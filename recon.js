/* =====================================================================
   CHRONOS · Reconocimientos por quincena (Ingeniería)
   Top 5 por área de quienes entregaron todas sus boletas y rindieron más de 80 %.
   Las cifras salen tal cual de fn_incentivos_quincena (Bonificaciones): eficiencia promedio,
   categoría y boletas. Publicar guarda el top (parche 184) para que cada operario lo vea.
   ===================================================================== */
let RC={ref:null,d:null,pub:null,o:{k:0,d:1},f:{},err:null,carga:false};
const RC_MIN=80, RC_TOP=5;
const rcF=(y,m,d)=>new Date(Date.UTC(y,m,d)).toISOString().slice(0,10);
const rcDM=f=>f.slice(8,10)+"/"+f.slice(5,7);
const rcMes=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const rcCorto=a=>String(a||"").replace(" COSTURA","");
function rcRango(){
  const [y,m,d]=RC.ref.split("-").map(Number), p=d<=15, a=rcF(y,m-1,p?1:16), fin=p?rcF(y,m-1,15):rcF(y,m,0), hoy=hoyLima();
  return {desde:a,fin,hasta:fin>hoy?hoy:fin,abierta:fin>=hoy,et:`${p?"1ra":"2da"} quincena de ${rcMes[m-1]} ${y}`};
}
function rcMover(n){
  const [y,m,d]=RC.ref.split("-").map(Number); let f;
  if(d<=15) f=n>0?rcF(y,m-1,16):rcF(y,m-2,16); else f=n>0?rcF(y,m,1):rcF(y,m-1,1);
  RC.ref=f>hoyLima()?hoyLima():f; rcCargar();
}
function rcInit(){ if(!RC.ref){ const h=hoyLima(), d=+h.slice(8); RC.ref=d<=15?(rcF(+h.slice(0,4),+h.slice(5,7)-2,16)):(rcF(+h.slice(0,4),+h.slice(5,7)-1,1)); } rcCargar(); }
async function rcCargar(){
  const R=rcRango(); RC.d=null; RC.pub=null; RC.err=null; RC.R=R; rcPintar();
  const clave=R.desde+Date.now(); RC.clave=clave;
  try{
    const r=await rpc("fn_incentivos_quincena",{p_dni:ING.dni,p_token:ING.token,p_desde:R.desde,p_hasta:R.hasta,p_area:""});
    if(RC.clave!==clave) return;
    if(!r||!r.ok){ RC.err=(r&&r.error)||"Error"; RC.d=[]; } else RC.d=rcTop(r.personas||[]);
  }catch(e){ if(RC.clave!==clave) return; RC.err=e.message; RC.d=[]; }
  rcPintar();
  try{
    const p=await rpc("fn_reconocimientos",{p_dni:ING.dni,p_token:ING.token,p_desde:R.desde});
    if(RC.clave!==clave) return; RC.pub=p&&p.ok?p.items:(/Could not find|PGRST202/i.test(JSON.stringify(p||""))?"falta":null);
  }catch(e){ if(RC.clave!==clave) return; RC.pub=/Could not find|PGRST202|fn_reconocimientos/i.test(e.message)?"falta":null; }
  rcPintar();
}
/* Top 5 por área: sin supervisoras ni cesados, con todas sus boletas (sin NO ENTREGO) y eficiencia mayor a 80. */
function rcTop(P){
  const por={};
  P.filter(x=>!x.supervisora&&!x.cesado&&x.area!=="UDP"&&!(+x.boleta>0)&&x.prom_ef!=null&&+x.prom_ef>RC_MIN)
   .forEach(x=>(por[x.area]=por[x.area]||[]).push(x));
  const out=[];
  Object.keys(por).sort().forEach(a=>por[a].sort((p,q)=>+q.prom_ef-+p.prom_ef).slice(0,RC_TOP)
    .forEach((x,i)=>out.push({puesto:i+1,dni:x.dni,nombre:x.nombre,area:a,categoria:x.categoria||"",ef:+(+x.prom_ef).toFixed(1),bono:+x.final||0,pen:!!x.penalizado})));
  return out;
}
function rcPublicar(){
  const R=RC.R; if(!RC.d||!RC.d.length) return;
  if(!confirm(`¿Publicar el reconocimiento de la ${R.et}?\n\nCada operario reconocido lo verá en su cuenta.`)) return;
  rpc("fn_reconocimiento_publicar",{p_dni:ING.dni,p_token:ING.token,p_desde:R.desde,p_hasta:R.fin,
    p_items:RC.d.map(x=>({dni:x.dni,area:x.area,puesto:x.puesto,ef:x.ef,categoria:x.categoria}))})
  .then(r=>{ if(!r||!r.ok){ mostrarError((r&&r.error)||"No se pudo publicar"); return; } mostrarOk(`${r.publicados} operarios reconocidos publicados`); rcCargar(); })
  .catch(e=>mostrarError(/Could not find|PGRST202|fn_reconocimiento/i.test(e.message)?"Falta correr el parche 184 en la base":e.message));
}
const RC_COL=["Puesto","Operario","Área","Categoría","Eficiencia","Bonificación"];
const rcCel=(x,i)=>[x.puesto,x.nombre,rcCorto(x.area),x.categoria||"—",x.ef,x.bono][i];
function rcOrden(i){ RC.o=RC.o.k===i?{k:i,d:-RC.o.d}:{k:i,d:1}; $("rcTabla").innerHTML=""; rcTabla(); }
function rcFiltro(i,v){ RC.f[i]=v.toLowerCase(); rcTabla(); }
function rcTabla(){
  const z=$("rcTabla"); if(!z||!RC.d) return;
  let F=RC.d.filter(x=>RC_COL.every((_,i)=>!RC.f[i]||String(rcCel(x,i)).toLowerCase().includes(RC.f[i])));
  F=F.sort((a,b)=>{ const p=rcCel(a,RC.o.k), q=rcCel(b,RC.o.k); return (p>q?1:p<q?-1:0)*RC.o.d; });
  const body=F.map(x=>`<tr><td><span class="rc-pu">${x.puesto}</span></td><td class="izq"><b>${esc(x.nombre)}</b></td><td class="izq">${esc(rcCorto(x.area))}</td><td>${esc(x.categoria||"—")}</td><td>${String(x.ef).replace(".",",")} %</td><td>S/ ${x.bono.toFixed(2)}</td></tr>`).join("")||`<tr><td colspan="6"><div class="vacio-msg">Sin reconocidos</div></td></tr>`;
  const tb=z.querySelector("tbody"), foco=document.activeElement&&z.contains(document.activeElement)&&document.activeElement.classList.contains("tb-f");
  if(tb&&foco){ tb.innerHTML=body; return; }
  z.innerHTML=`<table class="tabla sin-orden sin-filtro"><thead><tr>${RC_COL.map((t,i)=>`<th class="${i===1||i===2?"izq":""}" onclick="rcOrden(${i})">${t}${RC.o.k===i?(RC.o.d>0?" ▲":" ▼"):""}<input class="tb-f" value="${esc(RC.f[i]||"")}" placeholder="Filtrar" onclick="event.stopPropagation()" oninput="rcFiltro(${i},this.value)"></th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}
