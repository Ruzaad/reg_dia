/* ============================================================
   SAMITEX — Vista de Ingeniería (requiere app.js cargado antes)
   ============================================================ */
let ING=null;
const AREAS_LISTA = Object.keys(AREAS);
const CARGOS_LISTA = ["OPERARIO","SUPERVISORA","INGENIERIA"];
const ESTADOS_OPERARIO = ["ACTIVO","LIBERADO"];
let ESTADOS_ASIS = [];
function hoyISO(){ return new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"}); }
function mesActualISO(){ const d=hoyISO(); return d.slice(0,7); } // YYYY-MM

document.addEventListener("DOMContentLoaded", ()=>{
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
    };
  });

  ["fechaEf","fechaTk"].forEach(id=>{ $(id).value = hoyISO(); });
  $("mesAsis").value = mesActualISO();
  AREAS_LISTA.forEach(a=>{
    $("selArea").insertAdjacentHTML("beforeend",`<option>${esc(a)}</option>`);
    $("areaBase").insertAdjacentHTML("beforeend",`<option>${esc(a)}</option>`);
    $("filtroAreaAsis").insertAdjacentHTML("beforeend",`<option>${esc(a)}</option>`);
  });
  $("filtroNomAsis").addEventListener("input", pintarAsisMes);
  $("filtroAreaAsis").addEventListener("change", cargarAsisMes);
  $("filtroTk").addEventListener("input", pintarTk);
  cargarEf();
  cargarEstadosAsis();
  cargarAsisMes();
});

