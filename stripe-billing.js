/* ══════════════════════════════════════════════════════════════════════
   MALEVO · Integración Stripe (suscripciones, permanencia, facturación)
   ──────────────────────────────────────────────────────────────────────
   Módulo aislado de server.js para no inflar más el archivo principal.
   Se inicializa una vez con initStripe({readDB,writeDB,uuid}) y expone
   funciones puras que server.js llama desde sus rutas /api/stripe/* y
   /api/portal/stripe/*.

   Si no hay STRIPE_SECRET_KEY (o el paquete "stripe" no está instalado),
   el módulo queda en modo "no configurado": isConfigured() devuelve
   false y las funciones que dependen de la API lanzan un error con
   code:'NOT_CONFIGURED' — el resto de la app (pagos manuales, cashOnly,
   informes, etc.) sigue funcionando exactamente igual que antes.
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');

let StripeSDK = null;
try { StripeSDK = require('stripe'); } catch { StripeSDK = null; }

let stripe   = null;
let _readDB  = null;
let _writeDB = null;
let _uuid    = null;

function initStripe({ readDB, writeDB, uuid }) {
  _readDB = readDB; _writeDB = writeDB; _uuid = uuid;
  if (StripeSDK && process.env.STRIPE_SECRET_KEY) {
    stripe = StripeSDK(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  } else {
    stripe = null;
  }
  return isConfigured();
}

function isConfigured() { return !!stripe; }

function err(msg, code) { return Object.assign(new Error(msg), { code }); }

/* ── Meses de permanencia según el plan. Se puede configurar por plan en
   db.config.permanenciaMeses = {"35":0,"50":2,"80":2}; si un plan no está
   ahí, se usa un valor por defecto razonable (2 meses en 50€/80€, 0 en el
   resto) para no romper si el admin todavía no lo configuró. ── */
function mesesPermanencia(db, plan) {
  const cfg = db.config.permanenciaMeses || {};
  if (Object.prototype.hasOwnProperty.call(cfg, plan)) return Number(cfg[plan]) || 0;
  return (plan === '50' || plan === '80') ? 2 : 0;
}

/* ── ¿Estamos usando una clave de Stripe de test o de live? Se detecta
   por el prefijo de STRIPE_SECRET_KEY — Stripe no tiene forma de
   preguntárselo a la API, así que se deduce de la propia clave. ── */
function modoStripeActual() {
  const k = process.env.STRIPE_SECRET_KEY || '';
  if (k.startsWith('sk_test_')) return 'test';
  if (k.startsWith('sk_live_')) return 'live';
  return 'desconocido';
}

/* ── Crea (una sola vez, cacheado en db.config.stripePriceIds) el
   Product+Price recurrente mensual en Stripe para un plan. Así no hace
   falta que el admin los cree a mano en el Dashboard.
   IMPORTANTE: test y live son cuentas completamente separadas en
   Stripe — un Price ID creado en modo live no existe en modo test (y
   viceversa), así que el cache se guarda por separado en
   stripePriceIds.test / stripePriceIds.live. Si cambias la clave de
   entorno (por ejemplo para probar sin cobrar de verdad), la próxima
   vez que se necesite un precio simplemente se crea uno nuevo en el
   modo que corresponda — no hace falta tocar nada a mano. ── */
async function ensurePriceId(db, plan) {
  const modo = modoStripeActual();
  // Migración silenciosa: si stripePriceIds todavía tiene el formato
  // viejo (plano, sin distinguir test/live) se descarta — ese ID no
  // sirve para el modo actual y causaría "No such price" en Stripe.
  if (!db.config.stripePriceIds || typeof db.config.stripePriceIds.test !== 'object' || typeof db.config.stripePriceIds.live !== 'object') {
    db.config.stripePriceIds = { test: {}, live: {} };
  }
  const cache = db.config.stripePriceIds[modo] || (db.config.stripePriceIds[modo] = {});
  const cached = cache[plan];
  if (cached) return cached;
  const importe = (db.config.precios || {})[plan];
  if (!importe) throw err('Plan sin precio configurado: ' + plan, 'INVALID_PLAN');
  const product = await stripe.products.create({
    name: `Academia Malevo · Plan ${plan}€/mes`,
    metadata: { plan }
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: Math.round(importe * 100),
    recurring: { interval: 'month' }
  });
  cache[plan] = price.id;
  db._rev++; _writeDB(db);
  return price.id;
}

