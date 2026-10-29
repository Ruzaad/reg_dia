/* ================= CELULAR DEL OPERARIO: MENOS TOQUES =================
   La pantalla de OF pasa a ser el inicio: cómo va el día, "Sigue donde te
   quedaste" con las operaciones que hizo hoy y ayer (fn_mis_paquetes, que ya
   se pide al entrar) y la OF solo cuando es nueva. Un toque en la tarjeta
   abre los paquetes en modo marcar, con el que sigue a su último arriba.
   Las libres de cada tarjeta se completan en segundo plano bajando esas OF
   (fn_tickets_of, la misma que al abrir una OF), así que no agrega espera. */

const OPI={cargadas:false, cargando:false, bol:null, meta:null};
const opiNum = n => { const m=String(n||"").match(/\d+/); return m?Number(m[0]):NaN; };

/* Operaciones recientes: una tarjeta por OF + módulo + operación, la más
   reciente primero. */
function opiCombos(){
  const m=new Map();
  (MISPAQ||[]).forEach(p=>{
    if(!p.of||!p.op) return;
    const k=[normKey(p.of),normKey(p.modulo),normKey(p.op)].join("|");
    if(!m.has(k)) m.set(k,{of:norm(p.of),modulo:norm(p.modulo),op:norm(p.op),articulo:norm(p.articulo),ult:p.num,n:0});
    m.get(k).n++;
  });
  return [...m.values()].filter(c=>OF_LISTA.some(o=>normKey(o.of)===normKey(c.of)));
}
function opiTickets(c){ return ALM.tickets.filter(t=>normKey(t.of)===normKey(c.of)&&t.modulo===c.modulo&&t.op===c.op); }
const opiCargada = of => { const i=OF_LISTA.find(o=>normKey(o.of)===normKey(of)); return !i || !i.sys || OF_CARGADAS.has(normKey(of)); };

/* El paquete que sigue al último que registró en esa operación. */
function opiSigue(of, modulo, op){
  const ult=(MISPAQ||[]).find(p=>normKey(p.of)===normKey(of)&&p.modulo===modulo&&p.op===op);
  if(!ult) return null;
  const desde=opiNum(ult.num);
  const libres=ALM.tickets.filter(t=>normKey(t.of)===normKey(of)&&t.modulo===modulo&&t.op===op&&libre(t));
  const sig=libres.filter(t=>opiNum(t.num)>desde).sort((a,b)=>opiNum(a.num)-opiNum(b.num))[0];
  return {ult:ult.num, t:sig||null};
}

function opInicio(){
  if(ES_ACABADO) return;
  opPintarHoy(); opiPintar(); opiBoleta(); opiMeta();
  opiCargarOFs();
}
/* Meta del día que pone PCP (parche 144). Se pide una vez al día y se guarda en el
   celular: no agrega espera. Sin meta del área no se muestra nada. */
async function opiMeta(){
  const s=sesionActual(); if(!s) return;
  const k="opi-meta-"+s.dni, hoy=hoyLimaApp();
  try{ const c=JSON.parse(localStorage.getItem(k)||"null"); if(c && c.f===hoy){ OPI.meta=c.m; opPintarHoy(); return; } }catch(e){}
  try{
    const r=await rpc("fn_mi_meta",{p_dni:s.dni,p_token:s.token});
    if(!r || r.ok===false) return;
    OPI.meta=Number(r.meta)>0 ? Number(r.meta) : null;
    try{ localStorage.setItem(k, JSON.stringify({f:hoy, m:OPI.meta})); }catch(e){}
    opPintarHoy();
  }catch(e){}
}
/* Baja en segundo plano las OF de las tarjetas para saber cuántas libres hay. */
async function opiCargarOFs(){
  if(OPI.cargando) return;
  const ofs=[...new Set(opiCombos().slice(0,6).map(c=>c.of))].filter(of=>!opiCargada(of));
  if(!ofs.length){ opiPintar(); return; }
  OPI.cargando=true;
  try{ await Promise.all(ofs.map(of=>cargarTicketsDeOF(of).catch(()=>{}))); }
  finally{ OPI.cargando=false; }
  if(pasoActivo()==="pasoOF") opiPintar();
}

