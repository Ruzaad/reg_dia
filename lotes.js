/* ================= TRABAJO POR TIEMPO (parche 116) =================
   Lotes de DESPACHO, REPROCESO y CORTE, que no tienen OF ni BASE.
   Operario: EMPEZAR y TERMINAR (la hora la pone el servidor) y al terminar
   cuántas prendas hizo. Supervisora e Ingeniería: crear y cerrar lotes,
   ver las horas y poner la cantidad de lo que quedó por revisar.
   No cambia ningún cálculo de boleta, eficiencia ni incentivos. */

const LT_AREAS=["DESPACHO","REPROCESO","CORTE"];
const LT={mios:null, sel:null, tic:null, fin:null, tareas:null, panel:null, sesion:null};
const ltN = n => Number(n||0).toLocaleString("es-PE");
const ltH = m => { m=Math.max(0,Math.round(Number(m)||0)); return `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}`; };
const ltHoras = m => (Math.round((Number(m)||0)/6)/10).toLocaleString("es-PE",{minimumFractionDigits:1})+" h";
/* Horas siempre en hora de Lima: el servidor lee "Terminó a las" en esa hora. */
const ltHM = t => t ? new Date(t).toLocaleTimeString("es-PE",{timeZone:"America/Lima",hour:"2-digit",minute:"2-digit",hour12:false}) : "—";
const ltFalta = e => /Could not find the function|PGRST202/i.test(String(e&&e.message||e||""));
const LT_FALTA_HTML = `<div class="acf-falta"><b>Falta correr el parche 116 en la base.</b> Con él, DESPACHO, REPROCESO y CORTE registran su trabajo en lotes: empezar, terminar y cuántas prendas.</div>`;
const ltSes = () => LT.sesion || ((typeof ING!=="undefined" && ING && ING.dni) ? ING : sesionActual());
/* min/prenda real: solo con tramos que tienen cantidad. */
const ltReal = l => (l.hecho>0 && l.min_contado>0) ? l.min_contado/l.hecho : null;
const ltPct = l => Math.min(100, Math.round((l.hecho||0)/(l.cantidad||1)*100));

/* ---------------- OPERARIO ---------------- */
/* CORTE y REPROCESO entran directo aquí; quien está EN DESPACHO/REPROCESO/CORTE
   hoy ve un aviso arriba de su lista de OF (ltAvisoHoy). */
