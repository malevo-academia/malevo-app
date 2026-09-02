<<<<<<< HEAD
/* ===== Malevo v3.0 · Servidor con JWT y RBAC estricto =====
 * Roles: admin | teacher | student | guest
 * Variables de entorno:
 *   JWT_SECRET            (obligatorio en producción)
 *   PORT                  (por defecto 8080)
 *   DATA_DIR              (por defecto ./data)
 *   STRIPE_SECRET_KEY     (clave secreta de Stripe — sk_test_... / sk_live_...)
 *   STRIPE_WEBHOOK_SECRET (firma del endpoint de webhook — whsec_...)
 *   PUBLIC_BASE_URL       (URL pública del sitio, para las redirecciones de Checkout;
 *                          si no está, se deduce del propio request)
 * Sin STRIPE_SECRET_KEY el servidor arranca y funciona igual — los
 * endpoints /api/stripe/* y /api/portal/stripe/* devuelven un error claro
 * en vez de romper el resto de la app (ver stripe-billing.js).
 */
'use strict';
const http     = require('http');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const PDFDoc   = require('pdfkit');
const archiver = require('archiver');

// Carga opcional de un archivo .env en la raíz del proyecto (sin depender
// de ningún paquete npm): cada línea "CLAVE=valor" se vuelca en
// process.env si esa variable todavía no estaba definida (así una
// variable ya exportada por el sistema/hosting siempre gana). Si no existe
// el archivo, no pasa nada — se sigue leyendo todo de process.env normal.
(function cargarDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    // Primera pasada: parsear a un objeto en memoria. Si una misma clave
    // aparece más de una vez en el archivo (p.ej. un bloque de claves de
    // prueba seguido de uno de claves reales), gana la ÚLTIMA aparición —
    // igual que el paquete "dotenv" estándar — para que añadir un bloque
    // nuevo al final del archivo funcione como se espera.
    const parsed = {};
    raw.split('\n').forEach(line => {
      const l = line.trim();
      if (!l || l.startsWith('#')) return;
      const eq = l.indexOf('=');
      if (eq === -1) return;
      const key = l.slice(0, eq).trim();
      let val = l.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) parsed[key] = val;
    });
    // Segunda pasada: solo se aplica al proceso si esa variable no vino ya
    // fijada por el entorno real (una variable exportada por el sistema o
    // el hosting siempre gana sobre el archivo .env).
    for (const key in parsed) {
      if (!(key in process.env)) process.env[key] = parsed[key];
    }
  } catch { /* .env opcional — cualquier error de lectura se ignora */ }
})();

const stripeBilling = require('./stripe-billing.js');
const firebaseBackup = require('./firebase.js');

const PORT      = process.env.PORT     || 8081;
const ROOT      = __dirname;
const DATA_DIR  = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE   = path.join(DATA_DIR, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'malevo_dev_secret_change_in_prod';
const TOKEN_TTL  = 30 * 24 * 3600; // 30 días en segundos
// Sesión más larga para compradores externos "solo cursos" (soloCursosExternos):
// su acceso al curso dura 1 año (cursosVencimientos), así que la sesión que
// los mantiene logueados en la PWA debería durar lo mismo — si usáramos el
// TOKEN_TTL normal (30 días) se les cerraría la sesión mucho antes de que se
// les venza el curso, obligándolos a re-loguearse por un canal (código
// passwordless) que hoy no envía SMS real.
const TOKEN_TTL_CURSO_EXTERNO = 365 * 24 * 3600; // 1 año en segundos

// ⚠️ Bypass de login para pruebas locales (ver /api/dev-auto-login más abajo).
// Ya no depende de ninguna variable de entorno: funciona automáticamente
// cuando la petición viene de la propia máquina (localhost/127.0.0.1),
// que es como se accede en pruebas locales. Si este mismo server.js se
// despliega en un servidor accesible por internet u otras personas, el
// bypass queda inactivo solo (nadie externo puede alcanzar "localhost"),
// pero sigue siendo buena práctica borrar este bloque antes de un
// despliegue real de producción.
//
// ⚠ FIX DE SEGURIDAD (detectado en producción): con cualquier proxy
// inverso delante del proceso (nginx, Caddy, Cloudflare, etc.) el proxy
// puede reenviar la conexión al proceso Node por una ruta interna que hace
// que req.socket.remoteAddress SIGA viéndose como 127.0.0.1/::1, aunque la
// petición venga de un visitante externo real. Eso dejaba entrar a
// cualquiera al panel admin sin credenciales vía /api/dev-auto-login.
// La señal fiable no es la IP del socket, sino la presencia de cabeceras
// x-forwarded-*: CUALQUIER proxy real (nginx, Caddy, Cloudflare, etc.)
// las añade siempre; una conexión realmente local (curl o navegador
// hablando directo con node server.js en localhost, sin proxy de por
// medio) nunca las manda. Por
// eso, si aparece cualquier cabecera x-forwarded-*, la tratamos como NO
// local sin importar lo que diga el socket — ver cookieSecureFlag() abajo,
// que ya depende de x-forwarded-proto para lo mismo.
function esConexionLocal(req) {
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers['x-forwarded-host']) {
    return false;
  }
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Añade el flag "Secure" a la cookie de sesión cuando la petición llega
// por HTTPS (un proxy inverso delante — nginx, Caddy, etc. — hace la
// TLS-termination y reenvía con x-forwarded-proto:https), para que el
// navegador nunca la mande por una conexión sin cifrar. En local
// (http://localhost) no se añade, así que el desarrollo/las pruebas
// siguen funcionando igual.
function cookieSecureFlag(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return (proto === 'https' || req.socket?.encrypted) ? '; Secure' : '';
}

/* ---------- Login passwordless del alumno ----------
 * El alumno se identifica con su email o teléfono registrado (sin
 * contraseña) y recibe un código temporal de 6 dígitos para confirmar el
 * acceso. Por ahora no hay ningún proveedor externo de email/SMS/WhatsApp
 * conectado (Twilio, SendGrid, etc.), así que enviarCodigoAcceso() es un
 * stub: el código se devuelve directamente en la respuesta de
 * /api/auth/passwordless/request para que el frontend lo "simule en
 * pantalla" y el alumno pueda confirmar sin fricción desde cualquier
 * dispositivo. Cuando se quiera conectar un proveedor real, basta con:
 *   1) implementar el envío de verdad dentro de enviarCodigoAcceso(), y
 *   2) dejar de incluir "code" en la respuesta de /request (el frontend
 *      ya está preparado para que ese campo sea opcional).
 * Los códigos viven solo en memoria (no en data/db.json): son de un solo
 * uso y de corta duración, así que no hace falta persistirlos en disco. */
const _codigosAcceso = new Map(); // userId -> { code, exp }
const CODIGO_TTL_MS = 10 * 60 * 1000; // 10 minutos

function generarCodigoAcceso() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
}

// Token de un solo uso para enlaces de curso externos (ver /c/:token más
// abajo): estrictamente alfanumérico, sin guiones ni guiones bajos. Antes
// se usaba base64url (crypto.randomBytes(8).toString('base64url')), que
// incluye "-" y "_" en su alfabeto — WhatsApp en algunos móviles corta la
// URL justo en esos caracteres al hacer salto de línea, dejando el enlace
// roto en dos pedazos no clicables. Por eso acá se genera en base64
// estándar (que sí tiene un alfabeto conocido) y se filtran los símbolos
// no alfanuméricos (+, / y el padding =), rellenando con más bytes si el
// filtrado deja el resultado corto, hasta juntar exactamente `len`
// caracteres de un solo tirón (A-Z, a-z, 0-9).
function generarTokenAlfanumerico(len = 12) {
  let out = '';
  while (out.length < len) {
    out += crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  }
  return out.slice(0, len);
}

// Stub de envío — sustituir por una integración real (SendGrid, Twilio,
// WhatsApp Business API…) cuando esté disponible. Hoy no hace nada: el
// código se muestra en pantalla desde la propia respuesta del endpoint.
async function enviarCodigoAcceso(user, code) {
  return true;
}

// Normaliza un teléfono para comparar sin importar espacios, guiones,
// paréntesis o el prefijo de país de España (+34 / 0034). Solo se recorta
// el prefijo cuando el número resultante tiene exactamente 9 dígitos (el
// formato de un móvil español) — así evitamos "comernos" dígitos de datos
// mal cargados (p.ej. números de más de 9 dígitos sin prefijo real) que
// podrían chocar entre sí con un recorte genérico de "últimos 9 dígitos".
function normalizarTelefono(v) {
  const digitos = String(v || '').replace(/\D+/g, '');
  if (digitos.length === 11 && digitos.startsWith('34'))   return digitos.slice(2);
  if (digitos.length === 13 && digitos.startsWith('0034')) return digitos.slice(4);
  return digitos;
}

function buscarUsuarioPorContacto(db, contacto) {
  const c = String(contacto || '').trim();
  if (!c) return null;
  const cLower = c.toLowerCase();
  const cTelExacto = c.replace(/\s+/g, '');
  const cTelNorm   = normalizarTelefono(c);
  const coincide = u => u.role === 'student' &&
    ((u.email && u.email.toLowerCase() === cLower) ||
     (u.telefono && (
       u.telefono.replace(/\s+/g, '') === cTelExacto ||
       (cTelNorm && normalizarTelefono(u.telefono) === cTelNorm)
     )));
  const candidatos = (db.users || []).filter(coincide);
  if (!candidatos.length) return null;
  // Si hay varias coincidencias (p.ej. un registro anterior pendiente de
  // pago con el mismo email/teléfono), prioriza la cuenta activa.
  return candidatos.find(u => u.active) || candidatos[0];
}

/* ---------- MIME ---------- */
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp',
  '.gif':'image/gif', '.avif':'image/avif', '.bmp':'image/bmp',
  '.mp4':'video/mp4', '.webm':'video/webm', '.m4v':'video/x-m4v',
  '.txt':'text/plain; charset=utf-8', '.pdf':'application/pdf',
  '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf'
};

/* ---------- JWT puro (sin librería externa) ---------- */
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function signJWT(payload) {
  const header  = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const body    = b64url(JSON.stringify(payload));
  const sig     = b64url(crypto.createHmac('sha256', JWT_SECRET)
                    .update(header + '.' + body).digest());
  return header + '.' + body + '.' + sig;
}
function verifyJWT(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = b64url(crypto.createHmac('sha256', JWT_SECRET)
                    .update(parts[0] + '.' + parts[1]).digest());
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (p.exp && Date.now() / 1000 > p.exp) return null;
    return p;
  } catch { return null; }
}
function tokenFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // también acepta cookie malevo_jwt (fallback para SPA)
  const c = req.headers.cookie || '';
  const item = c.split(';').map(s=>s.trim()).find(s=>s.startsWith('malevo_jwt='));
  return item ? decodeURIComponent(item.slice('malevo_jwt='.length)) : null;
}
function getUser(req) { return verifyJWT(tokenFromReq(req)); }

/* ---------- Utilidades constante-time ---------- */
function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // consume tiempo igual
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------- Base de datos ---------- */
const DB_EMPTY = {
  config: {
    iva:21, mesesIniciales:3,
    inicial:{ malevo:80, box:20 }, posterior:{ malevo:70, box:30 },
    precios:{ 'suelta':12,'35':35,'50':50,'80':80,'bono':100 }, bonoClases:10,
    portalPlans:['35','50','bono','80'],   // planes con acceso al aula virtual
    negocio:{ nombre:'Academia de Baile Malevo', nif:'', direccion:'', contacto:'', pie:'' },
    // Meses de permanencia mínima exigidos por Stripe según el plan (0 =
    // sin compromiso). Editable desde db.json o un futuro panel; si un
    // plan no aparece acá, stripe-billing.js usa un valor por defecto
    // (2 meses en 50€/80€, 0 en el resto) — ver mesesPermanencia().
    permanenciaMeses: { '35':0, '50':2, '80':2, 'bono':0 },
    // Cache de los Price ID de Stripe ya creados por plan (se rellena solo
    // la primera vez que alguien paga ese plan — ver ensurePriceId()).
    stripePriceIds: {}
  },
  users: [],        // { id, username, passwordHash, role, nombre, email, active, plan, rol, assignedClasses, nivelBachata, nivelSalsa (arrays de niveles, selección libre — gestionados por el admin), nivelBachataPreferido, nivelSalsaPreferido (autopercibido por el alumno, informativo), referralCode, referredBy, referralMesesPendientes (meses de 30% pendientes por amigos referidos que pagaron, acumulativo — ver stripe-billing.js), referralRecompensaOtorgada (evita otorgar el mes dos veces si Stripe reintenta el webhook), profileComplete, pushSubs (suscripciones push del navegador/dispositivo), cursosAsignados (ids de db.cursos que el admin le dio acceso), stripeCustomerId, stripeSubscriptionId, subscriptionStatus, permanenciaMesesRequeridos, permanenciaInicio, facturacion:{nombreCompleto,nifDniNie,direccionFiscal} }
  classes: [],      // { id, nombre, estilo, nivel, nivelNum, dia, inicio, fin, aforo, hasVideo }
  enrollments: [],  // { id, userId, classId, nivelMax, status, fechaAlta }
  videos: [],       // { id, disciplina, nivel, titulo, url, orden }
  cursos: [],       // { id, nombre, ritmo:'bachata'|'salsa'|'otros', subcategoria, imagenPortada, nivel, duracion, videos:[{id,titulo,url,orden}], orden, activo }
  tokensCursoExterno: [], // Enlaces de UN SOLO USO para vender un Curso Exclusivo a gente de afuera que paga en persona
                      // (efectivo/en mano), sin pasarela online: { id, cursoId, token, usado, fechaGenerado, fechaUsado, userId }.
                      // El admin genera el token vacío desde "👥 Alumnos" (sin pedir datos todavía) y se lo pasa él mismo al
                      // comprador; recién cuando esa persona abre el link y completa su nombre+teléfono
                      // (POST /api/publico/token/:token/canjear) se crea/reutiliza su cuenta de alumno, el token se marca
                      // usado=true para siempre (no se puede volver a canjear) y queda logueada en el portal.
  attendances: [],  // { id, classId, userId, fecha, present }
  payments: [],     // { id, userId, mes, fechaPago, importe, metodo, notas, numeroTicket }
  contadorTicket: 0,
  _rev: 0
};

function ensureData() {
  // Si DATA_DIR apunta a un punto de montaje (otro disco/partición) que
  // todavía no está montado, mkdirSync/writeFileSync lanzan una excepción
  // síncrona ANTES de que server.listen() llegue a abrir el puerto — sin
  // pista de la causa real si no se atrapa. Con este try/catch al menos
  // queda un mensaje claro en los logs señalando el DATA_DIR concreto que
  // falló.
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
    if (!fs.existsSync(DB_FILE))  fs.writeFileSync(DB_FILE, JSON.stringify(DB_EMPTY,null,2));
  } catch (e) {
    console.error('✗ ERROR FATAL: no se pudo crear/acceder a DATA_DIR ("'+DATA_DIR+'"). ' +
      'Si DATA_DIR apunta a otro disco/partición montado aparte, comprueba que esté ' +
      'realmente montado en esa ruta exacta antes de arrancar el servicio. Detalle:', e.message);
    throw e;
  }
}
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch { return JSON.parse(JSON.stringify(DB_EMPTY)); }
}
function writeDB(obj) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj,null,2));
  fs.renameSync(tmp, DB_FILE);
  _programarBackupFirebase();
}

/* ---------- Backup de db.json en Firebase Storage ----------
   El disco de este servidor es persistente (a diferencia de plataformas
   con hosting efímero), así que este backup ya no es la única copia de
   los datos — es una red de seguridad extra ante un fallo de disco o un
   borrado accidental. Cada escritura programa (con un pequeño debounce,
   para no subir en cada cambio suelto si llegan varios seguidos) una
   subida en segundo plano del db.json actual a Firebase Storage — ver
   firebase.js. Si Firebase no está configurado o la subida falla, esto
   nunca bloquea ni rompe la petición que disparó el writeDB(): solo se
   registra un aviso en los logs. La restauración (bajar el último
   backup) pasa una sola vez, al arrancar, antes de abrir el puerto — ver
   iniciarServidor() más abajo. */
let _backupFirebaseTimer = null;
let _backupFirebasePendiente = false; // true si hay un cambio guardado localmente que aún no se subió
let _backupFirebaseChain = Promise.resolve(); // serializa subidas: nunca dos en paralelo pisándose
function _programarBackupFirebase() {
  _backupFirebasePendiente = true;
  if (_backupFirebaseTimer) clearTimeout(_backupFirebaseTimer);
  _backupFirebaseTimer = setTimeout(_ejecutarBackupFirebase, 4000);
}
function _ejecutarBackupFirebase() {
  if (_backupFirebaseTimer) { clearTimeout(_backupFirebaseTimer); _backupFirebaseTimer = null; }
  // Encadenada sobre la subida anterior (si la hubiera) en vez de lanzarla en
  // paralelo: así, si dos escrituras casi seguidas disparan cada una su propio
  // backup, la segunda espera a que termine la primera y siempre sube el
  // db.json más reciente en disco — nunca puede "ganar" una subida vieja que
  // tardó más en red y pisar con datos desactualizados una más nueva.
  _backupFirebaseChain = _backupFirebaseChain.then(() =>
    firebaseBackup.backupDBAFirebase(DB_FILE)
      .then(ok => { if (ok) { _backupFirebasePendiente = false; console.log('✓ Backup de db.json subido a Firebase Storage.'); } })
      .catch(e => console.warn('⚠ No se pudo subir el backup de db.json a Firebase Storage:', e.message))
  );
  return _backupFirebaseChain;
}

/* systemd (con `systemctl stop`/`restart malevo`, o cualquier otro
 * supervisor de procesos) manda SIGTERM antes de matar el proceso. Si
 * justo hay un backup pendiente (dentro de la ventana de
 * debounce de 4s de arriba), sin este hook ese último cambio se perdería
 * — se sube local pero nunca llega a Storage antes de que el proceso
 * termine. Al recibir la señal, si hay algo pendiente lo subimos ya
 * mismo (sin esperar el debounce) y solo entonces cerramos; con un tope
 * de 8s por si Firebase no responde, para no colgar el apagado. */
function _apagarConGracia(señal) {
  if (!_backupFirebasePendiente) { process.exit(0); return; }
  console.log('… '+señal+' recibido con un backup pendiente — subiendo a Firebase Storage antes de apagar.');
  const limite = new Promise(resolve => setTimeout(resolve, 8000));
  Promise.race([_ejecutarBackupFirebase(), limite]).finally(() => process.exit(0));
}
process.on('SIGTERM', () => _apagarConGracia('SIGTERM'));
process.on('SIGINT',  () => _apagarConGracia('SIGINT'));

/* ---------- Contraseñas (PBKDF2) ---------- */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}
function checkPassword(plain, stored) {
  const [salt, hash] = stored.split(':');
  const h = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return timingSafeEq(h, hash);
}

/* ---------- UUIDs ---------- */
function uuid() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>
    (c^crypto.randomBytes(1)[0]&15>>c/4).toString(16));
}

// Inicializa el módulo de Stripe con acceso a la base de datos. Si falta
// STRIPE_SECRET_KEY o el paquete "stripe" no está instalado, queda en modo
// "no configurado" (ver comentario al inicio de stripe-billing.js).
const _stripeConfigurado = stripeBilling.initStripe({ readDB, writeDB, uuid });

/* ══════════════════════════════════════════════════════════════════════
   WEB PUSH (notificaciones push reales) — implementación propia con el
   módulo "crypto" nativo de Node, SIN depender de la librería "web-push"
   de npm (este entorno no tiene acceso al registro de npm). Sigue:
     · RFC 8291 — cifrado del payload (esquema "aes128gcm")
     · RFC 8292 — autenticación VAPID (JWT firmado ES256)
   Las claves VAPID se generan una sola vez y se persisten en
   data/vapid.json: si cambiaran, las suscripciones ya guardadas por los
   alumnos (creadas en su navegador con la clave pública anterior) dejan
   de servir y habría que resuscribirlos.
   ══════════════════════════════════════════════════════════════════════ */
const VAPID_FILE    = path.join(DATA_DIR, 'vapid.json');
const VAPID_SUBJECT = 'mailto:notificaciones@malevo-academia.app';
let _vapidKeys = null;

function obtenerVapidKeys() {
  if (_vapidKeys) return _vapidKeys;
  if (fs.existsSync(VAPID_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE,'utf8'));
      if (saved && saved.publicKeyB64 && saved.privateKeyPem) {
        _vapidKeys = {
          publicKeyRaw: Buffer.from(saved.publicKeyB64,'base64url'),
          publicKeyB64: saved.publicKeyB64,
          privateKeyPem: saved.privateKeyPem
        };
        return _vapidKeys;
      }
    } catch {}
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve:'prime256v1' });
  const jwk = publicKey.export({format:'jwk'});
  const publicKeyRaw = Buffer.concat([
    Buffer.from([0x04]), Buffer.from(jwk.x,'base64url'), Buffer.from(jwk.y,'base64url')
  ]);
  const privateKeyPem = privateKey.export({format:'pem', type:'pkcs8'});
  const publicKeyB64  = publicKeyRaw.toString('base64url');
  _vapidKeys = { publicKeyRaw, publicKeyB64, privateKeyPem };
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
    fs.writeFileSync(VAPID_FILE, JSON.stringify({ publicKeyB64, privateKeyPem }, null, 2));
  } catch {}
  return _vapidKeys;
}

function _hmacSha256(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest(); }
// HKDF-Expand simplificado a un único bloque (válido porque aquí siempre
// pedimos <=32 bytes, el tamaño del hash usado).
function _hkdfExpand(prk, info, len) {
  return _hmacSha256(prk, Buffer.concat([info, Buffer.from([1])])).slice(0, len);
}

/* Firma un JWT ES256 (formato "raw" r||s de 64 bytes, no DER) para VAPID. */
function crearVapidJWT(endpointUrl, vapidKeys) {
  const aud = new URL(endpointUrl).origin;
  const header  = b64url(JSON.stringify({ typ:'JWT', alg:'ES256' }));
  const claims  = b64url(JSON.stringify({
    aud, exp: Math.floor(Date.now()/1000) + 12*3600, sub: VAPID_SUBJECT
  }));
  const signingInput = header + '.' + claims;
  const privateKey = crypto.createPrivateKey(vapidKeys.privateKeyPem);
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding:'ieee-p1363' });
  return signingInput + '.' + b64url(sig);
}

/* Cifra el payload según RFC 8291 (aes128gcm) para una suscripción push
   concreta (p256dh/auth vienen del navegador del alumno). */
function cifrarPayloadWebPush(payloadBuf, p256dhB64, authB64) {
  const uaPublicRaw = Buffer.from(p256dhB64, 'base64url');
  const authSecret  = Buffer.from(authB64, 'base64url');

  const asECDH = crypto.createECDH('prime256v1');
  asECDH.generateKeys();
  const asPublicRaw = asECDH.getPublicKey();
  const ecdhSecret  = asECDH.computeSecret(uaPublicRaw);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublicRaw, asPublicRaw]);
  const prkKey  = _hmacSha256(authSecret, ecdhSecret);
  const ikm     = _hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const prk  = _hmacSha256(salt, ikm);
  const cek   = _hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = _hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  const record = Buffer.concat([payloadBuf, Buffer.from([0x02])]); // 0x02 = único/último registro
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct  = Buffer.concat([cipher.update(record), cipher.final()]);
  const ciphertext = Buffer.concat([ct, cipher.getAuthTag()]);

  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0); // "record size" — solo un límite superior, el registro real puede ser más corto
  const header = Buffer.concat([salt, rsBuf, Buffer.from([asPublicRaw.length]), asPublicRaw]);
  return Buffer.concat([header, ciphertext]);
}

/* Envía una notificación push a UNA suscripción. Rechaza con
   {statusCode} si el servicio push responde con error (404/410 = la
   suscripción ya no existe y debe eliminarse). */
function enviarWebPush(subscription, payloadObj, vapidKeys) {
  return new Promise((resolve, reject) => {
    try {
      const payloadBuf  = Buffer.from(JSON.stringify(payloadObj));
      const cuerpo      = cifrarPayloadWebPush(payloadBuf, subscription.keys.p256dh, subscription.keys.auth);
      const jwt         = crearVapidJWT(subscription.endpoint, vapidKeys);
      const endpointUrl = new URL(subscription.endpoint);
      const reqOpts = {
        method: 'POST',
        hostname: endpointUrl.hostname,
        port: endpointUrl.port || 443,
        path: endpointUrl.pathname + (endpointUrl.search || ''),
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'Content-Length': cuerpo.length,
          'TTL': '86400',
          'Authorization': `vapid t=${jwt}, k=${vapidKeys.publicKeyB64}`
        }
      };
      const r = https.request(reqOpts, resp => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) resolve({ok:true});
          else reject({ statusCode: resp.statusCode, body: Buffer.concat(chunks).toString() });
        });
      });
      r.on('error', reject);
      r.write(cuerpo);
      r.end();
    } catch (e) { reject(e); }
  });
}

/* ---------- Utilidades HTTP ---------- */
function json(res, code, obj, extra) {
  const h = Object.assign({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, extra||{});
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise(resolve=>{
    let b='';
    req.on('data',c=>{ b+=c; if(b.length>10e6) req.destroy(); });
    req.on('end',()=>resolve(b));
  });
}
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  // La raíz sirve el Panel de Administrador directamente (en localhost,
  // el auto-login de admin entra sin pedir credenciales — ver dev-auto-login).
  if (rel === '/') rel = '/index.html';
  const fp = path.normalize(path.join(ROOT, rel));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err,data)=>{
    if (err) { res.writeHead(404,{'Cache-Control':'no-store'}); return res.end('Not found'); }
    const ext = path.extname(fp).toLowerCase();
    const ct  = MIME[ext] || 'application/octet-stream';
    // bloqueamos descarga directa de vídeos sin token
    if (['.mp4','.webm','.m4v'].includes(ext)) {
      const u = getUser(req);
      if (!u) { res.writeHead(401); return res.end('Unauthorized'); }
    }
    // Sin caché: esto es una app en desarrollo local — si un archivo (foto,
    // logo, Rachas.png, etc.) cambia o se agrega recién, algunos navegadores
    // (sobre todo Safari/Chrome de celular) pueden quedarse con una versión
    // vieja o un 404 en caché y el archivo nuevo "no aparece" hasta borrar
    // caché a mano. Evitamos esa clase entera de bug.
    res.writeHead(200,{'Content-Type':ct,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(data);
  });
}

/* ---------- Middleware RBAC ---------- */
const FINANCE_ROUTES = ['/api/payments','/api/db','/api/reports','/api/config'];
function isFinanceRoute(url) {
  return FINANCE_ROUTES.some(r => url === r || url.startsWith(r+'/'));
}
function requireRole(roles) {
  return (req, res) => {
    const u = getUser(req);
    if (!u) { json(res,401,{ok:false,error:'No autenticado'}); return false; }
    if (!roles.includes(u.role)) {
      // HTTP 403 inmediato para profesores que intentan acceder a finanzas
      json(res,403,{ok:false,error:'Acceso denegado'}); return false;
    }
    req._user = u;
    return true;
  };
}
function authAny(req, res) {
  const u = getUser(req);
  if (!u) { json(res,401,{ok:false,error:'No autenticado'}); return false; }
  req._user = u;
  // Bloqueo estricto: profesores nunca tocan rutas financieras
  if (u.role === 'teacher' && isFinanceRoute(req.url.split('?')[0])) {
    json(res,403,{ok:false,error:'Acceso denegado: área financiera'}); return false;
  }
  // Bloqueo: usuarios con cuenta inactiva (pago pendiente) no acceden a contenido
  if (u.role === 'student') {
    const db_ = readDB();
    const userRec = db_.users.find(x=>x.id===u.sub);
    if (userRec && !userRec.active) {
      json(res,402,{ok:false,error:'Cuenta pendiente de activación. Completa el pago.'}); return false;
    }
  }
  return true;
}
// Igual que authAny, pero SIN bloquear a los alumnos con pago pendiente
// (active:false). Se usa solo en las rutas que un alumno recién
// registrado necesita alcanzar para completar su primer pago por Stripe
// (guardar datos fiscales + crear la Checkout Session + consultar su
// estado): con authAny() normal quedarían atrapados en un bucle
// imposible — bloqueados por no haber pagado, pero sin forma de llegar
// al pago porque esas mismas rutas están bloqueadas. El resto de rutas
// de contenido (clases, perfil, vídeos…) siguen usando authAny estricto.
function authAnyPendiente(req, res) {
  const u = getUser(req);
  if (!u) { json(res,401,{ok:false,error:'No autenticado'}); return false; }
  req._user = u;
  if (u.role === 'teacher' && isFinanceRoute(req.url.split('?')[0])) {
    json(res,403,{ok:false,error:'Acceso denegado: área financiera'}); return false;
  }
  return true;
}

