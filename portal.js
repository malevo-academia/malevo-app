/* ===== Malevo v3.0 · Portal del Alumno ===== */
'use strict';

/* ── Web Audio · sonidos del portal ── */
let _portalAudioCtx = null;
function _getAudio(){
  if(!_portalAudioCtx) _portalAudioCtx=new(window.AudioContext||window.webkitAudioContext)();
  return _portalAudioCtx;
}
/* Sonido de navegación entre pestañas — suave, cristalino */
function portalPlayNav(){
  try{
    const ctx=_getAudio();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='sine';
    o.frequency.setValueAtTime(480,ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(620,ctx.currentTime+0.1);
    g.gain.setValueAtTime(0.04,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.18);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.2);
  }catch{}
}
/* Sonido de guardado exitoso */
function portalPlaySuccess(){
  try{
    const ctx=_getAudio();
    [[440,0],[554,0.07],[660,0.14]].forEach(([freq,t])=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type='sine'; o.frequency.value=freq;
      g.gain.setValueAtTime(0.055,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.18);
      o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.2);
    });
  }catch{}
}
/* Clic suave general */
function portalPlayClick(){
  try{
    const ctx=_getAudio();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='sine';
    o.frequency.setValueAtTime(720,ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(540,ctx.currentTime+0.07);
    g.gain.setValueAtTime(0.035,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.1);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.1);
  }catch{}
}
/* ══════════════════════════════════════════════
   TEMA — Modo Dorado (por defecto) / Modo Verde Neón
   La clase .theme-green en <body> ya se aplica lo antes posible desde un
   script inline en portal.html (para evitar el parpadeo dorado→verde al
   cargar), leyendo la misma clave de localStorage que se usa acá. Esta
   sección solo sincroniza el switch visual del header y guarda el cambio
   al alternar — no hace falta recargar la página, todo el resto del CSS
   ya reacciona solo por la cascada de variables (ver .theme-green en
   portal.html).
══════════════════════════════════════════════ */
function pInicializarTema(){
  pPintarToggleTema(document.body.classList.contains('theme-green'));
}
function pPintarToggleTema(verde){
  const btn = $('pThemeToggle');
  const label = $('pThemeToggleLabel');
  if (btn){
    btn.classList.toggle('on', verde);
    btn.title = verde ? 'Cambiar a Modo Dorado' : 'Cambiar a Modo Verde';
  }
  if (label) label.textContent = verde ? 'Verde' : 'Dorado';
}
function pToggleTema(){
  const verde = !document.body.classList.contains('theme-green');
  document.body.classList.toggle('theme-green', verde);
  try{ localStorage.setItem('malevo_theme', verde ? 'verde' : 'dorado'); }catch{}
  pPintarToggleTema(verde);
  portalPlayClick();
}

/* Sonido de copia de enlace */
function portalPlayCopy(){
  try{
    const ctx=_getAudio();
    [[880,0],[1100,0.05]].forEach(([freq,t])=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type='sine'; o.frequency.value=freq;
      g.gain.setValueAtTime(0.04,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.1);
      o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.12);
    });
  }catch{}
}

const DISCIPLINAS_VIDEO = ['Bachata','Salsa'];
const DIAS_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const DIAS_CORTO = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

let currentUser   = null;   // { sub, role, nombre, hasPortalAccess }
let allVideos     = [];
let allCursos     = [];     // catálogo de Cursos Exclusivos (ver /api/cursos) — bloqueados/desbloqueados según cursosAsignados
let myClasses     = [];     // clases asignadas por admin
let activeView    = null;
let activeDisciplina = null;
let activeNivel   = null;
let activeVideoId = null;

/* ── Utils ── */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function iniciales(n){ return (n||'').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?'; }

/* ── Base URL de respaldo para enlaces generados en el cliente (enlace de
   referidos), solo se usa si el servidor no devolvió ya un link armado
   (ver /api/referral, que construye la URL con PUBLIC_BASE_URL). Si
   location.origin no es http(s) (por ejemplo la página se abrió fuera del
   servidor real), caemos al servidor local por defecto. ── */
function malevoBaseUrl(){
  const o = location.origin;
  return /^https?:\/\//.test(o) ? o : 'http://localhost:8081';
}

/* ── Nivel 4 se muestra como "Coreografías" en toda la interfaz de vídeo ── */
function nivelLabel(n){ return n===4 ? 'Coreografías' : 'Nivel '+n; }
function nivelLabelCorto(n){ return n===4 ? 'Coreo' : 'N'+n; }
/* Versión "completa mínima": Nivel 1/2/3 igual que nivelLabel, pero el 4 se
   abrevia a "Coreo" (no "Coreografías") — usada donde antes se mostraba
   N1/N2/N3/Coreo abreviado y ahora se pide el texto entero. */
function nivelLabelFull(n){ return n===4 ? 'Coreo' : 'Nivel '+n; }

/* ── Pinta el avatar (foto real o iniciales) del alumno en el contenedor indicado ── */
function pintarAvatar(elId, fotoUrl, nombre, fontSize){
  const el=$(elId); if(!el) return;
  el.innerHTML = fotoUrl
    ? `<img src="${esc(fotoUrl)}" alt="">`
    : `<span style="font-family:'Sora',sans-serif;font-weight:700;font-size:${fontSize||14}px;color:var(--text-2);">${iniciales(nombre)}</span>`;
}

function showToast(msg, type='ok', duration=3200){
  const c=$('toastContainer'); if(!c) return;
  const t=document.createElement('div');
  t.className='portal-toast '+type;
  const icons={ok:'✓',warn:'⚠',info:'ℹ'};
  t.innerHTML=`<span style="font-size:16px;flex:0 0 auto;">${icons[type]||''}</span>
    <span style="flex:1;">${esc(msg)}</span>
    <span onclick="this.parentElement.remove()" style="cursor:pointer;opacity:.5;font-size:16px;margin-left:6px;">×</span>`;
  c.appendChild(t);
  setTimeout(()=>{ t.style.animation='toastOut .3s ease forwards'; setTimeout(()=>t.remove(),300); },duration);
}

/* ── Auth passwordless: Paso 1 (email/teléfono) → Paso 2 (código) ──
 * Sin proveedor real de email/SMS conectado todavía (ver server.js →
 * enviarCodigoAcceso, que hoy es un stub), el backend devuelve el código
 * directamente en la respuesta de /api/auth/passwordless/request y aquí
 * lo mostramos en pantalla + lo autocompletamos, para que el acceso sea
 * inmediato y sin fricción. La estructura queda lista para que, el día
 * que se conecte un proveedor real, solo haga falta dejar de leer/mostrar
 * "j.code" (el backend simplemente dejaría de incluirlo). */
let _loginContactoActual = null;

async function portalSolicitarCodigo(ev){
  ev.preventDefault();
  const contacto = $('pContacto').value.trim();
  const err = $('pErrorContacto'); err.textContent='';
  if (!contacto) return;
  const btn = $('pBtnEnviarCodigo');
  if (btn){ btn.disabled=true; btn.textContent='Enviando…'; }
  try {
    const r = await fetch('/api/auth/passwordless/request',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contacto}), credentials:'same-origin'});
    const j = await r.json();
    if (!r.ok || !j.ok){
      err.textContent = j.error || 'No encontramos una cuenta con ese email o teléfono.';
      if (btn){ btn.disabled=false; btn.textContent='Enviar código de acceso'; }
      return;
    }
    _loginContactoActual = contacto;
    $('pContactoConfirmado').textContent = contacto;
    const cajaSimulada = $('pCodigoSimuladoBox');
    if (j.code){
      // Simulación en pantalla: se muestra y se autocompleta el código.
      $('pCodigoSimuladoValor').textContent = j.code;
      $('pCodigo').value = j.code;
      if (cajaSimulada) cajaSimulada.style.display = '';
    } else if (cajaSimulada) {
      // Cuando haya un proveedor real conectado, el backend no envía "code"
      // y esta caja de simulación simplemente no se muestra.
      cajaSimulada.style.display = 'none';
    }
    $('loginPasoContacto').style.display = 'none';
    $('loginPasoCodigo').style.display = 'block';
    $('pCodigo').focus();
  } catch {
    err.textContent = 'No se pudo conectar.';
  } finally {
    if (btn){ btn.disabled=false; btn.textContent='Enviar código de acceso'; }
  }
}

async function portalConfirmarCodigo(ev){
  ev.preventDefault();
  const code = $('pCodigo').value.trim();
  const err = $('pErrorCodigo'); err.textContent='';
  try {
    const r = await fetch('/api/auth/passwordless/verify',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contacto:_loginContactoActual, code}), credentials:'same-origin'});
    const j = await r.json();
    if (!r.ok || !j.ok){ err.textContent = j.error || 'Código incorrecto o caducado.'; return; }
    // Admins y profesores → redirigir al panel de administración
    if (['admin','teacher'].includes(j.role)){ location.replace('/index.html'); return; }
    currentUser={sub:j.sub,role:j.role,nombre:j.nombre};
    await arrancarPortal();
  } catch { err.textContent='No se pudo conectar.'; }
}

function portalVolverPasoContacto(ev){
  if (ev) ev.preventDefault();
  $('loginPasoCodigo').style.display = 'none';
  $('loginPasoContacto').style.display = 'block';
  $('pCodigo').value = '';
  $('pErrorCodigo').textContent = '';
}

async function portalLogout(){
  if (!confirm('¿Salir?')) return;
  try { await fetch('/api/logout',{method:'POST',credentials:'same-origin'}); } catch {}
  location.reload();
}

// Enlace directo de acceso (?contacto=email-o-teléfono en la URL, ver
// panel de admin → ficha de alumno de pago manual → "Generar enlace de
// acceso"): se intenta una sola vez por carga de página, para no
// reenviar un código nuevo cada vez que se llama a mostrarLogin().
let _contactoAutoIntentado = false;

function mostrarLogin(){
  // Si veníamos de intentar confirmar un pago (overlay "Confirmando tu
  // pago…") y terminamos en el login de todas formas (sesión no
  // establecida, pago aún no confirmado, etc.), hay que quitar ese
  // overlay — si no, se queda tapando la pantalla de login por encima.
  const paymentOverlay = document.getElementById('paymentOverlay');
  if (paymentOverlay) paymentOverlay.remove();
  $('loginOverlay').style.display='flex';
  $('portalApp').style.display='none';
  // Siempre arrancar en el paso 1 (email/teléfono), nunca a mitad del flujo.
  $('loginPasoCodigo').style.display='none';
  $('loginPasoContacto').style.display='block';

  // Enlace directo del admin (alta manual con Bizum/transferencia/
  // efectivo): precarga el contacto y pide el código automáticamente, así
  // el alumno solo tiene que abrir el enlace y confirmar — sin escribir
  // nada. Ver app.js → abrirModalLinkPortal / linkPortalAlumno.
  if (!_contactoAutoIntentado) {
    _contactoAutoIntentado = true;
    const contactoUrl = new URLSearchParams(location.search).get('contacto');
    if (contactoUrl) {
      const inp = $('pContacto');
      if (inp) inp.value = contactoUrl;
      portalSolicitarCodigo({ preventDefault(){} });
    }
  }
  // El botón de acceso directo (modo dev) se muestra siempre: el propio
  // servidor es quien lo bloquea de verdad si la conexión no es local
  // (ver esConexionLocal() en server.js), así que ocultarlo aquí según el
  // hostname del navegador es innecesario y poco fiable (p.ej. al ver el
  // portal a través de un proxy o vista previa con otro origen).
  const devWrap = $('pDevLoginWrap');
  if (devWrap) devWrap.style.display = 'block';
}
function ocultarLogin(){ $('loginOverlay').style.display='none'; $('portalApp').style.display='grid'; }

/* ── Alterna el campo de contraseña entre oculto (••••) y texto plano,
   para poder verificar que la clave está bien escrita antes de enviarla ── */
function togglePassVisibility(inputId, btn){
  const input = $(inputId); if (!input) return;
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  btn.querySelector('.eye-open').style.display = mostrar ? 'none' : '';
  btn.querySelector('.eye-closed').style.display = mostrar ? '' : 'none';
  btn.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
}

function togglePortalSidebar(){
  const nav = $('portalNav');
  const ov  = $('portalSidebarOverlay');
  if(nav) nav.classList.toggle('open');
  if(ov)  ov.classList.toggle('open');
}

/* Botón "← Volver" del header (solo visible en móvil, fuera de Inicio) */
function pVolver(){
  pNavigate('inicio');
}

/* ══════════════════════════════════════════════
   ⚠️ MODO DEV — ACCESO DIRECTO (solo pruebas locales)
   /api/dev-auto-login existe en el servidor y solo responde a conexiones
   desde localhost (ver esConexionLocal() en server.js) — no depende de
   ninguna variable de entorno. DEV_AUTO_LOGIN aquí solo controla si el
   portal lo intenta automáticamente al cargar; el botón "Entrar directo
   como Alumno de prueba" del login (portalDevLogin) llama al mismo
   endpoint bajo demanda y ya se muestra solo en localhost.
══════════════════════════════════════════════ */
const DEV_AUTO_LOGIN = false;

// Solo para decidir si mostramos el botón/atajo de dev en la UI — el
// servidor hace su propia comprobación real y es la que de verdad importa.
function _esLocalhost(){
  return ['localhost','127.0.0.1','::1'].includes(location.hostname);
}

async function _devAutoLogin(){
  try {
    const r = await fetch('/api/dev-auto-login',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({as:'student'}), credentials:'same-origin'
    });
    if (!r.ok) return false; // fuera de localhost (o no hay alumno) → login normal
    const j = await r.json();
    if (['admin','teacher'].includes(j.role)){ location.replace('/index.html'); return true; }
    currentUser = {sub:j.sub, role:j.role, nombre:j.nombre, hasPortalAccess:j.hasPortalAccess};
    await arrancarPortal();
    return true;
  } catch { return false; }
}

async function intentarAutoLoginDev(){
  if (!DEV_AUTO_LOGIN) return false;
  return _devAutoLogin();
}

// Botón "⚡ Entrar directo como Alumno de prueba" del login.
async function portalDevLogin(){
  const err = $('pErrorContacto'); if (err) err.textContent = '';
  const ok = await _devAutoLogin();
  if (!ok && err) err.textContent = 'El acceso directo solo funciona en local (servidor en localhost).';
}

async function iniciarPortal(){
  pInicializarTema();
  if (await intentarAutoLoginDev()) return;

  // ── Alta directa por Stripe Checkout (sin cuenta previa): si volvemos
  // de Stripe con ?session_id=..., confirmamos el pago DIRECTAMENTE
  // contra la API de Stripe antes de nada más. Este flujo no registra
  // ninguna cuenta antes de pagar — la cuenta nace recién aquí, cuando el
  // pago se confirma — así que sin este paso la llamada a /api/me de
  // abajo fallaría con 401 (todavía no hay cookie de sesión) y el alumno
  // recién pagado terminaría viendo la pantalla de login. ──
  const sessionIdUrl = new URLSearchParams(location.search).get('session_id');
  if (sessionIdUrl){
    _mostrarEsperandoConfirmacionPago();
    try {
      const rConf = await fetch('/api/onboarding/confirmar-checkout?session_id=' + encodeURIComponent(sessionIdUrl), { credentials:'same-origin', cache:'no-store' });
      await rConf.json().catch(()=>null);
    } catch { /* si falla, /api/me de abajo simplemente no encuentra sesión y cae al login */ }
    // Quitamos session_id de la URL para no reintentar la confirmación si
    // el alumno recarga esta misma página más tarde.
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('session_id');
    history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  }

  try {
    const r=await fetch('/api/me',{cache:'no-store',credentials:'same-origin'});
    if (r.ok){
      const j=await r.json();
      // Admins y profesores → redirigir al panel
      if (['admin','teacher'].includes(j.role)){ location.replace('/index.html'); return; }
      currentUser={sub:j.sub,role:j.role,nombre:j.nombre,hasPortalAccess:j.hasPortalAccess};

      // Verificar si tiene pago pendiente (onboarding incompleto)
      let st = await _consultarOnboardingStatus();

      // Si volvemos justo de Stripe Checkout (?stripe=ok), el webhook que
      // activa la cuenta puede tardar unos segundos más que la propia
      // redirección del navegador — no hay garantía de orden entre ambos.
      // Reintentamos brevemente antes de resignarnos a mostrar otra vez la
      // pantalla de pago pendiente, que confundiría a alguien que ya pagó.
      if (st && st.pendingPayment && new URLSearchParams(location.search).get('stripe') === 'ok'){
        mostrarLogin();
        _mostrarEsperandoConfirmacionPago();
        st = await _reintentarStatusTrasStripe();
      }

      if (st && st.pendingPayment && st.onboardingToken){
        mostrarLogin();
        mostrarPantallaPago(st);
        return;
      }

      await arrancarPortal();
    } else { mostrarLogin(); }
  } catch { mostrarLogin(); }
}

