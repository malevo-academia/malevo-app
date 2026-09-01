# Checklist de migración a producción — Mini PC

Migración definitiva desde Render (sin espacio/recursos) a tu mini PC. Esta lista está hecha específicamente para este proyecto (Malevo Academia), hoy corriendo con `PUBLIC_BASE_URL=https://malevo-app.onrender.com` y Stripe en modo LIVE. El objetivo es pasar el servicio real a la mini PC sin perder datos ni romper pagos/logins. Se puede ir marcando a medida que se avanza; convivirá con las modificaciones chicas que sigamos haciendo antes del corte final — si alguna de esas modificaciones toca `.env`, `db.json` o rutas de archivos, hay que reflejarlo acá también.

**Nota sobre el espacio en Render:** una causa probable de que se haya quedado sin espacio es que las fotos de perfil de los alumnos viajan embebidas como texto base64 dentro de `db.json` (con solo 3 usuarios, hoy pesa ~10 MB, y cada backup manual guarda otra copia completa de ese tamaño en `data/backups/`). En la mini PC esto deja de ser un problema de cuota (es tu propio disco), pero si en el futuro la academia crece mucho en alumnos, convendría migrar esas fotos a archivos sueltos en vez de base64 — no es necesario para esta migración, es solo algo a tener en el radar.

## 1. Respaldo antes de tocar nada

- [ ] Copia completa de `data/` (incluye `db.json`, `data/backups/`, `data/firebase-service-account.json`, `data/vapid.json`) a un lugar fuera del proyecto (USB, disco externo, o simplemente otra carpeta).
- [ ] Confirmar que el backup automático en Firebase Storage está al día: mirar el log del servidor al último `writeDB()` o forzar un cambio chico desde el panel y verificar que no tira error de subida.
- [ ] Revisar `data/backups/` (hoy tiene ~7 snapshots de ~10 MB cada uno, de limpiezas anteriores) y decidir cuáles conservar — no hace falta viajar con todos a la mini PC, pero no borrar ninguno sin tener el respaldo del punto anterior hecho.
- [ ] Exportar/anotar el `.env` actual de Render (Environment → Environment Variables) tal como está hoy, para no perder ningún valor al recrearlo en la mini PC.

## 2. Variables de entorno (`.env`)

En la mini PC este archivo se crea a mano (no existe panel de Render). Copiar `.env.example` a `.env` y completar:

- [ ] `JWT_SECRET` — usar el **mismo valor** que en Render si vas a migrar sesiones activas, o uno nuevo si preferís que todos vuelvan a loguearse una vez.
- [ ] `STRIPE_SECRET_KEY` — la clave LIVE actual.
- [ ] `STRIPE_WEBHOOK_SECRET` — **este va a cambiar**: cuando actualices la URL del webhook en el Dashboard de Stripe (ver sección 6), Stripe te da un secreto nuevo para ese endpoint. No sirve reusar el de Render.
- [ ] `PUBLIC_BASE_URL` — la URL final por la que se va a acceder a la app (dominio propio, DDNS, o IP fija). Todo enlace que genera la app (links de pago, links de Cursos Exclusivos, links de referidos, facturas) sale mal si esto queda apuntando a Render.
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` — opcional en la mini PC (ver nota de la sección 3), pero si lo dejás, tiene que ser el JSON completo en una sola línea, igual que en Render.
- [ ] `DATA_DIR` — dejarlo sin definir para que use `./data` por defecto, salvo que quieras que la base viva en otro disco/partición de la mini PC.
- [ ] `PORT` — por defecto 8081; definirlo solo si ese puerto ya está ocupado en la mini PC.
- [ ] Verificar que `.env` **no** se sube a git (ya está en `.gitignore`) y que sus permisos no son de lectura pública (`chmod 600 .env` en Linux; en Windows, restringir el acceso solo a tu usuario).

## 3. Base de datos (`data/`) y el backup automático a Firebase

- [ ] Copiar toda la carpeta `data/` a la mini PC, en la misma ruta relativa al proyecto (o la que definas en `DATA_DIR`).
- [ ] **Punto importante y no obvio**: `server.js` restaura automáticamente el último backup de Firebase Storage sobre `db.json` cada vez que arranca (antes de abrir el puerto), sobrescribiendo lo que haya en el disco local. Esto está pensado para el plan gratuito de Render (que borra el disco en cada redeploy), pero en la mini PC el disco es persistente — así que:
  - Si dejás Firebase configurado, cada reinicio del proceso va a jalar la última copia de Firebase. Mientras el flujo normal sea "todo pasa por la app", esto no genera problemas (Firebase siempre tiene la copia más reciente, por el backup automático de cada escritura).
  - Si alguna vez editás `db.json` a mano por fuera del servidor (con el server apagado), ese cambio se pierde en el próximo arranque a menos que también subas esa versión a Firebase Storage manualmente, o comentes temporalmente la línea `await firebaseBackup.restaurarDBDesdeBackup(DB_FILE)` en `iniciarServidor()`.
  - Alternativa más simple si no querés depender de Firebase en la mini PC: dejar `FIREBASE_SERVICE_ACCOUNT_JSON` sin definir — el servidor sigue funcionando 100% con el `db.json` local (el log va a avisar "Firebase desactivado, se sigue usando solo db.json local"), pero perdés el respaldo automático fuera del sitio. Recomendado: mantenerlo activo igual, como red de seguridad ante un fallo de disco de la mini PC.
- [ ] Confirmar que el arranque en la mini PC deja el proceso **detenerse con una señal limpia** (Ctrl+C, `systemctl stop`, `pm2 stop`) y no con un corte de energía o `kill -9` — el servidor tiene hasta 8 segundos de gracia para terminar de subir el último cambio a Firebase antes de cerrar; si se corta la luz en ese margen, ese último cambio puede no llegar a la copia remota (el local sí queda guardado).

## 4. Carpetas de imágenes / assets

- [ ] `assets/` (~1,3 MB: logos, íconos, imágenes de fondo) — copiar tal cual.
- [ ] `tarjetas/` (~29 MB: ilustraciones de calendario, colores, desbloqueo, racha, reproductor, tarjeta de pago) — copiar tal cual.
- [ ] Portadas de Cursos Exclusivos: hoy son URLs de Google Drive embebidas en `db.json` (no archivos locales) — no requieren copia de carpeta, pero sí que la mini PC tenga salida a internet para poder cargarlas.
- [ ] Fotos de perfil de alumnos: confirmado, están embebidas como base64 dentro de `db.json` (por eso pesa ~10 MB con solo 3 usuarios) — ya viajan con el `db.json` del punto 3, no hace falta copiar ninguna carpeta aparte para esto.
- [ ] `data/firebase-service-account.json` y `data/vapid.json` no son "imágenes" pero son archivos sensibles/con estado que también deben viajar con `data/` (ya cubiertos en la sección 3) — vapid.json en particular: si se pierde o se regenera, las suscripciones push existentes de los alumnos dejan de funcionar hasta que vuelvan a aceptar notificaciones.

## 5. Dependencias y entorno de ejecución

- [ ] Node.js **18 o superior** instalado en la mini PC (`node -v`) — es el mínimo declarado en `package.json`.
- [ ] **No copiar `node_modules/`** desde este entorno — correr `npm install` directo en la mini PC (así quedan los binarios correctos para su sistema operativo/arquitectura).
- [ ] Copiar `package.json` y `package-lock.json` para que `npm install` instale exactamente las mismas versiones (`archiver`, `firebase-admin`, `pdfkit`, `stripe`).
- [ ] Probar `npm start` (ejecuta `node server.js`) una vez con todo en su lugar, revisando el log de arranque: debe decir Stripe configurado, Firebase conectado (si aplica) y el puerto correcto — sin errores de `DATA_DIR`.

## 6. Acceso público, dominio y HTTPS

`server.js` levanta un servidor **HTTP plano** (sin TLS propio) — Render hoy hace el HTTPS por vos. Si la mini PC va a ser accesible desde internet (no solo en tu red local), esto es crítico:

- [ ] Definir cómo se va a acceder desde afuera: dominio propio, DDNS (No-IP, DuckDNS, etc.) o IP fija — ese valor es el que va en `PUBLIC_BASE_URL`.
- [ ] Poner un proxy inverso delante del proceso Node (Caddy o nginx son los más simples) que:
  - Termine el HTTPS (certificado, por ejemplo con Let's Encrypt/Caddy automático).
  - Reenvíe a `http://127.0.0.1:8081` (o el puerto que uses).
  - **Agregue las cabeceras `X-Forwarded-For` y `X-Forwarded-Proto`** — Caddy y nginx lo hacen por defecto en su `reverse_proxy`/`proxy_pass`, pero conviene verificarlo explícitamente.