/* ── Checkout Session de Stripe. Elige sola el modo según el plan:
   - Planes de db.config.portalPlans (cuota mensual: 35/50/80€) → suscripción
     recurrente (mode:'subscription'), con Price cacheado vía ensurePriceId
     y el aviso de permanencia en custom_text.submit.message.
   - Cualquier otro plan con precio configurado en db.config.precios (p.ej.
     "bono", el Bono 5 Clases) → pago único (mode:'payment'), con el
     importe inline (price_data) porque no hay que cachear un Price fijo
     para algo que no se repite.
   Los datos fiscales (nombreCompleto/nifDniNie/direccionFiscal) son
   OPCIONALES: si el alumno ya los rellenó desde Mi Perfil se usan para el
   Customer de Stripe (mejor factura), pero si no existen no bloqueamos el
   pago — se crea el Customer solo con los datos que ya tenemos (nombre,
   email, teléfono). No usamos consent_collection.terms_of_service porque
   requiere tener una URL de Términos configurada en el Dashboard de
   Stripe, y fallaría si esa cuenta no la tiene puesta.
   metodoPreferido es puramente informativo (qué opción marcó el alumno en
   nuestro formulario: tarjeta/bizum/transferencia) — se guarda como
   metadata para que el admin lo vea, pero NO se fuerza como
   payment_method_types: es Stripe quien decide qué métodos mostrar en su
   propia pantalla de pago según lo habilitado en el Dashboard y el modo
   de la sesión. Importante: Bizum en Stripe solo está disponible para
   pagos únicos (mode:'payment'), no para suscripciones recurrentes — si
   un alumno marca "Bizum" para un plan mensual, Stripe simplemente no lo
   ofrecerá ahí y solo mostrará tarjeta. ── */
async function crearCheckoutSession({ db, user, plan, metodoPreferido, successUrl, cancelUrl }) {
  if (!stripe) throw err('Stripe no está configurado en este servidor.', 'NOT_CONFIGURED');
  if (user.cashOnly) throw err('Este alumno paga en efectivo — no corresponde cobro por Stripe.', 'CASH_ONLY');

  const esSuscripcion = (db.config.portalPlans || []).includes(plan);
  const importe = (db.config.precios || {})[plan];
  if (!esSuscripcion && !importe) throw err('Ese plan no admite pago online.', 'INVALID_PLAN');

  const fact = user.facturacion || {};
  const metaMetodo = metodoPreferido ? { metodoPreferido } : {};

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: fact.nombreCompleto || user.nombre,
      email: user.email || undefined,
      phone: user.telefono || undefined,
      ...(fact.direccionFiscal ? { address: { line1: fact.direccionFiscal } } : {}),
      metadata: { userId: user.id, ...(fact.nifDniNie ? { nifDniNie: fact.nifDniNie } : {}) }
    });
    customerId = customer.id;
    user.stripeCustomerId = customerId;
    db._rev++; _writeDB(db);
  }

  if (esSuscripcion) {
    const meses   = mesesPermanencia(db, plan);
    const priceId = await ensurePriceId(db, plan);
    const permanenciaTexto = meses > 0
      ? `Esta tarifa (${plan}€/mes) tiene un compromiso de permanencia de ${meses} mes${meses === 1 ? '' : 'es'}. Al confirmar el pago aceptas este compromiso.`
      : 'Esta tarifa no tiene compromiso de permanencia mínima.';

    return stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { userId: user.id, plan, minimum_commitment_months: String(meses), ...metaMetodo }
      },
      metadata: { userId: user.id, plan, minimum_commitment_months: String(meses), ...metaMetodo },
      custom_text: { submit: { message: permanenciaTexto.slice(0, 499) } },
      success_url: successUrl,
      cancel_url: cancelUrl
    });
  }

  // Pago único (ej. Bono 5 Clases): sin Price cacheado ni permanencia — el
  // importe se define aquí mismo con price_data, y el webhook registra el
  // pago directamente en checkout.session.completed (no hay invoice para
  // un pago único, así que no pasa por invoice.payment_succeeded).
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: { name: `Academia Malevo · ${plan}` },
        unit_amount: Math.round(importe * 100)
      },
      quantity: 1
    }],
    metadata: { userId: user.id, plan, ...metaMetodo },
    payment_intent_data: { metadata: { userId: user.id, plan, ...metaMetodo } },
    success_url: successUrl,
    cancel_url: cancelUrl
  });
}

/* ── Checkout Session SIN cuenta previa — usada por el registro público
   de registro-membresia.html, que ya no pide nombre/email/teléfono en
   nuestro propio formulario. El alumno solo elige plan, preferencia de
   pago y acepta los términos; toda la identificación (nombre, email,
   teléfono) la recoge Stripe en su propia pantalla de Checkout:
   - billing_address_collection:'required' fuerza a Stripe a pedir
     nombre completo y dirección de facturación.
   - phone_number_collection.enabled pide el teléfono.
   Cuando el pago se confirma (webhook o vuelta del navegador con
   session_id), procesarCheckoutCompletado() crea la cuenta del alumno
   usando esos datos — nunca antes, y nunca sin pago real de por medio. ── */
