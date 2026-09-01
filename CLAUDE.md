# Reglas del proyecto Malevo

## Regla permanente: sincronizar malevo-vista-previa.html

`malevo-vista-previa.html` es una vista previa estática de un solo archivo
del **panel de administración** (equivalente a `index.html` + `app.js`, con
un backend simulado por `fetch` interceptado y datos reales embebidos como
JSON). Se usa para previsualizar la interfaz del admin en el panel derecho
de Cowork sin depender del servidor real.

**A partir de ahora, cada vez que se modifique cualquier archivo del
frontend del panel de administración — `index.html`, `app.js`, o su CSS —
hay que trasladar el mismo cambio a `malevo-vista-previa.html` en el mismo
turno, sin que el usuario tenga que pedirlo explícitamente.** Esto incluye:

- Cambios de markup/CSS en `index.html` → aplicar el mismo cambio de estilo
  o estructura en `malevo-vista-previa.html`.
- Funciones nuevas o modificadas en `app.js` (vistas, lógica, "modo
  alumno") → portarlas a `malevo-vista-previa.html`, adaptando las llamadas
  a `fetch('/api/...')` que sean nuevas para que las intercepte el backend
  simulado (bloque `handleApi()` dentro de `malevo-vista-previa.html`).
- Si el cambio afecta la forma de los datos (`db.videos`, `db.users`,
  etc.), revisar que el JSON de datos reales embebido
  (`<script type="application/json" id="malevoRealDB">`) siga siendo
  compatible; normalmente no hace falta tocarlo salvo que cambie el
  esquema.

**Importante — alcance limitado:** `malevo-vista-previa.html` solo cubre el
panel de administración. **No** incluye el portal del alumno
(`portal.html` / `portal.js`) — no existe una vista previa equivalente para
esos archivos. Un cambio en `portal.js`/`portal.html` no requiere tocar
`malevo-vista-previa.html`, salvo que ese cambio también se refleje en el
espejo "modo alumno" dentro de `app.js` (funciones `ma*`/`mmp*`), en cuyo
caso sí hay que sincronizar esa parte del espejo en la vista previa.

Después de cada sincronización, verificar sintaxis con `node -c` sobre los
`<script>` del archivo (extrayéndolos), igual que se hace con los archivos
reales, y confirmar que el tamaño del archivo se mantiene razonable (no
volver a incluir fotos de perfil ni hashes de contraseña al tocar el JSON
de datos reales).

## Otras notas del proyecto

- La base de datos real vive en `data/db.json` y nunca se edita
  directamente sin backup previo; toda prueba de funcionalidad se hace
  sobre una copia en `/tmp`.
- El bypass de login (`/api/dev-auto-login` en `server.js`) solo funciona
  en conexiones desde localhost — no depende de variables de entorno.

## Protecciones — recursos que NUNCA se deben borrar ni limpiar

Ninguna limpieza de datos de prueba (usuarios, pagos, tokens de acceso,
etc.) debe tocar nunca estos recursos, aunque parezcan "datos" al pasar por
`data/db.json`:

- `assets/descuento-30-fuego.webp` — imagen del banner de 30% de descuento
  por referidos. Se referencia por ruta relativa desde `app.js` (espejo
  "Ver como alumno") y `portal.js` (alumno real). Si se reemplaza el
  archivo, mantener el mismo nombre y ruta.
- La constante `MA_IMG_DESCUENTO_FUEGO` dentro de `malevo-vista-previa.html`
  (cerca de `maRenderRefBlock`) — es la misma imagen anterior pero embebida
  en base64 (la vista previa no puede resolver rutas relativas a `assets/`
  porque se abre fuera del servidor real). Si se actualiza la imagen real,
  hay que regenerar también este base64, o el banner de descuento se ve
  vacío/roto solo en la vista previa aunque en la app real funcione bien.
- `user.fotoPerfil` de cada alumno en `data/db.json` — la foto de perfil
  real va embebida en base64 ahí. **Importante:** el JSON de datos
  embebido en `malevo-vista-previa.html` (`<script id="malevoRealDB">`)
  la lleva intencionalmente vacía por regla de este mismo archivo (ver
  arriba, "no volver a incluir fotos de perfil... al tocar el JSON de
  datos reales") — si en la vista previa un alumno aparece sin foto, es
  este recorte intencional, no una foto borrada de verdad. La foto real
  vive únicamente en `data/db.json` y ahí sí debe conservarse siempre.
- `cursos[].imagenPortada` en `data/db.json` — URLs de Google Drive
  (`https://lh3.googleusercontent.com/d/...`). Ninguna limpieza de alumnos
  o pagos debe tocar el array `db.cursos`. Al día de esta nota, 4 de 37
  cursos (Boogaloo, Cha-cha-chá, Tango, Zouk) todavía no tienen portada
  asignada — es una tarea pendiente de antes, no algo que se haya borrado.
- La constante `MA_CURSO_THUMBS` dentro de `malevo-vista-previa.html`
  (cerca de `MA_IMG_DESCUENTO_FUEGO`, justo antes de `maRenderRefBlock`) —
  un mapa `cursoId → miniatura JPEG en base64` (160px de ancho, calidad
  reducida) de cada portada de curso. Existe por el mismo motivo que
  `MA_IMG_DESCUENTO_FUEGO`: la vista previa de Cowork no logra cargar las
  imágenes de Google Drive (`lh3.googleusercontent.com`) en su entorno de
  renderizado, aunque esas mismas URLs cargan perfectamente en cualquier
  navegador real (la producción en el LXC de Proxmox no se ve afectada).
  El render usa `maThumbSrc(c)` — definida junto al mapa —
  que devuelve `MA_CURSO_THUMBS[c.id]` si existe y si no cae al
  `c.imagenPortada` real; `cxImgFallback` sigue siendo el último respaldo.
  Si se reemplaza la portada de un curso en `data/db.json`, hay que
  regenerar su miniatura en este mapa (fetch de la nueva URL de Drive +
  downscale a canvas + `toDataURL('image/jpeg', 0.4)`), o esa portada en
  particular volverá a verse rota solo en la vista previa.
