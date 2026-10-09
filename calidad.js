/* =====================================================================
   CALIDAD DE BASES (preview 8-oct-2026): avisos de solo lectura sobre la
   data de las BASES. Nada bloquea; cada aviso lleva a la BASE para corregir.
   Una sola llamada (fn_bases_calidad) y todo lo demás se filtra aquí.
   ===================================================================== */
let CQ=null, CQ_TIPO="";
const CQ_TIPOS={
  SIN_BASE_REG:{n:"grave",t:"Registran sin BASE",p:"Hay tickets registrados en un área que no tiene BASE para ese artículo: esos minutos no se pueden comparar con nada."},
  ARTICULO_PARECIDO:{n:"grave",t:"Artículo escrito de dos formas",p:"El mismo artículo aparece con O y con 0 (o con espacios). Lo registrado con la forma mal escrita no encuentra su BASE."},
  STD0:{n:"revisar",t:"Operaciones con STD 0",p:"Una operación con STD 0 paga 0 minutos: el operario que la hace pierde eficiencia aunque trabaje."},
  INCOMPLETA:{n:"revisar",t:"BASE incompleta",p:"El artículo tiene muchas menos operaciones que los de su misma prenda. Parece una carga cortada."},
  SIN_BASE_OF:{n:"revisar",t:"OF cargada sin BASE en un área",p:"La OF ya está cargada pero esa área no tiene BASE del artículo. Si el área no lo trabaja, se marca y deja de salir."},
  STD_RARO:{n:"revisar",t:"STD muy distinto a la misma operación",p:"La misma operación, en la misma prenda, vale 3 veces más o 3 veces menos en este artículo que en los demás."},
  NADIE_REGISTRA:{n:"revisar",t:"Operaciones que nadie registra",p:"Están en la BASE, pero en OFs que ya salieron de costura nadie las marcó nunca. O no se hacen, o se hacen con otro nombre."},
  TOTAL_RARO:{n:"info",t:"Minutos por prenda fuera de lo normal",p:"El total de la BASE se aleja más de 40% de la mediana de su prenda. Puede ser correcto (por ejemplo, pantalón de terno): solo para mirar."}
};
const CQ_NIVEL={grave:"Afecta registros",revisar:"Revisar",info:"Para mirar"};
const cqN=(n,d=0)=>Number(n||0).toLocaleString("es-PE",{maximumFractionDigits:d,minimumFractionDigits:d});
const cqArea=a=>String(a||"").replace(" COSTURA","");

