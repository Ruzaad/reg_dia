/* =====================================================================
   CHRONOS · Cronogramas (parche 152)
   Dos modos: subir los archivos de PCP (cronograma de corte, NOTI_CORTE,
   programa de costura) o calcular con lo real:
     · corte → costura: una OF pasa a costura cuando lo cortado llega a lo requerido;
     · acabado: lo que costura entrega en su penúltima operación, por línea
       (Camisería, Saco, Pantalón), contra lo hecho y la capacidad de ACABADO.
   ===================================================================== */
let CRO={modo:"real", r:null, sub:"", q:""};
const CRO_SUB={CAMISERIA:"Camisería",SACO:"Saco",PANTALON:"Pantalón",OTRO:"Sin línea"};
const CRO_EST={DISPONIBLE:["ok","Disponible"],INCOMPLETO:["warn","Incompleto"],"SIN CORTE":["gris","Sin corte"]};

function croInit(){
  const d=$("croDesde"), h=$("croHasta");
  if(d && !d.value){ const [y,m]=hoyLima().split("-").map(Number); d.value=new Date(y,m-1,1).toLocaleDateString("sv-SE"); h.value=new Date(y,m,0).toLocaleDateString("sv-SE"); }
  croModo(CRO.modo);
}
function croModo(m){
  CRO.modo=m;
  $("croModoReal").classList.toggle("activo",m==="real"); $("croModoArch").classList.toggle("activo",m==="arch");
  $("croArch").hidden=m!=="arch"; $("croReal").hidden=m!=="real";
  if(m==="real") croCargar();
}
/* Reusa las cargas de PCP y copia su estado aquí. */
function croSubir(fn, input){
  const pm=$("pcpMes"); if(pm && !pm.value) pm.value=hoyLima().slice(0,7);
  const e=$("croEstado"), src=$("pcpEstado"); if(src) src.textContent="";
  e.textContent="Leyendo el archivo…"; e.className="pcp-estado";
  fn(input);
  let n=0; const t=setInterval(()=>{
    n++; if(src && src.textContent){ e.textContent=src.textContent; e.className=src.className; }
    if((src && /\b(ok|err)\b/.test(src.className)) || n>120){ clearInterval(t); }
  },500);
}