/* ── Helpers de estado de onboarding / espera del webhook de Stripe ── */
async function _consultarOnboardingStatus(){
  try {
    const r = await fetch('/api/onboarding/status',{cache:'no-store',credentials:'same-origin'});
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ── Tras volver de Stripe Checkout, el webhook checkout.session.completed
   activa la cuenta de forma asíncrona (normalmente en 1-2s, pero sin
   garantía de orden con la redirección del navegador). Reintentamos el
   status cada 1.5s durante ~12s antes de resignarnos. ── */
async function _reintentarStatusTrasStripe(){
  for (let i=0;i<8;i++){
    await new Promise(r=>setTimeout(r,1500));
    const st = await _consultarOnboardingStatus();
    if (!st || !st.pendingPayment) return st;
  }
  return await _consultarOnboardingStatus();
}

function _mostrarEsperandoConfirmacionPago(){
  let overlay = document.getElementById('paymentOverlay');
  if (!overlay){
    overlay = document.createElement('div');
    overlay.id = 'paymentOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(ellipse 120% 100% at 50% -20%,#1a1200 0%,#0A0A0A 90%);';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="width:100%;max-width:400px;text-align:center;">
      <div style="width:44px;height:44px;margin:0 auto 20px;border:3px solid rgba(226,144,35,.25);
        border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <h2 style="font-family:'Sora',sans-serif;font-size:18px;font-weight:700;color:var(--white);margin-bottom:8px;">
        Confirmando tu pago…</h2>
      <p style="color:var(--text-2);font-size:13px;line-height:1.6;">Esto solo tarda unos segundos.</p>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg);}}</style>`;
}

async function arrancarPortal(){
  ocultarLogin();
  const overlay = document.getElementById('paymentOverlay');
  if (overlay) overlay.remove();
  if ($('pUserBadge')) $('pUserBadge').textContent=currentUser.nombre;
  pintarAvatar('pHeaderAvatar', null, currentUser.nombre, 13); // iniciales mientras carga el perfil

  // Cargar clases del alumno en paralelo
  const [clsRes, profileRes] = await Promise.allSettled([
    fetch('/api/my-classes',{credentials:'same-origin'}),
    fetch('/api/profile',{credentials:'same-origin'})
  ]);
  if (clsRes.status==='fulfilled' && clsRes.value.ok) myClasses=await clsRes.value.json();
  if (profileRes.status==='fulfilled' && profileRes.value.ok){
    const p=await profileRes.value.json();
    Object.assign(currentUser, p);
  }
  pintarAvatar('pHeaderAvatar', currentUser.fotoPerfil, currentUser.nombre, 13);

  // Mostrar badge de plan en el header
  const planBadge = $('pPlanBadge');
  if(planBadge && currentUser.plan){
    const planNames = {'suelta':'Clase suelta','35':'1 clase/sem','50':'2 clases/sem','80':'🎓 VIP','bono':'Bono'};
    planBadge.textContent = planNames[currentUser.plan] || currentUser.plan;
    planBadge.style.display = 'inline-flex';
    if(currentUser.plan==='80') planBadge.style.background='rgba(226,144,35,.12)';
  }

  // Cuentas "solo cursos" (comprador externo que canjeó un token — ver
  // soloCursosExternos en server.js): su portal es ÚNICAMENTE la pantalla
  // de Cursos Exclusivos — nada de Inicio, Perfil, Música ni nada más. Se
  // oculta toda la barra de navegación (no tiene sentido navegar si solo
  // hay una pantalla) y el botón hamburguesa que la abre en móvil.
  if (currentUser.soloCursosExternos){
    const nav = $('portalNav');
    if (nav) nav.style.display = 'none';
    const navToggle = $('portalSidebarToggle');
    if (navToggle) navToggle.style.display = 'none';
  }

  // Si venimos de canjear un token de curso externo (curso-acceso.html
  // redirige con "?curso=desbloqueado"), priorizar Cursos Exclusivos para
  // que el alumno vea de inmediato lo que acaba de desbloquear — incluso
  // si su perfil todavía no está completo (eso lo puede terminar después
  // desde Mi Perfil, no bloquea ver el curso que ya pagó).
  const _paramsInicio = new URLSearchParams(window.location.search);
  if (currentUser.soloCursosExternos){
    // Nunca pasan por Perfil: no los interesa ni necesitan completarlo.
    pNavigate('cursos');
  } else if (!currentUser.profileComplete){
    pNavigate('perfil', true);
  } else if (_paramsInicio.get('curso') === 'desbloqueado'){
    pNavigate('cursos');
  } else {
    pNavigate('inicio');
  }

  // Prompt de instalación PWA — solo para cuentas "solo cursos" (ver
  // mostrarPromptInstalarPWA() más abajo, cerca del registro del Service
  // Worker). Con un pequeño delay para no competir con el toast de
  // "¡Curso desbloqueado!" que dispara _avisarCursoDesbloqueado() más abajo.
  if (currentUser.soloCursosExternos){
    setTimeout(mostrarPromptInstalarPWA, 1400);
  }

  // Notificaciones push: no debe bloquear ni romper el arranque del portal
  // si el navegador/dispositivo no las soporta o el alumno las rechaza.
  _inicializarPush();

  // Aviso al volver de Stripe Checkout (?stripe=ok / ?stripe=cancelado en
  // la URL de éxito/cancelación configurada en /api/portal/stripe/
  // checkout-session). Se limpia el parámetro de la URL para que no
  // reaparezca el aviso si el alumno recarga la página.
  _avisarRegresoDeStripe();
  // Aviso tras canjear un enlace de curso externo (?curso=desbloqueado).
  _avisarCursoDesbloqueado();
}

function _avisarRegresoDeStripe(){
  try {
    const params = new URLSearchParams(window.location.search);
    const estado = params.get('stripe');
    if (!estado) return;
    if (estado === 'ok') {
      showToast('¡Pago confirmado! Bienvenido a tu Aula Virtual 🎉','ok',5000);
    } else if (estado === 'cancelado') {
      showToast('Pago cancelado — puedes intentarlo de nuevo cuando quieras desde tu perfil.','warn',5000);
    }
    params.delete('stripe');
    const query = params.toString();
    const nuevaUrl = window.location.pathname + (query ? '?'+query : '');
    window.history.replaceState({}, '', nuevaUrl);
  } catch(e) { /* URLSearchParams/history no disponible — no es crítico */ }
}

/* Toast tras canjear un token de acceso a curso externo (ver curso-acceso.html
   → redirige a /portal.html?curso=desbloqueado). Se limpia el parámetro para
   que no reaparezca el aviso si el alumno recarga la página. */
function _avisarCursoDesbloqueado(){
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('curso') !== 'desbloqueado') return;
    showToast('¡Curso desbloqueado! Ya está disponible en Cursos Exclusivos 🎉','ok',5000);
    params.delete('curso');
    const query = params.toString();
    const nuevaUrl = window.location.pathname + (query ? '?'+query : '');
    window.history.replaceState({}, '', nuevaUrl);
  } catch(e) { /* no crítico */ }
}

/* ── Recargar clases y perfil del alumno desde el servidor ── */
async function recargarMisClases(){
  try {
    const [clsRes, profileRes] = await Promise.allSettled([
      fetch('/api/my-classes',{credentials:'same-origin',cache:'no-store'}),
      fetch('/api/profile',{credentials:'same-origin',cache:'no-store'})
    ]);
    if(clsRes.status==='fulfilled' && clsRes.value.ok)
      myClasses = await clsRes.value.json();
    if(profileRes.status==='fulfilled' && profileRes.value.ok){
      const p = await profileRes.value.json();
      Object.assign(currentUser, p);
    }
  } catch {}
}

/* ── Navegación del portal ── */
/* ══════════════════════════════════════════════
   SCROLL REVEAL — técnica tipo AOS.js: el elemento nace invisible y
   desplazado fuera de pantalla (ver CSS .reveal-left/.reveal-right/
   .reveal-down/.reveal-up en portal.html, con opacity:0 !important +
   visibility:hidden mientras NO tenga .in-view) y se revela cada vez que
   el usuario hace scroll y el elemento entra activamente al viewport.
   Re-trigger (once:false): al salir del viewport se le quita .in-view,
   así vuelve a animarse la próxima vez que reaparezca en pantalla, tanto
   bajando como subiendo. Motor principal: IntersectionObserver (barato,
   no corre en cada evento de scroll, y sigue observando el elemento en
   vez de dejar de hacerlo tras la primera entrada). Respaldo: un chequeo
   manual por getBoundingClientRect atado a scroll/resize (igual que AOS
   clásico), por si el observer no detecta bien el contenedor de scroll
   real (simuladores/iframes anidados) — también revierte el estado al
   salir de vista. ── */
const _SR_CLASSES = ['reveal-left','reveal-right','reveal-down','reveal-up'];
const _SR_SELECTOR = _SR_CLASSES.map(c=>`.${c}:not(.in-view)`).join(', ');
const _srReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// Al terminar la transición de entrada solo limpiamos el transition-delay
// del stagger (para que una futura transición del elemento, p. ej. el
// hover de la tarjeta, no herede ese retraso, y para que el próximo
// re-trigger tampoco lo arrastre). La variante final (.in-view) no
// declara "transform", así nunca compite con el transform:translateY(-2px)
// de :hover — solo la variante :not(.in-view) declara transform.
function _srSettle(el){
  el.addEventListener('transitionend', function onEnd(ev){
    if (ev.propertyName !== 'transform') return;
    el.removeEventListener('transitionend', onEnd);
    el.style.transitionDelay = '';
  });
}

// Busca el ancestro desplazable más cercano (overflow-y auto/scroll con
// contenido más alto que su caja) para usarlo como "root" real del
// IntersectionObserver y como listener adicional de scroll. Si la página
// entera hace scroll con la ventana (caso normal), devuelve null.
function _srFindScrollRoot(el){
  let node = el ? el.parentElement : null;
  while (node && node !== document.body && node !== document.documentElement){
    const cs = window.getComputedStyle(node);
    if ((cs.overflowY==='auto' || cs.overflowY==='scroll' || cs.overflowY==='overlay') &&
        node.scrollHeight > node.clientHeight + 4){
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

let _srObserver = null;
let _srRoot = null;
let _srRootComputed = false;
function _srGetObserver(sampleEl){
  if (_srObserver) return _srObserver;
  if (!_srRootComputed){
    _srRootComputed = true;
    _srRoot = _srFindScrollRoot(sampleEl);
  }
  _srObserver = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      const el = entry.target;
      if (entry.isIntersecting){
        if (!el.classList.contains('in-view')){
          el.classList.add('in-view');
          _srSettle(el);
        }
      } else {
        el.classList.remove('in-view');
      }
    });
  }, {root:_srRoot, threshold:0.15, rootMargin:'0px 0px -50px 0px'});
  return _srObserver;
}

// ── Respaldo manual estilo AOS clásico (scroll + getBoundingClientRect) ──
// Cubre casos raros donde el IntersectionObserver no dispara en el
// contenedor de scroll real (p. ej. un simulador/iframe anidado). Igual
// que el observer, alterna .in-view en ambas direcciones (no descarta el
// elemento tras la primera entrada) para soportar el re-trigger.
let _srManualTargets = [];
let _srManualBound = false;
function _srManualCheck(){
  if (!_srManualTargets.length) return;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  _srManualTargets = _srManualTargets.filter(el=>{
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const visible = r.top < vh - 50 && r.bottom > 0;
    if (visible && !el.classList.contains('in-view')){
      el.classList.add('in-view');
      _srSettle(el);
    } else if (!visible && el.classList.contains('in-view')){
      el.classList.remove('in-view');
    }
    return true;
  });
}
function _srBindManualFallback(){
  if (_srManualBound) return;
  _srManualBound = true;
  const handler = ()=>{ requestAnimationFrame(_srManualCheck); };
  window.addEventListener('scroll', handler, {passive:true});
  window.addEventListener('resize', handler, {passive:true});
  if (_srRoot) _srRoot.addEventListener('scroll', handler, {passive:true});
}

function initScrollReveal(root){
  root = root || document;
  if (!root.querySelectorAll) return;
  const els = root.querySelectorAll(_SR_SELECTOR);
  if (!els.length) return;

  // Sin soporte de animación (navegador muy viejo) o el usuario prefiere
  // menos movimiento: mostrar todo directo, sin observar nada.
  if (_srReducedMotion || !('IntersectionObserver' in window)){
    els.forEach(el=>el.classList.add('in-view'));
    return;
  }

  // Stagger: agrupamos por el ancestro [data-stagger] más cercano de cada
  // elemento y les damos un retraso creciente (tope 420ms para que listas
  // largas no tarden una eternidad en terminar de aparecer).
  const grupos = new Map();
  els.forEach(el=>{
    const grupo = el.closest('[data-stagger]');
    if (!grupo){ el.style.transitionDelay=''; return; }
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo).push(el);
  });
  grupos.forEach(lista=>{
    lista.forEach((el,i)=>{ el.style.transitionDelay = Math.min(i*70,420)+'ms'; });
  });

  const io = _srGetObserver(els[0]);
  els.forEach(el=>{
    io.observe(el);
    if (_srManualTargets.indexOf(el)===-1) _srManualTargets.push(el);
  });
  _srBindManualFallback();
  requestAnimationFrame(_srManualCheck);
}

async function pNavigate(view, firstTime=false){
  // Cuentas "solo cursos" (ver soloCursosExternos, seteado en server.js al
  // canjear un token de curso externo) no tienen Inicio, Perfil ni
  // Referidos — su portal es ÚNICAMENTE la pantalla de Cursos Exclusivos.
  // Cualquier intento de llevarlas a otra vista (el botón "← Volver", el
  // avatar del header que abre Perfil, código viejo, un link guardado) cae
  // en Cursos en su lugar. Centralizado acá para no tener que blindar cada
  // llamador de pNavigate() por separado.
  if (currentUser && currentUser.soloCursosExternos && view!=='cursos'){
    view = 'cursos';
  }
  activeView=view;
  document.querySelectorAll('.pnav-btn').forEach(b=>{
    const on=b.dataset.pview===view;
    b.classList.toggle('active',on);
  });
  portalPlayNav();
  // Si el alumno estaba scrolleado hacia abajo (p.ej. clickeó una tarjeta
  // del Reel de Cursos, que vive más abajo en Inicio), sin esto la vista
  // nueva quedaba "muy abajo" — arrancamos siempre desde arriba.
  window.scrollTo(0,0);

  // Cerrar sidebar en móvil al navegar
  const nav=$('portalNav'), ov=$('portalSidebarOverlay');
  if(nav) nav.classList.remove('open');
  if(ov)  ov.classList.remove('open');

  // Botón "← Volver" (solo móvil): visible en cualquier vista que no sea
  // Inicio — salvo cuentas "solo cursos", que no tienen a dónde volver
  // (su única pantalla es Cursos), así que directamente no se los mostramos.
  const backBtn=$('pBackBtn');
  if(backBtn) backBtn.classList.toggle('show', view!=='inicio' && !(currentUser && currentUser.soloCursosExternos));

  // Al salir de Inicio se detiene el auto-avance de los carruseles (Eventos y Reel de Cursos)
  if (view!=='inicio'){ evDetenerAutoplay(); crDetenerAutoplay(); }

  const cont=$('portalContent');
  cont.className='';
  cont.innerHTML='';
  const fade=document.createElement('div');
  fade.style.animation='fade .28s cubic-bezier(.4,0,.2,1)';
  cont.appendChild(fade);

  // Recargar clases/perfil al entrar a inicio para reflejar cambios del admin
  if(view==='inicio'){
    await recargarMisClases();
  }

  if (view==='inicio')        renderInicio(fade);
  else if(view==='referidos') renderReferidos(fade);
  else if(view==='perfil')    renderPerfil(fade, firstTime);
  else if(view==='cursos')    renderCursosExclusivos(fade);
}

/* ══════════════════════════════════════════════
   SECCIÓN 0 — INICIO (Dashboard de bienvenida)
══════════════════════════════════════════════ */
async function renderInicio(cont){
  const u = currentUser;
  _actualizarFuegoDiario(); // fire-and-forget: suma 1 día al fueguito si es la primera vez hoy
  const tieneVideosPreCarga = u.plan === '80' || u.hasPortalAccess;
  // Se carga siempre (no solo con acceso VIP): los Talleres/Eventos son públicos
  // y tienen que verse en la tarjeta Calendario de CUALQUIER alumno registrado,
  // no solo de quienes tienen acceso al Aula Virtual.
  if (!allVideos.length){
    try {
      const r=await fetch('/api/videos',{credentials:'same-origin'});
      if (r.ok) allVideos=await r.json();
    } catch { /* se mostrará el aviso de "sin vídeos" más abajo */ }
  }
  // Catálogo de Cursos Exclusivos para el Reel — también se carga siempre,
  // para cualquier alumno, sea cual sea su plan (el acceso lo decide
  // cursosAsignados por alumno, no el plan/portalAccess).
  if (!allCursos.length){
    try {
      const rc=await fetch('/api/cursos',{credentials:'same-origin'});
      if (rc.ok) allCursos=await rc.json();
    } catch { /* se mostrará vacío el Reel de Cursos */ }
  }
  const hora = new Date().getHours();
  const saludo = hora < 13 ? '¡Buenos días' : hora < 20 ? '¡Buenas tardes' : '¡Buenas noches';
  const primerNombre = (u.nombre||'').split(' ')[0] || 'bailarín';
  const foto = u.fotoPerfil || null;

  const tieneVideos = u.plan === '80' || u.hasPortalAccess;
  const planLabel_  = planLabel(u.plan);
  const totalClases = myClasses.length;
  const nivelesBachataArr = nivelesArr(u.nivelBachata);
  const nivelesSalsaArr   = nivelesArr(u.nivelSalsa);
  const nivelBachata = nivelesBachataArr.length ? nivelesBachataArr.sort((a,b)=>a-b).map(nivelLabelFull).join(' · ') : '—';
  const nivelSalsa   = nivelesSalsaArr.length   ? nivelesSalsaArr.sort((a,b)=>a-b).map(nivelLabelFull).join(' · ')   : '—';

  cont.innerHTML = `<div id="inicioWrap" data-stagger>

    <!-- ── Hero + estadísticas, fusionados en una sola tarjeta ── -->
    <div class="bienvenida-hero reveal-down" style="--rv-dist:50px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div id="pHeroAvatar" class="hero-avatar hero-avatar-xl" onclick="pNavigate('perfil')" title="Editar mi foto de perfil"></div>
        <div>
          <div style="font-size:8px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;margin-bottom:3px;">Academia Malevo</div>
          <h1 style="margin-bottom:2px;font-size:15px;">${saludo}, ${esc(primerNombre)}! 👋</h1>
          <div class="bienvenida-plan" style="margin-top:4px;padding:3px 10px;font-size:8.5px;">
            🎓 ${esc(planLabel_)}
            ${tieneVideos ? '&nbsp;·&nbsp;<span style="color:var(--white);">✓ Aula Virtual</span>' : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div class="stat-box" style="min-width:62px;padding:6px 8px;">
          <div class="stat-num" style="font-size:9.5px;white-space:nowrap;${nivelesBachataArr.length?'color:var(--gold);':''}">${nivelBachata}</div>
          <div class="stat-lbl" style="font-size:7px;">Bachata</div>
        </div>
        <div class="stat-box" style="min-width:62px;padding:6px 8px;">
          <div class="stat-num" style="font-size:9.5px;white-space:nowrap;${nivelesSalsaArr.length?'color:var(--gold);':''}">${nivelSalsa}</div>
          <div class="stat-lbl" style="font-size:7px;">Salsa</div>
        </div>
        <div class="stat-box" style="min-width:40px;padding:6px 8px;">
          <div class="stat-num" style="font-size:13px;">${totalClases}</div>
          <div class="stat-lbl" style="font-size:7px;">Clases</div>
        </div>
      </div>
    </div>

    <!-- Invitar amigos: tarjeta dorada premium, justo debajo del saludo,
         para que sea lo primero que llame la atención del alumno. ── -->
    <div class="card ref-hero-card reveal-up" style="--rv-dist:0px;margin-bottom:24px;">
      <div class="ref-hero-title">🎁 Invita y gana</div>
      <p class="ref-hero-sub">Comparte tu enlace personal. Cada amigo que se registre y pague te da un 30% de descuento en una cuota — y se acumula por cada amigo.</p>
      <div id="refBlock">
        <div style="color:var(--muted);font-size:13px;padding:10px 0;">Cargando…</div>
      </div>
    </div>

    <!-- Calendario + Racha lado a lado en escritorio (la Racha ocupa el
         espacio que sobra a la derecha del calendario cuadrado); en móvil
         se apilan como antes ── -->
    <div class="racha-cal-row">
      ${renderCalendarioCard(true)}
      ${renderRachaCard(true)}
    </div>

    <!-- ══ SECCIÓN VÍDEOS (fusionada en Inicio) ══ -->
    <!-- 5º bloque de la secuencia de entrada inicial: entra desde abajo —
         el wrapper es estable (solo se recrea al volver a montar Inicio),
         así que puede llevar la clase de forma permanente; al usar el motor
         de scroll-reveal (re-trigger) en vez del @keyframes de una sola
         vez, también se re-anima si el bloque sale y vuelve a entrar en
         pantalla al hacer scroll. -->
    <div id="seccionVideos" class="reveal-up" style="--rv-dist:60px;">${construirBloqueVideos()}</div>

    <!-- Mi perfil -->
    <div class="h2" style="margin-bottom:14px;margin-top:28px;">Mi espacio</div>
    <div class="inicio-grid-3" style="margin-bottom:28px;">
      <div class="acceso-card reveal-left" style="--rv-dist:80px;" onclick="pNavigate('perfil')">
        <div class="acceso-icon">👤</div>
        <div class="acceso-title">Mi perfil</div>
        <div class="acceso-desc">Actualiza tus datos, foto y preferencias de baile.</div>
        ${!u.profileComplete?'<span class="badge warn">⚠ Incompleto</span>':'<span class="badge ok">✓ Completado</span>'}
      </div>
      <div class="acceso-card reveal-right" style="--rv-dist:80px;cursor:default;">
        <div class="acceso-icon">📞</div>
        <div class="acceso-title">Contacto</div>
        <div class="acceso-desc">¿Dudas? Habla con Gastón o Gimena.</div>
        <span class="badge muted">Academia Malevo</span>
      </div>
    </div>

    ${!myClasses.length?`
    <div class="reveal-up" style="background:var(--card-bg);border:1px solid var(--card-border);
      border-radius:var(--r-lg);padding:20px 24px;display:flex;gap:16px;align-items:flex-start;">
      <span style="font-size:22px;flex:0 0 auto;">ℹ️</span>
      <div>
        <div style="font-size:13.5px;font-weight:600;color:var(--white);margin-bottom:4px;">Tu horario estará disponible pronto</div>
        <div style="font-size:13px;color:var(--text-2);line-height:1.65;">
          Una vez confirmada tu matrícula, Gastón o Gimena asignarán tus clases y aparecerán aquí automáticamente.</div>
      </div>
    </div>`:''}
  </div>`;

  pintarAvatar('pHeroAvatar', foto, u.nombre, 64);

  // Inicializar el bloque de vídeos. Se llama siempre (no solo con acceso
  // VIP): el reproductor/playlists de clase sí quedan condicionados
  // adentro a tieneVideos, pero el Reel de Cursos y el carrusel de Eventos
  // son públicos y deben pintarse para cualquier alumno.
  inicializarBloqueVideos(tieneVideos);

  // Cargar bloque de referidos de forma asíncrona
  cargarRefBlock();

  // Animación scroll-reveal: tarjetas del Inicio (hero, invitar amigos,
  // racha/calendario, vídeos, mi espacio) aparecen deslizándose al entrar
  // en pantalla, con retraso escalonado entre ellas.
  initScrollReveal(cont);
}

/* ── Carga asíncrona del bloque de referidos en el Inicio ── */
async function cargarRefBlock(){
  const block = $('refBlock');
  if (!block) return;
  try {
    const r = await fetch('/api/referral',{credentials:'same-origin'});
    if (!r.ok) throw new Error();
    const data = await r.json();
    const link = data.link || `${malevoBaseUrl()}/registro-membresia.html?ref=${data.code}`;
    block.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.12);
          border-radius:12px;padding:14px;text-align:center;">
          <div style="font-family:'Sora',sans-serif;font-size:28px;font-weight:800;color:var(--gold-2);">${data.referred}</div>
          <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Amigos invitados</div>
        </div>
        <div class="ref-discount-box${data.discount>0?' ref-discount-active':''}">
          ${data.discount>0
            ? `<img src="assets/descuento-30-fuego.webp" alt="30% de descuento activo" class="ref-discount-img">
               <div class="ref-discount-label ref-discount-label-active">Descuento activo · ${data.mesesPendientes} mes${data.mesesPendientes===1?'':'es'}</div>`
            : `<div class="ref-discount-num">${data.discount}%</div><div class="ref-discount-label">Descuento activo</div>`}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="refLink" value="${esc(link)}" readonly
          style="background:rgba(226,144,35,.06);border-color:rgba(226,144,35,.2);
            color:var(--gold-light);font-size:12.5px;flex:1;min-width:200px;cursor:pointer;"
          onclick="this.select();">
        <button class="btn sm" onclick="copiarEnlace('${esc(link)}')">📋 Copiar</button>
        <button class="btn sm sec" onclick="compartirWhatsapp('${esc(link)}')">💬 WhatsApp</button>
      </div>`;
  } catch {
    block.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px 0;">
      No se pudo cargar el enlace de referidos.</div>`;
  }
}

/* ══════════════════════════════════════════════
   SECCIÓN 1 — MIS VÍDEOS (solo VIP plan 80)
══════════════════════════════════════════════ */
/* ── Construye el HTML del bloque de vídeos para insertarlo en el muro de Inicio.
   No hace fetch (eso ya lo hizo renderInicio antes de llamar aquí). ── */
function construirBloqueVideos(){
  const tieneAcceso = currentUser.plan === '80' || currentUser.hasPortalAccess ||
    PORTAL_PLANS.includes(currentUser.plan);

  // El Reel de Cursos Exclusivos y el carrusel de Eventos/Talleres son
  // públicos: se muestran a CUALQUIER alumno, tenga o no el Aula Virtual
  // (plan VIP). Antes, un "return" temprano acá cortaba TODO el bloque —
  // incluido el Reel y Eventos — para alumnos sin VIP, dejándolos sin ver
  // el slider nunca. Ahora ese bloque final se arma siempre, al margen de
  // si el resto del contenido (niveles de clase) está bloqueado o no.
  if (!tieneAcceso){
    return `<div class="card" style="text-align:center;padding:40px 32px;margin-bottom:32px;">
      <div style="font-size:48px;margin-bottom:14px;">🎓</div>
      <h2 style="font-family:'Sora',sans-serif;font-size:20px;font-weight:700;
        margin-bottom:10px;color:var(--white);">Aula Virtual exclusiva VIP</h2>
      <p style="color:var(--text-2);font-size:13.5px;line-height:1.7;margin-bottom:24px;">
        El acceso a los vídeos está disponible con el plan<br>
        <strong style="color:var(--gold);">VIP · Full Pass · 80 €/mes</strong></p>
      <p style="color:var(--muted);font-size:12.5px;">
        Habla con Gastón o Gimena para actualizar tu plan.</p>
    </div>`
    + renderCursosReelCard()
    + renderEventosCarouselCard();
  }

  if (!allVideos.length){
    return `<div class="vacio" style="margin-bottom:32px;">Sin vídeos disponibles todavía.</div>`
    + renderCursosReelCard()
    + renderEventosCarouselCard();
  }

  const nivelesCards = [];
  DISCIPLINAS_VIDEO.forEach(disc=>{
    const acceso = nivelesToAcceso(disc);
    [1,2,3,4].forEach(n=>{
      if (!acceso.includes(n)) return; // sin acceso a este nivel → ni se construye la tarjeta
      const vids = videosDeNivel(disc,n);
      if (!vids.length) return;
      const vistos = nivelVideosCompletados(disc,n); // completados de verdad, no solo abiertos
      const pct = Math.round(vistos/vids.length*100);
      nivelesCards.push({disc,n,vids,vistos,pct,bonus:bonusDeNivel(disc,n)});
    });
  });
  const calent = calentamientos();
  const lastId = getLastVideoId();
  const lastVideo = lastId ? allVideos.find(v=>v.id===lastId) : null;

  let html = '';

  // ── Calentamientos: sección propia e independiente, no mezclada con los
  // niveles. Va en la parte superior del módulo, por encima del catálogo
  // principal de clases. ──
  if (calent.length){
    html += `<div class="card reveal-up" style="margin-bottom:20px;padding:22px 20px;">
      <div class="h2" style="margin-bottom:14px;">🔥 Mis Calentamientos y Estiramientos</div>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 14px;">Independiente de tus niveles — úsalos antes de ensayar.</p>
      <div data-stagger style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        ${calent.map((v,i)=>`<div class="video-item calent-item ${i%2===0?'reveal-left':'reveal-right'}" style="--rv-dist:100px;" onclick="reproducirEnHub('${v.id}')">
          ${esVisto(v.id)?'<span class="vi-done" title="Ya lo hiciste"></span>':''}
          <div class="vi-title">${esc(v.titulo)}</div>
          <div class="vi-disc">Calentamiento</div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  if (lastVideo){
    html += `<div class="card reveal-up" style="margin-bottom:20px;display:flex;align-items:center;gap:16px;cursor:pointer;"
      onclick="reproducirEnHub('${lastVideo.id}')">
      <div style="width:44px;height:44px;border-radius:50%;background:rgba(226,144,35,.1);
        border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;flex:0 0 auto;color:var(--gold);">▶</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:3px;">Continuar viendo</div>
        <div style="font-size:14px;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(lastVideo.titulo)}</div>
      </div>
      <span style="color:var(--gold);font-size:20px;">›</span>
    </div>`;
  }

  html += `<div class="section-divider"><span class="line"></span><span class="label">▶ Mis Vídeos</span><span class="line"></span></div>`;

  if (!nivelesCards.length){
    html += `<div class="vacio" style="margin-bottom:32px;">Aún no hay vídeos para tu nivel. Habla con Gastón o Gimena.</div>`;
  } else {
    html += `<div data-stagger style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:20px;">`;
    nivelesCards.forEach((nc,idx)=>{
      const bonusListo = bonusNivelDesbloqueado(nc.disc,nc.n);
      const bonusDesbloqueados = bonusListo ? nc.bonus.length : nc.bonus.filter(bv=>esBonusDesbloqueadoPorRacha(bv.id)).length;
      const desbloqueadosNivel = nivelVideosDesbloqueados(nc.disc,nc.n);
      html += `<div class="card ${idx%2===0?'reveal-left':'reveal-right'}" style="--rv-dist:120px;cursor:pointer;" onclick="abrirNivelHub('${nc.disc}',${nc.n})">
        <div style="font-weight:700;color:var(--white);font-size:13.5px;margin-bottom:12px;">${nc.disc} ${nivelLabelFull(nc.n)}</div>
        <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:10px;">
          <span style="font-family:'Sora',sans-serif;font-size:32px;font-weight:800;color:var(--stat-number);">${nc.vids.length + nc.bonus.length}</span>
          <span style="font-size:10px;color:var(--muted);letter-spacing:1px;">CLASES</span>
        </div>
        <div style="display:flex;gap:3px;margin-bottom:10px;">
          ${nc.vids.map((v,i)=>`<div style="flex:1;height:5px;border-radius:2px;
            background:${esCompletado(v.id)?'var(--progress-accent)':(i<desbloqueadosNivel?'var(--progress-accent-soft)':'rgba(255,255,255,.1)')};transition:background .3s;"></div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;color:var(--muted);">${nc.vistos}/${nc.vids.length} completadas</span>
          <span style="font-size:12px;color:var(--gold);font-weight:600;">Ver →</span>
        </div>
        ${nc.bonus.length ? `<div style="display:flex;align-items:center;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--card-border);">
            <span style="font-size:13px;">🎁</span>
            <span style="font-size:10.5px;color:var(--muted);">Bonus: ${bonusDesbloqueados}/${nc.bonus.length} desbloqueados</span>
          </div>` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  html += renderCursosReelCard();

  html += `<div class="portal-paralelo">${renderMiPlaylistCard()}${renderEventosCarouselCard()}</div>`;

  html += `<div id="aulaWrap" style="display:none;position:fixed;inset:0;z-index:250;
      align-items:flex-start;justify-content:center;padding:26px 16px;overflow-y:auto;
      background:rgba(5,5,5,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);"
      onclick="if(event.target===this) cerrarPanelVideo()">
    <div class="card" style="width:100%;max-width:1000px;padding:0;overflow:hidden;margin:0 auto;">
      <div id="panelVideoHeader" style="display:flex;align-items:center;justify-content:space-between;gap:14px;
        padding:16px 22px;border-bottom:1px solid var(--card-border);position:sticky;top:0;
        background:var(--card-bg);z-index:2;">
        <div style="min-width:0;">
          <div id="panelVideoTitulo" style="font-size:16px;font-weight:800;color:var(--gold-2);letter-spacing:.2px;"></div>
          <div id="panelVideoSub" style="font-size:11.5px;color:var(--muted);margin-top:2px;"></div>
        </div>
        <button class="btn sm sec" onclick="cerrarPanelVideo()" style="flex:0 0 auto;white-space:nowrap;">← Volver a Cursos</button>
      </div>
      <div id="playerWrap">
        <div id="playerPlaceholder" style="position:absolute;inset:0;display:flex;flex-direction:column;
          align-items:center;justify-content:center;color:var(--muted);gap:14px;background:#0e0e0e;">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=".8" opacity=".2">
            <circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor" opacity=".5"/>
          </svg>
          <span style="font-size:14px;letter-spacing:.5px;">Selecciona una clase para empezar</span>
        </div>
      </div>
      <div id="videoMeta">
        <div id="videoTitle" style="display:none;"></div>
        <div id="videoNotes"></div>
      </div>
      <div id="videoCurrentLabel" class="video-status-bar" style="display:none;">
        <span id="videoCurrentLabelText"></span>
      </div>
      <div id="videoListRow" style="display:flex;gap:16px;align-items:flex-start;padding:20px 24px;">
        <div id="videoList" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;"></div>
      </div>
    </div>
  </div>`;

  // ── Modal explicativo intermedio (Rachas.png): aparece al completar el
  // 1er vídeo de cada par de la mecánica 2x2. Ver mostrarModalDesbloqueo().
  html += `<div id="desbloqueoModalOverlay" class="desbloqueo-modal-overlay" style="display:none;"
      onclick="if(event.target===this) continuarDesdeModalDesbloqueo()">
    <div class="desbloqueo-modal-card">
      <button class="desbloqueo-modal-close" onclick="cerrarModalDesbloqueo()" aria-label="Cerrar" title="Cerrar">✕</button>
      <img src="/tarjetas/desbloqueo/Rachas.jpg" alt="¡Vas muy bien! Sigue así" class="desbloqueo-modal-img"
        onclick="continuarDesdeModalDesbloqueo()">
      <div class="desbloqueo-modal-actions">
        <button class="btn" onclick="continuarDesdeModalDesbloqueo()">Continuar</button>
      </div>
    </div>
  </div>`;

  return html;
}

/* ── Post-montaje: arranca el reproductor y la primera pestaña de playlist.
   Se llama después de insertar construirBloqueVideos() en el DOM. ── */
function inicializarBloqueVideos(tieneVideos){
  // Reproductor de clases + Mi Playlist: solo tiene sentido inicializarlos
  // si el alumno tiene acceso al Aula Virtual (hay niveles/vídeos propios
  // que cargar). Sin acceso, esta parte se omite en silencio.
  if (tieneVideos && allVideos.length){
    const lastId = getLastVideoId();
    const lastVideo = lastId ? allVideos.find(v=>v.id===lastId) : null;
    if (lastVideo){
      reproducirEnHub(lastVideo.id, true);
    } else {
      const disc0 = DISCIPLINAS_VIDEO.find(disc=>{
        const acceso=nivelesToAcceso(disc);
        return [1,2,3,4].some(n=>acceso.includes(n) && videosDeNivel(disc,n).length);
      });
      if (disc0){
        const acceso=nivelesToAcceso(disc0);
        const n0=[1,2,3,4].find(n=>acceso.includes(n) && videosDeNivel(disc0,n).length);
        if (n0) mostrarListaNivel(disc0,n0);
      }
    }

    // "Mi Playlist" siempre arranca con Bachata Nivel 1 resaltado y su lista
    // de canciones cargada, pero SIN reproducir nada automáticamente.
    if ($('miPlaylistCard')){
      mpWireAudioEvents();
      _mpVista = 'playlist';
      mpRepintarTabs();
      mpSeleccionarNivel('Bachata', 1);
    }
  }

  // "Próximos Eventos y Talleres" y el Reel de Cursos Exclusivos son
  // públicos: se pintan para CUALQUIER alumno, tenga o no el Aula Virtual.
  if ($('eventosCarouselCard')){ evPintarCarrusel(); }
  if ($('crReelCard')){ crPintarReel(); }
}

/* ── Normaliza nivelBachata/nivelSalsa (array, número o vacío) a array ── */
function nivelesArr(v){
  if (Array.isArray(v)) return v.map(Number).filter(n=>!isNaN(n));
  if (v===null || v===undefined || v==='') return [];
  return [Number(v)];
}

/* ── Calcula qué niveles puede ver el alumno en una disciplina ──
   Selección libre e independiente: se devuelve exactamente el array de
   niveles asignado a esa disciplina (sin acumulación ni casos especiales
   por plan). Devuelve SIEMPRE un array (nunca null): sin nivel asignado =
   sin acceso. */
function nivelesToAcceso(disc){
  const u = currentUser;
  const valor = disc === 'Bachata' ? u.nivelBachata
              : disc === 'Salsa'   ? u.nivelSalsa
              : null;
  return nivelesArr(valor);
}

/* ── Construye el HTML de la lista de vídeos de un nivel (clases + bonus),
   aplicando los candados de la mecánica 2x2 (clases) y del 100% (bonus).
   Función compartida entre mostrarListaNivel() (que además dispara la
   reproducción) y el refresco silencioso tras cada vídeo completado (que
   NO debe interrumpir lo que se está reproduciendo). ── */
function _construirListaNivelHTML(disc, nivel){
  const vids = videosDeNivel(disc,nivel);
  if (!vids.length){
    return '<div style="padding:20px 22px;color:var(--muted);font-size:13px;text-align:center;">Sin clases en este nivel.</div>';
  }
  const desbloqueados = nivelVideosDesbloqueados(disc,nivel);
  const bonus = bonusDeNivel(disc,nivel);
  const bonusListo = bonusNivelDesbloqueado(disc,nivel);

  let html = '<div style="display:flex;flex-direction:column;gap:8px;">' + vids.map((v,i)=>{
    const completo = esCompletado(v.id);
    if (i>=desbloqueados){
      return `<div class="video-row" style="opacity:.55;cursor:not-allowed;" title="Completa el vídeo anterior para desbloquear esta clase">
        <div class="video-row-num">🔒</div>
        <div style="flex:1;min-width:0;"><div class="video-row-title">${esc(v.titulo)}</div></div>
      </div>`;
    }
    return `<div class="video-row${completo?' visto':''}" data-vid="${v.id}" onclick="playVideo('${v.id}')">
      ${completo?'<span class="vi-done" title="Ya la completaste"></span>':''}
      <div class="video-row-num">${i+1}</div>
      <div style="flex:1;min-width:0;"><div class="video-row-title">${esc(v.titulo)}</div></div>
      <span class="video-row-arrow">▶</span>
    </div>`;
  }).join('') + '</div>';

  if (bonus.length){
    html += `<div style="display:flex;align-items:center;gap:8px;margin:18px 0 10px;padding-top:14px;border-top:1px solid var(--card-border);">
      <span style="font-size:14px;">🎁</span>
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--muted);font-weight:700;">Bonus</span>
    </div>`;
    html += bonus.map((bv,i)=>{
      const porRacha = esBonusDesbloqueadoPorRacha(bv.id);
      const desbloqueado = bonusListo || porRacha;
      if (desbloqueado){
        return `<div class="video-row${esVisto(bv.id)?' visto':''}" data-vid="${bv.id}" onclick="playVideo('${bv.id}')">
          ${esVisto(bv.id)?'<span class="vi-done" title="Ya lo viste"></span>':''}
          <div class="video-row-num" style="background:var(--gold);color:#0a0a0a;border-color:transparent;">🎁</div>
          <div style="flex:1;min-width:0;">
            <div class="video-row-title">${esc(bv.titulo)}</div>
            <div class="video-row-sub">Bonus ${i+1} · ${(porRacha && !bonusListo) ? 'Desbloqueado con tu racha 🔥' : 'Desbloqueado'}</div>
          </div>
          <span class="video-row-arrow" style="opacity:1;">▶</span>
        </div>`;
      }
      return `<div class="video-row" style="opacity:.55;cursor:not-allowed;" title="Completa el 100% de las clases del nivel para desbloquear todo el Bonus">
        <div class="video-row-num">🔒</div>
        <div style="flex:1;min-width:0;">
          <div class="video-row-title">Bonus ${i+1} bloqueado</div>
          <div class="video-row-sub">Completa el 100% de las clases del nivel (${nivelVideosCompletados(disc,nivel)}/${vids.length})</div>
        </div>
      </div>`;
    }).join('');
  }
  return html;
}

/* ── Muestra la lista de vídeos de un nivel en #videoList y reproduce
   el primero pendiente entre los ya desbloqueados (o el último
   desbloqueado, si ya los completó todos) ── */
function mostrarListaNivel(disc, nivel){
  activeDisciplina=disc; activeNivel=nivel;
  const vids = videosDeNivel(disc,nivel);
  const bonus = bonusDeNivel(disc,nivel);
  const totalClases = vids.length + bonus.length;
  const cont=$('videoList'); if (!cont) return;

  if ($('panelVideoTitulo')) $('panelVideoTitulo').textContent = `${disc} · ${nivelLabel(nivel)}`;
  if ($('panelVideoSub'))    $('panelVideoSub').textContent    = `${totalClases} clase${totalClases!==1?'s':''}`;
  cargarReproductorDrive(disc, nivel);

  cont.innerHTML = _construirListaNivelHTML(disc, nivel);
  if (!vids.length) return;

  const desbloqueados = nivelVideosDesbloqueados(disc,nivel);
  const disponibles = vids.slice(0, desbloqueados);
  const primero = disponibles.find(v=>!esCompletado(v.id)) || disponibles[disponibles.length-1];
  playVideo(primero.id);
}

/* ── Abre un nivel desde la tarjeta y hace scroll hasta el panel del reproductor ── */
function abrirNivelHub(disc, nivel){
  mostrarListaNivel(disc, nivel);
  abrirModalVideo();
  portalPlayNav();
}

/* ── Abre el modal de vídeo sin mover el scroll de la página de fondo ── */
function abrirModalVideo(){
  const wrap = $('aulaWrap'); if (!wrap) return;
  wrap.style.display = 'flex';
  // El modal es un overlay fixed con su propio scroll interno (overflow-y:auto).
  // Si el alumno entra desde una tarjeta más abajo en la página, forzamos que
  // arranque siempre desde arriba (reproductor + título visibles de entrada,
  // sin tener que arrastrar el cursor hacia abajo para ver la lista).
  wrap.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

// Cerrar el modal de vídeo con la tecla Escape
document.addEventListener('keydown', e=>{
  if (e.key==='Escape' && $('aulaWrap') && $('aulaWrap').style.display!=='none' && $('aulaWrap').style.display!==''){
    cerrarPanelVideo();
  }
});

/* ── Rotación automática al ampliar un vídeo a pantalla completa ──────────
   La PWA instalada fuerza "orientation":"portrait" en el manifest para que
   el resto de la app no gire sola — pero eso mismo bloquea la rotación
   cuando el alumno pulsa el botón de pantalla completa dentro del propio
   reproductor de YouTube/Vimeo. Aquí escuchamos el evento nativo de
   fullscreen (se dispara solo, sin que nosotros lo pidamos, porque los
   iframes de vídeo llevan allowfullscreen) y usamos la Screen Orientation
   API para levantar el bloqueo mientras el vídeo está en pantalla completa,
   devolviendo el candado a portrait en cuanto se sale. En navegadores sin
   soporte (Safari/iOS) esto simplemente no hace nada y el usuario sigue
   pudiendo girar el móvil a mano como hasta ahora. */
function _elementoFullscreenActivo(){
  return document.fullscreenElement || document.webkitFullscreenElement ||
         document.mozFullScreenElement || document.msFullscreenElement || null;
}
function _onFullscreenChangeOrientacion(){
  const orientacion = window.screen && window.screen.orientation;
  if (!orientacion) return;
  try{
    if (_elementoFullscreenActivo()){
      if (typeof orientacion.unlock === 'function') orientacion.unlock();
      else if (typeof orientacion.lock === 'function') orientacion.lock('landscape').catch(()=>{});
    } else if (typeof orientacion.lock === 'function'){
      orientacion.lock('portrait').catch(()=>{});
    }
  }catch(e){ /* no crítico: si el navegador no lo permite, seguimos igual que antes */ }
}
['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange'].forEach(ev=>{
  document.addEventListener(ev, _onFullscreenChangeOrientacion);
});

/* ══════════════════════════════════════════════════════════════════════
   "Mi Playlist" — estructura vertical: encabezado (título + logo) →
   pestañas (♥ Favoritos | desplegable de Playlists agrupado por
   disciplina) → panel único de canciones con scroll propio → reproductor
   fijo justo debajo de la lista (dentro de la misma tarjeta, no flota
   sobre el resto de la página). Favoritos persistidos en localStorage por
   alumno. Reutiliza driveRecordDeNivel()/obtenerCancionesDrive() (mismo
   caché por carpeta) pero con su propio <audio> y estado, independiente
   del reproductor compacto del panel de vídeo (#drivePlayerWrap). ══════ */
let _mpTracks = [];        // canciones de la playlist elegida en el desplegable
let _mpNivelActivo = null; // {disc, nivel} de esa playlist
let _mpVista = 'playlist'; // 'playlist' | 'favoritos' — qué se ve en el panel de lista
let _mpPlaying = null;     // {disc, nivel, id, name} | null — lo que suena en el reproductor
let _mpFavoritos = null;   // Map<key,{key,disc,nivel,id,name}> — cargado lazy
let _mpVolumen = 0.9;

function mpNivelLabel(disc, nivel){
  return nivel===4 ? `${disc} Musicalidad` : `${disc} Nivel ${nivel}`;
}

function renderMiPlaylistCard(){
  const opcionesDisc = disc=>`<optgroup label="${esc(disc.toUpperCase())}">
      ${[1,2,3,4].map(n=>`<option value="${esc(disc)}|${n}">${esc(mpNivelLabel(disc,n))}</option>`).join('')}
    </optgroup>`;
  return `<div class="card mp-shell reveal-left" id="miPlaylistCard" style="--rv-dist:120px;padding:0;overflow:hidden;">
    <div class="mp-header-row">
      <div>
        <div class="h2" style="margin-bottom:4px;">Mi Playlist</div>
        <p class="mp-header-desc">La música de cada nivel, lista para reproducir.</p>
      </div>
      <div class="mp-header-logo">
        <div class="mp-logo-m">M</div>
        <div class="mp-logo-text">
          <div class="mp-logo-name">MALEVO</div>
          <div class="mp-logo-sub">Academia</div>
        </div>
      </div>
    </div>
    <div class="mp-tabs">
      <button type="button" id="mpTabFav" class="mp-tab" onclick="mpMostrarFavoritos()">♥ Favoritos</button>
      <select id="mpTabPlaylist" class="mp-tab mp-tab-select" onchange="mpDropdownCambio(this.value)">
        <option value="" disabled hidden>🎵 Playlists</option>
        ${DISCIPLINAS_VIDEO.map(opcionesDisc).join('')}
      </select>
    </div>
    <div id="mpListHeader" class="mp-list-header"></div>
    <div id="mpListPanel" class="mp-list-panel"></div>
    <div class="mp-player" id="mpPlayer">
      <audio id="mpAudioEl" style="display:none;"></audio>
      <div class="mp-bb-row1">
        <div class="mp-bb-info">
          <div id="mpNowPlaying" class="mp-bb-title">Selecciona una canción</div>
          <div id="mpNowPlayingSub" class="mp-bb-sub"></div>
        </div>
        <div class="mp-bb-seekwrap">
          <span id="mpTimeActual" class="mp-bb-time">0:00</span>
          <input type="range" id="mpSeek" class="mp-bb-seek" min="0" max="100" value="0" oninput="mpSeekTo(this.value)" aria-label="Progreso">
          <span id="mpTimeTotal" class="mp-bb-time">0:00</span>
        </div>
      </div>
      <div class="mp-bb-row2">
        <div class="mp-bb-transport">
          <button id="mpPrevBtn" class="mp-bb-btn" onclick="mpAnterior()" aria-label="Anterior">⏮</button>
          <button id="mpPlayBtn" class="mp-bb-play" onclick="mpTogglePlayPause()" aria-label="Reproducir/Pausar">▶</button>
          <button id="mpNextBtn" class="mp-bb-btn" onclick="mpSiguiente()" aria-label="Siguiente">⏭</button>
        </div>
        <div class="mp-bb-extras">
          <span id="mpBarHeart" class="mp-bb-heart" onclick="mpToggleFavoritoActual()" aria-label="Favorito">♡</span>
          <span class="mp-bb-vol-icon" aria-hidden="true">🔊</span>
          <input type="range" id="mpVolumen" class="mp-bb-vol" min="0" max="100" value="90" oninput="mpSetVolumen(this.value)" title="Volumen" aria-label="Volumen">
        </div>
      </div>
    </div>
  </div>`;
}

function mpEmptyStateHtml(msg){
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
    color:var(--muted);gap:10px;padding:26px 10px;text-align:center;min-height:180px;">
    <span style="font-size:26px;opacity:.4;">🎧</span>
    <span style="font-size:12.5px;">${esc(msg)}</span>
  </div>`;
}

/* ── Pestañas: "Favoritos" (botón) vs. el desplegable "Playlists" ── */
function mpRepintarTabs(){
  const favBtn = $('mpTabFav');
  if (favBtn) favBtn.classList.toggle('active', _mpVista==='favoritos');
  const sel = $('mpTabPlaylist');
  if (sel) sel.classList.toggle('active', _mpVista==='playlist');
}
function mpMostrarFavoritos(){
  _mpVista = 'favoritos';
  mpRepintarTabs();
  mpPintarPanelActivo();
}
function mpDropdownCambio(value){
  if (!value) return;
  const [disc, nivelStr] = value.split('|');
  _mpVista = 'playlist';
  mpRepintarTabs();
  mpSeleccionarNivel(disc, Number(nivelStr));
}
function mpPintarPanelActivo(){
  if (_mpVista === 'favoritos') mpPintarFavoritosPanel();
  else mpPintarListaPanel();
}

/* ── Favoritos: persistidos en localStorage, con clave por alumno (sub del
   JWT), así no se mezclan entre cuentas en el mismo navegador. ── */
function mpFavStorageKey(){
  return `malevo_mp_favoritos_${(currentUser && currentUser.sub) || 'anon'}`;
}
function mpFavKey(disc, nivel, id){ return `${disc}|${nivel}|${id}`; }
function mpCargarFavoritos(){
  if (_mpFavoritos) return _mpFavoritos;
  _mpFavoritos = new Map();
  try{
    const raw = localStorage.getItem(mpFavStorageKey());
    if (raw) JSON.parse(raw).forEach(f=>{ if (f && f.key) _mpFavoritos.set(f.key, f); });
  }catch{}
  return _mpFavoritos;
}
function mpGuardarFavoritos(){
  try{ localStorage.setItem(mpFavStorageKey(), JSON.stringify([..._mpFavoritos.values()])); }catch{}
}
function mpEsFavorito(disc, nivel, id){
  return mpCargarFavoritos().has(mpFavKey(disc, nivel, id));
}
function mpToggleFavorito(disc, nivel, id, name){
  const favs = mpCargarFavoritos();
  const key = mpFavKey(disc, nivel, id);
  if (favs.has(key)) favs.delete(key);
  else favs.set(key, {key, disc, nivel, id, name});
  mpGuardarFavoritos();
  mpPintarPanelActivo();
  mpActualizarCorazonBarra();
}
function mpToggleFavoritoDeLista(i, ev){
  if (ev) ev.stopPropagation();
  const t = _mpTracks[i];
  if (!t || !_mpNivelActivo) return;
  mpToggleFavorito(_mpNivelActivo.disc, _mpNivelActivo.nivel, t.id, t.name);
}
function mpToggleFavoritoActual(){
  if (!_mpPlaying) return;
  mpToggleFavorito(_mpPlaying.disc, _mpPlaying.nivel, _mpPlaying.id, _mpPlaying.name);
}
function mpQuitarFavoritoDeIndice(i, ev){
  if (ev) ev.stopPropagation();
  const favs = [...mpCargarFavoritos().values()];
  const f = favs[i];
  if (!f) return;
  mpToggleFavorito(f.disc, f.nivel, f.id, f.name);
}
/* ── Menú de 3 puntos de cada fila: única acción = favorito on/off ── */
function mpAbrirMenuFila(kind, i, ev){
  if (ev) ev.stopPropagation();
  document.querySelectorAll('.mp-row-menu-pop').forEach(el=>el.remove());
  let disc, nivel, id, name;
  if (kind==='fav'){
    const f = [...mpCargarFavoritos().values()][i];
    if (!f) return;
    ({disc, nivel, id, name} = f);
  } else {
    const t = _mpTracks[i];
    if (!t || !_mpNivelActivo) return;
    disc = _mpNivelActivo.disc; nivel = _mpNivelActivo.nivel; id = t.id; name = t.name;
  }
  const fav = mpEsFavorito(disc, nivel, id);
  const btn = ev.currentTarget;
  const row = btn.closest('.video-row');
  const opcion = document.createElement('button');
  opcion.type = 'button';
  opcion.textContent = fav ? '💔 Quitar de favoritos' : '♥ Agregar a favoritos';
  opcion.onclick = (e)=>{ e.stopPropagation(); mpToggleFavorito(disc, nivel, id, name); pop.remove(); };
  const pop = document.createElement('div');
  pop.className = 'mp-row-menu-pop';
  pop.appendChild(opcion);
  (row || btn.parentElement).appendChild(pop);
  setTimeout(()=>{
    const cerrar = e=>{ if (!pop.contains(e.target)){ pop.remove(); document.removeEventListener('click', cerrar); } };
    document.addEventListener('click', cerrar);
  }, 0);
}

function mpPintarFavoritosPanel(){
  const header = $('mpListHeader');
  const panel = $('mpListPanel');
  if (!panel) return;
  const favs = [...mpCargarFavoritos().values()];
  if (header) header.textContent = favs.length + (favs.length===1?' canción favorita':' canciones favoritas');
  if (!favs.length){
    panel.innerHTML = mpEmptyStateHtml('Toca el ♡ de una canción para agregarla aquí.');
    return;
  }
  const audio = $('mpAudioEl');
  const sonando = audio && !audio.paused;
  panel.innerHTML = favs.map((f,i)=>{
    const esLaQueSuena = _mpPlaying && _mpPlaying.disc===f.disc && _mpPlaying.nivel===f.nivel && _mpPlaying.id===f.id;
    const nombre = (f.name||'').replace(/\.[^.]+$/,'');
    return `<div class="video-row${esLaQueSuena?' active':''}" onclick="mpReproducirFavoritoDeIndice(${i})">
      <div class="video-row-num">${esLaQueSuena && sonando ? '♪' : (i+1)}</div>
      <div style="flex:1;min-width:0;">
        <div class="video-row-title">${esc(nombre)}</div>
        <div class="video-row-sub">${esc(mpNivelLabel(f.disc,f.nivel))}</div>
      </div>
      <span class="video-row-heart fav" onclick="mpQuitarFavoritoDeIndice(${i},event)">♥</span>
      <span class="video-row-menu" onclick="mpAbrirMenuFila('fav',${i},event)">⋮</span>
    </div>`;
  }).join('');
}
async function mpReproducirFavoritoDeIndice(i){
  const favs = [...mpCargarFavoritos().values()];
  const f = favs[i];
  if (!f) return;
  const rec = driveRecordDeNivel(f.disc, f.nivel);
  if (!rec) return;
  let tracks;
  try{ tracks = await obtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey); }catch{ return; }
  const t = tracks.find(x=>x.id===f.id) || {id:f.id, name:f.name};
  mpReproducirTrack(f.disc, f.nivel, t);
  if (_mpVista==='favoritos') mpPintarFavoritosPanel();
}

async function mpSeleccionarNivel(disc, nivel){
  _mpNivelActivo = {disc, nivel};
  const sel = $('mpTabPlaylist'); if (sel) sel.value = `${disc}|${nivel}`;
  driveDetener();               // no dejar sonando el reproductor del panel de vídeo a la vez
  const driveWrap=$('drivePlayerWrap'); if (driveWrap) driveWrap.style.display='none';

  const rec = driveRecordDeNivel(disc, nivel);
  if (!rec || !rec.driveFolderId){
    _mpTracks = [];
    if (_mpVista==='playlist'){
      const header=$('mpListHeader'); if (header) header.textContent = mpNivelLabel(disc,nivel);
      const panel=$('mpListPanel');
      if (panel) panel.innerHTML = mpEmptyStateHtml(`Todavía no hay música cargada para ${mpNivelLabel(disc,nivel)}.`);
    }
    return;
  }

  if (_mpVista==='playlist'){
    const header=$('mpListHeader'); if (header) header.textContent = mpNivelLabel(disc,nivel);
    const panel=$('mpListPanel');
    if (panel) panel.innerHTML = mpEmptyStateHtml('Cargando canciones…');
  }

  try {
    _mpTracks = await obtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey);
    if (_mpVista==='playlist') mpPintarListaPanel();
  } catch(e){
    _mpTracks = [];
    if (_mpVista==='playlist'){
      const panel=$('mpListPanel');
      if (panel) panel.innerHTML = `<div style="padding:14px 4px;color:var(--warn);font-size:12.5px;line-height:1.6;">
        No se pudo cargar la música de este nivel. Verifica que la carpeta esté compartida como
        "Cualquier persona con el enlace" y que la clave de API de Google Drive sea correcta.</div>`;
    }
  }
}

function mpWireAudioEvents(){
  // El <audio> vive en el reproductor fijo y se crea una sola vez (no se
  // recrea al cambiar de lista), así que solo hace falta engancharlo aquí.
  const audio = $('mpAudioEl');
  if (!audio) return;
  audio.volume = _mpVolumen;
  audio.addEventListener('play',  ()=>{ const b=$('mpPlayBtn'); if (b) b.textContent='⏸'; });
  audio.addEventListener('pause', ()=>{ const b=$('mpPlayBtn'); if (b) b.textContent='▶'; });
  audio.addEventListener('ended', mpSiguiente);
  audio.addEventListener('loadedmetadata', ()=>{
    const tt=$('mpTimeTotal'); if (tt) tt.textContent = mpFormatTiempo(audio.duration);
  });
  audio.addEventListener('timeupdate', ()=>{
    const seek=$('mpSeek');
    if (seek && audio.duration) seek.value = String(audio.currentTime/audio.duration*100);
    const ta=$('mpTimeActual'); if (ta) ta.textContent = mpFormatTiempo(audio.currentTime);
  });
}
function mpFormatTiempo(s){
  if (!isFinite(s) || s<0) return '0:00';
  const m=Math.floor(s/60), sec=Math.floor(s%60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function mpSetVolumen(val){
  _mpVolumen = Math.max(0, Math.min(1, val/100));
  const audio = $('mpAudioEl');
  if (audio) audio.volume = _mpVolumen;
}

function mpPintarListaPanel(){
  const header = $('mpListHeader');
  const panel = $('mpListPanel');
  if (!panel || !_mpNivelActivo) return;
  const disc = _mpNivelActivo.disc, nivel = _mpNivelActivo.nivel;
  if (!_mpTracks.length){
    if (header) header.textContent = mpNivelLabel(disc,nivel);
    panel.innerHTML = mpEmptyStateHtml('Sin canciones en esta carpeta.');
    return;
  }
  if (header) header.textContent = `${mpNivelLabel(disc,nivel)} · ${_mpTracks.length}${_mpTracks.length===1?' canción':' canciones'}`;
  const audio = $('mpAudioEl');
  const sonando = audio && !audio.paused;
  panel.innerHTML = _mpTracks.map((t,i)=>{
    const esLaQueSuena = _mpPlaying && _mpPlaying.disc===disc && _mpPlaying.nivel===nivel && _mpPlaying.id===t.id;
    const fav = mpEsFavorito(disc, nivel, t.id);
    const nombre = (t.name||'').replace(/\.[^.]+$/,'');
    return `<div class="video-row${esLaQueSuena?' active':''}" onclick="mpReproducir(${i})">
      <div class="video-row-num">${esLaQueSuena && sonando ? '♪' : (i+1)}</div>
      <div style="flex:1;min-width:0;"><div class="video-row-title">${esc(nombre)}</div></div>
      <span class="video-row-heart${fav?' fav':''}" onclick="mpToggleFavoritoDeLista(${i},event)">${fav?'♥':'♡'}</span>
      <span class="video-row-menu" onclick="mpAbrirMenuFila('lista',${i},event)">⋮</span>
    </div>`;
  }).join('');
}

function mpReproducir(i){
  const t = _mpTracks[i];
  if (!t || !_mpNivelActivo) return;
  mpReproducirTrack(_mpNivelActivo.disc, _mpNivelActivo.nivel, t);
}
/* Reproduce una canción puntual (viene de la lista activa o de Favoritos)
   identificada por disc/nivel/id — así el reproductor no depende de cuál
   vista (Favoritos o Playlists) esté mirando el alumno en ese momento. */
function mpReproducirTrack(disc, nivel, t){
  const rec = driveRecordDeNivel(disc, nivel);
  if (!rec) return;
  const audio = $('mpAudioEl');
  if (!audio) return;
  _mpPlaying = {disc, nivel, id:t.id, name:t.name};
  audio.src = `https://www.googleapis.com/drive/v3/files/${t.id}?alt=media&key=${encodeURIComponent(rec.driveApiKey)}`;
  audio.play().catch(()=>{});
  mpPintarPanelActivo();
  const lbl = $('mpNowPlaying'); if (lbl) lbl.textContent = (t.name||'').replace(/\.[^.]+$/,'');
  const sub = $('mpNowPlayingSub'); if (sub) sub.textContent = mpNivelLabel(disc, nivel);
  mpActualizarCorazonBarra();
}
function mpActualizarCorazonBarra(){
  const heart = $('mpBarHeart');
  if (!heart) return;
  if (!_mpPlaying){ heart.textContent='♡'; heart.classList.remove('fav'); return; }
  const fav = mpEsFavorito(_mpPlaying.disc, _mpPlaying.nivel, _mpPlaying.id);
  heart.textContent = fav ? '♥' : '♡';
  heart.classList.toggle('fav', fav);
}
function mpTogglePlayPause(){
  const audio = $('mpAudioEl'); if (!audio) return;
  if (!audio.src){ if (_mpTracks.length) mpReproducir(0); return; }
  if (audio.paused) audio.play().catch(()=>{}); else audio.pause();
}
async function mpAvanzar(delta){
  if (!_mpPlaying) return;
  const rec = driveRecordDeNivel(_mpPlaying.disc, _mpPlaying.nivel);
  if (!rec) return;
  let tracks;
  try{ tracks = await obtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey); }catch{ return; }
  if (!tracks.length) return;
  const i = tracks.findIndex(t=>t.id===_mpPlaying.id);
  const next = tracks[((i<0?0:i)+delta+tracks.length)%tracks.length];
  mpReproducirTrack(_mpPlaying.disc, _mpPlaying.nivel, next);
}
function mpSiguiente(){ mpAvanzar(1); }
function mpAnterior(){ mpAvanzar(-1); }
function mpSeekTo(pct){
  const audio = $('mpAudioEl');
  if (audio && audio.duration) audio.currentTime = (pct/100)*audio.duration;
}
function mpDetener(){
  const audio = $('mpAudioEl');
  if (audio) audio.pause();
  _mpPlaying = null;
  const lbl = $('mpNowPlaying'); if (lbl) lbl.textContent = 'Selecciona una canción';
  const sub = $('mpNowPlayingSub'); if (sub) sub.textContent = '';
  mpActualizarCorazonBarra();
  mpPintarPanelActivo();
}

/* ── Cierra el panel del reproductor (botón "× Cerrar") ── */
function cerrarPanelVideo(){
  const wrap=$('aulaWrap'); if (!wrap) return;
  wrap.style.display='none';
  document.body.style.overflow = '';
  const label=$('videoCurrentLabel'); if (label) label.style.display='none';
  driveDetener();
  const driveWrap=$('drivePlayerWrap'); if (driveWrap) driveWrap.style.display='none';
}

/* ── Reproduce un vídeo suelto (continuar viendo / calentamiento / taller),
   reconstruyendo el contexto de lista que corresponda.
   sinScroll=true → solo precarga el contenido del modal sin abrirlo
   (se usa al restaurar "continuar viendo" al cargar la página). ── */
function reproducirEnHub(id, sinScroll){
  const v = allVideos.find(x=>x.id===id);
  if (!v) return;

  if (!v.tipo || v.tipo==='clase' || v.tipo==='bonus'){
    mostrarListaNivel(v.disciplina, v.nivel);
    playVideo(id); // seleccionar exactamente este, no el primero no-visto
  } else if (v.tipo==='calentamiento'){
    driveDetener();
    const driveWrap=$('drivePlayerWrap'); if (driveWrap) driveWrap.style.display='none';
    const grupo = calentamientos();
    if ($('panelVideoTitulo')) $('panelVideoTitulo').textContent = '🔥 Mis Calentamientos y Estiramientos';
    if ($('panelVideoSub'))    $('panelVideoSub').textContent    = `${grupo.length} vídeo${grupo.length!==1?'s':''}`;
    const cont=$('videoList');
    if (cont){
      cont.innerHTML = grupo.map((gv,i)=>`<div class="video-row${esVisto(gv.id)?' visto':''}" data-vid="${gv.id}" onclick="playVideo('${gv.id}')">
          ${esVisto(gv.id)?'<span class="vi-done"></span>':''}
          <div class="video-row-num">${i+1}</div>
          <div style="flex:1;min-width:0;"><div class="video-row-title">${esc(gv.titulo)}</div></div>
          <span class="video-row-arrow">▶</span>
        </div>`).join('');
    }
    playVideo(id);
  }
  if (!sinScroll) abrirModalVideo();
}

/* ══════════════════════════════════════════════════════════════════════
   "Próximos Eventos y Talleres" — carrusel tipo "coverflow", en paralelo
   con "Mi Playlist". Usa db.videos con tipo:'evento' (imagen o vídeo de
   YouTube en .url, fecha/descripción en .notas como JSON) para no
   requerir endpoint nuevo. La tarjeta central va a escala/opacidad 100%;
   las laterales se desplazan, encogen y atenúan según su distancia al
   centro (offset = índice - progreso). Deslizable con el dedo/ratón y con
   las flechas del encabezado; al tocar cualquier tarjeta se abre el
   lightbox a tamaño completo. */
/* Extrae el ID de vídeo de cualquier formato de URL de YouTube: watch?v=,
   youtu.be/, /embed/ y también /shorts/ (los enlaces de YouTube Shorts). */
function youtubeIdFromUrl(url){
  if (!url) return null;
  const m1=url.match(/[?&]v=([^&]+)/); if (m1) return m1[1];
  const m2=url.match(/youtu\.be\/([^?&]+)/); if (m2) return m2[1];
  const m3=url.match(/youtube\.com\/embed\/([^?&]+)/); if (m3) return m3[1];
  const m4=url.match(/youtube\.com\/shorts\/([^?&]+)/); if (m4) return m4[1];
  return null;
}
function eventosCatalogo(){
  return allVideos.filter(v=>v.tipo==='evento').map(v=>{
    let meta={}; try{ meta=JSON.parse(v.notas||'{}'); }catch{}
    return {id:v.id, titulo:v.titulo, imagen:v.url, tipoMedia:meta.tipoImagen||'upload', fecha:meta.fecha||'', descripcion:meta.descripcion||''};
  }).sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''));
}
function formatearFechaEvento(iso){
  try{ const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}); }
  catch{ return iso; }
}
function renderEventosCarouselCard(){
  return `<div class="card reveal-right" id="eventosCarouselCard" style="--rv-dist:120px;padding:0;overflow:hidden;">
    <div style="padding:22px 26px 8px;
      display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="min-width:0;">
        <div class="h2" style="margin-bottom:4px;">🎉 Próximos Eventos y Talleres</div>
        <p style="font-size:12px;color:var(--muted);margin:0;">Desliza o usa las flechas — toca una foto para verla en grande.</p>
      </div>
      <div id="evNavWrap" style="display:none;align-items:center;gap:6px;flex:0 0 auto;">
        <button class="ev-nav-btn" onclick="evScroll(-1)" aria-label="Desplazar a la izquierda">←</button>
        <button class="ev-nav-btn" onclick="evScroll(1)" aria-label="Desplazar a la derecha">→</button>
      </div>
    </div>
    <div id="evCarouselBody"></div>
  </div>`;
}
const EV_AUTOPLAY_MS_PER_CARD = 4200; // tiempo (ms) que tarda en recorrer una tarjeta a velocidad constante

/* Separación horizontal (px) por unidad de offset. Ya no es un número fijo:
   .ev-card ahora tiene un ancho proporcional al contenedor (ver CSS,
   clamp(170px,50%,320px)) para verse igual de grande en un panel angosto
   (vista previa) que en una pantalla ancha (servidor real) — así que la
   separación entre tarjetas tiene que escalar con ella. Se recalcula leyendo
   el ancho/alto ya renderizado de una tarjeta real cada vez que se pinta el
   carrusel o cambia el tamaño de ventana (ver evActualizarCardStep). También
   ajusta el alto de #evCoverflow al alto real de la tarjeta — antes tenía un
   alto fijo "de sobra" (para el caso más grande) que dejaba una franja vacía
   debajo de la tarjeta cuando el ancho real resultaba menor al máximo. */
let _evCardStepPx = 200; // valor de respaldo hasta que haya una tarjeta en el DOM para medir
function evActualizarCardStep(){
  const muestra = document.querySelector('#evCoverflow .ev-card');
  if (!muestra) return;
  _evCardStepPx = muestra.offsetWidth * 0.91;
  const track = $('evCoverflow');
  if (track) track.style.height = muestra.offsetHeight + 'px';
}
window.addEventListener('resize', () => {
  if ($('evCoverflow')){ evActualizarCardStep(); evAplicarTransform(); }
});

/* progreso continuo del carrusel: entero = una tarjeta perfectamente
   centrada; valores intermedios ocurren mientras se anima, se arrastra o
   avanza solo. NO está acotado a [0, n-1]: es un carrusel circular —
   crece o decrece sin límite y cada tarjeta se posiciona por el camino
   más corto alrededor del círculo (ver evAplicarTransform), así el avance
   automático da vueltas sin fin y sin saltos al pasar de la última
   tarjeta a la primera. */
let _evProgress = 0;
let _evAnimRAF = null;       // animación de "snap" a la tarjeta más cercana (flechas / soltar arrastre)
let _evAutoplayRAF = null;   // bucle de avance automático continuo — nunca se cancela solo, solo se pausa
let _evAutoplayLastTs = null;
let _evDragActive = false, _evDragMoved = false, _evDragStartX = 0, _evDragStartProgress = 0;

/* Avance automático CONTINUO (no a saltos): cada frame suma una fracción
   de "unidad de tarjeta" proporcional al tiempo transcurrido, así el
   movimiento es fluido y no se detiene nunca — siempre hay 2-3 tarjetas
   deslizándose a la vez, igual que el efecto de referencia. Se pausa (sin
   cancelar el bucle) mientras el usuario arrastra, hay una animación de
   "snap" en curso (flecha/soltar) o el lightbox está abierto; apenas
   termina esa interacción sigue solo desde donde quedó, sin saltos. */
function _evAutoplayTick(ts){
  if (_evAutoplayLastTs == null) _evAutoplayLastTs = ts;
  const dt = ts - _evAutoplayLastTs;
  _evAutoplayLastTs = ts;
  const eventos = eventosCatalogo();
  const track = $('evCoverflow');
  if (track && eventos.length > 1 && !_evDragActive && !_evAnimRAF){
    const ov = $('evLightboxOverlay');
    const lightboxAbierto = ov && ov.style.display !== 'none';
    if (!lightboxAbierto){
      _evProgress += dt / EV_AUTOPLAY_MS_PER_CARD;
      evAplicarTransform();
    }
  }
  _evAutoplayRAF = requestAnimationFrame(_evAutoplayTick);
}
function evIniciarAutoplay(){
  if (_evAutoplayRAF) return; // ya está corriendo
  _evAutoplayLastTs = null;
  _evAutoplayRAF = requestAnimationFrame(_evAutoplayTick);
}
function evDetenerAutoplayTimer(){
  if (_evAutoplayRAF){ cancelAnimationFrame(_evAutoplayRAF); _evAutoplayRAF = null; }
  _evAutoplayLastTs = null;
}

/* Carrusel tipo "coverflow" circular e infinito: avanza solo sin parar
   nunca (ver evIniciarAutoplay) y también se puede arrastrar con el
   dedo/ratón o mover con las flechas del encabezado. Cada tarjeta abre
   el lightbox al tocarla (ver evAbrirLightbox) para verla a tamaño
   completo. */
function evPintarCarrusel(){
  const eventos = eventosCatalogo();
  const body = $('evCarouselBody');
  const navWrap = $('evNavWrap');
  if (!body) return;
  if (!eventos.length){
    if (navWrap) navWrap.style.display = 'none';
    body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      color:var(--muted);gap:10px;padding:34px 20px;text-align:center;min-height:180px;">
      <span style="font-size:26px;opacity:.4;">🎉</span>
      <span style="font-size:12.5px;">No hay eventos programados por ahora. Vuelve pronto.</span>
    </div>`;
    return;
  }
  if (navWrap) navWrap.style.display = eventos.length>1 ? 'flex' : 'none';
  body.innerHTML = `<div class="ev-coverflow" id="evCoverflow">
    ${eventos.map((ev,i)=>evCardHtml(ev,i)).join('')}
  </div>`;
  _evAttachDrag();
  evActualizarCardStep();
  evAplicarTransform();
  evIniciarAutoplay();
}
/* HTML de una tarjeta: para vídeos de YouTube se usa la miniatura oficial
   de YouTube (sin cargar un iframe por tarjeta) con un botón de play
   superpuesto; el vídeo real solo se carga al abrir el lightbox. */
function evCardHtml(ev, i){
  const ytId = ev.tipoMedia==='youtube' ? youtubeIdFromUrl(ev.imagen) : null;
  const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : ev.imagen;
  return `<div class="ev-card" data-ev-i="${i}" onclick="evClickCard(${i})">
    <div class="ev-card-media">
      ${thumb?`<img src="${esc(thumb)}" alt="${esc(ev.titulo)}" loading="lazy" draggable="false">`:''}
      ${ytId?`<span class="ev-card-play"></span>`:''}
    </div>
    <div class="ev-card-info">
      <div class="ev-card-titulo">${esc(ev.titulo)}</div>
      ${ev.fecha?`<div class="ev-card-fecha">📅 ${esc(formatearFechaEvento(ev.fecha))}</div>`:''}
    </div>
  </div>`;
}
/* Posiciona cada tarjeta según su distancia ("offset") al progreso actual:
   la central (offset 0) queda a escala/opacidad 100%; las laterales se
   desplazan ±280px por unidad de offset, se encogen hasta 0.55 y bajan su
   opacidad hasta 0.2 — misma fórmula que el efecto de referencia. */
function evAplicarTransform(){
  const track = $('evCoverflow');
  if (!track) return;
  const n = eventosCatalogo().length;
  track.querySelectorAll('.ev-card').forEach(card=>{
    const i = Number(card.dataset.evI);
    let offset = i - _evProgress;
    if (n > 1){
      // Camino más corto alrededor del círculo: evita el salto brusco al
      // pasar de la última tarjeta a la primera durante el avance continuo.
      offset = ((offset % n) + n) % n;
      if (offset > n / 2) offset -= n;
    }
    const translateX = offset * _evCardStepPx;
    const scale = Math.max(0.55, 1 - Math.abs(offset) * 0.25);
    const opacity = Math.max(0.2, 1 - Math.abs(offset) * 0.5);
    card.style.transform = `translate(-50%,-50%) translateX(${translateX}px) scale(${scale})`;
    card.style.opacity = opacity;
    card.style.zIndex = Math.round(10 - Math.abs(offset));
  });
}
/* Anima _evProgress hasta "target" con ease-out, repintando en cada
   frame — así llegan las flechas y el "soltar" tras arrastrar. Como el
   carrusel es circular, "target" no se acota a [0, n-1]: puede crecer o
   decrecer sin límite, evAplicarTransform() ya sabe dibujar cada tarjeta
   por el camino más corto sin importar cuántas vueltas lleve. */
function evAnimarA(target){
  const eventos = eventosCatalogo();
  if (!eventos.length) return;
  if (_evAnimRAF){ cancelAnimationFrame(_evAnimRAF); _evAnimRAF = null; }
  const start = _evProgress;
  const delta = target - start;
  if (Math.abs(delta) < 0.001){ _evProgress = target; evAplicarTransform(); return; }
  const dur = 380, t0 = performance.now();
  function paso(now){
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    _evProgress = start + delta * eased;
    evAplicarTransform();
    if (t < 1){ _evAnimRAF = requestAnimationFrame(paso); }
    else { _evProgress = target; evAplicarTransform(); _evAnimRAF = null; }
  }
  _evAnimRAF = requestAnimationFrame(paso);
}
function evScroll(dir){
  evAnimarA(Math.round(_evProgress) + dir);
}
/* Arrastre táctil/ratón: mueve _evProgress en vivo mientras se arrastra
   (con un pequeño rebote fuera de los extremos) y, al soltar, anima hasta
   la tarjeta más cercana. Distingue arrastre de clic real para no abrir
   el lightbox sin querer al deslizar (ver evClickCard). */
function _evAttachDrag(){
  const track = $('evCoverflow');
  if (!track) return;
  track.addEventListener('pointerdown', _evDragStart);
  track.addEventListener('pointermove', _evDragMove);
  track.addEventListener('pointerup', _evDragEnd);
  track.addEventListener('pointercancel', _evDragEnd);
}
function _evDragStart(e){
  if (_evAnimRAF){ cancelAnimationFrame(_evAnimRAF); _evAnimRAF = null; }
  _evDragActive = true;
  _evDragMoved = false;
  _evDragStartX = e.clientX;
  _evDragStartProgress = _evProgress;
  try{ e.currentTarget.setPointerCapture(e.pointerId); }catch{}
  // En móvil, si no se reclama el gesto desde el principio, el navegador
  // puede quedarse con el touch (para su propio scroll/selección) y el
  // carrusel se ve "trabado" — igual que con mouse, pero ahí pasa
  // desapercibido porque el arrastre con mouse no compite con gestos nativos.
  if (e.cancelable) e.preventDefault();
}
function _evDragMove(e){
  if (!_evDragActive) return;
  const dx = e.clientX - _evDragStartX;
  // Umbral generoso (no 4px) para que un toque con el dedo en móvil, que
  // casi siempre tiembla unos píxeles, no se confunda con un arrastre real
  // y termine bloqueando el clic (ver evClickCard).
  if (Math.abs(dx) > 10) _evDragMoved = true;
  // Carrusel circular: no hay extremos que "rebotar".
  _evProgress = _evDragStartProgress - dx / _evCardStepPx;
  evAplicarTransform();
  // Una vez confirmado el arrastre, se reclama el gesto por completo para
  // que el navegador no intente hacer scroll de página a mitad de camino.
  if (_evDragMoved && e.cancelable) e.preventDefault();
}
function _evDragEnd(){
  if (!_evDragActive) return;
  _evDragActive = false;
  evAnimarA(Math.round(_evProgress));
}
/* Solo abre el lightbox si fue un clic real (no el final de un arrastre). */
function evClickCard(i){
  if (_evDragMoved) return;
  evAbrirLightbox(i);
}

/* ── Lightbox de Eventos: vista ampliada a tamaño completo (foto, o vídeo
   de YouTube con sonido) con navegación anterior/siguiente sin cerrar y
   cierre con la X, clic fuera de la tarjeta, o la tecla Escape. ── */
let _evLightboxIndex = 0;
function evAbrirLightbox(i){
  _evLightboxIndex = i;
  evPintarLightbox();
  const ov = $('evLightboxOverlay');
  if (ov) ov.style.display = 'flex';
  document.addEventListener('keydown', _evLightboxKeyHandler);
}
function evCerrarLightbox(){
  const ov = $('evLightboxOverlay');
  if (ov) ov.style.display = 'none';
  const media = $('evLightboxMedia');
  if (media) media.innerHTML = ''; // corta cualquier vídeo de YouTube en reproducción
  document.removeEventListener('keydown', _evLightboxKeyHandler);
}
function evLightboxAnterior(){
  const eventos = eventosCatalogo();
  if (!eventos.length) return;
  _evLightboxIndex = (_evLightboxIndex - 1 + eventos.length) % eventos.length;
  evPintarLightbox();
}
function evLightboxSiguiente(){
  const eventos = eventosCatalogo();
  if (!eventos.length) return;
  _evLightboxIndex = (_evLightboxIndex + 1) % eventos.length;
  evPintarLightbox();
}
function _evLightboxKeyHandler(e){
  if (e.key === 'Escape') evCerrarLightbox();
  else if (e.key === 'ArrowLeft') evLightboxAnterior();
  else if (e.key === 'ArrowRight') evLightboxSiguiente();
}
function evPintarLightbox(){
  const eventos = eventosCatalogo();
  if (!eventos.length){ evCerrarLightbox(); return; }
  if (_evLightboxIndex >= eventos.length) _evLightboxIndex = 0;
  if (_evLightboxIndex < 0) _evLightboxIndex = eventos.length-1;
  const ev = eventos[_evLightboxIndex];
  const ytId = ev.tipoMedia==='youtube' ? youtubeIdFromUrl(ev.imagen) : null;
  const media = $('evLightboxMedia');
  if (media){
    media.innerHTML = ytId
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&modestbranding=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
      : `<img src="${esc(ev.imagen)}" alt="${esc(ev.titulo)}">`;
  }
  const titulo = $('evLightboxTitulo'); if (titulo) titulo.textContent = ev.titulo;
  const fecha = $('evLightboxFecha');
  if (fecha) fecha.innerHTML = ev.fecha ? `📅 ${esc(formatearFechaEvento(ev.fecha))}` : '';
  const desc = $('evLightboxDesc'); if (desc) desc.textContent = ev.descripcion || '';
  const nav = $('evLightboxNavWrap'); if (nav) nav.style.display = eventos.length>1 ? 'flex' : 'none';
}
/* Se llama al salir de "Inicio" (ver pNavigate más abajo): detiene el
   avance automático del carrusel y cierra el lightbox si quedó abierto,
   para no dejar un vídeo sonando de fondo ni un timer corriendo en otra
   vista. */
function evDetenerAutoplay(){ evDetenerAutoplayTimer(); evCerrarLightbox(); }

async function responderEvento(eventId, respuesta){
  currentUser.eventRsvps = currentUser.eventRsvps || {};
  currentUser.eventRsvps[eventId] = respuesta;
  evPintarCarrusel();
  showToast(respuesta==='si' ? '¡Genial, cuentan contigo! 🎉' : 'Anotado, gracias por avisar','ok');
  portalPlaySuccess();
  try {
    await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({eventRsvps: currentUser.eventRsvps}), credentials:'same-origin'});
  } catch {}
}

/* ══════════════════════════════════════════════════════════════════════
   REEL DE CURSOS EXCLUSIVOS — banner horizontal publicitario en Inicio,
   arriba de "Mi Playlist". Espejo exacto del motor de Eventos (mismo
   coverflow circular continuo, mismo drag/flechas/autoplay — ver
   evAplicarTransform/evIniciarAutoplay más arriba para los comentarios
   detallados de cómo funciona la fórmula). La diferencia: acá no hay
   lightbox — tocar cualquier tarjeta lleva directo a la vista completa
   "Cursos Exclusivos" (pNavigate('cursos')), sea cual sea su estado de
   acceso; el candado es solo visual, la promoción es para TODOS.
   ══════════════════════════════════════════════════════════════════════ */
const CR_AUTOPLAY_MS_PER_CARD = 4200;
let _crProgress = 0;
let _crAnimRAF = null;
let _crAutoplayRAF = null;
let _crAutoplayLastTs = null;
let _crCardStepPx = 200;
let _crDragActive = false, _crDragMoved = false, _crDragStartX = 0, _crDragStartProgress = 0;

function crActualizarCardStep(){
  const muestra = document.querySelector('#crReelCarousel .cr-card');
  if (!muestra) return;
  _crCardStepPx = muestra.offsetWidth * 0.91;
  const track = $('crReelCarousel');
  if (track) track.style.height = muestra.offsetHeight + 'px';
}
window.addEventListener('resize', () => {
  if ($('crReelCarousel')){ crActualizarCardStep(); crAplicarTransformReel(); }
});

function crTick(ts){
  if (_crAutoplayLastTs == null) _crAutoplayLastTs = ts;
  const dt = ts - _crAutoplayLastTs;
  _crAutoplayLastTs = ts;
  const n = (allCursos||[]).length;
  const track = $('crReelCarousel');
  if (track && n > 1 && !_crDragActive && !_crAnimRAF){
    _crProgress += dt / CR_AUTOPLAY_MS_PER_CARD;
    crAplicarTransformReel();
  }
  _crAutoplayRAF = requestAnimationFrame(crTick);
}
function crIniciarAutoplay(){
  if (_crAutoplayRAF) return;
  _crAutoplayLastTs = null;
  _crAutoplayRAF = requestAnimationFrame(crTick);
}
function crDetenerAutoplay(){
  if (_crAutoplayRAF){ cancelAnimationFrame(_crAutoplayRAF); _crAutoplayRAF = null; }
  _crAutoplayLastTs = null;
}

function renderCursosReelCard(){
  return `<div class="card reveal-right" id="crReelCard" style="--rv-dist:120px;padding:0;overflow:hidden;margin-bottom:20px;">
    <div style="padding:22px 26px 8px;
      display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="min-width:0;">
        <div class="h2" style="margin-bottom:4px;">🎓 Cursos Exclusivos</div>
        <p style="font-size:12px;color:var(--muted);margin:0;">Lleva tu baile al siguiente nivel — toca cualquier curso para ver el catálogo completo.</p>
      </div>
      <div id="crNavWrap" style="display:none;align-items:center;gap:6px;flex:0 0 auto;">
        <button class="ev-nav-btn" onclick="crScroll(-1)" aria-label="Desplazar a la izquierda">←</button>
        <button class="ev-nav-btn" onclick="crScroll(1)" aria-label="Desplazar a la derecha">→</button>
      </div>
    </div>
    <div id="crReelCarouselBody"></div>
  </div>`;
}
/* SVG embebido (data URI, sin request externo) usado como portada de
   respaldo cuando una imagen de Drive no carga (archivo no compartido
   públicamente, ID inválido, archivo borrado, etc.) — mismo mecanismo que
   el panel de administración (ver app.js). */
const CX_IMG_FALLBACK_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">'+
  '<rect width="400" height="600" fill="#141414"/>'+
  '<text x="200" y="285" text-anchor="middle" font-family="sans-serif" font-size="52" fill="#3a3a3a">🎓</text>'+
  '<text x="200" y="326" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#666">Imagen no disponible</text>'+
  '</svg>'
);
function cxImgFallback(img){
  if (img.dataset.cxFallback) return;
  img.dataset.cxFallback = '1';
  img.onerror = null;
  img.src = CX_IMG_FALLBACK_SVG;
}
function crCardHtml(c, i){
  const bloqueado = c.tieneAcceso===false;
  // Sin onclick por tarjeta: el click vive en el contenedor #crReelCarousel
  // (ver crPintarReel) para que tocar CUALQUIER punto del slider — huecos,
  // tarjetas laterales desenfocadas del coverflow, lo que sea — navegue a
  // Cursos, no solo el hit-target exacto de la tarjeta central.
  if (bloqueado){
    // La portada SÍ se muestra aunque el alumno no tenga el curso asignado
    // (solo se le oculta el contenido/vídeos) — por eso pintamos la imagen
    // real de fondo, con un overlay oscuro + candado encima.
    return `<div class="ev-card cr-card" data-cr-i="${i}">
      <div class="ev-card-media">
        ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" draggable="false" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
        <div style="position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:5px;
          padding:5px 10px;border-radius:999px;background:rgba(0,0,0,.55);border:1px solid var(--gold-2);z-index:2;">
          <span style="font-size:11px;color:var(--gold-2);">🔒</span>
          <span style="font-size:9.5px;font-weight:700;color:var(--gold-2);letter-spacing:.3px;text-transform:uppercase;">Acceso Privado</span>
        </div>
      </div>
      <div class="ev-card-info">
        <div class="ev-card-titulo">${esc(c.nombre)}</div>
        <div class="ev-card-fecha">${esc(c.subcategoria||CURSOS_RITMO_LABEL_PORTAL[c.ritmo]||'')}</div>
      </div>
    </div>`;
  }
  return `<div class="ev-card cr-card" data-cr-i="${i}">
    <div class="ev-card-media">
      ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" draggable="false" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
      <span class="ev-card-play"></span>
    </div>
    <div class="ev-card-info">
      <div class="ev-card-titulo">${esc(c.nombre)}</div>
      <div class="ev-card-fecha">${esc(c.subcategoria||CURSOS_RITMO_LABEL_PORTAL[c.ritmo]||'')}</div>
    </div>
  </div>`;
}
const CURSOS_RITMO_LABEL_PORTAL = {bachata:'Bachata', salsa:'Salsa', otros:'Otros Ritmos'};

function crPintarReel(){
  const cursos = allCursos||[];
  const body = $('crReelCarouselBody');
  const navWrap = $('crNavWrap');
  if (!body) return;
  if (!cursos.length){
    if (navWrap) navWrap.style.display = 'none';
    body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      color:var(--muted);gap:10px;padding:34px 20px;text-align:center;min-height:180px;">
      <span style="font-size:26px;opacity:.4;">🎓</span>
      <span style="font-size:12.5px;">Todavía no hay cursos publicados.</span>
    </div>`;
    return;
  }
  if (navWrap) navWrap.style.display = cursos.length>1 ? 'flex' : 'none';
  body.innerHTML = `<div class="ev-coverflow" id="crReelCarousel" onclick="crClickCard()">
    ${cursos.map((c,i)=>crCardHtml(c,i)).join('')}
  </div>`;
  crActualizarCardStep();
  crAplicarTransformReel();
  crAttachDrag();
  crIniciarAutoplay();
}
function crAplicarTransformReel(){
  const track = $('crReelCarousel');
  if (!track) return;
  const n = (allCursos||[]).length;
  track.querySelectorAll('.cr-card').forEach(card=>{
    const i = Number(card.dataset.crI);
    let offset = i - _crProgress;
    if (n > 1){
      offset = ((offset % n) + n) % n;
      if (offset > n / 2) offset -= n;
    }
    const translateX = offset * _crCardStepPx;
    const scale = Math.max(0.55, 1 - Math.abs(offset) * 0.25);
    const opacity = Math.max(0.2, 1 - Math.abs(offset) * 0.5);
    card.style.transform = `translate(-50%,-50%) translateX(${translateX}px) scale(${scale})`;
    card.style.opacity = opacity;
    card.style.zIndex = Math.round(10 - Math.abs(offset));
  });
}
function crAnimarA(target){
  const n = (allCursos||[]).length;
  if (!n) return;
  if (_crAnimRAF){ cancelAnimationFrame(_crAnimRAF); _crAnimRAF = null; }
  const start = _crProgress;
  const delta = target - start;
  if (Math.abs(delta) < 0.001){ _crProgress = target; crAplicarTransformReel(); return; }
  const dur = 380, t0 = performance.now();
  function paso(now){
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    _crProgress = start + delta * eased;
    crAplicarTransformReel();
    if (t < 1){ _crAnimRAF = requestAnimationFrame(paso); }
    else { _crProgress = target; crAplicarTransformReel(); _crAnimRAF = null; }
  }
  _crAnimRAF = requestAnimationFrame(paso);
}
function crScroll(dir){
  crAnimarA(Math.round(_crProgress) + dir);
}
function crAttachDrag(){
  const track = $('crReelCarousel');
  if (!track) return;
  track.addEventListener('pointerdown', _crDragStart);
  track.addEventListener('pointermove', _crDragMove);
  track.addEventListener('pointerup', _crDragEnd);
  track.addEventListener('pointercancel', _crDragEnd);
}
function _crDragStart(e){
  if (_crAnimRAF){ cancelAnimationFrame(_crAnimRAF); _crAnimRAF = null; }
  _crDragActive = true;
  _crDragMoved = false;
  _crDragStartX = e.clientX;
  _crDragStartProgress = _crProgress;
  try{ e.currentTarget.setPointerCapture(e.pointerId); }catch{}
  // Reclamar el gesto desde el vamos, igual que en el carrusel de Eventos —
  // en móvil, si no se hace esto, el navegador puede quedarse con el touch.
  if (e.cancelable) e.preventDefault();
}
function _crDragMove(e){
  if (!_crDragActive) return;
  const dx = e.clientX - _crDragStartX;
  if (Math.abs(dx) > 10) _crDragMoved = true;
  _crProgress = _crDragStartProgress - dx / _crCardStepPx;
  crAplicarTransformReel();
  if (_crDragMoved && e.cancelable) e.preventDefault();
}
function _crDragEnd(){
  if (!_crDragActive) return;
  _crDragActive = false;
  crAnimarA(Math.round(_crProgress));
}
/* Solo navega si fue un clic real (no el final de un arrastre) — mismo
   patrón que evClickCard. */
function crClickCard(){
  if (_crDragMoved) return;
  pNavigate('cursos');
}

/* ══════════════════════════════════════════════
   SECCIÓN 2b — CURSOS EXCLUSIVOS (vista completa)
   Recrea el mockup: fondo #050505, tarjetas con marco dorado #D4A359,
   filtros por ritmo (pills) y acordeones desplegables agrupados por
   ritmo → subcategoría. Bloqueado = candado dorado + "Acceso Privado";
   desbloqueado = foto + play + título + duración/nivel.
   ══════════════════════════════════════════════ */
const CX_RITMOS = ['bachata','salsa','otros'];
let _cxFiltro = 'todos';
let _cxAbiertos = {bachata:true, salsa:true, otros:true}; // acordeones abiertos por defecto, como en el mockup

async function renderCursosExclusivos(cont){
  const contentEl = $('portalContent');
  if (contentEl) contentEl.className = 'wide';

  cont.innerHTML = `<div class="cx-page" id="cxPage">
    <div class="cx-hero">
      <div class="cx-hero-text">
        <div class="cx-titulo">Cursos Exclusivos</div>
        <div class="cx-subtitulo">Lleva tu baile al siguiente nivel</div>
      </div>
      <div class="cx-hero-deco"><img src="assets/cx-hero-deco.png" alt="Malevo Academia"></div>
    </div>
    <div class="cx-pills" id="cxPills"></div>
    <div id="cxAcordeones"><div class="cx-empty">Cargando cursos…</div></div>
  </div>`;

  if (!allCursos.length){
    try {
      const r = await fetch('/api/cursos', {credentials:'same-origin'});
      if (r.ok) allCursos = await r.json();
    } catch { /* se mostrará el mensaje de "sin cursos" abajo */ }
  }

  cxPintarPills();
  cxPintarAcordeones();
}

function cxPintarPills(){
  const wrap = $('cxPills');
  if (!wrap) return;
  const opciones = [
    {v:'todos', label:'Todos'},
    {v:'bachata', label:'Bachata'},
    {v:'salsa', label:'Salsa'},
    {v:'otros', label:'Otros Ritmos'},
  ];
  wrap.innerHTML = opciones.map(o =>
    `<button type="button" class="cx-pill${_cxFiltro===o.v?' active':''}" onclick="cxFiltrar('${o.v}')">${o.label}</button>`
  ).join('');
}

function cxFiltrar(v){
  _cxFiltro = v;
  cxPintarPills();
  cxPintarAcordeones();
}

function cxToggleAcordeon(ritmo){
  _cxAbiertos[ritmo] = !_cxAbiertos[ritmo];
  const el = document.querySelector(`.cx-acc[data-ritmo="${ritmo}"]`);
  if (el) el.classList.toggle('open', _cxAbiertos[ritmo]);
}

function cxPintarAcordeones(){
  const wrap = $('cxAcordeones');
  if (!wrap) return;
  const cursos = allCursos || [];
  if (!cursos.length){
    wrap.innerHTML = `<div class="cx-empty">🎓 Todavía no hay cursos publicados.</div>`;
    return;
  }
  const ritmos = _cxFiltro==='todos' ? CX_RITMOS : [_cxFiltro];
  let html = '';
  ritmos.forEach(ritmo => {
    const delRitmo = cursos.filter(c => c.ritmo===ritmo && c.activo!==false);
    if (!delRitmo.length) return;
    // Agrupar por subcategoría, preservando el orden de aparición
    const subs = [];
    delRitmo.forEach(c => { if (!subs.includes(c.subcategoria)) subs.push(c.subcategoria); });
    const gruposHtml = subs.map(sub => {
      const deSub = delRitmo.filter(c => c.subcategoria===sub)
        .sort((a,b)=>(a.orden||0)-(b.orden||0));
      return `<div class="cx-sub-titulo">${esc(sub||'General')}</div>
        <div class="cx-grid">${deSub.map(c=>cxCardHtml(c)).join('')}</div>`;
    }).join('');
    const abierto = !!_cxAbiertos[ritmo];
    html += `<div class="cx-acc${abierto?' open':''}" data-ritmo="${ritmo}">
      <div class="cx-acc-head" onclick="cxToggleAcordeon('${ritmo}')">
        <div class="cx-acc-head-title">${CURSOS_RITMO_LABEL_PORTAL[ritmo]||ritmo}
          <span class="cx-acc-count">(${delRitmo.length})</span></div>
        <span class="cx-acc-chevron">▼</span>
      </div>
      <div class="cx-acc-body-wrap"><div class="cx-acc-body">${gruposHtml}</div></div>
    </div>`;
  });
  wrap.innerHTML = html || `<div class="cx-empty">No hay cursos en esta categoría todavía.</div>`;
}

function cxCardHtml(c){
  const bloqueado = c.tieneAcceso===false;
  const metaParts = [c.nivel, c.duracion].filter(Boolean);
  if (bloqueado){
    // La portada se ve siempre a brillo original, sin oscurecer — solo un
    // badge de candado arriba indica que el contenido está gateado.
    return `<div class="cx-card locked" title="Acceso Privado" onclick="cxAbrirCurso('${c.id}')">
      <div class="cx-card-media">
        ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" draggable="false" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
        <div class="cx-lock-badge"><span class="cx-lock-badge-ico">🔒</span><span class="cx-lock-badge-txt">Acceso Privado</span></div>
      </div>
      <div class="cx-card-info">
        <div class="cx-card-titulo">${esc(c.nombre)}</div>
        <div class="cx-card-meta">${esc(metaParts.join(' · '))}</div>
      </div>
    </div>`;
  }
  return `<div class="cx-card" onclick="cxAbrirCurso('${c.id}')">
    <div class="cx-card-media">
      ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" draggable="false" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
      <span class="cx-card-play"></span>
    </div>
    <div class="cx-card-info">
      <div class="cx-card-titulo">${esc(c.nombre)}</div>
      <div class="cx-card-meta">${esc(metaParts.join(' · '))}</div>
    </div>
  </div>`;
}

/* ── Modal detalle de curso: lista de vídeos + reproductor inline ── */
function cxAbrirCurso(cursoId){
  const c = (allCursos||[]).find(x => x.id===cursoId);
  if (!c) return;
  let ov = $('cursoDetalleOverlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'cursoDetalleOverlay';
    ov.className = 'curso-detalle-overlay';
    document.body.appendChild(ov);
  }
  const bloqueado = c.tieneAcceso===false;
  const metaParts = [c.nivel, c.duracion].filter(Boolean);
  // La portada siempre se muestra primero, grande, con todo el texto del
  // curso debajo — recién después "entra" el contenido (lista de vídeos o
  // el aviso de acceso privado si el curso está bloqueado / sin vídeos).
  const mediaHtml = c.imagenPortada
    ? `<div class="curso-detalle-media"><img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" referrerpolicy="no-referrer" onerror="cxImgFallback(this)"></div>`
    : '';
  let bodyHtml;
  if (bloqueado){
    bodyHtml = `<div class="curso-detalle-locked">
      <div class="curso-detalle-locked-ico">🔒</div>
      <div class="curso-detalle-locked-txt">Acceso Privado<br>Todavía no tenés acceso a los vídeos de este curso.</div>
    </div>`;
  } else {
    const videos = c.videos || [];
    bodyHtml = videos.length
      ? `<div id="cxPlayerWrap"></div>` + videos.map((v,i) => `<div class="curso-detalle-video-row" id="cxvrow_${i}" onclick="cxPlayVideo('${cursoId}',${i})">
          <div class="curso-detalle-video-num">${i+1}</div>
          <div class="curso-detalle-video-titulo">${esc(v.titulo||'Vídeo '+(i+1))}</div>
        </div>`).join('')
      : `<div class="cx-empty" style="padding:16px 0;">Este curso todavía no tiene vídeos cargados.</div>`;
  }
  ov.innerHTML = `
    <div class="curso-detalle-card">
      <button type="button" class="curso-detalle-close" onclick="cxCerrarCurso()">×</button>
      ${mediaHtml}
      <div class="curso-detalle-titulo">${esc(c.nombre)}</div>
      <div class="curso-detalle-meta">${esc(metaParts.join(' · ')||CURSOS_RITMO_LABEL_PORTAL[c.ritmo]||'')}</div>
      <div class="curso-detalle-body" id="cxDetalleBody">${bodyHtml}</div>
    </div>`;
  ov.style.display = 'flex';
  window._cxCursoActivoId = cursoId;
  const bodyEl = $('cxDetalleBody');
  if (bodyEl){
    bodyEl.classList.add('cxd-body-enter');
    setTimeout(()=>{ bodyEl.classList.add('cxd-body-enter-active'); }, 160);
  }
}

function cxCerrarCurso(){
  const ov = $('cursoDetalleOverlay');
  if (ov){ ov.style.display='none'; ov.innerHTML=''; }
}

function cxPlayVideo(cursoId, idx){
  const c = (allCursos||[]).find(x => x.id===cursoId);
  if (!c) return;
  const v = (c.videos||[])[idx];
  if (!v) return;

  document.querySelectorAll('.curso-detalle-video-row').forEach((el,i)=>{
    el.classList.toggle('playing', i===idx);
  });

  const wrap = $('cxPlayerWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.style.display = 'block';

  const url = v.url || '';
  if (url.includes('youtube.com/embed') || url.includes('youtu.be') || url.includes('youtube.com/watch') || url.includes('vimeo.com')){
    let embed = url;
    // youtube-nocookie.com + rel=0 + modestbranding=1 + iv_load_policy=3:
    // al ser vídeos sueltos (no playlist), esto evita que al terminar o
    // pausar aparezcan recomendaciones de otros canales o del historial
    // personal del alumno — solo contenido propio o pantalla en blanco.
    if (url.includes('youtu.be/')){ const vid_ = url.split('youtu.be/')[1].split('?')[0]; embed = `https://www.youtube-nocookie.com/embed/${vid_}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`; }
    else if (url.includes('youtube.com/watch')){ const p = new URLSearchParams(url.split('?')[1]); embed = `https://www.youtube-nocookie.com/embed/${p.get('v')}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`; }
    else if (url.includes('youtube.com/embed')){
      // Ya viene como enlace /embed/... guardado tal cual — igual lo pasamos
      // por youtube-nocookie.com y le añadimos los parámetros anti-sugerencias.
      const vid_ = url.split('/embed/')[1].split('?')[0];
      embed = `https://www.youtube-nocookie.com/embed/${vid_}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`;
    }
    const ifr = document.createElement('iframe');
    ifr.src = embed;
    ifr.allow = 'accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;fullscreen';
    ifr.allowFullscreen = true;
    wrap.appendChild(ifr);
  } else if (url.match(/\.(mp4|webm|m4v)$/i)){
    const vid_ = document.createElement('video');
    vid_.src = url; vid_.controls = true; vid_.autoplay = true; vid_.controlsList = 'nodownload';
    vid_.oncontextmenu = e => e.preventDefault();
    wrap.appendChild(vid_);
  } else if (url){
    const ifr = document.createElement('iframe');
    ifr.src = url; ifr.allowFullscreen = true;
    wrap.appendChild(ifr);
  }
  wrap.scrollIntoView({behavior:'smooth', block:'nearest'});
}

/* ── Vídeos vistos: se guardan con fecha (para poder calcular la racha semanal).
   Guardado local por alumno — el sistema no registra analítica de reproducción
   en el servidor, así que esto vive en localStorage del dispositivo. ── */
function _watchedKey(){ return 'malevo_watched_'+(currentUser&&currentUser.sub||'anon'); }
function getWatchedMap(){
  try {
    const raw = JSON.parse(localStorage.getItem(_watchedKey())||'{}');
    if (Array.isArray(raw)){ // compat con el formato anterior (solo array de ids)
      const migrado={}; raw.forEach(id=>migrado[id]=Date.now());
      localStorage.setItem(_watchedKey(), JSON.stringify(migrado));
      return migrado;
    }
    return raw;
  } catch { return {}; }
}
function esVisto(id){ return !!getWatchedMap()[id]; }
function marcarVisto(id){
  const m=getWatchedMap();
  if (m[id]) return;
  m[id]=Date.now();
  try { localStorage.setItem(_watchedKey(), JSON.stringify(m)); } catch {}
  _actualizarRachaServidor(); // fire-and-forget: sube/actualiza la racha semanal (antigua, en semanas)
  // OJO: la tarjeta "Racha" (5 días + fueguito) NO se actualiza acá — solo cuenta
  // cuando el vídeo se mira COMPLETO (ver _marcarVideoCompletado, disparado por
  // el evento "ended" del reproductor en playVideo()).
}

/* ── Vídeos COMPLETADOS (mirados hasta el final) — distinto de "vistos"
   (que se marca solo con abrir/clicar el vídeo, arriba). Esta es la base
   real de la mecánica de desbloqueo 2x2 y del 100% para los Bonus: solo
   cuenta cuando el reproductor confirma el final real del vídeo. Guardado
   local por alumno, igual que "vistos". ── */
function _completedKey(){ return 'malevo_completed_'+(currentUser&&currentUser.sub||'anon'); }
function getCompletedMap(){
  try { return JSON.parse(localStorage.getItem(_completedKey())||'{}'); } catch { return {}; }
}
function esCompletado(id){ return !!getCompletedMap()[id]; }
/* Devuelve true si esta llamada realmente sumó una finalización nueva
   (para no repetir modal/desbloqueos si el alumno vuelve a ver algo que
   ya había completado antes). */
function marcarCompletado(id){
  const m=getCompletedMap();
  if (m[id]) return false;
  m[id]=Date.now();
  try { localStorage.setItem(_completedKey(), JSON.stringify(m)); } catch {}
  return true;
}

/* Se llama cuando el reproductor confirma que el vídeo terminó de verse
   completo (evento "ended" nativo, o del SDK de YouTube/Vimeo). Solo
   entonces cuenta como "día visto" para la tarjeta Racha. */
function _marcarVideoCompletado(id){
  if (activeVideoId!==id) return; // el alumno ya cambió de vídeo, no cuenta
  _actualizarRachaDiaria();
  _actualizarFuegoDiario(); // asegura que el fueguito nunca quede en 0 si ya hubo consumo de vídeo hoy
  _procesarDesbloqueo2x2(id);
}

/* ── Racha de práctica — GLOBAL, persistida en el perfil del alumno (servidor) ──
   Se guarda como {streakWeeks, streakLastWeek} vía PUT /api/profile (el mismo
   endpoint que el alumno ya usa para su perfil), así es consistente entre
   dispositivos. Se basa en actividad real de vídeo, no en asistencia oficial
   de clase (el portal no tiene acceso a esos datos). ── */
function _inicioSemana(ts){
  const d=new Date(ts);
  const diaLunes=(d.getDay()+6)%7; // lunes=0 ... domingo=6
  d.setHours(0,0,0,0);
  d.setDate(d.getDate()-diaLunes);
  return d.getTime();
}
const MS_SEMANA=7*24*60*60*1000;

/* Valor a MOSTRAR ahora mismo, sin necesitar que el alumno vea algo hoy:
   si la última semana activa guardada quedó a más de 1 semana de hoy, la
   racha se considera rota aunque el servidor aún no lo sepa. */
function calcularRachaSemanas(){
  const u=currentUser;
  if (u && u.streakWeeks!=null && u.streakLastWeek!=null){
    const semanaActual=_inicioSemana(Date.now());
    const gap=Math.round((semanaActual-u.streakLastWeek)/MS_SEMANA);
    return gap<=1 ? u.streakWeeks : 0;
  }
  // Respaldo local (primer arranque, o si el servidor no devolvió el campo)
  const fechas=Object.values(getWatchedMap());
  if (!fechas.length) return 0;
  const semanas=new Set(fechas.map(_inicioSemana));
  let racha=0, cursor=_inicioSemana(Date.now());
  while (semanas.has(cursor)){ racha++; cursor-=MS_SEMANA; }
  return racha;
}

/* Actualiza la racha al ver un vídeo y la sube al servidor. */
async function _actualizarRachaServidor(){
  const u=currentUser;
  const semanaActual=_inicioSemana(Date.now());
  const ultima=u.streakLastWeek||0;
  let nuevaRacha;
  if (!ultima){
    nuevaRacha=1;
  } else {
    const gap=Math.round((semanaActual-ultima)/MS_SEMANA);
    if (gap===0) return; // esta semana ya estaba contabilizada
    nuevaRacha = gap===1 ? (u.streakWeeks||0)+1 : 1;
  }
  u.streakWeeks=nuevaRacha; u.streakLastWeek=semanaActual;
  try {
    await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({streakWeeks:nuevaRacha, streakLastWeek:semanaActual}), credentials:'same-origin'});
  } catch {}
}

/* ══════════════════════════════════════════════════════════════════════
   Tarjeta "Racha" — dos métricas GLOBALES e independientes entre sí:
   A) Racha de Desbloqueo: 5 días distintos (domingo a sábado) viendo
      cualquier vídeo de clase, con checkmarks D-L-M-M-J-V-S y barra de
      progreso. Se reinicia cada domingo, sin importar si se llegó a la
      meta o no. Al llegar a 5 se marca como completada (por ahora es un
      indicador visual; qué contenido puntual se desbloquea es una
      decisión pendiente de definir).
   B) Fueguito: contador HISTÓRICO de días distintos que el alumno usó
      la app. Nunca se reinicia y no depende en absoluto de (A).
   Ambas se persisten en el perfil (PUT /api/profile) para ser
   consistentes entre dispositivos. ══════════════════════════════════ */
function _inicioSemanaDom(ts){
  const d=new Date(ts);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate()-d.getDay()); // getDay(): domingo=0 ... sábado=6
  return d.getTime();
}
function _hoyStr(ts){
  const d=new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
/* Nota: la racha semanal (5 días distintos por semana) sigue existiendo
   como mecánica de recompensa en segundo plano (desbloquea 1 bonus, ver
   _intentarDesbloquearBonusPorRacha más abajo) pero ya NO tiene
   representación visual propia en la tarjeta Racha — esa tarjeta ahora
   muestra exclusivamente el progreso del bloque 2x2 activo y el avance
   del nivel (ver _renderRachaProgresoPrincipal). El fueguito queda como
   único contador histórico visible.

   Se llama al ver un vídeo: agrega el día de hoy a la racha de
   desbloqueo de esta semana (reiniciando el conteo si cambió la semana). */
async function _actualizarRachaDiaria(){
  const u=currentUser; if(!u) return;
  const semanaActual=_inicioSemanaDom(Date.now());
  const hoyIdx=new Date().getDay();
  const diasPrevios = (u.rachaSemanaInicio===semanaActual) ? (u.rachaDiasSemana||[]) : [];
  if (u.rachaSemanaInicio===semanaActual && diasPrevios.includes(hoyIdx)) return; // ya contado hoy
  const dias = diasPrevios.includes(hoyIdx) ? diasPrevios.slice() : [...diasPrevios, hoyIdx];
  u.rachaSemanaInicio=semanaActual; u.rachaDiasSemana=dias;
  try {
    await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rachaDiasSemana:dias, rachaSemanaInicio:semanaActual}), credentials:'same-origin'});
  } catch {}
  _repintarRachaCard();
  if (dias.length>=5) _intentarDesbloquearBonusPorRacha(semanaActual);
}

