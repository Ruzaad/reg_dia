/* ============================================================
   SAMITEX — Vista de Ingeniería (requiere app.js cargado antes)
   ============================================================ */
let ING=null;
let AREAS_LISTA = Object.keys(AREAS);       // se reemplaza con fn_areas_listar al iniciar
const CARGOS_LISTA = ["OPERARIO","SUPERVISORA","ESTAJERO"];
const ESTADOS_OPERARIO = ["ACTIVO","INACTIVO"];
const CATEGORIAS_LISTA = ["","A","B","C","D"];   // "" = sin asignar (parche 34)
let ESTADOS_ASIS = [];
let EF_CENS_ING = false;                     // censura de eficiencia (****) en toda la pestaña
function hoyISO(){ return new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"}); }

document.addEventListener("DOMContentLoaded", async ()=>{
  if(document.body.dataset.pagina!=="ingenieria") return;
  ING = sesionActual();
  if(!ING){ location.href="index.html"; return; }
  if(ING.cargo!=="INGENIERIA"){ location.href = destinoPorCargo(ING.cargo); return; }
  $("quienBadge").textContent = ING.nombre; $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  { const kb=$("btnLlave"); if(kb) kb.onclick=abrirCambioPin; }
  { const rc=$("btnRecargar"); if(rc) rc.onclick=recargarIngenieria; }

  // Navegación por SIDEBAR. Los ítems son enlaces reales (#pasoXxx) para permitir
  // abrir en nueva pestaña con clic central o Ctrl/⌘+clic; el clic normal navega
  // en la misma página (SPA) y actualiza el hash.
  document.querySelectorAll(".nav-item[data-tab]").forEach(a=>{
    a.addEventListener("click",(e)=>{
      if(e.ctrlKey||e.metaKey||e.shiftKey||e.button===1) return; // deja que el navegador abra nueva pestaña
      e.preventDefault();
      activarTab(a.dataset.tab);
      cerrarSidebarMovil();
    });
  });
  // Botón hamburguesa: colapsa el sidebar (PC) o abre/cierra el cajón (móvil).
  { const bm=$("btnMenu"); if(bm) bm.onclick=toggleSidebar; }
  { const bd=$("ingBackdrop"); if(bd) bd.onclick=()=>document.body.classList.add("sidebar-cerrada"); }
  // En pantallas chicas el sidebar arranca cerrado (cajón).
  if(window.innerWidth<=900) document.body.classList.add("sidebar-cerrada");
  // Dinámico: al cruzar el breakpoint (redimensionar/rotar) ajusta el sidebar.
  let _wasNarrow = window.innerWidth<=900;
  window.addEventListener("resize", ()=>{
    const narrow = window.innerWidth<=900;
    if(narrow!==_wasNarrow){ _wasNarrow=narrow; document.body.classList.toggle("sidebar-cerrada", narrow); }
  });
  // Deep-link / nueva pestaña: si la URL trae #pasoXxx válido, abre esa sección.
  window.addEventListener("hashchange",()=>{
    const t=(location.hash||"").replace(/^#/,"");
    if(NAV_TABS.includes(t)) activarTab(t);
  });

  ["fechaEf","fechaTk","fechaMod"].forEach(id=>{ const el=$(id); if(el) el.value = hoyISO(); });

  // Áreas desde la base de datos (incluye CORTE, REPROCESOS, etc.)
  await hidratarAreas();                 // config de Sheets desde areas_config
  AREAS_LISTA = await cargarAreasDB();
  poblarSelectsArea();
  pintarSupAreas();

  $("filtroAreaEf").addEventListener("change", ()=>{ if(EF) pintarEf(); else cargarEf(); });
  $("filtroNomEfR").addEventListener("input", ()=>{ if(EFR.personal.length) pintarEfRango(); });
  flatpickr("#rangoEf", {mode:"range", dateFormat:"Y-m-d", locale:{rangeSeparator:" a "},
    onChange:(dates)=>{
      // Permite elegir solo la fecha de inicio: el fin toma HOY por defecto.
      if(dates.length>=1){
        efRangoSel.desde = dates[0].toLocaleDateString("sv-SE");
        efRangoSel.hasta = (dates[1] ? dates[1] : new Date()).toLocaleDateString("sv-SE");
      }
    }});
  $("filtroTk").addEventListener("input", ()=>{ tkPag=1; pintarTk(); });
  cargarEstadosAsis();
  // Landing: sección del hash si es válida; si no, Tickets · Actual.
  const hashTab=(location.hash||"").replace(/^#/,"");
  activarTab(NAV_TABS.includes(hashTab) ? hashTab : "pasoTk");
});

/* Comparador único de las tablas ordenables.
   Antes cada tabla hacía parseFloat(v): "2026-08-10" daba 2026, así que todas
   las fechas del mismo año empataban y no ordenaban; "18:43" daba 18 y por eso
   las horas sí funcionaban. Ahora solo se compara como número si TODO el valor
   lo es; el resto va por texto, y los formatos ISO (YYYY-MM-DD [HH:MM]) ordenan
   bien lexicográficamente. Los vacíos siempre al final. */
const esNum = v => v!=null && v!=="" &&
  (typeof v==="number" || /^-?\d+([.,]\d+)?$/.test(String(v).trim()));
function cmpVal(va, vb){
  if(esNum(va) && esNum(vb))
    return Number(String(va).replace(",",".")) - Number(String(vb).replace(",","."));
  const a = va==null?"":String(va).trim(), b = vb==null?"":String(vb).trim();
  if(!a && b) return 1;
  if(!b && a) return -1;
  return a.localeCompare(b, "es", {numeric:true, sensitivity:"base"});
}

// Lista de secciones navegables (para validar hash y deep-links).
const NAV_TABS=["pasoTk","pasoMod","pasoOpsOF","pasoEf","pasoDia","pasoModEf","pasoBases",
  "pasoAsis","pasoIncid","pasoFechas","pasoGen","pasoSupArea","pasoOpArea","pasoDash","pasoAvOF","pasoOfs","pasoExtra"];
/* Pestañas ya visitadas: al reentrar NO se reinicializan, solo se muestran.
   Evita que volver a una pestaña borre los filtros que el usuario ya puso. */
const TABS_VISTAS=new Set();

/* Activa una sección del sidebar (misma lógica que el clic, reutilizable por
   el ruteo por hash). Actualiza el hash sin recargar. */
function activarTab(tab){
  document.querySelectorAll(".nav-item[data-tab]").forEach(x=>x.classList.toggle("activo", x.dataset.tab===tab));
  { const it=document.querySelector('.nav-item[data-tab="'+tab+'"]'); const d=it&&it.closest("details.nav-group"); if(d) d.open=true; }
  pararAvance();
  { const st=$("supTabs"); if(st) st.style.display="none"; }
  try{ history.replaceState(null,"","#"+tab); }catch(e){}
  if(tab==='pasoSupArea'){ ingSupVolverAreas(); return; }
  irA(tab);
  if(TABS_VISTAS.has(tab)) return;      // reentrada: conserva filtros y datos
  TABS_VISTAS.add(tab);
  if(tab==='pasoIncid') cargarIncidI();
  else if(tab==='pasoTk') cargarTk();
  else if(tab==='pasoMod') cargarMod();
  else if(tab==='pasoOpsOF') opfInit();
  else if(tab==='pasoAsis') perInit();
  else if(tab==='pasoModEf'){ const f=$("fechaModEf"); if(f&&!f.value) f.value=hoyLima(); if($("areaModEf")&&$("areaModEf").value) cargarModEf(); }
  else if(tab==='pasoOpArea') cargarOpArea();
  else if(tab==='pasoFechas') initFechas();
  else if(tab==='pasoGen') genInit();
  else if(tab==='pasoDash'){ dbEnsureFp(); dashTab(DASH_TAB||'asis'); }
  else if(tab==='pasoOfs') cargarOfs();
  else if(tab==='pasoExtra') cargarExtra();
  else if(tab==='pasoCausas') cargarCausas();
  else if(tab==='pasoFlujo') fjInit();
  else if(tab==='pasoOrigen') cargarOrigen();
}
function toggleSidebar(){ document.body.classList.toggle("sidebar-cerrada"); }
function cerrarSidebarMovil(){ if(window.innerWidth<=900) document.body.classList.add("sidebar-cerrada"); }

function poblarSelectsArea(){
  const op = a=>`<option>${esc(a)}</option>`;
  const elige = `<option value="">— Elige área —</option>`;
  const todas = `<option value="">Todas las áreas</option>`;
  { const se=$("selArea"); if(se) se.innerHTML = AREAS_LISTA.map(op).join(""); }  // "Cambiar Área" removido de la matriz
  $("areaBase").innerHTML = AREAS_LISTA.map(op).join("");
  if($("filtroAreaAsis")) $("filtroAreaAsis").innerHTML = todas + AREAS_LISTA.map(op).join("");
  if($("perArea")) $("perArea").innerHTML = todas + AREAS_LISTA.map(op).join("");
  if($("perMoverArea")) $("perMoverArea").innerHTML = AREAS_LISTA.map(op).join("");
  if($("perRangoArea")) $("perRangoArea").innerHTML = todas + AREAS_LISTA.map(op).join("");
  if($("perDashArea")) $("perDashArea").innerHTML = todas + AREAS_LISTA.map(op).join("");
  if($("perMatArea")) $("perMatArea").innerHTML = todas + AREAS_LISTA.map(op).join("");
  if($("dbModArea")) $("dbModArea").innerHTML = elige + AREAS_LISTA.map(op).join("");
  $("filtroAreaEf").innerHTML   = elige + AREAS_LISTA.map(op).join("");   // Efi. Área: requiere elegir
  $("filtroAreaEfR").innerHTML  = todas + AREAS_LISTA.map(op).join("");
  if($("areaTk"))  $("areaTk").innerHTML  = todas + AREAS_LISTA.map(op).join("");
  if($("areaMod")) $("areaMod").innerHTML = elige + AREAS_LISTA.map(op).join("");
  if($("areaOp"))  $("areaOp").innerHTML  = elige + AREAS_LISTA.map(op).join("");
  if($("areaFec")) $("areaFec").innerHTML = elige + AREAS_LISTA.map(op).join("");
  if($("areaInci")) $("areaInci").innerHTML = todas + AREAS_LISTA.map(op).join("");
  if($("areaModEf")) $("areaModEf").innerHTML = elige + AREAS_LISTA.map(op).join("");
  if($("avofArea")) $("avofArea").innerHTML = todas + AREAS_LISTA.map(op).join("");
  if($("exArea")) $("exArea").innerHTML = elige + AREAS_LISTA.map(op).join("");
  if($("movArea")) $("movArea").innerHTML = todas + AREAS_LISTA.map(op).join("");
  // Operaciones por OF y Generar tickets: solo áreas con Sheet en areas_config.
  const conSheet = Object.keys(AREAS).filter(a=>AREAS[a].habilitada && AREAS[a].sheetId).sort();
  if($("opfArea")) $("opfArea").innerHTML = elige + conSheet.map(op).join("");
  if($("areaGen")) $("areaGen").innerHTML = elige + conSheet.map(op).join("");
}

/* Recargar la pestaña activa (botón ↻ del header). */
function recargarIngenieria(){
  const rc=$("btnRecargar"); if(rc){ rc.classList.add("girando"); setTimeout(()=>rc.classList.remove("girando"),600); }
  const act = id => $(id) && $(id).classList.contains("activa");
  if(act("pasoEf")) cargarEf();
  else if(act("pasoDia")){ if(EFR.personal.length) cargarEfRango(); }
  else if(act("pasoModEf")){ if($("areaModEf")&&$("areaModEf").value) cargarModEf(); }
  else if(act("pasoTk")) cargarTk();
  else if(act("pasoMod")) cargarMod();
  else if(act("pasoBases")) cargarBases();
  else if(act("pasoAsis")) perReload();
  else if(act("pasoDash")) dashTab(DASH_TAB||'asis');
  else if(act("pasoAvOF")){ if(AVOF.items.length) cargarAvof(); }
  else if(act("pasoIncid")) cargarIncidI();
  else if(act("pasoPersonal")||act("pasoAvance")||act("pasoIncidencias")||act("pasoEfPersonal")) recargarSupervisora();
}
/* Censura de eficiencia: reemplaza los % por **** en toda la pestaña. */
function censEf(v){ return EF_CENS_ING ? "****" : v; }
function toggleCensuraEf(){
  EF_CENS_ING = !EF_CENS_ING;
  const b=$("btnCensEf");
  if(b){ b.textContent = EF_CENS_ING ? "Mostrar %" : "Censurar %";
    b.setAttribute("aria-pressed", EF_CENS_ING ? "true" : "false");
    b.classList.toggle("verde", EF_CENS_ING); b.classList.toggle("gris", !EF_CENS_ING); }
  if(EF) pintarEf();
  if(EFR.personal.length) pintarEfRango();
}

/* ================= SUPERVISIÓN (ingeniería opera como supervisora) ================= */
let supBound=false;
function pintarSupAreas(){
  const g=$("gridSupAreas"); if(!g) return;
  g.innerHTML="";
  (AREAS_LISTA||[]).forEach(a=>{
    const c=document.createElement("div");
    c.className="card-area";
    c.innerHTML=`<div class="ca-nombre">${esc(a)}</div><div class="ca-sub">Supervisar</div>`;
    c.onclick=()=>ingSupElegirArea(a);
    g.appendChild(c);
  });
}
function ingSupVolverAreas(){
  pararAvance();
  SUP_AREA_OVERRIDE=null;
  $("supTabs").style.display="none";
  irA("pasoSupArea");
  document.querySelectorAll(".nav-item[data-tab]").forEach(x=>x.classList.toggle("activo", x.dataset.tab==="pasoSupArea"));
}
/* Entra a supervisora.html con la sesión de ingeniería y el área elegida, igual
   que "Operar como operario". El panel embebido se quedaba desactualizado cada
   vez que cambiaba supervisora.html; así siempre es la pantalla real. */
function ingSupElegirArea(area){
  try{
    const s=sesionActual();
    sessionStorage.setItem("stx_volver_ing", localStorage.getItem("stx_sesion")||"");
    guardarSesion({...s, area});          // misma sesión, con el área a supervisar
  }catch(e){ mostrarError("No se pudo abrir supervisión"); return; }
  location.href="supervisora.html";
}

/* ================= GENERAR TICKETS DESDE HN ================= */
const GEN_ENC = { prenda:"1", articulo:"" };   // PRENDA_ENC / ARTICULO_ENC (iguales para todas las áreas)
let GEN_JOBS=[];        // un trabajo por archivo subido (multi-OF)
let GEN_SEQ=0;
function genEsAcabado(){ return normKey($("areaGen") ? $("areaGen").value : "").includes("ACABADO"); }
function genInit(){
  GEN_JOBS=[]; GEN_SEQ=0;
  $("genGate").style.display="block";
  if($("genJobs")) $("genJobs").innerHTML="";
  genOfsRecargar();
}
/* La config de empaquetado vive EN CADA tarjeta; al cambiar de área se re-renderiza. */
function genAreaChange(){ renderGenJobs(); genOfsRecargar(); }

/* ===== Generar desde una OF ya registrada (parche 29) =====
   No escribe el ALMACÉN: marca la OF como servida por el sistema y guarda qué
   operaciones se trocean. Los tickets se derivan de of_detalle × bases. */
let GEN_RUTA=null, GEN_OFS=[], GEN_OFMATCH=[];
function genEsAcabadoArea(){ return normKey($("areaGen")?$("areaGen").value:"").includes("ACABADO"); }
async function genOfsRecargar(){
  const inp=$("genOfBuscar"); if(!inp) return;
  const area=$("areaGen")?$("areaGen").value:"";
  $("genRuta").innerHTML=""; GEN_RUTA=null; GEN_OFS=[]; inp.value=""; genOfsCerrar();
  if(!area){ inp.disabled=true; inp.placeholder="— Elige área primero —"; return; }
  inp.disabled=false; inp.placeholder="Cargando OFs…";
  try{
    const r=await rpc("fn_ofs_generables",{p_dni:ING.dni,p_token:ING.token,p_area:area});
    GEN_OFS=Array.isArray(r)?r:[];
    inp.placeholder = GEN_OFS.length
      ? "Escribe la OF o el artículo…"
      : "Ninguna OF registrada con BASE en esta área";
  }catch(e){ inp.placeholder="Error"; mostrarError(e.message); }
}
function genOfsCerrar(){ const d=$("genOfDrop"); if(d) d.style.display="none"; }
function genOfsBuscar(){
  const inp=$("genOfBuscar"), drop=$("genOfDrop"); if(!inp||!drop) return;
  const q=normKey(inp.value);
  GEN_OFMATCH=GEN_OFS.filter(o=>!q||normKey((o.of||"")+" "+(o.articulo||"")).includes(q)).slice(0,40);
  if(!GEN_OFMATCH.length){
    drop.innerHTML=`<div class="ac-item" style="color:#5a6270;">${GEN_OFS.length?"Sin coincidencias":"Registra la OF en OFs registradas"}</div>`;
    drop.style.display="block"; return;
  }
  drop.innerHTML=GEN_OFMATCH.map((o,i)=>`<div class="ac-item" onmousedown="genOfElegir(${i})">
    <b>${esc(o.articulo)}</b> · OF ${esc(o.of)} · ${Math.round(o.cant_prog)} und${
      o.generada?' · <span class="pill ACTIVO">generada</span>':""}${
      o.paquetes?"":' · <span class="pill DM">sin desglose</span>'}</div>`).join("");
  drop.style.display="block";
}
function genOfElegir(i){
  const o=GEN_OFMATCH[i]; if(!o) return;
  $("genOfBuscar").value=`${o.articulo} · OF ${o.of}`;
  genOfsCerrar(); genRutaCargar(o.of);
}
async function genRutaCargar(ofElegida){
  const of=ofElegida||"", area=$("areaGen").value;
  const z=$("genRuta"); GEN_RUTA=null;
  if(!of){ z.innerHTML=""; return; }
  z.innerHTML=cargandoHTML("Cruzando con BASE…");
  try{
    const r=await rpc("fn_of_ruta",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_of:of});
    if(!r.ok){ z.innerHTML=""; mostrarError(r.error||"Error"); return; }
    GEN_RUTA=r; genRutaPintar();
  }catch(e){ z.innerHTML=""; mostrarError(e.message); }
}
function genRutaPintar(){
  const r=GEN_RUTA; if(!r) return;
  const cab=`<div class="diff-box">
      <h3>${esc(r.articulo)} · OF ${esc(r.of)}</h3>
      <div class="cf-detalle">${Math.round(r.cant_prog)} und · ${r.paquetes} paquete(s) de la HN · ${(r.ruta||[]).length} operación(es) en BASE
        ${r.generada?' · <span class="pill ACTIVO">YA GENERADA</span>':""}</div>
    </div>`;

  /* ACABADO no genera tickets: registra por cantidad contra el corte real, así
     que no hay paquetes que trocear. Basta con que la OF esté registrada y el
     artículo tenga BASE en el área — con eso ya le sale al operario. */
  if(genEsAcabadoArea()){
    $("genRuta").innerHTML = cab + `<div class="diff-box">
      <div class="cf-detalle"><b>ACABADO no genera tickets.</b> Registra por cantidad contra el corte real,
      así que no hay paquetes ni troceo. Esta OF ya le aparece al operario del área porque está registrada
      y su artículo tiene BASE.</div></div>
      <div class="contenedor-ancho tabla-scroll" style="max-height:44vh;">
        <table class="tabla"><thead><tr><th>N°OP</th><th class="izq">Módulo</th><th class="izq">Operación</th><th>STD</th></tr></thead>
        <tbody>${(r.ruta||[]).map(o=>`<tr><td>${o.n_op}</td><td class="izq">${esc(o.modulo||"—")}</td>
          <td class="izq"><b>${esc(o.operacion)}</b></td><td>${Number(o.std).toFixed(2)}</td></tr>`).join("")
          ||`<tr><td colspan="4"><div class="vacio-msg">Sin BASE para este artículo</div></td></tr>`}</tbody></table>
      </div>`;
    return;
  }

  const filas=(r.ruta||[]).map((o,i)=>`<tr>
      <td>${o.n_op}</td><td class="izq">${esc(o.modulo||"—")}</td>
      <td class="izq"><b>${esc(o.operacion)}</b></td><td>${Number(o.std).toFixed(2)}</td>
      <td><label class="chk-inline"><input type="checkbox" class="sw" id="gtOn${i}"
        ${o.troceo?"checked":""} onchange="genTroceoToggle(${i})"> trocear</label></td>
      <td><input type="number" id="gtN${i}" min="1" inputmode="numeric" placeholder="Ej: 10"
        value="${o.troceo||""}" style="max-width:90px;" ${o.troceo?"":"disabled"}></td>
    </tr>`).join("");
  const aviso = r.con_reclamos
    ? `<div class="diff-box"><div class="diff-del">Esta OF ya tiene tickets reclamados en el área. No se puede cambiar el troceo sin liberarlos antes: cambiarlo cambiaría los códigos.</div></div>`
    : !r.paquetes
      ? `<div class="diff-box"><div class="diff-del">La OF no tiene desglose de paquetes. Complétalo con su HN en OFs registradas antes de generar.</div></div>`
      : "";
  $("genRuta").innerHTML=cab+aviso+`
    <div class="contenedor-ancho tabla-scroll" style="max-height:44vh;">
      <table class="tabla"><thead><tr><th>N°OP</th><th class="izq">Módulo</th><th class="izq">Operación</th>
        <th>STD</th><th>Trocear</th><th>Cantidad</th></tr></thead><tbody>${filas
        ||`<tr><td colspan="6"><div class="vacio-msg">Sin BASE para este artículo</div></td></tr>`}</tbody></table>
    </div>
    <div class="fila-filtros" style="margin-top:8px;">
      <button class="btn-mini verde" onclick="genConfirmarOF()"
        ${(r.con_reclamos||!r.paquetes||!(r.ruta||[]).length)?"disabled":""}>
        ${r.generada?"Regenerar":"Generar"} tickets de la OF ${esc(r.of)}</button>
      <span class="sub" id="genPrev"></span>
    </div>`;
  genPrevisualizar();
}
function genTroceoToggle(i){
  const c=$("gtOn"+i), n=$("gtN"+i); if(!c||!n) return;
  n.disabled=!c.checked; if(!c.checked) n.value="";
  else if(!n.value) n.focus();
  genPrevisualizar();
}
function genTroceoActual(){
  return (GEN_RUTA.ruta||[]).map((o,i)=>{
    const c=$("gtOn"+i), n=$("gtN"+i);
    const v=(c&&c.checked&&n)?parseInt(n.value,10):0;
    // op_id manda (parche 35); n_op va de respaldo para rutas sin migrar.
    return v>0 ? {op_id:o.op_id, n_op:o.n_op, n:v} : null;
  }).filter(Boolean);
}
function genPrevisualizar(){
  const r=GEN_RUTA, p=$("genPrev"); if(!r||!p) return;
  const tro=genTroceoActual(), byOp={}; tro.forEach(t=>byOp[t.op_id!=null?t.op_id:"n"+t.n_op]=t.n);
  const kOp=o=>byOp[o.op_id!=null?o.op_id:"n"+o.n_op];
  const total=(r.ruta||[]).reduce((a,o)=>a + (kOp(o)
    ? Math.ceil(r.cant_prog/kOp(o)) : r.paquetes), 0);
  p.textContent = `${total} tickets · ${tro.length} operación(es) troceada(s)`;
}
async function genConfirmarOF(){
  const r=GEN_RUTA; if(!r) return;
  const area=$("areaGen").value, tro=genTroceoActual();
  const det=tro.length ? tro.map(t=>`N°OP ${t.n_op} en paquetes de ${t.n}`).join("\n") : "sin trocear ninguna operación";
  if(!confirm(`¿Generar los tickets de la OF ${r.of} en ${area}?\n\n${det}\n\nNo se escribe el ALMACÉN: los tickets se calculan desde el desglose de la HN.`)) return;
  try{
    const g=await rpc("fn_of_generar",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_of:r.of,p_troceo:tro});
    if(!g.ok){ mostrarError(g.error||"No se pudo generar"); return; }
    mostrarOk(`OF ${g.of} generada · ${g.tickets} tickets · ${g.troceadas} operación(es) troceada(s)`);
    await genOfsRecargar(); $("genOfBuscar").value=`${r.articulo} · OF ${r.of}`; genRutaCargar(r.of);
  }catch(e){ mostrarError(e.message); }
}
function celTxt(v){ return v==null?"":String(v).trim(); }

/* Carga MÚLTIPLES archivos: cada uno = un trabajo independiente (su hoja HN). */
function genLeerHN(input){
  const files=[...input.files]; input.value="";
  if(!files.length) return;
  if(!$("areaGen").value){ mostrarError("Elige primero el área"); return; }
  $("genGate").style.display="none";
  files.forEach(file=>{
    const lector=new FileReader();
    lector.onload=(e)=>{
      try{
        const wb=XLSX.read(e.target.result,{type:"array"});
        if(!wb.SheetNames.includes("HN")) throw new Error(`"${file.name}": no se encontró la hoja HN.`);
        const rows=XLSX.utils.sheet_to_json(wb.Sheets["HN"],{header:1,defval:null,raw:true});
        const hn=parseHN(rows);
        GEN_JOBS.push({id:++GEN_SEQ, name:file.name, hn, filas:null, dupes:[]});
        renderGenJobs();
      }catch(err){ mostrarError(err.message); }
    };
    lector.readAsArrayBuffer(file);
  });
}
function parseHN(rows){
  const get=(r,c)=> (rows[r]&&rows[r][c]!=null)?rows[r][c]:null;
  let prenda="", articulo="", of="";
  for(let r=0;r<Math.min(rows.length,12);r++){
    for(let c=0;c<Math.min((rows[r]||[]).length,12);c++){
      const t=normKey(get(r,c));
      if(t==="ARTICULO" && !articulo) articulo=celTxt(get(r,c+2));  // etiqueta col C → valor col E (c+2)
      if(t==="ORDEN" && !of)          of=celTxt(get(r,c+2));
    }
  }
  if(!prenda)   prenda=celTxt(get(1,1));      // B2
  if(!articulo) articulo=celTxt(get(3,4));    // E4
  if(!of)       of=celTxt(get(4,4));          // E5
  of=of.replace(/\D/g,"");
  // Fila de encabezados (tiene TALLA y CANT)
  let hr=-1;
  for(let r=0;r<rows.length;r++){
    const fila=(rows[r]||[]).map(normKey);
    if(fila.includes("TALLA") && fila.includes("CANT")){ hr=r; break; }
  }
  if(hr<0) throw new Error("No se encontró la fila de encabezados (TALLA / CANT).");
  const bloques=[]; (rows[hr]||[]).forEach((v,c)=>{ if(normKey(v)==="TALLA") bloques.push(c); });
  const tallas=[];
  bloques.forEach(cT=>{
    for(let r=hr+1;r<rows.length;r++){
      const talla=get(r,cT);
      if(talla==null || String(talla).trim()==="") break;
      tallas.push({ talla:celTxt(talla), cant:parseInt(get(r,cT+1))||0, color:celTxt(get(r,cT+3)) });
    }
  });
  return { prenda, articulo, of, tallas, bloques:bloques.length };
}
function jobById(id){ return GEN_JOBS.find(j=>j.id===id); }
function genQuitarJob(id){
  GEN_JOBS=GEN_JOBS.filter(j=>j.id!==id);
  renderGenJobs();
  if(!GEN_JOBS.length) $("genGate").style.display="block";
}
/* Render de una tarjeta independiente por archivo/OF (preview + edición + config propia). */
function renderGenJobs(){
  const z=$("genJobs"); if(!z) return;
  const ac=genEsAcabado();
  z.innerHTML = GEN_JOBS.map(j=>{
    const total=j.hn.tallas.reduce((a,t)=>a+t.cant,0);
    const filasTabla = j.hn.tallas.map((t,i)=>`<tr><td>${i+1}</td><td>${esc(t.talla)}</td><td>${t.cant}</td><td class="izq">${esc(t.color)}</td></tr>`).join("");
    const cfg = ac
      ? `<div class="barra-control gen-cfg-job">
          <label class="campo"><span>Paquete estándar</span><input type="number" id="genEstandar_${j.id}" min="1" inputmode="numeric" placeholder="Ej: 40"></label>
          <label class="campo"><span>Paquete pequeño</span><input type="number" id="genPequeno_${j.id}" min="1" inputmode="numeric" placeholder="Ej: 10"></label>
          <label class="campo"><span>Cant. paq. pequeños</span><input type="number" id="genCantPeq_${j.id}" min="0" inputmode="numeric" placeholder="Ej: 5"></label>
          <label class="campo campo-check"><input type="checkbox" id="genPorColor_${j.id}"><span>Separar por color</span></label>
        </div>`
      : `<div class="barra-control gen-cfg-job">
          <label class="campo campo-check"><input type="checkbox" id="genDivU_${j.id}" onchange="genToggleDivJob(${j.id})"><span>Dividir última operación</span></label>
          <label class="campo" id="genNUc_${j.id}" style="display:none;"><span>N (última)</span><input type="number" id="genNU_${j.id}" min="1" inputmode="numeric" placeholder="Ej: 10"></label>
          <label class="campo campo-check"><input type="checkbox" id="genDivP_${j.id}" onchange="genToggleDivJob(${j.id})"><span>Dividir penúltima operación</span></label>
          <label class="campo" id="genNPc_${j.id}" style="display:none;"><span>N (penúltima)</span><input type="number" id="genNP_${j.id}" min="1" inputmode="numeric" placeholder="Ej: 10"></label>
        </div>`;
    return `<div class="gen-job" id="genJob_${j.id}">
      <div class="gen-job-head">
        <div class="gen-job-name">${esc(j.name)}</div>
        <button class="btn-mini gris" onclick="genQuitarJob(${j.id})">Quitar</button>
      </div>
      <div class="barra-control">
        <label class="campo"><span>Prenda</span><input type="text" id="genPrenda_${j.id}" value="${esc(j.hn.prenda)}"></label>
        <label class="campo"><span>Artículo</span><input type="text" id="genArticulo_${j.id}" value="${esc(j.hn.articulo)}"></label>
        <label class="campo"><span>OF</span><input type="text" id="genOf_${j.id}" inputmode="numeric" value="${esc(j.hn.of)}"></label>
        <span class="sub" style="align-self:flex-end;">${j.hn.bloques} bloque(s) · ${j.hn.tallas.length} filas · ${total} und</span>
      </div>
      <div class="contenedor-ancho tabla-scroll" style="max-height:34vh;">
        <table class="tabla"><thead><tr><th>#</th><th>Talla</th><th>Cant</th><th class="izq">Color</th></tr></thead>
        <tbody>${filasTabla}</tbody></table>
      </div>
      ${cfg}
      <div class="fila-filtros" style="margin-top:6px;">
        <button class="btn-mini" onclick="genPrepararJob(${j.id})">Cruzar con BASE y previsualizar</button>
      </div>
      <div id="genPreview_${j.id}"></div>
    </div>`;
  }).join("");
}
function genToggleDivJob(id){
  { const c=$("genNUc_"+id), k=$("genDivU_"+id); if(c&&k) c.style.display=k.checked?"":"none"; }
  { const c=$("genNPc_"+id), k=$("genDivP_"+id); if(c&&k) c.style.display=k.checked?"":"none"; }
}
/* Paquetes de Acabado: pequeños primero, luego estándar, resto final.
   La suma es siempre exactamente el total. */
function genPaquetesAcabado(total, estandar, pequeno, cantPeq){
  const paq=[]; let restante=total;
  for(let i=0;i<cantPeq && restante>0;i++){ const c=Math.min(pequeno, restante); paq.push(c); restante-=c; }
  while(restante>=estandar){ paq.push(estandar); restante-=estandar; }
  if(restante>0) paq.push(restante);
  return paq;
}
function genCodigo(corte, of, nop){ return parseInt(String(corte)+String(of)+GEN_ENC.prenda+GEN_ENC.articulo+String(nop)); }

async function genPrepararJob(id){
  const j=jobById(id); if(!j) return;
  const area=$("areaGen").value;
  const prenda=$("genPrenda_"+id).value.trim().toUpperCase();
  const articulo=$("genArticulo_"+id).value.trim().toUpperCase();
  const of=$("genOf_"+id).value.replace(/\D/g,"");
  const pv=$("genPreview_"+id);
  if(!prenda||!articulo||!of){ mostrarError("Completa prenda, artículo y OF"); return; }
  if(!j.hn.tallas.length){ mostrarError("La HN no tiene filas"); return; }
  j.hn.prenda=prenda; j.hn.articulo=articulo; j.hn.of=of;   // conserva lo editado
  pv.innerHTML=cargandoHTML("Cruzando con BASE…");
  try{
    const ops=await rpc("fn_bases_operaciones",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_prenda:prenda,p_articulo:articulo});
    if(ops && ops.ok===false) throw new Error(ops.error);
    if(!Array.isArray(ops) || !ops.length){
      pv.innerHTML=`<div class="estado-vacio">SIN BASE cargada para este artículo — cárgala en BASES primero.</div>`; j.filas=null; return;
    }
    const total = j.hn.tallas.reduce((a,t)=>a+(Number(t.cant)||0),0);
    const cliente = norm(ops[0].cliente||"");
    const filas=[]; const set=new Set(); let detalle="";
    const pushFila=(o,p,corte)=>{
      const codigo=genCodigo(corte, of, o.n_op);
      if(set.has(codigo)) throw new Error("Código duplicado interno: "+codigo+" (paquete "+corte+", op "+o.n_op+")");
      set.add(codigo);
      const ef=Math.round(((Number(o.std)*p.cant)/576)*100*100)/100;
      // Col 13: costura = numeración (desde-hasta); acabado = CLIENTE.
      const col13 = p.col13!=null ? p.col13 : `${p.desde}-${p.hasta}`;
      filas.push([prenda,articulo,o.modulo,o.op,Number(o.std),Number(of),p.talla,p.color,corte,p.cant,codigo,o.n_op,col13,ef]);
    };

    if(genEsAcabado()){
      // Empaquetado estándar/pequeño sobre un único total (por color o global).
      const estandar=parseInt($("genEstandar_"+id).value,10);
      const pequeno=parseInt($("genPequeno_"+id).value,10);
      const cantPeq=parseInt($("genCantPeq_"+id).value,10);
      if(!estandar||estandar<=0||!pequeno||pequeno<=0||isNaN(cantPeq)||cantPeq<0){
        mostrarError("Configura paquete estándar, pequeño y cantidad de pequeños"); pv.innerHTML=""; return;
      }
      const porColor = $("genPorColor_"+id) && $("genPorColor_"+id).checked;   // Opción 1 (separar) vs 2 (ignorar)
      let grupos;
      if(porColor){
        const by={}; j.hn.tallas.forEach(t=>{ const c=norm(t.color)||"SIN COLOR"; by[c]=(by[c]||0)+(Number(t.cant)||0); });
        grupos=Object.entries(by).map(([color,tot])=>({color, total:tot}));
      } else {
        grupos=[{color:"C", total}];
      }
      // Lista plana de paquetes (índice global = N° corte).
      const paquetes=[];
      grupos.forEach(g=>{ genPaquetesAcabado(g.total, estandar, pequeno, cantPeq).forEach(cant=>paquetes.push({color:g.color, cant, talla:"T", col13:cliente})); });
      for(const o of ops){ paquetes.forEach((p,idx)=>pushFila(o,p,idx+1)); }
      detalle=`${ops.length} operaciones × ${paquetes.length} paquetes${porColor?` · ${grupos.length} color(es)`:" · sin separar color"} · total ${total} und · cliente ${esc(cliente||"—")}`;
    } else {
      // Costura: un paquete por talla; opción de dividir la última y/o la penúltima
      // operación, cada una con su propia cantidad N (siempre suma el total exacto).
      let acum=0; const paqTalla=j.hn.tallas.map(t=>{ const desde=acum+1, hasta=acum+t.cant; acum+=t.cant;
        return {talla:t.talla,color:t.color,cant:t.cant,desde,hasta}; });
      const divU = $("genDivU_"+id) && $("genDivU_"+id).checked;
      const divP = $("genDivP_"+id) && $("genDivP_"+id).checked;
      const nU = parseInt($("genNU_"+id)?$("genNU_"+id).value:"", 10);
      const nP = parseInt($("genNP_"+id)?$("genNP_"+id).value:"", 10);
      if(divU && (!nU||nU<=0)){ mostrarError("Indica la cantidad (N) para la última operación"); pv.innerHTML=""; return; }
      if(divP && (!nP||nP<=0)){ mostrarError("Indica la cantidad (N) para la penúltima operación"); pv.innerHTML=""; return; }
      const nops=[...new Set(ops.map(o=>Number(o.n_op)))].sort((a,b)=>b-a);
      const nopU = nops.length ? nops[0] : null;         // última = mayor N°OP
      const nopP = nops.length>1 ? nops[1] : null;        // penúltima = 2º mayor
      const trocear=(nn)=>{ const arr=[]; let ac=0; while(ac<total){ const c=Math.min(nn,total-ac); arr.push({talla:"T",color:"C",cant:c,desde:ac+1,hasta:ac+c}); ac+=c; } return arr; };
      const paqU = divU ? trocear(nU) : null;
      const paqP = divP ? trocear(nP) : null;
      for(const o of ops){
        let paquetes = paqTalla;
        if(divU && nopU!=null && Number(o.n_op)===nopU) paquetes = paqU;
        else if(divP && nopP!=null && Number(o.n_op)===nopP) paquetes = paqP;
        paquetes.forEach((p,idx)=>pushFila(o,p,idx+1));
      }
      const partes=[];
      if(divU && nopU!=null) partes.push(`última (N°OP ${nopU}) en paq. de ${nU}`);
      if(divP && nopP!=null) partes.push(`penúltima (N°OP ${nopP}) en paq. de ${nP}`);
      detalle = (partes.length ? partes.join(" · ")+" · resto por talla" : `${paqTalla.length} paquetes por talla`)
        + ` · OF ${esc(of)} · ${esc(articulo)}`;
    }

    const dupes=await genDuplicados(area, set);
    j.filas = dupes.length ? null : filas;
    let html=`<div class="diff-box"><h3>${filas.length} tickets a generar</h3><div class="cf-detalle">${detalle}</div></div>`;
    if(dupes.length){
      html+=`<div class="diff-box"><div class="diff-del">${dupes.length} código(s) YA existen en ALMACEN. ¿Esta OF ya fue procesada?</div>
        <div class="cf-detalle">Ejemplos: ${esc(dupes.slice(0,8).join(", "))}</div></div>`;
    } else {
      html+=`<div class="fila-filtros"><button class="btn-mini verde" onclick="genSubirJob(${id})">Confirmar y escribir en ALMACEN (${filas.length})</button></div>`;
    }
    pv.innerHTML=html;
  }catch(e){ pv.innerHTML=""; mostrarError(e.message); }
}
async function genDuplicados(area, codigosSet){
  const cfg=AREAS[area]; if(!cfg || !cfg.sheetId) return [];
  const url=`https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.hoja||"ALMACEN")}`;
  try{
    const r=await fetch(url); if(!r.ok) return [];
    const filas=parseCSV(await r.text()); if(filas.length<2) return [];
    let iCod=-1; filas[0].forEach((h,i)=>{ if(normKey(h)==="CODIGO") iCod=i; });
    if(iCod<0) return [];
    const ex=new Set(); for(let i=1;i<filas.length;i++){ const c=norm(filas[i][iCod]); if(c) ex.add(c); }
    const dup=[]; codigosSet.forEach(c=>{ if(ex.has(String(c))) dup.push(c); });
    return dup;
  }catch(e){ return []; }
}
async function genSubirJob(id){
  const j=jobById(id); if(!j) return;
  if(!j.filas || !j.filas.length){ mostrarError("Nada que subir (previsualiza primero)"); return; }
  const area=$("areaGen").value;
  if(!confirm(`¿Escribir ${j.filas.length} filas al ALMACEN de ${area}? (OF ${j.hn.of})`)) return;
  const pv=$("genPreview_"+id); pv.innerHTML=cargandoHTML("Escribiendo en ALMACEN…");
  try{
    const r=await edgeFn(FN_GENERAR_TICKETS,{p_dni:ING.dni,p_token:ING.token,area:area,filas:j.filas});
    if(!r.ok){ mostrarError(r.error||"No se pudo escribir"); pv.innerHTML=""; return; }
    mostrarOk(`${r.escritas} filas escritas en ALMACEN (OF ${j.hn.of})`);
    pv.innerHTML=`<div class="estado-vacio">✓ ${r.escritas} filas escritas en el ALMACEN de ${esc(area)} (OF ${esc(j.hn.of)}).</div>`
      + await genRegistrarOF(id, j);
    j.filas=null;
  }catch(e){ pv.innerHTML=""; mostrarError(e.message); }
}
/* Registra la OF y su desglose en Supabase (parche 26). Una sola subida por OF:
   la segunda (la de la otra área) corrobora, lista diferencias y no escribe. */
