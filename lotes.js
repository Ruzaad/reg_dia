/* ================= TRABAJO POR TIEMPO (parche 116) =================
   Lotes de DESPACHO y CORTE, que no tienen OF ni BASE.
   Operario: EMPEZAR y TERMINAR (la hora la pone el servidor) y al terminar
   cuántas prendas hizo. Supervisora e Ingeniería: crear y cerrar lotes,
   ver las horas y poner la cantidad de lo que quedó por revisar.
   Parche 119: Ingeniería sube el tiempo (min/prenda) de cada tarea. Con
   tiempo, cada tramo con prendas genera minutaje (prendas × tiempo) que entra
   a la boleta, la eficiencia y los incentivos como un ticket. La cantidad del
   lote es el tope, igual que el corte real en ACABADO.
   Parche 126: REPROCESO ya no trabaja por tiempo. Se trabaja como ACABADO: su
   BASE se sube en Bases y el lote es una OF provisional con su cantidad tope
   (ltRepAbrir, al final).
   Parche 129: la vista de Ingeniería y de supervisión es solo de REPROCESO (abrir,
   cerrar, avance). DESPACHO y CORTE no se toman por ahora: no tienen vista ni
   tarjeta de área (AREAS_LOTE vacío); el código de tramos queda sin uso. */

const LT_AREAS=["DESPACHO","CORTE"];
const ltSinRep = r => { if(r){ if(r.areas) r.areas=r.areas.filter(a=>a.area!=="REPROCESO"); if(r.lotes) r.lotes=r.lotes.filter(l=>l.area!=="REPROCESO");
  if(r.por_revisar) r.por_revisar=r.por_revisar.filter(t=>t.area!=="REPROCESO"); if(r.tareas) r.tareas=r.tareas.filter(t=>t.area!=="REPROCESO"); } return r; };
const LT={mios:null, sel:null, tic:null, fin:null, tareas:null, panel:null, sesion:null};
const ltN = n => Number(n||0).toLocaleString("es-PE");
const ltH = m => { m=Math.max(0,Math.round(Number(m)||0)); return `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}`; };
const ltHoras = m => (Math.round((Number(m)||0)/6)/10).toLocaleString("es-PE",{minimumFractionDigits:1})+" h";
/* Horas siempre en hora de Lima: el servidor lee "Terminó a las" en esa hora. */
const ltHM = t => t ? new Date(t).toLocaleTimeString("es-PE",{timeZone:"America/Lima",hour:"2-digit",minute:"2-digit",hour12:false}) : "—";
const ltFalta = e => /Could not find the function|PGRST202/i.test(String(e&&e.message||e||""));
const LT_FALTA_HTML = `<div class="acf-falta"><b>Falta correr el parche 116 en la base.</b> Con él, DESPACHO y CORTE registran su trabajo en lotes: empezar, terminar y cuántas prendas.</div>`;
const ltSes = () => LT.sesion || ((typeof ING!=="undefined" && ING && ING.dni) ? ING : sesionActual());
/* min/prenda real: solo con tramos que tienen cantidad. */
const ltReal = l => (l.hecho>0 && l.min_contado>0) ? l.min_contado/l.hecho : null;
const ltPct = l => Math.min(100, Math.round((l.hecho||0)/(l.cantidad||1)*100));
const ltMj = v => Math.round(Number(v)||0).toLocaleString("es-PE");