function rcPintar(){
  const R=RC.R||rcRango(), h=$("rcCab"); if(!h) return;
  h.innerHTML=`<div class="tb-nav"><button type="button" aria-label="Anterior" onclick="rcMover(-1)">‹</button><b>${esc(R.et)}</b>
    <button type="button" aria-label="Siguiente" onclick="rcMover(1)" ${R.fin>=hoyLima()?"disabled":""}>›</button></div>
    <span class="rc-est ${R.abierta?"a":"c"}">${R.abierta?"En curso":"Cerrada"}</span>`;
  const z=$("rcKpis"), c=$("rcAreas"); if(!z||!c) return;
  if(!RC.d){ z.innerHTML=""; c.innerHTML=`<div class="vacio-msg">Calculando…</div>`; $("rcTabla").innerHTML=""; return; }
  const areas=[...new Set(RC.d.map(x=>x.area))], mx=RC.d.reduce((s,x)=>Math.max(s,x.ef),0), pub=Array.isArray(RC.pub)&&RC.pub.length;
  z.innerHTML=`<div class="tb-k" style="--c:var(--azul)"><small>Operarios reconocidos</small><b>${RC.d.length}</b><span class="tb-s">top ${RC_TOP} de cada área</span><em>Bonificaciones › Eficiencia y boletas</em></div>
    <div class="tb-k" style="--c:var(--azul)"><small>Áreas con reconocidos</small><b>${areas.length}</b><span class="tb-s">con eficiencia mayor a ${RC_MIN} %</span><em>Bonificaciones › Áreas</em></div>
    <div class="tb-k" style="--c:var(--azul)"><small>Eficiencia más alta</small><b>${RC.d.length?String(mx).replace(".",",")+" %":"—"}</b><span class="tb-s">promedio de la quincena</span><em>Bonificaciones › Prom. eficiencia</em></div>
    <div class="tb-k" style="--c:${pub?"var(--exito)":"var(--ocre)"}"><small>Estado</small><b>${RC.pub==="falta"?"—":pub?"Publicado":"Sin publicar"}</b><span class="tb-s">${RC.pub==="falta"?"falta el parche 184":pub?"ya lo ven los operarios":"los operarios aún no lo ven"}</span>
      ${RC.pub==="falta"||!RC.d.length?"":`<button type="button" class="btn-primario rc-pub" onclick="rcPublicar()">${pub?"Volver a publicar":"Publicar"}</button>`}</div>`;
  if(RC.err){ c.innerHTML=`<div class="acf-falta">${esc(RC.err)}</div>`; $("rcTabla").innerHTML=""; return; }
  c.innerHTML=areas.map(a=>`<section class="ini-card rc-area"><div class="ini-card-h"><b>${esc(rcCorto(a))}</b></div>
    ${RC.d.filter(x=>x.area===a).map(x=>`<div class="rc-fila"><span class="rc-pu">${x.puesto}</span><span class="rc-n">${esc(x.nombre)}<small>${esc(x.categoria||"Sin categoría")}</small></span>
      <div class="rc-bar"><i style="width:${Math.min(100,x.ef)}%"></i></div><b>${String(x.ef).replace(".",",")} %</b></div>`).join("")}</section>`).join("")||`<div class="vacio-msg">Nadie cumple todavía en esta quincena</div>`;
  rcTabla();
}
