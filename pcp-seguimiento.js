/* =====================================================================
   CHRONOS · Ingeniería › PCP › seguimiento (parche 146)
   Cronograma de corte (PDF), cumplimiento corte/costura, Gantt por OF de lo que
   arranca costura sin corte completo, minutaje semanal, minutaje y eficiencia
   diaria, y el endpoint para que PCP mida sus tiempos reales.
   Una sola RPC de lectura (fn_pcp_seguimiento) y las de claves del endpoint.
   ===================================================================== */
let PCPS={r:null, ch:{}};
const PCPS_PDFJS="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const pcpDn=s=>Math.round(Date.parse(String(s).slice(0,10)+"T00:00:00Z")/864e5);
const pcpIso=n=>new Date(n*864e5).toISOString().slice(0,10);

/* ---------- PDF del cronograma de corte ---------- */
/* paginas: [[{s,x,y,w}]] (texto con posición). Las columnas salen de la fila de cabeceras de cada página y cada
   registro se ancla en su fecha de inicio de corte; lo que sobra en otra línea (cliente o material partidos) se
   suma al registro más cercano en vertical. */
function pcpParsearCronograma(paginas){
  const COLS=["pedido","cliente","of","cantidad","articulo","material","ini_corte","fin_corte","ini_costura","obs"];
  const fechaIso=s=>{ const m=String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:null; };
  const out=[];
  paginas.forEach(items=>{
    const it=items.filter(i=>String(i.s).trim()).map(i=>({s:String(i.s).trim(),x:i.x,y:i.y,c:i.x+i.w/2}));
    const hp=it.find(i=>i.s==="Pedido"); if(!hp) return;
    const hy=hp.y, fo=it.find(i=>/^Generado/.test(i.s)), fy=fo?fo.y+3:-1e9;
    const cab=it.filter(i=>Math.abs(i.y-hy)<=10).sort((a,b)=>a.c-b.c), grupos=[];
    cab.forEach(i=>{ const g=grupos[grupos.length-1]; if(g && i.c-g.c<=14){ g.c=(g.c*g.n+i.c)/(g.n+1); g.n++; } else grupos.push({c:i.c,n:1}); });
    if(grupos.length<COLS.length-1) return;   // Observaciones puede venir vacía pero su cabecera siempre está
    const cuerpo=it.filter(i=>i.y<hy-12 && i.y>fy);
    const anclas=cuerpo.filter(i=>/^\d{2}-\d{2}-\d{4}$/.test(i.s) && Math.abs(i.c-grupos[6].c)<=18).sort((a,b)=>b.y-a.y);
    if(!anclas.length) return;
    const reg=anclas.map(a=>({y:a.y,cel:COLS.map(()=>[])}));
    cuerpo.forEach(i=>{
      let r=reg[0]; reg.forEach(q=>{ if(Math.abs(q.y-i.y)<Math.abs(r.y-i.y)) r=q; });
      let k=0; grupos.forEach((g,j)=>{ if(Math.abs(g.c-i.c)<Math.abs(grupos[k].c-i.c)) k=j; });
      r.cel[k].push(i);
    });
    reg.forEach(r=>{
      const t=k=>r.cel[k].sort((a,b)=>b.y-a.y||a.x-b.x).map(i=>i.s).join(" ").trim();
      const of=t(2), cant=Number(t(3).replace(/[^\d.]/g,""));
      out.push({pedido:t(0),cliente:t(1),of:/^\d+$/.test(of)?of:"",cantidad:cant||0,articulo:t(4),material:t(5),
        ini_corte:fechaIso(t(6)),fin_corte:fechaIso(t(7)),ini_costura:fechaIso(t(8)),obs:COLS.length>9?t(9):""});
    });
  });
  return out.filter(f=>f.articulo && f.ini_corte);
}
async function pcpCargarPdfJs(){
  if(window.pdfjsLib) return;
  await new Promise((ok,ko)=>{ const s=document.createElement("script"); s.src=PCPS_PDFJS+"pdf.min.js"; s.onload=ok;
    s.onerror=()=>ko(new Error("No cargó el lector de PDF (revisa tu conexión y vuelve a intentar)")); document.head.appendChild(s); });
  pdfjsLib.GlobalWorkerOptions.workerSrc=PCPS_PDFJS+"pdf.worker.min.js";
}
async function pcpSubirCronograma(input){
  const file=input.files[0]; input.value=""; if(!file) return;
  try{
    pcpEstado("Leyendo "+file.name+"…");
    await pcpCargarPdfJs();
    const doc=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise, pags=[];
    for(let i=1;i<=doc.numPages;i++){
      const t=await (await doc.getPage(i)).getTextContent();
      pags.push(t.items.map(x=>({s:x.str,x:x.transform[4],y:x.transform[5],w:x.width})));
    }
    const filas=pcpParsearCronograma(pags);
    if(!filas.length) throw new Error("no encontré filas con las columnas Pedido, Cliente, OF, Cantidad, Artículo y fechas");
    pcpEstado(`Subiendo ${filas.length} órdenes del cronograma…`);
    const r=await rpc("fn_pcp_cronograma_cargar",{p_dni:ING.dni,p_token:ING.token,p_archivo:file.name,p_filas:filas});
    if(!r || !r.ok) throw new Error((r&&r.error)||"No se subió");
    pcpEstado(`Cronograma subido: ${r.filas} órdenes`,"ok"); pcpCargar();
  }catch(e){ pcpEstado("No se subió el cronograma: "+(e.message||e),"err"); }
}

