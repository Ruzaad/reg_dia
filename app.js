/* ============================================================
   SAMITEX — Tickets Virtuales · app.js (compartido)
   Páginas: index.html (login+área) · operario.html · supervisora.html
   ============================================================ */

/* ---------------- CONFIGURACIÓN (editar aquí) ---------------- */
const SUPABASE_URL  = "https://lmlwomurgbbzolgbkwtp.supabase.co";      // https://xxxx.supabase.co
const SUPABASE_ANON = "sb_publishable_UL22rxFy12xjwf4R9ReRNQ_igpA1hwJ";          // Settings → API → anon public
// Nombre (slug) EXACTO de la Edge Function que escribe tickets al ALMACEN.
// Debe coincidir con el que aparece en la URL de Supabase (Edge Functions).
// Supabase le puso "smooth-processor" al desplegar; si la renombras a
// "generar-tickets", cambia este valor.
const FN_GENERAR_TICKETS = "smooth-processor";

const MAPA_ESTANDAR = {                          // cabecera normalizada -> campo
  "PRENDA":"prenda","ARTICULO":"articulo","MODULO":"modulo","OP":"op",
  "STD":"std","OF":"of","TALLA":"talla","COLOR":"color","NCORTE":"corte",
  "CANT":"cant","CODIGO":"codigo","NOP":"nop","NUMERACION":"num"
};