async function crearCheckoutSessionDirecta({ db, plan, metodoPreferido, refCode, aceptadoImagen, aceptadoPermanencia, successUrl, cancelUrl }) {
  if (!stripe) throw err('Stripe no está configurado en este servidor.', 'NOT_CONFIGURED');

  const esSuscripcion = (db.config.portalPlans || []).includes(plan);
  const importe = (db.config.precios || {})[plan];
  if (!esSuscripcion && !importe) throw err('Ese plan no admite pago online.', 'INVALID_PLAN');

  const metaBase = {
    plan,
    ...(metodoPreferido ? { metodoPreferido } : {}),
    ...(refCode ? { refCode } : {}),
    aceptadoImagen: aceptadoImagen ? 'true' : 'false',
    aceptadoPermanencia: aceptadoPermanencia ? 'true' : 'false'
  };

  const base = {
    billing_address_collection: 'required',
    phone_number_collection: { enabled: true },
    success_url: successUrl,
    cancel_url: cancelUrl
  };

  if (esSuscripcion) {
    const meses   = mesesPermanencia(db, plan);
    const priceId = await ensurePriceId(db, plan);
    const permanenciaTexto = meses > 0
      ? `Esta tarifa (${plan}€/mes) tiene un compromiso de permanencia de ${meses} mes${meses === 1 ? '' : 'es'}. Al confirmar el pago aceptas este compromiso.`
      : 'Esta tarifa no tiene compromiso de permanencia mínima.';

    return stripe.checkout.sessions.create({
      ...base,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { ...metaBase, minimum_commitment_months: String(meses) } },
      metadata: { ...metaBase, minimum_commitment_months: String(meses) },
      custom_text: { submit: { message: permanenciaTexto.slice(0, 499) } }
    });
  }

  // Pago único (Bono 5 Clases): customer_creation:'always' porque en
  // mode:'payment' Stripe no crea un Customer persistente por defecto, y
  // lo necesitamos para poder identificar/gestionar al alumno después.
  return stripe.checkout.sessions.create({
    ...base,
    mode: 'payment',
    customer_creation: 'always',
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: { name: `Academia Malevo · ${plan}` },
        unit_amount: Math.round(importe * 100)
      },
      quantity: 1
    }],
    metadata: metaBase,
    payment_intent_data: { metadata: metaBase }
  });
}

/* ── Genera el passwordHash con el mismo esquema PBKDF2 que usa
   server.js (salt:hash, 100000 iteraciones, sha512, 64 bytes) — se
   duplica aquí en vez de importar server.js para no crear una
   dependencia circular entre los dos módulos. ── */
