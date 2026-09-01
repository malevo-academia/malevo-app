/* ===== Malevo · Migración única: usuarios de db.json → Firestore =====
 * Copia los usuarios actuales de data/db.json (Gaston, Gimena, Adrián)
 * a la colección "users" de Firestore, usando el mismo "id" como ID de
 * documento — así las referencias que siguen viviendo en db.json
 * (enrollments.userId, payments.userId, users.assignedClasses, etc.)
 * no se rompen.
 *
 * NO borra ni modifica data/db.json — es solo una copia hacia Firestore.
 * Se puede ejecutar varias veces sin problema (sobreescribe los mismos
 * documentos con los mismos datos).
 *
 * "fotoPerfil" se excluye a propósito: Firestore rechaza cualquier
 * documento que pese más de 1 MiB, y una foto de perfil en Base64 sola
 * ya puede superar ese límite (es justo lo que pasó al migrar por
 * primera vez). Guardar imágenes como texto Base64 dentro de un
 * documento de Firestore es además una mala práctica en general — lo
 * correcto a futuro es subirlas a Firebase Storage y guardar solo la
 * URL en el documento. Por ahora, mientras eso no se monte, la foto de
 * perfil se sigue sirviendo desde data/db.json (que es donde vive de
 * verdad) y el documento en Firestore simplemente no la incluye.
 *
 * Uso:
 *   npm run migrate:users
 *   (o directamente: node scripts/migrar-usuarios-a-firestore.js)
 *
 * Requiere data/firebase-service-account.json ya configurado (ver
 * firebase.js para más detalle).
 */
'use strict';
const path = require('path');
const fs   = require('fs');
const { initFirebase } = require('../firebase');

// Límite real de Firestore por documento (1 MiB), con margen de sobra
// para el resto de campos del usuario.
const LIMITE_DOC_BYTES = 900 * 1024;

function prepararParaFirestore(u) {
  const { fotoPerfil, ...limpio } = u;
  return { limpio, teniaFoto: !!fotoPerfil };
}

async function main() {
  const db = initFirebase();
  if (!db) {
    console.error('✗ No se pudo conectar a Firestore. Revisa que exista data/firebase-service-account.json y que el projectId sea correcto.');
    process.exit(1);
  }

  const dbPath = path.join(__dirname, '..', 'data', 'db.json');
  const localDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const users = localDb.users || [];

  if (!users.length) {
    console.log('No hay usuarios en data/db.json — nada que migrar.');
    return;
  }

  console.log(`Migrando ${users.length} usuario(s) a Firestore...`);
  const batch = db.batch();
  const conFotoExcluida = [];
  const demasiadoGrandes = [];

  users.forEach(u => {
    const { limpio, teniaFoto } = prepararParaFirestore(u);
    if (teniaFoto) conFotoExcluida.push(u.nombre || u.username);

    // Salvaguarda: si tras quitar la foto el documento SIGUE siendo
    // demasiado grande (algún otro campo inesperadamente pesado), se
    // avisa y se salta ese usuario en vez de romper todo el batch.
    const bytes = Buffer.byteLength(JSON.stringify(limpio), 'utf8');
    if (bytes > LIMITE_DOC_BYTES) {
      demasiadoGrandes.push({ nombre: u.nombre || u.username, bytes });
      return;
    }

    const ref = db.collection('users').doc(u.id);
    batch.set(ref, limpio);
  });

  await batch.commit();

  console.log('\n✓ Migración completa. Usuarios en Firestore:');
  users
    .filter(u => !demasiadoGrandes.some(d => d.nombre === (u.nombre || u.username)))
    .forEach(u => console.log('  -', u.role, '|', u.username, '|', u.nombre));

  if (conFotoExcluida.length) {
    console.log('\nℹ Foto de perfil excluida (sigue intacta en data/db.json) para:');
    conFotoExcluida.forEach(n => console.log('  -', n));
  }
  if (demasiadoGrandes.length) {
    console.log('\n⚠ Estos usuarios NO se migraron — su documento sigue pesando demasiado incluso sin la foto:');
    demasiadoGrandes.forEach(d => console.log(`  - ${d.nombre} (${(d.bytes / 1024).toFixed(0)} KB)`));
  }
}

main().catch(e => {
  console.error('✗ Error en la migración:', e.message);
  process.exit(1);
});