function opPintarHoy(){
  const z=$("opHoy"); if(!z || ES_ACABADO) return;
  const d=ULTIMO_DIA||{}, prod=Number(d.minutos_prod)||0, tope=Number(d.minutos_disp)||575, nt=Number(d.tickets_hoy);
  const meta=Math.round(tope*0.8), ef=Math.round(prod/tope*100), falta=Math.max(0,meta-Math.round(prod)), pm=Math.min(100,Math.round(prod/meta*100));
  const niv=prod>=meta?"ok":prod>=meta*0.875?"aviso":"alerta";
  const C=100,R=78, ang=a=>{ const t=(180-a*1.8)*Math.PI/180; return [C+Math.cos(t)*R, C-Math.sin(t)*R]; };
  const pct=Math.min(100,ef/120*100), [mx,my]=ang(80/120*100), [nx,ny]=ang(pct);
  z.innerHTML=`<div class="opi-hoy-t">Mi día${isNaN(nt)?"":` · <b>${nt} paquete${nt===1?"":"s"}</b>`}</div>
    <svg class="ini-gauge-svg" viewBox="0 0 200 124" role="img" aria-label="Eficiencia ${ef} por ciento">
      <path d="M22 100 A78 78 0 0 1 178 100" class="ini-g-pista" pathLength="100"/>
      <path d="M22 100 A78 78 0 0 1 178 100" class="ini-g-val ${niv}" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100"${pct<.8?' visibility="hidden"':""}/>
      <line x1="${(C+(mx-C)*.78).toFixed(1)}" y1="${(C+(my-C)*.78).toFixed(1)}" x2="${(C+(mx-C)*1.16).toFixed(1)}" y2="${(C+(my-C)*1.16).toFixed(1)}" class="ini-g-meta"/>
      <line x1="${C}" y1="${C}" x2="${(C+(nx-C)*.8).toFixed(1)}" y2="${(C+(ny-C)*.8).toFixed(1)}" class="ini-g-aguja"/><circle cx="${C}" cy="${C}" r="5" class="ini-g-eje"/>
      <text x="${C}" y="${C-12}" class="ini-g-num" text-anchor="middle">${ef}%</text>
      <text x="${C}" y="${C-1}" class="ini-g-et" text-anchor="middle">EFICIENCIA</text>
      <text x="22" y="120" class="ini-g-ext" text-anchor="middle">0</text><text x="178" y="120" class="ini-g-ext" text-anchor="middle">120</text></svg>
    <div class="opi-min"><b>${Math.round(prod)}</b><span>min hechos</span></div>
    <div class="opi-meta1">Meta: <b>${meta} min</b> (80% de ${Math.round(tope)})</div>
    <div class="opi-fila"><div class="opi-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${meta}" aria-valuenow="${Math.round(prod)}" aria-label="Avance a tu meta"><i style="width:${pm}%"></i></div><span>${pm}%</span></div>
    <div class="opi-hoy-s">${falta?`Te faltan <b>${falta} min</b>`:"¡Llegaste a tu meta! 👏"}</div>
    ${OPI.bol?`<div class="opi-chips">${OPI.bol}</div>`:""}`;
}
/* Ayer entregado / días pendientes de la quincena (fn_mi_boleta, parche 93). */
async function opiBoleta(){
  const s=sesionActual(); if(!s) return;
  try{
    const [d,h]=bolPreset("q"), ini=new Date(Date.parse(h+"T00:00:00Z")-8*86400000).toISOString().slice(0,10);
    const r=await rpc("fn_mi_boleta",{p_dni:s.dni,p_token:s.token,p_desde:ini<d?ini:d,p_hasta:h});
    if(!r||r.ok===false) return;
    const hoy=hoyLimaApp(), dias=(r.dias||[]).filter(x=>x.fecha<hoy);
    const ayer=dias.filter(x=>x.estado==="ENTREGADO"||x.estado==="PENDIENTE").pop();
    const pend=dias.filter(x=>x.fecha>=d&&x.estado==="PENDIENTE");
    let h2="";
    if(ayer && ayer.estado==="ENTREGADO") h2+=`<button type="button" class="opi-chip ok" onclick="abrirBoleta()">✓ ${ayer===dias[dias.length-1]?"Ayer":"Último día"} entregado</button>`;
    if(pend.length){
      const f=pend[pend.length-1].fecha, dt=new Date(f+"T00:00:00Z");
      h2+=`<button type="button" class="opi-chip mal" onclick="abrirBoleta()">${pend.length} día${pend.length===1?"":"s"} pendiente${pend.length===1?"":"s"} · ${["dom","lun","mar","mié","jue","vie","sáb"][dt.getUTCDay()]} ${dt.getUTCDate()} ›</button>`;
    }
    OPI.bol=h2; opPintarHoy();
  }catch(e){}
}

