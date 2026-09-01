# Guía de despliegue — Malevo Academia en un LXC de Proxmox

Esta guía reemplaza a `CHECKLIST-MIGRACION-MINI-PC.md` (que queda como
referencia histórica) y a cualquier despliegue previo en Render/Koyeb. El
proyecto ya no usa Git ni GitHub: no hay `.git` en la carpeta, así que la
"instalación" es simplemente copiar los archivos al LXC. Stripe y Firebase
se mantienen tal cual, controlados por variables de entorno en un único
`.env` local (ver `.env.example`).

## 0. Qué vas a necesitar antes de empezar

- Un servidor Proxmox VE funcionando, con acceso a su interfaz web
  (`https://IP_DEL_HOST:8006`) o por SSH.
- El proyecto completo (esta carpeta) en tu máquina Windows — no hace
  falta ni Git ni GitHub para transferirlo, solo copiarlo tal cual.
- Un rato sin cortes de red entre tu máquina y el Proxmox (la copia del
  proyecto es liviana salvo por `tarjetas/`, ~29 MB).

## 1. Crear el LXC en Proxmox

Si ya tenés un LXC creado y solo querés instalar la app ahí, saltá al
paso 2.

### Opción A — desde la interfaz web de Proxmox (más simple)

1. Entrá a `https://IP_DEL_HOST:8006` con tu usuario de Proxmox.
2. Botón **"Create CT"** (arriba a la derecha).
3. **General**: elegí un `CT ID` libre (por ejemplo 110), un `Hostname`
   (por ejemplo `malevo`), y una contraseña de root para el contenedor.
4. **Template**: descargá si no lo tenés ya un template de **Debian 12**
   o **Ubuntu 22.04/24.04** (Storage → tu storage de templates → botón
   "Templates" → buscar y descargar). Elegilo ahí.
5. **Disks**: 8 GB alcanzan de sobra para este proyecto (el `db.json` con
   fotos de perfil hoy pesa unos pocos MB); dejalo en 8–16 GB si querés
   margen para backups locales.
6. **CPU**: 1–2 núcleos sobra.
7. **Memory**: 512 MB–1 GB sobra (Node + el proceso es liviano).
8. **Network**: bridge `vmbr0` (o el que uses), y fijá una IP estática si
   podés (evita que cambie y te obligue a tocar `PUBLIC_BASE_URL` de
   nuevo) — o dejá DHCP y luego reservá esa IP en tu router.
9. **DNS**: los valores por defecto del host suelen andar bien.
10. Confirmá y arrancá el contenedor (botón "Start" una vez creado).

### Opción B — desde la consola del host Proxmox (`pct`)

Por SSH al host de Proxmox (no al LXC):

```
# Ver templates ya descargados:
pveam available --section system | grep -i "debian-12\|ubuntu-22\|ubuntu-24"
pveam download local debian-12-standard_12.7-1_amd64.tar.zst

# Crear el contenedor (ajustar storage, IP, CTID a tu entorno):
pct create 110 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname malevo \
  --cores 2 \
  --memory 1024 \
  --swap 512 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=192.168.1.50/24,gw=192.168.1.1 \
  --unprivileged 1 \
  --features nesting=1 \
  --password

pct start 110
pct enter 110   # te deja directo en una shell dentro del LXC
```

Ajustá `ip=`/`gw=` a tu red real, o usá `ip=dhcp` si preferís que la
asigne el router (y después reservarla ahí para que no cambie).

## 2. Preparar el LXC (Node.js y usuario dedicado)

Ya dentro del LXC (por la consola web de Proxmox, `pct enter`, o SSH):

```
apt update && apt install -y curl sudo openssh-server
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # confirmar >= 18 (requisito de package.json)
```

`openssh-server` es opcional pero recomendado: te permite copiar el
proyecto por `scp`/SFTP desde tu máquina Windows sin depender de la
consola del navegador. Si lo instalás, anotá la IP del LXC (`ip a`) y
verificá que el servicio corre: `systemctl status ssh`.