/* ---------- Lógica de niveles: selección libre e independiente ---------- */
// Recibe el conjunto EXACTO de niveles (números) que el alumno debe tener
// desbloqueados para una disciplina. No es acumulativo: marcar solo el
// nivel 3 no desbloquea el 1 ni el 2. Los niveles que ya no estén en el
// conjunto se revocan (status:'paused') si el alumno los tenía antes.
function unlockLevels(db, userId, disciplina, niveles) {
  const nivelesSet = new Set((niveles||[]).map(Number).filter(n=>!isNaN(n)));
  const clases = db.classes.filter(c => c.estilo === disciplina && c.hasVideo);
  clases.forEach(c => {
    const nivelNum = c.nivelNum || 0;
    const existing = db.enrollments.find(e => e.userId===userId && e.classId===c.id);
    if (nivelesSet.has(nivelNum)) {
      if (!existing) {
        db.enrollments.push({
          id: uuid(), userId, classId: c.id,
          nivelMax: nivelNum, status:'active', fechaAlta: new Date().toISOString().slice(0,10)
        });
      } else {
        existing.nivelMax = nivelNum;
        existing.status = 'active';
      }
    } else if (existing && existing.status==='active') {
      existing.status = 'paused';
    }
  });
}

/* ══════════════════════════════════════════════
   GENERACIÓN DE PDF CON PDFKIT
══════════════════════════════════════════════ */
function generarPDFFactura(p, db) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const doc = new PDFDoc({ size: 'A4', margin: 50, bufferPages: true });
      doc.on('data',  d   => chunks.push(d));
      doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const c       = db.config;
      const neg     = c.negocio || {};
      const ivaRate = c.iva ?? 21;
      const base    = p.importe / (1 + ivaRate / 100);
      const ivaAmt  = p.importe - base;
      const f = x  => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' EUR';

      const u       = (db.users||[]).find(x => x.id === p.userId);
      const numT    = p.numeroTicket ? 'T-' + String(p.numeroTicket).padStart(5,'0') : '---';
      const fechaStr = new Date((p.fechaPago || new Date().toISOString().slice(0,10)) + 'T12:00:00')
        .toLocaleDateString('es-ES', {day:'numeric', month:'long', year:'numeric'});
      const mesStr  = p.mes
        ? new Date(p.mes+'-01T00:00:00').toLocaleDateString('es-ES',{month:'long',year:'numeric'})
        : '';
      const PLAN_LABELS = {
        suelta:'Clase suelta', '35':'Tarifa 1 clase/semana',
        '50':'Tarifa 2 clases/semana', '80':'Tarifa VIP / Full Pass', bono:'Bono 5 clases'
      };
      const planLabel = (u && PLAN_LABELS[u.plan]) ? PLAN_LABELS[u.plan] : 'Servicio de clases de baile';
      // Limpiar emojis del concepto y campos de texto
      const limpiar = s => (s||'').replace(/[^\x00-\x7FÀ-ÿ\u00C0-\u017E]/g, '').trim();
      const concepto      = limpiar(p.notas || (mesStr ? `${planLabel} - ${mesStr}` : 'Clase de baile'));
      const clienteNombre = limpiar((u && p.userId !== '__anonimo__') ? (u.nombre||'---') : 'Publico en general');
      const nombreAcademia= limpiar(neg.nombre || 'Academia de Baile Malevo');
      const pieTexto      = limpiar(neg.pie || 'Gracias por bailar con nosotros');

      const ORO   = '#c9a84c';
      const GRIS  = '#666666';
      const NEGRO = '#1a1a1a';
      const W     = 495;

      // ── Logo ────────────────────────────────────────────────────────────
      if (neg.logo && neg.logo.startsWith('data:image/')) {
        try {
          const comma = neg.logo.indexOf(',');
          const buf   = Buffer.from(neg.logo.slice(comma+1), 'base64');
          doc.image(buf, 50, 50, { fit:[120,60] });
        } catch(e) { /* logo inválido, ignorar */ }
      }

      // ── Cabecera emisor ──────────────────────────────────────────────────
      const hdrX = 270;
      doc.fontSize(11).fillColor(NEGRO).font('Helvetica-Bold')
         .text(nombreAcademia, hdrX, 50, {width: W - (hdrX-50)});
      doc.fontSize(9).fillColor(GRIS).font('Helvetica');
      let hy = 65;
      if (neg.nif)       { doc.text('NIF: ' + limpiar(neg.nif),       hdrX, hy, {width: W-(hdrX-50)}); hy += 13; }
      if (neg.direccion) { doc.text(limpiar(neg.direccion),             hdrX, hy, {width: W-(hdrX-50)}); hy += 13; }
      if (neg.telefono)  { doc.text('Tel: ' + limpiar(neg.telefono),   hdrX, hy, {width: W-(hdrX-50)}); hy += 13; }
      if (neg.email)     { doc.text(limpiar(neg.email),                 hdrX, hy, {width: W-(hdrX-50)}); }

      // ── Línea dorada ────────────────────────────────────────────────────
      doc.moveTo(50, 125).lineTo(545, 125).lineWidth(2).strokeColor(ORO).stroke();

      // ── Número y fecha ───────────────────────────────────────────────────
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('FACTURA SIMPLIFICADA', 50, 138);
      doc.fontSize(22).fillColor(ORO).font('Helvetica-Bold')
         .text(numT, 50, 150);
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
         .text(fechaStr, 50, 176);

      // ── Cliente ──────────────────────────────────────────────────────────
      // Altura dinámica: la caja crece según cuántas líneas de datos del
      // cliente haya realmente (NIF/dirección fiscal son nuevos y no todos
      // los pagos antiguos los tienen), para que nunca se corten ni
      // choquen con la tabla de abajo.
      const clienteLineas = [
        u?.facturacion?.nifDniNie ? ('NIF/DNI/NIE: ' + limpiar(u.facturacion.nifDniNie)) : null,
        u?.facturacion?.direccionFiscal ? limpiar(u.facturacion.direccionFiscal) : null,
        u?.email ? ('Email: ' + limpiar(u.email)) : null,
        u?.telefono ? ('Tel: ' + limpiar(u.telefono)) : null
      ].filter(Boolean);
      const clienteBoxH = 38 + clienteLineas.length * 13;
      doc.rect(50, 200, W, clienteBoxH).fill('#f8f7f4');
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('CLIENTE', 64, 210);
      doc.fontSize(13).fillColor(NEGRO).font('Helvetica-Bold')
         .text(clienteNombre, 64, 222);
      let cy = 238;
      clienteLineas.forEach(linea=>{
        doc.fontSize(9).fillColor(GRIS).font('Helvetica').text(linea, 64, cy, {width:W-28});
        cy += 13;
      });

      // ── Tabla concepto ───────────────────────────────────────────────────
      const tY = 200 + clienteBoxH + 19;
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('DESCRIPCION',  50,  tY, {width:280})
         .text('BASE IMP.',   340,  tY, {width:70,  align:'right'})
         .text('IVA ('+ivaRate+'%)', 415, tY, {width:60, align:'right'})
         .text('TOTAL',       478,  tY, {width:67,  align:'right'});
      doc.moveTo(50, tY+14).lineTo(545, tY+14).lineWidth(0.5).strokeColor('#e0e0e0').stroke();

      const rY = tY + 22;
      doc.fontSize(11).fillColor(NEGRO).font('Helvetica')
         .text(concepto,      50,  rY, {width:280})
         .text(f(base),      340,  rY, {width:70,  align:'right'})
         .text(f(ivaAmt),    415,  rY, {width:60,  align:'right'})
         .text(f(p.importe), 478,  rY, {width:67,  align:'right'});

      // ── Total ────────────────────────────────────────────────────────────
      const totY = rY + 40;
      doc.moveTo(300, totY).lineTo(545, totY).lineWidth(2).strokeColor(ORO).stroke();
      doc.fontSize(10).fillColor(GRIS).font('Helvetica')
         .text('Total a pagar', 300, totY+8, {width:170});
      doc.fontSize(18).fillColor(ORO).font('Helvetica-Bold')
         .text(f(p.importe), 400, totY+5, {width:145, align:'right'});
      if (p.metodo) {
        doc.fontSize(9).fillColor(GRIS).font('Helvetica')
           .text('Metodo de pago: ' + limpiar(p.metodo), 50, totY+10);
      }

      // ── Pie ──────────────────────────────────────────────────────────────
      const pieY = 750;
      doc.moveTo(50, pieY).lineTo(545, pieY).lineWidth(0.5).strokeColor('#dddddd').dash(3,{space:3}).stroke();
      doc.undash();
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
         .text(pieTexto, 50, pieY+8, {width:W, align:'center'});
      if (neg.nif) {
        doc.fontSize(8).fillColor(GRIS).font('Helvetica')
           .text('NIF emisor: ' + limpiar(neg.nif), 50, pieY+22, {width:W, align:'center'});
      }

      doc.end();
    } catch(err) {
      reject(err);
    }
  });
}

/* ══════════════════════════════════════════════
   PDF RESUMEN / INFORME (lista de facturas)
══════════════════════════════════════════════ */
function generarPDFResumen(pagos, db, titulo) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const doc    = new PDFDoc({ size:'A4', margin:50, bufferPages:true });
      doc.on('data',  d   => chunks.push(d));
      doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const c       = db.config;
      const neg     = c.negocio || {};
      const ivaRate = c.iva ?? 21;
      const f = x  => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' EUR';
      const limpiar = s => (s||'').replace(/[^\x00-\x7FÀ-ÿ\u00C0-\u017E]/g,'').trim();
      const fechaHoy = new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});

      const ORO  = '#c9a84c';
      const GRIS = '#666666';
      const NEGRO= '#1a1a1a';
      const W    = 495;

      // ── Logo ──────────────────────────────────────────────────────────
      if (neg.logo && neg.logo.startsWith('data:image/')) {
        try {
          const buf = Buffer.from(neg.logo.slice(neg.logo.indexOf(',')+1), 'base64');
          doc.image(buf, 50, 50, { fit:[100,50] });
        } catch {}
      }

      // ── Cabecera ──────────────────────────────────────────────────────
      doc.fontSize(11).fillColor(NEGRO).font('Helvetica-Bold')
         .text(limpiar(neg.nombre||'Academia de Baile Malevo'), 270, 50, {width:275});
      doc.fontSize(9).fillColor(GRIS).font('Helvetica');
      let hy = 65;
      if (neg.nif)       { doc.text('NIF: '+limpiar(neg.nif),     270, hy, {width:275}); hy+=12; }
      if (neg.direccion) { doc.text(limpiar(neg.direccion),         270, hy, {width:275}); hy+=12; }
      if (neg.telefono)  { doc.text('Tel: '+limpiar(neg.telefono), 270, hy, {width:275}); }

      doc.moveTo(50,125).lineTo(545,125).lineWidth(2).strokeColor(ORO).stroke();

      doc.fontSize(16).fillColor(NEGRO).font('Helvetica-Bold')
         .text(limpiar(titulo), 50, 138, {width:W});
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
         .text('Generado el '+fechaHoy, 50, 160);

      // ── Cabecera tabla ────────────────────────────────────────────────
      let y = 185;
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('N. FACTURA', 50,  y, {width:80})
         .text('CLIENTE',   135,  y, {width:155})
         .text('MES',       295,  y, {width:70})
         .text('BASE',      368,  y, {width:60, align:'right'})
         .text('IVA',       430,  y, {width:50, align:'right'})
         .text('TOTAL',     482,  y, {width:63, align:'right'});
      y += 13;
      doc.moveTo(50,y).lineTo(545,y).lineWidth(0.5).strokeColor('#e0e0e0').stroke();
      y += 6;

      let totBase=0, totIva=0, totTotal=0;

      pagos.forEach(p => {
        const u      = (db.users||[]).find(x=>x.id===p.userId);
        const numT   = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : '---';
        const nombre = limpiar(p.simplificada ? (p.notas||'Anonimo') : (u?.nombre||'---'));
        const mesLbl = p.mes
          ? new Date(p.mes+'-01T00:00:00').toLocaleDateString('es-ES',{month:'short',year:'2-digit'})
          : '---';
        const base   = p.importe/(1+ivaRate/100);
        const iva    = p.importe - base;
        totBase  += base; totIva += iva; totTotal += p.importe;

        // nueva página si no hay espacio
        if (y > 760) { doc.addPage(); y = 60; }

        doc.fontSize(9).fillColor(NEGRO).font('Helvetica')
           .text(numT,        50,  y, {width:80})
           .text(nombre,     135,  y, {width:155, ellipsis:true})
           .text(mesLbl,     295,  y, {width:70})
           .text(f(base),    368,  y, {width:60,  align:'right'})
           .text(f(iva),     430,  y, {width:50,  align:'right'})
           .text(f(p.importe),482, y, {width:63,  align:'right'});
        y += 16;
        doc.moveTo(50,y-3).lineTo(545,y-3).lineWidth(0.3).strokeColor('#f0f0f0').stroke();
      });

      // ── Totales ───────────────────────────────────────────────────────
      if (y > 730) { doc.addPage(); y = 60; }
      y += 6;
      doc.moveTo(50,y).lineTo(545,y).lineWidth(2).strokeColor(ORO).stroke();
      y += 8;
      doc.fontSize(10).fillColor(NEGRO).font('Helvetica-Bold')
         .text('TOTAL  ('+pagos.length+' facturas)', 50, y, {width:310});
      doc.fontSize(11).fillColor(ORO).font('Helvetica-Bold')
         .text(f(totBase),   368, y, {width:60,  align:'right'})
         .text(f(totIva),    430, y, {width:50,  align:'right'})
         .text(f(totTotal),  482, y, {width:63,  align:'right'});

      // ── Pie ───────────────────────────────────────────────────────────
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('Documento generado por '+limpiar(neg.nombre||'Academia Malevo')+
               (neg.nif?' · NIF: '+limpiar(neg.nif):''),
               50, 790, {width:W, align:'center'});

      doc.end();
    } catch(err) { reject(err); }
  });
}

