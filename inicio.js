/* =====================================================================
   SAMITEX · Inicio de Ingeniería (propuesta, solo lectura)
   Al entrar dice cómo va el día de las áreas de la persona y qué necesita
   su atención. No agrega RPC nuevas: usa las mismas de las pestañas, cada
   tarjeta se pinta sola cuando llega su respuesta (carga por partes) y
   cada aviso lleva a la pestaña que ya existe.
   ===================================================================== */
let INI={todas:false, d:{}, t0:0, tiempos:{}};
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
  if(iniPuede("pasoEf")) iniRpc("ef","fn_eficiencia_areas",{p_desde:ayer,p_hasta:ayer});
  if(iniPuede("pasoAudit")) iniRpc("aud","fn_ef_auditoria_v2",{p_desde:ayer,p_hasta:ayer,p_area:"",p_umbral:AUD_ANORMAL,p_pico:20});
  if(iniPuede("pasoIncid")) iniRpc("sol","fn_solicitudes_listar",{p_area:""});
}

/* ---------- cálculo por área (solo con lo que devuelven las RPC) ---------- */
function iniPorArea(areas){
  const d=INI.d, M={};
  areas.forEach(a=>M[a]={area:a});
  if(d.bol && d.bol.ok) (d.bol.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].bol=x; });
  if(d.ef && d.ef.ok) (d.ef.areas||[]).forEach(x=>{ if(M[x.area]) M[x.area].ef=x; });
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
function iniCelda(k, cuerpo){
  if(!(k in INI.d)) return iniEspera();
  if(!INI.d[k] || INI.d[k].ok===false) return `<span class="ini-tenue" title="${esc((INI.d[k]&&INI.d[k].error)||"")}">sin dato</span>`;
  return cuerpo();
}
function iniPintar(){
  if(!$("iniAvisos")) return;
  const areas=iniAreas(), F=iniPorArea(areas), pend=["bol","asis","ef","aud","sol"].filter(k=>
      ({bol:"pasoBolSin",ef:"pasoEf",aud:"pasoAudit",sol:"pasoIncid"}[k] ? iniPuede({bol:"pasoBolSin",ef:"pasoEf",aud:"pasoAudit",sol:"pasoIncid"}[k]) : (iniPuede("pasoAsis")||iniPuede("pasoDash"))) && !(k in INI.d));
  const mias=PERM_LIBRE()?[]:areasEdita().filter(a=>(AREAS_LISTA||[]).includes(a));
  const alcance = PERM_LIBRE() ? "Todas las áreas"
    : mias.length ? (INI.todas?"Todas las áreas (solo lectura fuera de las tuyas)":"Tus áreas: "+mias.map(INI_CORTO).join(" y "))
    : "Todas las áreas · solo lectura";
  const toggle = (!PERM_LIBRE() && mias.length && leeTodas())
    ? `<button class="ini-link" onclick="INI.todas=!INI.todas;iniPintar()">${INI.todas?"Ver solo las mías":"Ver todas"}</button>` : "";
  $("iniFecha").textContent = INI.hoy ? iniFechaTxt(INI.hoy,true).replace(/^./,c=>c.toUpperCase()) : "";
  $("iniAlcance").innerHTML = esc(alcance)+" "+toggle;

  const av=iniAvisos(F);
  const avHTML = av.length ? av.map(a=>`
      <a class="ini-av ${a.tipo}" href="#${a.tab}" onclick="event.preventDefault();activarTab('${a.tab}')">
        <span class="ini-av-n">${a.n}</span>
        <span class="ini-av-c"><span class="ini-av-t">${esc(a.txt)}</span>
          <span class="ini-av-chips">${a.chips}</span>${a.nota?`<span class="ini-av-nota">${esc(a.nota)}</span>`:""}</span>
        <span class="ini-av-ir">${esc(a.ir)} <span aria-hidden="true">›</span></span>
      </a>`).join("")
    : pend.length ? `<div class="ini-vacio">${iniEspera()} Revisando tus áreas…</div>`
    : `<div class="ini-vacio ok">Nada pendiente en ${esc(INI_CORTO(alcance).toLowerCase())}.</div>`;
  $("iniAvisos").innerHTML = avHTML + (av.length && pend.length ? `<div class="ini-vacio chico">${iniEspera()} Faltan ${pend.length} revisión(es)…</div>` : "");

  const cols=[];
  if(iniPuede("pasoAsis")||iniPuede("pasoDash")) cols.push(["Asistencia hoy","asis",x=>{ const s=x.as; if(!s||!s.tot) return '<span class="ini-tenue">—</span>';
      if(s.marc<s.tot/2) return `<span class="ini-v aviso">${s.marc}</span><span class="ini-s">de ${s.tot} marcados</span>`;
      return `<span class="ini-v">${s.pres}</span><span class="ini-s">de ${s.tot} · ${[s.falta?s.falta+" falta"+(s.falta>1?"s":""):"", s.otra?s.otra+" en otra área":""].filter(Boolean).join(" · ")||"presentes"}</span>`; }]);
  if(iniPuede("pasoEf")) cols.push([`Eficiencia ${iniFechaTxt(INI.ayer||hoyLima())}`,"ef",x=>{ const e=x.ef; if(!e||!(e.minutos>0)) return '<span class="ini-tenue">sin tickets</span>';
      const v=Number(e.eficiencia), w=Math.max(0,Math.min(100,v));
      return `<span class="ini-v">${v.toFixed(1)}%</span><span class="ini-bar"><i style="width:${w}%"></i></span>`; }]);
  if(iniPuede("pasoBolSin")) cols.push([`Boletas ${INI.fb===INI.hoy?"hoy":iniFechaTxt(INI.fb||hoyLima())}`,"bol",x=>{ const b=x.bol; if(!b||!b.total||b.total===b.sin_labor) return '<span class="ini-tenue">no se exige</span>';
      const ex=b.total-b.sin_labor-b.ausentes; return b.pendientes ? `<span class="ini-v alerta">${b.pendientes}</span><span class="ini-s">de ${ex} sin boleta</span>` : `<span class="ini-v ok">✓</span><span class="ini-s">todas</span>`; }]);
  if(iniPuede("pasoAudit")) cols.push([`Auditoría ${iniFechaTxt(INI.ayer||hoyLima())}`,"aud",x=>x.aud?`<span class="ini-v aviso">${x.aud}</span><span class="ini-s">≥ ${AUD_ANORMAL}%</span>`:'<span class="ini-tenue">—</span>']);
  if(iniPuede("pasoIncid")) cols.push(["Solicitudes","sol",x=>x.sol?`<span class="ini-v">${x.sol}</span><span class="ini-s">pendientes</span>`:'<span class="ini-tenue">—</span>']);
  $("iniAreasTab").innerHTML = `<thead><tr><th>Área</th>${cols.map(c=>`<th>${esc(c[0])}</th>`).join("")}</tr></thead>
    <tbody>${F.map(x=>`<tr><th scope="row"><span class="ini-area"><i data-a="${esc(x.area)}"></i>${esc(INI_CORTO(x.area))}</span>${
        !PERM_LIBRE() && PERM.areas[x.area]!=="EDITAR" && PERM.areas["*"]!=="EDITAR" ? '<span class="ini-lee">lectura</span>':""}</th>${
        cols.map(c=>`<td>${iniCelda(c[1],()=>c[2](x))}</td>`).join("")}</tr>`).join("")}</tbody>`;
  const listo=!pend.length && INI.t0;
  $("iniPie").textContent = listo ? `Actualizado ${new Date().toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit",timeZone:"America/Lima"})} · ${Object.keys(INI.d).length} consultas en paralelo, la más lenta ${Math.max(...Object.values(INI.tiempos))} ms` : "";
}
