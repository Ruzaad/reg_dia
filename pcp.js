/* =====================================================================
   CHRONOS · Ingeniería › PCP (parche 144)
   PCP pone la meta del mes por área; la meta del día sale de dividirla entre
   los días laborables, y cada persona ve en su celular su parte (fn_mi_meta).
   Se alimenta a mano: el Excel del programa de costura y la hoja NOTI_CORTE
   (lo que sale de corte), leída del Google Sheets o subida como archivo.
   Una RPC de lectura (fn_pcp_resumen) y tres de escritura.
   ===================================================================== */
let PCP={r:null, mes:null};
const pcpN=n=>Math.round(+n||0).toLocaleString("es-PE");
const pcpPc=(a,b)=>b>0?Math.round(a/b*100):0;
const pcpDM=f=>f?String(f).slice(8,10)+"/"+String(f).slice(5,7):"—";
const pcpCorto=a=>String(a||"").replace(" COSTURA","");
const PCP_HOJAS=[["CAMISA","CAMISA COSTURA"],["PANTALON","PANTALON COSTURA"],["SACO","SACO COSTURA"]];

function pcpInit(){
  const m=$("pcpMes"); if(m && !m.value) m.value=hoyLima().slice(0,7);
  const u=$("pcpUrl"); if(u && !u.value){ try{ u.value=localStorage.getItem("pcp-url")||""; }catch(e){} }
  const d=$("pcpDesde"); if(d && !d.value){ const [y,mm]=hoyLima().split("-").map(Number); d.value=new Date(y,mm-2,1).toLocaleDateString("sv-SE"); }
  pcpCargar();
}
async function pcpCargar(){
  const box=$("pcpCuerpo"), mes=($("pcpMes").value||hoyLima().slice(0,7))+"-01";
  box.innerHTML=cargandoHTML("Leyendo metas, programa y corte…"); $("pcpKpis").innerHTML="";
  try{
    const r=await rpc("fn_pcp_resumen",{p_dni:ING.dni,p_token:ING.token,p_mes:mes});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    PCP.r=r; PCP.mes=mes;
    { const u=$("pcpUrl"), c=(r.cargas||{}).CORTE; if(u && !u.value && c && /^https?:/.test(c.archivo||"")) u.value=c.archivo; }
    $("pcpCargas").hidden=!r.puede_editar;
    pcpPintar();
  }catch(e){
    box.innerHTML = /fn_pcp_resumen|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 144 en la base.</b> Esta pantalla usa las funciones nuevas <code>fn_pcp_resumen</code>, <code>fn_pcp_meta_guardar</code>, <code>fn_pcp_programa_cargar</code> y <code>fn_pcp_corte_cargar</code>.</div>`
      : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}

function pcpTotales(r){
  const areas=r.areas||[], prod=areas.reduce((s,a)=>s+(+a.producido||0),0);
  const metaAreas=areas.reduce((s,a)=>s+(+a.meta_mes||0),0), meta=+r.meta_corp||metaAreas;
  /* Hoy va a medias: la proyección usa solo los días cerrados y lo de hoy cuenta como día que queda. */
  const hoyP=areas.reduce((s,a)=>s+(+a.producido_hoy||0),0), quedan=Math.max(0,r.laborables-r.transcurridos);
  const proy=r.transcurridos>0 ? (prod-hoyP)/r.transcurridos*r.laborables : 0;
  const prog=(r.programa||[]).reduce((s,p)=>s+(+p.programa||0),0);
  const sinProg=areas.filter(a=>!(r.programa||[]).some(p=>p.area===a.area)).reduce((s,a)=>s+(+a.producido||0),0);
  return {areas,prod,meta,metaAreas,proy,quedan,prog,sinProg,nec:quedan?Math.max(0,meta-prod)/quedan:0};
}
function pcpAvisos(r,t){
  const A=[];   // [clase, cifra, etiqueta, detalle, sección a la que lleva]
  if(!t.meta) A.push(["warn","Sin meta","PCP no puso la meta del mes","Escribe la meta de cada área en la tabla Meta por área. Mientras no haya meta, el celular del operario no muestra su meta del día.","pcpSecMetas"]);
  else{
    if(r.programa.length && t.prog+t.sinProg<t.meta) A.push(["crit",pcpPc(t.prog+t.sinProg,t.meta)+" %","del programa contra la meta",`Programado ${pcpN(t.prog+t.sinProg)} min de ${pcpN(t.meta)}. Costura ${pcpN(t.prog)} + lo producido por las áreas sin programa ${pcpN(t.sinProg)}.`,"pcpSecPrograma"]);
    if(t.proy && t.proy<t.meta) A.push([t.proy<t.meta*.8?"crit":"warn",pcpPc(t.proy,t.meta)+" %","cierre proyectado del mes",`Proyección ${pcpN(t.proy)} min.${t.quedan?` Harían falta ${pcpN(t.nec)} min por día en los ${t.quedan} días laborables que quedan${r.hoy_laborable?", contando hoy":""}.`:""}`,"pcpSecDia"]);
  }
  (r.programa||[]).forEach(p=>{
    const a=t.areas.find(x=>x.area===p.area), pr=a?+a.producido:0, d=pr-p.debia;
    if(p.debia>0 && d<0) A.push([-d>p.debia*.25?"crit":"warn","−"+pcpN(-d),pcpCorto(p.area)+" atrasado contra su programa",`Debía llevar ${pcpN(p.debia)} min por las fechas de fin de costura y lleva ${pcpN(pr)}.`,"pcpSecPrograma"]);
  });
  const arr=(r.arranque||[]).filter(x=>x.ini<=r.hoy);
  if(arr.length) A.push(["warn",arr.length+" OF","en costura sin corte completo",`${pcpN(arr.reduce((s,x)=>s+(x.cant_prog-x.cortado),0))} prendas por cortar en OF que ya debían estar en costura.`,"pcpSecGantt"]);
  if(!A.length) A.push(["ok","Al día","meta, programa y avance cuadran","","pcpSecMetas"]);
  return `<div class="pcp-chips" role="list">${A.map(a=>`<button type="button" role="listitem" class="pcp-chip ${a[0]}" title="${esc(a[3])}" onclick="pcpIr('${a[4]}')"><i aria-hidden="true"></i><b>${esc(a[1])}</b><span>${esc(a[2])}</span></button>`).join("")}</div>`;
}
function pcpIr(id){
  const e=$(id); if(!e) return;
  e.scrollIntoView({behavior:"smooth",block:"start"});
  e.classList.add("pcp-flash"); setTimeout(()=>e.classList.remove("pcp-flash"),1600);
}
function pcpPintar(){
  const r=PCP.r, t=pcpTotales(r), ed=r.puede_editar;
  const k=(v,txt,cls)=>`<div class="acf-k"><b${cls?` class="${cls}"`:""}>${v}</b><span>${txt}</span></div>`;
  $("pcpKpis").innerHTML=
     k(t.meta?pcpN(t.meta):"—", r.meta_corp?"meta del mes (corporación)":t.meta?"meta del mes (suma de áreas)":"sin meta de PCP este mes")
    +k(pcpN(t.prod), `minutos producidos${t.meta?` · ${pcpPc(t.prod,t.meta)} % de la meta`:""}`)
    +k(t.meta?pcpN(Math.max(0,t.meta-t.prod)):"—", t.quedan?`restan · ${pcpN(t.nec)} min por día en ${t.quedan} día${t.quedan===1?"":"s"}${r.hoy_laborable?" (con hoy)":""}`:"restan para la meta")
    +k(t.proy?pcpN(t.proy):"—", `proyección de cierre${t.meta&&t.proy?` · ${pcpPc(t.proy,t.meta)} %`:""}`, t.meta&&t.proy?(t.proy<t.meta?"rojo":"verde"):"")
    +k(`${r.transcurridos}/${r.laborables}`, "días laborables transcurridos (feriados descontados)");

  const filas=t.areas.map(a=>{
    const md=+a.meta_dia||0, ef=a.disponible_dia?Math.round(md/a.disponible_dia*100):0, av=pcpPc(a.producido,a.meta_mes);
    const esp=a.meta_mes? a.meta_mes*(r.transcurridos+(r.hoy_laborable?1:0))/r.laborables : 0;
    const est=!a.meta_mes?"":a.producido>=esp?`<span class="pcp-pill ok">Al día</span>`:a.producido>=esp*.85?`<span class="pcp-pill warn">Atraso leve</span>`:`<span class="pcp-pill crit">Atrasada</span>`;
    return `<tr><th scope="row">${esc(a.area)}</th>
      <td class="num">${a.personas||"—"}</td><td class="num">${a.disponible_dia?pcpN(a.disponible_dia):"—"}</td>
      <td class="num">${ed?`<input class="pcp-in" inputmode="numeric" data-area="${esc(a.area)}" value="${a.meta_mes?pcpN(a.meta_mes):""}" placeholder="${a.disponible_dia?pcpN(a.disponible_dia*r.laborables*.85):""}" aria-label="Meta del mes de ${esc(a.area)}">`:(a.meta_mes?pcpN(a.meta_mes):"—")}</td>
      <td class="num"><b>${md?pcpN(md):"—"}</b></td><td class="num">${md&&a.disponible_dia?ef+" %":"—"}</td>
      <td class="num">${pcpN(a.producido)}</td><td class="num">${r.hoy_laborable?pcpN(a.producido_hoy):"—"}</td>
      <td><span class="pcp-av" title="${av} % de la meta del mes"><i style="width:${Math.min(100,av)}%"></i></span>${a.meta_mes?av+" %":""}</td><td>${est}</td></tr>`;
  }).join("");
  const metas=`<section class="pcp-card" id="pcpSecMetas"><div class="pcp-h"><h2>Meta por área</h2>
      ${ed?`<span><button class="btn-mini gris" type="button" onclick="pcpSugerir()">Sugerir 85 %</button> <button class="btn-mini" type="button" onclick="pcpGuardarMetas()">Guardar metas</button></span>`:""}</div>
    <p class="seccion-sub">Disponible por día = personas MOD de la estructura del mes × jornada. Meta del día = meta del mes ÷ ${r.laborables} días laborables.
    Cada persona ve en su celular su parte: su jornada × (meta del día ÷ disponible del área).</p>
    ${ed?`<div class="fer-form pcp-corp"><label class="campo"><span>Meta de la corporación (min del mes)</span><input class="pcp-in" id="pcpCorp" inputmode="numeric" value="${r.meta_corp?pcpN(r.meta_corp):""}" placeholder="${t.metaAreas?pcpN(t.metaAreas):""}"></label></div>`:""}
    <div class="tabla-scroll"><table class="tabla pcp-tabla"><thead><tr><th>Área</th><th class="num">Personas</th><th class="num">Disponible/día</th><th class="num">Meta del mes</th>
      <th class="num">Meta del día</th><th class="num">Eficiencia meta</th><th class="num">Producido</th><th class="num">Hoy</th><th>Avance</th><th>Estado</th></tr></thead>
    <tbody>${filas||`<tr><td colspan="10">No hay estructura ni producción en este mes.</td></tr>`}</tbody></table></div></section>`;

  const prog=(r.programa||[]).map(p=>{
    const a=t.areas.find(x=>x.area===p.area), pr=a?+a.producido:0, d=pr-p.debia;
    const est=d>=0?`<span class="pcp-pill ok">Al día</span>`:-d>p.debia*.25?`<span class="pcp-pill crit">Desfasado</span>`:`<span class="pcp-pill warn">Atraso leve</span>`;
    return `<tr><th scope="row">${esc(p.area)}</th><td class="num">${pcpN(p.programa)}</td><td class="num">${pcpN(p.debia)}</td><td class="num">${pcpN(pr)}</td>
      <td class="num ${d<0?"rojo":"verde"}">${d<0?"−":"+"}${pcpN(Math.abs(d))}</td><td class="num">${pcpN(Math.max(0,p.programa-pr))}</td><td class="num">${pcpN(p.prendas)}</td><td>${est}</td></tr>`;
  }).join("");
  const ven=(r.vencidas||[]).map(v=>`<tr><td>${esc(pcpCorto(v.area))}</td><td>${esc(v.o_f||"sin OF")}</td><td>${esc(v.articulo||"")}</td><td>${esc(v.cliente||"")}</td>
      <td class="num">${pcpN(v.minutos)}</td><td>${pcpDM(v.fin)}</td><td class="num">${v.o_f?`${pcpN(v.cortado)} / ${pcpN(v.cant_prog)}`:"—"}</td></tr>`).join("");
  const cp=(r.cargas||{}).PROGRAMA;
  const programa=`<section class="pcp-card" id="pcpSecPrograma"><div class="pcp-h"><h2>Programa de costura contra producido</h2></div>
    <p class="seccion-sub">${cp?`Programa «${esc(cp.archivo||"")}» subido el ${pcpDM(String(cp.en).slice(0,10))} por ${esc(cp.por||"")} (${cp.filas} filas).`:"PCP todavía no sube su programa de costura."}
    Programa = cantidad programada × STD de las filas del mes. Producido = prendas de la penúltima operación × S.A.M del artículo. «Debía llevar» suma las que ya pasaron su fin de costura.</p>
    ${prog?`<div class="tabla-scroll"><table class="tabla pcp-tabla"><thead><tr><th>Área</th><th class="num">Programa</th><th class="num">Debía llevar</th><th class="num">Producido</th>
      <th class="num">Desfase</th><th class="num">Restante</th><th class="num">Prendas</th><th>Estado</th></tr></thead><tbody>${prog}</tbody></table></div>`:""}
    ${ven?`<h3 class="pcp-sub">OF con fin de costura vencido y sin FINALIZADO</h3><div class="tabla-scroll"><table class="tabla pcp-tabla"><thead><tr><th>Área</th><th>OF</th><th>Artículo</th><th>Cliente</th>
      <th class="num">Minutos</th><th>Fin</th><th class="num">Cortado</th></tr></thead><tbody>${ven}</tbody></table></div>`:""}</section>`;

  const c=r.corte||{}, dias=c.dias||[], cc=(r.cargas||{}).CORTE, mx=Math.max(1,...dias.map(d=>+d.c));
  const ult=dias.slice(-10), ritmo=ult.length?ult.reduce((s,d)=>s+(+d.c),0)/ult.length:0;
  const corte=`<section class="pcp-card" id="pcpSecCorte"><div class="pcp-h"><h2>Salida de corte</h2></div>
    <p class="seccion-sub">${cc?`NOTI_CORTE leída el ${pcpDM(String(cc.en).slice(0,10))} por ${esc(cc.por||"")}: ${cc.filas} filas del ${pcpDM(cc.desde)} al ${pcpDM(cc.hasta)}.`:"Todavía no se lee la hoja NOTI_CORTE."}
    Es lo que sale de corte y queda disponible para costura.</p>
    <div class="acf-kpis">${k(pcpN(c.total),"prendas cortadas en el mes")}${k(pcpN(ritmo),"prendas por día (últimos "+ult.length+" días con corte)")}</div>
    ${dias.length?`<div class="pcp-dias" role="img" aria-label="Prendas cortadas por día">${dias.map(d=>`<div title="${pcpDM(d.f)}: ${pcpN(d.c)} prendas"><i style="height:${Math.max(3,d.c/mx*100)}%"></i><span>${String(d.f).slice(8,10)}</span></div>`).join("")}</div>`:""}</section>`;

  $("pcpCuerpo").innerHTML=pcpAvisos(r,t)+`<div id="pcpSeg"></div>`+metas+programa+corte;
  pcpSeguimiento();
}

const pcpNum=v=>{ if(typeof v==="number") return v; const s=String(v==null?"":v).replace(/[^\d.,\-]/g,""); return s?Number(s.replace(/,/g,"")):NaN; };
function pcpSugerir(){
  const r=PCP.r;
  document.querySelectorAll("#pcpCuerpo .pcp-in[data-area]").forEach(i=>{
    if(i.value.trim()) return;
    const a=(r.areas||[]).find(x=>x.area===i.dataset.area);
    if(a && a.disponible_dia) i.value=pcpN(a.disponible_dia*r.laborables*.85);
  });
  toast("Llené las vacías con disponible × días laborables × 85 %. Revísalas y guarda.","ok");
}
async function pcpGuardarMetas(){
  const metas=[...document.querySelectorAll("#pcpCuerpo .pcp-in[data-area]")].map(i=>({alcance:"AREA",area:i.dataset.area,meta_minutos:pcpNum(i.value)||0}));
  const c=$("pcpCorp"); if(c) metas.push({alcance:"CORPORACION",meta_minutos:pcpNum(c.value)||0});
  try{
    const r=await rpc("fn_pcp_meta_guardar",{p_dni:ING.dni,p_token:ING.token,p_mes:PCP.mes,p_metas:metas});
    if(!r || !r.ok) throw new Error((r&&r.error)||"No se guardó");
    toast("Metas guardadas","ok"); pcpCargar();
  }catch(e){ toast(e.message); }
}

/* ---------- lectura de archivos ---------- */
function pcpFecha(v){
  if(v instanceof Date && !isNaN(v)) return new Date(v.getTime()+432e5).toLocaleDateString("sv-SE");
  if(typeof v==="number" && v>20000 && v<80000){ const d=XLSX.SSF.parse_date_code(v); return d?`${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`:null; }
  const s=String(v==null?"":v).trim(); let m;
  if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  if((m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))){ const y=m[3].length===2?"20"+m[3]:m[3]; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  return null;
}
/* Busca la fila de cabeceras (la primera que tenga todas las pedidas) y devuelve {fila, col}. */
function pcpCabeceras(rows, pedidas, alias){
  for(let i=0;i<Math.min(rows.length,30);i++){
    const col={}; (rows[i]||[]).forEach((h,j)=>{ const k=normKey(h); const n=alias[k]||k; if(n && col[n]===undefined) col[n]=j; });
    if(pedidas.every(p=>col[p]!==undefined)) return {fila:i,col};
  }
  return null;
}
function pcpEstado(msg, tipo){
  const e=$("pcpEstado"); if(e){ e.textContent=msg; e.className="pcp-estado "+(tipo||""); }
  if(tipo) toast(msg, tipo==="ok"?"ok":undefined);
}
function pcpLeerArchivo(input, fn){
  const file=input.files[0]; input.value=""; if(!file) return;
  if(typeof XLSX==="undefined"){ pcpEstado("No cargó el lector de Excel (revisa tu conexión y recarga la página)","err"); return; }
  pcpEstado("Leyendo "+file.name+"…");
  const lr=new FileReader();
  lr.onerror=()=>pcpEstado("No se pudo abrir el archivo","err");
  lr.onload=async e=>{
    try{ await fn(XLSX.read(e.target.result,{type:"array",cellDates:true}), file.name); }
    catch(err){ pcpEstado("No se pudo procesar: "+(err&&err.message||err),"err"); }
  };
  lr.readAsArrayBuffer(file);
}

function pcpSubirPrograma(input){ pcpLeerArchivo(input, pcpPrograma); }
async function pcpPrograma(wb, nombre){
  const filas=[], hojas=[];
  wb.SheetNames.forEach(h=>{
    const m=PCP_HOJAS.find(x=>normKey(h).includes(x[0])); if(!m) return;
    const ws=wb.Sheets[h], rg=XLSX.utils.decode_range(ws["!ref"]||"A1");
    rg.e.c=Math.min(rg.e.c,40);   // hay hojas con 16 000 columnas vacías
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true,range:rg});
    const cab=pcpCabeceras(rows,["ARTICULO","CANTPROG","STD"],{STDMIN:"STD",ANO:"ANIO",ORDENDEFABRICACION:"OF",STATUS:"ESTATUS"});
    if(!cab) return;
    const c=cab.col, g=(r,k)=>c[k]===undefined?"":r[c[k]];
    let n=0;
    for(let i=cab.fila+1;i<rows.length;i++){
      const r=rows[i], art=norm(g(r,"ARTICULO")), cp=pcpNum(g(r,"CANTPROG")), std=pcpNum(g(r,"STD"));
      if(!art || !(cp>0) || !(std>0)) continue;
      const of=String(g(r,"OF")).replace(/\.0+$/,"").trim();
      filas.push({area:m[1],planta:norm(g(r,"PLANTA")),linea:norm(g(r,"LINEA")),prenda:norm(g(r,"PRENDA")),cliente:norm(g(r,"CLIENTE")),
        pedido:norm(g(r,"PEDIDO")),articulo:art,modelo:norm(g(r,"MODELO")),color:norm(g(r,"COLOR")),of:/^\d+$/.test(of)?of:"",
        cant:pcpNum(g(r,"CANT"))||null,cant_prog:cp,std,ini:pcpFecha(g(r,"INICOSTURA")),fin:pcpFecha(g(r,"FINCOSTURA")),
        mes:pcpNum(g(r,"MES"))||null,anio:pcpNum(g(r,"ANIO"))||null,estatus:norm(g(r,"ESTATUS")),obs:norm(g(r,"OBSERVACION"))});
      n++;
    }
    hojas.push(`${pcpCorto(m[1])} ${n}`);
  });
  if(!filas.length){ pcpEstado("No encontré hojas CAMISA, PANTALON o SACO con las columnas ARTICULO, CANT PROG y STD(min)","err"); return; }
  pcpEstado(`Subiendo ${filas.length} filas (${hojas.join(", ")})…`);
  try{
    const r=await rpc("fn_pcp_programa_cargar",{p_dni:ING.dni,p_token:ING.token,p_archivo:nombre,p_filas:filas});
    if(!r || !r.ok) throw new Error((r&&r.error)||"No se subió");
    pcpEstado(`Programa subido: ${r.filas} filas (${hojas.join(", ")})`,"ok"); pcpCargar();
  }catch(e){ pcpEstado("No se subió el programa: "+e.message,"err"); }
}

/* NOTI_CORTE: FECHA, ORDEN DE FABRICACION, ARTICULO, COLOR, CLIENTE, CANTIDAD. Solo desde la fecha elegida. */
function pcpFilasCorte(rows){
  const cab=pcpCabeceras(rows,["FECHA","CANTIDAD"],{ORDENDEFABRICACION:"OF",ORDENFABRICACION:"OF",CANT:"CANTIDAD",CORTEREAL:"CORTE_REAL"});
  if(!cab) throw new Error("No encontré las columnas FECHA y CANTIDAD de NOTI_CORTE");
  const c=cab.col, g=(r,k)=>c[k]===undefined?"":r[c[k]], desde=$("pcpDesde").value||"0000";
  const out=[];
  for(let i=cab.fila+1;i<rows.length;i++){
    const r=rows[i], f=pcpFecha(g(r,"FECHA")), q=pcpNum(g(r,"CANTIDAD"));
    if(!f || f<desde || !q) continue;
    out.push({fecha:f,of:String(g(r,"OF")).replace(/\.0+$/,"").trim(),articulo:norm(g(r,"ARTICULO")),color:norm(g(r,"COLOR")),cliente:norm(g(r,"CLIENTE")),cantidad:q,corte_real:pcpNum(g(r,"CORTE_REAL"))||null});
  }
  return out;
}
async function pcpEnviarCorte(filas, origen){
  if(!filas.length){ pcpEstado("La hoja no trae filas con fecha y cantidad desde "+pcpDM($("pcpDesde").value),"err"); return; }
  const tot=filas.reduce((s,x)=>s+x.cantidad,0), fs=filas.map(x=>x.fecha).sort();
  pcpEstado(`Guardando corte: ${filas.length} filas, ${pcpN(tot)} prendas, del ${pcpDM(fs[0])} al ${pcpDM(fs[fs.length-1])}…`);
  try{
    const r=await rpc("fn_pcp_corte_cargar",{p_dni:ING.dni,p_token:ING.token,p_origen:origen,p_filas:filas});
    if(!r || !r.ok) throw new Error((r&&r.error)||"No se guardó");
    pcpEstado(`Corte guardado: ${r.filas} filas`,"ok"); pcpCargar();
  }catch(e){ pcpEstado("No se guardó el corte: "+e.message,"err"); }
}
function pcpSubirCorte(input){
  pcpLeerArchivo(input,(wb,nombre)=>{
    const h=wb.SheetNames.find(x=>normKey(x)==="NOTICORTE")||wb.SheetNames[0];
    pcpEnviarCorte(pcpFilasCorte(XLSX.utils.sheet_to_json(wb.Sheets[h],{header:1,defval:"",raw:true})), nombre);
  });
}
/* Lee la hoja NOTI_CORTE directo del Google Sheets. Funciona si la hoja está compartida
   como «cualquier persona con el enlace»; si no, se descarga como Excel y se sube. */
async function pcpLeerSheets(){
  const url=$("pcpUrl").value.trim(), m=url.match(/\/spreadsheets\/d\/([\w-]+)/);
  if(!m){ toast("Pega el enlace del Google Sheets de corte"); return; }
  try{ localStorage.setItem("pcp-url",url); }catch(e){}
  const b=$("pcpBtnSheets"); b.disabled=true; b.textContent="Leyendo…";
  try{
    const res=await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&sheet=NOTI_CORTE`);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const txt=await res.text();
    if(/^\s*</.test(txt)) throw new Error("la hoja no es pública");
    const wb=XLSX.read(txt,{type:"string",raw:true});
    await pcpEnviarCorte(pcpFilasCorte(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:"",raw:true})), url);
  }catch(e){
    toast(`No pude leer el Google Sheets (${e.message}). Compártelo como «cualquier persona con el enlace» o descárgalo como Excel y usa «Subir corte».`);
  }finally{ b.disabled=false; b.textContent="Leer NOTI_CORTE"; }
}