/* ---------------- OPERARIO ---------------- */
/* CORTE entra directo aquí; quien está EN DESPACHO/CORTE
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
  const mj=(LT.mios&&LT.mios.hoy||[]).reduce((a,t)=>a+Number(t.minutaje||0),0);
  const w=v=>Math.min(100,v/5.75).toFixed(1)+"%";
  return `<div class="lt-dia"><div class="t">Mi día en lotes <b>${Math.round(m)} de 575 min</b></div>
    <div class="lt-bar"><i style="width:${w(m-run)}"></i>${run?`<i class="run" style="width:${w(run)}"></i>`:""}</div>
    ${mj?`<div class="lt-mj">Minutaje ganado hoy <b>${ltMj(mj)} min</b></div>`:""}
    <div class="s">${LT.mios&&LT.mios.actual?"El lote en curso cuenta cuando lo terminas con tus prendas.":m?"Toca un lote para seguir.":"Aún no empiezas ningún lote."}</div></div>`;
}
function ltPintarOp(){
  const z=$("ltZona"), r=LT.mios; if(!z||!r) return;
  clearInterval(LT.tic); LT.tic=null;
  if(!r.area && !r.actual){ z.innerHTML=`<div class="vacio-msg">Hoy no estás en DESPACHO ni CORTE. Si vas a trabajar ahí, pide a tu supervisora que te marque en asistencia.</div>
      <button type="button" class="btn-secundario btn-boleta" onclick="irA(VOLVER_INICIO_OF())">VOLVER</button>`; return; }
  const cab=`<div class="lt-cab"><span class="lt-en">● HOY ESTÁS EN ${esc(r.area||r.actual.lote.area)}</span></div>`;
  const hoy=(r.hoy||[]).filter(t=>t.fin);
  const tramos = hoy.length ? `<h2 class="lt-h2">Hoy</h2>`+hoy.slice().reverse().map(t=>`<div class="lt-tr${t.prendas==null?" inc":""}"><span class="h">${ltHM(t.inicio)}<br>${ltHM(t.fin)}</span>
      <span class="q">${esc(t.destino)}</span><span class="min">${Math.round(t.min)}<small>min</small></span>
      <span class="d">${esc(t.tarea)} · ${t.prendas==null?"cantidad por poner":ltN(t.prendas)+" prendas"}${t.minutaje!=null?` · <b class="lt-mjt">+${ltMj(t.minutaje)} min de minutaje</b>`:""}</span></div>`).join("") : "";
  if(r.actual){
    const a=r.actual, l=a.lote;
    z.innerHTML=`${cab}${ltDia()}
      <div class="lt-run" aria-live="off"><div class="lbl">Trabajando</div><div class="reloj" id="ltReloj">${ltH((Date.now()-new Date(a.inicio))/60000)}</div>
        <div class="desde">desde las ${ltHM(a.inicio)}</div>
        <div class="lote">${esc(l.destino)}<small>${esc(l.tarea)}${l.o_f?` · OF ${esc(l.o_f)}`:""}</small></div>
        <div class="lt-av"><div class="lt-bar"><i style="width:${ltPct(l)}%;background:var(--azul)"></i></div>
          <div class="m"><span>Lote: <b>${ltN(l.hecho)}</b> de <b>${ltN(l.cantidad)}</b></span><span>${l.ahora>1?`con ${l.ahora-1} más`:"solo tú ahora"}</span></div>
          ${l.std?`<div class="m"><span>Cada prenda te da <b>${Number(l.std).toLocaleString("es-PE",{maximumFractionDigits:3})} min</b> de minutaje</span></div>`:""}</div></div>
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
  const q=$("ltFinQueda"); if(q) q.textContent = a.lote.queda!=null ? `En el lote quedan ${ltN(a.lote.queda)} de ${ltN(a.lote.cantidad)} prendas`+(a.lote.std?` · cada una da ${Number(a.lote.std).toLocaleString("es-PE",{maximumFractionDigits:3})} min`:"") : "";
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
      mostrarOk(p==null?"Listo: tu supervisora pondrá la cantidad":`Guardado: ${ltN(p)} prendas en ${Math.round(r.min||0)} min`+(r.minutaje!=null?` · ${ltMj(r.minutaje)} min de minutaje`:""));
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
    <label class="lt-f"><span>Lote, artículo o cliente</span><input class="inp" id="ltFDest" maxlength="60" autocomplete="off" placeholder="Ej: 9CY740"></label>
    <div class="lt-f"><span id="ltTarL">Operaciones <small class="lt-fn">toca todas las que lleva, en orden</small></span>
      <div class="lt-seg lt-multi" role="group" aria-labelledby="ltTarL" id="ltFTar"></div>
      <textarea class="inp" id="ltFOtra" rows="3" maxlength="400" placeholder="Operaciones nuevas, una por línea" hidden style="margin-top:8px"></textarea>
      <div class="lt-fsel" id="ltFSel" aria-live="polite"></div></div>
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
    LT.ops=[];
    g.innerHTML=ts.filter(t=>t.area===a).map(t=>`<button type="button" aria-pressed="false" data-v="${esc(t.nombre)}">${esc(t.nombre)}</button>`).join("")
      +`<button type="button" aria-pressed="false" data-v="">+ otras</button>`;
    $("ltFOtra").hidden=true; ltFSel(); };
  seg("ltFArea", pintarTar);
  /* Operaciones: varias a la vez (parche 122). El orden en que se tocan es el
     orden de los lotes (L-1, L-2…), como el desglose de la hoja. */
  const gt=$("ltFTar");
  if(gt) gt.onclick=e=>{ const b=e.target.closest("button"); if(!b) return;
    const on=b.getAttribute("aria-pressed")!=="true"; b.setAttribute("aria-pressed", on);
    if(b.dataset.v===""){ const o=$("ltFOtra"); o.hidden=!on; if(on) o.focus(); }
    else { LT.ops=(LT.ops||[]).filter(x=>x!==b.dataset.v); if(on) LT.ops.push(b.dataset.v); }
    ltFSel(); };
  const ot=$("ltFOtra"); if(ot) ot.oninput=ltFSel;
  const a=$("ltFArea").querySelector("[aria-checked=true]"); pintarTar(a?a.dataset.v:"");
}
/* Operaciones elegidas, en orden: las tocadas y luego las nuevas escritas. */
function ltFOps(){
  const o=$("ltFOtra"), nuevas = (o && !o.hidden) ? o.value.split(/\r?\n|;/).map(x=>x.trim().toUpperCase().replace(/\s+/g," ")).filter(Boolean) : [];
  return [...new Set([...(LT.ops||[]), ...nuevas])];
}
function ltFSel(){
  const z=$("ltFSel"); if(!z) return; const ops=ltFOps();
  z.innerHTML = ops.length ? `<b>${ops.length} ${ops.length===1?"operación":"operaciones"}:</b> ${ops.map((x,i)=>`${i+1}. ${esc(x)}`).join(" · ")}` : "";
  const b=document.querySelector(".lt-crear"); if(b) b.textContent = ops.length>1 ? `CREAR ${ops.length} LOTES` : "CREAR LOTE";
}
async function ltCrear(alTerminar){
  const s=ltSes(), msg=$("ltFMsg");
  const sel=id=>{ const b=$(id)&&$(id).querySelector("[aria-checked=true]"); return b?b.dataset.v:null; };
  const area=sel("ltFArea"), ops=ltFOps();
  const dest=$("ltFDest").value.trim(), cant=parseInt($("ltFCant").value,10), of=$("ltFOf").value.trim();
  if(!dest){ msg.textContent="Escribe el lote, artículo o cliente"; $("ltFDest").focus(); return; }
  if(!ops.length){ msg.textContent="Elige al menos una operación"; return; }
  if(ops.some(x=>x.length>40)){ msg.textContent="Cada operación puede tener hasta 40 letras"; return; }
  if(!(cant>0)){ msg.textContent="Pon la cantidad de prendas"; $("ltFCant").focus(); return; }
  msg.textContent="";
  await unaVez("ltCrear", botonesDe(".lt-crear"), async()=>{
    const hechos=[];
    try{
      // Una por una y en orden, para que los números de lote sigan el orden de la hoja.
      for(const tarea of ops){
        const r=await rpc("fn_lote_crear",{p_dni:s.dni,p_token:s.token,p_area:area,p_destino:dest,p_tarea:tarea,p_cantidad:cant,p_of:of});
        if(!r.ok){ msg.textContent=`${hechos.length?`Se crearon ${hechos.length}; `:""}no se pudo crear ${tarea}: ${r.error||"error"}`; break; }
        hechos.push(r.id);
      }
    }catch(e){ msg.textContent=`${hechos.length?`Se crearon ${hechos.length}; `:""}${e.message}`; }
    if(!hechos.length) return;
    LT.tareas=null;
    mostrarOk(hechos.length===1?`Lote L-${hechos[0]} creado`:`${hechos.length} lotes creados: L-${hechos[0]} a L-${hechos[hechos.length-1]}`);
    if(hechos.length===ops.length) alTerminar&&alTerminar();
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
      mostrarOk(r.minutaje!=null?`Guardado · ${ltMj(r.minutaje)} min de minutaje`:"Guardado"); alTerminar&&alTerminar();
    }catch(e){ mostrarError(e.message); }
  });
}
const ltPorRevisarFila = (t, cb) => `<div class="lt-rev"><div class="lt-rev-t"><b>${esc(soloApellidos(t.nombre||t.dni))}</b>
    <span>${esc(t.destino)} · ${esc(t.tarea)}${t.queda!=null?` · quedan ${ltN(t.queda)} en el lote`:""}</span><small>${new Date(t.inicio).toLocaleDateString("es-PE",{timeZone:"America/Lima",weekday:"short",day:"2-digit",month:"2-digit"})} · ${ltHM(t.inicio)} a ${ltHM(t.fin)} · ${Math.round(t.min)} min${t.auto?" · se cerró solo":""}</small></div>
    <div class="lt-rev-f"><label>Prendas<input id="ltRv${t.id}" type="number" inputmode="numeric" min="0"></label>
    ${t.auto?`<label>Terminó a las<input id="ltRvF${t.id}" type="time" value="${ltHM(t.fin)}"></label>`:""}
    <button type="button" class="btn-mini" id="ltRvB${t.id}" onclick="ltRevisar(${t.id},${cb})">Guardar</button></div></div>`;