const MAPA_ACABADO = {                          // cabecera normalizada -> campo
  "PRENDA":"prenda","ARTICULO":"articulo","MODULO":"modulo","OP":"op",
  "STD":"std","OF":"of","TALLA":"talla","COLOR":"color","NCORTE":"corte",
  "CANT":"cant","CODIGO":"codigo","NOP":"nop","NOMBRE":"nombre"
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
    habilitada: true,               // PENDIENTE: compartir libro como lector + confirmar cabeceras
    sheetId: "1R2FqLRZpFjdA7rzUk6dsTyj898yUYO0aKU_OYG4e0Xc",
    hoja: "ALMACEN",
    mapa: MAPA_ACABADO              // ajustar cuando se vean sus columnas reales
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

/* ---- Botón "atrás" del celular = botón Volver (evita cierres inesperados) ----
   window.VOLVER_MAP (paso -> paso de retorno) lo define cada página (operario /
   supervisora). Al retroceder con el hardware se ejecuta la MISMA lógica que el
   botón Volver; solo en un paso raíz se permite salir de la app. */
function pasoActivo(){ const el=document.querySelector(".pantalla.activa"); return el?el.id:null; }
/* El botón Atrás del celular vuelve DIRECTO a la pantalla de OF: encadenar
   Volver→Volver→Volver era lento en planta. `window.VOLVER_INICIO` lo fija cada
   página (operario: la lista de OF); si no está, se usa el salto de uno en uno. */
function volverAtras(){
  const o=$("modalOverlay");
  if(o && o.classList.contains("visible")){ cerrarModal(); return true; }   // 1º cierra modal
  const act=pasoActivo();
  const ini=window.VOLVER_INICIO;
  if(ini && act && act!==ini && (window.VOLVER_MAP||{})[act]){ irA(ini); return true; }
  const t=(window.VOLVER_MAP||{})[act];
  if(t){ irA(t); return true; }
  // Paso raíz: antes se dejaba salir de la app y en planta eso era un deslogueo
  // casual. Si la página define onSalirApp, pide confirmación y no sale.
  if(typeof window.onSalirApp === "function"){ window.onSalirApp(); return true; }
  return false;
}
function _armarAtras(){ try{ history.pushState({stx:1}, ""); }catch(e){} }
let _backTrapListo=false;
function initBackTrap(){
  if(_backTrapListo) return; _backTrapListo=true;
  _armarAtras();
  window.addEventListener("popstate", ()=>{ if(volverAtras()) _armarAtras(); });
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
function cerrarSesion(){ localStorage.removeItem("stx_sesion"); try{ sessionStorage.removeItem("stx_volver_ing"); }catch(e){} location.href = "index.html"; }
/* Si se entró como operario o como supervisora DESDE ingeniería, botón de vuelta.
   Restaura la sesión original de ingeniería, que se guardó al salir. */
function botonVolverIng(){
  try{
    const prevIng = sessionStorage.getItem("stx_volver_ing");
    const badges = document.querySelector("header .badges");
    if(!prevIng || !badges || $("btnVolverIng")) return;
    const b=document.createElement("button");
    b.type="button"; b.className="btn-hdr-icon"; b.id="btnVolverIng";
    b.title="Volver a Ingeniería"; b.textContent="🏭";
    b.onclick=()=>{ localStorage.setItem("stx_sesion", prevIng);
      sessionStorage.removeItem("stx_volver_ing"); location.href="ingenieria.html"; };
    badges.insertBefore(b, badges.firstChild);
  }catch(e){}
}

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

/* ---------------- CONFIG DE ÁREAS DESDE SUPABASE ----------------
   Fuente de verdad: tabla `areas_config` (area, sheet_id, hoja_almacen,
   hoja_of). AREAS (arriba) queda solo como respaldo si la RPC falla.
   Habilitar un área = darle fila con sheet_id; no hay que tocar código.
   El mapa de cabeceras se deriva del nombre: ACABADO usa MAPA_ACABADO. */
let AREAS_HIDRATADAS = false;
async function hidratarAreas(){
  if(AREAS_HIDRATADAS) return AREAS;
  const s = sesionActual(); if(!s || !s.token) return AREAS;
  try{
    const r = await rpc("fn_areas_config_listar",{p_dni:s.dni, p_token:s.token});
    if(!Array.isArray(r) || !r.length) return AREAS;
    Object.keys(AREAS).forEach(a=>{ AREAS[a].habilitada = false; });
    r.forEach(c=>{
      const a = norm(c.area); if(!a || !norm(c.sheet_id)) return;
      AREAS[a] = {habilitada:true, sheetId:norm(c.sheet_id),
        hoja: norm(c.hoja_almacen)||"ALMACEN", hojaOF: norm(c.hoja_of)||null,
        // parche 45: false = esta área ya no lee el ALMACEN del Sheet.
        usaAlmacen: (c.usa_almacen===undefined ? true : !!c.usa_almacen),
        mapa: normKey(a)==="ACABADO" ? MAPA_ACABADO : MAPA_ESTANDAR};
    });
    AREAS_HIDRATADAS = true;
  }catch(e){ console.warn("areas_config no disponible, uso AREAS locales:", e.message); }
  return AREAS;
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
  await hidratarAreas();
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
      await hidratarAreas();
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
  pasoTickets:"pasoOps", pasoConf:"pasoTickets",
  pasoAcabPrenda:"pasoAcabOF", pasoAcabOp:"pasoAcabOF",
  pasoAcabCant:"pasoAcabOp", pasoMisPaq:"pasoOF"
};

let sa={signo:-1};
/* El operario solo pide RESTAR minutos: nunca sumaron. Los motivos habituales
   son botones; "OTROS" abre los minutos y el texto libre, que se guarda en
   mayúsculas. */
const SA_MOTIVOS=["MÁQUINA PARADA","ARREGLOS","MUESTRAS","REPROCESOS","DESCOSER","OTROS"];
function abrirSolicitudAjuste(){
  sa={signo:-1, motivo:null};
  abrirModal(`
    <h2>Solicitar descuento de tiempo</h2>
    <div class="sub" style="margin-bottom:12px;">Pides a supervisión restar minutos de tu día</div>
    <div class="sa-motivos" id="saMotivos">
      ${SA_MOTIVOS.map((m,i)=>`<button type="button" class="sa-mot" id="saMot${i}" onclick="saElegir(${i})">${esc(m)}</button>`).join("")}
    </div>
    <div class="modal-campo"><label>Minutos a descontar</label>
      <input id="saMin" inputmode="numeric" maxlength="3" placeholder="Ej: 30" disabled></div>
    <div class="modal-campo" id="saMotivoCampo" hidden><label>¿Cuál fue el motivo?</label>
      <input id="saMotivo" maxlength="140" placeholder="Escribe el motivo"></div>
    <div class="modal-msg" id="saMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="enviarSolicitudAjuste()">ENVIAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
function saElegir(i){
  sa.motivo=SA_MOTIVOS[i];
  SA_MOTIVOS.forEach((_,k)=>{ const b=$("saMot"+k); if(b) b.classList.toggle("activo",k===i); });
  const otros = sa.motivo==="OTROS";
  $("saMotivoCampo").hidden=!otros;
  $("saMin").disabled=false;
  $("saMsg").textContent="";
  setTimeout(()=>{ const el=otros?$("saMotivo"):$("saMin"); if(el) el.focus(); },80);
}
async function enviarSolicitudAjuste(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  if(!sa.motivo){ $("saMsg").textContent="Elige el motivo"; return; }
  const v=parseInt($("saMin").value,10);
  const libre=($("saMotivo").value||"").trim().toUpperCase();
  if(!v||v<=0){ $("saMsg").textContent="Ingresa los minutos"; return; }
  if(sa.motivo==="OTROS" && !libre){ $("saMsg").textContent="Escribe cuál fue el motivo"; return; }
  const motivo = sa.motivo==="OTROS" ? libre : sa.motivo;
  try{
    const r=await rpc("fn_solicitud_ajuste_crear",{p_dni:s.dni,p_token:s.token,p_area:AREA_ESTAJERO||s.area,
      p_minutos:-Math.abs(v),p_motivo:motivo});
    if(!r.ok){ $("saMsg").textContent=r.error||"No se pudo enviar"; return; }
    cerrarModal();
    $("exTitulo").textContent="Solicitud enviada";
    $("exDetalle").innerHTML=`−${v} min · ${esc(motivo)} · esperando aprobación`;
    $("exAvance").textContent=""; $("exTimer").textContent="";
    const ex=$("exito"); ex.classList.add("visible");
    setTimeout(()=>ex.classList.remove("visible"),2200);
  }catch(e){ $("saMsg").textContent=e.message; }
}
/* Artículo de una OF, desde los tickets ya cargados. */
function artDeOF(of){
  if(!of || !ALM || !ALM.tickets) return "";
  const t=ALM.tickets.find(x=>x.of===of && norm(x.articulo));
  return t ? norm(t.articulo) : "";
}
function pintarCrumb(id){
  const el=$("crumbOF"); if(!el) return;
  if(id==="pasoCarga" || id==="pasoOF" || !sel.of){ el.style.display="none"; el.innerHTML=""; return; }
  const art=artDeOF(sel.of);
  const partes=[(art?`<b>${esc(art)}</b> · `:"")+`OF <b>${esc(sel.of)}</b>`];
  if(sel.modulo) partes.push(`Módulo <b>${esc(sel.modulo)}</b>`);
  if(sel.op)     partes.push(`Operación <b>${esc(sel.op)}</b>`);
  el.innerHTML = partes.join(' <span class="crumb-sep">\u203A</span> ');
  el.style.display="block";
}
let EF_CENSURADA = false;   // operario: ojo para censurar su propia eficiencia
/* ACABADO: se cuenta CANTIDAD (sin numeración, sin minutaje, sin eficiencia).
   Las metas diarias se retiraron en el parche 40. */
let ES_ACABADO = false, CANT_HOY_ACABADO = 0;
const qty = v => (Math.round((+v||0)*100)/100);   // cantidad legible (2 dec máx)
/* Oculta en la cabecera lo que no aplica a Acabado (ojo de eficiencia, ajuste
   de minutos) y ajusta el subtítulo del paso Tickets. */
function aplicarModoAcabado(){
  const oj=$("btnOjoEf"), rl=$("btnReloj");
  if(oj) oj.style.display = ES_ACABADO ? "none" : "";
  if(rl) rl.style.display = "";   // ajuste de tiempo disponible también en ACABADO
  const lblConf=$("confLabel"); if(lblConf) lblConf.textContent = ES_ACABADO ? "Cantidad" : "Numeración";
  // ACABADO ya no pasa por el almacén ni por "Mis paquetes": registra por cantidad.
  const bmp=$("btnMisPaq"); if(bmp) bmp.style.display = ES_ACABADO ? "none" : "";
  window.VOLVER_INICIO = ES_ACABADO ? "pasoAcabOF" : "pasoOF";
}
function initOperario(){
  const s = sesionActual();
  if(!s || !s.area){ location.href="index.html"; return; }
  $("quienBadge").textContent = soloApellidos(s.nombre); $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  { const rb=$("btnReloj"); if(rb) rb.onclick=abrirSolicitudAjuste; }
  { const kb=$("btnLlave"); if(kb) kb.onclick=abrirCambioPin; }
  { const rc=$("btnRecargar"); if(rc) rc.onclick=recargarMiEficiencia; }
  { const oj=$("btnOjoEf"); if(oj) oj.onclick=()=>{ EF_CENSURADA=!EF_CENSURADA; setAvance(ULTIMO_DIA); }; }
  botonVolverIng();
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
    irA("pasoAreaEstajero");
    hidratarAreas().then(()=>pintarAreasEstajero(s));
  } else {
    AREA_ESTAJERO = s.area;
    $("tituloArea").textContent = s.area;
    cargarTodo(s);
  }
  window.VOLVER_MAP = VOLVER_OPERARIO;
  // Atrás siempre devuelve a la lista de OF (o a la de Acabado, según el área).
  window.VOLVER_INICIO = ES_ACABADO ? "pasoAcabOF" : "pasoOF";
  window.onSalirApp = confirmarSalir;
  initBackTrap();
}

/* Atrás desde la pantalla raíz (OF o OF de Acabado): confirma antes de salir.
   Volver a pulsar atrás cierra este modal, así que no hay forma de deslogearse
   sin querer: hay que tocar el botón. */
function confirmarSalir(){
  abrirModal(`
    <h2>¿Cerrar sesión?</h2>
    <div class="sub" style="margin-bottom:12px;">Vas a salir de la aplicación. Lo que ya registraste no se pierde.</div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="cerrarSesion()">SÍ, CERRAR SESIÓN</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">NO, SEGUIR AQUÍ</button>
    </div>`);
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
  ES_ACABADO = (area === "ACABADO");
  aplicarModoAcabado();
  $("zonaCarga").innerHTML = cargandoHTML("Cargando "+(ES_ACABADO?"OFs":"almacén")+" de "+area+"…");
  try{
    // ACABADO ya no lee el almacén: registra por cantidad contra el corte real.
    if(ES_ACABADO){ await cargarAcabado(s, area); return; }
    // Las OF generadas en el sistema (parche 29) se derivan de of_detalle × bases:
    // no están en el Sheet. Las anteriores siguen saliendo del almacén, así que
    // ambas conviven y el Sheet se vacía solo conforme entren OF nuevas.
    // parche 45: si el área ya no usa el Sheet, ni se pide.
    const usaAlm = (AREAS[area] && AREAS[area].usaAlmacen !== false);
    const [alm, recl, dia, res, der, mp] = await Promise.all([
      usaAlm ? cargarAlmacen(area).catch(e=>({tickets:[],duplicados:[],_err:e.message}))
             : Promise.resolve({tickets:[],duplicados:[]}),
      rpc("fn_reclamados", {p_dni:s.dni, p_token:s.token, p_area:area}),
      rpc("fn_mi_dia", {p_dni:s.dni, p_token:s.token}),
      rpc("fn_residuales", {p_dni:s.dni, p_token:s.token, p_area:area}).catch(()=>[]),
      rpc("fn_tickets_area", {p_dni:s.dni, p_token:s.token, p_area:area}).catch(()=>[]),
      rpc("fn_mis_paquetes", {p_dni:s.dni, p_token:s.token, p_area:area}).catch(()=>[])
    ]);
    MISPAQ = Array.isArray(mp) ? mp : [];
    aplicarBotonMisPaq();
    ALM = alm;
    if(Array.isArray(der) && der.length){
      const propias=new Set(der.map(t=>normKey(t.of)));
      // Si una OF ya se sirve del sistema, se ignora lo que quede de ella en el Sheet.
      ALM.tickets = ALM.tickets.filter(t=>!propias.has(normKey(t.of))).concat(der.map(mapDerivado));
    }
    if(alm._err && !ALM.tickets.length) throw new Error(alm._err);
    if(Array.isArray(res) && res.length) ALM.tickets = ALM.tickets.concat(res.map(mapResidual));
    RECL = {}; recl.forEach(x=>{ RECL[x.codigo]={nombre:x.nombre,hora:x.hora}; });
    setAvance(dia);
    if(alm.duplicados.length) console.warn("Códigos duplicados en almacén:", alm.duplicados);
    irA("pasoOF");
  }catch(e){
    $("zonaCarga").innerHTML = `<div class="vacio-msg">${esc(e.message)}</div>`;
    mostrarError("No se pudo cargar. Revisa la conexión y vuelve a intentar.");
  }
}
/* Ticket derivado (parche 29): misma forma que una fila del almacén. */
function mapDerivado(t){
  const std=Number(t.std)||0, cant=Number(t.cant)||0;
  return {codigo:norm(t.codigo), std, cant, nop:t.nop, of:norm(t.of), modulo:norm(t.modulo),
    op:norm(t.op), talla:norm(t.talla), color:norm(t.color), corte:norm(t.corte),
    num:norm(t.num), articulo:norm(t.articulo), minutos:Math.round(std*cant*10)/10};
}
/* Un residual (-R1, -R2…) se comporta como un paquete más del almacén. */
function mapResidual(r){
  const std=Number(r.std)||0, cant=Number(r.cant)||0;
  return {codigo:r.codigo, std, cant, nop:r.nop, of:norm(r.of), modulo:norm(r.modulo),
    op:norm(r.op), talla:norm(r.talla), color:norm(r.color), corte:norm(r.corte),
    num:norm(r.num)||norm(r.padre), articulo:norm(r.articulo),
    minutos:Math.round(std*cant*10)/10, residual:true};
}

/* ================= ACABADO: registro por cantidad =================
   Sin almacén y sin código: OF (artículo · color) → operación → cantidad,
   con techo en el corte real de la OF. `fn_of_resumen` ignora los registros
   sin OF, así que el trabajo de reproceso no ensucia el resumen. */
let ACAB={ofs:[], extra:[], of:null, op:null, tipo:null, prenda:null};
let CAUSAS=[];
/* El operario elige una causa (auditoría, falta de vapor…); los minutos que
   suma los pone la BD desde `causas_std`. Nunca ve el número. */
function pintarCausas(){
  const card=$("acabCausaCard"), sel=$("acabCausa");
  if(!card || !sel) return;
  // No aplica al trabajo sin OF: ese ya tiene su propio STD.
  const aplica = CAUSAS.length && !ACAB.tipo;
  card.hidden = !aplica;
  sel.innerHTML = `<option value="">No, como siempre</option>`
    + (aplica ? CAUSAS.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("") : "");
  sel.value = "";
  acabCausaCambio();
}
/* Histórico de la operación (parche 42): quién registró qué y qué día en esta
   misma (OF, operación). Sirve para no volver a declarar lo que otro ya puso.
   No aplica al trabajo sin OF, que no tiene operación de ruta. */
async function cargarAcabHist(){
  const card=$("acabHistCard"), z=$("acabHist");
  if(!card||!z) return;
  card.hidden=true; z.innerHTML="";
  if(ACAB.tipo || !ACAB.of || !ACAB.op) return;
  const s=sesionActual(), area=AREA_ESTAJERO||s.area;
  try{
    const r=await rpc("fn_acabado_historial",{p_dni:s.dni,p_token:s.token,
      p_area:area, p_of:ACAB.of.of, p_nop:ACAB.op.n_op});
    if(!r || r.ok===false) return;
    pintarAcabHist(r.items||[]);
  }catch(e){ /* el histórico nunca debe impedir registrar */ }
}
function pintarAcabHist(items){
  const card=$("acabHistCard"), z=$("acabHist");
  if(!items.length){ card.hidden=true; return; }
  const total=items.reduce((a,x)=>a+(Number(x.cant)||0),0);
  const hoy=new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"});
  const cuando=f=> f===hoy ? "hoy" : f;
  z.innerHTML=`<div class="acab-hist-lista">${items.map(x=>`
      <div class="acab-hist-fila${x.mio?" mio":""}">
        <div>
          <div class="acab-hist-quien">${esc(soloApellidos(x.nombre))}${x.mio?" (tú)":""}</div>
          <div class="acab-hist-cuando">${esc(cuando(x.fecha))} · ${esc(x.hora)}</div>
          ${x.causa?`<div class="acab-hist-causa">${esc(x.causa)}</div>`:""}
        </div>
        <div class="acab-hist-cant">${qty(x.cant)} und</div>
      </div>`).join("")}</div>
    <div class="acab-hist-total">${items.length} registro(s) · <b>${qty(total)}</b> und en total</div>`;
  card.hidden=false;
}
/* Marca la tarjeta cuando hay causa elegida. Solo señal visual: el operario
   nunca ve minutos, el delta lo aplica la BD desde `causas_std`. */
function acabCausaCambio(){
  const card=$("acabCausaCard"), nota=$("acabCausaNota"), sel=$("acabCausa");
  const hay = !!(sel && sel.value);
  if(card) card.classList.toggle("activa", hay);
  if(nota) nota.hidden = !hay;
}
async function cargarAcabado(s, area){
  const [ofs, extra, dia, causas] = await Promise.all([
    rpc("fn_acabado_ofs",{p_dni:s.dni,p_token:s.token,p_area:area}),
    rpc("fn_extra_listar",{p_dni:s.dni,p_token:s.token,p_area:area,p_todas:false}).catch(()=>[]),
    rpc("fn_acabado_metas",{p_dni:s.dni,p_token:s.token,p_area:area}),
    rpc("fn_causas_std_listar",{p_dni:s.dni,p_token:s.token}).catch(()=>[])
  ]);
  CAUSAS = Array.isArray(causas) ? causas : [];
  if(ofs && ofs.ok===false) throw new Error(ofs.error||"No se pudieron cargar las OF");
  ACAB={ofs:(ofs&&ofs.items)||[], extra:Array.isArray(extra)?extra:[], of:null, op:null, tipo:null};
  setMetasAcabado(dia);
  pintarAcabOF();
  irA("pasoAcabOF");
}
function acabPct(hecho, meta){ return meta>0 ? Math.min(100, Math.round(hecho/meta*100)) : 0; }
function pintarAcabOF(){
  const l=$("listaAcabOF"); l.innerHTML="";
  const q=normKey(($("acabBuscaOF")||{}).value||"");
  if(ACAB.extra.length && !q){
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div><div class="cf-titulo">SIN OF</div>
      <div class="cf-detalle">Reproceso · muestra · arreglo</div></div>
      <div class="badge-disp">${ACAB.extra.length} op.</div>`;
    c.onclick=()=>{ ACAB.of=null; ACAB.prenda=null;
      window.VOLVER_MAP.pasoAcabOp="pasoAcabOF"; pintarAcabExtra(); irA("pasoAcabOp"); };
    l.appendChild(c);
  }
  ACAB.ofs.forEach((o,i)=>{
    if(q && !normKey((o.of||"")+" "+(o.articulo||"")).includes(q)) return;
    const ops=o.operaciones||[];
    const pend=ops.filter(x=>Number(x.hecho)<Number(o.cant_prog)).length;
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div>
        <div class="cf-titulo">${esc(o.articulo||"—")} · OF ${esc(o.of)}</div>
        <div class="cf-detalle">${esc(o.colores||"—")} · ${qty(o.cant_prog)} und de corte</div>
      </div>
      <div class="badge-disp ${pend?"":"vacio"}">${pend} op. pendiente(s)</div>`;
    c.onclick=()=>{ ACAB.of=ACAB.ofs[i]; abrirAcabOF(); };
    l.appendChild(c);
  });
  if(!l.children.length) l.innerHTML=`<div class="vacio-msg">${q
    ? `Ninguna OF o artículo contiene "${esc(($("acabBuscaOF")||{}).value||"")}"`
    : "No hay OF con trabajo pendiente en esta área."}</div>`;
}
/* Una OF puede llevar dos prendas (un terno = pantalón + saco): misma OF,
   mismo artículo, rutas distintas dentro de la misma BASE. Si es el caso se
   intercala un paso para elegirla; con una sola prenda el flujo no cambia. */
function acabPrendas(){ const p=(ACAB.of&&ACAB.of.prendas)||[]; return Array.isArray(p)?p:[]; }
function abrirAcabOF(){
  const pr=acabPrendas();
  if(pr.length > 1){
    ACAB.prenda=null;
    window.VOLVER_MAP.pasoAcabOp="pasoAcabPrenda";
    pintarAcabPrendas(); irA("pasoAcabPrenda");
  }else{
    ACAB.prenda = pr.length===1 ? pr[0] : null;
    window.VOLVER_MAP.pasoAcabOp="pasoAcabOF";
    pintarAcabOps(); irA("pasoAcabOp");
  }
}
function pintarAcabPrendas(){
  const o=ACAB.of; if(!o) return;
  $("tituloAcabPrenda").textContent = `${o.articulo} · OF ${o.of}`;
  const l=$("listaAcabPrenda"); l.innerHTML="";
  acabPrendas().forEach(pren=>{
    const ops=(o.operaciones||[]).filter(x=>x.prenda===pren);
    const meta=Number(o.cant_prog)||0;
    const pend=ops.filter(x=>Number(x.hecho)<meta).length;
    const c=document.createElement("div");
    c.className="card-fila"+(pend?"":" off");
    c.innerHTML=`<div>
        <div class="cf-titulo">${esc(pren)}</div>
        <div class="cf-detalle">${ops.length} operación(es) · ${qty(meta)} und de corte</div>
      </div>
      <div class="badge-disp ${pend?"":"vacio"}">${pend?pend+" pendiente(s)":"completa"}</div>`;
    c.onclick=()=>{ ACAB.prenda=pren; pintarAcabOps(); irA("pasoAcabOp"); };
    l.appendChild(c);
  });
}
function pintarAcabOps(){
  const o=ACAB.of; if(!o) return;
  $("tituloAcabOp").textContent = `${o.articulo}${ACAB.prenda?" · "+ACAB.prenda:""} · OF ${o.of}`;
  $("subAcabOp").textContent = `${o.colores||"—"} · corte real ${qty(o.cant_prog)} und`;
  const l=$("listaAcabOp"); l.innerHTML="";
  // Con dos prendas se listan solo las operaciones de la elegida.
  const lista = acabPrendas().length>1 && ACAB.prenda
    ? (o.operaciones||[]).filter(x=>x.prenda===ACAB.prenda)
    : (o.operaciones||[]);
  lista.forEach((x,i)=>{
    const meta=Number(o.cant_prog)||0, hecho=Number(x.hecho)||0, queda=Math.max(0,meta-hecho);
    const pct=acabPct(hecho,meta);
    const c=document.createElement("div");
    c.className="card-fila"+(queda?"":" off");
    c.innerHTML=`<div style="flex:1;">
        <div class="cf-titulo">${esc(x.operacion)}</div>
        <div class="cf-detalle">${qty(hecho)} de ${qty(meta)} und${Number(x.mio)?` · tú ${qty(x.mio)}`:""}</div>
        <div class="avance-bar"><div class="avance-fill ${pct>=80?'alto':pct<40?'bajo':''}" style="width:${pct}%"></div>
          <span class="avance-lbl">${pct}%</span></div>
      </div>
      <div class="badge-disp ${queda?"":"vacio"}">${queda?qty(queda)+" und":"completa"}</div>`;
    if(queda) c.onclick=()=>{ ACAB.op=lista[i]; ACAB.tipo=null; acabPedirCant(); };
    l.appendChild(c);
  });
}
function pintarAcabExtra(){
  $("tituloAcabOp").textContent = "Trabajo sin OF";
  $("subAcabOp").textContent = "Reprocesos, muestras y arreglos: no descuentan de ninguna OF";
  const l=$("listaAcabOp"); l.innerHTML="";
  ACAB.extra.forEach((e,i)=>{
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div><div class="cf-titulo">${esc(e.operacion)}</div>
      <div class="cf-detalle">${esc(e.tipo)} · STD ${Number(e.std).toFixed(2)} min</div></div>`;
    c.onclick=()=>{ ACAB.tipo=ACAB.extra[i]; ACAB.op=null; acabPedirCant(); };
    l.appendChild(c);
  });
}
/* Cabecera y "quedan N und". Separado para poder refrescarlo con el botón ↻
   sin borrar la cantidad que el operario ya tecleó. */
function acabDetalle(){
  const e=ACAB.tipo, x=ACAB.op, o=ACAB.of;
  if(!e && (!x || !o)) return;
  $("tituloAcabCant").textContent = e ? e.operacion : x.operacion;
  $("acabDet").innerHTML = e
    ? `${esc(e.tipo)} · STD ${Number(e.std).toFixed(2)} min`
    : `OF ${esc(o.of)} · ${esc(o.articulo)}<br>Quedan <b>${qty(Math.max(0,Number(o.cant_prog)-Number(x.hecho)))}</b> und de ${qty(o.cant_prog)}`;
}
function acabPedirCant(){
  acabDetalle();
  $("acabCant").value="";
  pintarCausas();
  cargarAcabHist();
  irA("pasoAcabCant");
  setTimeout(()=>$("acabCant").focus(),150);
}
async function acabRegistrar(){
  const cant=parseFloat(String($("acabCant").value).replace(/[^\d.]/g,""));
  if(!cant || cant<=0){ mostrarError("Escribe la cantidad que hiciste"); return; }
  const s=sesionActual(), area=AREA_ESTAJERO||s.area;
  const btn=document.querySelector("#pasoAcabCant .btn-principal");
  if(btn){ btn.disabled=true; btn.textContent="REGISTRANDO…"; }
  try{
    const r = ACAB.tipo
      ? await rpc("fn_extra_registrar",{p_dni:s.dni,p_token:s.token,p_area:area,p_id:ACAB.tipo.id,p_cant:cant})
      : await rpc("fn_acabado_registrar",{p_dni:s.dni,p_token:s.token,p_area:area,
          p_of:ACAB.of.of,p_nop:ACAB.op.n_op,p_cant:cant,
          p_causa:(($("acabCausa")||{}).value||"")});
    if(!r.ok){ mostrarError(r.error||"No se pudo registrar"); return; }
    $("exTitulo").textContent="¡Listo, "+s.nombre.split(" ")[0]+"!";
    $("exDetalle").innerHTML = `${qty(cant)} und · `
      + (ACAB.tipo ? esc(ACAB.tipo.operacion) : `${esc(ACAB.op.operacion)} · OF ${esc(ACAB.of.of)}`)
      + (r.causa ? `<br>${esc(r.causa)}` : "")
      + (r.hecho!=null ? `<br>Van ${qty(r.hecho)} de ${qty(r.cant_prog)} und` : "");
    mostrarExito();
    { const c=$("acabHistCard"); if(c) c.hidden=true; }
    await cargarAcabado(s, area);
  }catch(e){ mostrarError(e.message); }
  finally{ if(btn){ btn.disabled=false; btn.textContent="REGISTRAR"; } }
}

/* ================= MIS PAQUETES (costura) =================
   Todos cuentan como completos: solo se toca el que quedó a medias. Al
   declarar menos, el resto sale como paquete nuevo (-R1, -R2…) y queda libre
   para que quien lo termine sí pueda notificar sus minutos. */
let MISPAQ=[];
/* Solo son "míos y ajustables" los paquetes de una operación troceada (o un
   residual). El resto no se puede partir, así que ni se listan. */
function misPaqAjustables(){ return MISPAQ.filter(p=>p.divisible || p.ajustado); }
/* Sin ninguno, el botón sobra: evita que intenten trocear lo que no se trocea. */
function aplicarBotonMisPaq(){
  const b=$("btnMisPaq"); if(!b) return;
  b.style.display = (ES_ACABADO || !misPaqAjustables().length) ? "none" : "";
}
async function abrirMisPaquetes(){
  const s=sesionActual(), area=AREA_ESTAJERO||s.area;
  $("listaMisPaq").innerHTML=cargandoHTML("Cargando…");
  irA("pasoMisPaq");
  try{
    const r=await rpc("fn_mis_paquetes",{p_dni:s.dni,p_token:s.token,p_area:area});
    if(r && r.ok===false){ mostrarError(r.error||"Error"); MISPAQ=[]; }
    else MISPAQ=Array.isArray(r)?r:[];
    aplicarBotonMisPaq();
    pintarMisPaq();
  }catch(e){ $("listaMisPaq").innerHTML=""; mostrarError(e.message); }
}
function pintarMisPaq(){
  const l=$("listaMisPaq"); l.innerHTML="";
  const lista=misPaqAjustables();
  if(!lista.length){ l.innerHTML=`<div class="vacio-msg">No tienes paquetes que se puedan ajustar.</div>`; return; }
  lista.forEach((p,i)=>{
    const c=document.createElement("div");
    c.className="card-fila"+(p.ajustado?" marcada":"");
    const est = p.ajustado
      ? `<div class="mp-nota">Hiciste ${qty(p.cant)} de ${qty(p.asignada)} und</div>`
      : `<div class="cf-detalle"><b>${qty(p.cant)}</b> und · completo</div>`;
    c.innerHTML=`<div style="flex:1;">
        <div class="cf-titulo">${esc(p.articulo?p.articulo+" · ":"")}${esc(p.op)}</div>
        <div class="cf-detalle">OF ${esc(p.of||"—")} · ${esc(p.num||p.codigo)} · ${esc(p.fecha)} ${esc(p.hora)}</div>
        ${est}
        <div class="mp-editor" id="mpEd${i}" hidden>
          <input type="number" id="mpCant${i}" min="1" max="${p.asignada-1}" inputmode="numeric" placeholder="0">
          <button class="btn-mini verde" onclick="declararParcial(${i})">Guardar</button>
          <button class="btn-mini gris" onclick="mpEditar(${i},false)">Cancelar</button>
        </div>
      </div>`;
    if(p.divisible && !p.ajustado){
      const b=document.createElement("button");
      b.className="btn-mini"; b.textContent="Ajustar";
      b.onclick=()=>mpEditar(i,true);
      c.appendChild(b);
    }
    l.appendChild(c);
  });
}
function mpEditar(i, abrir){
  const e=$("mpEd"+i); if(!e) return;
  e.hidden=!abrir;
  if(abrir) setTimeout(()=>{ const c=$("mpCant"+i); if(c) c.focus(); },100);
}
async function declararParcial(i){
  const p=misPaqAjustables()[i]; if(!p) return;   // el índice es de la lista pintada
  const v=parseFloat(String(($("mpCant"+i)||{}).value||"").replace(/[^\d.]/g,""));
  if(!v || v<=0 || v>=p.asignada){ mostrarError(`Escribe entre 1 y ${qty(p.asignada-1)}`); return; }
  const resto=p.asignada-v;
  if(!confirm(`¿Hiciste ${qty(v)} de ${qty(p.asignada)} und?\nLas ${qty(resto)} restantes quedarán libres para quien las termine.`)) return;
  const s=sesionActual(), area=AREA_ESTAJERO||s.area;
  try{
    const r=await rpc("fn_declarar_parcial",{p_dni:s.dni,p_token:s.token,p_area:area,p_codigo:p.codigo,p_cant_hecha:v});
    if(!r.ok){ mostrarError(r.error||"No se pudo ajustar"); return; }
    mostrarOk(`${qty(v)} und registradas · ${qty(r.resto)} und quedaron libres`);
    await abrirMisPaquetes();
    try{ setAvance(await rpc("fn_mi_dia",{p_dni:s.dni,p_token:s.token})); }catch(e){}
  }catch(e){ mostrarError(e.message); }
}

let ULTIMO_DIA = {eficiencia:0,minutos_prod:0,minutos_disp:0};
function setAvance(d){
  ULTIMO_DIA = d || ULTIMO_DIA;
  const b=$("badgeAvance");
  const ef = EF_CENSURADA ? "****" : (ULTIMO_DIA.eficiencia + "%");
  b.textContent = `Hoy: ${ef} · ${ULTIMO_DIA.minutos_prod} de ${ULTIMO_DIA.minutos_disp} min`;
  b.classList.add("visible");
}
/* ACABADO: badge = cantidad de hoy (sin eficiencia ni minutaje).
   Las metas diarias se retiraron (parche 40): no las usaban para guiarse y
   salían mal en el encabezado. `fn_acabado_metas` se sigue llamando solo por
   `cant_hoy`; su campo `ops` ya no se lee. */
function setMetasAcabado(d){
  CANT_HOY_ACABADO = (d && +d.cant_hoy) || 0;
  const b=$("badgeAvance");
  b.textContent = `Hoy: ${qty(CANT_HOY_ACABADO)} und`;
  b.classList.add("visible");
}
async function refrescarMetasAcabado(){
  const s=sesionActual(); if(!s) return;
  const area = AREA_ESTAJERO || s.area;
  try{ setMetasAcabado(await rpc("fn_acabado_metas",{p_dni:s.dni,p_token:s.token,p_area:area})); }catch(e){}
}
async function recargarMiEficiencia(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const b=$("btnRecargar"); if(b) b.classList.add("girando");
  try{
    const act=pasoActivo();
    if(ES_ACABADO){
      /* En Acabado no hay tickets que liberar: lo que cambia es la ruta (una
         operación nueva en la BASE) y lo ya registrado por otros. Se recarga
         eso, conservando dónde está el operario. */
      const area=AREA_ESTAJERO||s.area;
      const ofAnt=ACAB.of&&ACAB.of.of, opAnt=ACAB.op&&ACAB.op.n_op, prAnt=ACAB.prenda;
      const [ofs, extra, dia] = await Promise.all([
        rpc("fn_acabado_ofs",{p_dni:s.dni,p_token:s.token,p_area:area}),
        rpc("fn_extra_listar",{p_dni:s.dni,p_token:s.token,p_area:area,p_todas:false}).catch(()=>[]),
        rpc("fn_acabado_metas",{p_dni:s.dni,p_token:s.token,p_area:area})
      ]);
      if(ofs && ofs.ok===false) throw new Error(ofs.error||"No se pudieron cargar las OF");
      ACAB.ofs=(ofs&&ofs.items)||[];
      ACAB.extra=Array.isArray(extra)?extra:[];
      setMetasAcabado(dia);
      // Reengancha la OF y la operación donde estaba, ya con los datos nuevos.
      ACAB.of = ofAnt ? (ACAB.ofs.find(x=>normKey(x.of)===normKey(ofAnt)) || null) : null;
      ACAB.prenda = ACAB.of && (ACAB.of.prendas||[]).includes(prAnt) ? prAnt : ACAB.prenda;
      ACAB.op = (ACAB.of && opAnt!=null)
        ? ((ACAB.of.operaciones||[]).find(x=>Number(x.n_op)===Number(opAnt)) || null) : null;
      if(act==="pasoAcabOF") pintarAcabOF();
      else if(act==="pasoAcabPrenda") pintarAcabPrendas();
      else if(act==="pasoAcabOp"){ if(ACAB.of) pintarAcabOps(); else pintarAcabExtra(); }
      else if(act==="pasoAcabCant"){
        if(ACAB.op){ acabDetalle(); await cargarAcabHist(); }
        else { pintarAcabOF(); irA("pasoAcabOF"); }
      }
    }else{
      /* Costura: antes solo refrescaba mi día y los reclamos, así que una OF
         nueva, una operación nueva o un troceo deshecho no aparecían hasta
         recargar la app. Ahora se recarga TODO —almacén (si el área lo usa),
         derivados, residuales y reclamos— conservando dónde está el operario. */
      const area = AREA_ESTAJERO || s.area;
      const usaAlm = (AREAS[area] && AREAS[area].usaAlmacen !== false);
      const [alm, recl, dia, res, der, mp] = await Promise.all([
        usaAlm ? cargarAlmacen(area).catch(e=>({tickets:[],duplicados:[],_err:e.message}))
               : Promise.resolve({tickets:[],duplicados:[]}),
        rpc("fn_reclamados", {p_dni:s.dni, p_token:s.token, p_area:area}),
        rpc("fn_mi_dia", {p_dni:s.dni, p_token:s.token}),
        rpc("fn_residuales", {p_dni:s.dni, p_token:s.token, p_area:area}).catch(()=>[]),
        rpc("fn_tickets_area", {p_dni:s.dni, p_token:s.token, p_area:area}).catch(()=>[]),
        rpc("fn_mis_paquetes", {p_dni:s.dni, p_token:s.token, p_area:area}).catch(()=>[])
      ]);
      const prev = ALM;
      ALM = alm;
      if(Array.isArray(der) && der.length){
        const propias=new Set(der.map(t=>normKey(t.of)));
        ALM.tickets = ALM.tickets.filter(t=>!propias.has(normKey(t.of))).concat(der.map(mapDerivado));
      }
      if(alm._err && !ALM.tickets.length) ALM = prev || ALM;   // no perder lo que ya había
      if(Array.isArray(res) && res.length) ALM.tickets = ALM.tickets.concat(res.map(mapResidual));
      RECL = {}; recl.forEach(x=>{ RECL[x.codigo]={nombre:x.nombre,hora:x.hora}; });
      MISPAQ = Array.isArray(mp) ? mp : [];
      aplicarBotonMisPaq();
      setAvance(dia);
      // Repinta donde está, y si su selección desapareció lo devuelve atrás.
      if(act==="pasoTickets"){ if(sel.op) pintarTickets(); else volverAOF(); }
      else if(act==="pasoOps"){ if(sel.modulo) pintarOperaciones(); else volverAOF(); }
      else if(act==="pasoModulos"){ if(sel.of) pintarModulos(); else volverAOF(); }
      else if(act==="pasoMisPaq") pintarMisPaq();
      else if(act==="pasoOF") pintarSugerencias();
    }
  }catch(e){ mostrarError(e.message); }
  finally{ if(b) setTimeout(()=>b.classList.remove("girando"),500); }
}
const libre = t => !RECL[t.codigo];

/* Si al recargar desapareció la selección (OF terminada, ticket liberado),
   se devuelve al buscador de OF en vez de dejar una pantalla vacía. */
function volverAOF(){ sel.of=null; sel.modulo=null; sel.op=null; pintarSugerencias(); irA("pasoOF"); }

/* --- paso OF: buscador con sugerencias --- */
function pintarSugerencias(){
  const q = $("inputOF").value.replace(/\D/g,"");
  $("inputOF").value = q;
  const z = $("sugerenciasOF"); z.innerHTML="";
  if(!q){ return; }
  const ofs = {};
  ALM.tickets.forEach(t=>{
    if(t.of.includes(q)){
      if(!ofs[t.of]) ofs[t.of]={total:0,libres:0,art:norm(t.articulo)};
      if(!ofs[t.of].art) ofs[t.of].art=norm(t.articulo);
      ofs[t.of].total++; if(libre(t)) ofs[t.of].libres++;
    }
  });
  Object.keys(ofs).sort().slice(0,8).forEach(of=>{
    const d=document.createElement("div");
    d.className="sug";
    d.innerHTML=`<span>${ofs[of].art?esc(ofs[of].art)+" · ":""}OF ${esc(of)}</span><small>${ofs[of].libres} de ${ofs[of].total} libres</small>`;
    d.onclick=()=>{ sel.of=of; sel.modulo=null; sel.op=null; pintarModulos(); irA("pasoModulos"); };
    z.appendChild(d);
  });
  if(!Object.keys(ofs).length) z.innerHTML=`<div class="vacio-msg">Ninguna OF contiene "${esc(q)}"</div>`;
}

/* --- paso módulos --- */
function pintarModulos(){
  { const a=artDeOF(sel.of); $("tituloModulos").textContent = (a?a+" · ":"") + "OF " + sel.of; }
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
    if(!ops[t.op]) ops[t.op]={std:t.std,total:0,libres:0,cantLibre:0};
    ops[t.op].total++; if(libre(t)){ ops[t.op].libres++; ops[t.op].cantLibre+=(+t.cant||0); }
  });
  Object.keys(ops).sort().forEach(op=>{
    const o=ops[op];
    const c=document.createElement("div");
    c.className="card-fila";
    if(ES_ACABADO){
      c.innerHTML=`<div><div class="cf-titulo">${esc(op)}</div></div>
        <div class="badge-disp ${o.libres===0?'vacio':''}">${qty(o.cantLibre)} und libres</div>`;
    } else {
      c.innerHTML=`<div>
          <div class="cf-titulo">${esc(op)}</div>
          <div class="cf-detalle">STD <b>${o.std.toFixed(2)}</b> min</div>
        </div>
        <div class="badge-disp ${o.libres===0?'vacio':''}">${o.libres} de ${o.total} libres</div>`;
    }
    c.onclick=()=>{ sel.op=op; modoSel=false; marcados={}; pintarTickets(); irA("pasoTickets"); };
    l.appendChild(c);
  });
}

