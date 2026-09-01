/* ===== Malevo v3.0 · Panel de Administración ===== */
'use strict';

/* ── Constantes ── */
const DISCIPLINAS_VIDEO  = ['Bachata','Salsa'];
const DISCIPLINAS_ASIST  = ['Zumba','Tango','Ritmos Libres'];
const TODAS_DISCIPLINAS  = [...DISCIPLINAS_VIDEO,...DISCIPLINAS_ASIST,'Otro'];
const NIVELES            = [1,2,3,4];
const DIAS               = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DIAS_FULL          = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const PLANES = {
  'suelta': 'Clase suelta',
  '35':     '1 clase/sem',
  '50':     '2 clases/sem',
  '80':     'VIP · Full Pass',
  'bono':   'Bono 5 clases'
};
const PORTAL_PLANS = ['35','50','bono','80'];
const ROLES_LABEL= { admin:'Admin',teacher:'Profesor',student:'Alumno',guest:'Invitado' };

/* ── Catálogo oficial de vídeos de YouTube por disciplina y nivel ──
   Fuente: estructura oficial proporcionada por la academia.
   Se siembra automáticamente en el arranque (sembrarCatalogoOficialVideos,
   llamada desde arrancarApp) — no requiere ninguna acción manual del admin. */
const CATALOGO_OFICIAL_VIDEOS = {
  bachata: {
    nivel1: ['uYU3HiNVKM8','IavcdMT3M28','WoQGCSsZ23w','Mg3px2M_UVk','LBU9EJETy8g','0QeH4BMywhI'],
    nivel2: ['0QeH4BMywhI','YPZL4hobRP0'],
    nivel3: ['0QeH4BMywhI','Lb1nc_YciT0']
  },
  salsa: {
    nivel1: ['IfAR1EqRjeE','kCJ-Hmy32pw','oQVgBItTr04','GJCE0cpGX6c','IavcdMT3M28','84l5Y_Fxo9c','96p88pO-H-E','86HDu6kT2kc','zT-BGPOE1tc','D_oG0LbmxWE','ca-nJ8NT8rg','Cd-UnDCUusc'],
    nivel2: ['zT-BGPOE1tc','Z-tsOAUX4sI','23e2dYRDLWI','VsNGPg3n2m4','OvFVyPy6WAM','QAs_zB29ufc','DzAANwMqI_E','IbsPlQ3CA2s','0L8O8RSrwS4'],
    nivel3: ['zUoXytGVHHI','RVF1FDFIc2E','unXFLyUc3nU','9M8x3aFQX90','mx5eoRgAAkE','vnqbh9hR7LQ','CoNMTYl9Rb8','OGddunSLCD4','mQra8BCQdd8','nEHawWIA80c','Lb1nc_YciT0']
  }
};

/* ── Estado global ── */
let db       = null;
let _rev     = 0;
let _syncTimer = null;
let currentUser = null;
let activeView  = 'dashboard';

/* ── Helpers ── */
const eur = n => Number(n||0).toLocaleString('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:2});
const hoy = () => new Date().toISOString().slice(0,10);
const mesActual = () => new Date().toISOString().slice(0,7);
const iniciales = n => (n||'').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';

/* ── Nivel 4 se muestra como "Coreografías" en toda la interfaz de vídeo ── */
const nivelLabel = n => n===4 ? 'Coreografías' : 'Nivel '+n;
const nivelLabelCorto = n => n===4 ? 'Coreo' : 'N'+n;
/* Igual que nivelLabel pero con el 4 abreviado a "Coreo" (no "Coreografías") */
const nivelLabelFull = n => n===4 ? 'Coreo' : 'Nivel '+n;

/* ── Selección libre de niveles: normaliza a array de números ── */
function nivelesArr(v){
  if (Array.isArray(v)) return v.map(Number).filter(n=>!isNaN(n));
  if (v===null || v===undefined || v==='') return [];
  return [Number(v)];
}
/* Genera un grupo de checkboxes de niveles (1,2,3,Coreografías) */
function nivelCheckboxesHtml(idPrefix, valores){
  const arr = nivelesArr(valores);
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;">${NIVELES.map(n=>
    `<label style="display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;
      background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);cursor:pointer;font-size:12px;white-space:nowrap;">
      <input type="checkbox" id="${idPrefix}_${n}" value="${n}" style="width:auto;accent-color:var(--gold);"${arr.includes(n)?' checked':''}>
      ${nivelLabel(n)}
    </label>`).join('')}</div>`;
}
/* Lee un grupo de checkboxes de niveles generado con nivelCheckboxesHtml */
function leerNivelCheckboxes(idPrefix){
  return NIVELES.filter(n => document.getElementById(idPrefix+'_'+n)?.checked);
}
/* Texto legible de un array de niveles, p.ej. "Nivel 1, Coreografías" */
function nivelesDisplay(v){
  const arr = nivelesArr(v).sort((a,b)=>a-b);
  return arr.length ? arr.map(nivelLabel).join(', ') : '—';
}
/* Versión compacta para tarjetas pequeñas, p.ej. "N1 · Coreo" */
function nivelesDisplayCorto(v){
  const arr = nivelesArr(v).sort((a,b)=>a-b);
  return arr.length ? arr.map(nivelLabelCorto).join(' · ') : '—';
}
/* Versión con nombres completos, p.ej. "Nivel 1 · Coreo" */
function nivelesDisplayFull(v){
  const arr = nivelesArr(v).sort((a,b)=>a-b);
  return arr.length ? arr.map(nivelLabelFull).join(' · ') : '—';
}
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
  const r=Math.random()*16|0; return (c==='x'?r:r&0x3|0x8).toString(16); });
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(id){ return document.getElementById(id); }
function el(tag,attrs,content){
  const e=document.createElement(tag);
  Object.entries(attrs||{}).forEach(([k,v])=>{ if(k==='style')e.style.cssText=v; else e.setAttribute(k,v); });
  if(content!=null) e.innerHTML=content;
  return e;
}

/* ── Ripple (onda expansiva) global — delegado, no requiere tocar cada botón ── */
document.addEventListener('pointerdown', function(e){
  const el = e.target.closest('.btn, .nav-btn, .alumno-card, .alumno-action, .acc-toggle');
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.4;
  const span = document.createElement('span');
  span.className = 'ripple-span';
  span.style.width = span.style.height = size+'px';
  span.style.left = (e.clientX - rect.left - size/2)+'px';
  span.style.top  = (e.clientY - rect.top  - size/2)+'px';
  el.appendChild(span);
  setTimeout(()=>span.remove(), 620);
});

/* ── API ── */
async function api(method, path_, data){
  const opts = { method, headers:{'Content-Type':'application/json'}, credentials:'same-origin' };
  if (data) opts.body = JSON.stringify(data);
  const r = await fetch(path_,opts);
  if (r.status===401) { mostrarLogin(); throw new Error('401'); }
  if (r.status===403) { throw new Error('403: Acceso denegado'); }
  return r;
}
async function apiJSON(method, path_, data){
  const r = await api(method,path_,data);
  if (!r.ok) {
    // Si el servidor respondió con un error, el cuerpo puede no ser JSON
    // (p.ej. el 404 "Not found" del catch-all de rutas) — sin este chequeo
    // r.json() explota con un mensaje críptico ("Unexpected token 'N'...")
    // que no dice nada sobre la causa real del fallo.
    let msg = 'HTTP '+r.status;
    try { const j = await r.json(); if (j && j.error) msg = j.error; }
    catch { try { const t = await r.text(); if (t) msg += ' — '+t.slice(0,200); } catch {} }
    throw new Error(msg);
  }
  return r.json();
}

/* ── Logo del negocio en el header (arriba a la izquierda) ── */
function actualizarLogoHeader(){
  const cont = $('mainBrandIcon');
  if (!cont) return;
  const logo = db?.config?.negocio?.logo;
  cont.innerHTML = logo
    ? `<img src="${logo}" alt="Logo" style="width:100%;height:100%;object-fit:contain;border-radius:10px;">`
    : `<span>M</span>`;
}

/* ── DB helpers ── */
async function cargarDB(){
  const r = await api('GET','/api/db');
  if (!r.ok) throw new Error('HTTP '+r.status);
  db = await r.json();
  _rev = db._rev||0;
  return db;
}
async function guardarDB(){
  const r = await apiJSON('PUT','/api/db',db);
  if (r._rev) { _rev=r._rev; db._rev=r._rev; }
  marcarEstado(true);
}
function guardar(){
  guardarDB().then(()=>{}).catch(()=>{ marcarEstado(false); showToast('Sin conexión — cambios guardados localmente','warn'); });
}

function marcarEstado(online){
  const elem=$('estadoSync');
  if(!elem) return;
  const dot=elem.querySelector('.dot');
  // Actualizar texto (último nodo de texto)
  const nodes=[...elem.childNodes];
  const textNode=nodes.find(n=>n.nodeType===3&&n.textContent.trim());
  if(textNode) textNode.textContent=online?' En línea':' Sin conexión';
  else elem.insertAdjacentText('beforeend',online?' En línea':' Sin conexión');
  elem.className=online?'sync-online':'sync-offline';
  if(dot){
    dot.style.background=online?'var(--ok)':'var(--warn)';
    dot.style.boxShadow=online?'0 0 8px var(--ok-glow)':'none';
  }
}

async function sincronizar(){
  try {
    const r = await fetch('/api/db',{cache:'no-store',credentials:'same-origin'});
    if (r.status===401){ marcarEstado(false); mostrarLogin(); return; }
    if (!r.ok) return;
    const d = await r.json();
    marcarEstado(true);
    if ((d._rev||0) > _rev){ db=d; _rev=db._rev||0; actualizarLogoHeader(); refrescarVista(); }
  } catch { marcarEstado(false); }
}

/* ── Navegación ── */
const VIEWS_ADMIN   = ['dashboard','alumnos','clases','pagos','videos','config'];
const VIEWS_TEACHER = ['dashboard','clases'];
const VIEW_LABELS   = {
  dashboard:'Dashboard', alumnos:'Alumnos', clases:'Clases',
  pagos:'Pagos', videos:'Multimedia', config:'Configuración'
};
const VIEW_ICONS = {
  dashboard:'◉', alumnos:'◍', clases:'▦',
  pagos:'◆', videos:'▶', config:'⚙'
};

function buildNav(){
  const nav = $('mainNav');
  nav.innerHTML='';
  const views = currentUser.role==='admin' ? VIEWS_ADMIN : VIEWS_TEACHER;

  // Logo / título compacto en la cabecera del sidebar
  const header = document.createElement('div');
  header.style.cssText='padding:4px 8px 16px;border-bottom:1px solid rgba(226,144,35,.1);margin-bottom:12px;';
  header.innerHTML=`<div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;
    color:var(--muted);font-weight:700;">Panel Admin</div>`;
  nav.appendChild(header);

  views.forEach(v=>{
    const b=document.createElement('button');
    b.dataset.vista=v;
    b.className='nav-btn';
    b.innerHTML=`<span style="font-size:14px;opacity:.75;flex:0 0 auto;">${VIEW_ICONS[v]||'·'}</span>
      <span>${VIEW_LABELS[v]}</span>`;
    b.onclick=()=>{ navigateTo(v); };
    nav.appendChild(b);
  });

  // Separador inferior
  const sep = document.createElement('div');
  sep.style.cssText='flex:1;';
  nav.appendChild(sep);

  const footer = document.createElement('div');
  footer.style.cssText='border-top:1px solid rgba(226,144,35,.1);padding-top:12px;margin-top:8px;';
  footer.innerHTML=`<div style="font-size:10.5px;color:var(--faint);padding:4px 8px;line-height:1.5;">
    Malevo 2.0<br><span style="color:var(--muted);">Academia de Baile</span></div>`;
  nav.appendChild(footer);
}

function toggleSidebar(){
  const nav = $('mainNav');
  const overlay = $('sidebarOverlay');
  if(!nav || !overlay) return;
  nav.classList.toggle('open');
  overlay.classList.toggle('open');
}

function navigateTo(v){
  activeView=v;
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.vista===v);
  });
  const nav=$('mainNav'), ov=$('sidebarOverlay');
  if(nav) nav.classList.remove('open');
  if(ov)  ov.classList.remove('open');
  playNav();
  renderView(v);
}

function refrescarVista(){ renderView(activeView); }

function renderView(v){
  const main=$('mainContent');
  main.innerHTML='';
  const fade=el('div',{style:'animation:fade .28s cubic-bezier(.4,0,.2,1);'});
  main.appendChild(fade);
  if (v==='dashboard')  renderHoy(fade);
  else if(v==='alumnos')   renderAlumnos(fade);
  else if(v==='clases')    renderClases(fade);
  else if(v==='pagos')     renderPagos(fade);
  else if(v==='videos')    renderVideos(fade);
  else if(v==='informes')  renderConfig(fade);
  else if(v==='config')    renderConfig(fade);
}

/* ── Finanzas helpers ── */
function calcularReparto(importe, numPago){
  const c=db.config;
  const base=importe/(1+c.iva/100);
  const iva=importe-base;
  const esIni = numPago<=(c.mesesIniciales||3);
  const r = esIni ? c.inicial : c.posterior;
  return { importe, base, iva, malevo:base*(r.malevo/100), box:base*(r.box/100),
    periodo: esIni?'Inicial':'Posterior', malevoPct:r.malevo, boxPct:r.box };
}
function numPagoDeUsuario(userId, mes, excluirId){
  const lista = db.payments
    .filter(p=>p.userId===userId && p.id!==excluirId)
    .map(p=>p.mes);
  if (!lista.includes(mes)) lista.push(mes);
  lista.sort();
  return lista.indexOf(mes)+1;
}
function precioUsuario(u){
  return db.config.precios[u.plan]??0;
}
function nombreUsuario(id){
  if(!id || id==='__anonimo__') return '— Anónimo (simplif.)';
  const u=(db.users||[]).find(x=>x.id===id);
  return u?u.nombre:'(eliminado)';
}

/* ── Vista HOY ── */
/* ── Vista HOY (Dashboard) ── */
/* ══════════════════════════════════════════════════════
   DASHBOARD — Diseño nuevo con imagen de bailarines
══════════════════════════════════════════════════════ */
/* ══ DASHBOARD ══ */
/* ══ DASHBOARD ══ */
/* ══ DASHBOARD — imagen completa de fondo + HTML encima ══ */
/* ── Vista HOY (Dashboard) ── */
function renderHoy(cont){
  var ahora=new Date();
  var dow=ahora.getDay(), mes=mesActual(), today=hoy();
  var hora=ahora.getHours();
  var saludo=hora<13?'¡Buenos días':hora<20?'¡Buenas tardes':'¡Buenas noches';
  var nombre=(currentUser&&currentUser.nombre||'').split(' ')[0]||'Admin';
  var fechaStr=ahora.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  var clasesHoy=(db.classes||[]).filter(function(c){return c.dia===dow;}).sort(function(a,b){return(a.inicio||'').localeCompare(b.inicio||'');});
  var alumnosActivos=(db.users||[]).filter(function(u){return u.active&&u.role==='student';}).length;
  var totalAlumnos=(db.users||[]).filter(function(u){return u.role==='student';}).length;
  var faltaCobrar=new Map();
  clasesHoy.forEach(function(c){
    usersOfClass(c.id).forEach(function(u){
      if(!u.guestCourtesy&&!db.payments.find(function(p){return p.userId===u.id&&p.mes===mes;}))
        faltaCobrar.set(u.id,u);
    });
  });
  var ingresosMes=(db.payments||[]).filter(function(p){return p.mes===mes;}).reduce(function(s,p){return s+(p.importe||0);},0);
  var pagosHoy=(db.payments||[]).filter(function(p){return p.fechaPago===today;}).length;

  var uAdmin=(db.users||[]).find(function(x){return x.id===(currentUser&&currentUser.sub);});
  var fotoAdmin=uAdmin&&uAdmin.fotoPerfil;
  var avatarHtml=fotoAdmin
    ? '<img src="'+esc(fotoAdmin)+'" alt="" style="width:100%;height:100%;object-fit:cover;">'
    : '<span style="font-family:\'Sora\',sans-serif;font-weight:700;font-size:19px;color:var(--text-2);">'+iniciales(nombre)+'</span>';

  var h='';

  /* ── HERO ── */
  h+='<div style="'+
    'background:var(--card-bg);'+
    'border:1px solid var(--card-border);border-radius:var(--r-xl);'+
    'padding:28px 34px;margin-bottom:24px;">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">'+
      '<div style="display:flex;align-items:center;gap:16px;">'+
        '<button onclick="abrirGestorAvatarAdmin()" title="Cambiar foto de perfil" style="'+
          'flex:0 0 auto;width:58px;height:58px;border-radius:50%;overflow:hidden;cursor:pointer;'+
          'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);padding:0;'+
          'display:flex;align-items:center;justify-content:center;position:relative;transition:border-color .2s;"'+
          'onmouseover="this.style.borderColor=\'rgba(255,255,255,.32)\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.14)\'">'+
          avatarHtml+
        '</button>'+
        '<div>'+
          '<div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:5px;">Panel de control</div>'+
          '<h1 style="font-family:\'Sora\',sans-serif;font-size:clamp(19px,2.3vw,28px);font-weight:700;'+
            'color:var(--text);letter-spacing:-.3px;margin-bottom:4px;">'+saludo+', '+esc(nombre)+'!</h1>'+
          '<p style="color:var(--text-2);font-size:13px;">'+fechaStr+'</p>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px;">'+
        '<div style="display:inline-flex;align-items:center;gap:7px;padding:5px 14px;'+
          'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);'+
          'border-radius:30px;font-size:11.5px;font-weight:600;color:var(--text-2);">'+
          '<span style="width:6px;height:6px;border-radius:50%;background:var(--ok);'+
            'box-shadow:0 0 5px var(--ok-glow);display:inline-block;"></span>'+
          'Sistema en línea'+
        '</div>'+
        (pagosHoy?'<div style="font-size:11.5px;color:var(--text-2);">✓ '+pagosHoy+' pago'+(pagosHoy!==1?'s':'')+' hoy</div>':'<div style="font-size:11.5px;color:var(--faint);">— 0 pagos registrados hoy</div>')+
        '<button class="btn sec sm" id="btnCopiarLinkPago" onclick="copiarLinkPago()" '+
          'style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;white-space:nowrap;">'+
          '🔗 Copiar link de pago</button>'+
      '</div>'+
    '</div>'+
  '</div>';

  /* ── STATS ── */
  var stats=[
    {icon:'📅',lbl:'Clases hoy',       val:clasesHoy.length, sub:clasesHoy.length?clasesHoy[0].inicio+' '+clasesHoy[0].nombre:'Sin clases hoy'},
    {icon:'👥',lbl:'Alumnos activos',  val:alumnosActivos,   sub:totalAlumnos!==alumnosActivos?(totalAlumnos-alumnosActivos)+' de baja':'Todos activos'},
    {icon:'💳',lbl:'Pendientes cobro', val:faltaCobrar.size, sub:faltaCobrar.size?'Este mes':'Al día ✓', warn:faltaCobrar.size>0},
    {icon:'€', lbl:'Ingresos del mes', val:eur(ingresosMes), sub:mes.replace('-','/'), gold:true},
  ];
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px;">';
  stats.forEach(function(s){
    var vc=s.warn?'var(--warn)':s.gold?'var(--gold-2)':'var(--text)';
    h+=statCard(s.lbl,s.val,vc,s.icon,s.sub);
  });
  h+='</div>';

  /* ── CLASES DE HOY ── */
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">'+
    '<span style="width:3px;height:14px;border-radius:2px;flex:0 0 auto;'+
      'background:linear-gradient(var(--gold),var(--accent-deep));"></span>'+
    '<span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--muted);">Clases de hoy</span>'+
  '</div>';

  if(!clasesHoy.length){
    h+='<div style="text-align:center;padding:60px 24px;background:rgba(255,255,255,.02);'+
      'border:1px dashed rgba(226,144,35,.14);border-radius:var(--r-xl);">'+
      '<div style="font-size:40px;margin-bottom:14px;opacity:.4;">📅</div>'+
      '<div style="font-size:15px;font-weight:600;color:var(--muted);margin-bottom:6px;">Sin clases hoy</div>'+
      '<div style="font-size:13px;color:var(--faint);">Disfruta el día libre o revisa la sección de Alumnos.</div>'+
    '</div>';
  } else {
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:28px;">';
    clasesHoy.forEach(function(c){
      var lista=usersOfClass(c.id);
      var ocupacionHtml='<div style="font-size:11px;color:var(--muted);margin:8px 0 12px;">👥 '+lista.length+' alumno'+(lista.length!==1?'s':'')+'</div>';
      h+='<div class="card">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px;">'+
          '<div>'+
            '<div style="font-size:16px;font-weight:700;margin-bottom:3px;">'+esc(c.nombre)+'</div>'+
            '<div style="color:var(--muted);font-size:12px;">'+esc(c.estilo)+(c.nivelNum?' · Nivel '+c.nivelNum:'')+'</div>'+
          '</div>'+
          '<div style="font-family:\'Sora\',sans-serif;font-size:14.5px;font-weight:700;color:var(--text-2);white-space:nowrap;">'+c.inicio+(c.fin?'–'+c.fin:'')+'</div>'+
        '</div>'+
        ocupacionHtml+
        '<button class="btn sec sm" style="width:100%;margin-bottom:12px;" onclick="abrirAsistencia(\''+c.id+'\')">📋 Pasar lista</button>'+
        '<div style="display:flex;flex-direction:column;gap:5px;">';
      lista.forEach(function(u){
        var pagado=!!db.payments.find(function(p){return p.userId===u.id&&p.mes===mes;});
        var asist=db.attendances.find(function(a){return a.classId===c.id&&a.userId===u.id&&a.fecha===today;});
        var mc2=asist?(asist.present?'var(--ok)':'var(--warn)'):'var(--border)';
        h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:8px;'+
          'background:'+(asist&&asist.present?'rgba(226,144,35,.05)':asist?'rgba(224,92,92,.05)':'rgba(255,255,255,.02)')+';'+
          'border:1px solid '+mc2+'33;">'+
          '<div style="display:flex;align-items:center;gap:8px;">'+
            '<span style="width:7px;height:7px;border-radius:50%;background:'+mc2+';flex:0 0 auto;"></span>'+
            '<span style="font-size:13px;font-weight:500;">'+esc(u.nombre)+'</span>'+
          '</div>'+
          (pagado?'<span class="badge ok" style="font-size:10.5px;">✓ Pagado</span>':'<button class="btn sm" style="padding:4px 10px;font-size:11px;" onclick="abrirPago(\''+u.id+'\')">Cobrar</button>')+
        '</div>';
      });
      h+='</div></div>';
    });
    h+='</div>';
  }

  /* ── COBROS PENDIENTES ── */
  if(faltaCobrar.size){
    h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;margin-top:8px;">'+
      '<span style="width:3px;height:14px;border-radius:2px;background:var(--warn);flex:0 0 auto;"></span>'+
      '<span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--warn);">Cobros pendientes</span>'+
      '<span style="background:var(--warn-soft);border:1px solid rgba(224,92,92,.25);padding:2px 10px;border-radius:20px;font-size:10px;color:var(--warn);font-weight:700;">'+
        faltaCobrar.size+' pendiente'+(faltaCobrar.size!==1?'s':'')+
      '</span></div>';
    var rows='';
    faltaCobrar.forEach(function(u){
      rows+='<tr><td><strong>'+esc(u.nombre)+'</strong></td>'+
        '<td><span class="badge muted">'+(PLANES[u.plan]||u.plan||'—')+'</span></td>'+
        '<td><span class="badge warn">'+eur(precioUsuario(u))+'</span></td>'+
        '<td style="text-align:right;"><button class="btn sm" onclick="abrirPago(\''+u.id+'\')">Registrar pago</button></td></tr>';
    });
    h+='<div class="tbl-wrap"><table><thead><tr><th>Alumno</th><th>Plan</th><th>Importe</th><th style="text-align:right;">Acción</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  /* ── MI PLAYLIST — el reproductor de la playlist local, para poner música en clase ── */
  h+='<div style="display:flex;align-items:center;gap:10px;margin:8px 0 16px;">'+
    '<span style="width:3px;height:14px;border-radius:2px;flex:0 0 auto;'+
      'background:linear-gradient(var(--gold),var(--accent-deep));"></span>'+
    '<span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--muted);">Mi Playlist</span>'+
  '</div>'+
  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px;margin-bottom:8px;">'+
    '<div id="dashMiPlaylistEmbed"><div class="card" style="border-color:rgba(255,255,255,.08);'+
      'display:flex;align-items:center;justify-content:center;min-height:200px;color:var(--muted);font-size:12.5px;">'+
      'Cargando música…</div></div>'+
  '</div>';

  cont.innerHTML=h;
  dashCargarMiPlaylist();
}

/* ── Tarjeta "Mi Playlist" en el Dashboard del admin: reutiliza el mismo
   reproductor de música local (por disciplina/nivel, carpeta de Drive) que
   ve el alumno y que ya existía como espejo dentro de "Ver como alumno"
   (maRenderMiPlaylistCard/mmp*) — acá se monta directo en el Dashboard
   real para que el admin pueda poner música en clase sin tener que entrar
   a simular un alumno. _maVideos se carga on-demand (se cachea sola). ── */
async function dashCargarMiPlaylist(){
  const cont = $('dashMiPlaylistEmbed');
  if (!cont) return; // el admin ya cambió de vista mientras cargaba
  try {
    await maAsegurarVideosCargados();
    if (!$('dashMiPlaylistEmbed')) return; // pudo haber navegado mientras esperaba el fetch
    cont.innerHTML = maRenderMiPlaylistCard() || (
      '<div class="card" style="border-color:rgba(255,255,255,.08);display:flex;align-items:center;'+
      'justify-content:center;min-height:200px;color:var(--muted);font-size:12.5px;text-align:center;padding:24px;">'+
      '🎵 Todavía no hay música cargada. Subí clases con música (Multimedia → Vídeos → tipo "Playlist") '+
      'para poder reproducirla acá.</div>'
    );
    // maRenderMiPlaylistCard() trae la clase "reveal-left" (animación de
    // entrada por scroll): un elemento con esa clase arranca en
    // opacity:0/trasladado y SOLO se hace visible cuando initScrollReveal()
    // lo detecta y le agrega "in-view". Como esta tarjeta se inyecta
    // async — después del initScrollReveal(cont) inicial de renderHoy — sin
    // este llamado quedaba en el DOM pero invisible para siempre.
    initScrollReveal(cont);
    if ($('maMiPlaylistCard')){
      _mmpPlaying = null;
      mmpWireAudioEvents();
      _mmpVista = 'playlist';
      mmpRepintarTabs();
      mmpSeleccionarNivel('Bachata', 1);
    }
  } catch(e){
    console.error('[Mi Playlist] no se pudo cargar el reproductor:', e);
    const c = $('dashMiPlaylistEmbed');
    if (c) c.innerHTML =
      '<div class="card" style="border-color:rgba(224,92,92,.3);display:flex;align-items:center;'+
      'justify-content:center;min-height:200px;color:var(--warn);font-size:12.5px;text-align:center;padding:24px;">'+
      '⚠ No se pudo cargar el reproductor ('+esc(e.message||String(e))+').</div>';
  }
}

/* ── Mini gráfico de barras en SVG puro (sin librerías externas) ──
   items: [{label, value, hoy}]. opts.esDinero formatea el tooltip/valor en €. */
function miniBarChart(items, opts){
  opts=opts||{};
  var max=Math.max.apply(null,items.map(function(d){return d.value;}).concat([1]));
  var w=340, h=110, barGap=10, barW=(w-barGap*(items.length-1))/items.length;
  var bars='', labels='';
  items.forEach(function(d,i){
    var barH=Math.max(3, Math.round((d.value/max)*(h-24)));
    var x=i*(barW+barGap);
    var y=h-24-barH;
    var fill=d.hoy?'var(--gold)':'rgba(255,255,255,.16)';
    bars+='<rect x="'+x+'" y="'+y+'" width="'+barW+'" height="'+barH+'" rx="4" fill="'+fill+'">'+
      '<title>'+d.label+': '+(opts.esDinero?eur(d.value):d.value)+'</title></rect>';
    if (d.hoy) bars+='<text x="'+(x+barW/2)+'" y="'+(y-6)+'" text-anchor="middle" font-size="10" font-weight="700" fill="var(--gold-2)" font-family="Sora,sans-serif">'+(opts.esDinero?Math.round(d.value):d.value)+'</text>';
    labels+='<text x="'+(x+barW/2)+'" y="'+(h-6)+'" text-anchor="middle" font-size="10" fill="'+(d.hoy?'var(--text-2)':'var(--faint)')+'" font-family="Inter,sans-serif">'+d.label+'</text>';
  });
  return '<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;height:auto;display:block;overflow:visible;">'+
    '<line x1="0" y1="'+(h-24)+'" x2="'+w+'" y2="'+(h-24)+'" stroke="rgba(255,255,255,.08)" stroke-width="1"/>'+
    bars+labels+
  '</svg>';
}

/* Fondo del dashboard gestionado dentro de navigateTo (ver arriba) */

function statCard(label,val,color,icon,sub){
  icon=icon||''; sub=sub||'';
  const iconSpan=icon?'<span style="font-size:14px;opacity:.7;">'+icon+'</span>':'';
  const subDiv=sub?'<div style="font-size:11px;color:var(--muted);margin-top:6px;">'+sub+'</div>':'';
  return '<div class="card stat glow" style="position:relative;overflow:hidden;">'+
    '<div style="position:absolute;top:-12px;right:-8px;font-size:42px;opacity:.07;pointer-events:none;line-height:1;">'+icon+'</div>'+
    '<div class="lbl" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">'+iconSpan+label+'</div>'+
    '<div class="val" style="color:'+color+';font-size:38px;line-height:1.1;">'+val+'</div>'+
    subDiv+
    '</div>';
}
function usersOfClass(classId){
  return (db.enrollments||[])
    .filter(e=>e.classId===classId&&e.status==='active')
    .map(e=>(db.users||[]).find(u=>u.id===e.userId))
    .filter(Boolean);
}

/* ── Avatar del admin en el Dashboard: gestión de foto de perfil propia ──
   Reutiliza el mismo campo fotoPerfil que ya usan los alumnos, pero se
   guarda con guardar()/PUT /api/db (el mecanismo genérico ya usado en toda
   la app), no con PUT /api/users/{id}, para no depender de validaciones
   de esquema específicas de rol que no conocemos del lado del servidor. */
function abrirGestorAvatarAdmin(){
  const u = (db.users||[]).find(x=>x.id===currentUser.sub);
  const fotoActual = u?.fotoPerfil || '';
  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalAvatarAdmin';
  overlay.innerHTML=`
    <div class="modal-box" style="max-width:360px;width:100%;text-align:center;">
      <h3 class="modal-title">Foto de perfil</h3>
      <div id="avAdminPreview" style="width:92px;height:92px;border-radius:50%;margin:8px auto 20px;
        overflow:hidden;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);
        display:flex;align-items:center;justify-content:center;">
        ${fotoActual
          ? `<img src="${esc(fotoActual)}" style="width:100%;height:100%;object-fit:cover;">`
          : `<span style="font-size:28px;color:var(--text-2);font-weight:700;font-family:'Sora',sans-serif;">${iniciales(u?.nombre||currentUser.nombre)}</span>`}
      </div>
      <label class="btn sec sm" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
        📁 Elegir foto
        <input type="file" accept="image/*" style="display:none;" onchange="avAdminPreviewFoto(this)">
      </label>
      ${fotoActual?`<button class="btn sec sm" style="margin-left:8px;" onclick="avAdminQuitarFoto()">Quitar</button>`:''}
      <p style="font-size:11px;color:var(--faint);margin-top:14px;">JPG o PNG, máx. 2 MB.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:18px;">
        <button class="btn sec" onclick="cerrarModal('modalAvatarAdmin')">Cancelar</button>
        <button class="btn" onclick="avAdminGuardarFoto()">Guardar</button>
      </div>
    </div>`;
  playModal(); document.body.appendChild(overlay);
}
function avAdminPreviewFoto(input){
  const file=input.files[0]; if(!file) return;
  if(file.size>2*1024*1024){ showToast('Imagen debe ser < 2 MB','warn'); return; }
  const reader=new FileReader();
  reader.onload=e=>{
    window._avAdminFotoTemp = e.target.result;
    const p=$('avAdminPreview');
    if(p) p.innerHTML='<img src="'+e.target.result+'" style="width:100%;height:100%;object-fit:cover;">';
  };
  reader.readAsDataURL(file);
}
function avAdminQuitarFoto(){
  window._avAdminFotoTemp='';
  const p=$('avAdminPreview');
  if(p) p.innerHTML='<span style="font-size:28px;color:var(--text-2);font-weight:700;font-family:\'Sora\',sans-serif;">'+iniciales(currentUser.nombre)+'</span>';
}
async function avAdminGuardarFoto(){
  if (window._avAdminFotoTemp===undefined){ cerrarModal('modalAvatarAdmin'); return; }
  const u=(db.users||[]).find(x=>x.id===currentUser.sub);
  if(!u){ showToast('No se encontró tu usuario en la base de datos','warn'); return; }
  u.fotoPerfil = window._avAdminFotoTemp;
  try {
    guardar();
    delete window._avAdminFotoTemp;
    cerrarModal('modalAvatarAdmin');
    renderView('dashboard');
    showToast('Foto de perfil actualizada','ok');
    playSuccess(); flashSuccess();
  } catch(e){ showToast('Error al guardar: '+e.message,'warn'); }
}

/* ── Vista ALUMNOS ── */
function renderAlumnos(cont){
  cont.innerHTML=`
  <div class="section-head">
    <div class="h2">◍ Alumnos y clientes</div>
    <button class="btn" onclick="abrirModalAlumno()">+ Nuevo alumno</button>
  </div>
  <div class="toolbar">
    <input type="text" id="busqAlumno" placeholder="Buscar por nombre o tel…" style="max-width:220px;" oninput="filtrarAlumnos()">
    <select id="filtPlan" onchange="filtrarAlumnos()" style="max-width:190px;">
      <option value="">Todos los planes</option>
      <option value="suelta">Clase suelta · 12 €</option>
      <option value="35">1 clase/sem · 35 €</option>
      <option value="50">2 clases/sem · 50 €</option>
      <option value="bono">Bono 5 clases · 50 €</option>
      <option value="80">VIP / Full Pass · 80 €</option>
    </select>
    <select id="filtActivo" onchange="filtrarAlumnos()" style="max-width:160px;">
      <option value="">Activos e inactivos</option>
      <option value="1">Solo activos</option>
      <option value="0">Inactivos</option>
    </select>
    <select id="filtTipo" onchange="filtrarAlumnos()" style="max-width:170px;">
      <option value="">Todos</option>
      <option value="normal">Pago digital</option>
      <option value="cash">Efectivo / sin factura</option>
      <option value="guest">Invitados cortesía</option>
    </select>
    <span id="cntAlumnos" style="margin-left:auto;color:var(--muted);font-size:12px;"></span>
  </div>
  <div class="alumnos-layout">
    <div id="tablaAlumnos" class="alumnos-grid-wrap"></div>
    <div class="az-index" id="azIndex"></div>
  </div>`;
  filtrarAlumnos();
}

function filtrarAlumnos(){
  const q=(($('busqAlumno')||{}).value||'').toLowerCase();
  const fp=($('filtPlan')||{}).value||'';
  const fa=($('filtActivo')||{}).value??'';
  const ft=($('filtTipo')||{}).value||'';

  // Exclusión estricta: admins, teachers y compradores externos "solo
  // cursos" (soloCursosExternos — canjearon un token de acceso a un curso
  // puntual, nunca fueron alumnos de la academia) NO aparecen aquí. Estos
  // últimos se ven, en cambio, dentro de "Alumnos" de cada curso puntual
  // (modal de accesos externos en Cursos Exclusivos).
  const lista=(db.users||[]).filter(u=>{
    if(['admin','teacher'].includes(u.role)) return false;
    if(u.soloCursosExternos) return false;
    const matchQ = u.nombre.toLowerCase().includes(q) ||
                   (u.telefono||'').replace(/\s/g,'').includes(q.replace(/\s/g,''));
    const matchP = !fp || u.plan===fp;
    const matchA = fa==='' || (u.active?'1':'0')===fa;
    const matchT = !ft ||
      (ft==='cash'  && !!u.cashOnly) ||
      (ft==='guest' && !!u.guestCourtesy) ||
      (ft==='normal'&& !u.cashOnly && !u.guestCourtesy);
    return matchQ && matchP && matchA && matchT;
  }).sort((a,b)=>a.nombre.localeCompare(b.nombre));

  const cnt=$('cntAlumnos');
  if(cnt) cnt.textContent=`${lista.length} alumno${lista.length!==1?'s':''}`;
  const cont=$('tablaAlumnos'); if(!cont) return;
  if(!lista.length){ cont.innerHTML='<div class="vacio">Sin resultados.</div>'; return; }

  const DIAS_F=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const initials = n => (n||'').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();

  const grid=document.createElement('div'); grid.className='alumnos-grid';
  const letrasPresentes=new Set();
  let letraAnterior='';

  lista.forEach((u,idx)=>{
    let tipoBadges='';
    if(u.guestCourtesy) tipoBadges+='<span class="alumno-badge" title="Invitado">♡ Invitado</span>';
    if(u.cashOnly)      tipoBadges+='<span class="alumno-badge" title="Pago en efectivo">💵 Efectivo</span>';

    const factLabel={'email':'📧 Email','whatsapp':'💬 WhatsApp','none':'— Sin envío'}[u.facturaEnvio||'none'];
    const clasesAsig=(db.classes||[]).filter(c=>(u.assignedClasses||[]).includes(c.id));
    const clasesTxt = clasesAsig.length
      ? clasesAsig.map(c=>`${DIAS_F[c.dia]?.slice(0,3)||''} ${c.inicio} · ${esc(c.nombre)}`).join('<br>')
      : 'Sin clases asignadas';

    // Letra inicial para el índice A-Z: solo se marca la primera tarjeta de cada letra
    const letra=(u.nombre||'#').trim()[0]?.toUpperCase()||'#';
    const esNuevaLetra = letra!==letraAnterior;
    if (esNuevaLetra){ letrasPresentes.add(letra); letraAnterior=letra; }

    const card=document.createElement('div');
    card.className='alumno-card';
    card.style.animationDelay=(idx*0.03)+'s';
    card.title='Ver el portal de '+u.nombre;
    if (esNuevaLetra) card.id='az_'+letra;
    card.innerHTML=`
      <div class="alumno-card-top">
        <div class="alumno-avatar">${u.fotoPerfil ? `<img src="${esc(u.fotoPerfil)}" alt="" loading="lazy">` : initials(u.nombre)}</div>
        <div style="flex:1;min-width:0;">
          <button class="alumno-name" onclick="event.stopPropagation();verComoAlumno('${u.id}')">${esc(u.nombre)}</button>
          ${u.telefono
            ? `<div><a class="alumno-tel" onclick="event.stopPropagation()" href="https://wa.me/${(u.telefono||'').replace(/\D/g,'')}?text=${encodeURIComponent('Hola '+u.nombre+', te escribimos desde la Academia Malevo 💃')}" target="_blank">📱 ${esc(u.telefono)}</a></div>`
            : '<div style="font-size:12px;color:var(--faint);margin-top:2px;">Sin teléfono</div>'}
          <div class="alumno-badges">
            <span class="alumno-badge">${PLANES[u.plan]||'—'}</span>
            <span class="alumno-status${u.active?' active':''}"><span class="dot"></span>${u.active?'Activo':'Inactivo'}</span>
            ${tipoBadges}
          </div>
        </div>
      </div>
      <div class="alumno-actions">
        <button class="alumno-action" onclick="event.stopPropagation();abrirModalAlumno('${u.id}')">✏ Editar</button>
        <button class="alumno-action" onclick="event.stopPropagation();abrirPago('${u.id}')">+ Pago</button>
        <button class="alumno-action" onclick="event.stopPropagation();archivarUsuario('${u.id}','${esc(u.nombre)}')" title="Archivar alumno (no elimina datos)">⬇ Archivar</button>
        <button class="alumno-action" onclick="event.stopPropagation();eliminarUsuarioDefinitivo('${u.id}','${esc(u.nombre)}')" title="Eliminar definitivamente — borrado permanente, no se puede deshacer" style="color:#ff6b6b;">🗑 Eliminar</button>
      </div>
      <button class="acc-toggle" onclick="event.stopPropagation();this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')" style="margin-top:12px;">
        <span class="chev">▾</span> Ver detalles
      </button>
      <div class="acc-body" onclick="event.stopPropagation()">
        <div class="alumno-acc-row"><span>Factura</span><span>${factLabel}</span></div>
        <div class="alumno-acc-row"><span>Niveles Bachata</span><span>${nivelesDisplay(u.nivelBachata)}</span></div>
        <div class="alumno-acc-row"><span>Niveles Salsa</span><span>${nivelesDisplay(u.nivelSalsa)}</span></div>
        <div class="alumno-acc-row"><span>Clases asignadas</span><span>${clasesTxt}</span></div>
      </div>`;
    card.addEventListener('click', () => verComoAlumno(u.id));
    grid.appendChild(card);
  });
  cont.innerHTML=''; cont.appendChild(grid);

  // ── Índice alfabético lateral A-Z ──
  const az=$('azIndex');
  if (az){
    az.innerHTML='';
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(L=>{
      const disponible=letrasPresentes.has(L);
      const b=document.createElement('button');
      b.textContent=L;
      b.className=disponible?'has':'';
      b.disabled=!disponible;
      if (disponible) b.onclick=()=>{ $('az_'+L)?.scrollIntoView({behavior:'smooth',block:'start'}); };
      az.appendChild(b);
    });
  }
}


/* ── Modal unificado: Alta / Editar alumno (contacto + plan + niveles + clases) ── */
/* ── Bloque de solo-lectura con el estado de la suscripción Stripe del
   alumno, para la ficha de edición del admin. Los datos ya vienen en el
   objeto de usuario cargado por /api/db (que solo omite passwordHash), así
   que no hace falta pedir nada al servidor. ── */
const MA_STRIPE_ESTADO_LABEL = {
  active:'Al día 🟢', trialing:'En periodo de prueba', past_due:'Pago pendiente ⚠️',
  en_deuda:'En deuda ⚠️', acceso_suspendido:'Acceso suspendido 🔴',
  pendiente_baja:'Baja programada', canceled:'Cancelada', incomplete:'Pago incompleto',
  unpaid:'Impagada', ninguno:'Sin suscripción activa'
};
function maFichaStripeHtml(u){
  const estado = u.subscriptionStatus || 'ninguno';
  const estadoTxt = MA_STRIPE_ESTADO_LABEL[estado] || estado;
  const tieneSuscripcion = !!u.stripeSubscriptionId;
  const meses = Number(u.permanenciaMesesRequeridos||0);
  let permanenciaCumplida = true;
  if (meses > 0 && u.permanenciaInicio) {
    const inicio = new Date(u.permanenciaInicio), ahora = new Date();
    const transcurridos = (ahora.getFullYear()-inicio.getFullYear())*12 + (ahora.getMonth()-inicio.getMonth());
    permanenciaCumplida = transcurridos >= meses;
  }
  const fact = u.facturacion || {};
  const factCompleta = !!(fact.nombreCompleto && fact.nifDniNie && fact.direccionFiscal);
  return `<div class="sect-lbl" style="margin-top:18px;">💳 Suscripción Stripe <span style="font-weight:400;color:var(--muted);font-size:10.5px;">(solo lectura — se gestiona desde el perfil del alumno)</span></div>
  <div style="padding:13px 15px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:var(--r);">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div style="font-size:13.5px;font-weight:700;">${esc(estadoTxt)}</div>
      ${tieneSuscripcion?`<span style="font-size:10.5px;color:var(--muted);">ID: ${esc(u.stripeSubscriptionId)}</span>`:''}
    </div>
    ${tieneSuscripcion && meses>0 ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;">Permanencia: ${meses} mes${meses===1?'':'es'} ${permanenciaCumplida?'(ya cumplida ✓)':'(todavía activa)'}</div>` : ''}
    <div style="font-size:12px;color:${factCompleta?'var(--muted)':'var(--warn)'};margin-top:6px;">
      ${factCompleta ? '✓ Datos fiscales completos' : '⚠️ Sin datos fiscales completos (nombre, NIF/DNI/NIE, dirección)'}
    </div>
  </div>`;
}

function abrirModalAlumno(id){
  const u   = id ? (db.users||[]).find(x=>x.id===id) : null;
  const plan = u?.plan||'35';
  const assigned = u?.assignedClasses||[];

  const DIAS_F = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const allCls = (db.classes||[]).sort((a,b)=>{
    const da=a.dia===0?7:a.dia, db_=b.dia===0?7:b.dia;
    return da-db_||(a.inicio||'').localeCompare(b.inicio||'');
  });

  const tel      = u?.telefono||'';

  // Grid de clases
  const clasesHtml = allCls.length ? allCls.map(c=>{
    const chk = assigned.includes(c.id);
    return `<label id="alClaseLbl_${c.id}" style="display:flex;align-items:center;gap:10px;padding:9px 12px;
      border-radius:8px;cursor:pointer;transition:all .15s;
      background:${chk?'rgba(226,144,35,.09)':'rgba(255,255,255,.03)'};
      border:1px solid ${chk?'rgba(226,144,35,.28)':'rgba(255,255,255,.07)'};"
      onmouseover="if(!this.querySelector('input').checked)this.style.borderColor='rgba(226,144,35,.2)'"
      onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='rgba(255,255,255,.07)'">
      <input type="checkbox" value="${c.id}" style="width:auto;accent-color:var(--gold);"
        ${chk?'checked':''} onchange="alToggleClase(this,'${c.id}')">
      <div style="width:3px;height:32px;border-radius:2px;background:${chk?'#E29023':'var(--card-border)'};flex:0 0 auto;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;">${esc(c.nombre)}</div>
        <div style="font-size:11px;color:var(--muted);">${DIAS_F[c.dia]||''} ${c.inicio}${c.fin?'–'+c.fin:''} · ${esc(c.estilo)}${c.nivelNum?' · N'+c.nivelNum:''}</div>
      </div>
    </label>`;
  }).join('')
  : '<p style="color:var(--muted);font-size:13px;">Sin clases creadas aún.</p>';

  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalAlumno';
  overlay.style.cssText='align-items:flex-start;padding:32px 16px;';

  overlay.innerHTML=`
  <div class="modal-box" style="max-width:640px;width:100%;">
  <h3 class="modal-title">${u?'✏️ Editar alumno':'➕ Nuevo alumno'}</h3>

  <!-- Datos de contacto -->
  <div class="sect-lbl">Datos de contacto</div>
  <label class="label-field">Nombre completo *</label>
  <input type="text" id="alNombre" value="${esc(u?.nombre||'')}" placeholder="Nombre y apellidos" style="font-size:15px;font-weight:600;">
  <div class="g2" style="margin-top:12px;">
    <div>
      <label class="label-field">📱 Teléfono (WhatsApp)</label>
      <input type="tel" id="alTel" value="${esc(tel)}" placeholder="600 000 000"
        style="font-size:15px;border-color:rgba(226,144,35,.35);border-width:2px;">
    </div>
    <div>
      <label class="label-field">Email</label>
      <input type="email" id="alEmail" value="${esc(u?.email||'')}" placeholder="correo@…">
    </div>
  </div>

  <!-- Plan y niveles -->
  <div class="sect-lbl" style="margin-top:18px;">Plan y niveles de baile</div>
  <div class="g2">
    <div>
      <label class="label-field">Plan / Tarifa</label>
      <select id="alPlan" style="font-size:13.5px;font-weight:600;" onchange="alAutoImporteCobro()">
        ${[['suelta','Clase suelta · 12€'],['35','1 clase/sem · 35€/mes'],['50','2 clases/sem · 50€/mes'],
           ['bono','Bono 5 clases · 50€'],['80','VIP / Full Pass · 80€/mes']]
          .map(([k,l])=>`<option value="${k}"${plan===k?' selected':''}>${l}</option>`).join('')}
      </select>
      <small style="color:var(--muted);font-size:11px;margin-top:4px;display:block;">Todos los planes incluyen acceso al Aula Virtual, excepto la clase suelta (12€).</small>
    </div>
    <div>
      <label class="label-field">Rol de baile</label>
      <select id="alRol">
        <option value="leader"${(u?.rol||'indiferente')==='leader'?' selected':''}>🕺 Leader</option>
        <option value="follower"${u?.rol==='follower'?' selected':''}>💃 Follower</option>
        <option value="indiferente"${(!u?.rol||u?.rol==='indiferente')?' selected':''}>🔄 Indiferente</option>
      </select>
    </div>
  </div>
  <div class="g2" style="margin-top:10px;">
    <div>
      <label class="label-field">Niveles Bachata</label>
      ${nivelCheckboxesHtml('alNivB', u?.nivelBachata)}
    </div>
    <div>
      <label class="label-field">Niveles Salsa</label>
      ${nivelCheckboxesHtml('alNivS', u?.nivelSalsa)}
    </div>
  </div>
  <p style="color:var(--muted);font-size:11px;margin-top:6px;">Marca todos los niveles/grupos a los que este alumno debe tener acceso (selección libre e independiente, por ejemplo Nivel 1 + Coreografías).</p>

  <!-- Clases asignadas -->
  <div class="sect-lbl" style="margin-top:18px;">
    📅 Clases asignadas
    <span id="alClaseCnt" style="margin-left:8px;color:var(--gold-2);font-weight:700;font-size:11px;">
      ${assigned.length?`(${assigned.length} asignada${assigned.length!==1?'s':''})`:''}</span>
  </div>
  <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">Marca los días y clases a los que asiste este alumno.</p>
  <div id="alClasesGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));
    gap:7px;max-height:260px;overflow-y:auto;padding:2px 2px 2px 0;">
    ${clasesHtml}
  </div>

  <!-- Facturación y accesos -->
  <div class="sect-lbl" style="margin-top:18px;">Facturación y accesos</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
    <label class="chk-card">
      <input type="checkbox" id="alCashOnly" style="width:auto;accent-color:var(--gold);"${u?.cashOnly?' checked':''}
        onchange="alToggleCobroManual()">
      <div><div style="font-size:13px;font-weight:600;">💵 Pago manual</div>
      <div style="font-size:11.5px;color:var(--muted);">Bizum, transferencia o efectivo</div></div>
    </label>
    <label class="chk-card">
      <input type="checkbox" id="alCourtesy" style="width:auto;accent-color:var(--amber);"${u?.guestCourtesy?' checked':''}
        onchange="actualizarContadorInvitados();alToggleCobroManual()">
      <div><div style="font-size:13px;font-weight:600;color:var(--amber);">♡ Invitado</div>
      <div style="font-size:11.5px;color:var(--muted);">Sin cobro<span id="contInvitados" style="display:none;color:var(--warn);font-weight:700;margin-left:4px;"></span></div></div>
    </label>
  </div>

  <!-- Registrar el cobro y generar factura correlativa en el mismo alta
       (solo para alumnos NUEVOS de pago manual, no invitados) — evita que
       el admin tenga que abrir aparte "Registrar pago" después. -->
  ${(!u) ? `
  <div id="alCobroManualWrap" style="display:none;background:rgba(226,144,35,.05);
    border:1px solid rgba(226,144,35,.18);border-radius:var(--r-sm);padding:14px;margin-bottom:10px;">
    <div style="font-size:12.5px;font-weight:600;color:var(--gold-2);margin-bottom:10px;">💶 Cobro recibido</div>
    <div class="g2">
      <div>
        <label class="label-field">Método</label>
        <select id="alMetodoCobro">
          <option value="Bizum">Bizum</option>
          <option value="Transferencia">Transferencia</option>
          <option value="Efectivo">Efectivo</option>
        </select>
      </div>
      <div>
        <label class="label-field">Importe cobrado (€)</label>
        <input type="number" id="alImporteCobro" step="0.01" placeholder="0.00">
      </div>
    </div>
    <p style="color:var(--muted);font-size:11px;margin-top:8px;">
      Al dar de alta se generará su factura correlativa automáticamente — podrás descargarla en PDF
      justo después, junto con su enlace de acceso.</p>
  </div>
  ` : ''}
  <label class="chk-card" style="margin-bottom:10px;">
    <input type="checkbox" id="alPortalAccess" style="width:auto;accent-color:var(--ok);"
      ${(u?.portalAccess||PORTAL_PLANS.includes(u?.plan||''))?' checked':''}>
    <div><div style="font-size:13px;font-weight:600;color:var(--ok);">🎓 Acceso al Aula Virtual</div>
    <div style="font-size:11.5px;color:var(--muted);">Activo aunque el plan no lo incluya</div></div>
  </label>
  <div style="display:flex;gap:8px;margin-bottom:10px;">
    ${[{v:'email',l:'📧 Email'},{v:'whatsapp',l:'💬 WhatsApp'},{v:'none',l:'— Sin envío'}].map(o=>
      `<label class="chk-card" style="flex:1;">
        <input type="radio" name="alFactura" value="${o.v}" style="width:auto;accent-color:var(--gold);"
          ${(u?.facturaEnvio||'none')===o.v?' checked':''}>
        ${o.l}
      </label>`).join('')}
  </div>
  <label style="display:flex;align-items:center;gap:10px;">
    <input type="checkbox" id="alActivo" style="width:auto;accent-color:var(--ok);"${u?.active!==false?' checked':''}>
    <span style="font-size:13.5px;color:var(--text-2);">Usuario activo</span>
  </label>

  <!-- Estado de suscripción Stripe (solo lectura, solo en edición y si no paga en efectivo) -->
  ${(u && !u.cashOnly) ? maFichaStripeHtml(u) : ''}

  <!-- Acceso directo al portal (solo edición, solo alumnos de pago manual:
       Bizum/Transferencia/Efectivo, agrupados bajo el flag cashOnly) -->
  ${(u && u.cashOnly) ? `
  <div class="sect-lbl" style="margin-top:18px;">🔗 Acceso directo al portal</div>
  <p style="color:var(--muted);font-size:12px;margin-bottom:10px;">
    Alumno de pago manual (Bizum, transferencia o efectivo) — genera un enlace directo a su
    portal para copiárselo y enviárselo tú mismo.
  </p>
  <button type="button" class="btn sec sm" onclick="abrirModalLinkPortal('${u.id}')">🔗 Generar enlace de acceso</button>
  ` : ''}

  <div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">
    <button class="btn sec" onclick="cerrarModal('modalAlumno')">Cancelar</button>
    <button class="btn" onclick="guardarAlumno('${u?.id||''}')">
      ${u?'Guardar cambios':'Dar de alta'}
    </button>
  </div>
  </div>`;

  playModal(); document.body.appendChild(overlay);
  actualizarContadorInvitados();
  alActualizarContadorClases();
}

/* ── Toggle visual clase en modal de edición ── */
function alToggleClase(input, classId){
  const lbl = document.getElementById('alClaseLbl_'+classId);
  if(!lbl) return;
  lbl.style.background   = input.checked ? 'rgba(226,144,35,.09)' : 'rgba(255,255,255,.03)';
  lbl.style.borderColor  = input.checked ? 'rgba(226,144,35,.28)' : 'rgba(255,255,255,.07)';
  alActualizarContadorClases();
}
function alActualizarContadorClases(){
  const n = document.querySelectorAll('#alClasesGrid input:checked').length;
  const el = $('alClaseCnt');
  if(el) el.textContent = n ? `(${n} asignada${n!==1?'s':''})` : '';
}

/* ── Eliminar definitivamente (borrado permanente, no recuperable) ──
   A diferencia de archivarUsuario (desactiva y conserva todo el
   historial), esto borra el registro por completo, junto con sus
   inscripciones/asistencias/pagos huérfanos. Pensado para cuentas de
   prueba o duplicadas — para un alumno real con historial, usar
   "Archivar" en su lugar. Doble confirmación por ser irreversible. */
async function eliminarUsuarioDefinitivo(id, nombre){
  if(!confirm(`¿Eliminar DEFINITIVAMENTE a "${nombre}"?\n\nEsto borra el usuario y todo su historial de forma permanente — no se puede deshacer. Si es un alumno real, usa "Archivar" en su lugar para conservar sus datos.`)) return;
  if(!confirm(`Última confirmación: "${nombre}" se borrará para siempre. ¿Continuar?`)) return;
  try {
    await apiJSON('DELETE',`/api/users/${id}`);
    await cargarDB(); renderView('alumnos');
    showToast(`${nombre} eliminado definitivamente.`,'ok');
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

/* ── Archivar alumno (en lugar de eliminar) ── */
async function archivarUsuario(id, nombre){
  if(!confirm(`¿Archivar a ${nombre}?\n\nSe marcará como Inactivo. Su historial de pagos e inscripciones se conserva intacto. Puedes reactivarlo en cualquier momento desde Editar.`)) return;
  try {
    const u = (db.users||[]).find(x=>x.id===id);
    if(!u) return;
    await apiJSON('PUT',`/api/users/${id}`,{
      nombre:u.nombre, telefono:u.telefono||'', email:u.email||'',
      role:'student', plan:u.plan, active:false,
      cashOnly:u.cashOnly||false, guestCourtesy:u.guestCourtesy||false,
      portalAccess:u.portalAccess||false, facturaEnvio:u.facturaEnvio||'none'
    });
    await cargarDB(); renderView('alumnos');
    showToast(`${nombre} archivado. Sus datos se conservan intactos.`,'ok');
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

/* ── Contador de invitados de cortesía (máx 5) ── */
function actualizarContadorInvitados(){
  const chk = $('alCourtesy');
  const span = $('contInvitados');
  if(!chk || !span) return;
  const totalActual = (db.users||[]).filter(u=>u.guestCourtesy).length;
  if(chk.checked){
    const limite = 5;
    if(totalActual >= limite){
      span.textContent = ' (límite '+limite+' alcanzado)';
      span.style.display='inline';
      chk.checked = false;
      showToast('Límite de '+limite+' invitados de cortesía alcanzado.','warn');
    } else {
      span.textContent = ' ('+totalActual+'/'+limite+')';
      span.style.display='inline';
    }
  } else {
    span.style.display='none';
  }
}

/* ── Muestra/oculta el bloque "Cobro recibido" del alta manual según el
   estado de Pago manual / Invitado, y autocompleta el importe con el
   precio del plan elegido al mostrarlo. ── */
function alToggleCobroManual(){
  const wrap = document.getElementById('alCobroManualWrap');
  if (!wrap) return; // no existe en el modal de edición, solo en alta nueva
  const cash = document.getElementById('alCashOnly')?.checked;
  const inv  = document.getElementById('alCourtesy')?.checked;
  const mostrar = !!cash && !inv;
  wrap.style.display = mostrar ? 'block' : 'none';
  if (mostrar) alAutoImporteCobro();
}

function alAutoImporteCobro(){
  const plan = document.getElementById('alPlan')?.value;
  const imp  = document.getElementById('alImporteCobro');
  if (!imp || imp.value) return; // no pisar un importe que el admin ya haya tocado
  const precio = plan && db.config.precios?.[plan];
  if (precio != null && precio > 0) imp.value = precio;
}

async function guardarAlumno(id){
  const nombre=$('alNombre').value.trim();
  const tel=$('alTel').value.trim();
  if(!nombre){ showToast('El nombre es obligatorio.','warn'); return; }

  const facturaEnvio=document.querySelector('input[name="alFactura"]:checked')?.value||'none';
  const esInvitado = $('alCourtesy').checked;
  const plan = $('alPlan').value;
  const rol  = $('alRol')?.value || 'indiferente';
  const nivelBachata = leerNivelCheckboxes('alNivB');
  const nivelSalsa   = leerNivelCheckboxes('alNivS');

  // Recoger clases marcadas en el modal fusionado
  const classIds = [...document.querySelectorAll('#alClasesGrid input[type=checkbox]:checked')]
    .map(i => i.value);

  if(esInvitado && !id){
    const totalInvitados = (db.users||[]).filter(u=>u.guestCourtesy).length;
    if(totalInvitados >= 5){ showToast('Límite de 5 invitados de cortesía alcanzado.','warn'); return; }
  }

  const data={
    nombre, telefono:tel, email:$('alEmail').value.trim(),
    role:'student', plan, active:$('alActivo').checked,
    cashOnly:$('alCashOnly').checked, guestCourtesy:esInvitado,
    portalAccess:$('alPortalAccess').checked, facturaEnvio,
  };

  try {
    let userId = id;
    if(id){
      await apiJSON('PUT',`/api/users/${id}`,data);
    } else {
      const res = await apiJSON('POST','/api/users',data);
      userId = res.user?.id || res.id;
    }
    // Guardar clases + niveles + rol si tenemos userId
    if(userId && classIds !== undefined){
      await apiJSON('PUT',`/api/users/${userId}/classes`,{
        classIds, plan, nivelBachata, nivelSalsa, rol
      });
      // Sincronizar inscripciones (selección libre e independiente por nivel):
      // se envía el conjunto EXACTO marcado; los niveles no marcados quedan revocados.
      await apiJSON('POST','/api/enrollments',{userId,disciplina:'Bachata',niveles:nivelBachata}).catch(()=>{});
      await apiJSON('POST','/api/enrollments',{userId,disciplina:'Salsa',niveles:nivelSalsa}).catch(()=>{});
    }
    // Alta manual nueva con pago fuera de Stripe (Bizum/transferencia/
    // efectivo): registrar el cobro ahí mismo genera su factura
    // correlativa (numeroTicket), sin que el admin tenga que abrir aparte
    // "Registrar pago" después. Solo aplica a altas nuevas, no invitados,
    // y con un importe realmente introducido.
    let pagoId = null;
    if (!id && userId && data.cashOnly && !esInvitado) {
      const importeCobro = parseFloat($('alImporteCobro')?.value);
      if (!isNaN(importeCobro) && importeCobro > 0) {
        try {
          const resPago = await apiJSON('POST','/api/payments',{
            userId, mes: mesActual(), fechaPago: hoy(),
            importe: importeCobro, metodo: $('alMetodoCobro')?.value || 'Bizum',
            notas: `Alta manual · plan ${plan}`
          });
          pagoId = resPago.payment?.id || null;
        } catch(e) { showToast('Alumno creado, pero la factura no se pudo generar: '+e.message, 'warn'); }
      }
    }

    cerrarModal('modalAlumno');
    await cargarDB();
    renderView('alumnos');
    confirmSave(id ? 'Alumno actualizado' : 'Alumno dado de alta');
    // En vez de obligar al admin a volver a abrir "Editar" para conseguir
    // el enlace y la factura, se los mostramos aquí mismo, recién creada
    // la cuenta.
    if (!id && data.cashOnly && userId) abrirModalLinkPortal(userId, pagoId);
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

async function borrarUsuario(id){
  const u=(db.users||[]).find(x=>x.id===id);
  if(!confirm(`¿Eliminar a "${u?.nombre}"? Se borrarán también sus inscripciones y pagos.`)) return;
  db.users=db.users.filter(x=>x.id!==id);
  db.enrollments=(db.enrollments||[]).filter(e=>e.userId!==id);
  db.payments=(db.payments||[]).filter(p=>p.userId!==id);
  db.attendances=(db.attendances||[]).filter(a=>a.userId!==id);
  db._rev++;
  guardar(); renderView('alumnos');
}

/* ── Modal Configuración completa del alumno (admin) ── */
function abrirConfigAlumno(userId){
  const u=(db.users||[]).find(x=>x.id===userId);
  if(!u) return;
  const DIAS_F=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const allCls=(db.classes||[]).sort((a,b)=>{
    const da=a.dia===0?7:a.dia, db_=b.dia===0?7:b.dia;
    return da-db_||(a.inicio||'').localeCompare(b.inicio||'');
  });
  const assigned=u.assignedClasses||[];
  // Nota: el acceso a Cursos Exclusivos ya NO se otorga desde acá — el único
  // lugar donde se asigna es en "Editar curso" (Multimedia → Cursos
  // Exclusivos), donde el admin tilda qué alumnos (activos o inactivos)
  // desbloquean ese curso puntual. Ver abrirModalCurso/guardarCurso.

  // Construir opciones de plan
  const planOpts=[
    {k:'suelta',l:'Clase suelta · 12 EUR'},
    {k:'35',    l:'1 clase/sem · 35 EUR'},
    {k:'50',    l:'2 clases/sem · 50 EUR'},
    {k:'bono',  l:'Bono 5 clases · 50 EUR'},
    {k:'80',    l:'VIP / Full Pass · 80 EUR'}
  ].map(p=>'<option value="'+p.k+'"'+(u.plan===p.k?' selected':'')+'>'+p.l+'</option>').join('');

  // Opciones de rol
  const rolOpts=
    '<option value="leader"'+(u.rol==='leader'?' selected':'')+'>Leader</option>'+
    '<option value="follower"'+(u.rol==='follower'?' selected':'')+'>Follower</option>'+
    '<option value="indiferente"'+((u.rol||'indiferente')==='indiferente'?' selected':'')+'>Indiferente</option>';


  // Grid de clases
  let clasesHtml='';
  if(!allCls.length){
    clasesHtml='<p style="color:var(--muted);font-size:13px;">Sin clases. Créalas en Clases.</p>';
  } else {
    allCls.forEach(function(c){
      const chk=assigned.includes(c.id);
      const bg   = chk ? 'rgba(226,144,35,.09)' : 'rgba(255,255,255,.03)';
      const bord = chk ? 'rgba(226,144,35,.28)' : 'rgba(255,255,255,.08)';
      const dia  = DIAS_F[c.dia]||'';
      const hora = c.inicio+(c.fin?'–'+c.fin:'');
      const disc = esc(c.estilo)+(c.nivelNum?' · Nivel '+c.nivelNum:'');
      clasesHtml+=
        '<label id="caClaseLbl_'+c.id+'" class="ca-clase-lbl" data-chk="'+chk+'" '+
          'style="display:flex;align-items:center;gap:12px;padding:10px 14px;'+
          'border-radius:var(--r-sm);cursor:pointer;'+
          'background:'+bg+';border:1px solid '+bord+';">'+
          '<input type="checkbox" value="'+c.id+'" style="width:auto;accent-color:var(--gold);"'+
            (chk?' checked':'')+' onchange="toggleCaClase(this,\''+c.id+'\')">'+
          '<div style="width:4px;height:36px;border-radius:2px;background:'+(chk?'#E29023':'var(--card-border)')+';flex:0 0 auto;"></div>'+
          '<div style="flex:1;">'+
            '<div style="font-size:13.5px;font-weight:600;">'+esc(c.nombre)+'</div>'+
            '<div style="font-size:11.5px;color:var(--muted);">'+dia+' '+hora+' · '+disc+'</div>'+
          '</div>'+
        '</label>';
    });
  }

  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalConfigAlumno';
  overlay.innerHTML=
    '<div class="modal-box" style="max-width:640px;">'+
    '<h3 class="modal-title">⚙ Configurar alumno</h3>'+
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;padding:14px 16px;'+
      'background:rgba(226,144,35,.07);border:1px solid rgba(226,144,35,.18);border-radius:var(--r);">'+
      '<div style="width:42px;height:42px;border-radius:12px;flex:0 0 auto;'+
        'background:linear-gradient(135deg,rgba(226,144,35,.3),rgba(138,112,0,.2));'+
        'display:flex;align-items:center;justify-content:center;font-size:18px;">👤</div>'+
      '<div>'+
        '<div style="font-weight:700;font-size:15px;">'+esc(u.nombre)+'</div>'+
        '<div style="font-size:12px;color:var(--muted);">@'+esc(u.username)+' · '+(ROLES_LABEL[u.role]||u.role)+'</div>'+
      '</div>'+
    '</div>'+
    '<div class="sect-lbl">Tarifa y niveles de baile</div>'+
    '<div class="g2" style="margin-bottom:18px;">'+
      '<div><label class="label-field">Plan / Tarifa</label>'+
        '<select id="caPlan">'+planOpts+'</select></div>'+
      '<div><label class="label-field">Rol de baile</label>'+
        '<select id="caRol">'+rolOpts+'</select></div>'+
    '</div>'+
    '<div class="g2" style="margin-bottom:20px;">'+
      '<div><label class="label-field">Niveles Bachata</label>'+nivelCheckboxesHtml('caNivB',u.nivelBachata)+'</div>'+
      '<div><label class="label-field">Niveles Salsa</label>'+nivelCheckboxesHtml('caNivS',u.nivelSalsa)+'</div>'+
    '</div>'+
    '<div class="sect-lbl">Días y clases asignados</div>'+
    '<p style="color:var(--muted);font-size:12.5px;margin-bottom:12px;">'+
      'Marca las clases a las que asistirá. Aparecerán en su agenda.</p>'+
    '<div id="caClasesGrid" style="display:flex;flex-direction:column;gap:8px;'+
      'max-height:280px;overflow-y:auto;padding-right:4px;">'+
      clasesHtml+
    '</div>'+
    '<div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">'+
      '<button class="btn sec" onclick="cerrarModal(\'modalConfigAlumno\')">Cancelar</button>'+
      '<button class="btn ok" onclick="guardarConfigAlumno(\''+userId+'\')">✓ Guardar</button>'+
    '</div>'+
    '</div>';

  playModal(); document.body.appendChild(overlay);
}
function toggleCaClase(inp, classId){
  const lbl=document.getElementById('caClaseLbl_'+classId);
  if(!lbl) return;
  lbl.style.background=inp.checked?'rgba(226,144,35,.09)':'rgba(255,255,255,.03)';
  lbl.style.borderColor=inp.checked?'rgba(226,144,35,.28)':'rgba(255,255,255,.08)';
}

async function guardarConfigAlumno(userId){
  const classIds=[...document.querySelectorAll('#caClasesGrid input[type=checkbox]:checked')].map(i=>i.value);
  const plan=$('caPlan').value;
  const rol=$('caRol').value;
  const nivelBachata=leerNivelCheckboxes('caNivB');
  const nivelSalsa=leerNivelCheckboxes('caNivS');
  try {
    // 1. Guardar clases asignadas + plan + rol + niveles via ruta dedicada
    await apiJSON('PUT',`/api/users/${userId}/classes`,{classIds,plan,nivelBachata,nivelSalsa,rol});
    // 2. También actualizar en el objeto local para reflejo inmediato
    const u=(db.users||[]).find(x=>x.id===userId);
    if(u){
      u.assignedClasses=classIds; u.plan=plan; u.rol=rol;
      u.nivelBachata=nivelBachata; u.nivelSalsa=nivelSalsa;
    }
    // 3. Sincronizar inscripciones: selección libre e independiente por nivel
    await apiJSON('POST','/api/enrollments',{userId,disciplina:'Bachata',niveles:nivelBachata}).catch(()=>{});
    await apiJSON('POST','/api/enrollments',{userId,disciplina:'Salsa',niveles:nivelSalsa}).catch(()=>{});
    cerrarModal('modalConfigAlumno');
    await cargarDB(); renderView('alumnos');
    confirmSave('Alumno configurado correctamente');
  } catch(e){ showToast('Error al guardar: '+e.message,'warn'); }
}

/* ══════════════════════════════════════════════
   VER COMO ALUMNO — Vista previa del portal
   desde la perspectiva de un alumno específico
══════════════════════════════════════════════ */
function verComoAlumno(userId){
  const u = (db.users||[]).find(x => x.id === userId);
  if (!u) return;

  // Clases asignadas al alumno
  const clasesDelAlumno = (u.assignedClasses||[])
    .map(cid => (db.classes||[]).find(c => c.id === cid))
    .filter(Boolean)
    .sort((a,b) => { const da = a.dia===0?7:a.dia, db_ = b.dia===0?7:b.dia; return da-db_||(a.inicio||'').localeCompare(b.inicio||''); });

  const DIAS_FULL_L  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const DIAS_CORTO_L = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const tieneVideos  = u.plan === '80' || u.portalAccess === true;
  const planNombre   = {'suelta':'Clase suelta','35':'1 clase/semana','50':'2 clases/semana','80':'VIP · Full Pass','bono':'Bono 5 clases'}[u.plan] || '—';

  // Hora y saludo
  const hora = new Date().getHours();
  const saludo = hora < 13 ? '¡Buenos días' : hora < 20 ? '¡Buenas tardes' : '¡Buenas noches';
  const primerNombre = (u.nombre||'').split(' ')[0] || 'alumno';
  const hoyNum  = new Date().getDay();
  const manaNum = (hoyNum + 1) % 7;
  const clasesHoy  = clasesDelAlumno.filter(c => (c.dia ?? 0) === hoyNum);
  const clasesMana = clasesDelAlumno.filter(c => (c.dia ?? 0) === manaNum);

  function chipClase(c){
    return `<div style="background:var(--card-bg);border:1px solid var(--card-border);
      border-radius:8px;padding:9px 12px;margin-bottom:7px;">
      <div style="font-size:11px;color:var(--text-2);font-weight:700;">${c.inicio||''}${c.fin?' – '+c.fin:''}</div>
      <div style="font-size:13px;font-weight:600;margin-top:2px;">${esc(c.nombre)}</div>
      <div style="font-size:11px;color:var(--muted);">${esc(c.estilo)}${c.nivelNum?' · Nivel '+c.nivelNum:''}</div>
    </div>`;
  }
  function bloqueHorario(lista, etiqueta){
    if(!lista.length) return `<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px 0;
      border:1px dashed rgba(226,144,35,.1);border-radius:8px;">Sin clases ${etiqueta.toLowerCase()}</div>`;
    return lista.map(chipClase).join('');
  }

  // Generar tabla de agenda semanal compacta
  function tablaAgenda(){
    if(!clasesDelAlumno.length) return `<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px;">
      Sin clases asignadas todavía.</div>`;
    const porDia = {};
    clasesDelAlumno.forEach(c => { const d = c.dia??0; if(!porDia[d]) porDia[d]=[]; porDia[d].push(c); });
    const diasCon = [1,2,3,4,5,6,0].filter(d => porDia[d]);
    return diasCon.map(d => {
      const cls = porDia[d].sort((a,b) => (a.inicio||'').localeCompare(b.inicio||''));
      return `<div style="margin-bottom:10px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);
          font-weight:600;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(226,144,35,.1);">
          ${DIAS_FULL_L[d]}
        </div>
        ${cls.map(chipClase).join('')}
      </div>`;
    }).join('');
  }

  // Sección de vídeos: previsualización (sin reproducción real)
  function seccionVideos(){
    if(!tieneVideos) return `<div style="text-align:center;padding:28px;background:rgba(255,255,255,.02);
      border:1px dashed rgba(226,144,35,.15);border-radius:12px;">
      <div style="font-size:32px;margin-bottom:10px;">🔒</div>
      <div style="font-size:13.5px;font-weight:600;color:var(--gold-2);margin-bottom:6px;">Aula Virtual no activa</div>
      <div style="font-size:12.5px;color:var(--muted);">Este alumno no tiene plan VIP.<br>
        Cambia su plan a <strong>VIP · Full Pass</strong> para activar el acceso.</div>
    </div>`;
    const videos = (db.videos||[]);
    if(!videos.length) return `<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px;">
      Sin vídeos cargados en el sistema todavía.</div>`;
    const disciplinas = [...new Set(videos.map(v => v.disciplina))];
    return disciplinas.map(disc => {
      const porNivel = {};
      videos.filter(v => v.disciplina === disc).forEach(v => {
        if(!porNivel[v.nivel]) porNivel[v.nivel] = [];
        porNivel[v.nivel].push(v);
      });
      return `<div style="margin-bottom:18px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);
          font-weight:700;margin-bottom:10px;">${esc(disc)}</div>
        ${Object.entries(porNivel).sort(([a],[b]) => +a - +b).map(([nivel, vids]) => `
          <div style="margin-bottom:12px;">
            <div style="font-size:11.5px;color:var(--gold-2);font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              <span style="background:rgba(226,144,35,.15);border:1px solid rgba(226,144,35,.25);
                padding:2px 10px;border-radius:20px;">${nivelLabel(+nivel)}</span>
              <span style="color:var(--muted);font-weight:400;">${vids.length} clase${vids.length!==1?'s':''}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${vids.sort((a,b)=>a.orden-b.orden).map(v => `
                <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                  background:rgba(255,255,255,.03);border:1px solid rgba(226,144,35,.1);border-radius:8px;">
                  <div style="width:26px;height:26px;border-radius:7px;
                    background:rgba(226,144,35,.12);border:1px solid rgba(226,144,35,.22);
                    display:flex;align-items:center;justify-content:center;
                    font-size:10px;font-weight:700;color:var(--gold-2);flex:0 0 auto;">${v.orden||'▶'}</div>
                  <div style="flex:1;font-size:13px;font-weight:500;">${esc(v.titulo)}</div>
                  <span style="font-size:10.5px;color:var(--muted);">▶ Vídeo</span>
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>`;
    }).join('');
  }

  // Construir el modal completo
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'modalVerAlumno';
  overlay.style.cssText = 'align-items:flex-start;padding:0;overflow-y:auto;';

  overlay.innerHTML = `
  <div style="width:100%;min-height:100%;display:flex;flex-direction:column;">

    <!-- ── Barra de contexto admin (siempre visible) ── -->
    <div id="barraContextoAdmin" style="
      position:sticky;top:0;z-index:10;
      background:rgba(12,10,2,.97);
      backdrop-filter:blur(24px);
      border-bottom:2px solid rgba(226,144,35,.35);
      padding:12px 28px;
      display:flex;align-items:center;justify-content:space-between;gap:16px;
      box-shadow:0 4px 20px rgba(0,0,0,.7);">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="background:linear-gradient(135deg,rgba(226,144,35,.25),rgba(138,112,0,.15));
          border:1px solid rgba(226,144,35,.4);border-radius:10px;
          padding:6px 14px;font-size:11.5px;font-weight:700;color:var(--gold-2);
          letter-spacing:.5px;white-space:nowrap;">
          👁 VISTA PREVIA · ADMIN
        </div>
        <div>
          <div style="font-size:14px;font-weight:700;">${esc(u.nombre)}</div>
          <div style="font-size:11px;color:var(--muted);">@${esc(u.username)} · Plan: ${esc(planNombre)}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="cerrarModal('modalVerAlumno');abrirConfigAlumno('${u.id}')"
          style="background:linear-gradient(135deg,rgba(226,144,35,.18),rgba(138,112,0,.12));
            border:1px solid rgba(226,144,35,.32);color:var(--gold-2);
            padding:7px 16px;border-radius:8px;cursor:pointer;font-size:12.5px;
            font-family:inherit;font-weight:600;transition:all .2s;white-space:nowrap;">
          ⚙ Editar alumno
        </button>
        <button onclick="cerrarModal('modalVerAlumno')"
          style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
            color:var(--muted);padding:7px 16px;border-radius:8px;cursor:pointer;
            font-size:12.5px;font-family:inherit;transition:all .2s;">
          × Cerrar
        </button>
      </div>
    </div>

    <!-- ── Contenido del portal simulado ── -->
    <div style="flex:1;padding:32px 28px;max-width:1060px;margin:0 auto;width:100%;">

      <!-- Hero bienvenida (como lo ve el alumno) -->
      <div style="
        background:linear-gradient(135deg,rgba(226,144,35,.1),rgba(138,112,0,.07) 60%,rgba(255,255,255,.02));
        border:1px solid rgba(226,144,35,.22);border-radius:22px;
        padding:32px 36px;margin-bottom:24px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:-50px;right:-50px;width:180px;height:180px;border-radius:50%;
          background:radial-gradient(circle,rgba(226,144,35,.12),transparent 70%);pointer-events:none;"></div>
        <h2 style="font-family:'Sora',sans-serif;font-size:22px;font-weight:700;
          color:var(--gold-light);letter-spacing:-.3px;margin-bottom:6px;">
          ${saludo}, ${esc(primerNombre)}! 👋</h2>
        <p style="color:var(--text-2);font-size:13.5px;line-height:1.6;">
          Bienvenido a tu espacio en la Academia Malevo.<br>
          Aquí tienes todo lo que necesitas para tu práctica.</p>
        <div style="display:inline-flex;align-items:center;gap:8px;margin-top:14px;
          padding:5px 16px;border-radius:30px;font-size:11.5px;font-weight:600;
          background:rgba(226,144,35,.14);border:1px solid rgba(226,144,35,.28);color:var(--gold-2);">
          🎓 ${esc(planNombre)}
          ${tieneVideos ? '&nbsp;·&nbsp;<span style="color:var(--ok);">✓ Aula Virtual activa</span>' : ''}
        </div>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px;">
        ${[
          {n: clasesDelAlumno.length, l:'Clases activas'},
          {n: nivelesDisplayFull(u.nivelBachata), l:'Bachata', col: nivelesArr(u.nivelBachata).length?'var(--gold-2)':'', small:true},
          {n: nivelesDisplayFull(u.nivelSalsa),   l:'Salsa',   col: nivelesArr(u.nivelSalsa).length?'var(--gold-2)':'', small:true},
          {n: u.rol==='leader'?'🕺':u.rol==='follower'?'💃':'🔄', l: u.rol==='leader'?'Leader':u.rol==='follower'?'Follower':'Indistinto'}
        ].map(s=>`
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(226,144,35,.14);
            border-radius:14px;padding:16px;text-align:center;">
            <div style="font-family:'Sora',sans-serif;font-size:${s.small?'14px':'24px'};font-weight:800;
              ${s.small?'line-height:1.35;':''}${s.col?'color:'+s.col+';':''}">${s.n}</div>
            <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;
              letter-spacing:1px;margin-top:4px;">${s.l}</div>
          </div>`).join('')}
      </div>

      <!-- Grid principal: Agenda + Vídeos -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">

        <!-- Clases hoy / mañana -->
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);
          border-radius:18px;padding:22px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--muted);
            font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px;">
            <span style="width:3px;height:12px;border-radius:2px;background:linear-gradient(var(--gold),var(--accent-deep));display:inline-block;"></span>
            Esta semana
          </div>
          <div style="margin-bottom:14px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;
              color:${clasesHoy.length?'var(--gold-2)':'var(--muted)'};font-weight:600;margin-bottom:7px;">
              ${clasesHoy.length?'● ':''} HOY — ${DIAS_FULL_L[hoyNum]}
            </div>
            ${bloqueHorario(clasesHoy, 'Hoy')}
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;
              color:var(--muted);font-weight:600;margin-bottom:7px;">
              MAÑANA — ${DIAS_FULL_L[manaNum]}
            </div>
            ${bloqueHorario(clasesMana, 'Mañana')}
          </div>
        </div>

        <!-- Aula virtual -->
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);
          border-radius:18px;padding:22px;overflow-y:auto;max-height:420px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--muted);
            font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px;">
            <span style="width:3px;height:12px;border-radius:2px;background:linear-gradient(var(--gold),var(--accent-deep));display:inline-block;"></span>
            Aula virtual · Mis vídeos
          </div>
          ${seccionVideos()}
        </div>
      </div>

      <!-- Agenda semanal completa -->
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);
        border-radius:18px;padding:22px;margin-bottom:24px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--muted);
          font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:6px;">
          <span style="width:3px;height:12px;border-radius:2px;background:linear-gradient(var(--gold),var(--accent-deep));display:inline-block;"></span>
          Agenda semanal completa
        </div>
        ${tablaAgenda()}
      </div>

      <!-- Panel de edición rápida (exclusivo para admin) -->
      <div style="background:rgba(226,144,35,.05);border:1px solid rgba(226,144,35,.2);
        border-radius:18px;padding:22px;margin-bottom:12px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--gold-2);
          font-weight:700;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
          <span style="display:flex;align-items:center;gap:6px;">
            <span style="width:3px;height:12px;border-radius:2px;background:var(--gold);display:inline-block;"></span>
            Edición rápida · Solo visible para el administrador
          </span>
          <span style="font-size:10px;color:var(--muted);font-weight:400;letter-spacing:.3px;">Los cambios aplican inmediatamente</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:16px;">
          <div>
            <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.7px;">Plan / Tarifa</label>
            <select id="vca_plan_${u.id}" style="font-size:13px;font-weight:600;">
              ${[['suelta','Clase suelta'],['35','1 clase/sem · 35€'],['50','2 clases/sem · 50€'],['bono','Bono 5 · 50€'],['80','VIP Full Pass · 80€']]
                .map(([k,l])=>`<option value="${k}"${u.plan===k?' selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.7px;">Niveles Bachata</label>
            ${nivelCheckboxesHtml('vca_bach_'+u.id, u.nivelBachata)}
          </div>
          <div>
            <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.7px;">Niveles Salsa</label>
            ${nivelCheckboxesHtml('vca_sals_'+u.id, u.nivelSalsa)}
          </div>
          <div>
            <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.7px;">Rol de baile</label>
            <select id="vca_rol_${u.id}">
              <option value="leader"${u.rol==='leader'?' selected':''}>Leader</option>
              <option value="follower"${u.rol==='follower'?' selected':''}>Follower</option>
              <option value="indiferente"${(!u.rol||u.rol==='indiferente')?' selected':''}>Indiferente</option>
            </select>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="vca_portal_${u.id}" style="width:auto;accent-color:var(--ok);"
              ${(u.portalAccess||u.plan==='80')?' checked':''}>
            <span style="font-size:13px;color:var(--text-2);">🎓 Acceso Aula Virtual</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="vca_activo_${u.id}" style="width:auto;accent-color:var(--ok);"
              ${u.active!==false?' checked':''}>
            <span style="font-size:13px;color:var(--text-2);">✓ Usuario activo</span>
          </label>
          <button onclick="guardarEdicionRapida('${u.id}')"
            style="margin-left:auto;background:linear-gradient(135deg,var(--gold),var(--accent-deep));
              color:#0a0a0a;border:none;padding:9px 22px;border-radius:9px;cursor:pointer;
              font-size:13px;font-weight:700;font-family:inherit;transition:all .2s;
              box-shadow:0 4px 14px rgba(0,0,0,.4);">
            ✓ Guardar cambios
          </button>
        </div>
      </div>

    </div>
  </div>`;

  playModal(); document.body.appendChild(overlay);
}

/* ── Guardar cambios desde la vista previa del alumno ── */
async function guardarEdicionRapida(userId){
  const u = (db.users||[]).find(x => x.id === userId);
  if (!u) return;
  const plan         = document.getElementById('vca_plan_'+userId)?.value || u.plan;
  const nivelBachata = leerNivelCheckboxes('vca_bach_'+userId);
  const nivelSalsa   = leerNivelCheckboxes('vca_sals_'+userId);
  const rol          = document.getElementById('vca_rol_'+userId)?.value  || 'indiferente';
  const portalAccess = document.getElementById('vca_portal_'+userId)?.checked ?? false;
  const active       = document.getElementById('vca_activo_'+userId)?.checked ?? true;

  try {
    // Guardar plan, niveles y rol vía ruta de clases (mantiene clases asignadas)
    await apiJSON('PUT', `/api/users/${userId}/classes`, {
      classIds: u.assignedClasses || [],
      plan, nivelBachata, nivelSalsa, rol
    });
    // Guardar estado activo y acceso portal
    await apiJSON('PUT', `/api/users/${userId}`, {
      nombre: u.nombre, telefono: u.telefono||'', email: u.email||'',
      role: 'student', plan, active, portalAccess,
      cashOnly: u.cashOnly||false, guestCourtesy: u.guestCourtesy||false,
      facturaEnvio: u.facturaEnvio||'none'
    });
    // Sincronizar inscripciones: selección libre e independiente por nivel
    await apiJSON('POST','/api/enrollments',{userId,disciplina:'Bachata',niveles:nivelBachata}).catch(()=>{});
    await apiJSON('POST','/api/enrollments',{userId,disciplina:'Salsa',niveles:nivelSalsa}).catch(()=>{});
    // Reflejar en objeto local
    Object.assign(u, { plan, nivelBachata, nivelSalsa, rol, active, portalAccess });
    await cargarDB();
    cerrarModal('modalVerAlumno');
    renderView('alumnos');
    confirmSave('Cambios guardados correctamente');
  } catch(e){ showToast('Error al guardar: '+e.message,'warn'); }
}

function abrirModalInscripcion(userId){
  const u=(db.users||[]).find(x=>x.id===userId);
  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalInscrip';
  overlay.innerHTML=
    '<div class="modal-box">'+
    '<h3 class="modal-title">Inscribir a '+esc(u&&u.nombre||'')+'</h3>'+
    '<p style="color:var(--muted);font-size:13px;margin-bottom:18px;">'+
      'Marca los niveles/grupos a los que este alumno debe tener acceso. Selección libre e independiente '+
      '(por ejemplo, puedes marcar solo Nivel 1 y Coreografías).</p>'+
    '<label class="label-field">Niveles Bachata</label>'+
    nivelCheckboxesHtml('inscB', u&&u.nivelBachata)+
    '<label class="label-field" style="margin-top:14px;">Niveles Salsa</label>'+
    nivelCheckboxesHtml('inscS', u&&u.nivelSalsa)+
    '<div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">'+
      '<button class="btn sec" onclick="cerrarModal(&quot;modalInscrip&quot;)">Cancelar</button>'+
      '<button class="btn" onclick="guardarInscripcion(&quot;'+userId+'&quot;)">Guardar acceso</button>'+
    '</div>'+
    '</div>';
  playModal(); document.body.appendChild(overlay);
}

async function guardarInscripcion(userId){
  const nivelBachata = leerNivelCheckboxes('inscB');
  const nivelSalsa   = leerNivelCheckboxes('inscS');
  try {
    await apiJSON('POST','/api/enrollments',{userId,disciplina:'Bachata',niveles:nivelBachata});
    await apiJSON('POST','/api/enrollments',{userId,disciplina:'Salsa',niveles:nivelSalsa});
    // Reflejar también en el registro del alumno para que el resto de vistas lo muestren
    await apiJSON('PUT',`/api/users/${userId}/classes`,{
      classIds:(db.users||[]).find(x=>x.id===userId)?.assignedClasses||[],
      plan:(db.users||[]).find(x=>x.id===userId)?.plan, nivelBachata, nivelSalsa,
      rol:(db.users||[]).find(x=>x.id===userId)?.rol||'indiferente'
    }).catch(()=>{});
    cerrarModal('modalInscrip');
    await cargarDB(); renderView('alumnos');
    confirmSave('Acceso actualizado correctamente');
  } catch(e){ alert('Error: '+e.message); }
}

/* ── Vista CLASES ── */
function renderClases(cont){
  const isAdmin = currentUser.role==='admin';
  const totalClases = (db.classes||[]).length;
  cont.innerHTML=`<div class="section-head">
    <div>
      <div class="h2" style="margin-bottom:4px;">▦ Clases</div>
      <div style="font-size:12.5px;color:var(--muted);">Calendario semanal · ${totalClases} clase${totalClases!==1?'s':''}</div>
    </div>
    ${isAdmin?'<button class="btn" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--gold);box-shadow:none;" onclick="abrirModalClase()">+ Nueva clase</button>':''}
  </div>
  <div id="calendarioSemanal" class="cal-grid-admin"></div>`;
  renderCalendario();
}

function renderCalendario(){
  const cal=$('calendarioSemanal');
  if (!cal) return;
  const diasOrden=[1,2,3,4,5,6]; // domingo cerrado — no se muestra en el calendario
  const hoyNum=new Date().getDay();
  let html='';
  diasOrden.forEach(function(d){
    const clasesDia=(db.classes||[]).filter(c=>c.dia===d).sort((a,b)=>(a.inicio||'').localeCompare(b.inicio||''));
    const esHoy = d===hoyNum;
    let chips='';
    clasesDia.forEach(function(c){
      chips+=
        '<div class="cal-card" onclick="abrirAsistencia(\''+c.id+'\')">'+
          '<button class="cal-card-edit" onclick="event.stopPropagation();abrirModalClase(\''+c.id+'\')" title="Editar clase">✎</button>'+
          '<div class="cal-card-time">'+c.inicio+(c.fin?'–'+c.fin:'')+'</div>'+
          '<div class="cal-card-name">'+esc(c.nombre)+'</div>'+
        '</div>';
    });
    if(!chips) chips='<div class="cal-empty">Sin clases</div>';
    html+=
      '<div class="cal-col'+(esHoy?' is-today':'')+'">'+
        '<div class="cal-col-label">'+DIAS[d]+(esHoy?' <span class="cal-col-dot"></span>':'')+'</div>'+
        '<div class="cal-col-body">'+chips+'</div>'+
      '</div>';
  });
  cal.innerHTML=html;
}

function abrirModalClase(id){
  const c=id?(db.classes||[]).find(x=>x.id===id):null;
  const discOpts=TODAS_DISCIPLINAS.map(function(d){
    return '<option value="'+d+'"'+(((c&&c.estilo)||'Salsa')===d?' selected':'')+'>'+d+'</option>';
  }).join('');
  const nivelOpts='<option value="">Sin nivel específico</option>'+
    NIVELES.map(function(n){
      return '<option value="'+n+'"'+((c&&c.nivelNum==n)?' selected':'')+'>'+n+'</option>';
    }).join('');
  const diaOpts=DIAS_FULL.map(function(d,i){
    return '<option value="'+i+'"'+(((c&&c.dia!=null?c.dia:1))==i?' selected':'')+'>'+d+'</option>';
  }).join('');

  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalClase';
  overlay.innerHTML=
    '<div class="modal-box">'+
    '<h3 class="modal-title">'+(c?'Editar clase':'Nueva clase')+'</h3>'+
    '<label class="label-field">Nombre *</label>'+
    '<input type="text" id="clNombre" value="'+esc(c&&c.nombre||'')+'" placeholder="Ej: Bachata Intermedio">'+
    '<div class="g2">'+
      '<div><label class="label-field">Disciplina</label>'+
        '<select id="clEstilo">'+discOpts+'</select></div>'+
      '<div><label class="label-field">Nivel (si aplica)</label>'+
        '<select id="clNivel">'+nivelOpts+'</select></div>'+
    '</div>'+
    '<div class="g2">'+
      '<div><label class="label-field">Día de la semana</label>'+
        '<select id="clDia">'+diaOpts+'</select></div>'+
      '<div><label class="label-field">Hora inicio</label>'+
        '<input type="time" id="clInicio" value="'+(c&&c.inicio||'19:00')+'"></div>'+
    '</div>'+
    '<label class="label-field">Hora fin</label>'+
    '<input type="time" id="clFin" value="'+(c&&c.fin||'20:00')+'">'+
    '<label style="display:flex;align-items:center;gap:10px;margin-top:14px;">'+
      '<input type="checkbox" id="clHasVideo" style="width:auto;"'+(c&&c.hasVideo?' checked':'')+'>'+
      '<span style="font-size:13.5px;color:var(--text-2);">Clase con vídeo (portal alumnos)</span>'+
    '</label>'+
    '<div style="display:flex;gap:10px;margin-top:24px;justify-content:flex-end;">'+
      (c?'<button class="btn warn sm" onclick="borrarClase(&quot;'+c.id+'&quot;)">Eliminar</button>':'')+
      '<button class="btn sec" onclick="cerrarModal(&quot;modalClase&quot;)">Cancelar</button>'+
      '<button class="btn" onclick="guardarClase(&quot;'+(c&&c.id||'')+'&quot;)">Guardar</button>'+
    '</div>'+
    '</div>';
  playModal(); document.body.appendChild(overlay);
}

function guardarClase(id){
  const nombre=$('clNombre').value.trim();
  if (!nombre){alert('El nombre es obligatorio.');return;}
  const data={
    nombre, estilo:$('clEstilo').value,
    nivelNum:$('clNivel').value?parseInt($('clNivel').value):null,
    dia:parseInt($('clDia').value), inicio:$('clInicio').value,
    fin:$('clFin').value,
    hasVideo:$('clHasVideo').checked
  };
  if (id){
    const idx=(db.classes||[]).findIndex(c=>c.id===id);
    if (idx!==-1) Object.assign(db.classes[idx],data);
  } else {
    db.classes=(db.classes||[]);
    db.classes.push({id:uuid(),...data});
  }
  guardar(); cerrarModal('modalClase'); renderView('clases'); confirmSave('Clase guardada');
}
function borrarClase(id){
  if (!confirm('¿Eliminar esta clase?')) return;
  db.classes=(db.classes||[]).filter(c=>c.id!==id);
  db.enrollments=(db.enrollments||[]).filter(e=>e.classId!==id);
  guardar(); cerrarModal('modalClase'); renderView('clases');
}

/* ── Asistencia modal ── */
function abrirAsistencia(classId){
  const c=(db.classes||[]).find(x=>x.id===classId);
  const today=hoy();
  const lista=usersOfClass(classId);

  let rowsHtml='';
  lista.forEach(function(u){
    const a=(db.attendances||[]).find(x=>x.classId===classId&&x.userId===u.id&&x.fecha===today);
    const chk=a?.present?'checked':'';
    rowsHtml+=
      '<div style="display:flex;align-items:center;justify-content:space-between;'+
        'padding:10px 0;border-top:1px solid rgba(255,255,255,.07);">'+
        '<span>'+esc(u.nombre)+'</span>'+
        '<label style="position:relative;display:inline-block;width:46px;height:26px;margin:0;">'+
          '<input type="checkbox" data-uid="'+u.id+'" '+chk+' style="opacity:0;width:0;height:0;">'+
          '<span class="asist-toggle" style="position:absolute;inset:0;border-radius:30px;cursor:pointer;'+
            'background:'+(a?.present?'var(--ok-soft)':'rgba(255,255,255,.06)')+';'+
            'border:1px solid '+(a?.present?'var(--ok)':'rgba(255,255,255,.12)')+';transition:.25s;"'+
            ' onclick="var i=this.previousElementSibling;i.click();'+
              'this.style.background=i.checked?\'var(--ok-soft)\':\' rgba(255,255,255,.06)\';'+
              'this.style.borderColor=i.checked?\'var(--ok)\':\' rgba(255,255,255,.12)\';'+
              'this.firstElementChild.style.transform=i.checked?\'translateX(20px)\':\'\';'+
              'this.firstElementChild.style.background=i.checked?\'var(--ok)\':\' var(--muted)\';">'+
            '<span style="position:absolute;height:18px;width:18px;left:3px;top:3px;'+
              'background:'+(a?.present?'var(--ok)':'var(--muted)')+';border-radius:50%;transition:.25s;"></span>'+
          '</span>'+
        '</label>'+
      '</div>';
  });
  if(!rowsHtml) rowsHtml='<div class="vacio" style="padding:20px;">Sin alumnos inscritos.</div>';

  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalAsist';
  overlay.innerHTML=
    '<div class="modal-box">'+
    '<h3 class="modal-title">📋 Lista · '+esc(c?.nombre||'')+'</h3>'+
    '<p style="color:var(--muted);font-size:12.5px;margin-bottom:18px;margin-top:-10px;">'+today+'</p>'+
    '<div>'+rowsHtml+'</div>'+
    '<div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">'+
      '<button class="btn sec" onclick="cerrarModal(\'modalAsist\')">Cancelar</button>'+
      '<button class="btn ok" onclick="guardarAsistencia(\''+classId+'\',\''+today+'\')">Guardar lista</button>'+
    '</div>'+
    '</div>';
  playModal(); document.body.appendChild(overlay);
}

async function guardarAsistencia(classId,fecha){
  const checks=document.querySelectorAll('#modalAsist input[data-uid]');
  for (const inp of checks){
    await apiJSON('POST','/api/attendances',{classId,userId:inp.dataset.uid,fecha,present:inp.checked});
  }
  cerrarModal('modalAsist');
  await cargarDB(); renderView(activeView);
  confirmSave('Lista de asistencia guardada');
}

/* ── Vista PAGOS ── */
function renderPagos(cont){
  const mes=mesActual();
  cont.innerHTML=`<div class="section-head">
    <div class="h2">◆ Pagos</div>
    <div style="display:flex;gap:8px;">
      <button class="btn sec" onclick="abrirFacturaSimplificada()" title="Factura exprés para cobro puntual sin datos de cliente">⚡ Factura simplificada</button>
      <button class="btn" onclick="abrirPago()">+ Registrar pago</button>
    </div>
  </div>
  <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:center;">
    <input type="month" id="filtroPagoMes" value="${mes}" onchange="filtrarPagos()" style="max-width:160px;">
    <input type="text" id="busqPago" placeholder="Buscar alumno…" style="max-width:200px;" oninput="filtrarPagos()">
    <div style="margin-left:auto;color:var(--muted);font-size:12px;" id="resumenPagos"></div>
  </div>
  <div id="tablaPagos"></div>
  <div class="h2" style="margin-top:28px;">! Pendientes del mes</div>
  <div class="toolbar">
    <input type="month" id="pendMes" value="${mes}" onchange="renderPendientes()" style="max-width:160px;">
  </div>
  <div id="tablaPendientes"></div>`;
  filtrarPagos(); renderPendientes();
}

function filtrarPagos(){
  const fm=($('filtroPagoMes')||{}).value||'';
  const q=(($('busqPago')||{}).value||'').toLowerCase();
  const lista=(db.payments||[]).filter(p=>
    (!fm||p.mes===fm)&&nombreUsuario(p.userId).toLowerCase().includes(q)
  ).sort((a,b)=> (a.numeroTicket||0) - (b.numeroTicket||0));
  const cont=$('tablaPagos');
  if (!cont) return;
  if (!lista.length){ cont.innerHTML='<div class="vacio">Sin pagos con estos filtros.</div>'; return; }
  let total=0;
  const wrap=document.createElement('div');
  wrap.className='tbl-wrap';
  let h=`<table><thead><tr>
    <th>Ticket</th><th>Mes</th><th>Alumno</th>
    <th>Total</th><th>IVA</th><th>Malevo</th>
    <th>Método</th><th></th>
  </tr></thead><tbody>`;
  lista.forEach(p=>{
    const n=numPagoDeUsuario(p.userId,p.mes,p.id);
    const r=calcularReparto(p.importe||0,n);
    total+=r.importe;
    const numT = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : '—';
    const u    = (db.users||[]).find(x=>x.id===p.userId);
    const tel  = (u?.telefono||'').replace(/\D/g,'');
    // Mensaje WhatsApp con enlace directo al PDF
    const pdfUrl = `${location.origin}/api/factura/${p.id}/pdf`;
    const importeStr = (Math.round(r.importe*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2});
    const waMsg = encodeURIComponent(
      `Hola ${u?.nombre||''}! 👋\nTe enviamos tu factura:\n📄 Factura: ${numT}\n💶 Importe: ${importeStr} €\n📅 Mes: ${p.mes||''}\n\n🔗 Descarga tu PDF aquí:\n${pdfUrl}\n\nGracias por bailar con nosotros 💃🕺`
    );
    const waBtn = tel
      ? `<a href="https://wa.me/${tel}?text=${waMsg}" target="_blank"
           class="btn sm ok" title="Enviar confirmación por WhatsApp"
           style="text-decoration:none;background:linear-gradient(135deg,#25d366,#128c7e);
             box-shadow:0 2px 8px rgba(37,211,102,.30);">💬</a>`
      : `<span class="btn sm sec" style="opacity:.3;cursor:not-allowed;" title="Sin teléfono registrado">💬</span>`;

    h+=`<tr>
      <td><b style="color:var(--accent);">${numT}</b></td>
      <td>${p.mes||'—'}</td>
      <td>${p.simplificada
        ?'<span class="badge muted" title="Factura simplificada">⚡ '+esc(p.notas||'Anónimo')+'</span>'
        :esc(nombreUsuario(p.userId))}</td>
      <td><b>${eur(r.importe)}</b></td>
      <td style="color:var(--warn);">${eur(r.iva)}</td>
      <td style="color:var(--ok);">${eur(r.malevo)}</td>
      <td><span class="badge muted">${esc(p.metodo||'')}</span></td>
      <td><div style="display:flex;gap:5px;align-items:center;">
        <button class="btn sm ok" title="Ver / Imprimir PDF"
          onclick="${p.simplificada
            ?"generarTicketSimplificado('"+p.id+"','"+esc(p.notas||'Cobro puntual').replace(/'/g,"\\'")+"')"
            :"generarTicket('"+p.id+"')"}">🧾</button>
        ${waBtn}
        <button class="btn sm sec" onclick="editarPago('${p.id}')">Editar</button>
        <button class="btn sm warn" onclick="borrarPago('${p.id}')">×</button>
      </div></td>
    </tr>`;
  });
  wrap.innerHTML=h+'</tbody></table>';
  cont.innerHTML='';
  cont.appendChild(wrap);
  const res=$('resumenPagos');
  if (res) res.textContent=`${lista.length} pagos · ${eur(total)} total`;
}

function renderPendientes(){
  const mes=($('pendMes')||{}).value||mesActual();
  const pagados=new Set((db.payments||[]).filter(p=>p.mes===mes).map(p=>p.userId));
  const pend=(db.users||[]).filter(u=>u.active&&u.role==='student'&&!u.guestCourtesy&&!pagados.has(u.id));
  const cont=$('tablaPendientes');
  if (!cont) return;
  if (!pend.length){ cont.innerHTML='<div class="vacio" style="color:var(--ok);">✓ Todos los alumnos han pagado este mes.</div>'; return; }
  const wrap=document.createElement('div');
  wrap.className='tbl-wrap';
  let h=`<table><thead><tr><th>Alumno</th><th>Plan</th><th>Importe</th><th></th></tr></thead><tbody>`;
  pend.forEach(u=>{
    h+=`<tr>
      <td><strong>${esc(u.nombre)}</strong></td>
      <td><span class="badge muted">${PLANES[u.plan]||'—'}</span></td>
      <td><span class="badge warn">Pendiente · ${eur(precioUsuario(u))}</span></td>
      <td><button class="btn sm" onclick="abrirPago('${u.id}')">Registrar pago</button></td>
    </tr>`;
  });
  wrap.innerHTML=h+'</tbody></table>';
  cont.innerHTML='';
  cont.appendChild(wrap);
}

function abrirPago(userId,pagoId){
  const p=pagoId?(db.payments||[]).find(x=>x.id===pagoId):null;
  const alumnos=(db.users||[]).filter(u=>u.role==='student'||u.role==='guest').sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const html=`<div class="modal-overlay open" id="modalPago">
  <div class="modal-box">
    <h3 class="modal-title">${p?'Editar pago':'Registrar pago'}</h3>
    <label class="label-field">Alumno *</label>
    <select id="pgAlumno" onchange="autoImporteTarifa();calcDesglose()">
      ${alumnos.map(function(u){return '<option value="'+u.id+'"'+((p&&p.userId||userId)===u.id?' selected':'')+'>'+esc(u.nombre)+'</option>';}).join('')}
    </select>
    <div class="g2">
      <div><label class="label-field">Mes del pago *</label>
        <input type="month" id="pgMes" value="${p?.mes||mesActual()}" onchange="calcDesglose()"></div>
      <div><label class="label-field">Fecha de cobro</label>
        <input type="date" id="pgFecha" value="${p?.fechaPago||hoy()}"></div>
    </div>
    <div class="g2">
      <div>
        <label class="label-field">Importe (€) *</label>
        <div style="position:relative;">
          <input type="number" id="pgImporte" value="${p?.importe||''}" step="0.01" oninput="calcDesglose()"
            style="padding-right:70px;">
          <span id="pgPlanTag" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
            font-size:10px;font-weight:600;color:var(--muted);pointer-events:none;"></span>
        </div>
      </div>
      <div><label class="label-field">Método</label>
        <select id="pgMetodo">
          ${['Efectivo','Bizum','Transferencia','Tarjeta'].map(function(m){return '<option'+((p&&p.metodo||'Efectivo')===m?' selected':'')+'>'+m+'</option>';}).join('')}
        </select></div>
    </div>
    <label class="label-field">Notas</label>
    <textarea id="pgNotas" rows="2">${esc(p?.notas||'')}</textarea>
    <div id="pgDesglose" style="background:var(--surface-2);border:1px solid var(--border-2);
      border-radius:12px;padding:14px;margin-top:14px;font-size:13px;"></div>
    <div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">
      <button class="btn sec" onclick="cerrarModal(&quot;modalPago&quot;)">Cancelar</button>
      <button class="btn" onclick="guardarPago('${p?.id||''}')">Guardar</button>
    </div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  // Al abrir para nuevo pago: autocompletar importe según tarifa del alumno
  if(!p) autoImporteTarifa();
  calcDesglose();
}

// Autocompleta el importe con la tarifa del plan del alumno seleccionado
function autoImporteTarifa(){
  const uid  = $('pgAlumno')?.value;
  const imp  = $('pgImporte');
  const tag  = $('pgPlanTag');
  if(!uid || !imp) return;
  const u     = (db.users||[]).find(x=>x.id===uid);
  const plan  = u?.plan;
  const precio= plan && db.config.precios?.[plan];
  if(precio != null && precio > 0){
    imp.value = precio;
    if(tag){
      const labels={'suelta':'Clase suelta','35':'1 cls/sem','50':'2 cls/sem','80':'VIP','bono':'Bono'};
      tag.textContent = labels[plan] || plan;
    }
  } else {
    imp.value = '';
    if(tag) tag.textContent = '';
  }
}

function calcDesglose(){
  const uid=($('pgAlumno')||{}).value;
  const imp=parseFloat(($('pgImporte')||{}).value);
  const mes=($('pgMes')||{}).value;
  const cont=$('pgDesglose');
  if (!cont||!uid||isNaN(imp)||imp<=0){if(cont)cont.innerHTML='<em style="color:var(--muted);">Introduce datos para ver el desglose.</em>';return;}
  const n=numPagoDeUsuario(uid,mes,'');
  const r=calcularReparto(imp,n);
  cont.innerHTML=`
    <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--muted);">Total cobrado</span><b>${eur(r.importe)}</b></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--muted);">IVA (${db.config.iva}%)</span><span style="color:var(--warn);">${eur(r.iva)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--muted);">Base imponible</span><b>${eur(r.base)}</b></div>
    <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;"><span style="color:var(--muted);">➜ Malevo (${r.malevoPct}%)</span><b style="color:var(--ok);">${eur(r.malevo)}</b></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--muted);">➜ The Box (${r.boxPct}%)</span><span>${eur(r.box)}</span></div>`;
}

async function guardarPago(id){
  const userId=$('pgAlumno').value;
  const importe=parseFloat($('pgImporte').value);
  if (!userId||isNaN(importe)||importe<=0){alert('Datos incompletos.');return;}
  const data={userId,mes:$('pgMes').value,fechaPago:$('pgFecha').value||hoy(),
    importe,metodo:$('pgMetodo').value,notas:$('pgNotas').value.trim()};
  try {
    if (id){ await apiJSON('PUT',`/api/payments/${id}`,data); }
    else { await apiJSON('POST','/api/payments',data); }
    cerrarModal('modalPago');
    await cargarDB();
    if (confirm('Pago guardado. ¿Generar ticket?')) generarTicket(id||db.payments[db.payments.length-1]?.id);
    confirmSave('Pago registrado');
    renderView('pagos');
  } catch(e){ alert('Error: '+e.message); }
}

/* ── Factura Simplificada Exprés ── */
function abrirFacturaSimplificada(){
  const precios = db.config?.precios || {};
  const iva     = db.config?.iva ?? 21;

  // Conceptos rápidos predefinidos + libre
  const conceptos = [
    { l:'Clase suelta',         v: precios.suelta || 12 },
    { l:'Clase suelta × 2',     v: (precios.suelta||12) * 2 },
    { l:'Bono 5 clases',       v: precios.bono   || 50 },
    { l:'1 clase/sem — mensual',v: precios['35']  || 35 },
    { l:'2 clases/sem — mensual',v: precios['50'] || 50 },
    { l:'VIP / Full Pass',      v: precios['80']  || 80 },
    { l:'Personalizado…',       v: 0 }
  ];

  const html =
    '<div class="modal-overlay open" id="modalFSimp">'+
    '<div class="modal-box" style="max-width:460px;">'+
    '<h3 class="modal-title">⚡ Factura simplificada exprés</h3>'+
    '<p style="color:var(--muted);font-size:12.5px;margin-bottom:18px;line-height:1.5;">'+
      'Para cobros puntuales sin cliente registrado. La factura se numera y queda en el sistema.</p>'+

    '<label class="label-field">Concepto *</label>'+
    '<select id="fsConcepto" onchange="fsSyncImporte()" style="font-size:14px;">'+
      conceptos.map(c=>'<option value="'+c.v+'">'+c.l+(c.v?' · '+eur(c.v):'')+'</option>').join('')+
    '</select>'+

    '<label class="label-field" style="margin-top:12px;">Descripción libre</label>'+
    '<input type="text" id="fsDesc" placeholder="Ej: Clase suelta bachata — 4 ago. 2026"'+
      ' value="Clase suelta — '+new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})+'">'+

    '<div class="g2" style="margin-top:12px;">'+
      '<div><label class="label-field">Importe total (€, IVA incl.) *</label>'+
        '<input type="number" id="fsImporte" step="0.01" min="0" placeholder="12.00"'+
          ' value="'+(precios.suelta||12)+'" oninput="fsActualizaDesglose()"'+
          ' style="font-size:18px;font-weight:700;color:var(--gold-2);">'+
      '</div>'+
      '<div><label class="label-field">Método de cobro</label>'+
        '<select id="fsMetodo">'+
          ['Efectivo','Bizum','Transferencia','Tarjeta'].map(m=>'<option>'+m+'</option>').join('')+
        '</select>'+
      '</div>'+
    '</div>'+

    '<div id="fsDesglose" style="background:var(--surface-2);border:1px solid var(--border-2);'+
      'border-radius:12px;padding:14px;margin-top:14px;font-size:13px;"></div>'+

    '<label class="label-field" style="margin-top:14px;">Fecha</label>'+
    '<input type="date" id="fsFecha" value="'+hoy()+'">'+

    '<div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">'+
      '<button class="btn sec" onclick="cerrarModal(\'modalFSimp\')">Cancelar</button>'+
      '<button class="btn ok" onclick="emitirFacturaSimplificada()">⚡ Emitir y generar ticket</button>'+
    '</div>'+
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
  fsActualizaDesglose();
}

function fsSyncImporte(){
  const sel = $('fsConcepto');
  const val = parseFloat(sel?.value);
  if(val > 0){ const imp = $('fsImporte'); if(imp) imp.value = val; }
  fsActualizaDesglose();
}

function fsActualizaDesglose(){
  const cont = $('fsDesglose');
  if(!cont) return;
  const imp = parseFloat($('fsImporte')?.value);
  const iva  = db.config?.iva ?? 21;
  if(isNaN(imp) || imp <= 0){
    cont.innerHTML='<em style="color:var(--muted);">Introduce el importe para ver el desglose.</em>';
    return;
  }
  const base = imp / (1 + iva/100);
  const ivaAmt = imp - base;
  const f = x => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2})+'€';
  cont.innerHTML=
    '<div style="display:flex;justify-content:space-between;padding:3px 0;">'+
      '<span style="color:var(--muted);">Base imponible</span><b>'+f(base)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between;padding:3px 0;">'+
      '<span style="color:var(--muted);">IVA ('+iva+'%)</span>'+
      '<span style="color:var(--warn);">'+f(ivaAmt)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:6px 0 0;'+
      'border-top:1px solid var(--border);margin-top:6px;">'+
      '<b>Total facturado</b><b style="color:var(--gold-2);font-size:16px;">'+f(imp)+'</b></div>';
}

async function emitirFacturaSimplificada(){
  const importe = parseFloat($('fsImporte')?.value);
  if(!importe || importe <= 0){ showToast('Introduce un importe válido.','warn'); return; }
  const desc    = ($('fsDesc')?.value||'').trim() || 'Factura simplificada';
  const metodo  = $('fsMetodo')?.value || 'Efectivo';
  const fecha   = $('fsFecha')?.value  || hoy();
  const mes     = fecha.slice(0,7);

  // Guardar como pago sin userId (cliente anónimo)
  try {
    const res = await apiJSON('POST', '/api/payments', {
      userId:   '__anonimo__',
      mes,
      fechaPago: fecha,
      importe,
      metodo,
      notas:    desc,
      simplificada: true
    });
    cerrarModal('modalFSimp');
    await cargarDB();
    // Generar ticket directamente
    const pid = res?.payment?.id || db.payments[db.payments.length-1]?.id;
    if(pid) generarTicketSimplificado(pid, desc);
    confirmSave('Factura simplificada emitida');
    renderView('pagos');
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

// ── Factura completa de cuota mensual — descarga PDF del servidor ─────────
function generarTicket(pagoId){
  _descargarPDFFactura(pagoId);
}

// ── Factura simplificada — descarga PDF del servidor ─────────────────────
function generarTicketSimplificado(pagoId, desc){
  _descargarPDFFactura(pagoId);
}

// Descarga un PDF individual desde el servidor
function _descargarPDFFactura(pagoId){
  const p = (db.payments||[]).find(x=>x.id===pagoId);
  if(!p){ showToast('Pago no encontrado','warn'); return; }
  const numT = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : pagoId.slice(0,8);
  const a = document.createElement('a');
  a.href     = `/api/factura/${pagoId}/pdf`;
  a.download = `${numT}.pdf`;
  a.click();
  showToast(`Descargando ${numT}.pdf…`, 'info', 2000);
}

// Etiquetas de plan (usadas en el servidor, aquí solo para referencia en UI)
const PLAN_DESC = {
  suelta: 'Clase suelta',
  '35':   'Tarifa 1 clase/semana',
  '50':   'Tarifa 2 clases/semana',
  '80':   'Tarifa VIP / Full Pass',
  bono:   'Bono 5 clases',
};

// CSS común para A4
function _estiloFacturaA4(){
  return `
    @page { size: A4; margin: 24mm 22mm 20mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      color: #1a1a1a; margin: 0; padding: 0; font-size: 13px; line-height: 1.5;
    }
    /* ── Cabecera emisor ── */
    .hdr {
      display: flex; align-items: flex-start;
      justify-content: space-between; gap: 24px;
      padding-bottom: 18px; margin-bottom: 24px;
      border-bottom: 2px solid #E29023;
    }
    .hdr-left { flex: 1; }
    .hdr-logo { max-height: 60px; max-width: 200px;
      object-fit: contain; display: block; margin-bottom: 10px; }
    .hdr-nombre { font-size: 18px; font-weight: 700; color: #1a1a1a; margin: 0 0 5px; }
    .hdr-meta { font-size: 11px; color: #666; line-height: 1.75; }
    .hdr-right { text-align: right; flex: 0 0 auto; }
    .hdr-tipo {
      font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
      color: #aaa; margin-bottom: 5px;
    }
    .hdr-num { font-size: 24px; font-weight: 800; color: #E29023; letter-spacing: 1px; }
    .hdr-fecha { font-size: 11px; color: #888; margin-top: 4px; }
    /* ── Secciones ── */
    .sec-label {
      font-size: 9.5px; text-transform: uppercase; letter-spacing: 1.5px;
      color: #bbb; font-weight: 700; margin: 20px 0 8px;
    }
    /* ── Bloque cliente ── */
    .cliente-box {
      background: #f8f7f4; border-radius: 8px;
      padding: 14px 18px; margin-bottom: 8px;
    }
    .cliente-nombre { font-size: 15px; font-weight: 700; margin: 0 0 3px; }
    .cliente-meta { font-size: 11.5px; color: #777; }
    /* ── Tabla desglose ── */
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    thead th {
      text-align: left; font-size: 9.5px; text-transform: uppercase;
      letter-spacing: 1px; color: #bbb; font-weight: 700;
      padding: 5px 0 6px; border-bottom: 1px solid #e0e0e0;
    }
    thead th.r { text-align: right; }
    tbody td { padding: 9px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .sub-label { color: #888; }
    .r { text-align: right; }
    .fila-base td { font-size: 13px; }
    .fila-iva  td { font-size: 12.5px; color: #888; }
    .fila-tot  td {
      font-size: 17px; font-weight: 800;
      border-top: 2px solid #E29023; border-bottom: none;
      padding-top: 10px; color: #1a1a1a;
    }
    .fila-tot .r { color: #E29023; }
    /* ── Pie ── */
    .foot {
      margin-top: 36px; padding-top: 14px;
      border-top: 1px dashed #ddd;
      font-size: 10.5px; color: #aaa; text-align: center; line-height: 1.8;
    }
    .btn-print {
      display: block; width: 100%; padding: 13px; margin-top: 24px;
      background: linear-gradient(135deg, #E29023, #B86E10);
      color: #fff; border: none; border-radius: 10px;
      cursor: pointer; font-size: 14px; font-weight: 600;
    }
    @media print { .btn-print { display: none; } }
  `;
}

// Cabecera HTML del emisor
function _cabeceraPDF(neg, numT, tipo, fechaStr){
  return `
  <div class="hdr">
    <div class="hdr-left">
      ${neg.logo ? `<img class="hdr-logo" src="${neg.logo}" alt="Logo">` : ''}
      <div class="hdr-nombre">${esc(neg.nombre||'Academia de Baile Malevo')}</div>
      <div class="hdr-meta">
        ${neg.nif       ? `<span>NIF: ${esc(neg.nif)}</span><br>` : ''}
        ${neg.direccion ? `<span>${esc(neg.direccion)}</span><br>` : ''}
        ${neg.telefono  ? `<span>Tel: ${esc(neg.telefono)}</span>` : ''}
        ${neg.telefono && neg.email ? '&emsp;' : ''}
        ${neg.email     ? `<span>${esc(neg.email)}</span>` : ''}
      </div>
    </div>
    <div class="hdr-right">
      <div class="hdr-tipo">${tipo}</div>
      <div class="hdr-num">${numT}</div>
      <div class="hdr-fecha">${fechaStr}</div>
    </div>
  </div>`;
}

// Pie de factura
function _piePDF(neg, metodo){
  const textoLegal = neg.nif ? `NIF emisor: ${esc(neg.nif)}` : '';
  const textoPago  = metodo  ? `Método de pago: ${esc(metodo)}` : '';
  const sep = textoLegal && textoPago ? ' &nbsp;·&nbsp; ' : '';
  return `
  <div class="foot">
    ${esc(neg.pie || 'Gracias por bailar con nosotros 💃🕺')}<br>
    ${textoLegal}${sep}${textoPago}
  </div>`;
}

// ── Factura completa de cuota mensual ─────────────────────────────────────
function generarTicket(pagoId){
  const p = (db.payments||[]).find(x=>x.id===pagoId);
  if(!p) return;
  const u   = (db.users||[]).find(x=>x.id===p.userId);
  const c   = db.config;
  const neg = c.negocio || {};
  const ivaRate = c.iva ?? 21;
  const base    = p.importe / (1 + ivaRate/100);
  const ivaAmt  = p.importe - base;
  const f = x => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' €';

  const numT      = p.numeroTicket ? 'T-' + String(p.numeroTicket).padStart(5,'0') : '—';
  const fechaStr  = new Date((p.fechaPago||hoy())+'T12:00:00')
    .toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});
  const mesStr    = p.mes
    ? new Date(p.mes+'-01T00:00:00').toLocaleDateString('es-ES',{month:'long',year:'numeric'})
    : '';

  // Concepto claro: plan + mes
  const planLabel = (u && PLAN_DESC[u.plan]) ? PLAN_DESC[u.plan] : 'Servicio de clases de baile';
  const concepto  = mesStr
    ? `${planLabel} · ${mesStr.charAt(0).toUpperCase()+mesStr.slice(1)}`
    : (p.notas || planLabel);
  const notasExtra = p.notas && p.notas !== concepto ? p.notas : '';

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>Factura ${numT}</title>
<style>${_estiloFacturaA4()}</style>
</head><body>

${_cabeceraPDF(neg, numT, 'Factura simplificada', fechaStr)}

<div class="sec-label">Cliente</div>
<div class="cliente-box">
  <div class="cliente-nombre">${esc(u?.nombre || '—')}</div>
  ${u?.email    ? `<div class="cliente-meta">✉ ${esc(u.email)}</div>`    : ''}
  ${u?.telefono ? `<div class="cliente-meta">📞 ${esc(u.telefono)}</div>` : ''}
</div>

<div class="sec-label">Concepto y desglose</div>
<table>
  <thead>
    <tr>
      <th>Descripción</th>
      <th class="r">Base imponible</th>
      <th class="r">IVA (${ivaRate}%)</th>
      <th class="r">Total</th>
    </tr>
  </thead>
  <tbody>
    <tr class="fila-base">
      <td>
        ${esc(concepto)}
        ${notasExtra ? `<br><span style="font-size:11px;color:#999;">${esc(notasExtra)}</span>` : ''}
      </td>
      <td class="r">${f(base)}</td>
      <td class="r">${f(ivaAmt)}</td>
      <td class="r">${f(p.importe)}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr class="fila-tot">
      <td>Total a pagar</td>
      <td class="r" colspan="3">${f(p.importe)}</td>
    </tr>
  </tfoot>
</table>

${_piePDF(neg, p.metodo)}
<button class="btn-print" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
<script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
</body></html>`;

  const w = window.open('','_blank','width=700,height=900');
  if(!w){ alert('Permite ventanas emergentes para generar la factura.'); return; }
  w.document.write(html); w.document.close();
}

// ── Factura simplificada (clase suelta / cobro exprés) ────────────────────
function generarTicketSimplificado(pagoId, desc){
  const p = (db.payments||[]).find(x=>x.id===pagoId);
  if(!p) return;
  const c   = db.config;
  const neg = c.negocio || {};
  const ivaRate = c.iva ?? 21;
  const base    = p.importe / (1 + ivaRate/100);
  const ivaAmt  = p.importe - base;
  const f = x => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' €';

  const numT     = p.numeroTicket ? 'T-' + String(p.numeroTicket).padStart(5,'0') : '—';
  const fechaStr = new Date((p.fechaPago||hoy())+'T12:00:00')
    .toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});

  // Cliente: puede ser anónimo (clase suelta exprés) o un alumno
  const u = p.userId && p.userId !== '__anonimo__'
    ? (db.users||[]).find(x=>x.id===p.userId)
    : null;
  const clienteNombre  = u?.nombre || 'Público en general';
  const clienteEmail   = u?.email   || '';
  const clienteTel     = u?.telefono || '';

  // Concepto
  const concepto = desc || p.notas || 'Clase de baile · Cobro puntual';

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>Factura Simplificada ${numT}</title>
<style>${_estiloFacturaA4()}</style>
</head><body>

${_cabeceraPDF(neg, numT, 'Factura simplificada', fechaStr)}

<div class="sec-label">Cliente</div>
<div class="cliente-box">
  <div class="cliente-nombre">${esc(clienteNombre)}</div>
  ${clienteEmail ? `<div class="cliente-meta">✉ ${esc(clienteEmail)}</div>`   : ''}
  ${clienteTel   ? `<div class="cliente-meta">📞 ${esc(clienteTel)}</div>`    : ''}
  ${!u ? `<div class="cliente-meta" style="color:#bbb;font-size:11px;">
    Operación sin identificación de destinatario (art. 4 RD 1619/2012)
  </div>` : ''}
</div>

<div class="sec-label">Concepto y desglose</div>
<table>
  <thead>
    <tr>
      <th>Descripción</th>
      <th class="r">Base imponible</th>
      <th class="r">IVA (${ivaRate}%)</th>
      <th class="r">Total</th>
    </tr>
  </thead>
  <tbody>
    <tr class="fila-base">
      <td>${esc(concepto)}</td>
      <td class="r">${f(base)}</td>
      <td class="r">${f(ivaAmt)}</td>
      <td class="r">${f(p.importe)}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr class="fila-tot">
      <td>Total a pagar</td>
      <td class="r" colspan="3">${f(p.importe)}</td>
    </tr>
  </tfoot>
</table>

${_piePDF(neg, p.metodo)}
<button class="btn-print" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
<script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
</body></html>`;

  const w = window.open('','_blank','width=700,height=900');
  if(!w){ alert('Permite ventanas emergentes para generar la factura.'); return; }
  w.document.write(html); w.document.close();
}

function editarPago(id){ abrirPago(null,id); }
async function borrarPago(id){
  if (!confirm('¿Eliminar este pago?')) return;
  await apiJSON('DELETE',`/api/payments/${id}`);
  await cargarDB(); renderView('pagos');
}

/* ── Vista VÍDEOS ── */
let _videosGrupoActivo = null; // {disciplina, nivel} | null — grupo abierto en "Gestionar →"
let _videosTipoActivo  = null; // 'calentamiento' | 'bonus' | 'evento' | null
let _playlistsNivelesActivo = false; // true cuando está abierta la pestaña "Playlists"
let _cursosAdminActivo = false; // true cuando está abierta la pestaña "Cursos" (Cursos Exclusivos)
let _cursosRitmoFiltro = 'todos'; // 'todos' | 'bachata' | 'salsa' | 'otros' — filtro de la pestaña Cursos

function renderVideos(cont){
  if (_videosGrupoActivo){ renderVideosGrupo(cont); return; }
  if (_videosTipoActivo){ renderVideosPorTipo(cont); return; }
  if (_playlistsNivelesActivo){ renderPlaylistsNiveles(cont); return; }
  if (_cursosAdminActivo){ renderCursosAdmin(cont); return; }

  const vids = (db.videos||[]).filter(v=>!v.tipo||v.tipo==='clase');
  const grupos = [];
  DISCIPLINAS_VIDEO.forEach(disc=>{
    NIVELES.forEach(n=>{
      grupos.push({disciplina:disc, nivel:n, count: vids.filter(v=>v.disciplina===disc&&v.nivel===n).length});
    });
  });
  const maxCount = Math.max(1, ...grupos.map(g=>g.count));
  const contarTipo = t => (db.videos||[]).filter(v=>v.tipo===t && v.origen!=='drive').length;
  const totalPlaylists = (db.videos||[]).filter(v=>v.tipo==='playlist' && v.origen==='drive').length;

  cont.innerHTML = `<div class="section-head">
    <div></div>
    <button class="btn" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--gold);box-shadow:none;" onclick="abrirModalVideo()">+ Nuevo contenido</button>
  </div>

  <!-- Accesos rápidos a contenido extra del portal del alumno (el Bonus se gestiona dentro de cada nivel, en "Gestionar →") -->
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px;">
    ${[['calentamiento','🔥 Calentamientos'],['evento','🎉 Eventos y Talleres']].map(([t,l])=>
      `<button class="vg-link" style="background:var(--card-bg);border:1px solid var(--card-border);
        border-radius:30px;padding:8px 16px;color:var(--text-2);" onclick="abrirVideosPorTipo('${t}')">
        ${l} <span style="color:var(--muted);">· ${contarTipo(t)}</span>
      </button>`).join('')}
    <button class="vg-link" style="background:var(--card-bg);border:1px solid var(--card-border);
      border-radius:30px;padding:8px 16px;color:var(--text-2);" onclick="abrirPlaylistsNiveles()">
      🎵 Playlists <span style="color:var(--muted);">· ${totalPlaylists}/8</span>
    </button>
    <button class="vg-link" style="background:var(--card-bg);border:1px solid var(--card-border);
      border-radius:30px;padding:8px 16px;color:var(--text-2);" onclick="abrirCursosAdmin()">
      🎓 Cursos Exclusivos <span style="color:var(--muted);">· ${(db.cursos||[]).length}</span>
    </button>
  </div>

  <div class="videos-grid">
    ${grupos.map(g=>{
      const pct = Math.round(g.count/maxCount*100);
      return `<div class="video-group-card">
        <div class="vg-name">${esc(g.disciplina)} · ${nivelLabel(g.nivel)}</div>
        <div class="vg-count"><span class="vg-num">${g.count}</span><span class="vg-label">VÍDEOS</span></div>
        <div class="vg-bar"><div class="vg-bar-fill" style="width:${pct}%;"></div></div>
        <div class="vg-foot">
          <span class="vg-disc">${esc(g.disciplina)}</span>
          <button class="vg-link" onclick="abrirGrupoVideos('${esc(g.disciplina)}',${g.nivel})">Gestionar →</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function abrirVideosPorTipo(tipo){
  _videosTipoActivo = tipo;
  renderView('videos');
}
function cerrarVideosPorTipo(){
  _videosTipoActivo = null;
  renderView('videos');
}

function renderVideosPorTipo(cont){
  const tipo = _videosTipoActivo;
  const labels = {calentamiento:'🔥 Calentamientos', bonus:'🎁 Bonus', evento:'🎉 Eventos y Talleres'};
  const items = (db.videos||[]).filter(v=>v.tipo===tipo && v.origen!=='drive').sort((a,b)=>(a.orden||0)-(b.orden||0));

  cont.innerHTML = `<button class="acc-toggle" style="margin-bottom:10px;" onclick="cerrarVideosPorTipo()">← Volver a Vídeos</button>
  <div class="section-head">
    <div>
      <div class="h2" style="margin-bottom:4px;">${labels[tipo]}</div>
      <div style="font-size:12.5px;color:var(--muted);">${items.length} elemento${items.length!==1?'s':''}</div>
    </div>
    <button class="btn" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--gold);box-shadow:none;"
      onclick="abrirModalVideo(null,null,null,'${tipo}')">+ Añadir</button>
  </div>
  <div id="tablaVideosTipo"></div>`;

  const tabla=$('tablaVideosTipo');
  if (!items.length){ tabla.innerHTML='<div class="vacio">Sin elementos todavía.</div>'; return; }

  const wrap=document.createElement('div'); wrap.className='tbl-wrap';
  let h='<table><thead><tr><th>Título</th>';
  if (tipo==='bonus') h+='<th>Nivel</th>';
  if (tipo==='evento') h+='<th>Fecha</th>';
  h+='<th></th></tr></thead><tbody>';
  items.forEach(v=>{
    let metaCol='';
    if (tipo==='bonus') metaCol=`<td><span class="badge muted">${esc(v.disciplina)} · ${nivelLabelCorto(v.nivel)}</span></td>`;
    if (tipo==='evento'){
      let meta={}; try{ meta=JSON.parse(v.notas||'{}'); }catch{}
      metaCol=`<td>${esc(meta.fecha||'—')}</td>`;
    }
    h+=`<tr>
      <td><strong>${esc(v.titulo)}</strong></td>
      ${metaCol}
      <td><div style="display:flex;gap:6px;justify-content:flex-end;">
        <button class="btn sm sec" onclick="abrirModalVideo('${v.id}')">Editar</button>
        <button class="btn sm warn" onclick="borrarVideo('${v.id}')">×</button>
      </div></td>
    </tr>`;
  });
  wrap.innerHTML=h+'</tbody></table>';
  tabla.innerHTML=''; tabla.appendChild(wrap);
}

/* ── Vista PLAYLISTS: gestión centralizada de las carpetas de Google Drive
   de los 8 niveles (Bachata y Salsa · Nivel 1 a 4), antes repartida dentro
   de "Gestionar →" de cada nivel. ── */
function abrirPlaylistsNiveles(){
  _playlistsNivelesActivo = true;
  renderView('videos');
}
function cerrarPlaylistsNiveles(){
  _playlistsNivelesActivo = false;
  renderView('videos');
}
function renderPlaylistsNiveles(cont){
  const totalPlaylists = (db.videos||[]).filter(v=>v.tipo==='playlist' && v.origen==='drive').length;

  cont.innerHTML = `<button class="acc-toggle" style="margin-bottom:10px;" onclick="cerrarPlaylistsNiveles()">← Volver a Vídeos</button>
  <div class="section-head">
    <div>
      <div class="h2" style="margin-bottom:4px;">🎵 Playlists</div>
      <div style="font-size:12.5px;color:var(--muted);">${totalPlaylists}/8 niveles con carpeta vinculada</div>
    </div>
  </div>
  <p style="font-size:12px;color:var(--muted);margin:-6px 0 20px;">
    Vincula la carpeta de Google Drive con la música de cada nivel: las canciones que contenga se cargarán
    automáticamente en el reproductor del alumno, dentro de "Mi Playlist". La carpeta debe estar compartida como
    <strong>"Cualquier persona con el enlace"</strong> (rol Lector); la clave de API se crea una sola vez en
    Google Cloud Console y se reutiliza automáticamente para el resto de niveles.</p>
  ${DISCIPLINAS_VIDEO.map(disc=>`
    <div class="h2" style="margin:26px 0 12px;font-size:14px;">${esc(disc)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
      ${NIVELES.map(n=>`<div id="driveFolderWrap_${disc}_${n}"></div>`).join('')}
    </div>`).join('')}`;

  DISCIPLINAS_VIDEO.forEach(disc=>{
    NIVELES.forEach(n=>{
      renderDriveFolderNivel(disc, n, driveRecordDeNivel(disc, n));
    });
  });
}

function abrirGrupoVideos(disciplina, nivel){
  _videosGrupoActivo = {disciplina, nivel};
  renderView('videos');
}
function cerrarGrupoVideos(){
  _videosGrupoActivo = null;
  renderView('videos');
}

function renderVideosGrupo(cont){
  const {disciplina, nivel} = _videosGrupoActivo;
  const vids = (db.videos||[]).filter(v=>v.disciplina===disciplina&&v.nivel===nivel&&(!v.tipo||v.tipo==='clase'))
    .sort((a,b)=>(a.orden||0)-(b.orden||0));
  const bonus = nivel===4 ? [] : (db.videos||[]).filter(v=>v.disciplina===disciplina&&v.nivel===nivel&&v.tipo==='bonus')
    .sort((a,b)=>(a.orden||0)-(b.orden||0));

  cont.innerHTML = `<button class="acc-toggle" style="margin-bottom:10px;" onclick="cerrarGrupoVideos()">← Volver a Vídeos</button>
  <div class="section-head">
    <div>
      <div class="h2" style="margin-bottom:4px;">${esc(disciplina)} · ${nivelLabel(nivel)}</div>
      <div style="font-size:12.5px;color:var(--muted);">${vids.length} vídeo${vids.length!==1?'s':''} en este nivel</div>
    </div>
    <button class="btn" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--gold);box-shadow:none;"
      onclick="abrirModalVideo(null,'${esc(disciplina)}',${nivel})">+ Nuevo vídeo</button>
  </div>
  ${vids.length?`<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
    <button class="btn sm" style="background:transparent;border:1px solid rgba(224,92,92,.35);color:var(--warn);box-shadow:none;"
      onclick="vaciarNivelVideos('${esc(disciplina)}',${nivel})">🗑 Vaciar nivel (${vids.length})</button>
  </div>`:''}
  <div id="tablaVideos"></div>

  ${nivel!==4 ? `
  <div class="section-head" style="margin-top:32px;">
    <div class="h2" style="margin-bottom:0;">🎁 Bonus (${bonus.length})</div>
    <button class="btn" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--gold);box-shadow:none;"
      onclick="abrirModalVideo(null,'${esc(disciplina)}',${nivel},'bonus')">+ Añadir bonus</button>
  </div>
  <p style="font-size:12px;color:var(--muted);margin:-6px 0 14px;">Los vídeos se desbloquean dinámicamente: completa 2 vídeos para desbloquear los siguientes 2.</p>
  <div id="tablaBonusNivel"></div>` : ''}`;

  renderTablaVideosGrupo(vids);
  renderTablaBonusNivel(bonus);
}

/* ══ Playlist de nivel vinculada a una carpeta de Google Drive ══
   Se guarda como un registro más de db.videos (tipo:'playlist', origen:'drive')
   para reutilizar el mismo flujo de /api/videos que ya filtra por inscripción
   del alumno — no requiere ningún endpoint nuevo en el servidor. ── */
function driveRecordDeNivel(disciplina, nivel){
  return (db.videos||[]).find(v=>v.disciplina===disciplina && v.nivel===nivel && v.tipo==='playlist' && v.origen==='drive');
}
/* Acepta un enlace completo de carpeta ("…/folders/ID…"), un enlace con ?id=,
   o el ID pegado directamente. */
function extraerDriveFolderId(raw){
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}
function renderDriveFolderNivel(disciplina, nivel, rec){
  const key  = disciplina+'_'+nivel;
  const cont = $('driveFolderWrap_'+key);
  if (!cont) return;
  const folderId  = rec ? (rec.driveFolderId||'') : '';
  const apiKey    = (rec && rec.driveApiKey) || (db.config && db.config.driveApiKey) || '';
  const folderLink = folderId ? ('https://drive.google.com/drive/folders/'+folderId) : '';
  cont.innerHTML = `<div class="card" style="padding:16px 18px;">
    <div style="font-size:12.5px;font-weight:700;color:var(--white);margin-bottom:12px;">${nivelLabel(nivel)}</div>
    ${rec && folderId ? `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--card-border);">
        <div style="width:34px;height:34px;border-radius:9px;background:rgba(226,144,35,.1);
          border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto;">📁</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;color:var(--white);">Carpeta vinculada</div>
          <a href="${esc(folderLink)}" target="_blank" style="font-size:10.5px;color:var(--muted);word-break:break-all;">${esc(folderLink)} ↗</a>
        </div>
        <button class="btn sm warn" onclick="quitarCarpetaDrive('${rec.id}')">Quitar</button>
      </div>` : ''}
    <label class="label-field">Carpeta de Google Drive (ID o enlace) *</label>
    <input type="text" id="driveFolderInput_${key}" value="${esc(folderId)}" placeholder="https://drive.google.com/drive/folders/…">
    <label class="label-field">Clave de API de Google Drive</label>
    <input type="text" id="driveApiKeyInput_${key}" value="${esc(apiKey)}" placeholder="Se reutiliza en todos los niveles">
    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <button class="btn sm" onclick="guardarCarpetaDrive('${esc(disciplina)}',${nivel})">${rec?'Actualizar':'Vincular'}</button>
    </div>
  </div>`;
}
function guardarCarpetaDrive(disciplina, nivel){
  const key = disciplina+'_'+nivel;
  const rawFolder = $('driveFolderInput_'+key).value.trim();
  const apiKey    = $('driveApiKeyInput_'+key).value.trim();
  const folderId  = extraerDriveFolderId(rawFolder);
  if (!folderId){ alert('No se reconoce el enlace o ID de la carpeta de Google Drive.'); return; }
  if (!apiKey){ alert('Falta la clave de API de Google Drive.'); return; }

  db.config = db.config || {};
  db.config.driveApiKey = apiKey; // se recuerda como valor por defecto para el resto de niveles

  let rec = driveRecordDeNivel(disciplina, nivel);
  if (rec){
    rec.driveFolderId = folderId;
    rec.driveApiKey = apiKey;
  } else {
    db.videos = db.videos || [];
    rec = {
      id: uuid(), disciplina, nivel, tipo:'playlist', origen:'drive',
      titulo: '🎵 Música de '+disciplina+' · '+nivelLabel(nivel)+' (Google Drive)',
      url:'', driveFolderId: folderId, driveApiKey: apiKey, orden:0
    };
    db.videos.push(rec);
  }
  guardar();
  confirmSave('Carpeta de Google Drive vinculada');
  renderDriveFolderNivel(disciplina, nivel, rec);
}
function quitarCarpetaDrive(id){
  if (!confirm('¿Quitar la carpeta de Google Drive vinculada a este nivel?')) return;
  const rec = (db.videos||[]).find(v=>v.id===id);
  db.videos = (db.videos||[]).filter(v=>v.id!==id);
  guardar();
  showToast('Carpeta desvinculada','ok');
  if (rec) renderDriveFolderNivel(rec.disciplina, rec.nivel, null);
}

/* ── Mini-tabla de los vídeos bonus de este nivel (sin límite de cantidad) ── */
function renderTablaBonusNivel(bonus){
  const cont=$('tablaBonusNivel');
  if (!cont) return;
  if (!bonus.length){ cont.innerHTML='<div class="vacio">Sin bonus cargados todavía en este nivel.</div>'; return; }
  const wrap=document.createElement('div');
  wrap.className='tbl-wrap';
  let h=`<table><thead><tr><th>Título</th><th>URL / Embed</th><th></th></tr></thead><tbody>`;
  bonus.forEach((v,i)=>{
    h+=`<tr>
      <td><span class="badge muted" style="margin-right:8px;">Bonus ${i+1}</span><strong>${esc(v.titulo)}</strong></td>
      <td style="max-width:280px;"><small style="color:var(--muted);word-break:break-all;">${esc(v.url)}</small></td>
      <td><div style="display:flex;gap:6px;">
        <button class="btn sm sec" onclick="abrirModalVideo('${v.id}')">Editar</button>
        <button class="btn sm warn" onclick="borrarVideo('${v.id}')">×</button>
      </div></td>
    </tr>`;
  });
  wrap.innerHTML=h+'</tbody></table>';
  cont.innerHTML=''; cont.appendChild(wrap);
}

/* ── Borra de golpe todos los vídeos de clase de un nivel (p.ej. para limpiar
   el catálogo de ejemplo sembrado automáticamente en su día) ── */
async function vaciarNivelVideos(disciplina, nivel){
  const vids = (db.videos||[]).filter(v=>v.disciplina===disciplina&&v.nivel===nivel&&(!v.tipo||v.tipo==='clase'));
  if (!vids.length) return;
  if (!confirm(`¿Eliminar los ${vids.length} vídeos de ${disciplina} · Nivel ${nivel}? Esta acción no se puede deshacer.`)) return;
  try {
    for (const v of vids){ await apiJSON('DELETE',`/api/videos/${v.id}`); }
    await cargarDB();
    renderView('videos');
    confirmSave(`${vids.length} vídeo(s) eliminados de ${disciplina} · Nivel ${nivel}`);
  } catch(e){ alert('Error al vaciar el nivel: '+e.message); }
}

function renderTablaVideosGrupo(vids){
  const cont=$('tablaVideos');
  if (!cont) return;
  if (!vids.length){ cont.innerHTML='<div class="vacio">Sin vídeos en este nivel todavía.</div>'; return; }
  const wrap=document.createElement('div');
  wrap.className='tbl-wrap';
  let h=`<table><thead><tr><th>Título</th><th>URL / Embed</th><th>Orden</th><th></th></tr></thead><tbody>`;
  vids.forEach(v=>{
    h+=`<tr>
      <td><strong>${esc(v.titulo)}</strong></td>
      <td style="max-width:280px;"><small style="color:var(--muted);word-break:break-all;">${esc(v.url)}</small></td>
      <td>${v.orden}</td>
      <td><div style="display:flex;gap:6px;">
        <button class="btn sm sec" onclick="abrirModalVideo('${v.id}')">Editar</button>
        <button class="btn sm warn" onclick="borrarVideo('${v.id}')">×</button>
      </div></td>
    </tr>`;
  });
  wrap.innerHTML=h+'</tbody></table>';
  cont.innerHTML='';
  cont.appendChild(wrap);
}

/* ══════════════════════════════════════════════════════════════════════
   CURSOS EXCLUSIVOS — gestor en Admin/Multimedia. Los cursos viven en
   db.cursos (separado de db.videos: un curso no es un vídeo suelto, es un
   paquete con su propia lista de vídeos, organizado por ritmo/
   subcategoría). El acceso de cada alumno se marca aparte, en su ficha
   (ver "Cursos Asignados" más abajo), NO acá.
   ══════════════════════════════════════════════════════════════════════ */
const CURSOS_RITMOS = [['todos','Todos'],['bachata','Bachata'],['salsa','Salsa'],['otros','Otros Ritmos']];
const CURSOS_RITMO_LABEL = {bachata:'Bachata', salsa:'Salsa', otros:'Otros Ritmos'};

function abrirCursosAdmin(){
  _cursosAdminActivo = true;
  renderView('videos');
}
function cerrarCursosAdmin(){
  _cursosAdminActivo = false;
  renderView('videos');
}
function cursosFiltrarRitmo(r){
  _cursosRitmoFiltro = r;
  renderView('videos');
}

function renderCursosAdmin(cont){
  const todos = (db.cursos||[]).slice().sort((a,b)=>(a.orden||0)-(b.orden||0));
  const filtrados = _cursosRitmoFiltro==='todos' ? todos : todos.filter(c=>c.ritmo===_cursosRitmoFiltro);

  // Agrupar por ritmo → subcategoría, en el orden en que aparecen
  const grupos = [];
  filtrados.forEach(c=>{
    let g = grupos.find(g=>g.ritmo===c.ritmo && g.subcategoria===(c.subcategoria||''));
    if (!g){ g={ritmo:c.ritmo, subcategoria:c.subcategoria||'', items:[]}; grupos.push(g); }
    g.items.push(c);
  });

  cont.innerHTML = `<button class="acc-toggle" style="margin-bottom:10px;" onclick="cerrarCursosAdmin()">← Volver a Vídeos</button>
  <div class="section-head">
    <div>
      <div class="h2" style="margin-bottom:4px;">🎓 Cursos Exclusivos</div>
      <div style="font-size:12.5px;color:var(--muted);">${todos.length} curso${todos.length!==1?'s':''} en total</div>
    </div>
    <button class="btn" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--gold);box-shadow:none;"
      onclick="abrirModalCurso()">+ Nuevo curso</button>
  </div>

  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
    ${CURSOS_RITMOS.map(([v,l])=>`<button class="vg-link" onclick="cursosFiltrarRitmo('${v}')"
      style="background:${_cursosRitmoFiltro===v?'var(--gold)':'var(--card-bg)'};
      color:${_cursosRitmoFiltro===v?'#000':'var(--text-2)'};
      border:1px solid var(--card-border);border-radius:30px;padding:8px 16px;font-weight:600;">${l}</button>`).join('')}
  </div>

  <div id="cursosAdminLista"></div>`;

  const lista = $('cursosAdminLista');
  if (!lista) return;
  if (!grupos.length){ lista.innerHTML = '<div class="vacio">Sin cursos en este filtro todavía.</div>'; return; }

  lista.innerHTML = grupos.map(g=>{
    const titulo = g.subcategoria ? `${CURSOS_RITMO_LABEL[g.ritmo]} · ${esc(g.subcategoria)}` : CURSOS_RITMO_LABEL[g.ritmo];
    const filas = g.items.map(c=>`<tr>
      <td><strong>${esc(c.nombre)}</strong>${c.activo===false?' <span class="badge muted">Inactivo</span>':''}</td>
      <td><span class="badge muted">${(c.videos||[]).length} vídeo${(c.videos||[]).length!==1?'s':''}</span></td>
      <td>${esc(c.nivel||'—')}</td>
      <td>${esc(c.duracion||'—')}</td>
      <td><div style="display:flex;gap:6px;justify-content:flex-end;">
        <button class="btn sm sec" onclick="abrirModalAlumnosCurso('${c.id}')" title="Ver/asignar alumnos y generar accesos externos">👥 Alumnos</button>
        <button class="btn sm sec" onclick="abrirModalCurso('${c.id}')">Editar</button>
        <button class="btn sm warn" onclick="borrarCurso('${c.id}')">×</button>
      </div></td>
    </tr>`).join('');
    return `<div style="margin-bottom:22px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--gold-2);font-weight:700;margin-bottom:8px;">${titulo}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Nombre</th><th>Vídeos</th><th>Nivel</th><th>Duración</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>
    </div>`;
  }).join('');
}

/* ── Modal crear/editar curso. La lista de vídeos del curso se edita como
   filas dinámicas (título + URL) dentro del mismo modal — se agregan/quitan
   con los botones +/×, y se leen del DOM recién al guardar. ── */
function abrirModalCurso(id){
  const c = id ? (db.cursos||[]).find(x=>x.id===id) : null;
  const ritmo = (c&&c.ritmo) || 'bachata';
  const subcatsExistentes = [...new Set((db.cursos||[]).filter(x=>x.ritmo===ritmo && x.subcategoria).map(x=>x.subcategoria))];

  // Alumnos con acceso a este curso — Cursos Exclusivos es un extra aparte,
  // no depende del plan ni de las clases asignadas. El único lugar donde se
  // otorga acceso es acá, en el propio curso: se listan TODOS los alumnos
  // (activos e inactivos) y el admin tilda a quién se lo desbloquea.
  const estudiantes = (db.users||[]).filter(u=>u.role==='student')
    .slice().sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  const alumnosHtml = estudiantes.length
    ? estudiantes.map(u=>{
        const tieneAcceso = !!(c && (u.cursosAsignados||[]).includes(c.id));
        const inactivo = u.active===false;
        return '<label class="c-alumno-lbl" data-nombre="'+esc((u.nombre||'').toLowerCase())+'" style="display:flex;align-items:center;gap:10px;'+
          'padding:7px 10px;border-radius:8px;cursor:pointer;'+
          'background:'+(tieneAcceso?'rgba(226,144,35,.09)':'transparent')+';'+(inactivo?'opacity:.55;':'')+'">'+
          '<input type="checkbox" class="c-alumno-chk" value="'+u.id+'" style="width:auto;accent-color:var(--gold);"'+(tieneAcceso?' checked':'')+'>'+
          '<span style="font-size:12.5px;">'+esc(u.nombre)+(inactivo?' <span style="color:var(--muted);">(inactivo)</span>':'')+'</span>'+
          '</label>';
      }).join('')
    : '<p style="color:var(--muted);font-size:13px;">Sin alumnos registrados todavía.</p>';

  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalCurso';
  overlay.innerHTML=
    '<div class="modal-box">'+
    '<h3 class="modal-title">'+(c?'Editar curso':'Nuevo curso')+'</h3>'+

    '<label class="label-field">Nombre *</label>'+
    '<input type="text" id="cNombre" value="'+esc(c&&c.nombre||'')+'" placeholder="Ej: Lady Style 1">'+

    '<div class="g2">'+
      '<div><label class="label-field">Ritmo</label>'+
        '<select id="cRitmo">'+
          '<option value="bachata"'+(ritmo==='bachata'?' selected':'')+'>Bachata</option>'+
          '<option value="salsa"'+(ritmo==='salsa'?' selected':'')+'>Salsa</option>'+
          '<option value="otros"'+(ritmo==='otros'?' selected':'')+'>Otros Ritmos</option>'+
        '</select></div>'+
      '<div><label class="label-field">Subcategoría</label>'+
        '<input type="text" id="cSubcategoria" list="cSubcatsList" value="'+esc(c&&c.subcategoria||'')+'" placeholder="Ej: Pasos Libres">'+
        '<datalist id="cSubcatsList">'+subcatsExistentes.map(s=>'<option value="'+esc(s)+'">').join('')+'</datalist></div>'+
    '</div>'+

    '<div class="g2">'+
      '<div><label class="label-field">Nivel (etiqueta libre)</label>'+
        '<input type="text" id="cNivel" value="'+esc(c&&c.nivel||'')+'" placeholder="Ej: Nivel Intermedio"></div>'+
      '<div><label class="label-field">Duración</label>'+
        '<input type="text" id="cDuracion" value="'+esc(c&&c.duracion||'')+'" placeholder="Ej: 12:45"></div>'+
    '</div>'+

    '<label class="label-field">Imagen de portada (Google Drive)</label>'+
    '<p style="color:var(--muted);font-size:11.5px;margin:0 0 8px;line-height:1.5;">'+
      'Pegá el link para compartir del archivo en Drive (el archivo tiene que estar como '+
      '"Cualquier persona con el enlace"). Se convierte solo al formato de imagen directa — no subas archivos al servidor.</p>'+
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px;">'+
      '<div id="cPortadaPreview" style="width:96px;height:96px;border-radius:8px;overflow:hidden;flex:0 0 auto;'+
        'background:rgba(255,255,255,.04);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center;">'+
        (c&&c.imagenPortada
          ? '<img src="'+esc(c.imagenPortada)+'" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">'
          : '<span style="color:var(--muted);font-size:10px;text-align:center;padding:4px;">Sin imagen</span>')+
      '</div>'+
      '<input type="text" id="cPortadaUrl" placeholder="https://drive.google.com/file/d/.../view?usp=sharing" '+
        'value="'+esc(c&&c.imagenPortada||'')+'" oninput="procesarPortadaUrlCurso(this)" style="flex:1;">'+
    '</div>'+

    '<label class="label-field" style="margin-top:6px;">🔓 Alumnos con acceso a este curso</label>'+
    '<p style="color:var(--muted);font-size:12px;margin:0 0 8px;">'+
      'Extra aparte de las clases y el plan — acá decidís a quién se lo desbloqueás. Incluye alumnos inactivos.</p>'+
    (estudiantes.length>3
      ? '<input type="text" id="cAlumnosFiltro" placeholder="Buscar alumno…" oninput="filtrarCAlumnos(this.value)" style="margin-bottom:8px;">'
      : '')+
    '<div id="cAlumnosGrid" style="display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;'+
      'padding:8px;margin-bottom:14px;border:1px solid var(--card-border);border-radius:8px;">'+
      alumnosHtml+
    '</div>'+

    '<label class="label-field">Vídeos del curso</label>'+
    '<div id="cVideosLista" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;"></div>'+
    '<button type="button" class="btn sec sm" onclick="cursoAgregarFilaVideo()">+ Añadir vídeo</button>'+

    '<label class="label-field" style="margin-top:16px;">Activo</label>'+
    '<select id="cActivo">'+
      '<option value="1"'+(!c||c.activo!==false?' selected':'')+'>Sí — visible en el catálogo del alumno</option>'+
      '<option value="0"'+(c&&c.activo===false?' selected':'')+'>No — oculto</option>'+
    '</select>'+

    '<div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">'+
      (c?'<button class="btn warn sm" onclick="borrarCurso(&quot;'+c.id+'&quot;);cerrarModal(&quot;modalCurso&quot;);">Eliminar</button>':'')+
      '<button class="btn sec" onclick="cerrarModal(&quot;modalCurso&quot;)">Cancelar</button>'+
      '<button class="btn" onclick="guardarCurso(&quot;'+(c&&c.id||'')+'&quot;)">Guardar</button>'+
    '</div>'+
    '</div>';
  playModal(); document.body.appendChild(overlay);

  const videosIniciales = (c && c.videos) || [];
  if (videosIniciales.length) videosIniciales.forEach(v=>cursoAgregarFilaVideo(v.titulo, v.url));
  else cursoAgregarFilaVideo();
}

function cursoAgregarFilaVideo(titulo, url){
  const cont = $('cVideosLista');
  if (!cont) return;
  const fila = document.createElement('div');
  fila.style.cssText = 'display:flex;gap:8px;align-items:center;';
  fila.innerHTML =
    '<input type="text" class="cv-titulo" placeholder="Título del vídeo" value="'+esc(titulo||'')+'" style="flex:1;">'+
    '<input type="text" class="cv-url" placeholder="URL (YouTube/Vimeo/archivo)" value="'+esc(url||'')+'" style="flex:2;">'+
    '<button type="button" class="btn sm warn" onclick="this.parentElement.remove()">×</button>';
  cont.appendChild(fila);
}

/* SVG embebido (data URI, sin request externo) usado como portada de
   respaldo cuando una imagen de Drive no carga. */
const CX_IMG_FALLBACK_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">'+
  '<rect width="400" height="600" fill="#141414"/>'+
  '<text x="200" y="285" text-anchor="middle" font-family="sans-serif" font-size="52" fill="#3a3a3a">🎓</text>'+
  '<text x="200" y="326" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#666">Imagen no disponible</text>'+
  '</svg>'
);
/* Portadas de Cursos Exclusivos: 100% Google Drive, cero archivos subidos al
   servidor local. El admin pega el link "compartir" tal cual Drive lo da
   (vista, "open?id=", "uc?id=", etc.) y esto lo normaliza al único formato
   que funciona embebido en una <img> sin forzar descarga ni mostrar la UI
   de Drive: https://lh3.googleusercontent.com/d/ID. Si no reconoce ningún
   patrón de Drive (el admin pegó otra URL directa cualquiera) la deja tal
   cual — así no se rompe si algún día se usa otro hosting de imágenes. */
function convertirUrlDriveAImagenDirecta(url){
  const u = (url||'').trim();
  if (!u) return '';
  const patrones = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/uc\?(?:export=\w+&)?id=([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/thumbnail\?id=([a-zA-Z0-9_-]+)/,
    /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/
  ];
  for (const re of patrones){
    const m = u.match(re);
    // lh3.googleusercontent.com/d/ID + referrerPolicy="no-referrer" en las
    // <img> (ver cxImgFallback y las tarjetas de curso): el motivo por el
    // que cargaba en localhost pero no en el portal real/móvil es que Drive
    // aplica su protección de hotlinking según el header Referer que manda
    // el navegador — sin no-referrer, ese header cambiaba según el host
    // desde el que se accedía y Drive lo bloqueaba en unos casos sí y en
    // otros no. Con no-referrer no se manda Referer nunca, así que el
    // comportamiento es el mismo sin importar el dominio/dispositivo.
    if (m && m[1]) return 'https://lh3.googleusercontent.com/d/'+m[1];
  }
  return u;
}
function procesarPortadaUrlCurso(input){
  const directa = convertirUrlDriveAImagenDirecta(input.value);
  if (directa !== input.value) input.value = directa;
  const preview = $('cPortadaPreview');
  if (!preview) return;
  preview.innerHTML = directa
    ? '<img src="'+esc(directa)+'" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">'
    : '<span style="color:var(--muted);font-size:10px;text-align:center;padding:4px;">Sin imagen</span>';
}
/* Fallback compartido para CUALQUIER <img> de portada de curso (preview del
   Admin, tarjetas del Reel, catálogo completo, Ver como alumno): si el link
   de Drive falla (archivo no compartido públicamente, ID inválido, archivo
   borrado), reemplaza el src por un placeholder propio en vez de dejar el
   ícono roto del navegador. dataset.cxFallback evita loop si el propio
   placeholder llegara a fallar. */
function cxImgFallback(img){
  if (img.dataset.cxFallback) return;
  img.dataset.cxFallback = '1';
  img.onerror = null;
  img.src = CX_IMG_FALLBACK_SVG;
}

function filtrarCAlumnos(q){
  const query = (q||'').toLowerCase().trim();
  document.querySelectorAll('#cAlumnosGrid .c-alumno-lbl').forEach(function(lbl){
    lbl.style.display = (!query || (lbl.dataset.nombre||'').includes(query)) ? 'flex' : 'none';
  });
}

async function guardarCurso(id){
  const nombre = $('cNombre').value.trim();
  if (!nombre){ alert('El nombre es obligatorio.'); return; }
  const videos = [...document.querySelectorAll('#cVideosLista > div')].map((fila,i)=>({
    titulo: fila.querySelector('.cv-titulo').value.trim(),
    url: fila.querySelector('.cv-url').value.trim(),
    orden: i+1
  })).filter(v=>v.titulo || v.url);
  const alumnosSeleccionados = [...document.querySelectorAll('#cAlumnosGrid input.c-alumno-chk:checked')].map(i=>i.value);

  const data = {
    nombre,
    ritmo: $('cRitmo').value,
    subcategoria: $('cSubcategoria').value.trim(),
    nivel: $('cNivel').value.trim(),
    duracion: $('cDuracion').value.trim(),
    imagenPortada: convertirUrlDriveAImagenDirecta($('cPortadaUrl').value),
    activo: $('cActivo').value==='1',
    videos
  };
  if (!id) data.orden = ((db.cursos||[]).length||0)+1;

  try {
    let cursoId = id;
    if (id){ await apiJSON('PUT',`/api/cursos/${id}`,data); }
    else { const r = await apiJSON('POST','/api/cursos',data); cursoId = r.curso.id; }

    // Sincronizar accesos internos (alumnos de la academia) — misma lógica
    // que usa el panel "👥 Alumnos" (sincronizarAlumnosAccesoCurso), para
    // no mantener el diff duplicado en dos lugares.
    await sincronizarAlumnosAccesoCurso(cursoId, alumnosSeleccionados);

    cerrarModal('modalCurso');
    await cargarDB(); renderView('videos');
    confirmSave('Curso guardado');
  } catch(e){ alert('Error: '+e.message); }
}

async function borrarCurso(id){
  if (!confirm('¿Eliminar este curso? Los alumnos que lo tenían asignado perderán el acceso.')) return;
  await apiJSON('DELETE',`/api/cursos/${id}`);
  await cargarDB(); renderView('videos');
}

/* ══════════════════════════════════════════════════════════════════════
   "👥 Alumnos" de un Curso Exclusivo — panel aparte de "Editar" con dos
   partes: 1) tildar/destildar alumnos de la academia (user.cursosAsignados
   + cursosVencimientos, vigencia de 1 año) y 2) generar enlaces de UN SOLO
   USO para gente de AFUERA que pagó el curso en persona (efectivo/en
   mano) — sin pasarela de pago de por medio. El admin genera el enlace
   vacío (sin pedir datos) y se lo pasa él mismo al comprador; recién
   cuando esa persona lo abre y completa su nombre+teléfono se crea su
   cuenta y el enlace se quema para siempre (no se puede volver a usar).
   ══════════════════════════════════════════════════════════════════════ */
async function abrirModalAlumnosCurso(cursoId){
  const c = (db.cursos||[]).find(x=>x.id===cursoId);
  if (!c) return;

  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalAlumnosCurso';
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:640px;">'+
    '<h3 class="modal-title">👥 Alumnos · '+esc(c.nombre)+'</h3>'+

    '<details class="ca-section" open style="margin-bottom:14px;">'+
      '<summary style="cursor:pointer;font-weight:700;font-size:13.5px;color:var(--text);padding:6px 0;">Alumnos de la academia</summary>'+
      '<p style="color:var(--muted);font-size:12px;margin:2px 0 8px;">Tildá a quién le desbloqueás este curso (vigencia de 1 año desde que guardás). Incluye alumnos inactivos.</p>'+
      '<div id="caAlumnosGrid" style="display:flex;flex-direction:column;gap:2px;max-height:180px;overflow-y:auto;'+
        'padding:8px;margin-bottom:8px;border:1px solid var(--card-border);border-radius:8px;"></div>'+
      '<div style="display:flex;justify-content:flex-end;">'+
        '<button class="btn sm" onclick="caGuardarAlumnosInternos(\''+c.id+'\')">Guardar alumnos</button>'+
      '</div>'+
    '</details>'+

    '<details class="ca-section" open>'+
      '<summary style="cursor:pointer;font-weight:700;font-size:13.5px;color:var(--text);padding:6px 0;">Compradores externos</summary>'+
      '<p style="color:var(--muted);font-size:12px;margin:2px 0 8px;">'+
        'Para clientes que NO son alumnos de la academia (pagaron en persona, o se los regalás). '+
        'Generá un enlace de un solo uso y pasáselo (WhatsApp, en mano). Al abrirlo, esa persona completa su nombre y '+
        'teléfono y queda con acceso directo a SOLO este curso durante 1 año; el enlace se quema apenas lo usa.</p>'+
      '<div style="display:flex;justify-content:flex-start;margin-bottom:8px;">'+
        '<button class="btn sm" onclick="caGenerarAccesoExterno(\''+c.id+'\')">+ Generar enlace de un solo uso</button>'+
      '</div>'+
      '<div id="caLinkGenerado"></div>'+
      '<div id="caAccesosLista" style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;margin-top:8px;">'+
        '<p style="color:var(--muted);font-size:13px;">Cargando…</p></div>'+
      '<div id="caRevocadosWrap" style="margin-top:8px;"></div>'+
    '</details>'+

    '<div style="display:flex;justify-content:flex-end;margin-top:20px;">'+
      '<button class="btn sec" onclick="cerrarModal(&quot;modalAlumnosCurso&quot;); caDetenerPolling();">Cerrar</button>'+
    '</div>'+
    '</div>';
  playModal(); document.body.appendChild(overlay);

  const estudiantes = (db.users||[]).filter(u=>u.role==='student')
    .slice().sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  const grid = $('caAlumnosGrid');
  grid.innerHTML = estudiantes.length
    ? estudiantes.map(u=>{
        const tieneAcceso = (u.cursosAsignados||[]).includes(c.id);
        const inactivo = u.active===false;
        return '<label style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;cursor:pointer;'+
          'background:'+(tieneAcceso?'rgba(226,144,35,.09)':'transparent')+';'+(inactivo?'opacity:.55;':'')+'">'+
          '<input type="checkbox" class="ca-alumno-chk" value="'+u.id+'" style="width:auto;accent-color:var(--gold);"'+(tieneAcceso?' checked':'')+'>'+
          '<span style="font-size:12.5px;">'+esc(u.nombre)+(inactivo?' <span style="color:var(--muted);">(inactivo)</span>':'')+'</span>'+
          '</label>';
      }).join('')
    : '<p style="color:var(--muted);font-size:13px;">Sin alumnos registrados todavía.</p>';

  await caCargarAccesosExternos(c.id);
  caIniciarPolling(c.id);
}

/* Mientras el modal de "Alumnos" está abierto, refresca sola la lista de
   compradores externos cada 5s — así, si alguien canjea un enlace pendiente
   justo en ese momento (completa nombre+teléfono desde curso-acceso.html),
   el enlace desaparece de "pendiente" y la persona aparece ya en la lista
   de activos sin que el admin tenga que hacer nada ni reabrir el modal. */
let _caPollTimer = null;
function caDetenerPolling(){
  if (_caPollTimer){ clearInterval(_caPollTimer); _caPollTimer = null; }
}
function caIniciarPolling(cursoId){
  caDetenerPolling();
  _caPollTimer = setInterval(()=>{
    if (!document.getElementById('modalAlumnosCurso')){ caDetenerPolling(); return; }
    caCargarAccesosExternos(cursoId);
  }, 5000);
}

async function caGuardarAlumnosInternos(cursoId){
  const seleccionados = [...document.querySelectorAll('#caAlumnosGrid input.ca-alumno-chk:checked')].map(i=>i.value);
  try {
    await sincronizarAlumnosAccesoCurso(cursoId, seleccionados);
    confirmSave('Alumnos actualizados');
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

/* Compara contra el cursosAsignados actual de cada alumno y solo escribe
   a los que realmente cambiaron. La usa tanto guardarCurso (Editar curso)
   como este panel de Alumnos — un único lugar para no desincronizar la
   lógica entre los dos. Al tildar, además de cursosAsignados se fija
   cursosVencimientos[cursoId] = ahora+1 año; al destildar se lo borra. */
async function sincronizarAlumnosAccesoCurso(cursoId, alumnosSeleccionados){
  const estudiantes = (db.users||[]).filter(u=>u.role==='student');
  const cambios = estudiantes.map(u=>{
    const tenia = (u.cursosAsignados||[]).includes(cursoId);
    const debeTener = alumnosSeleccionados.includes(u.id);
    if (tenia === debeTener) return null;
    const nuevosAsignados = debeTener
      ? [...(u.cursosAsignados||[]), cursoId]
      : (u.cursosAsignados||[]).filter(cid=>cid!==cursoId);
    const nuevosVencimientos = Object.assign({}, u.cursosVencimientos||{});
    if (debeTener) {
      const v = new Date(); v.setFullYear(v.getFullYear()+1);
      nuevosVencimientos[cursoId] = v.toISOString();
    } else {
      delete nuevosVencimientos[cursoId];
    }
    return apiJSON('PUT',`/api/users/${u.id}`,{cursosAsignados:nuevosAsignados,cursosVencimientos:nuevosVencimientos}).then(()=>{
      u.cursosAsignados = nuevosAsignados; u.cursosVencimientos = nuevosVencimientos;
    });
  }).filter(Boolean);
  await Promise.all(cambios);
}

/* Solo puede haber un enlace pendiente vivo por curso (el backend invalida
   el anterior sin usar al generar uno nuevo), así que alcanza con recargar
   la lista: caCargarAccesosExternos ya se encarga de pintar el enlace
   pendiente en #caLinkGenerado. */
async function caGenerarAccesoExterno(cursoId){
  try {
    await apiJSON('POST',`/api/cursos/${cursoId}/accesos-externos`,{});
    await caCargarAccesosExternos(cursoId);
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

/* navigator.clipboard solo existe en contexto seguro (HTTPS o localhost);
   si el panel se accede por HTTP plano en la red local (típico en una
   mini PC sin proxy HTTPS todavía), cae a un <textarea> temporal +
   document.execCommand('copy') para que "Copiar" funcione igual. */
function caCopiarLink(btn, link){
  const marcarCopiado = () => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copiado';
    setTimeout(()=>{ btn.textContent = orig; }, 1800);
  };
  if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext){
    navigator.clipboard.writeText(link).then(marcarCopiado)
      .catch(()=>caCopiarLinkFallback(link, marcarCopiado));
  } else {
    caCopiarLinkFallback(link, marcarCopiado);
  }
}

function caCopiarLinkFallback(link, onOk){
  try {
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) onOk();
    else showToast('No se pudo copiar — seleccioná el texto a mano.','warn');
  } catch(e){ showToast('No se pudo copiar — seleccioná el texto a mano.','warn'); }
}

function caPintarLinkPendiente(pendiente, cursoId){
  const cont = $('caLinkGenerado');
  if (!cont) return;
  if (!pendiente){ cont.innerHTML = ''; return; }
  const link = pendiente.link;
  const curso = (db.cursos||[]).find(c=>c.id===cursoId);
  const nombreCurso = curso ? curso.nombre : '';
  cont.innerHTML =
    '<div style="background:rgba(226,144,35,.08);border:1px solid var(--card-border);border-radius:8px;padding:10px 12px;margin-bottom:10px;">'+
    '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Enlace de un solo uso pendiente — copialo o mandalo por WhatsApp. Se quema apenas la persona lo usa; generar otro invalida este.</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'+
      '<input type="text" readonly value="'+esc(link)+'" style="flex:1;min-width:200px;font-size:12px;" onclick="this.select()">'+
      '<button class="btn sm sec" onclick="caCopiarLink(this,\''+esc(link).replace(/'/g,"\\'")+'\')">📋 Copiar</button>'+
      '<button class="btn sm sec" onclick="caCompartirLinkWhatsApp(\''+esc(link).replace(/'/g,"\\'")+'\',\''+esc(nombreCurso).replace(/'/g,"\\'")+'\')">💬 WhatsApp</button>'+
      '<button class="btn sm warn" onclick="caCancelarPendiente(\''+pendiente.id+'\',\''+cursoId+'\')">Cancelar</button>'+
    '</div></div>';
}

/* Arma el mensaje de WhatsApp: texto corto y prolijo con el nombre del
   curso, y el enlace en su propia línea al final. WhatsApp NO permite que
   un texto elegido (p.ej. "Acceso a tu curso") sea el link clicable
   ocultando la URL real — solo la URL en sí queda clicable en un mensaje
   de texto plano. Por eso el link ahora es el más corto posible
   (dominio + "/c/" + token, generado en server.js) para que quepa en una
   sola línea aun en pantallas chicas, en vez de intentar (imposible)
   esconderlo detrás de otro texto. */
function caCompartirLinkWhatsApp(link, nombreCurso){
  const msg = nombreCurso
    ? '✨ Acceso a tu curso de *'+nombreCurso+'*\nMalevo Academia — enlace de un solo uso:\n'+link
    : '✨ Acceso a tu curso\nMalevo Academia — enlace de un solo uso:\n'+link;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

/* Lista prolija: arriba el enlace pendiente (si hay uno), después SOLO los
   compradores externos con acceso activo. Los revocados quedan aparte, en
   un desplegable cerrado, para no ensuciar la vista principal. */
async function caCargarAccesosExternos(cursoId){
  const cont = $('caAccesosLista');
  const revWrap = $('caRevocadosWrap');
  if (!cont) return;
  try {
    const lista = await apiJSON('GET',`/api/accesos-cursos?cursoId=${cursoId}`);
    const pendiente = lista.find(a=>a.estado==='pendiente') || null;
    const activos = lista.filter(a=>a.estado==='activo');
    const revocados = lista.filter(a=>a.estado==='revocado');

    caPintarLinkPendiente(pendiente, cursoId);

    cont.innerHTML = activos.length
      ? activos.map(a=>caFilaCompradorHtml(a, cursoId)).join('')
      : '<p style="color:var(--muted);font-size:13px;">Todavía no hay compradores externos activos.</p>';

    if (revWrap){
      revWrap.innerHTML = revocados.length
        ? '<details><summary style="cursor:pointer;color:var(--muted);font-size:12px;">Revocados ('+revocados.length+')</summary>'+
          '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">'+
            revocados.map(a=>caFilaCompradorHtml(a, cursoId)).join('')+
          '</div></details>'
        : '';
    }
  } catch(e){ cont.innerHTML = '<p style="color:var(--muted);font-size:13px;">Error al cargar: '+esc(e.message)+'</p>'; }
}

function caFilaCompradorHtml(a, cursoId){
  const caducado = a.expira && new Date(a.expira) < new Date();
  const estado = !a.activo ? 'Revocado' : (caducado ? 'Caducado' : 'Activo');
  const colorEstado = !a.activo ? 'var(--muted)' : (caducado ? 'var(--warn)' : 'var(--gold)');
  const fecha = new Date(a.fecha).toLocaleDateString('es-ES');
  const expira = a.expira ? new Date(a.expira).toLocaleDateString('es-ES') : '—';
  return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--card-border);border-radius:8px;">'+
    '<div style="flex:1;min-width:0;">'+
      '<div style="font-size:13px;font-weight:600;">'+esc(a.nombre||'')+'</div>'+
      '<div style="font-size:11.5px;color:var(--muted);">'+(a.telefono?esc(a.telefono)+' · ':'')+'Ingresó '+fecha+' · Vence '+expira+'</div>'+
    '</div>'+
    '<span style="font-size:11px;font-weight:700;color:'+colorEstado+';white-space:nowrap;">'+estado+'</span>'+
    (!a.activo
      ? '<button class="btn sm sec" onclick="caToggleAcceso(\''+a.id+'\',true,\''+cursoId+'\')">Reactivar</button>'
      : '<button class="btn sm warn" onclick="caToggleAcceso(\''+a.id+'\',false,\''+cursoId+'\')">Revocar</button>')+
  '</div>';
}

async function caCancelarPendiente(accesoId, cursoId){
  if (!confirm('¿Cancelar este enlace? Dejará de funcionar y habrá que generar uno nuevo.')) return;
  try {
    await apiJSON('PUT',`/api/accesos-cursos/${accesoId}`,{invalidar:true});
    await caCargarAccesosExternos(cursoId);
    showToast('Enlace cancelado','ok');
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

async function caToggleAcceso(accesoId, activo, cursoId){
  if (!activo && !confirm('¿Revocar este acceso? La persona ya no podrá ver el curso hasta que lo reactives.')) return;
  try {
    await apiJSON('PUT',`/api/accesos-cursos/${accesoId}`,{activo});
    await caCargarAccesosExternos(cursoId);
    showToast(activo?'Acceso reactivado':'Acceso revocado','ok');
  } catch(e){ showToast('Error: '+e.message,'warn'); }
}

function abrirModalVideo(id, presetDisc, presetNivel, presetTipo){
  const v=id?(db.videos||[]).find(x=>x.id===id):null;
  const tipo = (v&&v.tipo) || presetTipo || 'clase';
  const discOpts=DISCIPLINAS_VIDEO.map(function(d){
    return '<option value="'+d+'"'+(((v&&v.disciplina)||presetDisc||'Bachata')===d?' selected':'')+'>'+d+'</option>';
  }).join('');
  const nivelOpts=NIVELES.map(function(n){
    return '<option value="'+n+'"'+(((v&&v.nivel)||presetNivel||1)==n?' selected':'')+'>'+nivelLabel(n)+'</option>';
  }).join('');
  let notasEvento={}; if (v&&v.tipo==='evento'){ try{ notasEvento=JSON.parse(v.notas||'{}'); }catch{} }

  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.id='modalVideo';
  overlay.innerHTML=
    '<div class="modal-box">'+
    '<h3 class="modal-title">'+(v?'Editar contenido':'Nuevo contenido')+'</h3>'+

    '<label class="label-field">Tipo de contenido</label>'+
    '<select id="vTipo" onchange="avToggleTipoVideo()">'+
      '<option value="clase"'+(tipo==='clase'?' selected':'')+'>🎬 Clase de nivel</option>'+
      '<option value="calentamiento"'+(tipo==='calentamiento'?' selected':'')+'>🔥 Calentamiento / estiramiento</option>'+
      '<option value="bonus"'+(tipo==='bonus'?' selected':'')+'>🎁 Bonus (desbloqueo dinámico 2x2)</option>'+
      '<option value="evento"'+(tipo==='evento'?' selected':'')+'>🎉 Evento / Taller presencial</option>'+
    '</select>'+

    '<label class="label-field">Título *</label>'+
    '<input type="text" id="vTitulo" value="'+esc(v&&v.titulo||'')+'" placeholder="Ej: Bachata básica — paso básico">'+

    // Disciplina + Nivel (clase, bonus)
    '<div class="g2" id="vGrupoDiscNivel">'+
      '<div><label class="label-field">Disciplina</label>'+
        '<select id="vDisc" onchange="avRecalcularOrden()">'+discOpts+'</select></div>'+
      '<div><label class="label-field">Nivel</label>'+
        '<select id="vNivel" onchange="avRecalcularOrden()">'+nivelOpts+'</select></div>'+
    '</div>'+

    // URL (clase, calentamiento, bonus) / Imagen o vídeo (evento)
    '<label class="label-field" id="vUrlLabel">URL del vídeo</label>'+
    '<input type="text" id="vUrl" value="'+esc(v&&v.url||'')+'" placeholder="https://www.youtube.com/embed/…">'+
    '<small style="color:var(--muted);font-size:11.5px;margin-top:6px;display:block;" id="vUrlHint">'+
      'YouTube: youtube.com/embed/VIDEO_ID · Archivos locales: /videos/nombre.mp4</small>'+

    // Notas (clase, calentamiento, bonus)
    '<label class="label-field" id="vNotasLabel">Notas pedagógicas</label>'+
    '<textarea id="vNotas" rows="2" placeholder="Descripción, objetivos…">'+esc(v&&v.tipo!=='evento'?(v.notas||''):'')+'</textarea>'+

    // Orden: se calcula solo (siguiente puesto libre del nivel al crear;
    // al editar se conserva el que ya tenía, sin volver a preguntar)
    '<input type="hidden" id="vOrden" value="'+(v?v.orden||1:1)+'" data-editando="'+(v?'1':'0')+'">'+

    // Campos exclusivos de Evento
    '<div id="vGrupoEvento" style="display:none;">'+
      '<label class="label-field">Categoría</label>'+
      '<select id="vEvCategoria">'+
        '<option value="evento"'+((notasEvento.categoria||'evento')==='evento'?' selected':'')+'>📅 Evento (público, se pinta cian en el calendario)</option>'+
        '<option value="taller"'+(notasEvento.categoria==='taller'?' selected':'')+'>👥 Taller (público, se pinta fucsia en el calendario)</option>'+
      '</select>'+
      '<label class="label-field">Fecha del evento</label>'+
      '<input type="date" id="vEvFecha" value="'+esc(notasEvento.fecha||'')+'">'+
      '<label class="label-field">Descripción</label>'+
      '<textarea id="vEvDescripcion" rows="2" placeholder="Qué se va a practicar, quién lo imparte…">'+esc(notasEvento.descripcion||'')+'</textarea>'+

      '<label class="label-field">Imagen del evento</label>'+
      '<select id="vEvFuente" onchange="avToggleFuenteEvento()">'+
        '<option value="upload"'+(!notasEvento.tipoImagen||notasEvento.tipoImagen==='upload'?' selected':'')+'>📁 Subir imagen (JPG/PNG)</option>'+
        '<option value="youtube"'+(notasEvento.tipoImagen==='youtube'?' selected':'')+'>🔗 Enlace de YouTube</option>'+
      '</select>'+

      '<div id="vEvUploadWrap" style="margin-top:10px;display:flex;align-items:center;gap:14px;">'+
        '<div id="vEvPreview" style="width:96px;height:64px;border-radius:8px;overflow:hidden;flex:0 0 auto;'+
          'background:rgba(255,255,255,.04);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center;">'+
          (v&&v.tipo==='evento'&&(!notasEvento.tipoImagen||notasEvento.tipoImagen==='upload')&&v.url
            ? '<img src="'+esc(v.url)+'" style="width:100%;height:100%;object-fit:cover;">'
            : '<span style="color:var(--muted);font-size:10px;text-align:center;padding:4px;">Sin imagen</span>')+
        '</div>'+
        '<label class="btn sec sm" style="cursor:pointer;">📁 Elegir archivo'+
          '<input type="file" accept="image/jpeg,image/png" style="display:none;" onchange="previsualizarImagenEvento(this)">'+
        '</label>'+
      '</div>'+
      '<input type="hidden" id="vEvImgData" value="'+(v&&v.tipo==='evento'&&(!notasEvento.tipoImagen||notasEvento.tipoImagen==='upload')?esc(v.url||''):'')+'">'+

      '<div id="vEvYoutubeWrap" style="display:none;margin-top:10px;">'+
        '<input type="text" id="vEvYoutubeUrl" value="'+(v&&v.tipo==='evento'&&notasEvento.tipoImagen==='youtube'?esc(v.url||''):'')+'" placeholder="https://www.youtube.com/watch?v=…">'+
      '</div>'+
    '</div>'+

    '<div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;">'+
      (v?'<button class="btn warn sm" onclick="borrarVideo(&quot;'+v.id+'&quot;);cerrarModal(&quot;modalVideo&quot;);">Eliminar</button>':'')+
      '<button class="btn sec" onclick="cerrarModal(&quot;modalVideo&quot;)">Cancelar</button>'+
      '<button class="btn" onclick="guardarVideo(&quot;'+(v&&v.id||'')+'&quot;)">Guardar</button>'+
    '</div>'+
    '</div>';
  playModal(); document.body.appendChild(overlay);
  avToggleTipoVideo();
}

/* ── Muestra/oculta campos del modal de contenido según el tipo elegido ── */
function avToggleTipoVideo(){
  const tipo=$('vTipo')?.value||'clase';
  const show=(id,disp)=>{ const el=$(id); if(el) el.style.display=disp; };
  const label={
    clase:'URL del vídeo', calentamiento:'URL del vídeo', taller:'URL del vídeo',
    evento:'URL de la imagen (flyer)'
  }[tipo];
  if ($('vUrlLabel')) $('vUrlLabel').textContent=label;
  show('vUrlHint', tipo==='clase'||tipo==='calentamiento'||tipo==='bonus' ? 'block':'none');

  // El campo URL genérico solo aplica a clase/calentamiento/taller — evento usa su propio bloque de imagen
  show('vUrlLabel', tipo==='evento' ? 'none':'block');
  const urlInput=$('vUrl'); if (urlInput) urlInput.style.display = tipo==='evento' ? 'none':'block';

  show('vGrupoDiscNivel', tipo==='clase'||tipo==='bonus' ? 'grid':'none');
  show('vNotasLabel', tipo==='evento' ? 'none':'block');
  const notas=$('vNotas'); if (notas) notas.style.display = tipo==='evento' ? 'none':'block';
  show('vGrupoEvento', tipo==='evento' ? 'block':'none');
  if (tipo==='evento') avToggleFuenteEvento();
  if (tipo==='clase') avRecalcularOrden();
}

/* ── Calcula automáticamente el siguiente puesto libre en el nivel al crear
   un vídeo nuevo (no se toca si se está editando uno ya existente) ── */
function avRecalcularOrden(){
  const ordenInput=$('vOrden');
  if (!ordenInput || ordenInput.dataset.editando==='1') return; // editando: no recalcular
  const disc=$('vDisc')?.value, nivel=parseInt($('vNivel')?.value);
  const siguiente=(db.videos||[]).filter(v=>v.disciplina===disc&&v.nivel===nivel&&(!v.tipo||v.tipo==='clase')).length+1;
  ordenInput.value=siguiente;
}

/* ── Alterna entre "subir imagen" y "enlace de YouTube" para el flyer del evento ── */
function avToggleFuenteEvento(){
  const fuente=$('vEvFuente')?.value||'upload';
  if ($('vEvUploadWrap'))   $('vEvUploadWrap').style.display   = fuente==='upload'  ? 'flex':'none';
  if ($('vEvYoutubeWrap'))  $('vEvYoutubeWrap').style.display  = fuente==='youtube' ? 'block':'none';
}

/* ── Sube y previsualiza la imagen del flyer (JPG/PNG, máx. 2 MB) ── */
function previsualizarImagenEvento(input){
  const file=input.files[0]; if (!file) return;
  if (file.size > 2*1024*1024){ showToast('La imagen supera los 2 MB','warn'); input.value=''; return; }
  const reader=new FileReader();
  reader.onload = e=>{
    const src=e.target.result;
    const preview=$('vEvPreview');
    if (preview) preview.innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`;
    const hidden=$('vEvImgData'); if (hidden) hidden.value=src;
  };
  reader.readAsDataURL(file);
}

async function guardarVideo(id){
  const titulo=$('vTitulo').value.trim();
  if (!titulo){alert('El título es obligatorio.');return;}
  const tipo=$('vTipo').value;
  let data={titulo, tipo};

  if (tipo==='evento'){
    const fuente=$('vEvFuente').value;
    const urlImagen = fuente==='youtube' ? $('vEvYoutubeUrl').value.trim() : $('vEvImgData').value;
    if (!urlImagen){ alert('Añade una imagen (JPG) o un enlace de YouTube para el evento.'); return; }
    data.url=urlImagen;
    data.disciplina='General'; data.nivel=0; data.orden=1;
    data.notas=JSON.stringify({
      fecha:$('vEvFecha').value||'',
      descripcion:$('vEvDescripcion').value.trim(),
      tipoImagen: fuente,
      categoria: $('vEvCategoria')?.value||'evento'
    });
  } else {
    data.url=$('vUrl').value.trim();
    if (tipo==='clase'||tipo==='bonus'){
      data.disciplina=$('vDisc').value;
      data.nivel=parseInt($('vNivel').value);
    } else {
      // calentamiento: sin disciplina/nivel específicos
      data.disciplina='General'; data.nivel=0;
    }
    if (tipo==='clase'){
      data.orden=parseInt($('vOrden').value)||1;
      data.notas=$('vNotas').value.trim();
    } else {
      data.orden=1;
      data.notas=$('vNotas').value.trim();
    }
  }

  try {
    if (id){ await apiJSON('PUT',`/api/videos/${id}`,data); }
    else { await apiJSON('POST','/api/videos',data); }
    cerrarModal('modalVideo');
    await cargarDB(); renderView('videos');
    confirmSave(tipo==='evento' ? 'Evento guardado' : 'Contenido guardado');
  } catch(e){ alert('Error: '+e.message); }
}

async function borrarVideo(id){
  if (!confirm('¿Eliminar este vídeo?')) return;
  await apiJSON('DELETE',`/api/videos/${id}`);
  await cargarDB(); renderView('videos');
}

/* ── Siembra automática del catálogo oficial de YouTube (Bachata/Salsa · Nivel 1-3) ──
   Se ejecuta sola al arrancar la app (arrancarApp), sin botón ni confirmación.
   Es idempotente: solo crea las entradas que todavía no existan (misma
   disciplina+nivel+url), así en cada arranque comprueba y no duplica nada. */
async function sembrarCatalogoOficialVideos(){
  if (!db) return;
  const DISC_MAP = { bachata:'Bachata', salsa:'Salsa' };
  const existentes = new Set(
    (db.videos||[]).map(v => `${v.disciplina}|${v.nivel}|${v.url}`)
  );

  const nuevos = [];
  Object.entries(CATALOGO_OFICIAL_VIDEOS).forEach(([discKey, niveles])=>{
    const disciplina = DISC_MAP[discKey] || discKey;
    Object.entries(niveles).forEach(([nivelKey, ids])=>{
      const nivel = parseInt(nivelKey.replace('nivel',''),10);
      ids.forEach((vid, i)=>{
        const url = `https://www.youtube.com/embed/${vid}`;
        const clave = `${disciplina}|${nivel}|${url}`;
        if (existentes.has(clave)) return; // ya sembrado en un arranque anterior
        existentes.add(clave);
        nuevos.push({
          titulo: `${disciplina} · Nivel ${nivel} · Clase ${i+1}`,
          disciplina, nivel, url,
          notas: '',
          orden: i+1
        });
      });
    });
  });

  if (!nuevos.length) return; // ya está todo sembrado, no hay nada que hacer

  try {
    for (const data of nuevos){ await apiJSON('POST','/api/videos',data); }
    await cargarDB(); // refrescar db.videos con los ids reales que asigna el servidor
  } catch(e){
    console.error('No se pudo sembrar el catálogo oficial de vídeos:', e);
  }
}

/* ── Vista INFORMES ── */
function renderInformes(cont){
  const mes=mesActual();
  cont.innerHTML=`<div class="h2">◷ Informes</div>
  <div class="stats-grid" id="dashCards"></div>
  <div class="card" style="margin-bottom:16px;">
    <div class="h2">Resumen por rango</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
      <div><label class="label-field">Desde</label><input type="month" id="infDesde" value="${mes}" style="width:160px;"></div>
      <div><label class="label-field">Hasta</label><input type="month" id="infHasta" value="${mes}" style="width:160px;"></div>
      <button class="btn" onclick="calcInforme()">Calcular</button>
    </div>
    <div id="resultInforme" style="margin-top:14px;"></div>
  </div>
  <div class="card">
    <div class="h2">Exportar</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn sec" onclick="exportCSV()">⬇ Pagos CSV</button>
      <button class="btn sec" onclick="exportBackup()">⬇ Copia JSON</button>
    </div>
  </div>`;
  const t=totalesMes(mes);
  const activos=(db.users||[]).filter(u=>u.active&&u.role==='student').length;
  $('dashCards').innerHTML=
    statCard('Alumnos activos',activos,'var(--gold)')+
    statCard('Pagos este mes',t.num,'var(--text-2)')+
    statCard('Total cobrado',eur(t.cobrado),'var(--ok)')+
    statCard('IVA a liquidar',eur(t.iva),'var(--warn)');
}

function totalesMes(mes){
  const t={cobrado:0,iva:0,base:0,malevo:0,box:0,num:0};
  (db.payments||[]).filter(p=>p.mes===mes).forEach(p=>{
    const n=numPagoDeUsuario(p.userId,p.mes,p.id);
    const r=calcularReparto(p.importe||0,n);
    t.cobrado+=r.importe;t.iva+=r.iva;t.base+=r.base;t.malevo+=r.malevo;t.box+=r.box;t.num++;
  });
  return t;
}

function calcInforme(){
  const desde=$('infDesde').value, hasta=$('infHasta').value;
  if (!desde||!hasta){alert('Selecciona rango.');return;}
  const t={cobrado:0,iva:0,base:0,malevo:0,box:0,num:0};
  (db.payments||[]).filter(p=>p.mes>=desde&&p.mes<=hasta).forEach(p=>{
    const n=numPagoDeUsuario(p.userId,p.mes,p.id);
    const r=calcularReparto(p.importe||0,n);
    t.cobrado+=r.importe;t.iva+=r.iva;t.base+=r.base;t.malevo+=r.malevo;t.box+=r.box;t.num++;
  });
  $('resultInforme').innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:8px;">
    ${statCard('Pagos',t.num,'var(--text-2)')}
    ${statCard('Total cobrado',eur(t.cobrado),'var(--ok)')}
    ${statCard('IVA',eur(t.iva),'var(--warn)')}
    ${statCard('Base',eur(t.base),'var(--text-2)')}
    ${statCard('Malevo',eur(t.malevo),'var(--ok)')}
    ${statCard('The Box',eur(t.box),'var(--gold)')}
  </div>`;
}

function exportCSV(){
  const cab=['Mes','Alumno','FechaCobro','Cobrado','Base','IVA','Malevo','TheBox','Metodo'];
  const f=x=>(Math.round(x*100)/100).toString().replace('.',',');
  const rows=(db.payments||[]).sort((a,b)=>a.mes.localeCompare(b.mes)).map(p=>{
    const n=numPagoDeUsuario(p.userId,p.mes,p.id);
    const r=calcularReparto(p.importe||0,n);
    return [p.mes,nombreUsuario(p.userId),p.fechaPago,f(r.importe),f(r.base),f(r.iva),f(r.malevo),f(r.box),p.metodo||'']
      .map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';');
  });
  descargar(`pagos_malevo_${hoy()}.csv`,'\ufeff'+cab.join(';')+'\n'+rows.join('\n'),'text/csv;charset=utf-8');
}
function exportBackup(){ descargar(`backup_malevo_${hoy()}.json`,JSON.stringify(db,null,2),'application/json'); }
function descargar(nombre,contenido,tipo){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([contenido],{type:tipo}));
  a.download=nombre; a.click(); URL.revokeObjectURL(a.href);
}

/* ── Vista CONFIG ── */
function renderConfig(cont){
  const c=db.config;
  cont.innerHTML=`
  <div class="h2">⚙ Configuración</div>

  <!-- ── Pestañas de configuración ── -->
  <div style="display:flex;gap:3px;margin-bottom:22px;flex-wrap:wrap;" id="cfgTabsBar">
    ${['negocio','tarifas','resumen','reparto','gestora','reset'].map(function(t,i){
      const labels={negocio:'🏢 Negocio',tarifas:'💰 Tarifas',resumen:'📊 Resumen',reparto:'⇄ Reparto con The Box',gestora:'📋 Gestora',reset:'⚠ Reset'};
      return '<button onclick="cfgTab(\'' + t + '\')" data-cfgtab="' + t + '"'
        + ' style="padding:9px 20px;border-radius:30px;border:1px solid var(--card-border);'
        + ' background:' + (i===0?'var(--card-bg)':'rgba(255,255,255,.04)') + ';'
        + ' color:' + (i===0?'var(--gold-2)':'var(--muted)') + ';font-weight:' + (i===0?'600':'500') + ';'
        + ' box-shadow:' + (i===0?'0 2px 10px rgba(0,0,0,.4)':'none') + ';'
        + ' font-size:13px;font-family:inherit;cursor:pointer;transition:all .2s;'
        + '">'
        + labels[t]
        + '</button>';
    }).join('')}
  </div>

  <!-- ── Panel: Negocio ── -->
  <div id="cfgPanel-negocio" class="card" style="margin-bottom:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;margin-bottom:4px;color:var(--gold-2);">Datos fiscales del negocio</h3>
    <p style="color:var(--muted);font-size:12px;line-height:1.6;margin-bottom:20px;">
      Estos datos aparecen como cabecera emisor en todas las facturas. No deben incluir referencias a terceros.</p>

    <!-- Logo -->
    <label class="label-field">Logotipo (aparece en cabecera de facturas)</label>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:6px;flex-wrap:wrap;">
      <div id="logoPreview" style="width:96px;height:64px;border-radius:var(--r-sm);
        border:1px dashed var(--border-2);background:var(--surface-2);
        display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;">
        ${c.negocio?.logo
          ? `<img src="${c.negocio.logo}" style="max-width:100%;max-height:100%;object-fit:contain;">`
          : `<span style="color:var(--muted);font-size:11px;text-align:center;padding:6px;">Sin logo</span>`}
      </div>
      <div style="flex:1;min-width:180px;">
        <label style="display:inline-flex;align-items:center;gap:8px;padding:9px 16px;
          border-radius:var(--r-sm);border:1px solid var(--border-2);cursor:pointer;
          font-size:12.5px;font-weight:600;color:var(--text-2);background:var(--surface-2);
          transition:all .2s;"
          onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold-2)'"
          onmouseout="this.style.borderColor='var(--border-2)';this.style.color='var(--text-2)'">
          📁 Seleccionar imagen
          <input type="file" id="cfgLogoFile" accept="image/*" style="display:none;" onchange="previsualizarLogo(this)">
        </label>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;">PNG, JPG o SVG · Máx. 200 KB · Fondo claro recomendado</div>
        ${c.negocio?.logo ? `<button onclick="eliminarLogo()" class="btn sm sec warn"
          style="margin-top:6px;padding:5px 10px;font-size:11px;">✕ Eliminar logo</button>` : ''}
      </div>
    </div>
    <input type="hidden" id="cfgLogoData" value="${c.negocio?.logo ? '1' : ''}">

    <!-- Datos principales -->
    <label class="label-field">Nombre / Razón social *</label>
    <input type="text" id="cfgNombre" value="${esc(c.negocio?.nombre||'')}" placeholder="Ej: Academia de Baile Malevo">

    <div class="g2">
      <div>
        <label class="label-field">NIF / DNI *</label>
        <input type="text" id="cfgNif" value="${esc(c.negocio?.nif||'')}" placeholder="Ej: 12345678A">
      </div>
      <div>
        <label class="label-field">Teléfono de contacto</label>
        <input type="tel" id="cfgTelefono" value="${esc(c.negocio?.telefono||'')}" placeholder="Ej: 688 734 909">
      </div>
    </div>

    <label class="label-field">Email de contacto</label>
    <input type="email" id="cfgEmail" value="${esc(c.negocio?.email||'')}" placeholder="Ej: info@academiamalevo.com">

    <label class="label-field">Dirección fiscal completa</label>
    <input type="text" id="cfgDir" value="${esc(c.negocio?.direccion||'')}" placeholder="Ej: Calle Mayor 10, 28001 Madrid">

    <label class="label-field">Pie de factura (texto opcional)</label>
    <input type="text" id="cfgPie" value="${esc(c.negocio?.pie||'')}" placeholder="Ej: Gracias por bailar con nosotros 💃">

    <div style="margin-top:22px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <button class="btn" onclick="guardarNegocio()">Guardar datos fiscales</button>
      <small style="color:var(--muted);font-size:11.5px;">* Obligatorios para facturas válidas</small>
    </div>

    <!-- Enlace de invitación WhatsApp — dentro del panel Negocio -->
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);">
      <h3 style="font-family:'Sora',sans-serif;font-size:14px;font-weight:700;
        color:var(--gold-2);margin-bottom:4px;display:flex;align-items:center;gap:8px;">
        📲 Enviar enlace de acceso
        <span style="background:var(--ok-soft);color:var(--ok);border:1px solid rgba(226,144,35,.2);
          padding:2px 10px;border-radius:30px;font-size:10px;font-weight:600;letter-spacing:.3px;">
          Captación automática
        </span>
      </h3>
      <p style="color:var(--muted);font-size:12.5px;line-height:1.6;margin-bottom:14px;max-width:480px;">
        Copia este enlace y envíalo por WhatsApp a cualquier persona interesada.
        Al abrirlo, se registrará y realizará el primer pago antes de acceder a los contenidos.</p>

      <div id="inviteLinkWrap" style="display:none;">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">
          <input type="text" id="inviteLink" readonly
            style="background:rgba(226,144,35,.06);border-color:rgba(226,144,35,.25);
              color:var(--gold-light);font-size:12.5px;cursor:pointer;font-family:monospace;"
            onclick="this.select()">
          <button class="btn sm" onclick="copiarEnlaceInvitacion()" id="btnCopyInvite"
            style="flex:0 0 auto;padding:9px 14px;">📋 Copiar</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" onclick="compartirEnlaceWhatsApp()"
            style="background:linear-gradient(135deg,#25d366,#128c7e);box-shadow:0 4px 14px rgba(37,211,102,.30);">
            💬 Compartir por WhatsApp
          </button>
          <button class="btn sec sm" onclick="regenerarEnlaceInvitacion()"
            style="font-size:11.5px;padding:9px 14px;">🔄 Regenerar enlace</button>
        </div>
        <p style="color:var(--muted);font-size:11.5px;margin-top:12px;line-height:1.6;">
          ⚠ Si regeneras el enlace, el anterior quedará inválido.</p>
      </div>
      <div id="inviteLinkLoading" style="color:var(--muted);font-size:13px;">
        Cargando enlace…
      </div>
    </div>
  </div>

  <!-- ── Panel: Tarifas (lista editable) ── -->
  <div id="cfgPanel-tarifas" class="card" style="display:none;margin-bottom:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;margin-bottom:6px;color:var(--gold-2);">Tarifas de clases</h3>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:20px;line-height:1.6;">
      Edita el nombre y precio de cada tarifa. Las marcadas con 🎓 incluyen acceso al Aula Virtual.</p>
    <div id="tarifasList" style="display:flex;flex-direction:column;gap:10px;">
      ${[
        {k:'suelta', nombre:'Clase suelta',          portal:false, desc:'Una clase individual, sin cuota'},
        {k:'35',     nombre:'1 clase / semana',       portal:true,  desc:'Cuota mensual · acceso al aula virtual'},
        {k:'50',     nombre:'2 clases / semana',      portal:true,  desc:'Cuota mensual · acceso al aula virtual'},
        {k:'80',     nombre:'VIP / Full Pass',        portal:true,  desc:'Clases ilimitadas · acceso al aula virtual'},
        {k:'bono',   nombre:'Bono 5 clases',         portal:false, desc:'Flexible, sin caducidad'},
      ].map(p=>`
        <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;
          background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);
          border-radius:var(--r-sm);transition:all .2s;"
          onmouseover="this.style.borderColor='rgba(226,144,35,.30)'"
          onmouseout="this.style.borderColor='rgba(226,144,35,.14)'">
          <div style="flex:0 0 32px;height:32px;border-radius:9px;
            background:${p.portal?'linear-gradient(135deg,rgba(226,144,35,.25),rgba(138,112,0,.15))':'rgba(255,255,255,.06)'};
            border:1px solid rgba(226,144,35,.${p.portal?'30':'12'});
            display:flex;align-items:center;justify-content:center;font-size:14px;">
            ${p.portal?'🎓':'📋'}
          </div>
          <div style="flex:1;min-width:0;">
            <input type="text" id="tNombre_${p.k}" value="${esc(p.nombre)}"
              style="width:100%;background:transparent;border:none;border-bottom:1px solid rgba(226,144,35,.20);
                border-radius:0;padding:4px 2px;font-size:14px;font-weight:600;color:var(--text);
                box-shadow:none;margin-bottom:3px;"
              onfocus="this.style.borderBottomColor='var(--gold)';this.style.boxShadow='none'"
              onblur="this.style.borderBottomColor='rgba(226,144,35,.20)'">
            <div style="font-size:11px;color:var(--muted);">${p.desc}${p.portal?' · <span style="color:var(--gold-2);">Portal incluido</span>':''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;">
            <input type="number" id="tPrecio_${p.k}" value="${c.precios[p.k]??0}" step="0.01" min="0"
              style="width:90px;text-align:right;font-size:15px;font-weight:700;color:var(--gold-2);
                background:rgba(226,144,35,.08);border:1px solid rgba(226,144,35,.22);border-radius:8px;padding:8px 10px;">
            <span style="color:var(--muted);font-size:13px;">€</span>
          </div>
        </div>`).join('')}
    </div>
    <div style="margin-top:22px;display:flex;align-items:center;gap:12px;">
      <button class="btn" onclick="guardarTarifas()">Guardar tarifas</button>
      <small style="color:var(--muted);font-size:12px;">🎓 = Acceso al Aula Virtual incluido</small>
    </div>
  </div>

  <!-- ── Panel: Reparto con The Box ── -->
  <div id="cfgPanel-reparto" class="card" style="display:none;margin-bottom:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;margin-bottom:6px;color:var(--gold-2);">Reparto con The Box</h3>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:20px;line-height:1.6;">
      El reparto se calcula sobre la <strong style="color:var(--text-2);">base imponible</strong> (precio sin IVA).
      Los primeros meses usan el reparto inicial; a partir del mes configurado, el posterior.</p>

    <!-- IVA -->
    <div class="g2" style="margin-bottom:18px;">
      <div><label class="label-field">IVA aplicado (%)</label>
        <input type="number" id="cfgIva" value="${c.iva}" step="0.01" min="0" max="100"></div>
      <div><label class="label-field">Meses con reparto inicial</label>
        <input type="number" id="cfgMesesIni" value="${c.mesesIniciales}" min="0"></div>
    </div>

    <!-- Tarjetas de reparto visual -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px;">
      <!-- Inicial -->
      <div style="background:rgba(226,144,35,.07);border:1px solid rgba(226,144,35,.22);
        border-radius:var(--r-lg);padding:20px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:14px;font-weight:700;">
          Primeros ${c.mesesIniciales||3} meses</div>
        <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:12px;">
          <div style="flex:1;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:5px;">Malevo</div>
            <input type="number" id="cfgIniMalevo" value="${c.inicial.malevo}" step="0.1" min="0" max="100"
              oninput="syncBox('IniBox','IniMalevo')"
              style="font-size:22px;font-weight:700;color:var(--gold-2);background:transparent;
                border:none;border-bottom:2px solid var(--gold);border-radius:0;padding:4px 2px;
                width:80px;text-align:center;box-shadow:none;">
          </div>
          <div style="color:var(--muted);font-size:20px;padding-bottom:8px;">+</div>
          <div style="flex:1;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:5px;">The Box</div>
            <input type="number" id="cfgIniBox" value="${c.inicial.box}" step="0.1" min="0" max="100"
              oninput="syncBox('IniMalevo','IniBox')"
              style="font-size:22px;font-weight:700;color:var(--text-2);background:transparent;
                border:none;border-bottom:2px solid rgba(255,255,255,.25);border-radius:0;padding:4px 2px;
                width:80px;text-align:center;box-shadow:none;">
          </div>
          <div style="color:var(--muted);font-size:14px;padding-bottom:10px;">= 100%</div>
        </div>
        <div id="barIni" style="height:8px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:6px;">
          <div id="barIniMalevo" style="height:100%;width:${c.inicial.malevo}%;
            background:linear-gradient(90deg,var(--gold),var(--gold-2));border-radius:4px;transition:.3s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--muted);">
          <span style="color:var(--gold-2);">Malevo ${c.inicial.malevo}%</span>
          <span>The Box ${c.inicial.box}%</span>
        </div>
      </div>
      <!-- Posterior -->
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);
        border-radius:var(--r-lg);padding:20px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:14px;font-weight:700;">
          Meses siguientes</div>
        <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:12px;">
          <div style="flex:1;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:5px;">Malevo</div>
            <input type="number" id="cfgPostMalevo" value="${c.posterior.malevo}" step="0.1" min="0" max="100"
              oninput="syncBox('PostBox','PostMalevo')"
              style="font-size:22px;font-weight:700;color:var(--gold-2);background:transparent;
                border:none;border-bottom:2px solid var(--gold);border-radius:0;padding:4px 2px;
                width:80px;text-align:center;box-shadow:none;">
          </div>
          <div style="color:var(--muted);font-size:20px;padding-bottom:8px;">+</div>
          <div style="flex:1;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:5px;">The Box</div>
            <input type="number" id="cfgPostBox" value="${c.posterior.box}" step="0.1" min="0" max="100"
              oninput="syncBox('PostMalevo','PostBox')"
              style="font-size:22px;font-weight:700;color:var(--text-2);background:transparent;
                border:none;border-bottom:2px solid rgba(255,255,255,.25);border-radius:0;padding:4px 2px;
                width:80px;text-align:center;box-shadow:none;">
          </div>
          <div style="color:var(--muted);font-size:14px;padding-bottom:10px;">= 100%</div>
        </div>
        <div id="barPost" style="height:8px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:6px;">
          <div id="barPostMalevo" style="height:100%;width:${c.posterior.malevo}%;
            background:linear-gradient(90deg,var(--gold),var(--gold-2));border-radius:4px;transition:.3s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--muted);">
          <span style="color:var(--gold-2);">Malevo ${c.posterior.malevo}%</span>
          <span>The Box ${c.posterior.box}%</span>
        </div>
      </div>
    </div>
    <div style="margin-top:20px;"><button class="btn" onclick="guardarConfig()">Guardar reparto</button></div>
  </div>

  <!-- ── Panel: Resumen (Fiscalidad) ── -->
  <div id="cfgPanel-resumen" style="display:none;margin-bottom:16px;">

    <!-- Calendario fiscal -->
    <div class="h2" style="margin-bottom:14px;">📅 Calendario fiscal</div>
    <div id="cfgCalFiscal" style="margin-bottom:28px;"></div>

    <!-- Resumen del mes con selector -->
    <div style="display:flex;align-items:center;justify-content:space-between;
      flex-wrap:wrap;gap:10px;margin-bottom:12px;">
      <div class="h2" style="margin-bottom:0;">€ Resumen del mes</div>
      <input type="month" id="resumMesSel" value="${mesActual()}"
        onchange="actualizarResumenMes()"
        style="width:190px;padding:7px 12px;font-size:13px;">
    </div>
    <div id="resumStats"
      style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;"></div>

    <!-- Reparto del mes -->
    <div class="h2" style="margin-bottom:12px;">⇄ Reparto del mes</div>
    <div id="resumReparto"
      style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:4px;"></div>

  </div>

  <!-- ── Panel: Gestora ── -->
  <div id="cfgPanel-gestora" class="card" style="display:none;margin-bottom:16px;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;
      color:var(--gold-2);margin-bottom:6px;">📋 Documentación para la gestora</h3>
    <p style="color:var(--muted);font-size:12.5px;line-height:1.6;margin-bottom:22px;">
      Listado completo de facturas emitidas con descarga individual y generación del informe trimestral.
      <strong style="color:var(--text-2);">Ningún documento menciona a terceros.</strong></p>

    <!-- Filtros -->
    <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:20px;">
      <div>
        <label class="label-field">Filtrar por trimestre</label>
        <select id="gestoraTrim" onchange="document.getElementById('gestoraFactMes').value='';actualizarGestora();" style="width:220px;">
          <option value="">— Todos los períodos —</option>
          ${(()=>{
            const now = new Date();
            const y   = now.getFullYear();
            const opts = [];
            for(let yr=y; yr>=y-1; yr--){
              [[1,'Enero – Marzo','01','03'],[2,'Abril – Junio','04','06'],
               [3,'Julio – Septiembre','07','09'],[4,'Octubre – Diciembre','10','12']]
              .reverse().forEach(([n,label,mI,mF])=>{
                opts.push(`<option value="${yr}-${mI}|${yr}-${mF}">${yr} · ${n}T — ${label}</option>`);
              });
            }
            return opts.join('');
          })()}
        </select>
      </div>
      <div>
        <label class="label-field">O mes concreto</label>
        <select id="gestoraFactMes" onchange="document.getElementById('gestoraTrim').value='';actualizarGestora();" style="width:190px;">
          <option value="">— Todos —</option>
          ${(()=>{
            const opts=[];
            const now=new Date();
            for(let m=11;m>=0;m--){
              const d=new Date(now.getFullYear(),now.getMonth()-m,1);
              const val=d.toISOString().slice(0,7);
              const label=d.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
              opts.push('<option value="'+val+'">'+label.charAt(0).toUpperCase()+label.slice(1)+'</option>');
            }
            return opts.join('');
          })()}
        </select>
      </div>
      <button class="btn sm sec" onclick="document.getElementById('gestoraTrim').value='';document.getElementById('gestoraFactMes').value='';actualizarGestora();">
        Ver todos
      </button>
    </div>

    <!-- Tabla de facturas -->
    <div id="gestoraListaFacturas"></div>

    <!-- Acciones de descarga -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:20px;padding-top:18px;
      border-top:1px solid var(--border);">
      <button class="btn" onclick="descargarFacturasMes()">
        Descargar facturas del período (.zip)
      </button>
      <button class="btn gold" onclick="generarInformeTrimestral()">
        Informe trimestral PDF
      </button>
      <span style="width:1px;align-self:stretch;background:var(--border);margin:0 2px;"></span>
      <select id="gestoraAnioAnual" style="width:100px;">
        ${(()=>{ const y=new Date().getFullYear(); return [y,y-1,y-2].map(yr=>`<option value="${yr}">${yr}</option>`).join(''); })()}
      </select>
      <button class="btn gold" onclick="generarInformeAnual()" title="Resumen anual de facturación, listo para la declaración de la renta">
        📅 Informe Anual PDF
      </button>
    </div>
  </div>

  <!-- ── Panel: Reset ── -->
  <div id="cfgPanel-reset" class="card" style="display:none;">
    <h3 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;color:var(--warn);">Reset de fábrica</h3>
    <p style="color:var(--muted);font-size:13px;margin-bottom:18px;line-height:1.6;">
      Borra por completo la base de datos: usuarios, pagos, inscripciones y vídeos.<br>
      <strong style="color:var(--warn);">Esta acción es irreversible.</strong></p>
    <button class="btn warn" onclick="vaciarTodo()">🗑 Vaciar toda la base de datos</button>
  </div>`;

  // Activar primera pestaña
  cfgTab('negocio');
}

/* ── Resumen: actualizar stats y reparto al cambiar mes ── */
function actualizarResumenMes(){
  const sel    = $('resumMesSel');
  const mes    = sel ? sel.value : mesActual();
  const t      = totalesMes(mes);
  const activos= (db.users||[]).filter(u=>u.active&&u.role==='student').length;

  const statsWrap = $('resumStats');
  if(statsWrap){
    statsWrap.innerHTML =
      statCard('Alumnos activos',    activos,       'var(--gold)')  +
      statCard('Pagos registrados',  t.num,         'var(--text-2)')+
      statCard('Total cobrado',      eur(t.cobrado),'var(--ok)')    +
      statCard('IVA a liquidar',     eur(t.iva),    'var(--warn)');
  }

  const repartoWrap = $('resumReparto');
  if(repartoWrap){
    repartoWrap.innerHTML =
      statCard('Base (sin IVA)',  eur(t.base),   'var(--text-2)') +
      statCard('Ingreso neto',    eur(t.malevo), 'var(--ok)')     +
      statCard('IVA repercutido', eur(t.iva),    'var(--warn)');
  }
}

/* ── Datos fiscales del negocio ── */
function previsualizarLogo(input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 200*1024){ showToast('El archivo supera los 200 KB','warn'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const src = e.target.result;
    const preview = $('logoPreview');
    if(preview) preview.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;">`;
    // Guardar base64 en campo oculto para que guardarNegocio lo recoja
    const hidden = $('cfgLogoData');
    if(hidden) hidden.value = src;
    db.config.negocio = db.config.negocio || {};
    db.config.negocio.logo = src;
  };
  reader.readAsDataURL(file);
}

function eliminarLogo(){
  if(!confirm('¿Eliminar el logo?')) return;
  db.config.negocio = db.config.negocio || {};
  db.config.negocio.logo = '';
  const preview = $('logoPreview');
  if(preview) preview.innerHTML = '<span style="color:var(--muted);font-size:11px;text-align:center;padding:6px;">Sin logo</span>';
  const hidden = $('cfgLogoData');
  if(hidden) hidden.value = '';
  guardar();
  actualizarLogoHeader();
  showToast('Logo eliminado','ok');
}

async function guardarNegocio(){
  db.config.negocio = {
    nombre:    ($('cfgNombre')?.value||'').trim() || 'Academia de Baile Malevo',
    nif:       ($('cfgNif')?.value||'').trim(),
    telefono:  ($('cfgTelefono')?.value||'').trim(),
    email:     ($('cfgEmail')?.value||'').trim(),
    direccion: ($('cfgDir')?.value||'').trim(),
    pie:       ($('cfgPie')?.value||'').trim(),
    logo:      db.config.negocio?.logo || '',
  };
  // Si hay un nuevo logo en el campo oculto, ya está en db.config.negocio.logo
  // (lo actualiza previsualizarLogo en tiempo real)
  guardar();
  actualizarLogoHeader();
  confirmSave('Datos fiscales guardados');
}

/* ── Enlace general de invitación ── */
async function cargarEnlaceInvitacion(){
  const wrap    = $('inviteLinkWrap');
  const loading = $('inviteLinkLoading');
  const inp     = $('inviteLink');
  if (!wrap || !inp) return;
  if (inp.value) return; // ya cargado
  try {
    const r = await fetch('/api/invite-link', { credentials:'same-origin' });
    if (!r.ok) throw new Error();
    const { link } = await r.json();
    inp.value = link;
    if (loading) loading.style.display = 'none';
    wrap.style.display = 'block';
  } catch { if (loading) loading.textContent = 'No se pudo cargar el enlace.'; }
}

/* ── Base URL para enlaces generados en el cliente (link de pago, enlaces
   de referidos). Normalmente coincide con window.location.origin (el
   panel corriendo en http://localhost:8081 o el dominio real), pero si el
   panel se abre fuera del servidor real (por ejemplo una vista previa
   local con origen file:// o cowork-file://), ese origin no sirve como
   URL pública — en ese caso caemos al servidor local por defecto. ── */
function malevoBaseUrl(){
  const o = window.location.origin;
  return /^https?:\/\//.test(o) ? o : 'http://localhost:8081';
}

/* ── Botón del dashboard: copiar enlace directo a la pantalla de pago
   (registro-membresia.html) — la página fetchea su propio invite token al
   cargar, así que el enlace no necesita parámetros. ── */
async function copiarLinkPago(){
  const link = malevoBaseUrl() + '/registro-membresia.html';
  const btn = $('btnCopiarLinkPago');
  const restaurar = (txt) => { if (btn) setTimeout(()=>{ btn.innerHTML = '🔗 Copiar link de pago'; }, 2200); };
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const tmp = document.createElement('textarea');
    tmp.value = link; tmp.style.position='fixed'; tmp.style.opacity='0';
    document.body.appendChild(tmp); tmp.select();
    document.execCommand('copy'); document.body.removeChild(tmp);
  }
  if (btn) btn.innerHTML = '✓ ¡Enlace copiado!';
  showToast('Enlace de pago copiado al portapapeles','ok');
  restaurar();
}

/* ── Enlace directo al portal de un alumno de pago manual (Bizum,
   transferencia, efectivo) — para que el admin se lo copie y envíe él
   mismo tras darlo de alta. Usa ?contacto= para precargar su email o
   teléfono en el login passwordless del portal (ver portal.js →
   mostrarLogin), así el alumno no tiene que escribir nada, solo abrir el
   enlace y confirmar el código que le aparece. ── */
function linkPortalAlumno(u){
  const contacto = (u.email || u.telefono || '').trim();
  return malevoBaseUrl() + '/portal.html' + (contacto ? ('?contacto=' + encodeURIComponent(contacto)) : '');
}

function abrirModalLinkPortal(userId, pagoId){
  const u = (db.users||[]).find(x=>x.id===userId);
  if (!u) return;
  if (!u.email && !u.telefono) {
    showToast('Este alumno no tiene email ni teléfono guardado — añade uno para poder generarle el enlace de acceso.','warn');
    return;
  }
  const p = pagoId ? (db.payments||[]).find(x=>x.id===pagoId) : null;
  const numT = p?.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : null;
  const link = linkPortalAlumno(u);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'modalLinkPortal';
  overlay.innerHTML =
    '<div class="modal-box">'+
    '<h3 class="modal-title">🔗 Acceso directo al portal · '+esc(u.nombre)+'</h3>'+
    (p ? (
      '<div style="display:flex;align-items:center;gap:10px;background:rgba(76,175,80,.08);'+
      'border:1px solid rgba(76,175,80,.25);border-radius:var(--r-sm);padding:12px 14px;margin-bottom:14px;">'+
      '<span style="font-size:20px;">📄</span>'+
      '<div style="flex:1;"><div style="font-size:13px;font-weight:600;color:var(--ok);">Factura '+numT+' generada</div>'+
      '<div style="font-size:11.5px;color:var(--muted);">'+eur(p.importe)+' · '+esc(p.metodo)+'</div></div>'+
      '<button class="btn sm" onclick="_descargarPDFFactura(\''+p.id+'\')">📥 Descargar PDF</button>'+
      '</div>'
    ) : '') +
    '<p style="color:var(--muted);font-size:12.5px;line-height:1.6;margin-bottom:14px;">'+
      'Copia este enlace y envíaselo por WhatsApp o email. Al abrirlo, se le precarga su '+
      (u.email && u.telefono ? 'contacto' : (u.email ? 'email' : 'teléfono')) +
      ' y se le solicita directamente el código de acceso a su portal — sin tener que registrarse de nuevo.</p>'+
    '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">'+
      '<input type="text" id="linkPortalInput" readonly value="'+esc(link)+'" '+
        'style="background:rgba(226,144,35,.06);border-color:rgba(226,144,35,.25);'+
        'color:var(--gold-light);font-size:12.5px;cursor:pointer;font-family:monospace;" '+
        'onclick="this.select()">'+
      '<button class="btn sm" onclick="copiarLinkPortal()" style="flex:0 0 auto;padding:9px 14px;">📋 Copiar</button>'+
    '</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
      '<button class="btn" onclick="compartirLinkPortalWhatsApp()" '+
        'style="background:linear-gradient(135deg,#25d366,#128c7e);box-shadow:0 4px 14px rgba(37,211,102,.30);">'+
        '💬 Compartir por WhatsApp</button>'+
      '<button class="btn sec" onclick="cerrarModal(\'modalLinkPortal\')">Cerrar</button>'+
    '</div>'+
    '</div>';
  playModal(); document.body.appendChild(overlay);
}

async function copiarLinkPortal(){
  const inp = document.getElementById('linkPortalInput');
  if (!inp) return;
  try {
    await navigator.clipboard.writeText(inp.value);
  } catch {
    inp.select(); document.execCommand('copy');
  }
  showToast('Enlace copiado al portapapeles','ok');
}

function compartirLinkPortalWhatsApp(){
  const inp = document.getElementById('linkPortalInput');
  if (!inp) return;
  const msg = '¡Hola! Ya está activa tu cuenta en Malevo Academia 💃🕺 Entra aquí para acceder a tu portal: ' + inp.value;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

async function copiarEnlaceInvitacion(){
  const inp = $('inviteLink');
  if (!inp) return;
  try {
    await navigator.clipboard.writeText(inp.value);
    showToast('Enlace copiado al portapapeles','ok');
  } catch {
    inp.select(); document.execCommand('copy');
    showToast('Enlace copiado','ok');
  }
}

function compartirEnlaceWhatsApp(){
  const inp = $('inviteLink');
  if (!inp) return;
  const msg = '¡Te invitamos a unirte a la Academia de Baile Malevo! 🕺💃\nApúntate aquí: ' + inp.value;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

async function regenerarEnlaceInvitacion(){
  if (!confirm('¿Regenerar el enlace? El enlace anterior quedará inválido.')) return;
  try {
    const r = await fetch('/api/invite-link', { method:'PUT', credentials:'same-origin' });
    if (!r.ok) throw new Error();
    const { link } = await r.json();
    const inp = $('inviteLink');
    if (inp) inp.value = link;
    showToast('Nuevo enlace generado','ok');
  } catch { showToast('Error al regenerar el enlace','warn'); }
}

/* ── Cambiar pestaña config ── */
function cfgTab(tab){
  ['negocio','tarifas','resumen','reparto','gestora','reset'].forEach(t=>{
    const panel=$(`cfgPanel-${t}`);
    if(panel) panel.style.display = t===tab ? '' : 'none';
  });
  document.querySelectorAll('[data-cfgtab]').forEach(btn=>{
    const active = btn.dataset.cfgtab===tab;
    btn.style.background = active ? 'var(--card-bg)' : 'rgba(255,255,255,.04)';
    btn.style.color  = active ? 'var(--gold-2)' : 'var(--muted)';
    btn.style.fontWeight = active ? '600' : '500';
    btn.style.borderColor = 'var(--card-border)';
    btn.style.boxShadow = active ? '0 2px 10px rgba(0,0,0,.4)' : 'none';
  });
  if(tab==='resumen') { renderCalFiscal(); actualizarResumenMes(); }
  if(tab==='negocio') cargarEnlaceInvitacion();
  if(tab==='gestora') actualizarGestora();
  playClick();
}

/* ── Calendario fiscal ── */
function renderCalFiscal(){
  const cont = $('cfgCalFiscal');
  if(!cont) return;

  const now  = new Date();
  const year = now.getFullYear();
  const mes  = now.getMonth(); // 0-based

  // ── Calcular el trimestre activo para 130 y 303 ───────────────────────────
  // Plazos: 1T → 20 abril, 2T → 20 julio, 3T → 20 octubre, 4T → 30 enero(año+1)
  // Lógica: mostramos el trimestre cuyo plazo está más próximo (futuro) o el
  // último si ya pasaron todos en el año.
  const PLAZOS_TRIM = [
    {q:'1T', mes:3, dia:20, ini:[0],   fin:[2]},   // Jan-Mar → presenta en abr
    {q:'2T', mes:6, dia:20, ini:[3],   fin:[5]},   // Apr-Jun → presenta en jul
    {q:'3T', mes:9, dia:20, ini:[6],   fin:[8]},   // Jul-Sep → presenta en oct
    {q:'4T', mes:1, dia:30, ini:[9],   fin:[11], year:1}, // Oct-Dic → presenta en ene
  ];

  // Encuentra el plazo más próximo (futuro) o el último pasado
  let trimActivo = PLAZOS_TRIM[PLAZOS_TRIM.length-1];
  for(const pt of PLAZOS_TRIM){
    const dl = new Date(year + (pt.year||0), pt.mes, pt.dia);
    if(dl >= now){ trimActivo = pt; break; }
  }

  // Rangos de meses del trimestre activo para calcular importes
  const triYear = year - (trimActivo.year||0); // año fiscal del trimestre
  const mesIniStr = `${triYear}-${String(trimActivo.ini[0]+1).padStart(2,'0')}`;
  const mesFinStr = `${triYear}-${String(trimActivo.fin[0]+1).padStart(2,'0')}`;

  const deadlineTrim = new Date(year + (trimActivo.year||0), trimActivo.mes, trimActivo.dia);
  const diffTrim = Math.ceil((deadlineTrim - now) / 86400000);
  const pasadoTrim = diffTrim < 0;
  const urgenteTrim = !pasadoTrim && diffTrim <= 15;

  // ── Calcular importes del trimestre activo ────────────────────────────────
  const pagosTrim = (db.payments||[]).filter(p => p.mes && p.mes >= mesIniStr && p.mes <= mesFinStr);

  let ivaTrim = 0;
  let baseIRPF = 0;
  pagosTrim.forEach(pg => {
    const r = calcularReparto(pg.importe||0, numPagoDeUsuario(pg.userId, pg.mes, pg.id));
    ivaTrim  += r.iva;
    baseIRPF += r.malevo;
  });
  const irpfTrim = baseIRPF * 0.20;

  // ── Calcular Renta anual (año anterior) ───────────────────────────────────
  const yearRenta = year - 1; // declaración del año pasado
  const deadlineRenta = new Date(year, 5, 30); // 30 junio del año en curso
  const diffRenta = Math.ceil((deadlineRenta - now) / 86400000);
  const pasadoRenta = diffRenta < 0;
  const urgenteRenta = !pasadoRenta && diffRenta <= 15;

  const pagosRenta = (db.payments||[]).filter(p => p.mes && p.mes.startsWith(String(yearRenta)));
  let baseRenta = 0;
  pagosRenta.forEach(pg => {
    const r = calcularReparto(pg.importe||0, numPagoDeUsuario(pg.userId, pg.mes, pg.id));
    baseRenta += r.malevo;
  });

  // ── Construir tarjeta ─────────────────────────────────────────────────────
  function pill(pasado, urgente, dias){
    if(pasado)  return `<span style="display:inline-block;padding:4px 12px;border-radius:30px;font-size:12px;font-weight:600;background:var(--surface-2);color:var(--muted);border:1px solid var(--border);">Vencido</span>`;
    if(urgente) return `<span style="display:inline-block;padding:4px 12px;border-radius:30px;font-size:12px;font-weight:600;background:var(--warn-soft);color:var(--warn);border:1px solid rgba(224,92,92,.3);">¡Faltan ${dias} día${dias===1?'':'s'}!</span>`;
    return `<span style="display:inline-block;padding:4px 12px;border-radius:30px;font-size:12px;font-weight:600;background:var(--accent-soft);color:var(--accent-2);border:1px solid rgba(226,144,35,.25);">Faltan ${dias} días</span>`;
  }

  function alerta(urgente, dias){
    if(!urgente) return '';
    return `<div style="margin:14px 0 0;padding:10px 14px;border-radius:var(--r-sm);
      background:var(--warn-soft);border:1px solid rgba(224,92,92,.3);
      display:flex;align-items:center;gap:10px;">
      <span style="font-size:16px;">⚠️</span>
      <div style="font-size:12.5px;font-weight:700;color:var(--warn);">
        Quedan ${dias} día${dias===1?'':'s'} — Prepara la documentación
      </div>
    </div>`;
  }

  function bigCard({tipo, modelo, nombre, color, importe, deadline, pasado, urgente, diffDays, q, desc}){
    const dateStr = deadline.toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});
    return `<div style="padding:22px 24px;border-radius:var(--r-lg);
      background:var(--surface);border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:10.5px;font-weight:600;letter-spacing:1.2px;
        text-transform:uppercase;color:var(--muted);margin-bottom:8px;">
        ${tipo} · Modelo ${modelo}${q?' · '+q:''}
      </div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div>
          <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:700;
            color:var(--text);margin-bottom:6px;">${nombre}</div>
          <div style="font-size:13px;color:${color};font-weight:600;margin-bottom:10px;">
            ${pasado?'Hasta el ':''}${dateStr}
          </div>
          ${pill(pasado, urgente, diffDays)}
        </div>
        <div style="font-family:'Sora',sans-serif;font-size:28px;font-weight:800;
          color:${color};white-space:nowrap;padding-top:4px;">
          ${eur(importe)}
        </div>
      </div>
      ${alerta(urgente, diffDays)}
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);
        font-size:12px;color:var(--muted);line-height:1.6;">${desc}</div>
    </div>`;
  }

  // ── Las tres tarjetas fijas ───────────────────────────────────────────────
  const card130 = bigCard({
    tipo:'IRPF', modelo:'130', nombre:'Pago fraccionado IRPF', color:'var(--gold)',
    importe: irpfTrim, deadline: deadlineTrim, pasado: pasadoTrim,
    urgente: urgenteTrim, diffDays: diffTrim, q: trimActivo.q,
    desc: `Estimación: 20% del beneficio del ${trimActivo.q} (${mesIniStr.slice(5,7)}/${triYear}–${mesFinStr.slice(5,7)}/${triYear}). Orientativo; no incluye gastos deducibles.`,
  });

  const card303 = bigCard({
    tipo:'IVA', modelo:'303', nombre:'IVA trimestral', color:'var(--warn)',
    importe: ivaTrim, deadline: deadlineTrim, pasado: pasadoTrim,
    urgente: urgenteTrim, diffDays: diffTrim, q: trimActivo.q,
    desc: `A liquidar del ${trimActivo.q}. Es el IVA cobrado en las cuotas; resta el IVA de tus gastos antes de presentar.`,
  });

  const card100 = bigCard({
    tipo:'IRPF', modelo:'100', nombre:'Declaración de la Renta', color:'var(--gold-2)',
    importe: baseRenta, deadline: deadlineRenta, pasado: pasadoRenta,
    urgente: urgenteRenta, diffDays: diffRenta, q: `Anual ${yearRenta}`,
    desc: `Ingresos netos de ${yearRenta}. Campaña abril–junio ${year}. El resultado depende de retenciones, gastos y deducciones.`,
  });

  // ── Histórico (todos los plazos del año, colapsado) ───────────────────────
  const ITEMS_HIST = [
    { tipo:'IRPF', modelo:'130', nombre:'Pago fraccionado IRPF', color:'var(--gold)',
      plazos: PLAZOS_TRIM },
    { tipo:'IVA', modelo:'303', nombre:'IVA trimestral', color:'var(--warn)',
      plazos: PLAZOS_TRIM },
  ];
  let htmlResto = '';
  ITEMS_HIST.forEach(item => {
    item.plazos.forEach(pt => {
      if(pt.q === trimActivo.q) return; // ya está en las tarjetas principales
      const dl = new Date(year + (pt.year||0), pt.mes, pt.dia);
      const dd = Math.ceil((dl - now) / 86400000);
      const pas = dd < 0;
      const urg = !pas && dd <= 15;
      htmlResto += bigCard({
        tipo: item.tipo, modelo: item.modelo, nombre: item.nombre, color: item.color,
        importe: 0, deadline: dl, pasado: pas, urgente: urg, diffDays: dd, q: pt.q,
        desc: `${item.modelo==='303'?'A liquidar':'Estimación 20% del beneficio'} del ${pt.q}.`,
      });
    });
  });

  cont.innerHTML = `
    ${card130}
    ${card303}
    ${card100}
    <div style="margin-top:4px;">
      <button onclick="toggleHistoricoFiscal(this)"
        style="background:transparent;border:none;color:var(--muted);font-size:12px;
          cursor:pointer;font-family:inherit;padding:6px 0;
          display:flex;align-items:center;gap:6px;transition:color .2s;"
        onmouseover="this.style.color='var(--gold-2)'"
        onmouseout="this.style.color='var(--muted)'">
        <span id="historicoIcon">▶</span>
        Ver todos los trimestres / Histórico fiscal
      </button>
      <div id="historicoFiscal" style="overflow:hidden;max-height:0;
        transition:max-height .4s ease;">
        <div style="padding-top:8px;">${htmlResto}</div>
      </div>
    </div>`;
}

function toggleHistoricoFiscal(btn){
  const div  = document.getElementById('historicoFiscal');
  const icon = document.getElementById('historicoIcon');
  if(!div) return;
  const cerrado = !div.style.maxHeight || div.style.maxHeight === '0px';
  if(cerrado){
    div.style.maxHeight = (div.scrollHeight + 600) + 'px';
    if(icon) icon.textContent = '▼';
  } else {
    div.style.maxHeight = '0';
    if(icon) icon.textContent = '▶';
  }
}

/* ── Gestora: actualizar lista de facturas al cambiar selector ── */
function actualizarGestora(){
  const lista = $('gestoraListaFacturas');
  if(!lista) return;

  // Leer filtro activo: trimestre o mes concreto
  const trimVal  = $('gestoraTrim')?.value  || '';
  const mesVal   = $('gestoraFactMes')?.value || '';
  const [tDesde, tHasta] = trimVal ? trimVal.split('|') : ['',''];

  // Filtrar y ordenar todos los pagos
  const pagos = (db.payments||[]).filter(p => {
    const m = (p.mes||'').slice(0,7);
    if(mesVal)  return m === mesVal;
    if(tDesde)  return m >= tDesde && m <= tHasta;
    return true; // sin filtro: todos
  }).sort((a,b) => (a.numeroTicket||0) - (b.numeroTicket||0));

  if(!pagos.length){
    lista.innerHTML = `
      <div class="vacio" style="margin-top:8px;">
        <div style="font-size:32px;margin-bottom:10px;">🧾</div>
        <p style="font-size:14px;font-weight:600;margin-bottom:6px;">Sin facturas en este período</p>
        <p style="font-size:12.5px;">Registra pagos en la sección <strong>Pagos</strong> para que aparezcan aquí.</p>
      </div>`;
    return;
  }

  const ivaRate = db.config.iva ?? 21;
  const f = x => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' €';

  let totBase=0, totIva=0, totTotal=0;

  // Tabla
  let rows = '';
  pagos.forEach(p => {
    const u    = (db.users||[]).find(x=>x.id===p.userId);
    const numT = p.numeroTicket ? 'T-'+String(p.numeroTicket).padStart(5,'0') : '—';
    const base = p.importe / (1+ivaRate/100);
    const iva  = p.importe - base;
    totBase  += base;
    totIva   += iva;
    totTotal += p.importe;
    const mesLabel = p.mes
      ? new Date(p.mes+'-01T00:00:00').toLocaleDateString('es-ES',{month:'short',year:'numeric'})
      : '—';
    const clienteNombre = p.simplificada
      ? `<span class="badge muted" style="font-size:11px;">⚡ ${esc(p.notas||'Anónimo')}</span>`
      : esc(u?.nombre || '—');
    const tel = (u?.telefono||'').replace(/\D/g,'');
    const pdfUrl = `${location.origin}/api/factura/${p.id}/pdf`;
    const waMsg = encodeURIComponent(
      `Hola ${u?.nombre||''}! 👋\nTe enviamos tu factura:\n📄 ${numT}\n💶 ${f(p.importe)}\n📅 ${p.mes||''}\n\n🔗 Descarga tu PDF aquí:\n${pdfUrl}\n\nGracias por bailar con nosotros 💃🕺`
    );
    const pdfFn = p.simplificada
      ? `generarTicketSimplificado('${p.id}','${esc(p.notas||'Cobro puntual').replace(/'/g,"\\'")}' )`
      : `generarTicket('${p.id}')`;

    rows += `<tr>
      <td><b style="color:var(--accent);font-size:12.5px;">${numT}</b></td>
      <td>${clienteNombre}</td>
      <td style="color:var(--muted);font-size:12px;">${mesLabel}</td>
      <td style="color:var(--muted);font-size:12px;">${p.fechaPago||'—'}</td>
      <td style="text-align:right;font-weight:700;">${f(p.importe)}</td>
      <td style="text-align:right;color:var(--muted);font-size:12px;">${f(base)}</td>
      <td style="text-align:right;color:var(--warn);font-size:12px;">${f(iva)}</td>
      <td><span class="badge muted" style="font-size:10.5px;">${esc(p.metodo||'—')}</span></td>
      <td>
        <div style="display:flex;gap:5px;justify-content:flex-end;">
          <button class="btn sm ok" onclick="${pdfFn}" title="Ver / Imprimir PDF">🧾</button>
          ${tel
            ? `<a href="https://wa.me/${tel}?text=${waMsg}" target="_blank"
                 class="btn sm" title="Enviar por WhatsApp"
                 style="text-decoration:none;background:linear-gradient(135deg,#25d366,#128c7e);
                   box-shadow:0 2px 8px rgba(37,211,102,.25);">💬</a>`
            : `<span class="btn sm sec" style="opacity:.3;cursor:not-allowed;" title="Sin teléfono">💬</span>`}
        </div>
      </td>
    </tr>`;
  });

  // Fila de totales
  const totalRow = `<tr style="background:var(--surface-2);">
    <td colspan="4" style="font-weight:700;font-size:12.5px;color:var(--text-2);">
      TOTAL · ${pagos.length} factura${pagos.length!==1?'s':''}
    </td>
    <td style="text-align:right;font-weight:800;font-size:14px;color:var(--gold-2);">${f(totTotal)}</td>
    <td style="text-align:right;font-weight:700;color:var(--muted);">${f(totBase)}</td>
    <td style="text-align:right;font-weight:700;color:var(--warn);">${f(totIva)}</td>
    <td colspan="2"></td>
  </tr>`;

  lista.innerHTML = `
    <div class="tbl-wrap" style="margin-top:8px;">
      <table>
        <thead><tr>
          <th>Nº Factura</th>
          <th>Cliente</th>
          <th>Mes</th>
          <th>Fecha cobro</th>
          <th style="text-align:right;">Total</th>
          <th style="text-align:right;">Base</th>
          <th style="text-align:right;">IVA</th>
          <th>Método</th>
          <th style="text-align:right;">Acciones</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>${totalRow}</tfoot>
      </table>
    </div>`;
}

// ── Helpers para construir HTML de factura (para ZIP) ────────────────────
function _buildHtmlFacturaParaZip(p){
  const u       = (db.users||[]).find(x=>x.id===p.userId);
  const c       = db.config;
  const neg     = c.negocio || {};
  const ivaRate = c.iva ?? 21;
  const base    = p.importe / (1 + ivaRate/100);
  const iva     = p.importe - base;
  const f = x => (Math.round(x*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2}) + ' €';
  const numT    = p.numeroTicket ? 'T-' + String(p.numeroTicket).padStart(5,'0') : 'T-' + p.id.slice(0,6);
  const fechaStr = new Date((p.fechaPago||hoy())+'T12:00:00')
    .toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});

  let clienteNombre, clienteExtra = '';
  if(p.simplificada || !u || p.userId === '__anonimo__'){
    clienteNombre = u?.nombre || 'Público en general';
    if(!u) clienteExtra = `<div class="cliente-meta" style="color:#bbb;font-size:11px;">Operación sin identificación de destinatario</div>`;
  } else {
    clienteNombre = u.nombre || '—';
    if(u.email)    clienteExtra += `<div class="cliente-meta">✉ ${esc(u.email)}</div>`;
    if(u.telefono) clienteExtra += `<div class="cliente-meta">📞 ${esc(u.telefono)}</div>`;
  }

  const mesStr    = p.mes ? new Date(p.mes+'-01T00:00:00').toLocaleDateString('es-ES',{month:'long',year:'numeric'}) : '';
  const planLabel = (u && PLAN_DESC[u.plan]) ? PLAN_DESC[u.plan] : 'Servicio de clases de baile';
  const concepto  = p.notas || (mesStr ? `${planLabel} · ${mesStr}` : 'Clase de baile · Cobro puntual');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Factura ${numT}</title>
<style>${_estiloFacturaA4()}</style>
</head><body>
${_cabeceraPDF(neg, numT, 'Factura simplificada', fechaStr)}
<div class="sec-label">Cliente</div>
<div class="cliente-box">
  <div class="cliente-nombre">${esc(clienteNombre)}</div>
  ${clienteExtra}
</div>
<div class="sec-label">Concepto y desglose</div>
<table>
  <thead><tr>
    <th>Descripción</th>
    <th class="r">Base imponible</th>
    <th class="r">IVA (${ivaRate}%)</th>
    <th class="r">Total</th>
  </tr></thead>
  <tbody><tr class="fila-base">
    <td>${esc(concepto)}</td>
    <td class="r">${f(base)}</td>
    <td class="r">${f(iva)}</td>
    <td class="r">${f(p.importe)}</td>
  </tr></tbody>
  <tfoot><tr class="fila-tot">
    <td>Total a pagar</td>
    <td class="r" colspan="3">${f(p.importe)}</td>
  </tr></tfoot>
</table>
${_piePDF(neg, p.metodo)}
<button class="btn-print" onclick="window.print()">🖨 Imprimir / Guardar como PDF</button>
</body></html>`;
}

async function _descargarZipFacturas(pagos, nombreZip){
  if(!pagos.length){ showToast('No hay facturas en este período.','warn'); return; }
  showToast(`Generando ZIP con ${pagos.length} factura${pagos.length!==1?'s':''}…`, 'info', 3000);
  try {
    const ids = pagos.map(p => p.id);
    const r = await fetch('/api/facturas/zip', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'same-origin',
      body: JSON.stringify({ ids, nombre: nombreZip })
    });
    if(!r.ok) throw new Error(await r.text());
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = nombreZip; a.click();
    URL.revokeObjectURL(url);
    showToast(`✓ ${nombreZip} descargado · ${pagos.length} factura${pagos.length!==1?'s':''}`, 'ok', 4000);
  } catch(e) {
    showToast('Error al generar el ZIP: ' + e.message, 'warn');
  }
}

function descargarFacturasMes(){
  const trimVal = $('gestoraTrim')?.value || '';
  const mesVal  = $('gestoraFactMes')?.value || '';
  const [tDesde, tHasta] = trimVal ? trimVal.split('|') : ['',''];

  const pagos = (db.payments||[]).filter(p => {
    const m = (p.mes||'').slice(0,7);
    if(mesVal)  return m === mesVal;
    if(tDesde)  return m >= tDesde && m <= tHasta;
    return true;
  }).sort((a,b) =>
    ((a.mes||'')+(a.fechaPago||'')).localeCompare((b.mes||'')+(b.fechaPago||''))
  );

  if(!pagos.length){ showToast('No hay facturas en ese período.','warn'); return; }

  const etiqueta = mesVal || (trimVal ? trimVal.replace('|','_') : 'todas');
  _descargarZipFacturas(pagos, `facturas_malevo_${etiqueta}.zip`);
}

/* ── Botón 2: Informe de todas las facturas (PDF del servidor) ── */
async function descargarInformeTodasFacturas(){
  showToast('Generando informe...', 'info', 3000);
  try {
    const r = await fetch('/api/facturas/informe-todas', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      body: JSON.stringify({ titulo: 'Informe de todas las facturas', nombre: 'informe_todas_facturas_malevo.pdf' })
    });
    if(!r.ok){ const e=await r.json(); throw new Error(e.error||'Error servidor'); }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'informe_todas_facturas_malevo.pdf'; a.click();
    URL.revokeObjectURL(url);
    showToast('Informe descargado', 'ok');
  } catch(e){ showToast('Error: '+e.message, 'warn'); }
}

/* ── Botón 3: Informe trimestral PDF (servidor) ── */
async function generarInformeTrimestral(){
  const trimVal = $('gestoraTrim')?.value || '';
  if(!trimVal){ showToast('Selecciona un trimestre en el filtro de arriba.','warn'); return; }
  const [desde, hasta] = trimVal.split('|');
  const [yr, mI] = desde.split('-').map(Number);
  const trimNum  = Math.ceil(mI/3);
  const labels   = ['Enero-Marzo','Abril-Junio','Julio-Septiembre','Octubre-Diciembre'];
  const trimLabel= yr+' - '+trimNum+'T  '+labels[trimNum-1];
  showToast('Generando informe trimestral...', 'info', 3000);
  try {
    const r = await fetch('/api/facturas/informe-trimestral', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      body: JSON.stringify({ desde, hasta, trimLabel })
    });
    if(!r.ok){ const e=await r.json(); throw new Error(e.error||'Error servidor'); }
    const blob   = await r.blob();
    const nombre = 'informe_trimestral_'+desde+'_'+hasta+'.pdf';
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
    showToast('Informe trimestral descargado', 'ok');
  } catch(e){ showToast('Error: '+e.message, 'warn'); }
}

/* ── Botón 4: Informe anual PDF (resumen de todo el año, para la
   declaración de la renta) — reutiliza el mismo endpoint genérico del
   informe trimestral, solo con un rango desde/hasta de 12 meses. ── */
async function generarInformeAnual(){
  const anio  = $('gestoraAnioAnual')?.value || String(new Date().getFullYear());
  const desde = anio+'-01', hasta = anio+'-12';
  const trimLabel = 'Informe Anual '+anio+' — Declaración de la Renta';
  showToast('Generando informe anual...', 'info', 3000);
  try {
    const r = await fetch('/api/facturas/informe-trimestral', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      body: JSON.stringify({ desde, hasta, trimLabel })
    });
    if(!r.ok){ const e=await r.json(); throw new Error(e.error||'Error servidor'); }
    const blob   = await r.blob();
    const nombre = 'informe_anual_'+anio+'.pdf';
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
    showToast('Informe anual descargado', 'ok');
  } catch(e){ showToast('Error: '+e.message, 'warn'); }
}

/* ── Sincroniza The Box automáticamente al editar Malevo y viceversa ── */
function syncBox(targetId, sourceId){
  const src = parseFloat($('cfg'+sourceId)?.value)||0;
  const tgt = $('cfg'+targetId);
  if(tgt){ tgt.value = Math.max(0, Math.min(100, 100-src)).toFixed(1); }
  // Actualiza barra visual
  const prefix = sourceId.startsWith('Ini') ? 'Ini' : 'Post';
  const malevoVal = parseFloat($('cfg'+prefix+'Malevo')?.value)||0;
  const bar = $('bar'+prefix+'Malevo');
  if(bar) bar.style.width = Math.min(100,malevoVal)+'%';
}

/* ── Guardar solo tarifas ── */
function guardarTarifas(){
  db.config.precios = {
    suelta: parseFloat($('tPrecio_suelta').value)||12,
    '35':   parseFloat($('tPrecio_35').value)||35,
    '50':   parseFloat($('tPrecio_50').value)||50,
    '80':   parseFloat($('tPrecio_80').value)||80,
    bono:   parseFloat($('tPrecio_bono').value)||100,
  };
  guardar(); confirmSave('Tarifas guardadas');
}

async function guardarConfig(){
  const ini={malevo:parseFloat($('cfgIniMalevo')?.value||0),box:parseFloat($('cfgIniBox')?.value||0)};
  const pos={malevo:parseFloat($('cfgPostMalevo')?.value||0),box:parseFloat($('cfgPostBox')?.value||0)};
  if (Math.round(ini.malevo+ini.box)!==100||Math.round(pos.malevo+pos.box)!==100){
    showToast('El reparto debe sumar 100% en cada período.','warn'); return;
  }
  const precio = k => {
    const v = $('tPrecio_'+k)?.value ?? $('cfgP'+k)?.value;
    return parseFloat(v) || db.config.precios[k] || 0;
  };
  // Preservar negocio completo (logo incluido) — no sobreescribir si no estamos en pestaña negocio
  const negActual = db.config.negocio || {};
  db.config = {
    iva: parseFloat($('cfgIva')?.value) || db.config.iva || 21,
    mesesIniciales: parseInt($('cfgMesesIni')?.value) || db.config.mesesIniciales || 3,
    inicial: ini, posterior: pos,
    precios: {
      suelta: precio('suelta'),
      '35':   precio('35'),
      '50':   precio('50'),
      '80':   precio('80'),
      bono:   precio('bono'),
    },
    portalPlans: ['35','50','bono','80'],
    bonoClases: 10,
    negocio: negActual,  // preservar logo y todos los campos fiscales
    inviteToken: db.config.inviteToken || '',
  };
  guardar(); confirmSave('Configuración guardada');
}

async function vaciarTodo(){
  if (!confirm('⚠ Se borrarán TODOS los datos. ¿Continuar?')) return;
  if (!confirm('Confirmación final: base de datos completamente vacía. ¿Seguro?')) return;
  db.users=[]; db.classes=[]; db.enrollments=[]; db.videos=[];
  db.attendances=[]; db.payments=[]; db.contadorTicket=0; db._rev++;
  guardar(); renderView('hoy'); showToast('Base de datos vaciada','warn');
}
/* ── Modales helpers ── */
function cerrarModal(id){
  const elem=document.getElementById(id);
  if (elem) elem.remove();
}

/* ── Toast elegante en esquina inferior derecha ── */
function showToast(msg, type='ok', duration=3200){
  const c=$('toastContainer'); if(!c) return;
  if (type==='warn') playError();
  const t=document.createElement('div');
  t.className='toast '+type;
  const icons={ok:'✓',warn:'⚠',info:'ℹ'};
  const icon=icons[type]||'';
  t.innerHTML=`<span style="font-size:16px;flex:0 0 auto;">${icon}</span><span style="flex:1;">${esc(msg)}</span>
    <span style="flex:0 0 auto;cursor:pointer;opacity:.5;font-size:16px;margin-left:6px;" onclick="this.parentElement.remove()">×</span>`;
  c.appendChild(t);
  setTimeout(()=>{
    t.style.animation='toastOut .3s ease forwards';
    setTimeout(()=>t.remove(),300);
  },duration);
}

/* ── Web Audio API — sonidos sin archivos externos ── */
let _audioCtx=null;
function getAudio(){
  if(!_audioCtx) _audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  return _audioCtx;
}

function playClick(){
  try{
    const ctx=getAudio();
    const o=ctx.createOscillator(); const g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='sine'; o.frequency.setValueAtTime(880,ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660,ctx.currentTime+0.06);
    g.gain.setValueAtTime(0.07,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.1);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.1);
  } catch{}
}

/* ── Sonido de navegación suave (cambio de vista) ── */
function playNav(){
  try{
    const ctx=getAudio();
    const o=ctx.createOscillator(); const g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='sine';
    o.frequency.setValueAtTime(520,ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(640,ctx.currentTime+0.08);
    g.gain.setValueAtTime(0.045,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.14);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.15);
  } catch{}
}

/* ── Sonido al abrir un modal ── */
function playModal(){
  try{
    const ctx=getAudio();
    [[600,0],[760,0.05]].forEach(([freq,t])=>{
      const o=ctx.createOscillator(); const g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type='sine'; o.frequency.value=freq;
      g.gain.setValueAtTime(0.04,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.12);
      o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.14);
    });
  } catch{}
}

function playSuccess(){
  try{
    const ctx=getAudio();
    [[440,0],[554,.06],[660,.12]].forEach(([freq,t])=>{
      const o=ctx.createOscillator(); const g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type='sine'; o.frequency.value=freq;
      g.gain.setValueAtTime(0.07,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.18);
      o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.2);
    });
  } catch{}
}

/* ── Sonido de alerta/error — tono bajo y sutil, nunca molesto ── */
function playError(){
  try{
    const ctx=getAudio();
    const o=ctx.createOscillator(); const g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='sine'; o.frequency.setValueAtTime(260,ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(210,ctx.currentTime+0.16);
    g.gain.setValueAtTime(0.05,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.22);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.24);
  } catch{}
}

/* ── flashSuccess — overlay verde translúcido 600ms ── */
function flashSuccess(){
  const f=$('flashOverlay'); if(!f) return;
  f.classList.remove('active');
  void f.offsetWidth;
  f.classList.add('active');
  setTimeout(()=>f.classList.remove('active'), 700);
}

/* ── confirmSave — llama a los tres juntos ── */
function confirmSave(msg='Guardado'){
  playSuccess();
  flashSuccess();
  showToast(msg,'ok');
}

/* ── Auth y arranque ── */
function mostrarLogin(){ $('loginOverlay').style.display='flex'; $('appShell').style.display='none'; }
function ocultarLogin(){ $('loginOverlay').style.display='none'; $('appShell').style.display='grid'; }

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

async function hacerLogin(ev){
  if (ev) ev.preventDefault();
  const username=$('logUser').value.trim();
  const password=$('logPass').value;
  const errEl=$('logError'); errEl.textContent='';
  try {
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password}),credentials:'same-origin'});
    if (r.ok){
      const j=await r.json();
      // Solo admin y teacher pueden acceder al panel
      if (!['admin','teacher'].includes(j.role)){
        errEl.innerHTML='Esta área es solo para administradores. <a href="/portal.html" style="color:var(--gold-2)">Ir al portal de alumnos →</a>';
        // Cerrar la sesión que se acaba de abrir para no dejar token huérfano
        try { await fetch('/api/logout',{method:'POST',credentials:'same-origin'}); } catch {}
        return;
      }
      currentUser={sub:j.sub,role:j.role,nombre:j.nombre};
      $('logPass').value='';
      ocultarLogin();
      await arrancarApp(j.role);
    } else { errEl.textContent='Usuario o contraseña incorrectos.'; }
  } catch { errEl.textContent='No se pudo conectar con el servidor.'; }
}

async function cerrarSesion(){
  if (!confirm('¿Cerrar sesión?')) return;
  try { await fetch('/api/logout',{method:'POST',credentials:'same-origin'}); } catch {}
  location.reload();
}

/* ── Restablecer contraseña de otro admin/profesor (ej. Gimena) ──
   Cualquier admin ya logueado puede ponerle una contraseña nueva a otro
   admin o profesor sin tocar la base de datos a mano. Ver
   /api/admin/reset-password en server.js. */
function abrirResetPassword(){
  const sel = $('resetPassUsuario');
  if (sel){
    const candidatos = (db?.users||[]).filter(u => ['admin','teacher'].includes(u.role));
    sel.innerHTML = candidatos.map(u =>
      `<option value="${esc(u.username)}">${esc(u.nombre||u.username)} (${esc(u.username)})</option>`
    ).join('') || '<option value="">No hay administradores/profesores cargados</option>';
  }
  const msg = $('resetPassMsg'); if (msg){ msg.textContent=''; msg.className=''; }
  const pass = $('resetPassNueva'); if (pass) pass.value='';
  $('resetPassOverlay')?.classList.add('open');
}
function cerrarResetPassword(){
  $('resetPassOverlay')?.classList.remove('open');
}
async function confirmarResetPassword(ev){
  ev.preventDefault();
  const username = $('resetPassUsuario')?.value;
  const newPassword = $('resetPassNueva')?.value || '';
  const msg = $('resetPassMsg');
  if (!username){ if(msg){msg.textContent='Elegí un usuario.'; msg.className='err';} return; }
  if (newPassword.length < 6){ if(msg){msg.textContent='La contraseña debe tener al menos 6 caracteres.'; msg.className='err';} return; }
  try{
    const r = await apiJSON('POST','/api/admin/reset-password',{username,newPassword});
    if (msg){ msg.textContent=`✓ Contraseña de "${username}" actualizada.`; msg.className='ok'; }
    $('resetPassNueva').value='';
  } catch(e){
    if (msg){ msg.textContent = 'No se pudo actualizar: '+(e.message||'error desconocido'); msg.className='err'; }
  }
}

async function arrancarApp(role){
  if (!['admin','teacher'].includes(role)){
    location.href='/portal.html'; return;
  }
  try {
    await cargarDB();
    marcarEstado(true);
    // Siembra automática desactivada: el catálogo de ejemplo (CATALOGO_OFICIAL_VIDEOS)
    // ya cumplió su propósito inicial y ahora reinsertaría vídeos de prueba que
    // el admin ya no quiere cada vez que se borren manualmente. Ver nota en la
    // constante más arriba si se necesita reactivar en el futuro.
    // if (role==='admin') await sembrarCatalogoOficialVideos();
  } catch(e) {
    marcarEstado(false);
    if (role==='admin') alert('Advertencia: no se pudo cargar la base de datos del servidor.');
  }
  if ($('userBadge')){
    const nombreU = currentUser.nombre || '';
    const rolLabel = ROLES_LABEL[currentUser.role]||currentUser.role;
    const iniciales = nombreU.trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase() || '?';
    $('userBadge').innerHTML = `<span class="ub-full">${esc(nombreU)} · ${esc(rolLabel)}</span><span class="ub-short">${esc(iniciales)}</span>`;
    $('userBadge').title = `${nombreU} · ${rolLabel}`;
  }
  actualizarLogoHeader();
  buildNav();
  navigateTo('dashboard');
  mostrarBotonModoAlumno();
  if (!window._syncStarted){ window._syncStarted=true; setInterval(sincronizar,5000); }
}

/* ══════════════════════════════════════════════
   ⚠️ MODO DEV — BYPASS DE LOGIN (solo pruebas locales)
   Pon esta constante en false para volver al login normal en cualquier
   momento. El bypass real vive en el servidor (/api/dev-auto-login) y
   solo responde a peticiones que llegan desde la propia máquina sin pasar
   por ningún proxy inverso (ver esConexionLocal() en server.js, que ahora
   además exige la ausencia de cabeceras x-forwarded-* — se detectó que en
   producción esas comprobaciones basadas solo en la IP del socket podían
   dar falso positivo detrás de un proxy).
   Esta comprobación de location.hostname es una segunda capa, no la
   principal: aunque esta constante siga en true, en cualquier dominio que
   no sea localhost/127.0.0.1 ni siquiera se intenta la llamada, así el
   login nunca parpadea para un visitante real y el servidor sigue siendo
   quien decide en última instancia.
══════════════════════════════════════════════ */
const DEV_AUTO_LOGIN = true;

async function intentarAutoLoginDev(){
  if (!DEV_AUTO_LOGIN) return false;
  if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) return false;
  try {
    const r = await fetch('/api/dev-auto-login',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({as:'admin'}), credentials:'same-origin'
    });
    if (!r.ok) return false; // el servidor no tiene el bypass activado (o no hay admin) → login normal
    const j = await r.json();
    currentUser = {sub:j.sub, role:j.role, nombre:j.nombre};
    ocultarLogin();
    await arrancarApp(j.role);
    return true;
  } catch { return false; }
}

async function iniciar(){
  if (await intentarAutoLoginDev()) return;
  try {
    const r=await fetch('/api/me',{cache:'no-store',credentials:'same-origin'});
    if (r.ok){
      const j=await r.json();
      // Si es alumno/invitado, redirigir al portal (no al panel admin)
      if (!['admin','teacher'].includes(j.role)){
        location.replace('/portal.html'); return;
      }
      currentUser={sub:j.sub,role:j.role,nombre:j.nombre};
      ocultarLogin();
      await arrancarApp(j.role);
    } else { mostrarLogin(); }
  } catch { mostrarLogin(); }
}

// Si "/" se abrió en un CELULAR/tablet con un navegador normal (no
// instalada como PWA), index.html muestra la landing de instalación en vez
// del login (ver #instalarOverlay y la clase "es-standalone" en <html>,
// agregada de forma síncrona en el <head> — esa clase también es true en un
// ORDENADOR, que siempre salta directo al login) — cuando la landing está
// visible no tiene sentido llamar a iniciar(): además de ser una petición
// de red innecesaria en una pantalla puramente informativa,
// mostrarLogin()/ocultarLogin() ponen display inline sobre #loginOverlay, lo
// que pisaría el display:none que le puso el CSS y haría reaparecer el login
// por encima de la landing.
if (document.documentElement.classList.contains('es-standalone')) {
  iniciar();
}

/* ══════════════════════════════════════════════
   MODO ALUMNO — selector dentro del panel admin
   Permite al admin ver la plataforma exactamente
   como la ve cualquier alumno (o el genérico)
══════════════════════════════════════════════ */

/* Estado del modo alumno */
let _maActivo      = false;
let _maUsuario     = null;   // objeto alumno activo o null (genérico)
let _maVista       = 'inicio';
let _maVideos      = [];
let _maCursos      = []; // catálogo de Cursos Exclusivos para el espejo "Ver como alumno" (ver maCursosParaAlumno)
let _maClases      = [];
/* Simulación en memoria (solo dura esta sesión de "Ver como alumno") del
   progreso de la mecánica 2x2, para que el admin pueda previsualizar el
   desbloqueo, el modal y la tarjeta Racha con datos reales aunque no
   provengan del dispositivo real del alumno. Se reinicia al entrar a ver
   a un alumno (maEntrarComoAlumno). */
let _maCompletados = {};   // { videoId: true }
let _maNivelActivo = null; // {disc,nivel} — último nivel abierto por el admin
let _maFuegoSimuladoHoy = false; // true si ya se simuló consumo de vídeo hoy en esta sesión de preview

const MA_PLANES = {'suelta':'Clase suelta','35':'1 clase/sem','50':'2 clases/sem','80':'🎓 VIP · Full Pass','bono':'Bono 5 clases'};
const MA_DIAS_FULL  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

/* ── Mostrar botón en header solo para admins ── */
function mostrarBotonModoAlumno(){
  const btn = $('btnModoAlumno');
  if (btn && currentUser?.role === 'admin') btn.style.display = 'inline-flex';
}

/* ── Activar: si no hay userId muestra selector de alumno ── */
function activarModoAlumno(userId){
  // Si no se especifica alumno, mostrar selector primero
  if (!userId) {
    maAbrirSelector();
    return;
  }
  maEntrarComoAlumno(userId);
}

/* ── Selector de alumno (cuando se activa desde el header) ── */
function maAbrirSelector(){
  const alumnos = (db.users||[])
    .filter(u => u.role === 'student')
    .sort((a,b) => a.nombre.localeCompare(b.nombre));

  if (!alumnos.length){
    showToast('No hay alumnos registrados todavía.','warn');
    return;
  }

  // Cerrar si ya existe
  const old = $('maSelector');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'maSelector';
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:500px;">
      <h3 class="modal-title">🎓 Ver como alumno</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        Selecciona un alumno para ver la plataforma desde su perspectiva.</p>
      <input type="text" id="maSelectorBusq" placeholder="Buscar alumno…"
        oninput="maFiltrarSelector()"
        style="margin-bottom:12px;">
      <div id="maSelectorLista" style="max-height:340px;overflow-y:auto;
        display:flex;flex-direction:column;gap:6px;"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:18px;">
        <button class="btn sec" onclick="cerrarModal('maSelector')">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Renderizar lista
  window._maSelectorAlumnos = alumnos;
  maFiltrarSelector();
}

function maFiltrarSelector(){
  const q = ($('maSelectorBusq')?.value||'').toLowerCase();
  const lista = window._maSelectorAlumnos || [];
  const cont = $('maSelectorLista');
  if (!cont) return;
  const filtrados = q ? lista.filter(u => u.nombre.toLowerCase().includes(q) || (u.telefono||'').includes(q)) : lista;
  if (!filtrados.length){
    cont.innerHTML = `<div style="color:var(--muted);text-align:center;padding:16px;">Sin resultados.</div>`;
    return;
  }
  cont.innerHTML = filtrados.map(u => {
    const asignadas = (u.assignedClasses||[]).length;
    const plan = MA_PLANES[u.plan]||'—';
    return `<div onclick="cerrarModal('maSelector');maEntrarComoAlumno('${u.id}')"
      style="display:flex;align-items:center;justify-content:space-between;
        padding:11px 14px;border-radius:10px;cursor:pointer;
        background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.1);
        transition:all .18s;"
      onmouseover="this.style.borderColor='rgba(226,144,35,.38)';this.style.background='rgba(226,144,35,.08)'"
      onmouseout="this.style.borderColor='rgba(226,144,35,.1)';this.style.background='rgba(255,255,255,.04)'">
      <div>
        <div style="font-size:13.5px;font-weight:600;">${esc(u.nombre)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">
          @${esc(u.username)}
          ${u.plan?`&nbsp;·&nbsp;<span style="color:var(--gold-2);">${plan}</span>`:''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${asignadas?`<span style="font-size:11px;color:var(--muted);">📅 ${asignadas} cl.</span>`:''}
        <span class="badge ${u.active?'ok':'muted'}" style="font-size:10px;">${u.active?'Activo':'Baja'}</span>
      </div>
    </div>`;
  }).join('');
}

/* ── Entrar al modo alumno con un alumno concreto ── */
function maEntrarComoAlumno(userId){
  _maActivo  = true;
  _maVideos  = [];
  _maCursos  = [];
  _maCompletados = {};
  _maNivelActivo = null;
  _maFuegoSimuladoHoy = false;
  _maUsuario = (db.users||[]).find(u => u.id === userId) || null;

  if (!_maUsuario){
    showToast('Alumno no encontrado.','warn');
    return;
  }

  const shell = $('modoAlumnoShell');
  if (!shell) return;
  shell.style.display = 'flex';
  shell.scrollTop = 0;

  /* Cabecera — datos reales del alumno */
  const nombre = $('maUserBadge');
  const plan   = $('maPlanBadge');
  if (nombre) nombre.textContent = _maUsuario.nombre;
  if (plan) {
    const p = _maUsuario.plan;
    if (p) {
      plan.textContent = MA_PLANES[p] || p;
      plan.style.display = 'inline-flex';
      plan.style.background = p === '80' ? 'rgba(226,144,35,.12)' : 'rgba(226,144,35,.12)';
    } else {
      plan.style.display = 'none';
    }
  }

  /* Clases del alumno */
  _maClases = [];
  if (_maUsuario) {
    const asignadas = _maUsuario.assignedClasses || [];
    _maClases = asignadas
      .map(cid => (db.classes||[]).find(c => c.id === cid))
      .filter(Boolean)
      .sort((a,b) => { const da=a.dia===0?7:a.dia, db_=b.dia===0?7:b.dia; return da-db_||(a.inicio||'').localeCompare(b.inicio||''); });
  }

  /* Construir nav del portal simulado — solo Inicio y Mi perfil */
  const nav = $('maNave');
  if (nav) {
    nav.innerHTML = '';
    [['inicio','🏠 Inicio'],['cursos','🎓 Cursos'],['perfil','👤 Mi perfil']].forEach(([v,l]) => {
      const b = document.createElement('button');
      b.className = 'ma-nav-btn';
      b.dataset.maview = v;
      b.textContent = l;
      b.onclick = () => maNavegarA(v);
      nav.appendChild(b);
    });
  }

  /* Descripción en barra admin */
  const desc = $('modoAlumnoNombre');
  if (desc) desc.textContent = `Perspectiva de: ${_maUsuario.nombre}`;

  maInicializarTema();
  maNavegarA('inicio');
  playNav();
}

/* ══════════════════════════════════════════════
   TEMA (espejo "Ver como alumno") — Modo Dorado / Modo Verde Neón.
   A diferencia del portal real (donde la clase va en <body>, porque body
   ES toda la página), acá se aplica solo sobre #modoAlumnoShell: el panel
   admin de atrás sigue siempre en dorado, el verde es nada más una vista
   previa de cómo lo vería el alumno. Comparte la misma clave de
   localStorage que portal.js, así la preferencia es una sola por alumno.
══════════════════════════════════════════════ */
function maInicializarTema(){
  let verde = false;
  try{ verde = localStorage.getItem('malevo_theme')==='verde'; }catch{}
  const shell = $('modoAlumnoShell');
  if (shell) shell.classList.toggle('theme-green', verde);
  maPintarToggleTema(verde);
}
function maPintarToggleTema(verde){
  const btn = $('maThemeToggle');
  const label = $('maThemeToggleLabel');
  if (btn){
    btn.classList.toggle('on', verde);
    btn.title = verde ? 'Cambiar a Modo Dorado' : 'Cambiar a Modo Verde';
  }
  if (label) label.textContent = verde ? 'Verde' : 'Dorado';
}
function maToggleTema(){
  const shell = $('modoAlumnoShell');
  const verde = !(shell && shell.classList.contains('theme-green'));
  if (shell) shell.classList.toggle('theme-green', verde);
  try{ localStorage.setItem('malevo_theme', verde ? 'verde' : 'dorado'); }catch{}
  maPintarToggleTema(verde);
  playClick();
}

/* ── Desactivar: volver al panel admin ── */
function desactivarModoAlumno(){
  maEvDetenerAutoplay();
  _maActivo = false;
  _maUsuario = null;
  _maVideos  = [];
  const ovPago = $('maPagoCuotaOverlay'); if (ovPago) ovPago.remove();
  const ovEv = $('maEvLightboxOverlay'); if (ovEv) ovEv.remove();
  const shell = $('modoAlumnoShell');
  if (shell) shell.style.display = 'none';
  // Limpiar tabs vídeo
  const dt = $('maDiscTabs'), np = $('maNivelPills');
  if (dt) { dt.style.display = 'none'; dt.innerHTML = ''; }
  if (np) { np.style.display = 'none'; np.innerHTML = ''; }
  playNav();
}

/* ── Modal "Pagar cuota / Renovación" simulado ── */
function maAbrirModalPagoCuota(){
  const shell = $('modoAlumnoShell');
  if (!shell) return;
  let ov = $('maPagoCuotaOverlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'maPagoCuotaOverlay';
    ov.className = 'pago-cuota-overlay';
    shell.appendChild(ov);
  }
  ov.innerHTML = `
    <div class="pago-cuota-card">
      <button type="button" class="pago-cuota-close" onclick="maCerrarModalPagoCuota()">×</button>
      <div style="font-size:38px;margin-bottom:10px;">💳</div>
      <h2 class="pago-cuota-titulo">Pagar cuota / Renovación</h2>
      <p class="pago-cuota-desc">Vista previa — en el portal real, el alumno confirma aquí su pago para que quede pendiente de validación.</p>
      <button type="button" class="pago-cuota-confirmar-btn" style="width:100%;margin-top:0;" onclick="maCerrarModalPagoCuota()">
        Cerrar vista previa
      </button>
    </div>`;
  ov.style.display = 'flex';
}
function maCerrarModalPagoCuota(){
  const ov = $('maPagoCuotaOverlay');
  if (ov) ov.style.display = 'none';
}

/* ── Navegación interna del modo alumno ── */
function maNavegarA(vista){
  _maVista = vista;
  document.querySelectorAll('.ma-nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.maview === vista));

  // Si el admin estaba scrolleado hacia abajo dentro del shell (p.ej.
  // clickeó una tarjeta del Reel de Cursos, más abajo en Inicio), sin esto
  // la vista nueva quedaba "muy abajo" — arrancamos siempre desde arriba.
  const shell = $('modoAlumnoShell');
  if (shell) shell.scrollTop = 0;

  const cont = $('maContent');
  if (!cont) return;
  cont.innerHTML = '';

  const fade = document.createElement('div');
  fade.style.animation = 'fade .28s cubic-bezier(.4,0,.2,1)';
  cont.appendChild(fade);

  // Al salir de Inicio se detiene el auto-avance de los carruseles (Eventos y Reel de Cursos)
  if (vista !== 'inicio'){ maEvDetenerAutoplay(); maCrDetenerAutoplay(); }

  if      (vista === 'inicio') maRenderInicio(fade);
  else if (vista === 'perfil') maRenderPerfil(fade);
  else if (vista === 'cursos') maRenderCursosExclusivos(fade);
}

/* ── Vista INICIO del portal simulado ── */
/* ══════════════════════════════════════════════════════════════════════
   Tarjeta "Racha" (espejo de portal.js, para "Ver como alumno"). El
   fueguito histórico usa el dato real ya guardado en el perfil
   (_maUsuario.fuegoDiasTotal) sin escribir nada. El bloqueo por racha
   semanal de bonus (rachaBonusDesbloqueados) también es un dato real.
   El progreso del bloque activo 2x2 y el avance del nivel, en cambio, NO
   tienen equivalente real en el admin (eso vive en el localStorage del
   dispositivo del propio alumno) — se simulan en memoria con
   _maCompletados, que el admin puede ir completando haciendo clic en las
   clases dentro de "Ver como alumno", solo para previsualizar cómo se
   ve/comporta el mecanismo. Esta simulación se reinicia cada vez que se
   entra a ver a un alumno (maEntrarComoAlumno).
   ══════════════════════════════════════════════════════════════════════ */
function maBonusDesbloqueadoPorRacha(id){
  return ((_maUsuario&&_maUsuario.rachaBonusDesbloqueados)||[]).includes(id);
}
function maVideosDeNivel(disc,nivel){
  return _maVideos.filter(v=>v.disciplina===disc && v.nivel===nivel && (!v.tipo||v.tipo==='clase'))
    .sort((a,b)=>(a.orden||0)-(b.orden||0));
}
function maBonusDeNivel(disc,nivel){
  return nivel===4 ? [] : _maVideos.filter(v=>v.disciplina===disc && v.nivel===nivel && v.tipo==='bonus')
    .sort((a,b)=>(a.orden||0)-(b.orden||0));
}
function maEsCompletado(id){ return !!_maCompletados[id]; }
function maMarcarCompletado(id){
  if (_maCompletados[id]) return false;
  _maCompletados[id] = true;
  return true;
}
function maNivelVideosCompletados(disc,nivel){
  return maVideosDeNivel(disc,nivel).filter(v=>maEsCompletado(v.id)).length;
}
function maNivelVideosDesbloqueados(disc,nivel){
  const vids = maVideosDeNivel(disc,nivel);
  if (!vids.length) return 0;
  const completados = maNivelVideosCompletados(disc,nivel);
  const desbloqueados = 2 + 2*Math.floor(completados/2);
  return Math.min(vids.length, Math.max(2, desbloqueados));
}
function maBonusNivelDesbloqueado(disc,nivel){
  const vids = maVideosDeNivel(disc,nivel);
  return vids.length>0 && maNivelVideosCompletados(disc,nivel)>=vids.length;
}
/* Nivel "activo" para la tarjeta Racha simulada: el último que el admin
   abrió con maAbrirNivel; si no hay ninguno, el primer nivel accesible
   con clases pendientes. */
function maNivelActivoParaRacha(){
  if (_maNivelActivo && maVideosDeNivel(_maNivelActivo.disc,_maNivelActivo.nivel).length) return _maNivelActivo;
  for (const disc of DISCIPLINAS_VIDEO){
    const acceso = maNivelesToAcceso(disc);
    for (const n of [1,2,3,4]){
      if (!acceso.includes(n)) continue;
      const vids = maVideosDeNivel(disc,n);
      if (vids.length && maNivelVideosCompletados(disc,n) < vids.length) return {disc, nivel:n};
    }
  }
  return null;
}
/* Todos los (disciplina, nivel) accesibles para el alumno simulado
   (niveles 1-3; el 4 / Coreografías no tiene bonus). Se muestra un
   redondel por cada uno de estos niveles exista o no todavía vídeo de
   bonus cargado ahí — el redondel se enciende apenas se completa el 100%
   de las clases del nivel, que es el mismo momento en que su bonus
   (cuando lo haya) queda desbloqueado. */
function maRachaNivelesConBonus(){
  const out = [];
  for (const disc of DISCIPLINAS_VIDEO){
    const acceso = maNivelesToAcceso(disc);
    for (const n of [1,2,3]){
      if (!acceso.includes(n)) continue;
      if (!maVideosDeNivel(disc,n).length) continue;
      out.push({disc, nivel:n});
    }
  }
  return out;
}
/* Fila de redondeles: uno por cada nivel (de cualquier disciplina) que
   tenga bonus. Se enciende (dorado) cuando el alumno simulado terminó el
   100% de las clases principales de ese nivel y por lo tanto ya
   desbloqueó TODOS los vídeos de bonus correspondientes — no representa
   días ni vídeos sueltos, sino "niveles con bonus ya desbloqueado". */
function maRenderRachaBonusFila(){
  const niveles = maRachaNivelesConBonus();
  if (!niveles.length) return '';
  const grupos = {};
  const orden = [];
  for (const item of niveles){
    if (!grupos[item.disc]){ grupos[item.disc] = []; orden.push(item.disc); }
    grupos[item.disc].push(item);
  }
  const gruposHtml = orden.map(disc => {
    const circulos = grupos[disc].map(({disc,nivel}) => {
      const encendido = maBonusNivelDesbloqueado(disc,nivel);
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
function maRenderRachaProgresoPrincipal(){
  const activo = maNivelActivoParaRacha();
  let principal;
  if (!activo){
    principal = `<div class="racha-progreso-texto">Todavía no hay clases disponibles para simular el progreso.</div>
      <div class="racha-bar-track"><div class="racha-bar-fill" style="width:0%;"></div></div>`;
  } else {
    const vids = maVideosDeNivel(activo.disc, activo.nivel);
    const completados = maNivelVideosCompletados(activo.disc, activo.nivel);
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
      <div class="racha-nivel-texto">Avance del nivel: ${completados}/${vids.length} clase${vids.length===1?'':'s'} (${pctNivel}%) · simulado en esta vista previa</div>`;
  }
  return principal + maRenderRachaBonusFila();
}
function maHoyStr(ts){
  const d=new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
/* Fuego a mostrar: el real guardado en el perfil, salvo que ese dato
   todavía no cuente el día de hoy Y el admin ya simuló consumo de al
   menos un vídeo hoy en esta sesión de preview — en ese caso se muestra
   +1 (mínimo 1 día), igual que exige la regla real, pero SIN escribir
   nada en el perfil del alumno (es puramente visual/temporal). */
function maFuegoMostrado(){
  const u=_maUsuario||{};
  const real=u.fuegoDiasTotal||0;
  const yaContadoHoy = u.fuegoUltimoDia===maHoyStr(Date.now());
  if (!yaContadoHoy && _maFuegoSimuladoHoy) return real+1;
  return real;
}
function maRenderRachaCard(inicial){
  // "inicial" solo es true la primera vez (desde maRenderInicio), para la
  // animación de entrada en cadena; los repintados por interacción no
  // deben repetirla — ver mismo patrón en portal.js.
  const fuego=maFuegoMostrado();
  return `<div class="card racha-card${inicial?' reveal-right':''}" id="maRachaCard" style="--rv-dist:60px;">
    <div class="racha-fuego-box">
      <div class="racha-fuego-icon">🔥</div>
      <div class="racha-fuego-num">${fuego} día${fuego===1?'':'s'}</div>
      <div class="racha-fuego-label">Racha de la aplicación</div>
    </div>
    <div class="racha-desbloqueo">
      ${maRenderRachaProgresoPrincipal()}
    </div>
  </div>`;
}
function maRepintarRachaCard(){
  const cont=$('maRachaCard');
  if (cont) cont.outerHTML = maRenderRachaCard();
}

/* ══════════════════════════════════════════════════════════════════════
   Tarjeta "Calendario" (espejo de solo lectura de portal.js, para "Ver
   como alumno"). Combina clases privadas recurrentes (_maClases) con los
   Talleres/Eventos públicos (_maVideos con tipo:'evento'). No persiste
   nada ni cambia el mes activo entre sesiones — es solo una vista previa.
   ══════════════════════════════════════════════════════════════════════ */
let _maCalMesActivo=null;
let _maCalMenuAbierto=false;
function _maCalHoy(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
function maCalInicializarMes(){
  if (_maCalMesActivo) return;
  const h=_maCalHoy();
  _maCalMesActivo={year:h.getFullYear(), month:h.getMonth()};
}
const MA_CAL_MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MA_CAL_DIAS_CORTOS=['L','M','M','J','V','S','D'];
function maCalEventosGlobalesDelDia(fechaStr){
  // Se lee directo de db.videos (no de _maVideos) porque los Talleres/Eventos
  // son públicos y el admin ya los tiene en memoria, sin depender de que el
  // alumno simulado tenga plan VIP (_maVideos solo se carga si lo tiene).
  const est={taller:false, evento:false};
  (db.videos||[]).filter(v=>v.tipo==='evento').forEach(v=>{
    let meta={}; try{ meta=JSON.parse(v.notas||'{}'); }catch{}
    if (meta.fecha===fechaStr){
      if (meta.categoria==='taller') est.taller=true; else est.evento=true;
    }
  });
  return est;
}
function maCalTieneClaseEseDiaSemana(diaSemana){
  return (_maClases||[]).some(c=>(c.dia??0)===diaSemana);
}
function maCalEstadoDia(year, month, day){
  const fecha=new Date(year, month, day);
  const diaSemana=fecha.getDay();
  const fechaStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const clase=maCalTieneClaseEseDiaSemana(diaSemana);
  const {taller, evento}=maCalEventosGlobalesDelDia(fechaStr);
  return {clase, taller, evento};
}
function maCalColorEstado(est){
  if (est.clase) return 'gold';
  if (est.taller) return 'magenta';
  if (est.evento) return 'cyan';
  return null;
}
function maRenderCalendarioCard(inicial){
  maCalInicializarMes();
  const {year, month}=_maCalMesActivo;
  const primerDia=new Date(year, month, 1);
  const diasEnMes=new Date(year, month+1, 0).getDate();
  const offset=(primerDia.getDay()+6)%7;
  const hoy=_maCalHoy();
  const esMesActual=hoy.getFullYear()===year && hoy.getMonth()===month;

  let celdas='';
  for (let i=0;i<offset;i++) celdas += `<div class="cal-cell cal-cell-vacia"></div>`;
  for (let d=1; d<=diasEnMes; d++){
    const est=maCalEstadoDia(year, month, d);
    const color=maCalColorEstado(est);
    const esHoy=esMesActual && hoy.getDate()===d;
    const extras=[];
    if (color!=='gold' && est.clase) extras.push('gold');
    if (color!=='magenta' && est.taller) extras.push('magenta');
    if (color!=='cyan' && est.evento) extras.push('cyan');
    const colorHoy=color||'gold';
    celdas += `<div class="cal-cell">
      <div class="cal-day${esHoy?' cal-day-hoy cal-day-hoy-'+colorHoy:(color?' cal-day-'+color:'')}">${d}</div>
      ${extras.length?`<div class="cal-day-dots">${extras.map(c=>`<span class="cal-dot cal-dot-${c}"></span>`).join('')}</div>`:''}
    </div>`;
  }

  return `<div class="card mescal-card${inicial?' reveal-left':''}" id="maCalendarioCard" style="--rv-dist:60px;">
    <div class="cal-main">
      <div class="cal-header">
        <div class="h2" style="margin:0;">Calendario</div>
        <div class="cal-mes-selector">
          <button type="button" class="cal-mes-pill" onclick="maCalToggleMenu()">
            ${MA_CAL_MESES[month]} ${year} <span class="cal-mes-chevron">⌄</span>
          </button>
          <div class="cal-mes-menu" id="maCalMesMenu" style="display:${_maCalMenuAbierto?'block':'none'};">
            ${maCalOpcionesMeses()}
          </div>
        </div>
      </div>
      <div class="cal-grid">
        ${MA_CAL_DIAS_CORTOS.map(l=>`<div class="cal-dow">${l}</div>`).join('')}
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
function maCalOpcionesMeses(){
  const h=_maCalHoy();
  let out='';
  for (let i=-6;i<=18;i++){
    const d=new Date(h.getFullYear(), h.getMonth()+i, 1);
    const y=d.getFullYear(), m=d.getMonth();
    const activo=_maCalMesActivo.year===y && _maCalMesActivo.month===m;
    out += `<div class="cal-mes-opcion${activo?' activa':''}" onclick="maCalIrAMes(${y},${m})">${MA_CAL_MESES[m]} ${y}</div>`;
  }
  return out;
}
function maCalToggleMenu(){
  _maCalMenuAbierto=!_maCalMenuAbierto;
  const menu=$('maCalMesMenu'); if (menu) menu.style.display=_maCalMenuAbierto?'block':'none';
}
function maCalIrAMes(y,m){
  _maCalMesActivo={year:y, month:m};
  _maCalMenuAbierto=false;
  const cont=$('maCalendarioCard');
  if (cont) cont.outerHTML = maRenderCalendarioCard();
}
document.addEventListener('click', e=>{
  if (_maCalMenuAbierto && !e.target.closest('.cal-mes-selector')){
    _maCalMenuAbierto=false;
    const menu=$('maCalMesMenu'); if (menu) menu.style.display='none';
  }
});

/* ── Bloque de referidos, solo lectura, para el espejo "Ver como alumno".
   No hace fetch (a diferencia de portal.js): usa los datos ya presentes
   en el usuario simulado (_maUsuario), igual que el resto de este espejo. ── */
function maRenderRefBlock(u){
  const code = u?.referralCode || (u?.id ? u.id.slice(0,8) : '—');
  // Igual que /api/referral en server.js: conteo en caliente sobre
  // db.users (ya cargado en el admin), no un contador guardado aparte.
  const referred = (db?.users||[]).filter(x=>x.referredBy===u?.id && x.active && !x.pendingPayment).length;
  const mesesPendientes = Number(u?.referralMesesPendientes || 0);
  const discount = mesesPendientes>0 ? 30 : 0;
  const link = `${malevoBaseUrl()}/registro-membresia.html?ref=${code}`;
  // El banner de 30% de descuento se muestra SIEMPRE, tenga o no el alumno
  // meses pendientes acumulados en este momento — es publicidad fija del
  // beneficio de referidos, no un indicador condicional de saldo.
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.12);
        border-radius:12px;padding:14px;text-align:center;">
        <div style="font-family:'Sora',sans-serif;font-size:28px;font-weight:800;color:var(--gold-2);">${referred}</div>
        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Amigos invitados</div>
      </div>
      <div class="ref-discount-box ref-discount-active">
        <img src="assets/descuento-30-fuego.webp" alt="30% de descuento por referidos" class="ref-discount-img">
        <div class="ref-discount-label ref-discount-label-active">${discount>0 ? `Descuento activo · ${mesesPendientes} mes${mesesPendientes===1?'':'es'}` : 'Referí un amigo y ganá 30% OFF'}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="text" id="maRefLinkInput" value="${esc(link)}" readonly
        style="background:rgba(226,144,35,.06);border-color:rgba(226,144,35,.2);
          color:var(--gold-light);font-size:12.5px;flex:1;min-width:200px;cursor:pointer;"
        onclick="this.select();">
      <button class="btn sm" onclick="maCopiarLinkReferido()">📋 Copiar</button>
      <button class="btn sm sec" onclick="maCompartirLinkReferidoWhatsApp()">💬 WhatsApp</button>
    </div>`;
}

/* Copiar/compartir el enlace de referidos real del alumno que se está
   previsualizando en "Ver como alumno" — útil para que el admin lo pueda
   probar o reenviar directamente sin tener que ir a buscarlo al perfil
   real del alumno. */
async function maCopiarLinkReferido(){
  const inp = $('maRefLinkInput');
  if (!inp) return;
  try {
    await navigator.clipboard.writeText(inp.value);
  } catch {
    inp.select(); document.execCommand('copy');
  }
  showToast('Enlace de referidos copiado','ok');
}
function maCompartirLinkReferidoWhatsApp(){
  const inp = $('maRefLinkInput');
  if (!inp) return;
  const msg = '¡Hola! Te comparto mi enlace de Malevo Academia, si te apuntas con él los dos ganamos descuento 🕺💃 ' + inp.value;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

/* ══════════════════════════════════════════════
   SCROLL REVEAL — técnica tipo AOS.js, espejo exacto de la de portal.js
   para que "Ver como alumno" tenga la misma interacción. El elemento nace
   invisible y desplazado fuera de pantalla (ver CSS en index.html, con
   opacity:0 !important + visibility:hidden mientras NO tenga .in-view) y
   se revela cada vez que el usuario hace scroll y el elemento entra
   activamente al viewport. Re-trigger (once:false): al salir del viewport
   se le quita .in-view, así vuelve a animarse la próxima vez que
   reaparezca, tanto bajando como subiendo. Motor principal:
   IntersectionObserver, que sigue observando el elemento en vez de dejar
   de hacerlo tras la primera entrada. Respaldo: chequeo manual por
   getBoundingClientRect atado a scroll/resize (igual que AOS clásico),
   por si el observer no detecta bien el contenedor de scroll real —
   también revierte el estado al salir de vista. ── */
const _SR_CLASSES = ['reveal-left','reveal-right','reveal-down','reveal-up'];
const _SR_SELECTOR = _SR_CLASSES.map(c=>`.${c}:not(.in-view)`).join(', ');
const _srReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function _srSettle(el){
  el.addEventListener('transitionend', function onEnd(ev){
    if (ev.propertyName !== 'transform') return;
    el.removeEventListener('transitionend', onEnd);
    el.style.transitionDelay = '';
  });
}

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

/* _srObservers: Map de elemento-raíz-de-scroll (o null = viewport) → su
   propio IntersectionObserver. ANTES había un único observer/root
   memoizados para toda la sesión (calculados una sola vez, con el primer
   elemento que pasara por acá) — eso rompía "Ver como alumno" (vive en
   #modoAlumnoShell, fuera de #mainContent) apenas el Dashboard (dentro de
   #mainContent, con su propio scroll) llamaba a initScrollReveal primero:
   el root quedaba fijado a #mainContent y el observer nunca disparaba
   isIntersecting para elementos de #modoAlumnoShell (fuera de ese root),
   dejando todo "Mis Vídeos" invisible (opacity:0 permanente). Ahora cada
   contenedor de scroll real obtiene su propio observer, sin pisarse. */
let _srObservers = new Map();
function _srGetObserver(sampleEl){
  const root = _srFindScrollRoot(sampleEl);
  if (_srObservers.has(root)) return _srObservers.get(root);
  const obs = new IntersectionObserver((entries)=>{
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
  }, {root, threshold:0.15, rootMargin:'0px 0px -50px 0px'});
  _srObservers.set(root, obs);
  _srBindManualFallback(root);
  return obs;
}

// Igual que el observer, alterna .in-view en ambas direcciones (no
// descarta el elemento tras la primera entrada) para soportar el
// re-trigger.
let _srManualTargets = [];
let _srManualBound = false;
let _srManualHandler = null;
let _srBoundRoots = new Set();
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
function _srBindManualFallback(root){
  if (!_srManualBound){
    _srManualBound = true;
    _srManualHandler = ()=>{ requestAnimationFrame(_srManualCheck); };
    window.addEventListener('scroll', _srManualHandler, {passive:true});
    window.addEventListener('resize', _srManualHandler, {passive:true});
  }
  if (root && !_srBoundRoots.has(root)){
    _srBoundRoots.add(root);
    root.addEventListener('scroll', _srManualHandler, {passive:true});
  }
}

function initScrollReveal(root){
  root = root || document;
  if (!root.querySelectorAll) return;
  const els = root.querySelectorAll(_SR_SELECTOR);
  if (!els.length) return;

  if (_srReducedMotion || !('IntersectionObserver' in window)){
    els.forEach(el=>el.classList.add('in-view'));
    return;
  }

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
  requestAnimationFrame(_srManualCheck);
}

function maRenderInicio(cont){
  const u = _maUsuario;
  if (!u){
    cont.innerHTML = `<div style="padding:48px;text-align:center;color:var(--muted);">
      <div style="font-size:36px;margin-bottom:12px;">⚠</div>
      No se encontraron datos del alumno.</div>`;
    return;
  }
  const hora = new Date().getHours();
  const saludo = hora < 13 ? '¡Buenos días' : hora < 20 ? '¡Buenas tardes' : '¡Buenas noches';
  const primerNombre = (u.nombre||'').split(' ')[0] || 'alumno';
  const tieneVideos = u.plan === '80' || u.portalAccess === true;
  const planNombre  = MA_PLANES[u.plan] || '—';

  cont.innerHTML = `<div style="padding:28px 24px;max-width:1060px;margin:0 auto;" data-stagger>
    <!-- Hero + estadísticas, fusionados en una sola tarjeta -->
    <div class="reveal-down" style="--rv-dist:50px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:22px;position:relative;overflow:hidden;
      padding:26px 32px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="width:160px;height:160px;border-radius:50%;flex:0 0 auto;overflow:hidden;
          border:3px solid var(--card-border);background:var(--bg);
          display:flex;align-items:center;justify-content:center;">
          ${u.fotoPerfil
            ? `<img src="${esc(u.fotoPerfil)}" alt="" style="width:100%;height:100%;object-fit:cover;">`
            : `<span style="font-family:'Sora',sans-serif;font-weight:700;font-size:54px;color:var(--text-2);">${iniciales(u.nombre)}</span>`}
        </div>
        <div>
          <h2 style="font-family:'Sora',sans-serif;font-size:15px;font-weight:700;
            color:var(--white);letter-spacing:-.2px;margin-bottom:4px;">
            ${saludo}, ${esc(primerNombre)}! 👋</h2>
          <div style="display:inline-flex;align-items:center;gap:5px;margin-top:2px;
            padding:3px 10px;border-radius:30px;font-size:8.5px;font-weight:600;
            background:rgba(226,144,35,.1);border:1px solid rgba(226,144,35,.25);color:var(--gold);">
            🎓 ${esc(planNombre)}
            ${tieneVideos ? '&nbsp;·&nbsp;<span style="color:var(--white);">✓ Aula Virtual activa</span>' : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[{n:_maClases.length,l:'Clases'},
           {n:nivelesDisplayFull(u.nivelBachata),l:'Bachata',small:true},
           {n:nivelesDisplayFull(u.nivelSalsa),l:'Salsa',small:true}]
          .map(s=>`<div style="background:var(--bg);border:1px solid var(--card-border);
            border-radius:10px;padding:6px 8px;text-align:center;min-width:${s.small?'62px':'40px'};">
            <div style="font-family:'Sora',sans-serif;font-size:${s.small?'9.5px':'12px'};font-weight:800;color:var(--white);white-space:nowrap;">${s.n}</div>
            <div style="font-size:7px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-top:2px;">${s.l}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Invitar amigos: solo lectura, espejo de portal.js — justo debajo del saludo -->
    <div class="card ref-hero-card reveal-up" style="--rv-dist:0px;margin-bottom:24px;">
      <div class="ref-hero-title">🎁 Invita y gana</div>
      <p class="ref-hero-sub">Comparte tu enlace personal. Cada amigo que se registre y pague te da un 30% de descuento en tu próxima cuota.</p>
      ${maRenderRefBlock(u)}
    </div>

    <!-- Calendario + Racha lado a lado en escritorio (solo lectura, espejo de portal.js) -->
    <div class="racha-cal-row">
      ${maRenderCalendarioCard(true)}
      ${maRenderRachaCard(true)}
    </div>

    <!-- Mis Vídeos, embebido en el mismo scroll -->
    <div style="display:flex;align-items:center;gap:14px;margin:8px 0 20px;">
      <div style="flex:1;height:1px;background:var(--card-border);"></div>
      <div style="font-size:10.5px;letter-spacing:3px;color:var(--muted);font-weight:700;">▶ MIS VÍDEOS</div>
      <div style="flex:1;height:1px;background:var(--card-border);"></div>
    </div>
    <div id="maVideosEmbed" class="reveal-up" style="--rv-dist:60px;margin-bottom:32px;"></div>
  </div>`;

  // Animación scroll-reveal: hero, invitar amigos y racha/calendario ya
  // están en el DOM (lo de abajo, Mis Vídeos, se activa aparte dentro de
  // maRenderVideos porque es async y todavía no existe en este punto).
  initScrollReveal(cont);

  maRenderVideos($('maVideosEmbed'));
}

/* ── Vista VÍDEOS del portal simulado — tarjetas de nivel, igual que el portal real ── */
/* Garantiza que _maVideos esté cargado antes de leerlo. Antes solo
   maRenderVideos hacía este fetch (de forma perezosa), así que si algo
   abría un nivel directamente (maAbrirNivel) sin haber pasado antes por
   la grilla de vídeos — por ejemplo, tras volver a entrar a "Ver como
   alumno" con el modal de una clase ya abierto — _maVideos podía estar
   vacío todavía y se veía "0 clases" / "Sin clases en este nivel" aunque
   el nivel sí tuviera clases reales. Centralizar la carga acá evita esa
   condición de carrera sin importar desde dónde se llame. */
async function maAsegurarVideosCargados(){
  if (_maVideos.length) return;
  try {
    const r = await fetch('/api/videos',{credentials:'same-origin'});
    if (r.ok) _maVideos = await r.json();
  } catch { _maVideos = []; }
}
async function maRenderVideos(cont){
  const u = _maUsuario || { plan: null };
  const tieneVideos = u.plan === '80' || u.portalAccess === true;

  // El Reel de Cursos y el carrusel de Eventos/Talleres son públicos —
  // se pintan para CUALQUIER alumno simulado, tenga o no el Aula Virtual.
  // Antes, estos dos "return" tempranos cortaban todo el bloque (incluidos
  // Reel y Eventos) para alumnos sin VIP, igual que el bug ya corregido en
  // portal.js (ver construirBloqueVideos).
  if (!tieneVideos){
    cont.innerHTML = `<div style="max-width:540px;margin:0 auto;padding:0 24px;">
      <div style="background:var(--card-bg);border:1px solid var(--card-border);
        border-radius:20px;padding:40px;text-align:center;">
        <div style="font-size:48px;margin-bottom:14px;">🔒</div>
        <h3 style="font-family:'Sora',sans-serif;font-size:20px;color:var(--white);margin-bottom:10px;">Aula Virtual no activa</h3>
        <p style="color:var(--text-2);font-size:13.5px;line-height:1.7;">
          Este alumno no tiene plan VIP.<br>Cambia su plan a <strong style="color:var(--gold);">VIP · Full Pass</strong> para activar el acceso.</p>
      </div></div>`
      + maRenderCursosReelCard()
      + maRenderEventosCarouselCard();
    _maCursos = maCursosParaAlumno();
    maCrPintarReel();
    await maAsegurarVideosCargados();
    maEvPintarCarrusel();
    maRepintarRachaCard();
    return;
  }

  await maAsegurarVideosCargados();
  // La tarjeta Racha (arriba, en Inicio) se pinta ANTES de que esta carga
  // async termine, así que sin este repintado quedaba pegada en "Todavía
  // no hay clases disponibles" (fueguito/redondeles nunca activados) aunque
  // el alumno sí tuviera vídeos — repintamos apenas _maVideos está listo.
  maRepintarRachaCard();

  if (!_maVideos.length){
    cont.innerHTML = `<div style="padding:28px 24px;color:var(--muted);text-align:center;">Sin vídeos cargados todavía.</div>`
      + maRenderCursosReelCard()
      + maRenderEventosCarouselCard();
    _maCursos = maCursosParaAlumno();
    maCrPintarReel();
    maEvPintarCarrusel();
    return;
  }

  // Niveles con contenido de clase (excluye calentamiento/bonus/playlist/evento), cruzando acceso real
  const discs = [...new Set(_maVideos.filter(v=>!v.tipo||v.tipo==='clase').map(v=>v.disciplina))];
  const nivelesCards = [];
  discs.forEach(disc=>{
    const acceso = maNivelesToAcceso(disc);
    [1,2,3,4].forEach(n=>{
      if (!acceso.includes(n)) return; // sin acceso a este nivel → ni se construye la tarjeta
      const vids = _maVideos.filter(v=>v.disciplina===disc && v.nivel===n && (!v.tipo||v.tipo==='clase'))
        .sort((a,b)=>(a.orden||0)-(b.orden||0));
      if (!vids.length) return;
      const bonus = n===4 ? [] : _maVideos.filter(v=>v.disciplina===disc && v.nivel===n && v.tipo==='bonus')
        .sort((a,b)=>(a.orden||0)-(b.orden||0));
      nivelesCards.push({disc, n, vids, bonus});
    });
  });

  // ── Calentamientos: sección propia e independiente, espejo de solo
  // lectura de portal.js. Va en la parte superior del módulo, por encima
  // del catálogo principal de clases. ──
  const calent = _maVideos.filter(v=>v.tipo==='calentamiento').sort((a,b)=>(a.orden||0)-(b.orden||0));
  let html = '';
  if (calent.length){
    html += `<div class="card reveal-up" style="margin-bottom:20px;padding:22px 20px;">
      <div class="h2" style="margin-bottom:14px;">🔥 Mis Calentamientos y Estiramientos</div>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 14px;">Independiente de tus niveles — úsalos antes de ensayar.</p>
      <div data-stagger style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        ${calent.map((v,i)=>`<div class="video-item calent-item ${i%2===0?'reveal-left':'reveal-right'}" style="--rv-dist:100px;" onclick="maAbrirCalentamiento('${v.id}')">
          ${maEsCompletado(v.id)?'<span class="vi-done" title="Ya lo hiciste (simulado)"></span>':''}
          <div class="vi-title">${esc(v.titulo)}</div>
          <div class="vi-disc">Calentamiento</div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  html += `<div data-stagger style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:20px;">`;
  nivelesCards.forEach((nc,idx)=>{
    const completados = maNivelVideosCompletados(nc.disc, nc.n);
    const desbloqueados = maNivelVideosDesbloqueados(nc.disc, nc.n);
    const bonusListo = maBonusNivelDesbloqueado(nc.disc, nc.n);
    const bonusDesbloqueados = bonusListo ? nc.bonus.length : nc.bonus.filter(bv=>maBonusDesbloqueadoPorRacha(bv.id)).length;
    html += `<div class="card ${idx%2===0?'reveal-left':'reveal-right'}" style="--rv-dist:120px;cursor:pointer;" onclick="maAbrirNivel('${esc(nc.disc)}',${nc.n})">
      <div style="font-weight:700;color:var(--white);font-size:13.5px;margin-bottom:12px;">${esc(nc.disc)} ${nivelLabelFull(nc.n)}</div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:10px;">
        <span style="font-family:'Sora',sans-serif;font-size:30px;font-weight:800;color:var(--stat-number);">${nc.vids.length + nc.bonus.length}</span>
        <span style="font-size:10px;color:var(--muted);letter-spacing:1px;">CLASES</span>
      </div>
      <div style="display:flex;gap:3px;margin-bottom:10px;" title="Progreso simulado en esta vista previa (${completados}/${nc.vids.length} completadas)">
        ${nc.vids.map((v,i)=>`<div style="flex:1;height:5px;border-radius:2px;background:${maEsCompletado(v.id)?'var(--progress-accent)':(i<desbloqueados?'var(--progress-accent-soft)':'rgba(255,255,255,.1)')};"></div>`).join('')}
      </div>
      <div style="text-align:right;"><span style="font-size:12px;color:var(--gold);font-weight:600;">Ver →</span></div>
      ${nc.bonus.length ? `<div style="display:flex;align-items:center;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--card-border);">
          <span style="font-size:13px;">🎁</span>
          <span style="font-size:10.5px;color:var(--muted);">Bonus: ${bonusDesbloqueados}/${nc.bonus.length} desbloqueados
            <span title="Simulado: 100% de las clases del nivel o racha semanal completa">(simulado)</span></span>
        </div>` : ''}
    </div>`;
  });
  html += `</div>`;

  html += maRenderCursosReelCard();

  html += `<div class="portal-paralelo">${maRenderMiPlaylistCard()}${maRenderEventosCarouselCard()}</div>`;

  html += `<div id="maAulaWrap" style="display:none;position:fixed;inset:0;z-index:250;
      align-items:flex-start;justify-content:center;padding:26px 16px;overflow-y:auto;
      background:rgba(5,5,5,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);"
      onclick="if(event.target===this) maCerrarPanelVideo()">
    <div class="card" style="width:100%;max-width:1000px;padding:0;overflow:hidden;margin:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;
        padding:16px 22px;border-bottom:1px solid var(--card-border);position:sticky;top:0;
        background:var(--card-bg);z-index:2;">
        <div style="min-width:0;">
          <div id="maPanelTitulo" style="font-size:16px;font-weight:800;color:var(--gold-2);letter-spacing:.2px;"></div>
          <div id="maPanelSub" style="font-size:11.5px;color:var(--muted);margin-top:2px;"></div>
        </div>
        <button class="btn sm sec" onclick="maCerrarPanelVideo()" style="flex:0 0 auto;white-space:nowrap;">← Volver a Cursos</button>
      </div>
      <div id="maPlayerWrap" style="position:relative;width:100%;padding-top:56.25%;background:#000;">
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
          color:var(--muted);gap:12px;background:#0e0e0e;">
          <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity=".3">
            <circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16" fill="currentColor"/>
          </svg>
          <span style="font-size:13px;">Selecciona una clase</span>
        </div>
      </div>
      <div id="maVideoMeta" style="padding:16px 22px 4px;">
        <div id="maVideoTitle" style="display:none;font-family:'Sora',sans-serif;font-size:17px;font-weight:700;color:var(--white);"></div>
        <div id="maVideoNotes" style="color:var(--text-2);font-size:13px;line-height:1.7;margin-top:6px;"></div>
      </div>
      <div id="maVideoCurrentLabel" class="video-status-bar" style="display:none;">
        <span id="maVideoCurrentLabelText"></span>
      </div>
      <div id="maVideoListRow" style="display:flex;flex-direction:column;gap:10px;align-items:stretch;padding:16px 22px;">
        <div style="font-size:11px;color:var(--muted);background:rgba(226,144,35,.06);
          border:1px solid var(--card-border);border-radius:10px;padding:8px 12px;">
          🧪 Vista previa: al hacer clic en una clase se simula que el alumno terminó de verla,
          para poder mostrar acá el desbloqueo 2x2, el modal y la tarjeta Racha en tiempo real.
        </div>
        <div id="maVideoList" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;"></div>
      </div>
    </div>
  </div>
  <div id="maDesbloqueoModalOverlay" class="desbloqueo-modal-overlay" style="display:none;"
      onclick="if(event.target===this) maContinuarDesdeModalDesbloqueo()">
    <div class="desbloqueo-modal-card">
      <button class="desbloqueo-modal-close" onclick="maCerrarModalDesbloqueo()" aria-label="Cerrar" title="Cerrar">✕</button>
      <img src="/tarjetas/desbloqueo/Rachas.jpg" alt="¡Vas muy bien! Sigue así" class="desbloqueo-modal-img"
        onclick="maContinuarDesdeModalDesbloqueo()">
      <div class="desbloqueo-modal-actions">
        <button class="btn" onclick="maContinuarDesdeModalDesbloqueo()">Continuar</button>
      </div>
    </div>
  </div>`;

  cont.innerHTML = html;

  // Animación scroll-reveal: calentamientos y tarjetas de nivel aparecen en
  // secuencia al hacer scroll (esta parte se activa acá porque llega async).
  initScrollReveal(cont);

  // "Mi Playlist" siempre arranca con Bachata Nivel 1 resaltado y su lista
  // de canciones cargada, pero SIN reproducir nada automáticamente. El
  // <audio>/barra se reconstruyen en cada render de esta vista, así que
  // hay que volver a engancharlos y olvidar cualquier reproducción previa.
  if ($('maMiPlaylistCard')){
    _mmpPlaying = null;
    mmpWireAudioEvents();
    _mmpVista = 'playlist';
    mmpRepintarTabs();
    mmpSeleccionarNivel('Bachata', 1);
  }

  // "Próximos Eventos y Talleres" arranca mostrando el primer evento.
  // _maVideos solo se carga automáticamente si el alumno simulado tiene
  // plan VIP (ver maRenderVideos) — pero los eventos son públicos y deben
  // verse para CUALQUIER alumno, igual que ya hace portal.js en su propio
  // renderInicio(). Forzamos la carga acá antes de pintar el carrusel para
  // no depender de que el admin haya visitado antes la pestaña de Vídeos.
  if ($('maEventosCarouselCard')){
    maAsegurarVideosCargados().then(maEvPintarCarrusel);
  }

  // Reel de Cursos Exclusivos — igual que Eventos, se pinta directo desde
  // db.cursos (ya en memoria del admin), independiente del plan del alumno.
  if ($('maCrReelCard')){
    _maCursos = maCursosParaAlumno();
    maCrPintarReel();
  }
}

/* ══ Reproductor de música (carpeta de Google Drive) — espejo del que ve
   el alumno de verdad en portal.js, para poder probarlo desde "Ver como
   alumno" en el panel admin. Usa el mismo registro db.videos
   (tipo:'playlist', origen:'drive'), sin llamadas al servidor propio. ══ */
let _maDriveTracks = [];
let _maDriveIndex  = -1;
let _maDriveCache  = {};
let _maDriveDisc   = null;
let _maDriveNivel  = null;
let _maDriveEventsWired = false;

function maWireDriveAudioEvents(){
  if (_maDriveEventsWired) return;
  _maDriveEventsWired = true;
  const audio = $('maDriveAudioEl');
  if (!audio) return;
  audio.addEventListener('play',  ()=>{ const b=$('maDrivePlayBtn'); if (b) b.textContent='⏸'; });
  audio.addEventListener('pause', ()=>{ const b=$('maDrivePlayBtn'); if (b) b.textContent='▶'; });
  audio.addEventListener('ended', maDriveSiguiente);
  audio.addEventListener('timeupdate', ()=>{
    const seek=$('maDriveSeek');
    if (seek && audio.duration) seek.value = String(audio.currentTime/audio.duration*100);
  });
}
async function maCargarReproductorDrive(disc, nivel){
  const wrap = $('maDrivePlayerWrap');
  if (!wrap) return;
  maDriveDetener();
  mmpDetener(); // no dejar sonando "Mi Playlist" a la vez que este reproductor
  _maDriveDisc=disc; _maDriveNivel=nivel;
  const rec = (_maVideos||[]).find(v=>v.disciplina===disc && v.nivel===nivel && v.tipo==='playlist' && v.origen==='drive');
  if (!rec || !rec.driveFolderId){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  maWireDriveAudioEvents();
  const list=$('maDriveTrackList'), controls=$('maDriveControls');
  if (controls) controls.style.display='none';
  if (list) list.innerHTML='<div style="padding:10px 4px;color:var(--muted);font-size:12px;">Cargando música…</div>';
  if ($('maDriveTrackCount')) $('maDriveTrackCount').textContent='';
  try {
    _maDriveTracks = await maObtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey);
    _maDriveIndex = -1;
    maPintarListaDrive();
  } catch(e){
    if (list) list.innerHTML = `<div style="padding:10px 4px;color:var(--warn);font-size:12px;line-height:1.6;">
      No se pudo cargar la música de este nivel. Verifica que la carpeta esté compartida como
      "Cualquier persona con el enlace" y que la clave de API de Google Drive sea correcta.</div>`;
  }
}
async function maObtenerCancionesDrive(folderId, apiKey){
  if (_maDriveCache[folderId]) return _maDriveCache[folderId];
  if (!apiKey) throw new Error('Falta la clave de API de Google Drive');
  const base='https://www.googleapis.com/drive/v3/files';
  const fields='files(id,name,mimeType)';
  const qAudio=`'${folderId}' in parents and trashed = false and mimeType contains 'audio/'`;
  let r=await fetch(`${base}?q=${encodeURIComponent(qAudio)}&fields=${encodeURIComponent(fields)}&orderBy=name&key=${encodeURIComponent(apiKey)}`);
  if (!r.ok) throw new Error('Error de la API de Google Drive ('+r.status+')');
  let j=await r.json();
  let files=j.files||[];
  if (!files.length){
    const qAll=`'${folderId}' in parents and trashed = false`;
    r=await fetch(`${base}?q=${encodeURIComponent(qAll)}&fields=${encodeURIComponent(fields)}&orderBy=name&key=${encodeURIComponent(apiKey)}`);
    if (r.ok){
      j=await r.json();
      files=(j.files||[]).filter(f=>/\.(mp3|wav|m4a|ogg|oga|flac|aac|opus|wma)$/i.test(f.name||''));
    }
  }
  _maDriveCache[folderId]=files;
  return files;
}
function maPintarListaDrive(){
  const list=$('maDriveTrackList');
  if (!list) return;
  if (!_maDriveTracks.length){
    list.innerHTML='<div style="padding:6px 2px;color:var(--muted);font-size:10.5px;">Sin canciones en la carpeta.</div>';
    if ($('maDriveTrackCount')) $('maDriveTrackCount').textContent='';
    if ($('maDriveControls')) $('maDriveControls').style.display='none';
    return;
  }
  if ($('maDriveTrackCount')) $('maDriveTrackCount').textContent=_maDriveTracks.length;
  const audio=$('maDriveAudioEl');
  const sonando = audio && !audio.paused;
  list.innerHTML=_maDriveTracks.map((t,i)=>{
    const activo=i===_maDriveIndex;
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer;
      background:transparent;" onclick="maDriveReproducir(${i})">
      <span style="width:12px;text-align:center;font-size:9px;color:${activo?'var(--gold)':'var(--muted)'};flex:0 0 auto;">${activo && sonando ? '♪' : (i+1)}</span>
      <span style="flex:1;min-width:0;font-size:10.5px;color:${activo?'var(--gold)':'var(--text-2)'};font-weight:${activo?'600':'400'};
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc((t.name||'').replace(/\.[^.]+$/,''))}</span>
    </div>`;
  }).join('');
  const controls=$('maDriveControls');
  if (controls) controls.style.display='flex';
}
function maDriveReproducir(i){
  const t=_maDriveTracks[i]; if (!t) return;
  const rec = (_maVideos||[]).find(v=>v.disciplina===_maDriveDisc && v.nivel===_maDriveNivel && v.tipo==='playlist' && v.origen==='drive');
  if (!rec) return;
  _maDriveIndex=i;
  const audio=$('maDriveAudioEl');
  audio.src=`https://www.googleapis.com/drive/v3/files/${t.id}?alt=media&key=${encodeURIComponent(rec.driveApiKey)}`;
  audio.play().catch(()=>{});
  maPintarListaDrive();
  const lbl=$('maDriveNowPlaying');
  if (lbl) lbl.textContent=(t.name||'').replace(/\.[^.]+$/,'');
}
function maDriveTogglePlayPause(){
  const audio=$('maDriveAudioEl'); if (!audio) return;
  if (!audio.src){ if (_maDriveTracks.length) maDriveReproducir(0); return; }
  if (audio.paused) audio.play().catch(()=>{}); else audio.pause();
}
function maDriveSiguiente(){
  if (!_maDriveTracks.length) return;
  maDriveReproducir((_maDriveIndex+1) % _maDriveTracks.length);
}
function maDriveAnterior(){
  if (!_maDriveTracks.length) return;
  maDriveReproducir((_maDriveIndex-1+_maDriveTracks.length) % _maDriveTracks.length);
}
function maDriveSeekTo(pct){
  const audio=$('maDriveAudioEl');
  if (audio && audio.duration) audio.currentTime=(pct/100)*audio.duration;
}
function maDriveDetener(){
  const audio=$('maDriveAudioEl');
  if (audio){ audio.pause(); audio.removeAttribute('src'); try{ audio.load(); }catch{} }
  _maDriveTracks=[]; _maDriveIndex=-1;
}

/* ══════════════════════════════════════════════════════════════════════
   "Mi Playlist" (espejo de portal.js) dentro de "Ver como alumno":
   encabezado (título+logo) → pestañas (Favoritos | desplegable Playlists)
   → panel único de canciones con scroll propio → reproductor fijo justo
   debajo de la lista, dentro de la misma tarjeta. Usa su propio
   <audio>/estado ("mmp*"), independiente del reproductor compacto del
   panel de vídeo (#maDrivePlayerWrap). Los favoritos aquí SOLO viven en
   memoria sobre _maUsuario (igual que eventRsvps) — no se guardan en el
   servidor ni en localStorage, porque es una simulación. ══════════ */
let _mmpTracks = [];
let _mmpNivelActivo = null; // {disc, nivel} | null
let _mmpVista = 'playlist'; // 'playlist' | 'favoritos'
let _mmpPlaying = null;     // {disc, nivel, id, name} | null
let _mmpVolumen = 0.9;

function mmpNivelLabel(disc, nivel){
  return nivel===4 ? `${disc} Musicalidad` : `${disc} Nivel ${nivel}`;
}

function maRenderMiPlaylistCard(){
  const discs = [...new Set(_maVideos.filter(v=>!v.tipo||v.tipo==='clase').map(v=>v.disciplina))];
  if (!discs.length) return '';
  const opcionesDisc = disc=>`<optgroup label="${esc(disc.toUpperCase())}">
      ${[1,2,3,4].map(n=>`<option value="${esc(disc)}|${n}">${esc(mmpNivelLabel(disc,n))}</option>`).join('')}
    </optgroup>`;
  return `<div class="card mp-shell reveal-left" id="maMiPlaylistCard" style="--rv-dist:120px;padding:0;overflow:hidden;">
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
      <button type="button" id="mmpTabFav" class="mp-tab" onclick="mmpMostrarFavoritos()">♥ Favoritos</button>
      <select id="mmpTabPlaylist" class="mp-tab mp-tab-select" onchange="mmpDropdownCambio(this.value)">
        <option value="" disabled hidden>🎵 Playlists</option>
        ${DISCIPLINAS_VIDEO.map(opcionesDisc).join('')}
      </select>
    </div>
    <div id="mmpListHeader" class="mp-list-header"></div>
    <div id="mmpListPanel" class="mp-list-panel"></div>
    <div class="mp-player" id="mmpPlayer">
      <audio id="mmpAudioEl" style="display:none;"></audio>
      <div class="mp-bb-row1">
        <div class="mp-bb-info">
          <div id="mmpNowPlaying" class="mp-bb-title">Selecciona una canción</div>
          <div id="mmpNowPlayingSub" class="mp-bb-sub"></div>
        </div>
        <div class="mp-bb-seekwrap">
          <span id="mmpTimeActual" class="mp-bb-time">0:00</span>
          <input type="range" id="mmpSeek" class="mp-bb-seek" min="0" max="100" value="0" oninput="mmpSeekTo(this.value)" aria-label="Progreso">
          <span id="mmpTimeTotal" class="mp-bb-time">0:00</span>
        </div>
      </div>
      <div class="mp-bb-row2">
        <div class="mp-bb-transport">
          <button id="mmpPrevBtn" class="mp-bb-btn" onclick="mmpAnterior()" aria-label="Anterior">⏮</button>
          <button id="mmpPlayBtn" class="mp-bb-play" onclick="mmpTogglePlayPause()" aria-label="Reproducir/Pausar">▶</button>
          <button id="mmpNextBtn" class="mp-bb-btn" onclick="mmpSiguiente()" aria-label="Siguiente">⏭</button>
        </div>
        <div class="mp-bb-extras">
          <span id="mmpBarHeart" class="mp-bb-heart" onclick="mmpToggleFavoritoActual()" aria-label="Favorito">♡</span>
          <span class="mp-bb-vol-icon" aria-hidden="true">🔊</span>
          <input type="range" id="mmpVolumen" class="mp-bb-vol" min="0" max="100" value="90" oninput="mmpSetVolumen(this.value)" title="Volumen" aria-label="Volumen">
        </div>
      </div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   "Próximos Eventos y Talleres" (espejo de portal.js) — carrusel
   horizontal interactivo, en paralelo con "Mi Playlist" dentro de "Ver
   como alumno". Usa _maVideos con tipo:'evento'. Las respuestas de
   asistencia (RSVP) solo se reflejan localmente en esta vista previa, no
   se guardan en el servidor. ══════════════════════════════════════════ */
function maYoutubeIdFromUrl(url){
  if (!url) return null;
  const m1=url.match(/[?&]v=([^&]+)/); if (m1) return m1[1];
  const m2=url.match(/youtu\.be\/([^?&]+)/); if (m2) return m2[1];
  const m3=url.match(/youtube\.com\/embed\/([^?&]+)/); if (m3) return m3[1];
  const m4=url.match(/youtube\.com\/shorts\/([^?&]+)/); if (m4) return m4[1];
  return null;
}
function maEventosCatalogo(){
  return _maVideos.filter(v=>v.tipo==='evento').map(v=>{
    let meta={}; try{ meta=JSON.parse(v.notas||'{}'); }catch{}
    return {id:v.id, titulo:v.titulo, imagen:v.url, tipoMedia:meta.tipoImagen||'upload', fecha:meta.fecha||'', descripcion:meta.descripcion||''};
  }).sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''));
}
function maFormatearFechaEvento(iso){
  try{ const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}); }
  catch{ return iso; }
}
function maRenderEventosCarouselCard(){
  return `<div class="card reveal-right" id="maEventosCarouselCard" style="--rv-dist:120px;padding:0;overflow:hidden;">
    <div style="padding:22px 26px 8px;
      display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="min-width:0;">
        <div class="h2" style="margin-bottom:4px;">🎉 Próximos Eventos y Talleres</div>
        <p style="font-size:12px;color:var(--muted);margin:0;">Desliza o usa las flechas — toca una foto para verla en grande.</p>
      </div>
      <div id="maEvNavWrap" style="display:none;align-items:center;gap:6px;flex:0 0 auto;">
        <button class="ev-nav-btn" onclick="maEvScroll(-1)" aria-label="Desplazar a la izquierda">←</button>
        <button class="ev-nav-btn" onclick="maEvScroll(1)" aria-label="Desplazar a la derecha">→</button>
      </div>
    </div>
    <div id="maEvCarouselBody"></div>
  </div>`;
}
const MA_EV_AUTOPLAY_MS_PER_CARD = 4200; // tiempo (ms) que tarda en recorrer una tarjeta a velocidad constante

/* Separación horizontal (px) por unidad de offset — espejo de _evCardStepPx/
   evActualizarCardStep() en portal.js: ya no es un número fijo, se recalcula
   leyendo el ancho ya renderizado de una tarjeta real (ver CSS .ev-card,
   ahora clamp(170px,50%,320px)) para que se vea igual de grande en un panel
   angosto o en una pantalla ancha. También ajusta el alto de #maEvCoverflow
   al alto real de la tarjeta, para no dejar una franja vacía debajo cuando
   el ancho real resulta menor al máximo del clamp. */
let _maEvCardStepPx = 200; // valor de respaldo hasta que haya una tarjeta en el DOM para medir
function maEvActualizarCardStep(){
  const muestra = document.querySelector('#maEvCoverflow .ev-card');
  if (!muestra) return;
  _maEvCardStepPx = muestra.offsetWidth * 0.91;
  const track = $('maEvCoverflow');
  if (track) track.style.height = muestra.offsetHeight + 'px';
}
window.addEventListener('resize', () => {
  if ($('maEvCoverflow')){ maEvActualizarCardStep(); maEvAplicarTransform(); }
});

/* Progreso circular sin límite — ver comentario extenso en evAplicarTransform/
   evIniciarAutoplay de portal.js (misma lógica, espejo exacto acá). */
let _maEvProgress = 0;
let _maEvAnimRAF = null;
let _maEvAutoplayRAF = null;
let _maEvAutoplayLastTs = null;
let _maEvDragActive = false, _maEvDragMoved = false, _maEvDragStartX = 0, _maEvDragStartProgress = 0;

/* Espejo de _evAutoplayTick()/evIniciarAutoplay()/evDetenerAutoplayTimer()
   en portal.js: avance continuo (no a saltos) que nunca se detiene solo. */
function _maEvAutoplayTick(ts){
  if (_maEvAutoplayLastTs == null) _maEvAutoplayLastTs = ts;
  const dt = ts - _maEvAutoplayLastTs;
  _maEvAutoplayLastTs = ts;
  const eventos = maEventosCatalogo();
  const track = $('maEvCoverflow');
  if (track && eventos.length > 1 && !_maEvDragActive && !_maEvAnimRAF){
    const ov = $('maEvLightboxOverlay');
    const lightboxAbierto = ov && ov.style.display !== 'none';
    if (!lightboxAbierto){
      _maEvProgress += dt / MA_EV_AUTOPLAY_MS_PER_CARD;
      maEvAplicarTransform();
    }
  }
  _maEvAutoplayRAF = requestAnimationFrame(_maEvAutoplayTick);
}
function maEvIniciarAutoplay(){
  if (_maEvAutoplayRAF) return;
  _maEvAutoplayLastTs = null;
  _maEvAutoplayRAF = requestAnimationFrame(_maEvAutoplayTick);
}
function maEvDetenerAutoplayTimer(){
  if (_maEvAutoplayRAF){ cancelAnimationFrame(_maEvAutoplayRAF); _maEvAutoplayRAF = null; }
  _maEvAutoplayLastTs = null;
}

/* Espejo de evPintarCarrusel() en portal.js: carrusel tipo "coverflow"
   circular e infinito — avanza solo sin parar nunca, y también se puede
   arrastrar con el dedo/ratón o mover con las flechas del encabezado.
   Cada tarjeta abre el lightbox al tocarla (ver maEvAbrirLightbox). */
function maEvPintarCarrusel(){
  const eventos = maEventosCatalogo();
  const body = $('maEvCarouselBody');
  const navWrap = $('maEvNavWrap');
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
  body.innerHTML = `<div class="ev-coverflow" id="maEvCoverflow">
    ${eventos.map((ev,i)=>maEvCardHtml(ev,i)).join('')}
  </div>`;
  _maEvAttachDrag();
  maEvActualizarCardStep();
  maEvAplicarTransform();
  maEvIniciarAutoplay();
}
function maEvCardHtml(ev, i){
  const ytId = ev.tipoMedia==='youtube' ? maYoutubeIdFromUrl(ev.imagen) : null;
  const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : ev.imagen;
  return `<div class="ev-card" data-ev-i="${i}" onclick="maEvClickCard(${i})">
    <div class="ev-card-media">
      ${thumb?`<img src="${esc(thumb)}" alt="${esc(ev.titulo)}" loading="lazy">`:''}
      ${ytId?`<span class="ev-card-play"></span>`:''}
    </div>
    <div class="ev-card-info">
      <div class="ev-card-titulo">${esc(ev.titulo)}</div>
      ${ev.fecha?`<div class="ev-card-fecha">📅 ${esc(maFormatearFechaEvento(ev.fecha))}</div>`:''}
    </div>
  </div>`;
}
function maEvAplicarTransform(){
  const track = $('maEvCoverflow');
  if (!track) return;
  const n = maEventosCatalogo().length;
  track.querySelectorAll('.ev-card').forEach(card=>{
    const i = Number(card.dataset.evI);
    let offset = i - _maEvProgress;
    if (n > 1){
      offset = ((offset % n) + n) % n;
      if (offset > n / 2) offset -= n;
    }
    const translateX = offset * _maEvCardStepPx;
    const scale = Math.max(0.55, 1 - Math.abs(offset) * 0.25);
    const opacity = Math.max(0.2, 1 - Math.abs(offset) * 0.5);
    card.style.transform = `translate(-50%,-50%) translateX(${translateX}px) scale(${scale})`;
    card.style.opacity = opacity;
    card.style.zIndex = Math.round(10 - Math.abs(offset));
  });
}
function maEvAnimarA(target){
  const eventos = maEventosCatalogo();
  if (!eventos.length) return;
  if (_maEvAnimRAF){ cancelAnimationFrame(_maEvAnimRAF); _maEvAnimRAF = null; }
  const start = _maEvProgress;
  const delta = target - start;
  if (Math.abs(delta) < 0.001){ _maEvProgress = target; maEvAplicarTransform(); return; }
  const dur = 380, t0 = performance.now();
  function paso(now){
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    _maEvProgress = start + delta * eased;
    maEvAplicarTransform();
    if (t < 1){ _maEvAnimRAF = requestAnimationFrame(paso); }
    else { _maEvProgress = target; maEvAplicarTransform(); _maEvAnimRAF = null; }
  }
  _maEvAnimRAF = requestAnimationFrame(paso);
}
function maEvScroll(dir){
  maEvAnimarA(Math.round(_maEvProgress) + dir);
}
function _maEvAttachDrag(){
  const track = $('maEvCoverflow');
  if (!track) return;
  track.addEventListener('pointerdown', _maEvDragStart);
  track.addEventListener('pointermove', _maEvDragMove);
  track.addEventListener('pointerup', _maEvDragEnd);
  track.addEventListener('pointercancel', _maEvDragEnd);
}
function _maEvDragStart(e){
  if (_maEvAnimRAF){ cancelAnimationFrame(_maEvAnimRAF); _maEvAnimRAF = null; }
  _maEvDragActive = true;
  _maEvDragMoved = false;
  _maEvDragStartX = e.clientX;
  _maEvDragStartProgress = _maEvProgress;
  try{ e.currentTarget.setPointerCapture(e.pointerId); }catch{}
}
function _maEvDragMove(e){
  if (!_maEvDragActive) return;
  const dx = e.clientX - _maEvDragStartX;
  // Umbral generoso (no 4px) para que un toque con el dedo en móvil, que
  // casi siempre tiembla unos píxeles, no se confunda con un arrastre real.
  if (Math.abs(dx) > 10) _maEvDragMoved = true;
  // Carrusel circular: no hay extremos que "rebotar".
  _maEvProgress = _maEvDragStartProgress - dx / _maEvCardStepPx;
  maEvAplicarTransform();
}
function _maEvDragEnd(){
  if (!_maEvDragActive) return;
  _maEvDragActive = false;
  maEvAnimarA(Math.round(_maEvProgress));
}
function maEvClickCard(i){
  if (_maEvDragMoved) return;
  maEvAbrirLightbox(i);
}

/* ── Lightbox de Eventos (espejo de evAbrirLightbox/etc. en portal.js) ──
   A diferencia del portal real (donde el overlay está fijo en el HTML),
   aquí se crea al vuelo dentro de #modoAlumnoShell — mismo patrón que
   maAbrirModalPagoCuota — porque todo "Ver como alumno" vive dentro de
   ese contenedor inyectado, no en el documento estático de index.html. */
let _maEvLightboxIndex = 0;
function maEvAbrirLightbox(i){
  const shell = $('modoAlumnoShell');
  if (!shell) return;
  let ov = $('maEvLightboxOverlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'maEvLightboxOverlay';
    ov.className = 'ev-lightbox-overlay';
    ov.onclick = (e)=>{ if (e.target===ov) maEvCerrarLightbox(); };
    ov.innerHTML = `
      <div class="ev-lightbox-card">
        <button type="button" class="ev-lightbox-close" onclick="maEvCerrarLightbox()" aria-label="Cerrar">×</button>
        <div id="maEvLightboxNavWrap" style="display:none;">
          <button type="button" class="ev-lightbox-nav prev" onclick="maEvLightboxAnterior()" aria-label="Evento anterior">←</button>
          <button type="button" class="ev-lightbox-nav next" onclick="maEvLightboxSiguiente()" aria-label="Evento siguiente">→</button>
        </div>
        <div id="maEvLightboxMedia" class="ev-lightbox-media"></div>
        <div class="ev-lightbox-info">
          <div id="maEvLightboxTitulo" class="ev-lightbox-titulo"></div>
          <div id="maEvLightboxFecha" class="ev-lightbox-fecha"></div>
          <div id="maEvLightboxDesc" class="ev-lightbox-desc"></div>
        </div>
      </div>`;
    shell.appendChild(ov);
  }
  _maEvLightboxIndex = i;
  maEvPintarLightbox();
  ov.style.display = 'flex';
  document.addEventListener('keydown', _maEvLightboxKeyHandler);
}
function maEvCerrarLightbox(){
  const ov = $('maEvLightboxOverlay');
  if (ov) ov.style.display = 'none';
  const media = $('maEvLightboxMedia');
  if (media) media.innerHTML = '';
  document.removeEventListener('keydown', _maEvLightboxKeyHandler);
}
function maEvLightboxAnterior(){
  const eventos = maEventosCatalogo();
  if (!eventos.length) return;
  _maEvLightboxIndex = (_maEvLightboxIndex - 1 + eventos.length) % eventos.length;
  maEvPintarLightbox();
}
function maEvLightboxSiguiente(){
  const eventos = maEventosCatalogo();
  if (!eventos.length) return;
  _maEvLightboxIndex = (_maEvLightboxIndex + 1) % eventos.length;
  maEvPintarLightbox();
}
function _maEvLightboxKeyHandler(e){
  if (e.key === 'Escape') maEvCerrarLightbox();
  else if (e.key === 'ArrowLeft') maEvLightboxAnterior();
  else if (e.key === 'ArrowRight') maEvLightboxSiguiente();
}
function maEvPintarLightbox(){
  const eventos = maEventosCatalogo();
  if (!eventos.length){ maEvCerrarLightbox(); return; }
  if (_maEvLightboxIndex >= eventos.length) _maEvLightboxIndex = 0;
  if (_maEvLightboxIndex < 0) _maEvLightboxIndex = eventos.length-1;
  const ev = eventos[_maEvLightboxIndex];
  const ytId = ev.tipoMedia==='youtube' ? maYoutubeIdFromUrl(ev.imagen) : null;
  const media = $('maEvLightboxMedia');
  if (media){
    media.innerHTML = ytId
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&modestbranding=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
      : `<img src="${esc(ev.imagen)}" alt="${esc(ev.titulo)}">`;
  }
  const titulo = $('maEvLightboxTitulo'); if (titulo) titulo.textContent = ev.titulo;
  const fecha = $('maEvLightboxFecha');
  if (fecha) fecha.innerHTML = ev.fecha ? `📅 ${esc(maFormatearFechaEvento(ev.fecha))}` : '';
  const desc = $('maEvLightboxDesc'); if (desc) desc.textContent = ev.descripcion || '';
  const nav = $('maEvLightboxNavWrap'); if (nav) nav.style.display = eventos.length>1 ? 'flex' : 'none';
}
/* Se llama al salir de "Inicio"/desactivar el modo alumno: detiene el
   avance automático del carrusel y cierra el lightbox si quedó abierto. */
function maEvDetenerAutoplay(){ maEvDetenerAutoplayTimer(); maEvCerrarLightbox(); }

function maResponderEvento(eventId, respuesta){
  if (!_maUsuario) return;
  _maUsuario.eventRsvps = _maUsuario.eventRsvps || {};
  _maUsuario.eventRsvps[eventId] = respuesta;
  maEvPintarCarrusel();
  showToast(respuesta==='si' ? '¡Genial, cuentan contigo! 🎉 (solo en esta vista previa)' : 'Anotado (solo en esta vista previa)','ok');
}

/* ══════════════════════════════════════════════════════════════════════
   CURSOS EXCLUSIVOS — espejo 'Ver como alumno' del Reel publicitario (Inicio)
   y la vista completa. Lee directo de db.cursos (el admin ya tiene todo en
   memoria) y calcula tieneAcceso localmente a partir de
   _maUsuario.cursosAsignados — no hay backend simulado que llamar.
   ══════════════════════════════════════════════════════════════════════ */
function maCursosParaAlumno(){
  const asignados = (_maUsuario && _maUsuario.cursosAsignados) || [];
  return (db.cursos||[]).filter(c=>c.activo!==false).slice().sort((a,b)=>(a.orden||0)-(b.orden||0))
    .map(c=>({...c, tieneAcceso: asignados.includes(c.id)}));
}

const MA_CR_AUTOPLAY_MS_PER_CARD = 4200;
let _maCrProgress = 0;
let _maCrAnimRAF = null;
let _maCrAutoplayRAF = null;
let _maCrAutoplayLastTs = null;
let _maCrCardStepPx = 200;
let _maCrDragActive = false, _maCrDragMoved = false, _maCrDragStartX = 0, _maCrDragStartProgress = 0;

function maCrActualizarCardStep(){
  const muestra = document.querySelector('#maCrReelCarousel .cr-card');
  if (!muestra) return;
  _maCrCardStepPx = muestra.offsetWidth * 0.91;
  const track = $('maCrReelCarousel');
  if (track) track.style.height = muestra.offsetHeight + 'px';
}
window.addEventListener('resize', () => {
  if ($('maCrReelCarousel')){ maCrActualizarCardStep(); maCrAplicarTransformReel(); }
});

function maCrTick(ts){
  if (_maCrAutoplayLastTs == null) _maCrAutoplayLastTs = ts;
  const dt = ts - _maCrAutoplayLastTs;
  _maCrAutoplayLastTs = ts;
  const n = (_maCursos||[]).length;
  const track = $('maCrReelCarousel');
  if (track && n > 1 && !_maCrDragActive && !_maCrAnimRAF){
    _maCrProgress += dt / MA_CR_AUTOPLAY_MS_PER_CARD;
    maCrAplicarTransformReel();
  }
  _maCrAutoplayRAF = requestAnimationFrame(maCrTick);
}
function maCrIniciarAutoplay(){
  if (_maCrAutoplayRAF) return;
  _maCrAutoplayLastTs = null;
  _maCrAutoplayRAF = requestAnimationFrame(maCrTick);
}
function maCrDetenerAutoplay(){
  if (_maCrAutoplayRAF){ cancelAnimationFrame(_maCrAutoplayRAF); _maCrAutoplayRAF = null; }
  _maCrAutoplayLastTs = null;
}

function maRenderCursosReelCard(){
  return `<div class="card reveal-right" id="maCrReelCard" style="--rv-dist:120px;padding:0;overflow:hidden;margin-bottom:20px;">
    <div style="padding:22px 26px 8px;
      display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="min-width:0;">
        <div class="h2" style="margin-bottom:4px;">🎓 Cursos Exclusivos</div>
        <p style="font-size:12px;color:var(--muted);margin:0;">Lleva tu baile al siguiente nivel — toca cualquier curso para ver el catálogo completo.</p>
      </div>
      <div id="maCrNavWrap" style="display:none;align-items:center;gap:6px;flex:0 0 auto;">
        <button class="ev-nav-btn" onclick="maCrScroll(-1)" aria-label="Desplazar a la izquierda">←</button>
        <button class="ev-nav-btn" onclick="maCrScroll(1)" aria-label="Desplazar a la derecha">→</button>
      </div>
    </div>
    <div id="maCrReelCarouselBody"></div>
  </div>`;
}
function maCrCardHtml(c, i){
  const bloqueado = c.tieneAcceso===false;
  // Sin onclick por tarjeta: el click vive en el contenedor
  // #maCrReelCarousel (ver maCrPintarReel) para que tocar cualquier punto
  // del slider navegue a Cursos, no solo el hit-target exacto de la tarjeta.
  if (bloqueado){
    // La portada SÍ se muestra aunque el alumno no tenga el curso asignado
    // (solo se le oculta el contenido/vídeos) — por eso pintamos la imagen
    // real de fondo, con un overlay oscuro + candado encima.
    return `<div class="ev-card cr-card" data-cr-i="${i}">
      <div class="ev-card-media">
        ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
        <div style="position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:5px;
          padding:5px 10px;border-radius:999px;background:rgba(0,0,0,.55);border:1px solid var(--gold-2);z-index:2;">
          <span style="font-size:11px;color:var(--gold-2);">🔒</span>
          <span style="font-size:9.5px;font-weight:700;color:var(--gold-2);letter-spacing:.3px;text-transform:uppercase;">Acceso Privado</span>
        </div>
      </div>
      <div class="ev-card-info">
        <div class="ev-card-titulo">${esc(c.nombre)}</div>
        <div class="ev-card-fecha">${esc(c.subcategoria||CURSOS_RITMO_LABEL[c.ritmo]||'')}</div>
      </div>
    </div>`;
  }
  return `<div class="ev-card cr-card" data-cr-i="${i}">
    <div class="ev-card-media">
      ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
      <span class="ev-card-play"></span>
    </div>
    <div class="ev-card-info">
      <div class="ev-card-titulo">${esc(c.nombre)}</div>
      <div class="ev-card-fecha">${esc(c.subcategoria||CURSOS_RITMO_LABEL[c.ritmo]||'')}</div>
    </div>
  </div>`;
}
function maCrPintarReel(){
  const cursos = _maCursos||[];
  const body = $('maCrReelCarouselBody');
  const navWrap = $('maCrNavWrap');
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
  body.innerHTML = `<div class="ev-coverflow" id="maCrReelCarousel" onclick="maCrClickCard()">
    ${cursos.map((c,i)=>maCrCardHtml(c,i)).join('')}
  </div>`;
  maCrActualizarCardStep();
  maCrAplicarTransformReel();
  maCrAttachDrag();
  maCrIniciarAutoplay();
}
function maCrAplicarTransformReel(){
  const track = $('maCrReelCarousel');
  if (!track) return;
  const n = (_maCursos||[]).length;
  track.querySelectorAll('.cr-card').forEach(card=>{
    const i = Number(card.dataset.crI);
    let offset = i - _maCrProgress;
    if (n > 1){
      offset = ((offset % n) + n) % n;
      if (offset > n / 2) offset -= n;
    }
    const translateX = offset * _maCrCardStepPx;
    const scale = Math.max(0.55, 1 - Math.abs(offset) * 0.25);
    const opacity = Math.max(0.2, 1 - Math.abs(offset) * 0.5);
    card.style.transform = `translate(-50%,-50%) translateX(${translateX}px) scale(${scale})`;
    card.style.opacity = opacity;
    card.style.zIndex = Math.round(10 - Math.abs(offset));
  });
}
function maCrAnimarA(target){
  const n = (_maCursos||[]).length;
  if (!n) return;
  if (_maCrAnimRAF){ cancelAnimationFrame(_maCrAnimRAF); _maCrAnimRAF = null; }
  const start = _maCrProgress;
  const delta = target - start;
  if (Math.abs(delta) < 0.001){ _maCrProgress = target; maCrAplicarTransformReel(); return; }
  const dur = 380, t0 = performance.now();
  function paso(now){
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    _maCrProgress = start + delta * eased;
    maCrAplicarTransformReel();
    if (t < 1){ _maCrAnimRAF = requestAnimationFrame(paso); }
    else { _maCrProgress = target; maCrAplicarTransformReel(); _maCrAnimRAF = null; }
  }
  _maCrAnimRAF = requestAnimationFrame(paso);
}
function maCrScroll(dir){
  maCrAnimarA(Math.round(_maCrProgress) + dir);
}
function maCrAttachDrag(){
  const track = $('maCrReelCarousel');
  if (!track) return;
  track.addEventListener('pointerdown', _maCrDragStart);
  track.addEventListener('pointermove', _maCrDragMove);
  track.addEventListener('pointerup', _maCrDragEnd);
  track.addEventListener('pointercancel', _maCrDragEnd);
}
function _maCrDragStart(e){
  if (_maCrAnimRAF){ cancelAnimationFrame(_maCrAnimRAF); _maCrAnimRAF = null; }
  _maCrDragActive = true;
  _maCrDragMoved = false;
  _maCrDragStartX = e.clientX;
  _maCrDragStartProgress = _maCrProgress;
  try{ e.currentTarget.setPointerCapture(e.pointerId); }catch{}
}
function _maCrDragMove(e){
  if (!_maCrDragActive) return;
  const dx = e.clientX - _maCrDragStartX;
  if (Math.abs(dx) > 10) _maCrDragMoved = true;
  _maCrProgress = _maCrDragStartProgress - dx / _maCrCardStepPx;
  maCrAplicarTransformReel();
}
function _maCrDragEnd(){
  if (!_maCrDragActive) return;
  _maCrDragActive = false;
  maCrAnimarA(Math.round(_maCrProgress));
}
/* Solo navega si fue un clic real (no el final de un arrastre) — mismo
   patrón que evClickCard. */
function maCrClickCard(){
  if (_maCrDragMoved) return;
  maNavegarA('cursos');
}

/* ══════════════════════════════════════════════
   SECCIÓN 2b — CURSOS EXCLUSIVOS (vista completa)
   Recrea el mockup: fondo #050505, tarjetas con marco dorado #D4A359,
   filtros por ritmo (pills) y acordeones desplegables agrupados por
   ritmo → subcategoría. Bloqueado = candado dorado + "Acceso Privado";
   desbloqueado = foto + play + título + duración/nivel.
   ══════════════════════════════════════════════ */
const MA_CX_RITMOS = ['bachata','salsa','otros'];
let _maCxFiltro = 'todos';
let _maCxAbiertos = {bachata:true, salsa:true, otros:true}; // acordeones abiertos por defecto, como en el mockup

async function maRenderCursosExclusivos(cont){
  cont.innerHTML = `<div class="cx-page" id="maCxPage">
    <div class="cx-hero">
      <div class="cx-hero-text">
        <div class="cx-titulo">Cursos Exclusivos</div>
        <div class="cx-subtitulo">Lleva tu baile al siguiente nivel</div>
      </div>
      <div class="cx-hero-deco"><img src="assets/cx-hero-deco.png" alt="Malevo Academia"></div>
    </div>
    <div class="cx-pills" id="maCxPills"></div>
    <div id="maCxAcordeones"><div class="cx-empty">Cargando cursos…</div></div>
  </div>`;

  _maCursos = maCursosParaAlumno();

  maCxPintarPills();
  maCxPintarAcordeones();
}

function maCxPintarPills(){
  const wrap = $('maCxPills');
  if (!wrap) return;
  const opciones = [
    {v:'todos', label:'Todos'},
    {v:'bachata', label:'Bachata'},
    {v:'salsa', label:'Salsa'},
    {v:'otros', label:'Otros Ritmos'},
  ];
  wrap.innerHTML = opciones.map(o =>
    `<button type="button" class="cx-pill${_maCxFiltro===o.v?' active':''}" onclick="maCxFiltrar('${o.v}')">${o.label}</button>`
  ).join('');
}

function maCxFiltrar(v){
  _maCxFiltro = v;
  maCxPintarPills();
  maCxPintarAcordeones();
}

function maCxToggleAcordeon(ritmo){
  _maCxAbiertos[ritmo] = !_maCxAbiertos[ritmo];
  const el = document.querySelector(`.cx-acc[data-ritmo="${ritmo}"]`);
  if (el) el.classList.toggle('open', _maCxAbiertos[ritmo]);
}

function maCxPintarAcordeones(){
  const wrap = $('maCxAcordeones');
  if (!wrap) return;
  const cursos = _maCursos || [];
  if (!cursos.length){
    wrap.innerHTML = `<div class="cx-empty">🎓 Todavía no hay cursos publicados.</div>`;
    return;
  }
  const ritmos = _maCxFiltro==='todos' ? MA_CX_RITMOS : [_maCxFiltro];
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
        <div class="cx-grid">${deSub.map(c=>maCxCardHtml(c)).join('')}</div>`;
    }).join('');
    const abierto = !!_maCxAbiertos[ritmo];
    html += `<div class="cx-acc${abierto?' open':''}" data-ritmo="${ritmo}">
      <div class="cx-acc-head" onclick="maCxToggleAcordeon('${ritmo}')">
        <div class="cx-acc-head-title">${CURSOS_RITMO_LABEL[ritmo]||ritmo}
          <span class="cx-acc-count">(${delRitmo.length})</span></div>
        <span class="cx-acc-chevron">▼</span>
      </div>
      <div class="cx-acc-body-wrap"><div class="cx-acc-body">${gruposHtml}</div></div>
    </div>`;
  });
  wrap.innerHTML = html || `<div class="cx-empty">No hay cursos en esta categoría todavía.</div>`;
}

function maCxCardHtml(c){
  const bloqueado = c.tieneAcceso===false;
  const metaParts = [c.nivel, c.duracion].filter(Boolean);
  if (bloqueado){
    // La portada se ve siempre a brillo original, sin oscurecer — solo un
    // badge de candado arriba indica que el contenido está gateado.
    return `<div class="cx-card locked" title="Acceso Privado" onclick="maCxAbrirCurso('${c.id}')">
      <div class="cx-card-media">
        ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
        <div class="cx-lock-badge"><span class="cx-lock-badge-ico">🔒</span><span class="cx-lock-badge-txt">Acceso Privado</span></div>
      </div>
      <div class="cx-card-info">
        <div class="cx-card-titulo">${esc(c.nombre)}</div>
        <div class="cx-card-meta">${esc(metaParts.join(' · '))}</div>
      </div>
    </div>`;
  }
  return `<div class="cx-card" onclick="maCxAbrirCurso('${c.id}')">
    <div class="cx-card-media">
      ${c.imagenPortada?`<img src="${esc(c.imagenPortada)}" alt="${esc(c.nombre)}" loading="lazy" referrerpolicy="no-referrer" onerror="cxImgFallback(this)">`:''}
      <span class="cx-card-play"></span>
    </div>
    <div class="cx-card-info">
      <div class="cx-card-titulo">${esc(c.nombre)}</div>
      <div class="cx-card-meta">${esc(metaParts.join(' · '))}</div>
    </div>
  </div>`;
}

/* ── Modal detalle de curso: lista de vídeos + reproductor inline ── */
function maCxAbrirCurso(cursoId){
  const c = (_maCursos||[]).find(x => x.id===cursoId);
  if (!c) return;
  const shell = $('modoAlumnoShell');
  if (!shell) return;
  let ov = $('maCursoDetalleOverlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'maCursoDetalleOverlay';
    ov.className = 'curso-detalle-overlay';
    shell.appendChild(ov);
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
      ? `<div id="maCxPlayerWrap"></div>` + videos.map((v,i) => `<div class="curso-detalle-video-row" id="maCxvrow_${i}" onclick="maCxPlayVideo('${cursoId}',${i})">
          <div class="curso-detalle-video-num">${i+1}</div>
          <div class="curso-detalle-video-titulo">${esc(v.titulo||'Vídeo '+(i+1))}</div>
        </div>`).join('')
      : `<div class="cx-empty" style="padding:16px 0;">Este curso todavía no tiene vídeos cargados.</div>`;
  }
  ov.innerHTML = `
    <div class="curso-detalle-card">
      <button type="button" class="curso-detalle-close" onclick="maCxCerrarCurso()">×</button>
      ${mediaHtml}
      <div class="curso-detalle-titulo">${esc(c.nombre)}</div>
      <div class="curso-detalle-meta">${esc(metaParts.join(' · ')||CURSOS_RITMO_LABEL[c.ritmo]||'')}</div>
      <div class="curso-detalle-body" id="maCxDetalleBody">${bodyHtml}</div>
    </div>`;
  ov.style.display = 'flex';
  window._maCxCursoActivoId = cursoId;
  const bodyEl = $('maCxDetalleBody');
  if (bodyEl){
    bodyEl.classList.add('cxd-body-enter');
    setTimeout(()=>{ bodyEl.classList.add('cxd-body-enter-active'); }, 160);
  }
}

function maCxCerrarCurso(){
  const ov = $('maCursoDetalleOverlay');
  if (ov){ ov.style.display='none'; ov.innerHTML=''; }
}

function maCxPlayVideo(cursoId, idx){
  const c = (_maCursos||[]).find(x => x.id===cursoId);
  if (!c) return;
  const v = (c.videos||[])[idx];
  if (!v) return;

  document.querySelectorAll('.curso-detalle-video-row').forEach((el,i)=>{
    el.classList.toggle('playing', i===idx);
  });

  const wrap = $('maCxPlayerWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.style.display = 'block';

  const url = v.url || '';
  if (url.includes('youtube.com/embed') || url.includes('youtu.be') || url.includes('youtube.com/watch') || url.includes('vimeo.com')){
    let embed = url;
    if (url.includes('youtu.be/')){ const vid_ = url.split('youtu.be/')[1].split('?')[0]; embed = `https://www.youtube-nocookie.com/embed/${vid_}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`; }
    else if (url.includes('youtube.com/watch')){ const p = new URLSearchParams(url.split('?')[1]); embed = `https://www.youtube-nocookie.com/embed/${p.get('v')}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`; }
    else if (url.includes('youtube.com/embed')){ const base = url.split('?')[0]; embed = `${base}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`; }
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


function mmpEmptyStateHtml(msg){
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
    color:var(--muted);gap:10px;padding:26px 10px;text-align:center;min-height:180px;">
    <span style="font-size:26px;opacity:.4;">🎧</span>
    <span style="font-size:12.5px;">${esc(msg)}</span>
  </div>`;
}

/* ── Pestañas: "Favoritos" (botón) vs. el desplegable "Playlists" ── */
function mmpRepintarTabs(){
  const favBtn = $('mmpTabFav');
  if (favBtn) favBtn.classList.toggle('active', _mmpVista==='favoritos');
  const sel = $('mmpTabPlaylist');
  if (sel) sel.classList.toggle('active', _mmpVista==='playlist');
}
function mmpMostrarFavoritos(){
  _mmpVista = 'favoritos';
  mmpRepintarTabs();
  mmpPintarPanelActivo();
}
function mmpDropdownCambio(value){
  if (!value) return;
  const [disc, nivelStr] = value.split('|');
  _mmpVista = 'playlist';
  mmpRepintarTabs();
  mmpSeleccionarNivel(disc, Number(nivelStr));
}
function mmpPintarPanelActivo(){
  if (_mmpVista === 'favoritos') mmpPintarFavoritosPanel();
  else mmpPintarListaPanel();
}

/* ── Favoritos: solo en memoria sobre _maUsuario.mpFavoritos (igual que
   eventRsvps) — se reinician al entrar a ver a otro alumno. ── */
function mmpFavKey(disc, nivel, id){ return `${disc}|${nivel}|${id}`; }
function mmpFavoritosObj(){
  if (!_maUsuario) return {};
  _maUsuario.mpFavoritos = _maUsuario.mpFavoritos || {};
  return _maUsuario.mpFavoritos;
}
function mmpEsFavorito(disc, nivel, id){
  return !!mmpFavoritosObj()[mmpFavKey(disc, nivel, id)];
}
function mmpToggleFavorito(disc, nivel, id, name){
  const favs = mmpFavoritosObj();
  const key = mmpFavKey(disc, nivel, id);
  if (favs[key]) delete favs[key];
  else favs[key] = {key, disc, nivel, id, name};
  mmpPintarPanelActivo();
  mmpActualizarCorazonBarra();
}
function mmpToggleFavoritoDeLista(i, ev){
  if (ev) ev.stopPropagation();
  const t = _mmpTracks[i];
  if (!t || !_mmpNivelActivo) return;
  mmpToggleFavorito(_mmpNivelActivo.disc, _mmpNivelActivo.nivel, t.id, t.name);
}
function mmpToggleFavoritoActual(){
  if (!_mmpPlaying) return;
  mmpToggleFavorito(_mmpPlaying.disc, _mmpPlaying.nivel, _mmpPlaying.id, _mmpPlaying.name);
}
function mmpQuitarFavoritoDeIndice(i, ev){
  if (ev) ev.stopPropagation();
  const favs = Object.values(mmpFavoritosObj());
  const f = favs[i];
  if (!f) return;
  mmpToggleFavorito(f.disc, f.nivel, f.id, f.name);
}
/* ── Menú de 3 puntos de cada fila: única acción = favorito on/off ── */
function mmpAbrirMenuFila(kind, i, ev){
  if (ev) ev.stopPropagation();
  document.querySelectorAll('.mp-row-menu-pop').forEach(el=>el.remove());
  let disc, nivel, id, name;
  if (kind==='fav'){
    const f = Object.values(mmpFavoritosObj())[i];
    if (!f) return;
    ({disc, nivel, id, name} = f);
  } else {
    const t = _mmpTracks[i];
    if (!t || !_mmpNivelActivo) return;
    disc = _mmpNivelActivo.disc; nivel = _mmpNivelActivo.nivel; id = t.id; name = t.name;
  }
  const fav = mmpEsFavorito(disc, nivel, id);
  const btn = ev.currentTarget;
  const row = btn.closest('.video-row');
  const opcion = document.createElement('button');
  opcion.type = 'button';
  opcion.textContent = fav ? '💔 Quitar de favoritos' : '♥ Agregar a favoritos';
  opcion.onclick = (e)=>{ e.stopPropagation(); mmpToggleFavorito(disc, nivel, id, name); pop.remove(); };
  const pop = document.createElement('div');
  pop.className = 'mp-row-menu-pop';
  pop.appendChild(opcion);
  (row || btn.parentElement).appendChild(pop);
  setTimeout(()=>{
    const cerrar = e=>{ if (!pop.contains(e.target)){ pop.remove(); document.removeEventListener('click', cerrar); } };
    document.addEventListener('click', cerrar);
  }, 0);
}

function mmpPintarFavoritosPanel(){
  const header = $('mmpListHeader');
  const panel = $('mmpListPanel');
  if (!panel) return;
  const favs = Object.values(mmpFavoritosObj());
  if (header) header.textContent = favs.length + (favs.length===1?' canción favorita':' canciones favoritas');
  if (!favs.length){
    panel.innerHTML = mmpEmptyStateHtml('Toca el ♡ de una canción para agregarla aquí.');
    return;
  }
  const audio = $('mmpAudioEl');
  const sonando = audio && !audio.paused;
  panel.innerHTML = favs.map((f,i)=>{
    const esLaQueSuena = _mmpPlaying && _mmpPlaying.disc===f.disc && _mmpPlaying.nivel===f.nivel && _mmpPlaying.id===f.id;
    const nombre = (f.name||'').replace(/\.[^.]+$/,'');
    return `<div class="video-row${esLaQueSuena?' active':''}" onclick="mmpReproducirFavoritoDeIndice(${i})">
      <div class="video-row-num">${esLaQueSuena && sonando ? '♪' : (i+1)}</div>
      <div style="flex:1;min-width:0;">
        <div class="video-row-title">${esc(nombre)}</div>
        <div class="video-row-sub">${esc(mmpNivelLabel(f.disc,f.nivel))}</div>
      </div>
      <span class="video-row-heart fav" onclick="mmpQuitarFavoritoDeIndice(${i},event)">♥</span>
      <span class="video-row-menu" onclick="mmpAbrirMenuFila('fav',${i},event)">⋮</span>
    </div>`;
  }).join('');
}
async function mmpReproducirFavoritoDeIndice(i){
  const favs = Object.values(mmpFavoritosObj());
  const f = favs[i];
  if (!f) return;
  const rec = (_maVideos||[]).find(v=>v.disciplina===f.disc && v.nivel===f.nivel && v.tipo==='playlist' && v.origen==='drive');
  if (!rec) return;
  let tracks;
  try{ tracks = await maObtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey); }catch{ return; }
  const t = tracks.find(x=>x.id===f.id) || {id:f.id, name:f.name};
  mmpReproducirTrack(f.disc, f.nivel, t);
  if (_mmpVista==='favoritos') mmpPintarFavoritosPanel();
}

async function mmpSeleccionarNivel(disc, nivel){
  _mmpNivelActivo = {disc, nivel};
  const sel = $('mmpTabPlaylist'); if (sel) sel.value = `${disc}|${nivel}`;
  maDriveDetener();
  const driveWrap=$('maDrivePlayerWrap'); if (driveWrap) driveWrap.style.display='none';

  const rec = (_maVideos||[]).find(v=>v.disciplina===disc && v.nivel===nivel && v.tipo==='playlist' && v.origen==='drive');
  if (!rec || !rec.driveFolderId){
    _mmpTracks = [];
    if (_mmpVista==='playlist'){
      const header=$('mmpListHeader'); if (header) header.textContent = mmpNivelLabel(disc,nivel);
      const panel=$('mmpListPanel');
      if (panel) panel.innerHTML = mmpEmptyStateHtml(`Todavía no hay música cargada para ${mmpNivelLabel(disc,nivel)}.`);
    }
    return;
  }

  if (_mmpVista==='playlist'){
    const header=$('mmpListHeader'); if (header) header.textContent = mmpNivelLabel(disc,nivel);
    const panel=$('mmpListPanel');
    if (panel) panel.innerHTML = mmpEmptyStateHtml('Cargando canciones…');
  }

  try {
    _mmpTracks = await maObtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey);
    if (_mmpVista==='playlist') mmpPintarListaPanel();
  } catch(e){
    _mmpTracks = [];
    if (_mmpVista==='playlist'){
      const panel=$('mmpListPanel');
      if (panel) panel.innerHTML = `<div style="padding:14px 4px;color:var(--warn);font-size:12.5px;line-height:1.6;">
        No se pudo cargar la música de este nivel. Verifica que la carpeta esté compartida como
        "Cualquier persona con el enlace" y que la clave de API de Google Drive sea correcta.</div>`;
    }
  }
}

function mmpWireAudioEvents(){
  const audio = $('mmpAudioEl');
  if (!audio) return;
  audio.volume = _mmpVolumen;
  audio.addEventListener('play',  ()=>{ const b=$('mmpPlayBtn'); if (b) b.textContent='⏸'; });
  audio.addEventListener('pause', ()=>{ const b=$('mmpPlayBtn'); if (b) b.textContent='▶'; });
  audio.addEventListener('ended', mmpSiguiente);
  audio.addEventListener('loadedmetadata', ()=>{
    const tt=$('mmpTimeTotal'); if (tt) tt.textContent = mmpFormatTiempo(audio.duration);
  });
  audio.addEventListener('timeupdate', ()=>{
    const seek=$('mmpSeek');
    if (seek && audio.duration) seek.value = String(audio.currentTime/audio.duration*100);
    const ta=$('mmpTimeActual'); if (ta) ta.textContent = mmpFormatTiempo(audio.currentTime);
  });
}
function mmpFormatTiempo(s){
  if (!isFinite(s) || s<0) return '0:00';
  const m=Math.floor(s/60), sec=Math.floor(s%60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function mmpSetVolumen(val){
  _mmpVolumen = Math.max(0, Math.min(1, val/100));
  const audio = $('mmpAudioEl');
  if (audio) audio.volume = _mmpVolumen;
}

function mmpPintarListaPanel(){
  const header = $('mmpListHeader');
  const panel = $('mmpListPanel');
  if (!panel || !_mmpNivelActivo) return;
  const disc = _mmpNivelActivo.disc, nivel = _mmpNivelActivo.nivel;
  if (!_mmpTracks.length){
    if (header) header.textContent = mmpNivelLabel(disc,nivel);
    panel.innerHTML = mmpEmptyStateHtml('Sin canciones en esta carpeta.');
    return;
  }
  if (header) header.textContent = `${mmpNivelLabel(disc,nivel)} · ${_mmpTracks.length}${_mmpTracks.length===1?' canción':' canciones'}`;
  const audio = $('mmpAudioEl');
  const sonando = audio && !audio.paused;
  panel.innerHTML = _mmpTracks.map((t,i)=>{
    const esLaQueSuena = _mmpPlaying && _mmpPlaying.disc===disc && _mmpPlaying.nivel===nivel && _mmpPlaying.id===t.id;
    const fav = mmpEsFavorito(disc, nivel, t.id);
    const nombre = (t.name||'').replace(/\.[^.]+$/,'');
    return `<div class="video-row${esLaQueSuena?' active':''}" onclick="mmpReproducir(${i})">
      <div class="video-row-num">${esLaQueSuena && sonando ? '♪' : (i+1)}</div>
      <div style="flex:1;min-width:0;"><div class="video-row-title">${esc(nombre)}</div></div>
      <span class="video-row-heart${fav?' fav':''}" onclick="mmpToggleFavoritoDeLista(${i},event)">${fav?'♥':'♡'}</span>
      <span class="video-row-menu" onclick="mmpAbrirMenuFila('lista',${i},event)">⋮</span>
    </div>`;
  }).join('');
}

function mmpReproducir(i){
  const t = _mmpTracks[i];
  if (!t || !_mmpNivelActivo) return;
  mmpReproducirTrack(_mmpNivelActivo.disc, _mmpNivelActivo.nivel, t);
}
function mmpReproducirTrack(disc, nivel, t){
  const rec = (_maVideos||[]).find(v=>v.disciplina===disc && v.nivel===nivel && v.tipo==='playlist' && v.origen==='drive');
  if (!rec) return;
  const audio = $('mmpAudioEl');
  if (!audio) return;
  _mmpPlaying = {disc, nivel, id:t.id, name:t.name};
  audio.src = `https://www.googleapis.com/drive/v3/files/${t.id}?alt=media&key=${encodeURIComponent(rec.driveApiKey)}`;
  audio.play().catch(()=>{});
  mmpPintarPanelActivo();
  const lbl = $('mmpNowPlaying'); if (lbl) lbl.textContent = (t.name||'').replace(/\.[^.]+$/,'');
  const sub = $('mmpNowPlayingSub'); if (sub) sub.textContent = mmpNivelLabel(disc, nivel);
  mmpActualizarCorazonBarra();
}
function mmpActualizarCorazonBarra(){
  const heart = $('mmpBarHeart');
  if (!heart) return;
  if (!_mmpPlaying){ heart.textContent='♡'; heart.classList.remove('fav'); return; }
  const fav = mmpEsFavorito(_mmpPlaying.disc, _mmpPlaying.nivel, _mmpPlaying.id);
  heart.textContent = fav ? '♥' : '♡';
  heart.classList.toggle('fav', fav);
}
function mmpTogglePlayPause(){
  const audio = $('mmpAudioEl'); if (!audio) return;
  if (!audio.src){ if (_mmpTracks.length) mmpReproducir(0); return; }
  if (audio.paused) audio.play().catch(()=>{}); else audio.pause();
}
async function mmpAvanzar(delta){
  if (!_mmpPlaying) return;
  const rec = (_maVideos||[]).find(v=>v.disciplina===_mmpPlaying.disc && v.nivel===_mmpPlaying.nivel && v.tipo==='playlist' && v.origen==='drive');
  if (!rec) return;
  let tracks;
  try{ tracks = await maObtenerCancionesDrive(rec.driveFolderId, rec.driveApiKey); }catch{ return; }
  if (!tracks.length) return;
  const i = tracks.findIndex(t=>t.id===_mmpPlaying.id);
  const next = tracks[((i<0?0:i)+delta+tracks.length)%tracks.length];
  mmpReproducirTrack(_mmpPlaying.disc, _mmpPlaying.nivel, next);
}
function mmpSiguiente(){ mmpAvanzar(1); }
function mmpAnterior(){ mmpAvanzar(-1); }
function mmpSeekTo(pct){
  const audio = $('mmpAudioEl');
  if (audio && audio.duration) audio.currentTime = (pct/100)*audio.duration;
}
function mmpDetener(){
  const audio = $('mmpAudioEl');
  if (audio) audio.pause();
  _mmpPlaying = null;
  const lbl = $('mmpNowPlaying'); if (lbl) lbl.textContent = 'Selecciona una canción';
  const sub = $('mmpNowPlayingSub'); if (sub) sub.textContent = '';
  mmpActualizarCorazonBarra();
  mmpPintarPanelActivo();
}

// Cerrar el modal de vídeo (modo alumno) con la tecla Escape
document.addEventListener('keydown', e=>{
  if (e.key!=='Escape') return;
  const modal=$('maDesbloqueoModalOverlay');
  if (modal && modal.style.display!=='none' && modal.style.display!==''){
    maCerrarModalDesbloqueo();
    return;
  }
  if ($('maAulaWrap') && $('maAulaWrap').style.display!=='none' && $('maAulaWrap').style.display!==''){
    maCerrarPanelVideo();
  }
});

/* ── Rotación automática al ampliar un vídeo a pantalla completa ──────────
   Espejo del mismo fix de portal.js: el manifest de la PWA fuerza
   "orientation":"portrait" para que el resto de la app no gire sola, pero
   eso bloquea la rotación al pulsar pantalla completa en el reproductor
   de YouTube/Vimeo (tanto en el portal real como aquí en "Ver como
   alumno"). Usamos la Screen Orientation API para levantar el bloqueo
   mientras el vídeo está en pantalla completa y devolverlo al salir. */
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

/* Construye la lista de clases + bonus de un nivel aplicando el
   bloqueo simulado 2x2 (espejo de _construirListaNivelHTML en portal.js,
   pero sobre _maCompletados en vez de datos reales de dispositivo). */
function maConstruirListaNivelHTML(disc, nivel){
  const vids = maVideosDeNivel(disc, nivel);
  if (!vids.length){
    return '<div style="padding:20px;color:var(--muted);font-size:13px;text-align:center;">Sin clases en este nivel.</div>';
  }
  const desbloqueados = maNivelVideosDesbloqueados(disc, nivel);
  const bonus = maBonusDeNivel(disc, nivel);
  const bonusListo = maBonusNivelDesbloqueado(disc, nivel);
  let html = '<div style="display:flex;flex-direction:column;gap:8px;">' + vids.map((v,i)=>{
    const completo = maEsCompletado(v.id);
    if (i>=desbloqueados){
      return `<div class="video-row" style="opacity:.55;cursor:not-allowed;" title="Se desbloquea al completar la clase anterior (simulado)">
        <div class="video-row-num">🔒</div>
        <div style="flex:1;min-width:0;"><div class="video-row-title">${esc(v.titulo)}</div></div>
      </div>`;
    }
    return `<div class="video-row${completo?' visto':''}" data-vid="${v.id}" onclick="maPlayVideo('${v.id}')">
      ${completo?'<span class="vi-done" title="Marcada como completada (simulado)"></span>':''}
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
      const porRacha = maBonusDesbloqueadoPorRacha(bv.id);
      const desbloqueado = bonusListo || porRacha;
      if (desbloqueado){
        return `<div class="video-row" data-vid="${bv.id}" onclick="maPlayVideo('${bv.id}')">
          <div class="video-row-num" style="background:var(--gold);color:#0a0a0a;border-color:transparent;">🎁</div>
          <div style="flex:1;min-width:0;">
            <div class="video-row-title">${esc(bv.titulo)}</div>
            <div class="video-row-sub">Bonus ${i+1} · ${(porRacha && !bonusListo) ? 'Desbloqueado con su racha 🔥' : 'Desbloqueado (100% del nivel, simulado)'}</div>
          </div>
          <span class="video-row-arrow" style="opacity:1;">▶</span>
        </div>`;
      }
      return `<div class="video-row" style="opacity:.55;cursor:not-allowed;"
        title="Se desbloquea al completar el 100% de las clases del nivel (simulado) o con la racha de 5 días">
        <div class="video-row-num">🔒</div>
        <div style="flex:1;min-width:0;">
          <div class="video-row-title">Bonus ${i+1} · ${esc(bv.titulo)}</div>
          <div class="video-row-sub">Se desbloquea al 100% del nivel (${maNivelVideosCompletados(disc,nivel)}/${vids.length}, simulado) o con la racha</div>
        </div>
      </div>`;
    }).join('');
  }
  return html;
}
async function maAbrirNivel(disc, nivel){
  await maAsegurarVideosCargados(); // evita el "Sin clases en este nivel" si _maVideos aún no había cargado
  const vids = maVideosDeNivel(disc, nivel);
  const bonus = maBonusDeNivel(disc, nivel);
  const totalClases = vids.length + bonus.length;
  _maNivelActivo = {disc, nivel};
  const wrap = $('maAulaWrap'); if (!wrap) return;
  wrap.style.display='flex';
  document.body.style.overflow = 'hidden';
  if ($('maPanelTitulo')) $('maPanelTitulo').textContent = `${disc} · ${nivelLabel(nivel)}`;
  if ($('maPanelSub'))    $('maPanelSub').textContent    = `${totalClases} clase${totalClases!==1?'s':''}`;
  maCargarReproductorDrive(disc, nivel);

  const list = $('maVideoList');
  if (list) list.innerHTML = maConstruirListaNivelHTML(disc, nivel);

  if (!vids.length) { playNav(); return; }
  const desbloqueados = maNivelVideosDesbloqueados(disc, nivel);
  const disponibles = vids.slice(0, desbloqueados);
  const primero = disponibles.find(v=>!maEsCompletado(v.id)) || disponibles[disponibles.length-1];
  maPlayVideo(primero.id, false);
  playNav();
}
/* El modal Rachas.png solo debe verse UNA vez por nivel (espejo de
   _desbloqueoModalYaVisto/_marcarDesbloqueoModalVisto en portal.js). En
   modo simulado no hay currentUser.sub real, así que se usa una clave
   fija de "modo alumno" para no mezclarse con el localStorage del portal
   real ni con el de otro alumno simulado. */
function _maDesbloqueoModalKey(disc, nivel){
  return 'malevo_dbmodal_maSim_'+disc+'_'+nivel;
}
function _maDesbloqueoModalYaVisto(disc, nivel){
  try { return localStorage.getItem(_maDesbloqueoModalKey(disc,nivel))==='1'; } catch { return false; }
}
function _maMarcarDesbloqueoModalVisto(disc, nivel){
  try { localStorage.setItem(_maDesbloqueoModalKey(disc,nivel), '1'); } catch {}
}
/* Procesa la finalización simulada de una clase: la marca completada,
   repinta la tarjeta Racha, refresca la lista del nivel abierto y — si
   corresponde (primera vez en ese nivel) — dispara el modal Rachas.png. */
function maProcesarDesbloqueo2x2(id){
  const v = _maVideos.find(x=>x.id===id);
  if (!v || (v.tipo && v.tipo!=='clase')) return;
  const esNueva = maMarcarCompletado(id);
  if (!esNueva) return;
  _maFuegoSimuladoHoy = true; // ya hubo consumo simulado de vídeo hoy: el fueguito nunca debe quedar en 0
  maRepintarRachaCard();
  if (_maNivelActivo && _maNivelActivo.disc===v.disciplina && _maNivelActivo.nivel===v.nivel && $('maVideoList')){
    $('maVideoList').innerHTML = maConstruirListaNivelHTML(v.disciplina, v.nivel);
  }
  const vids = maVideosDeNivel(v.disciplina, v.nivel);
  const completados = maNivelVideosCompletados(v.disciplina, v.nivel);
  if (completados % 2 !== 1) return;
  if (_maDesbloqueoModalYaVisto(v.disciplina, v.nivel)) return;
  const siguiente = vids.find(x=>!maEsCompletado(x.id));
  if (siguiente){
    _maMarcarDesbloqueoModalVisto(v.disciplina, v.nivel);
    maMostrarModalDesbloqueo(siguiente.id);
  }
}
let _maDesbloqueoModalSiguienteId = null;
function maMostrarModalDesbloqueo(siguienteVideoId){
  _maDesbloqueoModalSiguienteId = siguienteVideoId;
  const overlay = $('maDesbloqueoModalOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
}
function maCerrarModalDesbloqueo(){
  const overlay = $('maDesbloqueoModalOverlay');
  if (overlay) overlay.style.display = 'none';
  _maDesbloqueoModalSiguienteId = null;
}
function maContinuarDesdeModalDesbloqueo(){
  const siguienteId = _maDesbloqueoModalSiguienteId;
  maCerrarModalDesbloqueo();
  if (siguienteId) maPlayVideo(siguienteId, false);
}

/* ── Abre un vídeo de calentamiento/estiramiento en el mismo modal que las
   clases (maAulaWrap), reconstruyendo la lista de la sección en vez de la
   de un nivel. Espejo de solo lectura de reproducirEnHub() en portal.js
   para vídeos tipo='calentamiento'. ── */
function maAbrirCalentamiento(id){
  const wrap = $('maAulaWrap'); if (!wrap) return;
  wrap.style.display='flex';
  document.body.style.overflow = 'hidden';
  const grupo = _maVideos.filter(v=>v.tipo==='calentamiento').sort((a,b)=>(a.orden||0)-(b.orden||0));
  if ($('maPanelTitulo')) $('maPanelTitulo').textContent = '🔥 Mis Calentamientos y Estiramientos';
  if ($('maPanelSub'))    $('maPanelSub').textContent    = `${grupo.length} vídeo${grupo.length!==1?'s':''}`;
  const list = $('maVideoList');
  if (list){
    list.innerHTML = grupo.map((gv,i)=>`<div class="video-row${maEsCompletado(gv.id)?' visto':''}" data-vid="${gv.id}" onclick="maPlayVideo('${gv.id}')">
      ${maEsCompletado(gv.id)?'<span class="vi-done" title="Ya lo hiciste (simulado)"></span>':''}
      <div class="video-row-num">${i+1}</div>
      <div style="flex:1;min-width:0;"><div class="video-row-title">${esc(gv.titulo)}</div></div>
      <span class="video-row-arrow">▶</span>
    </div>`).join('');
  }
  maPlayVideo(id, false);
  playNav();
}

/* ── Cierra el panel de vídeo (botón "← Volver a Cursos") ── */
function maCerrarPanelVideo(){
  const wrap = $('maAulaWrap'); if (wrap) wrap.style.display='none';
  document.body.style.overflow = '';
  const label = $('maVideoCurrentLabel'); if (label) label.style.display='none';
  maDriveDetener();
  const driveWrap = $('maDrivePlayerWrap'); if (driveWrap) driveWrap.style.display='none';
}

/* simular=true (default, usado al hacer clic en una fila de la lista):
   marca la clase como completada al instante — el admin no reproduce el
   vídeo real, así que el clic hace las veces de "terminar de verla".
   simular=false (usado al abrir un nivel o al continuar desde el modal):
   solo carga el vídeo en el reproductor, sin completarlo todavía, igual
   que en el portal real donde cargar un vídeo no lo marca como visto. */
function maPlayVideo(id, simular=true){
  const v = _maVideos.find(x => x.id === id);
  if (!v) return;
  if (simular) maProcesarDesbloqueo2x2(id);
  document.querySelectorAll('#maVideoList .video-row, #maVideoList .clase-mini').forEach(el => {
    el.classList.toggle('active', el.dataset.vid === id);
    el.classList.toggle('playing', el.dataset.vid === id);
  });
  const title = $('maVideoTitle'), notes = $('maVideoNotes');
  if (title) { title.style.display = ''; title.textContent = v.titulo; }
  if (notes) notes.textContent = v.notas || '';

  const label = $('maVideoCurrentLabel');
  const labelText = $('maVideoCurrentLabelText');
  if (label && labelText){
    if (!v.tipo || v.tipo==='clase'){
      const lista = _maVideos.filter(x=>x.disciplina===v.disciplina && x.nivel===v.nivel && (!x.tipo||x.tipo==='clase'))
        .sort((a,b)=>(a.orden||0)-(b.orden||0));
      const posicion = lista.findIndex(x=>x.id===v.id) + 1;
      label.style.display='flex';
      labelText.innerHTML = `${esc(v.disciplina)} · ${nivelLabel(v.nivel)} — <span class="clase-actual">Clase ${posicion||1}</span>`;
    } else {
      label.style.display='none';
    }
  }
  const wrap = $('maPlayerWrap'); if (!wrap) return;
  wrap.querySelectorAll('iframe,video').forEach(e => e.remove());
  const placeholder = wrap.querySelector('div');
  if (placeholder) placeholder.remove();
  const url = v.url || '';
  if (url.includes('youtube.com/embed') || url.includes('youtu.be') || url.includes('vimeo.com')){
    let embed = url;
    if (url.includes('youtu.be/')){ const vid_ = url.split('youtu.be/')[1].split('?')[0]; embed = `https://www.youtube-nocookie.com/embed/${vid_}?rel=0&modestbranding=1&iv_load_policy=3`; }
    else if (url.includes('youtube.com/embed')){ const base = url.split('?')[0]; embed = `${base}?rel=0&modestbranding=1&iv_load_policy=3`; }
    const ifr = document.createElement('iframe');
    ifr.src = embed; ifr.allow = 'accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture';
    ifr.allowFullscreen = true;
    ifr.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;';
    wrap.appendChild(ifr);
  } else if (url.match(/\.(mp4|webm|m4v)$/i)){
    const vid_ = document.createElement('video');
    vid_.src = url; vid_.controls = true; vid_.controlsList = 'nodownload';
    vid_.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    wrap.appendChild(vid_);
  }
}
/* ── Calcula qué niveles puede ver el alumno en vista previa (modo admin) ──
   Espejo exacto de nivelesToAcceso() en portal.js, pero usando _maUsuario
   (el alumno que el admin está simulando) en vez de currentUser.
   Selección libre e independiente: se devuelve exactamente el array de
   niveles asignado a esa disciplina (sin acumulación ni casos especiales
   por plan). Devuelve SIEMPRE un array (nunca null). */
function maNivelesToAcceso(disc){
  const u = _maUsuario;
  if (!u) return [];
  const valor = disc === 'Bachata' ? u.nivelBachata
              : disc === 'Salsa'   ? u.nivelSalsa
              : null;
  return nivelesArr(valor);
}

/* ── Vista REFERIDOS del portal simulado ── */
function maRenderReferidos(cont){
  const u = _maUsuario;
  const code = u?.referralCode || '—';
  const referred = (db?.users||[]).filter(x=>x.referredBy===u?.id && x.active && !x.pendingPayment).length;
  const mesesPendientes = Number(u?.referralMesesPendientes || 0);
  const discount = mesesPendientes>0 ? 30 : 0;
  const link = `${malevoBaseUrl()}/registro-membresia.html?ref=${code}`;

  cont.innerHTML = `<div style="padding:28px 24px;max-width:700px;margin:0 auto;">
    <div class="h2">🎁 Invitar amigos</div>
    <div style="background:linear-gradient(135deg,rgba(226,144,35,.1),rgba(138,112,0,.07));
      border:1px solid rgba(226,144,35,.22);border-radius:20px;padding:32px;text-align:center;margin-bottom:18px;">
      <div style="font-size:44px;margin-bottom:12px;">🎁</div>
      <h3 style="font-family:'Sora',sans-serif;font-size:20px;color:var(--gold-2);margin-bottom:8px;">Gana un 30% de descuento</h3>
      <p style="color:var(--text-2);font-size:13.5px;line-height:1.7;">
        Cada amigo que se registre con tu enlace te da un <strong style="color:var(--gold-light);">30% de descuento</strong> en tu cuota.</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;">
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);border-radius:16px;padding:20px;text-align:center;">
        <div style="font-family:'Sora',sans-serif;font-size:34px;font-weight:800;color:var(--gold-2);">${referred}</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Amigos invitados</div>
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);border-radius:16px;padding:20px;text-align:center;">
        <div style="font-family:'Sora',sans-serif;font-size:34px;font-weight:800;color:${discount>0?'var(--ok)':'var(--muted)'};">${discount}%</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">
          ${mesesPendientes>0 ? `Activo · ${mesesPendientes} mes${mesesPendientes===1?'':'es'}` : 'Descuento activo'}</div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);border-radius:16px;padding:20px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600;">Enlace personal</div>
      <input type="text" value="${esc(link)}" readonly
        style="background:rgba(226,144,35,.06);border-color:rgba(226,144,35,.25);
          color:var(--gold-light);font-size:12.5px;cursor:pointer;" onclick="this.select();">
    </div>
  </div>`;
}

/* ── Vista PERFIL del portal simulado ── */
function maRenderPerfil(cont){
  const u = _maUsuario || { nombre:'', email:'', telefono:'', plan:null, nivelBachata:null, nivelSalsa:null, rol:'indiferente' };
  const planNombre = MA_PLANES[u.plan] || 'Sin plan asignado';

  cont.innerHTML = `<div style="padding:28px 24px;max-width:660px;margin:0 auto;">
    <div class="h2">👤 Mi perfil</div>

    <!-- ── Foto de perfil (editable desde aquí) ── -->
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);
      border-radius:18px;padding:22px;margin-bottom:16px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;
        margin-bottom:14px;font-weight:700;">📷 Foto de perfil</div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div style="flex:0 0 auto;">
          <div id="maFotoPreview" style="position:relative;width:90px;height:90px;border-radius:50%;overflow:hidden;
            background:linear-gradient(135deg,rgba(226,144,35,.2),rgba(138,112,0,.15));
            border:2px solid rgba(226,144,35,.4);display:flex;align-items:center;justify-content:center;
            box-shadow:0 2px 12px rgba(0,0,0,.4);"></div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:10px;">
          <p style="color:var(--muted);font-size:13px;margin:0;line-height:1.5;">
            La foto aparecerá en el saludo de inicio del alumno. Arrastra la imagen dentro
            del círculo para encuadrarla.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <label style="cursor:pointer;">
              <input type="file" id="maFotoInput" accept="image/*" style="display:none;"
                onchange="maPreviewFoto(this)">
              <span class="btn sm sec" style="display:inline-flex;align-items:center;gap:6px;">📁 Subir foto</span>
            </label>
            <button class="btn sm sec" onclick="maCapturarFoto()"
              style="display:inline-flex;align-items:center;gap:6px;">📷 Usar cámara</button>
            ${u.fotoPerfil ? '<button class="btn sm warn" onclick="maEliminarFoto()" style="display:inline-flex;align-items:center;gap:6px;">× Quitar foto</button>' : ''}
          </div>
          <canvas id="maFotoCanvas" style="display:none;"></canvas>
          <video id="maFotoVideo" autoplay playsinline
            style="display:none;width:220px;border-radius:10px;border:1px solid rgba(226,144,35,.3);"></video>
          <div id="maFotoCamControls" style="display:none;gap:8px;flex-wrap:wrap;">
            <button class="btn sm ok" onclick="maTomarFoto()"
              style="display:inline-flex;align-items:center;gap:6px;">📸 Tomar foto</button>
            <button class="btn sm sec" onclick="maCancelarCamara()"
              style="display:inline-flex;align-items:center;gap:6px;">× Cancelar</button>
          </div>
          <div id="maFotoGuardarWrap" style="display:none;">
            <button onclick="maGuardarFoto('${u.id}')"
              style="background:linear-gradient(135deg,var(--gold),var(--accent-deep));
                color:#0a0a0a;border:none;padding:9px 22px;border-radius:9px;cursor:pointer;
                font-size:13px;font-weight:700;font-family:inherit;
                box-shadow:0 4px 14px rgba(0,0,0,.4);display:inline-flex;align-items:center;gap:6px;">
              ✓ Guardar foto
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Datos -->
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);
      border-radius:18px;padding:22px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
        <div>
          <div style="font-size:17px;font-weight:700;">${esc(u.nombre||'—')}</div>
          <div style="font-size:12px;color:var(--muted);">@${esc(u.username||'')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px;">Email</div>
          <div style="font-size:13px;padding:9px 12px;background:rgba(255,255,255,.03);border-radius:8px;">${esc(u.email||'—')}</div></div>
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px;">Teléfono</div>
          <div style="font-size:13px;padding:9px 12px;background:rgba(255,255,255,.03);border-radius:8px;">${u.telefono?'📱 '+esc(u.telefono):'—'}</div></div>
      </div>
      ${u.bio?'<div style="margin-top:10px;font-size:12.5px;color:var(--text-2);padding:9px 12px;background:rgba(255,255,255,.03);border-radius:8px;">'+esc(u.bio)+'</div>':''}
    </div>

    <!-- Niveles y rol -->
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(226,144,35,.14);
      border-radius:18px;padding:22px;margin-bottom:16px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;font-weight:700;">Niveles y rol</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">
        <div style="padding:14px;background:rgba(255,255,255,.03);border-radius:12px;border:1px solid rgba(226,144,35,.1);">
          <div style="font-size:13px;font-weight:800;color:${nivelesArr(u.nivelBachata).length?'var(--gold-2)':'var(--muted)'};">${nivelesDisplayFull(u.nivelBachata)}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Bachata</div></div>
        <div style="padding:14px;background:rgba(255,255,255,.03);border-radius:12px;border:1px solid rgba(226,144,35,.1);">
          <div style="font-size:13px;font-weight:800;color:${nivelesArr(u.nivelSalsa).length?'var(--gold-2)':'var(--muted)'};">${nivelesDisplayFull(u.nivelSalsa)}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Salsa</div></div>
        <div style="padding:14px;background:rgba(255,255,255,.03);border-radius:12px;border:1px solid rgba(226,144,35,.1);">
          <div style="font-size:22px;">${u.rol==='leader'?'🕺':u.rol==='follower'?'💃':'🔄'}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:1px;">${u.rol==='leader'?'Leader':u.rol==='follower'?'Follower':'Indistinto'}</div></div>
      </div>
    </div>

    <!-- Plan -->
    <div style="background:rgba(226,144,35,.05);border:1px solid rgba(226,144,35,.18);
      border-radius:18px;padding:18px 20px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Plan actual</div>
          <div style="font-size:18px;font-weight:700;color:var(--gold-2);">${esc(planNombre)}</div>
        </div>
        ${u.plan==='80'?'<span class="badge ok">🎓 VIP · Aula Virtual</span>':'<span class="badge muted">Solo presencial</span>'}
      </div>
    </div>

    <button onclick="cerrarModal('modalVerAlumno');abrirModalAlumno('${u.id}')"
      style="background:rgba(255,255,255,.05);border:1px solid rgba(226,144,35,.28);color:var(--gold-2);
        padding:10px 22px;border-radius:9px;cursor:pointer;font-size:13px;
        font-weight:600;font-family:inherit;width:100%;">
      ✏ Editar todos los datos del alumno
    </button>
  </div>`;

  _maFotoPreviewDirty = false;
  _maFotoPreviewSetup(u.fotoPerfil || '', false);
}

/* ── Funciones de foto para la vista previa admin ──
   Mismo mecanismo de encuadre por arrastre que el portal real (ver
   _fotoPreviewSetup/_bindFotoDrag/_bakearFotoPreview en portal.js):
   la imagen se muestra sobredimensionada tipo "cover" y se puede arrastrar
   dentro del círculo; el encuadre elegido se hornea a canvas al guardar. */
let _maFotoPreviewDirty = false;

function _maFotoPreviewSetup(dataUrl, marcarDirty){
  const preview = $('maFotoPreview');
  if(!preview) return;
  const oldImg = $('maFotoPreviewImg');
  if(oldImg && oldImg._fotoDragCleanup) oldImg._fotoDragCleanup();
  if(!dataUrl){
    preview.innerHTML = '<span style="font-size:34px;opacity:.5;">👤</span>';
    return;
  }
  preview.innerHTML = `<img id="maFotoPreviewImg" src="${dataUrl}" draggable="false"
    style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    cursor:grab;touch-action:none;user-select:none;-webkit-user-drag:none;">`;
  if(marcarDirty) _maFotoPreviewDirty = true;
  _ajustarFotoPreviewCover($('maFotoPreviewImg'), preview);
  _maBindFotoDrag();
}

/* Ver _ajustarFotoPreviewCover en portal.js: mismo cálculo explícito en px
 * del tamaño "cover" (evita el truco CSS min-width/height:100%+auto, que
 * podía dar zooms desproporcionados con fotos de aspecto/resolución muy
 * variable). */
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

function _maBindFotoDrag(){
  const img = $('maFotoPreviewImg');
  const preview = $('maFotoPreview');
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
    _maFotoPreviewDirty = true;
    const w = $('maFotoGuardarWrap'); if(w) w.style.display = 'block';
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

function _maBakearFotoPreview(){
  return new Promise(resolve => {
    const img = $('maFotoPreviewImg');
    const preview = $('maFotoPreview');
    if(!img || !preview){ resolve(window._maFotoTemporal || ''); return; }
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

function maPreviewFoto(input){
  const file = input.files[0]; if(!file) return;
  if(file.size > 2*1024*1024){ showToast('Imagen debe ser < 2 MB','warn'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const d = e.target.result;
    window._maFotoTemporal = d;
    _maFotoPreviewSetup(d, true);
    const w = $('maFotoGuardarWrap'); if(w) w.style.display='block';
  };
  reader.readAsDataURL(file);
}
async function maCapturarFoto(){
  const v=$('maFotoVideo'), c=$('maFotoCamControls'); if(!v||!c) return;
  try {
    const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}});
    v._stream=s; v.srcObject=s; v.style.display='block'; c.style.display='flex';
  } catch { showToast('No se pudo acceder a la cámara','warn'); }
}
function maTomarFoto(){
  const v=$('maFotoVideo'), cv=$('maFotoCanvas'); if(!v||!cv) return;
  cv.width=v.videoWidth||320; cv.height=v.videoHeight||320;
  cv.getContext('2d').drawImage(v,0,0);
  const d=cv.toDataURL('image/jpeg',0.85);
  maCancelarCamara();
  window._maFotoTemporal=d;
  _maFotoPreviewSetup(d, true);
  const w=$('maFotoGuardarWrap'); if(w) w.style.display='block';
}
function maCancelarCamara(){
  const v=$('maFotoVideo'), c=$('maFotoCamControls');
  if(v){ if(v._stream) v._stream.getTracks().forEach(t=>t.stop()); v.style.display='none'; }
  if(c) c.style.display='none';
}
function maEliminarFoto(){
  if(!confirm('¿Quitar la foto de este alumno?')) return;
  window._maFotoTemporal='';
  _maFotoPreviewDirty = false;
  _maFotoPreviewSetup('', false);
  const w=$('maFotoGuardarWrap'); if(w) w.style.display='block';
}
async function maGuardarFoto(userId){
  if(window._maFotoTemporal===undefined && !_maFotoPreviewDirty){ showToast('Selecciona una foto primero','warn'); return; }
  // '' explícito = quitar foto; si no, hornear el encuadre actual del círculo
  const foto = window._maFotoTemporal === '' ? '' : await _maBakearFotoPreview();
  try {
    await apiJSON('PUT',`/api/users/${userId}`,{
      nombre:_maUsuario.nombre, telefono:_maUsuario.telefono||'',
      email:_maUsuario.email||'', role:'student', plan:_maUsuario.plan,
      active:_maUsuario.active!==false, portalAccess:_maUsuario.portalAccess||false,
      cashOnly:_maUsuario.cashOnly||false, guestCourtesy:_maUsuario.guestCourtesy||false,
      facturaEnvio:_maUsuario.facturaEnvio||'none',
      fotoPerfil: foto
    });
    _maUsuario.fotoPerfil = foto;
    delete window._maFotoTemporal;
    _maFotoPreviewDirty = false;
    await cargarDB();
    const w=$('maFotoGuardarWrap'); if(w) w.style.display='none';
    showToast('Foto guardada correctamente','ok');
    playSuccess(); flashSuccess();
  } catch(e){ showToast('Error al guardar: '+e.message,'warn'); }
}

/* ── Conectar botón Ver del listado al modo alumno ── */
function verComoAlumno(userId){
  maEntrarComoAlumno(userId);
}

/* ── mostrarBotonModoAlumno se llama desde arrancarApp (ver arriba) ── */
