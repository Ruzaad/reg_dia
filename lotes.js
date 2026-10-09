/* ================= TRABAJO POR TIEMPO (parche 116) =================
   Lotes de DESPACHO, REPROCESO y CORTE, que no tienen OF ni BASE.
   Operario: EMPEZAR y TERMINAR (la hora la pone el servidor) y al terminar
   cuántas prendas hizo. Supervisora e Ingeniería: crear y cerrar lotes,
   ver las horas y poner la cantidad de lo que quedó por revisar.
   Parche 119: Ingeniería sube el tiempo (min/prenda) de cada tarea. Con
   tiempo, cada tramo con prendas genera minutaje (prendas × tiempo) que entra
   a la boleta, la eficiencia y los incentivos como un ticket. La cantidad del
   lote es el tope, igual que el corte real en ACABADO. */

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
const ltMj = v => Math.round(Number(v)||0).toLocaleString("es-PE");

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
  if(!r.area && !r.actual){ z.innerHTML=`<div class="vacio-msg">Hoy no estás en DESPACHO, REPROCESO ni CORTE. Si vas a trabajar ahí, pide a tu supervisora que te marque en asistencia.</div>
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

/* ---------------- INGENIERÍA ---------------- */
async function ltCargarIng(){
  const z=$("ltIngZona"); if(!z) return;
  const s=ltSes(), f=$("ltFecha"), a=$("ltArea");
  const bc=$("ltBarra"); if(bc) bc.style.display="";
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
  const tb=$("ltTiemposBtn"); if(tb) tb.hidden=false;
  const sum=k=>(r.areas||[]).reduce((s,a)=>s+Number(a[k]||0),0);
  const kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num"${c?` style="color:${c}"`:""}>${v}</div><div class="kpi-lbl">${t}</div></div>`;
  const ls=r.lotes||[], pr=r.por_revisar||[];
  const std=l=>l.std?`<span class="lt-std">${Number(l.std).toFixed(2)}</span>`:`<span class="lt-sinstd">Sin tiempo</span>`;
  const real=l=>{ const v=ltReal(l); if(v==null) return `<span class="sub">—</span>`;
    return `<span class="lt-std${l.std?(v>l.std*1.1?" mal":" bien"):""}">${v.toFixed(2)}</span>`; };
  const efi=l=>{ const v=ltReal(l); return (l.std&&v)?`<b>${Math.round(l.std/v*100)}%</b>`:`<span class="sub">—</span>`; };
  const fila=l=>`<tr><td class="izq"><b>${esc(l.destino)}</b><small>L-${l.id} · ${esc(l.tarea)}${l.o_f?` · OF ${esc(l.o_f)}`:""}</small></td><td>${esc(l.area)}</td>
    <td class="nw">${ltN(l.hecho)} / ${ltN(l.cantidad)}</td>
    <td><span class="lt-prog${ltPct(l)>=100?" ok":""}"><span class="b"><i style="width:${ltPct(l)}%"></i></span><span>${ltPct(l)}%</span></span></td>
    <td class="nw">${ltHoras(l.min)}</td>
    <td>${l.estado==="CERRADO"?`<span class="tag g">Cerrado</span>`:l.ahora?`<span class="lt-vivo">${l.ahora}</span>`:`<span class="sub">0</span>`}</td>
    <td>${real(l)}</td><td>${std(l)}</td><td>${efi(l)}</td><td class="nw">${l.minutaje?`<b>${ltMj(l.minutaje)}</b>`:`<span class="sub">—</span>`}</td>
    <td>${l.por_revisar?`<span class="tag r">${l.por_revisar}</span>`:""}</td>
    <td class="nw"><button class="btn-mini gris" onclick="ltVer(${l.id})">Ver</button></td></tr>`;
  z.innerHTML=`<div class="kpis" style="margin-bottom:14px">${kpi("Lotes abiertos",sum("abiertos"))}${kpi("Trabajando ahora",sum("ahora"),"var(--exito)")}
      ${kpi("Horas del día",ltHoras(sum("min")))}${kpi("Minutaje del día",ltMj(sum("minutaje"))+" min","var(--azul)")}${kpi("Por revisar",pr.length,pr.length?"var(--alerta)":"")}</div>
    ${sum("sin_tiempo")?`<button type="button" class="lt-sintiempo" onclick="ltTiempos()"><b>${sum("sin_tiempo")} ${sum("sin_tiempo")===1?"tarea no tiene":"tareas no tienen"} tiempo</b>
      <span>Sin tiempo, lo que hacen en esas tareas no genera minutaje: el día queda solo en horas. Súbelo en Tiempos por tarea ›</span></button>`:""}
    <div class="lt-areas">${(r.areas||[]).map(a=>`<div class="lt-ar"><div class="t">${esc(a.area)} ${a.ahora?`<span class="lt-vivo">${a.ahora} ahora</span>`:""}</div>
      <div class="n">${ltHoras(a.min)} <small>· ${a.personas} ${a.personas===1?"persona":"personas"}</small></div><div class="s">${a.abiertos} ${a.abiertos===1?"lote abierto":"lotes abiertos"} · ${ltMj(a.minutaje)} min de minutaje${a.edita?"":" · solo lectura"}</div></div>`).join("")}</div>
    ${pr.length?`<h2 class="lt-h2">Por revisar <span class="sub">(sin cantidad: se cerraron solos o el operario no contó)</span></h2>
      <div class="lt-revs">${pr.map(t=>edita.includes(t.area)?ltPorRevisarFila(t,"ltCargarIng"):"").join("")}</div>`:""}
    ${ls.length?`<div class="contenedor-ancho tabla-scroll"><table class="tabla lt-tabla"><thead><tr><th class="izq">Lote</th><th>Área</th><th>Prendas</th><th>Avance</th><th>Horas</th>
      <th>Ahora</th><th>Min/prenda real</th><th>Tiempo</th><th>Eficiencia</th><th>Minutaje</th><th>Por revisar</th><th></th></tr></thead><tbody>${ls.map(fila).join("")}</tbody></table></div>`
      :`<div class="vacio-msg">Sin lotes ese día.${edita.length?" Crea el primero con + Nuevo lote.":""}</div>`}
    <div class="lt-explica">Cuando la tarea tiene tiempo, cada prenda genera <b>minutaje</b> (prendas × tiempo) que entra a la boleta, la eficiencia y los incentivos
      igual que un ticket, con la fecha del día que se trabajó. La cantidad del lote es el tope, como el corte real en ACABADO.
      Sin tiempo, el lote solo suma horas aquí. Min/prenda real cuenta solo los tramos con cantidad.</div>`;
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
      <div class="sub" style="margin-bottom:10px">${esc(l.area)} · ${esc(l.tarea)}${l.o_f?` · OF ${esc(l.o_f)}`:""} · ${ltN(l.hecho)} de ${ltN(l.cantidad)} prendas · ${ltHoras(l.min)}${rl?` · ${rl.toFixed(2)} min/prenda`:""}${l.std?` · ${ltMj(l.minutaje)} min de minutaje`:" · tarea sin tiempo"}</div>
      <div class="tabla-scroll" style="max-height:52vh"><table class="tabla"><thead><tr><th class="izq">Persona</th><th>Día</th><th>Desde</th><th>Hasta</th><th>Min</th><th>Prendas</th><th>Minutaje</th></tr></thead>
      <tbody>${ts.map(t=>`<tr><td class="izq">${esc(soloApellidos(t.nombre||t.dni))}</td><td>${new Date(t.inicio).toLocaleDateString("es-PE",{timeZone:"America/Lima",day:"2-digit",month:"2-digit"})}</td>
        <td>${ltHM(t.inicio)}</td><td>${t.fin?ltHM(t.fin):`<span class="lt-vivo">ahora</span>`}${t.auto?` <span class="tag o">solo</span>`:""}</td><td>${Math.round(t.min)}</td>
        <td>${t.prendas==null?(t.fin?`<span class="tag r">por revisar</span>`:"—"):ltN(t.prendas)}</td><td>${t.minutaje!=null?ltMj(t.minutaje):"—"}</td></tr>`).join("")||`<tr><td colspan="7" class="sub">Nadie trabajó aún en este lote</td></tr>`}</tbody></table></div>
      ${r.edita?`<div class="lt-cantedit"><label>Cantidad del lote (tope)<input class="inp" id="ltCantLote" type="number" inputmode="numeric" min="${l.hecho||1}" value="${l.cantidad}"></label>
        <button type="button" class="btn-mini" id="ltCantLoteB" onclick="ltCambiarCant(${l.id})">Cambiar</button><small>Nunca menos de lo ya hecho (${ltN(l.hecho)}).</small></div>`:""}
      <div class="modal-acciones">${r.edita?(l.estado==="ABIERTO"
          ?`<button class="btn-principal btn-modal-guardar" style="background:var(--alerta)" onclick="ltCerrar(${l.id},true,()=>{cerrarModal();ltRecargar();})">CERRAR LOTE</button>`
          :`<button class="btn-principal btn-modal-guardar" onclick="ltCerrar(${l.id},false,()=>{cerrarModal();ltRecargar();})">REABRIR LOTE</button>`):""}
        <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CERRAR</button></div>`;
  }catch(e){ const d=$("ltDet"); if(d) d.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
}
async function ltCambiarCant(id){
  const s=ltSes(), i=$("ltCantLote"), c=parseInt(i&&i.value,10);
  if(!(c>0)){ mostrarError("Pon la cantidad de prendas"); i&&i.focus(); return; }
  await unaVez("ltCant"+id, botonesDe("#ltCantLoteB"), async()=>{
    try{ const r=await rpc("fn_lote_cantidad",{p_dni:s.dni,p_token:s.token,p_lote:id,p_cantidad:c});
      if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
      mostrarOk(`Cantidad del lote: ${ltN(c)}`); cerrarModal(); ltRecargar();
    }catch(e){ mostrarError(ltFalta(e)?"Falta correr el parche 119 en la base":e.message); }
  });
}
function ltRecargar(){ if($("ltIngZona")) ltCargarIng(); else if($("ltSupZona")) ltCargarSup(); }
function ltDescargar(){
  const r=LT.panel; if(!r||!(r.lotes||[]).length){ mostrarError("No hay datos para descargar"); return; }
  const CAB=["Lote","Área","Destino","Tarea","OF","Estado","Cantidad","Hechas","Horas","Personas","Min/prenda real","Tiempo","Minutaje","Por revisar"];
  const filas=r.lotes.map(l=>[`L-${l.id}`,l.area,l.destino,l.tarea,l.o_f||"",l.estado,l.cantidad,l.hecho,Math.round(l.min/6)/10,l.personas,
    ltReal(l)?Number(ltReal(l).toFixed(2)):"",l.std||"",Math.round(Number(l.minutaje||0)*10)/10,l.por_revisar]);
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
        <div class="m"><span><b>${ltN(l.hecho)}</b> de ${ltN(l.cantidad)} prendas</span><span>${ltHoras(l.min)}${l.std?` · ${ltMj(l.minutaje)} min de minutaje`:" · sin tiempo"}</span></div></div>
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
  ["ltNuevoBtn","ltTiemposBtn"].forEach(id=>{ const b=$(id); if(b) b.hidden=true; });
  const bc=$("ltBarra"); if(bc) bc.style.display="none";
  pintarCargando(z,"Cargando tiempos…");
  const s=ltSes();
  try{
    const r=await rpc("fn_lote_tiempos",{p_dni:s.dni,p_token:s.token});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    LTT.r=r; LTT.cambios={}; LTT.nuevas=[]; ltPintarTiempos();
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
      La supervisora no sube tiempos; lo hace Ingeniería con Edición en el área (DESPACHO y REPROCESO van con ACABADO).</div>`;
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
  if(malas.length) mostrarError(`No se entendió la fila ${malas.slice(0,6).join(", ")}${malas.length>6?"…":""}: área de DESPACHO, REPROCESO o CORTE que puedas editar y un tiempo entre 0 y 600`);
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
