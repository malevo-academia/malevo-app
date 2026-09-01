# Integración de Stripe — guía de configuración

Esta guía explica qué variables de entorno hay que añadir al servidor y qué
pasos manuales hacer en el Dashboard de Stripe para dejar operativa la
integración ya implementada en el código (`stripe-billing.js` + rutas en
`server.js`).

## 1. Variables de entorno

Crea un archivo `.env` en la raíz del proyecto (junto a `server.js`) o
defínelas como variables de entorno reales del servidor. El servidor las lee
automáticamente al arrancar (no hace falta ninguna librería adicional).

| Variable | Obligatoria | Dónde se obtiene | Descripción |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Sí, para activar Stripe | Dashboard → Developers → API keys | Clave secreta. Usa `sk_test_...` para pruebas y `sk_live_...` en producción. |
| `STRIPE_WEBHOOK_SECRET` | Sí, para que los webhooks funcionen | Dashboard → Developers → Webhooks → tu endpoint → "Signing secret" | Verifica que las notificaciones realmente vienen de Stripe. Empieza por `whsec_...`. |
| `PUBLIC_BASE_URL` | Recomendada | La URL pública real del sitio (ej. `https://academiamalevo.com`) | Se usa para las URLs de éxito/cancelación de Checkout. Si no la defines, el servidor la deduce de la petición entrante, pero en producción es más seguro fijarla. |
| `JWT_SECRET` | Ya existente, no es nueva | — | Sigue siendo obligatoria en producción, no relacionada con Stripe pero recordatorio de que debe estar puesta. |

Ejemplo de `.env`:

```
STRIPE_SECRET_KEY=sk_test_51AbC...
STRIPE_WEBHOOK_SECRET=whsec_AbC123...
PUBLIC_BASE_URL=https://academiamalevo.com
JWT_SECRET=una_clave_larga_y_aleatoria
```

**Sin estas dos primeras variables el servidor arranca igual** y todo lo
demás de la plataforma sigue funcionando — los endpoints `/api/stripe/*` y
`/api/portal/stripe/*` simplemente devuelven un error 503 con
`code:"NOT_CONFIGURED"` en vez de romper nada. Esto ya está verificado.

## 1.bis Acciones urgentes antes del primer cobro real

Al conectar el formulario de `registro-membresia.html` al backend real
encontré y corregí varios problemas en tu `.env` y en el código. Antes de
aceptar el primer pago real, revisa esto:

1. **Bug corregido — la clave `sk_live_` nunca se estaba usando.** Tu
   `.env` tenía la clave `STRIPE_SECRET_KEY` puesta dos veces (un bloque de
   prueba y, debajo, el bloque live). El servidor cargaba la **primera**
   que encontraba en el archivo, así que aunque añadiste la clave live,
   seguía usando la de test sin que se notara. Ya arreglé el cargador de
   `.env` (ahora, si hay una clave repetida, gana la última) y reordené el
   archivo para que solo el bloque `sk_live_...` esté activo (dejé el
   bloque de test comentado debajo, por si lo necesitas).
2. **`STRIPE_WEBHOOK_SECRET` es casi seguro un secreto de TEST, no de
   producción.** Tu `.env` tenía el mismo `whsec_...` repetido en ambos
   bloques — normalmente cada endpoint de webhook (test y live) tiene su
   propio secreto distinto en el Dashboard de Stripe. Si no has creado
   todavía un endpoint de webhook en **modo live** (Developers → Webhooks,
   con el switch en "Live"), los eventos reales de Stripe no van a
   verificar su firma correctamente y `manejarWebhook()` los rechazará.
   Sigue el paso 4 de la sección 3 de esta guía, pero asegurándote de estar
   en modo Live, y pon ese `whsec_` nuevo en `.env`.
3. **`PUBLIC_BASE_URL` tiene que apuntar siempre al dominio o IP pública
   real del LXC de Proxmox** (históricamente pasó por un dominio de Koyeb
   y luego uno de Render — ninguno de los dos sigue en pie). Como ahora
   todo corre en un único `.env` en el propio servidor, solo hay un lugar
   donde actualizarla: editá `.env`, guardá, y reiniciá el servicio
   (`systemctl restart malevo`) para que tome el nuevo valor. Si el
   dominio/IP volviera a cambiar, hay que repetir este paso (si no, los
   alumnos que paguen con tarjeta volverán de Stripe a una URL que ya no
   existe).
4. **No pude probar la creación real de la Checkout Session desde este
   entorno de desarrollo** — el sandbox donde trabajo no tiene salida a
   internet en absoluto (ni siquiera a `google.com`), así que cualquier
   llamada real a la API de Stripe falla por conexión, no por un error de
   tu cuenta ni de las claves. Sí pude verificar con certeza: que la clave
   live ahora se carga correctamente, que el registro/token de invitación
   funciona, y que guardar los datos fiscales ya no se bloquea (ver punto
   siguiente). Falta una prueba real de extremo a extremo — con una tarjeta
   de test primero — ya en tu servidor real con acceso a internet.