/* Desglose de la HN: un paquete por fila, con la numeración acumulada (la misma
   que el generador escribe en la col. 13 del ALMACÉN). `paq` = N° CORTE. */
function hnDetalle(tallas){
  let acum=0;
  const det=(tallas||[]).map((t,i)=>{ const c=Number(t.cant)||0, desde=acum+1;
    acum+=c; return {paq:i+1, talla:norm(t.talla), color:norm(t.color), cant:c, desde, hasta:acum}; });
  return {det, total:acum};
}
async function genRegistrarOF(id, j){
  const nInp = k => { const c=$("genDiv"+k+"_"+id), n=$("genN"+k+"_"+id);
    return (c&&c.checked&&n) ? (parseInt(n.value,10)||null) : null; };
  const {det, total:acum} = hnDetalle(j.hn.tallas);
  try{
    const g=await rpc("fn_of_registrar",{p_dni:ING.dni,p_token:ING.token,p_of:j.hn.of,
      p_articulo:j.hn.articulo, p_prenda:j.hn.prenda, p_cant_prog:acum,
      p_div_ultima:nInp("U"), p_div_penultima:nInp("P"), p_detalle:det});
    if(!g || g.ok===false) return `<div class="diff-box"><div class="diff-del">OF no registrada: ${esc((g&&g.error)||"error")}</div></div>`;
    if(g.creada) return `<div class="diff-box"><div class="cf-detalle">OF ${esc(g.of)} registrada · ${g.paquetes} paquete(s) · ${Math.round(acum)} und programadas.</div></div>`;
    const dif=(g.difiere||[]).length ? `<br>Diferencias con esta HN: ${esc((g.difiere||[]).join(" · "))}` : "";
    return `<div class="diff-box"><div class="diff-del">La OF ${esc(g.of)} ya estaba registrada (${esc(g.fecha_carga||"—")}). No se volvió a escribir.${dif}</div></div>`;
  }catch(e){ return `<div class="diff-box"><div class="diff-del">OF no registrada: ${esc(e.message)}</div></div>`; }
}

/* ================= OPERACIONES POR OF (agregar / quitar en ALMACÉN) =================
   Escribe/borra en el ALMACÉN vía la Edge Function, a nivel de una OF. No renumera:
   la nueva operación entra con su N°OP y las filas existentes NO se tocan. Código de
   los tickets nuevos = OF + DDMM + N°OP(2) + corte(3) → único aunque se agreguen
   varias operaciones el mismo día. Quitar: borra solo los NO reclamados (muestra la
   lista y protege los reclamados). */
let OPF={area:"",of:"",prenda:"",articulo:"",H:{},rowsByOp:{},ops:[],baseOps:[],modo:"add",pendAdd:null,pendDel:null};
function opfInit(){ /* selects poblados por poblarSelectsArea; nada más al entrar */ }
function opfModo(m){
  OPF.modo=m;
  $("opfTabAdd").classList.toggle("activo",m==="add");
  $("opfTabDel").classList.toggle("activo",m==="del");
  $("opfAdd").hidden=m!=="add"; $("opfDel").hidden=m!=="del";
}
function opfReset(){
  OPF.of=""; OPF.pendAdd=null; OPF.pendDel=null;
  $("opfContenido").hidden=true; $("opfGate").style.display="block";
  $("opfAddPv").innerHTML=""; $("opfDelPv").innerHTML=""; $("opfDelList").innerHTML="";
}
function opfDDMM(){ const p=hoyLima().split("-"); return p[2]+p[1]; }   // YYYY-MM-DD -> DDMM
function opfCodigo(of,nop,corte){ return parseInt(`${of}${opfDDMM()}${String(nop).padStart(2,"0")}${String(corte).padStart(3,"0")}`); }
function opfTemplate(){ let best=null; for(const op in OPF.rowsByOp){ if(!best||OPF.rowsByOp[op].length>OPF.rowsByOp[best].length) best=op; } return best?OPF.rowsByOp[best]:[]; }

async function opfCargarOF(){
  const area=$("opfArea").value, of=$("opfOf").value.trim();
  if(!area){ mostrarError("Elige el área"); return; }
  if(!of){ mostrarError("Escribe la OF"); return; }
  const cfg=AREAS[area]; if(!cfg||!cfg.sheetId){ mostrarError("Área sin Sheet configurado"); return; }
  $("opfGate").style.display="none"; $("opfContenido").hidden=false;
  $("opfDelList").innerHTML=cargandoHTML("Leyendo ALMACÉN…"); $("opfAddPv").innerHTML=""; $("opfDelPv").innerHTML="";
  try{
    const url=`https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.hoja||"ALMACEN")}`;
    const filas=parseCSV(await (await fetch(url)).text());
    if(filas.length<2) throw new Error("El ALMACÉN está vacío");
    const H={}; filas[0].forEach((h,i)=>{ const k=normKey(h); if(k && H[k]===undefined) H[k]=i; });
    for(const req of ["OP","OF","CODIGO","NOP","CANT"]) if(H[req]===undefined) throw new Error("Falta la columna "+req+" en el ALMACÉN");
    const rowsByOp={}; let prenda="",articulo="";
    for(let i=1;i<filas.length;i++){
      const r=filas[i]; if(normKey(r[H.OF]||"")!==normKey(of)) continue;
      const op=norm(r[H.OP]); if(!op) continue;
      (rowsByOp[op]=rowsByOp[op]||[]).push(r);
      if(!prenda && H.PRENDA!==undefined) prenda=norm(r[H.PRENDA]);
      if(!articulo && H.ARTICULO!==undefined) articulo=norm(r[H.ARTICULO]);
    }
    const ops=Object.keys(rowsByOp).map(op=>({op, nop:norm(rowsByOp[op][0][H.NOP]), count:rowsByOp[op].length,
      codes:rowsByOp[op].map(r=>String(norm(r[H.CODIGO]))).filter(Boolean)}))
      .sort((a,b)=>(Number(a.nop)||0)-(Number(b.nop)||0));
    if(!ops.length) throw new Error("La OF "+of+" no tiene tickets en el ALMACÉN");
    OPF={area,of,prenda,articulo,H,rowsByOp,ops,baseOps:[],modo:OPF.modo,pendAdd:null,pendDel:null};
    try{ OPF.baseOps=await rpc("fn_bases_operaciones",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_prenda:prenda,p_articulo:articulo}); }catch(e){}
    if(!Array.isArray(OPF.baseOps)) OPF.baseOps=[];
    opfModo(OPF.modo); opfRenderAdd(); opfRenderDel();
  }catch(e){ $("opfDelList").innerHTML=""; mostrarError(e.message); }
}

/* La operación se busca escribiendo y el N°OP sale de la BASE: pedirlo a mano
   era pedir dos veces el mismo dato. Se pueden añadir varias de una vez. */
function opfRenderAdd(){
  OPF.sel=OPF.sel||[];
  opfPintarSel();
  $("opfAddPv").innerHTML=`<div class="cf-detalle" style="margin-top:8px;">OF ${esc(OPF.of)} · ${esc(OPF.prenda)} / ${esc(OPF.articulo)} · ${OPF.ops.length} operación(es) actuales · paquetes de referencia: ${opfTemplate().length}.</div>`;
}
function opfBuscarOp(){
  const inp=$("opfOp"), drop=$("opfOpDrop"); if(!inp||!drop) return;
  const q=normKey(inp.value);
  const yaOF=new Set(OPF.ops.map(o=>normKey(o.op)));
  const yaSel=new Set((OPF.sel||[]).map(o=>normKey(o.op)));
  OPF.match=(OPF.baseOps||[])
    .filter(o=>!yaSel.has(normKey(o.op)) && (!q || normKey(o.op).includes(q)))
    .slice(0,40);
  if(!OPF.match.length){
    drop.innerHTML=`<div class="ac-item" style="color:#5a6270;">${OPF.baseOps.length?"Sin coincidencias":"Sin BASE para "+esc(OPF.articulo||"—")}</div>`;
    drop.style.display="block"; return;
  }
  drop.innerHTML=OPF.match.map((o,i)=>`<div class="ac-item" onmousedown="opfElegirOp(${i})">
    <b>${esc(o.op)}</b> · N°OP ${o.n_op} · STD ${Number(o.std).toFixed(2)}${yaOF.has(normKey(o.op))?" · ya en la OF":""}</div>`).join("");
  drop.style.display="block";
}
function opfCerrarDrop(){ const d=$("opfOpDrop"); if(d) d.style.display="none"; }
function opfElegirOp(i){
  const o=(OPF.match||[])[i]; if(!o) return;
  (OPF.sel=OPF.sel||[]).push(o);
  $("opfOp").value=""; opfCerrarDrop(); opfPintarSel(); $("opfAddPv").innerHTML="";
}
function opfQuitarSel(i){ OPF.sel.splice(i,1); opfPintarSel(); $("opfAddPv").innerHTML=""; }
function opfLimpiarSel(){ OPF.sel=[]; opfPintarSel(); $("opfAddPv").innerHTML=""; OPF.pendAdd=null; }
function opfPintarSel(){
  const z=$("opfSel"); if(!z) return;
  const s=OPF.sel||[];
  z.innerHTML = s.length
    ? `Se añadirán ${s.length}: ` + s.map((o,i)=>`<span class="pill CERRADO" style="cursor:pointer;margin:2px;"
        onclick="opfQuitarSel(${i})" title="Quitar de la selección">${esc(o.op)} · N°OP ${o.n_op} ✕</span>`).join("")
    : `Escribe arriba para buscar operaciones de la BASE. Puedes elegir varias.`;
}
function opfPreviewAdd(){
  const sel=OPF.sel||[];
  if(!sel.length){ mostrarError("Elige al menos una operación"); return; }
  const H=OPF.H, tpl=opfTemplate();
  if(!tpl.length){ mostrarError("No hay paquetes de referencia en la OF"); return; }
  const filas=[], set=new Set(), resumen=[];
  for(const base of sel){
    const nop=parseInt(base.n_op,10);
    if(!nop||nop<=0){ mostrarError(`La operación ${base.op} no tiene N°OP en la BASE`); return; }
    const std=Number(base.std)||0, modulo=norm(base.modulo), opNom=norm(base.op);
    let n=0;
    for(const r of tpl){
      const corteRaw = H.NCORTE!==undefined ? norm(r[H.NCORTE]) : "";
      const corteNum = parseInt(corteRaw) || (n+1);
      const corte = corteRaw || String(corteNum);
      const talla = H.TALLA!==undefined?norm(r[H.TALLA]):"";
      const color = H.COLOR!==undefined?norm(r[H.COLOR]):"";
      const cant  = Number(norm(r[H.CANT]))||0;
      const col13 = H.NUMERACION!==undefined?norm(r[H.NUMERACION]):"";
      const codigo = opfCodigo(OPF.of, nop, corteNum);
      if(set.has(codigo)){ mostrarError("Código duplicado interno: "+codigo+" ("+opNom+")"); return; }
      set.add(codigo); n++;
      const ef=Math.round(((std*cant)/576)*100*100)/100;
      filas.push([OPF.prenda,OPF.articulo,modulo,opNom,std,Number(OPF.of),talla,color,corte,cant,codigo,nop,col13,ef]);
    }
    resumen.push(`<b>${esc(opNom)}</b> · N°OP ${nop} · STD ${std} · ${esc(modulo||"—")} · ${n} tickets`);
  }
  const yaExisten=new Set(); Object.values(OPF.rowsByOp).forEach(rows=>rows.forEach(r=>yaExisten.add(String(norm(r[H.CODIGO])))));
  const dup=filas.filter(f=>yaExisten.has(String(f[10])));
  OPF.pendAdd = dup.length?null:filas;
  let html=`<div class="diff-box"><h3>${filas.length} tickets a generar · ${sel.length} operación(es)</h3>
    <div class="cf-detalle">${resumen.join("<br>")}</div></div>`;
  if(dup.length){
    html+=`<div class="diff-box"><div class="diff-del">${dup.length} código(s) YA existen (¿ya agregaste alguna de estas operaciones?).</div></div>`;
  } else {
    html+=`<div class="fila-filtros"><button class="btn-mini verde" onclick="opfConfirmAdd()">Confirmar y escribir en ALMACÉN (${filas.length})</button></div>`;
  }
  $("opfAddPv").innerHTML=html;
}
async function opfConfirmAdd(){
  if(!OPF.pendAdd||!OPF.pendAdd.length){ mostrarError("Previsualiza primero"); return; }
  if(!confirm(`¿Escribir ${OPF.pendAdd.length} filas al ALMACÉN de ${OPF.area}? (OF ${OPF.of})`)) return;
  $("opfAddPv").innerHTML=cargandoHTML("Escribiendo en ALMACÉN…");
  try{
    const r=await edgeFn(FN_GENERAR_TICKETS,{p_dni:ING.dni,p_token:ING.token,area:OPF.area,accion:"append",filas:OPF.pendAdd});
    if(!r.ok) throw new Error(r.error||"No se pudo escribir");
    mostrarOk(`${r.escritas} filas escritas en el ALMACÉN (OF ${OPF.of}).`);
    OPF.pendAdd=null; await opfCargarOF();
  }catch(e){ mostrarError(e.message); }
}

function opfRenderDel(){
  $("opfDelSub").textContent=`OF ${OPF.of} · ${OPF.prenda}/${OPF.articulo} · toca "Quitar" en una operación.`;
  $("opfDelList").innerHTML=OPF.ops.map(o=>`<div class="mod-card"><div class="mod-head" style="cursor:default;">
      <div class="mod-nombre">${esc(o.op)}</div><div class="mod-sub">N°OP ${esc(o.nop)} · ${o.count} paquete(s)</div>
    </div>
    <div class="mod-body"><button class="btn-mini rojo" onclick="opfPrepDel('${esc(o.op).replace(/'/g,"\\'")}')">Quitar operación</button></div>
  </div>`).join("");
}
async function opfPrepDel(op){
  const o=OPF.ops.find(x=>x.op===op)||OPF.ops.find(x=>normKey(x.op)===normKey(op)); if(!o) return;
  $("opfDelPv").innerHTML=cargandoHTML("Verificando reclamos…");
  const claimed=new Set();
  try{ const recl=await rpc("fn_reclamados",{p_dni:ING.dni,p_token:ING.token,p_area:OPF.area}); (recl||[]).forEach(x=>claimed.add(String(x.codigo))); }catch(e){}
  const H=OPF.H, rows=OPF.rowsByOp[o.op]||[];
  const info=c=>{ const r=rows.find(rr=>String(norm(rr[H.CODIGO]))===String(c)); if(!r) return esc(String(c));
    const t=H.TALLA!==undefined?norm(r[H.TALLA]):"", col=H.COLOR!==undefined?norm(r[H.COLOR]):"", ca=H.CANT!==undefined?norm(r[H.CANT]):"";
    return `${esc(String(c))} · ${esc(t)}/${esc(col)} · ${esc(ca)}u`; };
  const toDel=o.codes.filter(c=>!claimed.has(String(c)));
  const prot=o.codes.filter(c=>claimed.has(String(c)));
  OPF.pendDel={op:o.op, codigos:toDel};
  let html=`<div class="diff-box"><h3>Quitar "${esc(o.op)}" (N°OP ${esc(o.nop)})</h3>
    <div class="cf-detalle"><b>${toDel.length}</b> ticket(s) se borrarán del ALMACÉN:</div>
    <div class="cf-detalle" style="max-height:220px;overflow:auto;">${toDel.length?toDel.map(info).join("<br>"):"— ninguno —"}</div></div>`;
  if(prot.length){
    html+=`<div class="diff-box"><div class="diff-del">${prot.length} ticket(s) están RECLAMADOS y NO se borrarán:</div>
      <div class="cf-detalle" style="max-height:150px;overflow:auto;">${prot.map(info).join("<br>")}</div></div>`;
  }
  html+=`<div class="fila-filtros">
    ${toDel.length?`<button class="btn-mini rojo" onclick="opfBorrar()">BORRAR ${toDel.length} del ALMACÉN</button>`:""}
    <button class="btn-mini gris" onclick="document.getElementById('opfDelPv').innerHTML=''">Cancelar</button></div>`;
  $("opfDelPv").innerHTML=html;
}
async function opfBorrar(){
  const p=OPF.pendDel; if(!p||!p.codigos.length){ mostrarError("Nada que borrar"); return; }
  if(!confirm(`¿Borrar ${p.codigos.length} ticket(s) de "${p.op}" del ALMACÉN de ${OPF.area}? (OF ${OPF.of})`)) return;
  $("opfDelPv").innerHTML=cargandoHTML("Borrando del ALMACÉN…");
  try{
    const r=await edgeFn(FN_GENERAR_TICKETS,{p_dni:ING.dni,p_token:ING.token,area:OPF.area,accion:"borrar",codigos:p.codigos});
    if(!r.ok) throw new Error(r.error||"No se pudo borrar");
    mostrarOk(`${r.borradas} ticket(s) borrados del ALMACÉN (OF ${OPF.of}).`);
    OPF.pendDel=null; await opfCargarOF();
  }catch(e){ mostrarError(e.message); }
}

/* (Tickets por personal fue eliminado — Parche 12) */

