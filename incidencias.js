/* ================= INCIDENCIAS POR ÁREA (parche 114) =================
   POR APROBAR: una sola llamada (fn_solicitudes_panel) trae las pendientes de
   tus áreas con cómo queda el día de esa persona, el visto bueno de la
   supervisora y las alertas (repetido, ya existe igual, pasa el turno). Las
   alertas no bloquean. Solo se marcan para aprobar en lote las que tienen
   visto bueno y ninguna alerta roja. Rechazar pide el motivo: el operario lo
   ve en su celular. Sin el parche cae a fn_solicitudes_listar, sin alertas.
   REPROCESOS Y APOYO: en qué se fueron los minutos (fn_reprocesos_apoyo). */

const IR={items:[], nuevo:false, marcadas:new Set(), rep:null};
const IR_JORNADA=575;
const irFalta = e => /Could not find the function|PGRST202|does not exist/i.test(String(e&&e.message||e||""));
const irMin = n => Number(n||0).toLocaleString("es-PE");
const irDM = f => { const p=String(f||"").slice(0,10).split("-"); return p.length===3?`${p[2]}/${p[1]}`:""; };
const irHora = f => String(f||"").slice(11,16);

/* Lo que el texto deja ver aunque haya llegado como OTROS. */
function irSugerencia(it){
  if(it.area_trabajo) return {t:"Trabajo en "+it.area_trabajo, c:"p"};
  const m=normKey(it.motivo||""), tp=String(it.tipo||"").toUpperCase();
  if(/DESPACH/.test(m)) return {t:"Trabajo en DESPACHO", c:"p", o:tp==="REPROCESOS"?"Dice DESPACHO pero vino como REPROCESOS":""};
  if(tp!=="REPROCESOS" && /REPROCES|RETOC/.test(m)) return {t:"Reproceso", c:"p"};
  if(/APOYO|AYUD|HABILIT/.test(m)) return {t:"Apoyo a otra área", c:"p"};
  if(/LIQUID|LIKID/.test(m)) return {t:"Liquidación", c:"p"};
  if(tp==="OTROS" && /MUESTRA/.test(m)) return {t:"", c:"", o:"Parece MUESTRAS"};
  return null;
}
function irAlertas(it){
  const r=[], o=[];
  if(it.rep) r.push(it.rep.estado==="APROBADO"
    ? `Ya tiene ${it.minutos} aprobado ese día con el mismo motivo`
    : `Repetido: igual al pedido de las ${it.rep.hora}`);
  if(it.igual) r.push(`Ya existe una incidencia igual ese día (${soloApellidos(it.igual.por||"")})`);
  if(it.reg!=null){
    const tot=Number(it.reg)+Number(it.inc)+Number(it.pide), disp=IR_JORNADA+Number(it.he||0);
    if(tot>disp) r.push(`Con ${Number(it.pide)>Math.abs(it.minutos)?"sus pedidos":"este"} el día pasa el turno por ${Math.round(tot-disp)} min`);
  }
  const sg=irSugerencia(it); if(sg && sg.o) o.push(sg.o);
  return {r,o};
}
const irSeleccionable = it => it.aprueba!==false && (it.visto_bueno || it.solo_ing || !IR.nuevo) && !irAlertas(it).r.length;

