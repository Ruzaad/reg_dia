/* ============================================================
   SAMITEX — Tickets Virtuales · app.js (compartido)
   Páginas: index.html (login+área) · operario.html · supervisora.html
   ============================================================ */

/* ---------------- CONFIGURACIÓN (editar aquí) ---------------- */
const SUPABASE_URL  = "https://lmlwomurgbbzolgbkwtp.supabase.co";      // https://xxxx.supabase.co
const SUPABASE_ANON = "sb_publishable_UL22rxFy12xjwf4R9ReRNQ_igpA1hwJ";          // Settings → API → anon public

const MAPA_ESTANDAR = {                          // cabecera normalizada -> campo
  "PRENDA":"prenda","ARTICULO":"articulo","MODULO":"modulo","OP":"op",
  "STD":"std","OF":"of","TALLA":"talla","COLOR":"color","NCORTE":"corte",
  "CANT":"cant","CODIGO":"codigo","NOP":"nop","NUMERACION":"num"
};

const AREAS = {
  "CAMISA COSTURA": {
    habilitada: true,
    sheetId: "1fuqMApXsZg-0PW4ugqtnye6zysVtoSAS_o4hhN1WDlo",
    hoja: "ALMACEN",
    hojaOF: "OF",                 // hoja con la meta por OF (cols: ARTICULO, OF, CANT PROG)
    mapa: MAPA_ESTANDAR
  },
  "ACABADO": {
    habilitada: false,               // PENDIENTE: compartir libro como lector + confirmar cabeceras
    sheetId: "1R2FqLRZpFjdA7rzUk6dsTyj898yUYO0aKU_OYG4e0Xc",
    hoja: "ALMACEN",
    mapa: MAPA_ESTANDAR              // ajustar cuando se vean sus columnas reales
  },
  "PANTALON COSTURA": {
    habilitada: true,
    sheetId: "1Or0seuSsiqmHSPAQ39RAfh1nWhpUtGi_ugFu4C4XCns",
    hoja: "ALMACEN",              // pestaña gid=0 del libro de PANTALONES
    mapa: MAPA_ESTANDAR           // GRUPO queda sin mapear (no se usa en el flujo)
  },
  "SACO COSTURA":     { habilitada:false }
};
const SESION_HORAS = 4;

/* ---------------- UTILIDADES ---------------- */
const $ = id => document.getElementById(id);
/* normKey: mayúsculas, sin tildes y SOLO letras/números.
   Cubre todas las variantes reales de cabecera:
   "N°OP" / "N° OP" / "N_OP" -> "NOP" · "N° CORTE" -> "NCORTE"
   "CANT." -> "CANT" · "O.F" -> "OF" · "EFICIENCIA%" -> "EFICIENCIA" */
const normKey = s => String(s==null?"":s).trim().toUpperCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^A-Z0-9]/g,"");
const norm = s => String(s==null?"":s).trim();
const COLORES = {NEGRO:"#212529",BLANCO:"#fafafa",ROSADO:"#e8a0b4",ROSA:"#e8a0b4",
  CELESTE:"#a8d0e6",AZUL:"#0D3B85",MARINO:"#0a2a5e",CREMA:"#f5e9d0",MARFIL:"#f2ead9",
  PLATA:"#d9dde1",PLOMO:"#8d949c",GRIS:"#adb5bd",LILA:"#c8a2c8",MORADO:"#8e6bb5",
  VINO:"#722f37",GUINDA:"#7b2d3b",VERDE:"#4a7c59",OLIVO:"#708238",ROJO:"#c0392b",
  AMARILLO:"#e4c441",MOSTAZA:"#d4a017",NARANJA:"#e08a3c",BEIGE:"#e6d8c3",
  HUESO:"#f1ece0",CAMEL:"#c19a6b",TURQUESA:"#5bc0be",AQUA:"#7fd4d4",
  CORAL:"#e8756a",FUCSIA:"#d3548f",MELON:"#f5b895",LACRE:"#a13d2d",
  PALOROSA:"#dcb2a7",PERLA:"#eae6de",ACERO:"#7f8c9b",PETROLEO:"#2f5d62"};