/* ══════════════════════════════════════════════
   SERVIDOR PRINCIPAL
══════════════════════════════════════════════ */
const server = http.createServer(async (req, res) => {
  const url    = req.url.split('?')[0];
  const method = req.method;

  // CORS básico para desarrollo local
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('X-Content-Type-Options','nosniff');

  // GET /c/:token — alias corto de curso-acceso.html?t=:token, para que el
  // link compartido por WhatsApp sea lo más corto posible. A diferencia de
  // un simple 302, esta ruta devuelve una páginita HTML propia (200) con
  // etiquetas Open Graph armadas con el nombre y la portada del curso real
  // (resueltos acá mismo a partir del token) — así, cuando WhatsApp genera
  // la tarjeta de vista previa del link, lee ESTAS etiquetas (el rastreador
  // de WhatsApp no ejecuta JavaScript, así que ve justo este HTML) y arma
  // una tarjeta con el curso en vez del dominio pelado. Para una persona
  // real, el <script> de esta misma página redirige de inmediato a
  // curso-acceso.html?t=..., que es donde sigue viviendo toda la lógica de
  // validación/canje — acá no se valida nada más que para elegir qué
  // mostrar en la tarjeta.
  {
    const mCorto = url.match(/^\/c\/([A-Za-z0-9_-]+)$/);
    if (mCorto && method === 'GET') {
      const tokenVal = mCorto[1];
      const destino = `/curso-acceso.html?t=${encodeURIComponent(tokenVal)}`;
      const db = readDB();
      const t = (db.tokensCursoExterno||[]).find(x=>x.token===tokenVal);
      const curso = (t && !t.invalidado && !t.usado) ? (db.cursos||[]).find(c=>c.id===t.cursoId) : null;

      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;

      const ogTitulo  = curso ? `Curso: ${curso.nombre} — Malevo Academia` : 'Malevo Academia · Tu acceso';
      const ogDesc    = curso ? `Tocá para desbloquear tu clase de ${curso.nombre}. Enlace de un solo uso.` : 'Enlace de acceso a tu curso — Malevo Academia.';
      const ogImagen  = (curso && curso.imagenPortada) ? curso.imagenPortada : `${base}/assets/malevo-logo-real.png`;

      // Los datos del curso vienen de nuestra propia base (los carga el
      // admin al crear el curso), no de un input externo — igual se
      // escapan por prolijidad antes de insertarlos en atributos HTML.
      const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>${esc(ogTitulo)}</title>
<meta property="og:title" content="${esc(ogTitulo)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImagen)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(base + '/c/' + tokenVal)}">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=${esc(destino)}">
<script>location.replace(${JSON.stringify(destino)});</script>
</head><body>Redirigiendo a tu curso…</body></html>`;

      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      return res.end(html);
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (url === '/api/login' && method === 'POST') {
    try {
      const { username, password } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      // FIX: antes se comparaba el username con timingSafeEq() de forma
      // exacta (mayúsculas/minúsculas incluidas), así que si el usuario
      // tecleaba "gimena" y en la base estaba guardado "Gimena" (o
      // viceversa), la búsqueda fallaba en silencio y devolvía
      // "credenciales incorrectas" aunque la contraseña fuera perfecta.
      // El username no es un secreto (no hace falta comparación de tiempo
      // constante para él, solo para el hash de la contraseña vía
      // checkPassword), así que ahora se normaliza a minúsculas y se
      // recorta espacios antes de comparar.
      const usernameNormalizado = (username||'').trim().toLowerCase();
      const user = db.users.find(u => (u.username||'').trim().toLowerCase() === usernameNormalizado);
      if (!user) {
        console.warn(`[login] usuario no encontrado: "${username}"`);
        return json(res,401,{ok:false,error:'Credenciales incorrectas'});
      }
      if (!user.active) {
        console.warn(`[login] usuario "${user.username}" existe pero está inactivo (active:false)`);
        return json(res,401,{ok:false,error:'Credenciales incorrectas'});
      }
      if (!checkPassword(password||'', user.passwordHash)) {
        console.warn(`[login] contraseña incorrecta para "${user.username}"`);
        return json(res,401,{ok:false,error:'Credenciales incorrectas'});
      }
      const token = signJWT({
        sub: user.id, role: user.role, nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,200,{ok:true,token,role:user.role,nombre:user.nombre},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false}); }
  }

  // ── Login passwordless del alumno (Email/Teléfono + código temporal) ──
  if (url === '/api/auth/passwordless/request' && method === 'POST') {
    try {
      const { contacto } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const user = buscarUsuarioPorContacto(db, contacto);
      if (!user || !user.active) {
        return json(res,404,{ok:false,error:'No encontramos una cuenta activa con ese email o teléfono.'});
      }
      const code = generarCodigoAcceso();
      _codigosAcceso.set(user.id, { code, exp: Date.now() + CODIGO_TTL_MS });
      await enviarCodigoAcceso(user, code);
      // Sin un proveedor real de email/SMS conectado todavía (ver
      // enviarCodigoAcceso más arriba), el código se devuelve aquí mismo
      // para que el frontend lo muestre en pantalla ("magic code" simulado)
      // y el alumno pueda entrar sin fricción desde cualquier dispositivo.
      return json(res,200,{ok:true, nombre:user.nombre, code});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  if (url === '/api/auth/passwordless/verify' && method === 'POST') {
    try {
      const { contacto, code } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const user = buscarUsuarioPorContacto(db, contacto);
      if (!user || !user.active) return json(res,404,{ok:false,error:'Cuenta no encontrada.'});
      const pendiente = _codigosAcceso.get(user.id);
      if (!pendiente || pendiente.exp < Date.now() || pendiente.code !== String(code||'').trim()) {
        return json(res,401,{ok:false,error:'Código incorrecto o caducado. Solicita uno nuevo.'});
      }
      _codigosAcceso.delete(user.id);
      const token = signJWT({
        sub: user.id, role: user.role, nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,200,{ok:true, sub:user.id, role:user.role, nombre:user.nombre},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ⚠️  BYPASS DE LOGIN PARA PRUEBAS LOCALES — SOLO ACTIVO EN LOCALHOST
  //     Se activa automáticamente cuando la petición viene de la propia
  //     máquina (127.0.0.1/::1), sin necesidad de ninguna variable de
  //     entorno (ver función esConexionLocal más arriba).
  //     Si este server.js se despliega en un servidor accesible por
  //     internet u otras personas, este bypass queda inactivo solo porque
  //     nadie externo puede conectarse como "localhost". Aun así, es buena
  //     práctica borrar este bloque antes de un despliegue real.
  // ══════════════════════════════════════════════════════════════════════
  if (url === '/api/dev-auto-login' && method === 'POST') {
    if (!esConexionLocal(req)) return json(res,404,{ok:false,error:'No disponible'});
    try {
      const { as } = JSON.parse(await body(req)||'{}'); // 'admin' | 'student'
      const db = readDB();
      const portalPlans = db.config.portalPlans || ['35','50','80'];
      let user;
      if (as === 'student') {
        user = db.users.find(u => u.role==='student' && u.active && (u.portalAccess || portalPlans.includes(u.plan)))
            || db.users.find(u => u.role==='student' && u.active);
      } else {
        user = db.users.find(u => u.role==='admin' && u.active) || db.users.find(u => u.role==='admin');
      }
      if (!user) return json(res,404,{ok:false,error:'No hay ningún usuario de ese tipo en la base de datos local'});
      const token = signJWT({
        sub: user.id, role: user.role, nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      const hasPortalAccess = ['admin','teacher'].includes(user.role) ||
        (portalPlans.includes(user.plan) || user.portalAccess===true);
      return json(res,200,{ok:true,role:user.role,nombre:user.nombre,sub:user.id,hasPortalAccess},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false}); }
  }

  if (url === '/api/logout' && method === 'POST') {
    return json(res,200,{ok:true},{'Set-Cookie':`malevo_jwt=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${cookieSecureFlag(req)}`});
  }

  if (url === '/api/me') {
    const u = getUser(req);
    if (!u) return json(res,401,{ok:false});
    // Incluir flag de acceso al portal según el plan del usuario
    const db_ = readDB();
    const userRec = db_.users.find(x=>x.id===u.sub);
    const portalPlans = db_.config.portalPlans || ['35','50','80'];
    const hasPortalAccess = ['admin','teacher'].includes(u.role) ||
      (userRec && (portalPlans.includes(userRec.plan) || userRec.portalAccess===true));
    return json(res,200,{ok:true,role:u.role,nombre:u.nombre,sub:u.sub,hasPortalAccess});
  }

  // ── Restablecer contraseña de un admin/profesor (solo un admin ya
  //    autenticado puede hacerlo) ─────────────────────────────────────────
  // Pensado para casos como "Gimena no puede entrar y no hay forma de
  // recuperar la contraseña por email/SMS": Gaston (o cualquier otro admin
  // que sí pueda entrar) entra al panel y le pone una contraseña nueva a
  // Gimena desde la propia interfaz, sin tocar la base de datos a mano.
  if (url === '/api/admin/reset-password' && method === 'POST') {
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const { username, newPassword } = JSON.parse(await body(req)||'{}');
      if (!username || !newPassword || String(newPassword).length < 6) {
        return json(res,400,{ok:false,error:'Falta el usuario o la contraseña debe tener al menos 6 caracteres'});
      }
      const db = readDB();
      const buscado = String(username).trim().toLowerCase();
      const user = db.users.find(u => (u.username||'').trim().toLowerCase() === buscado);
      if (!user) return json(res,404,{ok:false,error:'No existe ningún usuario con ese nombre de usuario'});
      if (!['admin','teacher'].includes(user.role)) {
        return json(res,400,{ok:false,error:'Esta herramienta solo restablece contraseñas de administradores o profesores'});
      }
      user.passwordHash = hashPassword(newPassword);
      db._rev++;
      writeDB(db);
      console.log(`[admin] ${req._user.nombre} restableció la contraseña de "${user.username}"`);
      return json(res,200,{ok:true});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Setup inicial (solo si no hay usuarios) ────────────────────────────────
  if (url === '/api/setup' && method === 'POST') {
    const db = readDB();
    if (db.users.length > 0) return json(res,403,{ok:false,error:'Ya configurado'});
    try {
      const { username, password, nombre } = JSON.parse(await body(req)||'{}');
      if (!username||!password) return json(res,400,{ok:false,error:'Faltan datos'});
      db.users.push({
        id: uuid(), username, passwordHash: hashPassword(password),
        role:'admin', nombre: nombre||username, email:'', active:true
      });
      db._rev++;
      writeDB(db);
      return json(res,200,{ok:true});
    } catch(e) { return json(res,400,{ok:false}); }
  }

  // ── DB completa (solo admin) ───────────────────────────────────────────────
  if (url === '/api/db') {
    if (!requireRole(['admin'])(req,res)) return;
    if (method === 'GET') return json(res,200,readDB());
    if (method === 'PUT' || method === 'POST') {
      try {
        const nuevo = JSON.parse(await body(req));
        const actual = readDB();
        nuevo._rev = (actual._rev||0)+1;
        writeDB(nuevo);
        return json(res,200,{ok:true,_rev:nuevo._rev});
      } catch { return json(res,400,{ok:false,error:'JSON inválido'}); }
    }
    res.writeHead(405); return res.end('Method Not Allowed');
  }

  // ── Config (admin) ─────────────────────────────────────────────────────────
  if (url === '/api/config') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    if (method === 'GET') return json(res,200,db.config);
    if (method === 'PUT') {
      try {
        db.config = JSON.parse(await body(req));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
  }

  // ── Usuarios (admin) ───────────────────────────────────────────────────────
  if (url === '/api/users' && method === 'GET') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const safe = db.users.map(({passwordHash,...u})=>u);
    return json(res,200,safe);
  }
  if (url === '/api/users' && method === 'POST') {
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const db = readDB();
      const { username, password, role, nombre, email, telefono,
              guestCourtesy, cashOnly, portalAccess, facturaEnvio, plan } = JSON.parse(await body(req)||'{}');
      if (!nombre) return json(res,400,{ok:false,error:'El nombre es obligatorio'});
      // Generar username automático si no se aporta
      const usernameVal = (username||'').trim() ||
        'alumno_' + (nombre||'').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .replace(/[^a-z0-9]/g,'_').slice(0,20) +
        '_' + Date.now().toString(36).slice(-4);
      if (db.users.find(u=>u.username===usernameVal))
        return json(res,409,{ok:false,error:'Nombre de usuario ya existe, prueba otro'});
      // Contraseña aleatoria si no se aporta (el alumno entrará vía enlace/Google)
      const passVal = (password||'').trim() || crypto.randomBytes(16).toString('hex');
      const user = {
        id:uuid(), username:usernameVal, passwordHash:hashPassword(passVal),
        role:role||'student', nombre:nombre||usernameVal,
        email:email||'', telefono:telefono||'',
        active:true,
        plan: plan||'35',
        guestCourtesy: !!guestCourtesy,
        cashOnly: !!cashOnly,
        portalAccess: !!portalAccess,
        facturaEnvio: facturaEnvio||'none',
        referralCode: uuid().slice(0,8),
        profileComplete: false
      };
      db.users.push(user);
      db._rev++; writeDB(db);
      const {passwordHash,...safe} = user;
      return json(res,201,{ok:true,user:safe});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  const userIdMatch = url.match(/^\/api\/users\/([a-z0-9-]+)$/);
  if (userIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const uid_ = userIdMatch[1];
    const idx  = db.users.findIndex(u=>u.id===uid_);
    if (idx===-1) return json(res,404,{ok:false,error:'No encontrado'});
    if (method==='PUT') {
      try {
        const upd = JSON.parse(await body(req)||'{}');
        if (upd.password) { db.users[idx].passwordHash = hashPassword(upd.password); delete upd.password; }
        // Campos permitidos para actualización
        const allowed = ['nombre','username','email','telefono','role','plan','active',
          'cashOnly','guestCourtesy','portalAccess','facturaEnvio',
          'nivelBachata','nivelSalsa','rol','assignedClasses','bio','profileComplete','fotoPerfil',
          'cursosAsignados','cursosVencimientos'];
        allowed.forEach(k=>{ if(upd[k]!==undefined) db.users[idx][k]=upd[k]; });
        db._rev++; writeDB(db);
        const {passwordHash,...safe}=db.users[idx];
        return json(res,200,{ok:true,user:safe});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      // Borrado permanente y en cascada: además del propio usuario, limpia
      // cualquier inscripción/asistencia/pago que quedara referenciando su
      // id, para que una cuenta de prueba no deje rastro huérfano en el
      // resto de la base de datos (a diferencia de "archivar", que es
      // reversible y conserva todo esto a propósito).
      db.users.splice(idx,1);
      if (Array.isArray(db.enrollments))  db.enrollments  = db.enrollments.filter(e=>e.userId!==uid_);
      if (Array.isArray(db.attendances))  db.attendances  = db.attendances.filter(a=>a.userId!==uid_);
      if (Array.isArray(db.payments))     db.payments     = db.payments.filter(p=>p.userId!==uid_);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ── Clases (admin/teacher GET, admin POST/PUT/DELETE) ──────────────────────
  if (url === '/api/classes') {
    if (!authAny(req,res)) return;
    const db = readDB();
    if (method==='GET') return json(res,200,db.classes);
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const data = JSON.parse(await body(req)||'{}');
      const c = Object.assign({id:uuid()},data);
      db.classes.push(c);
      db._rev++; writeDB(db);
      return json(res,201,{ok:true,class:c});
    } catch { return json(res,400,{ok:false}); }
  }
  const classIdMatch = url.match(/^\/api\/classes\/([a-z0-9-]+)$/);
  if (classIdMatch) {
    if (!authAny(req,res)) return;
    const db = readDB();
    const cid = classIdMatch[1];
    const idx = db.classes.findIndex(c=>c.id===cid);
    if (idx===-1) return json(res,404,{ok:false,error:'No encontrado'});
    if (method==='GET') return json(res,200,db.classes[idx]);
    if (!requireRole(['admin'])(req,res)) return;
    if (method==='PUT') {
      try {
        Object.assign(db.classes[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true,class:db.classes[idx]});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.classes.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ── Inscripciones (enrollments) ────────────────────────────────────────────
  if (url === '/api/enrollments') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      // Admin/teacher ven todo; alumno/invitado ven solo las suyas
      const list = ['admin','teacher'].includes(u.role)
        ? db.enrollments
        : db.enrollments.filter(e=>e.userId===u.sub);
      return json(res,200,list);
    }
    if (!requireRole(['admin'])(req,res)) return;
    if (method==='POST') {
      try {
        const { userId, disciplina, niveles } = JSON.parse(await body(req)||'{}');
        if (!userId||!disciplina||!Array.isArray(niveles)) return json(res,400,{ok:false,error:'Faltan campos'});
        // Selección libre: desbloquea EXACTAMENTE los niveles indicados y
        // revoca los que ya no estén en la lista.
        unlockLevels(db, userId, disciplina, niveles.map(Number));
        db._rev++; writeDB(db);
        return json(res,201,{ok:true});
      } catch(e) { return json(res,400,{ok:false,error:e.message}); }
    }
  }

  // ── Videos ────────────────────────────────────────────────────────────────
  if (url === '/api/videos') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      if (['admin'].includes(u.role)) return json(res,200,db.videos);
      const userRec = db.users.find(x=>x.id===u.sub);
      if (!userRec) return json(res,403,{ok:false,error:'Usuario no encontrado'});
      // Contenido general del portal (calentamientos y eventos/talleres): no
      // está ligado a ninguna clase/nivel ni al plan del alumno — tiene que
      // verse para CUALQUIER alumno registrado, tenga o no acceso al Aula
      // Virtual (a diferencia de las clases grabadas, que sí son solo para
      // quien pagó el plan VIP/portal). Por eso se calcula ANTES del check
      // de plan de abajo, y nunca depende de él.
      const TIPOS_GENERALES = ['evento','calentamiento'];
      const generales = db.videos.filter(v => TIPOS_GENERALES.includes(v.tipo));
      // Verificar que el plan del usuario tiene acceso al Aula Virtual para
      // el resto del contenido (clases grabadas). Si no lo tiene, sigue
      // viendo lo general de arriba — antes esto devolvía 403 y lo dejaba
      // sin ver ni siquiera los eventos.
      const portalPlans = db.config.portalPlans || ['35','50','80'];
      if (!portalPlans.includes(userRec.plan) && !userRec.portalAccess) {
        return json(res,200,generales);
      }
      // Alumnos/invitados con acceso: además de lo general, solo videos de
      // sus inscripciones activas. Las playlists de Google Drive
      // (tipo:'playlist', origen:'drive') sí están ligadas a una
      // disciplina/nivel real, así que pasan por el filtro normal de
      // inscripción, igual que las clases.
      const enrolled = db.enrollments.filter(e=>e.userId===u.sub && e.status==='active');
      const visible  = db.videos.filter(v=>{
        if (TIPOS_GENERALES.includes(v.tipo)) return true;
        return enrolled.some(e=>{
          const cls = db.classes.find(c=>c.id===e.classId);
          return cls && cls.estilo===v.disciplina && v.nivel===cls.nivelNum;
        });
      });
      return json(res,200,visible);
    }
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const data = JSON.parse(await body(req)||'{}');
      const vid  = Object.assign({id:uuid()},data);
      db.videos.push(vid);
      db._rev++; writeDB(db);
      return json(res,201,{ok:true,video:vid});
    } catch { return json(res,400,{ok:false}); }
  }
  const videoIdMatch = url.match(/^\/api\/videos\/([a-z0-9-]+)$/);
  if (videoIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const vid= videoIdMatch[1];
    const idx= db.videos.findIndex(v=>v.id===vid);
    if (idx===-1) return json(res,404,{ok:false});
    if (method==='PUT') {
      try {
        Object.assign(db.videos[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.videos.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cursos Exclusivos — módulo aparte de "videos"/Aula Virtual: son cursos
  // completos (con su propia lista de vídeos) organizados por ritmo/
  // subcategoría, y el acceso NO depende del plan del alumno sino de si el
  // admin se lo asignó específicamente (user.cursosAsignados). Un alumno
  // sin ningún curso asignado igual ve el catálogo completo (para saber
  // qué existe y pedirlo/comprarlo), pero los cursos no asignados llegan
  // "recortados" — sin imagenPortada/duracion/videos — para no filtrar
  // contenido real de un curso al que no tiene acceso.
  // ══════════════════════════════════════════════════════════════════════
  if (url === '/api/cursos') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      if (['admin','teacher'].includes(u.role)) return json(res,200,db.cursos||[]);
      const userRec = db.users.find(x=>x.id===u.sub);
      const asignados = new Set((userRec && userRec.cursosAsignados) || []);
      const vencimientos = (userRec && userRec.cursosVencimientos) || {};
      // Un curso asignado sin fecha de vencimiento registrada (asignaciones
      // antiguas, previas a la vigencia de 1 año) se sigue considerando
      // vigente; si tiene vencimiento y ya pasó, se trata como sin acceso.
      const vencido = cid => !!vencimientos[cid] && new Date(vencimientos[cid]) < new Date();
      const catalogo = (db.cursos||[]).filter(c=>c.activo!==false).map(c=>{
        const tieneAcceso = asignados.has(c.id) && !vencido(c.id);
        if (tieneAcceso) return Object.assign({}, c, {tieneAcceso:true});
        // Recortado: la portada/nivel/duración SÍ se muestran a todos —
        // son solo metadatos del catálogo, no contenido del curso. Lo único
        // que de verdad hay que ocultar a quien no tiene acceso es la lista
        // de vídeos (eso es lo que el admin asigna alumno por alumno).
        return {id:c.id, nombre:c.nombre, ritmo:c.ritmo, subcategoria:c.subcategoria,
          orden:c.orden, imagenPortada:c.imagenPortada, nivel:c.nivel, duracion:c.duracion,
          tieneAcceso:false};
      });
      return json(res,200,catalogo);
    }
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const data = JSON.parse(await body(req)||'{}');
      const curso = Object.assign({activo:true, videos:[]}, data, {id:uuid()});
      db.cursos.push(curso);
      db._rev++; writeDB(db);
      return json(res,201,{ok:true,curso});
    } catch { return json(res,400,{ok:false}); }
  }
  const cursoIdMatch = url.match(/^\/api\/cursos\/([a-z0-9-]+)$/);
  if (cursoIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db  = readDB();
    const cid = cursoIdMatch[1];
    const idx = db.cursos.findIndex(c=>c.id===cid);
    if (idx===-1) return json(res,404,{ok:false});
    if (method==='PUT') {
      try {
        Object.assign(db.cursos[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.cursos.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // CURSOS EXCLUSIVOS — acceso externo MANUAL (pago en persona/efectivo,
  // sin pasarela online). El admin genera un enlace de UN SOLO USO desde
  // "👥 Alumnos" en el curso (sin pedir ningún dato todavía) y se lo pasa
  // él mismo al comprador (WhatsApp, en mano, etc.). Recién cuando esa
  // persona abre el enlace y completa su nombre+teléfono, el token se
  // "quema" para siempre y el acceso queda registrado sobre una cuenta
  // real de alumno (cursosAsignados + cursosVencimientos), igual que el
  // acceso de un alumno interno — así ambos caminos comparten la misma
  // lógica de vigencia/gating en GET /api/cursos.
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/cursos/:id/accesos-externos — genera un token PENDIENTE (sin
  // datos del comprador todavía: esos se piden recién al canjear el link).
  // Solo puede haber UN token pendiente vivo por curso a la vez: generar
  // uno nuevo invalida automáticamente cualquier enlace anterior sin usar,
  // para no acumular enlaces viejos en el panel de "Alumnos".
  let m = url.match(/^\/api\/cursos\/([a-z0-9-]+)\/accesos-externos$/);
  if (m && method === 'POST') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const curso = (db.cursos||[]).find(c=>c.id===m[1]);
    if (!curso) return json(res,404,{ok:false,error:'Curso no encontrado'});
    db.tokensCursoExterno = db.tokensCursoExterno || [];
    db.tokensCursoExterno
      .filter(t=>t.cursoId===curso.id && !t.usado && !t.invalidado)
      .forEach(t=>{ t.invalidado = true; });
    const tokenRec = {
      id: uuid(),
      cursoId: curso.id,
      // Código corto (8 bytes al azar en base64url ≈ 11 caracteres) en vez
      // del hex de 48 caracteres de antes: el link es de un solo uso, lo
      // reparte el propio admin (WhatsApp/en mano) y se invalida al primer
      // canje, así que no hace falta la entropía de una clave criptográfica
      // de verdad — pero sí conviene que el link entero sea corto, porque
      // WhatsApp (sobre todo en el celular) puede no reconocer como enlace
      // clicable una URL demasiado larga con un token gigante. Alfanumérico
      // puro (ver generarTokenAlfanumerico) para que WhatsApp nunca corte
      // el link en un salto de línea por culpa de un "-" o "_".
      token: generarTokenAlfanumerico(12),
      usado: false,
      invalidado: false,
      fechaGenerado: new Date().toISOString(),
      fechaUsado: null,
      userId: null
    };
    db.tokensCursoExterno.push(tokenRec);
    db._rev++; writeDB(db);

    const host  = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
    // El link solo lleva el token — ni el id del curso ni su nombre viajan
    // en la URL (eso es lo que la hacía larga). curso-acceso.html resuelve
    // todo lo demás (a qué curso corresponde, si sigue vigente, el nombre
    // para mostrar en pantalla) consultando GET /api/publico/token/:token
    // apenas carga la página — ver ese endpoint más abajo.
    // Se usa el alias corto "/c/:token" (redirige 302 a curso-acceso.html
    // más arriba) en vez de "/curso-acceso.html?t=..." para que el link
    // completo ocupe lo mínimo posible al compartirlo por WhatsApp.
    const link  = `${base}/c/${tokenRec.token}`;

    console.log(`[cursos] admin ${req._user.nombre} generó un token de acceso de un solo uso para "${curso.nombre}"`);
    return json(res,201,{ok:true, token:tokenRec, link});
  }

  // GET /api/accesos-cursos?cursoId=X — listar compradores externos (admin):
  // tokens ya canjeados (con la cuenta de alumno que crearon/usaron) y
  // tokens todavía pendientes (para poder reenviar el mismo link o
  // cancelarlo). Los tokens cancelados sin canjear no se listan.
  if (url.startsWith('/api/accesos-cursos') && method === 'GET' && !url.match(/^\/api\/accesos-cursos\/[a-z0-9-]+/)) {
    if (!requireRole(['admin'])(req,res)) return;
    const params = new URL('http://x' + req.url).searchParams;
    const cursoId = params.get('cursoId') || '';
    const db = readDB();
    const host  = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
    const tokens = (db.tokensCursoExterno||[])
      .filter(t=>(!cursoId || t.cursoId===cursoId) && !(t.invalidado && !t.usado));
    const lista = tokens.map(t=>{
      if (t.usado && t.userId) {
        const comprador = (db.users||[]).find(x=>x.id===t.userId);
        const expira = comprador && comprador.cursosVencimientos ? comprador.cursosVencimientos[t.cursoId] : null;
        const activo = !!(comprador && (comprador.cursosAsignados||[]).includes(t.cursoId));
        return {
          id: t.id, cursoId: t.cursoId, estado: activo ? 'activo' : 'revocado',
          nombre: comprador ? comprador.nombre : '(cuenta eliminada)',
          telefono: comprador ? comprador.telefono : '',
          // userId viaja acá para que el admin pueda borrar DEFINITIVAMENTE la
          // cuenta de este comprador desde el propio panel (ver caEliminarComprador
          // en app.js) — antes solo se podía revocar el acceso, no borrar la cuenta.
          userId: t.userId,
          fecha: t.fechaUsado, expira, activo
        };
      }
      return {
        id: t.id, cursoId: t.cursoId, estado: 'pendiente',
        nombre: null, telefono: null, fecha: t.fechaGenerado, expira: null, activo: null,
        link: `${base}/c/${t.token}`
      };
    }).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
    return json(res,200,lista);
  }

  // PUT /api/accesos-cursos/:id — según el estado del token:
  //  · pendiente (nadie lo canjeó): {invalidar:true} lo cancela para que
  //    ese link deje de funcionar (el admin genera uno nuevo si hace falta).
  //  · ya canjeado: {activo:false} revoca el acceso al curso de esa cuenta
  //    (sin borrar la cuenta ni el historial); {activo:true} se lo devuelve
  //    con una vigencia nueva de 1 año desde ese momento.
  m = url.match(/^\/api\/accesos-cursos\/([a-z0-9-]+)$/);
  if (m && method === 'PUT') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const t = (db.tokensCursoExterno||[]).find(x=>x.id===m[1]);
    if (!t) return json(res,404,{ok:false,error:'No encontrado'});
    try {
      const { activo, invalidar } = JSON.parse(await body(req)||'{}');
      if (!t.usado) {
        if (invalidar) { t.invalidado = true; db._rev++; writeDB(db); }
        return json(res,200,{ok:true});
      }
      const comprador = (db.users||[]).find(x=>x.id===t.userId);
      if (!comprador) return json(res,404,{ok:false,error:'La cuenta de este comprador ya no existe'});
      comprador.cursosAsignados = comprador.cursosAsignados || [];
      comprador.cursosVencimientos = comprador.cursosVencimientos || {};
      if (activo === false) {
        comprador.cursosAsignados = comprador.cursosAsignados.filter(cid=>cid!==t.cursoId);
        delete comprador.cursosVencimientos[t.cursoId];
      } else {
        if (!comprador.cursosAsignados.includes(t.cursoId)) comprador.cursosAsignados.push(t.cursoId);
        const nuevoVencimiento = new Date();
        nuevoVencimiento.setFullYear(nuevoVencimiento.getFullYear()+1);
        comprador.cursosVencimientos[t.cursoId] = nuevoVencimiento.toISOString();
      }
      db._rev++; writeDB(db);
      console.log(`[cursos] admin ${req._user.nombre} ${activo===false?'revocó':'reactivó'} el acceso externo de "${comprador.nombre}"`);
      return json(res,200,{ok:true});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // GET /api/publico/token/:token — PÚBLICO (sin login): curso-acceso.html
  // consulta esto apenas carga (antes de pedirle nada al visitante) para
  // saber a qué curso corresponde el link y si sigue vigente — así se
  // puede mostrar "Tu acceso a Bachata Dominicana" (o el error de
  // "ya usado"/"no válido") sin que el link tenga que llevar esos datos
  // en la URL. No expone nada del comprador ni de otros tokens.
  m = url.match(/^\/api\/publico\/token\/([A-Za-z0-9_-]+)$/);
  if (m && method === 'GET') {
    const db = readDB();
    const t = (db.tokensCursoExterno||[]).find(x=>x.token===m[1]);
    if (!t || t.invalidado) return json(res,404,{ok:false,error:'Este enlace no es válido. Consultá con la academia.'});
    if (t.usado)            return json(res,404,{ok:false,error:'Este enlace ya fue usado. Cada enlace sirve una sola vez — pedile a la academia uno nuevo.'});
    const curso = (db.cursos||[]).find(c=>c.id===t.cursoId);
    if (!curso) return json(res,404,{ok:false,error:'El curso de este enlace ya no existe. Consultá con la academia.'});
    return json(res,200,{ok:true, cursoNombre:curso.nombre});
  }

  // POST /api/publico/token/:token/canjear — el comprador externo abre
  // curso-acceso.html con su link y esto valida que el token no esté
  // usado/invalidado, resuelve QUIÉN es el comprador (dos caminos, ver
  // abajo), le da acceso a ESE curso con vigencia de 1 año, quema el token
  // para siempre y lo deja logueado para que el frontend lo redirija
  // directo al panel de cursos exclusivos. El curso al que corresponde se
  // deduce del propio token — no depende de nada más que venga en la URL.
  //
  // Dos caminos para resolver "quién es el comprador":
  //  A) YA TIENE SESIÓN (cookie malevo_jwt válida — p.ej. volvió a tocar un
  //     link nuevo desde la PWA que ya tiene instalada de un curso
  //     anterior): no hace falta pedirle nombre/teléfono de nuevo, se le
  //     agrega el curso directamente a SU cuenta ya existente.
  //  B) NO TIENE SESIÓN (primera vez, o cambió de dispositivo): sigue
  //     pidiendo nombre+teléfono en el body, como antes — crea la cuenta si
  //     es la primera vez, o la reutiliza si el teléfono ya coincide con un
  //     alumno existente (mismo matching que el login passwordless).
  m = url.match(/^\/api\/publico\/token\/([A-Za-z0-9_-]+)\/canjear$/);
  if (m && method === 'POST') {
    const db = readDB();
    const t = (db.tokensCursoExterno||[]).find(x=>x.token===m[1]);
    if (!t || t.invalidado) return json(res,403,{ok:false,error:'Este enlace no es válido. Consultá con la academia.'});
    if (t.usado)            return json(res,403,{ok:false,error:'Este enlace ya fue usado. Cada enlace sirve una sola vez — pedile a la academia uno nuevo.'});
    const curso = (db.cursos||[]).find(c=>c.id===t.cursoId);
    if (!curso) return json(res,404,{ok:false,error:'El curso de este enlace ya no existe. Consultá con la academia.'});
    try {
      const sesion = getUser(req); // null si no hay cookie válida
      let comprador = sesion ? db.users.find(u=>u.id===sesion.sub) : null;

      if (!comprador) {
        // Camino B: sin sesión (o con una cookie que ya no corresponde a
        // ningún usuario) — sigue el flujo clásico de nombre+teléfono.
        const { nombre, telefono } = JSON.parse(await body(req)||'{}');
        if (!(nombre||'').trim())    return json(res,400,{ok:false,error:'Falta tu nombre'});
        if (!(telefono||'').trim())  return json(res,400,{ok:false,error:'Falta tu teléfono'});

        comprador = buscarUsuarioPorContacto(db, telefono.trim());
        // "soloCursosExternos" marca cuentas creadas ACÁ (comprador externo
        // que nunca fue alumno de la academia) para que portal.js les
        // oculte Inicio/Perfil/Referidos y los deje solo en Cursos — no se
        // toca si el comprador ya existía (buscarUsuarioPorContacto lo
        // encontró), ya que en ese caso es un alumno real con su
        // navegación completa.
        if (!comprador) {
          comprador = {
            id: uuid(), username: null, passwordHash: null, role: 'student',
            nombre: nombre.trim(), email: '', telefono: telefono.trim(),
            active: true, plan: null, cashOnly: true, portalAccess: true,
            cursosAsignados: [], cursosVencimientos: {}, profileComplete: false,
            soloCursosExternos: true
          };
          db.users.push(comprador);
        }
      }
      // Camino A (ya logueado) llega directo hasta acá con el "comprador"
      // resuelto desde la sesión — mismo tramo final para ambos caminos.

      comprador.cursosAsignados = comprador.cursosAsignados || [];
      comprador.cursosVencimientos = comprador.cursosVencimientos || {};
      if (!comprador.cursosAsignados.includes(curso.id)) comprador.cursosAsignados.push(curso.id);
      const expira = new Date();
      expira.setFullYear(expira.getFullYear()+1);
      comprador.cursosVencimientos[curso.id] = expira.toISOString();

      t.usado = true; t.fechaUsado = new Date().toISOString(); t.userId = comprador.id;
      db._rev++; writeDB(db);

      // Sesión larga (1 año, igual que la vigencia del curso) para cuentas
      // "solo cursos" — un alumno real de la academia conserva el TTL
      // normal de 30 días, igual que cualquier otro login.
      const ttl = comprador.soloCursosExternos ? TOKEN_TTL_CURSO_EXTERNO : TOKEN_TTL;
      const jwt = signJWT({
        sub: comprador.id, role: comprador.role, nombre: comprador.nombre,
        exp: Math.floor(Date.now()/1000) + ttl
      });
      const cookie = `malevo_jwt=${jwt}; HttpOnly; Path=/; Max-Age=${ttl}; SameSite=Lax${cookieSecureFlag(req)}`;
      console.log(`[cursos] "${comprador.nombre}" canjeó su token de acceso a "${curso.nombre}" (vigencia hasta ${comprador.cursosVencimientos[curso.id]}${sesion?', ya logueado':''})`);
      // cursoId viaja en la respuesta para que curso-acceso.html pueda
      // redirigir al portal directo al detalle de ESTE curso (en vez de
      // dejar al comprador en la lista de Cursos Exclusivos teniendo que
      // encontrarlo él mismo) — ver arrancarPortal()/cxAbrirCurso() en portal.js.
      return json(res,200,{ok:true, nombre:comprador.nombre, cursoId:curso.id, cursoNombre:curso.nombre},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Asistencia ────────────────────────────────────────────────────────────
  if (url === '/api/attendances') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      const list = ['admin','teacher'].includes(u.role)
        ? db.attendances
        : db.attendances.filter(a=>a.userId===u.sub);
      return json(res,200,list);
    }
    // Teachers y admins pueden marcar asistencia
    if (!requireRole(['admin','teacher'])(req,res)) return;
    if (method==='POST') {
      try {
        const { classId, userId, fecha, present } = JSON.parse(await body(req)||'{}');
        let rec = db.attendances.find(a=>a.classId===classId&&a.userId===userId&&a.fecha===fecha);
        if (rec) { rec.present = present; }
        else db.attendances.push({id:uuid(),classId,userId,fecha,present});
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
  }

  // ── Pagos (solo admin) ────────────────────────────────────────────────────
  if (url === '/api/payments') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    if (method==='GET') return json(res,200,db.payments);
    if (method==='POST') {
      try {
        const data = JSON.parse(await body(req)||'{}');
        db.contadorTicket++;
        const p = Object.assign({id:uuid(),numeroTicket:db.contadorTicket},data);
        db.payments.push(p);
        db._rev++; writeDB(db);
        return json(res,201,{ok:true,payment:p});
      } catch { return json(res,400,{ok:false}); }
    }
  }
  const payIdMatch = url.match(/^\/api\/payments\/([a-z0-9-]+)$/);
  if (payIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const pid= payIdMatch[1];
    const idx= db.payments.findIndex(p=>p.id===pid);
    if (idx===-1) return json(res,404,{ok:false});
    if (method==='PUT') {
      try {
        Object.assign(db.payments[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.payments.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ── Morosidad: invitados de cortesía no disparan alertas ─────────────────
  if (url === '/api/deuda' && method === 'GET') {
    if (!requireRole(['admin'])(req,res)) return;
    const db  = readDB();
    const mes = new URL('http://x'+req.url).searchParams.get('mes') || new Date().toISOString().slice(0,7);
    const pagados = new Set(db.payments.filter(p=>p.mes===mes).map(p=>p.userId));
    const deudores = db.users.filter(u=>
      u.active && u.role==='student' &&
      !u.guestCourtesy &&          // invitados de cortesía: excluidos
      !pagados.has(u.id)
    ).map(({passwordHash,...u})=>u);
    return json(res,200,deudores);
  }

  // ── Perfil del alumno (self) ─────────────────────────────────────────────
  if (url === '/api/profile') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    const me = db.users.find(x=>x.id===u.sub);
    if (!me) return json(res,404,{ok:false});
    if (method === 'GET') {
      const {passwordHash,...safe}=me;
      return json(res,200,safe);
    }
    if (method === 'PUT') {
      try {
        const upd = JSON.parse(await body(req)||'{}');
        // El alumno solo puede modificar campos seguros de su perfil.
        // nivelBachata/nivelSalsa son los niveles OFICIALES que gestiona el
        // admin (controlan el acceso real a los vídeos) — el alumno solo
        // puede indicar su nivel preferido/autopercibido, que es informativo.
        const allowed=['nombre','email','telefono','rol','nivelBachataPreferido','nivelSalsaPreferido','bio','fotoPerfil',
          'streakWeeks','streakLastWeek','eventRsvps',
          // Tarjeta "Racha": A) racha de desbloqueo semanal (5 días distintos viendo vídeo,
          // se reinicia cada domingo) y B) fueguito (contador histórico de días de uso, global
          // e independiente, nunca se reinicia).
          'rachaDiasSemana','rachaSemanaInicio','fuegoDiasTotal','fuegoUltimoDia',
          'rachaBonusDesbloqueados','rachaSemanaPremiada'];
        allowed.forEach(k=>{ if(upd[k]!==undefined) me[k]=upd[k]; });
        if (upd.password && upd.password.length>=6) {
          me.passwordHash = hashPassword(upd.password);
        }
        me.profileComplete = true;
        db._rev++; writeDB(db);
        const {passwordHash,...safe}=me;
        return json(res,200,{ok:true,user:safe});
      } catch(e){ return json(res,400,{ok:false,error:e.message}); }
    }
  }

  // ── Mis facturas (self-service, alumno) ───────────────────────────────────
  // GET /api/mis-facturas → lista de sus propios pagos/facturas, para el
  // botón "Quiero mi factura" del perfil. La descarga del PDF individual usa
  // la ruta ya existente /api/factura/:pagoId/pdf (que ya valida que el
  // alumno solo pueda descargar sus propias facturas).
  if (url === '/api/mis-facturas' && method === 'GET') {
    if (!authAny(req,res)) return;
    const u = req._user;
    if (u.role !== 'student') return json(res,403,{ok:false,error:'Solo para alumnos.'});
    const db = readDB();
    const mias = (db.payments||[])
      .filter(p => p.userId === u.sub)
      .sort((a,b) => new Date(b.fechaPago||b.mes||0) - new Date(a.fechaPago||a.mes||0))
      .map(p => ({
        id: p.id,
        numeroTicket: p.numeroTicket,
        mes: p.mes,
        fechaPago: p.fechaPago,
        importe: p.importe,
        metodo: p.metodo
      }));
    return json(res,200,{ok:true,facturas:mias});
  }

  // ── Notificaciones push del alumno (suscripción del navegador/dispositivo) ──
  if (url === '/api/push/vapid-public-key' && method === 'GET') {
    if (!authAny(req,res)) return;
    return json(res,200,{key: obtenerVapidKeys().publicKeyB64});
  }
  if (url === '/api/push/subscribe' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const sub = JSON.parse(await body(req)||'{}');
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return json(res,400,{ok:false,error:'Suscripción inválida.'});
      }
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      if (!Array.isArray(me.pushSubs)) me.pushSubs = [];
      me.pushSubs = me.pushSubs.filter(s=>s.endpoint!==sub.endpoint);
      me.pushSubs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }
  if (url === '/api/push/unsubscribe' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const { endpoint } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (me && Array.isArray(me.pushSubs)) {
        me.pushSubs = me.pushSubs.filter(s=>s.endpoint!==endpoint);
        db._rev++; writeDB(db);
      }
      return json(res,200,{ok:true});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Autoreporte de pago desde el portal (botón "Pagar cuota / Renovación").
  //    Crea un registro en Pagos para que el admin lo revise/confirme; no es
  //    un cobro online real (la app no tiene pasarela de pago integrada). ──
  if (url === '/api/portal/pago' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const { metodo } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      const mes         = new Date().toISOString().slice(0,7);
      const importeBase = (db.config.precios && db.config.precios[me.plan]) || 0;

      // ── Descuento por invitar amigos: cada amigo referido que completó
      // su pago suma 1 mes de 30% pendiente (referralMesesPendientes,
      // acumulativo — ver stripe-billing.js). Al reportar un pago manual
      // se consume UN mes de ese saldo, igual que Stripe consume uno por
      // cada factura con el cupón aplicado. ──
      const mesesPendientes = Number(me.referralMesesPendientes || 0);
      const descuentoPct = mesesPendientes > 0 ? 30 : 0;
      const importe = descuentoPct > 0
        ? Math.round(importeBase * (1 - descuentoPct/100) * 100) / 100
        : importeBase;
      let notas = 'Autoreportado por el alumno desde el portal.';
      if (descuentoPct > 0) {
        notas += ` Descuento por invitar a un amigo (-${descuentoPct}%, quedan ${mesesPendientes-1} mes${mesesPendientes-1===1?'':'es'} pendientes).`;
        me.referralMesesPendientes = mesesPendientes - 1;
      }

      db.contadorTicket = (db.contadorTicket||0) + 1;
      const pago = {
        id: uuid(), userId: me.id, mes, fechaPago: new Date().toISOString(),
        importe, metodo: metodo || 'Transferencia',
        notas,
        numeroTicket: db.contadorTicket
      };
      db.payments.push(pago);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true, pago});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  /* ══════════════════════════════════════════════════════════════════
     STRIPE — suscripciones recurrentes, permanencia y facturación.
     Ver stripe-billing.js para toda la lógica. Estas rutas solo hacen
     de puente HTTP: leen el usuario autenticado, llaman al módulo, y
     traducen sus códigos de error a respuestas HTTP claras. ══════════ */

  // ── Datos fiscales del alumno (obligatorios antes de poder pagar por
  //    Stripe). Se guardan sueltos de /api/me para no interferir con el
  //    resto del formulario de perfil. ──
  if (url === '/api/portal/facturacion' && method === 'PUT') {
    if (!authAnyPendiente(req,res)) return;
    try {
      const { nombreCompleto, nifDniNie, direccionFiscal } = JSON.parse(await body(req)||'{}');
      if (!nombreCompleto || !nifDniNie || !direccionFiscal) {
        return json(res,400,{ok:false,error:'Faltan datos: nombre completo, NIF/DNI/NIE y dirección fiscal son obligatorios.'});
      }
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      me.facturacion = {
        nombreCompleto: String(nombreCompleto).slice(0,200),
        nifDniNie: String(nifDniNie).slice(0,20),
        direccionFiscal: String(direccionFiscal).slice(0,300)
      };
      db._rev++; writeDB(db);
      return json(res,200,{ok:true, facturacion: me.facturacion});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Estado de la suscripción del alumno logueado (plan, si está al
  //    día/en deuda/suspendido, si ya cumplió la permanencia, etc.) ──
  if (url === '/api/portal/stripe/estado' && method === 'GET') {
    if (!authAnyPendiente(req,res)) return;
    const db = readDB();
    const me = db.users.find(x=>x.id===req._user.sub);
    if (!me) return json(res,404,{ok:false});
    return json(res,200,{ok:true, ...stripeBilling.estadoSuscripcion(me)});
  }

  // ── Crea una Checkout Session de Stripe para suscribirse a un plan de
  //    portal (35/50/80€) y devuelve la URL a la que redirigir al alumno.
  //    body: { plan, metodoPreferido? } — metodoPreferido es solo
  //    informativo (qué opción marcó el alumno en nuestro propio
  //    formulario: tarjeta/bizum/transferencia); no cambia el modo de la
  //    sesión ni la lógica de activación — Stripe decide qué métodos
  //    ofrece de verdad según el plan y lo configurado en su Dashboard. ──
  if (url === '/api/portal/stripe/checkout-session' && method === 'POST') {
    if (!authAnyPendiente(req,res)) return;
    try {
      const { plan, metodoPreferido } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
      const metodosValidos = ['tarjeta','bizum','transferencia'];
      const session = await stripeBilling.crearCheckoutSession({
        db, user: me, plan,
        metodoPreferido: metodosValidos.includes(metodoPreferido) ? metodoPreferido : undefined,
        successUrl: `${base}/portal.html?stripe=ok`,
        cancelUrl:  `${base}/portal.html?stripe=cancelado`
      });
      console.log(`[stripe:checkout-session] modo=${stripeBilling.modoStripeActual()} userId=${me.id} plan=${plan} sessionId=${session.id}`);
      return json(res,200,{ok:true, url: session.url});
    } catch(e){
      console.error('[stripe:checkout-session] ERROR:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Sesión del Customer Portal de Stripe: el alumno cambia su método de
  //    pago y ve/descarga sus facturas en la página oficial de Stripe.
  //    Requiere que ya tenga stripeCustomerId (se crea en su primer
  //    checkout). ──
  if (url === '/api/portal/stripe/billing-portal' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
      const session = await stripeBilling.crearBillingPortalSession({
        user: me,
        returnUrl: `${base}/portal.html`
      });
      return json(res,200,{ok:true, url: session.url});
    } catch(e){
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : (code==='NO_CUSTOMER' ? 400 : 400);
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Cancela la suscripción del alumno logueado (bloqueada mientras no
  //    haya cumplido la permanencia de su plan). ──
  if (url === '/api/portal/stripe/cancelar' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      await stripeBilling.cancelarSuscripcion({ user: me });
      db._rev++; writeDB(db);
      return json(res,200,{ok:true, estado: stripeBilling.estadoSuscripcion(me)});
    } catch(e){
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : (code==='PERMANENCIA_ACTIVA' ? 403 : 400);
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Webhook de Stripe: NO lleva autenticación JWT propia — Stripe firma
  //    cada petición con STRIPE_WEBHOOK_SECRET y stripe-billing.js verifica
  //    esa firma con el cuerpo crudo (sin JSON.parse) antes de confiar en
  //    nada. Registrar esta URL en el Dashboard de Stripe → Webhooks. ──
  if (url === '/api/stripe/webhook' && method === 'POST') {
    try {
      const raw = await body(req);
      const signature = req.headers['stripe-signature'];
      const result = await stripeBilling.manejarWebhook({ rawBody: raw, signature });
      return json(res,200,result);
    } catch(e){
      // Log en servidor SIEMPRE (aunque Stripe solo vea el 400/503 en su
      // Dashboard de reintentos) — es la única forma de ver por qué un
      // webhook de prueba no activó nada, ya que Stripe no expone el
      // cuerpo de nuestra respuesta de error en detalle en su UI.
      console.error('[stripe:webhook] ERROR procesando webhook:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Clases del alumno (para calendario) ──────────────────────────────────
  if (url === '/api/my-classes' && method === 'GET') {
    if (!authAny(req,res)) return;
    const db  = readDB();
    const u   = req._user;
    const me  = db.users.find(x=>x.id===u.sub);
    if (!me) return json(res,404,{ok:false});
    // clases asignadas manualmente por el admin (campo assignedClasses en user)
    const assigned = me.assignedClasses || [];
    const classes  = db.classes.filter(c=>assigned.includes(c.id));
    return json(res,200,classes);
  }

  // ── Referidos ─────────────────────────────────────────────────────────────
  if (url === '/api/referral' && method === 'GET') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const me = db.users.find(x=>x.id===req._user.sub);
    if (!me) return json(res,404,{ok:false});
    if (!me.referralCode) { me.referralCode = uuid().slice(0,8); db._rev++; writeDB(db); }
    const code = me.referralCode;
    // "Amigos invitados" cuenta conversiones reales: alguien que se registró
    // con este código Y completó su pago (activo, ya no pendiente) — no
    // simples visitas al enlace ni registros sin pagar. Es una consulta en
    // caliente sobre la base de datos, no un contador guardado aparte.
    const referred = db.users.filter(u => u.referredBy === me.id && u.active && !u.pendingPayment);
    const mesesPendientes = Number(me.referralMesesPendientes || 0);
    const discount = mesesPendientes > 0 ? 30 : 0;
    // Mismo origen que las URLs de retorno de Stripe Checkout (server.js,
    // ruta /api/portal/stripe/checkout-session): PUBLIC_BASE_URL como
    // fuente de verdad del dominio público, con el host de la petición
    // como respaldo si no está configurada.
    const host  = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
    const link  = `${base}/registro-membresia.html?ref=${code}`;
    return json(res,200,{code,referred:referred.length,discount,mesesPendientes,link});
  }

  // ── Asignación de clases a alumno por admin ───────────────────────────────
  if (url.match(/^\/api\/users\/[a-z0-9-]+\/classes$/) && method === 'PUT') {
    if (!requireRole(['admin'])(req,res)) return;
    const uid_ = url.split('/')[3];
    try {
      const db = readDB();
      const { classIds, plan, nivelBachata, nivelSalsa, rol } = JSON.parse(await body(req)||'{}');
      const me = db.users.find(x=>x.id===uid_);
      if (!me) return json(res,404,{ok:false});
      if (classIds) me.assignedClasses = classIds;
      if (plan)     me.plan = plan;
      if (nivelBachata!==undefined) me.nivelBachata = nivelBachata;
      if (nivelSalsa!==undefined)   me.nivelSalsa   = nivelSalsa;
      if (rol)      me.rol = rol;
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Enlace general de invitación (admin) ─────────────────────────────────
  // GET  /api/invite-link  → devuelve la URL de invitación general de la app
  // PUT  /api/invite-link  → regenera el token de invitación
  if (url === '/api/invite-link') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    if (method === 'GET') {
      if (!db.config.inviteToken) {
        db.config.inviteToken = uuid().replace(/-/g,'');
        db._rev++; writeDB(db);
      }
      const host = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const link = `${proto}://${host}/join.html?t=${db.config.inviteToken}`;
      return json(res,200,{ok:true, link, token: db.config.inviteToken});
    }
    if (method === 'PUT') {
      // Regenerar token (invalida links anteriores)
      db.config.inviteToken = uuid().replace(/-/g,'');
      db._rev++; writeDB(db);
      const host = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const link = `${proto}://${host}/join.html?t=${db.config.inviteToken}`;
      return json(res,200,{ok:true, link, token: db.config.inviteToken});
    }
  }

  // ── Onboarding: validar token de invitación (público) ────────────────────
  // GET /api/onboarding/check?t=TOKEN
  if (url.startsWith('/api/onboarding/check') && method === 'GET') {
    const params = new URL('http://x' + req.url).searchParams;
    const t = params.get('t') || '';
    const db = readDB();
    if (!t || t !== db.config.inviteToken) {
      return json(res,403,{ok:false,error:'Enlace inválido o expirado'});
    }
    return json(res,200,{ok:true, precios: db.config.precios, portalPlans: db.config.portalPlans || ['35','50','80']});
  }

  // ── Onboarding: token de invitación para la página pública de registro ────
  // GET /api/onboarding/public-token  (sin auth: esta página ES el punto de
  // alta público de la academia, equivalente a compartir el link de invitación)
  if (url === '/api/onboarding/public-token' && method === 'GET') {
    const db = readDB();
    if (!db.config.inviteToken) {
      db.config.inviteToken = uuid().replace(/-/g,'');
      db._rev++; writeDB(db);
    }
    return json(res,200,{ok:true, token: db.config.inviteToken});
  }

  // ── Onboarding: registro rápido por enlace de invitación (público) ────────
  // POST /api/onboarding/register
  if (url === '/api/onboarding/register' && method === 'POST') {
    try {
      const db = readDB();
      const { token, nombre, telefono, email, plan, refCode, dias, aceptadoImagen, aceptadoPermanencia } = JSON.parse(await body(req)||'{}');
      // Validar token de invitación
      if (!token || token !== db.config.inviteToken) {
        return json(res,403,{ok:false,error:'Enlace inválido o expirado'});
      }
      if (!nombre || !plan) return json(res,400,{ok:false,error:'Faltan datos'});
      const planesValidos = Object.keys(db.config.precios||{});
      if (!planesValidos.includes(plan)) return json(res,400,{ok:false,error:'Plan inválido'});
      // Cláusula legal obligatoria (permanencia de 2 meses en los planes que
      // aplica + cesión de derechos de imagen, RGPD): sin esta confirmación
      // explícita del alumno no se crea la cuenta.
      if (!aceptadoImagen || !aceptadoPermanencia) {
        return json(res,400,{ok:false,error:'Debes aceptar las condiciones de permanencia y el uso de imagen para continuar.'});
      }

      // Enlace de referido (?ref=CODIGO en registro-membresia.html): si el
      // código corresponde a un alumno real, se guarda quién invitó. La
      // recompensa (contador + descuento) se aplica recién cuando este
      // usuario nuevo complete su pago de verdad — ver
      // stripeBilling.otorgarRecompensaReferidoSiCorresponde, llamada desde
      // el webhook checkout.session.completed.
      let referrerId = null;
      if (refCode) {
        const ref = db.users.find(u => u.referralCode === refCode);
        if (ref) referrerId = ref.id;
      }

      // Crear usuario pendiente de pago
      const passRand = crypto.randomBytes(16).toString('hex');
      const usernameVal = 'user_' + crypto.randomBytes(4).toString('hex');
      const newUser = {
        id: uuid(),
        username: usernameVal,
        passwordHash: hashPassword(passRand),
        role: 'student',
        nombre: nombre.trim(),
        email: (email||'').trim(),
        telefono: (telefono||'').trim(),
        active: false,           // inactivo hasta confirmar pago
        plan: plan,
        pendingPayment: true,    // flag: pago pendiente
        pendingPlan: plan,
        guestCourtesy: false,
        cashOnly: false,
        portalAccess: false,
        facturaEnvio: 'none',
        referralCode: uuid().slice(0,8),
        referredBy: referrerId,
        profileComplete: false,
        onboardingToken: uuid().replace(/-/g,''), // token único para recuperar la sesión
        createdAt: new Date().toISOString(),
        // Días de clase elegidos en el registro (informativo; el admin puede
        // ajustarlos luego al asignar clases reales).
        diasAsistencia: Array.isArray(dias) ? dias.filter(d => typeof d === 'string').slice(0,7) : [],
        // Confirmación legal explícita del alumno al registrarse: condiciones
        // de permanencia (2 meses, aplica a los planes 50€ y VIP 80€) y
        // cesión de derechos de imagen en fotos/vídeos con fines
        // promocionales (RGPD). Ambas quedan en true porque el registro ya
        // se bloqueó arriba si no se confirmaron.
        aceptadoImagen: true,
        aceptadoPermanencia: true,
        fechaRegistro: new Date().toISOString()
      };
      db.users.push(newUser);
      db._rev++; writeDB(db);

      // Generar JWT temporal (role student, pero active=false → sin acceso real)
      const token_ = signJWT({
        sub: newUser.id, role: 'student', nombre: newUser.nombre,
        exp: Math.floor(Date.now()/1000) + 3600 // 1h para completar el onboarding
      });
      const cookie = `malevo_jwt=${token_}; HttpOnly; Path=/; Max-Age=3600; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,201,{
        ok:true,
        userId: newUser.id,
        nombre: newUser.nombre,
        plan: plan,
        precio: db.config.precios[plan] || 0,
        onboardingToken: newUser.onboardingToken
      },{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Onboarding: alta directa por Stripe Checkout, SIN registro previo
  //    (público) — reemplaza el paso 2 "Tus datos de acceso" en
  //    registro-membresia.html: el alumno elige plan + método preferido +
  //    acepta condiciones, y aquí se crea directamente la sesión de
  //    Stripe Checkout. Los datos de identificación (nombre/email/
  //    teléfono) los recoge la propia página de Stripe
  //    (billing_address_collection + phone_number_collection, ver
  //    stripeBilling.crearCheckoutSessionDirecta) y la cuenta del alumno
  //    se crea recién cuando el pago se confirma — ver
  //    /api/onboarding/confirmar-checkout y el webhook. ──
  // POST /api/onboarding/checkout-directo
  if (url === '/api/onboarding/checkout-directo' && method === 'POST') {
    try {
      const db = readDB();
      const { token, plan, metodoPreferido, refCode, aceptadoImagen, aceptadoPermanencia } = JSON.parse(await body(req)||'{}');
      if (!token || token !== db.config.inviteToken) {
        return json(res,403,{ok:false,error:'Enlace inválido o expirado'});
      }
      if (!plan) return json(res,400,{ok:false,error:'Falta el plan'});
      const planesValidos = Object.keys(db.config.precios||{});
      const portalPlansOk = db.config.portalPlans || [];
      if (!planesValidos.includes(plan) && !portalPlansOk.includes(plan)) {
        return json(res,400,{ok:false,error:'Plan inválido'});
      }
      // Misma cláusula legal obligatoria que en /api/onboarding/register
      // (permanencia + cesión de imagen): sin esto no se crea la sesión.
      if (!aceptadoImagen || !aceptadoPermanencia) {
        return json(res,400,{ok:false,error:'Debes aceptar las condiciones de permanencia y el uso de imagen para continuar.'});
      }
      const metodosValidos = ['tarjeta','bizum','transferencia'];
      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
      const session = await stripeBilling.crearCheckoutSessionDirecta({
        db, plan,
        metodoPreferido: metodosValidos.includes(metodoPreferido) ? metodoPreferido : undefined,
        refCode: (refCode||'').trim() || undefined,
        aceptadoImagen: true,
        aceptadoPermanencia: true,
        // {CHECKOUT_SESSION_ID} lo sustituye Stripe por el id real de la
        // sesión al redirigir de vuelta — portal.js lo lee de la URL para
        // llamar a /api/onboarding/confirmar-checkout.
        successUrl: `${base}/portal.html?stripe=ok&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl:  `${base}/registro-membresia.html?stripe=cancelado`
      });
      console.log(`[stripe:checkout-directo] modo=${stripeBilling.modoStripeActual()} plan=${plan} sessionId=${session.id} url=${session.url}`);
      return json(res,200,{ok:true, url: session.url});
    } catch(e) {
      console.error('[stripe:checkout-directo] ERROR creando la sesión:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Onboarding: confirma una Checkout Session al volver de Stripe
  //    (público) — se llama con ?session_id=... apenas el navegador
  //    vuelve a portal.html tras el pago. Consulta la sesión
  //    DIRECTAMENTE a la API de Stripe (no depende de que el webhook ya
  //    haya llegado): si el pago está confirmado, crea/activa la cuenta
  //    (stripeBilling.confirmarCheckoutSession) y deja al alumno logueado
  //    con su propia cookie de sesión, lista para que portal.js continúe
  //    con el flujo normal de /api/me. ──
  // GET /api/onboarding/confirmar-checkout?session_id=...
  if (url.startsWith('/api/onboarding/confirmar-checkout') && method === 'GET') {
    try {
      const params = new URL('http://x' + req.url).searchParams;
      const sessionId = params.get('session_id') || '';
      console.log(`[stripe:confirmar-checkout] request recibida · sessionId=${sessionId || '(vacío)'}`);
      const db = readDB();
      const { pagado, user } = await stripeBilling.confirmarCheckoutSession({ db, sessionId });
      if (!pagado || !user) return json(res,200,{ok:true, pending:true});
      const token_ = signJWT({
        sub: user.id, role: 'student', nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token_}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,200,{ok:true, active:true, nombre:user.nombre},{'Set-Cookie':cookie});
    } catch(e) {
      console.error('[stripe:confirmar-checkout] ERROR:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── NOTA DE SEGURIDAD: el endpoint /api/onboarding/confirm-payment que
  // existía aquí permitía que CUALQUIERA activara su propia cuenta con un
  // simple POST (auto-atestiguando "ya pagué"), sin ninguna verificación
  // real — el alumno nunca llegaba a pasar por Stripe. Se eliminó a
  // propósito: la única vía para activar una cuenta (user.active=true,
  // pendingPayment=false) es ahora el webhook real de Stripe
  // (checkout.session.completed, ver stripeBilling.manejarWebhook), que sí
  // confirma que el pago se procesó de verdad. El registro
  // (/api/onboarding/register) y el checkout
  // (/api/portal/stripe/checkout-session) siguen igual; solo cambia que ya
  // no hay atajo para saltarse Stripe. ──

  // ── Onboarding: verificar si el usuario autenticado aún tiene pago pendiente ─
  // GET /api/onboarding/status
  if (url === '/api/onboarding/status' && method === 'GET') {
    const u = getUser(req);
    if (!u) return json(res,401,{ok:false});
    const db = readDB();
    const userRec = db.users.find(x => x.id === u.sub);
    if (!userRec) return json(res,404,{ok:false});
    return json(res,200,{
      ok: true,
      active: !!userRec.active,
      pendingPayment: !!userRec.pendingPayment,
      plan: userRec.plan,
      nombre: userRec.nombre,
      precio: db.config.precios[userRec.plan] || 0,
      onboardingToken: userRec.onboardingToken || null
    });
  }

  // ── PDF resumen de todas las facturas ────────────────────────────────────
  // POST /api/facturas/informe-todas   body: { desde?, hasta? }
  if (url === '/api/facturas/informe-todas' && method === 'POST') {
    const u = getUser(req);
    if (!u || !['admin','teacher'].includes(u.role)) return json(res,401,{ok:false});
    try {
      const db    = readDB();
      const body_ = JSON.parse(await body(req)||'{}');
      let pagos   = [...db.payments];
      if (body_.desde && body_.hasta) {
        pagos = pagos.filter(p => {
          const m = (p.mes||'').slice(0,7);
          return m >= body_.desde && m <= body_.hasta;
        });
      }
      pagos.sort((a,b) => ((a.mes||'')+(a.fechaPago||'')).localeCompare((b.mes||'')+(b.fechaPago||'')));
      const pdfBuf = await generarPDFResumen(pagos, db, body_.titulo || 'Informe de facturas');
      const nombre = body_.nombre || 'informe_facturas_malevo.pdf';
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Content-Length': pdfBuf.length,
        'Cache-Control': 'no-store'
      });
      return res.end(pdfBuf);
    } catch(e) { return json(res,500,{ok:false,error:e.message}); }
  }

  // ── PDF informe trimestral ────────────────────────────────────────────────
  // POST /api/facturas/informe-trimestral   body: { desde, hasta, trimLabel }
  if (url === '/api/facturas/informe-trimestral' && method === 'POST') {
    const u = getUser(req);
    if (!u || !['admin','teacher'].includes(u.role)) return json(res,401,{ok:false});
    try {
      const db    = readDB();
      const body_ = JSON.parse(await body(req)||'{}');
      if (!body_.desde || !body_.hasta) return json(res,400,{ok:false,error:'Faltan desde/hasta'});
      const pagos = db.payments
        .filter(p => { const m=(p.mes||'').slice(0,7); return m>=body_.desde && m<=body_.hasta; })
        .sort((a,b)=>((a.mes||'')+(a.fechaPago||'')).localeCompare((b.mes||'')+(b.fechaPago||'')));
      const titulo   = body_.trimLabel || `Informe trimestral ${body_.desde} – ${body_.hasta}`;
      const pdfBuf   = await generarPDFResumen(pagos, db, titulo);
      const nombre   = `informe_trimestral_${body_.desde}_${body_.hasta}.pdf`;
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Content-Length': pdfBuf.length,
        'Cache-Control': 'no-store'
      });
      return res.end(pdfBuf);
    } catch(e) { return json(res,500,{ok:false,error:e.message}); }
  }

  // ── Generación de PDF de factura individual ──────────────────────────────
  // GET /api/factura/:pagoId/pdf
  const facturaMatch = url.match(/^\/api\/factura\/([a-z0-9-]+)\/pdf$/);
  if (facturaMatch && method === 'GET') {
    const u = getUser(req);
    if (!u) return json(res, 401, {ok:false});
    const db  = readDB();
    const pid = facturaMatch[1];
    const p   = db.payments.find(x => x.id === pid);
    if (!p) return json(res, 404, {ok:false, error:'Pago no encontrado'});
    // Admin/profe pueden ver cualquier factura; el alumno solo la suya propia.
    const esPropia = u.role === 'student' && p.userId === u.sub;
    if (!['admin','teacher'].includes(u.role) && !esPropia) {
      return json(res, 401, {ok:false});
    }

    const pdfBuf = await generarPDFFactura(p, db);
    const numT   = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : pid.slice(0,8);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${numT}.pdf"`,
      'Content-Length': pdfBuf.length,
      'Cache-Control': 'no-store'
    });
    return res.end(pdfBuf);
  }

  // ── ZIP con múltiples PDFs ────────────────────────────────────────────────
  // POST /api/facturas/zip   body: { ids: [...] }   o   { desde, hasta }
  if (url === '/api/facturas/zip' && method === 'POST') {
    const u = getUser(req);
    if (!u || !['admin','teacher'].includes(u.role)) {
      return json(res, 401, {ok:false});
    }
    try {
      const db   = readDB();
      const body_ = JSON.parse(await body(req)||'{}');
      let pagos = [];

      if (Array.isArray(body_.ids) && body_.ids.length) {
        pagos = db.payments.filter(p => body_.ids.includes(p.id));
      } else if (body_.desde && body_.hasta) {
        pagos = db.payments.filter(p => {
          const m = (p.mes||'').slice(0,7);
          return m >= body_.desde && m <= body_.hasta;
        });
      } else {
        pagos = [...db.payments];
      }
      pagos.sort((a,b) => ((a.mes||'')+(a.fechaPago||'')).localeCompare((b.mes||'')+(b.fechaPago||'')));

      if (!pagos.length) return json(res, 404, {ok:false, error:'Sin facturas en ese período'});

      const nombre = body_.nombre || 'facturas_malevo.zip';
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Cache-Control': 'no-store'
      });

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(res);
      archive.on('error', err => { try{ res.end(); }catch{} });

      for (const p of pagos) {
        const numT   = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : 'T-'+p.id.slice(0,6);
        const pdfBuf = await generarPDFFactura(p, db);
        archive.append(pdfBuf, { name: `${numT}.pdf` });
      }

      await archive.finalize();
      return;
    } catch(e) { return json(res, 500, {ok:false, error:e.message}); }
  }

  // ── Estáticos ─────────────────────────────────────────────────────────────
  if (method === 'GET') return serveStatic(req, res);
  res.writeHead(404); res.end('Not found');
});