/* ================= CORREGIR FECHAS DE RECLAMO ================= */
let FEC_RECL=[], FEC_SEL={}, FEC_MOTIVOS=[];
async function initFechas(){
  { const f=$("fechaFec"); if(f && !f.value) f.value=hoyISO(); }
  { const f=$("fechaNuevaFec"); if(f && !f.value) f.value=hoyISO(); }
  $("opFec").innerHTML = `<option value="">— Elige área primero —</option>`;
  $("fecContenido").hidden = true; $("fecGate").style.display="block";
  try{ FEC_MOTIVOS = await rpc("fn_motivos_fecha_listar",{p_dni:ING.dni,p_token:ING.token}); }
  catch(e){ FEC_MOTIVOS=[]; }
  pintarMotivosFec();
}
function pintarMotivosFec(){
  const s=$("motivoFec"); if(!s) return;
  s.innerHTML = `<option value="">— Elige motivo —</option>`
    + (FEC_MOTIVOS||[]).map(m=>`<option>${esc(m)}</option>`).join("")
    + `<option value="__OTRO__">OTRO (escribir)…</option>`;
}
function motivoFecCambio(){
  const otro = $("motivoFec").value==="__OTRO__";
  $("motivoOtroWrap").style.display = otro ? "flex" : "none";
}
async function cargarFecArea(){
  const area=$("areaFec").value;
  const s=$("opFec");
  if(!area){ s.innerHTML=`<option value="">— Elige área primero —</option>`; return; }
  s.innerHTML=`<option value="">Cargando…</option>`;
  try{
    const per = await rpc("fn_personal",{p_dni:ING.dni,p_token:ING.token,p_area:area});
    s.innerHTML = `<option value="">— Elige operario —</option>`
      + per.map(p=>`<option value="${esc(p.dni)}">${esc(soloApellidos(p.nombre))} · ${esc(p.dni)}</option>`).join("");
  }catch(e){ s.innerHTML=`<option value="">Error</option>`; mostrarError(e.message); }
}
async function cargarReclamosFec(){
  const dniOp=$("opFec").value, fecha=$("fechaFec").value;
  if(!dniOp){ mostrarError("Elige un operario"); return; }
  if(!fecha){ mostrarError("Elige la fecha actual de los tickets"); return; }
  $("fecGate").style.display="none"; $("fecContenido").hidden=false;
  $("tablaFec").innerHTML=cargandoHTML("Cargando tickets…");
  FEC_SEL={};
  try{
    FEC_RECL = await rpc("fn_reclamos_operario",{p_dni:ING.dni,p_token:ING.token,p_dni_op:dniOp,p_fecha:fecha});
    if(FEC_RECL && FEC_RECL.ok===false){ mostrarError(FEC_RECL.error||"Error"); FEC_RECL=[]; }
    pintarReclamosFec();
  }catch(e){ $("tablaFec").innerHTML=""; mostrarError(e.message); }
}
let fecSort={col:null,dir:1};
function ordenarFec(col){ if(fecSort.col===col) fecSort.dir*=-1; else fecSort={col,dir:1}; pintarReclamosFec(); }
function pintarReclamosFec(){
  let lista = Array.isArray(FEC_RECL) ? [...FEC_RECL] : [];
  $("resumenFec").textContent = `${lista.length} ticket(s) en esa fecha · ${Object.keys(FEC_SEL).length} seleccionado(s)`;
  if(!lista.length){ $("tablaFec").innerHTML=`<div class="vacio-msg">Ese operario no tiene tickets esa fecha</div>`; return; }
  if(fecSort.col){ const c=fecSort.col; lista.sort((a,b)=>{ return cmpVal(a[c],b[c])*fecSort.dir; }); }
  const fl=k=>fecSort.col===k?(fecSort.dir===1?" ▲":" ▼"):"";
  const COLS=[["of","OF"],["op","Operación"],["articulo","Artículo"],["num","Num."],["hora","Hora"],["cant","Cant"],["minutos","Min"],["estado","Estado"]];
  const thead=`<thead><tr><th></th>${COLS.map(c=>`<th class="ord${c[0]==="op"?" izq":""}" onclick="ordenarFec('${c[0]}')">${c[1]}${fl(c[0])}</th>`).join("")}<th></th></tr></thead>`;
  // Un registro por CANTIDAD (sin código, típico de Acabado) puede haberse hecho
  // en dos días: "Partir" deja una parte aquí y manda el resto a otra fecha.
  $("tablaFec").innerHTML = thead + "<tbody>" + lista.map(r=>`<tr>
    <td><input type="checkbox" class="sw" ${FEC_SEL[r.id]?"checked":""} onclick="toggleFecSel(${r.id})"></td>
    <td>${esc(r.of)}</td><td class="izq">${esc(r.op)}</td><td>${esc(r.articulo)}</td>
    <td>${esc(r.num)}</td><td>${esc(r.hora||"")}</td><td>${r.cant}</td><td>${r.minutos}</td>
    <td><span class="pill ${esc(r.estado)}">${esc(r.estado)}</span></td>
    <td>${(!r.codigo && r.estado==='ACTIVO' && Number(r.cant)>1)
        ? `<button class="btn-mini" onclick="abrirPartirFec(${r.id})">Partir</button>` : ""}</td></tr>`).join("") + "</tbody>";
}
function toggleFecSel(id){ if(FEC_SEL[id]) delete FEC_SEL[id]; else FEC_SEL[id]=true; pintarReclamosFec(); }
function marcarTodosFec(){
  const lista = Array.isArray(FEC_RECL) ? FEC_RECL : [];
  const faltan = lista.some(r=>!FEC_SEL[r.id]);
  FEC_SEL={};
  if(faltan) lista.forEach(r=>{ FEC_SEL[r.id]=true; });
  pintarReclamosFec();
}
async function abrirPartirFec(id){
  const r=(FEC_RECL||[]).find(x=>Number(x.id)===Number(id)); if(!r) return;
  if(!CAUSAS_ING.length) await cargarCausasSilencioso();
  const mots=(FEC_MOTIVOS||[]).map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
  abrirModal(`
    <h2>Partir el registro</h2>
    <div class="sub" style="margin-bottom:12px;">${esc(r.op)} · OF ${esc(r.of||"—")} · ${qty(r.cant)} und el ${esc(r.fecha)}</div>
    <div class="modal-2col">
      <div class="modal-campo"><label>Cantidad que se mueve</label>
        <input id="prtCant" type="number" min="1" max="${Number(r.cant)-1}" inputmode="numeric" placeholder="Ej: 150"></div>
      <div class="modal-campo"><label>A la fecha</label>
        <input id="prtFecha" type="date" value="${esc(r.fecha)}"></div>
    </div>
    <div class="modal-campo"><label>Causa de la parte separada</label>
      <select id="prtCausa">
        <option value="">Sin causa · al STD de la base</option>
        ${(CAUSAS_ING||[]).filter(c=>c.activa).map(c=>
          `<option value="${esc(c.texto)}" ${r.causa===c.texto?"selected":""}>${esc(c.texto)} (${Number(c.delta)>0?"+":""}${Number(c.delta).toFixed(2)} min/prenda)</option>`).join("")}
      </select></div>
    <div class="modal-campo"><label>Motivo</label>
      <input id="prtMotivo" list="prtMotivos" maxlength="120" placeholder="Ej: SE REGISTRÓ TODO EN UN DÍA">
      <datalist id="prtMotivos">${mots}</datalist></div>
    <div class="cf-detalle">Queda lo demás en ${esc(r.fecha)}${r.causa?` con la causa ${esc(r.causa)}`:""}.
      Si solo cambias la causa, deja la misma fecha.</div>
    <div class="modal-msg" id="prtMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="confirmarPartirFec(${r.id})">PARTIR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
async function confirmarPartirFec(id){
  const cant=parseFloat($("prtCant").value);
  const fecha=$("prtFecha").value;
  const motivo=norm($("prtMotivo").value).toUpperCase();
  const causa=$("prtCausa")?$("prtCausa").value:"";
  if(!cant || cant<=0){ $("prtMsg").textContent="Escribe la cantidad a mover"; return; }
  if(!fecha){ $("prtMsg").textContent="Elige la fecha"; return; }
  if(!motivo){ $("prtMsg").textContent="Indica el motivo"; return; }
  try{
    const r=await rpc("fn_reclamo_partir",{p_dni:ING.dni,p_token:ING.token,
      p_id:id,p_cant:cant,p_fecha:fecha,p_motivo:motivo,p_causa:causa});
    if(!r.ok){ $("prtMsg").textContent=r.error||"No se pudo partir"; return; }
    cerrarModal();
    mostrarOk(`${qty(r.movido)} und · ${esc(r.fecha)}${r.causa?" · "+esc(r.causa):""} · quedan ${qty(r.queda)}`);
    FEC_MOTIVOS = await rpc("fn_motivos_fecha_listar",{p_dni:ING.dni,p_token:ING.token}).catch(()=>FEC_MOTIVOS);
    pintarMotivosFec();
    await cargarReclamosFec();
  }catch(e){ $("prtMsg").textContent=e.message; }
}

async function aplicarCambioFec(){
  const ids = Object.keys(FEC_SEL).map(Number);
  if(!ids.length){ mostrarError("Marca al menos un ticket"); return; }
  const nueva = $("fechaNuevaFec").value;
  if(!nueva){ mostrarError("Elige la nueva fecha"); return; }
  let motivo = $("motivoFec").value;
  if(motivo==="__OTRO__") motivo = $("motivoOtroFec").value.trim();
  if(!motivo){ mostrarError("Indica el motivo"); return; }
  if(!confirm(`¿Mover ${ids.length} ticket(s) a ${nueva}?\nMotivo: ${motivo.toUpperCase()}`)) return;
  try{
    const r = await rpc("fn_reclamos_cambiar_fecha",{p_dni:ING.dni,p_token:ING.token,
      p_ids:ids, p_fecha:nueva, p_motivo:motivo});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    mostrarOk(`${r.cambiados} ticket(s) movidos a ${nueva}`);
    FEC_MOTIVOS = await rpc("fn_motivos_fecha_listar",{p_dni:ING.dni,p_token:ING.token}).catch(()=>FEC_MOTIVOS);
    pintarMotivosFec();
    await cargarReclamosFec();
  }catch(e){ mostrarError(e.message); }
}

/* ================= OPERAR COMO OPERARIO ================= */
let OP_PERSONAL=[];
async function cargarOpArea(){
  const area = $("areaOp") ? $("areaOp").value : "";
  const g=$("gridOpArea");
  if(!area){ $("opGate").style.display="block"; if(g) g.innerHTML=""; OP_PERSONAL=[]; return; }
  $("opGate").style.display="none";
  if(g) g.innerHTML=cargandoHTML("Cargando personal…");
  try{
    OP_PERSONAL = await rpc("fn_personal",{p_dni:ING.dni,p_token:ING.token,p_area:area});
    pintarOpArea();
  }catch(e){ if(g) g.innerHTML=""; mostrarError(e.message); }
}
function pintarOpArea(){
  const g=$("gridOpArea"); if(!g) return;
  const q=normKey($("filtroOp") ? $("filtroOp").value : "");
  const lista = OP_PERSONAL.filter(p=>!q || normKey(p.nombre).includes(q));
  if(!lista.length){ g.innerHTML=`<div class="vacio-msg">Sin personal para este filtro</div>`; return; }
  g.innerHTML="";
  lista.forEach(p=>{
    const c=document.createElement("div");
    c.className="card-persona";
    c.setAttribute("role","button"); c.setAttribute("tabindex","0");
    c.innerHTML=`<div><div class="cp-nombre">${esc(soloApellidos(p.nombre))}</div>
      <div class="cp-dni">DNI ${esc(p.dni)}</div></div><div class="cp-disp">${p.disp} min</div>`;
    const abrir=()=>opPinModal(p.dni, p.nombre);
    c.onclick=abrir;
    c.onkeydown=(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); abrir(); } };
    g.appendChild(c);
  });
}
function opPinModal(dni, nombre){
  abrirModal(`
    <h2>Entrar como ${esc(soloApellidos(nombre))}</h2>
    <div class="sub" style="margin-bottom:12px;">Con permiso del operario. Verifica su DNI e ingresa su PIN.</div>
    <div class="modal-campo"><label>DNI</label>
      <input id="opDni" value="${esc(dni)}" inputmode="numeric" maxlength="15" autocomplete="off"></div>
    <div class="modal-campo"><label>PIN (4 dígitos)</label>
      <input id="opPin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>
    <div class="modal-msg" id="opMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="opEntrar()">ENTRAR AL FLUJO</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
  setTimeout(()=>{ const el=$("opPin"); if(el) el.focus(); }, 50);
}
async function opEntrar(){
  const dni=($("opDni").value||"").trim();
  const pin=($("opPin").value||"").trim();
  const msg=$("opMsg");
  if(!dni || !/^\d{4}$/.test(pin)){ msg.textContent="Ingresa DNI y PIN de 4 dígitos"; return; }
  try{
    const r=await rpc("fn_login",{p_dni:dni,p_pin:pin});
    if(!r.ok){ msg.textContent=r.error||"DNI o PIN incorrectos"; return; }
    if(r.cargo!=="OPERARIO" && r.cargo!=="ESTAJERO"){ msg.textContent="Ese usuario no es operario"; return; }
    // Guarda la sesión de INGENIERÍA para poder volver desde operario.html.
    try{ sessionStorage.setItem("stx_volver_ing", localStorage.getItem("stx_sesion")||""); }catch(e){}
    // Reutiliza el flujo de operario tal cual: guarda la sesión del operario y entra.
    guardarSesion({dni:r.dni, nombre:r.nombre, cargo:r.cargo, token:r.token,
      area:(r.cargo==="ESTAJERO"? null : (r.area_actual||null))});
    location.href="operario.html";
  }catch(e){ msg.textContent=e.message; }
}

/* ================= TICKETS POR MÓDULO (% de avance) =================
   Avance del módulo = unidades que pasaron su ÚLTIMA operación (mayor N°OP
   por artículo+módulo en BASE) / meta de la OF (hoja "OF", col CANT PROG).
   No se muestra numeración: se muestra la CANTIDAD. */
let MODTK=[], modArea="", MOD_META={};
async function cargarMod(reset){
  modArea = $("areaMod") ? $("areaMod").value : "";
  if(!modArea){ $("modGate").style.display="block"; $("zonaModulos").innerHTML=""; $("resumenMod").textContent=""; return; }
  $("modGate").style.display="none";
  $("zonaModulos").innerHTML=cargandoHTML("Cargando…");
  $("resumenMod").textContent="";
  try{
    // Acumulativo: todos los tickets del área HASTA la fecha indicada.
    MODTK = await rpc("fn_tickets_rango",{p_dni:ING.dni,p_token:ING.token,
      p_area:modArea, p_dni_op:"", p_desde:null, p_hasta:$("fechaMod").value});
    if(MODTK && MODTK.ok===false){ mostrarError(MODTK.error||"Error"); MODTK=[]; }
    if(!BASES_CACHE[modArea]){
      try{ BASES_CACHE[modArea] = await rpc("fn_bases_listar",{p_dni:ING.dni,p_token:ING.token,p_area:modArea}); }
      catch(e){ BASES_CACHE[modArea]=[]; }
    }
    try{ MOD_META = await cargarMetaOF(modArea); }catch(e){ MOD_META={}; }
    await cargarModCerrados();
    // Solo al CAMBIAR de área se reinicia la cascada Artículo → OF; al recargar
    // o al volver a la pestaña se conserva lo que el usuario ya había elegido.
    if(reset && $("artMod")) $("artMod").value="";
    cerrarArtDrop();
    poblarOfMod();
    pintarMod();
  }catch(e){ $("zonaModulos").innerHTML=""; mostrarError(e.message); }
}
function filtrarModArea(a){
  modArea=a;
  if(!modArea){ $("modGate").style.display="block"; $("zonaModulos").innerHTML=""; $("resumenMod").textContent=""; return; }
  cargarMod(true);
}
/* --- Cascada Artículo → OF (autocompletado desde los tickets cargados) --- */
function modArtActual(){
  const q=normKey($("artMod")?$("artMod").value:"");
  if(!q) return "";
  const arts=[...new Set(MODTK.filter(t=>t.estado==='ACTIVO').map(t=>norm(t.articulo)).filter(Boolean))];
  return arts.find(a=>normKey(a)===q) || "";
}
let ART_MATCH=[];
/* Autocompletado por coincidencia (contains) con dropdown propio y estilizado. */
function renderArtDrop(){
  const inp=$("artMod"), drop=$("artModDrop"); if(!inp||!drop) return;
  const q=normKey(inp.value);
  const arts=[...new Set(MODTK.filter(t=>t.estado==='ACTIVO').map(t=>norm(t.articulo)).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"es"));
  ART_MATCH = (q ? arts.filter(a=>normKey(a).includes(q)) : arts).slice(0,60);
  if(!ART_MATCH.length){ drop.style.display="none"; drop.innerHTML=""; return; }
  drop.innerHTML = ART_MATCH.map((a,i)=>`<div class="ac-item" onmousedown="elegirArtMod(${i})">${esc(a)}</div>`).join("");
  drop.style.display="block";
}
function elegirArtMod(i){ const a=ART_MATCH[i]; if(a==null) return; $("artMod").value=a; cerrarArtDrop(); poblarOfMod(); pintarMod(); }
function cerrarArtDrop(){ const d=$("artModDrop"); if(d) d.style.display="none"; }
function poblarOfMod(){
  const sel=$("ofModSel"); if(!sel) return;
  const art=modArtActual();
  const prev=sel.value;
  if(!art){ sel.innerHTML=`<option value="">Ninguna</option>`; return; }
  const ofs=[...new Set(MODTK.filter(t=>t.estado==='ACTIVO' && norm(t.articulo)===art).map(t=>norm(t.of)).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"es"));
  sel.innerHTML=`<option value="">Ninguna</option>`+ofs.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join("");
  if(prev && ofs.includes(prev)) sel.value=prev;
}
function onArtModInput(){ renderArtDrop(); poblarOfMod(); pintarMod(); }
/* Lee la hoja OF (meta por OF). Devuelve { OF(normalizada): cantidadMeta }. */
async function cargarMetaOF(area){
  const cfg = AREAS[area];
  if(!cfg || !cfg.hojaOF || !cfg.sheetId) return {};
  const url = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.hojaOF)}`;
  const r = await fetch(url);
  if(!r.ok) return {};
  const filas = parseCSV(await r.text());
  if(filas.length<2) return {};
  let iOf=-1, iCant=-1;
  filas[0].forEach((h,i)=>{ const k=normKey(h);
    if(k==="OF") iOf=i; if(k==="CANTPROG"||k==="META"||k==="CANTIDAD") iCant=i; });
  if(iOf<0 || iCant<0) return {};
  const m={};
  for(let i=1;i<filas.length;i++){
    const of=normKey(filas[i][iOf]); if(!of) continue;
    m[of]=parseFloat(String(filas[i][iCant]).replace(/[^\d.]/g,""))||0;
  }
  return m;
}
/* Mayor N°OP (última operación) por artículo+módulo, desde BASE del área. */
function ultimaOpModulo(area, articulo, modulo){
  const ka=normKey(articulo), km=normKey(modulo); let mx=null;
  (BASES_CACHE[area]||[]).forEach(b=>{
    if(normKey(b.articulo)===ka && normKey(b.modulo)===km){
      const n=Number(b.n_op); if(!isNaN(n) && (mx===null || n>mx)) mx=n;
    }
  });
  return mx;
}
/* Nombre exacto de la última operación (mayor N°OP) del módulo, desde BASE. */
function ultimaOpNombreModulo(area, articulo, modulo){
  const ka=normKey(articulo), km=normKey(modulo); let mx=null, nom="";
  (BASES_CACHE[area]||[]).forEach(b=>{
    if(normKey(b.articulo)===ka && normKey(b.modulo)===km){
      const n=Number(b.n_op); if(!isNaN(n) && (mx===null || n>mx)){ mx=n; nom=norm(b.operacion); }
    }
  });
  return nom;
}
/* Módulos cerrados: ingeniería bloquea el reclamo de tickets de un módulo. */
let MOD_CERRADOS=new Set(), MOD_GRUPOS=[];
async function cargarModCerrados(){
  try{
    const r=await rpc("fn_modulos_cerrados_listar",{p_dni:ING.dni,p_token:ING.token,p_area:modArea});
    MOD_CERRADOS = new Set((Array.isArray(r)?r:[]).map(x=>normKey(x.of)+"||"+normKey(x.modulo)));
  }catch(e){ MOD_CERRADOS=new Set(); }
}
function modEstaCerrado(of, mod){ return MOD_CERRADOS.has(normKey(of)+"||"+normKey(mod)); }
async function toggleModulo(idx, cerrar){
  const g=MOD_GRUPOS[idx]; if(!g) return;
  const accion = cerrar ? "cerrar" : "liberar";
  if(!confirm(`¿Deseas ${accion} el módulo "${g.mod}" de la OF ${g.of}?\n`
    + (cerrar ? "Nadie podrá reclamar sus tickets hasta que lo liberes." : "Se podrán volver a reclamar sus tickets."))) return;
  try{
    const r=await rpc("fn_modulo_cerrar",{p_dni:ING.dni,p_token:ING.token,p_area:modArea,p_of:g.of,p_modulo:g.mod,p_cerrar:cerrar});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    await cargarModCerrados(); pintarMod();
  }catch(e){ mostrarError(e.message); }
}
function pintarMod(){
  if(!modArea) return;
  // Cascada estricta: no se muestra nada hasta elegir Artículo y luego una OF.
  const art = modArtActual();
  const of  = $("ofModSel") ? $("ofModSel").value : "";
  if(!art || !of){
    $("resumenMod").textContent = `${modArea} · elige artículo y OF`;
    $("zonaModulos").innerHTML = `<div class="vacio-msg">Elige un artículo y luego una OF para ver los módulos.</div>`;
    return;
  }
  const activos = MODTK.filter(t=>t.estado==='ACTIVO' && t.area===modArea
    && norm(t.articulo)===art && normKey(t.of)===normKey(of));
  // Agrupar por OF · módulo
  const grp={};
  activos.forEach(t=>{
    const mod = norm(t.modulo)||"(sin módulo)";
    const of = norm(t.of)||"(sin OF)";
    const key = of+" · "+mod;
    const g = grp[key] = grp[key] || {of, mod, articulo:norm(t.articulo), ops:{}, ultima:0, tks:0};
    const opName = norm(t.op)||"(sin operación)";
    const op = g.ops[opName] = g.ops[opName] || {cant:0, personas:{}};
    const c = Number(t.cant)||0;
    op.cant += c; g.tks++;
    const p = op.personas[t.dni] = op.personas[t.dni] || {nombre:t.nombre, cant:0};
    p.cant += c;
    const lastNop = ultimaOpModulo(modArea, t.articulo, mod);
    if(lastNop!=null && Number(t.nop)===lastNop) g.ultima += c;
  });
  const claves=Object.keys(grp).sort((a,b)=>a.localeCompare(b,"es"));
  MOD_GRUPOS = claves.map(k=>grp[k]);   // referencia por índice para cerrar/abrir
  $("resumenMod").textContent = `${modArea} · ${claves.length} módulo(s) con actividad · ${activos.length} tickets`;
  if(!claves.length){ $("zonaModulos").innerHTML=`<div class="vacio-msg">Sin tickets activos para esta área/OF</div>`; return; }
  $("zonaModulos").innerHTML = claves.map((k,idx)=>{
    const g=grp[k];
    const meta = MOD_META[normKey(g.of)] || 0;
    const pct = meta>0 ? Math.min(100, Math.round(g.ultima/meta*100)) : null;
    const ops=Object.keys(g.ops).sort((a,b)=>a.localeCompare(b,"es"));
    const lastOp = ultimaOpNombreModulo(modArea, g.articulo, g.mod);
    const cerrado = modEstaCerrado(g.of, g.mod);
    const barra = pct==null
      ? `<div class="avance-nometa">Sube el balance/OF para calcular el avance</div>`
      : `<div class="avance-bar"><div class="avance-fill ${pct>=80?'alto':pct<40?'bajo':''}" style="width:${pct}%"></div>
           <span class="avance-lbl">${pct}%</span></div>`;
    const metaTxt = pct==null ? ""
      : `<div class="avance-sub">${Math.round(g.ultima)} de ${Math.round(meta)} und · última op.: <b>${esc(lastOp||"—")}</b></div>`;
    return `<div class="mod-card${cerrado?' mod-cerrado':''}">
      <div class="mod-head-fija">
        <div class="mod-head-top">
          <div class="mod-nombre">${esc(g.mod)}${cerrado?' <span class="mod-badge-cerrado">CERRADO</span>':''}</div>
          <button class="btn-mini ${cerrado?'verde':'rojo'}" onclick="toggleModulo(${idx}, ${cerrado?'false':'true'})">${cerrado?'Liberar módulo':'Cerrar módulo'}</button>
        </div>
        <div class="mod-sub">OF ${esc(g.of)} · ${esc(g.articulo)} · ${ops.length} operación(es) · ${g.tks} tickets</div>
        <div class="mod-avance">${barra}${metaTxt}</div>
      </div>
      <details class="mod-ops">
        <summary>Ver operaciones (${ops.length})</summary>
        <div class="mod-ops-body">
        ${ops.map(opName=>{
          const op=g.ops[opName];
          const personas=Object.values(op.personas).sort((a,b)=>b.cant-a.cant);
          return `<details class="mod-op">
            <summary class="mod-op-head"><span class="mod-op-nom">${esc(opName)}</span>
              <span class="mod-op-sub">${Math.round(op.cant)} und · ${personas.length} operario(s)</span></summary>
            ${personas.map(p=>`<div class="mod-persona">
              <div class="mp-cab"><b>${esc(soloApellidos(p.nombre))}</b><span>${Math.round(p.cant)} und</span></div>
            </div>`).join("")}
          </details>`;
        }).join("")}
        </div>
      </details>
    </div>`;
  }).join("");
}

/* ================= EFICIENCIAS ================= */
let EF=null, efSort={col:null,dir:1};
const EF_COLS=[
  {k:"nombre",t:"Nombre"},{k:"dni",t:"DNI"},{k:"area",t:"Área"},{k:"estado",t:"Estado"},
  {k:"tickets",t:"Tickets"},{k:"prod",t:"Min prod"},{k:"disp",t:"Min disp"},{k:"eficiencia",t:"Eficiencia"}
];

async function cargarEf(){
  $("tablaEf").innerHTML=""; $("efAreas").innerHTML=cargandoHTML("Calculando…");
  try{
    const r = await rpc("fn_eficiencia_dia",{p_dni:ING.dni,p_token:ING.token,p_fecha:$("fechaEf").value});
    if(!r.ok){ mostrarError(r.error||"Error"); $("efAreas").innerHTML=""; return; }
    EF = r;
    pintarEf();
  }catch(e){ $("efAreas").innerHTML=""; mostrarError(e.message); }
}
function ordenarEf(col){
  if(efSort.col===col) efSort.dir*=-1; else efSort={col,dir:1};
  pintarEf();
}
function pintarEf(){
  if(!EF) return;
  const fArea = $("filtroAreaEf").value;
  // Gating: sin área elegida no se muestran datos.
  if(!fArea){
    $("efGate").style.display = "block";
    $("efContenido").hidden = true;
    return;
  }
  $("efGate").style.display = "none";
  $("efContenido").hidden = false;

  $("efAreas").innerHTML = (EF.areas||[]).filter(a=>a.area===fArea).map(a=>`
    <div class="kpi"><div class="kpi-num">${censEf(Math.round(a.eficiencia)+"%")}</div>
    <div class="kpi-lbl">${esc(a.area)}<br>${Math.round(a.prod)} / ${Math.round(a.disp)} min</div></div>`).join("")
    || '<div class="vacio-msg">Sin datos ese día para esta área</div>';

  let lista = (EF.personas||[]).filter(p=>p.area===fArea);
  const cmp = (a,b)=>{
    if(!efSort.col) return String(a.nombre||"").localeCompare(String(b.nombre||""),"es");
    const va=a[efSort.col], vb=b[efSort.col];
      const c=cmpVal(va,vb);
    return c*efSort.dir;
  };
  const flecha = k => efSort.col===k ? (efSort.dir===1?" \u25B2":" \u25BC") : "";
  const thead = "<thead><tr>"+EF_COLS.map(c=>
    `<th class="ord" onclick="ordenarEf('${c.k}')">${c.t}${flecha(c.k)}</th>`).join("")+"</tr></thead>";
  // Áreas bien separadas: agrupadas con encabezado de área.
  const porArea={};
  lista.forEach(p=>{ (porArea[p.area]=porArea[p.area]||[]).push(p); });
  const areas=Object.keys(porArea).sort((a,b)=>String(a).localeCompare(String(b),"es"));
  let tbody="";
  if(!lista.length){
    tbody = `<tr><td colspan="8"><div class="vacio-msg">Sin personas para este filtro</div></td></tr>`;
  } else {
    areas.forEach(area=>{
      const gente=[...porArea[area]].sort(cmp);
      tbody += `<tr class="grupo-area"><td colspan="8">${esc(area)} · ${gente.length} persona(s)</td></tr>`;
      tbody += gente.map(p=>`
        <tr><td>${esc(p.nombre)}</td><td>${esc(p.dni)}</td><td>${esc(p.area)}</td>
        <td><span class="pill ${esc(p.estado)}">${esc(p.estado)}</span></td>
        <td>${p.tickets}</td><td>${p.prod}</td><td>${p.disp}</td>
        <td class="${p.eficiencia>=80?'ef-alta':p.eficiencia<50?'ef-baja':''}">${censEf(Math.round(p.eficiencia)+"%")}</td></tr>`).join("");
    });
  }
  $("tablaEf").innerHTML = thead + "<tbody>" + tbody + "</tbody>";
}
/* Meta por DNI (área origen + categoría) para los Excel — parche 34.
   Va por su propio RPC para no reescribir fn_eficiencia_dia/_rango. */
let PMETA=null;
async function cargarPersonalMeta(){
  if(PMETA) return PMETA;
  try{ const r=await rpc("fn_personal_meta",{p_dni:ING.dni,p_token:ING.token});
       PMETA=(r&&r.ok===false)?{}:(r||{}); }
  catch(e){ PMETA={}; }
  return PMETA;
}
const pmOrigen=d=>(PMETA&&PMETA[d]&&PMETA[d].origen)||"";
const pmCat   =d=>(PMETA&&PMETA[d]&&PMETA[d].categoria)||"";

async function descargarEf(){
  if(!EF){ mostrarError("Carga la eficiencia primero"); return; }
  const fArea=$("filtroAreaEf").value; if(!fArea){ mostrarError("Elige un área"); return; }
  const lista=(EF.personas||[]).filter(p=>p.area===fArea);
  if(!lista.length){ mostrarError("No hay datos para descargar"); return; }
  await cargarPersonalMeta();
  const CAB=["Nombre","DNI","Área Actual","Área Origen","Categoría","Estado","Tickets","Min prod","Min disp","Eficiencia %"];
  const filas=lista.map(p=>[p.nombre,p.dni,p.area,pmOrigen(p.dni),pmCat(p.dni),
    p.estado,p.tickets,p.prod,p.disp,Math.round(p.eficiencia)]);
  const ws=XLSX.utils.aoa_to_sheet([CAB,...filas]); const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Eficiencia"); XLSX.writeFile(wb,`EFICIENCIA_${fArea}_${$("fechaEf").value}.xlsx`);
}

/* ================= EFICIENCIA DÍA × DÍA POR RANGO ================= */
let EFR={dias:[],personal:[]}, efRangoSel={desde:null,hasta:null};
let efrSort={col:null,dir:1};
function ordenarEfR(col){
  if(efrSort.col===col) efrSort.dir*=-1; else efrSort={col,dir:1};
  pintarEfRango();
}

async function cargarEfRango(){
  if(!efRangoSel.desde || !efRangoSel.hasta){ mostrarError("Selecciona un rango de fechas"); return; }
  $("tablaEfR").innerHTML = cargandoHTML("Calculando eficiencia del rango…");
  $("resumenEfR").textContent = "";
  try{
    const res = await rpc("fn_eficiencia_rango",{p_dni:ING.dni,p_token:ING.token,
      p_desde:efRangoSel.desde, p_hasta:efRangoSel.hasta, p_area:$("filtroAreaEfR").value});
    if(!res.ok){ mostrarError(res.error||"Error"); $("tablaEfR").innerHTML=""; return; }
    EFR = {dias:res.dias, personal:res.personal};
    $("resumenEfR").textContent = `${EFR.personal.length} persona(s) · ${EFR.dias.length} día(s) · ${efRangoSel.desde} a ${efRangoSel.hasta}`;
    pintarEfRango();
  }catch(e){ $("tablaEfR").innerHTML=""; mostrarError(e.message); }
}

function efClase(v){ return v>=80?'ef-alta':(v<50?'ef-baja':''); }

function pintarEfRango(){
  const q = normKey($("filtroNomEfR").value);
  const lista = EFR.personal.filter(p=>!q || normKey(p.nombre).includes(q));

  // Ordenamiento por clic en encabezado (asc/desc). Columnas: nombre, cada día
  // (por su fecha ISO) y promedio. Los días sin dato van siempre al final.
  if(efrSort.col){
    const col=efrSort.col, dir=efrSort.dir;
    lista.sort((a,b)=>{
      if(col==='__nombre') return String(a.nombre||"").localeCompare(String(b.nombre||""),"es")*dir;
      let va = col==='__prom' ? a.promedio : a.registros[col];
      let vb = col==='__prom' ? b.promedio : b.registros[col];
      const na=(va==null||va==="")?null:parseFloat(va);
      const nb=(vb==null||vb==="")?null:parseFloat(vb);
      if(na==null && nb==null) return 0;
      if(na==null) return 1;
      if(nb==null) return -1;
      return (na-nb)*dir;
    });
  }

  const flecha=k=>efrSort.col===k?(efrSort.dir===1?" ▲":" ▼"):"";
  let thead = `<thead><tr><th class="col-nombre-solo ord" onclick="ordenarEfR('__nombre')">Nombre${flecha('__nombre')}</th>`;
  EFR.dias.forEach(d=>{ thead += `<th class="ord" onclick="ordenarEfR('${d}')">${d.slice(8,10)}-${d.slice(5,7)}${flecha(d)}</th>`; });
  thead += `<th class="ord" onclick="ordenarEfR('__prom')">Prom.${flecha('__prom')}</th></tr></thead>`;

  let tbody = "<tbody>";
  if(!lista.length){
    tbody += `<tr><td colspan="${EFR.dias.length+2}"><div class="vacio-msg">Sin personal para este filtro</div></td></tr>`;
  }
  lista.forEach(p=>{
    tbody += `<tr>
      <td class="col-nombre-solo">
        <div>${esc(p.nombre)}</div>
        <div style="font-size:11px;color:#5a6270;font-weight:600">DNI ${esc(p.dni)} · ${esc(p.area)}</div>
      </td>`;
    EFR.dias.forEach(d=>{
      const v = p.registros[d];
      const est = p.estados ? p.estados[d] : null;
      if(v!=null) tbody += `<td class="${efClase(v)}">${censEf(v)}</td>`;
      else if(est) tbody += `<td><span class="pill ${esc(est)}" style="font-size:10px;">${esc(est)}</span></td>`;
      else tbody += `<td>\u2014</td>`;
    });
    tbody += `<td class="${efClase(p.promedio)}"><b>${censEf(p.promedio+"%")}</b></td>`;
    tbody += `</tr>`;
  });
  tbody += "</tbody>";
  $("tablaEfR").innerHTML = thead + tbody;
}

async function descargarEfRango(){
  if(!EFR.personal.length){ mostrarError("Carga primero un rango"); return; }
  await cargarPersonalMeta();
  // Igual que la tabla: cada celda es "XX%" (texto), o el estado (FALTA, VACACIONES…)
  // como texto. Donde antes iba "—" y el día es fin de semana, ahora se rotula
  // SABADO/DOMINGO: solo etiqueta, ningún cálculo cambia. Si alguien sí trabajó
  // ese día, manda su porcentaje. "T00:00:00" evita el corrimiento por UTC.
  const FINDE={0:"DOMINGO",6:"SABADO"};
  const finde=d=>FINDE[new Date(d+"T00:00:00").getDay()]||"";
  const celda=(v,est,d)=> v!=null ? `${Math.round(v)}%` : (est || finde(d) || "—");
  const CAB = ["DNI","Nombre","Área Actual","Área Origen","Categoría",
    ...EFR.dias.map(d=>d.slice(8,10)+"-"+d.slice(5,7)), "Promedio"]; // DD-MM
  const filas = EFR.personal.map(p=>[
    p.dni, p.nombre, p.area, pmOrigen(p.dni), pmCat(p.dni),
    ...EFR.dias.map(d=>celda(p.registros[d], p.estados ? p.estados[d] : null, d)),
    `${Math.round(p.promedio)}%`
  ]);
  const ws = XLSX.utils.aoa_to_sheet([CAB, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "EficienciaRango");
  XLSX.writeFile(wb, `EFICIENCIA_${efRangoSel.desde}_a_${efRangoSel.hasta}.xlsx`);
}

/* ================= EFICIENCIA · MÓDULOS DEL DÍA (visión) ================= */
let MODEF={items:[],personas:0,total:0,ef:0}, modEfSort={col:"minutos",dir:-1};
function ordenarModEf(col){ if(modEfSort.col===col) modEfSort.dir*=-1; else modEfSort={col,dir:1}; pintarModEf(); }
async function cargarModEf(){
  const area=$("areaModEf")?$("areaModEf").value:"";
  const gate=$("modEfGate"), cont=$("modEfContenido");
  if(!area){ if(gate) gate.style.display="block"; if(cont) cont.hidden=true; return; }
  if(gate) gate.style.display="none"; if(cont) cont.hidden=false;
  const f=$("fechaModEf"); if(f&&!f.value) f.value=hoyLima();
  $("tablaModEf").innerHTML=cargandoHTML("Calculando módulos…");
  try{
    const r=await rpc("fn_avance_modulos",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_fecha:(f?f.value:null)});
    if(!r.ok){ mostrarError(r.error||"Error"); $("tablaModEf").innerHTML=""; return; }
    MODEF={items:r.items||[],personas:r.personas||0,total:r.total_min||0,ef:r.eficiencia||0};
    pintarModEf();
  }catch(e){ $("tablaModEf").innerHTML=""; mostrarError(e.message); }
}
function pintarModEf(){
  const kpi=(t,v)=>`<div class="kpi"><div class="kpi-num">${v}</div><div class="kpi-lbl">${t}</div></div>`;
  $("modEfResumen").innerHTML =
    kpi("Personas del área", MODEF.personas)+
    kpi("Minutaje total", Math.round(MODEF.total))+
    kpi("Eficiencia del área", censEf(MODEF.ef+"%"))+
    kpi("Módulos", MODEF.items.length);
  let lista=[...MODEF.items];
  if(modEfSort.col){
    lista.sort((a,b)=>{
      const va=a[modEfSort.col], vb=b[modEfSort.col];
      const c=cmpVal(va,vb);
      return c*modEfSort.dir;
    });
  }
  const flecha=k=>modEfSort.col===k?(modEfSort.dir===1?" ▲":" ▼"):"";
  const thead=`<thead><tr>
    <th class="ord izq" onclick="ordenarModEf('modulo')">Módulo${flecha('modulo')}</th>
    <th class="ord" onclick="ordenarModEf('minutos')">Minutaje total${flecha('minutos')}</th>
    <th class="ord" onclick="ordenarModEf('eficiencia')">Eficiencia${flecha('eficiencia')}</th></tr></thead>`;
  const body = lista.length
    ? lista.map(o=>`<tr><td class="izq">${esc(o.modulo)}</td><td><b>${Math.round(o.minutos)}</b></td>
        <td class="${efClase(o.eficiencia)}">${censEf(o.eficiencia+"%")}</td></tr>`).join("")
    : `<tr><td colspan="3"><div class="vacio-msg">Sin módulos trabajados ese día</div></td></tr>`;
  $("tablaModEf").innerHTML=thead+"<tbody>"+body+"</tbody>";
}

async function cargarEstadosAsis(){
  try{
    ESTADOS_ASIS = await rpc("fn_estados_asistencia_listar",{p_dni:ING.dni,p_token:ING.token});
  }catch(e){ ESTADOS_ASIS = []; }
}

/* ================= MODAL genérico ================= */
function abrirModal(html){
  $("modalBox").innerHTML = html;
  $("modalOverlay").classList.add("visible");
}
function cerrarModal(){
  $("modalOverlay").classList.remove("visible");
  $("modalBox").innerHTML = "";
}

/* ---- Modal: crear / editar personal ---- */
async function abrirModalPersonal(dni){
  let datos = {dni:"", nombres_apellidos:"", area_origen:AREAS_LISTA[0]||"", area_actual:AREAS_LISTA[0]||"",
    estado:"ACTIVO", cargo:"OPERARIO", categoria:""};
  const esEdicion = !!dni;
  if(esEdicion){
    abrirModal(cargandoHTML("Cargando datos…"));
    try{
      const r = await rpc("fn_personal_detalle",{p_dni_ing:ING.dni,p_token:ING.token,p_dni:dni});
      if(!r.ok){ mostrarError(r.error||"No se pudo cargar"); cerrarModal(); return; }
      datos = r;
    }catch(e){ mostrarError(e.message); cerrarModal(); return; }
  }
  // Incluye siempre el área real del registro aunque no esté en AREAS_LISTA,
  // para que el select no caiga en la primera opción por defecto al editar.
  const areasSel = [...new Set([datos.area_origen, datos.area_actual, ...AREAS_LISTA])].filter(Boolean);
  const html = `
    <h2>${esEdicion? "Editar personal":"Agregar personal"}</h2>
    <div class="modal-campo">
      <label>DNI / Usuario</label>
      <input id="mpDni" value="${esc(datos.dni)}" ${esEdicion?"disabled":""} maxlength="15">
    </div>
    <div class="modal-campo">
      <label>Nombres y apellidos</label>
      <input id="mpNombres" value="${esc(datos.nombres_apellidos)}" maxlength="120">
    </div>
    <div class="modal-2col">
      <div class="modal-campo">
        <label>Área origen</label>
        <select id="mpAreaOrigen">${areasSel.map(a=>`<option ${a===datos.area_origen?"selected":""}>${esc(a)}</option>`).join("")}</select>
      </div>
      <div class="modal-campo">
        <label>Área actual</label>
        <select id="mpAreaActual">${areasSel.map(a=>`<option ${a===datos.area_actual?"selected":""}>${esc(a)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="modal-2col">
      <div class="modal-campo">
        <label>Estado</label>
        <select id="mpEstado">${ESTADOS_OPERARIO.map(e=>`<option ${e===datos.estado?"selected":""}>${esc(e)}</option>`).join("")}</select>
      </div>
      <div class="modal-campo">
        <label>Cargo</label>
        <select id="mpCargo">${CARGOS_LISTA.map(c=>`<option ${c===datos.cargo?"selected":""}>${esc(c)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="modal-campo">
      <label>Categoría</label>
      <select id="mpCategoria">${CATEGORIAS_LISTA.map(c=>
        `<option value="${esc(c)}" ${c===(datos.categoria||"")?"selected":""}>${c||"— sin asignar —"}</option>`).join("")}</select>
    </div>
    <div class="modal-msg" id="mpMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarPersonal(${esEdicion?`'${esc(datos.dni)}'`:"null"})">GUARDAR</button>
      ${esEdicion?`<button class="btn-pin" onclick="resetearPin('${esc(datos.dni)}')">RESETEAR PIN</button>`:""}
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`;
  abrirModal(html);
}

async function guardarPersonal(dniOriginal){
  const dni = dniOriginal || $("mpDni").value.trim();
  const nombres = $("mpNombres").value.trim();
  const areaOrigen = $("mpAreaOrigen").value;
  const areaActual = $("mpAreaActual").value;
  const estado = $("mpEstado").value;
  const cargo = $("mpCargo").value;
  const categoria = $("mpCategoria").value;
  if(!dni || !nombres){ $("mpMsg").textContent = "DNI y nombres son obligatorios"; return; }
  try{
    let r;
    if(dniOriginal){
      r = await rpc("fn_personal_editar",{p_dni_ing:ING.dni,p_token:ING.token,
        p_dni:dni,p_nombres:nombres,p_area_origen:areaOrigen,p_area_actual:areaActual,
        p_estado:estado,p_cargo:cargo,p_categoria:categoria});
    } else {
      r = await rpc("fn_personal_crear",{p_dni_ing:ING.dni,p_token:ING.token,
        p_dni:dni,p_nombres:nombres,p_area_origen:areaOrigen,p_area_actual:areaActual,
        p_estado:estado,p_cargo:cargo,p_categoria:categoria});
    }
    if(!r.ok){ $("mpMsg").textContent = r.error||"No se pudo guardar"; return; }
    PMETA=null;   // cambió área origen o categoría: el Excel debe releerlas
    cerrarModal();
    AREAS_DB=null; AREAS_LISTA = await cargarAreasDB(); poblarSelectsArea();  // por si se creó un área nueva
    await perReload();
  }catch(e){ $("mpMsg").textContent = e.message; }
}

async function resetearPin(dni){
  if(!confirm("¿Resetear el PIN de este operario?")) return;
  try{
    const r = await rpc("fn_personal_resetear_pin",{p_dni_ing:ING.dni,p_token:ING.token,p_dni:dni});
    if(!r.ok){ $("mpMsg").textContent = r.error||"No se pudo resetear"; return; }
    $("mpMsg").style.color = "var(--exito)";
    $("mpMsg").textContent = "PIN reseteado a " + r.pin_nuevo;
  }catch(e){ $("mpMsg").textContent = e.message; }
}

/* ================= PERSONAL (CRUD · estados · dashboard · marcar) ================= */
let PER={tab:"crud",crud:[],crudSel:{},rango:[],rangoSel:{},matriz:{dias:[],personal:[]},matSel:{desde:null,hasta:null},
  dash:null,dashSel:{desde:null,hasta:null},alPage:1,
  marcarArea:"",chartLine:null,chartPie:null,fpReady:false};
function perInit(){
  { const d=$("perRangoDesde"),h=$("perRangoHasta"); if(d&&!d.value)d.value=hoyISO(); if(h&&!h.value)h.value=hoyISO(); }
  { const f=$("perMarcarFecha"); if(f&&!f.value) f.value=hoyISO(); }
  if(!PER.fpReady && window.flatpickr){
    if($("perMatRango")){
      const hoy=new Date(), lun=new Date(hoy); lun.setDate(hoy.getDate()-((hoy.getDay()+6)%7)); // lunes de la semana actual
      const vie=new Date(lun); vie.setDate(lun.getDate()+4);                                     // viernes
      PER.matSel.desde=lun.toLocaleDateString("sv-SE"); PER.matSel.hasta=vie.toLocaleDateString("sv-SE");
      flatpickr("#perMatRango",{mode:"range",dateFormat:"Y-m-d",defaultDate:[PER.matSel.desde,PER.matSel.hasta],locale:{rangeSeparator:" a "},
        onChange:ds=>{ if(ds.length>=1){ PER.matSel.desde=ds[0].toLocaleDateString("sv-SE"); PER.matSel.hasta=(ds[1]||new Date()).toLocaleDateString("sv-SE"); } }});
    }
    PER.fpReady=true;
  }
  perTab(PER.tab||"crud");
}
function perReload(){
  if(PER.tab==="crud") perCargarCrud();
  else if(PER.tab==="rango") perCargarRango();
  else if(PER.tab==="matriz") perCargarMatriz();
  else if(PER.tab==="marcar") perMarcarInit();
}
function perTab(t){
  PER.tab=t;
  [["crud","perCrud","perTabCrud"],["rango","perRango","perTabRango"],["matriz","perMatriz","perTabMatriz"],
   ["marcar","perMarcar","perTabMarcar"],["mov","perMov","perTabMov"]]
    .forEach(x=>{ if($(x[1])) $(x[1]).hidden=x[0]!==t; if($(x[2])) $(x[2]).classList.toggle("activo",x[0]===t); });
  if(t==="mov"){ if($("movFecha")&&!$("movFecha").value) $("movFecha").value=hoyISO(); cargarMovs(); return; }
  perReload();
}

/* ===== Movimientos de área (parche 33) =====
   `_disp_prorrateado` reparte los 575 min del día usando la HORA del movimiento.
   Si se movió a alguien a destiempo, esa hora era intocable y los minutos
   quedaban mal repartidos; aquí se corrige. */
let MOVS=[];
async function cargarMovs(){
  const area=$("movArea")?$("movArea").value:"", fecha=$("movFecha")?$("movFecha").value:"";
  if(!fecha){ $("movTabla").innerHTML=""; $("movResumen").textContent="Elige la fecha"; return; }
  $("movTabla").innerHTML=cargandoHTML("Cargando…");
  try{
    const r=await rpc("fn_movimientos_listar",{p_dni:ING.dni,p_token:ING.token,p_area:area||"",p_fecha:fecha});
    if(r && r.ok===false){ mostrarError(r.error||"Error"); $("movTabla").innerHTML=""; return; }
    MOVS=Array.isArray(r)?r:[]; pintarMovs();
  }catch(e){ $("movTabla").innerHTML=""; mostrarError(e.message); }
}
function pintarMovs(){
  $("movResumen").textContent=`${MOVS.length} movimiento(s) · la hora reparte los 575 min del día entre las áreas`;
  const body=MOVS.length? MOVS.map((m,i)=>`<tr>
      <td class="izq"><b>${esc(soloApellidos(m.nombre))}</b></td>
      <td>${esc(m.desde_area||"—")}</td><td>${esc(m.hacia_area)}</td>
      <td><input type="date" id="mvF${i}" value="${esc(m.fecha||"")}" style="max-width:140px;"></td>
      <td><input type="time" id="mvH${i}" value="${esc(m.hora)}" style="max-width:110px;"></td>
      <td>${m.min_origen==null?"—":m.min_origen+" min"}</td>
      <td>${m.min_destino} min</td>
      <td class="izq">${esc(soloApellidos(m.movido_por||"—"))}</td>
      <td><button class="btn-mini verde" onclick="guardarMovHora(${i})">Guardar</button>
          <button class="btn-mini rojo" onclick="eliminarMov(${i})">Deshacer</button></td>
    </tr>`).join("")
    : `<tr><td colspan="9"><div class="vacio-msg">Sin movimientos de área en esa fecha</div></td></tr>`;
  $("movTabla").innerHTML=`<thead><tr><th class="izq">Persona</th><th>Desde</th><th>Hacia</th>
    <th>Fecha</th><th>Hora</th><th>Min. origen</th><th>Min. destino</th><th class="izq">Movido por</th><th></th></tr></thead>
    <tbody>${body}</tbody>`;
}
async function guardarMovHora(i){
  const m=MOVS[i]; if(!m) return;
  const h=(($("mvH"+i)||{}).value||"").trim();
  const f=(($("mvF"+i)||{}).value||"").trim() || m.fecha;
  if(!h){ mostrarError("Indica la hora"); return; }
  if(h===m.hora && f===m.fecha){ mostrarOk("Sin cambios"); return; }
  // Cambiar de día mueve el reparto de minutos de los DOS días: se avisa.
  if(f!==m.fecha && !confirm(`¿Mover el movimiento de ${soloApellidos(m.nombre)} del ${m.fecha} al ${f}?
`
    + `Se recalculan los minutos de los dos días.`)) return;
  try{
    const r=await rpc("fn_movimiento_hora",{p_dni:ING.dni,p_token:ING.token,p_id:m.id,p_hora:h,p_fecha:f});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    mostrarOk(`${soloApellidos(m.nombre)} · ${r.fecha} ${h} · ${r.min_origen==null?"":r.min_origen+" min en "+m.desde_area+" y "}${r.min_destino} min en ${m.hacia_area}`
      + (r.fecha_anterior?` · se recalculó también el ${r.fecha_anterior}`:""));
    cargarMovs();
  }catch(e){ mostrarError(e.message); }
}
async function eliminarMov(i){
  const m=MOVS[i]; if(!m) return;
  if(!confirm(`¿Deshacer el movimiento de ${soloApellidos(m.nombre)} (${m.desde_area||"—"} → ${m.hacia_area}, ${m.hora})?\n`
    + `Si es su último movimiento, vuelve a ${m.desde_area||"su área anterior"}.`)) return;
  try{
    const r=await rpc("fn_movimiento_eliminar",{p_dni:ING.dni,p_token:ING.token,p_id:m.id});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    mostrarOk(r.revertido?`Deshecho · vuelve a ${m.desde_area}`:"Movimiento eliminado");
    cargarMovs();
  }catch(e){ mostrarError(e.message); }
}

/* --- CRUD --- */
async function perCargarCrud(){
  $("perTablaCrud").innerHTML=cargandoHTML("Cargando personal…");
  try{
    const r=await rpc("fn_personal_listar",{p_dni_ing:ING.dni,p_token:ING.token,p_area:$("perArea").value,p_incluir_inactivos:$("perInactivos").checked});
    if(!r.ok){ mostrarError(r.error||"Error"); $("perTablaCrud").innerHTML=""; return; }
    PER.crud=r.personal||[]; PER.crudSel={}; perNSelUpd(); perPintarCrud();
  }catch(e){ $("perTablaCrud").innerHTML=""; mostrarError(e.message); }
}
function perNSelUpd(){ $("perNSel").textContent=Object.keys(PER.crudSel).length; }
function perLimpiarSel(){ PER.crudSel={}; perNSelUpd(); perPintarCrud(); }
function perToggleSel(dni){ if(PER.crudSel[dni]) delete PER.crudSel[dni]; else PER.crudSel[dni]=true; perNSelUpd(); }
let perCrudSort={col:null,dir:1};
function ordenarPerCrud(col){ if(perCrudSort.col===col) perCrudSort.dir*=-1; else perCrudSort={col,dir:1}; perPintarCrud(); }
function perPintarCrud(){
  const q=normKey($("perBuscar").value);
  let lista=PER.crud.filter(p=>!q||normKey(p.nombre+" "+p.dni).includes(q));
  if(perCrudSort.col){ const c=perCrudSort.col; lista=[...lista].sort((a,b)=>{ return cmpVal(a[c],b[c])*perCrudSort.dir; }); }
  $("perResumenCrud").textContent=`${lista.length} persona(s)`;
  const fl=k=>perCrudSort.col===k?(perCrudSort.dir===1?" ▲":" ▼"):"";
  const C=[["nombre","Nombre"],["dni","DNI"],["area_actual","Área actual"],["area_origen","Área origen"],["categoria","Cat."],["cargo","Cargo"],["estado","Estado"]];
  const thead=`<thead><tr><th class="col-check"></th>${C.map(c=>`<th class="ord${c[0]==="nombre"?" izq":""}" onclick="ordenarPerCrud('${c[0]}')">${c[1]}${fl(c[0])}</th>`).join("")}<th></th></tr></thead>`;
  const body=lista.length? lista.map(p=>`<tr${p.estado!=="ACTIVO"?' style="opacity:.6;"':''}>
      <td class="col-check"><input type="checkbox" class="sw" ${PER.crudSel[p.dni]?"checked":""} onclick="perToggleSel('${esc(p.dni)}')"></td>
      <td class="izq"><b>${esc(p.nombre)}</b></td><td>${esc(p.dni)}</td>
      <td>${esc(p.area_actual)}</td><td>${esc(p.area_origen||"—")}</td>
      <td>${p.categoria?`<b>${esc(p.categoria)}</b>`:"—"}</td><td>${esc(p.cargo)}</td>
      <td><span class="pill ${esc(p.estado)}">${esc(p.estado)}</span></td>
      <td><button class="acc-editar" onclick="abrirModalPersonal('${esc(p.dni)}')">Editar</button></td></tr>`).join("")
    : `<tr><td colspan="9"><div class="vacio-msg">Sin personal</div></td></tr>`;
  $("perTablaCrud").innerHTML=thead+"<tbody>"+body+"</tbody>";
}
async function perMoverArea(){
  const dnis=Object.keys(PER.crudSel);
  if(!dnis.length){ mostrarError("Selecciona al menos una persona"); return; }
  const destino=$("perMoverArea").value; if(!destino){ mostrarError("Elige el área destino"); return; }
  if(!confirm(`¿Mover ${dnis.length} persona(s) a ${destino}?`)) return;
  try{
    const r=await rpc("fn_cambiar_area",{p_dni:ING.dni,p_token:ING.token,p_dnis:dnis,p_area:destino});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    mostrarOk(`${dnis.length} movida(s) a ${destino}`); await perCargarCrud();
  }catch(e){ mostrarError(e.message); }
}

/* --- Estados por rango --- */
async function perCargarRango(){
  $("perRangoEstado").innerHTML=(ESTADOS_ASIS||[]).map(e=>`<option>${esc(e)}</option>`).join("")||'<option value="">Sin estados</option>';
  $("perRangoList").innerHTML=cargandoHTML("Cargando personal…");
  try{
    const r=await rpc("fn_personal_listar",{p_dni_ing:ING.dni,p_token:ING.token,p_area:$("perRangoArea").value,p_incluir_inactivos:false});
    if(!r.ok){ mostrarError(r.error||"Error"); $("perRangoList").innerHTML=""; return; }
    PER.rango=r.personal||[]; PER.rangoSel={}; perRangoNSelUpd(); perPintarRango();
  }catch(e){ $("perRangoList").innerHTML=""; mostrarError(e.message); }
}
function perRangoNSelUpd(){ $("perRangoNSel").textContent=Object.keys(PER.rangoSel).length; }
function perRangoToggle(dni){ if(PER.rangoSel[dni]) delete PER.rangoSel[dni]; else PER.rangoSel[dni]=true; perRangoNSelUpd(); perPintarRango(); }
function perRangoMarcarTodos(){ PER.rango.forEach(p=>PER.rangoSel[p.dni]=true); perRangoNSelUpd(); perPintarRango(); }
function perRangoLimpiar(){ PER.rangoSel={}; perRangoNSelUpd(); perPintarRango(); }
function perPintarRango(){
  $("perRangoList").innerHTML=PER.rango.length? PER.rango.map(p=>`<div class="card-persona${PER.rangoSel[p.dni]?" marcada":""}" onclick="perRangoToggle('${esc(p.dni)}')">
    <div><div class="cp-nombre">${esc(p.nombre)}</div><div class="cp-dni">DNI ${esc(p.dni)} · ${esc(p.area_actual)}</div></div></div>`).join("")
    : `<div class="vacio-msg">Sin personal</div>`;
}
async function perAplicarRango(){
  const dnis=Object.keys(PER.rangoSel);
  if(!dnis.length){ mostrarError("Selecciona al menos una persona"); return; }
  const estado=$("perRangoEstado").value, desde=$("perRangoDesde").value, hasta=$("perRangoHasta").value;
  if(!estado){ mostrarError("Elige un estado"); return; }
  if(!desde||!hasta){ mostrarError("Elige ambas fechas"); return; }
  if(hasta<desde){ mostrarError("La fecha final no puede ser menor"); return; }
  if(!confirm(`¿Aplicar ${estado} a ${dnis.length} persona(s) del ${desde} al ${hasta}?`)) return;
  try{
    const r=await rpc("fn_asignar_estado_rango",{p_dni:ING.dni,p_token:ING.token,p_dnis:dnis,p_estado:estado,p_fecha_desde:desde,p_fecha_hasta:hasta});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    mostrarOk(`Estado aplicado a ${dnis.length} persona(s)`); PER.rangoSel={}; perRangoNSelUpd(); perPintarRango();
  }catch(e){ mostrarError(e.message); }
}

/* --- Matriz (personal × días editable) --- */
async function perCargarMatriz(){
  if(!PER.matSel.desde||!PER.matSel.hasta){ mostrarError("Elige el rango de fechas"); return; }
  $("perTablaMatriz").innerHTML=cargandoHTML("Cargando matriz…");
  try{
    const r=await rpc("fn_asistencia_matriz",{p_dni:ING.dni,p_token:ING.token,p_area:$("perMatArea").value,p_desde:PER.matSel.desde,p_hasta:PER.matSel.hasta});
    if(!r.ok){ mostrarError(r.error||"Error"); $("perTablaMatriz").innerHTML=""; return; }
    PER.matriz={dias:r.dias||[],personal:r.personal||[]}; perPintarMatriz();
  }catch(e){ $("perTablaMatriz").innerHTML=""; mostrarError(e.message); }
}
function perPintarMatriz(){
  const q=normKey($("perMatBuscar").value), dias=PER.matriz.dias;
  const lista=PER.matriz.personal.filter(p=>!q||normKey(p.nombre).includes(q));
  $("perMatResumen").textContent=`${lista.length} persona(s) · ${dias.length} día(s)`;
  let thead=`<thead><tr><th class="col-nombre-solo">Nombre</th>`+dias.map(d=>`<th>${d.slice(8,10)}-${d.slice(5,7)}</th>`).join("")+`</tr></thead>`;
  let tbody="<tbody>";
  if(!lista.length) tbody+=`<tr><td colspan="${dias.length+1}"><div class="vacio-msg">Sin personal</div></td></tr>`;
  lista.forEach(p=>{
    tbody+=`<tr><td class="col-nombre-solo"><div>${esc(p.nombre)}</div><div style="font-size:11px;color:#5a6270;font-weight:600">${esc(p.area)}</div></td>`;
    dias.forEach(d=>{ const est=p.registros[d];
      tbody+=`<td class="celda-asis" onclick="perEditarCelda('${esc(p.dni)}','${esc(p.nombre).replace(/'/g,"\\'")}','${d}','${esc(est||"")}')">${est?`<span class="pill ${esc(est)}">${esc(est)}</span>`:"—"}</td>`;
    });
    tbody+=`</tr>`;
  });
  $("perTablaMatriz").innerHTML=thead+tbody+"</tbody>";
}
function perEditarCelda(dni,nombre,fecha,actual){
  const opts=(ESTADOS_ASIS||[]).map(e=>`<option ${e===actual?"selected":""}>${esc(e)}</option>`).join("")||'<option value="">Sin estados</option>';
  abrirModal(`<h2>${esc(nombre)}</h2><div class="sub" style="margin-bottom:12px;">${esc(fecha)}</div>
    <div class="modal-campo"><label>Estado</label><select id="pmcEstado">${opts}</select></div>
    <div class="modal-msg" id="pmcMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="perGuardarCelda('${esc(dni)}','${fecha}')">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
}
async function perGuardarCelda(dni,fecha){
  const estado=$("pmcEstado").value; if(!estado){ $("pmcMsg").textContent="Elige un estado"; return; }
  try{
    const r=await rpc("fn_asignar_estado_rango",{p_dni:ING.dni,p_token:ING.token,p_dnis:[dni],p_estado:estado,p_fecha_desde:fecha,p_fecha_hasta:fecha});
    if(!r.ok){ $("pmcMsg").textContent=r.error||"No se pudo"; return; }
    cerrarModal();
    const p=PER.matriz.personal.find(x=>x.dni===dni); if(p) p.registros[fecha]=estado; perPintarMatriz();
  }catch(e){ $("pmcMsg").textContent=e.message; }
}

/* --- Dashboard --- */
function perDashGranoChange(){ $("perDashRangoWrap").style.display=$("perDashGrano").value==="rango"?"":"none"; }
function perDashRange(){
  const g=$("perDashGrano").value, hoy=new Date(), iso=d=>d.toLocaleDateString("sv-SE");
  if(g==="dia") return {desde:iso(hoy),hasta:iso(hoy)};
  if(g==="semana"){ const d=new Date(hoy); d.setDate(d.getDate()-((d.getDay()+6)%7)); return {desde:iso(d),hasta:iso(hoy)}; }
  if(g==="mes"){ return {desde:iso(new Date(hoy.getFullYear(),hoy.getMonth(),1)),hasta:iso(hoy)}; }
  if(g==="anio"){ return {desde:iso(new Date(hoy.getFullYear(),0,1)),hasta:iso(hoy)}; }
  return {desde:PER.dashSel.desde,hasta:PER.dashSel.hasta};
}
async function perCargarDash(){
  const rango=perDashRange();
  if(!rango.desde||!rango.hasta){ mostrarError("Elige el rango de fechas"); return; }
  $("perDashKpis").innerHTML=cargandoHTML("Calculando…");
  try{
    const r=await rpc("fn_asistencia_dashboard",{p_dni:ING.dni,p_token:ING.token,p_area:$("perDashArea").value,p_desde:rango.desde,p_hasta:rango.hasta});
    if(!r.ok){ mostrarError(r.error||"Error"); $("perDashKpis").innerHTML=""; return; }
    PER.dash=r; perPintarDash(r);
  }catch(e){ $("perDashKpis").innerHTML=""; mostrarError(e.message); }
}
function perPintarDash(r){
  const dias=r.por_dia||[];
  const prom=dias.length? Math.round(dias.reduce((a,d)=>a+(r.personal>0?d.presentes/r.personal*100:0),0)/dias.length):0;
  const kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num"${c?` style="color:${c}"`:""}>${v}</div><div class="kpi-lbl">${t}</div></div>`;
  $("perDashKpis").innerHTML=
    kpi("Presentes hoy",`${r.hoy_presentes}/${r.hoy_total}`,"var(--exito)")+
    kpi("Asistencia prom.",prom+"%","var(--azul)")+
    kpi("Personal",r.personal)+
    kpi("Días laborales",r.dias_laborales);
  const labels=dias.map(d=>d.fecha.slice(8,10)+"-"+d.fecha.slice(5,7));
  const pct=dias.map(d=>r.personal>0?Math.round(d.presentes/r.personal*100):0);
  perChart("line",{labels,datasets:[{label:"% Presentes",data:pct,borderColor:"#0D3B85",backgroundColor:"rgba(13,59,133,.12)",fill:true,tension:.3,pointRadius:2}]});
  const est=r.por_estado||{}, keys=Object.keys(est);
  const col={ACTIVO:"#1E7B3C",FALTA:"#B3261E",DM:"#D49D53",VACACIONES:"#1A56B4",PERMISO:"#8e6bb5"};
  perChart("pie",{labels:keys,datasets:[{data:keys.map(k=>est[k]),backgroundColor:keys.map(k=>col[k]||"#9aa4b1")}]});
  $("perDashDetalleWrap").style.display="none";
  // Con "Todas las áreas": tendencia → comparativa por área (activos ÷ estructura − vacaciones/otros).
  const todas = ($("perDashArea")?$("perDashArea").value:"")==="";
  if($("perDashTrendCard")) $("perDashTrendCard").style.display = todas?"none":"";
  if($("perDashAreasCard")) $("perDashAreasCard").style.display = todas?"":"none";
  if(todas) perDashAreas();
  perRenderAlertas(1);
}
async function perDashAreas(){
  const rango=perDashRange(); if(!rango.desde||!rango.hasta) return;
  try{
    const r=await rpc("fn_asistencia_areas",{p_dni:ING.dni,p_token:ING.token,p_desde:rango.desde,p_hasta:rango.hasta});
    if(!r.ok){ mostrarError(r.error||"Error"); return; }
    const a=r.areas||[];
    dbBar("perChartAreas", a.map(x=>x.area), a.map(x=>x.pct), "% asistencia", a.map((_,i)=>DBCOL(i)), false);
  }catch(e){ mostrarError(e.message); }
}
function perChart(which,data){
  if(typeof Chart==="undefined") return;
  const id=which==="line"?"perChartLine":"perChartPie", ctx=$(id); if(!ctx) return;
  const prev=which==="line"?PER.chartLine:PER.chartPie; if(prev) prev.destroy();
  const opts={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:which==="pie"}}};
  if(which==="pie") opts.onClick=(e,els)=>{ if(els&&els.length) perDashDetalle(data.labels[els[0].index]); };
  const ch=new Chart(ctx,{type:which,data,options:opts});
  if(which==="line") PER.chartLine=ch; else PER.chartPie=ch;
}
function perDashDetalle(estado){
  const arr=((PER.dash&&PER.dash.detalle)||{})[estado]||[];
  $("perDashDetalleWrap").style.display="";
  $("perDashDetalleTit").innerHTML=`Personal en estado <span class="pill ${esc(estado)}">${esc(estado)}</span> (${arr.length})`;
  $("perDashDetalle").innerHTML=arr.length? arr.map(x=>`<div class="det-persona">${esc(x.nombre)} <span>${x.veces} día(s)</span></div>`).join("")
    : `<div class="vacio-msg">Sin registros</div>`;
  $("perDashDetalleWrap").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function perRenderAlertas(page){
  const al=(PER.dash&&PER.dash.alertas)||[], PP=10, tot=Math.ceil(al.length/PP)||1;
  PER.alPage=Math.min(Math.max(1,page),tot);
  const slice=al.slice((PER.alPage-1)*PP, PER.alPage*PP);
  $("perDashAlertas").innerHTML=slice.length? slice.map(a=>`<div class="det-persona">${esc(a.fecha)} · ${esc(a.nombre)} <span class="pill ${esc(a.estado)}">${esc(a.estado)}</span></div>`).join("")
    : `<div class="vacio-msg">Sin alertas en el periodo</div>`;
  $("perDashAlPager").innerHTML= al.length>PP
    ? `<button class="btn-mini" ${PER.alPage<=1?"disabled":""} onclick="perAlPage(-1)">‹ Anterior</button>
       <span class="sub" style="margin:0 8px;">${PER.alPage}/${tot}</span>
       <button class="btn-mini" ${PER.alPage>=tot?"disabled":""} onclick="perAlPage(1)">Siguiente ›</button>` : "";
}
function perAlPage(d){ perRenderAlertas(PER.alPage+d); }

/* --- Marcar asistencia (usa el motor compartido aswStart de app.js) --- */
function perMarcarInit(){
  $("perMarcarSwipe").hidden=true; $("perMarcarArea").hidden=false;
  $("perMarcarAreas").innerHTML=(AREAS_LISTA||[]).map(a=>`<div class="card-area" onclick="perMarcarArea('${esc(a).replace(/'/g,"\\'")}')"><div class="ca-nombre">${esc(a)}</div><div class="ca-sub">Marcar asistencia</div></div>`).join("");
}
function perMarcarArea(area){
  PER.marcarArea=area;
  $("perMarcarArea").hidden=true; $("perMarcarSwipe").hidden=false;
  const fecha=($("perMarcarFecha")&&$("perMarcarFecha").value)||hoyISO();
  aswStart({
    stackId:"perSwipeStack", progId:"perMarcarProgreso", saveBtnId:"perMarcarGuardar",
    resumenId:"perMarcarResumen", ayudaId:"perSwipeAyuda",
    estados:()=>ESTADOS_ASIS,
    listar:(f)=>rpc("fn_asistencia_marcar_lista",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_fecha:f}),
    guardar:(m,f)=>rpc("fn_asistencia_marcar_guardar",{p_dni:ING.dni,p_token:ING.token,p_fecha:f,p_marcas:m}),
    onSaved:()=>perMarcarInit()
  }, fecha);
}
function perMarcarVolver(){ perMarcarInit(); }