async function cargarCalidadBases(){
  $("cqLista").innerHTML=cargandoHTML("Revisando las BASES…");
  try{
    const r=await rpc("fn_bases_calidad",{p_dni:ING.dni,p_token:ING.token});
    if(!r||!r.ok){ mostrarError((r&&r.error)||"Error"); return; }
    CQ=r;
  }catch(e){
    if(/Could not find the function|PGRST202/i.test(String(e&&e.message||e))){
      $("cqLista").innerHTML=`<div class="acf-falta"><b>Falta correr el parche 121 en la base.</b> Esta pantalla revisa las BASES y avisa dónde están mal antes de que arruinen eficiencias y balances.</div>`; return; }
    mostrarError(e.message); $("cqLista").innerHTML=""; return; }
  cqPintar();
}
function cqPintar(){
  if(!CQ) return;
  const area=$("cqArea").value, q=normKey($("cqBuscar").value);
  const deArea=CQ.avisos.filter(a=>!area||a.area===area);
  /* Tarjetas por área */
  $("cqAreas").innerHTML=CQ.areas.map(a=>{
    const tot=a.grave+a.revisar;
    return `<button class="cq-ar${a.area===area?" sel":""}${tot?"":" ok"}" data-a="${esc(a.area)}" aria-pressed="${a.area===area}">
      <div class="t">${esc(a.area)}</div>
      <div class="n">${tot||"✓"} <small>${tot?"por corregir":"sin avisos"}</small></div>
      <div class="cq-pills">${a.grave?`<span class="cq-pill grave">${a.grave} afectan registros</span>`:""}${a.revisar?`<span class="cq-pill revisar">${a.revisar} revisar</span>`:""}${a.info?`<span class="cq-pill info">${a.info} para mirar</span>`:""}</div>
      <div class="s">${cqN(a.articulos)} artículos · ${cqN(a.ops)} operaciones</div></button>`;
  }).join("")+`<div class="cq-ar no"><div class="t">Sin BASE por diseño</div><div class="s">${CQ.sin_base.map(esc).join(", ")} trabajan por tiempo y sin OF: no salen como aviso.</div></div>`;
  $("cqAreas").querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{ $("cqArea").value=$("cqArea").value===b.dataset.a?"":b.dataset.a; cqPintar(); });
  /* Chips por tipo */
  const cnt=t=>deArea.filter(a=>a.tipo===t).length;
  $("cqTipos").innerHTML=`<button class="cq-chip${CQ_TIPO?"":" on"}" data-t="">Todos <b>${deArea.length}</b></button>`+
    Object.keys(CQ_TIPOS).filter(cnt).map(t=>`<button class="cq-chip ${CQ_TIPOS[t].n}${CQ_TIPO===t?" on":""}" data-t="${t}"><i></i>${CQ_TIPOS[t].t} <b>${cnt(t)}</b></button>`).join("");
  $("cqTipos").querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{ CQ_TIPO=b.dataset.t; cqPintar(); });
  /* Avisos agrupados por tipo */
  const vis=deArea.filter(a=>(!CQ_TIPO||a.tipo===CQ_TIPO)&&(!q||normKey((a.articulo||"")+" "+(a.operacion||"")).includes(q)));
  const html=Object.keys(CQ_TIPOS).map(t=>{
    const g=vis.filter(a=>a.tipo===t); if(!g.length) return "";
    const T=CQ_TIPOS[t];
    return `<section class="cq-grupo ${T.n}"><div class="cq-cab"><span class="cq-niv ${T.n}">${CQ_NIVEL[T.n]}</span><h3>${T.t}</h3><b class="cq-cnt">${g.length}</b></div>
      <p class="cq-por">${T.p}</p><div class="tabla-scroll"><table class="tabla cq-tabla">${cqTabla(t,g,!area)}</table></div></section>`;
  }).join("");
  $("cqLista").innerHTML=html||`<div class="vacio-msg">${deArea.length?"Ningún aviso con ese filtro":"La BASE de esta área no tiene avisos 👏"}</div>`;
  $("cqLista").querySelectorAll("[data-base]").forEach(b=>b.onclick=()=>cqIrBase(b.dataset.area,b.dataset.base,b.dataset.op||""));
  cqAcabado(area);
}
function cqTabla(t,g,conArea){
  const A=conArea?"<th class=\"izq\">Área</th>":"", a=x=>conArea?`<td class="izq">${esc(cqArea(x.area))}</td>`:"";
  const ir=(x,op)=>`<td class="der"><button class="btn-mini gris" data-area="${esc(x.area)}" data-base="${esc(String(x.articulo).split(/[ ,/]+/)[0])}" data-op="${esc(op||"")}">Ver en Bases ›</button></td>`;
  const ofs=n=>n?`<span class="cq-tag rojo">${n} OF${n>1?"s":""} cargada${n>1?"s":""}</span>`:`<span class="cq-tag">sin OF todavía</span>`;
  const d=x=>x.dato;
  if(t==="SIN_BASE_REG") return `<thead><tr>${A}<th class="izq">Artículo</th><th>Tickets</th><th>Minutos</th><th>OFs</th><th>Cuándo</th><th></th></tr></thead><tbody>`+
    g.map(x=>`<tr>${a(x)}<td class="izq mono b">${esc(x.articulo)}</td><td>${cqN(d(x).reclamos)}</td><td>${cqN(d(x).minutos)}</td><td>${d(x).ofs}</td><td>${fechaCorta(d(x).desde)} al ${fechaCorta(d(x).hasta)}</td>${ir(x)}</tr>`).join("")+"</tbody>";
  if(t==="ARTICULO_PARECIDO") return `<thead><tr>${A}<th class="izq">Se escribió</th><th>Tickets</th><th>OFs</th><th class="izq">Tiene BASE en</th><th></th></tr></thead><tbody>`+
    g.flatMap(x=>d(x).variantes.map((v,i)=>`<tr class="${i?"":"cq-sep"}">${a(x)}<td class="izq mono b">${esc(v.articulo)}${v.base==="ninguna"?' <span class="cq-tag rojo">mal escrito</span>':""}</td><td>${cqN(v.reclamos)}</td><td class="mono">${esc(v.ofs)}</td><td class="izq">${esc(v.base)}</td>${i?"<td></td>":ir(x)}</tr>`)).join("")+"</tbody>";
  if(t==="STD0") return `<thead><tr>${A}<th class="izq">Artículo</th><th class="izq">Prenda</th><th>Con STD 0</th><th class="izq">Cuánto falta</th><th class="izq">Subió</th><th>OFs</th><th></th></tr></thead><tbody>`+
    g.map(x=>{const p=Math.round(d(x).std0/d(x).ops*100);return `<tr>${a(x)}<td class="izq mono b">${esc(x.articulo)}</td><td class="izq">${esc(d(x).prenda||"")}</td><td><b>${d(x).std0}</b> de ${d(x).ops}</td>
      <td class="izq"><div class="cq-bar"><i style="width:${p}%"></i></div><small>${p}% de las operaciones</small></td><td class="izq">${esc(d(x).por)} · ${fechaCorta(d(x).subido)}</td><td>${ofs(d(x).ofs)}</td>${ir(x)}</tr>`;}).join("")+"</tbody>";
  if(t==="INCOMPLETA") return `<thead><tr>${A}<th class="izq">Artículo</th><th>Operaciones</th><th>Lo normal</th><th>Minutos</th><th>Lo normal</th><th class="izq">Subió</th><th>OFs</th><th></th></tr></thead><tbody>`+
    g.map(x=>`<tr>${a(x)}<td class="izq mono b">${esc(x.articulo)}${d(x).unica?`<div class="cq-sub">Única: ${esc(d(x).unica)}</div>`:""}</td><td class="rojo b">${d(x).ops}</td><td>${cqN(d(x).ops_normal)}</td><td class="rojo b">${cqN(d(x).total,1)}</td><td>${cqN(d(x).total_normal,1)}</td><td class="izq">${esc(d(x).por)} · ${fechaCorta(d(x).subido)}</td><td>${ofs(d(x).ofs)}</td>${ir(x)}</tr>`).join("")+"</tbody>";
  if(t==="SIN_BASE_OF") return `<thead><tr>${A}<th class="izq">Artículo</th><th class="izq">Prenda</th><th class="izq">OFs sin BASE aquí</th><th class="izq">Lo que sí hay</th><th></th></tr></thead><tbody>`+
    g.map(x=>`<tr>${a(x)}<td class="izq mono b">${esc(x.articulo)}</td><td class="izq">${esc(d(x).prenda)}</td><td class="izq mono">${d(x).lista.map(esc).join(", ")}</td>
      <td class="izq">${d(x).acabado_reg?`Solo ACABADO registró (${d(x).acabado_reg} tickets): ¿la costura es de servicio?`:d(x).costura_reg?`Costura ya registró ${d(x).costura_reg} tickets; ACABADO no tendrá con qué`:""}</td>${ir(x)}</tr>`).join("")+"</tbody>";
  if(t==="STD_RARO") return `<thead><tr>${A}<th class="izq">Artículo</th><th class="izq">Operación</th><th>STD aquí</th><th>Lo normal</th><th class="izq">Diferencia</th><th>Comparado con</th><th></th></tr></thead><tbody>`+
    g.sort((p,q)=>Math.abs(Math.log(q.dato.veces))-Math.abs(Math.log(p.dato.veces))).map(x=>{const v=d(x).veces,alto=v>1;
      return `<tr>${a(x)}<td class="izq mono b">${esc(x.articulo)}</td><td class="izq">${esc(x.operacion)}</td><td class="b ${alto?"rojo":"azul"}">${cqN(d(x).std,2)}</td><td>${cqN(d(x).normal,2)}</td>
      <td class="izq"><span class="cq-tag ${alto?"rojo":"azul"}">${alto?`${cqN(v,1)}× más`:`${cqN(1/v,1)}× menos`}</span> <small>${alto?"infla la eficiencia":"castiga al operario"}</small></td><td>${d(x).arts} artículos</td>${ir(x,x.operacion)}</tr>`;}).join("")+"</tbody>";
  if(t==="NADIE_REGISTRA") return `<thead><tr>${A}<th class="izq">Operación</th><th class="izq">Artículos</th><th>STD</th><th>OFs terminadas</th><th>Minutos de BASE sin registrar</th><th></th></tr></thead><tbody>`+
    g.sort((p,q)=>q.dato.min_base-p.dato.min_base).map(x=>`<tr>${a(x)}<td class="izq b">${esc(x.operacion)}</td><td class="izq mono">${esc(x.articulo)}</td><td>${cqN(d(x).std,2)}</td><td>${d(x).ofs}</td><td class="b">${cqN(d(x).min_base)}</td>${ir(x,x.operacion)}</tr>`).join("")+"</tbody>";
  return `<thead><tr>${A}<th class="izq">Artículo</th><th class="izq">Prenda</th><th>Minutos por prenda</th><th>Mediana de la prenda</th><th>Operaciones</th><th>OFs</th><th></th></tr></thead><tbody>`+
    g.map(x=>`<tr>${a(x)}<td class="izq mono b">${esc(x.articulo)}</td><td class="izq">${esc(d(x).prenda)}</td><td class="b">${cqN(d(x).total,1)} <small>(${d(x).pct}%)</small></td><td>${cqN(d(x).normal,1)}</td><td>${d(x).ops} <small>vs ${d(x).ops_normal}</small></td><td>${ofs(d(x).ofs)}</td>${ir(x)}</tr>`).join("")+"</tbody>";
}
/* ACABADO: lo que registra contra lo que pide su BASE, para las prendas que
   ya pasaron por ahí. Explica la diferencia que vio Carga vs capacidad. */