/* ---------- Arranque ----------
   Async porque, antes de abrir el puerto, intentamos restaurar el último
   backup de db.json desde Firebase Storage (ver firebase.js). Con un
   disco persistente (como en este servidor) esto ya no es imprescindible
   para sobrevivir un reinicio — el db.json local no se borra solo — pero
   se deja activo como red de seguridad ante un fallo de disco. Ojo con
   un caso de borde: si alguna vez editás db.json a mano con el servidor
   apagado, ese cambio se pisa en el próximo arranque con la copia de
   Firebase (que puede ser anterior). Para desactivar esta restauración
   (y también el backup automático) simplemente dejá
   FIREBASE_SERVICE_ACCOUNT_JSON sin definir en el .env. Si no hay backup
   todavía, o Firebase no está configurado, o falla la descarga por lo
   que sea, seguimos con el db.json local tal cual (ensureData() ya
   garantiza que exista, aunque sea vacío) — nunca bloqueamos el arranque
   por esto. */
async function iniciarServidor() {
  ensureData();
  try {
    const restaurado = await firebaseBackup.restaurarDBDesdeBackup(DB_FILE);
    console.log(restaurado
      ? '✓ db.json restaurado desde el último backup de Firebase Storage.'
      : '… Sin backup de Firebase Storage disponible (o Firebase no configurado) — usando el db.json local.');
  } catch (e) {
    console.warn('⚠ No se pudo restaurar el backup de Firebase Storage:', e.message);
  }

  server.listen(PORT, '0.0.0.0', () => {
    const db = readDB();
    if (db.users.length === 0) {
      console.log('\n⚠  PRIMERA EJECUCIÓN: ve a http://localhost:'+PORT+'/setup.html para crear el admin.\n');
    }
    console.log('Malevo v3.0 · http://localhost:'+PORT+'  (datos: '+DB_FILE+')');
    console.log(_stripeConfigurado
      ? 'Stripe: configurado (claves detectadas).'
      : 'Stripe: NO configurado — faltan STRIPE_SECRET_KEY/paquete "stripe", o ambos. Los pagos manuales/efectivo funcionan igual.');
    // Diagnóstico de arranque para PUBLIC_BASE_URL: sin esto, un .env mal
    // cargado (o un service sin reiniciar tras editarlo) se nota recién
    // cuando alguien genera un link y ve la IP/puerto local en vez del
    // dominio público — con este aviso queda claro desde el primer
    // segundo, en journalctl -u malevo, si la variable llegó bien o no.
    console.log(process.env.PUBLIC_BASE_URL
      ? '✓ PUBLIC_BASE_URL activo: ' + process.env.PUBLIC_BASE_URL + ' (todos los enlaces generados usan este dominio).'
      : '⚠ PUBLIC_BASE_URL no está definida — los enlaces (Cursos Exclusivos, Stripe, etc.) se van a generar con el host/IP de cada request entrante en vez del dominio público. Definila en .env y reiniciá el servicio.');
  });
}
iniciarServidor();
=======
/* ===== Malevo v3.0 · Servidor con JWT y RBAC estricto =====
 * Roles: admin | teacher | student | guest
 * Variables de entorno:
 *   JWT_SECRET            (obligatorio en producción)
 *   PORT                  (por defecto 8080)
 *   DATA_DIR              (por defecto ./data)
 *   STRIPE_SECRET_KEY     (clave secreta de Stripe — sk_test_... / sk_live_...)
 *   STRIPE_WEBHOOK_SECRET (firma del endpoint de webhook — whsec_...)
 *   PUBLIC_BASE_URL       (URL pública del sitio, para las redirecciones de Checkout;
 *                          si no está, se deduce del propio request)
 * Sin STRIPE_SECRET_KEY el servidor arranca y funciona igual — los
 * endpoints /api/stripe/* y /api/portal/stripe/* devuelven un error claro
 * en vez de romper el resto de la app (ver stripe-billing.js).
 */