/* ================= DASHBOARDS (por área / módulo) + AVANCE POR OF ================= */
let DASH_TAB="asis";
function dashTab(t){
  DASH_TAB=t;
  [["asis","dbPanelAsis","dashTabAsis"],["ef","dbPanelEf","dashTabEf"],["cant","dbPanelCant","dashTabCant"],["mod","dbPanelMod","dashTabMod"]]
    .forEach(x=>{ if($(x[1])) $(x[1]).hidden=x[0]!==t; if($(x[2])) $(x[2]).classList.toggle("activo",x[0]===t); });
  dbEnsureFp();
  if(t==="asis") perCargarDash();
  else if(t==="ef") cargarDbEf();
  else if(t==="cant") cargarDbCant();
  else if(t==="mod"){ if($("dbModArea")&&$("dbModArea").value) cargarDbMod(); }
}
let DBCH={};                 // instancias Chart por id de canvas
let DB={fpReady:false, efSel:{}, cantSel:{}, modSel:{}, efModo:"ef", efData:null};
let AVOF={items:[], meta:{}, _rows:[]};
let avofSort={col:null,dir:1};
function ordenarAvof(col){ if(avofSort.col===col) avofSort.dir*=-1; else avofSort={col,dir:1}; avofPintar(); }
function DBCOL(i){ const c=["#0D3B85","#D49D53","#1E7B3C","#1A56B4","#8e6bb5","#B3261E","#5e548e","#3a6ea5","#b0722a","#2e8b8b"]; return c[i%c.length]; }
function dbSemana(){ const hoy=new Date(), lun=new Date(hoy); lun.setDate(hoy.getDate()-((hoy.getDay()+6)%7));
  return {desde:lun.toLocaleDateString("sv-SE"), hasta:hoy.toLocaleDateString("sv-SE")}; }
