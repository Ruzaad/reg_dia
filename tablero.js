/* =====================================================================
   CHRONOS · Tablero de gestión (debajo de Inicio, solo lectura)
   8 indicadores con semáforo, filtro por área y cumplimiento por línea.
   Usa RPC que ya existen: fn_inicio_plan, fn_inicio_resumen, fn_pcp_costura,
   fn_eficiencia_areas, fn_bases_calidad y fn_reprocesos_apoyo. Sin SQL nuevo.
   ===================================================================== */
let TB={area:"",d:{},hoy:null,o:{k:3,d:-1},f:{}};
const TB_V="var(--exito)", TB_A="var(--ocre)", TB_R="var(--alerta)";
const tbCorto=a=>String(a||"").replace(" COSTURA","");
const tbCol=(p,a=95,b=75)=>p==null?"var(--tenue)":p>=a?TB_V:p>=b?TB_A:TB_R;
const tbN=n=>Math.round(+n||0).toLocaleString("es-PE").replace(/,/g," ");
const tbP=(v,d=0)=>v==null||!isFinite(v)?"—":(+v).toFixed(d).replace(".",",")+" %";

function tbAreas(){ return (typeof iniAreas==="function"?iniAreas():(AREAS_LISTA||[])).filter(a=>a!=="UDP"&&a!=="INGENIERIA"); }
function tbRpc(k,fn,args){
  const hoy=TB.hoy;
  return rpc(fn,Object.assign({p_dni:ING.dni,p_token:ING.token},args))
    .then(r=>{ if(TB.hoy===hoy){ TB.d[k]=r; tbPintar(); } })
    .catch(e=>{ if(TB.hoy===hoy){ TB.d[k]={ok:false,error:e.message}; tbPintar(); } });
}
function tbInit(){ TB.hoy=hoyLima(); TB.d={}; tbBarra(); tbPintar(); tbCargar(); }
function tbCargar(){
  const hoy=TB.hoy, ini=hoy.slice(0,8)+"01";
  tbRpc("res","fn_inicio_resumen",{p_fecha:hoy});
  tbRpc("plan","fn_inicio_plan",{p_fecha:hoy});
  tbRpc("pcp","fn_pcp_costura",{p_mes:ini});
  tbRpc("ef","fn_eficiencia_areas",{p_desde:ini,p_hasta:hoy});
  tbRpc("cal","fn_bases_calidad",{});
  tbRpc("inc","fn_reprocesos_apoyo",{p_area:"",p_desde:ini,p_hasta:hoy});
}
function tbElegir(a){ TB.area=a; tbBarra(); tbPintar(); }
function tbBarra(){
  const el=$("tbAreas"); if(!el) return;
  el.innerHTML=["",...tbAreas()].map(a=>`<button type="button" class="${a===TB.area?"on":""}" onclick="tbElegir(${JSON.stringify(a).replace(/"/g,"&quot;")})">${a?esc(tbCorto(a)):"Todas"}</button>`).join("");
}
/* Plan por área: meta del mes, lo llevado, lo que debería llevar y la proyección. */
function tbPlan(){
  const P=TB.d.plan, R=TB.d.res; if(!(P&&P.ok)) return null;
  const disp=+P.disp_total, meta=+P.meta||0, efMeta=disp&&meta?meta/disp:0;
  const hoyM=a=>{ const m=(P.manual_dia||{})[a]||(a==="CORTE"?P.corte_dia:null), t=+(((R&&R.areas)||[]).find(y=>y.area===a)||{}).minutos||0; return !m?t:a==="CORTE"?+m.minutos||0:t+(+m.minutos||0); };
  const ok=new Set(tbAreas());
  const A=(P.areas||[]).filter(x=>ok.has(x.area)).map(x=>{
    const dm=+x.disp_mes, df=+x.disp_fecha, min=+x.minutos+hoyM(x.area), efp=x.ef_prev==null?null:+x.ef_prev;
    return {area:x.area, meta:dm*efMeta, min, deberia:df*efMeta, ef:df?(+x.minutos)/df:0, proy:efp==null?null:efp*dm, pers:+x.personas, estr:+x.estructura, dm, df};
  });
  return {A,efMeta,meta,P};
}
function tbSuma(A,k){ return A.reduce((s,x)=>s+(+x[k]||0),0); }
function tbIndicadores(){
  const Q=tbPlan(), out=[]; const sel=a=>!TB.area||a===TB.area;
  const cargando=k=>!(k in TB.d);
  const mk=(t,v,sub,c,q,pct)=>({t,v,sub,c,q,pct});
  const A=Q?Q.A.filter(x=>sel(x.area)):[];
  if(Q&&A.length){
    const meta=tbSuma(A,"meta"), min=tbSuma(A,"min"), deb=tbSuma(A,"deberia"), proy=A.every(x=>x.proy!=null)?tbSuma(A,"proy"):null;
    const pm=meta?min/meta*100:0, rit=deb?min/deb*100:null, efR=tbSuma(A,"dm")&&tbSuma(A,"df")?A.reduce((s,x)=>s+x.ef*x.df,0)/tbSuma(A,"df")*100:0, efM=Q.efMeta*100;
    out.push(mk("Cumplimiento de la meta del mes",tbP(pm),`${tbN(min)} de ${tbN(meta)} min`,tbCol(rit),"¿Voy a llegar a la meta?",pm));
    out.push(mk("Cierre proyectado",proy==null?"—":tbP(proy/meta*100),proy==null?"sin mes anterior":`${tbN(proy)} min al ritmo del mes anterior`,proy==null?"var(--tenue)":tbCol(proy/meta*100),"¿Cuánto faltaría?",proy==null?0:proy/meta*100));
    out.push(mk("Eficiencia real vs meta",tbP(efR,1),`meta ${tbP(efM,1)}`,tbCol(efM?efR/efM*100:null),"¿Mi gente rinde lo esperado?",efM?efR/efM*100:0));
    const pe=tbSuma(A,"pers"), es=tbSuma(A,"estr");
    out.push(mk("Personal disponible",es?tbP(pe/es*100):"—",`${pe} de ${es} personas`,tbCol(es?pe/es*100:null,90,75),"¿Hay gente para la meta?",es?pe/es*100:0));
  } else for(const t of ["Cumplimiento de la meta del mes","Cierre proyectado","Eficiencia real vs meta","Personal disponible"]) out.push(mk(t,"…",cargando("plan")?"cargando":"sin dato","var(--tenue)","",0));
  const P=TB.d.pcp;
  if(P&&P.ok){
    const F=(P.filas||[]).filter(x=>!/TALLER/i.test(x.planta||"")&&(!TB.area||x.area===TB.area));
    const con=F.filter(x=>x.status!=null), ver=con.filter(x=>x.status>=80).length, prog=F.reduce((s,x)=>s+(+x.cant_prog||0),0), hec=F.reduce((s,x)=>s+(+x.hecho||0),0);
    out.push(mk("OF al día",F.length?`${ver} de ${F.length}`:"—",F.length?`${tbP(ver/F.length*100)} con avance de 80 a 100 %`:"sin OF de costura",F.length?tbCol(ver/F.length*100,80,50):"var(--tenue)","¿Qué línea se atrasa?",F.length?ver/F.length*100:0));
    out.push(mk("Avance de costura",prog?tbP(hec/prog*100):"—",prog?`${tbN(hec)} de ${tbN(prog)} prendas`:"sin programa",prog?tbCol(hec/prog*100,80,50):"var(--tenue)","¿Costura va con el cronograma?",prog?hec/prog*100:0));
  } else for(const t of ["OF al día","Avance de costura"]) out.push(mk(t,"…",cargando("pcp")?"cargando":"sin dato","var(--tenue)","",0));
  const I=TB.d.inc;
  out.push(I&&I.ok?mk("Minutos en incidencias",tbN(I.total),`${tbN(I.otra_cosa)} eran trabajo en otra cosa`,I.total&&I.otra_cosa/I.total>=.3?TB_A:"var(--azul)","¿Cuánto se va en incidencias?",0)
    :mk("Minutos en incidencias","…",cargando("inc")?"cargando":"sin permiso o sin dato","var(--tenue)","",0));
  const C=TB.d.cal;
  if(C&&C.ok){
    const ar=(C.areas||[]).filter(a=>!TB.area||a.area===TB.area), tot=ar.reduce((s,a)=>s+a.grave+a.revisar,0), ops=ar.reduce((s,a)=>s+(+a.ops||0),0), p=ops?(1-tot/ops)*100:null;
    out.push(mk("Bases al día",p==null?"—":tbP(p,1),`${tot} operaciones por corregir`,p==null?"var(--tenue)":tbCol(p,99,95),"¿Puedo confiar en los datos?",p||0));
  } else out.push(mk("Bases al día","…",cargando("cal")?"cargando":"sin dato","var(--tenue)","",0));
  return out;
}
function tbOrden(k){ TB.o=TB.o.k===k?{k,d:-TB.o.d}:{k,d:1}; tbTabla(); }
function tbFiltro(i,v){ TB.f[i]=v.toLowerCase(); tbTabla(true); }
const TB_COL=["Línea","Meta del mes","A la fecha","% de la meta","Debería llevar","Ef. real","Estado"];
function tbFilas(){
  const Q=tbPlan(); if(!Q) return [];
  return Q.A.filter(x=>!TB.area||x.area===TB.area).map(x=>{
    const pm=x.meta?x.min/x.meta*100:0, rit=x.deberia?x.min/x.deberia*100:null;
    return {c:[tbCorto(x.area),Math.round(x.meta),Math.round(x.min),+pm.toFixed(0),Math.round(x.deberia),+(x.ef*100).toFixed(1),rit==null?"Sin dato":rit>=95?"Cumple":rit>=75?"En riesgo":"No cumple"]};
  });
}
function tbTabla(solo){
  const z=$("tbTabla"); if(!z) return;
  let F=tbFilas().filter(r=>r.c.every((v,i)=>!TB.f[i]||String(v).toLowerCase().includes(TB.f[i])));
  const ci=TB.o.k;
  F.sort((a,b)=>(a.c[ci]>b.c[ci]?1:a.c[ci]<b.c[ci]?-1:0)*TB.o.d);
  const body=F.map(r=>`<tr><td class="izq"><b>${esc(r.c[0])}</b></td><td>${tbN(r.c[1])}</td><td>${tbN(r.c[2])}</td><td>${r.c[3]} %</td><td>${tbN(r.c[4])}</td><td>${r.c[5]} %</td>
    <td><span class="tb-tag ${r.c[6]==="Cumple"?"v":r.c[6]==="En riesgo"?"a":r.c[6]==="No cumple"?"r":"g"}">${r.c[6]}</span></td></tr>`).join("")||`<tr><td colspan="7"><div class="vacio-msg">Sin datos</div></td></tr>`;
  if(solo){ const tb=z.querySelector("tbody"); if(tb){ tb.innerHTML=body; return; } }
  z.innerHTML=`<table class="tabla sin-orden sin-filtro"><thead><tr>${TB_COL.map((t,i)=>`<th class="${i?"":"izq"}" onclick="tbOrden(${i})">${t}${ci===i?(TB.o.d>0?" ▲":" ▼"):""}<input class="tb-f" value="${esc(TB.f[i]||"")}" placeholder="Filtrar" onclick="event.stopPropagation()" oninput="tbFiltro(${i},this.value)"></th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}