async function ltEntrar(s, propia){
  LT.sesion=s;
  if(typeof VOLVER_OPERARIO!=="undefined"){
    VOLVER_OPERARIO.pasoLoteFin="pasoLotes";
    if(propia){ window.VOLVER_INICIO="pasoLotes"; VOLVER_OPERARIO.pasoBoleta="pasoLotes"; delete VOLVER_OPERARIO.pasoLotes; }
    else VOLVER_OPERARIO.pasoLotes=VOLVER_INICIO_OF();   // vino desde el aviso: atrás vuelve a su lista de OF
  }
  irA("pasoLotes"); window.scrollTo(0,0);
  await ltCargarOp();
}
async function ltAvisoHoy(s){
  const avisos=[$("ltAviso"),$("ltAvisoAcab")].filter(Boolean); if(!avisos.length) return;
  try{
    const r=await rpc("fn_lotes_mios",{p_dni:s.dni,p_token:s.token});
    if(!r || !r.ok || !r.area) { avisos.forEach(a=>a.hidden=true); return; }
    LT.mios=r;
    avisos.forEach(a=>{ a.hidden=false;
      a.innerHTML=`<button type="button" class="lt-aviso" onclick="ltEntrar(sesionActual(), false)"><span class="lt-en">● HOY ESTÁS EN ${esc(r.area)}</span>
        <b>${r.actual?"Tienes un lote en curso":"Registra tu trabajo en lotes"}</b><span aria-hidden="true">›</span></button>`; });
  }catch(e){ avisos.forEach(a=>a.hidden=true); }   // sin el parche no se muestra nada
}
async function ltCargarOp(){
  const z=$("ltZona"); if(!z) return;
  const s=ltSes();
  if(!LT.mios) pintarCargando(z,"Cargando lotes…");
  try{
    const r=await rpc("fn_lotes_mios",{p_dni:s.dni,p_token:s.token});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    LT.mios=r; ltPintarOp();
  }catch(e){ z.innerHTML = ltFalta(e) ? LT_FALTA_HTML : `<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function ltMinHoy(){
  const r=LT.mios||{}; return (r.hoy||[]).reduce((a,t)=>a+Number(t.min||0),0);
}
function ltDia(){
  const m=ltMinHoy(), run=LT.mios&&LT.mios.actual ? (LT.mios.hoy||[]).filter(t=>!t.fin).reduce((a,t)=>a+Number(t.min||0),0) : 0;
  const w=v=>Math.min(100,v/5.75).toFixed(1)+"%";
  return `<div class="lt-dia"><div class="t">Mi día en lotes <b>${Math.round(m)} de 575 min</b></div>
    <div class="lt-bar"><i style="width:${w(m-run)}"></i>${run?`<i class="run" style="width:${w(run)}"></i>`:""}</div>
    <div class="s">${LT.mios&&LT.mios.actual?"El lote en curso ya cuenta para tu día.":m?"Toca un lote para seguir.":"Aún no empiezas ningún lote."}</div></div>`;
}
function ltPintarOp(){
  const z=$("ltZona"), r=LT.mios; if(!z||!r) return;
  clearInterval(LT.tic); LT.tic=null;
  if(!r.area && !r.actual){ z.innerHTML=`<div class="vacio-msg">Hoy no estás en DESPACHO, REPROCESO ni CORTE. Si vas a trabajar ahí, pide a tu supervisora que te marque en asistencia.</div>
      <button type="button" class="btn-secundario btn-boleta" onclick="irA(VOLVER_INICIO_OF())">VOLVER</button>`; return; }
  const cab=`<div class="lt-cab"><span class="lt-en">● HOY ESTÁS EN ${esc(r.area||r.actual.lote.area)}</span></div>`;
  const hoy=(r.hoy||[]).filter(t=>t.fin);
  const tramos = hoy.length ? `<h2 class="lt-h2">Hoy</h2>`+hoy.slice().reverse().map(t=>`<div class="lt-tr${t.prendas==null?" inc":""}"><span class="h">${ltHM(t.inicio)}<br>${ltHM(t.fin)}</span>
      <span class="q">${esc(t.destino)}</span><span class="min">${Math.round(t.min)}<small>min</small></span>
      <span class="d">${esc(t.tarea)} · ${t.prendas==null?"cantidad por poner":ltN(t.prendas)+" prendas"}</span></div>`).join("") : "";
  if(r.actual){
    const a=r.actual, l=a.lote;
    z.innerHTML=`${cab}${ltDia()}
      <div class="lt-run" aria-live="off"><div class="lbl">Trabajando</div><div class="reloj" id="ltReloj">${ltH((Date.now()-new Date(a.inicio))/60000)}</div>
        <div class="desde">desde las ${ltHM(a.inicio)}</div>
        <div class="lote">${esc(l.destino)}<small>${esc(l.tarea)}${l.o_f?` · OF ${esc(l.o_f)}`:""}</small></div>
        <div class="lt-av"><div class="lt-bar"><i style="width:${ltPct(l)}%;background:var(--azul)"></i></div>
          <div class="m"><span>Lote: <b>${ltN(l.hecho)}</b> de <b>${ltN(l.cantidad)}</b></span><span>${l.ahora>1?`con ${l.ahora-1} más`:"solo tú ahora"}</span></div></div></div>
      <button type="button" class="lt-go stop" onclick="ltIrFin(false)">■ TERMINAR</button>
      <button type="button" class="lt-sec" onclick="ltIrFin(true)">Pasarme a otro lote</button>
      <div class="lt-nota">Si te olvidas de terminar, se cierra solo a la salida (18:20) y tu supervisora pone la cantidad.</div>
      ${tramos}
      <button type="button" class="btn-secundario btn-boleta" onclick="abrirBoleta()">MI BOLETA</button>`;
    LT.tic=setInterval(()=>{ const e=$("ltReloj"); if(!e||!e.isConnected){ clearInterval(LT.tic); return; } e.textContent=ltH((Date.now()-new Date(a.inicio))/60000); }, 20000);
    return;
  }
  const ls=r.lotes||[];
  z.innerHTML=`${cab}<h1 class="lt-h1">¿En qué lote trabajas?</h1><div class="sub">Toca el lote y luego EMPEZAR</div>${ltDia()}
    ${ls.length ? ls.map(l=>`<div class="lt-lote${LT.sel===l.id?" sel":""}" role="button" tabindex="0" aria-pressed="${LT.sel===l.id}"
          onclick="ltElegir(${l.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ltElegir(${l.id})}">
        <div class="k">${esc(l.area)} · L-${l.id}${l.o_f?` · OF ${esc(l.o_f)}`:""}</div><div class="n">${esc(l.destino)}</div><div class="tarea">${esc(l.tarea)}</div>
        <div class="m"><span><b>${ltN(l.hecho)}</b> de ${ltN(l.cantidad)} prendas</span>${l.ahora?`<span class="ahora">${l.ahora} trabajando ahora</span>`:""}</div>
        ${LT.sel===l.id?`<button type="button" class="lt-go" id="ltEmpezar" onclick="event.stopPropagation();ltEmpezar(${l.id})">▶ EMPEZAR</button>`:""}</div>`).join("")
      : `<div class="vacio-msg">Todavía no hay lotes abiertos en ${esc(r.area)}.</div>`}
    <div class="lt-nota">¿No ves tu lote? Pídele a tu supervisora que lo cree.</div>
    ${tramos}
    <button type="button" class="btn-secundario btn-boleta" onclick="abrirBoleta()">MI BOLETA</button>`;
}
function VOLVER_INICIO_OF(){ return (typeof ES_ACABADO!=="undefined" && ES_ACABADO) ? "pasoAcabOF" : "pasoOF"; }
function ltElegir(id){ LT.sel = LT.sel===id ? null : id; ltPintarOp(); const b=$("ltEmpezar"); if(b) b.focus(); }
async function ltEmpezar(id){
  const s=ltSes();
  await unaVez("ltEmpezar", botonesDe("#ltEmpezar"), async()=>{
    try{
      const r=await rpc("fn_lote_empezar",{p_dni:s.dni,p_token:s.token,p_lote:id});
      if(!r.ok){ mostrarError(r.error||"No se pudo empezar"); return; }
      LT.sel=null; await ltCargarOp(); window.scrollTo(0,0);
    }catch(e){ mostrarError(e.message); }
  });
}
/* Pantalla "¿Cuántas prendas hiciste?". otro=true: después vuelve a la lista. */
function ltIrFin(otro){
  const a=LT.mios&&LT.mios.actual; if(!a) return;
  LT.fin={otro};
  const min=(Date.now()-new Date(a.inicio))/60000;
  $("ltFinSub").textContent=`${a.lote.destino} · ${a.lote.tarea}`;
  $("ltFinRes").innerHTML=`<span>${ltHM(a.inicio)} a ${ltHM(new Date())}</span><b>${ltH(min).replace(":"," h ")} min</b>`;
  const i=$("ltCant"); i.value="";
  irA("pasoLoteFin"); window.scrollTo(0,0); setTimeout(()=>i.focus(),50);
}
function ltSumar(n){ const i=$("ltCant"); i.value=Math.max(0,(parseInt(i.value,10)||0)+n); }
async function ltTerminar(sinContar){
  const s=ltSes(), v=$("ltCant").value.trim();
  let p=null;
  if(!sinContar){
    p=parseInt(v,10);
    if(!(p>=0)){ mostrarError("Escribe cuántas prendas hiciste"); $("ltCant").focus(); return; }
    if(p>5000 && !confirm(`¿Seguro que fueron ${ltN(p)} prendas?`)) return;
  }
  await unaVez("ltTerminar", botonesDe("#pasoLoteFin button"), async()=>{
    try{
      const r=await rpc("fn_lote_terminar",{p_dni:s.dni,p_token:s.token,p_prendas:p});
      if(!r.ok){ mostrarError(r.error||"No se pudo guardar"); return; }
      mostrarOk(p==null?"Listo: tu supervisora pondrá la cantidad":`Guardado: ${ltN(p)} prendas en ${Math.round(r.min||0)} min`);
      irA("pasoLotes"); window.scrollTo(0,0); await ltCargarOp();
    }catch(e){ mostrarError(e.message); }
  });
}

/* ---------------- Nuevo lote (supervisora e Ingeniería) ---------------- */
async function ltTareas(){
  if(LT.tareas) return LT.tareas;
  const s=ltSes();
  try{ LT.tareas=await rpc("fn_lote_tareas",{p_dni:s.dni,p_token:s.token}); }catch(e){ LT.tareas=[]; }
  return LT.tareas;
}
function ltFormHTML(areas){
  return `<div class="lt-form" id="ltForm">
    <div class="lt-f"><span id="ltAreaL">Área</span><div class="lt-seg" role="radiogroup" aria-labelledby="ltAreaL" id="ltFArea">
      ${areas.map((a,i)=>`<button type="button" role="radio" aria-checked="${i===0}" data-v="${esc(a)}">${esc(a)}</button>`).join("")}</div></div>
    <label class="lt-f"><span>Cliente o destino</span><input class="inp" id="ltFDest" maxlength="60" autocomplete="off" placeholder="Ej: SCOTIABANK"></label>
    <div class="lt-f"><span id="ltTarL">Tarea</span><div class="lt-seg" role="radiogroup" aria-labelledby="ltTarL" id="ltFTar"></div>
      <input class="inp" id="ltFOtra" maxlength="40" placeholder="Nombre de la tarea nueva" hidden style="margin-top:8px"></div>
    <label class="lt-f"><span>Cantidad de prendas</span><input class="inp" id="ltFCant" type="number" inputmode="numeric" min="1"></label>
    <label class="lt-f"><span>OF (opcional)</span><input class="inp" id="ltFOf" maxlength="12" autocomplete="off" placeholder="Si el lote viene de una OF"></label>
    <div class="modal-msg" id="ltFMsg" role="alert"></div>
  </div>`;
}
async function ltFormIniciar(){
  const ts=await ltTareas();
  const seg=(id,cb)=>{ const g=$(id); if(!g) return; g.onclick=e=>{ const b=e.target.closest("button"); if(!b) return;
    g.querySelectorAll("button").forEach(x=>x.setAttribute("aria-checked", x===b)); cb&&cb(b.dataset.v); }; };
  const pintarTar=a=>{ const g=$("ltFTar"); if(!g) return;
    g.innerHTML=ts.filter(t=>t.area===a).map(t=>`<button type="button" role="radio" aria-checked="false" data-v="${esc(t.nombre)}">${esc(t.nombre)}</button>`).join("")
      +`<button type="button" role="radio" aria-checked="false" data-v="">+ otra</button>`;
    $("ltFOtra").hidden=true; };
  seg("ltFArea", pintarTar);
  seg("ltFTar", v=>{ const o=$("ltFOtra"); o.hidden = v!==""; if(v==="") o.focus(); });
  const a=$("ltFArea").querySelector("[aria-checked=true]"); pintarTar(a?a.dataset.v:"");
}
async function ltCrear(alTerminar){
  const s=ltSes(), msg=$("ltFMsg");
  const sel=id=>{ const b=$(id)&&$(id).querySelector("[aria-checked=true]"); return b?b.dataset.v:null; };
  const area=sel("ltFArea"); let tarea=sel("ltFTar");
  if(tarea==="") tarea=$("ltFOtra").value.trim();
  const dest=$("ltFDest").value.trim(), cant=parseInt($("ltFCant").value,10), of=$("ltFOf").value.trim();
  if(!dest){ msg.textContent="Escribe el cliente o destino"; $("ltFDest").focus(); return; }
  if(!tarea){ msg.textContent="Elige la tarea"; return; }
  if(!(cant>0)){ msg.textContent="Pon la cantidad de prendas"; $("ltFCant").focus(); return; }
  msg.textContent="";
  await unaVez("ltCrear", botonesDe(".lt-crear"), async()=>{
    try{
      const r=await rpc("fn_lote_crear",{p_dni:s.dni,p_token:s.token,p_area:area,p_destino:dest,p_tarea:tarea,p_cantidad:cant,p_of:of});
      if(!r.ok){ msg.textContent=r.error||"No se pudo crear"; return; }
      LT.tareas=null; mostrarOk(r.repetido?"Ese lote ya estaba creado":`Lote L-${r.id} creado`);
      alTerminar&&alTerminar();
    }catch(e){ msg.textContent=e.message; }
  });
}
async function ltCerrar(id, cerrar, alTerminar){
  if(cerrar && !confirm("¿Cerrar el lote? Quien siga trabajando en él termina ahora y su cantidad queda por revisar.")) return;
  const s=ltSes();
  await unaVez("ltCerrar"+id, [], async()=>{
    try{ const r=await rpc("fn_lote_cerrar",{p_dni:s.dni,p_token:s.token,p_lote:id,p_cerrar:cerrar});
      if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
      mostrarOk(cerrar?"Lote cerrado":"Lote reabierto"); alTerminar&&alTerminar();
    }catch(e){ mostrarError(e.message); }
  });
}
async function ltRevisar(id, alTerminar){
  const s=ltSes(), i=$("ltRv"+id), f=$("ltRvF"+id);
  const p=parseInt(i&&i.value,10); if(!(p>=0)){ mostrarError("Pon la cantidad"); i&&i.focus(); return; }
  await unaVez("ltRev"+id, botonesDe(`#ltRvB${id}`), async()=>{
    try{ const r=await rpc("fn_lote_tramo_revisar",{p_dni:s.dni,p_token:s.token,p_tramo:id,p_prendas:p,p_fin:f&&f.value||""});
      if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
      mostrarOk("Guardado"); alTerminar&&alTerminar();
    }catch(e){ mostrarError(e.message); }
  });
}
const ltPorRevisarFila = (t, cb) => `<div class="lt-rev"><div class="lt-rev-t"><b>${esc(soloApellidos(t.nombre||t.dni))}</b>
    <span>${esc(t.destino)} · ${esc(t.tarea)}</span><small>${new Date(t.inicio).toLocaleDateString("es-PE",{timeZone:"America/Lima",weekday:"short",day:"2-digit",month:"2-digit"})} · ${ltHM(t.inicio)} a ${ltHM(t.fin)} · ${Math.round(t.min)} min${t.auto?" · se cerró solo":""}</small></div>
    <div class="lt-rev-f"><label>Prendas<input id="ltRv${t.id}" type="number" inputmode="numeric" min="0"></label>
    ${t.auto?`<label>Terminó a las<input id="ltRvF${t.id}" type="time" value="${ltHM(t.fin)}"></label>`:""}
    <button type="button" class="btn-mini" id="ltRvB${t.id}" onclick="ltRevisar(${t.id},${cb})">Guardar</button></div></div>`;