function dbFp(id,obj){ if(!window.flatpickr||!$(id)) return; const d=dbSemana(); obj.desde=d.desde; obj.hasta=d.hasta;
  flatpickr("#"+id,{mode:"range",dateFormat:"Y-m-d",defaultDate:[obj.desde,obj.hasta],locale:{rangeSeparator:" a "},
    onChange:ds=>{ if(ds.length>=1){ obj.desde=ds[0].toLocaleDateString("sv-SE"); obj.hasta=(ds[1]||new Date()).toLocaleDateString("sv-SE"); } }}); }
function dbEnsureFp(){
  if(DB.fpReady) return;
  if($("perDashRango")&&window.flatpickr) flatpickr("#perDashRango",{mode:"range",dateFormat:"Y-m-d",locale:{rangeSeparator:" a "},
    onChange:ds=>{ if(ds.length>=1){ PER.dashSel.desde=ds[0].toLocaleDateString("sv-SE"); PER.dashSel.hasta=(ds[1]||new Date()).toLocaleDateString("sv-SE"); } }});
  dbFp("dbEfRango",DB.efSel); dbFp("dbCantRango",DB.cantSel); dbFp("dbModRango",DB.modSel);
  DB.fpReady=true;
}
function dbBar(cid,labels,data,label,colors,horizontal){
  if(typeof Chart==="undefined") return; const ctx=$(cid); if(!ctx) return;
  if(DBCH[cid]) DBCH[cid].destroy();
  DBCH[cid]=new Chart(ctx,{type:"bar",
    data:{labels,datasets:[{label,data,backgroundColor:colors,borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,
      indexAxis:horizontal?"y":"x",plugins:{legend:{display:false}}}});
}

/* --- Eficiencia / minutaje por área --- */
async function cargarDbEf(){
  dbEnsureFp(); const o=DB.efSel; if(!o.desde||!o.hasta){ mostrarError("Elige el rango"); return; }
  $("dbEfTabla").innerHTML=cargandoHTML("Calculando…");
  try{
    const r=await rpc("fn_eficiencia_areas",{p_dni:ING.dni,p_token:ING.token,p_desde:o.desde,p_hasta:o.hasta});
    if(!r.ok){ mostrarError(r.error||"Error"); $("dbEfTabla").innerHTML=""; return; }
    DB.efData=r; dbEfPintar();
  }catch(e){ $("dbEfTabla").innerHTML=""; mostrarError(e.message); }
}
function dbEfModo(m){ DB.efModo=m; $("dbEfBtnEf").classList.toggle("activo",m==="ef"); $("dbEfBtnMin").classList.toggle("activo",m==="min"); if(DB.efData) dbEfPintar(); }
function dbEfPintar(){
  const r=DB.efData; if(!r) return; const ef=DB.efModo==="ef"; const areas=r.areas||[];
  $("dbEfTit").textContent = ef?"Eficiencia % por área":"Minutaje por área";
  dbBar("dbEfChart", areas.map(a=>a.area), areas.map(a=>ef?a.eficiencia:a.minutos), ef?"Eficiencia %":"Minutos", areas.map((_,i)=>DBCOL(i)), false);
  const fechas=(r.por_fecha||[]).map(x=>x.fecha), anom=areas.map(a=>a.area);
  let thead=`<thead><tr><th class="izq">Área</th>`+fechas.map(f=>`<th>${f.slice(8,10)}-${f.slice(5,7)}</th>`).join("")+`</tr></thead>`;
  let tb="<tbody>";
  if(!anom.length) tb+=`<tr><td colspan="${fechas.length+1}"><div class="vacio-msg">Sin datos</div></td></tr>`;
  anom.forEach(a=>{
    tb+=`<tr><td class="izq"><b>${esc(a)}</b></td>`+fechas.map(f=>{
      const row=(r.por_fecha||[]).find(x=>x.fecha===f), v=row&&row.valores&&row.valores[a];
      const val=v?(ef?v.ef:v.min):0; return `<td>${val?(ef?val+"%":Math.round(val)):"—"}</td>`;
    }).join("")+`</tr>`;
  });
  $("dbEfTabla").innerHTML=thead+tb+"</tbody>";
}

/* --- Cantidad por área --- */
async function cargarDbCant(){
  dbEnsureFp(); const o=DB.cantSel; if(!o.desde||!o.hasta){ mostrarError("Elige el rango"); return; }
  try{
    const r=await rpc("fn_cantidad_areas",{p_dni:ING.dni,p_token:ING.token,p_desde:o.desde,p_hasta:o.hasta});
    if(!r.ok){ mostrarError(r.error||"Error"); return; }
    const a=r.areas||[]; dbBar("dbCantChart", a.map(x=>x.area), a.map(x=>x.cantidad), "Cantidad", a.map((_,i)=>DBCOL(i)), false);
  }catch(e){ mostrarError(e.message); }
}

/* --- Minutos por módulo --- */
async function cargarDbMod(){
  dbEnsureFp(); const area=$("dbModArea")?$("dbModArea").value:""; if(!area){ mostrarError("Elige un área"); return; }
  const o=DB.modSel; if(!o.desde||!o.hasta){ mostrarError("Elige el rango"); return; }
  try{
    const r=await rpc("fn_minutos_modulos",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_desde:o.desde,p_hasta:o.hasta});
    if(!r.ok){ mostrarError(r.error||"Error"); return; }
    const it=r.items||[]; $("dbModTit").textContent=`Minutos por módulo · ${area} · ${Math.round(r.total_min)} min`;
    dbBar("dbModChart", it.map(x=>x.modulo), it.map(x=>x.minutos), "Minutos", it.map((_,i)=>DBCOL(i)), true);
  }catch(e){ mostrarError(e.message); }
}

/* --- Operaciones sin OF (parche 27): reprocesos, muestras, arreglos --- */
let EXTRA=[], EXTRA_TIPOS=[];
async function cargarExtra(){
  const area=$("exArea")?$("exArea").value:"";
  /* El tipo es catálogo abierto, como los motivos de Corregir fechas: si el
     analista escribe uno nuevo, queda dado de alta al guardar (parche 30). */
  try{
    const t=await rpc("fn_tipos_extra_listar",{p_dni:ING.dni,p_token:ING.token});
    EXTRA_TIPOS=Array.isArray(t)?t:[];
    if($("exTiposLista")) $("exTiposLista").innerHTML=EXTRA_TIPOS.map(x=>`<option value="${esc(x)}">`).join("");
  }catch(e){}
  if(!area){ $("exTabla").innerHTML=""; $("exResumen").textContent="Elige un área"; return; }
  $("exTabla").innerHTML=cargandoHTML("Cargando…");
  try{
    const r=await rpc("fn_extra_listar",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_todas:true});
    if(r && r.ok===false){ mostrarError(r.error||"Error"); $("exTabla").innerHTML=""; return; }
    EXTRA=Array.isArray(r)?r:[]; pintarExtra();
  }catch(e){ $("exTabla").innerHTML=""; mostrarError(e.message); }
}
function pintarExtra(){
  const act=EXTRA.filter(e=>e.activa).length;
  $("exResumen").textContent=`${EXTRA.length} operación(es) · ${act} activa(s)`;
  const body=EXTRA.length? EXTRA.map((e,i)=>`<tr>
      <td>${esc(e.tipo)}</td><td class="izq"><b>${esc(e.operacion)}</b></td>
      <td>${Number(e.std).toFixed(2)}</td>
      <td><span class="pill ${e.activa?"ACTIVO":"DM"}">${e.activa?"ACTIVA":"INACTIVA"}</span></td>
      <td><button class="btn-mini ${e.activa?"rojo":"verde"}" onclick="toggleExtra(${i})">${e.activa?"Desactivar":"Activar"}</button></td>
    </tr>`).join("")
    : `<tr><td colspan="5"><div class="vacio-msg">Sin operaciones cargadas para esta área</div></td></tr>`;
  $("exTabla").innerHTML=`<thead><tr><th>Tipo</th><th class="izq">Operación</th><th>STD</th>
    <th>Estado</th><th></th></tr></thead><tbody>${body}</tbody>`;
}
async function guardarExtra(){
  const area=$("exArea").value, tipo=norm($("exTipo").value).toUpperCase();
  const op=norm($("exOp").value), std=parseFloat($("exStd").value);
  if(!area){ mostrarError("Elige un área"); return; }
  if(!tipo){ mostrarError("Escribe el tipo"); return; }
  if(!op){ mostrarError("Escribe la operación"); return; }
  if(!std || std<=0){ mostrarError("El STD debe ser mayor que cero"); return; }
  try{
    const r=await rpc("fn_extra_guardar",{p_dni:ING.dni,p_token:ING.token,p_id:null,
      p_area:area,p_tipo:tipo,p_operacion:op,p_std:std,p_activa:true});
    if(!r.ok){ mostrarError(r.error||"No se pudo guardar"); return; }
    mostrarOk("Operación guardada"); $("exOp").value=""; $("exStd").value="";
    cargarExtra();
  }catch(e){ mostrarError(e.message); }
}
async function toggleExtra(i){
  const e=EXTRA[i]; if(!e) return;
  try{
    const r=await rpc("fn_extra_guardar",{p_dni:ING.dni,p_token:ING.token,p_id:e.id,
      p_area:$("exArea").value,p_tipo:e.tipo,p_operacion:e.operacion,p_std:e.std,p_activa:!e.activa});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    cargarExtra();
  }catch(e2){ mostrarError(e2.message); }
}

/* --- Origen de tickets (parche 47) ---
   Qué se está reclamando y de dónde viene. El almacén del Sheet solo se puede
   apagar cuando al área no le cuelga ninguna OF sin generar; si cuelga algo,
   la BD lo rechaza y hay que confirmarlo a sabiendas. */
let ORIGEN=[];
async function cargarOrigen(){
  $("orZona").innerHTML=cargandoHTML("Revisando…"); $("orResumen").textContent="";
  try{
    const r=await rpc("fn_origen_reclamos",{p_dni:ING.dni,p_token:ING.token});
    if(!r.ok){ mostrarError(r.error||"Error"); $("orZona").innerHTML=""; return; }
    ORIGEN=r.areas||[]; pintarOrigen();
  }catch(e){ $("orZona").innerHTML=""; mostrarError(e.message); }
}
function pintarOrigen(){
  const conSheet=ORIGEN.filter(a=>a.usa_almacen).length;
  const listas=ORIGEN.filter(a=>a.usa_almacen && a.listo_para_apagar).length;
  $("orResumen").innerHTML=`${ORIGEN.length} área(s) · <b>${conSheet}</b> siguen leyendo el Sheet`
    + (listas?` · <b>${listas}</b> ya se pueden desconectar`:"");
  $("orZona").innerHTML = ORIGEN.map(a=>{
    const pend=a.pendientes||[];
    const estado = !a.usa_almacen
      ? `<span class="of-area lista">desconectada del Sheet</span>`
      : (a.listo_para_apagar
          ? `<span class="of-area lista">lista para desconectar</span>`
          : `<span class="of-area pendiente">${a.ofs_sheet} OF colgando del Sheet</span>`);
    const btn = a.usa_almacen
      ? `<button class="btn-mini ${a.listo_para_apagar?"verde":"rojo"}" onclick="apagarAlmacen('${esc(a.area)}')">Desconectar del Sheet</button>`
      : `<button class="btn-mini" onclick="prenderAlmacen('${esc(a.area)}')">Volver a conectar</button>`;
    const tabla = pend.length ? `
      <div class="contenedor-ancho tabla-scroll" style="max-height:26vh;margin-top:8px;">
        <table class="tabla"><thead><tr><th>OF</th><th>Tickets</th><th>Personas</th>
          <th>Und.</th><th>Último reclamo</th><th>¿Registrada?</th></tr></thead><tbody>${
          pend.map(x=>`<tr><td>${esc(x.of)}</td><td><b>${x.tickets}</b></td><td>${x.personas}</td>
            <td>${x.und}</td><td>${esc(x.ultima||"—")}</td>
            <td>${x.registrada
              ? `<span class="of-area pendiente">sí · falta generar</span>`
              : `<span class="of-area sin-base">no está en el sistema</span>`}</td></tr>`).join("")
        }</tbody></table></div>` : "";
    return `<div class="gen-job">
      <div class="gen-job-head">
        <div class="gen-job-name">${esc(a.area)} &nbsp; ${estado}</div>
        ${btn}
      </div>
      <div class="cf-detalle">Del sistema: <b>${a.ofs_sistema}</b> OF · ${a.tickets_sistema} ticket(s)
        &nbsp;·&nbsp; Del Sheet: <b>${a.ofs_sheet}</b> OF · ${a.tickets_sheet} ticket(s)</div>
      ${tabla}</div>`;
  }).join("") || `<div class="vacio-msg">Sin áreas configuradas</div>`;
}
async function apagarAlmacen(area){
  try{
    let r=await rpc("fn_area_almacen",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_usar:false,p_confirmar:false});
    if(!r.ok && r.requiere_confirmacion){
      if(!confirm(`${r.error}

¿Desconectar de todos modos?`)) return;
      r=await rpc("fn_area_almacen",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_usar:false,p_confirmar:true});
    }
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    mostrarOk(`${area} ya no lee el almacén del Sheet`);
    cargarOrigen();
  }catch(e){ mostrarError(e.message); }
}
async function prenderAlmacen(area){
  try{
    const r=await rpc("fn_area_almacen",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_usar:true,p_confirmar:true});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    mostrarOk(`${area} vuelve a leer el almacén del Sheet`);
    cargarOrigen();
  }catch(e){ mostrarError(e.message); }
}

/* --- Entradas y salidas por área (parche 46) ---
   ENTRÓ = al menos una operación registrada. SALIÓ = la operación de
   referencia (última o penúltima, a elección) alcanzó lo programado.
   Vista aparte del Resumen de OF, que es acumulativo a propósito. */
let FLUJO={items:[], ref:"ULTIMA", desde:"", hasta:""};
function fjInit(){
  if(!$("fjDesde").value) fjRango(7);
  else cargarFlujo();
}
function fjRango(dias){
  const hoy=hoyISO();
  const d=new Date(hoy+"T00:00:00"); d.setDate(d.getDate()-dias);
  $("fjDesde").value=d.toLocaleDateString("sv-SE");
  $("fjHasta").value=hoy;
  cargarFlujo();
}
async function cargarFlujo(){
  const desde=$("fjDesde").value, hasta=$("fjHasta").value;
  if(!desde||!hasta){ mostrarError("Elige el rango"); return; }
  $("fjTabla").innerHTML=cargandoHTML("Calculando…"); $("fjResumen").textContent="";
  try{
    const r=await rpc("fn_flujo_areas",{p_dni:ING.dni,p_token:ING.token,
      p_desde:desde,p_hasta:hasta,p_ref:$("fjRef").value});
    if(!r.ok){ mostrarError(r.error||"Error"); $("fjTabla").innerHTML=""; return; }
    FLUJO={items:r.items||[], ref:r.ref, desde:r.desde, hasta:r.hasta};
    const areas=[...new Set(FLUJO.items.map(x=>x.area))].sort((a,b)=>a.localeCompare(b,"es"));
    $("fjArea").innerHTML=`<option value="">Todas</option>`+areas.map(a=>`<option>${esc(a)}</option>`).join("");
    pintarFlujo();
  }catch(e){ $("fjTabla").innerHTML=""; mostrarError(e.message); }
}
function fjFiltradas(){
  const v=$("fjVista").value, ar=$("fjArea").value;
  return FLUJO.items.filter(x=>{
    if(ar && x.area!==ar) return false;
    if(v==="salio")   return x.salio_en_rango;
    if(v==="entro")   return x.entro_en_rango;
    if(v==="proceso") return !x.salida;
    return true;
  });
}
function pintarFlujo(){
  if(!FLUJO.items.length){ $("fjTabla").innerHTML=`<tbody><tr><td><div class="vacio-msg">Sin movimiento en ese rango</div></td></tr></tbody>`; return; }
  const l=fjFiltradas();
  const und=l.reduce((a,x)=>a+(Number(x.und_ref)||0),0);
  const salieron=l.filter(x=>x.salio_en_rango).length;
  $("fjResumen").innerHTML=`${FLUJO.desde} → ${FLUJO.hasta} · referencia: <b>${esc(FLUJO.ref==="PENULTIMA"?"penúltima":"última")} operación</b>`
    + ` · ${l.length} OF-área · ${salieron} salieron · ${Math.round(und)} und en la operación de referencia`;
  const body=l.length? l.map(x=>`<tr>
      <td class="izq"><b>${esc(x.area)}</b></td>
      <td>${esc(x.of)}</td><td class="izq">${esc(x.articulo)}</td>
      <td>${esc(x.prenda||"—")}</td>
      <td>${Math.round(x.cant_prog)}</td>
      <td><b>${Math.round(x.und_ref)}</b></td>
      <td>${esc(x.entrada||"—")}</td>
      <td>${esc(x.salida||"—")}</td>
      <td><span class="pill ${x.salida?"ACTIVO":"DM"}">${esc(x.estado)}</span></td></tr>`).join("")
    : `<tr><td colspan="9"><div class="vacio-msg">Nada con ese filtro</div></td></tr>`;
  $("fjTabla").innerHTML=`<thead><tr><th class="izq">Área</th><th>OF</th><th class="izq">Artículo</th>
    <th>Prenda</th><th>Cant. prog.</th><th>Und. ref.</th><th>Entró</th><th>Salió</th><th>Estado</th></tr></thead>
    <tbody>${body}</tbody>`;
}
function descargarFlujo(){
  const l=fjFiltradas();
  if(!l.length){ mostrarError("No hay datos para descargar"); return; }
  const CAB=["Área","OF","Artículo","Prenda","Cant. prog.","Und. operación ref.","Und. total área","Registros","Entró","Salió","Estado"];
  const filas=l.map(x=>[x.area,x.of,x.articulo,x.prenda||"",Math.round(x.cant_prog),
    Math.round(x.und_ref),Math.round(x.und_total),x.registros,x.entrada||"",x.salida||"",x.estado]);
  const ws=XLSX.utils.aoa_to_sheet([CAB,...filas]); const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Flujo");
  XLSX.writeFile(wb,`FLUJO_${FLUJO.desde}_a_${FLUJO.hasta}.xlsx`);
}

/* --- Causas de variación del STD (parche 36) --- */
let CAUSAS_ING=[];
async function cargarCausasSilencioso(){
  try{ const r=await rpc("fn_causas_std_listar",{p_dni:ING.dni,p_token:ING.token,p_todas:true});
       if(Array.isArray(r)) CAUSAS_ING=r; }catch(e){}
}
async function cargarCausas(){
  $("cauTabla").innerHTML=cargandoHTML("Cargando…");
  try{
    const r=await rpc("fn_causas_std_listar",{p_dni:ING.dni,p_token:ING.token,p_todas:true});
    if(r && r.ok===false){ mostrarError(r.error||"Error"); $("cauTabla").innerHTML=""; return; }
    CAUSAS_ING=Array.isArray(r)?r:[]; pintarCausasIng();
  }catch(e){ $("cauTabla").innerHTML=""; mostrarError(e.message); }
}
function pintarCausasIng(){
  const act=CAUSAS_ING.filter(c=>c.activa).length;
  $("cauResumen").textContent=`${CAUSAS_ING.length} causa(s) · ${act} activa(s)`;
  const body=CAUSAS_ING.length? CAUSAS_ING.map((c,i)=>`<tr>
      <td class="izq"><b>${esc(c.texto)}</b></td>
      <td>${Number(c.delta)>0?"+":""}${Number(c.delta).toFixed(2)}</td>
      <td><span class="pill ${c.activa?"ACTIVO":"DM"}">${c.activa?"ACTIVA":"INACTIVA"}</span></td>
      <td><button class="btn-mini" onclick="editarCausa(${i})">Editar</button></td>
      <td><button class="btn-mini ${c.activa?"rojo":"verde"}" onclick="toggleCausa(${i})">${c.activa?"Desactivar":"Activar"}</button></td>
    </tr>`).join("")
    : `<tr><td colspan="5"><div class="vacio-msg">Sin causas cargadas</div></td></tr>`;
  $("cauTabla").innerHTML=`<thead><tr><th class="izq">Causa</th><th>Min/prenda</th>
    <th>Estado</th><th></th><th></th></tr></thead><tbody>${body}</tbody>`;
}
function editarCausa(i){
  const c=CAUSAS_ING[i]; if(!c) return;
  $("cauTexto").value=c.texto; $("cauDelta").value=c.delta;
  $("cauTexto").focus();
}
async function guardarCausa(){
  const texto=norm($("cauTexto").value).toUpperCase();
  const delta=parseFloat($("cauDelta").value);
  if(!texto){ mostrarError("Escribe la causa"); return; }
  if(!delta || delta===0 || isNaN(delta)){ mostrarError("Los minutos por prenda deben ser distintos de cero"); return; }
  try{
    const r=await rpc("fn_causa_std_guardar",{p_dni:ING.dni,p_token:ING.token,
      p_texto:texto,p_delta:delta,p_activa:true});
    if(!r.ok){ mostrarError(r.error||"No se pudo guardar"); return; }
    mostrarOk(`Causa "${r.texto}" guardada`);
    $("cauTexto").value=""; $("cauDelta").value="";
    cargarCausas();
  }catch(e){ mostrarError(e.message); }
}
async function toggleCausa(i){
  const c=CAUSAS_ING[i]; if(!c) return;
  try{
    const r=await rpc("fn_causa_std_guardar",{p_dni:ING.dni,p_token:ING.token,
      p_texto:c.texto,p_delta:c.delta,p_activa:!c.activa});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    cargarCausas();
  }catch(e){ mostrarError(e.message); }
}

/* --- OFs registradas (parche 26): lo guardado al confirmar cada HN --- */
let OFS=[], OFS_VISTA=[];
async function cargarOfs(){
  $("ofsTabla").innerHTML=cargandoHTML("Cargando…"); $("ofsResumen").textContent="";
  try{
    const r=await rpc("fn_ofs_listar",{p_dni:ING.dni,p_token:ING.token,p_buscar:""});
    if(r && r.ok===false){ mostrarError(r.error||"Error"); $("ofsTabla").innerHTML=""; return; }
    OFS=Array.isArray(r)?r:[]; ofsPintar();
  }catch(e){ $("ofsTabla").innerHTML=""; mostrarError(e.message); }
}
/* Una OF puede llevar dos prendas (terno = pantalón + saco): `ofs.prenda`
   solo guarda la de la primera hoja, así que para mostrar hay que mirar lo
   que realmente se guardó en `of_detalle`. */
function ofsPrendas(o){ const p=(o&&o.prendas)||[]; return Array.isArray(p)?p:[]; }
function ofsPrendasTxt(o){
  const p=ofsPrendas(o).map(x=>x.prenda).filter(Boolean);
  return p.length ? p.join(" · ") : (o.prenda||"—");
}
/* Con dos hojas, "26" solo confunde: se muestra de dónde sale. */
function ofsPaqDesglose(o){
  const p=ofsPrendas(o);
  if(p.length<2) return "";
  return ` <span class="cf-detalle">(${p.map(x=>x.paquetes).join("+")})</span>`;
}
function ofsPintar(){
  const q=normKey($("ofsBuscar")?$("ofsBuscar").value:"");
  const rows=OFS.filter(o=>!q||normKey((o.of||"")+" "+(o.articulo||"")).includes(q));
  OFS_VISTA=rows;
  const und=rows.reduce((a,o)=>a+(Number(o.cant_prog)||0),0);
  $("ofsResumen").textContent=`${rows.length} OF · ${Math.round(und)} und programadas`;
  /* En vez de la división (casi siempre vacía), el estado por área: donde ya
     está servida, donde falta generar y donde falta subir la BASE. */
  const areasTxt=o=>{
    const a=(o.areas||[]); if(!a.length) return "—";
    return a.map(x=>{
      if(!x.base) return `<span class="of-area sin-base" title="Falta subir la BASE de ${esc(o.articulo)} en ${esc(x.area)}">${esc(x.area)} · sin BASE</span>`;
      if(x.acabado) return `<span class="of-area lista">${esc(x.area)} · activa</span>`;
      return x.generada
        ? `<span class="of-area lista">${esc(x.area)} · generada</span>`
        : `<span class="of-area pendiente">${esc(x.area)} · por generar</span>`;
    }).join(" ");
  };
  const body=rows.length? rows.map((o,i)=>`<tr>
      <td><button class="btn-mini gris" onclick="ofsToggle(${i})">▾</button></td>
      <td class="izq"><b>${esc(o.articulo||"—")}</b></td><td>${esc(o.of)}</td>
      <td>${esc(ofsPrendasTxt(o))}</td><td><b>${Math.round(o.cant_prog||0)}</b></td>
      <td>${o.paquetes}${ofsPaqDesglose(o)}</td><td class="izq">${areasTxt(o)}</td>
      <td>${esc(o.fecha_carga||"—")}</td></tr>
      <tr class="avof-det" id="ofsDet${i}" hidden><td></td><td colspan="7"></td></tr>`).join("")
    : `<tr><td colspan="8"><div class="vacio-msg">Sin OF registradas todavía. Se registran al confirmar una HN en Generar tickets.</div></td></tr>`;
  $("ofsTabla").innerHTML=`<thead><tr><th></th><th class="izq">Artículo</th><th>OF</th><th>Prenda</th>
    <th>Cant. prog.</th><th>Paquetes</th><th class="izq">Áreas</th><th>Cargada</th></tr></thead><tbody>${body}</tbody>`;
}
/* Alta desde la HN: mismo parseo que Generar tickets, pero SIN escribir en el
   ALMACÉN. Registra la OF con su desglose completo (talla, color, numeración).

   Antes registraba en cuanto se soltaba el archivo: una HN con la cabecera
   corrida entraba con la OF mal leída y no había vuelta atrás. Ahora se lee,
   se muestra una tarjeta por hoja con lo detectado —editable— y solo al
   CONFIRMAR se escribe. Las diferencias de una OF ya registrada se siguen
   mostrando igual que siempre. */