function opiPintar(){
  const z=$("opSigue"); if(!z || ES_ACABADO) return;
  const combos=opiCombos();
  let cards=combos.map(c=>{
    const cargada=opiCargada(c.of), tk=cargada?opiTickets(c):[], lib=tk.filter(libre).length;
    const sg=cargada?opiSigue(c.of,c.modulo,c.op):null;
    return {c,cargada,lib,sg};
  }).filter(x=>!x.cargada || x.lib>0).slice(0,4);
  const hayCards=cards.length>0;
  $("opOtraH").textContent = hayCards ? "¿Otra OF?" : "¿En qué OF trabajas?";
  // Atajos: OF recientes.
  const rec=[...new Set((MISPAQ||[]).map(p=>norm(p.of)))].filter(of=>OF_LISTA.some(o=>normKey(o.of)===normKey(of))).slice(0,4);
  $("opRecientes").innerHTML=rec.map(of=>`<button type="button" class="opi-of" onclick="abrirOF('${esc(of)}')">${esc(of)}</button>`).join("");
  if(!hayCards){ z.innerHTML=""; return; }
  const tarj=({c,cargada,lib,sg},i)=>{
      const col=opiColor(c.op);
      return `<button type="button" class="opi-card" style="--opc:${col}" onclick="opiAbrir(${i})"
          aria-label="${esc(c.op)}, ${esc(c.modulo)}, OF ${esc(c.of)}${cargada?`, ${lib} libres`:""}">
        <span class="opi-tx"><b>${esc(c.op)}</b>
          <span>${esc(c.modulo)} · OF <b>${esc(c.of)}</b>${c.articulo?` · ${esc(c.articulo)}`:""}</span>
          ${sg&&sg.t?`<span>Sigue: <b>${esc(sg.t.num)}</b></span>`:""}</span>
        <span class="opi-lib">${cargada?`<b>${lib}</b>libres`:`<i class="opi-spin" aria-hidden="true"></i>`}<em aria-hidden="true">›</em></span>
      </button>`; };
  const x0=cards[0], otras=cards.length-1;
  z.innerHTML = OPI.abierto
    ? `<button type="button" class="opi-h opi-h-btn" onclick="OPI.abierto=false;opiPintar()"><span>Sigue donde te quedaste</span><em aria-hidden="true">⌃</em></button>`+cards.map(tarj).join("")
    : `<div class="opi-col"><button type="button" class="opi-col-main" onclick="opiAbrir(0)"><i style="background:${opiColor(x0.c.op)}"></i>
        <span><small>Sigue donde te quedaste</small><b>${esc(x0.c.op)}</b><span>OF ${esc(x0.c.of)} · ${esc(x0.c.modulo)}</span></span><em aria-hidden="true">›</em></button>
        ${otras>0?`<button type="button" class="opi-col-mas" onclick="OPI.abierto=true;opiPintar()">Ver otras ${otras} ⌄</button>`:""}</div>`;
  OPI.cards=cards.map(x=>x.c);
}
/* Mismo color para la misma operación, para reconocerla de un vistazo. */
function opiColor(op){
  const P=["#2E7D6B","#7B4FD6","#C0662B","#2F6FD0","#B03A6E","#5E8C2A"];
  let h=2166136261; for(const ch of String(op)){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619)>>>0; }
  return P[h%P.length];
}
let OPI_ABRIENDO=false;
async function opiAbrir(i){
  const c=(OPI.cards||[])[i]; if(!c || OPI_ABRIENDO) return;
  OPI_ABRIENDO=true;
  try{
    if(!opiCargada(c.of) || OPADX.of!==c.of){
      pintarCargando($("opSigue"),"Abriendo OF "+c.of+"…");
      await Promise.all([cargarTicketsDeOF(c.of), cargarOpAdOF(c.of)]);
    }
  }catch(e){ mostrarError(e.message); OPI_ABRIENDO=false; opiPintar(); return; }
  OPI_ABRIENDO=false;
  sel.of=c.of; sel.modulo=c.modulo; sel.op=c.op;
  modoSel=true; marcados={}; OPI.tomados=false;
  pintarTickets(); irA("pasoTickets"); window.scrollTo(0,0);
  opiPintar();
}
/* Tras registrar: deja al día "Tus operaciones" y las tarjetas del inicio. */
async function opiTrasRegistrar(){
  const s=sesionActual(); if(!s) return;
  try{
    const mp=await rpc("fn_mis_paquetes",{p_dni:s.dni,p_token:s.token,p_area:AREA_ESTAJERO||s.area});
    if(Array.isArray(mp)){ MISPAQ=mp; aplicarBotonMisPaq(); }
  }catch(e){}
  if(pasoActivo()==="pasoOF"){ opiPintar(); opiCargarOFs(); }
  else if(pasoActivo()==="pasoOps" && sel.of && sel.modulo) pintarOperaciones();
}
