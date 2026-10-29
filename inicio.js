/* =====================================================================
   CHRONOS · Inicio de Ingeniería (solo lectura)
   Al entrar dice cómo va el día de las áreas de la persona (eficiencia de
   planta, minutos, prendas, personal) y qué necesita su atención. Usa las
   mismas RPC de las pestañas más fn_inicio_prendas (parche 148); cada tarjeta
   se pinta sola cuando llega su respuesta y todo lleva a la pestaña que ya existe.
   ===================================================================== */
let INI={todas:false, d:{}, t0:0, tiempos:{}, meta:85, timer:null};
const INI_CORTO=a=>String(a||"").replace(" COSTURA","");
const INI_DIAS=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const INI_MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function iniFechaTxt(iso,larga){ const [y,m,d]=iso.split("-").map(Number); const f=new Date(y,m-1,d);
  return larga ? `${INI_DIAS[f.getDay()]} ${d} de ${INI_MESES[m-1]}` : `${INI_DIAS[f.getDay()]} ${d}`; }
/* Día hábil anterior: el lunes mira el viernes. */
function iniAyer(hoy){ const [y,m,d]=hoy.split("-").map(Number); const f=new Date(y,m-1,d);
  do{ f.setDate(f.getDate()-1); }while(f.getDay()===0||f.getDay()===6);
  return f.toLocaleDateString("sv-SE"); }
/* Boletas: antes del cierre la de hoy todavía no está completa, así que se mira la de ayer. */
const iniFechaBoletas=()=> bolFaltaCierre(hoyLima())!=null ? iniAyer(hoyLima()) : hoyLima();

/* Qué ve cada quien: sus áreas de edición; si lee todas, puede abrirlas todas. */
function iniAreas(){
  const todas=(AREAS_LISTA||[]).filter(a=>a && a!=="INGENIERIA");
  if(PERM_LIBRE()) return todas;
  const mias=areasEdita().filter(a=>todas.includes(a));
  if(mias.length && !INI.todas) return mias;
  return leeTodas() ? todas : todas.filter(puedeLeer);
}
const iniPuede=tab=>tabPermitida(tab);
function iniHayAlgo(){ return ["pasoBolSin","pasoAudit","pasoIncid","pasoEf","pasoAsis","pasoDash"].some(iniPuede); }

function iniRpc(clave, fn, args){
  const t=performance.now();
  return rpc(fn, Object.assign({p_dni:ING.dni,p_token:ING.token}, args))
    .then(r=>{ INI.tiempos[clave]=Math.round(performance.now()-t); INI.d[clave]=r; iniPintar(); return r; })
    .catch(e=>{ INI.tiempos[clave]=Math.round(performance.now()-t); INI.d[clave]={ok:false,error:e.message}; iniPintar(); });
}
function iniCargar(){
  const hoy=hoyLima(), ayer=iniAyer(hoy), fb=iniFechaBoletas();
  INI.d={}; INI.tiempos={}; INI.t0=performance.now(); INI.hoy=hoy; INI.ayer=ayer; INI.fb=fb;
  iniPintar();
  if(iniPuede("pasoBolSin")) iniRpc("bol","fn_boletas_sin_llenar",{p_fecha:fb,p_area:null})
    .then(r=>{ if(r && r.ok) bslNav((r.personas||[]).length, fb); });
  if(iniPuede("pasoAsis")||iniPuede("pasoDash")) iniRpc("asis","fn_asistencia_matriz",{p_area:"",p_desde:hoy,p_hasta:hoy});
  if(iniPuede("pasoEf")) iniRpc("ef","fn_eficiencia_areas",{p_desde:hoy,p_hasta:hoy})
    .then(()=>setTimeout(()=>iniRpc("efa","fn_eficiencia_areas",{p_desde:ayer,p_hasta:ayer}),400));   // ayer va después: no frena lo primero
  iniRpc("pre","fn_inicio_prendas",{p_fecha:hoy});
  if(iniPuede("pasoAudit")) iniRpc("aud","fn_ef_auditoria_v2",{p_desde:ayer,p_hasta:ayer,p_area:"",p_umbral:AUD_ANORMAL,p_pico:20});
  if(iniPuede("pasoIncid")) iniRpc("sol","fn_solicitudes_listar",{p_area:""});
  if(iniPuede("pasoBolSin")) iniRpc("fer","fn_dias_no_laborables",{p_desde:ferSuma(hoy,-45),p_hasta:hoy})   // parche 120
    .then(r=>{ if(r && r.ok) ferNav(r); });
  clearInterval(INI.timer);   // se refresca solo cada 10 min mientras Inicio esté a la vista
  INI.timer=setInterval(()=>{ const p=$("pasoInicio"); if(p && p.classList.contains("activa") && !document.hidden) iniCargar(); },600000);
}