let OFS_JOBS=[], OFS_SEQ=0;
function ofsLeerHN(input){
  const files=[...input.files]; input.value="";
  if(!files.length) return;
  $("ofsHNRes").innerHTML="";
  let leidos=0;
  files.forEach(file=>{
    const lector=new FileReader();
    lector.onload=(e)=>{
      try{
        const wb=XLSX.read(e.target.result,{type:"array"});
        if(!wb.SheetNames.includes("HN")) throw new Error("no se encontró la hoja HN");
        const hn=parseHN(XLSX.utils.sheet_to_json(wb.Sheets["HN"],{header:1,defval:null,raw:true}));
        OFS_JOBS.push({id:++OFS_SEQ, name:file.name, hn, error:null});
      }catch(err){
        OFS_JOBS.push({id:++OFS_SEQ, name:file.name, hn:null, error:err.message});
      }
      if(++leidos===files.length) ofsCargarPrendas().then(renderOfsJobs);
    };
    lector.readAsArrayBuffer(file);
  });
}
/* La HN dice `TERNO(PANTALÓN)` y la BASE dice `PANTALON`: lo que se guarda
   tiene que ser SIEMPRE el vocabulario de la BASE, o después no cruza. Se
   ofrecen las prendas que existen de verdad y se preselecciona la que encaja
   con el texto de la hoja; el analista solo confirma. */
async function ofsCargarPrendas(){
  for(const j of OFS_JOBS){
    if(!j.hn || j.prendas) continue;
    try{
      const r=await rpc("fn_prendas_articulo",{p_dni:ING.dni,p_token:ING.token,p_articulo:j.hn.articulo});
      j.prendas = Array.isArray(r) ? r : [];
    }catch(e){ j.prendas = []; }
    j.sug = ofsSugerirPrenda(j.hn.prenda, j.prendas);
  }
}
/* Encaje por contención normalizada: "PANTALON" está dentro de "TERNOPANTALON".
   Gana la más larga, para que "SACO" no le robe el sitio a "SACO SPORT". */
function ofsSugerirPrenda(texto, lista){
  const t=normKey(texto||""); let mejor="";
  (lista||[]).forEach(p=>{ const k=normKey(p);
    if(k && t.includes(k) && k.length>normKey(mejor).length) mejor=p; });
  return mejor;
}
function ofsQuitarJob(id){ OFS_JOBS=OFS_JOBS.filter(j=>j.id!==id); renderOfsJobs(); }
function ofsCancelarHN(){ OFS_JOBS=[]; renderOfsJobs(); }
function renderOfsJobs(){
  const cont=$("ofsHNCont"), z=$("ofsHNJobs"), c=$("ofsHNConteo");
  if(!cont||!z) return;
  cont.hidden = !OFS_JOBS.length;
  if(!OFS_JOBS.length){ z.innerHTML=""; if(c) c.textContent=""; return; }
  const ok=OFS_JOBS.filter(j=>j.hn).length, mal=OFS_JOBS.length-ok;
  c.innerHTML=`<b>${OFS_JOBS.length}</b> hoja(s) leída(s) · <b>${ok}</b> OF por registrar`
    + (mal?` · <span style="color:var(--alerta);font-weight:700;">${mal} con problema</span>`:"")
    + ` — revisa y corrige antes de confirmar.`;
  z.innerHTML=OFS_JOBS.map(j=>{
    if(j.error) return `<div class="gen-job"><div class="gen-job-head">
      <div class="gen-job-name">${esc(j.name)}</div>
      <button class="btn-mini gris" onclick="ofsQuitarJob(${j.id})">Quitar</button></div>
      <div class="diff-box"><div class="diff-del">${esc(j.error)}</div></div></div>`;
    const {det, total}=hnDetalle(j.hn.tallas);
    const filas=j.hn.tallas.map((t,i)=>`<tr><td>${i+1}</td><td>${esc(t.talla)}</td><td>${t.cant}</td><td class="izq">${esc(t.color)}</td></tr>`).join("");
    const avisos=[];
    if(!j.hn.of) avisos.push("No se leyó la ORDEN (OF): escríbela a mano.");
    if(!j.hn.articulo) avisos.push("No se leyó el ARTÍCULO.");
    if(total<=0) avisos.push("La HN no trae cantidades.");
    if((j.prendas||[]).length>1 && !j.sug)
      avisos.push(`El artículo tiene varias prendas en la BASE (${j.prendas.join(" · ")}) y ninguna encaja con "${j.hn.prenda||"—"}": elígela a mano.`);
    if((j.prendas||[]).length===0 && j.hn.articulo)
      avisos.push("Ese artículo no tiene BASE cargada con prenda: se guardará lo que escribas.");
    return `<div class="gen-job" id="ofsJob_${j.id}">
      <div class="gen-job-head">
        <div class="gen-job-name">${esc(j.name)}</div>
        <button class="btn-mini gris" onclick="ofsQuitarJob(${j.id})">Quitar</button>
      </div>
      <div class="barra-control">
        <label class="campo"><span>OF</span><input type="text" id="ofsJofOf_${j.id}" inputmode="numeric" value="${esc(j.hn.of)}"></label>
        <label class="campo"><span>Artículo</span><input type="text" id="ofsJofArt_${j.id}" value="${esc(j.hn.articulo)}"></label>
        <label class="campo"><span>Prenda ${j.hn.prenda?`<span class="cf-detalle">(la hoja dice: ${esc(j.hn.prenda)})</span>`:""}</span>
          ${(j.prendas||[]).length
            ? `<select id="ofsJofPre_${j.id}">
                 <option value="">— elige la prenda —</option>
                 ${j.prendas.map(pr=>`<option value="${esc(pr)}" ${pr===j.sug?"selected":""}>${esc(pr)}</option>`).join("")}
               </select>`
            : `<input type="text" id="ofsJofPre_${j.id}" value="${esc(j.hn.prenda)}" placeholder="Sin BASE: escríbela">`}
        </label>
        <span class="sub" style="align-self:flex-end;">${j.hn.bloques} bloque(s) · ${det.length} paquete(s) · <b>${Math.round(total)}</b> und</span>
      </div>
      ${avisos.length?`<div class="diff-box"><div class="diff-del">${avisos.map(esc).join("<br>")}</div></div>`:""}
      <div class="contenedor-ancho tabla-scroll" style="max-height:28vh;">
        <table class="tabla"><thead><tr><th>#</th><th>Talla</th><th>Cant</th><th class="izq">Color</th></tr></thead>
        <tbody>${filas}</tbody></table>
      </div>
    </div>`;
  }).join("");
}
async function ofsConfirmarHN(){
  const vivos=OFS_JOBS.filter(j=>j.hn);
  if(!vivos.length){ mostrarError("No hay ninguna hoja válida para registrar"); return; }
  // Toma lo que hay en pantalla: puede haberse corregido a mano.
  const pend=[];
  for(const j of vivos){
    const of=($("ofsJofOf_"+j.id).value||"").replace(/\D/g,"");
    const art=($("ofsJofArt_"+j.id).value||"").trim().toUpperCase();
    const pre=($("ofsJofPre_"+j.id).value||"").trim().toUpperCase();
    const {det, total}=hnDetalle(j.hn.tallas);
    if(!of){ mostrarError(`${j.name}: falta la OF`); return; }
    if(!art){ mostrarError(`${j.name}: falta el artículo`); return; }
    if((j.prendas||[]).length>1 && !pre){
      mostrarError(`${j.name}: ese artículo tiene varias prendas, elige cuál es esta hoja`); return; }
    if(total<=0){ mostrarError(`${j.name}: la HN no trae cantidades`); return; }
    pend.push({j, of, art, pre, det, total});
  }
  const dupe=pend.map(p=>p.of).filter((v,i,a)=>a.indexOf(v)!==i);
  if(dupe.length && !confirm(`Hay hojas con la misma OF (${[...new Set(dupe)].join(", ")}).
Se registrarán una tras otra y la segunda saldrá como "ya registrada". ¿Sigo?`)) return;
  const resumen=pend.map(p=>`OF ${p.of} · ${p.art} · ${Math.round(p.total)} und`).join("\n");
  if(!confirm(`¿Registrar ${pend.length} OF?\n\n${resumen}`)) return;

  const lineas=[];
  for(const p of pend){
    try{
      const g=await rpc("fn_of_registrar",{p_dni:ING.dni,p_token:ING.token,p_of:p.of,
        p_articulo:p.art, p_prenda:p.pre, p_cant_prog:p.total,
        p_div_ultima:null, p_div_penultima:null, p_detalle:p.det});
      if(!g || g.ok===false) lineas.push(`<div class="diff-del">${esc(p.j.name)}: ${esc((g&&g.error)||"error")}</div>`);
      else if(g.creada) lineas.push(`<div class="cf-detalle">✓ OF ${esc(g.of)}${g.prenda?" · "+esc(g.prenda):""}`
        + (g.prenda_nueva?" <b>(segunda prenda de una OF ya registrada)</b>":"")
        + ` · ${g.paquetes} paquete(s) · ${Math.round(p.total)} und`
        + ((g.difiere||[]).length?`<br>Aviso: ${esc((g.difiere||[]).join(" · "))}`:"")+`</div>`);
      else if(g.completada) lineas.push(`<div class="cf-detalle">✓ OF ${esc(g.of)} completada con su desglose · ${g.paquetes} paquete(s) · ${Math.round(p.total)} und</div>`);
      else lineas.push(`<div class="diff-del">OF ${esc(g.of)} ya registrada (${esc(g.fecha_carga||"—")}). No se escribió.`
        + ((g.difiere||[]).length?`<br>Diferencias con esta HN: ${esc((g.difiere||[]).join(" · "))}`:"")+`</div>`);
    }catch(err){ lineas.push(`<div class="diff-del">${esc(p.j.name)}: ${esc(err.message)}</div>`); }
  }
  OFS_JOBS=[]; renderOfsJobs();
  $("ofsHNRes").innerHTML=`<div class="diff-box">${lineas.join("")}</div>`;
  cargarOfs();
}
/* Alta manual: sin desglose (of_detalle vacío) — basta el corte real para el
   techo de ACABADO, pero la validación de cantidades de costura no aplicará. */
async function altaOfManual(){
  const of=normKey($("ofNueva").value), art=norm($("ofNuevaArt").value).toUpperCase();
  const prenda=norm($("ofNuevaPrenda").value).toUpperCase(), cant=parseFloat($("ofNuevaCant").value);
  if(!of){ mostrarError("Escribe la OF"); return; }
  if(!art){ mostrarError("Escribe el artículo"); return; }
  if(!cant || cant<=0){ mostrarError("El corte real debe ser mayor que cero"); return; }
  if(!confirm(`¿Registrar la OF ${of} · ${art} con ${cant} und de corte real?\nSin desglose por paquete: la validación de cantidades de costura no aplicará a esta OF.`)) return;
  try{
    const r=await rpc("fn_of_registrar",{p_dni:ING.dni,p_token:ING.token,p_of:of,p_articulo:art,
      p_prenda:prenda||null,p_cant_prog:cant,p_div_ultima:null,p_div_penultima:null,p_detalle:[]});
    if(!r || r.ok===false){ mostrarError((r&&r.error)||"No se pudo registrar"); return; }
    if(!r.creada){ mostrarError(`La OF ${r.of} ya estaba registrada (${r.fecha_carga||"—"})`); return; }
    mostrarOk(`OF ${r.of} registrada`);
    ["ofNueva","ofNuevaArt","ofNuevaPrenda","ofNuevaCant"].forEach(id=>{ if($(id)) $(id).value=""; });
    cargarOfs();
  }catch(e){ mostrarError(e.message); }
}
function ofsToggle(i){
  const el=$("ofsDet"+i); if(!el) return;
  if(!el.dataset.listo){
    const o=OFS_VISTA[i]||{}, d=o.detalle||[];
    // Cada HN numera sus paquetes desde 1: mezclarlas hacía parecer que la
    // numeración estaba duplicada. Se pinta una tabla por prenda.
    const grupos=[...new Set(d.map(x=>x.prenda||""))];
    const tabla=(pren)=>{
      const filas=d.filter(x=>(x.prenda||"")===pren);
      const und=filas.reduce((a,x)=>a+(Number(x.cant)||0),0);
      return `${grupos.length>1
          ? `<div class="tk-ops-title">${esc(pren||"Sin prenda")} · ${filas.length} paquete(s) · ${Math.round(und)} und</div>`
          : ""}
        <table class="tabla"><thead><tr><th>Talla</th><th>Color</th><th>Cant.</th><th>Numeración</th></tr></thead><tbody>${
          filas.map(x=>`<tr><td>${esc(x.talla||"—")}</td><td>${esc(x.color||"—")}</td><td>${Math.round(x.cant)}</td>
            <td>${x.desde}-${x.hasta}</td></tr>`).join("")}</tbody></table>`;
    };
    el.querySelector("td[colspan]").innerHTML=`<div class="avof-det-wrap">
      <div class="tk-ops-title">Paquetes de la HN</div>
      ${d.length ? grupos.map(tabla).join("")
                 : `<div class="vacio-msg">Sin desglose</div>`}</div>`;
    el.dataset.listo="1";
  }
  el.hidden=!el.hidden;
}

/* --- Resumen de OF (trazabilidad cross-área; programado = hoja "OF") ---
   Módulo COMPLETADO = ingeniería lo cerró (modulos_cerrados) o su última
   operación alcanzó la cant. programada. La OF está lista cuando lo están
   todos sus módulos. El N°OP máx lo da la ruta del módulo en BASE. */
async function cargarAvof(){
  $("avofTabla").innerHTML=cargandoHTML("Cargando resumen…"); $("avofResumen").textContent="";
  try{
    // Acumulativo: sin rango. Con fechas, una OF terminada a caballo entre dos
    // meses salía EN PROCESO porque las unidades anteriores quedaban fuera.
    const r=await rpc("fn_of_resumen",{p_dni:ING.dni,p_token:ING.token,p_desde:null,p_hasta:null});
    if(!r.ok){ mostrarError(r.error||"Error"); $("avofTabla").innerHTML=""; return; }
    AVOF={items:r.items||[], meta:await avofMeta(), _rows:[]};
    avofPintar();
  }catch(e){ $("avofTabla").innerHTML=""; mostrarError(e.message); }
}
/* Meta por OF. Base primero (parche 26) y hoja "OF" como respaldo para las OF
   cargadas antes de que existiera `ofs`; la base manda si están en las dos. */
async function avofMeta(){
  const m={};
  for(const a of Object.keys(AREAS)){
    if(!AREAS[a].hojaOF) continue;
    try{ Object.assign(m, await cargarMetaOF(a)); }catch(e){}
  }
  try{
    const db=await rpc("fn_of_metas",{p_dni:ING.dni,p_token:ING.token});
    if(db && db.ok!==false) Object.assign(m, db);
  }catch(e){}
  return m;
}
/* Meta de la OF. cargarMetaOF devuelve 0 si la celda CANT PROG viene vacía:
   eso es "sin dato", no "programado cero". */
function avofProg(of){ const v=AVOF.meta[normKey(of||"")]; return v>0?v:null; }
/* Cerrado por ingeniería ⇒ completado, aunque la cantidad reportada no llegue.
   El nivel elegido (última/penúltima) manda en TODO el cálculo, no solo en la
   columna que se muestra. */
function avofCant(m,nivel){ return Number(nivel==="ultima" ? m.cant_ultima : m.cant_penultima)||0; }
function avofModCompleto(m,prog,nivel){
  return m.cerrado===true || (prog!=null && avofCant(m,nivel)>=prog);
}
const avofReciente = a => a.slice().sort((x,y)=>String(y.fecha_ultima||"").localeCompare(String(x.fecha_ultima||"")))[0];
function avofFila(it,nivel,area){
  const prog=avofProg(it.of);
  const mods=(it.modulos||[]).filter(m=>!area||m.area===area);
  const pend=mods.filter(m=>!avofModCompleto(m,prog,nivel));
  const cur=avofReciente(pend.length?pend:mods)||{};   // dónde está la OF ahora mismo
  return {of:it.of, articulo:it.articulo, area:cur.area||"—", modulo:cur.modulo||"—",
    prog, real:avofCant(cur,nivel), mods, nivel,
    estado:(mods.length && !pend.length)?"COMPLETADO":"PROCESO", it};
}
function avofPintar(){
  const nivel=$("avofNivel")?$("avofNivel").value:"penultima";
  const area=$("avofArea")?$("avofArea").value:"";
  const soloCompl=$("avofSoloCompl")?$("avofSoloCompl").checked:false;
  const q=normKey($("avofBuscar")?$("avofBuscar").value:"");
  const todas=(AVOF.items||[]).map(it=>avofFila(it,nivel,area))
    .filter(r=>r.mods.length)
    .filter(r=>!q||normKey((r.articulo||"")+" "+(r.of||"")).includes(q));
  const nCompl=todas.filter(r=>r.estado==="COMPLETADO").length;
  let rows=todas.filter(r=>r.estado===(soloCompl?"COMPLETADO":"PROCESO"));
  if(avofSort.col){ const c=avofSort.col; rows.sort((a,b)=>{ return cmpVal(a[c],b[c])*avofSort.dir; }); }
  AVOF._rows=rows;
  $("avofResumen").textContent=`${nCompl} completada(s) · ${todas.length-nCompl} en proceso`
    + ` · ${area||"todas las áreas"} · operación ${nivel==="ultima"?"última":"penúltima"}`;
  const fl=k=>avofSort.col===k?(avofSort.dir===1?" ▲":" ▼"):"";
  const C=[["articulo","Artículo"],["of","OF"],["area","Área actual"],["modulo","Módulo actual"],["prog","Cant. prog."],["real","Cant. reportada"],["estado","Estado"]];
  const thead=`<thead><tr><th></th>${C.map(c=>`<th class="ord${c[0]==="articulo"?" izq":""}" onclick="ordenarAvof('${c[0]}')">${c[1]}${fl(c[0])}</th>`).join("")}</tr></thead>`;
  const body=rows.length? rows.map((r,i)=>`<tr>
      <td><button class="btn-mini gris" onclick="avofToggle(${i})">▾</button></td>
      <td class="izq"><b>${esc(r.articulo||"—")}</b></td><td>${esc(r.of)}</td>
      <td>${esc(r.area)}</td><td>${esc(r.modulo)}</td>
      <td>${r.prog!=null?Math.round(r.prog):"—"}</td><td><b>${Math.round(r.real||0)}</b></td>
      <td><span class="pill ${r.estado==="COMPLETADO"?"ACTIVO":"PROCESO"}">${r.estado}</span></td></tr>
      <tr class="avof-det" id="avofDet${i}" hidden><td></td><td colspan="7"></td></tr>`).join("")
    : `<tr><td colspan="8"><div class="vacio-msg">Sin OF ${soloCompl?"completadas":"en proceso"} con este filtro</div></td></tr>`;
  $("avofTabla").innerHTML=thead+"<tbody>"+body+"</tbody>";
}
/* El detalle se arma al abrirlo: la vista es acumulativa y puede traer muchas OF. */
function avofToggle(i){
  const el=$("avofDet"+i); if(!el) return;
  if(!el.dataset.listo && AVOF._rows[i]){
    el.querySelector("td[colspan]").innerHTML=avofDetalle(AVOF._rows[i]); el.dataset.listo="1";
  }
  el.hidden=!el.hidden;
}
function avofEstadoMod(m,prog,nivel){ return m.cerrado?"CERRADO":(avofModCompleto(m,prog,nivel)?"COMPLETADO":"PROCESO"); }
function avofDetalle(r){
  const pill=t=>`<span class="pill ${t==="CERRADO"?"CERRADO":(t==="COMPLETADO"||t==="LISTO")?"ACTIVO":"PROCESO"}">${t}</span>`;
  const sinRuta=`<span class="avof-aviso" title="Este módulo no tiene ruta en BASE: se usa el mayor N°OP reclamado.">*</span>`;
  const mods=(r.mods||[]).map(m=>`<tr><td>${esc(m.area)}</td><td class="izq">${esc(m.modulo)}</td>
      <td>${m.nop_max==null?"—":m.nop_max}${m.ruta_base===false?sinRuta:""}</td>
      <td class="izq">${esc(m.op_ultima||"—")}</td><td>${m.cant_penultima}</td><td>${m.cant_ultima}</td>
      <td>${esc(m.fecha_entrada||"—")}</td><td>${esc(m.fecha_ultima||"—")}</td>
      <td>${pill(avofEstadoMod(m,r.prog,r.nivel))}</td></tr>`).join("")
    ||`<tr><td colspan="9"><div class="vacio-msg">Sin módulos</div></td></tr>`;
  const porArea={};
  (r.mods||[]).forEach(m=>{ const a=porArea[m.area]=porArea[m.area]||{n:0,ok:0};
    a.n++; if(avofModCompleto(m,r.prog,r.nivel)) a.ok++; });
  const trz=(r.it.areas||[]).filter(a=>porArea[a.area]).map(a=>{
    const s=porArea[a.area], listo=s.ok===s.n;
    return `<tr><td>${esc(a.area)}</td><td>${esc(a.entrada||"—")}</td><td>${esc(a.salida||"—")}</td>
      <td>${a.cantidad}</td><td>${s.ok}/${s.n}</td><td>${pill(listo?"LISTO":"EN PROCESO")}</td></tr>`;
  }).join("")||`<tr><td colspan="6"><div class="vacio-msg">Sin trazas</div></td></tr>`;
  return `<div class="avof-det-wrap">
    <div class="tk-ops-title">Por módulo (penúltima / última operación de cada módulo)</div>
    <table class="tabla"><thead><tr><th>Área</th><th class="izq">Módulo</th><th>N°OP máx</th><th class="izq">Última op.</th>
      <th>Penúltima${r.nivel!=="ultima"?" ◄":""}</th><th>Última${r.nivel==="ultima"?" ◄":""}</th>
      <th>Entró</th><th>Fecha últ.</th><th>Estado</th></tr></thead><tbody>${mods}</tbody></table>
    <div class="tk-ops-title" style="margin-top:10px;">Trazabilidad por área (entró / salió)</div>
    <table class="tabla"><thead><tr><th>Área</th><th>Entró</th><th>Salió</th><th>Cant.</th><th>Módulos listos</th><th>Estado</th></tr></thead><tbody>${trz}</tbody></table>
  </div>`;
}
function descargarAvof(){
  const rows=AVOF._rows||[]; if(!rows.length){ mostrarError("No hay datos para descargar"); return; }
  const CAB=["Artículo","OF","Área actual","Módulo actual","Cant programada","Cant reportada","Estado"];
  const filas=rows.map(r=>[r.articulo,r.of,r.area,r.modulo,r.prog,r.real,r.estado]);
  const det=[["OF","Área","Módulo","N°OP máx","Última op.","Penúltima","Última","Entró","Fecha últ.","Cerrado","Estado"]];
  rows.forEach(r=>(r.mods||[]).forEach(m=>det.push([r.of,m.area,m.modulo,m.nop_max,m.op_ultima,
    m.cant_penultima,m.cant_ultima,m.fecha_entrada,m.fecha_ultima,m.cerrado?"SÍ":"NO",avofEstadoMod(m,r.prog,r.nivel)])));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CAB,...filas]), "ResumenOF");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(det), "PorModulo");
  XLSX.writeFile(wb,"RESUMEN_OF.xlsx");
}