function _hashPasswordInterno(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

/* ── Crea la cuenta del alumno a partir de una Checkout Session ya
   pagada, para el caso en que no había ningún usuario previo (alta
   directa desde registro-membresia.html: sin registro propio, todos los
   datos de identificación vienen de Stripe). Se llama únicamente desde
   procesarCheckoutCompletado(), después de confirmar que el pago se
   procesó — la cuenta nace ya activa. ── */
function crearUsuarioDesdeSesion(db, session) {
  const meta = session.metadata || {};
  const cd   = session.customer_details || {};
  const plan = meta.plan || null;

  let referrerId = null;
  if (meta.refCode) {
    const ref = db.users.find(u => u.referralCode === meta.refCode);
    if (ref) referrerId = ref.id;
  }

  const nombre = (cd.name || '').trim() || (cd.email ? cd.email.split('@')[0] : 'Alumno Malevo');

  const nuevo = {
    id: _uuid(),
    username: 'user_' + crypto.randomBytes(4).toString('hex'),
    passwordHash: _hashPasswordInterno(crypto.randomBytes(16).toString('hex')),
    role: 'student',
    nombre,
    email: (cd.email || '').trim(),
    telefono: (cd.phone || '').trim(),
    active: true,
    plan,
    pendingPayment: false,
    guestCourtesy: false,
    cashOnly: false,
    portalAccess: false,
    facturaEnvio: 'none',
    referralCode: _uuid().slice(0, 8),
    referredBy: referrerId,
    profileComplete: false,
    createdAt: new Date().toISOString(),
    diasAsistencia: [],
    aceptadoImagen: meta.aceptadoImagen === 'true',
    aceptadoPermanencia: meta.aceptadoPermanencia === 'true',
    fechaRegistro: new Date().toISOString(),
    stripeCustomerId: session.customer
  };
  db.users.push(nuevo);
  return nuevo;
}

/* ── Registra en db.payments el cobro correspondiente a una invoice de
   Stripe ya pagada (si no estaba ya registrada) y consume un mes de
   descuento por referidos si el usuario tenía uno pendiente. La usan
   tanto el webhook invoice.payment_succeeded como el registro inmediato
   de la primera factura de una suscripción recién confirmada (ver
   procesarCheckoutCompletado más abajo) — la deduplicación por
   stripeInvoiceId asegura que la factura nunca se registra dos veces,
   sin importar cuál de los dos caminos llegue primero. Devuelve true si
   se registró un pago nuevo (para que el llamador sepa si debe marcar
   "changed" y guardar la base de datos). ── */
async function registrarFacturaDesdeInvoice({ db, user, invoice }) {
  const yaRegistrado = db.payments.find(p => p.stripeInvoiceId === invoice.id);
  if (yaRegistrado) return false;

  db.contadorTicket = (db.contadorTicket || 0) + 1;
  const mes = new Date((invoice.period_start || invoice.created) * 1000).toISOString().slice(0, 7);
  const fechaPago = new Date(
    (invoice.status_transitions && invoice.status_transitions.paid_at) || invoice.created
  ).toISOString().slice(0, 10);
  db.payments.push({
    id: _uuid(),
    numeroTicket: db.contadorTicket,
    userId: user.id,
    mes,
    fechaPago,
    importe: (invoice.amount_paid || 0) / 100,
    metodo: 'Stripe',
    notas: `Cobro Stripe · plan ${user.plan || ''}`,
    origen: 'stripe',
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: invoice.subscription || user.stripeSubscriptionId || null
  });

  // Consumir 1 mes de descuento por referidos si este usuario tenía uno
  // pendiente: sincronizarDescuentoReferidos() mantiene el cupón de la
  // suscripción siempre alineado con referralMesesPendientes (ver el
  // comentario junto a esa función). El chequeo de "yaRegistrado" de
  // arriba evita descontar dos veces si esta misma factura se procesa
  // por dos caminos (webhook + confirmación inmediata) o si Stripe
  // reintenta la entrega del evento.
  if (invoice.subscription && Number(user.referralMesesPendientes || 0) > 0) {
    user.referralMesesPendientes = Number(user.referralMesesPendientes) - 1;
    await sincronizarDescuentoReferidos({ db, user });
  }

  return true;
}

/* ── Lógica compartida para "una Checkout Session se pagó de verdad":
   la usan tanto el webhook (manejarWebhook, abajo) como la confirmación
   inmediata al volver del navegador (confirmarCheckoutSession). Busca el
   usuario dueño de la sesión (por metadata.userId, para los flujos donde
   la cuenta ya existía) o por stripeCustomerId (idempotencia: si esta
   sesión ya se procesó antes, sea por webhook o por confirmación
   inmediata, no vuelve a crear nada). Si no encuentra a nadie Y la
   sesión trae un plan en su metadata, crea la cuenta nueva — el caso del
   alta directa sin registro previo. Devuelve el usuario afectado, o null
   si la sesión no corresponde a ningún flujo conocido. ── */
async function procesarCheckoutCompletado({ db, session }) {
  if (session.mode !== 'subscription' && session.mode !== 'payment') return null;

  const userByCustomer = (customerId) => db.users.find(u => u.stripeCustomerId === customerId);
  const userByMeta     = (meta) => (meta && meta.userId) ? db.users.find(u => u.id === meta.userId) : null;
  const portalPlans    = () => db.config.portalPlans || [];

  let user = userByMeta(session.metadata) || userByCustomer(session.customer);
  if (!user) {
    if (!session.metadata || !session.metadata.plan) return null; // sesión ajena a este flujo
    user = crearUsuarioDesdeSesion(db, session);
  }

  user.stripeCustomerId = session.customer;
  user.active         = true;
  user.pendingPayment = false;
  const plan = session.metadata && session.metadata.plan;

  // Recompensa de referidos: si este usuario llegó con el enlace de otro
  // alumno (referredBy) y acaba de completar su primer pago por Stripe,
  // el promotor gana un mes más de 30% de descuento. Idempotente.
  await otorgarRecompensaReferidoSiCorresponde({ db, user });

  if (session.mode === 'subscription') {
    user.stripeSubscriptionId = session.subscription;
    if (plan && portalPlans().includes(plan)) { user.plan = plan; user.portalAccess = true; }
    user.subscriptionStatus = 'active';
    user.permanenciaMesesRequeridos = Number((session.metadata && session.metadata.minimum_commitment_months) || 0);
    user.permanenciaInicio = user.permanenciaInicio || new Date().toISOString();
    // Por si este usuario YA tenía meses de descuento por referidos
    // pendientes de antes de tener suscripción (ej. invitó a alguien
    // mientras pagaba en efectivo, y ahora se pasa a Stripe): se
    // adjunta el cupón a la suscripción recién creada.
    await sincronizarDescuentoReferidos({ db, user });

    // Registrar la primera factura de la suscripción AQUÍ MISMO, sin
    // esperar al webhook invoice.payment_succeeded (que puede tardar
    // unos segundos, o no llegar nunca si el webhook no está bien
    // configurado — ver el incidente de hoy con el modo test). Stripe
    // Checkout ya cobró la primera cuota antes de completar la sesión de
    // suscripción, así que session.invoice ya apunta a una factura
    // pagada en este momento. Usa el mismo stripeInvoiceId que el
    // webhook para deduplicar — si el webhook SÍ llega después, no
    // registra nada dos veces (ver registrarFacturaDesdeInvoice).
    if (session.invoice) {
      try {
        const invoice = await stripe.invoices.retrieve(session.invoice);
        const registrada = await registrarFacturaDesdeInvoice({ db, user, invoice });
        console.log(`[stripe] factura de suscripción ${registrada ? 'registrada' : 'ya existía'} al confirmar checkout: userId=${user.id} invoiceId=${invoice.id} importe=${(invoice.amount_paid||0)/100}`);
      } catch (e) {
        console.error('[stripe] no se pudo recuperar/registrar la primera factura de la suscripción (sessionId=' + session.id + '):', e.message);
      }
    } else {
      console.warn(`[stripe] checkout de suscripción sin session.invoice (sessionId=${session.id}) — la factura quedará pendiente de invoice.payment_succeeded.`);
    }
  } else {
    // Pago único (ej. Bono 5 Clases): sin suscripción ni permanencia.
    // No hay invoice para un pago único, así que el cobro se registra
    // aquí mismo — con el id de la sesión como clave de idempotencia
    // por si Stripe reenvía el evento o si el webhook y la confirmación
    // inmediata procesan la misma sesión por separado.
    if (plan) user.plan = plan;
    const yaRegistrado = db.payments.find(p => p.stripeSessionId === session.id);
    if (!yaRegistrado) {
      db.contadorTicket = (db.contadorTicket || 0) + 1;
      db.payments.push({
        id: _uuid(),
        numeroTicket: db.contadorTicket,
        userId: user.id,
        mes: new Date().toISOString().slice(0, 7),
        fechaPago: new Date().toISOString().slice(0, 10),
        importe: (session.amount_total || 0) / 100,
        metodo: 'Stripe',
        notas: `Pago único Stripe · plan ${plan || ''}`,
        origen: 'stripe',
        tipo: 'pago_unico',
        stripeSessionId: session.id
      });
    }
  }

  return user;
}

/* ── Confirma una Checkout Session consultando a Stripe DIRECTAMENTE
   (no depende de que el webhook ya haya llegado) — se usa cuando el
   alumno vuelve de Stripe con ?session_id=... en la URL, para poder
   loguearlo al instante en vez de esperar al webhook. Es idempotente:
   si el webhook ya procesó esta sesión, procesarCheckoutCompletado()
   simplemente encuentra al usuario ya creado y no duplica nada. ── */
async function confirmarCheckoutSession({ db, sessionId }) {
  console.log(`[stripe:confirmar-checkout] modo=${modoStripeActual()} sessionId=${sessionId}`);
  if (!stripe) throw err('Stripe no está configurado en este servidor.', 'NOT_CONFIGURED');
  if (!sessionId) throw err('Falta el identificador de la sesión de pago.', 'MISSING_SESSION_ID');

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (e) {
    // Causa típica: sessionId de un modo (test/live) distinto al de la
    // STRIPE_SECRET_KEY actual — Stripe responde "No such checkout.session"
    // porque cada modo tiene su propio espacio de IDs, igual que con los
    // Price IDs (ver modoStripeActual/ensurePriceId más arriba).
    console.error(`[stripe:confirmar-checkout] ERROR al consultar la sesión en Stripe (modo=${modoStripeActual()}):`, e.message);
    throw e;
  }
  console.log(`[stripe:confirmar-checkout] sessionId=${sessionId} payment_status=${session.payment_status} mode=${session.mode} customer=${session.customer} metadata=${JSON.stringify(session.metadata)}`);

  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    console.log(`[stripe:confirmar-checkout] pago aún no confirmado (payment_status=${session.payment_status}) — se informa "pending" al frontend.`);
    return { pagado: false, user: null };
  }
  const user = await procesarCheckoutCompletado({ db, session });
  if (user) {
    db._rev++; _writeDB(db);
    console.log(`[stripe:confirmar-checkout] cuenta activada: userId=${user.id} email=${user.email} plan=${user.plan}`);
  } else {
    console.warn(`[stripe:confirmar-checkout] sesión pagada pero procesarCheckoutCompletado() devolvió null (sessionId=${sessionId}, metadata=${JSON.stringify(session.metadata)}) — revisar que la sesión traiga metadata.plan o metadata.userId.`);
  }
  return { pagado: !!user, user };
}