async function cargarPendientesInci(){
  const z=$("listaIncidI"); if(!z) return;
  pintarCargando(z,"Cargando pendientes…");
  try{
    let r;
    try{ r=await rpc("fn_solicitudes_panel",{p_dni:ING.dni,p_token:ING.token,p_area:"",p_dias:0}); IR.nuevo=true; }
    catch(e){ if(!irFalta(e)) throw e;
      r=await rpc("fn_solicitudes_listar",{p_dni:ING.dni,p_token:ING.token,p_area:""}); IR.nuevo=false; }
    if(!r.ok){ mostrarError(r.error||"Error"); z.innerHTML=""; return; }
    IR.items=(r.items||[]).filter(x=>!x.estado || x.estado==="PENDIENTE");
    if(!IR.nuevo) IR.items.forEach(x=>{ x.pidio=(x.fecha||"")+" "+(x.hora||""); });
    IR.marcadas=new Set(IR.items.filter(x=>IR.nuevo && x.visto_bueno && irSeleccionable(x)).map(x=>x.id));
    const sel=$("areaInciPend");
    if(sel){
      const prev=sel.value;
      const areas=[...new Set(IR.items.map(x=>x.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
      if(prev && !areas.includes(prev)) areas.push(prev);
      sel.innerHTML=`<option value="">Todas mis áreas</option>`+areas.map(a=>`<option>${esc(a)}</option>`).join("");
      // El filtro de área de arriba (dinamico.js) manda cuando el select está escondido.
      const g=(typeof G!=="undefined" && G && G.area) || "";
      sel.value = prev || (areas.includes(g) ? g : "");
    }
    const n=$("inciPendN"); if(n){ n.textContent=IR.items.length; n.hidden=!IR.items.length; }
    pintarPendientesInci();
  }catch(e){ z.innerHTML=""; mostrarError(e.message); }
}

function irBarraDia(it){
  if(it.reg==null) return "";
  const reg=Number(it.reg), otras=Number(it.inc)+Number(it.pide), disp=IR_JORNADA+Number(it.he||0);
  const tot=reg+otras, base=Math.max(disp,tot), ex=Math.max(0,tot-disp);
  const pc=v=>(v/base*100).toFixed(1)+"%";
  return `<div class="ir-dia" role="img" aria-label="Registró ${reg} min, incidencias ${otras} min, de ${disp}">
    <div class="bar"><i class="reg" style="width:${pc(reg)}"></i><i class="pide" style="width:${pc(Math.max(0,otras-ex))}"></i>${ex?`<i class="ex" style="width:${pc(ex)}"></i>`:""}</div>
    <small>${reg} reg + ${otras} inc = ${ex?`<b>${tot}</b>`:tot} / ${disp}</small></div>`;
}
function irSupTag(it){
  if(!IR.nuevo) return "";
  if(it.solo_ing) return `<span class="tag a">La pidió la supervisora${it.solicitante?` (${esc(soloApellidos(it.solicitante))})`:""}</span>`;
  if(it.visto_bueno) return `<span class="tag v">✓ Supervisora: visto bueno</span>`;
  if(it.chica) return `<span class="tag g">Lo puede aprobar la supervisora</span>`;
  return `<span class="tag o">Supervisora aún no lo ve</span>`;
}
function irQue(it){
  const sg=irSugerencia(it), ex=[];
  if(it.area_causa) ex.push(`Vino de <b>${esc(it.area_causa)}</b>`);
  if(it.o_f) ex.push(`OF <b>${esc(it.o_f)}</b>`);
  return `<div class="tp">${esc(TIPO_LBL(it.tipo))}${sg&&sg.t?` <span class="tag ${sg.c}">${esc(sg.t)}</span>`:""}</div>${esc(it.motivo||"")}
    ${ex.length?`<div class="ir-ex">${ex.join(" · ")}</div>`:""}`;
}
function pintarPendientesInci(){
  const z=$("listaIncidI"); if(!z) return;
  const ar=(($("areaInciPend")||{}).value||""), ver=(($("verInciPend")||{}).value||"");
  const q=normKey((($("filtroInciPend")||{}).value||""));
  const items=IR.items.filter(it=>
    (!ar || it.area===ar) &&
    (!ver || (ver==="vb" ? it.visto_bueno : ver==="sin" ? !it.visto_bueno && !it.solo_ing : irAlertas(it).r.length>0)) &&
    (!q || normKey([it.nombre,it.tipo,it.motivo,it.solicitante,it.o_f,it.area_causa,it.area_trabajo].join(" ")).includes(q)));
  { const rp=$("resumenInciPend"); if(rp) rp.textContent=`${items.length} de ${IR.items.length} pendiente(s)`; }
  if(!IR.items.length){ z.innerHTML=`<div class="vacio-msg">Sin incidencias pendientes en tus áreas</div>`; return; }

  const areas=[...new Set(items.map(x=>x.area))].sort((a,b)=>a.localeCompare(b,"es"));
  const lee=a=>items.some(x=>x.area===a) && items.filter(x=>x.area===a).every(x=>x.aprueba===false);
  const tarjetas=`<div class="ir-areas">${areas.map(a=>{
    const xs=items.filter(x=>x.area===a), vb=xs.filter(x=>x.visto_bueno).length;
    const viejo=xs.map(x=>x.pidio||"").sort()[0]||"", al=xs.filter(x=>irAlertas(x).r.length).length;
    return `<button type="button" class="ir-ar${lee(a)?" ro":""}" onclick="irArea('${esc(a)}')">
      <span class="t">${esc(a)}${lee(a)?" · solo lectura":""}</span>
      <span class="n">${xs.length} <small>por aprobar · ${irMin(xs.reduce((s,x)=>s-Number(x.minutos||0),0))} min</small></span>
      <span class="s">${IR.nuevo?`${vb} con visto bueno · `:""}la más vieja ${esc(irDM(viejo))} ${esc(irHora(viejo))}${al?` · <b>${al} con alerta</b>`:""}</span></button>`;
  }).join("")}</div>`;
  const ley=IR.nuevo?`<div class="ir-ley"><span><i style="background:var(--azul)"></i>Minutos que registró ese día</span>
    <span><i style="background:var(--aviso)"></i>Incidencias (esta y las otras del día)</span>
    <span><i style="background:var(--alerta)"></i>Lo que pasa de la jornada</span></div>`:"";

  const fila=it=>{
    const ro=it.aprueba===false, al=irAlertas(it), selec=!ro && irSeleccionable(it), mar=IR.marcadas.has(it.id);
    return `<tr class="${ro?"ir-ro":""}${mar?" ir-sel":""}">
      <td class="nw">${selec?`<input type="checkbox" aria-label="Marcar a ${esc(it.nombre)}" ${mar?"checked":""} onchange="irMarcar(${it.id},this.checked)">`:""}</td>
      <td class="izq ir-per"><b>${esc(it.nombre)}</b><small>${it.cat?`Cat. ${esc(it.cat)} · `:""}pidió ${esc(irDM(it.pidio))} ${esc(irHora(it.pidio))}</small></td>
      <td>${esc(irDM(it.fecha))}</td>
      <td class="izq ir-mot">${irQue(it)}</td>
      ${IR.nuevo?`<td>${irBarraDia(it)}</td>`:""}
      <td class="izq"><div class="ir-av">${irSupTag(it)}${al.r.map(t=>`<span class="tag r">${esc(t)}</span>`).join("")}${al.o.map(t=>`<span class="tag o">${esc(t)}</span>`).join("")}</div></td>
      <td class="nw">${ro?`<b class="ir-num">${it.minutos}</b>`:`<input class="ir-min" id="inci_${it.id}" type="number" value="${it.minutos}" aria-label="Minutos">`}</td>
      <td class="nw">${ro?`<span class="tag g">Solo lectura</span>`:`<div class="ir-acc">
        <button class="btn-mini verde" onclick="resolverIncidI(${it.id},true)">Aprobar</button>
        <button class="btn-mini rojo" onclick="resolverIncidI(${it.id},false)">Rechazar</button></div>`}</td></tr>`;
  };
  const cols=IR.nuevo?8:7;
  const cuerpo=items.length ? areas.map(a=>{
    const ys=items.filter(x=>x.area===a);
    return `<tr class="ir-grupo"><td colspan="${cols}">${esc(a)}<span>${ys.length} pendientes · ${irMin(ys.reduce((s,x)=>s-Number(x.minutos||0),0))} min${lee(a)?" · tú solo lees esta área":""}</span></td></tr>`
      + ys.map(fila).join("");
  }).join("") : `<tr><td colspan="${cols}"><div class="vacio-msg">Nada con ese filtro</div></td></tr>`;
  const marcadas=[...IR.marcadas].filter(id=>items.some(x=>x.id===id));
  z.innerHTML=tarjetas+ley+`<div class="contenedor-ancho tabla-scroll"><table class="tabla ir-tabla"><thead><tr><th></th>
      <th class="izq">Persona</th><th>Día</th><th class="izq">Qué pide</th>${IR.nuevo?"<th>Cómo queda su día</th>":""}
      <th class="izq">${IR.nuevo?"Supervisora y alertas":"Alertas"}</th><th>Min</th><th></th></tr></thead><tbody>${cuerpo}</tbody></table></div>
    <div class="ir-pie"><button class="btn-mini verde" id="irLote" onclick="irAprobarLote()"${marcadas.length?"":" disabled"}>Aprobar ${marcadas.length===1?"la marcada":`las ${marcadas.length} marcadas`}</button>
      <span class="sub">${IR.nuevo?"Solo se pueden marcar las que tienen visto bueno y ninguna alerta roja. ":""}Rechazar siempre pide el motivo, y el operario lo ve en su celular.</span></div>`;
}
function irArea(a){ const s=$("areaInciPend"); if(!s) return; s.value = s.value===a ? "" : a; pintarPendientesInci(); }
function irMarcar(id, on){ on?IR.marcadas.add(id):IR.marcadas.delete(id); pintarPendientesInci(); }

async function irResolver(id, aprobar, mf, motivo){
  const args={p_dni:ING.dni,p_token:ING.token,p_id:id,p_aprobar:aprobar,p_minutos_final:mf};
  if(IR.nuevo) args.p_motivo=motivo||null;
  return rpc("fn_solicitud_resolver",args);
}
async function resolverIncidI(id, aprobar){
  const it=IR.items.find(x=>x.id===id);
  if(!aprobar){ irPedirMotivo(id); return; }
  const mf=parseInt(($("inci_"+id)||{}).value,10); if(!mf){ mostrarError("Minutos inválidos"); return; }
  const al=it?irAlertas(it).r:[];
  if(al.length && !confirm(`${soloApellidos(it.nombre)}:\n· ${al.join("\n· ")}\n\n¿Aprobar igual?`)) return;
  return unaVez("sol"+id, botonesDe(`[onclick^="resolverIncidI(${id},"]`), async ()=>{
    try{
      const r=await irResolver(id,true,mf);
      if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
      IR.marcadas.delete(id); await cargarPendientesInci();
    }catch(e){ mostrarError(e.message); }
  });
}
function irPedirMotivo(id){
  const it=IR.items.find(x=>x.id===id); if(!it) return;
  const rapidos=["Repetida: ya se pidió lo mismo","Ya está registrada como incidencia","Los minutos no corresponden","Ese día registró su jornada completa"];
  abrirModal(`<h2>Rechazar el pedido</h2>
    <div class="sub" style="margin-bottom:12px;">${esc(it.nombre)} · ${it.minutos} min · ${esc(TIPO_LBL(it.tipo))}. ${esc(it.motivo||"")}</div>
    <div class="ir-rap">${rapidos.map((t,i)=>`<button type="button" class="tab" onclick="$('irMotivo').value=this.textContent;$('irMotivo').focus()">${esc(t)}</button>`).join("")}</div>
    <div class="modal-campo"><label for="irMotivo">Motivo (lo ve el operario)</label>
      <input id="irMotivo" maxlength="160" placeholder="Escribe el motivo"></div>
    <div class="modal-msg" id="irMsg"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" id="irRechazar" onclick="irRechazar(${id})">RECHAZAR</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`);
  setTimeout(()=>{ const i=$("irMotivo"); if(i) i.focus(); },60);
}
async function irRechazar(id){
  const m=(($("irMotivo")||{}).value||"").trim();
  if(!m){ $("irMsg").textContent="Escribe el motivo: el operario lo ve"; return; }
  return unaVez("sol"+id, [$("irRechazar")], async ()=>{
    try{
      const r=await irResolver(id,false,null,m);
      if(!r.ok){ $("irMsg").textContent=r.error||"No se pudo"; return; }
      cerrarModal(); IR.marcadas.delete(id); await cargarPendientesInci();
    }catch(e){ $("irMsg").textContent=e.message; }
  });
}
async function irAprobarLote(){
  const ids=[...IR.marcadas].filter(id=>IR.items.some(x=>x.id===id));
  if(!ids.length) return;
  const tot=ids.reduce((s,id)=>s-Number((($("inci_"+id)||{}).value)||0),0);
  if(!confirm(`¿Aprobar ${ids.length} pedido${ids.length===1?"":"s"} (${irMin(tot)} min)?`)) return;
  return unaVez("irLote", [$("irLote")], async ()=>{
    let ok=0; const err=[];
    for(const id of ids){
      const it=IR.items.find(x=>x.id===id), mf=parseInt(($("inci_"+id)||{}).value,10)||it.minutos;
      try{ const r=await irResolver(id,true,mf); if(r.ok){ ok++; IR.marcadas.delete(id); } else err.push(soloApellidos(it.nombre)+": "+(r.error||"no se pudo")); }
      catch(e){ err.push(soloApellidos(it.nombre)+": "+e.message); }
    }
    if(ok) mostrarOk(`${ok} aprobado${ok===1?"":"s"}`);
    if(err.length) mostrarError(err.join(" · "));
    await cargarPendientesInci();
  });
}

/* ---------------- REPROCESOS Y APOYO ---------------- */
const REP_COL={"Despacho":"c-desp","Reproceso":"c-rep","Apoyo a otra área":"c-apo","Liquidación":"c-liq",
  "Máquina parada":"c-maq","Muestras":"c-mue","Arreglos":"c-mue"};
const REP_OTRA=["Despacho","Reproceso","Apoyo a otra área","Liquidación"];
async function repCargar(){
  const z=$("repZona"); if(!z) return;
  if(!$("irRepHasta").value){
    const h=hoyLima(); $("irRepHasta").value=h;
    $("irRepDesde").value=new Date(Date.parse(h+"T00:00:00Z")-30*86400000).toISOString().slice(0,10);
  }
  const sa=$("irRepArea"); if(sa && sa.options.length<2){ const v=sa.value; sa.innerHTML=opcionesAreaVista(); sa.value=v; }
  pintarCargando(z,"Sumando los minutos de incidencia…");
  try{
    const r=await rpc("fn_reprocesos_apoyo",{p_dni:ING.dni,p_token:ING.token,p_area:sa?sa.value:"",
      p_desde:$("irRepDesde").value,p_hasta:$("irRepHasta").value});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    IR.rep=r; repPintar();
  }catch(e){
    z.innerHTML = irFalta(e)
      ? `<div class="acf-falta"><b>Falta correr el parche 114 en la base.</b> Esta pestaña suma en qué se fueron los minutos de incidencia: despacho, reproceso, apoyo a otra área y quién causó el reproceso.</div>`
      : `<div class="vacio-msg">${esc(e.message)}</div>`;
  }
}
function repPintar(){
  const r=IR.rep, z=$("repZona"); if(!r||!z) return;
  if(!r.total){ z.innerHTML=`<div class="vacio-msg">Sin incidencias en el rango</div>`; return; }
  const pct=Math.round(r.otra_cosa/r.total*100), max=Math.max(...r.cats.map(c=>c.min),1);
  const kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num"${c?` style="color:${c}"`:""}>${v}</div><div class="kpi-lbl">${t}</div></div>`;
  const areas=[...new Set(r.por_area.map(x=>x.area))].sort((a,b)=>a.localeCompare(b,"es"));
  const val=(cat,a)=>(r.por_area.find(x=>x.cat===cat&&x.area===a)||{}).min||0;
  z.innerHTML=`<div class="kpis" style="margin-bottom:14px">
      ${kpi("Min. de incidencia (sin horas extra)",irMin(r.total),"var(--alerta)")}
      ${kpi(`Eran trabajo en otra cosa (${pct}%)`,irMin(r.otra_cosa),"var(--violeta)")}
      ${kpi("Días-persona enteros en incidencia",irMin(r.dias_enteros))}
      ${kpi("Min. de máquina parada",irMin(r.maquina))}</div>
    ${pct>=30?`<div class="ir-nota"><b>${pct}% de los minutos de incidencia no es tiempo perdido</b>: es gente que trabajó en despacho, reproceso, apoyo o liquidación. Desde el parche 114 el operario dice dónde trabajó y qué área le devolvió el reproceso, así que se puede sumar y cobrar a quien lo causó.</div>`:""}
    <div class="ir-grid2"><div class="ir-card"><h3>En qué se fueron los minutos</h3><p>Personas distintas a la derecha.</p>
      <div class="ir-hb">${r.cats.map(c=>`<div class="l">${esc(c.cat)}</div><div class="b"><i class="${REP_COL[c.cat]||"c-otr"}" style="width:${(c.min/max*100).toFixed(1)}%"></i></div>
        <div class="v">${irMin(c.min)} <span class="sub">· ${c.personas} p.</span></div>`).join("")}</div></div>
    <div class="ir-card"><h3>Quién lo hizo</h3><p>Minutos por el área de la persona que pidió.</p>
      <div class="tabla-scroll"><table class="tabla ir-mx"><thead><tr><th class="izq"></th>${REP_OTRA.map(c=>`<th>${esc(c.replace("Apoyo a otra área","Apoyo").replace("Liquidación","Liquid."))}</th>`).join("")}</tr></thead><tbody>
      ${areas.map(a=>`<tr><td class="izq h">${esc(a.replace(" COSTURA",""))}</td>${REP_OTRA.map(c=>{ const v=val(c,a);
        return `<td class="cel${v>7000?" f":v>1500?" m":""}">${v?irMin(v):"—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
      <h3 style="margin-top:16px">Quién lo causó</h3>
      ${r.causa.length?`<div class="tabla-scroll"><table class="tabla ir-mx"><thead><tr><th class="izq">Lo devolvió</th><th class="izq">Lo arregló</th><th>Min</th><th class="izq">OF</th></tr></thead><tbody>
        ${r.causa.map(c=>`<tr><td class="izq h">${esc(c.causa)}</td><td class="izq">${esc(c.area)}</td><td class="cel">${irMin(c.min)}</td><td class="izq">${esc((c.ofs||[]).slice(0,6).join(", "))}${(c.ofs||[]).length>6?"…":""}</td></tr>`).join("")}</tbody></table></div>`
        :`<p>Todavía nadie dijo de qué área vino un reproceso: se llena desde que el operario lo pide con la app nueva.</p>`}
      ${r.sin_causa?`<p class="sub">${r.sin_causa} reproceso${r.sin_causa===1?"":"s"} sin área de origen (pedidos de antes o escritos a mano).</p>`:""}
    </div></div>`;
}
function repDescargar(){
  const r=IR.rep; if(!r||!r.total){ mostrarError("No hay datos para descargar"); return; }
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["En qué","Minutos","Personas"],...r.cats.map(c=>[c.cat,c.min,c.personas])]), "EN QUE");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["En qué","Área","Minutos"],...r.por_area.map(c=>[c.cat,c.area,c.min])]), "QUIEN LO HIZO");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Lo devolvió","Lo arregló","Minutos","OF"],...r.causa.map(c=>[c.causa,c.area,c.min,(c.ofs||[]).join(", ")])]), "QUIEN LO CAUSO");
  XLSX.writeFile(wb, `REPROCESOS_Y_APOYO_${$("irRepDesde").value}_a_${$("irRepHasta").value}.xlsx`);
}