- [ ] **Por qué el punto anterior no es opcional**: el bypass de login para pruebas locales (`/api/dev-auto-login`, que deja entrar sin contraseña) solo se desactiva cuando la petición trae cabeceras `X-Forwarded-*` — si el proxy no las agrega, cualquier persona en internet podría loguearse como admin sin contraseña a través del proxy. Verificarlo con una prueba real desde afuera de la red local antes de dar el servicio por expuesto.
- [ ] Configurar port forwarding en el router de tu casa/local si corresponde (puerto 443 hacia la mini PC), o confirmar que el proveedor de internet no bloquea puertos entrantes.
- [ ] Actualizar en el Dashboard de Stripe (modo Live) la URL del webhook al nuevo `PUBLIC_BASE_URL` + la ruta del webhook, y copiar el nuevo `STRIPE_WEBHOOK_SECRET` al `.env` (ver sección 2).
- [ ] Si vas a mantener la app funcionando solo dentro de tu red local (sin exponerla a internet), podés saltear el HTTPS/proxy, pero entonces los alumnos solo van a poder entrar conectados a esa misma red — confirmar que es lo que querés.

## 7. Que el proceso quede siempre encendido

- [ ] Elegir un supervisor de procesos que reinicie `node server.js` solo si se cae, y lo levante automáticamente si la mini PC se reinicia (por ejemplo `pm2` con `pm2 startup` + `pm2 save`, un servicio de `systemd` en Linux, o una Tarea Programada/Servicio de Windows si la mini PC corre Windows).
- [ ] UPS o algo similar si los cortes de luz son frecuentes en tu zona — evita apagados abruptos que puedan perder el último cambio no respaldado (ver sección 3).
- [ ] Definir quién monitorea que el servicio siga arriba (alertas del supervisor, o un chequeo manual periódico).

## 8. Corte desde Render (día de la migración)

- [ ] Con la mini PC lista y probada (ver sección 9) pero **todavía sin tráfico real**, hacer un último respaldo de `db.json` en Render (la copia de Firebase Storage ya debería tenerlo, pero confirmalo).
- [ ] Cambiar el DNS/dominio (o avisar a los alumnos del nuevo enlace, si no hay dominio propio) para que apunte a la mini PC.
- [ ] Actualizar el webhook de Stripe a la nueva URL (si no se hizo ya en la sección 6) — hacerlo justo antes del corte para minimizar la ventana sin webhook activo.
- [ ] Pausar o apagar el servicio de Render una vez confirmado que la mini PC responde bien, para que no queden dos instancias escribiendo `db.json` al mismo tiempo (eso sí puede corromper datos).
- [ ] Guardar/archivar la configuración de Render (por si hace falta volver atrás de urgencia).

## 9. Prueba funcional final (antes de anunciar el cambio)

- [ ] Login de admin (Gaston/Gimena) con contraseña real.
- [ ] Login passwordless de un alumno de prueba (no el "alumno preferido" real, para no generarle notificaciones de más).
- [ ] Alta manual de un alumno + generación del link directo al portal.
- [ ] Un pago de prueba real con Stripe en modo LIVE de bajo monto (o al menos confirmar que el checkout carga y el webhook llega — revisar logs).
- [ ] Generar un enlace de Curso Exclusivo, abrirlo desde otro dispositivo/red (para probar el `PUBLIC_BASE_URL` real) y confirmar que canjea bien y redirige al portal.
- [ ] Subir/editar un curso y confirmar que las portadas de Google Drive cargan (prueba de que la mini PC tiene salida a internet correcta).
- [ ] Descargar una factura en PDF.
- [ ] Confirmar que las notificaciones push siguen andando para un alumno que ya las tenía activadas antes de la migración (valida que `vapid.json` viajó bien).
- [ ] Reiniciar el proceso a propósito (`pm2 restart` o el equivalente) y confirmar que levanta solo, con los datos intactos.