'use strict';
const http     = require('http');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const PDFDoc   = require('pdfkit');
const archiver = require('archiver');

// Carga opcional de un archivo .env en la raíz del proyecto (sin depender
// de ningún paquete npm): cada línea "CLAVE=valor" se vuelca en
// process.env si esa variable todavía no estaba definida (así una
// variable ya exportada por el sistema/hosting siempre gana). Si no existe
// el archivo, no pasa nada — se sigue leyendo todo de process.env normal.
(function cargarDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    // Primera pasada: parsear a un objeto en memoria. Si una misma clave
    // aparece más de una vez en el archivo (p.ej. un bloque de claves de
    // prueba seguido de uno de claves reales), gana la ÚLTIMA aparición —
    // igual que el paquete "dotenv" estándar — para que añadir un bloque
    // nuevo al final del archivo funcione como se espera.
    const parsed = {};
    raw.split('\n').forEach(line => {
      const l = line.trim();
      if (!l || l.startsWith('#')) return;
      const eq = l.indexOf('=');
      if (eq === -1) return;
      const key = l.slice(0, eq).trim();
      let val = l.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) parsed[key] = val;
    });
    // Segunda pasada: solo se aplica al proceso si esa variable no vino ya
    // fijada por el entorno real (una variable exportada por el sistema o
    // el hosting siempre gana sobre el archivo .env).
    for (const key in parsed) {
      if (!(key in process.env)) process.env[key] = parsed[key];
    }
  } catch { /* .env opcional — cualquier error de lectura se ignora */ }
})();

const stripeBilling = require('./stripe-billing.js');
const firebaseBackup = require('./firebase.js');

const PORT      = process.env.PORT     || 8081;
const ROOT      = __dirname;
const DATA_DIR  = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE   = path.join(DATA_DIR, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'malevo_dev_secret_change_in_prod';
const TOKEN_TTL  = 30 * 24 * 3600; // 30 días en segundos
// Sesión más larga para compradores externos "solo cursos" (soloCursosExternos):
// su acceso al curso dura 1 año (cursosVencimientos), así que la sesión que
// los mantiene logueados en la PWA debería durar lo mismo — si usáramos el
// TOKEN_TTL normal (30 días) se les cerraría la sesión mucho antes de que se
// les venza el curso, obligándolos a re-loguearse por un canal (código
// passwordless) que hoy no envía SMS real.
const TOKEN_TTL_CURSO_EXTERNO = 365 * 24 * 3600; // 1 año en segundos

// ⚠️ Bypass de login para pruebas locales (ver /api/dev-auto-login más abajo).
// Ya no depende de ninguna variable de entorno: funciona automáticamente
// cuando la petición viene de la propia máquina (localhost/127.0.0.1),
// que es como se accede en pruebas locales. Si este mismo server.js se
// despliega en un servidor accesible por internet u otras personas, el
// bypass queda inactivo solo (nadie externo puede alcanzar "localhost"),
// pero sigue siendo buena práctica borrar este bloque antes de un
// despliegue real de producción.
//
// ⚠ FIX DE SEGURIDAD (detectado en producción): con cualquier proxy
// inverso delante del proceso (nginx, Caddy, Cloudflare, etc.) el proxy
// puede reenviar la conexión al proceso Node por una ruta interna que hace
// que req.socket.remoteAddress SIGA viéndose como 127.0.0.1/::1, aunque la
// petición venga de un visitante externo real. Eso dejaba entrar a
// cualquiera al panel admin sin credenciales vía /api/dev-auto-login.
// La señal fiable no es la IP del socket, sino la presencia de cabeceras
// x-forwarded-*: CUALQUIER proxy real (nginx, Caddy, Cloudflare, etc.)
// las añade siempre; una conexión realmente local (curl o navegador
// hablando directo con node server.js en localhost, sin proxy de por
// medio) nunca las manda. Por
// eso, si aparece cualquier cabecera x-forwarded-*, la tratamos como NO
// local sin importar lo que diga el socket — ver cookieSecureFlag() abajo,
// que ya depende de x-forwarded-proto para lo mismo.
function esConexionLocal(req) {
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers['x-forwarded-host']) {
    return false;
  }
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Añade el flag "Secure" a la cookie de sesión cuando la petición llega
// por HTTPS (un proxy inverso delante — nginx, Caddy, etc. — hace la
// TLS-termination y reenvía con x-forwarded-proto:https), para que el
// navegador nunca la mande por una conexión sin cifrar. En local
// (http://localhost) no se añade, así que el desarrollo/las pruebas
// siguen funcionando igual.
function cookieSecureFlag(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return (proto === 'https' || req.socket?.encrypted) ? '; Secure' : '';
}

/* ---------- Login passwordless del alumno ----------
 * El alumno se identifica con su email o teléfono registrado (sin
 * contraseña) y recibe un código temporal de 6 dígitos para confirmar el
 * acceso. Por ahora no hay ningún proveedor externo de email/SMS/WhatsApp
 * conectado (Twilio, SendGrid, etc.), así que enviarCodigoAcceso() es un
 * stub: el código se devuelve directamente en la respuesta de
 * /api/auth/passwordless/request para que el frontend lo "simule en
 * pantalla" y el alumno pueda confirmar sin fricción desde cualquier
 * dispositivo. Cuando se quiera conectar un proveedor real, basta con:
 *   1) implementar el envío de verdad dentro de enviarCodigoAcceso(), y
 *   2) dejar de incluir "code" en la respuesta de /request (el frontend
 *      ya está preparado para que ese campo sea opcional).
 * Los códigos viven solo en memoria (no en data/db.json): son de un solo
 * uso y de corta duración, así que no hace falta persistirlos en disco. */
const _codigosAcceso = new Map(); // userId -> { code, exp }
const CODIGO_TTL_MS = 10 * 60 * 1000; // 10 minutos

function generarCodigoAcceso() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
}

// Token de un solo uso para enlaces de curso externos (ver /c/:token más
// abajo): estrictamente alfanumérico, sin guiones ni guiones bajos. Antes
// se usaba base64url (crypto.randomBytes(8).toString('base64url')), que
// incluye "-" y "_" en su alfabeto — WhatsApp en algunos móviles corta la
// URL justo en esos caracteres al hacer salto de línea, dejando el enlace
// roto en dos pedazos no clicables. Por eso acá se genera en base64
// estándar (que sí tiene un alfabeto conocido) y se filtran los símbolos
// no alfanuméricos (+, / y el padding =), rellenando con más bytes si el
// filtrado deja el resultado corto, hasta juntar exactamente `len`
// caracteres de un solo tirón (A-Z, a-z, 0-9).
function generarTokenAlfanumerico(len = 12) {
  let out = '';
  while (out.length < len) {
    out += crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  }
  return out.slice(0, len);
}

// Stub de envío — sustituir por una integración real (SendGrid, Twilio,
// WhatsApp Business API…) cuando esté disponible. Hoy no hace nada: el
// código se muestra en pantalla desde la propia respuesta del endpoint.
async function enviarCodigoAcceso(user, code) {
  return true;
}

// Normaliza un teléfono para comparar sin importar espacios, guiones,
// paréntesis o el prefijo de país de España (+34 / 0034). Solo se recorta
// el prefijo cuando el número resultante tiene exactamente 9 dígitos (el
// formato de un móvil español) — así evitamos "comernos" dígitos de datos
// mal cargados (p.ej. números de más de 9 dígitos sin prefijo real) que
// podrían chocar entre sí con un recorte genérico de "últimos 9 dígitos".
function normalizarTelefono(v) {
  const digitos = String(v || '').replace(/\D+/g, '');
  if (digitos.length === 11 && digitos.startsWith('34'))   return digitos.slice(2);
  if (digitos.length === 13 && digitos.startsWith('0034')) return digitos.slice(4);
  return digitos;
}

function buscarUsuarioPorContacto(db, contacto) {
  const c = String(contacto || '').trim();
  if (!c) return null;
  const cLower = c.toLowerCase();
  const cTelExacto = c.replace(/\s+/g, '');
  const cTelNorm   = normalizarTelefono(c);
  const coincide = u => u.role === 'student' &&
    ((u.email && u.email.toLowerCase() === cLower) ||
     (u.telefono && (
       u.telefono.replace(/\s+/g, '') === cTelExacto ||
       (cTelNorm && normalizarTelefono(u.telefono) === cTelNorm)
     )));
  const candidatos = (db.users || []).filter(coincide);
  if (!candidatos.length) return null;
  // Si hay varias coincidencias (p.ej. un registro anterior pendiente de
  // pago con el mismo email/teléfono), prioriza la cuenta activa.
  return candidatos.find(u => u.active) || candidatos[0];
}

/* ---------- MIME ---------- */
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp',
  '.gif':'image/gif', '.avif':'image/avif', '.bmp':'image/bmp',
  '.mp4':'video/mp4', '.webm':'video/webm', '.m4v':'video/x-m4v',
  '.txt':'text/plain; charset=utf-8', '.pdf':'application/pdf',
  '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf'
};

/* ---------- JWT puro (sin librería externa) ---------- */
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function signJWT(payload) {
  const header  = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const body    = b64url(JSON.stringify(payload));
  const sig     = b64url(crypto.createHmac('sha256', JWT_SECRET)
                    .update(header + '.' + body).digest());
  return header + '.' + body + '.' + sig;
}
function verifyJWT(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = b64url(crypto.createHmac('sha256', JWT_SECRET)
                    .update(parts[0] + '.' + parts[1]).digest());
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (p.exp && Date.now() / 1000 > p.exp) return null;
    return p;
  } catch { return null; }
}
function tokenFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // también acepta cookie malevo_jwt (fallback para SPA)
  const c = req.headers.cookie || '';
  const item = c.split(';').map(s=>s.trim()).find(s=>s.startsWith('malevo_jwt='));
  return item ? decodeURIComponent(item.slice('malevo_jwt='.length)) : null;
}
function getUser(req) { return verifyJWT(tokenFromReq(req)); }

/* ---------- Utilidades constante-time ---------- */
function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // consume tiempo igual
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------- Base de datos ---------- */
const DB_EMPTY = {
  config: {
    iva:21, mesesIniciales:3,
    inicial:{ malevo:80, box:20 }, posterior:{ malevo:70, box:30 },
    precios:{ 'suelta':12,'35':35,'50':50,'80':80,'bono':100 }, bonoClases:10,
    portalPlans:['35','50','bono','80'],   // planes con acceso al aula virtual
    negocio:{ nombre:'Academia de Baile Malevo', nif:'', direccion:'', contacto:'', pie:'' },
    // Meses de permanencia mínima exigidos por Stripe según el plan (0 =
    // sin compromiso). Editable desde db.json o un futuro panel; si un
    // plan no aparece acá, stripe-billing.js usa un valor por defecto
    // (2 meses en 50€/80€, 0 en el resto) — ver mesesPermanencia().
    permanenciaMeses: { '35':0, '50':2, '80':2, 'bono':0 },
    // Cache de los Price ID de Stripe ya creados por plan (se rellena solo
    // la primera vez que alguien paga ese plan — ver ensurePriceId()).
    stripePriceIds: {}
  },
  users: [],        // { id, username, passwordHash, role, nombre, email, active, plan, rol, assignedClasses, nivelBachata, nivelSalsa (arrays de niveles, selección libre — gestionados por el admin), nivelBachataPreferido, nivelSalsaPreferido (autopercibido por el alumno, informativo), referralCode, referredBy, referralMesesPendientes (meses de 30% pendientes por amigos referidos que pagaron, acumulativo — ver stripe-billing.js), referralRecompensaOtorgada (evita otorgar el mes dos veces si Stripe reintenta el webhook), profileComplete, pushSubs (suscripciones push del navegador/dispositivo), cursosAsignados (ids de db.cursos que el admin le dio acceso), stripeCustomerId, stripeSubscriptionId, subscriptionStatus, permanenciaMesesRequeridos, permanenciaInicio, facturacion:{nombreCompleto,nifDniNie,direccionFiscal} }
  classes: [],      // { id, nombre, estilo, nivel, nivelNum, dia, inicio, fin, aforo, hasVideo }
  enrollments: [],  // { id, userId, classId, nivelMax, status, fechaAlta }
  videos: [],       // { id, disciplina, nivel, titulo, url, orden }
  cursos: [],       // { id, nombre, ritmo:'bachata'|'salsa'|'otros', subcategoria, imagenPortada, nivel, duracion, videos:[{id,titulo,url,orden}], orden, activo }
  tokensCursoExterno: [], // Enlaces de UN SOLO USO para vender un Curso Exclusivo a gente de afuera que paga en persona
                      // (efectivo/en mano), sin pasarela online: { id, cursoId, token, usado, fechaGenerado, fechaUsado, userId }.
                      // El admin genera el token vacío desde "👥 Alumnos" (sin pedir datos todavía) y se lo pasa él mismo al
                      // comprador; recién cuando esa persona abre el link y completa su nombre+teléfono
                      // (POST /api/publico/token/:token/canjear) se crea/reutiliza su cuenta de alumno, el token se marca
                      // usado=true para siempre (no se puede volver a canjear) y queda logueada en el portal.
  attendances: [],  // { id, classId, userId, fecha, present }
  payments: [],     // { id, userId, mes, fechaPago, importe, metodo, notas, numeroTicket }
  contadorTicket: 0,
  _rev: 0
};

function ensureData() {
  // Si DATA_DIR apunta a un punto de montaje (otro disco/partición) que
  // todavía no está montado, mkdirSync/writeFileSync lanzan una excepción
  // síncrona ANTES de que server.listen() llegue a abrir el puerto — sin
  // pista de la causa real si no se atrapa. Con este try/catch al menos
  // queda un mensaje claro en los logs señalando el DATA_DIR concreto que
  // falló.
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
    if (!fs.existsSync(DB_FILE))  fs.writeFileSync(DB_FILE, JSON.stringify(DB_EMPTY,null,2));
  } catch (e) {
    console.error('✗ ERROR FATAL: no se pudo crear/acceder a DATA_DIR ("'+DATA_DIR+'"). ' +
      'Si DATA_DIR apunta a otro disco/partición montado aparte, comprueba que esté ' +
      'realmente montado en esa ruta exacta antes de arrancar el servicio. Detalle:', e.message);
    throw e;
  }
}
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch { return JSON.parse(JSON.stringify(DB_EMPTY)); }
}
function writeDB(obj) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj,null,2));
  fs.renameSync(tmp, DB_FILE);
  _programarBackupFirebase();
}

/* ---------- Backup de db.json en Firebase Storage ----------
   El disco de este servidor es persistente (a diferencia de plataformas
   con hosting efímero), así que este backup ya no es la única copia de
   los datos — es una red de seguridad extra ante un fallo de disco o un
   borrado accidental. Cada escritura programa (con un pequeño debounce,
   para no subir en cada cambio suelto si llegan varios seguidos) una
   subida en segundo plano del db.json actual a Firebase Storage — ver
   firebase.js. Si Firebase no está configurado o la subida falla, esto
   nunca bloquea ni rompe la petición que disparó el writeDB(): solo se
   registra un aviso en los logs. La restauración (bajar el último
   backup) pasa una sola vez, al arrancar, antes de abrir el puerto — ver
   iniciarServidor() más abajo. */
let _backupFirebaseTimer = null;
let _backupFirebasePendiente = false; // true si hay un cambio guardado localmente que aún no se subió
let _backupFirebaseChain = Promise.resolve(); // serializa subidas: nunca dos en paralelo pisándose
function _programarBackupFirebase() {
  _backupFirebasePendiente = true;
  if (_backupFirebaseTimer) clearTimeout(_backupFirebaseTimer);
  _backupFirebaseTimer = setTimeout(_ejecutarBackupFirebase, 4000);
}
function _ejecutarBackupFirebase() {
  if (_backupFirebaseTimer) { clearTimeout(_backupFirebaseTimer); _backupFirebaseTimer = null; }
  // Encadenada sobre la subida anterior (si la hubiera) en vez de lanzarla en
  // paralelo: así, si dos escrituras casi seguidas disparan cada una su propio
  // backup, la segunda espera a que termine la primera y siempre sube el
  // db.json más reciente en disco — nunca puede "ganar" una subida vieja que
  // tardó más en red y pisar con datos desactualizados una más nueva.
  _backupFirebaseChain = _backupFirebaseChain.then(() =>
    firebaseBackup.backupDBAFirebase(DB_FILE)
      .then(ok => { if (ok) { _backupFirebasePendiente = false; console.log('✓ Backup de db.json subido a Firebase Storage.'); } })
      .catch(e => console.warn('⚠ No se pudo subir el backup de db.json a Firebase Storage:', e.message))
  );
  return _backupFirebaseChain;
}

/* systemd (con `systemctl stop`/`restart malevo`, o cualquier otro
 * supervisor de procesos) manda SIGTERM antes de matar el proceso. Si
 * justo hay un backup pendiente (dentro de la ventana de
 * debounce de 4s de arriba), sin este hook ese último cambio se perdería
 * — se sube local pero nunca llega a Storage antes de que el proceso
 * termine. Al recibir la señal, si hay algo pendiente lo subimos ya
 * mismo (sin esperar el debounce) y solo entonces cerramos; con un tope
 * de 8s por si Firebase no responde, para no colgar el apagado. */
function _apagarConGracia(señal) {
  if (!_backupFirebasePendiente) { process.exit(0); return; }
  console.log('… '+señal+' recibido con un backup pendiente — subiendo a Firebase Storage antes de apagar.');
  const limite = new Promise(resolve => setTimeout(resolve, 8000));
  Promise.race([_ejecutarBackupFirebase(), limite]).finally(() => process.exit(0));
}
process.on('SIGTERM', () => _apagarConGracia('SIGTERM'));
process.on('SIGINT',  () => _apagarConGracia('SIGINT'));

/* ---------- Contraseñas (PBKDF2) ---------- */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}
function checkPassword(plain, stored) {
  const [salt, hash] = stored.split(':');
  const h = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return timingSafeEq(h, hash);
}

/* ---------- UUIDs ---------- */
function uuid() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>
    (c^crypto.randomBytes(1)[0]&15>>c/4).toString(16));
}

// Inicializa el módulo de Stripe con acceso a la base de datos. Si falta
// STRIPE_SECRET_KEY o el paquete "stripe" no está instalado, queda en modo
// "no configurado" (ver comentario al inicio de stripe-billing.js).
const _stripeConfigurado = stripeBilling.initStripe({ readDB, writeDB, uuid });

/* ══════════════════════════════════════════════════════════════════════
   WEB PUSH (notificaciones push reales) — implementación propia con el
   módulo "crypto" nativo de Node, SIN depender de la librería "web-push"
   de npm (este entorno no tiene acceso al registro de npm). Sigue:
     · RFC 8291 — cifrado del payload (esquema "aes128gcm")
     · RFC 8292 — autenticación VAPID (JWT firmado ES256)
   Las claves VAPID se generan una sola vez y se persisten en
   data/vapid.json: si cambiaran, las suscripciones ya guardadas por los
   alumnos (creadas en su navegador con la clave pública anterior) dejan
   de servir y habría que resuscribirlos.
   ══════════════════════════════════════════════════════════════════════ */
const VAPID_FILE    = path.join(DATA_DIR, 'vapid.json');
const VAPID_SUBJECT = 'mailto:notificaciones@malevo-academia.app';
let _vapidKeys = null;

function obtenerVapidKeys() {
  if (_vapidKeys) return _vapidKeys;
  if (fs.existsSync(VAPID_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE,'utf8'));
      if (saved && saved.publicKeyB64 && saved.privateKeyPem) {
        _vapidKeys = {
          publicKeyRaw: Buffer.from(saved.publicKeyB64,'base64url'),
          publicKeyB64: saved.publicKeyB64,
          privateKeyPem: saved.privateKeyPem
        };
        return _vapidKeys;
      }
    } catch {}
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve:'prime256v1' });
  const jwk = publicKey.export({format:'jwk'});
  const publicKeyRaw = Buffer.concat([
    Buffer.from([0x04]), Buffer.from(jwk.x,'base64url'), Buffer.from(jwk.y,'base64url')
  ]);
  const privateKeyPem = privateKey.export({format:'pem', type:'pkcs8'});
  const publicKeyB64  = publicKeyRaw.toString('base64url');
  _vapidKeys = { publicKeyRaw, publicKeyB64, privateKeyPem };
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
    fs.writeFileSync(VAPID_FILE, JSON.stringify({ publicKeyB64, privateKeyPem }, null, 2));
  } catch {}
  return _vapidKeys;
}

function _hmacSha256(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest(); }
// HKDF-Expand simplificado a un único bloque (válido porque aquí siempre
// pedimos <=32 bytes, el tamaño del hash usado).
function _hkdfExpand(prk, info, len) {
  return _hmacSha256(prk, Buffer.concat([info, Buffer.from([1])])).slice(0, len);
}

/* Firma un JWT ES256 (formato "raw" r||s de 64 bytes, no DER) para VAPID. */
function crearVapidJWT(endpointUrl, vapidKeys) {
  const aud = new URL(endpointUrl).origin;
  const header  = b64url(JSON.stringify({ typ:'JWT', alg:'ES256' }));
  const claims  = b64url(JSON.stringify({
    aud, exp: Math.floor(Date.now()/1000) + 12*3600, sub: VAPID_SUBJECT
  }));
  const signingInput = header + '.' + claims;
  const privateKey = crypto.createPrivateKey(vapidKeys.privateKeyPem);
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding:'ieee-p1363' });
  return signingInput + '.' + b64url(sig);
}

/* Cifra el payload según RFC 8291 (aes128gcm) para una suscripción push
   concreta (p256dh/auth vienen del navegador del alumno). */
function cifrarPayloadWebPush(payloadBuf, p256dhB64, authB64) {
  const uaPublicRaw = Buffer.from(p256dhB64, 'base64url');
  const authSecret  = Buffer.from(authB64, 'base64url');

  const asECDH = crypto.createECDH('prime256v1');
  asECDH.generateKeys();
  const asPublicRaw = asECDH.getPublicKey();
  const ecdhSecret  = asECDH.computeSecret(uaPublicRaw);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublicRaw, asPublicRaw]);
  const prkKey  = _hmacSha256(authSecret, ecdhSecret);
  const ikm     = _hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const prk  = _hmacSha256(salt, ikm);
  const cek   = _hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = _hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  const record = Buffer.concat([payloadBuf, Buffer.from([0x02])]); // 0x02 = único/último registro
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct  = Buffer.concat([cipher.update(record), cipher.final()]);
  const ciphertext = Buffer.concat([ct, cipher.getAuthTag()]);

  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0); // "record size" — solo un límite superior, el registro real puede ser más corto
  const header = Buffer.concat([salt, rsBuf, Buffer.from([asPublicRaw.length]), asPublicRaw]);
  return Buffer.concat([header, ciphertext]);
}

/* Envía una notificación push a UNA suscripción. Rechaza con
   {statusCode} si el servicio push responde con error (404/410 = la
   suscripción ya no existe y debe eliminarse). */
function enviarWebPush(subscription, payloadObj, vapidKeys) {
  return new Promise((resolve, reject) => {
    try {
      const payloadBuf  = Buffer.from(JSON.stringify(payloadObj));
      const cuerpo      = cifrarPayloadWebPush(payloadBuf, subscription.keys.p256dh, subscription.keys.auth);
      const jwt         = crearVapidJWT(subscription.endpoint, vapidKeys);
      const endpointUrl = new URL(subscription.endpoint);
      const reqOpts = {
        method: 'POST',
        hostname: endpointUrl.hostname,
        port: endpointUrl.port || 443,
        path: endpointUrl.pathname + (endpointUrl.search || ''),
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'Content-Length': cuerpo.length,
          'TTL': '86400',
          'Authorization': `vapid t=${jwt}, k=${vapidKeys.publicKeyB64}`
        }
      };
      const r = https.request(reqOpts, resp => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) resolve({ok:true});
          else reject({ statusCode: resp.statusCode, body: Buffer.concat(chunks).toString() });
        });
      });
      r.on('error', reject);
      r.write(cuerpo);
      r.end();
    } catch (e) { reject(e); }
  });
}

/* ---------- Utilidades HTTP ---------- */
function json(res, code, obj, extra) {
  const h = Object.assign({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, extra||{});
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise(resolve=>{
    let b='';
    req.on('data',c=>{ b+=c; if(b.length>10e6) req.destroy(); });
    req.on('end',()=>resolve(b));
  });
}
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  // La raíz sirve el Panel de Administrador directamente (en localhost,
  // el auto-login de admin entra sin pedir credenciales — ver dev-auto-login).
  if (rel === '/') rel = '/index.html';
  const fp = path.normalize(path.join(ROOT, rel));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err,data)=>{
    if (err) { res.writeHead(404,{'Cache-Control':'no-store'}); return res.end('Not found'); }
    const ext = path.extname(fp).toLowerCase();
    const ct  = MIME[ext] || 'application/octet-stream';
    // bloqueamos descarga directa de vídeos sin token
    if (['.mp4','.webm','.m4v'].includes(ext)) {
      const u = getUser(req);
      if (!u) { res.writeHead(401); return res.end('Unauthorized'); }
    }
    // Sin caché: esto es una app en desarrollo local — si un archivo (foto,
    // logo, Rachas.png, etc.) cambia o se agrega recién, algunos navegadores
    // (sobre todo Safari/Chrome de celular) pueden quedarse con una versión
    // vieja o un 404 en caché y el archivo nuevo "no aparece" hasta borrar
    // caché a mano. Evitamos esa clase entera de bug.
    res.writeHead(200,{'Content-Type':ct,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(data);
  });
}

/* ---------- Middleware RBAC ---------- */
const FINANCE_ROUTES = ['/api/payments','/api/db','/api/reports','/api/config'];
function isFinanceRoute(url) {
  return FINANCE_ROUTES.some(r => url === r || url.startsWith(r+'/'));
}
function requireRole(roles) {
  return (req, res) => {
    const u = getUser(req);
    if (!u) { json(res,401,{ok:false,error:'No autenticado'}); return false; }
    if (!roles.includes(u.role)) {
      // HTTP 403 inmediato para profesores que intentan acceder a finanzas
      json(res,403,{ok:false,error:'Acceso denegado'}); return false;
    }
    req._user = u;
    return true;
  };
}
function authAny(req, res) {
  const u = getUser(req);
  if (!u) { json(res,401,{ok:false,error:'No autenticado'}); return false; }
  req._user = u;
  // Bloqueo estricto: profesores nunca tocan rutas financieras
  if (u.role === 'teacher' && isFinanceRoute(req.url.split('?')[0])) {
    json(res,403,{ok:false,error:'Acceso denegado: área financiera'}); return false;
  }
  // Bloqueo: usuarios con cuenta inactiva (pago pendiente) no acceden a contenido
  if (u.role === 'student') {
    const db_ = readDB();
    const userRec = db_.users.find(x=>x.id===u.sub);
    if (userRec && !userRec.active) {
      json(res,402,{ok:false,error:'Cuenta pendiente de activación. Completa el pago.'}); return false;
    }
  }
  return true;
}
// Igual que authAny, pero SIN bloquear a los alumnos con pago pendiente
// (active:false). Se usa solo en las rutas que un alumno recién
// registrado necesita alcanzar para completar su primer pago por Stripe
// (guardar datos fiscales + crear la Checkout Session + consultar su
// estado): con authAny() normal quedarían atrapados en un bucle
// imposible — bloqueados por no haber pagado, pero sin forma de llegar
// al pago porque esas mismas rutas están bloqueadas. El resto de rutas
// de contenido (clases, perfil, vídeos…) siguen usando authAny estricto.
function authAnyPendiente(req, res) {
  const u = getUser(req);
  if (!u) { json(res,401,{ok:false,error:'No autenticado'}); return false; }
  req._user = u;
  if (u.role === 'teacher' && isFinanceRoute(req.url.split('?')[0])) {
    json(res,403,{ok:false,error:'Acceso denegado: área financiera'}); return false;
  }
  return true;
}

/* ---------- Lógica de niveles: selección libre e independiente ---------- */
// Recibe el conjunto EXACTO de niveles (números) que el alumno debe tener
// desbloqueados para una disciplina. No es acumulativo: marcar solo el
// nivel 3 no desbloquea el 1 ni el 2. Los niveles que ya no estén en el
// conjunto se revocan (status:'paused') si el alumno los tenía antes.
function unlockLevels(db, userId, disciplina, niveles) {
  const nivelesSet = new Set((niveles||[]).map(Number).filter(n=>!isNaN(n)));
  const clases = db.classes.filter(c => c.estilo === disciplina && c.hasVideo);
  clases.forEach(c => {
    const nivelNum = c.nivelNum || 0;
    const existing = db.enrollments.find(e => e.userId===userId && e.classId===c.id);
    if (nivelesSet.has(nivelNum)) {
      if (!existing) {
        db.enrollments.push({
          id: uuid(), userId, classId: c.id,
          nivelMax: nivelNum, status:'active', fechaAlta: new Date().toISOString().slice(0,10)
        });
      } else {
        existing.nivelMax = nivelNum;
        existing.status = 'active';
      }
    } else if (existing && existing.status==='active') {
      existing.status = 'paused';
    }
  });
}

