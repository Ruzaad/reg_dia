/* ============================================================
   SAMITEX — Vista de Ingeniería (requiere app.js cargado antes)
   ============================================================ */
let ING=null;
let AREAS_LISTA = Object.keys(AREAS);       // se reemplaza con fn_areas_listar al iniciar
const CARGOS_LISTA = ["OPERARIO","SUPERVISORA","ESTAJERO"];
const ESTADOS_OPERARIO = ["ACTIVO","INACTIVO"];
const USUARIO_LIBERA = "ALOPEZ";            // único usuario que puede retirar tickets desde la app
let ESTADOS_ASIS = [];
function hoyISO(){ return new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"}); }
function mesActualISO(){ const d=hoyISO(); return d.slice(0,7); } // YYYY-MM

document.addEventListener("DOMContentLoaded", async ()=>{
  if(document.body.dataset.pagina!=="ingenieria") return;
  ING = sesionActual();
  if(!ING){ location.href="index.html"; return; }
  if(ING.cargo!=="INGENIERIA"){ location.href = destinoPorCargo(ING.cargo); return; }
  $("quienBadge").textContent = ING.nombre; $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;

  document.querySelectorAll(".tab[data-tab]").forEach(b=>{
    b.onclick = ()=>{
      document.querySelectorAll(".tab[data-tab]").forEach(x=>x.classList.remove("activo"));
      b.classList.add("activo");
      irA(b.dataset.tab);
      if(b.dataset.tab==='pasoIncid') cargarIncidI();
    };
  });

  ["fechaEf","fechaTk"].forEach(id=>{ $(id).value = hoyISO(); });
  $("mesAsis").value = mesActualISO();

  // Áreas desde la base de datos (incluye CORTE, REPROCESOS, etc.)
  AREAS_LISTA = await cargarAreasDB();
  poblarSelectsArea();

  $("filtroNomAsis").addEventListener("input", pintarAsisMes);
  $("filtroAreaAsis").addEventListener("change", cargarAsisMes);
  $("filtroAreaEf").addEventListener("change", pintarEf);
  $("filtroNomEfR").addEventListener("input", ()=>{ if(EFR.personal.length) pintarEfRango(); });
  flatpickr("#rangoEf", {mode:"range", dateFormat:"Y-m-d", locale:{rangeSeparator:" a "},
    onChange:(dates)=>{
      if(dates.length===2){
        efRangoSel.desde = dates[0].toLocaleDateString("sv-SE");
        efRangoSel.hasta = dates[1].toLocaleDateString("sv-SE");
      }
    }});
  $("filtroTk").addEventListener("input", pintarTk);
  cargarEf();
  cargarEstadosAsis();
  cargarAsisMes();
});

function poblarSelectsArea(){
  const op = a=>`<option>${esc(a)}</option>`;
  $("selArea").innerHTML = AREAS_LISTA.map(op).join("");
  $("areaBase").innerHTML = AREAS_LISTA.map(op).join("");
  $("filtroAreaAsis").innerHTML = `<option value="">Todas las áreas</option>` + AREAS_LISTA.map(op).join("");
  $("filtroAreaEf").innerHTML   = `<option value="">Todas las áreas</option>` + AREAS_LISTA.map(op).join("");
  $("filtroAreaEfR").innerHTML  = `<option value="">Todas las áreas</option>` + AREAS_LISTA.map(op).join("");
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
  $("efAreas").innerHTML = (EF.areas||[]).map(a=>`
    <div class="kpi"><div class="kpi-num">${a.eficiencia}%</div>
    <div class="kpi-lbl">${esc(a.area)}<br>${Math.round(a.prod)} / ${Math.round(a.disp)} min</div></div>`).join("")
    || '<div class="vacio-msg">Sin datos ese día</div>';

  const fArea = $("filtroAreaEf").value;
  let lista = (EF.personas||[]).filter(p=>!fArea || p.area===fArea);
  if(efSort.col){
    lista = [...lista].sort((a,b)=>{
      const va=a[efSort.col], vb=b[efSort.col];
      const na=parseFloat(va), nb=parseFloat(vb);
      const c = (!isNaN(na)&&!isNaN(nb)) ? na-nb : String(va??"").localeCompare(String(vb??""),"es");
      return c*efSort.dir;
    });
  }
  const flecha = k => efSort.col===k ? (efSort.dir===1?" \u25B2":" \u25BC") : "";
  const thead = "<thead><tr>"+EF_COLS.map(c=>
    `<th class="ord" onclick="ordenarEf('${c.k}')">${c.t}${flecha(c.k)}</th>`).join("")+"</tr></thead>";
  const filas = lista.map(p=>`
    <tr><td>${esc(p.nombre)}</td><td>${esc(p.dni)}</td><td>${esc(p.area)}</td>
    <td><span class="pill ${esc(p.estado)}">${esc(p.estado)}</span></td>
    <td>${p.tickets}</td><td>${p.prod}</td><td>${p.disp}</td>
    <td class="${p.eficiencia>=80?'ef-alta':p.eficiencia<50?'ef-baja':''}">${p.eficiencia}%</td></tr>`).join("");
  $("tablaEf").innerHTML = thead + "<tbody>" +
    (filas || `<tr><td colspan="8"><div class="vacio-msg">Sin personas para este filtro</div></td></tr>`) + "</tbody>";
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
      <td class="${efClase(p.promedio)}"><b>${p.promedio}%</b></td>`;
    EFR.dias.forEach(d=>{
      const v = p.registros[d];
      tbody += (v==null) ? `<td>\u2014</td>` : `<td class="${efClase(v)}">${v}</td>`;
    });
    tbody += `</tr>`;
  });
  tbody += "</tbody>";
  $("tablaEfR").innerHTML = thead + tbody;
}

function descargarEfRango(){
  if(!EFR.personal.length){ mostrarError("Carga primero un rango"); return; }
  const CAB = ["DNI","Nombre","Área","Promedio %", ...EFR.dias.map(d=>d.slice(5))]; // MM-DD
  const filas = EFR.personal.map(p=>[
    p.dni, p.nombre, p.area, p.promedio,
    ...EFR.dias.map(d=>{ const v=p.registros[d]; return v==null ? "" : v; })
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
  }catch(e){ $("tablaAsisMes").innerHTML=""; mostrarError(e.message); }
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
const TK_COLS=[
  {k:"hora",t:"Hora"},{k:"nombre",t:"Nombre"},{k:"area",t:"Área"},{k:"of",t:"OF"},
  {k:"articulo",t:"Artículo"},{k:"op",t:"Operación"},{k:"nop",t:"N°OP"},{k:"num",t:"Num."},
  {k:"cant",t:"Cant"},{k:"minutos",t:"Min"},{k:"codigo",t:"Código"},{k:"estado",t:"Estado"}
];
function ordenarTk(col){ if(tkSort.col===col) tkSort.dir*=-1; else tkSort={col,dir:1}; pintarTk(); }
function descargarTk(){
  const lista = TK_VISTA;
  if(!lista.length){ mostrarError("No hay tickets para descargar"); return; }
  const CAB = ["Hora","Nombre","DNI","Área","OF","Artículo","Operación","N°OP","Numeración","Cant","Min","Código","Estado"];
  const filas = lista.map(t=>[t.hora,t.nombre,t.dni,t.area,t.of,t.articulo,t.op,t.nop,t.num,t.cant,t.minutos,t.codigo,t.estado]);
  const ws = XLSX.utils.aoa_to_sheet([CAB, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TicketsDia");
  XLSX.writeFile(wb, `TICKETS_${$("fechaTk").value}.xlsx`);
}

async function cargarTk(){
  $("tablaTk").innerHTML=cargandoHTML("Cargando…");
  $("resumenUltimas").innerHTML="";
  try{
    TK = await rpc("fn_tickets_dia",{p_dni:ING.dni,p_token:ING.token,p_fecha:$("fechaTk").value});
    pintarTk();
    cargarResumenUltimas();   // no bloquea la tabla
  }catch(e){ $("tablaTk").innerHTML=""; mostrarError(e.message); }
}
function pintarTk(){
  const q=normKey($("filtroTk").value);
  TK_VISTA = TK.filter(t=>!q ||
    normKey(t.nombre+" "+t.of+" "+t.articulo+" "+t.op+" "+t.codigo+" "+t.area).includes(q));
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
  $("resumenTk").textContent=`${lista.length} tickets · ${Math.round(min)} min activos`;
  const puedeLiberar = ING && normKey(ING.dni)===USUARIO_LIBERA;
  const flecha=k=>tkSort.col===k?(tkSort.dir===1?" \u25B2":" \u25BC"):"";
  const thead="<thead><tr>"+TK_COLS.map(c=>
    `<th class="ord" onclick="ordenarTk('${c.k}')">${c.t}${flecha(c.k)}</th>`).join("")
    +(puedeLiberar?"<th></th>":"")+"</tr></thead>";
  $("tablaTk").innerHTML = thead+"<tbody>"+
    lista.map((t,i)=>`<tr><td>${esc(t.hora)}</td><td>${esc(t.nombre)}</td><td>${esc(t.area)}</td>
      <td>${esc(t.of)}</td><td>${esc(t.articulo)}</td><td>${esc(t.op)}</td><td>${t.nop??""}</td>
      <td>${esc(t.num)}</td><td>${t.cant}</td><td>${t.minutos}</td><td>${esc(t.codigo)}</td>
      <td><span class="pill ${esc(t.estado)}">${esc(t.estado)}</span></td>
      ${puedeLiberar?`<td>${t.estado==='ACTIVO'?`<button class="btn-mini rojo" onclick="liberarTicket(${i})">LIBERAR</button>`:""}</td>`:""}
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
  const areas=[...new Set(TK.map(t=>t.area).filter(Boolean))];
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
  $("resumenBases").textContent = `${arts.size} artículo(s) · ${lista.length} operaciones`;
  const flecha = k => baseSort.col===k ? (baseSort.dir===1?" \u25B2":" \u25BC") : "";
  const thead = "<thead><tr>"+BASE_COLS.map(c=>
    `<th class="ord${c.k==='operacion'?' izq':''}" onclick="ordenarBase('${c.k}')">${c.t}${flecha(c.k)}</th>`).join("")+"</tr></thead>";
  $("tablaBases").innerHTML = thead + "<tbody>"+
    lista.map(b=>`<tr><td>${esc(b.prenda)}</td><td>${esc(b.cliente)}</td><td>${esc(b.modulo)}</td>
      <td><b>${esc(b.articulo)}</b></td><td class="izq">${esc(b.operacion)}</td><td>${b.std}</td>
      <td>${b.max_op}</td><td>${b.n_op}</td></tr>`).join("")+"</tbody>";
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