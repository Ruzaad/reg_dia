/* PCP · Cronograma de costura (parche 178). Programa de costura + STD de la base + avance real de la penúltima operación. */
const PCS={mes:"",r:null,f:{sem:"",planta:"",linea:"",cliente:"",est:"",q:""}};
const PCS_META=[["PLANTA","Planta"],["CAMISA COSTURA","Camisa"],["PANTALON COSTURA","Pantalón"],["SACO COSTURA","Saco"],["CORTE","Corte"],["ACABADO","Acabado"],["REPROCESO","Reproceso"]];
const pcsMes=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const pcsN=n=>Math.round(+n||0).toLocaleString("es-PE");
const pcsDM=f=>f?f.slice(8,10)+"/"+f.slice(5,7):"—";
const pcsSem=st=>st==null?"":st>=80?"v":st>=51?"a":"r";
function pcsLunes(f){ const d=new Date(f+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)); return d.toISOString().slice(0,10); }
function pcsNumSem(l){ const d=new Date(l+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+3); const j=new Date(Date.UTC(d.getUTCFullYear(),0,4)); return 1+Math.round(((d-j)/864e5-3+((j.getUTCDay()+6)%7))/7); }
function pcsRango(l){ const a=new Date(l+"T00:00:00Z"), b=new Date(a.getTime()+6*864e5);
  return `${a.getUTCDate()}${a.getUTCMonth()===b.getUTCMonth()?"":" "+pcsMes[a.getUTCMonth()]}–${b.getUTCDate()} ${pcsMes[b.getUTCMonth()]}`; }