5. **Bug corregido — un alumno recién registrado no podía llegar a pagar.**
   La cuenta que crea `/api/onboarding/register` queda `active:false` hasta
   completar el pago (correcto), pero las rutas para guardar datos fiscales
   y crear la Checkout Session (`/api/portal/facturacion` y
   `/api/portal/stripe/checkout-session`) bloqueaban justamente a las
   cuentas inactivas — un alumno nuevo pagando con tarjeta se quedaba
   atrapado sin poder llegar a pagar. Añadí una excepción específica para
   esas dos rutas (más `/api/portal/stripe/estado`) que sí permite pasar a
   una cuenta con pago pendiente; el resto del contenido (clases, vídeos,
   perfil…) sigue bloqueado igual que antes hasta que el pago se confirme.
6. **Cookies de sesión llevan `Secure` en producción.** La cookie
   `malevo_jwt` incluye el flag `Secure` automáticamente cuando la
   petición llega por HTTPS. En el LXC de Proxmox esto depende de que el
   reverso proxy que tengas delante (nginx, Caddy, etc.) reenvíe la
   cabecera `x-forwarded-proto: https` — si no lo hace, revisa su
   configuración, porque de eso depende también `esConexionLocal()` (ver
   comentarios en `server.js`). No se añade en `http://localhost` para no
   romper el desarrollo local. No hace falta ninguna variable nueva.
7. **`.env.example` como plantilla.** Sirve para saber qué variables hacen
   falta sin exponer valores reales; el `.env` real con las claves vive
   solo en el disco del LXC y nunca debe compartirse.
8. **Persistencia de datos — backup opcional en Firebase Storage (ver
   sección 1.ter).** Este servidor guarda todo en `data/db.json`, un
   archivo plano en disco. El disco del LXC de Proxmox es persistente, así
   que esto ya no es indispensable para no perder datos entre reinicios —
   pero sigue siendo una red de seguridad útil ante un fallo de disco o un
   borrado accidental: cada vez que se guarda algo, el servidor sube
   automáticamente una copia de `db.json` a Firebase Storage, y al
   arrancar restaura la última copia guardada antes de abrir el puerto.
   Sección 1.ter tiene el paso a paso para activarlo (opcional).

## 1.ter Backup en Firebase Storage (opcional, red de seguridad)

`db.json` se puede respaldar solo en Firebase Storage y restaurarse solo al
arrancar el servidor — útil como red de seguridad extra aunque el disco del
LXC ya sea persistente. El código ya está implementado (`firebase.js` + los
hooks en `server.js`); esto es lo que hace falta configurar en el Dashboard
de Firebase y en el `.env` del servidor:

1. **Confirma que el proyecto de Firebase tiene Storage activado.**
   Firebase Console → tu proyecto (`malevo-academia`) → menú lateral
   **Storage** → si no está activado todavía, pulsa "Comenzar" y crea el
   bucket por defecto (modo producción está bien, las reglas de seguridad
   de Storage no importan aquí porque el backend accede con la cuenta de
   servicio, no con el SDK de cliente).
2. **Genera (o reutiliza) la clave de la cuenta de servicio:** Firebase
   Console → ⚙️ **Configuración del proyecto** → pestaña **Cuentas de
   servicio** → "Generar nueva clave privada". Se descarga un archivo
   `.json` — no lo compartas ni lo subas a ningún control de versiones.
3. **Dos formas de usar ese JSON en el LXC** (ver también `firebase.js` y
   `.env.example`):
   - Guardarlo tal cual como `data/firebase-service-account.json` (la más
     simple, con disco persistente).
   - O pegar su contenido completo en una sola línea en la variable
     `FIREBASE_SERVICE_ACCOUNT_JSON` de tu `.env`.
   - No hace falta tocar `FIREBASE_STORAGE_BUCKET` salvo que tu bucket no
     siga el patrón `<project_id>.appspot.com` (algunos proyectos nuevos
     usan `<project_id>.firebasestorage.app` — en ese caso añade también
     esa variable con el nombre exacto del bucket).
4. **Reinicia el servicio** (`systemctl restart malevo`) para que arranque
   con la credencial ya puesta.
