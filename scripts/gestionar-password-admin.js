/* ===== Malevo · Verificar / establecer la contraseña de una cuenta admin =====
 * Herramienta de línea de comandos para uso LOCAL. La contraseña se
 * escribe directamente en tu propia terminal — nunca se envía a Claude
 * ni queda en ningún chat, solo se compara (o se guarda) dentro de tu
 * propio data/db.json.
 *
 * Usa el MISMO esquema de hash que server.js (PBKDF2 · 100000
 * iteraciones · sha512 · "salt:hash"), así que una contraseña
 * verificada/establecida aquí funciona igual en /api/login.
 *
 * Uso:
 *   node scripts/gestionar-password-admin.js <username>          → verifica
 *   node scripts/gestionar-password-admin.js <username> --set    → establece
 *
 * Ejemplos:
 *   node scripts/gestionar-password-admin.js Gimena
 *   node scripts/gestionar-password-admin.js Gaston --set
 *
 * Con --set se hace antes un backup de data/db.json en data/backups/,
 * igual que en cualquier otra edición de la base de datos real.
 */
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

// Códigos de teclas de control usados por el lector de contraseña oculto.
const TECLA_ENTER_LF   = '\n';
const TECLA_ENTER_CR   = '\r';
const TECLA_CTRL_D_EOT = '\u0004';
const TECLA_CTRL_C     = '\u0003';
const TECLA_BACKSPACE  = '\u007f';
const TECLA_BACKSPACE2 = '\b';

/* Debe coincidir EXACTO con hashPassword()/checkPassword() en server.js
 * (líneas ~254-263) — si esa lógica cambia allí, hay que actualizarla
 * también aquí. */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}
function checkPassword(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const h = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false; // longitudes distintas u hash corrupto → no coincide
  }
}

/* Pide una contraseña en la terminal sin mostrarla en pantalla (no usa
 * ninguna dependencia externa — solo el modo "raw" de stdin).
 *
 * Se procesa CARÁCTER POR CARÁCTER dentro de cada chunk recibido (en
 * vez de asumir que cada evento "data" trae un único carácter): en modo
 * TTY normal cada tecla suele llegar en su propio evento, pero eso no
 * está garantizado (pegar texto, terminales que agrupan bytes, o stdin
 * no interactivo como al probar el script con un pipe) — así funciona
 * igual en ambos casos. */
function preguntarPasswordOculto(mensaje) {
  return new Promise((resolve) => {
    process.stdout.write(mensaje);
    const stdin = process.stdin;
    const eraRaw = stdin.isTTY;
    stdin.resume();
    stdin.setEncoding('utf8');
    if (eraRaw) stdin.setRawMode(true);

    let input = '';
    let terminado = false;

    const terminar = () => {
      if (terminado) return;
      terminado = true;
      if (eraRaw) stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      process.stdout.write('\n');
      resolve(input);
    };
    const onEnd = () => terminar(); // stdin no interactivo (pipe/redirección) que llega a EOF

    const onData = (chunk) => {
      chunk = chunk.toString('utf8');
      for (const char of chunk) {
        if (terminado) return;
        if (char === TECLA_ENTER_LF || char === TECLA_ENTER_CR || char === TECLA_CTRL_D_EOT) {
          terminar();
          return;
        } else if (char === TECLA_CTRL_C) {
          process.stdout.write('\n');
          process.exit(1);
        } else if (char === TECLA_BACKSPACE || char === TECLA_BACKSPACE2) {
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      }
    };
    stdin.on('data', onData);
    stdin.on('end', onEnd);
  });
}

async function main() {
  const [, , usernameArg, modo] = process.argv;
  if (!usernameArg) {
    console.log('Uso:');
    console.log('  node scripts/gestionar-password-admin.js <username>          → verifica');
    console.log('  node scripts/gestionar-password-admin.js <username> --set    → establece/cambia');
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const user = db.users.find(u => u.username === usernameArg);
  if (!user) {
    console.error(`✗ No existe ningún usuario con username "${usernameArg}".`);
    console.error('  Usernames de admin disponibles:', db.users.filter(u => u.role === 'admin').map(u => u.username).join(', '));
    process.exit(1);
  }

  const password = await preguntarPasswordOculto(`Contraseña para "${usernameArg}": `);

  if (modo === '--set') {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '..', 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `db_backup_before_password_${usernameArg}_${ts}.json`);
    fs.copyFileSync(DB_PATH, backupPath);

    user.passwordHash = hashPassword(password);
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    console.log(`✓ Contraseña de "${usernameArg}" actualizada. Backup previo en data/backups/${path.basename(backupPath)}`);
  } else {
    if (!user.passwordHash) {
      console.log(`⚠ "${usernameArg}" no tiene ninguna contraseña guardada todavía — no hay nada con qué comparar.`);
      console.log(`  Ejecuta:  node scripts/gestionar-password-admin.js ${usernameArg} --set`);
    } else if (checkPassword(password, user.passwordHash)) {
      console.log(`✓ Coincide — esa contraseña funciona para "${usernameArg}".`);
    } else {
      console.log(`✗ No coincide con la contraseña guardada para "${usernameArg}".`);
    }
  }
}

main();