/* ================= TICKETS DEL DÍA ================= */
let TK=[], TK_VISTA=[], BASES_CACHE={};
let tkSort={col:null,dir:1};
let tkArea="";                 // filtro de área activo (select); "" = todas
let modoLibTk=false, libSel={}; // modo liberar en lote + códigos marcados
let tkPag=1; const TK_PAGE=100; // paginación de la tabla (100 por página)
const TK_COLS=[
  {k:"hora",t:"Hora"},{k:"nombre",t:"Nombre"},{k:"area",t:"Área"},{k:"articulo",t:"Artículo"},
  {k:"of",t:"OF"},{k:"op",t:"Operación"},{k:"std",t:"STD"},{k:"cant",t:"Cant"},
  {k:"minutos",t:"Min gen."},{k:"num",t:"Numeración"},{k:"estado",t:"Estado"}
];
function ordenarTk(col){ if(tkSort.col===col) tkSort.dir*=-1; else tkSort={col,dir:1}; pintarTk(); }
function descargarTk(){
  const lista = TK_VISTA;
  if(!lista.length){ mostrarError("No hay tickets para descargar"); return; }
  const CAB = ["Hora","Nombre","DNI","Área","Artículo","OF","Operación","STD","Cant","Min generado","Numeración","Estado"];
  const filas = lista.map(t=>[t.hora,t.nombre,t.dni,t.area,t.articulo,t.of,t.op,t.std,t.cant,t.minutos,t.num,t.estado]);
  const ws = XLSX.utils.aoa_to_sheet([CAB, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TicketsDia");
  XLSX.writeFile(wb, `TICKETS_${$("fechaTk").value}.xlsx`);
}

async function cargarTk(){
  $("tablaTk").innerHTML=cargandoHTML("Cargando…");
  $("resumenUltimas").innerHTML="";
  libSel={}; tkPag=1;
  try{
    TK = await rpc("fn_tickets_dia",{p_dni:ING.dni,p_token:ING.token,p_fecha:$("fechaTk").value});
    // Si el área filtrada ya no tiene tickets hoy, vuelve a "todas".
    if(tkArea && !TK.some(t=>t.area===tkArea)) tkArea="";
    poblarAreaTk();
    pintarTk();
    cargarResumenUltimas();   // no bloquea la tabla
  }catch(e){ $("tablaTk").innerHTML=""; mostrarError(e.message); }
}

/* Select de área: solo las áreas que registraron tickets hoy. */
function poblarAreaTk(){
  const s=$("areaTk"); if(!s) return;
  const areas=[...new Set(TK.map(t=>t.area).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"es"));
  s.innerHTML = `<option value="">Todas las áreas</option>`
    + areas.map(a=>`<option ${a===tkArea?"selected":""}>${esc(a)}</option>`).join("");
  s.value = tkArea;
}
function filtrarTkArea(a){ tkArea=a; tkPag=1; pintarTk(); cargarResumenUltimas(); }

/* Liberar en lote: alterna el modo de selección con checkboxes. */
function toggleModoLiberar(){
  modoLibTk=!modoLibTk; libSel={};
  const bm=$("btnModoLiberar"), bs=$("btnLiberarSel"), bv=$("btnMarcarVisibles");
  if(bm){ bm.textContent = modoLibTk ? "Cancelar lote" : "Liberar en lote"; bm.classList.toggle("gris",modoLibTk); }
  if(bs){ bs.style.display = modoLibTk ? "inline-block" : "none"; bs.textContent="Liberar selección (0)"; }
  if(bv) bv.style.display = modoLibTk ? "inline-block" : "none";
  pintarTk();
}
function toggleLibSel(codigo){
  if(libSel[codigo]) delete libSel[codigo]; else libSel[codigo]=true;
  actualizarLibSel();
}
function actualizarLibSel(){
  const bs=$("btnLiberarSel"); if(bs) bs.textContent=`Liberar selección (${Object.keys(libSel).length})`;
}
/* Marcar todos los tickets ACTIVOS visibles (respeta filtro de área/búsqueda). */
function marcarVisiblesLib(){
  const todos = TK_VISTA.filter(t=>t.estado==='ACTIVO');
  const faltan = todos.some(t=>!libSel[t.codigo]);
  if(faltan) todos.forEach(t=>{ libSel[t.codigo]=true; });   // marca todos
  else todos.forEach(t=>{ delete libSel[t.codigo]; });        // si ya estaban todos, desmarca
  actualizarLibSel();
  pintarTk();
}
async function liberarLote(){
  const codigos=Object.keys(libSel);
  if(!codigos.length){ mostrarError("No hay tickets seleccionados"); return; }
  const motivo=prompt(`Liberar ${codigos.length} ticket(s) seleccionado(s).\nMotivo:`);
  if(motivo===null) return;
  try{
    // Los códigos son únicos SOLO por área → agrupar por área antes de liberar.
    const areaDe={}; TK.forEach(t=>{ if(t && t.codigo!=null) areaDe[String(t.codigo)]=t.area; });
    const porArea={}; codigos.forEach(c=>{ const a=areaDe[String(c)]||tkArea||""; (porArea[a]=porArea[a]||[]).push(c); });
    for(const a of Object.keys(porArea)){
      const r=await rpc("fn_liberar_lote",{p_dni:ING.dni,p_token:ING.token,
        p_codigos:porArea[a],p_motivo:motivo.trim(),p_area:a||null});
      if(!r.ok){ mostrarError(r.error||"No se pudo liberar"); return; }
      const av=avisoTroceoLote(r); if(av) mostrarOk(`${a||"—"}${av}`);
    }
    modoLibTk=false; libSel={};
    const bm=$("btnModoLiberar"); if(bm){ bm.textContent="LIBERAR EN LOTE"; bm.classList.remove("gris"); }
    const bs=$("btnLiberarSel"); if(bs) bs.style.display="none";
    await cargarTk();
  }catch(e){ mostrarError(e.message); }
}
let tkOcultarLib=false;
function toggleOcultarLib(){ tkOcultarLib = !!($("chkOcultarLib") && $("chkOcultarLib").checked); pintarTk(); }
function pintarTk(){
  // Búsqueda por tokens: se separa el texto por espacios y "/" y cada término
  // debe aparecer en la fila. Antes se normalizaba toda la consulta junta, así
  // que "juan / 1234" quedaba "JUAN1234" y no coincidía entre campos (bug del "/").
  const tokens = String($("filtroTk").value).split(/[\s/]+/).map(normKey).filter(Boolean);
  TK_VISTA = TK.filter(t=>{
    if(tkOcultarLib && t.estado==='LIBERADO') return false;
    if(tkArea && t.area!==tkArea) return false;
    if(!tokens.length) return true;
    const hay = normKey(t.nombre+" "+t.of+" "+t.articulo+" "+t.op+" "+t.codigo+" "+t.area);
    return tokens.every(tok=>hay.includes(tok));
  });
  if(tkSort.col){
    TK_VISTA.sort((a,b)=>{
      const va=a[tkSort.col], vb=b[tkSort.col];
      const c=cmpVal(va,vb);
      return c*tkSort.dir;
    });
  }
  const lista=TK_VISTA;
  const min=lista.reduce((a,t)=>a+(t.estado==='ACTIVO'?Number(t.minutos):0),0);
  $("resumenTk").textContent=`${lista.length} tickets · ${Math.round(min)} min activos`
    + (tkArea?` · área: ${tkArea}`:"");
  // Panel lateral (solo al buscar): operaciones por OF con cantidad total realizada.
  renderTkOpsPanel(tokens.length>0);
  // Paginación (100 por página).
  const totalP=Math.max(1, Math.ceil(lista.length/TK_PAGE));
  if(tkPag>totalP) tkPag=totalP; if(tkPag<1) tkPag=1;
  const ini=(tkPag-1)*TK_PAGE;
  const pagina=lista.slice(ini, ini+TK_PAGE);
  // Cualquier cargo INGENIERIA puede liberar (el servidor revalida).
  const flecha=k=>tkSort.col===k?(tkSort.dir===1?" \u25B2":" \u25BC"):"";
  const thead="<thead><tr>"
    +(modoLibTk?`<th></th>`:"")
    +TK_COLS.map(c=>`<th class="ord" onclick="ordenarTk('${c.k}')">${c.t}${flecha(c.k)}</th>`).join("")
    +"<th></th></tr></thead>";
  $("tablaTk").innerHTML = thead+"<tbody>"+
    pagina.map((t,idx)=>{ const i=ini+idx; return `<tr>
      ${modoLibTk?`<td>${t.estado==='ACTIVO'?`<input type="checkbox" class="chk-lib" ${libSel[t.codigo]?"checked":""} onclick="toggleLibSel('${esc(t.codigo)}')">`:""}</td>`:""}
      <td>${esc(t.hora)}</td><td>${esc(t.nombre)}</td><td>${esc(t.area)}</td>
      <td>${esc(t.articulo)}</td><td>${esc(t.of)}</td><td class="izq">${esc(t.op)}</td>
      <td>${t.std!=null?t.std:""}</td><td>${t.cant}</td><td>${t.minutos}</td><td>${esc(t.num)}</td>
      <td><span class="pill ${esc(t.estado)}">${esc(t.estado)}</span></td>
      <td>${t.estado==='ACTIVO'?`<button class="btn-mini rojo" onclick="liberarTicket(${i})">LIBERAR</button>`:""}</td>
      </tr>`; }).join("")+"</tbody>";
  const pg=$("tkPager");
  if(pg){
    if(totalP<=1){ pg.innerHTML=""; }
    else pg.innerHTML = `<button class="btn-mini" ${tkPag<=1?"disabled":""} onclick="tkIrPagina(-1)">‹ Anterior</button>`
      + `<span class="pg-info">Página ${tkPag} de ${totalP} · ${lista.length} filas</span>`
      + `<button class="btn-mini" ${tkPag>=totalP?"disabled":""} onclick="tkIrPagina(1)">Siguiente ›</button>`;
  }
}
function tkIrPagina(d){ tkPag=Math.max(1, tkPag+d); pintarTk(); }
/* Panel de operaciones por OF (cantidad total realizada de tickets reclamados) — solo al buscar. */
function renderTkOpsPanel(activo){
  const panel=$("tkOpsPanel"); if(!panel) return;
  if(!activo){ panel.style.display="none"; panel.innerHTML=""; return; }
  const byOf={};
  TK_VISTA.forEach(t=>{
    if(t.estado!=='ACTIVO') return;
    const of=norm(t.of)||"(sin OF)"; const op=norm(t.op)||"(sin operación)";
    (byOf[of]=byOf[of]||{}); byOf[of][op]=(byOf[of][op]||0)+(Number(t.cant)||0);
  });
  const ofs=Object.keys(byOf).sort((a,b)=>a.localeCompare(b,"es"));
  if(!ofs.length){ panel.style.display="none"; panel.innerHTML=""; return; }
  // Resumen por nombre de operación (op → total realizado, sumando todas las OFs).
  const byOpTot={};
  TK_VISTA.forEach(t=>{
    if(t.estado!=='ACTIVO') return;
    const op=norm(t.op)||"(sin operación)";
    byOpTot[op]=(byOpTot[op]||0)+(Number(t.cant)||0);
  });
  const ops2=Object.keys(byOpTot).sort((a,b)=>a.localeCompare(b,"es"));
  panel.style.display="";
  panel.innerHTML = `<div class="tk-ops-title">Operaciones por OF</div>` + ofs.map(of=>{
    const ops=byOf[of]; const opNames=Object.keys(ops).sort((a,b)=>a.localeCompare(b,"es"));
    const totOf=opNames.reduce((a,o)=>a+ops[o],0);
    return `<details class="tk-ops-of">
      <summary>${esc(of)} · ${Math.round(totOf)} und</summary>
      ${opNames.map(o=>`<div class="tk-ops-row"><span>${esc(o)}</span><span>${Math.round(ops[o])}</span></div>`).join("")}
    </details>`;
  }).join("")
  + `<div class="tk-ops-title" style="margin-top:14px;">Resumen por operación</div>`
  + ops2.map(op=>`<div class="tk-ops-row"><span>${esc(op)}</span><span>${Math.round(byOpTot[op])}</span></div>`).join("");
}

/* Retiro de tickets desde la app: SOLO el usuario ALOPEZ.
   El servidor vuelve a validar (fn_liberar_ticket); esto es solo UI. */
async function liberarTicket(i){
  const t = TK_VISTA[i]; if(!t) return;
  const motivo = prompt(`Liberar el ticket ${t.num||t.codigo} tomado por ${t.nombre}.\nMotivo:`);
  if(motivo===null) return;
  try{
    const r = await rpc("fn_liberar_ticket",{p_dni:ING.dni,p_token:ING.token,
      p_codigo:t.codigo,p_motivo:motivo.trim(),p_area:t.area});
    if(!r.ok){ mostrarError(r.error||"No se pudo liberar"); return; }
    mostrarOk(`Ticket ${t.codigo} liberado${avisoTroceo(r)}`);
    await cargarTk();
  }catch(e){ mostrarError(e.message); }
}

/* ---- Tickets · Reclamados x Operación (por OF, sin filtro de fecha) ---- */
let TKOP={items:[],of:"",area:"",_rows:[]}, tkOpSort={col:null,dir:1}, tkOpMarc={}, tkOpPag=1;
const TKOP_PAGE=10;
function tkVista(v){
  const op=v==="op";
  $("tkActualView").hidden=op; $("tkOpView").hidden=!op;
  $("tkTabActual").classList.toggle("activo",!op); $("tkTabOp").classList.toggle("activo",op);
  if(op){ const s=$("tkOpArea"); if(s && !s.value && s.options.length<=1)
    s.innerHTML=`<option value="">— Elige área —</option>`+(AREAS_LISTA||[]).map(a=>`<option>${esc(a)}</option>`).join(""); }
}
async function cargarTkOp(){
  const area=$("tkOpArea").value, of=$("tkOpOf").value.trim();
  if(!area){ mostrarError("Elige el área"); return; }
  if(!of){ mostrarError("Escribe la OF"); return; }
  $("tablaTkOp").innerHTML=cargandoHTML("Cargando…"); $("tkOpResumen").textContent="";
  tkOpMarc={}; tkOpPag=1;
  try{
    const r=await rpc("fn_reclamos_por_of",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_of:of});
    if(!r.ok){ mostrarError(r.error||"Error"); $("tablaTkOp").innerHTML=""; return; }
    TKOP={items:r.items||[], of, area, _rows:[]};
    const ops=[...new Set(TKOP.items.map(x=>x.op).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"es"));
    $("tkOpSel").innerHTML=`<option value="">Todas</option>`+ops.map(o=>`<option>${esc(o)}</option>`).join("");
    pintarTkOp();
  }catch(e){ $("tablaTkOp").innerHTML=""; mostrarError(e.message); }
}
function tkOpFiltrar(){ tkOpPag=1; pintarTkOp(); }
function ordenarTkOp(col){ if(tkOpSort.col===col) tkOpSort.dir*=-1; else tkOpSort={col,dir:1}; pintarTkOp(); }
function tkOpToggle(c){ if(tkOpMarc[c]) delete tkOpMarc[c]; else tkOpMarc[c]=true; pintarTkOp(); }
function tkOpPagina(d){ tkOpPag+=d; pintarTkOp(); }
function tkOpMarcarVisibles(){
  const act=(TKOP._rows||[]).filter(t=>t.estado==='ACTIVO');
  const faltan=act.some(t=>!tkOpMarc[t.codigo]);
  act.forEach(t=>{ if(faltan) tkOpMarc[t.codigo]=true; else delete tkOpMarc[t.codigo]; });
  pintarTkOp();
}
function pintarTkOp(){
  const opSel=$("tkOpSel").value, q=normKey($("tkOpBuscar").value), ocultarLib=$("tkOpOcultarLib").checked;
  let rows=(TKOP.items||[]).filter(t=>{
    if(opSel && t.op!==opSel) return false;
    if(ocultarLib && t.estado==='LIBERADO') return false;
    if(!q) return true;
    return normKey((t.nombre||"")+" "+(t.dni||"")+" "+(t.numeracion||"")+" "+(t.codigo||"")).includes(q);
  });
  if(tkOpSort.col){ const c=tkOpSort.col; rows.sort((a,b)=>{ return cmpVal(a[c],b[c])*tkOpSort.dir; }); }
  TKOP._rows=rows;
  const totP=Math.max(1,Math.ceil(rows.length/TKOP_PAGE));
  if(tkOpPag>totP) tkOpPag=totP; if(tkOpPag<1) tkOpPag=1;
  const pag=rows.slice((tkOpPag-1)*TKOP_PAGE, tkOpPag*TKOP_PAGE);
  const nsel=Object.keys(tkOpMarc).length;
  const act=rows.filter(t=>t.estado==='ACTIVO');
  const sum=(a,k)=>a.reduce((x,t)=>x+(Number(t[k])||0),0);
  $("tkOpResumen").textContent=`OF ${esc(TKOP.of)} · ${rows.length} ticket(s) · `
    + `${qty(sum(act,"cant"))} und · ${Math.round(sum(act,"minutos"))} min (activos) · ${nsel} seleccionado(s)`;
  const bs=$("tkOpLiberarSel"); if(bs) bs.textContent=`Liberar selección (${nsel})`;
  const fl=k=>tkOpSort.col===k?(tkOpSort.dir===1?" ▲":" ▼"):"";
  const COLS=[["nombre","Nombre"],["dni","DNI"],["op","Operación"],["hora","Fecha/hora reclamado"],["numeracion","Numeración"],["cant","Cant"],["minutos","Min"],["estado","Estado"]];
  const thead=`<thead><tr><th></th>${COLS.map(c=>`<th class="ord${c[0]==="nombre"?" izq":""}" onclick="ordenarTkOp('${c[0]}')">${c[1]}${fl(c[0])}</th>`).join("")}<th></th></tr></thead>`;
  const body=pag.length? pag.map(t=>`<tr${t.estado==='LIBERADO'?' style="opacity:.55;"':''}>
      <td>${t.estado==='ACTIVO'?`<input type="checkbox" class="sw" ${tkOpMarc[t.codigo]?"checked":""} onclick="tkOpToggle('${esc(t.codigo)}')">`:""}</td>
      <td class="izq">${esc(t.nombre)}</td><td>${esc(t.dni)}</td>
      <td>${esc(t.op)}${t.causa?`<div class="cf-detalle">${esc(t.causa)}</div>`:""}</td>
      <td>${esc(t.hora)}</td><td>${esc(t.numeracion||"—")}</td>
      <td><b>${t.cant!=null?qty(t.cant):"—"}</b></td><td>${t.minutos!=null?t.minutos:"—"}</td>
      <td><span class="pill ${t.estado==='ACTIVO'?'ACTIVO':'FALTA'}">${esc(t.estado)}</span></td>
      <td>${t.estado==='ACTIVO'?`<button class="btn-mini rojo" onclick="liberarTkOp('${esc(t.codigo)}')">LIBERAR</button>`:""}</td></tr>`).join("")
    : `<tr><td colspan="10"><div class="vacio-msg">Sin tickets reclamados para esta OF</div></td></tr>`;
  $("tablaTkOp").innerHTML=thead+"<tbody>"+body+"</tbody>";
  const pg=$("tkOpPager");
  if(pg) pg.innerHTML = totP>1
    ? `<button class="btn-mini" ${tkOpPag<=1?"disabled":""} onclick="tkOpPagina(-1)">‹ Anterior</button>
       <span class="sub" style="margin:0 8px;">${tkOpPag}/${totP}</span>
       <button class="btn-mini" ${tkOpPag>=totP?"disabled":""} onclick="tkOpPagina(1)">Siguiente ›</button>` : "";
}
async function liberarTkOp(codigo){
  const t=(TKOP.items||[]).find(x=>x.codigo===codigo);
  const motivo=prompt(`Liberar el ticket ${t?(t.numeracion||codigo):codigo} tomado por ${t?t.nombre:""}.\nMotivo:`);
  if(motivo===null) return;
  try{
    const r=await rpc("fn_liberar_ticket",{p_dni:ING.dni,p_token:ING.token,p_codigo:codigo,p_motivo:(motivo||"").trim(),p_area:TKOP.area});
    if(!r.ok){ mostrarError(r.error||"No se pudo liberar"); return; }
    mostrarOk(`Ticket ${codigo} liberado${avisoTroceo(r)}`);
    delete tkOpMarc[codigo]; await cargarTkOp();
  }catch(e){ mostrarError(e.message); }
}
async function liberarTkOpLote(){
  const cods=Object.keys(tkOpMarc);
  if(!cods.length){ mostrarError("No hay tickets seleccionados"); return; }
  const motivo=prompt(`Liberar ${cods.length} ticket(s) seleccionado(s).\nMotivo:`);
  if(motivo===null) return;
  try{
    const r=await rpc("fn_liberar_lote",{p_dni:ING.dni,p_token:ING.token,p_codigos:cods,p_motivo:motivo.trim(),p_area:TKOP.area});
    if(!r.ok){ mostrarError(r.error||"No se pudo liberar"); return; }
    mostrarOk(`${r.liberados||cods.length} ticket(s) liberado(s)${avisoTroceoLote(r)}`);
    tkOpMarc={}; await cargarTkOp();
  }catch(e){ mostrarError(e.message); }
}

/* Tarjetas: suma de cantidades de las 2 últimas operaciones (mayor N°OP
   por artículo según la BASE), sobre los tickets ACTIVOS del día.
   Son 2 tarjetas globales (última y penúltima operación), sumando
   cantidades de todos los artículos del día que caigan en cada una. */
async function cargarResumenUltimas(){
  const z=$("resumenUltimas"); if(!z) return;
  z.innerHTML="";
  if(!TK.length) return;
  const areas=[...new Set(TK.map(t=>t.area).filter(Boolean))].filter(a=>!tkArea||a===tkArea);
  for(const a of areas){
    if(!BASES_CACHE[a]){
      try{ BASES_CACHE[a] = await rpc("fn_bases_listar",{p_dni:ING.dni,p_token:ING.token,p_area:a}); }
      catch(e){ BASES_CACHE[a]=[]; }
    }
  }
  const info={};   // "AREA|ARTICULO" -> {n1,n2,op1:Set,op2:Set}
  areas.forEach(a=>{
    const porArt={};
    (BASES_CACHE[a]||[]).forEach(b=>{
      const k=normKey(b.articulo);
      (porArt[k]=porArt[k]||[]).push(b);
    });
    Object.keys(porArt).forEach(k=>{
      const nops=[...new Set(porArt[k].map(b=>Number(b.n_op)).filter(n=>!isNaN(n)&&n>0))].sort((x,y)=>y-x);
      if(!nops.length) return;
      const n1=nops[0], n2=(nops[1]!==undefined?nops[1]:null);
      info[a+"|"+k]={
        n1, n2,
        op1:new Set(porArt[k].filter(b=>Number(b.n_op)===n1).map(b=>norm(b.operacion)).filter(Boolean)),
        op2:n2!=null?new Set(porArt[k].filter(b=>Number(b.n_op)===n2).map(b=>norm(b.operacion)).filter(Boolean)):new Set()
      };
    });
  });
  let c1=0,c2=0,sinNop=0; const o1=new Set(), o2=new Set();
  TK.forEach(t=>{
    if(t.estado!=="ACTIVO") return;
    if(tkArea && t.area!==tkArea) return;
    const i=info[t.area+"|"+normKey(t.articulo)];
    if(!i) return;
    if(t.nop==null || t.nop===""){ sinNop++; return; }
    const n=Number(t.nop);
    if(n===i.n1){ c1+=Number(t.cant)||0; i.op1.forEach(x=>o1.add(x)); }
    else if(i.n2!=null && n===i.n2){ c2+=Number(t.cant)||0; i.op2.forEach(x=>o2.add(x)); }
  });
  const nom=s=>{ const l=[...s]; return l.length? l.slice(0,3).join(" / ")+(l.length>3?"…":"") : "—"; };
  z.innerHTML = `
    <div class="kpi"><div class="kpi-num">${Math.round(c1)}</div>
      <div class="kpi-lbl">ÚLTIMA OPERACIÓN · und<br>${esc(nom(o1))}</div></div>
    <div class="kpi"><div class="kpi-num">${Math.round(c2)}</div>
      <div class="kpi-lbl">PENÚLTIMA OPERACIÓN · und<br>${esc(nom(o2))}</div></div>`
    + (sinNop?`<div class="kpi"><div class="kpi-num">${sinNop}</div>
      <div class="kpi-lbl">TICKETS SIN N°OP<br>no cuentan en las tarjetas</div></div>`:"");
}

/* ================= BASES ================= */
const CAB_BASE = ["PRENDA","CLIENTE","MÓDULO","ARTICULO","OPERACIÓN","STD","MAX OP.","NOP"];
const BASE_COLS=[
  {k:"prenda",t:"Prenda"},{k:"cliente",t:"Cliente"},{k:"modulo",t:"Módulo"},
  {k:"articulo",t:"Artículo"},{k:"operacion",t:"Operación"},{k:"std",t:"STD"},
  {k:"max_op",t:"Max Op."},{k:"n_op",t:"N_OP"}
];
let BASE=[], baseSort={col:null,dir:1};
let basePag=1; const BASE_PAGE=100;
function filtrarBases(){ basePag=1; pintarBases(); }
function basePagina(d){ basePag+=d; pintarBases(); }

async function cargarBases(){
  $("zonaDiff").style.display="none";
  $("tablaBases").innerHTML=cargandoHTML("Cargando base…");
  try{
    BASE = await rpc("fn_bases_listar",{p_dni:ING.dni,p_token:ING.token,p_area:$("areaBase").value});
    BASES_CACHE[$("areaBase").value] = BASE;
    pintarBases();
  }catch(e){ $("tablaBases").innerHTML=""; mostrarError(e.message); }
}
function basesFiltradas(){
  const fa=normKey($("fArt").value), fo=normKey($("fOp").value), fc=normKey($("fCli").value);
  const fm=normKey(($("fMod")||{}).value||"");
  return BASE.filter(b=>
    (!fa||normKey(b.articulo).includes(fa)) &&
    (!fo||normKey(b.operacion).includes(fo)) &&
    (!fc||normKey(b.cliente).includes(fc)) &&
    (!fm||normKey(b.modulo).includes(fm)));
}
/* Módulos distintos en la vista actual: si es uno solo, su STD es "el tiempo
   del módulo" y se muestra aparte. */
function basesModulosVista(lista){
  return [...new Set((lista||[]).map(b=>norm(b.modulo)).filter(Boolean))];
}
function ordenarBase(col){
  if(baseSort.col===col) baseSort.dir*=-1; else baseSort={col,dir:1};
  pintarBases();
}
function pintarBases(){
  let lista = basesFiltradas();
  if(baseSort.col){
    lista = [...lista].sort((a,b)=>{
      const va=a[baseSort.col], vb=b[baseSort.col];
      const c=cmpVal(va,vb);
      return c*baseSort.dir;
    });
  }
  const arts = new Set(lista.map(b=>b.articulo));
  const stdTotal = lista.reduce((a,b)=>a+(Number(b.std)||0),0);
  const totalFilas = lista.length;
  // Paginación (la base puede tener miles de filas).
  const totPag = Math.max(1, Math.ceil(totalFilas/BASE_PAGE));
  if(basePag>totPag) basePag=totPag; if(basePag<1) basePag=1;
  lista = lista.slice((basePag-1)*BASE_PAGE, basePag*BASE_PAGE);
  const mods=basesModulosVista(lista);
  const extra = mods.length===1
    ? ` · módulo ${mods[0]}: ${Math.round(stdTotal*100)/100} min`
    : (mods.length>1 ? ` · ${mods.length} módulos` : "");
  $("resumenBases").textContent =
    `${arts.size} artículo(s) · ${totalFilas} operaciones · STD total: ${Math.round(stdTotal*100)/100}${extra}`;
  // #11: editar artículo solo tiene sentido con UN artículo a la vista.
  { const be=$("btnEditArt"); if(be) be.hidden = (arts.size !== 1); }
  const flecha = k => baseSort.col===k ? (baseSort.dir===1?" \u25B2":" \u25BC") : "";
  // Final = mayor N°OP del artículo (⭐ dorada); penúltima = 2º mayor (estrella plateada).
  const finalPorArt = calcularFinalesBase(BASE);
  const thead = "<thead><tr>"+BASE_COLS.map(c=>
    `<th class="ord${c.k==='operacion'?' izq':''}" onclick="ordenarBase('${c.k}')">${c.t}${flecha(c.k)}</th>`).join("")
    +"<th></th></tr></thead>";
  $("tablaBases").innerHTML = thead + "<tbody>"+
    lista.map(b=>{
      const f=finalPorArt[normKey(b.articulo)]||{};
      const n=Number(b.n_op);
      const estrella = (f.n1!=null && n===f.n1)
        ? `<span class="estrella estrella-final" title="Operación final">★</span> `
        : (f.n2!=null && n===f.n2)
          ? `<span class="estrella estrella-pen" title="Penúltima operación">★</span> `
          : "";
      return `<tr><td>${esc(b.prenda)}</td><td>${esc(b.cliente)}</td><td>${esc(b.modulo)}</td>
      <td><b>${esc(b.articulo)}</b></td><td class="izq">${estrella}${esc(b.operacion)}</td><td>${b.std}</td>
      <td>${b.max_op}</td><td>${b.n_op}</td>
      <td><div class="acc-base">
        <button class="acc-editar" onclick="abrirModalBaseOp(${b.id})">Editar</button>
        <button class="acc-borrar" onclick="eliminarBaseOp(${b.id},'${esc((b.operacion||"").replace(/'/g,""))}','${esc((b.articulo||"").replace(/'/g,""))}')">Borrar</button>
      </div></td></tr>`;
    }).join("")+"</tbody>";
  const pg=$("basesPager");
  if(pg) pg.innerHTML = totPag>1
    ? `<button class="btn-mini" ${basePag<=1?"disabled":""} onclick="basePagina(-1)">‹ Anterior</button>
       <span class="sub" style="margin:0 8px;">${basePag}/${totPag}</span>
       <button class="btn-mini" ${basePag>=totPag?"disabled":""} onclick="basePagina(1)">Siguiente ›</button>` : "";
}

/* Mapa articulo(normKey) -> {n1: mayor N°OP, n2: 2º mayor} sobre TODA la base. */
function calcularFinalesBase(filas){
  const porArt={};
  (filas||[]).forEach(b=>{ (porArt[normKey(b.articulo)]=porArt[normKey(b.articulo)]||[]).push(b); });
  const res={};
  Object.keys(porArt).forEach(k=>{
    const nops=[...new Set(porArt[k].map(b=>Number(b.n_op)).filter(n=>!isNaN(n)&&n>0))].sort((x,y)=>y-x);
    res[k]={ n1: nops.length?nops[0]:null, n2: nops.length>1?nops[1]:null };
  });
  return res;
}
function descargarBase(){
  const lista = basesFiltradas();
  if(!lista.length){ mostrarError("No hay filas para descargar (revisa filtros o carga la base)"); return; }
  // fn_bases_listar devuelve n_op (b.nop no existe: antes exportaba la columna vacía)
  const filas = lista.map(b=>[b.prenda,b.cliente,b.modulo,b.articulo,b.operacion,b.std,b.max_op,b.n_op]);
  const ws = XLSX.utils.aoa_to_sheet([CAB_BASE, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
  XLSX.writeFile(wb, `BASE_${$("areaBase").value.replace(/ /g,"_")}_${hoyISO()}.xlsx`);
}

/* --- Borrar ARTÍCULO completo (con modal de confirmación) --- */
function abrirModalBorrarArt(){
  const arts=[...new Set((BASE||[]).map(b=>norm(b.articulo)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
  if(!arts.length){ mostrarError("Carga una base primero"); return; }
  const opts=arts.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join("");
  abrirModal(`
    <h2 style="margin:0 0 12px;color:var(--azul);font-size:20px;">Borrar artículo</h2>
    <label class="campo" style="margin-bottom:12px;"><span>Artículo</span>
      <select id="delArtSel" style="border:2px solid #cfd8e6;border-radius:10px;padding:9px 12px;font-size:15px;font-weight:600;"
        onchange="$('delArtMsg').textContent='SEGURO QUE DESEAS BORRAR: ART '+this.value+' ?'">${opts}</select></label>
    <div id="delArtMsg" style="background:#fdeceb;border:1.5px solid var(--alerta);color:var(--alerta);font-weight:800;border-radius:12px;padding:12px 14px;margin-bottom:12px;">SEGURO QUE DESEAS BORRAR: ART ${esc(arts[0])} ?</div>
    <p class="seccion-sub" style="margin:0 0 16px;">Se eliminarán TODAS las operaciones de ese artículo. No se puede deshacer.</p>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
      <button class="btn-mini gris" onclick="cerrarModal()">Cancelar</button>
      <button class="btn-mini rojo" onclick="confirmarBorrarArt()">Confirmar borrado</button>
    </div>`);
}
async function confirmarBorrarArt(){
  const sel=$("delArtSel"); if(!sel) return;
  const art=sel.value; if(!art) return;
  const area=$("areaBase").value;
  try{
    const r=await rpc("fn_base_articulo_eliminar",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_articulo:art});
    if(!r.ok){ mostrarError(r.error||"No se pudo borrar"); return; }
    cerrarModal();
    mostrarOk(`Artículo ${art} eliminado (${r.eliminadas} operación(es))`);
    await cargarBases();
  }catch(e){ mostrarError(e.message); }
}

/* --- CRUD de BASE por fila (editar STD / artículos / operaciones) --- */
let BASE_VALORES={};   // cache por área de valores históricos (prendas/clientes/…/maxop)
async function abrirModalBaseOp(id){
  const area = $("areaBase").value;
  const esEdicion = id!=null;
  // Al AGREGAR, el artículo lo manda el filtro: con dos o más a la vista no se
  // sabe a cuál cuelga la operación nueva. Sin artículos visibles se deja libre,
  // que es como se da de alta el primero de un artículo nuevo.
  let pre = null;
  if(!esEdicion){
    const vis = basesFiltradas();
    const arts = [...new Set(vis.map(x=>normKey(x.articulo)).filter(Boolean))];
    if(arts.length > 2){
      mostrarError("Filtra hasta dejar uno o dos artículos para agregar una operación");
      return;
    }
    // Con dos a la vista se pregunta a cuál va, para no colgarla del equivocado.
    if(arts.length === 1) pre = vis.find(x=>normKey(x.articulo)===arts[0]) || null;
    else if(arts.length === 2){
      const nombres=arts.map(k=>(vis.find(x=>normKey(x.articulo)===k)||{}).articulo);
      const cual=prompt(`Hay dos artículos a la vista.
¿A cuál agregas la operación?

1) ${nombres[0]}
2) ${nombres[1]}

Escribe 1 o 2:`);
      if(cual!=="1" && cual!=="2") return;
      pre = vis.find(x=>normKey(x.articulo)===arts[+cual-1]) || null;
    }
  }
  const b = esEdicion ? (BASE.find(x=>Number(x.id)===Number(id))||{})
          : (pre ? {prenda:pre.prenda, cliente:pre.cliente, articulo:pre.articulo} : {});
  const v = k => esc(b[k]!=null?b[k]:"");
  // Valores históricos para los desplegables (una vez por área).
  if(!BASE_VALORES[area]){
    try{
      const r = await rpc("fn_base_valores",{p_dni:ING.dni,p_token:ING.token,p_area:area});
      BASE_VALORES[area] = r && r.ok ? r : {prendas:[],clientes:[],modulos:[],articulos:[],maxop:{}};
    }catch(e){ BASE_VALORES[area] = {prendas:[],clientes:[],modulos:[],articulos:[],maxop:{}}; }
  }
  const VAL = BASE_VALORES[area];
  const dl = (arr)=> (arr||[]).map(x=>`<option value="${esc(x)}">`).join("");
  abrirModal(`
    <h2>${esEdicion?"Editar operación":"Agregar operación"}</h2>
    <div class="sub" style="margin-bottom:12px;">Área: ${esc(area)}</div>
    <datalist id="dlPrenda">${dl(VAL.prendas)}</datalist>
    <datalist id="dlCliente">${dl(VAL.clientes)}</datalist>
    <datalist id="dlModulo">${dl(VAL.modulos)}</datalist>
    <datalist id="dlArticulo">${dl(VAL.articulos)}</datalist>
    <div class="modal-2col">
      <div class="modal-campo"><label>Prenda</label><input id="boPrenda" list="dlPrenda" value="${v('prenda')}" maxlength="80" placeholder="Elige o escribe…"></div>
      <div class="modal-campo"><label>Cliente</label><input id="boCliente" list="dlCliente" value="${v('cliente')}" maxlength="80" placeholder="Elige o escribe…"></div>
    </div>
    <div class="modal-2col">
      <div class="modal-campo"><label>Módulo</label><input id="boModulo" list="dlModulo" value="${v('modulo')}" maxlength="80" placeholder="Elige o escribe…"></div>
      <div class="modal-campo"><label>Artículo${pre?` <span class="cf-detalle" style="font-weight:600;">(del filtro)</span>`:""}</label><input id="boArticulo" list="dlArticulo" value="${v('articulo')}" maxlength="80" placeholder="Elige o escribe…" oninput="autoMaxOp()"${pre?` readonly style="background:var(--gris-fondo);color:#5a6270;"`:""}></div>
    </div>
    <div class="modal-campo"><label>Operación</label><input id="boOperacion" value="${v('operacion')}" maxlength="120"></div>
    <div class="modal-2col">
      <div class="modal-campo"><label>STD (min)</label><input id="boStd" inputmode="decimal" value="${v('std')}"></div>
      <div class="modal-campo"><label>N°OP (orden)</label><input id="boNop" inputmode="numeric" value="${v('n_op')}"></div>
    </div>
    <div class="modal-campo"><label>Max Op. <span class="cf-detalle" style="font-weight:600;">(automático)</span></label>
      <input id="boMaxOp" inputmode="numeric" value="${v('max_op')}" readonly style="background:var(--gris-fondo);color:#5a6270;"></div>
    <div class="cf-detalle" style="margin-top:-4px;">El N°OP es la posición; al guardar se reordena automáticamente el resto y Max Op. = total de operaciones del artículo. El mayor N°OP es la operación final (★ dorada); el 2º mayor, la penúltima.</div>
    <div class="modal-msg" id="boMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarBaseOp(${esEdicion?id:"null"})">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
  if(!esEdicion) autoMaxOp();
}
/* #11 — Editar el artículo completo (parche 51). Se abre con UN artículo a la
   vista; la cabecera se aplica a todas las filas y el resto va fila por fila.
   Son `input` normales para poder copiar y pegar, que es el caso de uso. */
function abrirModalArticulo(){
  const vis=basesFiltradas();
  const arts=[...new Set(vis.map(x=>normKey(x.articulo)).filter(Boolean))];
  if(arts.length!==1){ mostrarError("Filtra hasta dejar un solo artículo para editarlo"); return; }
  const filas=vis.filter(x=>normKey(x.articulo)===arts[0])
                 .sort((a,b)=>(Number(a.n_op)||0)-(Number(b.n_op)||0));
  const p0=filas.find(x=>norm(x.prenda))||{}, c0=filas.find(x=>norm(x.cliente))||{};
  const distintos=(k)=>[...new Set(filas.map(x=>norm(x[k])))].filter(Boolean).length>1;
  const aviso=(k,txt)=> distintos(k)
    ? `<div class="cf-detalle" style="color:var(--ocre);font-weight:700;">Las filas tienen ${txt} distintos: si escribes algo aquí se aplica a todas.</div>` : "";
  MODART={area:$("areaBase").value, articulo:filas[0].articulo, ids:filas.map(x=>x.id)};
  abrirModal(`
    <h2>Editar artículo</h2>
    <div class="sub" style="margin-bottom:12px;">${esc(MODART.area)} · ${filas.length} operación(es)</div>
    <div class="modal-2col">
      <div class="modal-campo"><label>Artículo</label>
        <input id="maArt" value="${esc(filas[0].articulo)}" maxlength="80"></div>
      <div class="modal-campo"><label>Prenda <span class="cf-detalle">(todas las filas)</span></label>
        <input id="maPrenda" value="${esc(p0.prenda||"")}" maxlength="80"></div>
    </div>
    ${aviso("prenda","prendas")}
    <div class="modal-campo"><label>Cliente <span class="cf-detalle">(todas las filas)</span></label>
      <input id="maCliente" value="${esc(c0.cliente||"")}" maxlength="80"></div>
    ${aviso("cliente","clientes")}
    <div class="contenedor-ancho tabla-scroll" style="max-height:44vh;margin-top:10px;">
      <table class="tabla ma-tabla"><thead><tr><th>N°OP</th><th class="izq">Módulo</th>
        <th class="izq">Operación</th><th>STD</th></tr></thead>
      <tbody>${filas.map(f=>`<tr>
        <td><input id="maN_${f.id}" type="number" min="1" value="${esc(f.n_op)}"></td>
        <td class="izq"><input id="maM_${f.id}" value="${esc(f.modulo||"")}" maxlength="80"></td>
        <td class="izq"><input id="maO_${f.id}" value="${esc(f.operacion||"")}" maxlength="120"></td>
        <td><input id="maS_${f.id}" inputmode="decimal" value="${esc(f.std)}"></td>
      </tr>`).join("")}</tbody></table>
    </div>
    <div class="cf-detalle" style="margin-top:6px;">Renombrar una operación aquí <b>conserva su identidad</b>,
      así que los tickets ya reclamados siguen casando. Al guardar se reordena el N°OP y se sincronizan los reclamos.</div>
    <div class="modal-msg" id="maMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarModalArticulo()">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
let MODART=null;
async function guardarModalArticulo(){
  if(!MODART) return;
  const filas=MODART.ids.map(id=>({
    id,
    modulo:   norm(($("maM_"+id)||{}).value||""),
    operacion:norm(($("maO_"+id)||{}).value||""),
    std:      (($("maS_"+id)||{}).value||"").trim(),
    n_op:     (($("maN_"+id)||{}).value||"").trim()
  }));
  if(filas.some(f=>!f.operacion)){ $("maMsg").textContent="Ninguna operación puede quedar sin nombre"; return; }
  const art=norm($("maArt").value).toUpperCase();
  if(!art){ $("maMsg").textContent="El artículo no puede quedar vacío"; return; }
  try{
    const r=await rpc("fn_base_articulo_guardar",{p_dni:ING.dni,p_token:ING.token,
      p_area:MODART.area, p_articulo:MODART.articulo,
      p_prenda:norm($("maPrenda").value).toUpperCase(),
      p_cliente:norm($("maCliente").value).toUpperCase(),
      p_articulo_nuevo:(art===norm(MODART.articulo).toUpperCase()?null:art),
      p_filas:filas});
    if(!r.ok){ $("maMsg").textContent=r.error||"No se pudo guardar"; return; }
    cerrarModal();
    mostrarOk(`${r.articulo} · ${r.filas} fila(s) guardada(s)`
      + (r.reclamos_actualizados?` · ${r.reclamos_actualizados} reclamo(s) sincronizados`:""));
    delete BASES_CACHE[MODART.area];
    await cargarBases();
  }catch(e){ $("maMsg").textContent=e.message; }
}

/* Max Op. se calcula según el artículo (mayor N°OP histórico). */
function autoMaxOp(){
  const area=$("areaBase").value;
  const art=normKey($("boArticulo").value);
  const mapa=(BASE_VALORES[area]||{}).maxop||{};
  // busca por coincidencia normalizada de artículo
  let mx=null;
  Object.keys(mapa).forEach(k=>{ if(normKey(k)===art) mx=mapa[k]; });
  if(mx!=null && $("boMaxOp")) $("boMaxOp").value = mx;
}
/* Reescribe el ALMACÉN (Sheet) de un artículo según la BASE, conservando los
   códigos. Sincroniza también reclamos (fn_base_sync). Silencioso si el área
   no tiene Sheet configurado. */
async function sincronizarAlmacen(area, articulo){
  if(!articulo) return;
  const cfg=AREAS[area];
  try{
    const p=await rpc("fn_base_sync",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_articulo:articulo});
    if(!p||!p.ok) { if(p&&p.error) mostrarError("Sync BASE: "+p.error); return; }
    if(!cfg||!cfg.sheetId) return;                 // sin Sheet: solo se sincronizó Supabase
    if(!Array.isArray(p.mapa)||!p.mapa.length) return;
    const r=await edgeFn(FN_GENERAR_TICKETS,{p_dni:ING.dni,p_token:ING.token,area,accion:"actualizar",articulo,mapa:p.mapa});
    if(r&&r.ok){ if(r.actualizadas) mostrarOk(`ALMACÉN sincronizado (${r.actualizadas} fila(s)).`); }
    else mostrarError("ALMACÉN no sincronizado: "+((r&&r.error)||"error"));
  }catch(e){ mostrarError("Sync ALMACÉN: "+e.message); }
}
async function guardarBaseOp(id){
  const area=$("areaBase").value;
  const datos={
    p_prenda:$("boPrenda").value.trim(), p_cliente:$("boCliente").value.trim(),
    p_modulo:$("boModulo").value.trim(), p_articulo:$("boArticulo").value.trim(),
    p_operacion:$("boOperacion").value.trim(),
    p_std:parseFloat($("boStd").value)||0,
    p_max_op:parseInt($("boMaxOp").value,10)||0,
    p_n_op:parseInt($("boNop").value,10)||0
  };
  if(!datos.p_articulo || !datos.p_operacion){ $("boMsg").textContent="Artículo y operación son obligatorios"; return; }
  // Aviso: cuántos tickets se reescribirán en ALMACÉN/Supabase.
  try{
    const pv=await rpc("fn_base_almacen_map",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_articulo:datos.p_articulo});
    const tot=(pv&&pv.ok)?(pv.reclamos_total||0):0;
    if(tot>0 && !confirm(`Este cambio reescribirá ${tot} ticket(s) del artículo ${datos.p_articulo} en ALMACÉN y Supabase (se conservan los códigos; ${pv.reclamos_activos||0} reclamado(s)). ¿Continuar?`)) return;
  }catch(e){}
  try{
    const r = id!=null
      ? await rpc("fn_base_op_editar",{p_dni:ING.dni,p_token:ING.token,p_id:id,...datos})
      : await rpc("fn_base_op_crear",{p_dni:ING.dni,p_token:ING.token,p_area:area,...datos});
    if(!r.ok){ $("boMsg").textContent=r.error||"No se pudo guardar"; return; }
    cerrarModal();
    delete BASES_CACHE[area]; delete BASE_VALORES[area];
    if(typeof r.reclamos_actualizados==="number" && r.reclamos_actualizados>0)
      mostrarOk(`Guardado · ${r.reclamos_actualizados} reclamo(s) sincronizados`);
    await sincronizarAlmacen(area, datos.p_articulo);
    await cargarBases();
  }catch(e){ $("boMsg").textContent=e.message; }
}
async function eliminarBaseOp(id, nombre, articulo){
  const area=$("areaBase").value;
  let tot=0;
  try{ const pv=await rpc("fn_base_almacen_map",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_articulo:articulo}); if(pv&&pv.ok) tot=pv.reclamos_total||0; }catch(e){}
  if(!confirm(`¿Eliminar la operación "${nombre}"?`+(tot>0?`\nReescribirá ${tot} ticket(s) del artículo ${articulo} en ALMACÉN y Supabase.`:""))) return;
  try{
    let r=await rpc("fn_base_op_eliminar",{p_dni:ING.dni,p_token:ING.token,p_id:id,p_confirmar:false});
    // Parche 35: si la operación tiene trabajo reclamado, se confirma aparte.
    if(!r.ok && r.requiere_confirmacion){
      if(!confirm(`${r.error}\n\n¿Eliminarla de todos modos?`)) return;
      r=await rpc("fn_base_op_eliminar",{p_dni:ING.dni,p_token:ING.token,p_id:id,p_confirmar:true});
    }
    if(!r.ok){ mostrarError(r.error||"No se pudo eliminar"); return; }
    if(r.reclamos_sueltos>0) mostrarOk(`Eliminada · ${r.reclamos_sueltos} reclamo(s) quedaron fuera de la ruta`);
    delete BASES_CACHE[area];
    await sincronizarAlmacen(area, articulo);
    await cargarBases();
  }catch(e){ mostrarError(e.message); }
}

/* --- subida con diff previo --- */
let PENDIENTE=null;
function leerExcelBase(input){
  const file=input.files[0]; input.value="";
  if(!file) return;
  const lector=new FileReader();
  lector.onload = async (e)=>{
    try{
      const wb = XLSX.read(e.target.result, {type:"array"});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:""});
      if(rows.length<2) throw new Error("El excel está vacío");
      const idx={};
      rows[0].forEach((h,i)=>{
        const k=normKey(h);   // normKey ya cubre N_OP / N° OP / N°OP -> NOP
        if(k==="PRENDA")idx.prenda=i; if(k==="CLIENTE")idx.cliente=i;
        if(k==="MODULO")idx.modulo=i; if(k==="ARTICULO")idx.articulo=i;
        if(k==="OPERACION")idx.operacion=i; if(k==="STD")idx.std=i;
        if(k==="MAXOP")idx.max_op=i; if(k==="NOP")idx.n_op=i;
      });
      if(idx.articulo===undefined||idx.operacion===undefined||idx.std===undefined||idx.n_op===undefined)
        throw new Error("Faltan cabeceras: se esperan "+CAB_BASE.join(", "));
      const filas=[];
      for(let i=1;i<rows.length;i++){
        const r=rows[i];
        if(!norm(r[idx.articulo])) continue;
        filas.push({prenda:norm(r[idx.prenda]),cliente:norm(r[idx.cliente]),
          modulo:norm(r[idx.modulo]),articulo:norm(r[idx.articulo]).toUpperCase(),
          operacion:norm(r[idx.operacion]),std:parseFloat(r[idx.std])||0,
          max_op:parseInt(r[idx.max_op])||0,n_op:parseInt(r[idx.n_op])||0});
      }
      if(!filas.length) throw new Error("Sin filas válidas");
      await mostrarDiff(filas);
    }catch(err){ mostrarError(err.message); }
  };
  lector.readAsArrayBuffer(file);
}
async function mostrarDiff(filas){
  const arts=[...new Set(filas.map(f=>f.articulo))];
  const existentes = await rpc("fn_bases_existentes",{p_dni:ING.dni,p_token:ING.token,
    p_area:$("areaBase").value,p_articulos:arts});
  const viejasPorArt={};
  existentes.forEach(v=>{ (viejasPorArt[v.articulo]=viejasPorArt[v.articulo]||[]).push(v); });
  let html=`<div class="diff-box"><h3>Vas a actualizar ${arts.length} artículo(s) en ${esc($("areaBase").value)}</h3>
    <div class="cf-detalle">Solo se reemplazan los artículos del archivo; el resto de la base queda intacto.</div></div>`;
  arts.forEach(a=>{
    const nuevas=filas.filter(f=>f.articulo===a);
    const viejas=viejasPorArt[a]||[];
    const kOp=o=>normKey(o.operacion);
    const mapaV={}; viejas.forEach(v=>mapaV[kOp(v)]=v);
    const mapaN={}; nuevas.forEach(n=>mapaN[kOp(n)]=n);
    const agregadas=nuevas.filter(n=>!mapaV[kOp(n)]);
    const quitadas=viejas.filter(v=>!mapaN[kOp(v)]);
    const cambiadas=nuevas.filter(n=>{
      const v=mapaV[kOp(n)];
      return v && (Number(v.std)!==n.std || Number(v.n_op)!==n.n_op || Number(v.max_op)!==n.max_op);
    });
    const tNuevo=nuevas.reduce((s,x)=>s+x.std,0), tViejo=viejas.reduce((s,x)=>s+Number(x.std),0);
    html+=`<div class="diff-box"><h3>${esc(a)} ${viejas.length?"(reemplaza al existente)":"(nuevo)"}</h3>
      <div class="cf-detalle">Operaciones: ${viejas.length} → ${nuevas.length} · Tiempo prenda: ${tViejo.toFixed(2)} → ${tNuevo.toFixed(2)} min</div>`;
    if(agregadas.length) html+=`<div class="diff-add">+ Se agregan: ${agregadas.map(x=>esc(x.operacion)).join(" · ")}</div>`;
    if(quitadas.length)  html+=`<div class="diff-del">− Se quitan: ${quitadas.map(x=>esc(x.operacion)).join(" · ")}</div>`;
    if(cambiadas.length) html+=`<div class="diff-mod">≈ Cambian (STD/orden): ${cambiadas.map(x=>esc(x.operacion)).join(" · ")}</div>`;
    if(!agregadas.length&&!quitadas.length&&!cambiadas.length)
      html+=`<div class="cf-detalle">Sin diferencias con lo existente.</div>`;
    html+=`</div>`;
  });
  html+=`<div class="fila-filtros">
    <button class="btn-mini verde" onclick="confirmarSubida()">CONFIRMAR Y SUBIR</button>
    <button class="btn-mini gris" onclick="cancelarSubida()">CANCELAR</button></div>`;
  PENDIENTE=filas;
  $("zonaDiff").innerHTML=html; $("zonaDiff").style.display="block";
  window.scrollTo(0,0);
}
function cancelarSubida(){ PENDIENTE=null; $("zonaDiff").style.display="none"; }
async function confirmarSubida(){
  if(!PENDIENTE) return;
  try{
    const area=$("areaBase").value;
    const arts=[...new Set((PENDIENTE||[]).map(f=>f.articulo).filter(Boolean))];
    const r = await rpc("fn_bases_subir",{p_dni:ING.dni,p_token:ING.token,
      p_area:area,p_filas:PENDIENTE});
    if(!r.ok){ mostrarError(r.error); return; }
    cancelarSubida();
    // Sincroniza ALMACÉN (Sheet) + reclamos por cada artículo subido; los códigos NO cambian.
    for(const a of arts){ await sincronizarAlmacen(area, a); }
    await cargarBases();
  }catch(e){ mostrarError(e.message); }
}
/* ================= INCIDENCIAS ================= */
const TIPOS_OC = ["MAQUINA","HORA_EXTRA","TARDANZA","SEGURO","PERMISO","OTROS"];
const hoyLima = ()=> new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"});
let OCURR=[], inciSort={col:"fecha",dir:-1}, INCI_PERSONAL=[];

function inciVista(v){
  const apl=v!=="pend";
  $("inciAplicadas").hidden=!apl; $("inciPendientes").hidden=apl;
  $("inciTabApl").classList.toggle("activo",apl); $("inciTabPend").classList.toggle("activo",!apl);
  if(apl) cargarOcurrencias(); else cargarPendientesInci();
}
/* Semana del sistema en hora de Lima: lunes a domingo. `getDay()` da 0 el
   domingo, así que el lunes se calcula con ((dow+6) % 7). */
function semanaActual(){
  const hoy = hoyISO();
  const d = new Date(hoy+"T00:00:00");
  const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay()+6) % 7));
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate()+6);
  const f = x => x.toLocaleDateString("sv-SE");
  return {desde:f(lunes), hasta:f(domingo)};
}
async function cargarIncidI(){        // pendientes + tabla aplicada
  if($("fechaInciH") && !$("fechaInciH").value){
    const {desde, hasta} = semanaActual();
    $("fechaInciD").value = desde;
    $("fechaInciH").value = hasta;
  }
  await Promise.all([cargarPendientesInci(), cargarOcurrencias()]);
}