async function pcsCargar(){
  const box=$("pcpCron"); if(!box) return;
  PCS.mes=($("pcpMes").value||hoyLima().slice(0,7))+"-01";
  box.innerHTML=cargandoHTML("Armando el cronograma…");
  try{
    const r=await rpc("fn_pcp_costura",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    PCS.r=r; { const c=$("pcpCargas"); if(c) c.hidden=!r.puede_editar; }
    pcsPintar();
  }catch(e){
    box.innerHTML=/fn_pcp_costura|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 178 en la base.</b></div>` : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}
function pcsFiltrar(){
  const F=PCS.f, q=F.q.trim().toUpperCase();
  return (PCS.r.filas||[]).filter(x=>{
    const l=x.ini?pcsLunes(x.ini):"sin";
    return (!F.sem||l===F.sem) && (!F.planta||x.planta===F.planta) && (!F.linea||x.linea===F.linea) && (!F.cliente||x.cliente===F.cliente)
      && (!F.est||(F.est==="obs"?x.obs.length:F.est==="s"?x.status==null:pcsSem(x.status)===F.est))
      && (!q||String(x.articulo||"").includes(q)||String(x.o_f||"").includes(q)||String(x.modelo||"").toUpperCase().includes(q));
  });
}
function pcsOpts(k,v,txt){ const s=[...new Set((PCS.r.filas||[]).map(x=>x[k]).filter(Boolean))].sort();
  return `<option value="">${txt}</option>`+s.map(a=>`<option${a===v?" selected":""}>${esc(a)}</option>`).join(""); }
function pcsFiltro(k,v){ PCS.f[k]=v; pcsPintar(); }
function pcsFila(x){
  const s=pcsSem(x.status), ob=(x.obs||[]).map(t=>`<span class="pcs-ob${x.bloquea&&/BASE|REGISTRADO/.test(t)?" bl":""}">${esc(t)}</span>`).join("");
  const tip=x.est?`${x.est} personas × 9,57 h × 60 = ${pcsN(x.min_dia)} min por día`:"";
  return `<tr><td>${esc(x.planta)}</td><td>${esc(x.linea)}</td><td>${esc(x.prenda)}</td><td>${esc(x.cliente)}</td><td><b>${esc(x.articulo)}</b></td><td>${esc(x.modelo)}</td><td>${esc(x.color)}</td>
    <td class="num">${esc(x.o_f||"—")}</td><td class="num">${pcsDM(x.target)}</td><td class="num">${pcsN(x.cant_prog)}</td><td class="num">${x.std!=null?(+x.std).toFixed(1).replace(".",","):"—"}</td>
    <td class="num" title="${esc(tip)}">${x.dias!=null?String(x.dias).replace(".",","):"—"}</td><td class="num">${pcsDM(x.ini)}</td><td class="num">${pcsDM(x.fin)}</td>
    <td class="num">${x.status!=null?`<span class="pcs-st ${s}">${x.status} %</span>`:"—"}</td><td class="pcs-obs">${ob}</td></tr>`;
}
function pcsPintar(){
  const r=PCS.r, F=PCS.f, tot=r.filas||[], v=pcsFiltrar();
  const c=k=>tot.filter(x=>pcsSem(x.status)===k).length, [y,m]=r.mes.split("-").map(Number);
  const k=(n,t,cl)=>`<div class="acf-k"><b${cl?` class="${cl}"`:""}>${n}</b><span>${t}</span></div>`;
  const sems={}; v.forEach(x=>{ const l=x.ini?pcsLunes(x.ini):"sin"; (sems[l]=sems[l]||[]).push(x); });
  const claves=Object.keys(sems).sort((a,b)=>a==="sin"?1:b==="sin"?-1:a<b?-1:1);
  const todasSem=[...new Set(tot.map(x=>x.ini?pcsLunes(x.ini):"sin"))].sort((a,b)=>a==="sin"?1:b==="sin"?-1:a<b?-1:1);
  const cuerpo=claves.map(l=>{ const f=sems[l];
    return `<tbody><tr class="pcs-sem"><th colspan="16">${l==="sin"?"Sin fecha de inicio":`Semana ${pcsNumSem(l)} · ${pcsRango(l)}`} <i>${f.length} OF</i></th></tr>${f.map(pcsFila).join("")}</tbody>`; }).join("");
  const sel=(id,k2,txt)=>`<select class="pcp-in" onchange="pcsFiltro('${k2}',this.value)" aria-label="${txt}">${pcsOpts(k2,F[k2],txt)}</select>`;
  const ed=r.puede_editar?`<details class="pcs-meta"><summary>Meta del mes</summary><div class="pcs-meta-g">${PCS_META.map(a=>`<label class="campo"><span>${a[1]}</span><input class="pcp-in" id="pcsM_${a[0].replace(/ /g,"_")}" inputmode="numeric" value="${(r.metas||{})[a[0]]?pcsN(r.metas[a[0]]):""}"></label>`).join("")}
      <button class="btn-mini" type="button" onclick="pcsGuardarMeta()">Guardar</button></div></details>`:"";
  $("pcpCron").innerHTML=`<div class="acf-kpis">${k(tot.length,"OF programadas")}${k(c("v"),"avance 80–100 %","verde")}${k(c("a"),"avance 51–79 %","ambar")}${k(c("r"),"avance 0–50 %","rojo")}${k(tot.filter(x=>x.obs.length).length,"con observación")}</div>
    <section class="pcp-card pcs"><div class="pcp-h"><h2>Cronograma de costura · ${pcsMes[m-1]} ${y}</h2></div>
    <div class="pcs-filtros"><select class="pcp-in" onchange="pcsFiltro('sem',this.value)" aria-label="Semana"><option value="">Semana</option>${todasSem.map(l=>`<option value="${l}"${F.sem===l?" selected":""}>${l==="sin"?"Sin fecha":`Semana ${pcsNumSem(l)} · ${pcsRango(l)}`}</option>`).join("")}</select>
      ${sel("","planta","Planta")}${sel("","linea","Línea")}${sel("","cliente","Cliente")}
      <select class="pcp-in" onchange="pcsFiltro('est',this.value)" aria-label="Estado de avance"><option value="">Avance</option>${[["v","Verde"],["a","Amarillo"],["r","Rojo"],["s","Sin avance"],["obs","Con observación"]].map(o=>`<option value="${o[0]}"${F.est===o[0]?" selected":""}>${o[1]}</option>`).join("")}</select>
      <input class="pcp-in" type="search" placeholder="Artículo, OF o modelo" value="${esc(F.q)}" onchange="PCS.f.q=this.value;pcsPintar()" aria-label="Buscar"></div>
    <div class="tabla-scroll"><table class="tabla pcs-t"><thead><tr><th>Planta</th><th>Línea</th><th>Prenda</th><th>Cliente</th><th>Artículo</th><th>Modelo</th><th>Color</th><th class="num">OF</th><th class="num">Target</th><th class="num">Cant prog</th><th class="num">STD</th><th class="num">Días háb.</th><th class="num">Ini costura</th><th class="num">Fin costura</th><th class="num">Status</th><th>Observación</th></tr></thead>${cuerpo||`<tbody><tr><td colspan="16" class="acf-falta">Sin OF para este filtro.</td></tr></tbody>`}</table></div></section>${ed}`;
}
async function pcsGuardarMeta(){
  try{
    const g=a=>pcpNum($("pcsM_"+a.replace(/ /g,"_")).value)||0, m=PCS.r.metas||{}, cambios=[];
    let p=null; PCS_META.forEach(a=>{ const v=g(a[0]); if(v===(+m[a[0]]||0)) return; if(a[0]==="PLANTA") p=v; else cambios.push({alcance:"AREA",area:a[0],meta_minutos:v}); });
    if(p!=null){ const r=await rpc("fn_pcp_meta_mes_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes,p_minutos:p,p_prendas:0}); if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó"); }
    if(cambios.length){ const r=await rpc("fn_pcp_meta_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCS.mes,p_metas:cambios}); if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó"); }
    toast("Meta guardada","ok"); pcsCargar();
  }catch(e){ toast(e.message); }
}