/* ══════════════════════════════════════════════
   GENERACIÓN DE PDF CON PDFKIT
══════════════════════════════════════════════ */
function generarPDFFactura(p, db) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const doc = new PDFDoc({ size: 'A4', margin: 50, bufferPages: true });
      doc.on('data',  d   => chunks.push(d));
      doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const c       = db.config;
      const neg     = c.negocio || {};
      const ivaRate = c.iva ?? 21;
      const base    = p.importe / (1 + ivaRate / 100);
      const ivaAmt  = p.importe - base;
      const f = x  => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' EUR';

      const u       = (db.users||[]).find(x => x.id === p.userId);
      const numT    = p.numeroTicket ? 'T-' + String(p.numeroTicket).padStart(5,'0') : '---';
      const fechaStr = new Date((p.fechaPago || new Date().toISOString().slice(0,10)) + 'T12:00:00')
        .toLocaleDateString('es-ES', {day:'numeric', month:'long', year:'numeric'});
      const mesStr  = p.mes
        ? new Date(p.mes+'-01T00:00:00').toLocaleDateString('es-ES',{month:'long',year:'numeric'})
        : '';
      const PLAN_LABELS = {
        suelta:'Clase suelta', '35':'Tarifa 1 clase/semana',
        '50':'Tarifa 2 clases/semana', '80':'Tarifa VIP / Full Pass', bono:'Bono 5 clases'
      };
      const planLabel = (u && PLAN_LABELS[u.plan]) ? PLAN_LABELS[u.plan] : 'Servicio de clases de baile';
      // Limpiar emojis del concepto y campos de texto
      const limpiar = s => (s||'').replace(/[^\x00-\x7FÀ-ÿ\u00C0-\u017E]/g, '').trim();
      const concepto      = limpiar(p.notas || (mesStr ? `${planLabel} - ${mesStr}` : 'Clase de baile'));
      const clienteNombre = limpiar((u && p.userId !== '__anonimo__') ? (u.nombre||'---') : 'Publico en general');
      const nombreAcademia= limpiar(neg.nombre || 'Academia de Baile Malevo');
      const pieTexto      = limpiar(neg.pie || 'Gracias por bailar con nosotros');

      const ORO   = '#c9a84c';
      const GRIS  = '#666666';
      const NEGRO = '#1a1a1a';
      const W     = 495;

      // ── Logo ────────────────────────────────────────────────────────────
      if (neg.logo && neg.logo.startsWith('data:image/')) {
        try {
          const comma = neg.logo.indexOf(',');
          const buf   = Buffer.from(neg.logo.slice(comma+1), 'base64');
          doc.image(buf, 50, 50, { fit:[120,60] });
        } catch(e) { /* logo inválido, ignorar */ }
      }

      // ── Cabecera emisor ──────────────────────────────────────────────────
      const hdrX = 270;
      doc.fontSize(11).fillColor(NEGRO).font('Helvetica-Bold')
         .text(nombreAcademia, hdrX, 50, {width: W - (hdrX-50)});
      doc.fontSize(9).fillColor(GRIS).font('Helvetica');
      let hy = 65;
      if (neg.nif)       { doc.text('NIF: ' + limpiar(neg.nif),       hdrX, hy, {width: W-(hdrX-50)}); hy += 13; }
      if (neg.direccion) { doc.text(limpiar(neg.direccion),             hdrX, hy, {width: W-(hdrX-50)}); hy += 13; }
      if (neg.telefono)  { doc.text('Tel: ' + limpiar(neg.telefono),   hdrX, hy, {width: W-(hdrX-50)}); hy += 13; }
      if (neg.email)     { doc.text(limpiar(neg.email),                 hdrX, hy, {width: W-(hdrX-50)}); }

      // ── Línea dorada ────────────────────────────────────────────────────
      doc.moveTo(50, 125).lineTo(545, 125).lineWidth(2).strokeColor(ORO).stroke();

      // ── Número y fecha ───────────────────────────────────────────────────
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('FACTURA SIMPLIFICADA', 50, 138);
      doc.fontSize(22).fillColor(ORO).font('Helvetica-Bold')
         .text(numT, 50, 150);
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
         .text(fechaStr, 50, 176);

      // ── Cliente ──────────────────────────────────────────────────────────
      // Altura dinámica: la caja crece según cuántas líneas de datos del
      // cliente haya realmente (NIF/dirección fiscal son nuevos y no todos
      // los pagos antiguos los tienen), para que nunca se corten ni
      // choquen con la tabla de abajo.
      const clienteLineas = [
        u?.facturacion?.nifDniNie ? ('NIF/DNI/NIE: ' + limpiar(u.facturacion.nifDniNie)) : null,
        u?.facturacion?.direccionFiscal ? limpiar(u.facturacion.direccionFiscal) : null,
        u?.email ? ('Email: ' + limpiar(u.email)) : null,
        u?.telefono ? ('Tel: ' + limpiar(u.telefono)) : null
      ].filter(Boolean);
      const clienteBoxH = 38 + clienteLineas.length * 13;
      doc.rect(50, 200, W, clienteBoxH).fill('#f8f7f4');
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('CLIENTE', 64, 210);
      doc.fontSize(13).fillColor(NEGRO).font('Helvetica-Bold')
         .text(clienteNombre, 64, 222);
      let cy = 238;
      clienteLineas.forEach(linea=>{
        doc.fontSize(9).fillColor(GRIS).font('Helvetica').text(linea, 64, cy, {width:W-28});
        cy += 13;
      });

      // ── Tabla concepto ───────────────────────────────────────────────────
      const tY = 200 + clienteBoxH + 19;
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('DESCRIPCION',  50,  tY, {width:280})
         .text('BASE IMP.',   340,  tY, {width:70,  align:'right'})
         .text('IVA ('+ivaRate+'%)', 415, tY, {width:60, align:'right'})
         .text('TOTAL',       478,  tY, {width:67,  align:'right'});
      doc.moveTo(50, tY+14).lineTo(545, tY+14).lineWidth(0.5).strokeColor('#e0e0e0').stroke();

      const rY = tY + 22;
      doc.fontSize(11).fillColor(NEGRO).font('Helvetica')
         .text(concepto,      50,  rY, {width:280})
         .text(f(base),      340,  rY, {width:70,  align:'right'})
         .text(f(ivaAmt),    415,  rY, {width:60,  align:'right'})
         .text(f(p.importe), 478,  rY, {width:67,  align:'right'});

      // ── Total ────────────────────────────────────────────────────────────
      const totY = rY + 40;
      doc.moveTo(300, totY).lineTo(545, totY).lineWidth(2).strokeColor(ORO).stroke();
      doc.fontSize(10).fillColor(GRIS).font('Helvetica')
         .text('Total a pagar', 300, totY+8, {width:170});
      doc.fontSize(18).fillColor(ORO).font('Helvetica-Bold')
         .text(f(p.importe), 400, totY+5, {width:145, align:'right'});
      if (p.metodo) {
        doc.fontSize(9).fillColor(GRIS).font('Helvetica')
           .text('Metodo de pago: ' + limpiar(p.metodo), 50, totY+10);
      }

      // ── Pie ──────────────────────────────────────────────────────────────
      const pieY = 750;
      doc.moveTo(50, pieY).lineTo(545, pieY).lineWidth(0.5).strokeColor('#dddddd').dash(3,{space:3}).stroke();
      doc.undash();
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
         .text(pieTexto, 50, pieY+8, {width:W, align:'center'});
      if (neg.nif) {
        doc.fontSize(8).fillColor(GRIS).font('Helvetica')
           .text('NIF emisor: ' + limpiar(neg.nif), 50, pieY+22, {width:W, align:'center'});
      }

      doc.end();
    } catch(err) {
      reject(err);
    }
  });
}

/* ══════════════════════════════════════════════
   PDF RESUMEN / INFORME (lista de facturas)
══════════════════════════════════════════════ */
function generarPDFResumen(pagos, db, titulo) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const doc    = new PDFDoc({ size:'A4', margin:50, bufferPages:true });
      doc.on('data',  d   => chunks.push(d));
      doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const c       = db.config;
      const neg     = c.negocio || {};
      const ivaRate = c.iva ?? 21;
      const f = x  => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' EUR';
      const limpiar = s => (s||'').replace(/[^\x00-\x7FÀ-ÿ\u00C0-\u017E]/g,'').trim();
      const fechaHoy = new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});

      const ORO  = '#c9a84c';
      const GRIS = '#666666';
      const NEGRO= '#1a1a1a';
      const W    = 495;

      // ── Logo ──────────────────────────────────────────────────────────
      if (neg.logo && neg.logo.startsWith('data:image/')) {
        try {
          const buf = Buffer.from(neg.logo.slice(neg.logo.indexOf(',')+1), 'base64');
          doc.image(buf, 50, 50, { fit:[100,50] });
        } catch {}
      }

      // ── Cabecera ──────────────────────────────────────────────────────
      doc.fontSize(11).fillColor(NEGRO).font('Helvetica-Bold')
         .text(limpiar(neg.nombre||'Academia de Baile Malevo'), 270, 50, {width:275});
      doc.fontSize(9).fillColor(GRIS).font('Helvetica');
      let hy = 65;
      if (neg.nif)       { doc.text('NIF: '+limpiar(neg.nif),     270, hy, {width:275}); hy+=12; }
      if (neg.direccion) { doc.text(limpiar(neg.direccion),         270, hy, {width:275}); hy+=12; }
      if (neg.telefono)  { doc.text('Tel: '+limpiar(neg.telefono), 270, hy, {width:275}); }

      doc.moveTo(50,125).lineTo(545,125).lineWidth(2).strokeColor(ORO).stroke();

      doc.fontSize(16).fillColor(NEGRO).font('Helvetica-Bold')
         .text(limpiar(titulo), 50, 138, {width:W});
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
         .text('Generado el '+fechaHoy, 50, 160);

      // ── Cabecera tabla ────────────────────────────────────────────────
      let y = 185;
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('N. FACTURA', 50,  y, {width:80})
         .text('CLIENTE',   135,  y, {width:155})
         .text('MES',       295,  y, {width:70})
         .text('BASE',      368,  y, {width:60, align:'right'})
         .text('IVA',       430,  y, {width:50, align:'right'})
         .text('TOTAL',     482,  y, {width:63, align:'right'});
      y += 13;
      doc.moveTo(50,y).lineTo(545,y).lineWidth(0.5).strokeColor('#e0e0e0').stroke();
      y += 6;

      let totBase=0, totIva=0, totTotal=0;

      pagos.forEach(p => {
        const u      = (db.users||[]).find(x=>x.id===p.userId);
        const numT   = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : '---';
        const nombre = limpiar(p.simplificada ? (p.notas||'Anonimo') : (u?.nombre||'---'));
        const mesLbl = p.mes
          ? new Date(p.mes+'-01T00:00:00').toLocaleDateString('es-ES',{month:'short',year:'2-digit'})
          : '---';
        const base   = p.importe/(1+ivaRate/100);
        const iva    = p.importe - base;
        totBase  += base; totIva += iva; totTotal += p.importe;

        // nueva página si no hay espacio
        if (y > 760) { doc.addPage(); y = 60; }

        doc.fontSize(9).fillColor(NEGRO).font('Helvetica')
           .text(numT,        50,  y, {width:80})
           .text(nombre,     135,  y, {width:155, ellipsis:true})
           .text(mesLbl,     295,  y, {width:70})
           .text(f(base),    368,  y, {width:60,  align:'right'})
           .text(f(iva),     430,  y, {width:50,  align:'right'})
           .text(f(p.importe),482, y, {width:63,  align:'right'});
        y += 16;
        doc.moveTo(50,y-3).lineTo(545,y-3).lineWidth(0.3).strokeColor('#f0f0f0').stroke();
      });

      // ── Totales ───────────────────────────────────────────────────────
      if (y > 730) { doc.addPage(); y = 60; }
      y += 6;
      doc.moveTo(50,y).lineTo(545,y).lineWidth(2).strokeColor(ORO).stroke();
      y += 8;
      doc.fontSize(10).fillColor(NEGRO).font('Helvetica-Bold')
         .text('TOTAL  ('+pagos.length+' facturas)', 50, y, {width:310});
      doc.fontSize(11).fillColor(ORO).font('Helvetica-Bold')
         .text(f(totBase),   368, y, {width:60,  align:'right'})
         .text(f(totIva),    430, y, {width:50,  align:'right'})
         .text(f(totTotal),  482, y, {width:63,  align:'right'});

      // ── Pie ───────────────────────────────────────────────────────────
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
         .text('Documento generado por '+limpiar(neg.nombre||'Academia Malevo')+
               (neg.nif?' · NIF: '+limpiar(neg.nif):''),
               50, 790, {width:W, align:'center'});

      doc.end();
    } catch(err) { reject(err); }
  });
}