/* ---------- cálculo por área (solo con lo que devuelven las RPC) ---------- */
function iniPorArea(areas){
  const d=INI.d, M={};
  areas.forEach(a=>M[a]={area:a});
  if(d.bol && d.bol.ok) (d.bol.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].bol=x; });
  if(d.ef && d.ef.ok) (d.ef.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].ef=x; });
  if(d.pre && d.pre.ok) (d.pre.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].pre=+x.prendas||0; });
  if(d.aud && d.aud.ok) (d.aud.items||[]).forEach(x=>{ if(M[x.area] && x.ef>=AUD_ANORMAL) M[x.area].aud=(M[x.area].aud||0)+1; });
  if(d.sol && d.sol.ok) (d.sol.items||[]).forEach(x=>{ if(M[x.area]) M[x.area].sol=(M[x.area].sol||0)+1; });
  if(d.asis && d.asis.ok) (d.asis.personal||[]).forEach(p=>{
    const m=M[p.area]; if(!m) return; const e=(p.registros||{})[INI.hoy];
    m.as=m.as||{tot:0,marc:0,pres:0,otra:0,falta:0};
    m.as.tot++; if(!e) return; m.as.marc++;
    if(e==="FALTA") m.as.falta++;
    else if(/^EN /.test(e)){ m.as.pres++; if(!INI_CORTO(p.area).startsWith(e.slice(3,7))) m.as.otra++; }   // EN SACOS en SACO es su propia área
    else if(e==="ACTIVO") m.as.pres++;
  });
  return areas.map(a=>M[a]);
}
/* Lo que necesita atención, de lo más grande a lo más chico. */
function iniAvisos(F){
  const L=[], chips=(k,f)=>F.filter(x=>f(x)>0).map(x=>`<span class="ini-chip"><i data-a="${esc(x.area)}"></i>${esc(INI_CORTO(x.area))} <b>${f(x)}</b></span>`).join("");
  const suma=f=>F.reduce((s,x)=>s+(f(x)||0),0);
  const fb=INI.fb===INI.hoy?"hoy":"el "+iniFechaTxt(INI.fb);
  if(INI.d.bol && INI.d.bol.ok){ const f=x=>x.bol?x.bol.pendientes:0, n=suma(f);
    if(n) L.push({n, tab:"pasoBolSin", ir:"Boletas sin llenar", tipo:"alerta",
      txt:`${n===1?"persona no llenó":"personas no llenaron"} su boleta ${fb}`, chips:chips("bol",f)}); }
  if(INI.d.asis && INI.d.asis.ok){ const f=x=>x.as&&x.as.tot&&x.as.marc<x.as.tot/2?x.as.tot-x.as.marc:0, n=suma(f);
    if(n) L.push({n, tab:iniPuede("pasoAsis")?"pasoAsis":"pasoDash", ir:iniPuede("pasoAsis")?"Personal":"Tableros", tipo:"aviso",
      txt:`${n===1?"persona sigue":"personas siguen"} sin asistencia marcada hoy`, chips:chips("as",f),
      nota:"Sin marca cuentan como ACTIVO en la eficiencia; una falta no marcada no se ve."}); }
  if(INI.d.fer && INI.d.fer.ok){   // parche 120: trabajaron en sábado, domingo o feriado y nadie puso sus horas
    const M={}; (INI.d.fer.dias||[]).forEach(d=>ferPend(d).forEach(p=>{ if(F.some(x=>x.area===p.area)) M[p.area]=(M[p.area]||0)+1; }));
    const n=Object.values(M).reduce((a,b)=>a+b,0);
    if(n) L.push({n, tab:"pasoFeriados", ir:"Feriados y fin de semana", tipo:"alerta",
      txt:`${n===1?"persona trabajó":"personas trabajaron"} en sábado, domingo o feriado y no tiene${n===1?"":"n"} sus horas`, chips:chips("fer",x=>M[x.area]||0),
      nota:"Hasta ponerlas, su disponible de ese día es 0."}); }
  if(INI.d.aud && INI.d.aud.ok){ const f=x=>x.aud||0, n=suma(f);
    if(n) L.push({n, tab:"pasoAudit", ir:"Auditoría", tipo:"aviso",
      txt:`${n===1?"persona pasó":"personas pasaron"} el ${AUD_ANORMAL}% de eficiencia el ${iniFechaTxt(INI.ayer)}`, chips:chips("aud",f)}); }
  if(INI.d.sol && INI.d.sol.ok){ const f=x=>x.sol||0, n=suma(f);
    if(n) L.push({n, tab:"pasoIncid", ir:"Incidencias", tipo:"info",
      txt:`${n===1?"solicitud de ajuste espera":"solicitudes de ajuste esperan"} respuesta`, chips:chips("sol",f)}); }
  return L.sort((a,b)=>({alerta:0,aviso:1,info:2}[a.tipo]-({alerta:0,aviso:1,info:2}[b.tipo]))||b.n-a.n);
}

