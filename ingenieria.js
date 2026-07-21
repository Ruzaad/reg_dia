/* ============================================================
   SAMITEX — Vista de Ingeniería (requiere app.js cargado antes)
   ============================================================ */
let ING=null;
let AREAS_LISTA = Object.keys(AREAS);       // se reemplaza con fn_areas_listar al iniciar
const CARGOS_LISTA = ["OPERARIO","SUPERVISORA","ESTAJERO"];
const ESTADOS_OPERARIO = ["ACTIVO","INACTIVO"];
let ESTADOS_ASIS = [];
let EF_CENS_ING = false;                     // censura de eficiencia (****) en toda la pestaña
function hoyISO(){ return new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"}); }
function mesActualISO(){ const d=hoyISO(); return d.slice(0,7); } // YYYY-MM

document.addEventListener("DOMContentLoaded", async ()=>{
  if(document.body.dataset.pagina!=="ingenieria") return;
  ING = sesionActual();
  if(!ING){ location.href="index.html"; return; }
  if(ING.cargo!=="INGENIERIA"){ location.href = destinoPorCargo(ING.cargo); return; }
  $("quienBadge").textContent = ING.nombre; $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  { const kb=$("btnLlave"); if(kb) kb.onclick=abrirCambioPin; }
  { const rc=$("btnRecargar"); if(rc) rc.onclick=recargarIngenieria; }

  // Navegación por SIDEBAR (solo PC).
  document.querySelectorAll(".nav-item[data-tab]").forEach(b=>{
    b.onclick = ()=>{
      document.querySelectorAll(".nav-item[data-tab]").forEach(x=>x.classList.remove("activo"));
      b.classList.add("activo");
      pararAvance();                       // corta el refresco de avance si venía de supervisión
      $("supTabs").style.display = "none"; // sub-tabs de supervisión ocultos por defecto
      const tab=b.dataset.tab;
      if(tab==='pasoSupArea'){ ingSupVolverAreas(); return; }
      irA(tab);
      if(tab==='pasoIncid') cargarIncidI();
      else if(tab==='pasoTk') cargarTk();
      else if(tab==='pasoMod') cargarMod();
      else if(tab==='pasoOpArea') cargarOpArea();
      else if(tab==='pasoFechas') initFechas();
      else if(tab==='pasoTkPer') initTkPer();
    };
  });

  ["fechaEf","fechaTk","fechaMod"].forEach(id=>{ const el=$(id); if(el) el.value = hoyISO(); });
  { const fd=$("fechaDetAsis"); if(fd) fd.value = hoyISO(); }
  $("mesAsis").value = mesActualISO();

  // Áreas desde la base de datos (incluye CORTE, REPROCESOS, etc.)
  AREAS_LISTA = await cargarAreasDB();
  poblarSelectsArea();
  pintarSupAreas();

  $("filtroNomAsis").addEventListener("input", pintarAsisMes);
  $("filtroAreaAsis").addEventListener("change", cargarAsisMes);
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
  $("filtroTk").addEventListener("input", pintarTk);
  cargarTk();            // landing por defecto: Tickets · Actual
  cargarEstadosAsis();
  cargarAsisMes();
});

function poblarSelectsArea(){
  const op = a=>`<option>${esc(a)}</option>`;
  const elige = `<option value="">— Elige área —</option>`;
  const todas = `<option value="">Todas las áreas</option>`;
  $("selArea").innerHTML = AREAS_LISTA.map(op).join("");
  $("areaBase").innerHTML = AREAS_LISTA.map(op).join("");
  $("filtroAreaAsis").innerHTML = todas + AREAS_LISTA.map(op).join("");
  $("filtroAreaEf").innerHTML   = elige + AREAS_LISTA.map(op).join("");   // Efi. Área: requiere elegir
  $("filtroAreaEfR").innerHTML  = todas + AREAS_LISTA.map(op).join("");
  if($("areaTk"))  $("areaTk").innerHTML  = todas + AREAS_LISTA.map(op).join("");
  if($("areaMod")) $("areaMod").innerHTML = elige + AREAS_LISTA.map(op).join("");
  if($("areaOp"))  $("areaOp").innerHTML  = elige + AREAS_LISTA.map(op).join("");
  if($("areaFec")) $("areaFec").innerHTML = elige + AREAS_LISTA.map(op).join("");
  if($("areaTkPer")) $("areaTkPer").innerHTML = elige + AREAS_LISTA.map(op).join("");
}

/* Recargar la pestaña activa (botón ↻ del header). */
function recargarIngenieria(){
  const rc=$("btnRecargar"); if(rc){ rc.classList.add("girando"); setTimeout(()=>rc.classList.remove("girando"),600); }
  const act = id => $(id) && $(id).classList.contains("activa");
  if(act("pasoEf")) cargarEf();
  else if(act("pasoDia")){ if(EFR.personal.length) cargarEfRango(); }
  else if(act("pasoTk")) cargarTk();
  else if(act("pasoTkPer")){ if($("areaTkPer").value) cargarTkPer(); }
  else if(act("pasoMod")) cargarMod();
  else if(act("pasoBases")) cargarBases();
  else if(act("pasoAsis")) cargarAsisMes();
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
function ingSupElegirArea(area){
  SUP_AREA_OVERRIDE=area;
  if(!supBound){ bindSupervisoraUI(); supBound=true; }
  $("supAreaActual").textContent = area;
  $("supTabs").style.display="flex";
  marcarTab("tabPersonal");
  cargarPersonal(sesionActual());
  irA("pasoPersonal");
}

/* ================= TICKETS POR PERSONAL (rango + Excel) ================= */
let TKPER=[];
function initTkPer(){
  { const d=$("desdeTkPer"); if(d && !d.value) d.value=hoyISO(); }
  { const h=$("hastaTkPer"); if(h && !h.value) h.value=hoyISO(); }
  $("opTkPer").innerHTML = `<option value="">— Toda el área —</option>`;
}
async function cargarTkPerArea(){
  const area=$("areaTkPer").value; const s=$("opTkPer");
  if(!area){ s.innerHTML=`<option value="">— Elige área —</option>`; return; }
  s.innerHTML=`<option value="">Cargando…</option>`;
  try{
    const per=await rpc("fn_personal",{p_dni:ING.dni,p_token:ING.token,p_area:area});
    s.innerHTML=`<option value="">— Toda el área —</option>`
      + per.map(p=>`<option value="${esc(p.dni)}">${esc(soloApellidos(p.nombre))} · ${esc(p.dni)}</option>`).join("");
  }catch(e){ s.innerHTML=`<option value="">Error</option>`; mostrarError(e.message); }
}
async function cargarTkPer(){
  const area=$("areaTkPer").value;
  if(!area){ mostrarError("Elige un área"); return; }
  const desde=$("desdeTkPer").value, hasta=$("hastaTkPer").value;
  if(!desde || !hasta){ mostrarError("Elige el rango de fechas"); return; }
  if(hasta<desde){ mostrarError("La fecha final no puede ser menor a la inicial"); return; }
  $("tkPerGate").style.display="none";
  $("tablaTkPer").innerHTML=cargandoHTML("Cargando…");
  try{
    const r=await rpc("fn_tickets_rango",{p_dni:ING.dni,p_token:ING.token,
      p_area:area,p_dni_op:$("opTkPer").value,p_desde:desde,p_hasta:hasta});
    TKPER = Array.isArray(r) ? r : [];
    if(r && r.ok===false){ mostrarError(r.error||"Error"); TKPER=[]; }
    pintarTkPer();
  }catch(e){ $("tablaTkPer").innerHTML=""; mostrarError(e.message); }
}
function pintarTkPer(){
  const min=TKPER.reduce((a,t)=>a+(t.estado==='ACTIVO'?Number(t.minutos):0),0);
  $("resumenTkPer").textContent=`${TKPER.length} tickets · ${Math.round(min)} min activos`;
  if(!TKPER.length){ $("tablaTkPer").innerHTML=`<div class="vacio-msg">Sin tickets en ese rango</div>`; return; }
  const cols=["Fecha","Hora","Nombre","Área","Artículo","OF","Operación","STD","Cant","Min gen.","Numeración","Estado"];
  const thead="<thead><tr>"+cols.map(c=>`<th>${c}</th>`).join("")+"</tr></thead>";
  $("tablaTkPer").innerHTML = thead+"<tbody>"+TKPER.map(t=>`<tr>
    <td>${esc(t.fecha)}</td><td>${esc(t.hora)}</td><td>${esc(t.nombre)}</td><td>${esc(t.area)}</td>
    <td>${esc(t.articulo)}</td><td>${esc(t.of)}</td><td class="izq">${esc(t.op)}</td>
    <td>${t.std!=null?t.std:""}</td><td>${t.cant}</td><td>${t.minutos}</td><td>${esc(t.num)}</td>
    <td><span class="pill ${esc(t.estado)}">${esc(t.estado)}</span></td></tr>`).join("")+"</tbody>";
}
function descargarTkPer(){
  if(!TKPER.length){ mostrarError("Carga primero un rango"); return; }
  const CAB=["Fecha","Hora","DNI","Nombre","Área","Artículo","OF","Operación","STD","Cant","Min generado","Numeración","Código","Estado"];
  const filas=TKPER.map(t=>[t.fecha,t.hora,t.dni,t.nombre,t.area,t.articulo,t.of,t.op,t.std,t.cant,t.minutos,t.num,t.codigo,t.estado]);
  const ws=XLSX.utils.aoa_to_sheet([CAB,...filas]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TicketsPersonal");
  const suf=$("opTkPer").value || $("areaTkPer").value.replace(/ /g,"_");
  XLSX.writeFile(wb, `TICKETS_${suf}_${$("desdeTkPer").value}_a_${$("hastaTkPer").value}.xlsx`);
}

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
function pintarReclamosFec(){
  const lista = Array.isArray(FEC_RECL) ? FEC_RECL : [];
  $("resumenFec").textContent = `${lista.length} ticket(s) en esa fecha · ${Object.keys(FEC_SEL).length} seleccionado(s)`;
  if(!lista.length){ $("tablaFec").innerHTML=`<div class="vacio-msg">Ese operario no tiene tickets esa fecha</div>`; return; }
  const thead=`<thead><tr><th></th><th>OF</th><th class="izq">Operación</th><th>Artículo</th><th>Num.</th><th>Cant</th><th>Min</th><th>Estado</th></tr></thead>`;
  $("tablaFec").innerHTML = thead + "<tbody>" + lista.map(r=>`<tr>
    <td><input type="checkbox" class="chk-lib" ${FEC_SEL[r.id]?"checked":""} onclick="toggleFecSel(${r.id})"></td>
    <td>${esc(r.of)}</td><td class="izq">${esc(r.op)}</td><td>${esc(r.articulo)}</td>
    <td>${esc(r.num)}</td><td>${r.cant}</td><td>${r.minutos}</td>
    <td><span class="pill ${esc(r.estado)}">${esc(r.estado)}</span></td></tr>`).join("") + "</tbody>";
}
function toggleFecSel(id){ if(FEC_SEL[id]) delete FEC_SEL[id]; else FEC_SEL[id]=true; pintarReclamosFec(); }
function marcarTodosFec(){
  const lista = Array.isArray(FEC_RECL) ? FEC_RECL : [];
  const faltan = lista.some(r=>!FEC_SEL[r.id]);
  FEC_SEL={};
  if(faltan) lista.forEach(r=>{ FEC_SEL[r.id]=true; });
  pintarReclamosFec();
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
async function cargarMod(){
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
    pintarMod();
  }catch(e){ $("zonaModulos").innerHTML=""; mostrarError(e.message); }
}
function filtrarModArea(a){
  modArea=a;
  if(!modArea){ $("modGate").style.display="block"; $("zonaModulos").innerHTML=""; $("resumenMod").textContent=""; return; }
  cargarMod();
}
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
function pintarMod(){
  const q=normKey($("ofMod") ? $("ofMod").value : "");   // filtro por OF
  const activos = MODTK.filter(t=>t.estado==='ACTIVO' && t.area===modArea && (!q || normKey(t.of).includes(q)));
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
  $("resumenMod").textContent = `${modArea} · ${claves.length} módulo(s) con actividad · ${activos.length} tickets`;
  if(!claves.length){ $("zonaModulos").innerHTML=`<div class="vacio-msg">Sin tickets activos para esta área/OF</div>`; return; }
  $("zonaModulos").innerHTML = claves.map(k=>{
    const g=grp[k];
    const meta = MOD_META[normKey(g.of)] || 0;
    const pct = meta>0 ? Math.min(100, Math.round(g.ultima/meta*100)) : null;
    const ops=Object.keys(g.ops).sort((a,b)=>a.localeCompare(b,"es"));
    const barra = pct==null
      ? `<div class="avance-nometa">Sube el balance/OF para calcular el avance</div>`
      : `<div class="avance-bar"><div class="avance-fill ${pct>=80?'alto':pct<40?'bajo':''}" style="width:${pct}%"></div>
           <span class="avance-lbl">${pct}%</span></div>
         <div class="avance-sub">${Math.round(g.ultima)} de ${Math.round(meta)} und (última operación)</div>`;
    return `<details class="mod-card" open>
      <summary class="mod-head">
        <div class="mod-nombre">${esc(g.mod)}</div>
        <div class="mod-sub">OF ${esc(g.of)} · ${esc(g.articulo)} · ${ops.length} operación(es) · ${g.tks} tickets</div>
      </summary>
      <div class="mod-body">
        <div class="mod-avance">${barra}</div>
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
    </details>`;
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
    <div class="kpi"><div class="kpi-num">${censEf(a.eficiencia+"%")}</div>
    <div class="kpi-lbl">${esc(a.area)}<br>${Math.round(a.prod)} / ${Math.round(a.disp)} min</div></div>`).join("")
    || '<div class="vacio-msg">Sin datos ese día para esta área</div>';

  let lista = (EF.personas||[]).filter(p=>p.area===fArea);
  const cmp = (a,b)=>{
    if(!efSort.col) return String(a.nombre||"").localeCompare(String(b.nombre||""),"es");
    const va=a[efSort.col], vb=b[efSort.col];
    const na=parseFloat(va), nb=parseFloat(vb);
    const c=(!isNaN(na)&&!isNaN(nb))?na-nb:String(va??"").localeCompare(String(vb??""),"es");
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
        <td class="${p.eficiencia>=80?'ef-alta':p.eficiencia<50?'ef-baja':''}">${censEf(p.eficiencia+"%")}</td></tr>`).join("");
    });
  }
  $("tablaEf").innerHTML = thead + "<tbody>" + tbody + "</tbody>";
}

/* ================= EFICIENCIA DÍA × DÍA POR RANGO ================= */
let EFR={dias:[],personal:[]}, efRangoSel={desde:null,hasta:null};

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

  let thead = `<thead><tr><th class="col-nombre-solo">Nombre</th><th>Prom.</th>`;
  EFR.dias.forEach(d=>{ thead += `<th>${d.slice(8,10)}</th>`; });
  thead += `</tr></thead>`;

  let tbody = "<tbody>";
  if(!lista.length){
    tbody += `<tr><td colspan="${EFR.dias.length+2}"><div class="vacio-msg">Sin personal para este filtro</div></td></tr>`;
  }
  lista.forEach(p=>{
    tbody += `<tr>
      <td class="col-nombre-solo">
        <div>${esc(p.nombre)}</div>
        <div style="font-size:11px;color:#5a6270;font-weight:600">DNI ${esc(p.dni)} · ${esc(p.area)}</div>
      </td>
      <td class="${efClase(p.promedio)}"><b>${censEf(p.promedio+"%")}</b></td>`;
    EFR.dias.forEach(d=>{
      const v = p.registros[d];
      const est = p.estados ? p.estados[d] : null;
      if(v!=null) tbody += `<td class="${efClase(v)}">${censEf(v)}</td>`;
      else if(est) tbody += `<td><span class="pill ${esc(est)}" style="font-size:10px;">${esc(est)}</span></td>`;
      else tbody += `<td>\u2014</td>`;
    });
    tbody += `</tr>`;
  });
  tbody += "</tbody>";
  $("tablaEfR").innerHTML = thead + tbody;
}