/* ── Recompensa de la racha: al completar los 5 días se desbloquea 1
   bonus (el primero que esté bloqueado) de entre TODOS los niveles a los
   que el alumno tiene acceso. Se entrega como máximo una vez por semana
   (por ciclo de racha), aunque siga viendo vídeos después de llegar a 5. */
function _bonusCandidatosOrdenados(){
  const out=[];
  DISCIPLINAS_VIDEO.forEach(disc=>{
    const acceso=nivelesToAcceso(disc);
    [1,2,3,4].forEach(n=>{
      if (!acceso.includes(n)) return;
      const vids=videosDeNivel(disc,n);
      if (!vids.length) return;
      if (bonusNivelDesbloqueado(disc,n)) return; // ya está desbloqueado por el 100% del nivel
      bonusDeNivel(disc,n).forEach(bv=>{
        out.push({bv});
      });
    });
  });
  return out;
}
function esBonusDesbloqueadoPorRacha(id){
  return ((currentUser&&currentUser.rachaBonusDesbloqueados)||[]).includes(id);
}
async function _intentarDesbloquearBonusPorRacha(semanaActual){
  const u=currentUser; if(!u) return;
  if (u.rachaSemanaPremiada===semanaActual) return; // ya se procesó esta semana
  u.rachaSemanaPremiada=semanaActual;
  const yaDesbloqueados=u.rachaBonusDesbloqueados||[];
  const candidato=_bonusCandidatosOrdenados().find(c=>
    !yaDesbloqueados.includes(c.bv.id));
  const nuevos = candidato ? [...yaDesbloqueados, candidato.bv.id] : yaDesbloqueados;
  u.rachaBonusDesbloqueados=nuevos;
  try {
    await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rachaSemanaPremiada:semanaActual, rachaBonusDesbloqueados:nuevos}), credentials:'same-origin'});
  } catch {}
  if (candidato){
    showToast(`🎁 ¡Racha completa! Desbloqueaste "${candidato.bv.titulo}"`,'ok',4200);
  } else {
    showToast('🔥 ¡Racha completa! Ya tenés todos los bonus desbloqueados.','ok',4200);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Tarjeta "Calendario" — calendario mensual unificado que reemplaza las
   dos tarjetas antiguas "HOY"/"MAÑANA". Combina tres fuentes:
   - Clases (dorado): recurrentes por día de semana, PRIVADAS — solo las
     del alumno (myClasses, según su plan/días asignados). Se proyectan
     sobre todas las fechas del mes que caigan en ese día de semana.
   - Talleres (fucsia) y Eventos (cian): db.videos con tipo:'evento' y
     notas.categoria 'taller'|'evento', PÚBLICAS — fecha puntual en
     notas.fecha, visibles para cualquier alumno registrado.
   El día de hoy se pinta con el círculo relleno (no solo el borde). ═══ */
let _calMesActivo = null;   // {year, month(0-11)} — se inicializa al mes actual
let _calMenuAbierto = false;

function _calHoy(){ const d=new Date(); d.setHours(0,0,0,0); return d; }

function calInicializarMes(){
  if (_calMesActivo) return;
  const h=_calHoy();
  _calMesActivo = {year:h.getFullYear(), month:h.getMonth()};
}

const CAL_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const CAL_DIAS_CORTOS = ['L','M','M','J','V','S','D']; // lunes → domingo

/* Talleres/Eventos públicos que caen en una fecha puntual (YYYY-MM-DD). */
function calEventosGlobalesDelDia(fechaStr){
  const est = {taller:false, evento:false};
  allVideos.filter(v=>v.tipo==='evento').forEach(v=>{
    let meta={}; try{ meta=JSON.parse(v.notas||'{}'); }catch{}
    if (meta.fecha===fechaStr){
      if (meta.categoria==='taller') est.taller=true; else est.evento=true;
    }
  });
  return est;
}
/* Clases privadas del alumno: recurrentes por día de semana (0=domingo). */
function calTieneClaseEseDiaSemana(diaSemana){
  return myClasses.some(c=>(c.dia??0)===diaSemana);
}
function calEstadoDia(year, month, day){
  const fecha=new Date(year, month, day);
  const diaSemana=fecha.getDay();
  const fechaStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const clase=calTieneClaseEseDiaSemana(diaSemana);
  const {taller, evento}=calEventosGlobalesDelDia(fechaStr);
  return {clase, taller, evento};
}
/* Color principal del día (prioridad: clase > taller > evento). */
function calColorEstado(est){
  if (est.clase) return 'gold';
  if (est.taller) return 'magenta';
  if (est.evento) return 'cyan';
  return null;
}

function renderCalendarioCard(inicial){
  // El parámetro "inicial" solo es true la primera vez que se pinta la
  // tarjeta (desde renderInicio): ahí sí queremos la clase reveal-left del
  // scroll-reveal. En los repintados por interacción (cambiar de mes) NO
  // debe volver a deslizarse desde fuera de pantalla — por eso
  // _repintarCalendarioCard() llama a esta función sin argumento.
  calInicializarMes();
  const {year, month}=_calMesActivo;
  const primerDia=new Date(year, month, 1);
  const diasEnMes=new Date(year, month+1, 0).getDate();
  const offset=(primerDia.getDay()+6)%7; // lunes=0 ... domingo=6
  const hoy=_calHoy();
  const esMesActual = hoy.getFullYear()===year && hoy.getMonth()===month;

  let celdas='';
  for (let i=0;i<offset;i++) celdas += `<div class="cal-cell cal-cell-vacia"></div>`;
  for (let d=1; d<=diasEnMes; d++){
    const est=calEstadoDia(year, month, d);
    const color=calColorEstado(est);
    const esHoy=esMesActual && hoy.getDate()===d;
    const extras=[];
    if (color!=='gold' && est.clase) extras.push('gold');
    if (color!=='magenta' && est.taller) extras.push('magenta');
    if (color!=='cyan' && est.evento) extras.push('cyan');
    const colorHoy = color || 'gold'; // si hoy no tiene nada agendado, se resalta en dorado igual
    celdas += `<div class="cal-cell">
      <div class="cal-day${esHoy?' cal-day-hoy cal-day-hoy-'+colorHoy:(color?' cal-day-'+color:'')}">${d}</div>
      ${extras.length?`<div class="cal-day-dots">${extras.map(c=>`<span class="cal-dot cal-dot-${c}"></span>`).join('')}</div>`:''}
    </div>`;
  }

  return `<div class="card mescal-card${inicial?' reveal-left':''}" id="calendarioCard" style="--rv-dist:60px;">
    <div class="cal-main">
      <div class="cal-header">
        <div class="h2" style="margin:0;">Calendario</div>
        <div class="cal-mes-selector">
          <button type="button" class="cal-mes-pill" onclick="calToggleMenu()">
            ${CAL_MESES[month]} ${year} <span class="cal-mes-chevron">⌄</span>
          </button>
          <div class="cal-mes-menu" id="calMesMenu" style="display:${_calMenuAbierto?'block':'none'};">
            ${calOpcionesMeses()}
          </div>
        </div>
      </div>
      <div class="cal-grid">
        ${CAL_DIAS_CORTOS.map(l=>`<div class="cal-dow">${l}</div>`).join('')}
        ${celdas}
      </div>
    </div>
    <div class="cal-divider"></div>
    <div class="cal-legend">
      <div class="cal-legend-item">
        <div class="cal-legend-icon cal-legend-gold">🎓</div>
        <div class="cal-legend-label cal-legend-label-gold">Clases</div>
      </div>
      <div class="cal-legend-item">
        <div class="cal-legend-icon cal-legend-magenta">👥</div>
        <div class="cal-legend-label cal-legend-label-magenta">Talleres</div>
      </div>
      <div class="cal-legend-item">
        <div class="cal-legend-icon cal-legend-cyan">📅</div>
        <div class="cal-legend-label cal-legend-label-cyan">Eventos</div>
      </div>
    </div>
  </div>`;
}
function calOpcionesMeses(){
  // Rango fijo: 6 meses atrás .. 18 meses adelante desde HOY real (no desde el mes que se esté viendo)
  const h=_calHoy();
  let out='';
  for (let i=-6;i<=18;i++){
    const d=new Date(h.getFullYear(), h.getMonth()+i, 1);
    const y=d.getFullYear(), m=d.getMonth();
    const activo=_calMesActivo.year===y && _calMesActivo.month===m;
    out += `<div class="cal-mes-opcion${activo?' activa':''}" onclick="calIrAMes(${y},${m})">${CAL_MESES[m]} ${y}</div>`;
  }
  return out;
}
function calToggleMenu(){
  _calMenuAbierto = !_calMenuAbierto;
  const menu=$('calMesMenu'); if (menu) menu.style.display = _calMenuAbierto ? 'block' : 'none';
}
function calIrAMes(y,m){
  _calMesActivo={year:y, month:m};
  _calMenuAbierto=false;
  _repintarCalendarioCard();
}
function _repintarCalendarioCard(){
  const cont=$('calendarioCard');
  if (cont) cont.outerHTML = renderCalendarioCard();
}
// Cierra el menú de meses al hacer clic fuera de él.
document.addEventListener('click', e=>{
  if (_calMenuAbierto && !e.target.closest('.cal-mes-selector')){
    _calMenuAbierto=false;
    const menu=$('calMesMenu'); if (menu) menu.style.display='none';
  }
});

/* Suma un día al fueguito la primera vez que el alumno usa la app ese día
   calendario (se llama al entrar a Inicio) Y también la primera vez que
   completa un vídeo ese mismo día (se llama desde _marcarVideoCompletado),
   como red de seguridad: si ya hubo consumo real de contenido hoy, el
   fueguito nunca debe quedar en 0 días. Es idempotente por día (no sube
   dos veces). Independiente de la racha semanal de 5 días (A). */
async function _actualizarFuegoDiario(){
  const u=currentUser; if(!u) return;
  const hoy=_hoyStr(Date.now());
  if (u.fuegoUltimoDia===hoy) return; // ya contado hoy
  const nuevoTotal=(u.fuegoDiasTotal||0)+1;
  u.fuegoDiasTotal=nuevoTotal; u.fuegoUltimoDia=hoy;
  try {
    await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fuegoDiasTotal:nuevoTotal, fuegoUltimoDia:hoy}), credentials:'same-origin'});
  } catch {}
  _repintarRachaCard();
}

