/* PCP · Calendario mensual de metas con redistribución (parche 172). Minutos y prendas. */
const PCC={mes:"",m:"min",r:null};
const pccN=n=>Math.round(+n||0).toLocaleString("es-PE");
const pccDias=["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];
const pccMeses=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

async function pccCargar(){
  const box=$("pcpCal"); if(!box) return;
  const mes=($("pcpMes").value||hoyLima().slice(0,7))+"-01"; PCC.mes=mes;
  box.innerHTML=cargandoHTML("Armando el calendario…");
  try{
    const r=await rpc("fn_pcp_calendario",{p_dni:ING.dni,p_token:ING.token,p_mes:mes});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    PCC.r=r; pccPintar();
  }catch(e){
    box.innerHTML=/fn_pcp_calendario|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 172 en la base.</b></div>` : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}

/* Meta diaria con redistribución: cada día hábil = lo que falta ÷ días hábiles que quedan.
   Un día ya pasado resta lo real; un día de hoy o futuro resta su propia meta. */
function pccCalcular(){
  const r=PCC.r, u=PCC.m==="un", hoy=r.hoy, sam=+r.sam||0;
  const meta=+(u?r.meta_un:r.meta_min)||0;
  let rest=meta, utiles=r.dias.filter(d=>d.habil).length;
  return r.dias.map(d=>{
    const real=+(u?d.real_un:d.real_min)||0, prog=+(u?d.prog_un:d.prog_min)||0;
    const disp=u?(sam>0?(+d.disp_min||0)/sam:0):(+d.disp_min||0);
    let t=0;
    if(d.habil && utiles>0){ t=Math.max(rest,0)/utiles; utiles--; }
    rest-= d.f<hoy ? (d.habil||real>0 ? real : 0) : t;
    const pasado=d.f<hoy, ext=d.f>=hoy&&d.habil?Math.max(0,prog-disp):0;
    return {...d,t,real,prog,disp,pasado,ext,pct:(pasado&&d.habil&&meta>0&&t>0)?real/t*100:null};
  });
}
const pccClase=p=>p==null?"":p>=95?"ok":p>=70?"am":"ro";
const pccPct=p=>p==null?"":`<span class="pcc-p ${pccClase(p)}">${Math.round(p)} %</span>`;

function pccPintar(){
  const r=PCC.r, u=PCC.m==="un", ed=r.puede_editar, ds=pccCalcular(), hoy=r.hoy;
  const meta=+(u?r.meta_un:r.meta_min)||0, cast=meta*0.85;
  const sum=a=>a.reduce((s,x)=>s+x,0);
  const realMes=sum(ds.map(d=>d.real)), antes=ds.filter(d=>d.pasado);
  const realAF=sum(antes.map(d=>d.real)), metaAF=sum(antes.map(d=>d.t)), castAF=metaAF*0.85;
  const vs=(a,b)=>b>0?a/b*100:null;
  const chip=p=>p==null?`<span class="pcc-p">—</span>`:`<span class="pcc-p ${pccClase(p)}">${p.toFixed(1)} %</span>`;
  const unidad=u?"prendas":"minutos";
  const [y,m]=r.mes.split("-").map(Number);

  const resumen=`<table class="tabla pcc-res"><thead><tr><th>Ventana</th><th class="num">Real</th><th class="num">Meta</th><th class="num">vs meta</th><th class="num">Meta × 0,85</th><th class="num">vs castigada</th></tr></thead><tbody>
    <tr><th scope="row">Mensual</th><td class="num"><b>${pccN(realMes)}</b></td><td class="num">${meta?pccN(meta):"—"}</td><td class="num">${chip(vs(realMes,meta))}</td><td class="num">${meta?pccN(cast):"—"}</td><td class="num">${chip(vs(realMes,cast))}</td></tr>
    <tr><th scope="row">A la fecha</th><td class="num"><b>${pccN(realAF)}</b></td><td class="num">${metaAF?pccN(metaAF):"—"}</td><td class="num">${chip(vs(realAF,metaAF))}</td><td class="num">${metaAF?pccN(castAF):"—"}</td><td class="num">${chip(vs(realAF,castAF))}</td></tr></tbody></table>`;

  const wd=s=>(new Date(s+"T00:00:00Z").getUTCDay()+6)%7;
  const sems=[]; let cur=null;
  ds.forEach(d=>{ const w=wd(d.f); if(!cur||w===0){ cur={dias:[],pre:w}; sems.push(cur); } cur.dias.push(d); });
  const celda=d=>{
    const dia=d.f.slice(8,10), tipo=d.tipo, marca=tipo==="feriado"?" ★":(!d.habil&&(tipo==="sabado"||tipo==="domingo"))?" ●":d.hab_extra?" ◆":"";
    const cab=ed?`<button type="button" class="pcc-n" onclick="pccDia('${d.f}',${!d.habil})" title="${d.habil?"Marcar como no laborable":"Habilitar para trabajar"}">${dia}${marca}</button>`:`<span class="pcc-n">${dia}${marca}</span>`;
    const hoyC=d.f===hoy?" pcc-hoy":"";
    if(!d.habil && !d.real) return `<td class="pcc-c off${hoyC}">${cab}${d.motivo?`<small>${esc(d.motivo)}</small>`:""}</td>`;
    const lin=(k,v,cl)=>`<div class="pcc-l ${cl||""}"><i>${k}</i><b>${v}</b></div>`;
    const vacio=d.pasado||d.f===hoy?pccN(d.real):"—";
    return `<td class="pcc-c${d.habil?"":" off"}${hoyC}">${cab}
      ${lin("M",d.habil?pccN(d.t):"—","m")}${lin("D",d.habil&&d.disp?pccN(d.disp):"—","d")}${lin("P",d.prog?pccN(d.prog):"—","p")}${lin("R",d.pasado||d.f===hoy?(d.real?pccN(d.real):"—"):"—","r")}
      ${d.f===hoy?`<span class="pcc-p">En curso</span>`:pccPct(d.pct)}${d.ext>0?`<div class="pcc-ex">+${pccN(d.ext)} extra</div>`:""}</td>`;
  };
  const filas=sems.map(s=>{
    const metaS=s.dias.reduce((a,d)=>a+d.t,0), realS=s.dias.reduce((a,d)=>a+d.real,0), cerrada=s.dias[s.dias.length-1].f<hoy;
    const rel=s.dias.slice(0,1)[0].f.slice(8,10)+"–"+s.dias[s.dias.length-1].f.slice(8,10);
    return `<tr><th class="pcc-sem" scope="row">${rel}</th>${"<td class='pcc-c vac'></td>".repeat(s.pre)}${s.dias.map(celda).join("")}${"<td class='pcc-c vac'></td>".repeat(7-s.pre-s.dias.length)}
      <td class="pcc-meta"><b>${pccN(realS)} / ${pccN(metaS)}</b>${metaS>0&&cerrada?pccPct(realS/metaS*100):""}</td></tr>`;
  }).join("");

  $("pcpCal").innerHTML=`<section class="pcp-card pcc"><div class="pcp-h"><h2>Calendario de producción · ${pccMeses[m-1]} ${y}</h2>
    <div class="seg pcc-seg" role="tablist"><button type="button" class="${u?"":"activo"}" onclick="pccMetrica('min')">Minutos</button><button type="button" class="${u?"activo":""}" onclick="pccMetrica('un')">Prendas</button></div></div>
    <div class="pcc-leyenda"><b>M</b> Meta del día · <b>D</b> Disponible · <b>P</b> Programado · <b>R</b> Real · <span class="pcc-p ok">≥ 95 %</span> <span class="pcc-p am">≥ 70 %</span> <span class="pcc-p ro">&lt; 70 %</span> · ★ feriado · ● fin de semana · ◆ día habilitado</div>
    ${ed?`<div class="pcc-edit"><label class="campo"><span>Meta del mes · minutos</span><input class="pcp-in" id="pccMeta_min" inputmode="numeric" value="${r.meta_min?pccN(r.meta_min):""}"></label>
      <label class="campo"><span>Meta del mes · prendas</span><input class="pcp-in" id="pccMeta_un" inputmode="numeric" value="${r.meta_un?pccN(r.meta_un):""}"></label>
      <button class="btn-mini" type="button" onclick="pccGuardarMeta()">Guardar meta</button></div>`:""}
    ${meta?"":`<div class="acf-falta">Sin meta de ${unidad} para este mes${ed?": ponla arriba":""}.</div>`}
    <div class="tabla-scroll">${resumen}</div>
    <div class="tabla-scroll"><table class="pcc-tabla"><thead><tr><th>Sem.</th>${pccDias.map(x=>`<th>${x}</th>`).join("")}<th>Meta sem.</th></tr></thead><tbody>${filas}</tbody></table></div></section>`;
}
function pccMetrica(m){ PCC.m=m; pccPintar(); }
async function pccDia(f,habil){
  let motivo=""; if(!habil || true){ motivo=window.prompt(habil?"Motivo para trabajar ese día (opcional):":"Motivo (opcional):","")||""; }
  try{
    const r=await rpc("fn_pcp_dia_cambiar",{p_dni:ING.dni,p_token:ING.token,p_fecha:f,p_habil:habil,p_motivo:motivo});
    if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó");
    toast("Día actualizado","ok"); pccCargar();
  }catch(e){ toast(e.message); }
}
async function pccGuardarMeta(){
  try{
    const r=await rpc("fn_pcp_meta_mes_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCC.mes,p_minutos:pcpNum($("pccMeta_min").value)||0,p_prendas:pcpNum($("pccMeta_un").value)||0});
    if(!r||!r.ok) throw new Error((r&&r.error)||"No se guardó");
    toast("Meta guardada","ok"); pccCargar(); pcpCargar();
  }catch(e){ toast(e.message); }
}