function colorDe(nombre){
  const k = normKey(nombre);
  if(!k) return "#ccc";
  if(COLORES[k]) return COLORES[k];                      // exacto
  for(const base in COLORES){                            // parcial: "CELESTE CLARO" -> CELESTE
    if(k.includes(base)) return COLORES[base];
  }
  let h=0; for(let i=0;i<k.length;i++) h=(h*31+k.charCodeAt(i))>>>0;  // desconocido: pastel estable
  return `hsl(${h%360},45%,78%)`;
}
const esc = s => String(s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
/* Solo apellidos: todo lo que va ANTES de la primera coma del registro.
   "PEREZ GOMEZ, JUAN CARLOS" -> "PEREZ GOMEZ". Sin coma, devuelve todo. */
const soloApellidos = s => String(s==null?"":s).split(",")[0].trim() || String(s||"").trim();

/* ---------------- CAMBIO DE PIN (compartido, todas las vistas) ---------------- */
function abrirCambioPin(){
  abrirModal(`
    <h2>Cambiar mi PIN</h2>
    <div class="sub" style="margin-bottom:12px;">Ingresa tu PIN actual y el nuevo (4 dígitos)</div>
    <div class="modal-campo"><label>PIN actual</label>
      <input id="cpActual" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>
    <div class="modal-campo"><label>PIN nuevo</label>
      <input id="cpNuevo" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>
    <div class="modal-campo"><label>Repite el PIN nuevo</label>
      <input id="cpNuevo2" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>
    <div class="modal-msg" id="cpMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarCambioPin()">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
async function guardarCambioPin(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const actual=$("cpActual").value.trim(), nuevo=$("cpNuevo").value.trim(), nuevo2=$("cpNuevo2").value.trim();
  const msg=$("cpMsg");
  if(!/^\d{4}$/.test(nuevo)){ msg.textContent="El nuevo PIN debe tener 4 dígitos"; return; }
  if(nuevo!==nuevo2){ msg.textContent="Los PIN nuevos no coinciden"; return; }
  try{
    const r=await rpc("fn_cambiar_pin",{p_dni:s.dni,p_token:s.token,p_pin_actual:actual,p_pin_nuevo:nuevo});
    if(!r.ok){ msg.textContent=r.error||"No se pudo cambiar"; return; }
    msg.style.color="var(--exito)"; msg.textContent="PIN actualizado";
    setTimeout(cerrarModal, 900);
  }catch(e){ msg.textContent=e.message; }
}

function irA(id){
  document.querySelectorAll(".pantalla").forEach(p=>p.classList.remove("activa"));
  const el = $(id); if(el) el.classList.add("activa");
  ocultarError();
  if(typeof window.onCambioPaso === "function") window.onCambioPaso(id);
}
/* ---- Toasts (popouts abajo-derecha) ---- */
function _toastWrap(){
  let w=document.getElementById("toastWrap");
  if(!w){ w=document.createElement("div"); w.id="toastWrap"; w.className="toast-wrap";
    w.setAttribute("aria-live","polite"); document.body.appendChild(w); }
  return w;
}
function toast(msg, tipo){
  const w=_toastWrap();
  const t=document.createElement("div");
  t.className="toast "+(tipo||"error");
  t.setAttribute("role","status");
  t.innerHTML=`<span class="toast-msg">${esc(msg)}</span><button class="toast-x" aria-label="Cerrar">×</button>`;
  t.querySelector(".toast-x").onclick=()=>cerrarToast(t);
  w.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("visible"));
  const ms = tipo==="ok" ? 3000 : 5000;
  setTimeout(()=>cerrarToast(t), ms);
  return t;
}
function cerrarToast(t){ if(!t) return; t.classList.remove("visible");
  setTimeout(()=>{ if(t.parentNode) t.parentNode.removeChild(t); }, 220); }
function mostrarError(msg){ toast(msg, "error"); }
function mostrarOk(msg){ toast(msg, "ok"); }
function ocultarError(){ /* compat: los toasts se cierran solos */ }
function cargandoHTML(txt){ return `<div class="cargando"><div class="spinner"></div>${esc(txt)}</div>`; }
function abrirModal(html){ const o=$("modalOverlay"); if(!o) return; $("modalBox").innerHTML=html; o.classList.add("visible"); }
function cerrarModal(){ const o=$("modalOverlay"); if(!o) return; o.classList.remove("visible"); $("modalBox").innerHTML=""; }

/* ---------------- SESIÓN (localStorage, 4h) ---------------- */
function guardarSesion(s){ s.exp = Date.now() + SESION_HORAS*3600*1000; localStorage.setItem("stx_sesion", JSON.stringify(s)); }
function sesionActual(){
  try{
    const s = JSON.parse(localStorage.getItem("stx_sesion")||"null");
    if(!s || Date.now() > s.exp){ localStorage.removeItem("stx_sesion"); return null; }
    return s;
  }catch(e){ return null; }
}
function cerrarSesion(){ localStorage.removeItem("stx_sesion"); location.href = "index.html"; }

/* ---------------- SUPABASE (RPC) ---------------- */
async function rpc(fn, args){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json",
      "apikey":SUPABASE_ANON, "Authorization":"Bearer "+SUPABASE_ANON },
    body: JSON.stringify(args)
  });
  if(!r.ok){
    let detalle = "";
    try{ const j = await r.json(); detalle = j.message || j.hint || ""; }catch(e){}
    if(detalle.includes("SESION_INVALIDA")){ cerrarSesion(); throw new Error("Sesión vencida"); }
    if(detalle.includes("NO_AUTORIZADA")) throw new Error("No autorizada para esta acción");
    throw new Error("Servidor: " + (detalle || ("error " + r.status)));
  }
  return await r.json();
}

/* ---------------- EDGE FUNCTIONS (Supabase) ---------------- */
async function edgeFn(nombre, body){
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${nombre}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json",
      "apikey":SUPABASE_ANON, "Authorization":"Bearer "+SUPABASE_ANON },
    body: JSON.stringify(body)
  });
  let j; try{ j = await r.json(); }catch(e){ throw new Error("Respuesta no válida de "+nombre); }
  if(!r.ok && j && j.ok===undefined) throw new Error(j.error || ("error "+r.status));
  return j;
}

/* ---------------- ÁREAS DESDE LA BASE DE DATOS ----------------
   fn_areas_listar devuelve el distinct de area_actual/area_origen de
   operarios (incluye CORTE, REPROCESOS, etc.). AREAS (arriba) solo
   define qué áreas tienen almacén en Sheets para el flujo de operario. */
let AREAS_DB = null;
async function cargarAreasDB(){
  if(AREAS_DB) return AREAS_DB;
  const s = sesionActual();
  try{
    const r = await rpc("fn_areas_listar",{p_dni:s.dni, p_token:s.token});
    AREAS_DB = [...new Set([...(Array.isArray(r)?r:[]), ...Object.keys(AREAS)])]
      .filter(Boolean).sort();
  }catch(e){
    console.warn("fn_areas_listar no disponible, uso AREAS locales:", e.message);
    AREAS_DB = Object.keys(AREAS);
  }
  return AREAS_DB;
}

/* ---------------- LECTOR DE ALMACÉN (Google Sheets CSV) ---------------- */
function parseCSV(texto){
  const filas=[]; let fila=[], campo="", dentro=false;
  for(let i=0;i<texto.length;i++){
    const c=texto[i];
    if(dentro){
      if(c==='"'){ if(texto[i+1]==='"'){campo+='"';i++;} else dentro=false; }
      else campo+=c;
    } else {
      if(c==='"') dentro=true;
      else if(c===','){ fila.push(campo); campo=""; }
      else if(c==='\n'){ fila.push(campo); filas.push(fila); fila=[]; campo=""; }
      else if(c!=='\r') campo+=c;
    }
  }
  if(campo!=="" || fila.length){ fila.push(campo); filas.push(fila); }
  return filas;
}

async function cargarAlmacen(nombreArea){
  const cfg = AREAS[nombreArea];
  if(!cfg || !cfg.habilitada) throw new Error("Área no habilitada todavía");
  const url = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.hoja)}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("No se pudo leer el almacén (¿libro compartido como lector?)");
  const filas = parseCSV(await r.text());
  if(filas.length < 2) throw new Error("El almacén está vacío");

  const idx = {}; const sinMapear = [];
  filas[0].forEach((h,i)=>{
    const k = normKey(h);
    if(cfg.mapa[k]) idx[cfg.mapa[k]] = i;
    else if(k) sinMapear.push(h);
  });
  // Diagnóstico: si una columna esperada no aparece, se ve aquí en consola.
  console.info("Almacén "+nombreArea+" — columnas mapeadas:", idx,
               sinMapear.length ? "· sin mapear: "+sinMapear.join(", ") : "");
  if(idx.codigo===undefined || idx.op===undefined || idx.of===undefined)
    throw new Error("El almacén no tiene las columnas esperadas (CÓDIGO/OP/O.F)");

  const tickets=[]; const vistos={}; const duplicados=[];
  for(let i=1;i<filas.length;i++){
    const f = filas[i];
    const codigo = norm(f[idx.codigo]);
    if(!codigo) continue;
    if(vistos[codigo]){ duplicados.push(codigo); continue; }
    vistos[codigo]=true;
    const std  = parseFloat(f[idx.std])  || 0;
    const cant = parseFloat(f[idx.cant]) || 0;
    tickets.push({
      codigo, std, cant,
      nop:     parseInt(f[idx.nop]) || null,
      of:      norm(f[idx.of]),
      modulo:  norm(f[idx.modulo]),
      op:      norm(f[idx.op]),
      talla:   norm(f[idx.talla]),
      color:   norm(f[idx.color]),
      corte:   norm(f[idx.corte]),
      num:     norm(f[idx.num]),
      articulo:norm(f[idx.articulo]),
      minutos: Math.round(std*cant*10)/10
    });
  }
  return { tickets, duplicados };
}

/* ============================================================
   PÁGINA: LOGIN + ÁREA (index.html)
   ============================================================ */
function destinoPorCargo(cargo){
  if(cargo==="INGENIERIA") return "ingenieria.html";
  if(cargo==="SUPERVISORA") return "supervisora.html";
  return "operario.html";
}
function initLogin(){
  const s = sesionActual();
  if(s && (s.area || s.cargo==="INGENIERIA")){ location.href = destinoPorCargo(s.cargo); return; }

  let dni="", pin="", foco="dni", modoIng=false;
  $("linkIng").onclick = ()=>{
    modoIng = !modoIng; dni=""; pin="";
    $("zonaDniNum").style.display  = modoIng ? "none" : "block";
    $("zonaDniTxt").style.display  = modoIng ? "block" : "none";
    // Ingeniería: sin teclado en pantalla; PIN se escribe con el teclado de la PC.
    $("zonaPinNum").style.display  = modoIng ? "none" : "block";
    $("zonaPinTxt").style.display  = modoIng ? "block" : "none";
    $("tecladoLogin").style.display = modoIng ? "none" : "grid";
    $("linkIng").textContent = modoIng ? "← Ingreso de personal" : "Ingreso ingeniería";
    if(modoIng){ $("inputUsuario").value=""; $("inputPinIng").value=""; $("inputUsuario").focus(); foco="pin"; }
    else foco="dni";
    pintar();
  };
  // Enter y flujo de teclado físico para el modo ingeniería.
  $("inputUsuario").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); $("inputPinIng").focus(); } });
  $("inputPinIng").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); intentarLogin(); } });
  const pintar = ()=>{
    if(modoIng) dni = normKey($("inputUsuario").value);
    $("dispDni").textContent = dni.padEnd(8,"•");
    $("dispPin").textContent = "•".repeat(pin.length).padEnd(4,"·");
    $("dispDni").style.borderColor = foco==="dni" ? "var(--enlace)" : "var(--azul)";
    $("dispPin").style.borderColor = foco==="pin" ? "var(--enlace)" : "var(--azul)";
  };
  $("dispDni").onclick = ()=>{ foco="dni"; pintar(); };
  $("dispPin").onclick = ()=>{ foco="pin"; pintar(); };

  const teclas=[1,2,3,4,5,6,7,8,9,"BORRAR",0,"ENTRAR"];
  teclas.forEach(k=>{
    const b=document.createElement("button");
    b.className="tecla"+(k==="BORRAR"?" borrar":k==="ENTRAR"?" accion":"");
    b.textContent=k;
    b.onclick=()=>{
      if(k==="BORRAR"){ if(foco==="dni") dni=dni.slice(0,-1); else pin=pin.slice(0,-1); }
      else if(k==="ENTRAR"){ intentarLogin(); return; }
      else {
        if(foco==="dni" && !modoIng){ if(dni.length<8) dni+=String(k); if(dni.length===8) foco="pin"; }
        else if(pin.length<4) pin+=String(k);
      }
      pintar();
    };
    $("tecladoLogin").appendChild(b);
  });
  pintar();

  async function intentarLogin(){
    $("msgLogin").textContent="";
    if(modoIng){ dni = normKey($("inputUsuario").value); pin = $("inputPinIng").value.trim(); }
    if(!modoIng && dni.length!==8){ $("msgLogin").textContent="El DNI debe tener 8 dígitos"; return; }
    if(modoIng && !dni){ $("msgLogin").textContent="Escribe tu usuario"; return; }
    if(pin.length!==4){ $("msgLogin").textContent="La clave debe tener 4 dígitos"; return; }
    $("msgLogin").textContent="Verificando…";
    try{
      const r = await rpc("fn_login", {p_dni:dni, p_pin:pin});
      if(!r.ok){ $("msgLogin").textContent=r.error; pin=""; pintar(); return; }
      guardarSesion({dni:r.dni, nombre:r.nombre, cargo:r.cargo, token:r.token, area:null});
      if(r.cargo==="INGENIERIA"){ location.href="ingenieria.html"; return; }
      $("nombreSaludo").textContent = "Hola, " + r.nombre.split(" ")[0];
      pintarAreas(r.cargo);
      irA("pasoArea");
    }catch(e){ $("msgLogin").textContent = e.message; }
  }

  function pintarAreas(cargo){
    const g=$("gridAreas"); g.innerHTML="";
    Object.keys(AREAS).forEach(a=>{
      const cfg=AREAS[a];
      const c=document.createElement("div");
      c.className="card-area"+(cfg.habilitada?"":" off");
      c.innerHTML=`<div class="ca-nombre">${esc(a)}</div>
        <div class="ca-sub">${cfg.habilitada?"Disponible":"Próximamente"}</div>`;
      if(cfg.habilitada){
        c.onclick=()=>{
          const s=sesionActual(); s.area=a; guardarSesion(s);
          location.href = destinoPorCargo(cargo);
        };
      }
      g.appendChild(c);
    });
  }
}

let ALM=null, RECL={}, sel={of:null,modulo:null,op:null,ticket:null};
let AREA_ESTAJERO = null;   // área elegida por el estajero para este reclamo (no persiste en operarios.area_actual)

const VOLVER_OPERARIO = {
  pasoModulos:"pasoOF", pasoOps:"pasoModulos",
  pasoTickets:"pasoOps", pasoConf:"pasoTickets"
};

let sa={signo:-1};
function abrirSolicitudAjuste(){
  sa={signo:-1};
  abrirModal(`
    <h2>Solicitar ajuste de tiempo</h2>
    <div class="sub" style="margin-bottom:12px;">Pides a supervisión sumar o restar minutos de tu día</div>
    <div class="seg" id="saSeg">
      <button id="saResta" class="activo" onclick="saSigno(-1)">RESTA min</button>
      <button id="saSuma" onclick="saSigno(1)">SUMA min</button>
    </div>
    <div class="modal-campo"><label>Minutos</label>
      <input id="saMin" inputmode="numeric" maxlength="3" placeholder="Ej: 30"></div>
    <div class="modal-campo"><label>Motivo</label>
      <input id="saMotivo" maxlength="140" placeholder="Ej: máquina parada 9:00 a 9:30"></div>
    <div class="modal-msg" id="saMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="enviarSolicitudAjuste()">ENVIAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
function saSigno(s){ sa.signo=s; $("saResta").classList.toggle("activo",s===-1); $("saSuma").classList.toggle("activo",s===1); }
async function enviarSolicitudAjuste(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const v=parseInt($("saMin").value,10);
  const motivo=$("saMotivo").value.trim();
  if(!v||v<=0){ $("saMsg").textContent="Ingresa los minutos"; return; }
  if(!motivo){ $("saMsg").textContent="Indica el motivo"; return; }
  try{
    const r=await rpc("fn_solicitud_ajuste_crear",{p_dni:s.dni,p_token:s.token,p_area:AREA_ESTAJERO||s.area,
      p_minutos:v*sa.signo,p_motivo:motivo});
    if(!r.ok){ $("saMsg").textContent=r.error||"No se pudo enviar"; return; }
    cerrarModal();
    $("exTitulo").textContent="Solicitud enviada";
    $("exDetalle").innerHTML=`${sa.signo>0?"+":"-"}${v} min · esperando aprobación`;
    $("exAvance").textContent=""; $("exTimer").textContent="";
    const ex=$("exito"); ex.classList.add("visible");
    setTimeout(()=>ex.classList.remove("visible"),2200);
  }catch(e){ $("saMsg").textContent=e.message; }
}
function pintarCrumb(id){
  const el=$("crumbOF"); if(!el) return;
  if(id==="pasoCarga" || id==="pasoOF" || !sel.of){ el.style.display="none"; el.innerHTML=""; return; }
  const partes=[`OF <b>${esc(sel.of)}</b>`];
  if(sel.modulo) partes.push(`Módulo <b>${esc(sel.modulo)}</b>`);
  if(sel.op)     partes.push(`Operación <b>${esc(sel.op)}</b>`);
  el.innerHTML = partes.join(' <span class="crumb-sep">\u203A</span> ');
  el.style.display="block";
}
let EF_CENSURADA = false;   // operario: ojo para censurar su propia eficiencia
function initOperario(){
  const s = sesionActual();
  if(!s || !s.area){ location.href="index.html"; return; }
  $("quienBadge").textContent = soloApellidos(s.nombre); $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  { const rb=$("btnReloj"); if(rb) rb.onclick=abrirSolicitudAjuste; }
  { const kb=$("btnLlave"); if(kb) kb.onclick=abrirCambioPin; }
  { const rc=$("btnRecargar"); if(rc) rc.onclick=recargarMiEficiencia; }
  { const oj=$("btnOjoEf"); if(oj) oj.onclick=()=>{ EF_CENSURADA=!EF_CENSURADA; setAvance(ULTIMO_DIA); }; }
  window.onCambioPaso = (id)=>{
    // Al retroceder, limpiar la selección más profunda para que el
    // breadcrumb del encabezado no deje pasos viejos colgados.
    if(id==="pasoOF"){ sel.of=null; sel.modulo=null; sel.op=null; }
    else if(id==="pasoModulos"){ sel.modulo=null; sel.op=null; }
    else if(id==="pasoOps"){ sel.op=null; }
    pintarCrumb(id);
    const b=$("btnVolverHdr"); if(!b) return;
    const destino = VOLVER_OPERARIO[id];
    if(destino){ b.style.display="inline-block"; b.onclick=()=>irA(destino); }
    else b.style.display="none";
  };
  $("inputOF").addEventListener("input", pintarSugerencias);

  if(s.cargo==='ESTAJERO'){
    const btnCambiar=$("btnCambiarAreaEst");
    if(btnCambiar){ btnCambiar.style.display="block"; btnCambiar.onclick=()=>irA("pasoAreaEstajero"); }
    $("tituloArea").textContent = "ESTAJERO";
    pintarAreasEstajero(s);
    irA("pasoAreaEstajero");
  } else {
    AREA_ESTAJERO = s.area;
    $("tituloArea").textContent = s.area;
    cargarTodo(s);
  }
}

function pintarAreasEstajero(s){
  const g=$("gridAreaEstajero"); if(!g) return;
  g.innerHTML="";
  Object.keys(AREAS).forEach(a=>{
    const cfg=AREAS[a];
    const c=document.createElement("div");
    c.className="card-area"+(cfg.habilitada?"":" off");
    c.innerHTML=`<div class="ca-nombre">${esc(a)}</div>
      <div class="ca-sub">${cfg.habilitada?"Disponible":"Próximamente"}</div>`;
    if(cfg.habilitada){
      c.onclick=()=>{
        AREA_ESTAJERO = a;
        $("tituloArea").textContent = "ESTAJERO · " + a;
        cargarTodo(s);
      };
    }
    g.appendChild(c);
  });
}

async function cargarTodo(s){
  irA("pasoCarga");
  const area = AREA_ESTAJERO || s.area;
  $("zonaCarga").innerHTML = cargandoHTML("Cargando almacén de "+area+"…");
  try{
    const [alm, recl, dia] = await Promise.all([
      cargarAlmacen(area),
      rpc("fn_reclamados", {p_dni:s.dni, p_token:s.token, p_area:area}),
      rpc("fn_mi_dia", {p_dni:s.dni, p_token:s.token})
    ]);
    ALM = alm;
    RECL = {}; recl.forEach(x=>{ RECL[x.codigo]={nombre:x.nombre,hora:x.hora}; });
    setAvance(dia);
    if(alm.duplicados.length) console.warn("Códigos duplicados en almacén:", alm.duplicados);
    irA("pasoOF");
  }catch(e){
    $("zonaCarga").innerHTML = `<div class="vacio-msg">${esc(e.message)}</div>`;
    mostrarError("No se pudo cargar. Revisa la conexión y vuelve a intentar.");
  }
}
let ULTIMO_DIA = {eficiencia:0,minutos_prod:0,minutos_disp:0};
function setAvance(d){
  ULTIMO_DIA = d || ULTIMO_DIA;
  const b=$("badgeAvance");
  const ef = EF_CENSURADA ? "****" : (ULTIMO_DIA.eficiencia + "%");
  b.textContent = `Hoy: ${ef} · ${ULTIMO_DIA.minutos_prod} de ${ULTIMO_DIA.minutos_disp} min`;
  b.classList.add("visible");
}
async function recargarMiEficiencia(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const b=$("btnRecargar"); if(b) b.classList.add("girando");
  try{
    const d=await rpc("fn_mi_dia",{p_dni:s.dni,p_token:s.token});
    setAvance(d);
  }catch(e){ mostrarError(e.message); }
  finally{ if(b) setTimeout(()=>b.classList.remove("girando"),500); }
}
const libre = t => !RECL[t.codigo];

/* --- paso OF: buscador con sugerencias --- */
function pintarSugerencias(){
  const q = $("inputOF").value.replace(/\D/g,"");
  $("inputOF").value = q;
  const z = $("sugerenciasOF"); z.innerHTML="";
  if(!q){ return; }
  const ofs = {};
  ALM.tickets.forEach(t=>{
    if(t.of.includes(q)){
      if(!ofs[t.of]) ofs[t.of]={total:0,libres:0};
      ofs[t.of].total++; if(libre(t)) ofs[t.of].libres++;
    }
  });
  Object.keys(ofs).sort().slice(0,8).forEach(of=>{
    const d=document.createElement("div");
    d.className="sug";
    d.innerHTML=`<span>OF ${esc(of)}</span><small>${ofs[of].libres} de ${ofs[of].total} libres</small>`;
    d.onclick=()=>{ sel.of=of; sel.modulo=null; sel.op=null; pintarModulos(); irA("pasoModulos"); };
    z.appendChild(d);
  });
  if(!Object.keys(ofs).length) z.innerHTML=`<div class="vacio-msg">Ninguna OF contiene "${esc(q)}"</div>`;
}

/* --- paso módulos --- */
function pintarModulos(){
  $("tituloModulos").textContent = "OF " + sel.of;
  const l=$("listaModulos"); l.innerHTML="";
  const mods={};
  ALM.tickets.forEach(t=>{
    if(t.of!==sel.of) return;
    if(!mods[t.modulo]) mods[t.modulo]={total:0,libres:0};
    mods[t.modulo].total++; if(libre(t)) mods[t.modulo].libres++;
  });
  Object.keys(mods).sort().forEach(m=>{
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div class="cf-titulo">${esc(m)}</div>
      <div class="badge-disp ${mods[m].libres===0?'vacio':''}">${mods[m].libres} de ${mods[m].total} libres</div>`;
    c.onclick=()=>{ sel.modulo=m; pintarOperaciones(); irA("pasoOps"); };
    l.appendChild(c);
  });
}

/* --- paso operaciones (con STD visible) --- */
function pintarOperaciones(){
  $("tituloOps").textContent = sel.modulo + " · OF " + sel.of;
  const l=$("listaOps"); l.innerHTML="";
  const ops={};
  ALM.tickets.forEach(t=>{
    if(t.of!==sel.of || t.modulo!==sel.modulo) return;
    if(!ops[t.op]) ops[t.op]={std:t.std,total:0,libres:0};
    ops[t.op].total++; if(libre(t)) ops[t.op].libres++;
  });
  Object.keys(ops).sort().forEach(op=>{
    const o=ops[op];
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div>
        <div class="cf-titulo">${esc(op)}</div>
        <div class="cf-detalle">STD <b>${o.std.toFixed(2)}</b> min</div>
      </div>
      <div class="badge-disp ${o.libres===0?'vacio':''}">${o.libres} de ${o.total} libres</div>`;
    c.onclick=()=>{ sel.op=op; modoSel=false; marcados={}; pintarTickets(); irA("pasoTickets"); };
    l.appendChild(c);
  });
}

/* --- paso tickets (numeración protagonista + selección múltiple) --- */
let modoSel=false, marcados={};

function ticketsActuales(){
  return ALM.tickets.filter(t=>t.of===sel.of && t.modulo===sel.modulo && t.op===sel.op);
}
function pintarTickets(){
  $("tituloTickets").textContent = sel.op;
  pintarBarraSel();
  const l=$("listaTickets"); l.innerHTML="";
  ticketsActuales().forEach(t=>{
    const r = RECL[t.codigo];
    const marcado = modoSel && marcados[t.codigo];
    const c=document.createElement("div");
    c.className="card-ticket"+(r?" tomado":"")+(marcado?" marcada":"");
    c.innerHTML=`
      <div class="tk-min">${t.minutos} min</div>
      <div class="tk-label">Numeración</div>
      <div class="tk-numeracion">${esc(t.num)}</div>
      <div class="tk-fila">
        <div><span class="chip-color" style="background:${colorDe(t.color)}"></span>${esc(t.color)}</div>
        <div>Talla <b>${esc(t.talla)}</b></div>
        <div><b>${t.cant}</b> und</div>
        <div>Corte <b>${esc(t.corte)}</b></div>
        <div>N°OP <b>${t.nop ?? "—"}</b></div>
      </div>
      ${r?`<div class="tk-tomado-por">Tomado por ${esc(soloApellidos(r.nombre))} · ${esc(r.hora)}</div>`:""}`;
    if(!r){
      c.onclick=()=>{
        if(modoSel){
          if(marcados[t.codigo]) delete marcados[t.codigo]; else marcados[t.codigo]=t;
          pintarTickets();
        } else {
          sel.ticket=t;
          $("confNum").textContent=t.num;
          $("confDet").innerHTML=
            `${esc(sel.op)}<br>OF ${esc(t.of)} · ${esc(t.color)} · Talla ${esc(t.talla)} · <b>${t.cant} und</b><br>`+
            `<span style="color:#5a6270">STD ${t.std.toFixed(2)} min · vale <b>${t.minutos} min</b></span>`;
          $("btnRegistrar").disabled=false;
          irA("pasoConf");
        }
      };
    }
    l.appendChild(c);
  });
}
function pintarBarraSel(){
  const libres = ticketsActuales().filter(t=>!RECL[t.codigo]);
  const nSel = Object.keys(marcados).length;
  const minSel = Object.values(marcados).reduce((a,t)=>a+t.minutos,0);
  const b=$("barraSel");
  if(!modoSel){
    b.innerHTML = libres.length>1
      ? `<button class="btn-sel" onclick="activarSel()">MARCAR VARIOS</button>`
      : "";
  } else {
    b.innerHTML = `
      <button class="btn-sel" onclick="marcarTodos()">MARCAR TODOS (${libres.length})</button>
      <button class="btn-sel primario" ${nSel?"":"disabled"} onclick="confirmarLote()">REGISTRAR ${nSel} · ${Math.round(minSel*10)/10} min</button>
      <button class="btn-sel cancelar" onclick="cancelarSel()">CANCELAR</button>`;
  }
}
function activarSel(){ modoSel=true; marcados={}; pintarTickets(); }
function cancelarSel(){ modoSel=false; marcados={}; pintarTickets(); }
function marcarTodos(){
  marcados={};
  ticketsActuales().forEach(t=>{ if(!RECL[t.codigo]) marcados[t.codigo]=t; });
  pintarTickets();
}
function confirmarLote(){
  const lista=Object.values(marcados);
  if(!lista.length) return;
  const min = Math.round(lista.reduce((a,t)=>a+t.minutos,0)*10)/10;
  const nums = lista.slice(0,6).map(t=>t.num).join(", ") + (lista.length>6?"…":"");
  $("confNum").textContent = lista.length + " paquetes";
  $("confDet").innerHTML =
    `${esc(sel.op)} · OF ${esc(sel.of)}<br>`+
    `<span style="color:#5a6270">${esc(nums)}</span><br>`+
    `Total: <b>${min} min</b> a tu nombre`;
  $("btnRegistrar").disabled=false;
  irA("pasoConf");
}

/* --- reclamar (individual o lote) --- */
async function registrar(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const area = AREA_ESTAJERO || s.area;
  const btn=$("btnRegistrar");
  btn.disabled=true; btn.textContent="REGISTRANDO…";
  const esLote = modoSel && Object.keys(marcados).length>0;
  try{
    let r;
    if(esLote){
      const lote=Object.values(marcados).map(t=>({codigo:t.codigo,of:t.of,modulo:t.modulo,
        op:t.op,std:t.std,cant:t.cant,num:t.num,articulo:t.articulo,color:t.color,
        talla:t.talla,corte:t.corte,nop:t.nop}));
      r = await rpc("fn_reclamar_lote",{p_dni:s.dni,p_token:s.token,p_area:area,p_tickets:lote});
    } else {
      const t=sel.ticket;
      r = await rpc("fn_reclamar", {p_dni:s.dni,p_token:s.token,p_area:area,
        p_codigo:t.codigo,p_of:t.of,p_modulo:t.modulo,p_op:t.op,p_std:t.std,p_cant:t.cant,
        p_numeracion:t.num,p_articulo:t.articulo,p_color:t.color,p_talla:t.talla,p_corte:t.corte,p_nop:t.nop});
    }
    btn.textContent="SÍ, REGISTRAR";
    if(!r.ok){
      mostrarError(r.error||"No se pudo registrar");
      if(r.conflicto){ await refrescarReclamos(s); pintarTickets(); irA("pasoTickets"); }
      btn.disabled=false; return;
    }
    setAvance(r);
    if(esLote){
      Object.values(marcados).forEach(t=>{ RECL[t.codigo]={nombre:s.nombre,hora:"ahora"}; });
      const conf = (r.conflictos||[]);
      $("exTitulo").textContent="¡Listo, "+s.nombre.split(" ")[0]+"!";
      $("exDetalle").innerHTML =
        `<b>${r.reclamados}</b> paquete(s) registrados · ${esc(sel.op)}`+
        (conf.length?`<br><span style="opacity:.85">No se pudieron (ya tomados): ${esc(conf.join(", "))}</span>`:"");
      modoSel=false; marcados={};
      if(conf.length) await refrescarReclamos(s);
    } else {
      const t=sel.ticket;
      RECL[t.codigo]={nombre:s.nombre,hora:"ahora"};
      $("exTitulo").textContent="¡Listo, "+s.nombre.split(" ")[0]+"!";
      $("exDetalle").innerHTML=`${esc(sel.op)}<br>Numeración <b>${esc(t.num)}</b> · ${t.cant} und · +${t.minutos} min`;
    }
    $("exAvance").textContent=`Tu día: ${r.eficiencia}%`;
    mostrarExito();
  }catch(e){
    btn.textContent="SÍ, REGISTRAR"; btn.disabled=false;
    mostrarError(e.message);
  }
}
async function refrescarReclamos(s){
  try{
    const area = AREA_ESTAJERO || s.area;
    const recl = await rpc("fn_reclamados",{p_dni:s.dni,p_token:s.token,p_area:area});
    RECL={}; recl.forEach(x=>{RECL[x.codigo]={nombre:x.nombre,hora:x.hora};});
  }catch(e){}
}
let timerReset=null;
function mostrarExito(){
  const ex=$("exito"); ex.classList.add("visible");
  $("exTimer").textContent="Volviendo…";
  clearTimeout(timerReset);
  timerReset=setTimeout(()=>{
    ex.classList.remove("visible");
    pintarTickets(); irA("pasoTickets");
  }, 2500);
}

/* ============================================================
   PÁGINA: SUPERVISORA (supervisora.html)
   ============================================================ */
let PERSONAL=[], oc={tipo:null,minutos:0,dnis:[]};
/* Área activa del panel de supervisión.
   - Supervisora: su propia área (session).
   - Ingeniería operando "como supervisora": el área elegida (override). */
let SUP_AREA_OVERRIDE=null;
function areaSup(){ return SUP_AREA_OVERRIDE || ((sesionActual()||{}).area) || ""; }

async function cargarIncidencias(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const z=$("listaIncidencias"); z.innerHTML=cargandoHTML("Cargando incidencias…");
  try{
    const r=await rpc("fn_solicitudes_listar",{p_dni:s.dni,p_token:s.token,p_area:areaSup()});
    if(!r.ok){ mostrarError(r.error||"Error"); z.innerHTML=""; return; }
    pintarIncidencias(r.items||[], z, "inc", "resolverIncidencia");
  }catch(e){ z.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function pintarIncidencias(items, z, pref, fn){
  if(!items.length){ z.innerHTML=`<div class="vacio-msg">Sin incidencias pendientes</div>`; return; }
  z.innerHTML="";
  items.forEach(it=>{
    const d=document.createElement("div");
    d.className="card-fila"; d.style.cursor="default"; d.style.flexWrap="wrap";
    d.innerHTML=`
      <div style="flex:1;min-width:220px;">
        <div class="cf-titulo">${esc(it.nombre)}</div>
        <div class="cf-detalle">${esc(it.motivo)}</div>
        <div class="cf-detalle">${esc(it.area)} · ${esc(it.fecha)} ${esc(it.hora)}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="number" id="${pref}_${it.id}" value="${it.minutos}"
          style="width:90px;background:var(--gris-fondo);border:2px solid var(--azul);border-radius:10px;font-size:16px;font-weight:800;padding:8px;text-align:center;">
        <span class="cf-detalle">min</span>
        <button class="btn-mini verde" onclick="${fn}(${it.id},true)">APROBAR</button>
        <button class="btn-mini rojo" onclick="${fn}(${it.id},false)">RECHAZAR</button>
      </div>`;
    z.appendChild(d);
  });
}
async function resolverIncidencia(id, aprobar){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  let mf=null;
  if(aprobar){ mf=parseInt($("inc_"+id).value,10); if(!mf){ mostrarError("Minutos inválidos"); return; } }
  try{
    const r=await rpc("fn_solicitud_resolver",{p_dni:s.dni,p_token:s.token,p_id:id,p_aprobar:aprobar,p_minutos_final:mf});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    await cargarIncidencias();
  }catch(e){ mostrarError(e.message); }
}

let timerAvance=null;
/* Bindings del panel de supervisión (reutilizables por la vista de supervisora
   y por ingeniería operando "como supervisora"). */
function bindSupervisoraUI(){
  $("filtroNombre").addEventListener("input", pintarPersonal);
  $("tabPersonal").onclick = ()=>{ pararAvance(); marcarTab("tabPersonal"); irA("pasoPersonal"); };
  $("tabAvance").onclick  = ()=>{ marcarTab("tabAvance"); irA("pasoAvance"); cargarAvance(); timerAvance=setInterval(cargarAvance, 60000); };
  $("tabIncidencias").onclick = ()=>{ pararAvance(); marcarTab("tabIncidencias"); irA("pasoIncidencias"); cargarIncidencias(); };
  { const te=$("tabEfPersonal"); if(te) te.onclick = ()=>{ pararAvance(); marcarTab("tabEfPersonal"); irA("pasoEfPersonal"); cargarEfPersonal(); }; }
  cargarEstadosSup();
}

/* --- Supervisión: Eficiencias del Personal (por fecha) --- */
function cargarEfPersonal(){
  const s=sesionActual(); if(!s) return;
  const fd=$("fechaEfPer"); if(fd && !fd.value) fd.value = new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"});
  const g=$("gridEfPer"); if(g) g.innerHTML=cargandoHTML("Calculando eficiencia…");
  rpc("fn_eficiencia_personal",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),p_fecha:(fd?fd.value:null)})
    .then(r=>{ if(!r.ok){ mostrarError(r.error||"Error"); if(g) g.innerHTML=""; return; }
      pintarEfPersonal(r.personal||[]); })
    .catch(e=>{ if(g) g.innerHTML=""; mostrarError(e.message); });
}
function pintarEfPersonal(lista){
  const g=$("gridEfPer"); if(!g) return;
  const q=normKey($("filtroEfPer") ? $("filtroEfPer").value : "");
  const l = lista.filter(p=>!q || normKey(p.nombre).includes(q));
  window.__EFPER = lista;   // cache para el filtro
  if(!l.length){ g.innerHTML=`<div class="vacio-msg">Sin personal para este filtro</div>`; return; }
  g.innerHTML="";
  l.forEach(p=>{
    const efClase = p.eficiencia>=80?"ef-alta":(p.eficiencia<50?"ef-baja":"");
    const c=document.createElement("div");
    c.className="card-persona";
    c.setAttribute("role","button"); c.setAttribute("tabindex","0");
    c.innerHTML=`<div>
        <div class="cp-nombre">${esc(soloApellidos(p.nombre))}</div>
        <div class="cp-dni"><span class="pill ${esc(p.estado)}">${esc(p.estado)}</span> · ${p.tickets} tk</div>
      </div>
      <div class="cp-disp ${efClase}" style="font-size:20px;">${p.eficiencia}%</div>`;
    const abrir=()=>verEfPersonaOps(p.dni, p.nombre);
    c.onclick=abrir;
    c.onkeydown=(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); abrir(); } };
    g.appendChild(c);
  });
}
function filtrarEfPersonal(){ if(window.__EFPER) pintarEfPersonal(window.__EFPER); }
async function verEfPersonaOps(dni, nombre){
  const s=sesionActual(); if(!s) return;
  const fd=$("fechaEfPer");
  abrirModal(cargandoHTML("Cargando operaciones…"));
  try{
    const r=await rpc("fn_operario_ops_dia",{p_dni:s.dni,p_token:s.token,p_dni_op:dni,p_fecha:(fd?fd.value:null)});
    if(!r.ok){ mostrarError(r.error||"Error"); cerrarModal(); return; }
    const ops=r.ops||[];
    const filas = ops.length
      ? ops.map(o=>`<tr><td>${esc(o.of)}</td><td class="izq">${esc(o.op)}</td>
          <td><b>${Math.round(o.cantidad)}</b></td></tr>`).join("")
      : `<tr><td colspan="3"><div class="vacio-msg">Sin operaciones ese día</div></td></tr>`;
    abrirModal(`
      <h2>${esc(soloApellidos(nombre))}</h2>
      <div class="sub" style="margin-bottom:12px;">Operaciones por OF · ${esc(fd?fd.value:"")}</div>
      <div style="max-height:60vh;overflow:auto;">
        <table class="tabla"><thead><tr><th>OF</th><th class="izq">Operación</th><th>Cantidad</th></tr></thead>
        <tbody>${filas}</tbody></table>
      </div>
      <div class="modal-acciones"><button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CERRAR</button></div>`);
  }catch(e){ mostrarError(e.message); cerrarModal(); }
}
function initSupervisora(){
  const s=sesionActual();
  if(!s || !s.area){ location.href="index.html"; return; }
  if(s.cargo!=="SUPERVISORA"){ location.href = destinoPorCargo(s.cargo); return; }
  SUP_AREA_OVERRIDE=null;
  $("tituloArea").textContent = s.area + " · Supervisión";
  $("quienBadge").textContent = s.nombre; $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  { const kb=$("btnLlave"); if(kb) kb.onclick=abrirCambioPin; }
  { const rc=$("btnRecargar"); if(rc) rc.onclick=()=>{ recargarSupervisora(); }; }
  bindSupervisoraUI();
  cargarPersonal(s);
}
/* Recargar según la pestaña activa (botón ↻ del header). */
function recargarSupervisora(){
  const s=sesionActual(); if(!s) return;
  const rc=$("btnRecargar"); if(rc){ rc.classList.add("girando"); setTimeout(()=>rc.classList.remove("girando"),500); }
  if($("pasoAvance").classList.contains("activa")) cargarAvance();
  else if($("pasoIncidencias").classList.contains("activa")) cargarIncidencias();
  else if($("pasoEfPersonal") && $("pasoEfPersonal").classList.contains("activa")) cargarEfPersonal();
  else cargarPersonal(s);
}

/* --- Marcar faltantes (estados de asistencia, misma lógica que ingeniería) ---
   NO suma minutos al área: un estado ausente deja disp = 0 ese día. */
let ESTADOS_SUP = [], mf_sup = {dnis:[]};
async function cargarEstadosSup(){
  const s=sesionActual(); if(!s) return;
  try{ ESTADOS_SUP = await rpc("fn_estados_asistencia_listar",{p_dni:s.dni,p_token:s.token}); }
  catch(e){ ESTADOS_SUP = ["FALTA","DM","VACACIONES","ACTIVO"]; }
}
function marcarFaltantesInicio(){
  mf_sup={dnis:[]};
  pintarPersonalFalta();
  irA("pasoFaltantes");
}
function pintarPersonalFalta(){
  const g=$("gridPersonalFalta"); if(!g) return;
  g.innerHTML="";
  if(!PERSONAL.length){ g.innerHTML=`<div class="vacio-msg">Sin personal en el área</div>`; return; }
  PERSONAL.forEach(p=>{
    const c=document.createElement("div");
    c.className="card-persona"+(mf_sup.dnis.includes(p.dni)?" marcada":"");
    c.innerHTML=`<div>
        <div class="cp-nombre">${esc(p.nombre)}</div>
        <div class="cp-dni">DNI ${esc(p.dni)}</div>
      </div>
      <div class="cp-disp">${p.disp} min</div>`;
    c.onclick=()=>{
      const i=mf_sup.dnis.indexOf(p.dni);
      if(i>=0) mf_sup.dnis.splice(i,1); else mf_sup.dnis.push(p.dni);
      pintarPersonalFalta();
    };
    g.appendChild(c);
  });
  const b=$("btnContinuarFalta");
  if(b){ b.disabled = mf_sup.dnis.length===0;
    b.textContent = mf_sup.dnis.length ? `ELEGIR ESTADO (${mf_sup.dnis.length})` : "ELEGIR ESTADO"; }
}
function marcarFaltantesEstado(){
  if(!mf_sup.dnis.length) return;
  const opts = ESTADOS_SUP.map(e=>`<option>${esc(e)}</option>`).join("") || '<option value="">Sin estados</option>';
  abrirModal(`
    <h2>Marcar estado</h2>
    <div class="sub" style="margin-bottom:12px;">${mf_sup.dnis.length} persona(s) · hoy</div>
    <div class="modal-campo"><label>Estado</label>
      <select id="mfEstado">${opts}</select></div>
    <div class="modal-msg" id="mfMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarFaltantes()">APLICAR A ${mf_sup.dnis.length}</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
async function guardarFaltantes(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const estado=$("mfEstado").value;
  if(!estado){ $("mfMsg").textContent="Elige un estado"; return; }
  try{
    const r=await rpc("fn_marcar_asistencia",{p_dni:s.dni,p_token:s.token,
      p_dnis:mf_sup.dnis,p_estado:estado,p_fecha:null});
    if(!r.ok){ $("mfMsg").textContent=r.error||"No se pudo"; return; }
    cerrarModal();
    $("exTitulo").textContent="Estado registrado";
    $("exDetalle").innerHTML=`${esc(estado)} · <b>${r.afectados}</b> persona(s)`;
    $("exAvance").textContent=""; $("exTimer").textContent="";
    const ex=$("exito"); ex.classList.add("visible");
    setTimeout(async ()=>{
      ex.classList.remove("visible");
      mf_sup={dnis:[]};
      await cargarPersonal(s);
      irA("pasoPersonal");
    }, 2200);
  }catch(e){ $("mfMsg").textContent=e.message; }
}
function marcarTab(id){
  ["tabPersonal","tabAvance","tabIncidencias","tabEfPersonal"].forEach(t=>{ const el=$(t); if(el) el.classList.toggle("activo", t===id); });
}
function pararAvance(){ clearInterval(timerAvance); timerAvance=null; }

async function cargarAvance(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  try{
    const r = await rpc("fn_avance_area",{p_dni:s.dni,p_token:s.token,p_area:areaSup()});
    if(!r.ok){ mostrarError(r.error||"Error"); return; }
    $("avResumen").innerHTML = `
      <div class="kpi"><div class="kpi-num">${r.eficiencia}%</div><div class="kpi-lbl">Eficiencia del área</div></div>
      <div class="kpi"><div class="kpi-num">${r.personas}</div><div class="kpi-lbl">Presentes</div></div>
      <div class="kpi"><div class="kpi-num">${Math.round(r.minutos_prod)}</div><div class="kpi-lbl">Min producidos</div></div>
      <div class="kpi"><div class="kpi-num">${Math.round(r.minutos_disp)}</div><div class="kpi-lbl">Min disponibles</div></div>`;
    const l=$("avItems"); l.innerHTML="";
    if(r.sin_base && r.sin_base.length){
      const w=document.createElement("div");
      w.className="banner-error visible"; w.style.margin="0 0 12px";
      w.textContent="SIN BASE cargada: "+r.sin_base.join(", ")+" — pide a ingeniería subir la BASE de estos artículos.";
      l.appendChild(w);
    }
    if(!r.items.length){
      l.insertAdjacentHTML("beforeend",'<div class="vacio-msg">Aún no hay notificaciones en la última operación hoy</div>');
    }
    r.items.forEach(it=>{
      l.insertAdjacentHTML("beforeend", `
        <div class="card-fila" style="cursor:default;">
          <div>
            <div class="cf-titulo">${esc(it.articulo)} · OF ${esc(it.of)}</div>
            <div class="cf-detalle">Prenda completa: ${it.t_total} min</div>
          </div>
          <div style="text-align:right;">
            <div class="cf-titulo" style="color:var(--azul);">${it.unidades} und</div>
            <div class="cf-detalle">${Math.round(it.minutos)} min</div>
          </div>
        </div>`);
    });
    $("avHora").textContent = "Actualizado " + new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  }catch(e){ mostrarError(e.message); }
}
async function cargarPersonal(s){
  $("gridPersonal").innerHTML = cargandoHTML("Cargando personal…");
  try{
    PERSONAL = await rpc("fn_personal",{p_dni:s.dni,p_token:s.token,p_area:areaSup()});
    pintarPersonal();
  }catch(e){
    $("gridPersonal").innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`;
  }
}
function pintarPersonal(){
  const q = normKey($("filtroNombre").value);
  const g = oc.multiple ? $("gridPersonalSel") : $("gridPersonal");
  g.innerHTML="";
  const lista = (q.length>=3)
    ? PERSONAL.filter(p=>normKey(p.nombre).includes(q))
    : PERSONAL;
  if(!lista.length){ g.innerHTML=`<div class="vacio-msg">Sin coincidencias</div>`; return; }
  lista.forEach(p=>{
    const c=document.createElement("div");
    c.className="card-persona"+(oc.dnis.includes(p.dni)?" marcada":"");
    c.innerHTML=`<div>
        <div class="cp-nombre">${esc(p.nombre)}</div>
        <div class="cp-dni">DNI ${esc(p.dni)}</div>
      </div>
      <div class="cp-disp">${p.disp} min</div>`;
    c.onclick=()=>{
      if(oc.multiple){
        const i=oc.dnis.indexOf(p.dni);
        if(i>=0) oc.dnis.splice(i,1); else oc.dnis.push(p.dni);
        pintarPersonal();
        actualizarBtnContinuar();
      } else {
        oc.dnis=[p.dni];
        $("nombreAfectado").textContent = p.nombre;
        irA("pasoTipo");
      }
    };
    g.appendChild(c);
  });
}
function actualizarBtnContinuar(){
  const b=$("btnContinuarSel"); if(!b) return;
  b.disabled = oc.dnis.length===0;
  b.textContent = oc.dnis.length ? `CONTINUAR (${oc.dnis.length})` : "CONTINUAR";
}

/* --- selección de tipo --- */
const TIPOS_MOTIVO = ["TARDANZA","SEGURO","PERMISO"];
function elegirTipo(tipo){
  oc.tipo=tipo; oc.minutos=0;
  $("zonaMotivo").style.display = TIPOS_MOTIVO.includes(tipo) ? "block" : "none";
  $("inputMotivo").value="";
  if(tipo==="HORA_EXTRA"){
    oc.horas=1;
    $("tituloMin").textContent="Horas extra";
    $("subMin").textContent="Cada hora suma 60 minutos disponibles";
    $("zonaStepper").style.display="flex"; $("zonaMinutos").style.display="none";
    $("valorStepper").textContent="1 h";
  } else {
    const titulos = {MAQUINA:"Minutos de máquina parada", TARDANZA:"Minutos de tardanza",
                     SEGURO:"Minutos por seguro", PERMISO:"Minutos de permiso", OTROS:"Minutos (Otros)"};
    $("tituloMin").textContent = titulos[tipo] || "Minutos";
    $("subMin").textContent = tipo==="OTROS"
      ? "Elige si suma o resta minutos disponibles"
      : "Se restan de los minutos disponibles del día";
    $("zonaStepper").style.display="none"; $("zonaMinutos").style.display="block";
    $("inputMinutos").value="";
    $("segSigno").style.display = tipo==="OTROS" ? "flex" : "none";
    oc.signo = -1;
    if(tipo==="OTROS") marcarSigno(-1);
  }
  irA("pasoMinutos");
}
function stepper(d){
  oc.horas=Math.max(1, Math.min(6,(oc.horas||1)+d));
  $("valorStepper").textContent=oc.horas+" h";
}
function marcarSigno(s){
  oc.signo=s;
  $("btnResta").classList.toggle("activo",s===-1);
  $("btnSuma").classList.toggle("activo",s===1);
}

/* --- confirmar ocurrencia --- */
async function confirmarOcurrencia(){
  const s=sesionActual(); if(!s){location.href="index.html";return;}
  let minutos;
  if(oc.tipo==="HORA_EXTRA") minutos = oc.horas*60;
  else {
    const v=parseInt($("inputMinutos").value,10);
    if(!v || v<=0){ mostrarError("Ingresa los minutos"); return; }
    minutos = v * oc.signo;
  }
  const motivo = ($("inputMotivo") ? $("inputMotivo").value.trim() : "");
  if(TIPOS_MOTIVO.includes(oc.tipo) && !motivo){ mostrarError("Indica el motivo (hora de salida/regreso)"); return; }
  const btn=$("btnGuardarOc"); btn.disabled=true; btn.textContent="GUARDANDO…";
  try{
    const r = await rpc("fn_ocurrencia",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),
      p_tipo:oc.tipo,p_minutos:minutos,p_detalle:(motivo||oc.tipo),p_dnis:oc.dnis});
    btn.disabled=false; btn.textContent="GUARDAR";
    if(!r.ok){ mostrarError(r.error||"No se pudo guardar"); return; }
    $("exTitulo").textContent="Registrado";
    $("exDetalle").innerHTML=`${oc.tipo.replace("_"," ")} · <b>${minutos>0?"+":""}${minutos} min</b> · ${r.afectados} persona(s)`;
    $("exAvance").textContent="";
    const ex=$("exito"); ex.classList.add("visible");
    setTimeout(async ()=>{
      ex.classList.remove("visible");
      oc={tipo:null,minutos:0,dnis:[],multiple:false};
      $("filtroNombre").value="";
      await cargarPersonal(s);
      irA("pasoPersonal");
    },2500);
  }catch(e){ btn.disabled=false; btn.textContent="GUARDAR"; mostrarError(e.message); }
}

