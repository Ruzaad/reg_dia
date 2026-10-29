/* =====================================================================
   CHRONOS · Inicio de Ingeniería (solo lectura)
   Al entrar dice cómo va el día de cada área de la persona (minutos contra el tope
   de sus asistentes, prendas, personal), la meta del mes y qué necesita su atención.
   Usa fn_inicio_resumen y fn_inicio_mes (parche 149) más las RPC de las pestañas;
   cada tarjeta se pinta sola cuando llega su respuesta y lleva a la pestaña que ya existe.
   ===================================================================== */
let INI={todas:false, d:{}, fecha:null, timer:null};
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
  const fecha=INI.hoy;
  return rpc(fn, Object.assign({p_dni:ING.dni,p_token:ING.token}, args))
    .then(r=>{ if(INI.hoy!==fecha) return r; INI.d[clave]=r; iniPintar(); return r; })
    .catch(e=>{ if(INI.hoy!==fecha) return; INI.d[clave]={ok:false,error:e.message}; iniPintar(); });
}
function iniCargar(){
  const hoy=INI.fecha||hoyLima(), ayer=iniAyer(hoy), fb=iniFechaBoletas();
  INI.d={}; INI.hoy=hoy; INI.ayer=ayer; INI.fb=fb;
  iniPintar();
  iniRpc("res","fn_inicio_resumen",{p_fecha:hoy});
  iniRpc("mes","fn_inicio_mes",{p_fecha:hoy});
  if(iniPuede("pasoBolSin")) iniRpc("bol","fn_boletas_sin_llenar",{p_fecha:fb,p_area:null})
    .then(r=>{ if(r && r.ok) bslNav((r.personas||[]).length, fb); });
  if(iniPuede("pasoAsis")||iniPuede("pasoDash")) iniRpc("asis","fn_asistencia_matriz",{p_area:"",p_desde:hoy,p_hasta:hoy});
  if(iniPuede("pasoAudit")) iniRpc("aud","fn_ef_auditoria_v2",{p_desde:ayer,p_hasta:ayer,p_area:"",p_umbral:AUD_ANORMAL,p_pico:20});
  if(iniPuede("pasoIncid")) iniRpc("sol","fn_solicitudes_listar",{p_area:""});
  if(iniPuede("pasoBolSin")) iniRpc("fer","fn_dias_no_laborables",{p_desde:ferSuma(hoy,-45),p_hasta:hoy})   // parche 120
    .then(r=>{ if(r && r.ok) ferNav(r); });
  clearInterval(INI.timer);   // se refresca solo cada 10 min mientras Inicio esté a la vista
  INI.timer=setInterval(()=>{ const p=$("pasoInicio"); if(p && p.classList.contains("activa") && !document.hidden) iniCargar(); },600000);
}
function iniCambiarFecha(v){ INI.fecha = v && v<hoyLima() ? v : null; iniCargar(); }

/* ---------- cálculo por área (solo con lo que devuelven las RPC) ---------- */
function iniPorArea(areas){
  const d=INI.d, M={};
  areas.forEach(a=>M[a]={area:a});
  if(d.bol && d.bol.ok) (d.bol.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].bol=x; });
  if(d.res && d.res.ok) (d.res.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].r=x; });
  if(d.mes && d.mes.ok) (d.mes.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].mes=+x.acum||0; });
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
const iniCorto=INI_CORTO;
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
/* Medidor de un área: el arco llega al tope (asistentes × jornada); la marca es la meta mínima (80 % del tope).
   El día en curso se compara con lo que ya debería llevar según las horas corridas. */
