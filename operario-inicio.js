/* ================= CELULAR DEL OPERARIO: MENOS TOQUES =================
   La pantalla de OF pasa a ser el inicio: cómo va el día, "Sigue donde te
   quedaste" con las operaciones que hizo hoy y ayer (fn_mis_paquetes, que ya
   se pide al entrar) y la OF solo cuando es nueva. Un toque en la tarjeta
   abre los paquetes en modo marcar, con el que sigue a su último arriba.
   Las libres de cada tarjeta se completan en segundo plano bajando esas OF
   (fn_tickets_of, la misma que al abrir una OF), así que no agrega espera. */

const OPI={cargadas:false, cargando:false, bol:null};
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
  opPintarHoy(); opiPintar(); opiBoleta();
  opiCargarOFs();
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
  const d=ULTIMO_DIA||{}, prod=Number(d.minutos_prod)||0, disp=Number(d.minutos_disp)||575, nt=Number(d.tickets_hoy);
  const pct=Math.max(0,Math.min(100,Math.round(prod/disp*100))), falta=Math.max(0,Math.round(disp-prod));
  const bol=OPI.bol;
  z.innerHTML=`<div class="opi-hoy-t">Hoy: ${isNaN(nt)?"":`<b>${nt} paquete${nt===1?"":"s"}</b> · `}${Math.round(prod)} de ${Math.round(disp)} min</div>
    <div class="opi-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.round(disp)}" aria-valuenow="${Math.round(prod)}" aria-label="Minutos de hoy"><i style="width:${pct}%"></i></div>
    <div class="opi-hoy-s">${falta?`Te faltan <b>${falta} min</b> para cubrir tu jornada`:"Ya cubriste tu jornada 👏"}</div>
    ${bol?`<div class="opi-chips">${bol}</div>`:""}`;
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
  z.innerHTML=`<div class="opi-h"><span>Sigue donde te quedaste</span><small>lo último que hiciste</small></div>`
    + cards.map(({c,cargada,lib,sg},i)=>{
      const col=opiColor(c.op);
      return `<button type="button" class="opi-card" style="--opc:${col}" onclick="opiAbrir(${i})"
          aria-label="${esc(c.op)}, ${esc(c.modulo)}, OF ${esc(c.of)}${cargada?`, ${lib} libres`:""}">
        <span class="opi-tx"><b>${esc(c.op)}</b>
          <span>${esc(c.modulo)} · OF <b>${esc(c.of)}</b>${c.articulo?` · ${esc(c.articulo)}`:""}</span>
          ${sg&&sg.t?`<span>Sigue: <b>${esc(sg.t.num)}</b></span>`:""}</span>
        <span class="opi-lib">${cargada?`<b>${lib}</b>libres`:`<i class="opi-spin" aria-hidden="true"></i>`}<em aria-hidden="true">›</em></span>
      </button>`;
    }).join("");
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
/* Tras registrar: vuelve al inicio con el día y las tarjetas al día. */
async function opiTrasRegistrar(){
  const s=sesionActual(); if(!s) return;
  try{
    const mp=await rpc("fn_mis_paquetes",{p_dni:s.dni,p_token:s.token,p_area:AREA_ESTAJERO||s.area});
    if(Array.isArray(mp)){ MISPAQ=mp; aplicarBotonMisPaq(); }
  }catch(e){}
  if(pasoActivo()==="pasoOF"){ opiPintar(); opiCargarOFs(); }
}