function _repintarRachaCard(){
  const cont=$('rachaCard');
  if (cont) cont.outerHTML = renderRachaCard();
}

/* Nivel "activo" para mostrar el progreso del bloque 2x2 dentro de la
   tarjeta Racha: el que el alumno tiene abierto ahora mismo si hay uno;
   si no, el del último vídeo reproducido; si no, el primer nivel
   accesible que todavía tenga clases pendientes. Devuelve null si no hay
   ningún nivel con contenido (ej. sin acceso VIP). */
function _nivelActivoParaRacha(){
  if (activeDisciplina && activeNivel && videosDeNivel(activeDisciplina, activeNivel).length){
    return {disc:activeDisciplina, nivel:activeNivel};
  }
  const lastId = getLastVideoId();
  const lastVideo = lastId ? allVideos.find(v=>v.id===lastId) : null;
  if (lastVideo && (!lastVideo.tipo || lastVideo.tipo==='clase') && videosDeNivel(lastVideo.disciplina, lastVideo.nivel).length){
    return {disc:lastVideo.disciplina, nivel:lastVideo.nivel};
  }
  for (const disc of DISCIPLINAS_VIDEO){
    const acceso = nivelesToAcceso(disc);
    for (const n of [1,2,3,4]){
      if (!acceso.includes(n)) continue;
      const vids = videosDeNivel(disc,n);
      if (vids.length && nivelVideosCompletados(disc,n) < vids.length) return {disc, nivel:n};
    }
  }
  return null;
}
/* Barra horizontal PRINCIPAL de la tarjeta Racha: representa
   exclusivamente el progreso del bloque activo de la mecánica 2x2 (X/2
   para el próximo desbloqueo) y, debajo, el avance general del nivel
   (clases completadas / total). Reemplaza a la antigua barra semanal. */