function iniGaugeArea(r,fr){
  const W=200,C=100,R=78, tope=+r.tope||0, v=+r.minutos||0, meta=+r.meta_min||0, hoy=INI.hoy===hoyLima();
  const esp=hoy?Math.max(.05,fr.f):1, pct=tope?Math.min(100,v/tope*100):0, mpct=tope?meta/tope*100:80;
  const niv=!tope?"nd":v>=meta*esp?"ok":v>=meta*esp*.875?"aviso":"alerta";
  const ang=a=>{ const t=(180-a*1.8)*Math.PI/180; return [C+Math.cos(t)*R, C-Math.sin(t)*R]; };
  const [mx,my]=ang(mpct);
  return `<svg class="ini-gauge-svg" viewBox="0 0 ${W} 112" role="img" aria-label="${iniN(v)} de ${iniN(tope)} minutos, meta mínima ${iniN(meta)}">
      <path d="M${C-R} ${C} A${R} ${R} 0 0 1 ${C+R} ${C}" class="ini-g-pista" pathLength="100"/>
      <path d="M${C-R} ${C} A${R} ${R} 0 0 1 ${C+R} ${C}" class="ini-g-val ${niv}" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100"${pct<.8?" visibility=\"hidden\"":""}/>
      <line x1="${(C+(mx-C)*.78).toFixed(1)}" y1="${(C+(my-C)*.78).toFixed(1)}" x2="${(C+(mx-C)*1.16).toFixed(1)}" y2="${(C+(my-C)*1.16).toFixed(1)}" class="ini-g-meta"/>
      <text x="${C}" y="${C-6}" class="ini-g-num" text-anchor="middle">${iniN(v)}</text>
      <text x="${C}" y="${C+10}" class="ini-g-et" text-anchor="middle">MINUTOS</text>
      <text x="${C-R}" y="${C+20}" class="ini-g-ext" text-anchor="middle">0</text><text x="${C+R}" y="${C+20}" class="ini-g-ext" text-anchor="middle">${iniN(tope)}</text></svg>`;
}
function iniAreaCard(x,fr){
  const r=x.r, n=iniCorto(x.area);
  if(!r) return `<section class="ini-card ini-ac"><div class="ini-card-h"><b class="ini-area"><i data-a="${esc(x.area)}"></i>${esc(n)}</b></div><div class="ini-gauge-esp">${iniEspera()}</div></section>`;
  const t=(l,v)=>`<div><span>${l}</span><b>${v}</b></div>`;
  return `<section class="ini-card ini-ac"><div class="ini-card-h"><b class="ini-area"><i data-a="${esc(x.area)}"></i>${esc(n)}</b>
      </div>
    ${r.tope?iniGaugeArea(r,fr):`<p class="ini-tenue ini-centro">sin asistentes</p>`}
    ${r.tope?`<p class="ini-ac-m">Meta mínima <b>${iniN(r.meta_min)}</b> · Tope <b>${iniN(r.tope)}</b></p>`:""}
    <div class="ini-ac-d">${t("Asistentes",`${iniN(r.asistentes)} <small>de ${iniN(r.personal)}</small>`)}${t("Prendas",iniN(r.prendas))}${t("Minutos",iniN(r.minutos))}</div></section>`;
}
function iniAreasHtml(F,fr){
  const L=F.filter(x=>!("res" in INI.d) || (x.r && (x.r.personal||x.r.minutos||x.r.prendas)));
  if("res" in INI.d && !(INI.d.res&&INI.d.res.ok)) return `<div class="ini-vacio">No se pudo cargar el día. Intenta de nuevo en un momento.</div>`;
  return L.map(x=>iniAreaCard(x,fr)).join("");
}
/* Meta del mes en grande: lo acumulado hasta ayer (guardado) más lo de la fecha mirada. */
function iniMesHtml(F){
  if(!("res" in INI.d) || !("mes" in INI.d)) return `<div class="ini-card-h"><b>Meta del mes</b></div><div class="ini-gauge-esp">${iniEspera()}</div>`;
  const R=INI.d.res, M=INI.d.mes;
  if(!(R&&R.ok&&M&&M.ok)) return `<div class="ini-card-h"><b>Meta del mes</b></div><p class="ini-tenue">sin dato</p>`;
  const sel=new Set(F.map(x=>x.area));
  const ac=a=>(+((M.areas||[]).find(y=>y.area===a)||{}).acum||0)+(+((R.areas||[]).find(y=>y.area===a)||{}).minutos||0);
  const metaA=a=>+((R.areas||[]).find(y=>y.area===a)||{}).meta_mes||0;
  const todas=F.length===(AREAS_LISTA||[]).filter(a=>a&&a!=="INGENIERIA").length;
  const tot=F.reduce((s,x)=>s+ac(x.area),0), met=todas&&+R.meta_mes ? +R.meta_mes : F.reduce((s,x)=>s+metaA(x.area),0);
  const pct=met?tot/met*100:0, mesTxt=INI_MESES[+R.fecha.slice(5,7)-1];
  const filas=F.filter(x=>metaA(x.area)||ac(x.area)).map(x=>{ const m=metaA(x.area), a=ac(x.area), p=m?Math.min(100,a/m*100):0;
    return `<div class="ini-mf"><span class="ini-area"><i data-a="${esc(x.area)}"></i>${esc(iniCorto(x.area))}</span>
      <span class="ini-mf-b"><i style="width:${p.toFixed(1)}%"></i></span><b>${iniN(a)}${m?` <small>/ ${iniN(m)}</small>`:""}</b></div>`; }).join("");
  return `<div class="ini-card-h"><b>Meta de ${mesTxt}</b>${iniPuede("pasoPcp")?`<button type="button" class="ini-link" onclick="activarTab('pasoPcp')">Ver PCP ›</button>`:""}</div>
    <div class="ini-mes-n"><b>${met?iniN(met):"—"}</b><span>minutos de meta</span></div>
    <div class="ini-mes-n ini-mes-a"><b>${iniN(tot)}</b><span>${met?`a la fecha · ${pct.toFixed(1).replace(".",",")} %`:"a la fecha"}</span></div>
    ${met?`<div class="ini-mes-bar"><i style="width:${Math.min(100,pct).toFixed(1)}%"></i></div>`:""}
    <div class="ini-mfs">${filas}</div>`;
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
  $("iniAlcance").textContent = `${alcance} · ${INI.hoy?iniFechaTxt(INI.hoy,true):""}`;
  const puedeAlt=!PERM_LIBRE() && mias.length && leeTodas();
  $("iniSeg").hidden=!puedeAlt;
  if(puedeAlt){ $("iniSegMias").classList.toggle("activo",!INI.todas); $("iniSegTodas").classList.toggle("activo",INI.todas); }
  const fi=$("iniFechaSel"); if(fi && document.activeElement!==fi){ fi.max=hoyLima(); fi.value=INI.hoy||""; }
  $("iniMes").innerHTML=iniMesHtml(F);
  $("iniAreas").innerHTML=iniAreasHtml(F,fr);

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
}