/* ---------------- INGENIERÍA ---------------- */
async function ltCargarIng(){
  const z=$("ltIngZona"); if(!z) return;
  const s=ltSes(), f=$("ltFecha"), a=$("ltArea");
  pintarCargando(z,"Cargando lotes…");
  try{
    const r=await rpc("fn_lotes_panel",{p_dni:s.dni,p_token:s.token,p_area:a?a.value:"",p_fecha:(f&&f.value)||null});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    LT.panel=r; ltPintarIng();
  }catch(e){ z.innerHTML = ltFalta(e) ? LT_FALTA_HTML : `<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function ltPintarIng(){
  const z=$("ltIngZona"), r=LT.panel; if(!z||!r) return;
  const edita=(r.areas||[]).filter(a=>a.edita).map(a=>a.area);
  const nb=$("ltNuevoBtn"); if(nb) nb.hidden=!edita.length;
  const sum=k=>(r.areas||[]).reduce((s,a)=>s+Number(a[k]||0),0);
  const kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num"${c?` style="color:${c}"`:""}>${v}</div><div class="kpi-lbl">${t}</div></div>`;
  const ls=r.lotes||[], pr=r.por_revisar||[];
  const std=l=>l.std?`<span class="lt-std">${Number(l.std).toFixed(2)}</span>`:`<span class="lt-sinstd">Sin estándar</span>`;
  const real=l=>{ const v=ltReal(l); if(v==null) return `<span class="sub">—</span>`;
    return `<span class="lt-std${l.std?(v>l.std*1.1?" mal":" bien"):""}">${v.toFixed(2)}</span>`; };
  const efi=l=>{ const v=ltReal(l); return (l.std&&v)?`<b>${Math.round(l.std/v*100)}%</b>`:`<span class="sub">—</span>`; };
  const fila=l=>`<tr><td class="izq"><b>${esc(l.destino)}</b><small>L-${l.id} · ${esc(l.tarea)}${l.o_f?` · OF ${esc(l.o_f)}`:""}</small></td><td>${esc(l.area)}</td>
    <td class="nw">${ltN(l.hecho)} / ${ltN(l.cantidad)}</td>
    <td><span class="lt-prog${ltPct(l)>=100?" ok":""}"><span class="b"><i style="width:${ltPct(l)}%"></i></span><span>${ltPct(l)}%</span></span></td>
    <td class="nw">${ltHoras(l.min)}</td>
    <td>${l.estado==="CERRADO"?`<span class="tag g">Cerrado</span>`:l.ahora?`<span class="lt-vivo">${l.ahora}</span>`:`<span class="sub">0</span>`}</td>
    <td>${real(l)}</td><td>${std(l)}</td><td>${efi(l)}</td>
    <td>${l.por_revisar?`<span class="tag r">${l.por_revisar}</span>`:""}</td>
    <td class="nw"><button class="btn-mini gris" onclick="ltVer(${l.id})">Ver</button></td></tr>`;
  z.innerHTML=`<div class="kpis" style="margin-bottom:14px">${kpi("Lotes abiertos",sum("abiertos"))}${kpi("Trabajando ahora",sum("ahora"),"var(--exito)")}
      ${kpi("Horas del día",ltHoras(sum("min")))}${kpi("Por revisar",pr.length,pr.length?"var(--alerta)":"")}</div>
    <div class="lt-areas">${(r.areas||[]).map(a=>`<div class="lt-ar"><div class="t">${esc(a.area)} ${a.ahora?`<span class="lt-vivo">${a.ahora} ahora</span>`:""}</div>
      <div class="n">${ltHoras(a.min)} <small>· ${a.personas} ${a.personas===1?"persona":"personas"}</small></div><div class="s">${a.abiertos} ${a.abiertos===1?"lote abierto":"lotes abiertos"}${a.edita?"":" · solo lectura"}</div></div>`).join("")}</div>
    ${pr.length?`<h2 class="lt-h2">Por revisar <span class="sub">(sin cantidad: se cerraron solos o el operario no contó)</span></h2>
      <div class="lt-revs">${pr.map(t=>edita.includes(t.area)?ltPorRevisarFila(t,"ltCargarIng"):"").join("")}</div>`:""}
    ${ls.length?`<div class="contenedor-ancho tabla-scroll"><table class="tabla lt-tabla"><thead><tr><th class="izq">Lote</th><th>Área</th><th>Prendas</th><th>Avance</th><th>Horas</th>
      <th>Ahora</th><th>Min/prenda real</th><th>Estándar</th><th>Eficiencia</th><th>Por revisar</th><th></th></tr></thead><tbody>${ls.map(fila).join("")}</tbody></table></div>`
      :`<div class="vacio-msg">Sin lotes ese día.${edita.length?" Crea el primero con + Nuevo lote.":""}</div>`}
    <div class="lt-explica">Los minutos en lotes <b>todavía no cambian</b> la boleta, la eficiencia ni los incentivos: se ven aquí aparte.
      Min/prenda real cuenta solo los tramos con cantidad. La eficiencia sale cuando la tarea tiene estándar medido en Tiempos.</div>`;
}
async function ltNuevoIng(){
  const r=LT.panel; const areas=((r&&r.areas)||[]).filter(a=>a.edita).map(a=>a.area); if(!areas.length) return;
  abrirModal(`<h2>Nuevo lote</h2><div class="sub" style="margin-bottom:10px">Lo ve al instante quien esté hoy en esa área.</div>${ltFormHTML(areas)}
    <div class="modal-acciones"><button class="btn-principal btn-modal-guardar lt-crear" onclick="ltCrear(()=>{cerrarModal();ltCargarIng();})">CREAR LOTE</button>
    <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
  await ltFormIniciar(); $("ltFDest").focus();
}
async function ltVer(id){
  const s=ltSes();
  abrirModal(`<div id="ltDet">${cargandoHTML("Cargando lote…")}</div>`);
  try{
    const r=await rpc("fn_lote_detalle",{p_dni:s.dni,p_token:s.token,p_lote:id});
    const d=$("ltDet"); if(!d) return;
    if(!r.ok){ d.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    const l=r.lote, ts=r.tramos||[], rl=ltReal(l);
    d.innerHTML=`<h2>${esc(l.destino)} · L-${l.id}</h2>
      <div class="sub" style="margin-bottom:10px">${esc(l.area)} · ${esc(l.tarea)}${l.o_f?` · OF ${esc(l.o_f)}`:""} · ${ltN(l.hecho)} de ${ltN(l.cantidad)} prendas · ${ltHoras(l.min)}${rl?` · ${rl.toFixed(2)} min/prenda`:""}</div>
      <div class="tabla-scroll" style="max-height:52vh"><table class="tabla"><thead><tr><th class="izq">Persona</th><th>Día</th><th>Desde</th><th>Hasta</th><th>Min</th><th>Prendas</th></tr></thead>
      <tbody>${ts.map(t=>`<tr><td class="izq">${esc(soloApellidos(t.nombre||t.dni))}</td><td>${new Date(t.inicio).toLocaleDateString("es-PE",{timeZone:"America/Lima",day:"2-digit",month:"2-digit"})}</td>
        <td>${ltHM(t.inicio)}</td><td>${t.fin?ltHM(t.fin):`<span class="lt-vivo">ahora</span>`}${t.auto?` <span class="tag o">solo</span>`:""}</td><td>${Math.round(t.min)}</td>
        <td>${t.prendas==null?(t.fin?`<span class="tag r">por revisar</span>`:"—"):ltN(t.prendas)}</td></tr>`).join("")||`<tr><td colspan="6" class="sub">Nadie trabajó aún en este lote</td></tr>`}</tbody></table></div>
      <div class="modal-acciones">${r.edita?(l.estado==="ABIERTO"
          ?`<button class="btn-principal btn-modal-guardar" style="background:var(--alerta)" onclick="ltCerrar(${l.id},true,()=>{cerrarModal();ltRecargar();})">CERRAR LOTE</button>`
          :`<button class="btn-principal btn-modal-guardar" onclick="ltCerrar(${l.id},false,()=>{cerrarModal();ltRecargar();})">REABRIR LOTE</button>`):""}
        <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CERRAR</button></div>`;
  }catch(e){ const d=$("ltDet"); if(d) d.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function ltRecargar(){ if($("ltIngZona")) ltCargarIng(); else if($("ltSupZona")) ltCargarSup(); }
function ltDescargar(){
  const r=LT.panel; if(!r||!(r.lotes||[]).length){ mostrarError("No hay datos para descargar"); return; }
  const CAB=["Lote","Área","Destino","Tarea","OF","Estado","Cantidad","Hechas","Horas","Personas","Min/prenda real","Estándar","Por revisar"];
  const filas=r.lotes.map(l=>[`L-${l.id}`,l.area,l.destino,l.tarea,l.o_f||"",l.estado,l.cantidad,l.hecho,Math.round(l.min/6)/10,l.personas,
    ltReal(l)?Number(ltReal(l).toFixed(2)):"",l.std||"",l.por_revisar]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CAB,...filas]), "LOTES");
  XLSX.writeFile(wb, `TRABAJO_POR_TIEMPO_${r.fecha||""}.xlsx`);
}

/* ---------------- SUPERVISORA (celular) ---------------- */
async function ltCargarSup(){
  const z=$("ltSupZona"); if(!z) return;
  const s=sesionActual(); if(!s) return;
  pintarCargando(z,"Cargando lotes…");
  try{
    const r=await rpc("fn_lotes_panel",{p_dni:s.dni,p_token:s.token,p_area:"",p_fecha:null});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    LT.panel=r; ltPintarSup();
  }catch(e){ z.innerHTML = ltFalta(e) ? LT_FALTA_HTML : `<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function ltPintarSup(){
  const z=$("ltSupZona"), r=LT.panel; if(!z||!r) return;
  const areas=(r.areas||[]).filter(a=>a.edita).map(a=>a.area);
  const ls=(r.lotes||[]).filter(l=>l.estado==="ABIERTO"), pr=r.por_revisar||[];
  z.innerHTML=`<div class="cel-res">${(r.areas||[]).map(a=>`<div><b>${a.ahora}</b>trabajando en ${esc(a.area)}</div>`).join("")}</div>
    ${areas.length?`<button type="button" class="lt-go azul" id="ltNuevoSup" onclick="ltNuevoSup()">+ NUEVO LOTE</button><div id="ltFormSup"></div>`:""}
    ${pr.length?`<h2 class="lt-h2">Por revisar</h2><div class="lt-revs">${pr.map(t=>ltPorRevisarFila(t,"ltCargarSup")).join("")}</div>`:""}
    <h2 class="lt-h2">Lotes abiertos</h2>
    ${ls.length?ls.map(l=>`<div class="cel-card ${l.ahora?"v":"g"}"><div class="cel-top"><b>${esc(l.destino)}</b><span class="tag ${l.ahora?"v":"g"}">${l.ahora} ahora</span></div>
        <div class="cel-l">${esc(l.area)} · ${esc(l.tarea)} · L-${l.id}${l.o_f?` · OF ${esc(l.o_f)}`:""}</div>
        <div class="lt-av"><div class="lt-bar"><i style="width:${ltPct(l)}%;background:var(--azul)"></i></div>
        <div class="m"><span><b>${ltN(l.hecho)}</b> de ${ltN(l.cantidad)} prendas</span><span>${ltHoras(l.min)}</span></div></div>
        <div class="cel-btns"><button type="button" class="az" onclick="ltVer(${l.id})">Ver quién</button>
        <button type="button" class="no" onclick="ltCerrar(${l.id},true,ltCargarSup)">Cerrar lote</button></div></div>`).join("")
      :`<div class="vacio-msg">No hay lotes abiertos. Crea uno para que tu gente pueda registrar.</div>`}`;
}
async function ltNuevoSup(){
  const r=LT.panel, areas=((r&&r.areas)||[]).filter(a=>a.edita).map(a=>a.area);
  const z=$("ltFormSup"); if(!z) return;
  if(z.innerHTML){ z.innerHTML=""; return; }
  z.innerHTML=ltFormHTML(areas)+`<button type="button" class="lt-go azul lt-crear" onclick="ltCrear(()=>{ $('ltFormSup').innerHTML=''; ltCargarSup(); })">CREAR LOTE</button>
    <button type="button" class="lt-sec" onclick="$('ltFormSup').innerHTML=''">Cancelar</button>`;
  await ltFormIniciar(); $("ltFDest").focus();
}