/* ── Webhook: verifica la firma con STRIPE_WEBHOOK_SECRET y sincroniza
   db.users / db.payments según el evento. rawBody debe ser el cuerpo TAL
   CUAL llegó (sin JSON.parse) — server.js ya lo entrega así. ── */
async function manejarWebhook({ rawBody, signature }) {
  console.log(`[stripe:webhook] petición recibida · modo=${modoStripeActual()} bytes=${rawBody ? rawBody.length : 0} tieneFirma=${!!signature}`);
  if (!stripe) { console.error('[stripe:webhook] RECHAZADO: Stripe no está configurado (falta STRIPE_SECRET_KEY o el paquete "stripe").'); throw err('Stripe no está configurado en este servidor.', 'NOT_CONFIGURED'); }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) { console.error('[stripe:webhook] RECHAZADO: falta STRIPE_WEBHOOK_SECRET en el entorno.'); throw err('STRIPE_WEBHOOK_SECRET no está configurado.', 'NOT_CONFIGURED'); }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret); // lanza si la firma no es válida
  } catch (e) {
    // Causa más común de este error: el STRIPE_WEBHOOK_SECRET configurado
    // aquí no coincide con el del endpoint que de verdad envió este
    // evento — por ejemplo, un whsec_ copiado del Dashboard (modo live o
    // un endpoint distinto) mientras la app corre en test, o un whsec_
    // desactualizado de una sesión anterior de "stripe listen" (el CLI
    // genera uno nuevo cada vez que se ejecuta, salvo que se fije con
    // --print-secret). Sin firma válida, Stripe SÍ envió el evento pero
    // aquí se descarta por seguridad — nunca llega a tocar la base de
    // datos.
    console.error(`[stripe:webhook] FIRMA INVÁLIDA (modo=${modoStripeActual()}, secret configurado empieza por "${secret.slice(0,10)}…"): ${e.message}`);
    throw err('Firma de webhook inválida: ' + e.message, 'INVALID_SIGNATURE');
  }
  console.log(`[stripe:webhook] evento verificado: id=${event.id} type=${event.type} livemode=${event.livemode}`);

  const db = _readDB();
  let changed = false;

  const userByCustomer = (customerId) => db.users.find(u => u.stripeCustomerId === customerId);
  const userByMeta     = (meta) => (meta && meta.userId) ? db.users.find(u => u.id === meta.userId) : null;
  const portalPlans    = () => db.config.portalPlans || [];

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log(`[stripe:webhook] checkout.session.completed · sessionId=${session.id} payment_status=${session.payment_status} mode=${session.mode} customer=${session.customer} metadata=${JSON.stringify(session.metadata)}`);
      const user = await procesarCheckoutCompletado({ db, session });
      if (user) {
        changed = true;
        console.log(`[stripe:webhook] cuenta activada por webhook: userId=${user.id} email=${user.email} plan=${user.plan}`);
      } else {
        console.warn(`[stripe:webhook] checkout.session.completed sin efecto (sessionId=${session.id}) — no se encontró ni se pudo crear usuario. Revisar metadata.userId / metadata.plan de la sesión.`);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub  = event.data.object;
      const user = userByMeta(sub.metadata) || userByCustomer(sub.customer);
      if (!user) break;
      user.stripeSubscriptionId = sub.id;
      user.subscriptionStatus   = sub.status; // active | trialing | past_due | canceled | unpaid | incomplete...
      if (sub.status === 'active' || sub.status === 'trialing') {
        user.active = true;
        if (portalPlans().includes(user.plan)) user.portalAccess = true;
      }
      if (sub.metadata && sub.metadata.minimum_commitment_months !== undefined) {
        user.permanenciaMesesRequeridos = Number(sub.metadata.minimum_commitment_months) || 0;
      }
      if (!user.permanenciaInicio && sub.start_date) {
        user.permanenciaInicio = new Date(sub.start_date * 1000).toISOString();
      }
      changed = true;
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const user = userByCustomer(invoice.customer);
      if (!user) break;
      const registrada = await registrarFacturaDesdeInvoice({ db, user, invoice });
      if (registrada) changed = true;
      if (user.subscriptionStatus === 'en_deuda' || user.subscriptionStatus === 'past_due') {
        user.subscriptionStatus = 'active';
        user.active = true;
        if (portalPlans().includes(user.plan)) user.portalAccess = true;
        changed = true;
      }
      break;
    }

    // Impago: Stripe ya reintenta el cobro automáticamente si "Smart
    // Retries" está activado en el Dashboard (Configuración → Facturación
    // → Suscripciones y facturas) — eso es un ajuste de cuenta, no de
    // código. Aquí solo reflejamos el estado mientras dure el impago.
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const user = userByCustomer(invoice.customer);
      if (!user) break;
      user.subscriptionStatus = 'en_deuda';
      changed = true;
      break;
    }

    // Se dispara cuando la suscripción termina de verdad: se agotaron los
    // reintentos, o el alumno canceló y llegó al final del periodo pagado.
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = userByMeta(sub.metadata) || userByCustomer(sub.customer);
      if (!user) break;
      user.subscriptionStatus = 'acceso_suspendido';
      user.portalAccess = false;
      changed = true;
      break;
    }

    default:
      break; // otros eventos de Stripe se ignoran a propósito
  }

  if (changed) {
    db._rev++; _writeDB(db);
    console.log(`[stripe:webhook] db.json actualizado (rev=${db._rev}) tras evento ${event.type} (${event.id})`);
  } else {
    console.log(`[stripe:webhook] evento ${event.type} (${event.id}) procesado sin cambios en la base de datos.`);
  }
  return { received: true, type: event.type };
}