/* ================= EFICIENCIAS ================= */
async function cargarEf(){
  $("tablaEf").innerHTML=""; $("efAreas").innerHTML=cargandoHTML("Calculando…");
  try{
    const r = await rpc("fn_eficiencia_dia",{p_dni:ING.dni,p_token:ING.token,p_fecha:$("fechaEf").value});
    if(!r.ok){ mostrarError(r.error||"Error"); return; }
    $("efAreas").innerHTML = (r.areas||[]).map(a=>`
      <div class="kpi"><div class="kpi-num">${a.eficiencia}%</div>
      <div class="kpi-lbl">${esc(a.area)}<br>${Math.round(a.prod)} / ${Math.round(a.disp)} min</div></div>`).join("")
      || '<div class="vacio-msg">Sin datos ese día</div>';
    const filas = (r.personas||[]).map(p=>`
      <tr><td>${esc(p.nombre)}</td><td>${esc(p.dni)}</td><td>${esc(p.area)}</td>
      <td><span class="pill ${esc(p.estado)}">${esc(p.estado)}</span></td>
      <td>${p.tickets}</td><td>${p.prod}</td><td>${p.disp}</td>
      <td class="${p.eficiencia>=80?'ef-alta':p.eficiencia<50?'ef-baja':''}">${p.eficiencia}%</td></tr>`).join("");
    $("tablaEf").innerHTML = `<thead><tr><th>Nombre</th><th>DNI</th><th>Área</th><th>Estado</th>
      <th>Tickets</th><th>Min prod</th><th>Min disp</th><th>Eficiencia</th></tr></thead><tbody>${filas}</tbody>`;
  }catch(e){ $("efAreas").innerHTML=""; mostrarError(e.message); }
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
      <td class="col-check"><input type="checkbox" ${marcado?"checked":""} onclick="toggleSelAsis('${p.dni}')"></td>
      <td class="col-nombre" onclick="abrirModalPersonal('${p.dni}')">${esc(p.nombres_apellidos)}</td>`;
    ASIS_DIAS.forEach(d=>{
      const est = p.registros[d];
      tbody += `<td>${est ? `<span class="pill ${esc(est)}">${esc(est)}</span>` : "—"}</td>`;
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
        <select id="mpAreaOrigen">${AREAS_LISTA.map(a=>`<option ${a===datos.area_origen?"selected":""}>${esc(a)}</option>`).join("")}</select>
      </div>
      <div class="modal-campo">
        <label>Área actual</label>
        <select id="mpAreaActual">${AREAS_LISTA.map(a=>`<option ${a===datos.area_actual?"selected":""}>${esc(a)}</option>`).join("")}</select>
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
      <button class="btn-principal" onclick="guardarPersonal(${esEdicion?`'${esc(datos.dni)}'`:"null"})">GUARDAR</button>
      ${esEdicion?`<button class="btn-pin" onclick="resetearPin('${esc(datos.dni)}')">RESETEAR PIN</button>`:""}
      <button class="btn-secundario" style="width:auto;flex:1;" onclick="cerrarModal()">CANCELAR</button>
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
      <button class="btn-principal" onclick="guardarRango()">APLICAR A ${dnis.length} PERSONA(S)</button>
      <button class="btn-secundario" style="width:auto;flex:1;" onclick="cerrarModal()">CANCELAR</button>
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
let TK=[];
async function cargarTk(){
  $("tablaTk").innerHTML=cargandoHTML("Cargando…");
  try{
    TK = await rpc("fn_tickets_dia",{p_dni:ING.dni,p_token:ING.token,p_fecha:$("fechaTk").value});
    pintarTk();
  }catch(e){ $("tablaTk").innerHTML=""; mostrarError(e.message); }
}
function pintarTk(){
  const q=normKey($("filtroTk").value);
  const lista = TK.filter(t=>!q ||
    normKey(t.nombre+" "+t.of+" "+t.articulo+" "+t.op+" "+t.codigo+" "+t.area).includes(q));
  const min = lista.reduce((a,t)=>a+(t.estado==='ACTIVO'?Number(t.minutos):0),0);
  $("resumenTk").textContent = `${lista.length} tickets · ${Math.round(min)} min activos`;
  $("tablaTk").innerHTML = `<thead><tr><th>Hora</th><th>Nombre</th><th>Área</th><th>OF</th>
    <th>Artículo</th><th>Operación</th><th>N°OP</th><th>Num.</th><th>Cant</th><th>Min</th>
    <th>Código</th><th>Estado</th></tr></thead><tbody>`+
    lista.map(t=>`<tr><td>${esc(t.hora)}</td><td>${esc(t.nombre)}</td><td>${esc(t.area)}</td>
      <td>${esc(t.of)}</td><td>${esc(t.articulo)}</td><td>${esc(t.op)}</td><td>${t.nop??""}</td>
      <td>${esc(t.num)}</td><td>${t.cant}</td><td>${t.minutos}</td><td>${esc(t.codigo)}</td>
      <td><span class="pill ${esc(t.estado)}">${esc(t.estado)}</span></td></tr>`).join("")+"</tbody>";
}

/* ================= BASES ================= */
const CAB_BASE = ["PRENDA","CLIENTE","MÓDULO","ARTICULO","OPERACIÓN","STD","MAX OP.","NOP"];
let BASE=[];
async function cargarBases(){
  $("zonaDiff").style.display="none";
  $("tablaBases").innerHTML=cargandoHTML("Cargando base…");
  try{
    BASE = await rpc("fn_bases_listar",{p_dni:ING.dni,p_token:ING.token,p_area:$("areaBase").value});
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
function pintarBases(){
  const lista = basesFiltradas();
  const arts = new Set(lista.map(b=>b.articulo));
  $("resumenBases").textContent = `${arts.size} artículo(s) · ${lista.length} operaciones`;
  $("tablaBases").innerHTML = `<thead><tr><th>Prenda</th><th>Cliente</th><th>Módulo</th>
    <th>Artículo</th><th>Operación</th><th>STD</th><th>Max Op.</th><th>N_OP</th></tr></thead><tbody>`+
    lista.map(b=>`<tr><td>${esc(b.prenda)}</td><td>${esc(b.cliente)}</td><td>${esc(b.modulo)}</td>
      <td><b>${esc(b.articulo)}</b></td><td>${esc(b.operacion)}</td><td>${b.std}</td>
      <td>${b.max_op}</td><td>${b.n_op}</td></tr>`).join("")+"</tbody>";
}
function descargarBase(){
  const lista = basesFiltradas();
  if(!lista.length){ mostrarError("No hay filas para descargar (revisa filtros o carga la base)"); return; }
  const filas = lista.map(b=>[b.prenda,b.cliente,b.modulo,b.articulo,b.operacion,b.std,b.max_op,b.nop]);
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
        const k=normKey(h);
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