/* ══════════════════════════════════════════════
   SERVIDOR PRINCIPAL
══════════════════════════════════════════════ */
const server = http.createServer(async (req, res) => {
  const url    = req.url.split('?')[0];
  const method = req.method;

  // CORS básico para desarrollo local
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('X-Content-Type-Options','nosniff');

  // GET /c/:token — alias corto de curso-acceso.html?t=:token, para que el
  // link compartido por WhatsApp sea lo más corto posible. A diferencia de
  // un simple 302, esta ruta devuelve una páginita HTML propia (200) con
  // etiquetas Open Graph armadas con el nombre y la portada del curso real
  // (resueltos acá mismo a partir del token) — así, cuando WhatsApp genera
  // la tarjeta de vista previa del link, lee ESTAS etiquetas (el rastreador
  // de WhatsApp no ejecuta JavaScript, así que ve justo este HTML) y arma
  // una tarjeta con el curso en vez del dominio pelado. Para una persona
  // real, el <script> de esta misma página redirige de inmediato a
  // curso-acceso.html?t=..., que es donde sigue viviendo toda la lógica de
  // validación/canje — acá no se valida nada más que para elegir qué
  // mostrar en la tarjeta.
  {
    const mCorto = url.match(/^\/c\/([A-Za-z0-9_-]+)$/);
    if (mCorto && method === 'GET') {
      const tokenVal = mCorto[1];
      const destino = `/curso-acceso.html?t=${encodeURIComponent(tokenVal)}`;
      const db = readDB();
      const t = (db.tokensCursoExterno||[]).find(x=>x.token===tokenVal);
      const curso = (t && !t.invalidado && !t.usado) ? (db.cursos||[]).find(c=>c.id===t.cursoId) : null;

      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;

      const ogTitulo  = curso ? `Curso: ${curso.nombre} — Malevo Academia` : 'Malevo Academia · Tu acceso';
      const ogDesc    = curso ? `Tocá para desbloquear tu clase de ${curso.nombre}. Enlace de un solo uso.` : 'Enlace de acceso a tu curso — Malevo Academia.';
      const ogImagen  = (curso && curso.imagenPortada) ? curso.imagenPortada : `${base}/assets/malevo-logo-real.png`;

      // Los datos del curso vienen de nuestra propia base (los carga el
      // admin al crear el curso), no de un input externo — igual se
      // escapan por prolijidad antes de insertarlos en atributos HTML.
      const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>${esc(ogTitulo)}</title>
<meta property="og:title" content="${esc(ogTitulo)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImagen)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(base + '/c/' + tokenVal)}">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=${esc(destino)}">
<script>location.replace(${JSON.stringify(destino)});</script>
</head><body>Redirigiendo a tu curso…</body></html>`;

      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      return res.end(html);
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (url === '/api/login' && method === 'POST') {
    try {
      const { username, password } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      // FIX: antes se comparaba el username con timingSafeEq() de forma
      // exacta (mayúsculas/minúsculas incluidas), así que si el usuario
      // tecleaba "gimena" y en la base estaba guardado "Gimena" (o
      // viceversa), la búsqueda fallaba en silencio y devolvía
      // "credenciales incorrectas" aunque la contraseña fuera perfecta.
      // El username no es un secreto (no hace falta comparación de tiempo
      // constante para él, solo para el hash de la contraseña vía
      // checkPassword), así que ahora se normaliza a minúsculas y se
      // recorta espacios antes de comparar.
      const usernameNormalizado = (username||'').trim().toLowerCase();
      const user = db.users.find(u => (u.username||'').trim().toLowerCase() === usernameNormalizado);
      if (!user) {
        console.warn(`[login] usuario no encontrado: "${username}"`);
        return json(res,401,{ok:false,error:'Credenciales incorrectas'});
      }
      if (!user.active) {
        console.warn(`[login] usuario "${user.username}" existe pero está inactivo (active:false)`);
        return json(res,401,{ok:false,error:'Credenciales incorrectas'});
      }
      if (!checkPassword(password||'', user.passwordHash)) {
        console.warn(`[login] contraseña incorrecta para "${user.username}"`);
        return json(res,401,{ok:false,error:'Credenciales incorrectas'});
      }
      const token = signJWT({
        sub: user.id, role: user.role, nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,200,{ok:true,token,role:user.role,nombre:user.nombre},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false}); }
  }

  // ── Login passwordless del alumno (Email/Teléfono + código temporal) ──
  if (url === '/api/auth/passwordless/request' && method === 'POST') {
    try {
      const { contacto } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const user = buscarUsuarioPorContacto(db, contacto);
      if (!user || !user.active) {
        return json(res,404,{ok:false,error:'No encontramos una cuenta activa con ese email o teléfono.'});
      }
      const code = generarCodigoAcceso();
      _codigosAcceso.set(user.id, { code, exp: Date.now() + CODIGO_TTL_MS });
      await enviarCodigoAcceso(user, code);
      // Sin un proveedor real de email/SMS conectado todavía (ver
      // enviarCodigoAcceso más arriba), el código se devuelve aquí mismo
      // para que el frontend lo muestre en pantalla ("magic code" simulado)
      // y el alumno pueda entrar sin fricción desde cualquier dispositivo.
      return json(res,200,{ok:true, nombre:user.nombre, code});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  if (url === '/api/auth/passwordless/verify' && method === 'POST') {
    try {
      const { contacto, code } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const user = buscarUsuarioPorContacto(db, contacto);
      if (!user || !user.active) return json(res,404,{ok:false,error:'Cuenta no encontrada.'});
      const pendiente = _codigosAcceso.get(user.id);
      if (!pendiente || pendiente.exp < Date.now() || pendiente.code !== String(code||'').trim()) {
        return json(res,401,{ok:false,error:'Código incorrecto o caducado. Solicita uno nuevo.'});
      }
      _codigosAcceso.delete(user.id);
      const token = signJWT({
        sub: user.id, role: user.role, nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,200,{ok:true, sub:user.id, role:user.role, nombre:user.nombre},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ⚠️  BYPASS DE LOGIN PARA PRUEBAS LOCALES — SOLO ACTIVO EN LOCALHOST
  //     Se activa automáticamente cuando la petición viene de la propia
  //     máquina (127.0.0.1/::1), sin necesidad de ninguna variable de
  //     entorno (ver función esConexionLocal más arriba).
  //     Si este server.js se despliega en un servidor accesible por
  //     internet u otras personas, este bypass queda inactivo solo porque
  //     nadie externo puede conectarse como "localhost". Aun así, es buena
  //     práctica borrar este bloque antes de un despliegue real.
  // ══════════════════════════════════════════════════════════════════════
  if (url === '/api/dev-auto-login' && method === 'POST') {
    if (!esConexionLocal(req)) return json(res,404,{ok:false,error:'No disponible'});
    try {
      const { as } = JSON.parse(await body(req)||'{}'); // 'admin' | 'student'
      const db = readDB();
      const portalPlans = db.config.portalPlans || ['35','50','80'];
      let user;
      if (as === 'student') {
        user = db.users.find(u => u.role==='student' && u.active && (u.portalAccess || portalPlans.includes(u.plan)))
            || db.users.find(u => u.role==='student' && u.active);
      } else {
        user = db.users.find(u => u.role==='admin' && u.active) || db.users.find(u => u.role==='admin');
      }
      if (!user) return json(res,404,{ok:false,error:'No hay ningún usuario de ese tipo en la base de datos local'});
      const token = signJWT({
        sub: user.id, role: user.role, nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      const hasPortalAccess = ['admin','teacher'].includes(user.role) ||
        (portalPlans.includes(user.plan) || user.portalAccess===true);
      return json(res,200,{ok:true,role:user.role,nombre:user.nombre,sub:user.id,hasPortalAccess},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false}); }
  }

  if (url === '/api/logout' && method === 'POST') {
    return json(res,200,{ok:true},{'Set-Cookie':`malevo_jwt=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${cookieSecureFlag(req)}`});
  }

  if (url === '/api/me') {
    const u = getUser(req);
    if (!u) return json(res,401,{ok:false});
    // Incluir flag de acceso al portal según el plan del usuario
    const db_ = readDB();
    const userRec = db_.users.find(x=>x.id===u.sub);
    const portalPlans = db_.config.portalPlans || ['35','50','80'];
    const hasPortalAccess = ['admin','teacher'].includes(u.role) ||
      (userRec && (portalPlans.includes(userRec.plan) || userRec.portalAccess===true));
    return json(res,200,{ok:true,role:u.role,nombre:u.nombre,sub:u.sub,hasPortalAccess});
  }

  // ── Restablecer contraseña de un admin/profesor (solo un admin ya
  //    autenticado puede hacerlo) ─────────────────────────────────────────
  // Pensado para casos como "Gimena no puede entrar y no hay forma de
  // recuperar la contraseña por email/SMS": Gaston (o cualquier otro admin
  // que sí pueda entrar) entra al panel y le pone una contraseña nueva a
  // Gimena desde la propia interfaz, sin tocar la base de datos a mano.
  if (url === '/api/admin/reset-password' && method === 'POST') {
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const { username, newPassword } = JSON.parse(await body(req)||'{}');
      if (!username || !newPassword || String(newPassword).length < 6) {
        return json(res,400,{ok:false,error:'Falta el usuario o la contraseña debe tener al menos 6 caracteres'});
      }
      const db = readDB();
      const buscado = String(username).trim().toLowerCase();
      const user = db.users.find(u => (u.username||'').trim().toLowerCase() === buscado);
      if (!user) return json(res,404,{ok:false,error:'No existe ningún usuario con ese nombre de usuario'});
      if (!['admin','teacher'].includes(user.role)) {
        return json(res,400,{ok:false,error:'Esta herramienta solo restablece contraseñas de administradores o profesores'});
      }
      user.passwordHash = hashPassword(newPassword);
      db._rev++;
      writeDB(db);
      console.log(`[admin] ${req._user.nombre} restableció la contraseña de "${user.username}"`);
      return json(res,200,{ok:true});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Setup inicial (solo si no hay usuarios) ────────────────────────────────
  if (url === '/api/setup' && method === 'POST') {
    const db = readDB();
    if (db.users.length > 0) return json(res,403,{ok:false,error:'Ya configurado'});
    try {
      const { username, password, nombre } = JSON.parse(await body(req)||'{}');
      if (!username||!password) return json(res,400,{ok:false,error:'Faltan datos'});
      db.users.push({
        id: uuid(), username, passwordHash: hashPassword(password),
        role:'admin', nombre: nombre||username, email:'', active:true
      });
      db._rev++;
      writeDB(db);
      return json(res,200,{ok:true});
    } catch(e) { return json(res,400,{ok:false}); }
  }

  // ── DB completa (solo admin) ───────────────────────────────────────────────
  if (url === '/api/db') {
    if (!requireRole(['admin'])(req,res)) return;
    if (method === 'GET') return json(res,200,readDB());
    if (method === 'PUT' || method === 'POST') {
      try {
        const nuevo = JSON.parse(await body(req));
        const actual = readDB();
        nuevo._rev = (actual._rev||0)+1;
        writeDB(nuevo);
        return json(res,200,{ok:true,_rev:nuevo._rev});
      } catch { return json(res,400,{ok:false,error:'JSON inválido'}); }
    }
    res.writeHead(405); return res.end('Method Not Allowed');
  }

  // ── Config (admin) ─────────────────────────────────────────────────────────
  if (url === '/api/config') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    if (method === 'GET') return json(res,200,db.config);
    if (method === 'PUT') {
      try {
        db.config = JSON.parse(await body(req));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
  }

  // ── Usuarios (admin) ───────────────────────────────────────────────────────
  if (url === '/api/users' && method === 'GET') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const safe = db.users.map(({passwordHash,...u})=>u);
    return json(res,200,safe);
  }
  if (url === '/api/users' && method === 'POST') {
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const db = readDB();
      const { username, password, role, nombre, email, telefono,
              guestCourtesy, cashOnly, portalAccess, facturaEnvio, plan } = JSON.parse(await body(req)||'{}');
      if (!nombre) return json(res,400,{ok:false,error:'El nombre es obligatorio'});
      // Generar username automático si no se aporta
      const usernameVal = (username||'').trim() ||
        'alumno_' + (nombre||'').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .replace(/[^a-z0-9]/g,'_').slice(0,20) +
        '_' + Date.now().toString(36).slice(-4);
      if (db.users.find(u=>u.username===usernameVal))
        return json(res,409,{ok:false,error:'Nombre de usuario ya existe, prueba otro'});
      // Contraseña aleatoria si no se aporta (el alumno entrará vía enlace/Google)
      const passVal = (password||'').trim() || crypto.randomBytes(16).toString('hex');
      const user = {
        id:uuid(), username:usernameVal, passwordHash:hashPassword(passVal),
        role:role||'student', nombre:nombre||usernameVal,
        email:email||'', telefono:telefono||'',
        active:true,
        plan: plan||'35',
        guestCourtesy: !!guestCourtesy,
        cashOnly: !!cashOnly,
        portalAccess: !!portalAccess,
        facturaEnvio: facturaEnvio||'none',
        referralCode: uuid().slice(0,8),
        profileComplete: false
      };
      db.users.push(user);
      db._rev++; writeDB(db);
      const {passwordHash,...safe} = user;
      return json(res,201,{ok:true,user:safe});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  const userIdMatch = url.match(/^\/api\/users\/([a-z0-9-]+)$/);
  if (userIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const uid_ = userIdMatch[1];
    const idx  = db.users.findIndex(u=>u.id===uid_);
    if (idx===-1) return json(res,404,{ok:false,error:'No encontrado'});
    if (method==='PUT') {
      try {
        const upd = JSON.parse(await body(req)||'{}');
        if (upd.password) { db.users[idx].passwordHash = hashPassword(upd.password); delete upd.password; }
        // Campos permitidos para actualización
        const allowed = ['nombre','username','email','telefono','role','plan','active',
          'cashOnly','guestCourtesy','portalAccess','facturaEnvio',
          'nivelBachata','nivelSalsa','rol','assignedClasses','bio','profileComplete','fotoPerfil',
          'cursosAsignados','cursosVencimientos'];
        allowed.forEach(k=>{ if(upd[k]!==undefined) db.users[idx][k]=upd[k]; });
        db._rev++; writeDB(db);
        const {passwordHash,...safe}=db.users[idx];
        return json(res,200,{ok:true,user:safe});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      // Borrado permanente y en cascada: además del propio usuario, limpia
      // cualquier inscripción/asistencia/pago que quedara referenciando su
      // id, para que una cuenta de prueba no deje rastro huérfano en el
      // resto de la base de datos (a diferencia de "archivar", que es
      // reversible y conserva todo esto a propósito).
      db.users.splice(idx,1);
      if (Array.isArray(db.enrollments))  db.enrollments  = db.enrollments.filter(e=>e.userId!==uid_);
      if (Array.isArray(db.attendances))  db.attendances  = db.attendances.filter(a=>a.userId!==uid_);
      if (Array.isArray(db.payments))     db.payments     = db.payments.filter(p=>p.userId!==uid_);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ── Clases (admin/teacher GET, admin POST/PUT/DELETE) ──────────────────────
  if (url === '/api/classes') {
    if (!authAny(req,res)) return;
    const db = readDB();
    if (method==='GET') return json(res,200,db.classes);
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const data = JSON.parse(await body(req)||'{}');
      const c = Object.assign({id:uuid()},data);
      db.classes.push(c);
      db._rev++; writeDB(db);
      return json(res,201,{ok:true,class:c});
    } catch { return json(res,400,{ok:false}); }
  }
  const classIdMatch = url.match(/^\/api\/classes\/([a-z0-9-]+)$/);
  if (classIdMatch) {
    if (!authAny(req,res)) return;
    const db = readDB();
    const cid = classIdMatch[1];
    const idx = db.classes.findIndex(c=>c.id===cid);
    if (idx===-1) return json(res,404,{ok:false,error:'No encontrado'});
    if (method==='GET') return json(res,200,db.classes[idx]);
    if (!requireRole(['admin'])(req,res)) return;
    if (method==='PUT') {
      try {
        Object.assign(db.classes[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true,class:db.classes[idx]});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.classes.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ── Inscripciones (enrollments) ────────────────────────────────────────────
  if (url === '/api/enrollments') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      // Admin/teacher ven todo; alumno/invitado ven solo las suyas
      const list = ['admin','teacher'].includes(u.role)
        ? db.enrollments
        : db.enrollments.filter(e=>e.userId===u.sub);
      return json(res,200,list);
    }
    if (!requireRole(['admin'])(req,res)) return;
    if (method==='POST') {
      try {
        const { userId, disciplina, niveles } = JSON.parse(await body(req)||'{}');
        if (!userId||!disciplina||!Array.isArray(niveles)) return json(res,400,{ok:false,error:'Faltan campos'});
        // Selección libre: desbloquea EXACTAMENTE los niveles indicados y
        // revoca los que ya no estén en la lista.
        unlockLevels(db, userId, disciplina, niveles.map(Number));
        db._rev++; writeDB(db);
        return json(res,201,{ok:true});
      } catch(e) { return json(res,400,{ok:false,error:e.message}); }
    }
  }

  // ── Videos ────────────────────────────────────────────────────────────────
  if (url === '/api/videos') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      if (['admin'].includes(u.role)) return json(res,200,db.videos);
      const userRec = db.users.find(x=>x.id===u.sub);
      if (!userRec) return json(res,403,{ok:false,error:'Usuario no encontrado'});
      // Contenido general del portal (calentamientos y eventos/talleres): no
      // está ligado a ninguna clase/nivel ni al plan del alumno — tiene que
      // verse para CUALQUIER alumno registrado, tenga o no acceso al Aula
      // Virtual (a diferencia de las clases grabadas, que sí son solo para
      // quien pagó el plan VIP/portal). Por eso se calcula ANTES del check
      // de plan de abajo, y nunca depende de él.
      const TIPOS_GENERALES = ['evento','calentamiento'];
      const generales = db.videos.filter(v => TIPOS_GENERALES.includes(v.tipo));
      // Verificar que el plan del usuario tiene acceso al Aula Virtual para
      // el resto del contenido (clases grabadas). Si no lo tiene, sigue
      // viendo lo general de arriba — antes esto devolvía 403 y lo dejaba
      // sin ver ni siquiera los eventos.
      const portalPlans = db.config.portalPlans || ['35','50','80'];
      if (!portalPlans.includes(userRec.plan) && !userRec.portalAccess) {
        return json(res,200,generales);
      }
      // Alumnos/invitados con acceso: además de lo general, solo videos de
      // sus inscripciones activas. Las playlists de Google Drive
      // (tipo:'playlist', origen:'drive') sí están ligadas a una
      // disciplina/nivel real, así que pasan por el filtro normal de
      // inscripción, igual que las clases.
      const enrolled = db.enrollments.filter(e=>e.userId===u.sub && e.status==='active');
      const visible  = db.videos.filter(v=>{
        if (TIPOS_GENERALES.includes(v.tipo)) return true;
        return enrolled.some(e=>{
          const cls = db.classes.find(c=>c.id===e.classId);
          return cls && cls.estilo===v.disciplina && v.nivel===cls.nivelNum;
        });
      });
      return json(res,200,visible);
    }
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const data = JSON.parse(await body(req)||'{}');
      const vid  = Object.assign({id:uuid()},data);
      db.videos.push(vid);
      db._rev++; writeDB(db);
      return json(res,201,{ok:true,video:vid});
    } catch { return json(res,400,{ok:false}); }
  }
  const videoIdMatch = url.match(/^\/api\/videos\/([a-z0-9-]+)$/);
  if (videoIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const vid= videoIdMatch[1];
    const idx= db.videos.findIndex(v=>v.id===vid);
    if (idx===-1) return json(res,404,{ok:false});
    if (method==='PUT') {
      try {
        Object.assign(db.videos[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.videos.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cursos Exclusivos — módulo aparte de "videos"/Aula Virtual: son cursos
  // completos (con su propia lista de vídeos) organizados por ritmo/
  // subcategoría, y el acceso NO depende del plan del alumno sino de si el
  // admin se lo asignó específicamente (user.cursosAsignados). Un alumno
  // sin ningún curso asignado igual ve el catálogo completo (para saber
  // qué existe y pedirlo/comprarlo), pero los cursos no asignados llegan
  // "recortados" — sin imagenPortada/duracion/videos — para no filtrar
  // contenido real de un curso al que no tiene acceso.
  // ══════════════════════════════════════════════════════════════════════
  if (url === '/api/cursos') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      if (['admin','teacher'].includes(u.role)) return json(res,200,db.cursos||[]);
      const userRec = db.users.find(x=>x.id===u.sub);
      const asignados = new Set((userRec && userRec.cursosAsignados) || []);
      const vencimientos = (userRec && userRec.cursosVencimientos) || {};
      // Un curso asignado sin fecha de vencimiento registrada (asignaciones
      // antiguas, previas a la vigencia de 1 año) se sigue considerando
      // vigente; si tiene vencimiento y ya pasó, se trata como sin acceso.
      const vencido = cid => !!vencimientos[cid] && new Date(vencimientos[cid]) < new Date();
      const catalogo = (db.cursos||[]).filter(c=>c.activo!==false).map(c=>{
        const tieneAcceso = asignados.has(c.id) && !vencido(c.id);
        if (tieneAcceso) return Object.assign({}, c, {tieneAcceso:true});
        // Recortado: la portada/nivel/duración SÍ se muestran a todos —
        // son solo metadatos del catálogo, no contenido del curso. Lo único
        // que de verdad hay que ocultar a quien no tiene acceso es la lista
        // de vídeos (eso es lo que el admin asigna alumno por alumno).
        return {id:c.id, nombre:c.nombre, ritmo:c.ritmo, subcategoria:c.subcategoria,
          orden:c.orden, imagenPortada:c.imagenPortada, nivel:c.nivel, duracion:c.duracion,
          tieneAcceso:false};
      });
      return json(res,200,catalogo);
    }
    if (!requireRole(['admin'])(req,res)) return;
    try {
      const data = JSON.parse(await body(req)||'{}');
      const curso = Object.assign({activo:true, videos:[]}, data, {id:uuid()});
      db.cursos.push(curso);
      db._rev++; writeDB(db);
      return json(res,201,{ok:true,curso});
    } catch { return json(res,400,{ok:false}); }
  }
  const cursoIdMatch = url.match(/^\/api\/cursos\/([a-z0-9-]+)$/);
  if (cursoIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db  = readDB();
    const cid = cursoIdMatch[1];
    const idx = db.cursos.findIndex(c=>c.id===cid);
    if (idx===-1) return json(res,404,{ok:false});
    if (method==='PUT') {
      try {
        Object.assign(db.cursos[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.cursos.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // CURSOS EXCLUSIVOS — acceso externo MANUAL (pago en persona/efectivo,
  // sin pasarela online). El admin genera un enlace de UN SOLO USO desde
  // "👥 Alumnos" en el curso (sin pedir ningún dato todavía) y se lo pasa
  // él mismo al comprador (WhatsApp, en mano, etc.). Recién cuando esa
  // persona abre el enlace y completa su nombre+teléfono, el token se
  // "quema" para siempre y el acceso queda registrado sobre una cuenta
  // real de alumno (cursosAsignados + cursosVencimientos), igual que el
  // acceso de un alumno interno — así ambos caminos comparten la misma
  // lógica de vigencia/gating en GET /api/cursos.
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/cursos/:id/accesos-externos — genera un token PENDIENTE (sin
  // datos del comprador todavía: esos se piden recién al canjear el link).
  // Solo puede haber UN token pendiente vivo por curso a la vez: generar
  // uno nuevo invalida automáticamente cualquier enlace anterior sin usar,
  // para no acumular enlaces viejos en el panel de "Alumnos".
  let m = url.match(/^\/api\/cursos\/([a-z0-9-]+)\/accesos-externos$/);
  if (m && method === 'POST') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const curso = (db.cursos||[]).find(c=>c.id===m[1]);
    if (!curso) return json(res,404,{ok:false,error:'Curso no encontrado'});
    db.tokensCursoExterno = db.tokensCursoExterno || [];
    db.tokensCursoExterno
      .filter(t=>t.cursoId===curso.id && !t.usado && !t.invalidado)
      .forEach(t=>{ t.invalidado = true; });
    const tokenRec = {
      id: uuid(),
      cursoId: curso.id,
      // Código corto (8 bytes al azar en base64url ≈ 11 caracteres) en vez
      // del hex de 48 caracteres de antes: el link es de un solo uso, lo
      // reparte el propio admin (WhatsApp/en mano) y se invalida al primer
      // canje, así que no hace falta la entropía de una clave criptográfica
      // de verdad — pero sí conviene que el link entero sea corto, porque
      // WhatsApp (sobre todo en el celular) puede no reconocer como enlace
      // clicable una URL demasiado larga con un token gigante. Alfanumérico
      // puro (ver generarTokenAlfanumerico) para que WhatsApp nunca corte
      // el link en un salto de línea por culpa de un "-" o "_".
      token: generarTokenAlfanumerico(12),
      usado: false,
      invalidado: false,
      fechaGenerado: new Date().toISOString(),
      fechaUsado: null,
      userId: null
    };
    db.tokensCursoExterno.push(tokenRec);
    db._rev++; writeDB(db);

    const host  = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
    // El link solo lleva el token — ni el id del curso ni su nombre viajan
    // en la URL (eso es lo que la hacía larga). curso-acceso.html resuelve
    // todo lo demás (a qué curso corresponde, si sigue vigente, el nombre
    // para mostrar en pantalla) consultando GET /api/publico/token/:token
    // apenas carga la página — ver ese endpoint más abajo.
    // Se usa el alias corto "/c/:token" (redirige 302 a curso-acceso.html
    // más arriba) en vez de "/curso-acceso.html?t=..." para que el link
    // completo ocupe lo mínimo posible al compartirlo por WhatsApp.
    const link  = `${base}/c/${tokenRec.token}`;

    console.log(`[cursos] admin ${req._user.nombre} generó un token de acceso de un solo uso para "${curso.nombre}"`);
    return json(res,201,{ok:true, token:tokenRec, link});
  }

  // GET /api/accesos-cursos?cursoId=X — listar compradores externos (admin):
  // tokens ya canjeados (con la cuenta de alumno que crearon/usaron) y
  // tokens todavía pendientes (para poder reenviar el mismo link o
  // cancelarlo). Los tokens cancelados sin canjear no se listan.
  if (url.startsWith('/api/accesos-cursos') && method === 'GET' && !url.match(/^\/api\/accesos-cursos\/[a-z0-9-]+/)) {
    if (!requireRole(['admin'])(req,res)) return;
    const params = new URL('http://x' + req.url).searchParams;
    const cursoId = params.get('cursoId') || '';
    const db = readDB();
    const host  = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
    const tokens = (db.tokensCursoExterno||[])
      .filter(t=>(!cursoId || t.cursoId===cursoId) && !(t.invalidado && !t.usado));
    const lista = tokens.map(t=>{
      if (t.usado && t.userId) {
        const comprador = (db.users||[]).find(x=>x.id===t.userId);
        const expira = comprador && comprador.cursosVencimientos ? comprador.cursosVencimientos[t.cursoId] : null;
        const activo = !!(comprador && (comprador.cursosAsignados||[]).includes(t.cursoId));
        return {
          id: t.id, cursoId: t.cursoId, estado: activo ? 'activo' : 'revocado',
          nombre: comprador ? comprador.nombre : '(cuenta eliminada)',
          telefono: comprador ? comprador.telefono : '',
          // userId viaja acá para que el admin pueda borrar DEFINITIVAMENTE la
          // cuenta de este comprador desde el propio panel (ver caEliminarComprador
          // en app.js) — antes solo se podía revocar el acceso, no borrar la cuenta.
          userId: t.userId,
          fecha: t.fechaUsado, expira, activo
        };
      }
      return {
        id: t.id, cursoId: t.cursoId, estado: 'pendiente',
        nombre: null, telefono: null, fecha: t.fechaGenerado, expira: null, activo: null,
        link: `${base}/c/${t.token}`
      };
    }).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
    return json(res,200,lista);
  }

  // PUT /api/accesos-cursos/:id — según el estado del token:
  //  · pendiente (nadie lo canjeó): {invalidar:true} lo cancela para que
  //    ese link deje de funcionar (el admin genera uno nuevo si hace falta).
  //  · ya canjeado: {activo:false} revoca el acceso al curso de esa cuenta
  //    (sin borrar la cuenta ni el historial); {activo:true} se lo devuelve
  //    con una vigencia nueva de 1 año desde ese momento.
  m = url.match(/^\/api\/accesos-cursos\/([a-z0-9-]+)$/);
  if (m && method === 'PUT') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const t = (db.tokensCursoExterno||[]).find(x=>x.id===m[1]);
    if (!t) return json(res,404,{ok:false,error:'No encontrado'});
    try {
      const { activo, invalidar } = JSON.parse(await body(req)||'{}');
      if (!t.usado) {
        if (invalidar) { t.invalidado = true; db._rev++; writeDB(db); }
        return json(res,200,{ok:true});
      }
      const comprador = (db.users||[]).find(x=>x.id===t.userId);
      if (!comprador) return json(res,404,{ok:false,error:'La cuenta de este comprador ya no existe'});
      comprador.cursosAsignados = comprador.cursosAsignados || [];
      comprador.cursosVencimientos = comprador.cursosVencimientos || {};
      if (activo === false) {
        comprador.cursosAsignados = comprador.cursosAsignados.filter(cid=>cid!==t.cursoId);
        delete comprador.cursosVencimientos[t.cursoId];
      } else {
        if (!comprador.cursosAsignados.includes(t.cursoId)) comprador.cursosAsignados.push(t.cursoId);
        const nuevoVencimiento = new Date();
        nuevoVencimiento.setFullYear(nuevoVencimiento.getFullYear()+1);
        comprador.cursosVencimientos[t.cursoId] = nuevoVencimiento.toISOString();
      }
      db._rev++; writeDB(db);
      console.log(`[cursos] admin ${req._user.nombre} ${activo===false?'revocó':'reactivó'} el acceso externo de "${comprador.nombre}"`);
      return json(res,200,{ok:true});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // GET /api/publico/token/:token — PÚBLICO (sin login): curso-acceso.html
  // consulta esto apenas carga (antes de pedirle nada al visitante) para
  // saber a qué curso corresponde el link y si sigue vigente — así se
  // puede mostrar "Tu acceso a Bachata Dominicana" (o el error de
  // "ya usado"/"no válido") sin que el link tenga que llevar esos datos
  // en la URL. No expone nada del comprador ni de otros tokens.
  m = url.match(/^\/api\/publico\/token\/([A-Za-z0-9_-]+)$/);
  if (m && method === 'GET') {
    const db = readDB();
    const t = (db.tokensCursoExterno||[]).find(x=>x.token===m[1]);
    if (!t || t.invalidado) return json(res,404,{ok:false,error:'Este enlace no es válido. Consultá con la academia.'});
    if (t.usado)            return json(res,404,{ok:false,error:'Este enlace ya fue usado. Cada enlace sirve una sola vez — pedile a la academia uno nuevo.'});
    const curso = (db.cursos||[]).find(c=>c.id===t.cursoId);
    if (!curso) return json(res,404,{ok:false,error:'El curso de este enlace ya no existe. Consultá con la academia.'});
    return json(res,200,{ok:true, cursoNombre:curso.nombre});
  }

  // POST /api/publico/token/:token/canjear — el comprador externo abre
  // curso-acceso.html con su link y esto valida que el token no esté
  // usado/invalidado, resuelve QUIÉN es el comprador (dos caminos, ver
  // abajo), le da acceso a ESE curso con vigencia de 1 año, quema el token
  // para siempre y lo deja logueado para que el frontend lo redirija
  // directo al panel de cursos exclusivos. El curso al que corresponde se
  // deduce del propio token — no depende de nada más que venga en la URL.
  //
  // Dos caminos para resolver "quién es el comprador":
  //  A) YA TIENE SESIÓN (cookie malevo_jwt válida — p.ej. volvió a tocar un
  //     link nuevo desde la PWA que ya tiene instalada de un curso
  //     anterior): no hace falta pedirle nombre/teléfono de nuevo, se le
  //     agrega el curso directamente a SU cuenta ya existente.
  //  B) NO TIENE SESIÓN (primera vez, o cambió de dispositivo): sigue
  //     pidiendo nombre+teléfono en el body, como antes — crea la cuenta si
  //     es la primera vez, o la reutiliza si el teléfono ya coincide con un
  //     alumno existente (mismo matching que el login passwordless).
  m = url.match(/^\/api\/publico\/token\/([A-Za-z0-9_-]+)\/canjear$/);
  if (m && method === 'POST') {
    const db = readDB();
    const t = (db.tokensCursoExterno||[]).find(x=>x.token===m[1]);
    if (!t || t.invalidado) return json(res,403,{ok:false,error:'Este enlace no es válido. Consultá con la academia.'});
    if (t.usado)            return json(res,403,{ok:false,error:'Este enlace ya fue usado. Cada enlace sirve una sola vez — pedile a la academia uno nuevo.'});
    const curso = (db.cursos||[]).find(c=>c.id===t.cursoId);
    if (!curso) return json(res,404,{ok:false,error:'El curso de este enlace ya no existe. Consultá con la academia.'});
    try {
      const sesion = getUser(req); // null si no hay cookie válida
      let comprador = sesion ? db.users.find(u=>u.id===sesion.sub) : null;

      if (!comprador) {
        // Camino B: sin sesión (o con una cookie que ya no corresponde a
        // ningún usuario) — sigue el flujo clásico de nombre+teléfono.
        const { nombre, telefono } = JSON.parse(await body(req)||'{}');
        if (!(nombre||'').trim())    return json(res,400,{ok:false,error:'Falta tu nombre'});
        if (!(telefono||'').trim())  return json(res,400,{ok:false,error:'Falta tu teléfono'});

        comprador = buscarUsuarioPorContacto(db, telefono.trim());
        // "soloCursosExternos" marca cuentas creadas ACÁ (comprador externo
        // que nunca fue alumno de la academia) para que portal.js les
        // oculte Inicio/Perfil/Referidos y los deje solo en Cursos — no se
        // toca si el comprador ya existía (buscarUsuarioPorContacto lo
        // encontró), ya que en ese caso es un alumno real con su
        // navegación completa.
        if (!comprador) {
          comprador = {
            id: uuid(), username: null, passwordHash: null, role: 'student',
            nombre: nombre.trim(), email: '', telefono: telefono.trim(),
            active: true, plan: null, cashOnly: true, portalAccess: true,
            cursosAsignados: [], cursosVencimientos: {}, profileComplete: false,
            soloCursosExternos: true
          };
          db.users.push(comprador);
        }
      }
      // Camino A (ya logueado) llega directo hasta acá con el "comprador"
      // resuelto desde la sesión — mismo tramo final para ambos caminos.

      comprador.cursosAsignados = comprador.cursosAsignados || [];
      comprador.cursosVencimientos = comprador.cursosVencimientos || {};
      if (!comprador.cursosAsignados.includes(curso.id)) comprador.cursosAsignados.push(curso.id);
      const expira = new Date();
      expira.setFullYear(expira.getFullYear()+1);
      comprador.cursosVencimientos[curso.id] = expira.toISOString();

      t.usado = true; t.fechaUsado = new Date().toISOString(); t.userId = comprador.id;
      db._rev++; writeDB(db);

      // Sesión larga (1 año, igual que la vigencia del curso) para cuentas
      // "solo cursos" — un alumno real de la academia conserva el TTL
      // normal de 30 días, igual que cualquier otro login.
      const ttl = comprador.soloCursosExternos ? TOKEN_TTL_CURSO_EXTERNO : TOKEN_TTL;
      const jwt = signJWT({
        sub: comprador.id, role: comprador.role, nombre: comprador.nombre,
        exp: Math.floor(Date.now()/1000) + ttl
      });
      const cookie = `malevo_jwt=${jwt}; HttpOnly; Path=/; Max-Age=${ttl}; SameSite=Lax${cookieSecureFlag(req)}`;
      console.log(`[cursos] "${comprador.nombre}" canjeó su token de acceso a "${curso.nombre}" (vigencia hasta ${comprador.cursosVencimientos[curso.id]}${sesion?', ya logueado':''})`);
      // cursoId viaja en la respuesta para que curso-acceso.html pueda
      // redirigir al portal directo al detalle de ESTE curso (en vez de
      // dejar al comprador en la lista de Cursos Exclusivos teniendo que
      // encontrarlo él mismo) — ver arrancarPortal()/cxAbrirCurso() en portal.js.
      return json(res,200,{ok:true, nombre:comprador.nombre, cursoId:curso.id, cursoNombre:curso.nombre},{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Asistencia ────────────────────────────────────────────────────────────
  if (url === '/api/attendances') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    if (method==='GET') {
      const list = ['admin','teacher'].includes(u.role)
        ? db.attendances
        : db.attendances.filter(a=>a.userId===u.sub);
      return json(res,200,list);
    }
    // Teachers y admins pueden marcar asistencia
    if (!requireRole(['admin','teacher'])(req,res)) return;
    if (method==='POST') {
      try {
        const { classId, userId, fecha, present } = JSON.parse(await body(req)||'{}');
        let rec = db.attendances.find(a=>a.classId===classId&&a.userId===userId&&a.fecha===fecha);
        if (rec) { rec.present = present; }
        else db.attendances.push({id:uuid(),classId,userId,fecha,present});
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
  }

  // ── Pagos (solo admin) ────────────────────────────────────────────────────
  if (url === '/api/payments') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    if (method==='GET') return json(res,200,db.payments);
    if (method==='POST') {
      try {
        const data = JSON.parse(await body(req)||'{}');
        db.contadorTicket++;
        const p = Object.assign({id:uuid(),numeroTicket:db.contadorTicket},data);
        db.payments.push(p);
        db._rev++; writeDB(db);
        return json(res,201,{ok:true,payment:p});
      } catch { return json(res,400,{ok:false}); }
    }
  }
  const payIdMatch = url.match(/^\/api\/payments\/([a-z0-9-]+)$/);
  if (payIdMatch) {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    const pid= payIdMatch[1];
    const idx= db.payments.findIndex(p=>p.id===pid);
    if (idx===-1) return json(res,404,{ok:false});
    if (method==='PUT') {
      try {
        Object.assign(db.payments[idx], JSON.parse(await body(req)||'{}'));
        db._rev++; writeDB(db);
        return json(res,200,{ok:true});
      } catch { return json(res,400,{ok:false}); }
    }
    if (method==='DELETE') {
      db.payments.splice(idx,1);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    }
  }

  // ── Morosidad: invitados de cortesía no disparan alertas ─────────────────
  if (url === '/api/deuda' && method === 'GET') {
    if (!requireRole(['admin'])(req,res)) return;
    const db  = readDB();
    const mes = new URL('http://x'+req.url).searchParams.get('mes') || new Date().toISOString().slice(0,7);
    const pagados = new Set(db.payments.filter(p=>p.mes===mes).map(p=>p.userId));
    const deudores = db.users.filter(u=>
      u.active && u.role==='student' &&
      !u.guestCourtesy &&          // invitados de cortesía: excluidos
      !pagados.has(u.id)
    ).map(({passwordHash,...u})=>u);
    return json(res,200,deudores);
  }

  // ── Perfil del alumno (self) ─────────────────────────────────────────────
  if (url === '/api/profile') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const u  = req._user;
    const me = db.users.find(x=>x.id===u.sub);
    if (!me) return json(res,404,{ok:false});
    if (method === 'GET') {
      const {passwordHash,...safe}=me;
      return json(res,200,safe);
    }
    if (method === 'PUT') {
      try {
        const upd = JSON.parse(await body(req)||'{}');
        // El alumno solo puede modificar campos seguros de su perfil.
        // nivelBachata/nivelSalsa son los niveles OFICIALES que gestiona el
        // admin (controlan el acceso real a los vídeos) — el alumno solo
        // puede indicar su nivel preferido/autopercibido, que es informativo.
        const allowed=['nombre','email','telefono','rol','nivelBachataPreferido','nivelSalsaPreferido','bio','fotoPerfil',
          'streakWeeks','streakLastWeek','eventRsvps',
          // Tarjeta "Racha": A) racha de desbloqueo semanal (5 días distintos viendo vídeo,
          // se reinicia cada domingo) y B) fueguito (contador histórico de días de uso, global
          // e independiente, nunca se reinicia).
          'rachaDiasSemana','rachaSemanaInicio','fuegoDiasTotal','fuegoUltimoDia',
          'rachaBonusDesbloqueados','rachaSemanaPremiada'];
        allowed.forEach(k=>{ if(upd[k]!==undefined) me[k]=upd[k]; });
        if (upd.password && upd.password.length>=6) {
          me.passwordHash = hashPassword(upd.password);
        }
        me.profileComplete = true;
        db._rev++; writeDB(db);
        const {passwordHash,...safe}=me;
        return json(res,200,{ok:true,user:safe});
      } catch(e){ return json(res,400,{ok:false,error:e.message}); }
    }
  }

  // ── Mis facturas (self-service, alumno) ───────────────────────────────────
  // GET /api/mis-facturas → lista de sus propios pagos/facturas, para el
  // botón "Quiero mi factura" del perfil. La descarga del PDF individual usa
  // la ruta ya existente /api/factura/:pagoId/pdf (que ya valida que el
  // alumno solo pueda descargar sus propias facturas).
  if (url === '/api/mis-facturas' && method === 'GET') {
    if (!authAny(req,res)) return;
    const u = req._user;
    if (u.role !== 'student') return json(res,403,{ok:false,error:'Solo para alumnos.'});
    const db = readDB();
    const mias = (db.payments||[])
      .filter(p => p.userId === u.sub)
      .sort((a,b) => new Date(b.fechaPago||b.mes||0) - new Date(a.fechaPago||a.mes||0))
      .map(p => ({
        id: p.id,
        numeroTicket: p.numeroTicket,
        mes: p.mes,
        fechaPago: p.fechaPago,
        importe: p.importe,
        metodo: p.metodo
      }));
    return json(res,200,{ok:true,facturas:mias});
  }

  // ── Notificaciones push del alumno (suscripción del navegador/dispositivo) ──
  if (url === '/api/push/vapid-public-key' && method === 'GET') {
    if (!authAny(req,res)) return;
    return json(res,200,{key: obtenerVapidKeys().publicKeyB64});
  }
  if (url === '/api/push/subscribe' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const sub = JSON.parse(await body(req)||'{}');
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return json(res,400,{ok:false,error:'Suscripción inválida.'});
      }
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      if (!Array.isArray(me.pushSubs)) me.pushSubs = [];
      me.pushSubs = me.pushSubs.filter(s=>s.endpoint!==sub.endpoint);
      me.pushSubs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }
  if (url === '/api/push/unsubscribe' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const { endpoint } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (me && Array.isArray(me.pushSubs)) {
        me.pushSubs = me.pushSubs.filter(s=>s.endpoint!==endpoint);
        db._rev++; writeDB(db);
      }
      return json(res,200,{ok:true});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Autoreporte de pago desde el portal (botón "Pagar cuota / Renovación").
  //    Crea un registro en Pagos para que el admin lo revise/confirme; no es
  //    un cobro online real (la app no tiene pasarela de pago integrada). ──
  if (url === '/api/portal/pago' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const { metodo } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      const mes         = new Date().toISOString().slice(0,7);
      const importeBase = (db.config.precios && db.config.precios[me.plan]) || 0;

      // ── Descuento por invitar amigos: cada amigo referido que completó
      // su pago suma 1 mes de 30% pendiente (referralMesesPendientes,
      // acumulativo — ver stripe-billing.js). Al reportar un pago manual
      // se consume UN mes de ese saldo, igual que Stripe consume uno por
      // cada factura con el cupón aplicado. ──
      const mesesPendientes = Number(me.referralMesesPendientes || 0);
      const descuentoPct = mesesPendientes > 0 ? 30 : 0;
      const importe = descuentoPct > 0
        ? Math.round(importeBase * (1 - descuentoPct/100) * 100) / 100
        : importeBase;
      let notas = 'Autoreportado por el alumno desde el portal.';
      if (descuentoPct > 0) {
        notas += ` Descuento por invitar a un amigo (-${descuentoPct}%, quedan ${mesesPendientes-1} mes${mesesPendientes-1===1?'':'es'} pendientes).`;
        me.referralMesesPendientes = mesesPendientes - 1;
      }

      db.contadorTicket = (db.contadorTicket||0) + 1;
      const pago = {
        id: uuid(), userId: me.id, mes, fechaPago: new Date().toISOString(),
        importe, metodo: metodo || 'Transferencia',
        notas,
        numeroTicket: db.contadorTicket
      };
      db.payments.push(pago);
      db._rev++; writeDB(db);
      return json(res,200,{ok:true, pago});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  /* ══════════════════════════════════════════════════════════════════
     STRIPE — suscripciones recurrentes, permanencia y facturación.
     Ver stripe-billing.js para toda la lógica. Estas rutas solo hacen
     de puente HTTP: leen el usuario autenticado, llaman al módulo, y
     traducen sus códigos de error a respuestas HTTP claras. ══════════ */

  // ── Datos fiscales del alumno (obligatorios antes de poder pagar por
  //    Stripe). Se guardan sueltos de /api/me para no interferir con el
  //    resto del formulario de perfil. ──
  if (url === '/api/portal/facturacion' && method === 'PUT') {
    if (!authAnyPendiente(req,res)) return;
    try {
      const { nombreCompleto, nifDniNie, direccionFiscal } = JSON.parse(await body(req)||'{}');
      if (!nombreCompleto || !nifDniNie || !direccionFiscal) {
        return json(res,400,{ok:false,error:'Faltan datos: nombre completo, NIF/DNI/NIE y dirección fiscal son obligatorios.'});
      }
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      me.facturacion = {
        nombreCompleto: String(nombreCompleto).slice(0,200),
        nifDniNie: String(nifDniNie).slice(0,20),
        direccionFiscal: String(direccionFiscal).slice(0,300)
      };
      db._rev++; writeDB(db);
      return json(res,200,{ok:true, facturacion: me.facturacion});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Estado de la suscripción del alumno logueado (plan, si está al
  //    día/en deuda/suspendido, si ya cumplió la permanencia, etc.) ──
  if (url === '/api/portal/stripe/estado' && method === 'GET') {
    if (!authAnyPendiente(req,res)) return;
    const db = readDB();
    const me = db.users.find(x=>x.id===req._user.sub);
    if (!me) return json(res,404,{ok:false});
    return json(res,200,{ok:true, ...stripeBilling.estadoSuscripcion(me)});
  }

  // ── Crea una Checkout Session de Stripe para suscribirse a un plan de
  //    portal (35/50/80€) y devuelve la URL a la que redirigir al alumno.
  //    body: { plan, metodoPreferido? } — metodoPreferido es solo
  //    informativo (qué opción marcó el alumno en nuestro propio
  //    formulario: tarjeta/bizum/transferencia); no cambia el modo de la
  //    sesión ni la lógica de activación — Stripe decide qué métodos
  //    ofrece de verdad según el plan y lo configurado en su Dashboard. ──
  if (url === '/api/portal/stripe/checkout-session' && method === 'POST') {
    if (!authAnyPendiente(req,res)) return;
    try {
      const { plan, metodoPreferido } = JSON.parse(await body(req)||'{}');
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
      const metodosValidos = ['tarjeta','bizum','transferencia'];
      const session = await stripeBilling.crearCheckoutSession({
        db, user: me, plan,
        metodoPreferido: metodosValidos.includes(metodoPreferido) ? metodoPreferido : undefined,
        successUrl: `${base}/portal.html?stripe=ok`,
        cancelUrl:  `${base}/portal.html?stripe=cancelado`
      });
      console.log(`[stripe:checkout-session] modo=${stripeBilling.modoStripeActual()} userId=${me.id} plan=${plan} sessionId=${session.id}`);
      return json(res,200,{ok:true, url: session.url});
    } catch(e){
      console.error('[stripe:checkout-session] ERROR:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Sesión del Customer Portal de Stripe: el alumno cambia su método de
  //    pago y ve/descarga sus facturas en la página oficial de Stripe.
  //    Requiere que ya tenga stripeCustomerId (se crea en su primer
  //    checkout). ──
  if (url === '/api/portal/stripe/billing-portal' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
      const session = await stripeBilling.crearBillingPortalSession({
        user: me,
        returnUrl: `${base}/portal.html`
      });
      return json(res,200,{ok:true, url: session.url});
    } catch(e){
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : (code==='NO_CUSTOMER' ? 400 : 400);
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Cancela la suscripción del alumno logueado (bloqueada mientras no
  //    haya cumplido la permanencia de su plan). ──
  if (url === '/api/portal/stripe/cancelar' && method === 'POST') {
    if (!authAny(req,res)) return;
    try {
      const db = readDB();
      const me = db.users.find(x=>x.id===req._user.sub);
      if (!me) return json(res,404,{ok:false});
      await stripeBilling.cancelarSuscripcion({ user: me });
      db._rev++; writeDB(db);
      return json(res,200,{ok:true, estado: stripeBilling.estadoSuscripcion(me)});
    } catch(e){
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : (code==='PERMANENCIA_ACTIVA' ? 403 : 400);
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Webhook de Stripe: NO lleva autenticación JWT propia — Stripe firma
  //    cada petición con STRIPE_WEBHOOK_SECRET y stripe-billing.js verifica
  //    esa firma con el cuerpo crudo (sin JSON.parse) antes de confiar en
  //    nada. Registrar esta URL en el Dashboard de Stripe → Webhooks. ──
  if (url === '/api/stripe/webhook' && method === 'POST') {
    try {
      const raw = await body(req);
      const signature = req.headers['stripe-signature'];
      const result = await stripeBilling.manejarWebhook({ rawBody: raw, signature });
      return json(res,200,result);
    } catch(e){
      // Log en servidor SIEMPRE (aunque Stripe solo vea el 400/503 en su
      // Dashboard de reintentos) — es la única forma de ver por qué un
      // webhook de prueba no activó nada, ya que Stripe no expone el
      // cuerpo de nuestra respuesta de error en detalle en su UI.
      console.error('[stripe:webhook] ERROR procesando webhook:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Clases del alumno (para calendario) ──────────────────────────────────
  if (url === '/api/my-classes' && method === 'GET') {
    if (!authAny(req,res)) return;
    const db  = readDB();
    const u   = req._user;
    const me  = db.users.find(x=>x.id===u.sub);
    if (!me) return json(res,404,{ok:false});
    // clases asignadas manualmente por el admin (campo assignedClasses en user)
    const assigned = me.assignedClasses || [];
    const classes  = db.classes.filter(c=>assigned.includes(c.id));
    return json(res,200,classes);
  }

  // ── Referidos ─────────────────────────────────────────────────────────────
  if (url === '/api/referral' && method === 'GET') {
    if (!authAny(req,res)) return;
    const db = readDB();
    const me = db.users.find(x=>x.id===req._user.sub);
    if (!me) return json(res,404,{ok:false});
    if (!me.referralCode) { me.referralCode = uuid().slice(0,8); db._rev++; writeDB(db); }
    const code = me.referralCode;
    // "Amigos invitados" cuenta conversiones reales: alguien que se registró
    // con este código Y completó su pago (activo, ya no pendiente) — no
    // simples visitas al enlace ni registros sin pagar. Es una consulta en
    // caliente sobre la base de datos, no un contador guardado aparte.
    const referred = db.users.filter(u => u.referredBy === me.id && u.active && !u.pendingPayment);
    const mesesPendientes = Number(me.referralMesesPendientes || 0);
    const discount = mesesPendientes > 0 ? 30 : 0;
    // Mismo origen que las URLs de retorno de Stripe Checkout (server.js,
    // ruta /api/portal/stripe/checkout-session): PUBLIC_BASE_URL como
    // fuente de verdad del dominio público, con el host de la petición
    // como respaldo si no está configurada.
    const host  = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
    const link  = `${base}/registro-membresia.html?ref=${code}`;
    return json(res,200,{code,referred:referred.length,discount,mesesPendientes,link});
  }

  // ── Asignación de clases a alumno por admin ───────────────────────────────
  if (url.match(/^\/api\/users\/[a-z0-9-]+\/classes$/) && method === 'PUT') {
    if (!requireRole(['admin'])(req,res)) return;
    const uid_ = url.split('/')[3];
    try {
      const db = readDB();
      const { classIds, plan, nivelBachata, nivelSalsa, rol } = JSON.parse(await body(req)||'{}');
      const me = db.users.find(x=>x.id===uid_);
      if (!me) return json(res,404,{ok:false});
      if (classIds) me.assignedClasses = classIds;
      if (plan)     me.plan = plan;
      if (nivelBachata!==undefined) me.nivelBachata = nivelBachata;
      if (nivelSalsa!==undefined)   me.nivelSalsa   = nivelSalsa;
      if (rol)      me.rol = rol;
      db._rev++; writeDB(db);
      return json(res,200,{ok:true});
    } catch(e){ return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Enlace general de invitación (admin) ─────────────────────────────────
  // GET  /api/invite-link  → devuelve la URL de invitación general de la app
  // PUT  /api/invite-link  → regenera el token de invitación
  if (url === '/api/invite-link') {
    if (!requireRole(['admin'])(req,res)) return;
    const db = readDB();
    if (method === 'GET') {
      if (!db.config.inviteToken) {
        db.config.inviteToken = uuid().replace(/-/g,'');
        db._rev++; writeDB(db);
      }
      const host = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const link = `${proto}://${host}/join.html?t=${db.config.inviteToken}`;
      return json(res,200,{ok:true, link, token: db.config.inviteToken});
    }
    if (method === 'PUT') {
      // Regenerar token (invalida links anteriores)
      db.config.inviteToken = uuid().replace(/-/g,'');
      db._rev++; writeDB(db);
      const host = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const link = `${proto}://${host}/join.html?t=${db.config.inviteToken}`;
      return json(res,200,{ok:true, link, token: db.config.inviteToken});
    }
  }

  // ── Onboarding: validar token de invitación (público) ────────────────────
  // GET /api/onboarding/check?t=TOKEN
  if (url.startsWith('/api/onboarding/check') && method === 'GET') {
    const params = new URL('http://x' + req.url).searchParams;
    const t = params.get('t') || '';
    const db = readDB();
    if (!t || t !== db.config.inviteToken) {
      return json(res,403,{ok:false,error:'Enlace inválido o expirado'});
    }
    return json(res,200,{ok:true, precios: db.config.precios, portalPlans: db.config.portalPlans || ['35','50','80']});
  }

  // ── Onboarding: token de invitación para la página pública de registro ────
  // GET /api/onboarding/public-token  (sin auth: esta página ES el punto de
  // alta público de la academia, equivalente a compartir el link de invitación)
  if (url === '/api/onboarding/public-token' && method === 'GET') {
    const db = readDB();
    if (!db.config.inviteToken) {
      db.config.inviteToken = uuid().replace(/-/g,'');
      db._rev++; writeDB(db);
    }
    return json(res,200,{ok:true, token: db.config.inviteToken});
  }

  // ── Onboarding: registro rápido por enlace de invitación (público) ────────
  // POST /api/onboarding/register
  if (url === '/api/onboarding/register' && method === 'POST') {
    try {
      const db = readDB();
      const { token, nombre, telefono, email, plan, refCode, dias, aceptadoImagen, aceptadoPermanencia } = JSON.parse(await body(req)||'{}');
      // Validar token de invitación
      if (!token || token !== db.config.inviteToken) {
        return json(res,403,{ok:false,error:'Enlace inválido o expirado'});
      }
      if (!nombre || !plan) return json(res,400,{ok:false,error:'Faltan datos'});
      const planesValidos = Object.keys(db.config.precios||{});
      if (!planesValidos.includes(plan)) return json(res,400,{ok:false,error:'Plan inválido'});
      // Cláusula legal obligatoria (permanencia de 2 meses en los planes que
      // aplica + cesión de derechos de imagen, RGPD): sin esta confirmación
      // explícita del alumno no se crea la cuenta.
      if (!aceptadoImagen || !aceptadoPermanencia) {
        return json(res,400,{ok:false,error:'Debes aceptar las condiciones de permanencia y el uso de imagen para continuar.'});
      }

      // Enlace de referido (?ref=CODIGO en registro-membresia.html): si el
      // código corresponde a un alumno real, se guarda quién invitó. La
      // recompensa (contador + descuento) se aplica recién cuando este
      // usuario nuevo complete su pago de verdad — ver
      // stripeBilling.otorgarRecompensaReferidoSiCorresponde, llamada desde
      // el webhook checkout.session.completed.
      let referrerId = null;
      if (refCode) {
        const ref = db.users.find(u => u.referralCode === refCode);
        if (ref) referrerId = ref.id;
      }

      // Crear usuario pendiente de pago
      const passRand = crypto.randomBytes(16).toString('hex');
      const usernameVal = 'user_' + crypto.randomBytes(4).toString('hex');
      const newUser = {
        id: uuid(),
        username: usernameVal,
        passwordHash: hashPassword(passRand),
        role: 'student',
        nombre: nombre.trim(),
        email: (email||'').trim(),
        telefono: (telefono||'').trim(),
        active: false,           // inactivo hasta confirmar pago
        plan: plan,
        pendingPayment: true,    // flag: pago pendiente
        pendingPlan: plan,
        guestCourtesy: false,
        cashOnly: false,
        portalAccess: false,
        facturaEnvio: 'none',
        referralCode: uuid().slice(0,8),
        referredBy: referrerId,
        profileComplete: false,
        onboardingToken: uuid().replace(/-/g,''), // token único para recuperar la sesión
        createdAt: new Date().toISOString(),
        // Días de clase elegidos en el registro (informativo; el admin puede
        // ajustarlos luego al asignar clases reales).
        diasAsistencia: Array.isArray(dias) ? dias.filter(d => typeof d === 'string').slice(0,7) : [],
        // Confirmación legal explícita del alumno al registrarse: condiciones
        // de permanencia (2 meses, aplica a los planes 50€ y VIP 80€) y
        // cesión de derechos de imagen en fotos/vídeos con fines
        // promocionales (RGPD). Ambas quedan en true porque el registro ya
        // se bloqueó arriba si no se confirmaron.
        aceptadoImagen: true,
        aceptadoPermanencia: true,
        fechaRegistro: new Date().toISOString()
      };
      db.users.push(newUser);
      db._rev++; writeDB(db);

      // Generar JWT temporal (role student, pero active=false → sin acceso real)
      const token_ = signJWT({
        sub: newUser.id, role: 'student', nombre: newUser.nombre,
        exp: Math.floor(Date.now()/1000) + 3600 // 1h para completar el onboarding
      });
      const cookie = `malevo_jwt=${token_}; HttpOnly; Path=/; Max-Age=3600; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,201,{
        ok:true,
        userId: newUser.id,
        nombre: newUser.nombre,
        plan: plan,
        precio: db.config.precios[plan] || 0,
        onboardingToken: newUser.onboardingToken
      },{'Set-Cookie':cookie});
    } catch(e) { return json(res,400,{ok:false,error:e.message}); }
  }

  // ── Onboarding: alta directa por Stripe Checkout, SIN registro previo
  //    (público) — reemplaza el paso 2 "Tus datos de acceso" en
  //    registro-membresia.html: el alumno elige plan + método preferido +
  //    acepta condiciones, y aquí se crea directamente la sesión de
  //    Stripe Checkout. Los datos de identificación (nombre/email/
  //    teléfono) los recoge la propia página de Stripe
  //    (billing_address_collection + phone_number_collection, ver
  //    stripeBilling.crearCheckoutSessionDirecta) y la cuenta del alumno
  //    se crea recién cuando el pago se confirma — ver
  //    /api/onboarding/confirmar-checkout y el webhook. ──
  // POST /api/onboarding/checkout-directo
  if (url === '/api/onboarding/checkout-directo' && method === 'POST') {
    try {
      const db = readDB();
      const { token, plan, metodoPreferido, refCode, aceptadoImagen, aceptadoPermanencia } = JSON.parse(await body(req)||'{}');
      if (!token || token !== db.config.inviteToken) {
        return json(res,403,{ok:false,error:'Enlace inválido o expirado'});
      }
      if (!plan) return json(res,400,{ok:false,error:'Falta el plan'});
      const planesValidos = Object.keys(db.config.precios||{});
      const portalPlansOk = db.config.portalPlans || [];
      if (!planesValidos.includes(plan) && !portalPlansOk.includes(plan)) {
        return json(res,400,{ok:false,error:'Plan inválido'});
      }
      // Misma cláusula legal obligatoria que en /api/onboarding/register
      // (permanencia + cesión de imagen): sin esto no se crea la sesión.
      if (!aceptadoImagen || !aceptadoPermanencia) {
        return json(res,400,{ok:false,error:'Debes aceptar las condiciones de permanencia y el uso de imagen para continuar.'});
      }
      const metodosValidos = ['tarjeta','bizum','transferencia'];
      const host  = req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const base  = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
      const session = await stripeBilling.crearCheckoutSessionDirecta({
        db, plan,
        metodoPreferido: metodosValidos.includes(metodoPreferido) ? metodoPreferido : undefined,
        refCode: (refCode||'').trim() || undefined,
        aceptadoImagen: true,
        aceptadoPermanencia: true,
        // {CHECKOUT_SESSION_ID} lo sustituye Stripe por el id real de la
        // sesión al redirigir de vuelta — portal.js lo lee de la URL para
        // llamar a /api/onboarding/confirmar-checkout.
        successUrl: `${base}/portal.html?stripe=ok&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl:  `${base}/registro-membresia.html?stripe=cancelado`
      });
      console.log(`[stripe:checkout-directo] modo=${stripeBilling.modoStripeActual()} plan=${plan} sessionId=${session.id} url=${session.url}`);
      return json(res,200,{ok:true, url: session.url});
    } catch(e) {
      console.error('[stripe:checkout-directo] ERROR creando la sesión:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── Onboarding: confirma una Checkout Session al volver de Stripe
  //    (público) — se llama con ?session_id=... apenas el navegador
  //    vuelve a portal.html tras el pago. Consulta la sesión
  //    DIRECTAMENTE a la API de Stripe (no depende de que el webhook ya
  //    haya llegado): si el pago está confirmado, crea/activa la cuenta
  //    (stripeBilling.confirmarCheckoutSession) y deja al alumno logueado
  //    con su propia cookie de sesión, lista para que portal.js continúe
  //    con el flujo normal de /api/me. ──
  // GET /api/onboarding/confirmar-checkout?session_id=...
  if (url.startsWith('/api/onboarding/confirmar-checkout') && method === 'GET') {
    try {
      const params = new URL('http://x' + req.url).searchParams;
      const sessionId = params.get('session_id') || '';
      console.log(`[stripe:confirmar-checkout] request recibida · sessionId=${sessionId || '(vacío)'}`);
      const db = readDB();
      const { pagado, user } = await stripeBilling.confirmarCheckoutSession({ db, sessionId });
      if (!pagado || !user) return json(res,200,{ok:true, pending:true});
      const token_ = signJWT({
        sub: user.id, role: 'student', nombre: user.nombre,
        exp: Math.floor(Date.now()/1000) + TOKEN_TTL
      });
      const cookie = `malevo_jwt=${token_}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL}; SameSite=Lax${cookieSecureFlag(req)}`;
      return json(res,200,{ok:true, active:true, nombre:user.nombre},{'Set-Cookie':cookie});
    } catch(e) {
      console.error('[stripe:confirmar-checkout] ERROR:', e.code || 'ERROR', '-', e.message);
      const code = e.code || 'ERROR';
      const status = code==='NOT_CONFIGURED' ? 503 : 400;
      return json(res,status,{ok:false, code, error:e.message});
    }
  }

  // ── NOTA DE SEGURIDAD: el endpoint /api/onboarding/confirm-payment que
  // existía aquí permitía que CUALQUIERA activara su propia cuenta con un
  // simple POST (auto-atestiguando "ya pagué"), sin ninguna verificación
  // real — el alumno nunca llegaba a pasar por Stripe. Se eliminó a
  // propósito: la única vía para activar una cuenta (user.active=true,
  // pendingPayment=false) es ahora el webhook real de Stripe
  // (checkout.session.completed, ver stripeBilling.manejarWebhook), que sí
  // confirma que el pago se procesó de verdad. El registro
  // (/api/onboarding/register) y el checkout
  // (/api/portal/stripe/checkout-session) siguen igual; solo cambia que ya
  // no hay atajo para saltarse Stripe. ──

  // ── Onboarding: verificar si el usuario autenticado aún tiene pago pendiente ─
  // GET /api/onboarding/status
  if (url === '/api/onboarding/status' && method === 'GET') {
    const u = getUser(req);
    if (!u) return json(res,401,{ok:false});
    const db = readDB();
    const userRec = db.users.find(x => x.id === u.sub);
    if (!userRec) return json(res,404,{ok:false});
    return json(res,200,{
      ok: true,
      active: !!userRec.active,
      pendingPayment: !!userRec.pendingPayment,
      plan: userRec.plan,
      nombre: userRec.nombre,
      precio: db.config.precios[userRec.plan] || 0,
      onboardingToken: userRec.onboardingToken || null
    });
  }

  // ── PDF resumen de todas las facturas ────────────────────────────────────
  // POST /api/facturas/informe-todas   body: { desde?, hasta? }
  if (url === '/api/facturas/informe-todas' && method === 'POST') {
    const u = getUser(req);
    if (!u || !['admin','teacher'].includes(u.role)) return json(res,401,{ok:false});
    try {
      const db    = readDB();
      const body_ = JSON.parse(await body(req)||'{}');
      let pagos   = [...db.payments];
      if (body_.desde && body_.hasta) {
        pagos = pagos.filter(p => {
          const m = (p.mes||'').slice(0,7);
          return m >= body_.desde && m <= body_.hasta;
        });
      }
      pagos.sort((a,b) => ((a.mes||'')+(a.fechaPago||'')).localeCompare((b.mes||'')+(b.fechaPago||'')));
      const pdfBuf = await generarPDFResumen(pagos, db, body_.titulo || 'Informe de facturas');
      const nombre = body_.nombre || 'informe_facturas_malevo.pdf';
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Content-Length': pdfBuf.length,
        'Cache-Control': 'no-store'
      });
      return res.end(pdfBuf);
    } catch(e) { return json(res,500,{ok:false,error:e.message}); }
  }

  // ── PDF informe trimestral ────────────────────────────────────────────────
  // POST /api/facturas/informe-trimestral   body: { desde, hasta, trimLabel }
  if (url === '/api/facturas/informe-trimestral' && method === 'POST') {
    const u = getUser(req);
    if (!u || !['admin','teacher'].includes(u.role)) return json(res,401,{ok:false});
    try {
      const db    = readDB();
      const body_ = JSON.parse(await body(req)||'{}');
      if (!body_.desde || !body_.hasta) return json(res,400,{ok:false,error:'Faltan desde/hasta'});
      const pagos = db.payments
        .filter(p => { const m=(p.mes||'').slice(0,7); return m>=body_.desde && m<=body_.hasta; })
        .sort((a,b)=>((a.mes||'')+(a.fechaPago||'')).localeCompare((b.mes||'')+(b.fechaPago||'')));
      const titulo   = body_.trimLabel || `Informe trimestral ${body_.desde} – ${body_.hasta}`;
      const pdfBuf   = await generarPDFResumen(pagos, db, titulo);
      const nombre   = `informe_trimestral_${body_.desde}_${body_.hasta}.pdf`;
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Content-Length': pdfBuf.length,
        'Cache-Control': 'no-store'
      });
      return res.end(pdfBuf);
    } catch(e) { return json(res,500,{ok:false,error:e.message}); }
  }

  // ── Generación de PDF de factura individual ──────────────────────────────
  // GET /api/factura/:pagoId/pdf
  const facturaMatch = url.match(/^\/api\/factura\/([a-z0-9-]+)\/pdf$/);
  if (facturaMatch && method === 'GET') {
    const u = getUser(req);
    if (!u) return json(res, 401, {ok:false});
    const db  = readDB();
    const pid = facturaMatch[1];
    const p   = db.payments.find(x => x.id === pid);
    if (!p) return json(res, 404, {ok:false, error:'Pago no encontrado'});
    // Admin/profe pueden ver cualquier factura; el alumno solo la suya propia.
    const esPropia = u.role === 'student' && p.userId === u.sub;
    if (!['admin','teacher'].includes(u.role) && !esPropia) {
      return json(res, 401, {ok:false});
    }

    const pdfBuf = await generarPDFFactura(p, db);
    const numT   = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : pid.slice(0,8);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${numT}.pdf"`,
      'Content-Length': pdfBuf.length,
      'Cache-Control': 'no-store'
    });
    return res.end(pdfBuf);
  }

  // ── ZIP con múltiples PDFs ────────────────────────────────────────────────
  // POST /api/facturas/zip   body: { ids: [...] }   o   { desde, hasta }
  if (url === '/api/facturas/zip' && method === 'POST') {
    const u = getUser(req);
    if (!u || !['admin','teacher'].includes(u.role)) {
      return json(res, 401, {ok:false});
    }
    try {
      const db   = readDB();
      const body_ = JSON.parse(await body(req)||'{}');
      let pagos = [];

      if (Array.isArray(body_.ids) && body_.ids.length) {
        pagos = db.payments.filter(p => body_.ids.includes(p.id));
      } else if (body_.desde && body_.hasta) {
        pagos = db.payments.filter(p => {
          const m = (p.mes||'').slice(0,7);
          return m >= body_.desde && m <= body_.hasta;
        });
      } else {
        pagos = [...db.payments];
      }
      pagos.sort((a,b) => ((a.mes||'')+(a.fechaPago||'')).localeCompare((b.mes||'')+(b.fechaPago||'')));

      if (!pagos.length) return json(res, 404, {ok:false, error:'Sin facturas en ese período'});

      const nombre = body_.nombre || 'facturas_malevo.zip';
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Cache-Control': 'no-store'
      });

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(res);
      archive.on('error', err => { try{ res.end(); }catch{} });

      for (const p of pagos) {
        const numT   = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : 'T-'+p.id.slice(0,6);
        const pdfBuf = await generarPDFFactura(p, db);
        archive.append(pdfBuf, { name: `${numT}.pdf` });
      }

      await archive.finalize();
      return;
    } catch(e) { return json(res, 500, {ok:false, error:e.message}); }
  }

  // ── Estáticos ─────────────────────────────────────────────────────────────
  if (method === 'GET') return serveStatic(req, res);
  res.writeHead(404); res.end('Not found');
});