/* ══════════════════════════════════════════════════════════════════════
   REFERIDOS — descuento acumulativo del 30% por cada amigo que paga.
   ──────────────────────────────────────────────────────────────────────
   Modelo de datos en el usuario PROMOTOR (quien invita):
     referralMesesPendientes: número de meses de 30% de descuento que
       todavía se le deben — fuente de verdad única. Se incrementa +1
       cada vez que un amigo referido completa su primer pago (ver
       otorgarRecompensaReferidoSiCorresponde), y se decrementa -1 cada
       vez que se consume un mes (una factura de Stripe con el cupón
       aplicado, o un pago manual desde el portal — ver server.js
       /api/portal/pago).
   En el usuario REFERIDO (quien fue invitado):
     referralRecompensaOtorgada: flag que evita otorgar la recompensa dos
       veces al mismo promotor si Stripe reintenta la entrega del webhook
       (checkout.session.completed puede llegar duplicado).

   Por qué un cupón nuevo cada vez en vez de reutilizar uno: Stripe no
   permite editar duration_in_months de un cupón ya creado, así que cada
   cambio en referralMesesPendientes crea un cupón "repeating" fresco con
   el total pendiente actual y lo adjunta a la suscripción, reemplazando
   el anterior. Como referralMesesPendientes es la única fuente de
   verdad (nosotros decrementamos, no Stripe), esto se mantiene siempre
   consistente aunque cambie a mitad de un ciclo de facturación. ═══════ */