function cqAcabado(area){
  const z=$("cqAcab"), A=CQ.acabado;
  if(area&&area!=="ACABADO"||!A){ z.hidden=true; return; }
  z.hidden=false;
  const b=A.prendas.reduce((s,p)=>s+p.min_base,0), r=A.prendas.reduce((s,p)=>s+p.min_reg,0), pc=Math.round(r/b*100);
  const top=A.ops.slice(0,8), fal=A.ops.reduce((s,o)=>s+o.min_falta,0);
  z.innerHTML=`<div class="cq-cab"><span class="cq-niv revisar">Revisar</span><h3>¿ACABADO registra lo que pide su BASE?</h3></div>
    <p class="cq-por">Para las piezas que ya pasaron por ACABADO, ACABADO registró <b>${pc}%</b> de los minutos que pide su BASE
    (${cqN(r)} de ${cqN(b)} min). Lo que falta sale casi todo de unas pocas operaciones de PANTALÓN que casi nunca se marcan.
    Si esas operaciones no se hacen, la BASE de ACABADO está inflada; si se hacen y no se marcan, la eficiencia de ACABADO sale baja sin serlo.</p>
    <div class="cq-acab">
      <div><h4>Por prenda</h4>${A.prendas.filter(p=>p.min_base>=500).map(p=>`<div class="cq-fila"><span>${esc(p.prenda)}</span>
        <div class="cq-bar ancha ${p.pct<70?"rojo":p.pct<90?"ambar":""}"><i style="width:${Math.min(p.pct,100)}%"></i></div><b>${p.pct}%</b><small>${cqN(p.piezas)} pzs</small></div>`).join("")}</div>
      <div><h4>Operaciones que casi no se marcan</h4><div class="tabla-scroll"><table class="tabla cq-tabla"><thead><tr><th class="izq">Operación</th><th class="izq">Prenda</th><th>Se marca en</th><th>Min sin registrar</th><th></th></tr></thead><tbody>
        ${top.map(o=>`<tr><td class="izq">${esc(o.operacion)}</td><td class="izq">${esc(o.prenda)}</td><td class="${o.pct<30?"rojo b":""}">${o.pct}%</td><td class="b">${cqN(o.min_falta)}</td>
          <td class="der"><button class="btn-mini gris" data-op2="${esc(o.operacion)}">Ver en Bases ›</button></td></tr>`).join("")}</tbody></table></div>
        <small class="cq-sub">Estas ${A.ops.length} operaciones suman ${cqN(fal)} min de BASE sin registrar desde agosto.</small></div></div>`;
  z.querySelectorAll("[data-op2]").forEach(x=>x.onclick=()=>cqIrBase("ACABADO","",x.dataset.op2));
}
function cqIrBase(area,art,op){
  activarTab("pasoBases");
  const s=$("areaBase"); if(s&&area&&s.value!==area){ s.value=area; }
  $("fArt").value=art||""; $("fOp").value=op||"";
  cargarBases();
}
function calidadInit(){
  const s=$("cqArea"); if(s&&s.options.length<2) s.innerHTML=`<option value="">Todas las áreas</option>`+(AREAS_LISTA||[]).filter(a=>!["CORTE","REPROCESO","DESPACHO","UDP"].includes(a)).map(a=>`<option>${esc(a)}</option>`).join("");
  cargarCalidadBases();
}