/* ---------- pintado ---------- */
const iniEspera=()=>`<span class="ini-esp" aria-label="Cargando"></span>`;
const iniN=n=>Math.round(+n||0).toLocaleString("es-PE").replace(/,/g," ");
const iniNivel=v=>v>=INI.meta?"ok":v>=70?"aviso":"alerta";
const IC={chk:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',shield:'<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',cal:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  msg:'<path d="M4 5h16v11H9l-5 4z"/>',users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5.5a3 3 0 0 1 0 5.6M18 14c2 .6 3.5 2.6 3.5 5"/>'};
const iniIco=k=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]||IC.chk}</svg>`;
/* Minutos de la jornada ya corridos hoy (hora de Lima, sin el refrigerio 13:00–13:45) sobre los 575 del turno. */
function iniFraccion(){
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:"America/Lima",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  const t=(+p.find(x=>x.type==="hour").value%24)*60+(+p.find(x=>x.type==="minute").value);
  const w=Math.max(0,Math.min(t,1100)-480)-Math.max(0,Math.min(t,825)-780);
  return {f:Math.min(1,w/575), hora:String(Math.floor(t/60)).padStart(2,"0")+":"+String(t%60).padStart(2,"0")};
}
/* Minutos y disponible del conjunto de áreas (el disponible sale de minutos ÷ eficiencia de la misma RPC). */
function iniPlanta(F,k){
  const d=INI.d[k]; if(!d||!d.ok) return null; let m=0,disp=0;
  F.forEach(x=>{ const e=((d.areas||[]).find(y=>y.area===x.area)); if(!e) return; const mi=+e.minutos||0, ef=+e.eficiencia||0; m+=mi; if(mi>0&&ef>0) disp+=mi/ef*100; });
  return {min:m,disp,ef:disp?m/disp*100:null};
}
function iniGauge(F,fr){
  const P=iniPlanta(F,"ef"), W=200, C=100, R=78;
  const cab=`<div class="ini-card-h"><b>Eficiencia de planta hoy</b><span class="ini-hora">${fr.hora}</span></div>`;
  if(!("ef" in INI.d)) return cab+`<div class="ini-gauge-esp">${iniEspera()}</div>`;
  if(!P) return cab+`<p class="ini-tenue ini-centro">sin dato</p>`;
  const lista=fr.f>=.12 && P.ef!=null, v=lista?P.ef/fr.f:null, pct=lista?Math.max(0,Math.min(120,v))/120*100:0, niv=lista?iniNivel(v):"nd";
  const ang=a=>{ const r=(180-a*1.8)*Math.PI/180; return [C+Math.cos(r)*R, C-Math.sin(r)*R]; };
  const [mx,my]=ang(INI.meta/120*100), [nx,ny]=ang(pct), [ix,iy]=[C+(mx-C)*.78,C+(my-C)*.78];
  const dif=lista?Math.round(Math.abs(v-INI.meta)):0;
  return cab+`<svg class="ini-gauge-svg" viewBox="0 0 ${W} 124" role="img" aria-label="Eficiencia ${lista?Math.round(v)+" por ciento":"sin dato"}">
      <path d="M${C-R} ${C} A${R} ${R} 0 0 1 ${C+R} ${C}" class="ini-g-pista" pathLength="100"/>
      <path d="M${C-R} ${C} A${R} ${R} 0 0 1 ${C+R} ${C}" class="ini-g-val ${niv}" pathLength="100" stroke-dasharray="${pct} 100"/>
      <line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${(C+(mx-C)*1.16).toFixed(1)}" y2="${(C+(my-C)*1.16).toFixed(1)}" class="ini-g-meta"/>
      ${lista?`<line x1="${C}" y1="${C}" x2="${(C+(nx-C)*.8).toFixed(1)}" y2="${(C+(ny-C)*.8).toFixed(1)}" class="ini-g-aguja"/><circle cx="${C}" cy="${C}" r="5" class="ini-g-eje"/>`:""}
      <text x="${C}" y="${C-8}" class="ini-g-num" text-anchor="middle">${lista?Math.round(v)+"%":"—"}</text>
      <text x="${C}" y="${C+8}" class="ini-g-et" text-anchor="middle">EFICIENCIA</text>
      <text x="${C-R}" y="${C+20}" class="ini-g-ext" text-anchor="middle">0</text><text x="${C+R}" y="${C+20}" class="ini-g-ext" text-anchor="middle">120</text></svg>
    <div class="ini-g-pie">${lista?`<span class="ini-badge ${niv}">${niv==="ok"?"En meta":niv==="aviso"?"Atención":"Bajo"}</span> ${niv==="ok"?`${dif} punto${dif===1?"":"s"} sobre la meta`:`a ${dif} punto${dif===1?"":"s"} de la meta`}`
      : `<span class="ini-tenue">${fr.f<.12?"El turno recién empieza":"Aún sin tickets hoy"}</span>`}</div>
    <p class="ini-nota">Meta ${INI.meta}% · minutos producidos ÷ disponible, ajustado a las horas corridas del turno.</p>`;
}
function iniKpis(F,fr){
  const P=iniPlanta(F,"ef"), A=iniPlanta(F,"efa"), K=[];
  const k=(tit,val,sub,tab,cls)=>`<${tab?`button type="button" onclick="activarTab('${tab}')"`:"div"} class="ini-k${tab?" ini-k-ir":""}"><span class="ini-k-t">${tit}</span><b class="ini-k-v ${cls||""}">${val}</b><span class="ini-k-s ${cls||""}">${sub}</span></${tab?"button":"div"}>`;
  // minutos
  let mv=iniEspera(), ms="";
  if("ef" in INI.d){ if(P){ mv=iniN(P.min); const ay=A&&A.min>0?A.min:0;
      ms = ay&&fr.f>=.12 ? (()=>{ const r=(P.min/fr.f/ay-1)*100; return `<span class="${r>=0?"ok":"alerta"}">${r>=0?"+":""}${r.toFixed(1).replace(".",",")} %</span> al ritmo vs ayer`; })()
        : ay ? `ayer cerró ${iniN(ay)}` : ("efa" in INI.d?"":"comparando con ayer…"); } else { mv='<span class="ini-tenue">sin dato</span>'; } }
  if(iniPuede("pasoEf")) K.push(k("Minutos producidos",mv,ms,"pasoEf"));
  // prendas
  let pv=iniEspera(), ps="";
  if("pre" in INI.d){ if(INI.d.pre && INI.d.pre.ok){ pv=iniN(F.reduce((s,x)=>s+(x.pre||0),0)); const n=F.filter(x=>x.pre>0).length; ps=`${n} área${n===1?"":"s"} activa${n===1?"":"s"}`; }
    else { pv='<span class="ini-tenue">—</span>'; ps='<span class="ini-tenue">falta el parche 148</span>'; } }
  K.push(k("Prendas registradas",pv,ps,iniPuede("pasoOfs")?"pasoOfs":null));
  // personal
  if(iniPuede("pasoAsis")||iniPuede("pasoDash")){
    let av=iniEspera(), as="", cl="";
    if("asis" in INI.d){ if(INI.d.asis && INI.d.asis.ok){ const t=F.reduce((s,x)=>s+(x.as?x.as.tot:0),0), p=F.reduce((s,x)=>s+(x.as?x.as.pres:0),0), m=F.reduce((s,x)=>s+(x.as?x.as.marc:0),0);
        av=`${iniN(p)} / ${iniN(t)}`; as=t-m>0?`${iniN(t-m)} sin marcar`:"todos marcados"; cl=t-m>0?"aviso":"ok"; } else av='<span class="ini-tenue">sin dato</span>'; }
    K.push(k("Personal presente",av,as,iniPuede("pasoAsis")?"pasoAsis":"pasoDash",cl));
  }
  // por confirmar
  const C=iniConfirmar(F);
  let cv=iniEspera(), cs="";
  if(C.listo){ cv=C.total; cs=C.total?C.partes.map(p=>p[0]).join(", "):"nada pendiente"; }
  K.push(`<a class="ini-k ini-k-ir" href="#iniAtencion" onclick="event.preventDefault();$('iniAtencion').scrollIntoView({behavior:'smooth',block:'start'})"><span class="ini-k-t">Por confirmar</span><b class="ini-k-v ${C.listo?(C.total?"alerta":"ok"):""}">${cv}</b><span class="ini-k-s ${C.total?"alerta":""}">${esc(cs)}</span></a>`);
  return K.join("");
}
/* Asistencias por marcar (áreas con menos de la mitad marcada), boletas sin llenar y solicitudes de ajuste. */
function iniConfirmar(F){
  const pend=[["bol",iniPuede("pasoBolSin")],["asis",iniPuede("pasoAsis")||iniPuede("pasoDash")],["sol",iniPuede("pasoIncid")]].filter(x=>x[1]&&!(x[0] in INI.d));
  const nAs=INI.d.asis&&INI.d.asis.ok?F.filter(x=>x.as&&x.as.tot&&x.as.marc<x.as.tot/2).length:0;
  const nBo=INI.d.bol&&INI.d.bol.ok?F.reduce((s,x)=>s+(x.bol?x.bol.pendientes:0),0):0;
  const nSo=INI.d.sol&&INI.d.sol.ok?F.reduce((s,x)=>s+(x.sol||0),0):0;
  const partes=[]; if(nAs) partes.push([`${nAs} asistencia${nAs===1?"":"s"}`,iniPuede("pasoAsis")?"pasoAsis":"pasoDash"]);
  if(nBo) partes.push([`${nBo} boleta${nBo===1?"":"s"}`,"pasoBolSin"]); if(nSo) partes.push([`${nSo} incidencia${nSo===1?"":"s"}`,"pasoIncid"]);
  return {total:nAs+nBo+nSo, partes, listo:!pend.length};
}
function iniBarras(F,fr){
  const d=INI.d.ef, cab=`<div class="ini-card-h"><b>Eficiencia por área</b><span class="ini-tenue">hoy · meta ${INI.meta}%</span></div>`;
  if(!iniPuede("pasoEf")) return "";
  if(!("ef" in INI.d)) return cab+`<div class="ini-vacio chico">${iniEspera()} Calculando…</div>`;
  if(!d||!d.ok) return cab+`<p class="ini-tenue">sin dato</p>`;
  const filas=F.map(x=>{ const e=x.ef; if(!e||!(+e.minutos>0)||!(+e.eficiencia>0)||fr.f<.12) return null; const v=+e.eficiencia/fr.f; return {area:x.area,v}; }).filter(Boolean).sort((a,b)=>b.v-a.v);
  if(!filas.length) return cab+`<p class="ini-tenue">${fr.f<.12?"El turno recién empieza: aún no hay un ritmo que comparar.":"Todavía no hay tickets hoy en estas áreas."}</p>`;
  return cab+filas.map(x=>`<button type="button" class="ini-b" onclick="activarTab('pasoEf')" title="Ir a Eficiencia"><span class="ini-b-a"><i data-a="${esc(x.area)}"></i>${esc(INI_CORTO(x.area))}</span>
      <span class="ini-b-pista"><i class="${iniNivel(x.v)}" style="width:${Math.min(100,x.v/120*100)}%"></i><u style="left:${INI.meta/120*100}%" title="Meta ${INI.meta}%"></u></span><b class="${iniNivel(x.v)}">${Math.round(x.v)}%</b></button>`).join("")
    +`<div class="ini-leyenda"><span><i class="ok"></i>≥ ${INI.meta} en meta</span><span><i class="aviso"></i>70–${INI.meta-1} atención</span><span><i class="alerta"></i>&lt; 70 bajo</span><span><u></u>meta</span></div>`;
}
function iniPintar(){
  if(!$("iniAvisos")) return;
  const areas=iniAreas(), F=iniPorArea(areas), fr=iniFraccion();
  const mias=PERM_LIBRE()?[]:areasEdita().filter(a=>(AREAS_LISTA||[]).includes(a));
  const alcance = PERM_LIBRE() ? "todas las áreas"
    : mias.length ? (INI.todas?"todas las áreas (solo lectura fuera de las tuyas)":mias.map(INI_CORTO).join(" y "))
    : "todas las áreas · solo lectura";
  const h=+fr.hora.slice(0,2), saludo=h<12?"Buenos días":h<19?"Buenas tardes":"Buenas noches";
  const nombre=String((ING&&ING.nombre)||"").trim().split(/\s+/)[0]; 
  $("iniFecha").textContent = `${saludo}${nombre?", "+nombre.charAt(0)+nombre.slice(1).toLowerCase():""}`;
  $("iniAlcance").textContent = `Así va el día en ${alcance} · ${INI.hoy?iniFechaTxt(INI.hoy,true):""}`;
  const puedeAlt=!PERM_LIBRE() && mias.length && leeTodas();
  $("iniSeg").hidden=!puedeAlt;
  if(puedeAlt){ $("iniSegMias").classList.toggle("activo",!INI.todas); $("iniSegTodas").classList.toggle("activo",INI.todas); }
  $("iniGauge").innerHTML=iniGauge(F,fr);
  $("iniKpis").innerHTML=iniKpis(F,fr);
  $("iniBarras").innerHTML=iniBarras(F,fr); $("iniBarras").hidden=!iniPuede("pasoEf");

  const av=iniAvisos(F).filter(a=>!["pasoBolSin","pasoAsis","pasoDash","pasoIncid"].includes(a.tab)), C=iniConfirmar(F), L=[];
  if(C.listo && C.total) L.push(`<div class="ini-r" role="link" tabindex="0" onclick="activarTab('${C.partes[0][1]}')" onkeydown="if(event.key==='Enter')activarTab('${C.partes[0][1]}')">
      <span class="ini-r-i">${iniIco("chk")}</span><span class="ini-r-c"><b>${C.total} por confirmar</b>
      <span>${C.partes.map(p=>`<a href="#${p[1]}" onclick="event.stopPropagation();event.preventDefault();activarTab('${p[1]}')">${esc(p[0])}</a>`).join(", ")}</span></span><span class="ini-r-ir" aria-hidden="true">›</span></div>`);
  const ico={pasoAudit:"shield",pasoFeriados:"cal"};
  av.forEach(a=>L.push(`<div class="ini-r ${a.tipo}" role="link" tabindex="0" onclick="activarTab('${a.tab}')" onkeydown="if(event.key==='Enter')activarTab('${a.tab}')">
      <span class="ini-r-i">${iniIco(ico[a.tab]||"msg")}</span><span class="ini-r-c"><b>${a.n} ${esc(a.txt)}</b>
      <span>${a.chips?a.chips.replace(/<i data-a="[^"]*"><\/i>/g,""):""}${a.nota?" · "+esc(a.nota):""}</span></span><span class="ini-r-ir" aria-hidden="true">›</span></div>`));
  const pend=!C.listo || ["aud","fer"].some(k=>({aud:"pasoAudit",fer:"pasoBolSin"}[k]&&iniPuede({aud:"pasoAudit",fer:"pasoBolSin"}[k]))&&!(k in INI.d));
  $("iniAvisos").innerHTML = L.join("") || (pend?`<div class="ini-vacio">${iniEspera()} Revisando tus áreas…</div>`:`<div class="ini-vacio ok">Nada pendiente en ${esc(alcance)}.</div>`);
  if(L.length && pend) $("iniAvisos").insertAdjacentHTML("beforeend",`<div class="ini-vacio chico">${iniEspera()} Faltan revisiones…</div>`);
  const ts=Object.values(INI.tiempos);
  $("iniPie").textContent = ts.length ? `Actualizado ${fr.hora} · ${ts.length} consultas en paralelo, la más lenta ${Math.max(...ts)} ms · se refresca solo cada 10 min` : "";
}
