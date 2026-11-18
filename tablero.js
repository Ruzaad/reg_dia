/* =====================================================================
   CHRONOS · Tablero de gestión (debajo de Inicio, solo lectura)
   Resumen de todo CHRONOS para Ingeniería, por día, semana, quincena o mes (también pasados).
   Cada cifra sale tal cual de una pantalla que ya existe; aquí no hay fórmulas nuevas.
   RPC: fn_inicio_plan, fn_inicio_resumen, fn_eficiencia_areas, fn_cantidad_penultima,
   fn_pcp_costura, fn_reprocesos_apoyo y fn_bases_calidad. Sin SQL nuevo.
   ===================================================================== */
let TB={modo:"dia",ref:null,area:"",d:{},o:{k:3,d:-1},f:{},oo:{k:5,d:1},fo:{}};
const TB_V="var(--exito)", TB_A="var(--ocre)", TB_R="var(--alerta)", TB_AZ="var(--azul)";
const tbCorto=a=>String(a||"").replace(" COSTURA","");
const tbN=n=>Math.round(+n||0).toLocaleString("es-PE").replace(/,/g," ");
const tbP=(v,d=0)=>v==null||!isFinite(v)?"—":(+v).toFixed(d).replace(".",",")+" %";
const tbF=(y,m,d)=>new Date(Date.UTC(y,m,d)).toISOString().slice(0,10);
const tbDM=f=>f.slice(8,10)+"/"+f.slice(5,7);
const TB_MES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

