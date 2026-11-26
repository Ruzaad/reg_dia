/* PCP · Cronograma de costura (parche 178). Programa de costura + STD de la base + avance real de la penúltima operación. */
const PCS={mes:"",r:null,et:null,det:{},f:{q:""},o:{k:"",d:1},pop:null};
const PCS_META=[["PLANTA","Planta"],["CAMISA COSTURA","Camisa"],["PANTALON COSTURA","Pantalón"],["SACO COSTURA","Saco"],["CORTE","Corte"],["ACABADO","Acabado"],["REPROCESO","Reproceso"]];
const pcsMes=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const pcsN=n=>Math.round(+n||0).toLocaleString("es-PE");
const pcsDM=f=>f?f.slice(8,10)+"/"+f.slice(5,7):"—";
const pcsSem=st=>st==null?"":st>=80?"v":st>=51?"a":"r";
function pcsLunes(f){ const d=new Date(f+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)); return d.toISOString().slice(0,10); }
function pcsNumSem(l){ const d=new Date(l+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+3); const j=new Date(Date.UTC(d.getUTCFullYear(),0,4)); return 1+Math.round(((d-j)/864e5-3+((j.getUTCDay()+6)%7))/7); }
function pcsRango(l){ const a=new Date(l+"T00:00:00Z"), b=new Date(a.getTime()+6*864e5);
  return `${a.getUTCDate()}${a.getUTCMonth()===b.getUTCMonth()?"":" "+pcsMes[a.getUTCMonth()]}–${b.getUTCDate()} ${pcsMes[b.getUTCMonth()]}`; }