/* Todos los (disciplina, nivel) accesibles para el alumno (niveles 1-3;
   el 4 / Coreografías no tiene bonus). Se muestra un redondel por cada
   uno de estos niveles exista o no todavía vídeo de bonus cargado ahí —
   el redondel se enciende apenas se completa el 100% de las clases del
   nivel, que es el mismo momento en que su bonus (cuando lo haya) queda
   desbloqueado. */
function _rachaNivelesConBonus(){
  const out = [];
  for (const disc of DISCIPLINAS_VIDEO){
    const acceso = nivelesToAcceso(disc);
    for (const n of [1,2,3]){
      if (!acceso.includes(n)) continue;
      if (!videosDeNivel(disc,n).length) continue;
      out.push({disc, nivel:n});
    }
  }
  return out;
}
/* Fila de redondeles: uno por cada nivel (de cualquier disciplina) que
   tenga bonus. Se enciende (dorado) cuando el alumno terminó el 100% de
   las clases principales de ese nivel y por lo tanto ya desbloqueó TODOS
   los vídeos de bonus correspondientes — no representa días ni vídeos
   sueltos, sino "niveles con bonus ya desbloqueado". */
function _renderRachaBonusFila(){
  const niveles = _rachaNivelesConBonus();
  if (!niveles.length) return '';
  /* Agrupadas por disciplina (ya vienen en orden Bachata,Salsa desde
     DISCIPLINAS_VIDEO) con una rayita divisoria entre grupos y el nombre
     de la disciplina debajo, para que se entienda de un vistazo cuáles
     redondeles son de cada una. */
  const grupos = {};
  const orden = [];
  for (const item of niveles){
    if (!grupos[item.disc]){ grupos[item.disc] = []; orden.push(item.disc); }
    grupos[item.disc].push(item);
  }
  const gruposHtml = orden.map(disc => {
    const circulos = grupos[disc].map(({disc,nivel}) => {
      const encendido = bonusNivelDesbloqueado(disc,nivel);
      const label = `${esc(disc)} · ${nivelLabelCorto(nivel)}${encendido?' — bonus desbloqueado':' — todavía bloqueado'}`;
      return `<div class="racha-video-circulo${encendido?' encendido':''}" title="${label}">✓</div>`;
    }).join('');
    return `<div class="racha-videos-grupo">
      <div class="racha-videos-fila">${circulos}</div>
      <div class="racha-videos-grupo-label">${esc(disc)}</div>
    </div>`;
  }).join('<div class="racha-videos-divisor"></div>');
  return `<div class="racha-nivel-texto" style="margin-top:2px;">Bonus desbloqueados (termina el 100% de las clases de un nivel para abrir todo su bonus):</div>
    <div class="racha-videos-grupos">${gruposHtml}</div>`;
}
function _renderRachaProgresoPrincipal(){
  const activo = _nivelActivoParaRacha();
  let principal;
  if (!activo){
    principal = `<div class="racha-progreso-texto">Todavía no hay clases disponibles para mostrar tu progreso.</div>
      <div class="racha-bar-track"><div class="racha-bar-fill" style="width:0%;"></div></div>`;
  } else {
    const vids = videosDeNivel(activo.disc, activo.nivel);
    const completados = nivelVideosCompletados(activo.disc, activo.nivel);
    const nivelCompleto = completados>=vids.length;
    const enBloque = nivelCompleto ? vids.length : completados%2;
    const metaBloque = nivelCompleto ? vids.length : 2;
    const pctBloque = metaBloque ? Math.round((enBloque/metaBloque)*100) : 0;
    const pctNivel = vids.length ? Math.round((completados/vids.length)*100) : 0;
    principal = `<div class="racha-progreso-texto">
        ${nivelCompleto
          ? `🏆 <strong>¡Nivel completado!</strong> Clases desbloqueadas`
          : `<strong>${enBloque}</strong> / ${metaBloque} <span class="racha-progreso-destacado">vídeos vistos</span> para el próximo desbloqueo`}
      </div>
      <div class="racha-bar-track"><div class="racha-bar-fill" style="width:${pctBloque}%;"></div></div>
      <div class="racha-nivel-texto">Avance del nivel: ${completados}/${vids.length} clase${vids.length===1?'':'s'} (${pctNivel}%)</div>`;
  }
  return principal + _renderRachaBonusFila();
}
function renderRachaCard(inicial){
  // Igual que en renderCalendarioCard: "inicial" solo es true la primera
  // vez (desde renderInicio), para que la tarjeta anime en cadena al
  // montar la vista. Los repintados posteriores (_repintarRachaCard) no
  // deben repetir la animación de entrada.
  const u=currentUser||{};
  const fuego=u.fuegoDiasTotal||0;
  return `<div class="card racha-card${inicial?' reveal-right':''}" id="rachaCard" style="--rv-dist:60px;">
    <div class="racha-fuego-box">
      <div class="racha-fuego-icon">🔥</div>
      <div class="racha-fuego-num">${fuego} día${fuego===1?'':'s'}</div>
      <div class="racha-fuego-label">Racha de la aplicación</div>
    </div>
    <div class="racha-desbloqueo">
      ${_renderRachaProgresoPrincipal()}
    </div>
  </div>`;
}