let INCI_PEND=[];
async function cargarPendientesInci(){
  const z=$("listaIncidI"); z.innerHTML=cargandoHTML("Cargando pendientes…");
  try{
    const r=await rpc("fn_solicitudes_listar",{p_dni:ING.dni,p_token:ING.token,p_area:""});
    if(!r.ok){ mostrarError(r.error||"Error"); z.innerHTML=""; return; }
    INCI_PEND=r.items||[];
    // El select de área se llena con lo que hay pendiente, no con todas las áreas.
    const sel=$("areaInciPend");
    if(sel){
      const prev=sel.value;
      const areas=[...new Set(INCI_PEND.map(x=>x.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
      sel.innerHTML=`<option value="">Todas</option>`+areas.map(a=>`<option>${esc(a)}</option>`).join("");
      if(areas.includes(prev)) sel.value=prev;
    }
    pintarPendientesInci();
  }catch(e){ z.innerHTML=""; mostrarError(e.message); }
}
function pintarPendientesInci(){
  const z=$("listaIncidI"); if(!z) return;
  const ar=(($("areaInciPend")||{}).value||"");
  const q=normKey((($("filtroInciPend")||{}).value||""));
  const items=INCI_PEND.filter(it=>
    (!ar || it.area===ar) &&
    (!q || normKey((it.nombre||"")+" "+(it.tipo||"")+" "+(it.motivo||"")+" "+(it.solicitante||"")).includes(q)));
  { const rp=$("resumenInciPend");
    if(rp) rp.textContent = `${items.length} de ${INCI_PEND.length} pendiente(s)`; }
  if(!items.length){
    z.innerHTML=`<div class="vacio-msg">${INCI_PEND.length?"Nada con ese filtro":"Sin incidencias pendientes"}</div>`;
    return;
  }
  z.innerHTML="";
  {
    const items_=items; items_.forEach(it=>{
      const d=document.createElement("div");
      d.className="card-fila"; d.style.cursor="default"; d.style.flexWrap="wrap";
      const tipoTxt = it.tipo ? String(it.tipo).replace(/_/g," ") : "";
      d.innerHTML=`
        <div style="flex:1;min-width:220px;">
          <div class="cf-titulo">${esc(it.nombre)}${tipoTxt?` · <span style="font-weight:700;color:var(--azul);">${esc(tipoTxt)}</span>`:""}</div>
          <div class="cf-detalle">${esc(it.motivo)}</div>
          <div class="cf-detalle">${esc(it.area)} · aplica el <b>${esc(it.fecha)}</b> ${esc(it.hora)}${it.solicitante?` · Solicitó: ${esc(it.solicitante)}`:""}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="number" id="inci_${it.id}" value="${it.minutos}"
            style="width:90px;background:var(--gris-fondo);border:2px solid var(--azul);border-radius:10px;font-size:16px;font-weight:800;padding:8px;text-align:center;">
          <span class="cf-detalle">min</span>
          <button class="btn-mini verde" onclick="resolverIncidI(${it.id},true)">APROBAR</button>
          <button class="btn-mini rojo" onclick="resolverIncidI(${it.id},false)">RECHAZAR</button>
        </div>`;
      z.appendChild(d);
    });
  }
}
async function resolverIncidI(id, aprobar){
  let mf=null;
  if(aprobar){ mf=parseInt($("inci_"+id).value,10); if(!mf){ mostrarError("Minutos inválidos"); return; } }
  try{
    const r=await rpc("fn_solicitud_resolver",{p_dni:ING.dni,p_token:ING.token,p_id:id,p_aprobar:aprobar,p_minutos_final:mf});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
    await cargarIncidI();
  }catch(e){ mostrarError(e.message); }
}

/* ---- Ocurrencias aplicadas (tabla + resumen + CRUD) ---- */
async function cargarOcurrencias(){
  const t=$("tablaInci"); if(t) t.innerHTML=`<tbody><tr><td>${cargandoHTML("Cargando…")}</td></tr></tbody>`;
  try{
    const r=await rpc("fn_ocurrencias_listar",{p_dni:ING.dni,p_token:ING.token,
      p_area:($("areaInci")?$("areaInci").value:"")||"",
      p_desde:$("fechaInciD")?$("fechaInciD").value:null,
      p_hasta:$("fechaInciH")?$("fechaInciH").value:null});
    if(!r.ok){ mostrarError(r.error||"Error"); OCURR=[]; }
    else OCURR=r.items||[];
    pintarOcurrencias();
  }catch(e){ mostrarError(e.message); }
}
/* Parche 49: al liberar un ticket troceado, el paquete vuelve a su cantidad
   original y los residuales que salieron de él dejan de existir. Si alguien ya
   tenía uno tomado, se le liberó también y hay que decirlo. */
function avisoTroceo(r){
  const an=(r && r.residuales_anulados) || [];
  const li=(r && r.reclamos_liberados) || [];
  if(!an.length && !li.length) return "";
  let t = an.length ? ` · se anuló ${an.length===1?"el residual":"los residuales"} ${an.join(", ")}` : "";
  if(li.length) t += ` · se liberó también a ${li.map(x=>soloApellidos(x.nombre)+" ("+x.cant+" und)").join(", ")}`;
  if(r && r.cant_restaurada) t = ` · el paquete vuelve a ${r.cant_restaurada} und` + t;
  return t;
}
function avisoTroceoLote(r){
  const t=(r && r.troceos_deshechos) || [];
  if(!t.length) return "";
  const n=t.reduce((a,x)=>a+((x.anulados||[]).length),0);
  const per=t.flatMap(x=>x.liberados||[]);
  return ` · ${n} residual(es) anulado(s)`
    + (per.length?` · se liberó también a ${[...new Set(per.map(x=>soloApellidos(x.nombre)))].join(", ")}`:"");
}
/* #3 — "dónde fue mayor la incidencia" cuando no hay área elegida. */
function kpiAreaMayor(lista){
  const por={};
  (lista||[]).forEach(o=>{ const a=o.area||"—"; const m=+o.minutos||0;
    por[a]=por[a]||{n:0,desc:0,suma:0};
    por[a].n++; if(m<0) por[a].desc+=m; else por[a].suma+=m; });
  const top=Object.entries(por).sort((a,b)=>a[1].desc-b[1].desc)[0];
  if(!top || top[1].desc>=0) return "";
  const k=(t,v,c)=>`<div class="kpi"><div class="kpi-num" style="color:${c};font-size:22px;">${esc(v)}</div><div class="kpi-lbl">${esc(t)}</div></div>`;
  return k("Área que más descuenta", `${top[0]} (${top[1].desc})`, "var(--alerta)");
}
/* Desglose por motivo del rango: cuenta y minutos, lo que más pesa primero. */
function pintarMotivosInci(lista){
  const z=$("motivosInci"); if(!z) return;
  const por={};
  (lista||[]).forEach(o=>{
    const k=(o.detalle||o.tipo||"—").toString().trim().toUpperCase()||"—";
    const m=+o.minutos||0;
    por[k]=por[k]||{n:0,min:0};
    por[k].n++; por[k].min+=m;
  });
  const filas=Object.entries(por).sort((a,b)=>Math.abs(b[1].min)-Math.abs(a[1].min));
  if(!filas.length){ z.innerHTML=""; return; }
  z.innerHTML=`<div class="tk-ops-title">Motivos del rango</div>
    <div class="mot-chips">${filas.map(([k,v])=>`
      <span class="mot-chip ${v.min<0?"neg":"pos"}">
        <b>${esc(k.replace(/_/g," "))}</b>
        <span class="mot-n">${v.n}</span>
        <span class="mot-min">${v.min>0?"+":""}${Math.round(v.min)} min</span>
      </span>`).join("")}</div>`;
}
function ordenarInci(col){ if(inciSort.col===col) inciSort.dir*=-1; else inciSort={col,dir:1}; pintarOcurrencias(); }
function pintarOcurrencias(){
  const q=normKey($("filtroInci")?$("filtroInci").value:"");
  let lista=OCURR.filter(o=>!q || normKey(`${o.nombre} ${o.tipo} ${o.detalle||""}`).includes(q));
  // resumen: cuánto suma (+) y cuánto descuenta (-)
  const suma=lista.filter(o=>+o.minutos>0).reduce((a,o)=>a+ +o.minutos,0);
  const resta=lista.filter(o=>+o.minutos<0).reduce((a,o)=>a+ +o.minutos,0);
  const porTipo={}; lista.forEach(o=>{ porTipo[o.tipo]=(porTipo[o.tipo]||0)+ +o.minutos; });
  const topDesc=Object.entries(porTipo).sort((a,b)=>a[1]-b[1])[0];
  const topSum=Object.entries(porTipo).sort((a,b)=>b[1]-a[1])[0];
  const kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num" style="color:${c}">${v}</div><div class="sub">${t}</div></div>`;
  $("resumenInci").innerHTML =
    kpi("Incidencias", lista.length, "var(--azul)")+
    kpi("Suman (min)", "+"+suma, "var(--exito)")+
    kpi("Descuentan (min)", resta, "var(--alerta)")+
    kpi("Neto (min)", (suma+resta>0?"+":"")+(suma+resta), "var(--azul)")+
    (topDesc?kpi("Más descuenta", topDesc[1]<0?`${topDesc[0].replace(/_/g," ")} (${topDesc[1]})`:"—", "var(--alerta)"):"")+
    (topSum && topSum[1]>0?kpi("Más suma", `${topSum[0].replace(/_/g," ")} (+${topSum[1]})`, "var(--exito)"):"")+
    /* Sin área elegida, lo que interesa es DÓNDE pesó más. Con un área
       elegida el comportamiento queda igual que antes. */
    ((($("areaInci")||{}).value||"") ? "" : kpiAreaMayor(lista));
  pintarMotivosInci(lista);
  // orden
  lista=[...lista].sort((a,b)=>{
    const va=a[inciSort.col], vb=b[inciSort.col];
      const c=cmpVal(va,vb);
    return c*inciSort.dir;
  });
  const flecha=k=>inciSort.col===k?(inciSort.dir===1?" ▲":" ▼"):"";
  const COLS=[["fecha","Fecha"],["nombre","Persona"],["area","Área"],["tipo","Tipo"],["minutos","Min"],["detalle","Motivo"],["registrado_por","Registró"]];
  const thead="<thead><tr>"+COLS.map(c=>`<th class="ord" onclick="ordenarInci('${c[0]}')">${c[1]}${flecha(c[0])}</th>`).join("")+"<th></th></tr></thead>";
  const body=lista.length? lista.map(o=>{
    const m=+o.minutos, col=m<0?"var(--alerta)":"var(--exito)";
    return `<tr>
      <td>${esc(o.fecha)}</td><td class="izq">${esc(soloApellidos(o.nombre))}</td>
      <td>${esc(o.area)}</td><td>${esc(String(o.tipo).replace(/_/g," "))}</td>
      <td style="color:${col};font-weight:800;">${m>0?"+":""}${m}</td>
      <td class="izq">${esc(o.detalle||"")}</td><td>${esc(soloApellidos(o.registrado_por||""))}</td>
      <td><div class="acc-base">
        <button class="acc-editar" onclick="editarIncidencia(${o.id})">Editar</button>
        <button class="acc-borrar" onclick="eliminarIncidencia(${o.id})">Borrar</button>
      </div></td></tr>`;
  }).join("") : `<tr><td colspan="${COLS.length+1}"><div class="vacio-msg">Sin incidencias en el rango</div></td></tr>`;
  $("tablaInci").innerHTML=thead+"<tbody>"+body+"</tbody>";
  $("resumenInciTxt").textContent=`${lista.length} incidencia(s) en el rango`;
}

/* ---- Modal crear/editar incidencia ---- */
function nuevaIncidencia(){ abrirModalInci(null); }
function editarIncidencia(id){ abrirModalInci(OCURR.find(o=>o.id===id)||null); }
async function abrirModalInci(oc){
  const editar=!!oc;
  const areaSel=(oc&&oc.area)|| ($("areaInci")&&$("areaInci").value)||AREAS_LISTA[0]||"";
  const opTipo=t=>`<option value="${t}"${oc&&oc.tipo===t?" selected":""}>${t.replace(/_/g," ")}</option>`;
  abrirModal(`
    <h2>${editar?"Editar":"Nueva"} incidencia</h2>
    <div class="modal-campo"><label>Área</label>
      <select id="mi_area">${AREAS_LISTA.map(a=>`<option${a===areaSel?" selected":""}>${esc(a)}</option>`).join("")}</select></div>
    <div class="modal-campo"><label>Persona</label>
      <select id="mi_dni"><option value="">Cargando…</option></select></div>
    <div class="modal-campo"><label>Tipo</label>
      <select id="mi_tipo">${TIPOS_OC.map(opTipo).join("")}</select></div>
    <div class="modal-campo"><label>Minutos (negativo = descuenta)</label>
      <input id="mi_min" type="number" value="${oc?oc.minutos:""}" placeholder="Ej: -30 o 60"></div>
    <div class="modal-campo"><label>Fecha en que aplica</label>
      <input id="mi_fecha" type="date" value="${oc?oc.fecha:hoyLima()}"></div>
    <div class="modal-campo"><label>Motivo</label>
      <input id="mi_detalle" maxlength="140" value="${oc?esc(oc.detalle||""):""}" placeholder="Motivo del ajuste"></div>
    <div class="modal-msg" id="mi_msg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarIncidencia(${editar?oc.id:"null"})">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
  $("mi_area").onchange=()=>cargarPersonalInci(oc?oc.dni:null);
  await cargarPersonalInci(oc?oc.dni:null);
}
async function cargarPersonalInci(dniSel){
  const sel=$("mi_dni"); if(!sel) return;
  const area=$("mi_area").value;
  sel.innerHTML=`<option value="">Cargando…</option>`;
  try{
    INCI_PERSONAL=await rpc("fn_personal",{p_dni:ING.dni,p_token:ING.token,p_area:area});
    if(!Array.isArray(INCI_PERSONAL)||!INCI_PERSONAL.length){ sel.innerHTML=`<option value="">Sin personal en el área</option>`; return; }
    sel.innerHTML=INCI_PERSONAL.map(p=>`<option value="${esc(p.dni)}"${p.dni===dniSel?" selected":""}>${esc(soloApellidos(p.nombre))} · ${esc(p.dni)}</option>`).join("");
  }catch(e){ sel.innerHTML=`<option value="">Error al cargar</option>`; }
}
async function guardarIncidencia(id){
  const dni=$("mi_dni").value, area=$("mi_area").value, tipo=$("mi_tipo").value;
  const min=parseInt($("mi_min").value,10), fecha=$("mi_fecha").value, detalle=$("mi_detalle").value.trim();
  const msg=$("mi_msg");
  if(!dni){ msg.textContent="Elige la persona"; return; }
  if(!min){ msg.textContent="Minutos no puede ser 0"; return; }
  if(!fecha){ msg.textContent="Indica la fecha"; return; }
  if(!detalle){ msg.textContent="Indica el motivo"; return; }
  try{
    const r=id
      ? await rpc("fn_ocurrencia_editar",{p_dni:ING.dni,p_token:ING.token,p_id:id,p_dni_op:dni,p_tipo:tipo,p_minutos:min,p_fecha:fecha,p_detalle:detalle})
      : await rpc("fn_ocurrencia",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_tipo:tipo,p_minutos:min,p_detalle:detalle,p_dnis:[dni],p_fecha:fecha});
    if(!r.ok){ msg.textContent=r.error||"No se pudo guardar"; return; }
    cerrarModal(); await cargarOcurrencias();
  }catch(e){ msg.textContent=e.message; }
}
function eliminarIncidencia(id){
  const o=OCURR.find(x=>x.id===id)||{};
  abrirModal(`
    <h2>Borrar incidencia</h2>
    <div class="sub" style="margin-bottom:14px;">¿Eliminar la incidencia de <b>${esc(soloApellidos(o.nombre||""))}</b> del <b>${esc(o.fecha||"")}</b> (${o.minutos} min)? Se recalculará su eficiencia de ese día.</div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" style="background:var(--alerta)" onclick="confirmarEliminarInci(${id})">SÍ, BORRAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
async function confirmarEliminarInci(id){
  try{
    const r=await rpc("fn_ocurrencia_eliminar",{p_dni:ING.dni,p_token:ING.token,p_id:id});
    if(!r.ok){ mostrarError(r.error||"No se pudo borrar"); return; }
    cerrarModal(); await cargarOcurrencias();
  }catch(e){ mostrarError(e.message); }
}