Crear el usuario dedicado que va a correr el servicio (sin privilegios de
root, sin shell de login):

```
useradd -r -m -d /opt/malevo -s /usr/sbin/nologin malevo
```

Si preferís usar tu propio usuario en vez de uno dedicado, ajustá
`User=`/`Group=` en `malevo.service` más adelante.

## 3. Copiar el proyecto al LXC (crear y poblar la carpeta)

El objetivo es que el contenido de esta carpeta termine en `/opt/malevo`
dentro del LXC — **excepto** `node_modules/` (se reinstala en el paso 5,
con los binarios correctos para la arquitectura del LXC). No hay `.git`
que excluir porque ya no existe.

Primero, crear la carpeta destino dentro del LXC (si no existe todavía):

```
mkdir -p /opt/malevo
```

Después, elegí **una** de estas formas de transferir los archivos desde tu
máquina Windows — cualquiera deja el mismo resultado:

**Opción A — WinSCP (la más simple si nunca usaste una terminal Linux)**

1. Descargá e instalá [WinSCP](https://winscp.net) si no lo tenés.
2. Conexión nueva: protocolo SFTP, `Host name` = la IP del LXC, `User
   name` = `root` (o el usuario que uses), la contraseña que pusiste al
   crear el LXC, puerto 22.
3. En el panel izquierdo (tu PC), navegá hasta la carpeta del proyecto:
   `E:\MALEVO\IA\Aplicaciones\Malevo aplicacion\Malevo`.
4. En el panel derecho (el LXC), navegá a `/opt/malevo`.
5. Seleccioná todos los archivos y carpetas del panel izquierdo
   **excepto `node_modules`** (si existiera) y arrastralos al panel
   derecho para subirlos.

**Opción B — `scp` desde PowerShell** (Windows 10/11 trae `scp` incluido):

```powershell
# Desde PowerShell, parado en la carpeta del proyecto:
cd "E:\MALEVO\IA\Aplicaciones\Malevo aplicacion\Malevo"
scp -r * root@IP_DEL_LXC:/opt/malevo/
```

Si `node_modules` ya existe localmente, excluilo copiando todo menos esa
carpeta (por ejemplo moviéndola afuera temporalmente, o listando los
archivos/carpetas necesarios explícitamente en vez de usar `*`).

**Opción C — subir un .zip y descomprimirlo dentro del LXC**

Útil si la conexión es inestable para copiar muchos archivos sueltos:

```powershell
# En Windows, comprimí la carpeta del proyecto (sin node_modules) a
# malevo.zip, por ejemplo con el propio Explorador de Windows
# (clic derecho → Enviar a → Carpeta comprimida), y luego:
scp "malevo.zip" root@IP_DEL_LXC:/opt/
```

```bash
# Dentro del LXC:
apt install -y unzip
cd /opt && unzip malevo.zip -d malevo
```

**Opción D — desde la consola web de Proxmox (sin SSH)**

Si no querés habilitar SSH: Datacenter → tu LXC → pestaña **"Console"**
te da una terminal dentro del contenedor, pero no permite arrastrar
archivos directamente. Para subir archivos sin SSH, la vía más simple es
montar un recurso compartido de red (SMB/NFS) accesible desde el LXC, o
usar el propio storage de Proxmox: subí el `.zip` del proyecto como
"ISO"/archivo al storage del host desde la interfaz web (Storage → tu
storage → Upload), y luego, en la consola del LXC, copialo desde la ruta
del storage montada en el host (por ejemplo `/var/lib/vz/template/iso/`)
y descomprimilo en `/opt/malevo`.

### Una vez copiado, dentro del LXC:

```bash
ls /opt/malevo               # confirmar que server.js, package.json, etc. están ahí
chown -R malevo:malevo /opt/malevo
```

## 4. Variables de entorno (`.env`)

Copiar `.env.example` a `.env` dentro de `/opt/malevo` y completar (ver el
propio archivo para el detalle de cada variable):

```bash
cd /opt/malevo
cp .env.example .env
nano .env   # o el editor que prefieras
chmod 600 .env
chown malevo:malevo .env
```

- `JWT_SECRET` — un valor largo y aleatorio. Si migrás desde otro entorno y
  querés conservar sesiones activas, usá el mismo valor; si no, uno nuevo
  (todos los alumnos deberán volver a loguearse una vez).
- `STRIPE_SECRET_KEY` — la clave live actual.
- `STRIPE_WEBHOOK_SECRET` — **este cambia**: al actualizar la URL del
  webhook en el Dashboard de Stripe (paso 9) te da un secreto nuevo para
  ese endpoint. No sirve reusar uno viejo de Render/Koyeb.
- `PUBLIC_BASE_URL` — la URL final por la que se accede a la app (dominio
  propio o IP fija del LXC). Todos los enlaces que genera la app (pagos,
  Cursos Exclusivos, referidos, facturas) salen mal si esto queda
  apuntando a una URL vieja.
- `FIREBASE_SERVICE_ACCOUNT_JSON` o `data/firebase-service-account.json` —
  opcional, para el backup en Firebase Storage (ver sección 6).
- `DATA_DIR` — dejar sin definir para usar `./data` por defecto, salvo que
  quieras que la base viva en otro punto de montaje del LXC.
- `PORT` — por defecto 8081; definilo solo si ese puerto ya está ocupado.

## 5. Instalar dependencias

Dentro de `/opt/malevo`:

```bash
cd /opt/malevo
npm install --omit=dev
```

Esto usa `package.json`/`package-lock.json` para instalar exactamente
`archiver`, `firebase-admin`, `pdfkit` y `stripe` en las versiones
correctas para este LXC.

## 6. Base de datos (`data/`) y el backup en Firebase Storage

- El disco del LXC es persistente: `data/db.json` no se pierde entre
  reinicios ni al reiniciar el servicio. El backup en Firebase Storage
  (ver `firebase.js` y sección 1.ter de `STRIPE-SETUP.md`) ya no es
  indispensable por eso, pero sigue siendo útil como red de seguridad ante
  un fallo de disco o un borrado accidental — se recomienda dejarlo
  activo.
- Si venís de otro entorno, la carpeta `data/` completa (incluye
  `db.json`, `data/backups/`, `data/firebase-service-account.json` si
  existe, y `data/vapid.json` — este último es necesario para que las
  notificaciones push de alumnos que ya las activaron sigan funcionando)
  ya debería haber viajado junto con el resto del proyecto en el paso 3.
- **Punto no obvio**: al arrancar, `server.js` intenta restaurar el último
  backup de Firebase Storage sobre `db.json` *antes* de abrir el puerto
  (pensado originalmente para un disco efímero). En este LXC con disco
  persistente, eso significa que si editás `db.json` a mano con el
  servicio detenido, ese cambio se pierde en el próximo arranque a menos
  que también lo subas a Firebase Storage, o comentes temporalmente la
  línea `await firebaseBackup.restaurarDBDesdeBackup(DB_FILE)` en
  `iniciarServidor()` (`server.js`).

## 7. Assets

- `assets/` y `tarjetas/` — copiar tal cual junto con el resto del
  proyecto (ya cubierto en el paso 3).
- Portadas de Cursos Exclusivos: son URLs de Google Drive embebidas en
  `db.json`, no archivos locales — solo requieren que el LXC tenga salida
  a internet para cargarlas.
- Fotos de perfil de alumnos: van embebidas en base64 dentro de
  `data/db.json`, ya cubiertas al copiar `data/`.

## 8. Servicio systemd

Este proyecto incluye `malevo.service`, ya preparado para systemd (ver ese
archivo para el detalle de cada línea). Instalarlo:

```bash
cp /opt/malevo/malevo.service /etc/systemd/system/malevo.service
# Editar WorkingDirectory/User/Group ahí si usaste otra ruta o usuario.
systemctl daemon-reload
systemctl enable --now malevo
systemctl status malevo
journalctl -u malevo -f
```

Con esto, el servicio arranca solo si el LXC se reinicia y se reinicia
solo si el proceso Node se cae — sin depender de `pm2` ni de dejar una
terminal abierta.

## 9. Acceso público, dominio y HTTPS

`server.js` levanta un servidor **HTTP plano** (sin TLS propio) — antes lo
resolvía la plataforma (Render/Koyeb); ahora hay que resolverlo dentro del
propio Proxmox/LXC:

- Definir cómo se va a acceder desde afuera: dominio propio, DDNS, o IP
  fija — ese valor es el que va en `PUBLIC_BASE_URL`.
- Poner un proxy inverso delante del proceso Node (nginx o Caddy son los
  más simples; puede correr en el mismo LXC o en otro dedicado a "puerta
  de entrada") que:
  - Termine el HTTPS (certificado, por ejemplo con Let's Encrypt).
  - Reenvíe a `http://127.0.0.1:8081` (o el puerto que uses).
  - **Agregue las cabeceras `X-Forwarded-For` y `X-Forwarded-Proto`** —
    nginx y Caddy lo hacen por defecto en `proxy_pass`/`reverse_proxy`,
    pero conviene verificarlo explícitamente.
- **Por qué esto no es opcional**: el bypass de login para pruebas locales
  (`/api/dev-auto-login`, que deja entrar sin contraseña) solo se
  desactiva cuando la petición trae cabeceras `X-Forwarded-*` — si el
  proxy no las agrega, cualquier persona en internet podría loguearse como
  admin sin contraseña a través del proxy. Probarlo de verdad desde afuera
  de la red local antes de dar el servicio por expuesto (ver
  `esConexionLocal()` en `server.js`).
- Si el LXC va a estar expuesto a internet, configurar el firewall de
  Proxmox/el router para reenviar el puerto 443 hacia el proxy inverso.
- Si vas a mantener la app solo dentro de tu red local (sin exponerla a
  internet), podés saltear el HTTPS/proxy — pero entonces los alumnos solo
  van a poder entrar conectados a esa misma red.

## 10. Stripe: actualizar el webhook

- Dashboard de Stripe (modo Live) → Developers → Webhooks → tu endpoint →
  actualizar la URL a `PUBLIC_BASE_URL` + `/api/stripe/webhook`.
- Copiar el nuevo `STRIPE_WEBHOOK_SECRET` a `.env` y `systemctl restart
  malevo`.
- Ver `STRIPE-SETUP.md` para el detalle completo (variables, checklist de
  producción, cómo probar con Stripe CLI).

## 11. Prueba funcional final (antes de anunciar el cambio)

- [ ] Login de admin con contraseña real.
- [ ] Login passwordless de un alumno de prueba.
- [ ] Alta manual de un alumno + generación del link directo al portal.
- [ ] Un pago de prueba real con Stripe en modo Live de bajo monto (o al
      menos confirmar que el checkout carga y el webhook llega — revisar
      `journalctl -u malevo -f`).
- [ ] Generar un enlace de Curso Exclusivo, abrirlo desde otro
      dispositivo/red (para probar el `PUBLIC_BASE_URL` real) y confirmar
      que canjea bien y redirige al portal.
- [ ] Subir/editar un curso y confirmar que las portadas de Google Drive
      cargan (prueba de que el LXC tiene salida a internet correcta).
- [ ] Descargar una factura en PDF.
- [ ] Confirmar que las notificaciones push siguen andando para un alumno
      que ya las tenía activadas (valida que `data/vapid.json` viajó bien).
- [ ] Reiniciar el LXC completo y confirmar que `malevo.service` levanta
      solo, con los datos intactos (`systemctl status malevo`).
- [ ] Probar `systemctl stop malevo` y confirmar en los logs que alcanza a
      subir el último backup a Firebase Storage antes de cerrar (si está
      activado) — el proceso tiene hasta 8 segundos de gracia para eso.