/* ── "Continuar viendo": última clase reproducida ── */
function _lastVideoKey(){ return 'malevo_lastvideo_'+(currentUser&&currentUser.sub||'anon'); }
function getLastVideoId(){ try { return localStorage.getItem(_lastVideoKey())||null; } catch { return null; } }
function setLastVideoId(id){ try { localStorage.setItem(_lastVideoKey(), id); } catch {} }

/* ── Catálogo de vídeo por tipo (clase de nivel / calentamiento / taller) ──
   Vídeos "normales" no tienen v.tipo o tienen tipo:'clase'. Se reutiliza la
   misma colección db.videos / endpoint /api/videos ya existente. ── */
function videosDeNivel(disc,nivel){
  return allVideos.filter(v=>v.disciplina===disc && v.nivel===nivel && (!v.tipo||v.tipo==='clase'))
    .sort((a,b)=>(a.orden||0)-(b.orden||0));
}
/* ── Bonus: solo aplica a niveles 1, 2 y 3 (no a Coreografías/4). Sin
   límite de cantidad. Se desbloquean TODOS juntos al llegar al 100% de las
   clases principales del nivel (ver bonusNivelDesbloqueado), o antes si la
   racha semanal ya desbloqueó alguno puntualmente
   (esBonusDesbloqueadoPorRacha). ── */
function bonusDeNivel(disc,nivel){
  if (nivel===4) return [];
  return allVideos.filter(v=>v.disciplina===disc && v.nivel===nivel && v.tipo==='bonus')
    .sort((a,b)=>(a.orden||0)-(b.orden||0));
}
function calentamientos(){
  return allVideos.filter(v=>v.tipo==='calentamiento').sort((a,b)=>(a.orden||0)-(b.orden||0));
}

/* ══════════════════════════════════════════════════════════════════════
   MECÁNICA DE DESBLOQUEO 2x2 (vídeos de clase, por nivel)
   ──────────────────────────────────────────────────────────────────────
   - El alumno arranca cada nivel con los primeros 2 vídeos de clase
     desbloqueados.
   - Al COMPLETAR (ver hasta el final, no solo abrir) 2 vídeos del nivel,
     se desbloquean automáticamente los 2 siguientes de la lista.
   - Al completar el 100% de las clases principales del nivel, se
     desbloquea TODA la sección Bonus de ese nivel de una sola vez (ver
     bonusNivelDesbloqueado más abajo).
   Se basa en esCompletado() (fin real de vídeo), no en esVisto() (que
   solo marca que se abrió/clicó el vídeo). ══════════════════════════ */
function nivelVideosCompletados(disc,nivel){
  return videosDeNivel(disc,nivel).filter(v=>esCompletado(v.id)).length;
}
/* Cuántos vídeos de clase están desbloqueados ahora mismo en este nivel. */
function nivelVideosDesbloqueados(disc,nivel){
  const vids = videosDeNivel(disc,nivel);
  if (!vids.length) return 0;
  const completados = nivelVideosCompletados(disc,nivel);
  const desbloqueados = 2 + 2*Math.floor(completados/2);
  return Math.min(vids.length, Math.max(2, desbloqueados));
}
/* Bonus del nivel desbloqueados por haber llegado al 100% de las clases
   principales. */
function bonusNivelDesbloqueado(disc,nivel){
  const vids = videosDeNivel(disc,nivel);
  return vids.length>0 && nivelVideosCompletados(disc,nivel)>=vids.length;
}
/* ── El modal explicativo (Rachas.png) solo debe verse UNA vez por nivel
   (disciplina+nivel), no en cada par de la mecánica 2x2 — una vez que el
   alumno entendió cómo funciona el desbloqueo, repetirlo cada 2 vídeos
   solo estorba. Se persiste en localStorage por alumno. ── */
function _desbloqueoModalKey(disc, nivel){
  return 'malevo_dbmodal_'+(currentUser&&currentUser.sub||'anon')+'_'+disc+'_'+nivel;
}
function _desbloqueoModalYaVisto(disc, nivel){
  try { return localStorage.getItem(_desbloqueoModalKey(disc,nivel))==='1'; } catch { return false; }
}
function _marcarDesbloqueoModalVisto(disc, nivel){
  try { localStorage.setItem(_desbloqueoModalKey(disc,nivel), '1'); } catch {}
}

/* Se llama al confirmarse que un vídeo terminó de verse completo. Si es
   un vídeo de clase (no bonus/calentamiento) y con esto se acaba de
   completar el PRIMERO de un par activo, muestra el modal explicativo
   (Rachas.png) —solo la primera vez en ese nivel— y, al continuar, pasa
   automáticamente al siguiente vídeo ya desbloqueado del mismo par. */
function _procesarDesbloqueo2x2(id){
  const v = allVideos.find(x=>x.id===id);
  if (!v || (v.tipo && v.tipo!=='clase')) return; // solo aplica a vídeos de clase principales
  const esNueva = marcarCompletado(id);
  if (!esNueva) return; // ya estaba completado antes (ej. lo volvió a mirar) — no repetir modal/refrescos

  _repintarRachaCard(); // la Racha muestra el progreso del bloque activo

  // Si la lista de este nivel está abierta, refrescarla para reflejar
  // los nuevos candados/desbloqueos sin interrumpir la reproducción actual.
  if (activeDisciplina===v.disciplina && activeNivel===v.nivel && $('videoList')){
    $('videoList').innerHTML = _construirListaNivelHTML(v.disciplina, v.nivel);
  }

  const vids = videosDeNivel(v.disciplina, v.nivel);
  const completados = nivelVideosCompletados(v.disciplina, v.nivel);
  if (completados % 2 !== 1) return; // solo dispara tras el 1er vídeo del par (impar), no el 2do
  if (_desbloqueoModalYaVisto(v.disciplina, v.nivel)) return; // ya se explicó una vez en este nivel
  const siguiente = vids.find(x=>!esCompletado(x.id)); // próximo pendiente, ya desbloqueado en este par
  if (siguiente){
    _marcarDesbloqueoModalVisto(v.disciplina, v.nivel);
    mostrarModalDesbloqueo(siguiente.id);
  }
}

/* ── Modal explicativo intermedio (Rachas.png) ──
   Se muestra al terminar el 1er vídeo de un par de la mecánica 2x2.
   - Cerrar (✕) o Escape: solo cierra el modal, sin cambiar de vídeo.
   - "Continuar" (o clic sobre la imagen/el fondo oscuro): cierra el modal
     y pasa automáticamente al siguiente vídeo ya desbloqueado. ── */