/* ---------- carga y pintado ---------- */
async function pcpSeguimiento(){
  const box=$("pcpSeg"); if(!box) return;
  const mes=($("pcpMes").value||hoyLima().slice(0,7))+"-01";
  box.innerHTML=cargandoHTML("Armando el seguimiento…");
  try{
    const r=await rpc("fn_pcp_seguimiento",{p_dni:ING.dni,p_token:ING.token,p_mes:mes});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    PCPS.r=r; pcpSegPintar(r);
  }catch(e){
    box.innerHTML=/fn_pcp_seguimiento|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 146 en la base.</b> El seguimiento usa <code>fn_pcp_seguimiento</code>.</div>`
      : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}
function pcpColor(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim()||"#888"; }
function pcpGrafico(id,cfg){
  const cv=$(id); if(!cv || typeof Chart==="undefined") return;
  if(PCPS.ch[id]) PCPS.ch[id].destroy();
  const txt=pcpColor("--suave"), lin=pcpColor("--linea");
  cfg.options=Object.assign({responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false}},cfg.options||{});
  cfg.options.plugins=Object.assign({legend:{position:"bottom",labels:{color:txt,usePointStyle:true,boxWidth:8,padding:14}}},cfg.options.plugins||{});
  cfg.options.scales=cfg.options.scales||{};
  Object.keys(cfg.options.scales).forEach(k=>{ const s=cfg.options.scales[k]; s.ticks=Object.assign({color:txt},s.ticks||{}); s.grid=Object.assign({color:lin},s.grid||{}); });
  PCPS.ch[id]=new Chart(cv,cfg);
}
const PCP_EST={"A TIEMPO":["ok","A tiempo"],"TARDE":["warn","Tarde"],"ATRASADO":["crit","Atrasado"],"SIN ARRANCAR":["crit","Sin arrancar"],
  "EN CURSO":["warn","En curso"],"PENDIENTE":["gris","Pendiente"],"SIN OF":["gris","Sin OF"]};
const pcpPill=e=>{ const x=PCP_EST[e]||["gris",e||"—"]; return `<span class="pcp-pill ${x[0]}">${x[1]}</span>`; };
const pcpRango=(a,b)=>a||b?`${pcpDM(a)} – ${pcpDM(b)}`:"—";

function pcpSegPintar(r){
  const cr=r.cronograma||[], cp=(r.planes||{}).CRONOGRAMA, ed=PCP.r&&PCP.r.puede_editar;
  const cnt=(k,v)=>cr.filter(x=>x[k]===v).length;
  const ct=["A TIEMPO","TARDE","ATRASADO"].reduce((s,e)=>s+cnt("e_corte",e),0), cs=["A TIEMPO","TARDE","SIN ARRANCAR"].reduce((s,e)=>s+cnt("e_costura",e),0);
  const kp=(v,t,c)=>`<div class="acf-k"><b${c?` class="${c}"`:""}>${v}</b><span>${t}</span></div>`;
  const pc=(a,b)=>b?Math.round(a/b*100)+" %":"—";
  const falta=cr.filter(x=>x.falta_corte).length;

  const tabla=cr.map(x=>`<tr${x.falta_corte?` class="pcp-fila-crit"`:""}><td>${esc(x.o_f||"SIN OF")}</td><td>${esc(x.articulo)}</td><td>${esc(x.cliente||"")}</td>
      <td class="num">${pcpN(x.cantidad)}</td><td>${pcpRango(x.ini_corte,x.fin_corte)}</td><td class="num">${pcpN(x.cortado)}</td>
      <td>${x.corte_fin_real?pcpDM(x.corte_fin_real):x.corte_ini_real?"desde "+pcpDM(x.corte_ini_real):"—"}</td><td>${pcpPill(x.e_corte)}</td>
      <td>${pcpDM(x.ini_costura)}</td><td>${x.costura_ini_real?pcpDM(x.costura_ini_real)+(x.costura_avance!=null?` · ${x.costura_avance} %`:""):"—"}</td><td>${pcpPill(x.e_costura)}</td></tr>`).join("");
  const cumpl=`<section class="pcp-card"><div class="pcp-h"><h2>Cumplimiento del cronograma de corte y costura</h2></div>
    <p class="seccion-sub">${cp?`Cronograma «${esc(cp.archivo||"")}» subido el ${pcpDM(String(cp.cargado_en).slice(0,10))} (${cp.filas} órdenes).`:"PCP todavía no sube su cronograma de corte (PDF)."}
    Corte: lo cortado según NOTI_CORTE contra la fecha de fin planificada. Costura: primer día con tickets de costura de esa OF contra el inicio planificado.
    Las filas «SIN OF» se cruzan por artículo y no se puede medir su costura.</p>
    ${cr.length?`<div class="acf-kpis">${kp(pc(cnt("e_corte","A TIEMPO"),ct),"corte cerrado a tiempo ("+cnt("e_corte","A TIEMPO")+" de "+ct+")",ct&&cnt("e_corte","A TIEMPO")/ct<.8?"rojo":"verde")}
      ${kp(pc(cnt("e_costura","A TIEMPO"),cs),"costura iniciada a tiempo ("+cnt("e_costura","A TIEMPO")+" de "+cs+")",cs&&cnt("e_costura","A TIEMPO")/cs<.8?"rojo":"verde")}
      ${kp(falta,"OF en costura sin corte completo",falta?"rojo":"verde")}${kp(cr.length,"órdenes en el cronograma")}</div>
    <div class="pcp-graf"><canvas id="pcpGCump" role="img" aria-label="Estado de corte y costura del cronograma"></canvas></div>
    <div class="tabla-scroll pcp-alto"><table class="tabla pcp-tabla"><thead><tr><th>OF</th><th>Artículo</th><th>Cliente</th><th class="num">Cantidad</th><th>Corte plan</th>
      <th class="num">Cortado</th><th>Corte real</th><th>Corte</th><th>Inicio costura</th><th>Costura real</th><th>Costura</th></tr></thead><tbody>${tabla}</tbody></table></div>`:""}</section>`;

  const semanas=(r.semanas||[]);
  const sem=`<section class="pcp-card"><div class="pcp-h"><h2>Minutaje semanal: compromiso contra demanda</h2></div>
    <p class="seccion-sub">Compromiso = meta del mes repartida por días laborables de la semana. Demanda = minutos del programa de costura cuyo fin de costura cae en la semana.
    Real = minutos producidos.</p>
    <div class="pcp-graf"><canvas id="pcpGSem" role="img" aria-label="Minutaje semanal"></canvas></div>
    <div class="tabla-scroll"><table class="tabla pcp-tabla"><thead><tr><th>Semana</th><th class="num">Compromiso</th><th class="num">Demanda</th><th class="num">Real</th><th class="num">Real / compromiso</th><th class="num">Real / demanda</th></tr></thead>
    <tbody>${semanas.map((s,i)=>`<tr><th scope="row">S${i+1} · ${pcpDM(s.ini)} – ${pcpDM(s.fin)}${s.cerrada?"":" (en curso)"}</th><td class="num">${pcpN(s.meta)}</td><td class="num">${pcpN(s.programa)}</td><td class="num">${pcpN(s.real)}</td>
      <td class="num ${s.cerrada&&s.meta&&s.real<s.meta?"rojo":""}">${pc(s.real,s.meta)}</td><td class="num ${s.cerrada&&s.programa&&s.real<s.programa?"rojo":""}">${pc(s.real,s.programa)}</td></tr>`).join("")}</tbody></table></div></section>`;

  const dia=`<section class="pcp-card"><div class="pcp-h"><h2>Minutaje y eficiencia diaria</h2></div>
    <p class="seccion-sub">Disponible = personas MOD de la estructura del mes × jornada. Eficiencia = minutos producidos ÷ disponibles. La línea punteada es la eficiencia que exige la meta.</p>
    <div class="pcp-graf"><canvas id="pcpGDia" role="img" aria-label="Minutos por día"></canvas></div>
    <div class="pcp-graf pcp-graf-b"><canvas id="pcpGEf" role="img" aria-label="Eficiencia diaria"></canvas></div></section>`;

  $("pcpSeg").innerHTML=cumpl+pcpGanttHTML(r)+sem+dia+(ed?pcpApiHTML():"");
  pcpGraficos(r,cr);
  if(ed) pcpClavesCargar();
}

function pcpGraficos(r,cr){
  const azul=pcpColor("--azul"), dor=pcpColor("--dorado"), ok=pcpColor("--exito"), mal=pcpColor("--alerta"), av=pcpColor("--aviso"), su=pcpColor("--suave"), li=pcpColor("--linea");
  const cnt=(k,v)=>cr.filter(x=>x[k]===v).length;
  const est=[["A TIEMPO","A tiempo",ok],["TARDE","Tarde",av],["ATRASADO","Atrasado / sin arrancar",mal],["EN CURSO","En curso",azul],["PENDIENTE","Pendiente",li],["SIN OF","Sin OF (no medible)",su]];
  pcpGrafico("pcpGCump",{type:"bar",data:{labels:["Corte","Costura"],datasets:est.map(([k,n,c])=>({label:n,backgroundColor:c,
    data:[cnt("e_corte",k), k==="ATRASADO"?cnt("e_costura","SIN ARRANCAR"):cnt("e_costura",k)]}))},
    options:{indexAxis:"y",scales:{x:{stacked:true,title:{display:true,text:"órdenes",color:su},ticks:{precision:0}},y:{stacked:true}}}});
  const sm=r.semanas||[];
  pcpGrafico("pcpGSem",{type:"bar",data:{labels:sm.map((s,i)=>`S${i+1} ${pcpDM(s.ini)}–${pcpDM(s.fin)}`),datasets:[
    {label:"Compromiso (meta)",data:sm.map(s=>s.meta),backgroundColor:dor},
    {label:"Demanda (programa)",data:sm.map(s=>s.programa),backgroundColor:su},
    {label:"Real",data:sm.map(s=>s.real),backgroundColor:azul}]},
    options:{scales:{y:{beginAtZero:true,title:{display:true,text:"minutos",color:su}}}}});
  const d=r.dias||[], lab=d.map(x=>String(x.f).slice(8,10)), ef=d.map(x=>x.lab&&x.disp&&x.real>0?Math.round(x.real/x.disp*1000)/10:null);
  pcpGrafico("pcpGDia",{type:"bar",data:{labels:lab,datasets:[
    {label:"Producido",data:d.map(x=>x.lab?x.real:null),backgroundColor:azul,order:3},
    {type:"line",label:"Meta del día",data:d.map(x=>x.meta),borderColor:dor,backgroundColor:dor,pointRadius:2,borderWidth:2,order:1},
    {type:"line",label:"Disponible",data:d.map(x=>x.disp),borderColor:su,backgroundColor:su,borderDash:[5,4],pointRadius:0,borderWidth:1.5,order:2}]},
    options:{scales:{y:{beginAtZero:true,title:{display:true,text:"minutos",color:su}},x:{title:{display:true,text:"día del mes",color:su}}}}});
  const exig=d.map(x=>x.meta&&x.disp?Math.round(x.meta/x.disp*1000)/10:null);
  pcpGrafico("pcpGEf",{type:"line",data:{labels:lab,datasets:[
    {label:"Eficiencia del día (%)",data:ef,borderColor:azul,backgroundColor:azul,pointRadius:3,borderWidth:2,spanGaps:true},
    {label:"Eficiencia que exige la meta (%)",data:exig,borderColor:dor,backgroundColor:dor,borderDash:[6,4],pointRadius:0,borderWidth:2}]},
    options:{scales:{y:{beginAtZero:true,title:{display:true,text:"% de los minutos disponibles",color:su}},x:{title:{display:true,text:"día del mes",color:su}}}}});
}

/* ---------- Gantt por OF ---------- */
function pcpGanttHTML(r){
  const g=r.gantt||[];
  const cab=`<div class="pcp-h"><h2>OF que arrancan costura sin corte completo</h2></div>
    <p class="seccion-sub">Ordenadas por OF. Cada fila muestra el corte planificado (cronograma) con lo ya cortado, el corte real y la costura programada.
    La línea roja es hoy.</p>`;
  if(!g.length) return `<section class="pcp-card">${cab}<p class="seccion-sub">No hay OF por arrancar costura (en los próximos 10 días) con corte incompleto.</p></section>`;
  const fs=[]; g.forEach(x=>["ini_corte","fin_corte","ini_costura","fin_costura","corte_ini_real","corte_fin_real","costura_ini_real"].forEach(k=>{ if(x[k]) fs.push(pcpDn(x[k])); }));
  const hoy=pcpDn(r.hoy);
  const a=Math.max(Math.min(...fs,hoy)-2,hoy-30), b=Math.min(Math.max(...fs,hoy)+2,hoy+50), n=b-a+1;
  const pos=d=>Math.max(0,Math.min(100,(d-a)/n*100)), anc=(d1,d2)=>Math.max(1.2,pos(d2+1)-pos(d1));
  const ticks=[]; for(let d=a;d<=b;d++){ if(new Date(d*864e5).getUTCDay()===1 || d===a) ticks.push(d); }
  const barra=(cls,i,f,tit,txt,pct)=>{ if(!i||!f) return ""; const d1=pcpDn(i), d2=pcpDn(f);
    return `<div class="gt-b ${cls}" style="left:${pos(d1)}%;width:${anc(d1,d2)}%" title="${esc(tit)}">${pct!=null?`<i style="width:${Math.min(100,pct)}%"></i>`:""}<span>${esc(txt||"")}</span></div>`; };
  const filas=g.map(x=>{
    const pCorte=x.cant_prog?Math.round(x.cortado/x.cant_prog*100):0, sinPlan=!x.ini_corte;
    const real=x.corte_ini_real?`<div class="gt-real" style="left:${pos(pcpDn(x.corte_ini_real))}%;width:${anc(pcpDn(x.corte_ini_real),pcpDn(x.corte_fin_real||x.corte_ini_real))}%" title="Corte real: ${pcpDM(x.corte_ini_real)} – ${pcpDM(x.corte_fin_real)}"></div>`:"";
    return `<div class="gt-f"><div class="gt-l"><b>${esc(x.o_f)}</b> · ${esc(x.articulo)}<span>${esc((x.cliente||"").slice(0,26))} · ${esc(pcpCorto(x.area))} · cortado ${pcpN(x.cortado)}/${pcpN(x.cant_prog)}</span></div>
      <div class="gt-g">
        ${barra("gt-corte",x.ini_corte,x.fin_corte,`Corte planificado ${pcpDM(x.ini_corte)} – ${pcpDM(x.fin_corte)} · cortado ${pCorte} %`,pCorte+" %",pCorte)}
        ${sinPlan?`<div class="gt-sin" title="Esta OF no está en el cronograma de corte">sin cronograma de corte</div>`:""}
        ${real}
        ${barra("gt-cos",x.ini_costura,x.fin_costura,`Costura programada ${pcpDM(x.ini_costura)} – ${pcpDM(x.fin_costura)}${x.costura_avance!=null?" · avance "+x.costura_avance+" %":""}`,x.costura_avance?x.costura_avance+" %":"",x.costura_avance||0)}
      </div></div>`;
  }).join("");
  const head=ticks.map(d=>`<span style="left:${pos(d)}%">${pcpDM(pcpIso(d))}</span>`).join("");
  return `<section class="pcp-card">${cab}
    <div class="gt-leyenda" aria-label="Leyenda"><span><i class="gt-k corte"></i>Corte planificado (relleno = % cortado)</span><span><i class="gt-k real"></i>Corte real (primer a último día)</span>
      <span><i class="gt-k cos"></i>Costura programada (relleno = avance)</span><span><i class="gt-k hoy"></i>Hoy</span></div>
    <div class="tabla-scroll"><div class="gt" style="--n:${n}"><div class="gt-f gt-h"><div class="gt-l">OF · artículo</div><div class="gt-g gt-eje">${head}</div></div>
      <div class="gt-cuerpo">${filas}<div class="gt-hoy" style="left:${pos(hoy+.5)}%" title="Hoy ${pcpDM(r.hoy)}"></div></div></div></div></section>`;
}

/* ---------- endpoint para PCP ---------- */
function pcpApiHTML(){
  const url=`${SUPABASE_URL}/rest/v1/rpc/fn_pcp_api`, mes=hoyLima().slice(0,7)+"-01";
  const curl=`curl -X POST "${url}" \\\n  -H "apikey: ${SUPABASE_ANON}" -H "Authorization: Bearer ${SUPABASE_ANON}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"p_clave":"TU_CLAVE","p_mes":"${mes}"}'`;
  return `<section class="pcp-card"><div class="pcp-h"><h2>Endpoint para PCP</h2></div>
    <p class="seccion-sub">PCP (u otro sistema) consulta aquí el plan contra lo real y recalcula sus tiempos cada vez que cambie el cronograma o el programa.
    Cada respuesta trae <code>planes</code> con el archivo y la hora de cada carga, para detectar que el plan cambió. Parámetros: <code>p_clave</code> (obligatorio), <code>p_mes</code> (primer día del mes) y <code>p_of</code> (una sola OF o artículo, opcional).
    Devuelve <code>cronograma</code> (corte y costura planificado y real por OF), <code>gantt</code>, <code>semanas</code>, <code>dias</code> (meta, disponible, real, personas) y <code>resumen</code>.</p>
    <pre class="pcp-code" tabindex="0">${esc(curl)}</pre>
    <div class="fer-form"><label class="campo"><span>Nombre de la clave nueva</span><input id="pcpClaveNom" maxlength="80" placeholder="Ej. Planeamiento — Excel de seguimiento"></label>
      <button type="button" class="btn-mini" onclick="pcpClaveCrear()">Crear clave</button></div>
    <div id="pcpClaveNueva"></div><div id="pcpClaves"></div></section>`;
}
async function pcpClaveCrear(){
  const nom=$("pcpClaveNom").value.trim(); if(!nom){ toast("Ponle un nombre a la clave"); return; }
  try{
    const r=await rpc("fn_pcp_api_clave_crear",{p_dni:ING.dni,p_token:ING.token,p_nombre:nom});
    if(!r || !r.ok) throw new Error((r&&r.error)||"No se creó");
    $("pcpClaveNom").value="";
    $("pcpClaveNueva").innerHTML=`<div class="pcp-al warn"><i aria-hidden="true"></i><div><b>Copia la clave ahora: no se vuelve a mostrar</b><span><code class="pcp-clave" id="pcpClaveTxt">${esc(r.clave)}</code>
      <button type="button" class="btn-mini gris" onclick="navigator.clipboard.writeText($('pcpClaveTxt').textContent).then(()=>toast('Clave copiada','ok'))">Copiar</button></span></div></div>`;
    pcpClavesCargar();
  }catch(e){ toast(e.message); }
}
async function pcpClavesCargar(){
  const box=$("pcpClaves"); if(!box) return;
  try{
    const r=await rpc("fn_pcp_api_claves",{p_dni:ING.dni,p_token:ING.token});
    if(!r || !r.ok) throw new Error((r&&r.error)||"Error");
    const c=r.claves||[];
    box.innerHTML=c.length?`<div class="tabla-scroll"><table class="tabla pcp-tabla"><thead><tr><th>Nombre</th><th>Creada</th><th>Último uso</th><th>Estado</th><th></th></tr></thead><tbody>${c.map(k=>
      `<tr><td>${esc(k.nombre)}</td><td>${pcpDM(String(k.creada_en).slice(0,10))}</td><td>${k.ultimo_uso?pcpDM(String(k.ultimo_uso).slice(0,10)):"nunca"}</td>
      <td>${k.activa?`<span class="pcp-pill ok">Activa</span>`:`<span class="pcp-pill gris">Revocada</span>`}</td>
      <td>${k.activa?`<button type="button" class="btn-mini gris" onclick="pcpClaveRevocar(${k.id})">Revocar</button>`:""}</td></tr>`).join("")}</tbody></table></div>`:"";
  }catch(e){ box.innerHTML=""; }
}
async function pcpClaveRevocar(id){
  if(!confirm("¿Revocar esta clave? Quien la use dejará de poder consultar.")) return;
  try{
    const r=await rpc("fn_pcp_api_clave_revocar",{p_dni:ING.dni,p_token:ING.token,p_id:id});
    if(!r || !r.ok) throw new Error((r&&r.error)||"No se revocó");
    toast("Clave revocada","ok"); pcpClavesCargar();
  }catch(e){ toast(e.message); }
}
if(typeof module!=="undefined") module.exports={pcpParsearCronograma};