/* --- paso tickets (numeración protagonista + selección múltiple) --- */
let modoSel=false, marcados={};

function ticketsActuales(){
  return ALM.tickets.filter(t=>t.of===sel.of && t.modulo===sel.modulo && t.op===sel.op);
}
/* Módulo final = las dos últimas operaciones de la ruta de esa OF+artículo
   (las que el analista puede dividir). Ahí el sticker va como en Acabado. */
let NOPS_FIN={};
function esTicketFinal(t){
  if(t.residual) return true;
  if(t.nop==null) return false;
  const k=normKey(t.of)+"|"+normKey(t.articulo);
  if(!NOPS_FIN[k]){
    const ns=[...new Set(ALM.tickets.filter(x=>normKey(x.of)===normKey(t.of)
      && normKey(x.articulo)===normKey(t.articulo) && x.nop!=null).map(x=>Number(x.nop)))]
      .sort((a,b)=>b-a);
    NOPS_FIN[k]=ns.slice(0,2);
  }
  return NOPS_FIN[k].includes(Number(t.nop));
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
    const pph = t.std>0 ? Math.round(60/t.std) : "—";
    // En el módulo final la numeración ya está tapada por la costura: manda la
    // cantidad, con STD y color debajo. El nº de paquete no se muestra nunca.
    const fin = esTicketFinal(t);
    const cab = fin
      ? `<div class="tk-label">Cantidad</div>
         <div class="tk-numeracion">${qty(t.cant)} und</div>`
      : `<div class="tk-min">${t.minutos} min</div>
         <div class="tk-head">
           <div class="tk-col"><div class="tk-label">Numeración</div>
             <div class="tk-numeracion">${esc(t.num)}</div></div>
           <div class="tk-col tk-pph"><div class="tk-label tk-oro">PPH</div>
             <div class="tk-numeracion tk-oro">${pph}</div></div>
         </div>`;
    // Al dividir la última/penúltima operación el generador pone color "C" y
    // talla "T": son marcadores, no datos. Solo se muestran si son reales.
    const col = norm(t.color), tal = norm(t.talla);
    const fila = fin
      ? `<div>STD <b>${t.std.toFixed(2)}</b> min</div>
         ${tal && normKey(tal)!=="T" ? `<div>Talla <b>${esc(tal)}</b></div>` : ""}
         ${t.residual?`<div class="tk-cant">resto de ${esc(t.num)}</div>`:""}`
      : `<div>Talla <b>${esc(t.talla)}</b></div>
         <div class="tk-cant"><b>${t.cant}</b> und</div>
         <div>STD <b>${t.std.toFixed(2)}</b> min</div>
         <div>N°OP <b>${t.nop ?? "—"}</b></div>`;
    c.innerHTML=`
      ${cab}
      <div class="tk-fila">
        ${col && normKey(col)!=="C"
          ? `<div><span class="chip-color" style="background:${colorDe(col)}"></span>${esc(col)}</div>`
          : ""}
        ${fila}
      </div>
      ${r?`<div class="tk-tomado-por">Tomado por ${esc(soloApellidos(r.nombre))} · ${esc(r.hora)}</div>`:""}`;
    if(!r){
      c.onclick=()=>{
        if(modoSel){
          if(marcados[t.codigo]) delete marcados[t.codigo]; else marcados[t.codigo]=t;
          pintarTickets();
        } else {
          sel.ticket=t;
          if(ES_ACABADO){
            $("confNum").textContent=qty(t.cant)+" und";
            $("confDet").innerHTML=
              `${esc(sel.op)}<br>OF ${esc(t.of)} · ${esc(t.color)} · Talla ${esc(t.talla)}`;
          } else {
            $("confNum").textContent=t.num;
            $("confDet").innerHTML=
              `${esc(sel.op)}<br>OF ${esc(t.of)} · ${esc(t.color)} · Talla ${esc(t.talla)} · <b>${t.cant} und</b><br>`+
              `<span style="color:#5a6270">STD ${t.std.toFixed(2)} min · vale <b>${t.minutos} min</b></span>`;
          }
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
    const cantSel = Object.values(marcados).reduce((a,t)=>a+(+t.cant||0),0);
    const resumen = ES_ACABADO ? `${qty(cantSel)} und` : `${nSel} · ${Math.round(minSel*10)/10} min`;
    b.innerHTML = `
      <button class="btn-sel" onclick="marcarTodos()">MARCAR TODOS (${libres.length})</button>
      <button class="btn-sel primario" ${nSel?"":"disabled"} onclick="confirmarLote()">REGISTRAR ${resumen}</button>
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
  if(ES_ACABADO){
    const cant = lista.reduce((a,t)=>a+(+t.cant||0),0);
    $("confNum").textContent = qty(cant) + " und";
    $("confDet").innerHTML =
      `${esc(sel.op)} · OF ${esc(sel.of)}<br>`+
      `<span style="color:#5a6270">${lista.length} paquete(s)</span><br>`+
      `Total: <b>${qty(cant)} und</b> a tu nombre`;
  } else {
    const min = Math.round(lista.reduce((a,t)=>a+t.minutos,0)*10)/10;
    const nums = lista.slice(0,6).map(t=>t.num).join(", ") + (lista.length>6?"…":"");
    $("confNum").textContent = lista.length + " paquetes";
    $("confDet").innerHTML =
      `${esc(sel.op)} · OF ${esc(sel.of)}<br>`+
      `<span style="color:#5a6270">${esc(nums)}</span><br>`+
      `Total: <b>${min} min</b> a tu nombre`;
  }
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
    const cantLote = esLote ? Object.values(marcados).reduce((a,t)=>a+(+t.cant||0),0) : 0;
    if(ES_ACABADO) await refrescarMetasAcabado(); else setAvance(r);
    if(esLote){
      Object.values(marcados).forEach(t=>{ RECL[t.codigo]={nombre:s.nombre,hora:"ahora"}; });
      const conf = (r.conflictos||[]);
      $("exTitulo").textContent="¡Listo, "+s.nombre.split(" ")[0]+"!";
      $("exDetalle").innerHTML =
        `<b>${r.reclamados}</b> paquete(s) registrados${ES_ACABADO?` · <b>${qty(cantLote)} und</b>`:""} · ${esc(sel.op)}`+
        (conf.length?`<br><span style="opacity:.85">No se pudieron (ya tomados): ${esc(conf.join(", "))}</span>`:"");
      modoSel=false; marcados={};
      if(conf.length) await refrescarReclamos(s);
    } else {
      const t=sel.ticket;
      RECL[t.codigo]={nombre:s.nombre,hora:"ahora"};
      $("exTitulo").textContent="¡Listo, "+s.nombre.split(" ")[0]+"!";
      $("exDetalle").innerHTML=ES_ACABADO
        ? `${esc(sel.op)}<br>Cantidad <b>${qty(t.cant)} und</b>`
        : `${esc(sel.op)}<br>Numeración <b>${esc(t.num)}</b> · ${t.cant} und · +${t.minutos} min`;
    }
    $("exAvance").textContent = ES_ACABADO ? `Hoy: ${qty(CANT_HOY_ACABADO)} und` : `Tu día: ${r.eficiencia}%`;
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
  cargarRetornos();
}

/* Retornos de seguro/permiso pendientes de confirmar. Mientras no se confirmen,
   esa persona tiene descontado hasta el fin de jornada: confirmarlo le devuelve
   los minutos de después del regreso. Si no volvió, se marca y se queda igual. */
let RETORNOS=[];
async function cargarRetornos(){
  const s=sesionActual(), z=$("zonaRetornos"); if(!s||!z) return;
  try{
    const r=await rpc("fn_retornos_pendientes",{p_dni:s.dni,p_token:s.token,p_area:areaSup()});
    RETORNOS=Array.isArray(r)?r:[];
  }catch(e){ RETORNOS=[]; }
  if(!RETORNOS.length){ z.innerHTML=""; return; }
  z.innerHTML=`<div class="diff-box"><h3>Confirmar regreso (${RETORNOS.length})</h3>
    <div class="cf-detalle">Hasta confirmarlo se les descuenta como si no hubieran vuelto.</div></div>`
    + RETORNOS.map((x,i)=>`<div class="card-fila" style="cursor:default;">
      <div style="flex:1;">
        <div class="cf-titulo">${esc(soloApellidos(x.nombre))}</div>
        <div class="cf-detalle">${esc(x.tipo)} · salió ${esc(x.salida)} · descontados ${Math.abs(x.minutos)} min</div>
        <div class="mp-editor">
          <input type="time" id="rtH${i}" value="${esc(x.retorno)}">
          <button class="btn-mini verde" onclick="confirmarRetorno(${i},true)">Sí regresó</button>
          <button class="btn-mini rojo" onclick="confirmarRetorno(${i},false)">No regresó</button>
        </div>
        <div class="cf-detalle">Si confirmas las ${esc(x.retorno)}, el descuento baja a ${Math.abs(x.min_si_confirma)} min.</div>
      </div></div>`).join("");
}
async function confirmarRetorno(i, regreso){
  const x=RETORNOS[i]; if(!x) return;
  const s=sesionActual();
  const hora = regreso ? (($("rtH"+i)||{}).value||x.retorno) : null;
  if(regreso && !hora){ mostrarError("Indica la hora de regreso"); return; }
  if(!confirm(regreso
      ? `¿${soloApellidos(x.nombre)} regresó a las ${hora}?`
      : `¿${soloApellidos(x.nombre)} NO regresó a planta?\nSe le descuenta desde su salida hasta el fin de la jornada.`)) return;
  try{
    const r=await rpc("fn_retorno_confirmar",{p_dni:s.dni,p_token:s.token,p_id:x.id,p_retorno:hora});
    if(!r.ok){ mostrarError(r.error||"No se pudo confirmar"); return; }
    mostrarOk(`Confirmado · ${Math.abs(r.minutos)} min de descuento`);
    await recargarSupervisora(); cargarRetornos();
  }catch(e){ mostrarError(e.message); }
}
function pintarIncidencias(items, z, pref, fn){
  if(!items.length){ z.innerHTML=`<div class="vacio-msg">Sin incidencias pendientes</div>`; return; }
  z.innerHTML="";
  items.forEach(it=>{
    const d=document.createElement("div");
    d.className="card-fila"; d.style.cursor="default"; d.style.flexWrap="wrap";
    const tipoTxt = it.tipo ? String(it.tipo).replace(/_/g," ") : "";
    d.innerHTML=`
      <div style="flex:1;min-width:220px;">
        <div class="cf-titulo">${esc(it.nombre)}${tipoTxt?` · <span style="font-weight:700;color:var(--azul);">${esc(tipoTxt)}</span>`:""}</div>
        <div class="cf-detalle">${esc(it.motivo)}</div>
        <div class="cf-detalle">${esc(it.area)} · ${esc(it.fecha)} ${esc(it.hora)}${it.solicitante?` · Solicitó: ${esc(it.solicitante)}`:""}</div>
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
  { const ta=$("tabAsistencia"); if(ta) ta.onclick = ()=>{ pararAvance(); marcarTab("tabAsistencia"); irA("pasoAsistencia"); asisInit(); }; }
  { const af=$("asisFecha"); if(af) af.onchange = asisInit; }
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
    const acabado = areaSup()==="ACABADO";
    const nCols = 3;
    const filas = ops.length
      ? ops.map(o=>{
          const cant=+o.cantidad||0;
          return `<tr><td>${esc(o.of)}</td><td class="izq">${esc(o.op)}</td>
            <td><b>${Math.round(cant)}</b></td></tr>`;
        }).join("")
      : `<tr><td colspan="${nCols}"><div class="vacio-msg">Sin operaciones ese día</div></td></tr>`;
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
  // INGENIERIA puede entrar aquí desde "Operar como → Supervisora": reutiliza esta
  // pantalla en vez del panel embebido, que se quedaba desactualizado.
  const desdeIng = (()=>{ try{ return !!sessionStorage.getItem("stx_volver_ing"); }catch(e){ return false; } })();
  if(s.cargo!=="SUPERVISORA" && !(s.cargo==="INGENIERIA" && desdeIng)){
    location.href = destinoPorCargo(s.cargo); return; }
  SUP_AREA_OVERRIDE=null;
  $("tituloArea").textContent = s.area + " · Supervisión";
  $("quienBadge").textContent = s.nombre; $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  botonVolverIng();
  { const kb=$("btnLlave"); if(kb) kb.onclick=abrirCambioPin; }
  { const rc=$("btnRecargar"); if(rc) rc.onclick=()=>{ recargarSupervisora(); }; }
  bindSupervisoraUI();
  cargarPersonal(s);
  marcarTab("tabAsistencia"); irA("pasoAsistencia"); asisInit();   // vista principal
  window.VOLVER_MAP = {
    pasoAlcance:"pasoPersonal", pasoSeleccion:"pasoAlcance",
    pasoTipo:"pasoPersonal", pasoMinutos:"pasoTipo",
    pasoMoverSel:"pasoPersonal", pasoMoverArea:"pasoMoverSel"
  };
  window.onSalirApp = confirmarSalir;   // mismo resguardo que el operario
  initBackTrap();
}
/* Recargar según la pestaña activa (botón ↻ del header). */
function recargarSupervisora(){
  const s=sesionActual(); if(!s) return;
  const rc=$("btnRecargar"); if(rc){ rc.classList.add("girando"); setTimeout(()=>rc.classList.remove("girando"),500); }
  if($("pasoAsistencia") && $("pasoAsistencia").classList.contains("activa")) asisInit();
  else if($("pasoAvance").classList.contains("activa")) cargarAvance();
  else if($("pasoIncidencias").classList.contains("activa")) cargarIncidencias();
  else if($("pasoEfPersonal") && $("pasoEfPersonal").classList.contains("activa")) cargarEfPersonal();
  else cargarPersonal(s);
}

/* --- Estados de asistencia (para el swipe de la vista Asistencia) --- */
let ESTADOS_SUP = [];
async function cargarEstadosSup(){
  const s=sesionActual(); if(!s) return;
  try{ ESTADOS_SUP = await rpc("fn_estados_asistencia_listar",{p_dni:s.dni,p_token:s.token}); }
  catch(e){ ESTADOS_SUP = ["ACTIVO","FALTA","DM","VACACIONES"]; }
}

/* ============================================================
   MOTOR DE ASISTENCIA POR TARJETAS DESLIZABLES (compartido)
   Usado por Ingeniería (ingenieria.js) y Supervisora (esta vista).
   ▶ ACTIVO · ◀ FALTA · ▼ OTRO estado · ▲ confirmar estado actual.
   Al terminar: cuadro resumen (ACTIVO = solo cantidad; faltas/otros =
   lista editable) antes de guardar.
   cfg = {stackId, progId, saveBtnId, resumenId, ayudaId,
          estados():[...], listar(fecha):Promise, guardar(marcas,fecha):Promise, onSaved()}
   ============================================================ */
const ASW = {cfg:null, list:[], idx:0, dec:{}, cur:{}, fecha:null};
function aswHoy(){ return new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"}); }
async function aswStart(cfg, fecha){
  ASW.cfg=cfg; ASW.dec={}; ASW.idx=0; ASW.cur={}; ASW.fecha=fecha||aswHoy();
  const st=$(cfg.stackId); if(!st) return;
  st.innerHTML=cargandoHTML("Cargando personal…");
  if($(cfg.resumenId)){ $(cfg.resumenId).hidden=true; $(cfg.resumenId).innerHTML=""; }
  try{
    const r=await cfg.listar(ASW.fecha);
    if(r&&r.ok===false){ mostrarError(r.error||"Error"); st.innerHTML=""; return; }
    ASW.list=(r&&r.personal)||(Array.isArray(r)?r:[]);
    ASW.list.forEach(p=>{ if(p.estado) ASW.cur[p.dni]=p.estado; });
    aswRender();
  }catch(e){ st.innerHTML=""; mostrarError(e.message); }
}
function aswRender(){
  const cfg=ASW.cfg, st=$(cfg.stackId); st.innerHTML="";
  aswProg();
  if($(cfg.resumenId)) $(cfg.resumenId).hidden=true;
  if(cfg.ayudaId&&$(cfg.ayudaId)) $(cfg.ayudaId).style.display="";
  const pend=ASW.list.slice(ASW.idx);
  if(!pend.length){ aswResumen(); return; }
  pend.slice(0,3).reverse().forEach((p,i,arr)=>{
    const top=i===arr.length-1;
    const card=document.createElement("div");
    card.className="swipe-card"+(top?" top":"");
    const act=ASW.cur[p.dni]?`<span class="pill ${esc(ASW.cur[p.dni])}">${esc(ASW.cur[p.dni])}</span>`:"—";
    card.innerHTML=`<div class="sc-nombre">${esc(p.nombre)}</div><div class="sc-dni">DNI ${esc(p.dni)}</div>
      <div class="sc-actual">Hoy: ${act}</div>
      <div class="sc-hint"><span class="sc-l">◀ FALTA</span><span class="sc-d">▼ OTRO</span><span class="sc-r">ACTIVO ▶</span></div>`;
    if(top) aswBind(card,p);
    st.appendChild(card);
  });
}
function aswProg(){
  const cfg=ASW.cfg, done=Object.keys(ASW.dec).length, tot=ASW.list.length;
  if($(cfg.progId)) $(cfg.progId).textContent=`${done}/${tot}`;
  const g=$(cfg.saveBtnId); if(g){ g.disabled=done===0; g.textContent=`Revisar (${done})`; }
}
function aswBind(card,p){
  let sx=0,sy=0,dx=0,dy=0,drag=false; const TH=90;
  card.style.touchAction="none";
  card.addEventListener("pointerdown",e=>{ drag=true; sx=e.clientX; sy=e.clientY; if(card.setPointerCapture) card.setPointerCapture(e.pointerId); });
  card.addEventListener("pointermove",e=>{ if(!drag) return; dx=e.clientX-sx; dy=e.clientY-sy;
    card.style.transform=`translate(${dx}px,${dy}px) rotate(${dx/22}deg)`;
    const v=Math.abs(dx)<TH/2;
    card.classList.toggle("hint-r",dx>TH/2); card.classList.toggle("hint-l",dx<-TH/2);
    card.classList.toggle("hint-d",dy>TH/2&&v); card.classList.toggle("hint-u",dy<-TH/2&&v); });
  const end=()=>{ if(!drag) return; drag=false; const v=Math.abs(dx)<TH;
    if(dy<-TH&&v){ aswSnap(card); aswArriba(p); return; }        // ▲ estado actual + confirmar
    if(dy>TH&&v){ aswSnap(card); aswOtro(p); return; }            // ▼ otro estado
    if(dx>TH){ aswFly(card,1); aswDecidir(p.dni,"ACTIVO"); return; }
    if(dx<-TH){ aswFly(card,-1); aswDecidir(p.dni,"FALTA"); return; }
    aswSnap(card); };
  card.addEventListener("pointerup",end); card.addEventListener("pointercancel",end);
}
function aswSnap(card){ card.classList.remove("hint-r","hint-l","hint-d","hint-u"); card.style.transition="transform .15s"; card.style.transform=""; setTimeout(()=>card.style.transition="",160); }
function aswFly(card,dir){ card.style.transition="transform .2s"; card.style.transform=`translate(${dir*600}px,-30px) rotate(${dir*18}deg)`; }
function aswDecidir(dni,estado){ ASW.dec[dni]=estado; ASW.idx++; aswRender(); }
function aswArriba(p){
  const act=ASW.cur[p.dni]||"ACTIVO";
  abrirModal(`<h2>${esc(p.nombre)}</h2>
    <div class="sub" style="margin-bottom:12px;">Estado actual del día: <span class="pill ${esc(act)}">${esc(act)}</span></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="aswArribaOk('${esc(p.dni)}')">CONFIRMAR ${esc(act)}</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
}
function aswArribaOk(dni){ const act=ASW.cur[dni]||"ACTIVO"; cerrarModal(); aswDecidir(dni,act); }
function aswOtro(p){
  const opts=(ASW.cfg.estados()||[]).filter(e=>e!=="ACTIVO"&&e!=="FALTA").map(e=>`<option>${esc(e)}</option>`).join("")||'<option value="">Sin estados</option>';
  abrirModal(`<h2>${esc(p.nombre)}</h2>
    <div class="modal-campo"><label>Estado</label><select id="aswEst">${opts}</select></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="aswOtroOk('${esc(p.dni)}')">APLICAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
}
function aswOtroOk(dni){ const est=$("aswEst").value; if(!est) return; cerrarModal(); aswDecidir(dni,est); }
function aswVerResumen(){ if(!Object.keys(ASW.dec).length){ mostrarError("Marca al menos una persona"); return; } aswResumen(); }
function aswResumen(){
  const cfg=ASW.cfg, dec=ASW.dec, box=$(cfg.resumenId); if(!box) return;
  const dnis=Object.keys(dec), otros=dnis.filter(d=>dec[d]!=="ACTIVO"), activos=dnis.length-otros.length;
  const nom=d=>{ const p=ASW.list.find(x=>x.dni===d); return p?p.nombre:d; };
  box.hidden=false;
  box.innerHTML=`<div class="asis-res">
      <div class="asis-res-cab">Resumen · ${ASW.fecha}</div>
      <div class="asis-res-activo">✓ ACTIVOS: <b>${activos}</b></div>
      <div class="tk-ops-title" style="margin-top:10px;">Faltas / otros estados (${otros.length})</div>
      ${otros.length? `<div class="asis-res-lista">`+otros.map(d=>`<div class="asis-res-fila" onclick="aswEditar('${esc(d)}')">
          <span>${esc(nom(d))}</span><span class="pill ${esc(dec[d])}">${esc(dec[d])}</span></div>`).join("")+`</div>`
        : `<div class="vacio-msg">Sin faltas ni otros estados</div>`}
      <div class="asis-res-acc">
        <button class="btn-mini gris" onclick="aswReiniciar()">← Volver a marcar</button>
        <button class="btn-mini verde" onclick="aswGuardar()">GUARDAR (${dnis.length})</button>
      </div>
    </div>`;
  $(cfg.stackId).innerHTML=`<div class="vacio-msg">✓ Personal marcado. Revisa el resumen y guarda. Toca una fila para editar.</div>`;
  if(cfg.ayudaId&&$(cfg.ayudaId)) $(cfg.ayudaId).style.display="none";
}
function aswEditar(dni){
  const cfg=ASW.cfg, cur=ASW.dec[dni]||ASW.cur[dni]||"ACTIVO";
  const opts=(cfg.estados()||[]).map(e=>`<option ${e===cur?"selected":""}>${esc(e)}</option>`).join("")||'<option value="">Sin estados</option>';
  const p=ASW.list.find(x=>x.dni===dni);
  abrirModal(`<h2>${esc(p?p.nombre:dni)}</h2>
    <div class="modal-campo"><label>Estado</label><select id="aswEd">${opts}</select></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="aswEditarOk('${esc(dni)}')">APLICAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
}
function aswEditarOk(dni){ const est=$("aswEd").value; if(!est) return; ASW.dec[dni]=est; cerrarModal(); aswResumen(); }
function aswReiniciar(){ ASW.dec={}; ASW.idx=0; aswRender(); }
async function aswGuardar(){
  const cfg=ASW.cfg, dec=ASW.dec, dnis=Object.keys(dec);
  if(!dnis.length){ mostrarError("No hay personal marcado"); return; }
  if(!confirm(`¿Guardar la asistencia del ${ASW.fecha} de ${dnis.length} persona(s)?`)) return;
  const marcas=dnis.map(d=>({dni:d,estado:dec[d]}));
  try{
    const r=await cfg.guardar(marcas,ASW.fecha);
    if(r&&r.ok===false){ mostrarError(r.error||"No se pudo guardar"); return; }
    mostrarOk(`Asistencia guardada (${(r&&r.afectados)||dnis.length}) para ${ASW.fecha}.`);
    if(cfg.onSaved) cfg.onSaved();
  }catch(e){ mostrarError(e.message); }
}

/* --- Supervisora · Asistencia (lista + buscador; marca solo excepciones) --- */
let ASIS={list:[],dec:{},fecha:null};
function asisInit(){
  const s=sesionActual(); if(!s) return;
  const f=$("asisFecha"); if(f && !f.value) f.value=aswHoy();
  ASIS={list:[],dec:{},fecha:(f&&f.value)||aswHoy()};
  const g=$("asisLista"); if(g) g.innerHTML=cargandoHTML("Cargando personal…");
  rpc("fn_asistencia_marcar_lista",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),p_fecha:ASIS.fecha})
    .then(r=>{
      if(r&&r.ok===false){ mostrarError(r.error||"Error"); if(g) g.innerHTML=""; return; }
      ASIS.list=(r&&r.personal)||[];
      ASIS.list.forEach(p=>{ if(p.estado && p.estado!=="ACTIVO") ASIS.dec[p.dni]=p.estado; });
      asisPintar();
    })
    .catch(e=>{ if(g) g.innerHTML=""; mostrarError(e.message); });
}
function asisPintar(){
  const g=$("asisLista"); if(!g) return;
  const q=normKey($("asisBuscar")?$("asisBuscar").value:"");
  const lista=ASIS.list.filter(p=>!q||normKey(p.nombre+" "+p.dni).includes(q));
  const marc=Object.keys(ASIS.dec).length;
  if($("asisProg")) $("asisProg").textContent=`${ASIS.list.length-marc} activo(s) · ${marc} con estado`;
  if(!lista.length){ g.innerHTML=`<div class="vacio-msg">Sin personal</div>`; return; }
  g.innerHTML=lista.map(p=>{
    const est=ASIS.dec[p.dni]||"ACTIVO", m=est!=="ACTIVO";
    return `<div class="asis-fila${m?" marcada":""}" onclick="asisElegir('${esc(p.dni)}')">
      <div class="asis-nom">${esc(p.nombre)}<div class="asis-dni">DNI ${esc(p.dni)}</div></div>
      <span class="pill ${esc(est)}">${esc(est)}</span></div>`;
  }).join("");
}
function asisElegir(dni){
  const p=ASIS.list.find(x=>x.dni===dni); if(!p) return;
  const cur=ASIS.dec[dni]||"ACTIVO";
  const ests=["ACTIVO",...(ESTADOS_SUP||[]).filter(e=>e!=="ACTIVO")];
  const chips=ests.map(e=>`<button class="asis-chip ${e===cur?"sel":""}" onclick="asisSet('${esc(dni)}','${esc(e)}')">${esc(e)}</button>`).join("");
  abrirModal(`<h2>${esc(p.nombre)}</h2>
    <div class="sub" style="margin-bottom:10px;">Estado del ${ASIS.fecha}</div>
    <div class="asis-chips">${chips}</div>
    <div class="modal-acciones"><button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CERRAR</button></div>`);
}
function asisSet(dni,est){
  if(est==="ACTIVO") delete ASIS.dec[dni]; else ASIS.dec[dni]=est;
  cerrarModal(); asisPintar();
}
async function asisGuardar(){
  const s=sesionActual(); if(!s) return;
  if(!ASIS.list.length){ mostrarError("Sin personal"); return; }
  const marcas=ASIS.list.map(p=>({dni:p.dni,estado:ASIS.dec[p.dni]||"ACTIVO"}));
  const faltas=Object.keys(ASIS.dec).length;
  if(!confirm(`Guardar asistencia del ${ASIS.fecha}: ${marcas.length-faltas} activo(s) y ${faltas} con otro estado. ¿Continuar?`)) return;
  try{
    const r=await rpc("fn_asistencia_marcar_guardar",{p_dni:s.dni,p_token:s.token,p_fecha:ASIS.fecha,p_marcas:marcas});
    if(r&&r.ok===false){ mostrarError(r.error||"No se pudo guardar"); return; }
    mostrarOk(`Asistencia guardada (${(r&&r.afectados)||marcas.length}) para ${ASIS.fecha}.`);
    asisInit();
  }catch(e){ mostrarError(e.message); }
}
function marcarTab(id){
  ["tabAsistencia","tabPersonal","tabAvance","tabIncidencias","tabEfPersonal"].forEach(t=>{ const el=$(t); if(el) el.classList.toggle("activo", t===id); });
}
function pararAvance(){ clearInterval(timerAvance); timerAvance=null; }

async function cargarAvance(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  try{
    const nivel = $("avNivel") ? $("avNivel").value : "ultima";
    const modulo = $("avModulo") ? $("avModulo").value : "";
    const r = await rpc("fn_avance_area",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),p_nivel:nivel,p_modulo:modulo});
    if(!r.ok){ mostrarError(r.error||"Error"); return; }
    // Poblar el selector de módulos preservando la selección.
    const selMod=$("avModulo");
    if(selMod){
      const actual=selMod.value; const mods=r.modulos||[];
      selMod.innerHTML=`<option value="">Todos los módulos</option>`+mods.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
      selMod.value = mods.includes(actual)?actual:"";
    }
    const nivelTxt = (r.nivel==="penultima") ? "penúltima" : "última";
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
      l.insertAdjacentHTML("beforeend",`<div class="vacio-msg">Aún no hay avance en la ${nivelTxt} operación${modulo?` del módulo ${esc(modulo)}`:""} hoy</div>`);
    }
    r.items.forEach(it=>{
      l.insertAdjacentHTML("beforeend", `
        <div class="card-fila" style="cursor:default;">
          <div>
            <div class="cf-titulo">${esc(it.articulo)} · OF ${esc(it.of)}</div>
            <div class="cf-detalle">${it.modulo?`Módulo ${esc(it.modulo)} · `:""}Prenda completa: ${it.t_total} min</div>
          </div>
          <div style="text-align:right;">
            <div class="cf-titulo" style="color:var(--azul);">${it.unidades} und</div>
            <div class="cf-detalle">${Math.round(it.minutos)} min</div>
          </div>
        </div>`);
    });
    $("avHora").textContent = `Avance por ${nivelTxt} operación · actualizado ` + new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
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
/* Los minutos disponibles solo tienen sentido si la persona está en planta.
   Si su estado del día es otro (FALTA, DM, VACACIONES, LICENCIA…), se muestra
   el estado en su lugar: enseñar "575 min" de alguien que faltó confunde. */
function dispPersona(p){
  const e=norm(p.estado_dia||"");
  if(p.ausente || (e && e!=="ACTIVO")) return `<span class="pill ${esc(e||"FALTA")}">${esc(e||"—")}</span>`;
  return `${p.disp} min`;
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
      <div class="cp-disp">${dispPersona(p)}</div>`;
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
const TIPOS_MOTIVO = ["OTROS"];              // los únicos que aún piden texto libre
const TIPOS_SALIDA = ["SEGURO","PERMISO"];   // se registran por hora de salida/retorno
function elegirTipo(tipo){
  oc.tipo=tipo; oc.minutos=0;
  $("zonaMotivo").style.display = TIPOS_MOTIVO.includes(tipo) ? "block" : "none";
  if($("inputMotivo")) $("inputMotivo").value="";
  const esSalida = TIPOS_SALIDA.includes(tipo);
  $("zonaSalida").style.display  = esSalida ? "block" : "none";
  $("zonaTardanza").style.display = tipo==="TARDANZA" ? "block" : "none";

  if(esSalida){
    // Sin minutos: se deducen de la hora de salida y la de retorno.
    $("tituloMin").textContent = tipo==="SEGURO" ? "Salida al seguro" : "Permiso";
    $("subMin").textContent = "Indica desde qué hora salió y si vuelve a planta";
    $("zonaStepper").style.display="none"; $("zonaMinutos").style.display="none";
    ["ocSalida","ocRetorno"].forEach(id=>{ if($(id)) $(id).value=""; });
    if($("ocNoRetorna")) $("ocNoRetorna").checked=false;
    ocCalcSalida();
    irA("pasoMinutos"); return;
  }
  if(tipo==="TARDANZA"){
    // Siempre 1 hora y sin motivo: la pantalla solo confirma.
    oc.minutos=-60;
    $("tituloMin").textContent="Tardanza";
    $("subMin").textContent="Confirma que esta persona llegó tarde";
    $("zonaStepper").style.display="none"; $("zonaMinutos").style.display="none";
    irA("pasoMinutos"); return;
  }
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
/* Minutos de una salida. Sin retorno confirmado se descuenta hasta el fin de
   jornada (18:20): lo conservador. Al confirmar el regreso se devuelven los
   minutos posteriores, así una hora de retorno optimista nunca regala tiempo. */
const FIN_JORNADA="18:20", INI_JORNADA="08:00";
const hm=t=>{ const m=/^(\d{1,2}):(\d{2})$/.exec(String(t||"")); return m?(+m[1])*60+(+m[2]):null; };
function minSalida(salida, retorno){
  const s=hm(salida), f=hm(FIN_JORNADA), i=hm(INI_JORNADA);
  if(s==null) return 0;
  const desde=Math.min(Math.max(s,i),f), hasta=retorno!=null?Math.min(hm(retorno),f):f;
  return Math.max(0, Math.round(hasta-desde));
}
function ocCalcSalida(){
  const noRet=$("ocNoRetorna") && $("ocNoRetorna").checked;
  const ret=$("ocRetorno");
  if(ret){ ret.disabled=!!noRet; if(noRet) ret.value=""; }
  const s=$("ocSalida")?$("ocSalida").value:"", r=(!noRet && ret)?ret.value:"";
  const z=$("ocSalidaCalc"); if(!z) return;
  if(!s){ z.innerHTML="Indica la hora de salida."; return; }
  if(r && hm(r)<=hm(s)){ z.innerHTML=`<b style="color:var(--alerta)">El retorno debe ser posterior a la salida.</b>`; return; }
  const sinVolver=minSalida(s,null);
  z.innerHTML = (noRet || !r)
    ? `No vuelve a planta: se descuentan <b>${sinVolver} min</b> (de ${s} a ${FIN_JORNADA}).`
    : `Se descuentan <b>${sinVolver} min</b> hasta confirmar el regreso.<br>`
      + `Si se confirma que volvió a las ${r}, quedan <b>${minSalida(s,r)} min</b> de descuento.`;
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

/* SEGURO / PERMISO: se guarda la hora de salida y la de retorno. Mientras el
   regreso no se confirme cuenta como si no hubiera vuelto. */
async function confirmarSalida(s){
  const salida=$("ocSalida").value;
  const noRet=$("ocNoRetorna").checked;
  const retorno=noRet?null:($("ocRetorno").value||null);
  if(!salida){ mostrarError("Indica la hora de salida"); return; }
  if(!noRet && !retorno){ mostrarError("Indica la hora de retorno o marca «No retorna»"); return; }
  if(retorno && hm(retorno)<=hm(salida)){ mostrarError("El retorno debe ser posterior a la salida"); return; }
  const btn=$("btnGuardarOc"); btn.disabled=true; btn.textContent="GUARDANDO…";
  try{
    const r=await rpc("fn_ocurrencia_salida",{p_dni:s.dni,p_token:s.token,p_dnis:oc.dnis,
      p_area:s.area,p_tipo:oc.tipo,p_salida:salida,p_retorno:retorno});
    if(!r.ok){ mostrarError(r.error||"No se pudo registrar"); return; }
    mostrarOk(r.pendiente_confirmar
      ? `Registrado · ${Math.abs(r.minutos)} min. Confirma el regreso cuando vuelva.`
      : `Registrado · ${Math.abs(r.minutos)} min descontados`);
    await recargarSupervisora();
    irA("pasoPersonal");
  }catch(e){ mostrarError(e.message); }
  finally{ btn.disabled=false; btn.textContent="GUARDAR"; }
}

/* --- confirmar ocurrencia --- */
async function confirmarOcurrencia(){
  const s=sesionActual(); if(!s){location.href="index.html";return;}

  // SEGURO / PERMISO: van por su propia RPC, con horas en vez de minutos.
  if(TIPOS_SALIDA.includes(oc.tipo)) return confirmarSalida(s);

  let minutos;
  if(oc.tipo==="TARDANZA") minutos = -60;                 // siempre 1 hora
  else if(oc.tipo==="HORA_EXTRA") minutos = oc.horas*60;
  else {
    const v=parseInt($("inputMinutos").value,10);
    if(!v || v<=0){ mostrarError("Ingresa los minutos"); return; }
    minutos = v * oc.signo;
  }
  const motivo = ($("inputMotivo") ? $("inputMotivo").value.trim().toUpperCase() : "");
  if(TIPOS_MOTIVO.includes(oc.tipo) && !motivo){ mostrarError("Indica el motivo"); return; }
  // La supervisora YA NO registra minutos directamente: crea una solicitud que
  // aprueba únicamente Ingeniería. Ingeniería (operar como) sigue registrando directo.
  const esSupervisora = s.cargo === "SUPERVISORA";
  const btn=$("btnGuardarOc"); btn.disabled=true; btn.textContent=esSupervisora?"ENVIANDO…":"GUARDANDO…";
  try{
    const r = esSupervisora
      ? await rpc("fn_solicitud_ocurrencia_crear",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),
          p_tipo:oc.tipo,p_minutos:minutos,p_detalle:motivo,p_dnis:oc.dnis})
      : await rpc("fn_ocurrencia",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),
          p_tipo:oc.tipo,p_minutos:minutos,p_detalle:(motivo||oc.tipo),p_dnis:oc.dnis});
    btn.disabled=false; btn.textContent="GUARDAR";
    if(!r.ok){ mostrarError(r.error||"No se pudo guardar"); return; }
    const afectados = esSupervisora ? r.solicitadas : r.afectados;
    $("exTitulo").textContent = esSupervisora ? "Solicitud enviada" : "Registrado";
    $("exDetalle").innerHTML = esSupervisora
      ? `${oc.tipo.replace("_"," ")} · <b>${minutos>0?"+":""}${minutos} min</b> · ${afectados} persona(s)<br><small>Pendiente de aprobación de Ingeniería</small>`
      : `${oc.tipo.replace("_"," ")} · <b>${minutos>0?"+":""}${minutos} min</b> · ${afectados} persona(s)`;
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
  irA("pasoTipo");   // primero elegir el tipo (incidencias predefinidas), luego minutos
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
      <div class="cp-disp">${dispPersona(p)}</div>`;
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