const REFERRAL_COUPON_META_KEY = 'malevo_referral';

/* Crea/reemplaza el cupón de descuento por referidos en la suscripción
 * de Stripe del usuario, según su referralMesesPendientes actual. Si no
 * tiene suscripción de Stripe (paga manual, o aún no se suscribió), no
 * hace nada — el descuento queda pendiente para cuando corresponda
 * (pago manual en /api/portal/pago, o esta misma función se vuelve a
 * llamar cuando el usuario sí se suscriba). Nunca lanza — un fallo aquí
 * no debe romper el flujo de pago del amigo referido ni el webhook. */
async function sincronizarDescuentoReferidos({ db, user }) {
  if (!stripe) return;
  if (!user || !user.stripeSubscriptionId) return;

  const pendientes = Number(user.referralMesesPendientes || 0);

  try {
    if (pendientes <= 0) {
      await stripe.subscriptions.deleteDiscount(user.stripeSubscriptionId);
      return;
    }
    const coupon = await stripe.coupons.create({
      percent_off: 30,
      duration: 'repeating',
      duration_in_months: pendientes,
      metadata: { [REFERRAL_COUPON_META_KEY]: '1', userId: user.id }
    });
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      discounts: [{ coupon: coupon.id }]
    });
  } catch (e) {
    console.warn('⚠ No se pudo sincronizar el cupón de referidos de Stripe para', user.id, '—', e.message);
  }
}

/* Se llama cuando un usuario referido (user.referredBy) acaba de
 * completar su primer pago de verdad, desde el webhook
 * checkout.session.completed (Stripe) — es el único disparador posible
 * ahora que no existe ninguna vía de auto-activación sin pago real.
 * Idempotente: si ya se otorgó para este usuario referido, no vuelve a sumar. */