/* ---------- Arranque ----------
   Async porque, antes de abrir el puerto, intentamos restaurar el último
   backup de db.json desde Firebase Storage (ver firebase.js). Con un
   disco persistente (como en este servidor) esto ya no es imprescindible
   para sobrevivir un reinicio — el db.json local no se borra solo — pero
   se deja activo como red de seguridad ante un fallo de disco. Ojo con
   un caso de borde: si alguna vez editás db.json a mano con el servidor
   apagado, ese cambio se pisa en el próximo arranque con la copia de
   Firebase (que puede ser anterior). Para desactivar esta restauración
   (y también el backup automático) simplemente dejá
   FIREBASE_SERVICE_ACCOUNT_JSON sin definir en el .env. Si no hay backup
   todavía, o Firebase no está configurado, o falla la descarga por lo
   que sea, seguimos con el db.json local tal cual (ensureData() ya
   garantiza que exista, aunque sea vacío) — nunca bloqueamos el arranque
   por esto. */
async function iniciarServidor() {
  ensureData();
  try {
    const restaurado = await firebaseBackup.restaurarDBDesdeBackup(DB_FILE);
    console.log(restaurado
      ? '✓ db.json restaurado desde el último backup de Firebase Storage.'
      : '… Sin backup de Firebase Storage disponible (o Firebase no configurado) — usando el db.json local.');
  } catch (e) {
    console.warn('⚠ No se pudo restaurar el backup de Firebase Storage:', e.message);
  }

  server.listen(PORT, '0.0.0.0', () => {
    const db = readDB();
    if (db.users.length === 0) {
      console.log('\n⚠  PRIMERA EJECUCIÓN: ve a http://localhost:'+PORT+'/setup.html para crear el admin.\n');
    }
    console.log('Malevo v3.0 · http://localhost:'+PORT+'  (datos: '+DB_FILE+')');
    console.log(_stripeConfigurado
      ? 'Stripe: configurado (claves detectadas).'
      : 'Stripe: NO configurado — faltan STRIPE_SECRET_KEY/paquete "stripe", o ambos. Los pagos manuales/efectivo funcionan igual.');
    // Diagnóstico de arranque para PUBLIC_BASE_URL: sin esto, un .env mal
    // cargado (o un service sin reiniciar tras editarlo) se nota recién
    // cuando alguien genera un link y ve la IP/puerto local en vez del
    // dominio público — con este aviso queda claro desde el primer
    // segundo, en journalctl -u malevo, si la variable llegó bien o no.
    console.log(process.env.PUBLIC_BASE_URL
      ? '✓ PUBLIC_BASE_URL activo: ' + process.env.PUBLIC_BASE_URL + ' (todos los enlaces generados usan este dominio).'
      : '⚠ PUBLIC_BASE_URL no está definida — los enlaces (Cursos Exclusivos, Stripe, etc.) se van a generar con el host/IP de cada request entrante en vez del dominio público. Definila en .env y reiniciá el servicio.');
  });
}
iniciarServidor();
>>>>>>> 3e6731f88115fcaf4a7652abe188b46d1957d2c8