/* Rango del periodo elegido (nunca pasa de hoy). */
function tbRango(){
  const [y,m,d]=TB.ref.split("-").map(Number), hoy=hoyLima(); let a,b,et;
  if(TB.modo==="dia"){ a=b=TB.ref; et=iniFechaTxt(TB.ref,true); }
  else if(TB.modo==="semana"){ const dw=(new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7; a=tbF(y,m-1,d-dw); b=tbF(y,m-1,d-dw+6); et=`Semana del ${tbDM(a)} al ${tbDM(b)}`; }
  else if(TB.modo==="quincena"){ const p=d<=15; a=tbF(y,m-1,p?1:16); b=p?tbF(y,m-1,15):tbF(y,m,0); et=`${p?"1ra":"2da"} quincena de ${TB_MES[m-1]}`; }
  else { a=tbF(y,m-1,1); b=tbF(y,m,0); et=`${TB_MES[m-1][0].toUpperCase()+TB_MES[m-1].slice(1)} ${y}`; }
  return {desde:a,hasta:b>hoy?hoy:b,et,mes:TB.ref.slice(0,8)+"01"};
}
function tbMover(n){
  const [y,m,d]=TB.ref.split("-").map(Number), M=TB.modo;
  let f=M==="dia"?tbF(y,m-1,d+n):M==="semana"?tbF(y,m-1,d+7*n):M==="quincena"?(d<=15?(n>0?tbF(y,m-1,16):tbF(y,m-2,16)):(n>0?tbF(y,m,1):tbF(y,m-1,1))):tbF(y,m-1+n,1);
  if(f>hoyLima()) f=hoyLima(); TB.ref=f; tbCargar();
}
function tbModo(m){ TB.modo=m; tbCargar(); }
function tbFecha(v){ if(v){ TB.ref=v>hoyLima()?hoyLima():v; tbCargar(); } }
function tbAreas(){ return (typeof iniAreas==="function"?iniAreas():(AREAS_LISTA||[])).filter(a=>a!=="UDP"&&a!=="INGENIERIA"); }
function tbRpc(k,fn,args,clave){
  return rpc(fn,Object.assign({p_dni:ING.dni,p_token:ING.token},args))
    .then(r=>{ if(TB.clave===clave){ TB.d[k]=r; tbPintar(); } })
    .catch(e=>{ if(TB.clave===clave){ TB.d[k]={ok:false,error:e.message}; tbPintar(); } });
}
function tbInit(){ if(!TB.ref) TB.ref=hoyLima(); tbCargar(); }
function tbCargar(){
  const R=tbRango(), clave=TB.modo+R.desde+R.hasta+Date.now(); TB.clave=clave; TB.d={}; TB.R=R;
  tbBarra(); tbPintar();
  tbRpc("plan","fn_inicio_plan",{p_fecha:R.hasta},clave);
  tbRpc("res","fn_inicio_resumen",{p_fecha:R.hasta},clave);
  tbRpc("efp","fn_eficiencia_areas",{p_desde:R.desde,p_hasta:R.hasta},clave);
  const fin=R.hasta.slice(0,7)===R.mes.slice(0,7)?R.hasta:tbF(+R.mes.slice(0,4),+R.mes.slice(5,7),0);
  if(R.desde!==R.mes||R.hasta!==(fin>hoyLima()?hoyLima():fin)) tbRpc("efm","fn_eficiencia_areas",{p_desde:R.mes,p_hasta:fin>hoyLima()?hoyLima():fin},clave);
  tbRpc("cant","fn_cantidad_penultima",{p_desde:R.desde,p_hasta:R.hasta},clave);
  tbRpc("pcp","fn_pcp_costura",{p_mes:R.mes},clave);
  tbRpc("inc","fn_reprocesos_apoyo",{p_area:"",p_desde:R.desde,p_hasta:R.hasta},clave);
  tbRpc("cal","fn_bases_calidad",{},clave);
  const [y,m,d]=R.hasta.split("-").map(Number), p=d<=15, qa=tbF(y,m-1,p?1:16), qf=p?tbF(y,m-1,15):tbF(y,m,0);
  TB.Q={desde:qa,hasta:qf>hoyLima()?hoyLima():qf};
  tbRpc("opq","fn_incentivos_quincena",{p_desde:TB.Q.desde,p_hasta:TB.Q.hasta,p_area:""},clave);
}
function tbElegir(a){ TB.area=a; tbBarra(); tbPintar(); }
function tbBarra(){
  const el=$("tbAreas"); if(!el) return; const R=TB.R||tbRango();
  const seg=(m,t)=>`<button type="button" class="${TB.modo===m?"on":""}" onclick="tbModo('${m}')">${t}</button>`;
  $("tbPeriodo").innerHTML=`<div class="tb-seg">${seg("dia","Día")}${seg("semana","Semana")}${seg("quincena","Quincena")}${seg("mes","Mes")}</div>
    <div class="tb-nav"><button type="button" aria-label="Anterior" onclick="tbMover(-1)">‹</button><b>${esc(R.et)}</b>
    <button type="button" aria-label="Siguiente" onclick="tbMover(1)" ${R.hasta>=hoyLima()?"disabled":""}>›</button>
    <input type="date" value="${TB.ref}" max="${hoyLima()}" onchange="tbFecha(this.value)" aria-label="Ir a la fecha"></div>`;
  el.innerHTML=["",...tbAreas()].map(a=>`<button type="button" class="${a===TB.area?"on":""}" onclick="tbElegir(${JSON.stringify(a).replace(/"/g,"&quot;")})">${a?esc(tbCorto(a)):"Todas"}</button>`).join("");
}
/* Plan de Inicio (meta, estructura, disponible), con las mismas definiciones de Inicio. */
function tbPlan(){
  const P=TB.d.plan, Rs=TB.d.res; if(!(P&&P.ok)) return null;
  const disp=+P.disp_total, meta=+P.meta||0, efMeta=disp&&meta?meta/disp:0, ok=new Set(tbAreas());
  const hoyM=a=>{ const m=(P.manual_dia||{})[a]||(a==="CORTE"?P.corte_dia:null), t=+(((Rs&&Rs.areas)||[]).find(y=>y.area===a)||{}).minutos||0; return !m?t:a==="CORTE"?+m.minutos||0:t+(+m.minutos||0); };
  const A=(P.areas||[]).filter(x=>ok.has(x.area)).map(x=>{ const dm=+x.disp_mes, df=+x.disp_fecha, efp=x.ef_prev==null?null:+x.ef_prev;
    return {area:x.area, opt:dm*efMeta, min:+x.minutos+hoyM(x.area), ef:df?(+x.minutos)/df:0, proy:efp==null?null:efp*dm, pers:+x.personas, estr:+x.estructura, dm, df, ay:+x.minutos}; });
  return {A,efMeta,meta,P};
}
const tbSuma=(A,k)=>A.reduce((s,x)=>s+(+x[k]||0),0);
const tbSel=a=>!TB.area||a===TB.area;
function tbIndicadores(){
  const Q=tbPlan(), out=[], esp=k=>!(k in TB.d), mk=(t,v,sub,c,src,pct)=>({t,v,sub,c,src,pct});
  const nd=(t,k,src)=>mk(t,"…",esp(k)?"cargando":"sin dato o sin permiso","var(--tenue)",src,null);
  const A=Q?Q.A.filter(x=>tbSel(x.area)):[];
  if(Q&&A.length){
    const opt=tbSuma(A,"opt"), min=tbSuma(A,"min"), dfs=tbSuma(A,"df"), efR=dfs?tbSuma(A,"ay")/dfs*100:0, proy=A.every(x=>x.proy!=null)?tbSuma(A,"proy"):null;
    out.push(mk("Meta del mes",tbP(opt?min/opt*100:0),`${tbN(min)} de ${tbN(opt)} min`,TB_AZ,"Inicio › Meta del mes",opt?min/opt*100:0));
    out.push(mk("Cierre proyectado",proy==null?"—":tbN(proy),proy==null?"sin mes anterior":`min · meta ${tbN(opt)}`,TB_AZ,"Inicio › Cierre proyectado",null));
    out.push(mk("Eficiencia real",tbP(efR,1),`meta ${tbP(Q.efMeta*100,1)}`,TB_AZ,"Inicio › Eficiencia por área",Q.efMeta?efR/(Q.efMeta*100)*100:0));
    out.push(mk("Personal",`${tbSuma(A,"pers")} de ${tbSuma(A,"estr")}`,"personas hoy y en la estructura",TB_AZ,"Inicio › Personal",null));
  } else for(const t of ["Meta del mes","Cierre proyectado","Eficiencia real","Personal"]) out.push(nd(t,"plan","Inicio"));
  const E=TB.d.efp;
  if(E&&E.ok){ const a=(E.areas||[]).filter(x=>x.area!=="UDP"&&tbSel(x.area)); out.push(mk("Minutos del periodo",tbN(a.reduce((s,x)=>s+(+x.minutos||0),0)),"minutos producidos",TB_AZ,"Eficiencia › Minutaje por área",null)); }
  else out.push(nd("Minutos del periodo","efp","Eficiencia"));
  const C=TB.d.cant;
  if(C&&C.ok){ const a=(C.areas||[]).filter(x=>x.area!=="UDP"&&tbSel(x.area)); out.push(mk("Prendas del periodo",tbN(a.reduce((s,x)=>s+(+x.cantidad||0),0)),"penúltima operación",TB_AZ,"Cantidad por área",null)); }
  else out.push(nd("Prendas del periodo","cant","Cantidad por área"));
  const P=TB.d.pcp;
  if(P&&P.ok){
    const F=tbPcp(), c=(lo,hi)=>F.filter(x=>x.status!=null&&x.status>=lo&&x.status<=hi).length, prog=F.reduce((s,x)=>s+(+x.cant_prog||0),0), hec=F.reduce((s,x)=>s+(+x.hecho||0),0);
    out.push(mk("OF con avance 80–100 %",`${c(80,100)} de ${F.length}`,"OF programadas de costura",TB_V,"PCP › Cronograma, tarjeta verde",null));
    out.push(mk("OF con avance 51–79 %",`${c(51,79)} de ${F.length}`,"OF programadas de costura",TB_A,"PCP › Cronograma, tarjeta ámbar",null));
    out.push(mk("OF con avance 0–50 %",`${c(0,50)} de ${F.length}`,"OF programadas de costura",TB_R,"PCP › Cronograma, tarjeta roja",null));
    out.push(mk("Prendas de costura",`${tbN(hec)} de ${tbN(prog)}`,"hechas de las programadas",TB_AZ,"PCP › Cronograma, Cant prog y avance",null));
  } else for(const t of ["OF con avance 80–100 %","OF con avance 51–79 %","OF con avance 0–50 %","Prendas de costura"]) out.push(nd(t,"pcp","PCP › Cronograma"));
  const I=TB.d.inc;
  out.push(I&&I.ok?mk("Minutos de incidencia",tbN(I.total),`${tbN(I.otra_cosa)} eran trabajo en otra cosa`,TB_AZ,"Incidencias › Reprocesos y apoyo",null):nd("Minutos de incidencia","inc","Incidencias"));
  const B=TB.d.cal;
  if(B&&B.ok){ const g=(B.areas||[]).filter(a=>tbSel(a.area)); out.push(mk("Bases con avisos",String(g.reduce((s,a)=>s+a.grave+a.revisar,0)),"operaciones por corregir",TB_AZ,"Calidad de BASE (hoy)",null)); }
  else out.push(nd("Bases con avisos","cal","Calidad de BASE"));
  return out;
}
const tbPcp=()=>((TB.d.pcp&&TB.d.pcp.filas)||[]).filter(x=>!/TALLER/i.test(x.planta||"")&&tbSel(x.area));
/* Tabla 1: por línea (todas las cifras ya existen en Inicio, Eficiencia y Cantidad). */
const TB_COL=["Línea","Meta del mes","A la fecha","% de la meta","Ef. del periodo","Min. del periodo","Prendas del periodo"];
function tbFilas(){
  const Q=tbPlan(); if(!Q) return [];
  const E=((TB.d.efp&&TB.d.efp.areas)||[]), C=((TB.d.cant&&TB.d.cant.areas)||[]);
  return Q.A.filter(x=>tbSel(x.area)).map(x=>{ const e=E.find(y=>y.area===x.area)||{}, c=C.find(y=>y.area===x.area)||{};
    return [tbCorto(x.area),Math.round(x.opt),Math.round(x.min),+(x.opt?x.min/x.opt*100:0).toFixed(0),e.eficiencia==null?null:+(+e.eficiencia).toFixed(1),Math.round(+e.minutos||0),Math.round(+c.cantidad||0)]; });
}
const tbVer=(v,i)=>v==null?"—":i===3||i===4?v+" %":i===0?`<b>${esc(v)}</b>`:tbN(v);
function tbSort(F,o){ return F.sort((a,b)=>{ const x=a[o.k],y=b[o.k]; return (x==null?-1e9:x)>(y==null?-1e9:y)?o.d:(x==null?-1e9:x)<(y==null?-1e9:y)?-o.d:0; }); }
function tbTabla1(){
  const z=$("tbTabla"); if(!z) return;
  const F=tbSort(tbFilas().filter(r=>r.every((v,i)=>!TB.f[i]||String(v==null?"":v).toLowerCase().includes(TB.f[i]))),TB.o);
  const body=F.map(r=>`<tr>${r.map((v,i)=>`<td class="${i?"":"izq"}">${tbVer(v,i)}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="7"><div class="vacio-msg">Sin datos</div></td></tr>`;
  tbEnc(z,"tbTabla",TB_COL,TB.o,TB.f,"tbOrden","tbFiltro",body);
}
/* Tabla 2: OF del cronograma de costura, con el status del PCP. */
const TB_COL2=["Línea","OF","Artículo","Cant prog","Avance","Status"];
const tbStEt=s=>s==null?"Sin avance":s>=80?"Verde":s>=51?"Ámbar":"Rojo";
function tbFilas2(){ return tbPcp().map(x=>[tbCorto(x.area),String(x.o_f||"—"),x.articulo||"—",+x.cant_prog||0,x.status==null?null:+x.status,tbStEt(x.status)]); }
function tbTabla2(){
  const z=$("tbTabla2"); if(!z) return;
  const F=tbSort(tbFilas2().filter(r=>r.every((v,i)=>!TB.fo[i]||String(v==null?"":v).toLowerCase().includes(TB.fo[i]))),TB.oo);
  const cl={Verde:"v",Ámbar:"a",Rojo:"r"};
  const body=F.map(r=>`<tr><td class="izq"><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td class="izq">${esc(r[2])}</td><td>${tbN(r[3])}</td><td>${r[4]==null?"—":r[4]+" %"}</td><td><span class="tb-tag ${cl[r[5]]||"g"}">${r[5]}</span></td></tr>`).join("")||`<tr><td colspan="6"><div class="vacio-msg">Sin OF programadas</div></td></tr>`;
  tbEnc(z,"tbTabla2",TB_COL2,TB.oo,TB.fo,"tbOrden2","tbFiltro2",body);
}
function tbEnc(z,id,cols,o,f,fo,ff,body){
  const tb=z.querySelector("tbody"), foco=document.activeElement&&z.contains(document.activeElement)&&document.activeElement.classList.contains("tb-f");
  if(tb&&foco){ tb.innerHTML=body; return; }
  z.innerHTML=`<table class="tabla sin-orden sin-filtro"><thead><tr>${cols.map((t,i)=>`<th class="${i?"":"izq"}" onclick="${fo}(${i})">${t}${o.k===i?(o.d>0?" ▲":" ▼"):""}<input class="tb-f" value="${esc(f[i]||"")}" placeholder="Filtrar" onclick="event.stopPropagation()" oninput="${ff}(${i},this.value)"></th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}
function tbOrden(i){ TB.o=TB.o.k===i?{k:i,d:-TB.o.d}:{k:i,d:1}; $("tbTabla").innerHTML=""; tbTabla1(); }
function tbFiltro(i,v){ TB.f[i]=v.toLowerCase(); tbTabla1(); }
function tbOrden2(i){ TB.oo=TB.oo.k===i?{k:i,d:-TB.oo.d}:{k:i,d:1}; $("tbTabla2").innerHTML=""; tbTabla2(); }
function tbFiltro2(i,v){ TB.fo[i]=v.toLowerCase(); tbTabla2(); }
/* Eficiencia diaria por área del mes elegido, con la meta de Inicio. */
function tbLinea(){
  const r=TB.d.efm||TB.d.efp, z=$("tbLinea"); if(!z) return;
  if(!r){ z.innerHTML=`<div class="vacio-msg">Cargando…</div>`; return; }
  if(!r.ok||!(r.por_fecha||[]).length){ z.innerHTML=`<div class="vacio-msg">Sin datos</div>`; return; }
  const Q=tbPlan(), meta=Q?Q.efMeta*100:null, ar=(r.areas||[]).map(a=>a.area).filter(a=>a!=="UDP"&&tbSel(a));
  const F=r.por_fecha, W=520, H=230, L=38, B=24, X=i=>L+(F.length>1?i*(W-L-10)/(F.length-1):(W-L)/2);
  const vals=[]; F.forEach(f=>ar.forEach(a=>{ const v=f.valores&&f.valores[a]; if(v&&v.ef) vals.push(+v.ef); }));
  const mx=Math.max(100,Math.ceil(Math.max(...vals,meta||0,0)/10)*10), Y=v=>H-B-(v/mx)*(H-B-8);
  const COL=["var(--azul)","var(--dorado)","var(--exito)","var(--cian)","var(--violeta)","var(--ocre)"];
  let h=""; for(let v=0;v<=mx;v+=20) h+=`<line x1="${L}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="4" y="${Y(v)+4}">${v}</text>`;
  if(meta) h+=`<line x1="${L}" x2="${W}" y1="${Y(meta)}" y2="${Y(meta)}" class="m"/>`;
  const paso=Math.ceil(F.length/8); F.forEach((f,i)=>{ if(i%paso===0) h+=`<text x="${X(i)-12}" y="${H-6}">${tbDM(f.fecha)}</text>`; });
  ar.forEach((a,k)=>{ const pts=F.map((f,i)=>{ const v=f.valores&&f.valores[a]; return v&&v.ef?`${X(i)},${Y(+v.ef)}`:null; }).filter(Boolean).join(" "); if(pts) h+=`<polyline points="${pts}" fill="none" stroke="${COL[k%6]}" stroke-width="2.4" stroke-linejoin="round"/>`; });
  z.innerHTML=`<div class="tb-lg">${ar.map((a,k)=>`<span><i style="background:${COL[k%6]}"></i>${esc(tbCorto(a))}</span>`).join("")}${meta?`<span><i class="m"></i>Meta ${tbP(meta,0)}</span>`:""}</div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Eficiencia diaria por área">${h}</svg>`;
}
function tbPintar(){
  const k=$("tbKpis"); if(!k) return;
  k.innerHTML=tbIndicadores().map(x=>`<div class="tb-k" style="--c:${x.c}"><small>${esc(x.t)}</small><b>${x.v}</b><span class="tb-s">${esc(x.sub)}</span>
    ${x.pct==null?"":`<div class="tb-bar"><i style="width:${Math.max(0,Math.min(100,x.pct)).toFixed(0)}%"></i></div>`}<em>${esc(x.src)}</em></div>`).join("");
  tbOcho(); tbTabla1(); tbTabla2();
}

/* ---- Las 8 tarjetas. Asignado = Meta del mes de Inicio; real = minutos a la fecha. ---- */
const tbCol=p=>p>=80?TB_V:p>=51?TB_A:TB_R;
function tbBarras(F,max){ return F.map(x=>`<div class="tb8-r"><span>${esc(x[0])}</span><div class="tb-bar"><i style="width:${Math.max(0,Math.min(100,x[1]/(max||100)*100)).toFixed(0)}%;background:${x[2]||TB_AZ}"></i></div><b>${tbP(x[1])}</b></div>`).join(""); }
function tbOps(){
  const r=TB.d.opq; if(!r||!r.ok) return null; const a=TB.area||"ACABADO";
  return {a,P:(r.personas||[]).filter(p=>p.area===a&&!p.supervisora&&!p.cesado&&p.prom_ef!=null).sort((x,y)=>y.prom_ef-x.prom_ef)};
}
function tbDona(p,c){ const R=52,L=2*Math.PI*R,v=Math.max(0,Math.min(100,p)); return `<svg viewBox="0 0 140 140" width="150" role="img" aria-label="${tbP(p)}"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--linea)" stroke-width="16"/><circle cx="70" cy="70" r="${R}" fill="none" stroke="${c}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(L*v/100).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 70 70)"/><text x="70" y="78" text-anchor="middle" class="tb8-d">${tbP(p)}</text></svg>`; }
function tbTend(){
  const r=TB.d.efm||TB.d.efp; if(!r) return `<div class="vacio-msg">Cargando…</div>`; if(!r.ok||!(r.por_fecha||[]).length) return `<div class="vacio-msg">Sin datos</div>`;
  const ar=(r.areas||[]).map(a=>a.area).filter(a=>a!=="UDP"&&a!=="CORTE"&&tbSel(a));
  const F=r.por_fecha, W=520, H=210, L=34, B=22, X=i=>L+(F.length>1?i*(W-L-10)/(F.length-1):(W-L)/2);
  const mx=100, Y=v=>H-B-(Math.min(v,mx)/mx)*(H-B-8), COL=["var(--azul)","var(--dorado)","var(--exito)","var(--cian)","var(--ocre)"];
  let h=""; for(let v=0;v<=100;v+=20) h+=`<line x1="${L}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="4" y="${Y(v)+4}">${v}</text>`;
  h+=`<line x1="${L}" x2="${W}" y1="${Y(80)}" y2="${Y(80)}" class="m"/>`;
  const paso=Math.ceil(F.length/8); F.forEach((f,i)=>{ if(i%paso===0) h+=`<text x="${X(i)-12}" y="${H-6}">${tbDM(f.fecha)}</text>`; });
  ar.forEach((a,k)=>{ const pts=F.map((f,i)=>{ const v=f.valores&&f.valores[a]; return v&&v.ef?`${X(i)},${Y(+v.ef)}`:null; }).filter(Boolean).join(" "); if(pts) h+=`<polyline points="${pts}" fill="none" stroke="${COL[k%5]}" stroke-width="2.4" stroke-linejoin="round"/>`; });
  return `<div class="tb-lg">${ar.map((a,k)=>`<span><i style="background:${COL[k%5]}"></i>${esc(tbCorto(a))}</span>`).join("")}<span><i class="m"></i>80 %</span></div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Eficiencia diaria">${h}</svg>`;
}
function tbOcho(){
  const z=$("tb8"); if(!z) return; const Q=tbPlan(), cd=(n,t,b,c)=>`<section class="tb8-c ${c||""}"><div class="tb8-h"><i>${n}</i><b>${t}</b></div>${b}</section>`;
  const cargando=`<div class="vacio-msg">Cargando…</div>`, sin=`<div class="vacio-msg">Sin dato</div>`;
  let h="";
  if(!Q){ const m=TB.d.plan?sin:cargando; h=[1,2,3,6,8].map(n=>cd(n,["","Cumplimiento total de cuotas","Cumplimiento por línea de producto","Cumplimiento por área","","","Real frente a asignado","","Brechas que requieren atención"][n],m)).join(""); }
  else {
    const A=Q.A, pc=x=>x.opt?x.min/x.opt*100:0, T=(L)=>({o:tbSuma(L,"opt"),m:tbSuma(L,"min")}), t=T(A), pt=t.o?t.m/t.o*100:0;
    h+=cd(1,"Cumplimiento total de cuotas",`<div class="tb8-do">${tbDona(pt,tbCol(pt))}<div><b>${tbN(t.m)}</b><small>de ${tbN(t.o)} min</small></div></div>`);
    const linea=A.filter(x=>/CAMISA|PANTALON|SACO/.test(x.area)).map(x=>[tbCorto(x.area),pc(x),tbCol(pc(x))]);
    h+=cd(2,"Cumplimiento por línea de producto",tbBarras(linea,100));
    const cos=T(A.filter(x=>/COSTURA/.test(x.area))), g=(n,L)=>{ const q=T(L); return [n,q.o?q.m/q.o*100:0]; };
    const ar3=[g("Corte",A.filter(x=>x.area==="CORTE")),["Costura",cos.o?cos.m/cos.o*100:0],g("Acabado",A.filter(x=>x.area==="ACABADO")),g("Reproceso",A.filter(x=>x.area==="REPROCESO"))].map(x=>[x[0],x[1],tbCol(x[1])]);
    h+=cd(3,"Cumplimiento por área",tbBarras(ar3,100));
  }
  const O=tbOps(), ref=80;
  if(!O) h+=cd(4,"Cumplimiento por operario",TB.d.opq?sin:cargando)+cd(5,"Operarios que cumplen y no cumplen",TB.d.opq?sin:cargando);
  else {
    const P=O.P, ok=P.filter(p=>+p.prom_ef>=ref).length, no=P.length-ok, et=tbCorto(O.a);
    h+=cd(4,`Cumplimiento por operario`,`<small class="tb8-s">${esc(et)} · del ${tbDM(TB.Q.desde)} al ${tbDM(TB.Q.hasta)}</small><div class="tb8-sc">${P.map(p=>`<div class="tb8-r"><span title="${esc(p.nombre)}">${esc(String(p.nombre).split(",")[0])}</span><div class="tb-bar"><i style="width:${Math.min(100,+p.prom_ef).toFixed(0)}%;background:${+p.prom_ef>=ref?TB_V:TB_R}"></i><u style="left:${ref}%"></u></div><b>${tbP(+p.prom_ef)}</b></div>`).join("")||sin}</div>`);
    h+=cd(5,"Operarios que cumplen y no cumplen",`<small class="tb8-s">${esc(et)} · referencia ${ref} %</small><div class="tb8-cn"><div style="--c:${TB_V}"><b>${ok}</b><span>Cumplen</span></div><div style="--c:${TB_R}"><b>${no}</b><span>No cumplen</span></div></div><div class="tb-bar" style="height:10px"><i style="width:${P.length?ok/P.length*100:0}%;background:${TB_V}"></i></div>`);
  }
  if(Q){
    const A=Q.A, o=tbSuma(A,"opt"), m=tbSuma(A,"min"), pt=o?m/o*100:0;
    h+=cd(6,"Real frente a asignado",`<div class="tb-bar" style="height:14px"><i style="width:${Math.min(100,pt).toFixed(0)}%;background:${TB_AZ}"></i></div><div class="tb8-rf"><div><small>Real</small><b>${tbN(m)}</b></div><div><small>Asignado</small><b>${tbN(o)}</b></div><div><small>Falta</small><b>${tbN(Math.max(0,o-m))}</b></div></div>`);
  }
  h+=cd(7,"Tendencia del cumplimiento",`<div id="tbLinea">${tbTend()}</div>`,"tb8-w");
  if(Q){
    const L=Q.A.map(x=>({a:x.area,f:x.opt-x.min,p:x.opt?x.min/x.opt*100:0,al:x.proy!=null&&x.proy<x.opt})).sort((a,b)=>b.f-a.f);
    h+=cd(8,"Brechas que requieren atención",L.map(x=>`<div class="tb8-b"><span>${esc(tbCorto(x.a))}</span><b>${x.f>0?"−":""}${tbN(Math.abs(x.f))}</b><em>${tbP(x.p)}</em>${x.al?`<i class="tb-tag r">ATENCIÓN</i>`:`<i class="tb-tag v">AL DÍA</i>`}</div>`).join("")||sin);
  }
  z.innerHTML=h;
}