let _desbloqueoModalSiguienteId = null;
function mostrarModalDesbloqueo(siguienteVideoId){
  _desbloqueoModalSiguienteId = siguienteVideoId;
  const overlay = $('desbloqueoModalOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
}
function cerrarModalDesbloqueo(){
  const overlay = $('desbloqueoModalOverlay');
  if (overlay) overlay.style.display = 'none';
  _desbloqueoModalSiguienteId = null;
}
function continuarDesdeModalDesbloqueo(){
  const siguienteId = _desbloqueoModalSiguienteId;
  cerrarModalDesbloqueo();
  if (siguienteId) playVideo(siguienteId);
}
document.addEventListener('keydown', e=>{
  if (e.key==='Escape'){
    const overlay=$('desbloqueoModalOverlay');
    if (overlay && overlay.style.display!=='none' && overlay.style.display!==''){
      cerrarModalDesbloqueo();
    }
  }
});

/* ══════════════════════════════════════════════
   REPRODUCTOR DE MÚSICA — carpeta de Google Drive vinculada al nivel
   ──────────────────────────────────────────────
   El admin vincula una carpeta (app.js → Multimedia → Gestionar nivel →
   Playlist de este nivel). Ese vínculo viaja como un registro más de
   db.videos (tipo:'playlist', origen:'drive') a través del mismo
   /api/videos que ya usa el alumno, así que no hace falta ningún
   endpoint nuevo en el servidor. Aquí solo consultamos la Google Drive
   API v3 (files.list / alt=media) con la clave pública guardada en ese
   registro para listar y reproducir las canciones de la carpeta.
══════════════════════════════════════════════ */
let _driveTracks = [];
let _driveIndex  = -1;
let _driveCache  = {};      // folderId -> archivos ya consultados (evita repetir la llamada)
let _driveEventsWired = false;

function driveRecordDeNivel(disc, nivel){
  return allVideos.find(v=>v.disciplina===disc && v.nivel===nivel && v.tipo==='playlist' && v.origen==='drive');
}

function wireDriveAudioEvents(){
  if (_driveEventsWired) return;
  _driveEventsWired = true;
  const audio = $('driveAudioEl');
  if (!audio) return;
  audio.addEventListener('play',  ()=>{ const b=$('drivePlayBtn'); if (b) b.textContent='⏸'; });
  audio.addEventListener('pause', ()=>{ const b=$('drivePlayBtn'); if (b) b.textContent='▶'; });
  audio.addEventListener('ended', driveSiguiente);
  audio.addEventListener('timeupdate', ()=>{
    const seek=$('driveSeek');
    if (seek && audio.duration) seek.value = String(audio.currentTime/audio.duration*100);
  });
}

async function cargarReproductorDrive(disc, nivel){
  const wrap = $('drivePlayerWrap');
  if (!wrap) return;
  driveDetener();
  mpDetener(); // no dejar sonando "Mi Playlist" a la vez que este reproductor
  const rec = driveRecordDeNivel(disc, nivel);
  if (!rec || !rec.driveFolderId){
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  wireDriveAudioEvents();
  const list = $('driveTrackList');
  const controls = $('driveControls');
  if (controls) controls.style.display = 'none';
  if (list) list.innerHTML = '<div style="padding:10px 4px;color:var(--muted);font-size:12px;">Cargando música…</div>';
  if ($('driveTrackCount')) $('driveTrackCount').textContent = '';

  try {
    _driveTracks = await obtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey);
    _driveIndex = -1;
    pintarListaDrive();
  } catch(e){
    if (list) list.innerHTML = `<div style="padding:10px 4px;color:var(--warn);font-size:12px;line-height:1.6;">
      No se pudo cargar la música de este nivel. Verifica que la carpeta esté compartida como
      "Cualquier persona con el enlace" y que la clave de API de Google Drive sea correcta.</div>`;
  }
}

async function obtenerCancionesDrive(folderId, apiKey){
  if (_driveCache[folderId]) return _driveCache[folderId];
  if (!apiKey) throw new Error('Falta la clave de API de Google Drive');
  const base = 'https://www.googleapis.com/drive/v3/files';
  const fields = 'files(id,name,mimeType)';

  const qAudio = `'${folderId}' in parents and trashed = false and mimeType contains 'audio/'`;
  let r = await fetch(`${base}?q=${encodeURIComponent(qAudio)}&fields=${encodeURIComponent(fields)}&orderBy=name&key=${encodeURIComponent(apiKey)}`);
  if (!r.ok) throw new Error('Error de la API de Google Drive ('+r.status+')');
  let j = await r.json();
  let files = j.files || [];

  // Si no hay resultados por mimeType (algunos audios se suben con tipo genérico),
  // se pide todo el contenido de la carpeta y se filtra por extensión de archivo.
  if (!files.length){
    const qAll = `'${folderId}' in parents and trashed = false`;
    r = await fetch(`${base}?q=${encodeURIComponent(qAll)}&fields=${encodeURIComponent(fields)}&orderBy=name&key=${encodeURIComponent(apiKey)}`);
    if (r.ok){
      j = await r.json();
      files = (j.files||[]).filter(f=>/\.(mp3|wav|m4a|ogg|oga|flac|aac|opus|wma)$/i.test(f.name||''));
    }
  }

  _driveCache[folderId] = files;
  return files;
}

function pintarListaDrive(){
  const list = $('driveTrackList');
  if (!list) return;
  if (!_driveTracks.length){
    list.innerHTML = '<div style="padding:6px 2px;color:var(--muted);font-size:10.5px;">Sin canciones en la carpeta.</div>';
    if ($('driveTrackCount')) $('driveTrackCount').textContent = '';
    if ($('driveControls')) $('driveControls').style.display = 'none';
    return;
  }
  if ($('driveTrackCount')) $('driveTrackCount').textContent = _driveTracks.length;
  const audio = $('driveAudioEl');
  const sonando = audio && !audio.paused;
  list.innerHTML = _driveTracks.map((t,i)=>{
    const activo = i===_driveIndex;
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer;
      background:transparent;" onclick="driveReproducir(${i})">
      <span style="width:12px;text-align:center;font-size:9px;color:${activo?'var(--gold)':'var(--muted)'};flex:0 0 auto;">${activo && sonando ? '♪' : (i+1)}</span>
      <span style="flex:1;min-width:0;font-size:10.5px;color:${activo?'var(--gold)':'var(--text-2)'};font-weight:${activo?'600':'400'};
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc((t.name||'').replace(/\.[^.]+$/,''))}</span>
    </div>`;
  }).join('');
  const controls = $('driveControls');
  if (controls) controls.style.display = 'flex';
}

function driveReproducir(i){
  const t = _driveTracks[i];
  if (!t) return;
  const rec = driveRecordDeNivel(activeDisciplina, activeNivel);
  if (!rec) return;
  _driveIndex = i;
  const audio = $('driveAudioEl');
  audio.src = `https://www.googleapis.com/drive/v3/files/${t.id}?alt=media&key=${encodeURIComponent(rec.driveApiKey)}`;
  audio.play().catch(()=>{});
  pintarListaDrive();
  actualizarNowPlayingDrive();
}
function driveTogglePlayPause(){
  const audio = $('driveAudioEl');
  if (!audio) return;
  if (!audio.src){ if (_driveTracks.length) driveReproducir(0); return; }
  if (audio.paused) audio.play().catch(()=>{}); else audio.pause();
}
function driveSiguiente(){
  if (!_driveTracks.length) return;
  driveReproducir((_driveIndex+1) % _driveTracks.length);
}
function driveAnterior(){
  if (!_driveTracks.length) return;
  driveReproducir((_driveIndex-1+_driveTracks.length) % _driveTracks.length);
}
function driveSeekTo(pct){
  const audio = $('driveAudioEl');
  if (audio && audio.duration) audio.currentTime = (pct/100)*audio.duration;
}
function actualizarNowPlayingDrive(){
  const t = _driveTracks[_driveIndex];
  const lbl = $('driveNowPlaying');
  if (lbl) lbl.textContent = t ? (t.name||'').replace(/\.[^.]+$/,'') : '';
}
function driveDetener(){
  const audio = $('driveAudioEl');
  if (audio){ audio.pause(); audio.removeAttribute('src'); try{ audio.load(); }catch{} }
  _driveTracks = [];
  _driveIndex = -1;
}

/* ── Detección de "vídeo completo" para la tarjeta Racha ──────────────────
   Se apoya en los SDKs oficiales de YouTube/Vimeo (evento "ended"), y en
   el evento nativo "ended" para vídeo propio (.mp4/.webm/.m4v). Si el
   vídeo viene de otra fuente sin API conocida, no hay forma de detectar
   cuándo termina, así que ese caso no puede sumar día de racha. ── */
let _ytApiListo=false, _ytApiCargando=false;
function _cargarYoutubeApiSiHaceFalta(cb){
  if (_ytApiListo || (window.YT && window.YT.Player)){ _ytApiListo=true; cb(); return; }
  const prevCb=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=function(){
    _ytApiListo=true;
    if (typeof prevCb==='function') try{ prevCb(); }catch{}
    cb();
  };
  if (!_ytApiCargando){
    _ytApiCargando=true;
    const s=document.createElement('script');
    s.src='https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }
}
function _wireYoutubeCompletado(iframeEl, videoId){
  _cargarYoutubeApiSiHaceFalta(()=>{
    if (!document.body.contains(iframeEl)) return; // el alumno ya cambió de vídeo
    try {
      new YT.Player(iframeEl, {
        events:{ onStateChange:ev=>{ if (ev.data===YT.PlayerState.ENDED) _marcarVideoCompletado(videoId); } }
      });
    } catch {}
  });
}
let _vimeoApiCargando=false;
function _cargarVimeoApiSiHaceFalta(cb){
  if (window.Vimeo && window.Vimeo.Player){ cb(); return; }
  if (!_vimeoApiCargando){
    _vimeoApiCargando=true;
    const s=document.createElement('script');
    s.src='https://player.vimeo.com/api/player.js';
    s.onload=cb;
    document.head.appendChild(s);
  } else {
    const t=setInterval(()=>{ if (window.Vimeo && window.Vimeo.Player){ clearInterval(t); cb(); } },200);
  }
}
function _wireVimeoCompletado(iframeEl, videoId){
  _cargarVimeoApiSiHaceFalta(()=>{
    if (!document.body.contains(iframeEl)) return;
    try {
      const player=new Vimeo.Player(iframeEl);
      player.on('ended', ()=>_marcarVideoCompletado(videoId));
    } catch {}
  });
}

function playVideo(id){
  activeVideoId=id;
  const v=allVideos.find(x=>x.id===id); if(!v) return;

  marcarVisto(id);
  setLastVideoId(id);

  // Marcar activo (y visto) en la cuadrícula de tarjetas y en las filas de lista.
  // Las clases principales ('clase') NO se marcan como vistas al solo hacer clic:
  // su check depende de esCompletado (ver _construirListaNivelHTML), para no
  // mostrar un check prematuro antes de terminar el vídeo. Bonus/calentamientos
  // conservan el marcado inmediato por clic (comportamiento previo).
  const esClasePrincipal = !v.tipo || v.tipo==='clase';
  document.querySelectorAll('.video-item, .video-row, .clase-mini').forEach(el=>{
    const activo = el.dataset.vid===id;
    el.classList.toggle('playing', activo);
    el.classList.toggle('active', activo);
    if (activo && !esClasePrincipal && !el.classList.contains('visto')){
      el.classList.add('visto');
      if (!el.querySelector('.vi-done')){
        const dot=document.createElement('span');
        dot.className='vi-done'; dot.title='Ya la viste';
        el.prepend(dot);
      }
    }
  });

  const title=$('videoTitle'); const notes=$('videoNotes');
  if(title){ title.style.display=''; title.textContent=v.titulo; }
  if(notes) notes.textContent=v.notas||'';

  const label=$('videoCurrentLabel');
  const labelText=$('videoCurrentLabelText');
  if (label && labelText){
    if (!v.tipo || v.tipo==='clase'){
      const lista = videosDeNivel(v.disciplina, v.nivel);
      const posicion = lista.findIndex(x=>x.id===v.id) + 1;
      label.style.display='flex';
      labelText.innerHTML = `${esc(v.disciplina)} · ${nivelLabel(v.nivel)} — <span class="clase-actual">Clase ${posicion||1}</span>`;
    } else {
      label.style.display='none';
    }
  }

  const wrap=$('playerWrap'); if(!wrap) return;
  const ph=$('playerPlaceholder'); if(ph) ph.remove();
  wrap.querySelectorAll('iframe,video').forEach(e=>e.remove());

  const url=v.url||'';
  if(url.includes('youtube.com/embed')||url.includes('youtu.be')||url.includes('vimeo.com')){
    let embed=url;
    // rel=0 + modestbranding=1 + iv_load_policy=3: al ser vídeos sueltos
    // (no playlist), evita que al terminar o pausar aparezcan
    // recomendaciones de otros canales o del historial personal del
    // alumno. Se mantiene el dominio youtube.com (no youtube-nocookie)
    // porque _wireYoutubeCompletado depende de la API oficial de YouTube
    // para detectar el fin del vídeo y marcar la clase como completada.
    if(url.includes('youtu.be/')){ const vid_=url.split('youtu.be/')[1].split('?')[0]; embed=`https://www.youtube.com/embed/${vid_}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`; }
    else if(url.includes('youtube.com/watch')){ const p=new URLSearchParams(url.split('?')[1]); embed=`https://www.youtube.com/embed/${p.get('v')}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`; }
    else if(url.includes('youtube.com/embed')){
      const base = url.split('?')[0];
      embed = `${base}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`;
    }
    const esYouTube=embed.includes('youtube.com/embed');
    const esVimeo=embed.includes('vimeo.com');
    if (esYouTube) embed += (embed.includes('?')?'&':'?')+'enablejsapi=1';
    const ifr=document.createElement('iframe');
    ifr.id='videoFrameEl';
    ifr.src=embed;
    ifr.allow='accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;fullscreen';
    ifr.allowFullscreen=true;
    ifr.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:none;';
    wrap.appendChild(ifr);
    if (esYouTube) _wireYoutubeCompletado(ifr, id);
    else if (esVimeo) _wireVimeoCompletado(ifr, id);
  } else if(url.match(/\.(mp4|webm|m4v)$/i)){
    const vid_=document.createElement('video');
    vid_.src=url; vid_.controls=true; vid_.autoplay=true; vid_.controlsList='nodownload';
    vid_.oncontextmenu=e=>e.preventDefault();
    vid_.style.cssText='position:absolute;inset:0;width:100%;height:100%;background:#000;';
    vid_.addEventListener('ended', ()=>_marcarVideoCompletado(id));
    wrap.appendChild(vid_);
  } else if(url){
    const ifr=document.createElement('iframe');
    ifr.src=url; ifr.allowFullscreen=true;
    ifr.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:none;';
    wrap.appendChild(ifr);
  }

  // Scroll suave al reproductor
  wrap.scrollIntoView({behavior:'smooth', block:'start'});
}

function clearPlayer(){
  const wrap=$('playerWrap'); if(!wrap) return;
  wrap.querySelectorAll('iframe,video').forEach(e=>e.remove());
  $('videoTitle').style.display='none'; if($('videoNotes')) $('videoNotes').textContent='';
}

/* ══════════════════════════════════════════════
   SECCIÓN 3 — INVITAR AMIGOS (Referidos)
══════════════════════════════════════════════ */
async function renderReferidos(cont){
  cont.style.cssText='padding:28px 24px;max-width:700px;margin:0 auto;';
  cont.innerHTML=`<div class="h2">🎁 Invitar amigos</div>
    <div style="text-align:center;padding:20px 0;color:var(--muted);font-size:13px;">Cargando…</div>`;

  try {
    const r=await fetch('/api/referral',{credentials:'same-origin'});
    if(!r.ok) throw new Error();
    const data=await r.json();
    const link=data.link || `${malevoBaseUrl()}/registro-membresia.html?ref=${data.code}`;

    cont.innerHTML=`
    <div class="h2">🎁 Invitar amigos</div>

    <!-- Hero -->
    <div class="card gold-glow" style="text-align:center;padding:36px 28px;margin-bottom:20px;">
      <div style="font-size:48px;margin-bottom:14px;">🎁</div>
      <h2 style="font-family:'Sora',sans-serif;font-size:22px;font-weight:700;color:var(--white);margin-bottom:10px;">
        Gana un 30% de descuento</h2>
      <p style="color:var(--text-2);font-size:14px;line-height:1.7;">
        Cada amigo que se registre y pague a través de tu enlace,<br>
        tú consigues automáticamente un <strong style="color:var(--gold-light);">30% de descuento</strong>
        en tu próxima cuota mensual.</p>
    </div>

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
      <div class="card" style="text-align:center;">
        <div style="font-size:38px;font-weight:800;font-family:'Sora',sans-serif;color:var(--gold-2);">${data.referred}</div>
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Amigos invitados</div>
      </div>
      <div class="card" style="text-align:center;">
        <div style="font-size:38px;font-weight:800;font-family:'Sora',sans-serif;color:${data.discount>0?'var(--ok)':'var(--muted)'};">${data.discount}%</div>
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">
          ${data.mesesPendientes>0 ? `Activo · ${data.mesesPendientes} mes${data.mesesPendientes===1?'':'es'}` : 'Descuento activo'}</div>
      </div>
    </div>

    <!-- Enlace -->
    <div class="card" style="margin-bottom:20px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-weight:600;">Tu enlace personal</div>
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="text" id="refLink" value="${esc(link)}" readonly
          style="background:rgba(226,144,35,.06);border-color:rgba(226,144,35,.25);color:var(--gold-light);
            font-size:13px;flex:1;cursor:pointer;"
          onclick="this.select();">
        <button class="btn sm" onclick="copiarEnlace('${esc(link)}')">📋 Copiar</button>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn sm sec" onclick="compartirWhatsapp('${esc(link)}')">💬 WhatsApp</button>
        <button class="btn sm sec" onclick="compartirEmail('${esc(link)}')">📧 Email</button>
      </div>
    </div>

    <!-- Cómo funciona -->
    <div class="card">
      <div class="h2" style="margin-bottom:14px;">¿Cómo funciona?</div>
      ${[
        {n:1, txt:'Comparte tu enlace con amigos que quieran aprender a bailar'},
        {n:2, txt:'Tu amigo se registra en Malevo usando tu enlace único'},
        {n:3, txt:'Cuando tu amigo realiza su primer pago, ¡tú ganas un mes más de descuento!'},
        {n:4, txt:'El 30% se aplica automáticamente en tus próximas cuotas — uno por cada amigo, se acumula'}
      ].map(s=>`
        <div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;
          border-bottom:1px solid var(--border);">
          <div style="flex:0 0 32px;height:32px;border-radius:50%;
            background:linear-gradient(135deg,rgba(226,144,35,.25),rgba(138,112,0,.15));
            border:1px solid rgba(226,144,35,.3);display:flex;align-items:center;justify-content:center;
            font-weight:700;font-size:13px;color:var(--gold-2);">${s.n}</div>
          <div style="font-size:13.5px;color:var(--text-2);padding-top:6px;">${s.txt}</div>
        </div>`).join('')}
    </div>`;
  } catch {
    cont.innerHTML+='<div class="vacio">No se pudo cargar la información de referidos.</div>';
  }
}

function copiarEnlace(link){
  portalPlayCopy();   // ← sonido al copiar
  navigator.clipboard?.writeText(link).then(()=>showToast('Enlace copiado','ok'))
    .catch(()=>{ $('refLink')?.select(); document.execCommand('copy'); showToast('Enlace copiado','ok'); });
}
function compartirWhatsapp(link){
  const msg = `¡Hola! Te invito a unirte a Malevo Academia. Regístrate desde mi enlace y empieza a bailar: ${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}
function compartirEmail(link){
  location.href=`mailto:?subject=${encodeURIComponent('Únete a la Academia Malevo')}&body=${encodeURIComponent('¡Hola! Te invito a aprender a bailar en la Academia Malevo. Regístrate con mi enlace: '+link)}`;
}

/* ══════════════════════════════════════════════
   SECCIÓN 4 — MI PERFIL
══════════════════════════════════════════════ */
function renderPerfil(cont, firstTime=false){
  cont.style.cssText='padding:28px 24px;max-width:680px;margin:0 auto;';
  cont.setAttribute('data-stagger','');
  const u=currentUser;

  // Banner de bienvenida (sin backtick anidado)
  const bannerBienvenida = firstTime
    ? '<div class="card reveal-down" style="--rv-dist:60px;margin-bottom:20px;text-align:center;">'+
      '<div style="font-size:32px;margin-bottom:8px;">👋</div>'+
      '<h3 style="font-family:\'Sora\',sans-serif;font-size:17px;color:var(--white);margin-bottom:6px;">¡Bienvenido a Malevo!</h3>'+
      '<p style="color:var(--text-2);font-size:13.5px;">Completa tu perfil para que podamos personalizarlo todo para ti.</p>'+
      '</div>'
    : '';

  const quitarFotoBtn = u.fotoPerfil
    ? '<button class="btn sm warn" onclick="eliminarFoto()" style="display:inline-flex;align-items:center;gap:6px;">× Quitar foto</button>'
    : '';

  cont.innerHTML=bannerBienvenida+`
  <div class="h2">👤 Mi perfil</div>

  <!-- Foto de perfil -->
  <div class="card reveal-up" style="margin-bottom:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;color:var(--white);margin-bottom:16px;">
      📷 Foto de perfil</h3>
    <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;">
      <div style="flex:0 0 auto;">
        <div id="fotoPreview" style="position:relative;width:90px;height:90px;border-radius:50%;overflow:hidden;
          background:linear-gradient(135deg,rgba(226,144,35,.2),rgba(138,112,0,.15));
          border:2px solid rgba(226,144,35,.4);display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 12px rgba(0,0,0,.4);"></div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:10px;">
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0;">
          Sube una foto o hazte una con tu cámara.<br>
          Aparecerá en el saludo de tu pantalla de inicio. Arrastra la imagen dentro del
          círculo para encuadrarla como quieras.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <label style="cursor:pointer;">
            <input type="file" id="fotoInput" accept="image/*" style="display:none;"
              onchange="previewFoto(this)">
            <span class="btn sm sec" style="display:inline-flex;align-items:center;gap:6px;">📁 Subir foto</span>
          </label>
          <button class="btn sm sec" onclick="capturarFoto()"
            style="display:inline-flex;align-items:center;gap:6px;">📷 Usar cámara</button>
          ${quitarFotoBtn}
        </div>
        <canvas id="fotoCanvas" style="display:none;"></canvas>
        <video id="fotoVideo" autoplay playsinline
          style="display:none;width:220px;border-radius:10px;border:1px solid rgba(226,144,35,.3);margin-top:6px;"></video>
        <div id="fotoCamControls" style="display:none;gap:8px;flex-wrap:wrap;margin-top:4px;">
          <button class="btn sm ok" onclick="tomarFoto()"
            style="display:inline-flex;align-items:center;gap:6px;">📸 Tomar foto</button>
          <button class="btn sm sec" onclick="cancelarCamara()"
            style="display:inline-flex;align-items:center;gap:6px;">× Cancelar</button>
        </div>
      </div>
    </div>
  </div>

  <div class="card reveal-up" style="margin-bottom:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;color:var(--white);margin-bottom:18px;">
      Datos personales</h3>
    <label class="label-field">Nombre completo</label>
    <input type="text" id="pNombre" value="${esc(u.nombre||'')}" placeholder="Tu nombre">
    <div class="g2">
      <div><label class="label-field">Email</label>
        <input type="email" id="pEmail" value="${esc(u.email||'')}" placeholder="correo@…"></div>
      <div><label class="label-field">Teléfono</label>
        <input type="tel" id="pTel" value="${esc(u.telefono||'')}" placeholder="600 000 000"></div>
    </div>
    <label class="label-field">Sobre mí (opcional)</label>
    <textarea id="pBio" rows="2" placeholder="Cuéntanos algo sobre ti, tus objetivos…">${esc(u.bio||'')}</textarea>
  </div>

  <div class="card reveal-up" style="margin-bottom:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;color:var(--white);margin-bottom:18px;">
      Mi rol de baile</h3>
    <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
      Indica tu rol preferido en las clases de pareja.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
      ${[{v:'leader',l:'Leader',i:'🕺',d:'Guío en la pareja'},
         {v:'follower',l:'Follower',i:'💃',d:'Sigo en la pareja'},
         {v:'indiferente',l:'Indiferente',i:'🔄',d:'Me adapto a lo que toque'}].map(r=>`
        <div onclick="selectRol('${r.v}')" id="rolCard_${r.v}"
          style="padding:16px 12px;border-radius:var(--r);cursor:pointer;text-align:center;
            transition:all .2s;border:2px solid ${(u.rol||'indiferente')===r.v?'var(--gold)':'var(--border)'};
            background:${(u.rol||'indiferente')===r.v?'rgba(226,144,35,.12)':'rgba(255,255,255,.03)'};">
          <div style="font-size:28px;margin-bottom:6px;">${r.i}</div>
          <div style="font-size:13px;font-weight:700;color:${(u.rol||'indiferente')===r.v?'var(--gold-2)':'var(--text-2)'};">${r.l}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px;">${r.d}</div>
        </div>`).join('')}
    </div>
    <input type="hidden" id="pRol" value="${esc(u.rol||'indiferente')}">
  </div>

  <div style="display:flex;gap:12px;align-items:center;">
    <button class="btn" onclick="guardarPerfil()"
      style="padding:12px 28px;font-size:14px;">${firstTime?'Guardar y continuar →':'Guardar cambios'}</button>
    ${!firstTime?'<button class="btn sec" onclick="pNavigate(\'agenda\')">Cancelar</button>':''}
  </div>

  <!-- Info del plan -->
  <div class="card reveal-up" style="margin-top:16px;background:rgba(226,144,35,.05);border-color:rgba(226,144,35,.18);">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Mi plan actual</div>
        <div style="font-size:18px;font-weight:700;color:var(--gold-2);">${planLabel(u.plan)}</div>
      </div>
      ${u.plan==='80'?'<span class="badge gold">🎓 VIP · Aula Virtual</span>':'<span class="badge muted">Solo presencial</span>'}
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-top:10px;">
      Para cambiar de plan habla con Gastón o Gimena.</p>
    <button class="btn sm sec" style="margin-top:12px;" onclick="abrirMisFacturas()">🧾 Quiero mi factura</button>
  </div>

  <!-- Facturación y suscripción (Stripe) — solo tiene sentido para planes
       de pago online; los alumnos cashOnly siguen pagando en efectivo con
       el admin, sin nada de esto. ── -->
  ${!u.cashOnly ? `
  <div class="card reveal-up" style="margin-top:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;color:var(--white);margin-bottom:6px;">
      💳 Suscripción y facturación</h3>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:16px;">
      Tus datos fiscales son obligatorios antes de pagar online — se usan en tus facturas.</p>

    <label class="label-field">Nombre completo (facturación)</label>
    <input type="text" id="pFactNombre" value="${esc((u.facturacion&&u.facturacion.nombreCompleto)||'')}" placeholder="Nombre y apellidos">
    <div class="g2">
      <div><label class="label-field">NIF / DNI / NIE</label>
        <input type="text" id="pFactNif" value="${esc((u.facturacion&&u.facturacion.nifDniNie)||'')}" placeholder="12345678A"></div>
      <div><label class="label-field">Dirección fiscal</label>
        <input type="text" id="pFactDireccion" value="${esc((u.facturacion&&u.facturacion.direccionFiscal)||'')}" placeholder="Calle, número, CP, ciudad"></div>
    </div>
    <button class="btn sm sec" onclick="guardarDatosFiscales()" style="margin-top:6px;">Guardar datos fiscales</button>

    <div id="stripeEstadoBox" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="color:var(--muted);font-size:12.5px;">Cargando estado de tu suscripción…</div>
    </div>
  </div>` : ''}`;

  // Animación scroll-reveal: las secciones del perfil aparecen deslizándose
  // en secuencia a medida que se hace scroll.
  initScrollReveal(cont);

  _fotoPreviewDirty = false;
  _fotoPreviewSetup(u.fotoPerfil || '', false);

  if (!u.cashOnly) cargarEstadoSuscripcionStripe();
}

/* ══ Facturación y suscripción (Stripe) ══════════════════════════════ */
async function guardarDatosFiscales(){
  const nombreCompleto   = ($('pFactNombre')?.value||'').trim();
  const nifDniNie        = ($('pFactNif')?.value||'').trim();
  const direccionFiscal  = ($('pFactDireccion')?.value||'').trim();
  if (!nombreCompleto || !nifDniNie || !direccionFiscal){
    showToast('Completa nombre, NIF/DNI/NIE y dirección fiscal.','warn'); return;
  }
  try{
    const r = await fetch('/api/portal/facturacion', {
      method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
      body: JSON.stringify({nombreCompleto, nifDniNie, direccionFiscal})
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||'Error al guardar');
    currentUser.facturacion = d.facturacion;
    showToast('Datos fiscales guardados.','ok');
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

const STRIPE_ESTADO_LABEL = {
  active:'Al día 🟢', trialing:'En periodo de prueba', past_due:'Pago pendiente ⚠️',
  en_deuda:'En deuda ⚠️', acceso_suspendido:'Acceso suspendido 🔴',
  pendiente_baja:'Baja programada', canceled:'Cancelada', incomplete:'Pago incompleto',
  unpaid:'Impagada', ninguno:'Sin suscripción activa'
};

async function cargarEstadoSuscripcionStripe(){
  const box = $('stripeEstadoBox');
  if (!box) return;
  try{
    const r = await fetch('/api/portal/stripe/estado', {credentials:'same-origin'});
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||'No se pudo cargar el estado');

    if (!d.stripeConfigurado){
      box.innerHTML = `<div style="color:var(--muted);font-size:12.5px;">El pago online todavía no está activado en la plataforma. Habla con administración para pagar tu cuota.</div>`;
      return;
    }

    const estadoTxt = STRIPE_ESTADO_LABEL[d.estado] || d.estado;
    let html = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Estado de tu suscripción</div>
        <div style="font-size:15px;font-weight:700;color:var(--white);">${esc(estadoTxt)}</div>
      </div>
    </div>`;

    if (!d.tieneSuscripcion){
      html += `<button class="btn sm" style="margin-top:14px;" onclick="pagarConStripe()">💳 Pagar con Stripe</button>`;
    } else {
      if (d.permanenciaMeses > 0){
        html += `<p style="color:var(--muted);font-size:12px;margin-top:10px;">
          Permanencia: ${d.permanenciaMeses} mes${d.permanenciaMeses===1?'':'es'}
          ${d.permanenciaCumplida ? '(ya cumplida ✓)' : '(todavía activa)'}</p>`;
      }
      html += `<button class="btn sm warn" style="margin-top:10px;" onclick="cancelarSuscripcionStripe()">Cancelar suscripción</button>`;
    }
    // "Gestionar mi suscripción" (Customer Portal de Stripe): cambiar
    // tarjeta y ver/descargar facturas. Se ofrece siempre que ya exista un
    // customer de Stripe, aunque la suscripción esté cancelada — el
    // histórico de facturas sigue ahí.
    if (d.tieneCustomer){
      html += `<button class="btn sm sec" style="margin-top:10px;" onclick="gestionarSuscripcionStripe()">🧾 Gestionar mi suscripción</button>`;
    }
    box.innerHTML = html;
  } catch(e){
    box.innerHTML = `<div style="color:var(--muted);font-size:12.5px;">No se pudo cargar el estado de tu suscripción.</div>`;
  }
}

async function pagarConStripe(){
  const fact = currentUser.facturacion;
  if (!fact || !fact.nombreCompleto || !fact.nifDniNie || !fact.direccionFiscal){
    showToast('Completa y guarda tus datos fiscales antes de pagar.','warn'); return;
  }
  try{
    showToast('Abriendo pasarela de pago…','info',2500);
    const r = await fetch('/api/portal/stripe/checkout-session', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
      body: JSON.stringify({plan: currentUser.plan})
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||'No se pudo iniciar el pago');
    window.location.href = d.url;
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

/* ── Lleva al Customer Portal oficial de Stripe: ahí el alumno cambia su
   tarjeta y ve/descarga sus facturas sin salir de una página segura de
   Stripe. ── */
async function gestionarSuscripcionStripe(){
  try{
    showToast('Abriendo tu portal de facturación…','info',2500);
    const r = await fetch('/api/portal/stripe/billing-portal', {method:'POST', credentials:'same-origin'});
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||'No se pudo abrir el portal de facturación');
    window.location.href = d.url;
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

async function cancelarSuscripcionStripe(){
  if (!confirm('¿Seguro que quieres cancelar tu suscripción?')) return;
  try{
    const r = await fetch('/api/portal/stripe/cancelar', {method:'POST', credentials:'same-origin'});
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||'No se pudo cancelar');
    showToast('Suscripción cancelada. Mantendrás el acceso hasta el final del periodo ya pagado.','ok',5000);
    cargarEstadoSuscripcionStripe();
  } catch(e){
    // El bloqueo por permanencia llega con este mensaje exacto desde el servidor
    showToast(e.message,'warn',6000);
  }
}

function selectRol(v){
  ['leader','follower','indiferente'].forEach(r=>{
    const card=document.getElementById('rolCard_'+r);
    if(!card) return;
    const active=r===v;
    card.style.borderColor=active?'var(--gold)':'var(--border)';
    card.style.background=active?'rgba(226,144,35,.12)':'rgba(255,255,255,.03)';
    card.querySelector('div:nth-child(2)').style.color=active?'var(--gold-2)':'var(--text-2)';
  });
  const inp=document.getElementById('pRol'); if(inp) inp.value=v;
}

function planLabel(plan){
  const m={'suelta':'Clase suelta','35':'1 clase/sem','50':'2 clases/sem','80':'VIP · Full Pass','bono':'Bono 5 clases'};
  return m[plan]||plan||'Sin plan asignado';
}

async function guardarPerfil(){
  const data={
    nombre:$('pNombre')?.value.trim()||'',
    email:$('pEmail')?.value.trim()||'',
    telefono:$('pTel')?.value.trim()||'',
    bio:$('pBio')?.value.trim()||'',
    rol:$('pRol')?.value||'indiferente',
  };

  // Incluir foto si se cambió o si el usuario reencuadró la actual arrastrándola
  if(currentUser._fotoTemporal === ''){
    data.fotoPerfil = ''; // eliminar
  } else if(_fotoPreviewDirty){
    data.fotoPerfil = await _bakearFotoPreview(); // hornea el encuadre elegido
  }

  try {
    const r=await fetch('/api/profile',{method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data), credentials:'same-origin'});
    if(!r.ok) throw new Error();
    const j=await r.json();
    Object.assign(currentUser, j.user);
    // Limpiar foto temporal tras guardar
    delete currentUser._fotoTemporal;
    _fotoPreviewDirty = false;

    if($('pUserBadge')) $('pUserBadge').textContent=currentUser.nombre;
    showToast('Perfil guardado','ok');
    portalPlaySuccess();
    cancelarCamara(); // cerrar cámara si estaba abierta
    if(!currentUser.profileComplete||activeView==='perfil'){
      setTimeout(()=>pNavigate('inicio'),800);
    }
  } catch { showToast('Error al guardar el perfil','warn'); }
}

/* ══════════════════════════════════════════════
   PAGO PENDIENTE (onboarding incompleto)
══════════════════════════════════════════════ */
const PLAN_LABELS_P = {
  suelta:{ nombre:'Clase suelta',    desc:'Una clase individual, sin cuota', icon:'🎟' },
  '35':  { nombre:'1 clase/semana',  desc:'Cuota mensual · Aula Virtual',    icon:'📅' },
  '50':  { nombre:'2 clases/semana', desc:'Cuota mensual · Aula Virtual',    icon:'📅📅' },
  '80':  { nombre:'VIP / Full Pass', desc:'Clases ilimitadas · Aula Virtual',icon:'🎓' },
  bono:  { nombre:'Bono 5 clases',  desc:'Flexible, sin caducidad',         icon:'🎫' },
};

/* ── Pantalla de "pago pendiente" al reingresar (alumno que se registró
   pero no llegó a completar el pago en Stripe, o lo canceló a mitad de
   camino). Antes esta pantalla dejaba "confirmar" el pago con un solo
   clic sin pasar por Stripe — un agujero de seguridad real, porque
   cualquiera podía activar su cuenta sin pagar. Ahora el único botón
   lleva de verdad a Stripe Checkout; la cuenta solo se activa cuando el
   webhook de Stripe confirma el pago (ver stripeBilling.manejarWebhook
   en el servidor). ── */
function mostrarPantallaPago(st){
  let overlay = document.getElementById('paymentOverlay');
  if (!overlay){
    overlay = document.createElement('div');
    overlay.id = 'paymentOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(ellipse 120% 100% at 50% -20%,#1a1200 0%,#0A0A0A 90%);';
    document.body.appendChild(overlay);
  }
  const p = PLAN_LABELS_P[st.plan] || { nombre: st.plan, desc:'', icon:'📋' };

  overlay.innerHTML = `
    <div style="width:100%;max-width:460px;background:rgba(10,8,0,.97);
      backdrop-filter:blur(40px);border:1px solid rgba(226,144,35,.28);border-radius:28px;
      padding:44px 38px;box-shadow:0 24px 64px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.06);
      text-align:center;animation:scaleIn .4s cubic-bezier(.34,1.56,.64,1);">
      <div style="font-size:48px;margin-bottom:14px;">💳</div>
      <h2 style="font-family:'Sora',sans-serif;font-size:22px;font-weight:700;color:var(--white);margin-bottom:8px;">
        Un paso más, ${esc(st.nombre||'')}</h2>
      <p style="color:var(--text-2);font-size:13.5px;line-height:1.75;margin-bottom:24px;">
        Para acceder a los contenidos necesitas completar el pago de tu primer mes en Stripe.</p>
      <div style="background:rgba(226,144,35,.08);border:1px solid rgba(226,144,35,.22);
        border-radius:16px;padding:18px 22px;margin-bottom:24px;text-align:left;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Plan seleccionado</div>
          <div style="font-size:17px;font-weight:700;color:var(--gold-2);">${p.icon} ${p.nombre}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${p.desc}</div>
        </div>
        <div style="font-family:'Sora',sans-serif;font-size:30px;font-weight:800;color:var(--gold-light);">
          ${st.precio}<span style="font-size:14px;color:var(--muted);margin-left:2px;">€</span>
        </div>
      </div>
      <div id="payErr" style="color:var(--warn);font-size:13px;margin-bottom:12px;min-height:18px;"></div>
      <button id="btnPagar" onclick="pagarConStripeOnboarding('${esc(st.plan||'')}')"
        style="width:100%;padding:15px;background:linear-gradient(135deg,#E29023,#B86E10);
          color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;
          cursor:pointer;font-family:inherit;transition:all .2s;
          box-shadow:0 5px 18px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.15);">
        💳 Pagar con Stripe
      </button>
      <p style="color:var(--muted);font-size:11.5px;margin-top:14px;">
        Te llevamos a la pasarela segura de Stripe. Tu cuenta se activa automáticamente en cuanto el pago se confirma.</p>
    </div>`;
}

async function pagarConStripeOnboarding(plan){
  const btn = document.getElementById('btnPagar');
  const err = document.getElementById('payErr');
  if (btn) { btn.disabled=true; btn.textContent='Conectando con Stripe…'; }
  if (err) err.textContent='';
  try {
    const r = await fetch('/api/portal/stripe/checkout-session',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ plan }),
      credentials:'same-origin'
    });
    const j = await r.json();
    if (!r.ok || !j.ok){
      if (err) err.textContent = j.error || 'No se pudo iniciar el pago. Inténtalo de nuevo.';
      if (btn) { btn.disabled=false; btn.textContent='💳 Pagar con Stripe'; }
      return;
    }
    window.location.href = j.url; // Stripe Checkout real — al volver, iniciarPortal() confirma el estado
  } catch {
    if (err) err.textContent = 'No se pudo conectar. Inténtalo de nuevo.';
    if (btn) { btn.disabled=false; btn.textContent='💳 Pagar con Stripe'; }
  }
}

