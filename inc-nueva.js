/* =====================================================================
   CHRONOS · Incentivos › COMPARAR: tabla actual contra la nueva (tope 130 %)
   Solo lectura. Cada día de cada persona sale de fn_incentivos_quincena (eficiencia y soles de la
   tabla vigente); aquí se vuelve a buscar ese día en la tabla nueva. El modular no cambia.
   La tabla nueva vive en este archivo (sin tabla en la base) hasta que se fije la fecha de uso.
   ===================================================================== */
/* Tabla nueva: soles por día según categoría y eficiencia (80 a 130 %). */
const ICN_TABLA = (function(){
  const cab={A:[3.57,3.97,4.37,4.77,5.17,5.57,5.97,6.37,6.77,7.17],B:[0.76,1.16,1.56,1.96,2.36,2.76,3.16,3.56,3.96,4.36],
             C:[0.00,0.03,0.43,0.83,1.23,1.63,2.03,2.43,2.83,3.23],D:[0,0,0,0,0,0.2,0.6,1,1.4,1.8]};
  const T={}; Object.keys(cab).forEach(c=>{ T[c]={}; for(let p=80;p<=130;p++){ const i=p-80; T[c][p]= i<10?cab[c][i]:+(cab[c][9]+0.4*(i-9)).toFixed(2); } });
  return T;
})();
let ICN={filas:[],o:{k:6,d:1},f:{},soloBoleta:true,r:null};
const icnS=n=>"S/ "+(+n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g," ").replace(".",",");
const icnNueva=(cat,ef)=>{ const t=ICN_TABLA[cat]; if(!t||ef==null||Math.round(ef)<80) return 0; return t[Math.min(130,Math.round(ef))]||0; };
function incCmpInit(){
  if(!$("icnDesde").value){
    let {desde,hasta}=incRango();
    if(!desde){ const [a,m,d]=hoyLima().split("-").map(Number), mm=String(m).padStart(2,"0"), ult=new Date(a,m,0).getDate();
      desde=`${a}-${mm}-${d<=15?"01":"16"}`; hasta=`${a}-${mm}-${String(d<=15?15:ult).padStart(2,"0")}`; }
    $("icnDesde").value=desde; $("icnHasta").value=hasta; }
  if(!ICN.r) incCmpCargar();
}
async function incCmpCargar(){
  const d=$("icnDesde").value, h=$("icnHasta").value; if(!d||!h){ mostrarError("Elige el rango de la quincena"); return; }
  pintarCargando($("icnTabla"),"Calculando…");
  try{
    const r=await rpc("fn_incentivos_quincena",{p_dni:ING.dni,p_token:ING.token,p_desde:d,p_hasta:h,p_area:""});
    if(!r.ok){ mostrarError(r.error||"Error"); $("icnTabla").innerHTML=""; return; }
    ICN.r=r; incCmpArmar();
  }catch(e){ $("icnTabla").innerHTML=""; mostrarError(e.message); }
}
function incCmpArmar(){
  const r=ICN.r; if(!r) return;
  const lab=new Set((r.dias||[]).filter(x=>x.laborable).map(x=>x.fecha));
  ICN.filas=(r.personas||[]).filter(p=>p.area!=="UDP"&&!p.supervisora&&!p.cesado&&(!ICN.soloBoleta||(!(+p.boleta>0)&&!(+p.faltas>0))))
    .map(p=>{ let a=0,n=0,s100=0;
      Object.keys(p.dias||{}).forEach(f=>{ if(!lab.has(f)) return; const x=p.dias[f]; a+=+x.soles||0; if(x.ef!=null){ n+=icnNueva(p.categoria,+x.ef); if(Math.round(+x.ef)>100) s100++; } });
      return [p.nombre,p.area,p.categoria||"—",+(+p.prom_ef||0).toFixed(1),+a.toFixed(2),+n.toFixed(2),+(n-a).toFixed(2),s100]; });
  incCmpPintar();
}
const ICN_COL=["Operario","Área","Cat.","Prom. ef. %","Tabla actual","Tabla nueva","Diferencia","Días sobre 100 %"];
function incCmpPintar(){
  const F=ICN.filas, sum=(L,i)=>L.reduce((s,x)=>s+x[i],0), a=sum(F,4), n=sum(F,5);
  const pct=a?((n-a)/a*100):0, sg=v=>(v>0?"+":v<0?"−":"")+icnS(Math.abs(v));
  $("icnKpis").innerHTML=[["Personas",F.length,""],["Tabla actual",icnS(a),""],["Tabla nueva",icnS(n),""],["Diferencia",sg(n-a),(pct>0?"+":"")+pct.toFixed(1).replace(".",",")+" %"]]
    .map(k=>`<div class="tb-k" style="--c:var(--azul)"><small>${k[0]}</small><b>${k[1]}</b><span class="tb-s">${k[2]}</span></div>`).join("");
  const por={}; F.forEach(x=>{ const q=por[x[1]]=por[x[1]]||[0,0,0]; q[0]++; q[1]+=x[4]; q[2]+=x[5]; });
  $("icnAreas").innerHTML=`<table class="tabla sin-orden sin-filtro"><thead><tr><th class="izq">Área</th><th>Personas</th><th>Tabla actual</th><th>Tabla nueva</th><th>Diferencia</th></tr></thead><tbody>`+
    Object.keys(por).sort().map(k=>{ const q=por[k]; return `<tr><td class="izq"><b>${esc(k)}</b></td><td>${q[0]}</td><td>${icnS(q[1])}</td><td>${icnS(q[2])}</td><td>${sg(q[2]-q[1])}</td></tr>`; }).join("")+`</tbody></table>`;
  const L=F.filter(r=>r.every((v,i)=>!ICN.f[i]||String(v).toLowerCase().includes(ICN.f[i]))).sort((x,y)=>{ const u=x[ICN.o.k],v=y[ICN.o.k]; return u>v?ICN.o.d:u<v?-ICN.o.d:0; });
  const z=$("icnTabla"), foco=document.activeElement&&z.contains(document.activeElement)&&document.activeElement.classList.contains("tb-f");
  const body=L.map(r=>`<tr><td class="izq">${esc(r[0])}</td><td class="izq">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${String(r[3]).replace(".",",")}</td><td>${icnS(r[4])}</td><td>${icnS(r[5])}</td><td>${sg(r[6])}</td><td>${r[7]}</td></tr>`).join("")||`<tr><td colspan="8"><div class="vacio-msg">Sin datos</div></td></tr>`;
  if(z.querySelector("tbody")&&foco){ z.querySelector("tbody").innerHTML=body; return; }
  z.innerHTML=`<table class="tabla sin-orden sin-filtro"><thead><tr>${ICN_COL.map((t,i)=>`<th class="${i<2?"izq":""}" onclick="incCmpOrden(${i})">${t}${ICN.o.k===i?(ICN.o.d>0?" ▲":" ▼"):""}<input class="tb-f" value="${esc(ICN.f[i]||"")}" placeholder="Filtrar" onclick="event.stopPropagation()" oninput="incCmpFiltro(${i},this.value)"></th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}
function incCmpOrden(i){ ICN.o=ICN.o.k===i?{k:i,d:-ICN.o.d}:{k:i,d:1}; $("icnTabla").innerHTML=""; incCmpPintar(); }
function incCmpFiltro(i,v){ ICN.f[i]=v.toLowerCase(); incCmpPintar(); }
function incCmpBoleta(v){ ICN.soloBoleta=v; incCmpArmar(); }
