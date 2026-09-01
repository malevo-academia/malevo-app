/* ===== Malevo · Conexión con Firebase (Firestore + Storage) =====
 * Uso actual: Firestore SOLO se deja disponible como conector (funciones
 * fsGet..., fsUpsert..., etc. de la colección "users"), nada lo llama todavía.
 * El uso REAL en producción es Firebase Storage, como backup/restauración
 * de data/db.json — una red de seguridad extra ante un fallo de disco o
 * un borrado accidental, independiente del disco persistente local.
 *
 * Cómo funciona el backup (ver server.js):
 *   - Al arrancar, antes de abrir el puerto, se intenta descargar el
 *     último db.json subido a Storage y sobreescribir el local con él.
 *   - Cada vez que writeDB() guarda un cambio, unos segundos después
 *     (debounce) se sube esa misma copia a Storage en segundo plano.
 * Si Firebase no está configurado o falla la subida/bajada, la app sigue
 * funcionando igual con el db.json local — nunca se bloquea ni se cae
 * por esto.
 *
 * Credenciales — dos formas, en este orden de prioridad:
 *   1. Variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON: el contenido
 *      completo del JSON de la cuenta de servicio, en una sola línea.
 *      Útil si preferís no tener el archivo de credenciales en texto
 *      plano en el disco del LXC, o para inyectar el secreto desde el
 *      EnvironmentFile de systemd.
 *   2. Archivo local data/firebase-service-account.json — con disco
 *      persistente (como en este servidor) esta es la opción más simple:
 *      descargalo una vez desde Firebase Console → Configuración del
 *      proyecto → Cuentas de servicio → Generar nueva clave privada, y
 *      dejalo ahí. Ese archivo NUNCA debe compartirse ni subirse a
 *      ningún control de versiones ni backup público.
 *
 * FIREBASE_STORAGE_BUCKET (opcional): por defecto se usa
 * "<project_id>.appspot.com". Solo hace falta esta variable si tu bucket
 * real tiene otro nombre (por ejemplo los proyectos nuevos de Firebase
 * usan "<project_id>.firebasestorage.app").
 */
'use strict';
const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'data', 'firebase-service-account.json');
const USERS_COLLECTION = 'users';
const BACKUP_REMOTE_PATH = 'backups/db.json';

let _firestoreDb = null;
let _firebaseDisponible = false;
let _yaIntentado = false;
let _bucketName = null;

function _cargarServiceAccount() {
  // 1) Variable de entorno (útil si no querés el JSON de credenciales como archivo en disco)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  // 2) Archivo local (recomendado con disco persistente, como este servidor)
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    return JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  }
  return null;
}

function initFirebase() {
  if (_firestoreDb) return _firestoreDb;
  if (_yaIntentado) return null; // ya falló antes en este proceso — no reintentar en bucle
  _yaIntentado = true;
  try {
    const serviceAccount = _cargarServiceAccount();
    if (!serviceAccount) {
      console.warn('⚠ Firebase: no hay credenciales (ni FIREBASE_SERVICE_ACCOUNT_JSON ni data/firebase-service-account.json) — Firebase desactivado, se sigue usando solo db.json local.');
      return null;
    }
    _bucketName = process.env.FIREBASE_STORAGE_BUCKET || (serviceAccount.project_id + '.appspot.com');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
        storageBucket: _bucketName,
      });
    }
    _firestoreDb = admin.firestore();
    _firebaseDisponible = true;
    console.log('Firebase: conectado (proyecto ' + serviceAccount.project_id + ', bucket ' + _bucketName + ').');
    return _firestoreDb;
  } catch (e) {
    console.warn('⚠ Firebase: error al inicializar —', e.message, '— se sigue usando solo db.json local.');
    return null;
  }
}

function firebaseDisponible() {
  initFirebase();
  return _firebaseDisponible;
}

/* ── Backup/restauración de db.json en Firebase Storage ──────────────
   No usa Firestore (que limita cada documento a 1MB — db.json con fotos
   de perfil pesa mucho más que eso): usa Storage, pensado para archivos
   de cualquier tamaño. */

function _getBucket() {
  initFirebase();
  if (!_firebaseDisponible) return null;
  try { return admin.storage().bucket(_bucketName); }
  catch (e) { console.warn('⚠ Firebase Storage: no se pudo obtener el bucket —', e.message); return null; }
}

/* Sube el db.json local a Storage. Se llama en segundo plano (no se
   espera desde las rutas de la API) cada vez que writeDB() guarda algo,
   con un pequeño debounce en server.js para no subir en cada escritura
   suelta si llegan varias seguidas. */
async function backupDBAFirebase(localPath) {
  const bucket = _getBucket();
  if (!bucket) return false;
  try {
    await bucket.upload(localPath, {
      destination: BACKUP_REMOTE_PATH,
      metadata: { contentType: 'application/json' },
    });
    return true;
  } catch (e) {
    console.warn('⚠ Firebase Storage: no se pudo subir el backup de db.json —', e.message);
    return false;
  }
}

/* Descarga el último backup de Storage y sobreescribe localPath. Se usa
   solo al arrancar el servidor, antes de abrir el puerto — si no hay
   backup todavía (primera vez) o Firebase no está configurado, devuelve
   false sin tocar el archivo local. */
async function restaurarDBDesdeBackup(localPath) {
  const bucket = _getBucket();
  if (!bucket) return false;
  try {
    const file = bucket.file(BACKUP_REMOTE_PATH);
    const [existe] = await file.exists();
    if (!existe) return false;
    await file.download({ destination: localPath });
    return true;
  } catch (e) {
    console.warn('⚠ Firebase Storage: no se pudo restaurar el backup de db.json —', e.message);
    return false;
  }
}

/* ── Colección "users" (conector listo, todavía sin usar desde server.js) ── */

async function fsGetAllUsers() {
  const db = initFirebase();
  if (!db) return null;
  const snap = await db.collection(USERS_COLLECTION).get();
  return snap.docs.map(d => d.data());
}

async function fsGetUserById(id) {
  const db = initFirebase();
  if (!db) return null;
  const doc = await db.collection(USERS_COLLECTION).doc(id).get();
  return doc.exists ? doc.data() : null;
}

/* set(..., {merge:false}) para que un "update" parcial no deje campos
 * viejos colgando — igual que sobreescribir el objeto completo en
 * db.json. Si en el futuro se necesita un update parcial real, usar
 * fsUpdateUser() en su lugar. */
async function fsUpsertUser(user) {
  const db = initFirebase();
  if (!db) return false;
  await db.collection(USERS_COLLECTION).doc(user.id).set(user, { merge: false });
  return true;
}

async function fsUpdateUser(id, cambios) {
  const db = initFirebase();
  if (!db) return false;
  await db.collection(USERS_COLLECTION).doc(id).set(cambios, { merge: true });
  return true;
}

async function fsDeleteUser(id) {
  const db = initFirebase();
  if (!db) return false;
  await db.collection(USERS_COLLECTION).doc(id).delete();
  return true;
}

module.exports = {
  initFirebase,
  firebaseDisponible,
  backupDBAFirebase,
  restaurarDBDesdeBackup,
  fsGetAllUsers,
  fsGetUserById,
  fsUpsertUser,
  fsUpdateUser,
  fsDeleteUser,
};