/* ---------------- REPROCESO: lotes (Ingeniería y supervisión, parche 129) ----------------
   Los lotes de REPROCESO son OF provisionales (parche 126). Aquí se ve el avance de
   cada operación, se abren o cierran (un lote cerrado deja de salirle al operario) y
   se crean o se corrige su tope. DESPACHO y CORTE ya no se toman: no hay vista. */
LT.lotes=null; LT.filtro="ABIERTO";
const LT_FALTA_129 = `<div class="acf-falta"><b>Falta correr el parche 129 en la base.</b> Con él se abren y cierran los lotes de REPROCESO y se ve su avance.</div>`;
const ltCargarIng = () => ltRepLotes("ltIngZona");
const ltCargarSup = () => ltRepLotes("ltSupZona");
function ltRecargar(){ if($("ltIngZona")) ltCargarIng(); else if($("ltSupZona")) ltCargarSup(); }
async function ltRepLotes(zona){
  const z=$(zona); if(!z) return;
  const s=ltSes(); if(!s) return;
  pintarCargando(z,"Cargando lotes…");
  try{
    const r=await rpc("fn_reproceso_lotes",{p_dni:s.dni,p_token:s.token});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    LT.lotes=r; ltRepPintar(zona);
  }catch(e){ z.innerHTML = ltFalta(e) ? LT_FALTA_129 : `<div class="vacio-msg">${esc(e.message)}</div>`; }
}
const ltRepPct = l => { const n=(l.ops||[]).length, c=Number(l.cant_prog)||0; if(!n||!c) return 0;
  return Math.round((l.ops||[]).reduce((s,o)=>s+Math.min(Number(o.hecho)||0,c),0)/(c*n)*100); };