/* ══════════════════════════════════════════════
   FOTO DE PERFIL
══════════════════════════════════════════════ */
function previewFoto(input){
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024){ showToast('La imagen debe ser menor de 2 MB','warn'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    actualizarPreviewFoto(dataUrl);
  };
  reader.readAsDataURL(file);
}

function actualizarPreviewFoto(dataUrl){
  // Guardar temporalmente en currentUser para que se refleje al guardar el perfil
  currentUser._fotoTemporal = dataUrl;
  _fotoPreviewSetup(dataUrl, true);
}

/* ── Encuadre de foto de perfil: el círculo muestra la imagen a tamaño
   "cover" (min-width/min-height:100%) y el usuario puede arrastrarla para
   elegir qué parte queda visible. El encuadre elegido se "hornea" en un
   canvas cuadrado de alta resolución justo antes de guardar (ver
   _bakearFotoPreview, usado en guardarPerfil). ── */
let _fotoPreviewDirty = false;

function _fotoPreviewSetup(dataUrl, marcarDirty){
  const preview = $('fotoPreview');
  if(!preview) return;
  const oldImg = $('fotoPreviewImg');
  if(oldImg && oldImg._fotoDragCleanup) oldImg._fotoDragCleanup();
  if(!dataUrl){
    preview.innerHTML = '<span style="font-size:34px;opacity:.5;">👤</span>';
    return;
  }
  preview.innerHTML = `<img id="fotoPreviewImg" src="${dataUrl}" draggable="false"
    style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    cursor:grab;touch-action:none;user-select:none;-webkit-user-drag:none;">`;
  if(marcarDirty) _fotoPreviewDirty = true;
  _ajustarFotoPreviewCover($('fotoPreviewImg'), preview);
  _bindFotoDrag();
}

/* Calcula y aplica en px el tamaño "cover" exacto de la imagen dentro del
 * círculo (equivalente a object-fit:cover, pero con dimensiones explícitas
 * en vez del truco CSS min-width/height:100%+width/height:auto — ese truco
 * podía dar tamaños desproporcionados con fotos de resolución/aspecto muy
 * variable, causando el efecto de "zoom gigante" que se salía del círculo). */
function _ajustarFotoPreviewCover(img, preview){
  if(!img || !preview) return;
  const aplicar = () => {
    const size = preview.clientWidth || 90;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if(!nw || !nh) return;
    const scale = size / Math.min(nw, nh);
    img.style.width  = (nw * scale) + 'px';
    img.style.height = (nh * scale) + 'px';
  };
  if(img.complete && img.naturalWidth) aplicar();
  else img.onload = aplicar;
}

function _bindFotoDrag(){
  const img = $('fotoPreviewImg');
  const preview = $('fotoPreview');
  if(!img || !preview) return;
  let dragging = false, startX = 0, startY = 0, startOffset = {x:0, y:0}, offset = {x:0, y:0};

  const clamp = (dx, dy) => {
    const pRect = preview.getBoundingClientRect();
    const iRect = img.getBoundingClientRect();
    const overX = Math.max(0, (iRect.width  - pRect.width)  / 2);
    const overY = Math.max(0, (iRect.height - pRect.height) / 2);
    return { x: Math.max(-overX, Math.min(overX, dx)), y: Math.max(-overY, Math.min(overY, dy)) };
  };
  const onDown = (e) => {
    dragging = true;
    img.style.cursor = 'grabbing';
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX; startY = pt.clientY;
    startOffset = {...offset};
    e.preventDefault();
  };
  const onMove = (e) => {
    if(!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    offset = clamp(startOffset.x + (pt.clientX - startX), startOffset.y + (pt.clientY - startY));
    img.style.transform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`;
    _fotoPreviewDirty = true;
    e.preventDefault();
  };
  const onUp = () => { dragging = false; img.style.cursor = 'grab'; };

  img.addEventListener('mousedown', onDown);
  img.addEventListener('touchstart', onDown, {passive:false});
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, {passive:false});
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);
  img._fotoDragCleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchend', onUp);
  };
}

/* Recorta, con el encuadre actual del círculo, la foto de perfil a un
   canvas cuadrado de alta resolución (independiente del tamaño en pantalla
   del círculo de 90px) y devuelve el dataURL resultante. */
function _bakearFotoPreview(){
  return new Promise(resolve => {
    const img = $('fotoPreviewImg');
    const preview = $('fotoPreview');
    if(!img || !preview){ resolve(currentUser._fotoTemporal || ''); return; }
    const pRect = preview.getBoundingClientRect();
    const iRect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth  / iRect.width;
    const scaleY = img.naturalHeight / iRect.height;
    const OUT = 400;
    const canvas = document.createElement('canvas');
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img,
      (pRect.left - iRect.left) * scaleX, (pRect.top - iRect.top) * scaleY,
      pRect.width * scaleX, pRect.height * scaleY,
      0, 0, OUT, OUT);
    resolve(canvas.toDataURL('image/jpeg', 0.88));
  });
}

async function capturarFoto(){
  const video = $('fotoVideo');
  const controls = $('fotoCamControls');
  if(!video || !controls) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}});
    video._stream = stream;
    video.srcObject = stream;
    video.style.display = 'block';
    controls.style.display = 'flex';
  } catch {
    showToast('No se pudo acceder a la cámara','warn');
  }
}

function tomarFoto(){
  const video = $('fotoVideo');
  const canvas = $('fotoCanvas');
  if(!video || !canvas) return;
  canvas.width  = video.videoWidth  || 320;
  canvas.height = video.videoHeight || 320;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  cancelarCamara();
  actualizarPreviewFoto(dataUrl);
  showToast('Foto capturada — pulsa Guardar para aplicarla','info');
}

function cancelarCamara(){
  const video = $('fotoVideo');
  const controls = $('fotoCamControls');
  if(video){
    if(video._stream) video._stream.getTracks().forEach(t=>t.stop());
    video.style.display = 'none';
  }
  if(controls) controls.style.display = 'none';
}

function eliminarFoto(){
  if(!confirm('¿Quitar la foto de perfil?')) return;
  currentUser._fotoTemporal = '';
  _fotoPreviewDirty = false;
  _fotoPreviewSetup('', false);
  showToast('Foto eliminada — pulsa Guardar para confirmar','info');
}

/* ── Modal "Pagar cuota / Renovación". Autoreporta el pago (lo confirma el
   admin después, igual que el resto de pagos de la academia). ── */
function abrirModalPagoCuota(){
  let ov = $('pagoCuotaOverlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'pagoCuotaOverlay';
    ov.className = 'pago-cuota-overlay';
    document.body.appendChild(ov);
  }
  const metodosHtml = ['transferencia','efectivo','bizum','tarjeta'].map((m,i)=>{
    const icons={transferencia:'🏦',efectivo:'💵',bizum:'📱',tarjeta:'💳'};
    const names={transferencia:'Transferencia',efectivo:'Efectivo',bizum:'Bizum',tarjeta:'Tarjeta'};
    return `<div onclick="_seleccionarMetodoPagoCuota('${m}')" id="pcm_${m}" class="pago-cuota-metodo${i===0?' sel':''}">
      <div style="font-size:22px;margin-bottom:4px;">${icons[m]}</div>
      <div style="font-size:12px;font-weight:600;">${names[m]}</div>
    </div>`;
  }).join('');
  ov.innerHTML = `
    <div class="pago-cuota-card">
      <button type="button" class="pago-cuota-close" onclick="cerrarModalPagoCuota()">×</button>
      <div style="font-size:38px;margin-bottom:10px;">💳</div>
      <h2 class="pago-cuota-titulo">Pagar cuota / Renovación</h2>
      <p class="pago-cuota-desc">Elige tu método y confirma — quedará pendiente de validación por la academia.</p>
      <div class="pago-cuota-metodos">${metodosHtml}</div>
      <div id="pagoCuotaErr" style="color:var(--warn);font-size:12.5px;margin:10px 0;min-height:16px;"></div>
      <button type="button" id="btnPagoCuotaConfirmar" class="pago-cuota-confirmar-btn" style="width:100%;margin-top:0;" onclick="confirmarPagoCuota()">
        ✓ Confirmar pago
      </button>
    </div>`;
  ov.style.display = 'flex';
  window._metodoPagoCuotaSeleccionado = 'transferencia';
}

function _seleccionarMetodoPagoCuota(m){
  window._metodoPagoCuotaSeleccionado = m;
  document.querySelectorAll('.pago-cuota-metodo').forEach(d=>{
    d.classList.toggle('sel', d.id === 'pcm_'+m);
  });
}

function cerrarModalPagoCuota(){
  const ov = $('pagoCuotaOverlay');
  if (ov) ov.style.display = 'none';
}

/* ══ "Quiero mi factura" — autoservicio del alumno ══════════════════
   Lista sus propios pagos (locales, sea Stripe o Bizum/transferencia
   registrados por el admin) y permite descargar el PDF de cada uno vía
   /api/factura/:pagoId/pdf (esa ruta ya valida que solo pueda bajar las
   suyas). No depende de tener Stripe activo — funciona igual para
   alumnos cashOnly. ══ */
async function abrirMisFacturas(){
  let ov = $('misFacturasOverlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'misFacturasOverlay';
    ov.className = 'pago-cuota-overlay';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `
    <div class="pago-cuota-card">
      <button type="button" class="pago-cuota-close" onclick="cerrarMisFacturas()">×</button>
      <div style="font-size:38px;margin-bottom:10px;">🧾</div>
      <h2 class="pago-cuota-titulo">Mis facturas</h2>
      <div id="misFacturasLista" style="text-align:left;margin-top:14px;">
        <p style="color:var(--muted);font-size:12.5px;text-align:center;">Cargando…</p>
      </div>
    </div>`;
  ov.style.display = 'flex';

  try{
    const r = await fetch('/api/mis-facturas', {credentials:'same-origin'});
    const d = await r.json();
    const lista = $('misFacturasLista');
    if (!lista) return;
    if (!d.ok) throw new Error(d.error||'No se pudieron cargar tus facturas.');
    if (!d.facturas || !d.facturas.length){
      lista.innerHTML = `<p style="color:var(--muted);font-size:12.5px;text-align:center;">
        Todavía no tienes facturas generadas. En cuanto se registre tu próximo pago, aparecerá aquí.</p>`;
      return;
    }
    lista.innerHTML = d.facturas.map(f=>{
      const numT = f.numeroTicket ? 'T-'+String(f.numeroTicket).padStart(5,'0') : (f.id||'').slice(0,8);
      const fecha = f.fechaPago ? new Date(f.fechaPago).toLocaleDateString('es-ES') : (f.mes||'—');
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;
        padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--white);">${esc(numT)}</div>
          <div style="font-size:11.5px;color:var(--muted);">${esc(fecha)} · ${f.importe!=null?f.importe+'€':''}</div>
        </div>
        <a class="btn sm sec" href="/api/factura/${f.id}/pdf" target="_blank" rel="noopener">📥 PDF</a>
      </div>`;
    }).join('');
  } catch(e){
    const lista = $('misFacturasLista');
    if (lista) lista.innerHTML = `<p style="color:var(--warn);font-size:12.5px;text-align:center;">Error: ${esc(e.message)}</p>`;
  }
}
function cerrarMisFacturas(){
  const ov = $('misFacturasOverlay');
  if (ov) ov.style.display = 'none';
}

async function confirmarPagoCuota(){
  const btn = $('btnPagoCuotaConfirmar');
  const err = $('pagoCuotaErr');
  if (btn){ btn.disabled=true; btn.textContent='Procesando…'; }
  if (err) err.textContent='';
  try {
    const r = await fetch('/api/portal/pago',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({metodo: window._metodoPagoCuotaSeleccionado||'transferencia'}),
      credentials:'same-origin'
    });
    const j = await r.json();
    if (!r.ok){
      if (err) err.textContent = j.error || 'No se pudo registrar el pago.';
      if (btn){ btn.disabled=false; btn.textContent='✓ Confirmar pago'; }
      return;
    }
    portalPlaySuccess();
    showToast('Pago registrado — quedará pendiente de validación 🎉','ok',4000);
    const ov = $('pagoCuotaOverlay'); if (ov) ov.remove();
  } catch {
    if (err) err.textContent = 'No se pudo conectar. Inténtalo de nuevo.';
    if (btn){ btn.disabled=false; btn.textContent='✓ Confirmar pago'; }
  }
}

/* ══════════════════════════════════════════════
   NOTIFICACIONES PUSH (permiso + Service Worker + suscripción real)
══════════════════════════════════════════════ */
function _urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/* Registra el Service Worker YA, sin esperar a que haya sesión iniciada
 * (a diferencia de _inicializarPush(), que sigue llamándose solo tras el
 * login porque las suscripciones push son por alumno). Instalabilidad de
 * la PWA (que Chrome/Android ofrezcan "Instalar app" y no solo "Crear
 * acceso directo") depende de tener un Service Worker registrado — si
 * solo se registraba después de iniciar sesión, un visitante que todavía
 * no entró nunca cumplía ese requisito y el navegador solo ofrecía el
 * acceso directo con barra. register() es idempotente: si ya estaba
 * registrado (p.ej. al volver a llamarlo desde _inicializarPush), el
 * navegador devuelve el mismo registro sin reinstalar nada. */
function _registrarServiceWorker(){
  if (!('serviceWorker' in navigator)){
    console.warn('[Malevo] Este navegador no soporta Service Worker — la PWA no será instalable.');
    return;
  }
  if (!window.isSecureContext){
    console.warn('[Malevo] Contexto no seguro (ni HTTPS ni localhost) — Service Worker no se registra.');
    return;
  }
  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('[Malevo] Service Worker registrado. Scope:', reg.scope);
    // Fuerza a Chrome a comprobar ya mismo si hay una versión más nueva de
    // sw.js en vez de esperar su chequeo periódico (hasta 24h) — importante
    // justo después de haber corregido el propio sw.js, para que un
    // registro viejo (de antes del listener de 'fetch') se actualice cuanto
    // antes en vez de quedarse "pegado" controlando la pestaña.
    reg.update().catch(() => {});
  }).catch(err => {
    console.error('[Malevo] No se pudo registrar el Service Worker (/sw.js):', err);
  });
}
_registrarServiceWorker();

/* ══════════════════════════════════════════════
   PROMPT DE INSTALACIÓN PWA — solo para cuentas "solo cursos"
   (soloCursosExternos, ver server.js). Un alumno normal ya tiene su propio
   flujo de instalación en index.html/registro-membresia.html — este es el
   equivalente para el comprador externo que entra directo al portal sin
   pasar por ninguna de esas dos pantallas. Se muestra una vez que
   arrancarPortal() confirma la cuenta y aterriza en Cursos; si el alumno
   toca "Ahora no" no se lo vuelve a molestar (localStorage), y tampoco se
   muestra si el navegador ya está corriendo como app instalada.
══════════════════════════════════════════════ */
let _pDeferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  _pDeferredInstallPrompt = e;
  const btn = $('pBtnInstalarNativo');
  if (btn) btn.style.display = 'block';
});

function _pEsStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function _pInstalarDetectarPlataforma(){
  const ua = navigator.userAgent || '';
  const esIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return esIOS ? 'ios' : 'android';
}

function _pInstalarMostrarPasos(plataforma){
  const pasosAndroid = $('pPasosAndroid');
  const pasosIOS = $('pPasosIOS');
  if (pasosAndroid) pasosAndroid.style.display = (plataforma === 'android') ? 'block' : 'none';
  if (pasosIOS) pasosIOS.style.display = (plataforma === 'ios') ? 'block' : 'none';
  document.querySelectorAll('#pInstalarTabs .p-instalar-tab').forEach(function(t){
    t.classList.toggle('activa', t.dataset.plataforma === plataforma);
  });
}

function _pInstalarPWANativo(){
  if (!_pDeferredInstallPrompt) return;
  _pDeferredInstallPrompt.prompt();
  _pDeferredInstallPrompt.userChoice.finally(function(){
    _pDeferredInstallPrompt = null;
    const btn = $('pBtnInstalarNativo');
    if (btn) btn.style.display = 'none';
  });
}

function _pInstalarCerrar(){
  const overlay = $('pInstalarOverlay');
  if (overlay) overlay.classList.remove('show');
  try{ localStorage.setItem('malevo_instalar_dismiss', '1'); }catch(e){}
}

// Señal fiable de instalación completada (a diferencia de asumir éxito solo
// por haber tocado el botón) — oculta el overlay si seguía abierto y avisa.
window.addEventListener('appinstalled', function(){
  const overlay = $('pInstalarOverlay');
  if (overlay) overlay.classList.remove('show');
  try{ localStorage.setItem('malevo_instalar_dismiss', '1'); }catch(e){}
  showToast('¡Aplicación instalada! Ya podés abrir Malevo desde tu pantalla de inicio 🎉','ok',5000);
});

function mostrarPromptInstalarPWA(){
  if (_pEsStandalone()) return; // ya la tiene instalada y abierta como app
  try{ if (localStorage.getItem('malevo_instalar_dismiss')==='1') return; }catch(e){}
  const overlay = $('pInstalarOverlay');
  if (!overlay) return;
  _pInstalarMostrarPasos(_pInstalarDetectarPlataforma());
  overlay.classList.add('show');
}

async function _inicializarPush(){
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!window.isSecureContext) return; // el push real requiere HTTPS (o localhost)

    const reg = await navigator.serviceWorker.register('/sw.js');

    if (Notification.permission === 'default'){
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub){
      const kr = await fetch('/api/push/vapid-public-key',{credentials:'same-origin'});
      if (!kr.ok) return;
      const { key } = await kr.json();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(key)
      });
    }
    await fetch('/api/push/subscribe',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(sub.toJSON ? sub.toJSON() : sub),
      credentials:'same-origin'
    });
  } catch { /* el push es un extra — nunca debe romper el arranque del portal */ }
}

iniciarPortal();