async function croCargar(){
  if(CRO.modo!=="real") return;
  const box=$("croReal"), d=$("croDesde").value, h=$("croHasta").value;
  if(!d||!h) return;
  box.innerHTML=cargandoHTML("Armando los cronogramas con lo real…");
  try{
    const r=await rpc("fn_pcp_cronos",{p_dni:ING.dni,p_token:ING.token,p_desde:d,p_hasta:h});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    CRO.r=r; croPintar();
  }catch(e){
    box.innerHTML=/fn_pcp_cronos|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 152 en la base.</b></div>`
      : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}

function croPintar(){
  const r=CRO.r, kp=(v,t,c)=>`<div class="acf-k"><b${c?` class="${c}"`:""}>${v}</b><span>${t}</span></div>`;
  const C=r.corte||[], n=e=>C.filter(x=>x.estado===e).length;
  const pill=e=>{ const x=CRO_EST[e]||["gris",e]; return `<span class="pcp-pill ${x[0]}">${x[1]}</span>`; };
  const filas=C.map(x=>{ const p=x.requerido?Math.min(100,Math.round(x.cortado/x.requerido*100)):0;
    return `<tr data-q="${esc((x.o_f+" "+(x.articulo||"")+" "+(x.cliente||"")).toLowerCase())}"><td><b>${esc(x.o_f)}</b></td><td>${esc(x.articulo||"")}</td><td>${esc((x.cliente||"").slice(0,24))}</td><td>${esc(pcpCorto(x.area||""))}</td>
      <td class="num">${pcpN(x.requerido)}</td><td class="num">${pcpN(x.cortado)}</td>
      <td class="nw"><span class="cro-bar"><i class="${p>=100?"ok":""}" style="width:${p}%"></i></span> ${p} %</td>
      <td>${x.completo?pcpDM(x.completo):"—"}</td><td>${pcpDM(x.ini_costura)}</td><td>${pill(x.estado)}</td></tr>`; }).join("");
  const corte=`<section class="pcp-card"><div class="pcp-h"><h2>Corte → costura</h2></div>
    <p class="seccion-sub">Una OF queda disponible para costura cuando lo cortado (NOTI_CORTE) llega a lo requerido. «Completo» es el día en que se llegó a esa cantidad.</p>
    <div class="acf-kpis">${kp(n("DISPONIBLE"),"disponibles para costura","verde")}${kp(n("INCOMPLETO"),"con corte incompleto",n("INCOMPLETO")?"rojo":"")}${kp(n("SIN CORTE"),"sin corte todavía")}</div>
    <div class="gt-bar"><input type="search" class="gt-filtro" placeholder="Filtrar por OF, artículo o cliente" oninput="croFiltrar(this.value)" aria-label="Filtrar corte"></div>
    <div class="tabla-scroll pcp-alto"><table class="tabla pcp-tabla" id="croTabCorte"><thead><tr><th>OF</th><th>Artículo</th><th>Cliente</th><th>Área</th><th class="num">Requerido</th><th class="num">Cortado</th><th>Avance</th><th>Completo</th><th>Costura plan</th><th>Estado</th></tr></thead>
    <tbody>${filas||`<tr><td colspan="10" class="tenue">Sin OF con corte o programa en estas fechas.</td></tr>`}</tbody></table></div></section>`;

  const S=r.semanas||[], subs=["CAMISERIA","SACO","PANTALON"], sum=o=>Object.values(o||{}).reduce((a,b)=>a+(+b||0),0);
  const semFilas=S.map(s=>`<tr><th scope="row">${pcpDM(s.ini)} – ${pcpDM(s.fin)}</th>${subs.map(k=>`<td class="num">${pcpN((s.llega||{})[k])}</td>`).join("")}
      <td class="num"><b>${pcpN(sum(s.llega))}</b></td><td class="num">${pcpN(sum(s.hecho))}</td><td class="num">${pcpN(s.capacidad)}</td>
      <td class="num ${s.capacidad&&sum(s.llega)<s.capacidad*.8?"rojo":""}">${s.capacidad?Math.round(sum(s.llega)/s.capacidad*100)+" %":"—"}</td></tr>`).join("");
  const acab=`<section class="pcp-card"><div class="pcp-h"><h2>Acabado: carga por semana</h2></div>
    <p class="seccion-sub">Llega = prendas de la penúltima operación de costura × S.A.M de la base de ACABADO del artículo. Capacidad = personas MOD de ACABADO en la estructura × jornada. Carga baja de la capacidad = falta trabajo.</p>
    <div class="pcp-graf"><canvas id="croGSem" role="img" aria-label="Carga semanal de acabado"></canvas></div>
    <div class="tabla-scroll"><table class="tabla pcp-tabla"><thead><tr><th>Semana</th>${subs.map(k=>`<th class="num">Llega ${CRO_SUB[k]}</th>`).join("")}<th class="num">Llega total</th><th class="num">Hecho</th><th class="num">Capacidad</th><th class="num">Carga</th></tr></thead>
    <tbody>${semFilas}</tbody></table></div></section>`;

  $("croReal").innerHTML=corte+acab+`<section class="pcp-card" id="croSecGantt"></section>`;
  croGantt(); croGrafico();
}
function croFiltrar(v){
  const q=String(v||"").trim().toLowerCase();
  document.querySelectorAll("#croTabCorte tbody tr[data-q]").forEach(f=>{ f.hidden=!!q && !f.dataset.q.includes(q); });
}
function croGrafico(){
  const S=CRO.r.semanas||[], su=pcpColor("--suave");
  const col={CAMISERIA:pcpColor("--azul"),SACO:pcpColor("--exito"),PANTALON:pcpColor("--dorado")};
  const sum=o=>Object.values(o||{}).reduce((a,b)=>a+(+b||0),0);
  pcpGrafico("croGSem",{type:"bar",data:{labels:S.map(s=>`${pcpDM(s.ini)}–${pcpDM(s.fin)}`),datasets:[
    ...["CAMISERIA","SACO","PANTALON"].map(k=>({label:"Llega "+CRO_SUB[k],data:S.map(s=>(s.llega||{})[k]||0),backgroundColor:col[k],stack:"l",order:3})),
    {type:"line",label:"Hecho en acabado",data:S.map(s=>sum(s.hecho)),borderColor:pcpColor("--texto"),backgroundColor:pcpColor("--texto"),pointRadius:3,borderWidth:2,order:1},
    {type:"line",label:"Capacidad",data:S.map(s=>s.capacidad),borderColor:su,backgroundColor:su,borderDash:[6,4],pointRadius:0,borderWidth:2,order:2}]},
    options:{scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true,title:{display:true,text:"minutos",color:su}}}}});
}
function croSubFiltro(s){ CRO.sub=s; croGantt(); }
function croGantt(){
  const r=CRO.r, box=$("croSecGantt"); if(!box) return;
  const G=(r.ofs||[]).filter(x=>!CRO.sub||x.sub===CRO.sub);
  const sinBase=(r.ofs||[]).filter(x=>x.sin_base).length;
  const chips=["","CAMISERIA","SACO","PANTALON"].map(k=>`<button type="button" class="btn-mini ${CRO.sub===k?"":"gris"}" onclick="croSubFiltro('${k}')">${k?CRO_SUB[k]:"Todas"}</button>`).join(" ");
  const cab=`<div class="pcp-h"><h2>Acabado por OF</h2><div>${chips}</div></div>
    <p class="seccion-sub">Arriba, los días en que costura entregó (penúltima operación). Abajo, los días con tickets en ACABADO.${sinBase?` <b class="rojo">${sinBase} OF sin base de ACABADO</b>: entran sin minutos hasta que se cargue su base.`:""}</p>`;
  if(!G.length){ box.innerHTML=cab+`<p class="seccion-sub">No llegó nada de costura en estas fechas.</p>`; return; }
  const a=pcpDn(r.desde), b=pcpDn(r.hasta), n=b-a+1, hoy=pcpDn(r.hoy);
  const pos=d=>Math.max(0,Math.min(100,(d-a)/n*100)), anc=(d1,d2)=>Math.max(1.2,pos(d2+1)-pos(d1));
  const ticks=[]; for(let d=a;d<=b;d++){ if(new Date(d*864e5).getUTCDay()===1 || d===a) ticks.push(d); }
  const barra=(cls,i,f,tit,txt,pct)=>{ if(!i) return ""; const d1=pcpDn(i), d2=pcpDn(f||i);
    return `<div class="gt-b ${cls}" style="left:${pos(d1)}%;width:${anc(d1,d2)}%" title="${esc(tit)}">${pct!=null?`<i style="width:${Math.min(100,pct)}%"></i>`:""}<span>${esc(txt||"")}</span></div>`; };
  const filas=G.map(x=>{ const p=x.minutos?Math.round(x.hecho/x.minutos*100):null;
    return `<div class="gt-f"><div class="gt-l"><b>${esc(x.o_f)}</b> · ${esc(x.articulo||"")}<span>${CRO_SUB[x.sub]||x.sub} · ${pcpN(x.prendas)} prendas · ${x.sin_base?"sin base":pcpN(x.minutos)+" min"}</span></div>
      <div class="gt-g">${barra("gt-corte",x.llega_ini,x.llega_fin,`Costura entregó ${pcpDM(x.llega_ini)} – ${pcpDM(x.llega_fin)} · ${pcpN(x.prendas)} prendas`,"")}
        ${barra("gt-cos",x.acab_ini,x.acab_fin,`Acabado ${pcpDM(x.acab_ini)} – ${pcpDM(x.acab_fin)} · ${pcpN(x.hecho)} min${p!=null?" ("+p+" %)":""}`,p!=null?p+" %":"",p)}</div></div>`; }).join("");
  box.innerHTML=cab+`<div class="gt-leyenda"><span><i class="gt-k corte"></i>Llega de costura</span><span><i class="gt-k cos"></i>Acabado (relleno = % hecho)</span><span><i class="gt-k hoy"></i>Hoy</span></div>
    <div class="gt-scroll"><div class="gt" style="--n:${n}"><div class="gt-f gt-h"><div class="gt-l">OF · artículo</div><div class="gt-g gt-eje">${ticks.map(d=>`<span style="left:${pos(d)}%">${pcpDM(pcpIso(d))}</span>`).join("")}</div></div>
      <div class="gt-cuerpo">${filas}${hoy>=a&&hoy<=b?`<div class="gt-hoy" style="left:${pos(hoy+.5)}%"></div>`:""}</div></div></div>`;
}