function descargarEfRango(){
  if(!EFR.personal.length){ mostrarError("Carga primero un rango"); return; }
  const CAB = ["DNI","Nombre","Área","Promedio %", ...EFR.dias.map(d=>d.slice(5))]; // MM-DD
  // Porcentajes enteros (88, 34), no decimales (87.1, 33.3).
  const filas = EFR.personal.map(p=>[
    p.dni, p.nombre, p.area, Math.round(p.promedio),
    ...EFR.dias.map(d=>{ const v=p.registros[d]; return v==null ? "" : Math.round(v); })
  ]);
  const ws = XLSX.utils.aoa_to_sheet([CAB, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "EficienciaRango");
  XLSX.writeFile(wb, `EFICIENCIA_${efRangoSel.desde}_a_${efRangoSel.hasta}.xlsx`);
}

/* ================= ASISTENCIA (mes completo) ================= */
let ASIS_MES=[], ASIS_DIAS=[], selAsis={};

async function cargarEstadosAsis(){
  try{
    ESTADOS_ASIS = await rpc("fn_estados_asistencia_listar",{p_dni:ING.dni,p_token:ING.token});
  }catch(e){ ESTADOS_ASIS = []; }
}

async function cargarAsisMes(){
  const [anio, mes] = $("mesAsis").value.split("-").map(Number);
  $("tablaAsisMes").innerHTML = cargandoHTML("Cargando asistencia del mes…");
  selAsis={}; actualizarNSel();
  try{
    const r = await rpc("fn_asistencia_mes",{p_dni:ING.dni,p_token:ING.token,
      p_area:$("filtroAreaAsis").value, p_anio:anio, p_mes:mes});
    if(!r.ok){ mostrarError(r.error||"Error"); $("tablaAsisMes").innerHTML=""; return; }
    ASIS_DIAS = r.dias; ASIS_MES = r.personal;
    pintarResumenAsis();
    pintarAsisMes();
    pintarDetalleAsis();
  }catch(e){ $("tablaAsisMes").innerHTML=""; mostrarError(e.message); }
}

/* --- Sub-vistas de asistencia: matriz mensual / detallado por día y estado --- */
function asisVista(v){
  const det = v==='detalle';
  $("asisMatriz").style.display = det ? "none" : "block";
  $("asisDetalle").style.display = det ? "block" : "none";
  $("asisTabMatriz").classList.toggle("activo", !det);
  $("asisTabDetalle").classList.toggle("activo", det);
  if(det) pintarDetalleAsis();
}
function pintarDetalleAsis(){
  const z=$("detalleAsis"); if(!z) return;
  const fecha=$("fechaDetAsis") ? $("fechaDetAsis").value : "";
  if(!fecha){ z.innerHTML=`<div class="vacio-msg">Elige un día</div>`; $("resumenDetAsis").textContent=""; return; }
  if(!ASIS_DIAS.includes(fecha)){
    z.innerHTML=`<div class="vacio-msg">Ese día no pertenece al mes cargado. Cambia el mes arriba y recarga.</div>`;
    $("resumenDetAsis").textContent=""; return;
  }
  const porEstado={};
  ASIS_MES.forEach(p=>{
    const est = p.registros[fecha] || 'ACTIVO';   // sin registro ese día = ACTIVO (igual que _estado_dia)
    (porEstado[est]=porEstado[est]||[]).push(p);
  });
  const estados=Object.keys(porEstado).sort((a,b)=>a.localeCompare(b,"es"));
  $("resumenDetAsis").textContent = `${ASIS_MES.length} persona(s) · ${estados.length} estado(s) · ${fecha}`;
  z.innerHTML = estados.map(est=>{
    const gente=[...porEstado[est]].sort((a,b)=>String(a.nombres_apellidos).localeCompare(String(b.nombres_apellidos),"es"));
    return `<div class="det-card">
      <div class="det-head"><span class="pill ${esc(est)}">${esc(est)}</span> <b>${gente.length}</b> persona(s)</div>
      <div class="det-list">${gente.map(p=>`<div class="det-persona">${esc(p.nombres_apellidos)} <span>${esc(p.area_actual)}</span></div>`).join("")}</div>
    </div>`;
  }).join("");
}

function pintarResumenAsis(){
  const total = ASIS_MES.length;
  const porEstado = {};
  ASIS_MES.forEach(p=>{ porEstado[p.estado_actual] = (porEstado[p.estado_actual]||0)+1; });
  let html = `<div class="chip-estado"><div class="ce-num">${total}</div><div class="ce-lbl">TOTAL PERSONAL</div></div>`;
  Object.keys(porEstado).sort().forEach(e=>{
    html += `<div class="chip-estado"><div class="ce-num">${porEstado[e]}</div><div class="ce-lbl">${esc(e)}</div></div>`;
  });
  $("resumenEstadosAsis").innerHTML = html;
}

function pintarAsisMes(){
  const q = normKey($("filtroNomAsis").value);
  const lista = ASIS_MES.filter(p=>!q || normKey(p.nombres_apellidos).includes(q));

  let thead = `<thead><tr><th class="col-check"></th><th class="col-nombre">Nombre</th>`;
  ASIS_DIAS.forEach(d=>{
    const dia = d.slice(8,10);
    thead += `<th>${dia}</th>`;
  });
  thead += `</tr></thead>`;

  let tbody = "<tbody>";
  if(!lista.length){
    tbody += `<tr><td colspan="${ASIS_DIAS.length+2}"><div class="vacio-msg">Sin personal para este filtro</div></td></tr>`;
  }
  lista.forEach(p=>{
    const marcado = !!selAsis[p.dni];
    tbody += `<tr>
      <td class="col-check"><input type="checkbox" ${marcado?"checked":""} onclick="toggleSelAsis('${esc(p.dni)}')"></td>
      <td class="col-nombre" onclick="abrirModalPersonal('${esc(p.dni)}')">${esc(p.nombres_apellidos)}</td>`;
    ASIS_DIAS.forEach(d=>{
      const est = p.registros[d];
      tbody += `<td class="celda-asis" onclick="abrirCeldaAsis('${esc(p.dni)}','${d}','${esc(est||"")}')">${est ? `<span class="pill ${esc(est)}">${esc(est)}</span>` : "\u2014"}</td>`;
    });
    tbody += `</tr>`;
  });
  tbody += "</tbody>";
  $("tablaAsisMes").innerHTML = thead + tbody;
}

function toggleSelAsis(dni){
  if(selAsis[dni]) delete selAsis[dni]; else selAsis[dni]=true;
  actualizarNSel();
}
function actualizarNSel(){ $("nSelAsis").textContent = Object.keys(selAsis).length; }
function limpiarSelAsis(){ selAsis={}; actualizarNSel(); pintarAsisMes(); }

async function aplicarArea(){
  const dnis = Object.keys(selAsis);
  if(!dnis.length){ mostrarError("No hay personas seleccionadas"); return; }
  try{
    const r = await rpc("fn_cambiar_area",{p_dni:ING.dni,p_token:ING.token,
      p_dnis:dnis,p_area:$("selArea").value});
    if(!r.ok){ mostrarError(r.error); return; }
    await cargarAsisMes();
  }catch(e){ mostrarError(e.message); }
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
    estado:"ACTIVO", cargo:"OPERARIO"};
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
  if(!dni || !nombres){ $("mpMsg").textContent = "DNI y nombres son obligatorios"; return; }
  try{
    let r;
    if(dniOriginal){
      r = await rpc("fn_personal_editar",{p_dni_ing:ING.dni,p_token:ING.token,
        p_dni:dni,p_nombres:nombres,p_area_origen:areaOrigen,p_area_actual:areaActual,
        p_estado:estado,p_cargo:cargo});
    } else {
      r = await rpc("fn_personal_crear",{p_dni_ing:ING.dni,p_token:ING.token,
        p_dni:dni,p_nombres:nombres,p_area_origen:areaOrigen,p_area_actual:areaActual,
        p_estado:estado,p_cargo:cargo});
    }
    if(!r.ok){ $("mpMsg").textContent = r.error||"No se pudo guardar"; return; }
    cerrarModal();
    AREAS_DB=null; AREAS_LISTA = await cargarAreasDB(); poblarSelectsArea();  // por si se creó un área nueva
    await cargarAsisMes();
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

/* ---- Modal: asistencia de un solo día (clic en celda) ---- */
function abrirCeldaAsis(dni, fecha, actual){
  const persona = ASIS_MES.find(p=>p.dni===dni);
  const nombre = persona ? persona.nombres_apellidos : dni;
  const opts = ESTADOS_ASIS.map(e=>`<option ${e===actual?"selected":""}>${esc(e)}</option>`).join("");
  abrirModal(`
    <h2>Asistencia · ${esc(nombre)}</h2>
    <div class="sub" style="margin-bottom:14px;">${esc(fecha)}</div>
    <div class="modal-campo">
      <label>Estado</label>
      <select id="caEstado">${opts || '<option value="">Sin estados configurados</option>'}</select>
    </div>
    <div class="modal-msg" id="caMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarCeldaAsis('${esc(dni)}','${fecha}')">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
}
async function guardarCeldaAsis(dni, fecha){
  const estado = $("caEstado").value;
  if(!estado){ $("caMsg").textContent="Elige un estado"; return; }
  try{
    const r = await rpc("fn_asignar_estado_rango",{p_dni:ING.dni,p_token:ING.token,
      p_dnis:[dni],p_estado:estado,p_fecha_desde:fecha,p_fecha_hasta:fecha});
    if(!r.ok){ $("caMsg").textContent=r.error||"No se pudo guardar"; return; }
    cerrarModal();
    await cargarAsisMes();
  }catch(e){ $("caMsg").textContent=e.message; }
}

/* ---- Modal: asignar estado por rango de fechas ---- */
function abrirModalRango(){
  const dnis = Object.keys(selAsis);
  if(!dnis.length){ mostrarError("Selecciona al menos una persona en la tabla"); return; }
  const html = `
    <h2>Asignar estado por rango</h2>
    <div class="sub" style="margin-bottom:14px;">${dnis.length} persona(s) seleccionada(s)</div>
    <div class="modal-campo">
      <label>Estado</label>
      <select id="mrEstado">${ESTADOS_ASIS.map(e=>`<option>${esc(e)}</option>`).join("") || '<option value="">Sin estados configurados</option>'}</select>
    </div>
    <div class="modal-2col">
      <div class="modal-campo">
        <label>Desde</label>
        <input type="date" id="mrDesde" value="${hoyISO()}">
      </div>
      <div class="modal-campo">
        <label>Hasta</label>
        <input type="date" id="mrHasta" value="${hoyISO()}">
      </div>
    </div>
    <div class="modal-msg" id="mrMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarRango()">APLICAR A ${dnis.length}</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`;
  abrirModal(html);
}

async function guardarRango(){
  const dnis = Object.keys(selAsis);
  const estado = $("mrEstado").value;
  const desde = $("mrDesde").value;
  const hasta = $("mrHasta").value;
  if(!estado){ $("mrMsg").textContent = "Elige un estado"; return; }
  if(!desde || !hasta){ $("mrMsg").textContent = "Elige ambas fechas"; return; }
  if(hasta < desde){ $("mrMsg").textContent = "La fecha final no puede ser menor a la inicial"; return; }
  try{
    const r = await rpc("fn_asignar_estado_rango",{p_dni:ING.dni,p_token:ING.token,
      p_dnis:dnis,p_estado:estado,p_fecha_desde:desde,p_fecha_hasta:hasta});
    if(!r.ok){ $("mrMsg").textContent = r.error||"No se pudo guardar"; return; }
    cerrarModal();
    selAsis={}; actualizarNSel();
    await cargarAsisMes();
  }catch(e){ $("mrMsg").textContent = e.message; }
}

/* ================= TICKETS DEL DÍA ================= */
let TK=[], TK_VISTA=[], BASES_CACHE={};
let tkSort={col:null,dir:1};
let tkArea="";                 // filtro de área activo (select); "" = todas
let modoLibTk=false, libSel={}; // modo liberar en lote + códigos marcados
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
  libSel={};
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
function filtrarTkArea(a){ tkArea=a; pintarTk(); cargarResumenUltimas(); }

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
    const r=await rpc("fn_liberar_lote",{p_dni:ING.dni,p_token:ING.token,
      p_codigos:codigos,p_motivo:motivo.trim()});
    if(!r.ok){ mostrarError(r.error||"No se pudo liberar"); return; }
    modoLibTk=false; libSel={};
    const bm=$("btnModoLiberar"); if(bm){ bm.textContent="LIBERAR EN LOTE"; bm.classList.remove("gris"); }
    const bs=$("btnLiberarSel"); if(bs) bs.style.display="none";
    await cargarTk();
  }catch(e){ mostrarError(e.message); }
}
let tkOcultarLib=false;
function toggleOcultarLib(){ tkOcultarLib = !!($("chkOcultarLib") && $("chkOcultarLib").checked); pintarTk(); }
function pintarTk(){
  const q=normKey($("filtroTk").value);
  TK_VISTA = TK.filter(t=>
    (!tkOcultarLib || t.estado!=='LIBERADO') &&
    (!tkArea || t.area===tkArea) &&
    (!q || normKey(t.nombre+" "+t.of+" "+t.articulo+" "+t.op+" "+t.codigo+" "+t.area).includes(q)));
  if(tkSort.col){
    TK_VISTA.sort((a,b)=>{
      const va=a[tkSort.col], vb=b[tkSort.col];
      const na=parseFloat(va), nb=parseFloat(vb);
      const c=(!isNaN(na)&&!isNaN(nb))?na-nb:String(va??"").localeCompare(String(vb??""),"es");
      return c*tkSort.dir;
    });
  }
  const lista=TK_VISTA;
  const min=lista.reduce((a,t)=>a+(t.estado==='ACTIVO'?Number(t.minutos):0),0);
  $("resumenTk").textContent=`${lista.length} tickets · ${Math.round(min)} min activos`
    + (tkArea?` · área: ${tkArea}`:"");
  // Cualquier cargo INGENIERIA puede liberar (el servidor revalida).
  const flecha=k=>tkSort.col===k?(tkSort.dir===1?" \u25B2":" \u25BC"):"";
  const thead="<thead><tr>"
    +(modoLibTk?`<th></th>`:"")
    +TK_COLS.map(c=>`<th class="ord" onclick="ordenarTk('${c.k}')">${c.t}${flecha(c.k)}</th>`).join("")
    +"<th></th></tr></thead>";
  $("tablaTk").innerHTML = thead+"<tbody>"+
    lista.map((t,i)=>`<tr>
      ${modoLibTk?`<td>${t.estado==='ACTIVO'?`<input type="checkbox" class="chk-lib" ${libSel[t.codigo]?"checked":""} onclick="toggleLibSel('${esc(t.codigo)}')">`:""}</td>`:""}
      <td>${esc(t.hora)}</td><td>${esc(t.nombre)}</td><td>${esc(t.area)}</td>
      <td>${esc(t.articulo)}</td><td>${esc(t.of)}</td><td class="izq">${esc(t.op)}</td>
      <td>${t.std!=null?t.std:""}</td><td>${t.cant}</td><td>${t.minutos}</td><td>${esc(t.num)}</td>
      <td><span class="pill ${esc(t.estado)}">${esc(t.estado)}</span></td>
      <td>${t.estado==='ACTIVO'?`<button class="btn-mini rojo" onclick="liberarTicket(${i})">LIBERAR</button>`:""}</td>
      </tr>`).join("")+"</tbody>";
}

/* Retiro de tickets desde la app: SOLO el usuario ALOPEZ.
   El servidor vuelve a validar (fn_liberar_ticket); esto es solo UI. */
async function liberarTicket(i){
  const t = TK_VISTA[i]; if(!t) return;
  const motivo = prompt(`Liberar el ticket ${t.num||t.codigo} tomado por ${t.nombre}.\nMotivo:`);
  if(motivo===null) return;
  try{
    const r = await rpc("fn_liberar_ticket",{p_dni:ING.dni,p_token:ING.token,
      p_codigo:t.codigo,p_motivo:motivo.trim()});
    if(!r.ok){ mostrarError(r.error||"No se pudo liberar"); return; }
    await cargarTk();
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
  return BASE.filter(b=>
    (!fa||normKey(b.articulo).includes(fa)) &&
    (!fo||normKey(b.operacion).includes(fo)) &&
    (!fc||normKey(b.cliente).includes(fc)));
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
      const na=parseFloat(va), nb=parseFloat(vb);
      const c = (!isNaN(na)&&!isNaN(nb)) ? na-nb : String(va??"").localeCompare(String(vb??""),"es");
      return c*baseSort.dir;
    });
  }
  const arts = new Set(lista.map(b=>b.articulo));
  // Cap de render: la base puede tener miles de filas; pintarlas todas cuelga la
  // pestaña. Mostramos hasta LIMITE_BASE y pedimos filtrar para ver más.
  const LIMITE_BASE = 400;
  const totalFilas = lista.length;
  const recortado = totalFilas > LIMITE_BASE;
  if(recortado) lista = lista.slice(0, LIMITE_BASE);
  $("resumenBases").textContent = `${arts.size} artículo(s) · ${totalFilas} operaciones`
    + (recortado ? ` · mostrando ${LIMITE_BASE} (usa los filtros para acotar)` : "");
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
        <button class="acc-borrar" onclick="eliminarBaseOp(${b.id},'${esc((b.operacion||"").replace(/'/g,""))}')">Borrar</button>
      </div></td></tr>`;
    }).join("")+"</tbody>";
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

/* --- CRUD de BASE por fila (editar STD / artículos / operaciones) --- */
let BASE_VALORES={};   // cache por área de valores históricos (prendas/clientes/…/maxop)
async function abrirModalBaseOp(id){
  const area = $("areaBase").value;
  const b = id!=null ? (BASE.find(x=>Number(x.id)===Number(id))||{}) : {};
  const esEdicion = id!=null;
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
      <div class="modal-campo"><label>Artículo</label><input id="boArticulo" list="dlArticulo" value="${v('articulo')}" maxlength="80" placeholder="Elige o escribe…" oninput="autoMaxOp()"></div>
    </div>
    <div class="modal-campo"><label>Operación</label><input id="boOperacion" value="${v('operacion')}" maxlength="120"></div>
    <div class="modal-2col">
      <div class="modal-campo"><label>STD (min)</label><input id="boStd" inputmode="decimal" value="${v('std')}"></div>
      <div class="modal-campo"><label>N°OP (orden)</label><input id="boNop" inputmode="numeric" value="${v('n_op')}"></div>
    </div>
    <div class="modal-campo"><label>Max Op. <span class="cf-detalle" style="font-weight:600;">(auto según artículo)</span></label>
      <input id="boMaxOp" inputmode="numeric" value="${v('max_op')}"></div>
    <div class="cf-detalle" style="margin-top:-4px;">El mayor N°OP del artículo es la operación final (★ dorada); el 2º mayor, la penúltima.</div>
    <div class="modal-msg" id="boMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" onclick="guardarBaseOp(${esEdicion?id:"null"})">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
  if(!esEdicion) autoMaxOp();
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
  try{
    let r;
    if(id!=null){
      r=await rpc("fn_base_op_editar",{p_dni:ING.dni,p_token:ING.token,p_id:id,...datos});
    } else {
      r=await rpc("fn_base_op_crear",{p_dni:ING.dni,p_token:ING.token,p_area:area,...datos});
    }
    if(!r.ok){ $("boMsg").textContent=r.error||"No se pudo guardar"; return; }
    cerrarModal();
    delete BASES_CACHE[area]; delete BASE_VALORES[area];
    if(typeof r.reclamos_actualizados==="number" && r.reclamos_actualizados>0)
      mostrarOk(`Guardado · ${r.reclamos_actualizados} reclamo(s) actualizados por STD`);
    await cargarBases();
  }catch(e){ $("boMsg").textContent=e.message; }
}
async function eliminarBaseOp(id, nombre){
  if(!confirm(`¿Eliminar la operación "${nombre}"?`)) return;
  try{
    const r=await rpc("fn_base_op_eliminar",{p_dni:ING.dni,p_token:ING.token,p_id:id});
    if(!r.ok){ mostrarError(r.error||"No se pudo eliminar"); return; }
    delete BASES_CACHE[$("areaBase").value];
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
    const r = await rpc("fn_bases_subir",{p_dni:ING.dni,p_token:ING.token,
      p_area:$("areaBase").value,p_filas:PENDIENTE});
    if(!r.ok){ mostrarError(r.error); return; }
    cancelarSubida();
    await cargarBases();
  }catch(e){ mostrarError(e.message); }
}
/* ================= INCIDENCIAS (solicitudes de ajuste de tiempo) ================= */
async function cargarIncidI(){
  const z=$("listaIncidI"); z.innerHTML=cargandoHTML("Cargando incidencias…");
  try{
    const r=await rpc("fn_solicitudes_listar",{p_dni:ING.dni,p_token:ING.token,p_area:""});
    if(!r.ok){ mostrarError(r.error||"Error"); z.innerHTML=""; return; }
    const items=r.items||[];
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
          <input type="number" id="inci_${it.id}" value="${it.minutos}"
            style="width:90px;background:var(--gris-fondo);border:2px solid var(--azul);border-radius:10px;font-size:16px;font-weight:800;padding:8px;text-align:center;">
          <span class="cf-detalle">min</span>
          <button class="btn-mini verde" onclick="resolverIncidI(${it.id},true)">APROBAR</button>
          <button class="btn-mini rojo" onclick="resolverIncidI(${it.id},false)">RECHAZAR</button>
        </div>`;
      z.appendChild(d);
    });
  }catch(e){ z.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
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