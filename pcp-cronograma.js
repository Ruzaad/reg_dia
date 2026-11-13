/* PCP · Cronograma de costura (parche 178). Programa de costura + STD de la base + avance real de la penúltima operación. */
const PCS={mes:"",r:null,f:{q:""},o:{k:"",d:1},pop:null};
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
    pcsPintar();
  }catch(e){
    box.innerHTML=/fn_pcp_costura|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 178 en la base.</b></div>` : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}
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
  {k:"status",t:"Status",n:1,v:x=>[pcsStEt(x)],o:x=>x.status==null?-1:x.status},
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
  const of=x.o_f?`<button type="button" class="pcs-of" onclick="pcsOf('${esc(x.o_f)}')" aria-label="Ver avance de la OF ${esc(x.o_f)}">${esc(x.o_f)}</button>`:"—";
  return `<tr><td>${esc(x.planta)}</td><td>${esc(pcsCorto(x.area))}</td><td>${esc(x.prenda)}</td><td>${esc(x.cliente)}</td><td><b>${esc(x.articulo)}</b></td><td>${esc(x.modelo)}</td><td>${esc(x.color)}</td>
    <td class="num">${of}</td><td class="num">${pcsDM(x.target)}</td><td class="num">${pcsN(x.cant_prog)}</td><td class="num">${x.std!=null?(+x.std).toFixed(1).replace(".",","):"—"}</td>
    <td class="num" title="${esc(tip)}">${x.dias!=null?String(x.dias).replace(".",","):"—"}</td><td class="num">${pcsDM(x.ini)}</td><td class="num">${pcsDM(x.fin)}</td>
    <td class="num">${x.status!=null?`<span class="pcs-st ${s}">${x.status} %</span>`:"—"}</td><td class="pcs-obs">${ob}</td></tr>`;
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
    return `<tbody><tr class="pcs-sem"><th colspan="16">${pcsSemEt(l)} <i>${f.length} OF</i></th></tr>${f.map(pcsFila).join("")}</tbody>`; }).join("");
  const ed=r.puede_editar?`<details class="pcs-meta"><summary>Meta del mes</summary><div class="pcs-meta-g">${PCS_META.map(a=>`<label class="campo"><span>${a[1]}</span><input class="pcp-in" id="pcsM_${a[0].replace(/ /g,"_")}" inputmode="numeric" value="${(r.metas||{})[a[0]]?pcsN(r.metas[a[0]]):""}"></label>`).join("")}
      <button class="btn-mini" type="button" onclick="pcsGuardarMeta()">Guardar</button></div></details>`:"";
  const hay=Object.keys(PCS.f).some(z=>z!=="q"&&PCS.f[z])||PCS.f.q;
  const q=document.activeElement&&document.activeElement.id==="pcsQ";
  $("pcpCron").innerHTML=`<div class="acf-kpis">${k(v.length,"OF programadas"+(v.length!==tot.length?` de ${tot.length}`:""))}${k(c("v"),"avance 80–100 %","verde")}${k(c("a"),"avance 51–79 %","ambar")}${k(c("r"),"avance 0–50 %","rojo")}${k(v.filter(x=>x.obs.length).length,"con observación")}</div>
    <section class="pcp-card pcs"><div class="pcp-h"><h2>Cronograma de costura · ${pcsMes[m-1]} ${y}</h2>
      <div class="pcs-barra"><input class="pcp-in" id="pcsQ" type="search" placeholder="Artículo, OF o modelo" value="${esc(PCS.f.q)}" oninput="PCS.f.q=this.value;clearTimeout(PCS.tq);PCS.tq=setTimeout(pcsPintar,180)" aria-label="Buscar">
      ${hay?`<button class="btn-mini" type="button" onclick="pcsLimpiar()">Quitar filtros</button>`:""}</div></div>
    <div class="tabla-scroll"><table class="tabla pcs-t sin-orden sin-filtro"><thead><tr>${PCS_COL.map(pcsTh).join("")}</tr></thead>${cuerpo||`<tbody><tr><td colspan="16" class="acf-falta">Sin OF para este filtro.</td></tr></tbody>`}</table></div></section>${ed}`;
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

/* ---------- panel lateral de la OF: Corte → Costura → Acabado ---------- */
function pcsCerrarOf(){ const p=$("pcsOf"); if(!p) return; p.classList.remove("on"); setTimeout(()=>p.remove(),260); document.removeEventListener("keydown",pcsEscOf,true); }
function pcsEscOf(e){ if(e.key==="Escape") pcsCerrarOf(); }
async function pcsOf(of){
  pcsCerrar(); const ya=$("pcsOf"); if(ya) ya.remove();
  const p=document.createElement("div"); p.id="pcsOf"; p.className="pcs-of-p";
  p.innerHTML=`<div class="pcs-of-bg" onclick="pcsCerrarOf()"></div><aside role="dialog" aria-label="Avance de la OF ${esc(of)}"><button type="button" class="pcs-of-x" onclick="pcsCerrarOf()" aria-label="Cerrar">✕</button><div class="pcs-of-c">${cargandoHTML("Cargando OF…")}</div></aside>`;
  document.body.appendChild(p); void p.offsetWidth; p.classList.add("on"); document.addEventListener("keydown",pcsEscOf,true);
  const c=p.querySelector(".pcs-of-c");
  try{
    const r=await rpc("fn_pcp_of_avance",{p_dni:ING.dni,p_token:ING.token,p_of:of});
    if(!r||!r.ok) throw new Error((r&&r.error)||"Sin datos");
    c.innerHTML=pcsOfHTML(r); pcsOfAnimar(p);
  }catch(e){ c.innerHTML=`<div class="acf-falta">${esc(/fn_pcp_of_avance|404|PGRST202|Could not find/i.test(e.message)?"Falta correr el parche 180 en la base.":e.message)}</div>`; }
}
function pcsOfHTML(r){
  const et=[];
  const progr=(r.costura||[]).reduce((t,z)=>t+(+z.cant||0),0);
  if(r.corte&&(r.corte.meta||r.corte.hecho)) et.push({t:"Corte",m:+r.corte.meta||progr||+r.corte.hecho||0,h:+r.corte.hecho||0,a:r.corte.ini,b:r.corte.fin});
  (r.costura||[]).forEach(z=>et.push({t:pcsCorto(z.area)+" · costura",m:+z.cant||0,h:+z.hecho||0,a:z.desde||z.ini,b:z.ult||z.fin}));
  if(r.acabado&&+r.acabado.meta) et.push({t:"Acabado",m:+r.acabado.meta,h:+r.acabado.hecho||0,a:r.acabado.desde,b:r.acabado.ult});
  const pc=e=>e.m>0?Math.min(100,Math.round(e.h/e.m*100)):0, tot=et.length?Math.round(et.reduce((s,e)=>s+pc(e),0)/et.length):0;
  const col=p=>p>=80?"v":p>=51?"a":"r";
  return `<div class="pcs-of-h"><small>OF</small><h3>${esc(r.of)}</h3><p>${esc([r.articulo,r.modelo,r.color].filter(Boolean).join(" · "))}</p><p class="cl">${esc(r.cliente||"")}</p></div>
    <div class="pcs-of-tot"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.9" class="bg"/><circle cx="18" cy="18" r="15.9" class="fg ${col(tot)}" pathLength="100" data-p="${tot}"/></svg><div><b data-n="${tot}">0</b><span>% avance de la OF</span></div></div>
    <ol class="pcs-of-l">${et.map((e,i)=>`<li style="--i:${i}"><span class="pt ${e.h>0?col(pc(e)):""}"></span><div class="cd"><div class="t"><b>${esc(e.t)}</b><em class="${col(pc(e))}">${pc(e)} %</em></div>
      <div class="bar"><i class="${col(pc(e))}" data-p="${pc(e)}"></i></div><div class="n"><span><b data-n="${e.h}">0</b> de ${pcsN(e.m)} prendas</span><span>${e.a?pcsDM(e.a)+(e.b&&e.b!==e.a?" – "+pcsDM(e.b):""):"Sin registros"}</span></div></div></li>`).join("")||`<li class="vacio">Sin datos de esta OF.</li>`}</ol>`;
}
function pcsOfAnimar(p){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    p.querySelectorAll(".bar i").forEach(i=>i.style.width=i.dataset.p+"%");
    p.querySelectorAll("circle.fg").forEach(c=>c.style.strokeDashoffset=100-c.dataset.p);
  }));
  const red=matchMedia("(prefers-reduced-motion: reduce)").matches;
  p.querySelectorAll("[data-n]").forEach(b=>{ const n=+b.dataset.n; if(red||!n){ b.textContent=pcsN(n); return; }
    const t0=performance.now(), d=900; (function f(t){ const k=Math.min(1,(t-t0)/d); b.textContent=pcsN(n*(1-Math.pow(1-k,3))); if(k<1) requestAnimationFrame(f); })(t0); });
}
async function pcsGuardarMeta(){
  try{
    const g=a=>pcpNum($("pcsM_"+a.replace(/ /g,"_")).value)||0, m=PCS.r.metas||{}, cambios=[];
    let p=null; PCS_META.forEach(a=>{ const v=g(a[0]); if(v===(+m[a[0]]||0)) return; if(a[0]==="PLANTA") p=v; else cambios.push({alcance:"AREA",area:a[0],meta_minutos:v}); });
    if(p!=null){ const r=await rpc("fn_pcp_meta_mes_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes,p_minutos:p,p_prendas:0}); if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó"); }
    if(cambios.length){ const r=await rpc("fn_pcp_meta_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes,p_metas:cambios}); if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó"); }
    toast("Meta guardada","ok"); pcsCargar();
  }catch(e){ toast(e.message); }
}