5. **Verifica en los logs** (`journalctl -u malevo -f`), justo después de
   que arranque:
   - `Firebase: conectado (proyecto malevo-academia, bucket ...)` — confirma
     que las credenciales son válidas.
   - `✓ db.json restaurado desde el último backup de Firebase Storage.` (o,
     la primera vez que actives esto, `… Sin backup de Firebase Storage
     disponible...` porque todavía no existe ningún backup subido — es
     normal en el primer arranque).
   - Después de cualquier alta, pago o cambio guardado, unos segundos
     después: `✓ Backup de db.json subido a Firebase Storage.`
6. **Prueba real de extremo a extremo:** haz un cambio cualquiera (por
   ejemplo, edita un alumno de prueba), espera a ver el log de "Backup
   subido", y luego reinicia el servicio (`systemctl restart malevo`). Si
   al volver a arrancar ves "db.json restaurado..." y el cambio de prueba
   sigue ahí, la persistencia está funcionando correctamente.
7. Si no configurás ninguna de las dos credenciales o Firebase falla por
   cualquier motivo, el servidor sigue arrancando y funcionando igual con
   el `db.json` local — solo que sin este respaldo extra. Esto nunca
   bloquea ni rompe la app.

## 2. Paquete `stripe` — ya instalado

`node_modules/stripe` está presente (v17.7.0) y carga correctamente. Si en
algún despliegue nuevo no estuviera, basta con `npm install` en la raíz del
proyecto — el código ya detecta solo si el paquete está o no
(`try{require('stripe')}catch{...}`).

## 3. Pasos manuales en el Dashboard de Stripe

1. **Crear la cuenta** (si no existe) en https://dashboard.stripe.com y
   activarla en modo Test primero.
2. **Copiar la clave secreta** (Developers → API keys → "Secret key") y
   ponerla en `STRIPE_SECRET_KEY`.
3. **No hace falta crear productos ni precios a mano** — el servidor los
   crea solos la primera vez que alguien paga cada plan (`ensurePriceId()`
   en `stripe-billing.js`), usando los importes ya configurados en
   `db.config.precios`. Los verás aparecer en Developers → Products a
   medida que se usen.
4. **Configurar el webhook**:
   - Ve a Developers → Webhooks → "Add endpoint" (con el switch en modo
     **Live**, arriba a la derecha del Dashboard).
   - URL del endpoint: `https://tu-dominio-o-ip-proxmox.com/api/stripe/webhook`
     (usando el mismo dominio/IP que pusiste en `PUBLIC_BASE_URL`; en local
     con Stripe CLI, ver sección 4).
   - Eventos a escuchar (marca exactamente estos 5):
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
   - Guarda y copia el "Signing secret" (empieza por `whsec_`) en
     `STRIPE_WEBHOOK_SECRET`.
5. **Activar Smart Retries** (reintentos automáticos ante pagos fallidos):
   Dashboard → Settings → Billing → Revenue recovery → activa "Smart
   Retries". Esto es una configuración de cuenta, no algo que el código
   controle — una vez activado, Stripe reintenta los cobros fallidos
   automáticamente y dispara `invoice.payment_failed` en cada intento y,
   si finalmente no cobra, `customer.subscription.deleted` (o el estado
   queda en `past_due`/`unpaid`, que el webhook ya traduce a `en_deuda`).
6. **Revisar el email de recibos de Stripe** (opcional): Settings → Emails,
   por si quieres que Stripe también mande su propio recibo automático
   además de tu factura en PDF.

## 4. Probar en local con Stripe CLI