async function pcsCargar(){
  const box=$("pcpCron"); if(!box) return;
  PCS.mes=($("pcpMes").value||hoyLima().slice(0,7))+"-01";
  box.innerHTML=cargandoHTML("Armando el cronograma…");
  try{
    const r=await rpc("fn_pcp_costura",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    PCS.r=r; { const c=$("pcpCargas"); if(c) c.hidden=!r.puede_editar; }
    PCS.et=null; PCS.det={}; pcsPintar(); pcsEtapas();
  }catch(e){
    box.innerHTML=/fn_pcp_costura|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 178 en la base.</b></div>` : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}
/* % de Corte y Acabado de todas las OF en una sola consulta (parche 187); si falta el parche quedan en «—». */
async function pcsEtapas(){
  const mes=PCS.mes;
  try{
    const r=await rpc("fn_pcp_etapas",{p_dni:ING.dni,p_token:ING.token,p_mes:mes});
    if(mes!==PCS.mes) return;
    PCS.et=(r&&r.ok)?r.etapas:{}; pcsPintar();
  }catch(e){ PCS.et={}; pcsPintar(); }
}
const pcsPct=(x,e)=>e==="costura"?x.status:(((PCS.et||{})[x.o_f]||{})[e]);
const pcsEtPct=e=>x=>{ const p=pcsPct(x,e); return p==null?"Sin avance":p>=80?"Verde · 80–100 %":p>=51?"Ámbar · 51–79 %":"Rojo · 0–50 %"; };
/* Columnas: k, título, valores para filtrar (array), valor para ordenar, celda */
const pcsCorto=a=>({"CAMISA COSTURA":"Camisa","PANTALON COSTURA":"Pantalón","SACO COSTURA":"Saco"})[a]||String(a||"").replace(" COSTURA","");
const pcsSemEt=l=>l==="sin"?"Sin fecha":`Semana ${pcsNumSem(l)} · ${pcsRango(l)}`;
const pcsStEt=x=>x.status==null?"Sin avance":x.status>=80?"Verde · 80–100 %":x.status>=51?"Ámbar · 51–79 %":"Rojo · 0–50 %";
const pcsObs=x=>[...new Set((x.obs||[]).map(t=>t==="ARTÍCULO NO REGISTRADO EN CHRONOS"?"SIN BASE DE OPERACIONES":t))];
const PCS_COL=[
  {k:"planta",t:"Planta",v:x=>[x.planta||"—"],o:x=>x.planta},
  {k:"linea",t:"Línea",v:x=>[pcsCorto(x.area)||"—"],o:x=>pcsCorto(x.area)},
  {k:"prenda",t:"Prenda",v:x=>[x.prenda||"—"],o:x=>x.prenda},
  {k:"cliente",t:"Cliente",v:x=>[x.cliente||"—"],o:x=>x.cliente},
  {k:"articulo",t:"Artículo",v:x=>[x.articulo||"—"],o:x=>x.articulo},
  {k:"modelo",t:"Modelo",v:x=>[x.modelo||"—"],o:x=>x.modelo},
  {k:"color",t:"Color",v:x=>[x.color||"—"],o:x=>x.color},
  {k:"o_f",t:"OF",n:1,v:x=>[x.o_f||"—"],o:x=>+x.o_f||0},
  {k:"target",t:"Target",n:1,v:x=>[x.target?pcsDM(x.target):"—"],o:x=>x.target||""},
  {k:"cant_prog",t:"Cant prog",n:1,v:x=>[pcsN(x.cant_prog)],o:x=>+x.cant_prog||0},
  {k:"std",t:"STD",n:1,v:x=>[x.std!=null?(+x.std).toFixed(1).replace(".",","):"—"],o:x=>x.std==null?-1:+x.std},
  {k:"dias",t:"Días háb.",n:1,v:x=>[x.dias!=null?String(x.dias).replace(".",","):"—"],o:x=>x.dias==null?-1:+x.dias},
  {k:"ini",t:"Ini costura",n:1,v:x=>[x.ini?pcsSemEt(pcsLunes(x.ini)):"Sin fecha"],o:x=>x.ini||"9"},
  {k:"fin",t:"Fin costura",n:1,v:x=>[x.fin?pcsDM(x.fin):"—"],o:x=>x.fin||"9"},
  ...["corte","costura","acabado"].map(e=>({k:e,t:e[0].toUpperCase()+e.slice(1),n:1,v:x=>[pcsEtPct(e)(x)],o:x=>{ const p=pcsPct(x,e); return p==null?-1:p; }})),
  {k:"obs",t:"Observación",v:x=>{ const o=pcsObs(x); return o.length?o:["(Sin observación)"]; },o:x=>pcsObs(x).length}
];
/* PLANTA = SAMITEX: lo de TALLER no entra en Chronos */
const pcsBase=()=>(PCS.r.filas||[]).filter(x=>!/TALLER/i.test(x.planta||""));
function pcsPasa(x,omitir){
  const F=PCS.f, q=F.q.trim().toUpperCase();
  if(q && !(String(x.articulo||"").includes(q)||String(x.o_f||"").includes(q)||String(x.modelo||"").toUpperCase().includes(q))) return false;
  return PCS_COL.every(c=>{ const ok=F[c.k]; return c.k===omitir||!ok||c.v(x).some(v=>ok.has(v)); });
}
function pcsFiltrar(){ return pcsBase().filter(x=>pcsPasa(x)); }
function pcsOrdenar(k){ const O=PCS.o; PCS.o=O.k===k?(O.d===1?{k,d:-1}:{k:"",d:1}):{k,d:1}; pcsPintar(); }
function pcsCmp(){
  const c=PCS_COL.find(z=>z.k===PCS.o.k); if(!c) return null; const d=PCS.o.d;
  return (a,b)=>{ const x=c.o(a), y=c.o(b); return (typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),"es",{numeric:true}))*d; };
}
function pcsFila(x){
  const s=pcsSem(x.status), ob=pcsObs(x).map(t=>`<span class="pcs-ob${x.bloquea&&/BASE|REGISTRADO/.test(t)?" bl":""}">${esc(t)}</span>`).join("");
  const tip=x.est?`${x.est} personas × 9,57 h × 60 = ${pcsN(x.min_dia)} min por día`:"";
  const of=x.o_f?`<span class="pcs-of-n">${esc(x.o_f)}</span>`:"—";
  const et=e=>{ const p=pcsPct(x,e); return p==null?`<td class="num"><span class="pcs-sin" title="Sin registros todavía">—</span></td>`
    :`<td class="num"><button type="button" class="pcs-st pc ${pcsSem(p)}" onclick="pcsDetalle('${esc(x.o_f)}','${e}','${esc(x.area)}',this)" aria-label="${e}: ${p} por ciento. Ver detalle">${p} %</button></td>`; };
  return `<tr><td>${esc(x.planta)}</td><td>${esc(pcsCorto(x.area))}</td><td>${esc(x.prenda)}</td><td>${esc(x.cliente)}</td><td><b>${esc(x.articulo)}</b></td><td>${esc(x.modelo)}</td><td>${esc(x.color)}</td>
    <td class="num">${of}</td><td class="num">${pcsDM(x.target)}</td><td class="num"${x.cant_plan!=null&&+x.cant_plan!==+x.cant_prog?` title="Programado ${pcsN(x.cant_plan)} · cortado ${pcsN(x.cortado)}"`:""}>${pcsN(x.cant_prog)}${x.cant_plan!=null&&+x.cant_plan!==+x.cant_prog?`<sup class="pcs-cor">●</sup>`:""}</td><td class="num">${x.std!=null?(+x.std).toFixed(1).replace(".",","):"—"}</td>
    <td class="num" title="${esc(tip)}">${x.dias!=null?String(x.dias).replace(".",","):"—"}</td><td class="num">${pcsDM(x.ini)}</td><td class="num">${pcsDM(x.fin)}</td>
    ${et("corte")}${et("costura")}${et("acabado")}<td class="pcs-obs">${ob}</td></tr>`;
}
function pcsTh(c){
  const O=PCS.o, on=PCS.f[c.k], fl=on?"▼":"▾", fl2=O.k===c.k?(O.d===1?"▲":"▼"):"";
  return `<th class="${c.n?"num ":""}pcs-th${on?" filtrado":""}"><div><button type="button" class="pcs-ord" onclick="pcsOrdenar('${c.k}')" aria-label="Ordenar por ${c.t}">${c.t}<i>${fl2}</i></button><button type="button" class="pcs-fb${on?" on":""}" onclick="pcsAbrir('${c.k}',this)" aria-haspopup="true" aria-label="Filtrar ${c.t}">${fl}</button></div></th>`;
}
function pcsPintar(){
  const r=PCS.r, tot=pcsBase(), v=pcsFiltrar(), cmp=pcsCmp(), [y,m]=r.mes.split("-").map(Number);
  const c=k=>v.filter(x=>pcsSem(x.status)===k).length;
  const k=(n,t,cl)=>`<div class="acf-k"><b${cl?` class="${cl}"`:""}>${n}</b><span>${t}</span></div>`;
  const sems={}; v.forEach(x=>{ const l=x.ini?pcsLunes(x.ini):"sin"; (sems[l]=sems[l]||[]).push(x); });
  const claves=Object.keys(sems).sort((a,b)=>a==="sin"?1:b==="sin"?-1:a<b?-1:1);
  const cuerpo=claves.map(l=>{ const f=cmp?sems[l].sort(cmp):sems[l];
    return `<tbody><tr class="pcs-sem"><th colspan="18">${pcsSemEt(l)} <i>${f.length} OF</i></th></tr>${f.map(pcsFila).join("")}</tbody>`; }).join("");
  const ed=r.puede_editar?`<details class="pcs-meta"><summary>Meta del mes</summary><div class="pcs-meta-g">${PCS_META.map(a=>`<label class="campo"><span>${a[1]}</span><input class="pcp-in" id="pcsM_${a[0].replace(/ /g,"_")}" inputmode="numeric" value="${(r.metas||{})[a[0]]?pcsN(r.metas[a[0]]):""}"></label>`).join("")}
      <button class="btn-mini" type="button" onclick="pcsGuardarMeta()">Guardar</button></div></details>`:"";
  const hay=Object.keys(PCS.f).some(z=>z!=="q"&&PCS.f[z])||PCS.f.q;
  const q=document.activeElement&&document.activeElement.id==="pcsQ";
  $("pcpCron").innerHTML=`<div class="acf-kpis">${k(v.length,"OF programadas"+(v.length!==tot.length?` de ${tot.length}`:""))}${k(c("v"),"avance 80–100 %","verde")}${k(c("a"),"avance 51–79 %","ambar")}${k(c("r"),"avance 0–50 %","rojo")}${k(v.filter(x=>x.obs.length).length,"con observación")}</div>
    <section class="pcp-card pcs"><div class="pcp-h"><h2>Cronograma de costura · ${pcsMes[m-1]} ${y}</h2>
      <div class="pcs-barra"><input class="pcp-in" id="pcsQ" type="search" placeholder="Artículo, OF o modelo" value="${esc(PCS.f.q)}" oninput="PCS.f.q=this.value;clearTimeout(PCS.tq);PCS.tq=setTimeout(pcsPintar,180)" aria-label="Buscar">
      ${hay?`<button class="btn-mini" type="button" onclick="pcsLimpiar()">Quitar filtros</button>`:""}</div></div>
    <div class="tabla-scroll"><table class="tabla pcs-t sin-orden sin-filtro"><thead><tr>${PCS_COL.map(pcsTh).join("")}</tr></thead>${cuerpo||`<tbody><tr><td colspan="18" class="acf-falta">Sin OF para este filtro.</td></tr></tbody>`}</table></div></section>${ed}`;
  if(q){ const i=$("pcsQ"); i.focus(); i.setSelectionRange(i.value.length,i.value.length); }
}
function pcsLimpiar(){ PCS.f={q:""}; pcsCerrar(); pcsPintar(); }

/* ---------- filtro tipo Excel en el encabezado ---------- */
function pcsCerrar(){ const p=$("pcsPop"); if(p) p.remove(); PCS.pop=null; document.removeEventListener("mousedown",pcsFuera,true); document.removeEventListener("keydown",pcsEsc,true); }
function pcsFuera(e){ const p=$("pcsPop"); if(p&&!p.contains(e.target)&&!(e.target.closest&&e.target.closest(".pcs-fb"))) pcsCerrar(); }
function pcsEsc(e){ if(e.key==="Escape") pcsCerrar(); }
function pcsAbrir(k,btn){
  if(PCS.pop&&PCS.pop.k===k){ pcsCerrar(); return; }
  pcsCerrar(); PCS.pop={k,q:""};
  const p=document.createElement("div"); p.id="pcsPop"; p.className="pcs-pop"; p.setAttribute("role","dialog"); p.setAttribute("aria-label","Filtrar "+PCS_COL.find(c=>c.k===k).t);
  document.body.appendChild(p); pcsPopPintar();
  const b=btn.getBoundingClientRect(), w=p.offsetWidth, h=p.offsetHeight;
  p.style.left=Math.max(8,Math.min(b.right-w,innerWidth-w-8))+"px";
  p.style.top=Math.max(8,Math.min(b.bottom+4,innerHeight-h-8))+"px";
  document.addEventListener("mousedown",pcsFuera,true); document.addEventListener("keydown",pcsEsc,true);
  const i=p.querySelector("input[type=search]"); if(i) i.focus();
}
function pcsOpciones(k){
  const c=PCS_COL.find(z=>z.k===k), cnt=new Map();
  pcsBase().filter(x=>pcsPasa(x,k)).forEach(x=>c.v(x).forEach(t=>cnt.set(t,(cnt.get(t)||0)+1)));
  return [...cnt].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"es",{numeric:true}));
}
function pcsPopPintar(){
  const P=PCS.pop, p=$("pcsPop"); if(!P||!p) return;
  const k=P.k, ops=pcsOpciones(k), ok=PCS.f[k], q=P.q.trim().toLowerCase(), vis=ops.filter(o=>!q||String(o[0]).toLowerCase().includes(q));
  const marc=o=>!ok||ok.has(o[0]), todos=vis.length&&vis.every(marc), ant=p.querySelector(".pcs-lista");
  p.innerHTML=`<div class="pcs-pop-o"><button type="button" onclick="PCS.o={k:'${k}',d:1};pcsPintar()">A → Z</button><button type="button" onclick="PCS.o={k:'${k}',d:-1};pcsPintar()">Z → A</button></div>
    <input type="search" class="pcp-in" placeholder="Buscar" value="${esc(P.q)}" oninput="PCS.pop.q=this.value;pcsPopPintar()" aria-label="Buscar valor">
    <div class="pcs-lista"><label><input type="checkbox" ${todos?"checked":""} onchange="pcsTodos(this.checked)"><span>(Seleccionar todo)</span></label>
      ${vis.map(o=>`<label><input type="checkbox" value="${esc(o[0])}" ${marc(o)?"checked":""} onchange="pcsMarcar(this)"><span title="${esc(o[0])}">${esc(o[0])}</span><i>${o[1]}</i></label>`).join("")||`<div class="pcs-vacio">Sin valores</div>`}</div>
    <div class="pcs-pop-f"><button type="button" class="btn-mini" onclick="PCS.f['${k}']=null;delete PCS.f['${k}'];pcsCerrar();pcsPintar()">Borrar filtro</button><button type="button" class="btn-mini" onclick="pcsCerrar()">Listo</button></div>`;
  if(ant){ const l=p.querySelector(".pcs-lista"); l.scrollTop=ant.scrollTop; const i=p.querySelector("input[type=search]"); i.focus(); i.setSelectionRange(i.value.length,i.value.length); }
}
function pcsMarcar(inp){
  const k=PCS.pop.k, ops=pcsOpciones(k).map(o=>o[0]), set=PCS.f[k]||new Set(ops);
  inp.checked?set.add(inp.value):set.delete(inp.value);
  PCS.f[k]=ops.every(o=>set.has(o))?null:set; if(!PCS.f[k]) delete PCS.f[k];
  pcsPintar(); pcsPopPintar();
}
function pcsTodos(on){
  const k=PCS.pop.k, ops=pcsOpciones(k).map(o=>o[0]), q=PCS.pop.q.trim().toLowerCase(), vis=ops.filter(o=>!q||String(o).toLowerCase().includes(q));
  const set=PCS.f[k]||new Set(ops); vis.forEach(o=>on?set.add(o):set.delete(o));
  if(ops.every(o=>set.has(o))) delete PCS.f[k]; else PCS.f[k]=set;
  pcsPintar(); pcsPopPintar();
}

/* ---------- detalle de una etapa: Módulo · Operaciones · Fecha de inicio · Fecha final (se pide solo al tocar el %) ---------- */
const pcsEtNom={corte:"Corte",costura:"Costura",acabado:"Acabado"};
const pcsF=f=>f?pcsDM(f):"—";
const pcsCol=p=>p>=80?"#16834A":p>=51?"#D69A16":"#CB3939";
function pcsCerrarDet(){ const o=$("pcsDet"); if(!o) return; o.classList.remove("visible"); document.removeEventListener("keydown",pcsEscDet,true);
  const b=PCS.ult; PCS.ult=null; setTimeout(()=>o.remove(),200); if(b&&document.body.contains(b)) b.focus(); }
function pcsEscDet(e){ if(e.key==="Escape") pcsCerrarDet(); }
async function pcsDetalle(of,e,area,btn){
  pcsCerrar(); const ya=$("pcsDet"); if(ya) ya.remove(); PCS.ult=btn;
  const x=(PCS.r.filas||[]).find(z=>z.o_f===of&&(e!=="costura"||z.area===area))||{};
  const etq=e==="costura"?"COSTURA · "+pcsCorto(area).toUpperCase():pcsEtNom[e].toUpperCase();
  const ov=document.createElement("div"); ov.id="pcsDet"; ov.className="modal-overlay"; ov.onclick=ev=>{ if(ev.target===ov) pcsCerrarDet(); };
  ov.innerHTML=`<div class="modal-box modal-ancho pm-box" role="dialog" aria-modal="true" aria-labelledby="pmT"><div class="pm-h"><div><small>OF ${esc(of)} › ${esc(etq)}</small><h2 id="pmT">Avance de ${pcsEtNom[e].toLowerCase()}</h2>
    <div class="pm-sub">${esc([x.articulo,x.modelo,x.color,x.cliente].filter(Boolean).join(" · "))}</div></div><button type="button" class="pm-x" onclick="pcsCerrarDet()" aria-label="Cerrar">✕</button></div>
    <div id="pmC"><div class="pm-skel"></div><div class="pm-skel"></div><div class="pm-skel"></div></div></div>`;
  document.body.appendChild(ov); void ov.offsetWidth; ov.classList.add("visible"); document.addEventListener("keydown",pcsEscDet,true);
  const x0=ov.querySelector(".pm-x"); if(x0) x0.focus();
  const c=ov.querySelector("#pmC"), k=of+"|"+e+"|"+area;
  try{
    let d=PCS.det[k];
    if(!d){ d=await rpc("fn_pcp_etapa_detalle",{p_dni:ING.dni,p_token:ING.token,p_of:of,p_etapa:e.toUpperCase(),p_area:e==="costura"?area:null});
      if(!d||!d.ok) throw new Error((d&&d.error)||"Sin datos"); PCS.det[k]=d; }
    if($("pcsDet")===ov) c.innerHTML=pcsDetHTML(d,pcsPct(x,e),e);
  }catch(er){ c.innerHTML=`<div class="acf-falta">${esc(/fn_pcp_etapa_detalle|404|PGRST202|Could not find/i.test(er.message)?"Falta correr el parche 187 en la base.":er.message)}</div>`; }
}
function pcsDetHTML(d,p,e){
  const meta=+d.meta||0, hecho=+d.hecho||0, mods=d.mods||[];
  const ini=mods.map(m=>m.ini).filter(Boolean).sort()[0], fin=mods.map(m=>m.fin).filter(Boolean).sort().pop();
  const pm=m=>meta>0?Math.min(100,Math.round((+m.hecho||0)/meta*100)):0;
  if(!mods.length) return `<div class="acf-falta">Todavía no hay registros de ${pcsEtNom[e].toLowerCase()} para esta OF.</div>`;
  return `<div class="pm-k"><div><span>Avance</span><b class="pcs-st ${pcsSem(p)}">${p==null?"—":p+" %"}</b></div>
    <div><b>${pcsN(hecho)} de ${pcsN(meta)}</b><span>prendas${d.pen_n!=null?` en la operación ${d.pen_n}`:""}</span></div>
    <div><b>${pcsF(ini)} → ${pcsF(fin)}</b><span>fecha de inicio → final</span></div></div>
    <div class="tabla-wrap"><table class="tabla bus-tabla pm-t sin-orden sin-filtro"><thead><tr><th>Módulo</th><th class="num">Operaciones</th><th class="num"><span class="pm-l">Fecha de </span>inicio</th><th class="num"><span class="pm-l">Fecha </span>final</th><th class="num">Avance</th></tr></thead><tbody>
    ${mods.map((m,j)=>{ const ops=m.ops||[], q=pm(m), nom=m.mod==="CORTE"?"Corte":m.mod;
      return `<tr class="pm-mod" onclick="pcsAlternar(this,${j})" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pcsAlternar(this,${j})}" aria-expanded="false"><td><span class="chev">▸</span>${esc(nom)}</td>
        <td class="num">${m.total!=null?`${m.con} de ${m.total}`:ops.length}</td><td class="num">${pcsF(m.ini)}</td><td class="num">${pcsF(m.fin)}</td>
        <td class="num"><div class="pm-bar"><div class="opi-barra"><i style="width:${q}%;background:${pcsCol(q)}"></i></div><b>${q} %</b></div></td></tr>`
      +ops.map(o=>`<tr class="pm-ops${o.pen?" pen":""}" data-m="${j}" hidden><td>${o.n!=null?o.n+" · ":""}${esc(o.op)}${o.pen?`<span class="pm-pen">penúltima</span>`:""}</td><td class="num">${pcsN(o.hecho)} de ${pcsN(meta)}<span class="pm-pr"> prendas</span></td><td class="num">${pcsF(o.ini)}</td><td class="num">${pcsF(o.fin)}</td><td></td></tr>`).join(""); }).join("")}</tbody></table></div>
    <div class="pm-pie"><span>${d.pen_n!=null?`El % se calcula con la operación <b>${d.pen_n}</b> (penúltima).`:"Corte aún no tiene módulos: se muestra por fecha de salida."}</span></div>`;
}
function pcsAlternar(tr,j){ const a=tr.classList.toggle("abierto"); tr.setAttribute("aria-expanded",a); document.querySelectorAll(`#pcsDet .pm-ops[data-m="${j}"]`).forEach(x=>x.hidden=!a); }
async function pcsGuardarMeta(){
  try{
    const g=a=>pcpNum($("pcsM_"+a.replace(/ /g,"_")).value)||0, m=PCS.r.metas||{}, cambios=[];
    let p=null; PCS_META.forEach(a=>{ const v=g(a[0]); if(v===(+m[a[0]]||0)) return; if(a[0]==="PLANTA") p=v; else cambios.push({alcance:"AREA",area:a[0],meta_minutos:v}); });
    if(p!=null){ const r=await rpc("fn_pcp_meta_mes_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes,p_minutos:p,p_prendas:0}); if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó"); }
    if(cambios.length){ const r=await rpc("fn_pcp_meta_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes,p_metas:cambios}); if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó"); }
    toast("Meta guardada","ok"); pcsCargar();
  }catch(e){ toast(e.message); }
}
