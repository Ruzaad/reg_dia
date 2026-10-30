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
  const todas=(AREAS_LISTA||[]).filter(a=>a && a!=="INGENIERIA" && a!=="UDP");
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
  iniRpc("mes","fn_inicio_mes",{p_fecha:hoy}).then(()=>{ if(INI.hoy===hoy) iniRpc("plan","fn_inicio_plan",{p_fecha:hoy}); });
  if(INI.fecha){   // la meta del mes sigue siendo la de hoy; el filtro solo mueve los medidores del día
    const hr=hoyLima();
    iniRpc("resHoy","fn_inicio_resumen",{p_fecha:hr});
    iniRpc("mesHoy","fn_inicio_mes",{p_fecha:hr}).then(()=>{ if(INI.hoy===hoy) iniRpc("planMes","fn_inicio_plan",{p_fecha:hr}); });
  }
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
/* Estado de un área frente a su meta mínima: en meta, en riesgo o crítico (según el día en curso). */
function iniNivel(r,fr){
  const tope=+r.tope||0, v=+r.minutos||0, meta=+r.meta_min||0, hoy=INI.hoy===hoyLima();
  const esp=hoy?Math.max(.05,fr.f):1;
  return !tope?"nd":v>=meta*esp?"ok":v>=meta*esp*.875?"aviso":"alerta";
}
const INI_ESTADO={ok:"En meta",aviso:"En riesgo",alerta:"Crítico"};
/* Medidor de un área: el arco llega al tope (asistentes × jornada); la marca es la meta mínima (80 % del tope).
   El número grande es el % del tope producido; debajo, los minutos. */
function iniGaugeArea(r,fr){
  const W=200,C=100,R=78, tope=+r.tope||0, v=+r.minutos||0, meta=+r.meta_min||0;
  const niv=iniNivel(r,fr), pct=tope?Math.min(100,v/tope*100):0, mpct=tope?meta/tope*100:80;
  const ang=a=>{ const t=(180-a*1.8)*Math.PI/180; return [C+Math.cos(t)*R, C-Math.sin(t)*R]; };
  const [mx,my]=ang(mpct);
  return `<svg class="ini-gauge-svg" viewBox="0 0 ${W} 112" role="img" aria-label="${pct.toFixed(0)} % del tope, ${iniN(v)} minutos, meta mínima ${iniN(meta)}">
      <path d="M${C-R} ${C} A${R} ${R} 0 0 1 ${C+R} ${C}" class="ini-g-pista" pathLength="100"/>
      <path d="M${C-R} ${C} A${R} ${R} 0 0 1 ${C+R} ${C}" class="ini-g-val ${niv}" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100"${pct<.8?" visibility=\"hidden\"":""}/>
      <line x1="${(C+(mx-C)*.78).toFixed(1)}" y1="${(C+(my-C)*.78).toFixed(1)}" x2="${(C+(mx-C)*1.16).toFixed(1)}" y2="${(C+(my-C)*1.16).toFixed(1)}" class="ini-g-meta"/>
      <text x="${C}" y="${C-6}" class="ini-g-num" text-anchor="middle">${pct.toFixed(0)} %</text>
      <text x="${C}" y="${C+12}" class="ini-g-et" text-anchor="middle">${iniN(v)} min</text></svg>`;
}
function iniAreaCard(x,fr){
  let r=x.r; const n=iniCorto(x.area), cd=x.area==="CORTE"&&INI.d.plan&&INI.d.plan.ok?(INI.d.plan.corte_dia||{}):null;
  if(r&&cd) r={...r, prendas:+cd.prendas||0, minutos:+cd.minutos||0};
  const cabeza=`<div class="ini-card-h"><span class="ini-hn"><b class="ini-area"><i data-a="${esc(x.area)}"></i>${esc(n)}</b>${r&&r.tope?`<span class="ini-hm">Meta <b>${iniN(r.meta_min)}</b></span>`:""}</span>${r&&r.tope?`<span class="ini-estado ${iniNivel(r,fr)}">${INI_ESTADO[iniNivel(r,fr)]||""}</span>`:""}</div>`;
  if(!r) return `<section class="ini-card ini-ac">${cabeza}<div class="ini-gauge-esp">${iniEspera()}</div></section>`;
  const corte=cd?`<div class="ini-corte"><label>Prendas<input id="iniCortePr" type="number" min="0" inputmode="numeric" value="${cd.prendas??""}"></label>
      <label>Minutos<input id="iniCorteMi" type="number" min="0" inputmode="numeric" value="${cd.minutos??""}"></label><button type="button" class="btn-mini verde" onclick="iniCorteGuardar()">GUARDAR</button></div>`:"";
  const t=(l,v)=>`<div><span>${l}</span><b>${v}</b></div>`;
  return `<section class="ini-card ini-ac">${cabeza}
    ${r.tope?iniGaugeArea(r,fr):`<p class="ini-tenue ini-centro">sin asistentes</p>`}
    <div class="ini-ac-d">${t("Asistentes",`${iniN(r.asistentes)} <small>de ${iniN(r.personal)}</small>`)}${t("Prendas",iniN(r.prendas))}${t("Min. Produ.",iniN(r.minutos))}</div>
    ${corte}</section>`;
}
function iniAreasHtml(F,fr){
  if("res" in INI.d && !(INI.d.res&&INI.d.res.ok)) return `<div class="ini-vacio">No se pudo cargar el día. Intenta de nuevo en un momento.</div>`;
  const o=a=>{ const i=INI_ORDEN.indexOf(a); return i<0?99:i; };
  const L=F.filter(x=>!("res" in INI.d) || (x.r && (x.r.personal||x.r.minutos||x.r.prendas))).slice().sort((a,b)=>o(a.area)-o(b.area));
  const conDato=L.filter(x=>x.r&&x.r.tope), enMeta=conDato.filter(x=>iniNivel(x.r,fr)==="ok").length;
  const head=`<div class="ini-prod-h"><div><h2 class="ini-prod-t">Producción del día</h2>
      <p class="ini-prod-s">Minutos producidos frente a la meta mínima, por área</p></div>
      <div class="ini-prod-leg"><span><i class="ini-leg-meta"></i>Meta mínima</span><span><i class="ini-leg-arc"></i>Extremo del arco = tope</span>
      ${conDato.length?`<b class="ini-prod-cnt">${enMeta} de ${conDato.length} áreas en meta</b>`:""}</div></div>`;
  return `<div class="ini-prod">${head}<div class="ini-prod-g">${L.map(x=>iniAreaCard(x,fr)).join("")}</div></div>`;
}
/* Meta del mes: disponible (MOD × jornada × días laborables, sin vacaciones ni licencias) = 100 %;
   eficiencia meta = meta ÷ disponible; óptima del área = su disponible × eficiencia meta;
   proyectado = eficiencia del mes anterior × disponible. */