/* Ingeniería: tarjetas con KPIs, chips de operaciones y edición del lote (parche 141). */
function ltIngPintar(z, r){
  const todos=r.lotes||[], ab=todos.filter(l=>!l.cerrado), ce=todos.filter(l=>l.cerrado);
  const ls=LT.filtro==="CERRADO"?ce:ab;
  const nb=$("ltRepBtn"); if(nb) nb.hidden=!r.edita;
  const kpi=(t,v)=>`<div class="kpi"><div class="kpi-num">${v}</div><div class="kpi-lbl">${t}</div></div>`;
  const avance=ab.length?Math.round(ab.reduce((s,l)=>s+ltRepPct(l),0)/ab.length):0;
  const card=l=>{ const pct=ltRepPct(l), c=Number(l.cant_prog)||0;
    return `<div class="lr-card${l.cerrado?" cerrado":""}">
      <div class="lr-top"><div><b>${esc(l.of)}</b><small>${esc(l.articulo)} · ${ltN(c)} prendas</small></div>
        <span class="tag ${l.cerrado?"g":"v"}">${l.cerrado?"Cerrado":"Abierto"}</span></div>
      <div class="lr-chips">${(l.ops||[]).map(o=>{ const h=Number(o.hecho)||0;
        return `<span class="lr-chip${c&&h>=c?" ok":""}" title="${esc(o.operacion)}: ${ltN(h)} de ${ltN(c)}">${esc(o.n_op)}</span>`; }).join("")}</div>
      <div class="lt-prog${pct>=100?" ok":""}"><span class="b"><i style="width:${pct}%"></i></span><span>${pct}%</span></div>
      <div class="lr-pie"><span>${l.personas} ${l.personas===1?"persona":"personas"}</span><span>${ltMj(l.minutos)} min</span>
        <span>${ltN(l.reclasificado)} reclasificadas</span></div>
      ${r.edita?`<div class="lr-btns"><button type="button" class="btn-mini azul" onclick="ltEditarLote('${esc(l.of)}')">Editar</button>
        <button type="button" class="btn-mini ${l.cerrado?"verde":"rojo"}" onclick="ltRepEstado('${esc(l.of)}',${!l.cerrado})">${l.cerrado?"Reabrir":"Cerrar lote"}</button>
        <button type="button" class="btn-mini gris" onclick="ltEliminarLote('${esc(l.of)}')">Eliminar</button></div>`:""}</div>`; };
  z.innerHTML=`<div class="kpis lr-kpis">${kpi("Lotes abiertos",ab.length)}${kpi("Prendas en proceso",ltN(ab.reduce((s,l)=>s+(Number(l.cant_prog)||0),0)))}
      ${kpi("Minutos registrados",ltMj(ab.reduce((s,l)=>s+(Number(l.minutos)||0),0)))}${kpi("Avance medio",avance+" %")}</div>
    <div class="lt-seg lr-filtro" role="radiogroup" aria-label="Estado del lote">
      <button type="button" role="radio" aria-checked="${LT.filtro!=="CERRADO"}" onclick="ltRepFiltro('ABIERTO')">Abiertos <small>${ab.length}</small></button>
      <button type="button" role="radio" aria-checked="${LT.filtro==="CERRADO"}" onclick="ltRepFiltro('CERRADO')">Cerrados <small>${ce.length}</small></button></div>
    ${ls.length?`<div class="lr-grid">${ls.map(card).join("")}</div>`
      :`<div class="vacio-msg">${LT.filtro==="CERRADO"?"No hay lotes cerrados.":"No hay lotes abiertos."}${r.edita&&LT.filtro!=="CERRADO"?" Crea el primero con + Crear lote.":""}</div>`}`;
}
function ltRepPintar(zona){
  const z=$(zona), r=LT.lotes; if(!z||!r) return;
  if(zona==="ltIngZona") return ltIngPintar(z, r);
  const todos=r.lotes||[], ab=todos.filter(l=>!l.cerrado), ce=todos.filter(l=>l.cerrado);
  const ls=LT.filtro==="CERRADO"?ce:ab;
  const nb=$("ltRepBtn"); if(nb) nb.hidden=!r.edita;
  const card=l=>{ const pct=ltRepPct(l), c=Number(l.cant_prog)||0;
    return `<div class="lr-card${l.cerrado?" cerrado":""}">
      <div class="lr-top"><div><b>${esc(l.of)}</b><small>${esc(l.articulo)} · tope ${ltN(c)} prendas</small></div>
        <span class="tag ${l.cerrado?"g":"v"}">${l.cerrado?"Cerrado":"Abierto"}</span></div>
      <div class="lt-prog${pct>=100?" ok":""}"><span class="b"><i style="width:${pct}%"></i></span><span>${pct}%</span></div>
      <div class="lr-ops">${(l.ops||[]).map(o=>{ const h=Number(o.hecho)||0, p=c?Math.min(100,Math.round(h/c*100)):0;
        return `<div class="lr-op"><span class="n">${esc(o.n_op)}. ${esc(o.operacion)}</span><span class="b"><i style="width:${p}%"></i></span><span class="v">${ltN(h)}</span></div>`; }).join("")}</div>
      <div class="lr-pie"><span>${l.personas} ${l.personas===1?"persona":"personas"}</span><span>${ltMj(l.minutos)} min</span>
        <span>${ltN(l.reclasificado)} reclasificadas</span></div>
      ${r.edita?`<div class="lr-btns"><button type="button" class="btn-mini ${l.cerrado?"verde":"rojo"}" onclick="ltRepEstado('${esc(l.of)}',${!l.cerrado})">${l.cerrado?"Reabrir":"Cerrar lote"}</button>
        <button type="button" class="btn-mini gris" onclick="ltRepTope('${esc(l.of)}','${esc(l.articulo)}',${c})">Cambiar tope</button></div>`:""}</div>`; };
  z.innerHTML=`${zona==="ltSupZona"&&r.edita?`<button type="button" class="lt-go azul" onclick="ltRepAbrir()">+ CREAR LOTE</button>`:""}
    <div class="lt-seg lr-filtro" role="radiogroup" aria-label="Estado del lote">
      <button type="button" role="radio" aria-checked="${LT.filtro!=="CERRADO"}" onclick="ltRepFiltro('ABIERTO')">Abiertos <small>${ab.length}</small></button>
      <button type="button" role="radio" aria-checked="${LT.filtro==="CERRADO"}" onclick="ltRepFiltro('CERRADO')">Cerrados <small>${ce.length}</small></button></div>
    ${ls.length?`<div class="lr-grid">${ls.map(card).join("")}</div>`
      :`<div class="vacio-msg">${LT.filtro==="CERRADO"?"No hay lotes cerrados.":"No hay lotes abiertos."}${r.edita&&LT.filtro!=="CERRADO"?" Crea el primero con + Crear lote.":""}</div>`}`;
}
function ltRepFiltro(f){ LT.filtro=f; const z=$("ltIngZona")?"ltIngZona":"ltSupZona"; ltRepPintar(z); }
async function ltRepEstado(of, cerrar){
  const s=ltSes();
  await unaVez("ltRepEst"+of, [], async()=>{
    try{
      const r=await rpc("fn_reproceso_lote_estado",{p_dni:s.dni,p_token:s.token,p_of:of,p_cerrar:cerrar});
      if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
      mostrarOk(cerrar?`Lote ${of} cerrado: ya no le sale al personal`:`Lote ${of} abierto otra vez`); ltRecargar();
    }catch(e){ mostrarError(ltFalta(e)?"Falta correr el parche 129 en la base":e.message); }
  });
}
async function ltRepTope(of, art, cant){ await ltRepAbrir(); ltRepEditar(of, art, cant); }

/* Editar lote (parche 141): nombre y cantidad. Si la cantidad baja de lo ya notificado, el exceso se
   resta de los registros repartido por persona y día; antes de guardar se muestra cuánto sería. */