async function otorgarRecompensaReferidoSiCorresponde({ db, user }) {
  if (!user || !user.referredBy || user.referralRecompensaOtorgada) return false;
  const referrer = db.users.find(x => x.id === user.referredBy);
  // Solo se otorga si quien invitó es un alumno de pago activo — un
  // invitado sin cuota (guestCourtesy) no tiene sobre qué aplicar el
  // descuento todavía.
  if (!referrer || !referrer.active || referrer.guestCourtesy) return false;

  referrer.referralMesesPendientes = Number(referrer.referralMesesPendientes || 0) + 1;
  user.referralRecompensaOtorgada = true;
  await sincronizarDescuentoReferidos({ db, user: referrer });
  return true;
}

/* ── ¿Ya cumplió el alumno los meses de permanencia de su plan? Sin dato
   de inicio no bloqueamos (evita falsos bloqueos con datos incompletos). ── */
function permanenciaCumplida(user) {
  const meses = Number(user.permanenciaMesesRequeridos || 0);
  if (meses <= 0) return true;
  if (!user.permanenciaInicio) return true;
  const inicio = new Date(user.permanenciaInicio);
  const ahora  = new Date();
  const mesesTranscurridos = (ahora.getFullYear() - inicio.getFullYear()) * 12 + (ahora.getMonth() - inicio.getMonth());
  return mesesTranscurridos >= meses;
}

/* ── Cancelación solicitada por el propio alumno. Si no cumplió la
   permanencia, se bloquea con el mensaje informativo pedido; si la
   cumplió, se programa la baja al final del periodo ya pagado
   (cancel_at_period_end) — el alumno sigue con acceso hasta esa fecha. ── */
async function cancelarSuscripcion({ user }) {
  if (!stripe) throw err('Stripe no está configurado en este servidor.', 'NOT_CONFIGURED');
  if (!user.stripeSubscriptionId) throw err('No tenés una suscripción activa de Stripe.', 'NO_SUBSCRIPTION');
  if (!permanenciaCumplida(user)) {
    const meses = Number(user.permanenciaMesesRequeridos || 0);
    throw err(
      `Tu tarifa tiene un compromiso de permanencia activa de ${meses} mes${meses === 1 ? '' : 'es'}. Para gestionar tu baja o cambio de plan, ponte en contacto con administración.`,
      'PERMANENCIA_ACTIVA'
    );
  }
  const sub = await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
  user.subscriptionStatus = 'pendiente_baja';
  return sub;
}

function estadoSuscripcion(user) {
  return {
    stripeConfigurado: isConfigured(),
    plan: user.plan || null,
    cashOnly: !!user.cashOnly,
    tieneSuscripcion: !!user.stripeSubscriptionId,
    tieneCustomer: !!user.stripeCustomerId,
    estado: user.subscriptionStatus || 'ninguno',
    permanenciaMeses: Number(user.permanenciaMesesRequeridos || 0),
    permanenciaInicio: user.permanenciaInicio || null,
    permanenciaCumplida: permanenciaCumplida(user),
    facturacionCompleta: !!(user.facturacion && user.facturacion.nombreCompleto && user.facturacion.nifDniNie && user.facturacion.direccionFiscal)
  };
}

/* ── Sesión del Customer Portal de Stripe: la página oficial de Stripe
   donde el propio alumno puede cambiar su tarjeta, ver/descargar sus
   facturas y (si esa opción está habilitada en el Dashboard) cancelar.
   Requiere que el alumno ya tenga un stripeCustomerId, que se crea en su
   primer checkout — si nunca llegó a iniciar un pago con tarjeta, no hay
   nada que gestionar todavía.
   Nota importante: el botón "Cancelar suscripción" propio de esta app
   (cancelarSuscripcion, arriba) aplica la regla de permanencia mínima del
   plan; el Customer Portal de Stripe NO conoce esa regla. Para que no se
   contradigan, conviene desactivar la cancelación dentro de la
   configuración del Customer Portal en el Dashboard de Stripe y dejar
   solo el cambio de método de pago y el histórico de facturas. ── */
async function crearBillingPortalSession({ user, returnUrl }) {
  if (!stripe) throw err('Stripe no está configurado en este servidor.', 'NOT_CONFIGURED');
  if (!user.stripeCustomerId) throw err('Todavía no tienes ninguna suscripción de pago con tarjeta.', 'NO_CUSTOMER');
  return stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl
  });
}

module.exports = {
  initStripe, isConfigured, mesesPermanencia,
  crearCheckoutSession, manejarWebhook,
  cancelarSuscripcion, estadoSuscripcion, permanenciaCumplida,
  sincronizarDescuentoReferidos, otorgarRecompensaReferidoSiCorresponde,
  crearBillingPortalSession,
  crearCheckoutSessionDirecta, confirmarCheckoutSession, modoStripeActual
};