/* --- flujo OTROS: alcance todos / específicos --- */
function ocurrenciaGrupal(){ oc={tipo:null,minutos:0,dnis:[],multiple:false}; irA("pasoAlcance"); }
function alcanceTodos(){
  oc.dnis = PERSONAL.map(p=>p.dni); oc.multiple=false;
  $("nombreAfectado").textContent = "Todo el personal del área ("+oc.dnis.length+")";
  elegirTipo("OTROS");
}
function alcanceAlgunos(){
  oc.dnis=[]; oc.multiple=true;
  actualizarBtnContinuar();
  pintarPersonal();
  irA("pasoSeleccion");
}
function continuarSeleccion(){
  if(!oc.dnis.length) return;
  oc.multiple=false;
  $("nombreAfectado").textContent = oc.dnis.length+" persona(s) seleccionada(s)";
  irA("pasoTipo");
}

/* --- mover personal de área (cubrir puestos en otras áreas) ---
   Registra el movimiento con hora en Supabase (movimientos_area);
   el servidor prorratea los minutos disponibles entre áreas. */
let mv={dnis:[]};
function moverAreaInicio(){
  mv={dnis:[]};
  pintarPersonalMov();
  irA("pasoMoverSel");
}
function pintarPersonalMov(){
  const g=$("gridPersonalMov"); g.innerHTML="";
  if(!PERSONAL.length){ g.innerHTML=`<div class="vacio-msg">Sin personal en el área</div>`; return; }
  PERSONAL.forEach(p=>{
    const c=document.createElement("div");
    c.className="card-persona"+(mv.dnis.includes(p.dni)?" marcada":"");
    c.innerHTML=`<div>
        <div class="cp-nombre">${esc(p.nombre)}</div>
        <div class="cp-dni">DNI ${esc(p.dni)}</div>
      </div>
      <div class="cp-disp">${p.disp} min</div>`;
    c.onclick=()=>{
      const i=mv.dnis.indexOf(p.dni);
      if(i>=0) mv.dnis.splice(i,1); else mv.dnis.push(p.dni);
      pintarPersonalMov();
    };
    g.appendChild(c);
  });
  const b=$("btnContinuarMov");
  b.disabled = mv.dnis.length===0;
  b.textContent = mv.dnis.length ? `ELEGIR ÁREA DESTINO (${mv.dnis.length})` : "ELEGIR ÁREA DESTINO";
}
async function moverAreaElegir(){
  if(!mv.dnis.length) return;
  const s=sesionActual();
  const l=$("listaAreasMov"); l.innerHTML=cargandoHTML("Cargando áreas…");
  irA("pasoMoverArea");
  const areas = (await cargarAreasDB()).filter(a=>a!==areaSup());
  l.innerHTML="";
  if(!areas.length){ l.innerHTML=`<div class="vacio-msg">No hay otras áreas registradas</div>`; return; }
  areas.forEach(a=>{
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div class="cf-titulo">${esc(a)}</div>`;
    c.onclick=()=>moverAreaConfirmar(a);
    l.appendChild(c);
  });
}
async function moverAreaConfirmar(area){
  const s=sesionActual(); if(!s){location.href="index.html";return;}
  if(!confirm(`¿Mover ${mv.dnis.length} persona(s) de ${areaSup()} a ${area}?\nSe registra la hora del cambio para el cálculo de minutos.`)) return;
  try{
    const r = await rpc("fn_cambiar_area",{p_dni:s.dni,p_token:s.token,p_dnis:mv.dnis,p_area:area});
    if(!r.ok){ mostrarError(r.error||"No se pudo mover"); return; }
    $("exTitulo").textContent="Movimiento registrado";
    $("exDetalle").innerHTML=`${mv.dnis.length} persona(s) → <b>${esc(area)}</b>`;
    $("exAvance").textContent="";
    const ex=$("exito"); ex.classList.add("visible");
    setTimeout(async ()=>{
      ex.classList.remove("visible");
      mv={dnis:[]};
      await cargarPersonal(s);
      irA("pasoPersonal");
    },2200);
  }catch(e){ mostrarError(e.message); }
}

/* ---------------- PWA ---------------- */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
}

/* ---------------- ARRANQUE POR PÁGINA ---------------- */
document.addEventListener("DOMContentLoaded",()=>{
  const pagina = document.body.dataset.pagina;
  if(pagina==="login") initLogin();
  if(pagina==="operario") initOperario();
  if(pagina==="supervisora") initSupervisora();
});