Para recibir webhooks en tu máquina de desarrollo (que no tiene URL
pública), usa la [Stripe CLI](https://stripe.com/docs/stripe-cli):

```
stripe login
stripe listen --forward-to localhost:8081/api/stripe/webhook
```

Este comando te da un `whsec_...` temporal — úsalo como
`STRIPE_WEBHOOK_SECRET` mientras pruebas en local. Con `stripe trigger
customer.subscription.created` (y los otros 4 eventos) puedes simular cada
webhook sin necesidad de completar un pago real.

Para el checkout en sí, usa las tarjetas de prueba de Stripe, por ejemplo
`4242 4242 4242 4242` con cualquier fecha futura y CVC.

## 5. Qué hace cada pieza ya implementada

- **Alta con Stripe**: en `registro-membresia.html` (el formulario tipo app
  con los 4 bonos), el alumno ve 3 opciones de pago (Tarjeta, Bizum,
  Transferencia) que son solo una preferencia informativa — elija la que
  elija, se crea la cuenta (inactiva, pago pendiente) y se le redirige
  siempre a Stripe Checkout de verdad; al terminar, Stripe lo devuelve a
  `portal.html?stripe=ok`. La cuenta solo se activa cuando el webhook
  `checkout.session.completed` confirma el pago — no existe ninguna vía
  para activar una cuenta sin pasar por Stripe (el viejo endpoint de
  auto-confirmación manual se eliminó por seguridad).
- **Bono 5 Clases (pago único) — ya admite tarjeta.** No es una cuota
  recurrente, así que usa Stripe Checkout en `mode:'payment'` (sin
  permanencia, sin Price cacheado — el importe se define al vuelo). El
  webhook registra ese cobro directamente en `checkout.session.completed`
  (un pago único no genera facturas/invoices como una suscripción).
- **Permanencia**: cada plan tiene sus meses de permanencia configurados en
  `db.config.permanenciaMeses` (por defecto: 35€ → 0 meses, 50€ → 2 meses,
  80€ → 2 meses, bono → 0 meses). Es editable directamente en `data/db.json`
  si cambian las condiciones comerciales.
- **Bloqueo de cancelación**: si el alumno no cumplió la permanencia,
  `/api/portal/stripe/cancelar` devuelve el mensaje exacto pedido: *"Tu
  tarifa tiene un compromiso de permanencia activa de X meses. Para
  gestionar tu baja o cambio de plan, ponte en contacto con
  administración."* Si ya la cumplió, la baja se programa para el final
  del periodo ya pagado (el alumno no pierde el acceso a mitad de mes).
- **Webhook**: `manejarWebhook()` en `stripe-billing.js` procesa los 5
  eventos pedidos, con verificación de firma y sin duplicar pagos aunque
  Stripe reenvíe el mismo evento más de una vez.
- **Datos fiscales**: se piden en el registro (si paga con tarjeta) y
  también se pueden completar/editar después desde "Mi perfil" en el
  portal del alumno. Ya se incluyen en el PDF de cada factura individual,
  y quedan disponibles para alimentar los Informes Trimestral y Anual
  igual que cualquier otro pago.
- **Panel de administración**: la ficha de cada alumno (Alumnos → Editar)
  muestra en solo lectura el estado de su suscripción de Stripe, la
  permanencia y si sus datos fiscales están completos.

## 6. Checklist antes de pasar a producción

- [x] Paquete `stripe` instalado (`node_modules/stripe` v17.7.0 detectado).
- [x] `STRIPE_SECRET_KEY` con la clave **live** activa en `.env` (corregido
      el bug que hacía que se siguiera usando la de test).
- [ ] `PUBLIC_BASE_URL` puesta en el `.env` del LXC con el dominio/IP
      pública real de Proxmox (ver `.env.example`) — actualizar y reiniciar
      el servicio (`systemctl restart malevo`) cada vez que ese dominio/IP
      cambie.
- [x] Cookies de sesión con `Secure` automático en HTTPS (depende de que el
      reverso proxy delante del LXC reenvíe `x-forwarded-proto: https`).
- [x] `.env.example` añadido como plantilla (secretos fuera del repo/backup).
- [x] Bono 5 Clases: pago único por tarjeta implementado.
- [x] `STRIPE_WEBHOOK_SECRET` con el secreto real del endpoint Live puesto
      en `.env` — verificado que el servidor lo carga y lo usa para
      validar firmas (probado con una firma falsa: rechaza con 400, no
      revienta).
- [ ] Confirma que el endpoint de webhook en el Dashboard de Stripe apunta
      exactamente al dominio/IP real del LXC
      (`https://tu-dominio-o-ip-proxmox.com/api/stripe/webhook`) y está en
      modo Live con los 5 eventos marcados (sección 3, paso 4). Si el
      endpoint ya existía apuntando a un dominio viejo (Koyeb o Render),
      podés editar su URL directamente en el Dashboard sin perder el mismo
      `whsec_` (Developers → Webhooks → tu endpoint → editar URL).
- [ ] **Backup en Firebase Storage configurado (opcional pero recomendado)**
      — ver sección 1.ter. Con disco persistente en el LXC ya no es
      indispensable, pero sigue siendo la red de seguridad ante un fallo de
      disco o un borrado accidental. Verifica en los logs
      (`journalctl -u malevo -f`) los mensajes "Firebase: conectado...",
      "db.json restaurado..." y, tras cualquier cambio, "Backup de db.json
      subido...".
- [ ] Smart Retries activado en Settings → Billing.
- [ ] Prueba de extremo a extremo con una tarjeta de test (`4242 4242 4242
      4242`) hecha **desde el LXC ya desplegado en Proxmox** (con acceso a
      internet) — no pude completarla yo desde este entorno de desarrollo,
      que no tiene salida a internet en absoluto.
- [ ] Registro real de prueba con importe pequeño y una tarjeta real antes
      de anunciarlo a los alumnos.
- [ ] Confirmar que el servicio `malevo` (systemd) arranca solo al reiniciar
      el LXC y se reinicia solo si el proceso Node se cae
      (`systemctl status malevo`, ver `DEPLOY-PROXMOX-LXC.md`).