const INI_ORDEN=["CORTE","CAMISA COSTURA","PANTALON COSTURA","SACO COSTURA","ACABADO","REPROCESO"];
const iniPct=v=>(isFinite(v)?v*100:0).toFixed(1).replace(".",",")+" %";
function iniPlan(F){
  const P=INI.d[INI.fecha?"planMes":"plan"], R=INI.d[INI.fecha?"resHoy":"res"]; if(!(P&&P.ok)) return null;
  const sel=new Set(F.map(x=>x.area)), hoyM=a=>a==="CORTE"?+((P.corte_dia||{}).minutos||0):+(((R&&R.areas)||[]).find(y=>y.area===a)||{}).minutos||0;
  const A=(P.areas||[]).filter(x=>sel.has(x.area)).map(x=>({...x, estructura:+x.estructura, personas:+x.personas, disp_mes:+x.disp_mes, disp_fecha:+x.disp_fecha, he:+x.he_min/60, ayer:+x.minutos, minutos:+x.minutos+hoyM(x.area)}));
  const sum=k=>A.reduce((s,x)=>s+(+x[k]||0),0), todas=A.length===(P.areas||[]).length;
  const dispTot=+P.disp_total, meta=+P.meta||0, efMeta=dispTot&&meta?meta/dispTot:0;
  const t={estructura:sum("estructura"), personas:sum("personas"), disp_mes:sum("disp_mes"), disp_fecha:sum("disp_fecha"), ayer:sum("ayer"), minutos:sum("minutos"), he:sum("he")};
  const efReal=t.disp_fecha?t.ayer/t.disp_fecha:0, efPrev=P.ef_prev==null?null:+P.ef_prev, quedan=(+P.dias||0)-(+P.dias_pasados||0);
  return {P, A, t, efMeta, efReal, efPrev, quedan, todas, dispTot, meta:todas?meta:t.disp_mes*efMeta,
    proy:efPrev==null?null:efPrev*t.disp_mes, deberia:t.disp_fecha*efMeta, resta:t.disp_mes-t.disp_fecha,
    opt:x=>x.disp_mes*efMeta, efArea:x=>x.disp_fecha?x.ayer/x.disp_fecha:0};
}
function iniMesHtml(F){
  const kP=INI.fecha?"planMes":"plan", kR=INI.fecha?"resHoy":"res";
  if(!(kP in INI.d) || !(kR in INI.d)) return `<section class="ini-card"><div class="ini-gauge-esp">${iniEspera()}</div></section>`;
  const Q=iniPlan(F);
  if(!Q) return `<section class="ini-card"><p class="ini-tenue">sin dato</p></section>`;
  const {P,A,t,efMeta,efPrev,todas,meta,proy}=Q, mesTxt=INI_MESES[+P.mes.slice(5,7)-1];
  const pct=meta?t.minutos/meta*100:0, disp=todas?Q.dispTot:t.disp_mes, brecha=proy==null?null:meta-proy;
  const suma=A.reduce((s,x)=>s+x.disp_mes,0), descuadre=todas&&Math.round(suma)!==Math.round(Q.dispTot), mx=Math.max(1,...A.map(x=>x.disp_mes));
  const w=(v,m)=>Math.max(0,Math.min(100,m?v/m*100:0)).toFixed(1);
  const fl=(l,sub,v,pc,col)=>`<div class="ini-m-fl"><div class="ini-m-c"><div>${l}<span>${sub}</span></div><em>${v}</em></div><div class="ini-m-bar"><i style="width:${pc}%;background:${col}"></i></div></div>`;
  const filas=A.map(x=>`<tr><td><span class="ini-area"><i data-a="${esc(x.area)}"></i>${esc(iniCorto(x.area))}</span></td>
      <td>${iniN(x.estructura)}</td><td>${iniN(x.personas)}</td><td class="bb"><div><i style="width:${w(x.disp_mes,mx)}%"></i></div></td><td class="n">${iniN(x.disp_mes)}</td></tr>`).join("");
  return `<div class="ini-m"><section class="ini-m-izq">
      <div class="ini-m-rot"><span>Meta de ${mesTxt}</span>${iniPuede("pasoPcp")?`<a onclick="activarTab('pasoPcp')" role="link" tabindex="0">Ver PCP ›</a>`:""}</div>
      <div class="ini-m-meta">${meta?iniN(meta):"—"}</div><div class="ini-m-sub">minutos de meta</div>
      <div class="ini-m-llevo"><b>${iniN(t.minutos)}</b><span>a la fecha</span>${meta?`<i>${pct.toFixed(1).replace(".",",")} %</i>`:""}</div>
      ${meta?`<div class="ini-m-pista"><i style="width:${Math.min(100,pct).toFixed(1)}%"></i></div>`:""}
    </section>
    <section class="ini-m-der"><h3>Cierre proyectado</h3>
      ${fl("Disponible","100 %",iniN(disp),"100","var(--tomado)")}
      ${fl("Meta",`eficiencia ${iniPct(efMeta)}`,iniN(meta),w(meta,disp),"var(--azul)")}
      ${proy==null?"":fl("Proyección",`mes anterior ${iniPct(efPrev)}`,iniN(proy),w(proy,disp),"var(--dorado)")}
      ${brecha==null?"":`<div class="ini-m-pie"><span><i class="${brecha>0?"mal":"bien"}"></i>${brecha>0?"Brecha proyectada":"Excedente proyectado"}</span><b class="${brecha>0?"mal":"bien"}">${iniN(Math.abs(brecha))} min</b></div>`}
    </section></div>
    ${descuadre?`<div class="ini-pv alerta"><b>Error: los minutos disponibles por área suman ${iniN(suma)} y el 100 % es ${iniN(Q.dispTot)}</b></div>`:""}
    <section class="ini-m-tab"><h3>Capacidad del mes por área</h3><div class="ini-pt-w"><table><thead><tr><th>Área</th><th>Estructura</th><th>Disponible</th><th></th><th class="n">Minutos del mes</th></tr></thead><tbody>${filas}
      <tr class="t"><td>Total</td><td>${iniN(t.estructura)}</td><td>${iniN(t.personas)}</td><td class="bb"></td><td class="n">${iniN(suma)}</td></tr></tbody></table></div></section>`;
}
/* CORTE no registra en el sistema: Ingeniería pone sus prendas y minutos del día. */
function iniCorteGuardar(){
  const pr=$("iniCortePr").value, mi=$("iniCorteMi").value;
  rpc("fn_corte_manual_guardar",{p_dni:ING.dni,p_token:ING.token,p_fecha:INI.hoy,p_prendas:pr===""?null:+pr,p_minutos:mi===""?null:+mi})
    .then(r=>{ if(!r||!r.ok) return toast((r&&r.error)||"No se pudo guardar","error"); toast("Guardado","ok"); iniRpc("plan","fn_inicio_plan",{p_fecha:INI.hoy}); })
    .catch(e=>toast(e.message,"error"));
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
  if(!/^iniCorte/.test((document.activeElement||{}).id||"")) $("iniAreas").innerHTML=iniAreasHtml(F,fr);

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