let LT_ED=null, LT_EDT=null;
function ltEditarLote(of){
  const l=((LT.lotes&&LT.lotes.lotes)||[]).find(x=>x.of===of); if(!l) return;
  LT_ED={of, cant:Number(l.cant_prog)||0};
  abrirModal(`<h2>Editar lote</h2>
    <div class="sub" style="margin-bottom:10px">${esc(l.articulo)} · cambia el nombre o la cantidad de prendas del lote.</div>
    <div class="lt-form">
      <label class="lt-f"><span>Nombre del lote</span><input class="inp" id="ltEdNom" maxlength="20" autocomplete="off" value="${esc(l.of)}"></label>
      <label class="lt-f"><span>Cantidad de prendas (tope de cada operación)</span><input class="inp" id="ltEdCant" type="number" inputmode="numeric" min="1" value="${LT_ED.cant}"></label>
      <div class="lr-efecto" id="ltEdEfecto" aria-live="polite"></div>
      <div class="modal-msg" id="ltEdMsg" role="alert"></div></div>
    <div class="modal-acciones"><button class="btn-principal btn-modal-guardar" id="ltEdOk" onclick="ltEdGuardar()">GUARDAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
  $("ltEdCant").oninput=()=>{ clearTimeout(LT_EDT); LT_EDT=setTimeout(ltEdEfecto,350); };
  $("ltEdCant").focus();
}
function ltEliminarLote(of){
  abrirModal(`<h2>Eliminar lote</h2>
    <div class="sub" style="margin-bottom:10px">¿Eliminar el lote <b>${esc(of)}</b>? Solo se puede si todavía no tiene registros. Si ya se trabajó en él, ciérralo.</div>
    <div class="modal-msg" id="ltElMsg" role="alert"></div>
    <div class="modal-acciones"><button class="btn-principal btn-modal-guardar" id="ltElOk" style="background:var(--alerta)" onclick="ltElConfirmar('${esc(of)}')">ELIMINAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
}
async function ltElConfirmar(of){
  const s=ltSes(), msg=$("ltElMsg");
  await unaVez("ltElLote"+of, botonesDe("#ltElOk"), async()=>{
    try{
      const r=await rpc("fn_reproceso_lote_eliminar",{p_dni:s.dni,p_token:s.token,p_of:of});
      if(!r.ok){ msg.textContent=r.error||"No se pudo eliminar"; return; }
      mostrarOk(`Lote ${r.of} eliminado`); cerrarModal(); LT.rep=null; ltRecargar();
    }catch(e){ msg.textContent=ltFalta(e)?"Falta correr el parche 142 en la base":e.message; }
  });
}
async function ltEdEfecto(){
  const e=$("ltEdEfecto"), c=parseInt($("ltEdCant")&&$("ltEdCant").value,10); if(!e) return;
  if(!(c>0)){ e.innerHTML=""; return; }
  const s=ltSes();
  try{
    const r=await rpc("fn_reproceso_lote_editar",{p_dni:s.dni,p_token:s.token,p_of:LT_ED.of,p_nombre:$("ltEdNom").value,p_cantidad:c,p_simular:true});
    if(!e.isConnected) return;
    if(!r.ok){ e.innerHTML=""; $("ltEdMsg").textContent=r.error||""; return; }
    $("ltEdMsg").textContent="";
    if(!(r.descuento_total>0)){ e.innerHTML=`<div class="lr-ef ok">No se quita nada de lo ya registrado.</div>`; return; }
    e.innerHTML=`<div class="lr-ef">Se descontarán <b>${ltN(r.descuento_total)}</b> prendas de lo ya registrado, repartidas por día para no pegarle a un solo día:
      ${(r.personas||[]).map(p=>`<div class="lr-ef-p"><b>${esc(p.nombre)}</b> −${ltN(p.quita)} <small>${(p.dias||[]).map(d=>`${esc(String(d.fecha).slice(5))}: ${ltN(d.antes)}→${ltN(d.antes-d.quita)}`).join(" · ")}</small></div>`).join("")}</div>`;
  }catch(x){ e.innerHTML=ltFalta(x)?`<div class="lr-ef">Falta correr el parche 141 en la base.</div>`:""; }
}
async function ltEdGuardar(){
  const s=ltSes(), msg=$("ltEdMsg"), nom=$("ltEdNom").value.trim(), cant=parseInt($("ltEdCant").value,10);
  if(!nom){ msg.textContent="Escribe el nombre del lote"; $("ltEdNom").focus(); return; }
  if(!(cant>0)){ msg.textContent="Pon la cantidad de prendas"; $("ltEdCant").focus(); return; }
  msg.textContent="";
  await unaVez("ltEdGuardar", botonesDe("#ltEdOk"), async()=>{
    try{
      const r=await rpc("fn_reproceso_lote_editar",{p_dni:s.dni,p_token:s.token,p_of:LT_ED.of,p_nombre:nom,p_cantidad:cant});
      if(!r.ok){ msg.textContent=r.error||"No se pudo guardar"; return; }
      mostrarOk(r.descuento_total>0?`Lote ${r.of} guardado: se descontaron ${ltN(r.descuento_total)} prendas`:`Lote ${r.of} guardado`);
      cerrarModal(); LT.rep=null; ltRecargar();
    }catch(e){ msg.textContent=ltFalta(e)?"Falta correr el parche 141 en la base":e.message; }
  });
}

/* ---------------- TIEMPOS POR TAREA (parche 119, Ingeniería) ----------------
   Ingeniería sube el tiempo (min por prenda) de cada tarea. Con él, lo que la
   gente termina con prendas genera minutaje. Se puede pegar desde Excel.
   "Real 30 días" es la referencia: minutos trabajados ÷ prendas. */
const LTT={r:null, cambios:{}, nuevas:[]};
function ltQuincena(){ const h=hoyLimaApp(); return h.slice(0,8)+(Number(h.slice(8,10))>=16?"16":"01"); }
const ltNum = v => { const n=parseFloat(String(v==null?"":v).replace(",", ".")); return isFinite(n)?n:null; };
const ltFmtStd = v => v==null||v==="" ? "" : String(Math.round(Number(v)*10000)/10000);
async function ltTiempos(){
  const z=$("ltIngZona"); if(!z) return;
  ["ltNuevoBtn","ltTiemposBtn","ltRepBtn"].forEach(id=>{ const b=$(id); if(b) b.hidden=true; });
  const bc=$("ltBarra"); if(bc) bc.style.display="none";
  pintarCargando(z,"Cargando tiempos…");
  const s=ltSes();
  try{
    const r=await rpc("fn_lote_tiempos",{p_dni:s.dni,p_token:s.token});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    LTT.r=ltSinRep(r); LTT.cambios={}; LTT.nuevas=[]; ltPintarTiempos();
  }catch(e){
    z.innerHTML = ltFalta(e) ? `<div class="acf-falta"><b>Falta correr el parche 119 en la base.</b> Con él, Ingeniería sube el tiempo de cada tarea y lo que la gente hace en lotes genera minutaje, con la cantidad del lote como tope.</div>`
      : `<div class="vacio-msg">${esc(e.message)}</div>`;
  }
}
function ltSalirTiempos(){
  if(Object.keys(LTT.cambios).length+LTT.nuevas.length && !confirm("Hay tiempos sin guardar. ¿Salir igual?")) return;
  ltCargarIng();
}
function ltPintarTiempos(){
  const z=$("ltIngZona"), r=LTT.r; if(!z||!r) return;
  const ts=r.tareas||[], areas=r.areas||[];
  const edita=a=>(areas.find(x=>x.area===a)||{}).edita;
  const act=ts.filter(t=>t.activo), sin=act.filter(t=>t.std==null);
  const sinMj=ts.reduce((s,t)=>s+Number(t.sin_minutaje||0),0);
  const conT=act.length-sin.length;
  const fila=t=>{
    const c=LTT.cambios[t.id]||{}, std=("std" in c)?c.std:ltFmtStd(t.std), activo=("activo" in c)?c.activo:t.activo;
    const real=t.real>0?Number(t.real):null, sv=ltNum(std);
    const dif = (real&&sv) ? Math.round((sv/real-1)*100) : null;
    const ed=edita(t.area);
    return `<tr class="${Object.keys(c).length?"ltt-cambio":""}${activo?"":" ltt-off"}">
      <th scope="row">${esc(t.nombre)}${t.actualizado?`<small>${esc(soloApellidos(t.por||""))} · ${new Date(t.actualizado).toLocaleDateString("es-PE",{timeZone:"America/Lima",day:"2-digit",month:"2-digit"})}</small>`:`<small>nunca se subió</small>`}</th>
      <td>${ed?`<input class="inp ltt-in${std===""&&activo?" vacio":""}" inputmode="decimal" aria-label="Tiempo de ${esc(t.nombre)} en minutos por prenda" value="${esc(std)}" placeholder="—"
          oninput="ltTCambio(${t.id},'std',this.value)">`:(std===""?`<span class="lt-sinstd">Sin tiempo</span>`:`<b class="lt-std">${esc(std)}</b>`)}</td>
      <td>${real?`<span class="lt-std">${real.toFixed(2)}</span>${dif!=null&&Math.abs(dif)>=20?`<small class="ltt-dif ${dif>0?"alto":"bajo"}">el tiempo está ${Math.abs(dif)}% ${dif>0?"arriba":"abajo"} de lo real</small>`:""}`:`<span class="sub">—</span>`}</td>
      <td class="nw">${t.prendas?ltN(t.prendas):`<span class="sub">0</span>`}</td>
      <td class="nw">${t.personas||`<span class="sub">0</span>`}</td>
      <td>${t.sin_minutaje?`<span class="acf-n alto" title="Tramos con prendas que no generaron minutaje">${t.sin_minutaje}</span>`:`<span class="acf-n ok">✓</span>`}</td>
      <td>${ed?`<label class="ltt-sw"><input type="checkbox" ${activo?"checked":""} onchange="ltTCambio(${t.id},'activo',this.checked)"> <span>${activo?"Activa":"Oculta"}</span></label>`:(activo?"Activa":"Oculta")}</td>
      <td><button type="button" class="btn-mini gris" onclick="ltTLog(${t.id},'${esc(t.nombre)}')">Historial</button></td></tr>`;
  };
  const nuevas=a=>LTT.nuevas.map((n,i)=>n.area!==a?"":`<tr class="ltt-cambio"><th scope="row"><input class="inp" maxlength="40" aria-label="Nombre de la tarea nueva" placeholder="Nombre de la tarea" value="${esc(n.nombre)}" oninput="LTT.nuevas[${i}].nombre=this.value"></th>
      <td><input class="inp ltt-in" inputmode="decimal" aria-label="Tiempo de la tarea nueva" placeholder="min/prenda" value="${esc(n.std)}" oninput="LTT.nuevas[${i}].std=this.value"></td>
      <td colspan="5" class="sub">Tarea nueva</td><td><button type="button" class="btn-mini gris" onclick="LTT.nuevas.splice(${i},1);ltPintarTiempos()">Quitar</button></td></tr>`).join("");
  const bloque=a=>{ const de=ts.filter(t=>t.area===a.area); const s0=de.filter(t=>t.activo&&t.std==null).length;
    return `<div class="ltt-area"><div class="ltt-cab"><h2>${esc(a.area)}</h2><span class="${s0?"acf-q mal":"acf-q ok"}">${s0?`${s0} sin tiempo`:"Todas con tiempo"}</span>
      ${a.edita?"":`<span class="sub">solo lectura</span>`}</div>
      <div class="contenedor-ancho tabla-scroll"><table class="tabla acf-tabla ltt-tabla">
      <thead><tr><th>Tarea</th><th>Tiempo<small>min por prenda</small></th><th>Real 30 días<small>min por prenda</small></th><th>Prendas<small>30 días</small></th><th>Personas</th><th>Sin minutaje</th><th>Estado</th><th></th></tr></thead>
      <tbody>${de.map(fila).join("")}${nuevas(a.area)}</tbody></table></div>
      ${a.edita?`<button type="button" class="btn-mini" onclick="LTT.nuevas.push({area:'${esc(a.area)}',nombre:'',std:''});ltPintarTiempos()">+ Tarea nueva en ${esc(a.area)}</button>`:""}</div>`; };
  const puede=areas.some(a=>a.edita), nCamb=Object.keys(LTT.cambios).length+LTT.nuevas.length;
  z.innerHTML=`<div class="ltt-top"><button type="button" class="btn-mini gris" onclick="ltSalirTiempos()">‹ Volver a los lotes</button><h2 class="lt-h2" style="margin:0">Tiempos por tarea</h2></div>
    <div class="acf-kpis">
      <div class="acf-k"><b class="${sin.length?"rojo":"verde"}">${sin.length}</b><span>tarea${sin.length===1?"":"s"} activa${sin.length===1?"":"s"} sin tiempo: lo que se hace en ellas no genera minutaje</span></div>
      <div class="acf-k"><b class="${sinMj?"rojo":"verde"}">${ltN(sinMj)}</b><span>tramos con prendas en 30 días que se quedaron sin minutaje</span></div>
      <div class="acf-k"><b class="verde">${conT}</b><span>tarea${conT===1?"":"s"} con tiempo, cada prenda suma minutaje como un ticket</span></div>
    </div>
    ${areas.map(bloque).join("")}
    ${puede?`<details class="ltt-pegar"><summary>Pegar desde Excel</summary>
      <p class="sub">Copia de Excel tres columnas: <b>ÁREA</b>, <b>TAREA</b> y <b>MIN POR PRENDA</b> (o solo TAREA y MIN si eliges el área). Las tareas que no existen se crean.</p>
      <div class="ltt-pegar-f"><label class="campo"><span>Área si pegas 2 columnas</span><select id="lttPegArea">${areas.filter(a=>a.edita).map(a=>`<option>${esc(a.area)}</option>`).join("")}</select></label>
      <textarea class="inp" id="lttPegar" rows="5" placeholder="CORTE&#9;TENDIDO&#9;0.35&#10;CORTE&#9;NUMERADO&#9;0.12"></textarea>
      <button type="button" class="btn-mini" onclick="ltTPegar()">Leer lo pegado</button></div></details>
    <div class="ltt-guardar">
      <label class="ltt-chk"><input type="checkbox" id="lttDesdeOn" checked> Dar minutaje también a lo ya registrado sin tiempo desde el
        <input type="date" id="lttDesde" value="${ltQuincena()}" min="${(()=>{const d=new Date(hoyLimaApp()+"T12:00:00");d.setDate(d.getDate()-31);return d.toLocaleDateString("sv-SE");})()}" max="${hoyLimaApp()}"></label>
      <button type="button" class="btn-principal" id="lttGuardar" onclick="ltTGuardar()" ${nCamb?"":"disabled"}>GUARDAR ${nCamb?nCamb+" CAMBIO"+(nCamb===1?"":"S"):"TIEMPOS"}</button>
    </div>`:""}
    <div class="lt-explica">El tiempo queda congelado en cada registro, igual que el STD de un ticket: cambiarlo después solo cuenta para lo que se registre desde ahí.
      "Real 30 días" son los minutos trabajados entre las prendas contadas: sirve de referencia, no es el tiempo que se paga.
      La supervisora no sube tiempos; lo hace Ingeniería con Edición en el área (DESPACHO va con ACABADO).</div>`;
}
function ltTCambio(id, k, v){
  const t=(LTT.r.tareas||[]).find(x=>x.id===id); if(!t) return;
  const c=LTT.cambios[id]||(LTT.cambios[id]={});
  const orig = k==="std" ? ltFmtStd(t.std) : t.activo;
  if(k==="std" ? (ltNum(v)===ltNum(orig) && (String(v).trim()==="")===(orig==="")) : v===orig) delete c[k]; else c[k]=v;
  if(!Object.keys(c).length) delete LTT.cambios[id];
  const n=Object.keys(LTT.cambios).length+LTT.nuevas.length, b=$("lttGuardar");
  if(b){ b.disabled=!n; b.textContent=n?`GUARDAR ${n} CAMBIO${n===1?"":"S"}`:"GUARDAR TIEMPOS"; }
  if(k==="activo") ltPintarTiempos();
}
function ltTPegar(){
  const txt=($("lttPegar").value||"").trim(), defA=$("lttPegArea").value;
  if(!txt){ mostrarError("Pega las filas de Excel"); return; }
  const ts=LTT.r.tareas||[], edit=(LTT.r.areas||[]).filter(a=>a.edita).map(a=>a.area);
  let ok=0; const malas=[];
  txt.split(/\r?\n/).forEach((ln,i)=>{
    const c=ln.split(/\t|;/).map(x=>x.trim()).filter((x,j,a)=>x!==""||j<a.length-1);
    if(!c.length||!c.join("")) return;
    let area=defA, nom, std;
    if(c.length>=3){ area=c[0].toUpperCase(); nom=c[1]; std=c[2]; } else { nom=c[0]; std=c[1]; }
    nom=String(nom||"").toUpperCase().replace(/\s+/g," ").trim();
    const n=ltNum(std);
    if(/^(AREA|ÁREA|TAREA)$/i.test(c[0])) return;                         // encabezado
    if(!edit.includes(area) || !nom || n==null || n<=0 || n>600){ malas.push(i+1); return; }
    const t=ts.find(x=>x.area===area&&x.nombre===nom);
    if(t) ltTCambio(t.id,"std",String(n));
    else { const e=LTT.nuevas.find(x=>x.area===area&&x.nombre.toUpperCase()===nom); if(e) e.std=String(n); else LTT.nuevas.push({area,nombre:nom,std:String(n)}); }
    ok++;
  });
  ltPintarTiempos();
  if(ok) mostrarOk(`${ok} fila${ok===1?"":"s"} leída${ok===1?"":"s"}: revisa y toca GUARDAR`);
  if(malas.length) mostrarError(`No se entendió la fila ${malas.slice(0,6).join(", ")}${malas.length>6?"…":""}: área de DESPACHO o CORTE que puedas editar y un tiempo entre 0 y 600`);
}
async function ltTGuardar(){
  const ts=LTT.r.tareas||[], filas=[];
  for(const [id,c] of Object.entries(LTT.cambios)){
    const t=ts.find(x=>x.id===Number(id)); if(!t) continue;
    const std=("std" in c)?c.std:ltFmtStd(t.std);
    if(String(std).trim()!=="" && !(ltNum(std)>0)){ mostrarError(`El tiempo de ${t.nombre} no es un número`); return; }
    filas.push({area:t.area,nombre:t.nombre,std:String(std).trim(),activo:("activo" in c)?c.activo:t.activo});
  }
  for(const n of LTT.nuevas){
    if(!n.nombre.trim()){ mostrarError("Falta el nombre de una tarea nueva"); return; }
    if(String(n.std).trim()!=="" && !(ltNum(n.std)>0)){ mostrarError(`El tiempo de ${n.nombre} no es un número`); return; }
    filas.push({area:n.area,nombre:n.nombre,std:String(n.std).trim(),activo:true});
  }
  if(!filas.length) return;
  const on=$("lttDesdeOn"), d=$("lttDesde"), desde=(on&&on.checked&&d&&d.value)||null;
  const s=ltSes();
  await unaVez("lttGuardar", botonesDe("#lttGuardar"), async()=>{
    try{
      const r=await rpc("fn_lote_tiempos_guardar",{p_dni:s.dni,p_token:s.token,p_filas:filas,p_desde:desde});
      if(!r.ok){ mostrarError(r.error||"No se pudo guardar"); return; }
      mostrarOk(`${r.guardadas} tiempo${r.guardadas===1?"":"s"} guardado${r.guardadas===1?"":"s"}`+(r.aplicados?` · ${ltN(r.aplicados)} tramos ya registrados ganaron ${ltMj(r.minutaje)} min de minutaje`:""));
      LTT.cambios={}; LTT.nuevas=[]; LT.tareas=null;
      await ltTiempos();
    }catch(e){ mostrarError(e.message); }
  });
}
async function ltTLog(id, nombre){
  const s=ltSes();
  abrirModal(`<div id="lttLog">${cargandoHTML("Cargando historial…")}</div>`);
  try{
    const r=await rpc("fn_lote_tiempos_log",{p_dni:s.dni,p_token:s.token,p_tarea:id});
    const d=$("lttLog"); if(!d) return;
    if(!r.ok){ d.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    const f=r.filas||[], v=x=>x==null?"sin tiempo":ltFmtStd(x)+" min";
    d.innerHTML=`<h2>${esc(nombre)}</h2><div class="sub" style="margin-bottom:10px">Cambios del tiempo por prenda</div>
      ${f.length?`<div class="tabla-scroll" style="max-height:52vh"><table class="tabla"><thead><tr><th class="izq">Cuándo</th><th>Quién</th><th>Antes</th><th>Nuevo</th><th>Estado</th></tr></thead>
      <tbody>${f.map(x=>`<tr><td class="izq">${new Date(x.cuando).toLocaleString("es-PE",{timeZone:"America/Lima",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false})}</td>
        <td>${esc(soloApellidos(x.por||""))}</td><td>${v(x.antes)}</td><td><b>${v(x.nuevo)}</b></td><td>${x.activo?"Activa":"Oculta"}</td></tr>`).join("")}</tbody></table></div>`
      :`<div class="vacio-msg">Nadie ha cambiado este tiempo todavía.</div>`}
      <div class="modal-acciones"><button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CERRAR</button></div>`;
  }catch(e){ const d=$("lttLog"); if(d) d.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
}


/* ---------------- LOTES DE REPROCESO (parche 126) ----------------
   REPROCESO se trabaja como ACABADO: su BASE se sube en Bases (área
   REPROCESO) y el lote (p. ej. 9CY740) es una OF provisional con su cantidad
   tope. El operario lo busca por número de lote o artículo y registra
   cantidades por operación. Aquí se crea el lote o se corrige su cantidad. */
LT.rep=null;
async function ltRepPuede(){
  try{
    const s=ltSes(); const r=await rpc("fn_reproceso_bases",{p_dni:s.dni,p_token:s.token});
    LT.rep = r&&r.ok ? r : null;
  }catch(e){ LT.rep=null; }   // sin el parche 126 no se muestra el botón
  ["ltRepBtn","ltRepSup"].forEach(id=>{ const b=$(id); if(b) b.hidden=!(LT.rep&&LT.rep.puede); });
}
async function ltRepAbrir(){
  if(!LT.rep) await ltRepPuede();
  if(!(LT.rep&&LT.rep.puede)) return;
  const r=LT.rep, bs=r.bases||[];
  abrirModal(`<h2>Lote de reproceso</h2>
    <div class="sub" style="margin-bottom:10px">El lote funciona como una OF: el operario lo busca por su número, ve las operaciones de la base y registra cantidades hasta el tope.</div>
    ${bs.length?`<div class="lt-form" id="ltRepForm">
      <div class="lt-f"><span id="ltRepBL">Base (artículo)</span><div class="lt-seg" role="radiogroup" aria-labelledby="ltRepBL" id="ltRepBase">
        ${bs.map((b,i)=>`<button type="button" role="radio" aria-checked="${i===0}" data-v="${esc(b.articulo)}">${esc(b.articulo)} <small>${b.ops} op.</small></button>`).join("")}</div></div>
      <label class="lt-f"><span>Número de lote</span><input class="inp" id="ltRepLote" maxlength="20" autocomplete="off" placeholder="Ej: 9CY740"></label>
      <label class="lt-f"><span>Cantidad máxima de prendas (tope de cada operación)</span><input class="inp" id="ltRepCant" type="number" inputmode="numeric" min="1"></label>
      <div class="modal-msg" id="ltRepMsg" role="alert"></div></div>`
    :`<div class="vacio-msg">REPROCESO no tiene bases todavía. Súbelas en Bases, eligiendo el área REPROCESO, igual que las de ACABADO.</div>`}
    <div class="modal-acciones">${bs.length?`<button class="btn-principal btn-modal-guardar" id="ltRepOk" onclick="ltRepCrear()">CREAR LOTE</button>`:""}
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CERRAR</button></div>`);
  const g=$("ltRepBase");
  if(g) g.onclick=e=>{ const b=e.target.closest("button"); if(!b) return; g.querySelectorAll("button").forEach(x=>x.setAttribute("aria-checked", x===b)); };
  const i=$("ltRepLote"); if(i) i.focus();
}
function ltRepEditar(of, art, cant){
  const g=$("ltRepBase"); if(g) g.querySelectorAll("button").forEach(x=>x.setAttribute("aria-checked", normKey(x.dataset.v)===normKey(art)));
  const l=$("ltRepLote"), c=$("ltRepCant"); if(l) l.value=of; if(c){ c.value=cant; c.focus(); }
  const b=$("ltRepOk"); if(b) b.textContent="GUARDAR TOPE";
}
async function ltRepCrear(){
  const s=ltSes(), msg=$("ltRepMsg"), b=$("ltRepBase")&&$("ltRepBase").querySelector("[aria-checked=true]");
  const lote=$("ltRepLote").value.trim(), cant=parseInt($("ltRepCant").value,10);
  if(!b){ msg.textContent="Elige la base"; return; }
  if(!lote){ msg.textContent="Escribe el número de lote"; $("ltRepLote").focus(); return; }
  if(!(cant>0)){ msg.textContent="Pon la cantidad máxima de prendas"; $("ltRepCant").focus(); return; }
  msg.textContent="";
  await unaVez("ltRepCrear", botonesDe("#ltRepOk"), async()=>{
    try{
      const r=await rpc("fn_reproceso_lote_crear",{p_dni:s.dni,p_token:s.token,p_articulo:b.dataset.v,p_lote:lote,p_cantidad:cant});
      if(!r.ok){ msg.textContent=r.error||"No se pudo crear el lote"; return; }
      mostrarOk(r.actualizado?`Lote ${r.of}: tope ${ltN(cant)} prendas`:`Lote ${r.of} creado: ${ltN(cant)} prendas por operación`);
      cerrarModal(); LT.rep=null; ltRecargar();
    }catch(e){ msg.textContent=e.message; }
  });
}