/* Eficiencia diaria por área contra la meta. */
function tbLinea(){
  const r=TB.d.ef, z=$("tbLinea"); if(!z) return;
  if(!r) { z.innerHTML=`<div class="vacio-msg">Cargando…</div>`; return; }
  if(!r.ok||!(r.por_fecha||[]).length){ z.innerHTML=`<div class="vacio-msg">Sin datos</div>`; return; }
  const Q=tbPlan(), meta=Q?Q.efMeta*100:80, ar=(r.areas||[]).map(a=>a.area).filter(a=>a!=="UDP"&&(!TB.area||a===TB.area));
  const F=r.por_fecha, W=520, H=230, L=38, B=24, X=i=>L+(F.length>1?i*(W-L-10)/(F.length-1):0);
  const vals=[]; F.forEach(f=>ar.forEach(a=>{ const v=f.valores&&f.valores[a]; if(v&&v.ef) vals.push(+v.ef); }));
  const mx=Math.max(100,Math.ceil(Math.max(...vals,0)/10)*10), Y=v=>H-B-(v/mx)*(H-B-8);
  const COL=["var(--azul)","var(--dorado)","var(--exito)","var(--cian)","var(--violeta)","var(--ocre)"];
  let h=""; for(let v=0;v<=mx;v+=20) h+=`<line x1="${L}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="4" y="${Y(v)+4}">${v}</text>`;
  h+=`<line x1="${L}" x2="${W}" y1="${Y(meta)}" y2="${Y(meta)}" class="m"/>`;
  const paso=Math.ceil(F.length/8); F.forEach((f,i)=>{ if(i%paso===0) h+=`<text x="${X(i)-12}" y="${H-6}">${f.fecha.slice(8,10)}/${f.fecha.slice(5,7)}</text>`; });
  ar.forEach((a,k)=>{ const pts=F.map((f,i)=>{ const v=f.valores&&f.valores[a]; return v&&v.ef?`${X(i)},${Y(+v.ef)}`:null; }).filter(Boolean).join(" "); if(pts) h+=`<polyline points="${pts}" fill="none" stroke="${COL[k%6]}" stroke-width="2.4" stroke-linejoin="round"/>`; });
  z.innerHTML=`<div class="tb-lg">${ar.map((a,k)=>`<span><i style="background:${COL[k%6]}"></i>${esc(tbCorto(a))}</span>`).join("")}<span><i class="m"></i>Meta ${tbP(meta,0)}</span></div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Eficiencia diaria por área">${h}</svg>`;
}
function tbPintar(){
  const k=$("tbKpis"); if(!k) return;
  k.innerHTML=tbIndicadores().map(x=>`<div class="tb-k" style="--c:${x.c}"><small>${esc(x.t)}</small><b>${x.v}</b><span class="tb-s">${esc(x.sub)}</span>
    <div class="tb-bar"><i style="width:${Math.max(0,Math.min(100,x.pct||0)).toFixed(0)}%"></i></div><em>${esc(x.q)}</em></div>`).join("");
  const f=$("tbFecha"); if(f) f.textContent=TB.hoy?(typeof iniFechaTxt==="function"?iniFechaTxt(TB.hoy,true):TB.hoy):"";
  tbTabla(); tbLinea();
}
