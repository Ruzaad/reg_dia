/* ============================================================
   SAMITEX — Pestañas de COSTOS (parche 96). Todo es de solo lectura:
   las RPC fn_costos_* validan con _lector (permiso por área del parche 95)
   y no hay ningún botón que escriba. Requiere app.js e ingenieria.js.
   ============================================================ */
const COSTOS_TABS=["pasoCostosBase","pasoCostosHoy","pasoCostosInc","pasoCostosAsis"];
const LIB_PDF=["https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
               "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"];
const LIB_XLSX_ESTILO="https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
const _libs={};
function cargarLib(url){
  return _libs[url] || (_libs[url]=new Promise((ok,mal)=>{
    const s=document.createElement("script"); s.src=url; s.onload=ok;
    s.onerror=()=>{ delete _libs[url]; mal(new Error("No se pudo cargar la librería de descarga")); };
    document.head.appendChild(s);
  }));
}
function costosAreas(sel, conTodas){
  const s=$(sel); if(!s || s.options.length>1) return;
  s.innerHTML=(conTodas?`<option value="">Todas las áreas</option>`:"")
    + (AREAS_LISTA||[]).map(a=>`<option>${esc(a)}</option>`).join("");
}
function costosEntrar(tab){
  if(tab==="pasoCostosBase") cbInit();
  else if(tab==="pasoCostosHoy") chInit();
  else if(tab==="pasoCostosInc") ciInit();
  else if(tab==="pasoCostosAsis") caInit();
}
function costosRecargar(tab){
  if(tab==="pasoCostosBase") cargarCostosBase();
  else if(tab==="pasoCostosHoy") cargarCostosHoy();
  else if(tab==="pasoCostosInc") cargarCostosInc();
  else if(tab==="pasoCostosAsis") cargarCostosAsis();
}
const num2 = v => (Math.round((+v||0)*100)/100).toFixed(2);
const nombreArchivo = s => String(s||"").trim().replace(/[\\/:*?"<>|\[\]]+/g,"").replace(/\s+/g,"_");
function xlsxSimple(nombre, hoja, cab, filas){
  const ws=XLSX.utils.aoa_to_sheet([cab, ...filas]);
  ws["!cols"]=cab.map((c,i)=>({wch:Math.min(60,Math.max(String(c).length,...filas.map(f=>String(f[i]??"").length))+2)}));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, hoja);
  XLSX.writeFile(wb, nombre);
}
const kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num"${c?` style="color:${c}"`:""}>${v}</div><div class="kpi-lbl">${esc(t)}</div></div>`;

/* ================= BASE Y BALANCE DE LÍNEA =================
   Mismo cálculo que las hojas de balance de ingeniería (PDF/Excel de artículo):
   PPH = 60 / S.A.M · PxH = PPH × eficiencia · H. Req. = meta / PxH ·
   N° Pers = H. Req. / horas disponibles · Pers. disp. = N° Pers total redondeado
   hacia arriba. En ACABADO los bloques son por prenda (ACABADO PANTALON, ACABADO
   SACO); en costura, por módulo. Como en las hojas de Ruzaad (Balances.xlsx), lo
   manual (en amarillo) es Meta, Eficiencia, Artículo, Prenda y Cliente; las horas
   disponibles son fijas (575 min). La producción posible es la hoja META:
   personas × minutos / S.A.M × eficiencia, con 575 y 576 minutos. */
let CB={area:"", filas:[], vista:"bal", pag:1};
const CB_PAG_BAL=6, CB_PAG_TAB=100;
const CB_PARAM_DEF={meta:1400, ef:80}, CB_HORAS=9.57;
const CB_MIN=[575,576], CB_EFS=[1,.95,.9,.85,.8,.75,.7];
function cbParamsLeer(){
  let p={...CB_PARAM_DEF};
  try{ Object.assign(p, JSON.parse(localStorage.getItem("stx-costos-param")||"{}")); }catch(e){}
  return p;
}
function cbParams(){
  const m=Number($("cbMeta").value), e=Number($("cbEf").value), n=Math.floor(Number($("cbPers").value));
  return {meta:m>0?m:CB_PARAM_DEF.meta, horas:CB_HORAS, ef:(e>0&&e<=100?e:CB_PARAM_DEF.ef)/100, personas:n>0?n:0};
}
function cbParam(){
  const p=cbParams();
  try{ localStorage.setItem("stx-costos-param", JSON.stringify({meta:p.meta,ef:Math.round(p.ef*100)})); }catch(e){}
  cbPintar();
}
function cbInit(){
  costosAreas("cbArea", false);
  if(!$("cbMeta").value){ const p=cbParamsLeer(); $("cbMeta").value=p.meta; $("cbEf").value=p.ef; }
  cargarCostosBase();
}
async function cargarCostosBase(){
  const area=$("cbArea").value;
  if(!area){ $("cbBalView").innerHTML=`<div class="estado-vacio">Elige un área para ver su base.</div>`; return; }
  pintarCargando($("cbBalView"),"Cargando base…");
  try{
    const [r, ult]=await Promise.all([rpc("fn_costos_base",{p_dni:ING.dni,p_token:ING.token,p_area:area}), ultimasArea(area)]);
    CB.area=area; CB.filas=Array.isArray(r)?r:[]; CB.ult=ult; CB.pag=1;
    $("cbArtLista").innerHTML=[...new Set(CB.filas.map(b=>norm(b.articulo)))].sort()
      .map(a=>`<option value="${esc(a)}">`).join("");
    cbPintar();
  }catch(e){ $("cbBalView").innerHTML=""; $("cbKpis").innerHTML=""; mostrarError(e.message); }
}
function cbVista(v){
  CB.vista=v; CB.pag=1;
  $("cbTabBal").classList.toggle("activo",v==="bal"); $("cbTabTab").classList.toggle("activo",v==="tab");
  $("cbBalView").hidden=v!=="bal"; $("cbTabView").hidden=v!=="tab";
  cbPintar();
}
function cbFiltrar(){ CB.pag=1; cbPintar(); }
function cbFiltradas(){
  const f=id=>normKey($(id).value);
  const fa=f("cbArt"), fp=f("cbPrenda"), fc=f("cbCli"), fm=f("cbMod"), fo=f("cbOp");
  return CB.filas.filter(b=>
    (!fa||normKey(b.articulo).includes(fa)) && (!fp||normKey(b.prenda).includes(fp)) &&
    (!fc||normKey(b.cliente).includes(fc)) && (!fm||normKey(b.modulo).includes(fm)) &&
    (!fo||normKey(b.operacion).includes(fo)));
}
/* Lo más repetido de una lista (el cliente de un artículo a veces viene escrito
   distinto en una fila: "MARZOTTO - GIOVANNI II" entre 27 "GIOVANNI II"). */
function masComun(lista){
  const c={}; lista.map(norm).filter(Boolean).forEach(x=>c[x]=(c[x]||0)+1);
  return Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||"";
}
/* Un artículo armado para pintar o exportar: bloques con sus operaciones y totales. */
function cbArticulos(filas){
  const p=cbParams(), acab=normKey(CB.area)==="ACABADO";
  const porArt={};
  filas.forEach(b=>{ const k=norm(b.articulo); (porArt[k]=porArt[k]||[]).push(b); });
  return Object.keys(porArt).sort((a,b)=>a.localeCompare(b,"es",{numeric:true})).map(art=>{
    const ops=[...porArt[art]].sort((a,b)=>(Number(a.n_op)||0)-(Number(b.n_op)||0));
    const bloques=[], idx={};
    ops.forEach(b=>{
      const g=acab ? ("ACABADO "+(norm(b.prenda)||"")).trim() : (norm(b.modulo)||"SIN MÓDULO");
      if(!(g in idx)){ idx[g]=bloques.length; bloques.push({nombre:g, ops:[], sam:0, pers:0}); }
      const sam=Number(b.std)||0, pph=sam>0?60/sam:0, pxh=pph*p.ef, hreq=pxh>0?p.meta/pxh:0, pers=hreq/p.horas;
      const bl=bloques[idx[g]];
      bl.ops.push({n:b.n_op, op:norm(b.operacion), sam, pph, ef:p.ef, pxh, hreq, pers});
      bl.sam+=sam; bl.pers+=pers;
    });
    const sam=bloques.reduce((a,x)=>a+x.sam,0), pers=bloques.reduce((a,x)=>a+x.pers,0), persDisp=Math.ceil(pers-1e-9);
    const personas=p.personas||persDisp;
    return {art, cliente:masComun(ops.map(b=>b.cliente)),
      prenda:[...new Set(ops.map(b=>norm(b.prenda)).filter(Boolean))].join(" + "),
      bloques, sam, pers, persDisp, nOps:ops.length, p, personas,
      prod:CB_MIN.map(min=>({min, vals:CB_EFS.map(ef=>sam>0?personas*min/sam*ef:0)}))};
  });
}
function cbPintar(){
  if(!CB.area) return;
  const filas=cbFiltradas();
  const arts=cbArticulos(filas);
  const sam=arts.reduce((a,x)=>a+x.sam,0);
  $("cbKpis").innerHTML = kpi("Artículos", arts.length) + kpi("Operaciones", filas.length)
    + (arts.length===1
        ? kpi("Tiempo estándar de prenda", num2(arts[0].sam), "var(--ocre)") + kpi("N° de personas", num2(arts[0].pers))
          + kpi("Pers. disponibles", arts[0].persDisp)
        : kpi("S.A.M total filtrado", num2(sam)));
  if(!CB.filas.length){
    $("cbBalView").innerHTML=`<div class="estado-vacio">${esc(CB.area)} no tiene base cargada.</div>`;
    $("cbTabla").innerHTML=""; $("cbPager").innerHTML=""; return;
  }
  if(CB.vista==="tab") return cbPintarTabla(filas);
  const tot=Math.max(1,Math.ceil(arts.length/CB_PAG_BAL));
  CB.pag=Math.min(Math.max(1,CB.pag),tot);
  const pagina=arts.slice((CB.pag-1)*CB_PAG_BAL, CB.pag*CB_PAG_BAL);
  $("cbBalView").innerHTML = pagina.length
    ? pagina.map(cbFichaHTML).join("")
    : `<div class="estado-vacio">Ningún artículo coincide con los filtros.</div>`;
  cbPager(tot);
}
function cbFichaHTML(a){
  const p=a.p;
  // [etiqueta, valor, manual] — lo manual va resaltado como el amarillo de la hoja.
  const cab=[["Meta",p.meta,1],["Horas disp.",num2(p.horas)],["Pers. disp.",a.persDisp],["Eficiencia",Math.round(p.ef*100)+"%",1],
             ["Artículo",a.art,1],["Prenda",a.prenda||"—",1],["Cliente",a.cliente||"—",1]];
  const filas=a.bloques.map(bl=>bl.ops.map((o,i)=>`<tr>
      ${i===0?`<td class="cb-mod" rowspan="${bl.ops.length}">${esc(bl.nombre)}</td>`:""}
      <td>${esc(o.n??"")}</td><td class="izq">${esc(o.op)}</td><td>${num2(o.sam)}</td><td>${num2(o.pph)}</td>
      <td>${Math.round(o.ef*100)}%</td><td>${num2(o.pxh)}</td><td>${num2(o.hreq)}</td><td>${num2(o.pers)}</td></tr>`).join("")
    + `<tr class="cb-sub"><td colspan="3"></td><td>${num2(bl.sam)}</td><td colspan="4"></td><td>${num2(bl.pers)}</td></tr>`).join("");
  return `<article class="cb-ficha">
    <div class="cb-cab">
      <dl class="cb-datos">${cab.map(([k,v,m])=>`<dt>${k}</dt><dd${m?' class="cb-man"':""}>${esc(v)}</dd>`).join("")}</dl>
      <div class="cb-sam"><span>S.A.M</span><b>${num2(a.sam)}</b></div>
      <div class="cb-nombre"><span>${esc(a.art)}</span><b>${esc(a.cliente||a.art)}</b></div>
    </div>
    <div class="tabla-scroll"><table class="tabla cb-tabla">
      <thead><tr><th>Módulo</th><th>N°</th><th class="izq">Operaciones</th><th>S.A.M</th><th>PPH</th><th>EFIC.</th>
        <th>PxH</th><th>H. Req.</th><th>N° Pers</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>
    <div class="cb-pie"><span>Tiempo estándar de prenda</span><b>${num2(a.sam)}</b>
      <span>N° pers</span><b>${num2(a.pers)}</b></div>
    <div class="cb-prod">
      <div class="cb-prod-tit">Producción posible con <b>${a.personas}</b> persona${a.personas===1?"":"s"}
        <span class="sub">personas × minutos ÷ S.A.M × eficiencia</span></div>
      <div class="tabla-scroll"><table class="tabla cb-tabla">
        <thead><tr data-dyn="1"><th>Minutos disp.</th>${CB_EFS.map(e=>`<th>${Math.round(e*100)}%</th>`).join("")}</tr></thead>
        <tbody>${a.prod.map(r=>`<tr><td><b>${r.min}</b></td>${r.vals.map(v=>`<td>${Math.round(v).toLocaleString("es-PE")}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
    </div>
  </article>`;
}
function cbPintarTabla(filas){
  const fin=calcularFinalesBase(CB.filas, CB.ult);
  const lista=ordAplicar("cbTabla", filas);
  const tot=Math.max(1,Math.ceil(lista.length/CB_PAG_TAB));
  CB.pag=Math.min(Math.max(1,CB.pag),tot);
  $("cbTabla").innerHTML = ordThead("cbTabla",[{k:"prenda",t:"Prenda"},{k:"cliente",t:"Cliente"},{k:"modulo",t:"Módulo"},
      {k:"articulo",t:"Artículo"},{k:"operacion",t:"Operación",cls:"izq"},{k:"std",t:"STD"},{k:"max_op",t:"Max. op."},{k:"n_op",t:"N° op."}], cbPintar)
    + "<tbody>" + lista.slice((CB.pag-1)*CB_PAG_TAB, CB.pag*CB_PAG_TAB).map(b=>{
        const f=fin[normKey(b.articulo)]||{}, n=Number(b.n_op);
        const est=n===f.n1?`<span class="estrella estrella-final" title="Operación final">★</span> `
          : n===f.n2?`<span class="estrella estrella-pen" title="Penúltima operación">★</span> `:"";
        return `<tr><td>${esc(norm(b.prenda))}</td><td>${esc(norm(b.cliente))}</td><td>${esc(norm(b.modulo))}</td>
          <td><b>${esc(norm(b.articulo))}</b></td><td class="izq">${est}${esc(norm(b.operacion))}</td>
          <td>${esc(b.std)}</td><td>${esc(b.max_op??"")}</td><td>${esc(b.n_op??"")}</td></tr>`;
      }).join("") + "</tbody>";
  cbPager(tot);
}
function cbPager(tot){
  $("cbPager").innerHTML = tot>1
    ? `<button class="btn-mini" ${CB.pag<=1?"disabled":""} onclick="CB.pag--;cbPintar()">‹ Anterior</button>
       <span class="sub" style="margin:0 8px;">${CB.pag}/${tot}</span>
       <button class="btn-mini" ${CB.pag>=tot?"disabled":""} onclick="CB.pag++;cbPintar()">Siguiente ›</button>` : "";
}
const CB_MAX_EXPORT=80;
function cbParaExportar(){
  if(!CB.filas.length){ mostrarError("Carga la base de un área primero"); return null; }
  const arts=cbArticulos(cbFiltradas());
  if(!arts.length){ mostrarError("Ningún artículo coincide con los filtros"); return null; }
  if(arts.length>CB_MAX_EXPORT){ mostrarError(`Son ${arts.length} artículos: filtra hasta ${CB_MAX_EXPORT} para descargar`); return null; }
  return arts;
}
function cbNombreDescarga(arts, ext){
  return (arts.length===1 ? nombreArchivo(arts[0].art+" "+arts[0].cliente)
    : "BALANCE_"+nombreArchivo(CB.area)+"_"+arts.length+"_articulos") + "." + ext;
}
/* PDF: una página A4 horizontal por artículo, como las hojas de balance. */
async function cbDescargarPdf(){
  const arts=cbParaExportar(); if(!arts) return;
  try{ for(const u of LIB_PDF) await cargarLib(u); }catch(e){ mostrarError(e.message); return; }
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"landscape", unit:"mm", format:"a4"});
  const GRIS=[81,86,115], AMAR=[255,255,0];
  arts.forEach((a,ix)=>{
    if(ix) doc.addPage();
    const p=a.p, x0=14, y0=12;
    // Datos de cabecera (izquierda, en amarillo como la hoja original).
    const cab=[["Meta:",String(p.meta),1],["Horas Disp.",num2(p.horas)],["Pers. Disp.:",String(a.persDisp)],
               ["Eficiencia:",Math.round(p.ef*100)+"%",1],["Articulo:",a.art,1],["Prenda",a.prenda,1],["Cliente:",a.cliente,1]];
    doc.setFontSize(7.5); doc.setDrawColor(0); doc.setLineWidth(.2);
    cab.forEach(([k,v,m],i)=>{
      const y=y0+i*4.6;
      doc.setFont("helvetica","bold"); doc.rect(x0,y,22,4.6); doc.text(k,x0+1,y+3.3);
      if(m){ doc.setFillColor(...AMAR); doc.rect(x0+22,y,26,4.6,"FD"); } else doc.rect(x0+22,y,26,4.6);
      doc.text(doc.splitTextToSize(String(v||""),25)[0]||"", x0+35, y+3.3, {align:"center"});
    });
    const hCab=cab.length*4.6;
    doc.rect(x0+48,y0,22,hCab); doc.setFont("helvetica","normal"); doc.setFontSize(20);
    doc.text(num2(a.sam), x0+59, y0+hCab/2+3, {align:"center"});
    doc.rect(x0+70,y0,130,hCab); doc.setFont("times","bold"); doc.setFontSize(26);
    doc.text(doc.splitTextToSize(a.cliente||a.art,125)[0], x0+135, y0+hCab/2+4, {align:"center"});
    doc.setFillColor(0,0,0); doc.rect(x0+200,y0,69,hCab,"F");
    doc.setTextColor(255); doc.setFont("helvetica","bold"); doc.setFontSize(14);
    doc.text(a.art, x0+234.5, y0+hCab/2+2, {align:"center"}); doc.setTextColor(0);
    // Tabla por bloques: el módulo ocupa la primera columna de su bloque.
    const body=[];
    a.bloques.forEach(bl=>{
      bl.ops.forEach((o,i)=>{
        const fila=[String(o.n??""),o.op,num2(o.sam),num2(o.pph),Math.round(o.ef*100)+"%",num2(o.pxh),num2(o.hreq),num2(o.pers)];
        body.push(i===0?[{content:bl.nombre,rowSpan:bl.ops.length,styles:{valign:"middle",halign:"center",fontStyle:"bold",fontSize:11,textColor:GRIS}},...fila]:fila);
      });
      body.push([{content:"",colSpan:3,styles:{lineWidth:0}},{content:num2(bl.sam),styles:{fillColor:GRIS,textColor:255,fontStyle:"bold"}},
        {content:"",colSpan:4,styles:{lineWidth:0}},{content:num2(bl.pers),styles:{fillColor:GRIS,textColor:255,fontStyle:"bold"}}]);
    });
    doc.autoTable({
      startY:y0+hCab+6, margin:{left:x0,right:14},
      head:[["Módulo","N°","Operaciones","S.A.M","PPH","EFIC.","PxH","H. Req.","N° Pers"]],
      body, theme:"grid",
      styles:{fontSize:7,cellPadding:.9,halign:"center",lineColor:[200,205,215],lineWidth:.15,textColor:[60,64,80]},
      headStyles:{fillColor:GRIS,textColor:255,fontStyle:"bold",fontSize:8},
      columnStyles:{0:{cellWidth:38},1:{cellWidth:12},2:{cellWidth:100}}
    });
    const y=doc.lastAutoTable.finalY+5;
    doc.setFontSize(7); doc.setFont("helvetica","normal");
    doc.rect(150,y,62,6); doc.text("TIEMPO ESTANDAR DE PRENDA",181,y+4,{align:"center"});
    doc.setFillColor(...AMAR); doc.rect(212,y,16,6,"FD"); doc.setFont("helvetica","bold"); doc.text(num2(a.sam),220,y+4,{align:"center"});
    doc.setFont("helvetica","normal"); doc.rect(228,y,16,6); doc.text("N° PERS",236,y+4,{align:"center"});
    doc.setFillColor(...AMAR); doc.rect(244,y,16,6,"FD"); doc.setFont("helvetica","bold"); doc.text(num2(a.pers),252,y+4,{align:"center"});
    // Producción posible (hoja META).
    doc.autoTable({
      startY:y+10, margin:{left:x0}, tableWidth:150, theme:"grid",
      head:[[{content:`PRODUCCIÓN POSIBLE CON ${a.personas} PERSONAS`,colSpan:8,styles:{halign:"left"}}],
            ["Minutos disp.",...CB_EFS.map(e=>Math.round(e*100)+"%")]],
      body:a.prod.map(r=>[String(r.min),...r.vals.map(v=>String(Math.round(v)))]),
      styles:{fontSize:7,cellPadding:.9,halign:"center",lineColor:[200,205,215],lineWidth:.15,textColor:[60,64,80]},
      headStyles:{fillColor:GRIS,textColor:255,fontStyle:"bold",fontSize:7.5}
    });
  });
  doc.save(cbNombreDescarga(arts,"pdf"));
}
/* Excel: una hoja por artículo con el formato y las fórmulas de la hoja de
   balance de línea (cambiar Meta, Horas o Eficiencia en el Excel recalcula). */
async function cbDescargarXlsx(){
  const arts=cbParaExportar(); if(!arts) return;
  try{ await cargarLib(LIB_XLSX_ESTILO); }catch(e){ mostrarError(e.message); return; }
  const wb=new ExcelJS.Workbook(); wb.creator="SAMITEX";
  const GRIS="FF515673", AMAR="FFFFFF00";
  const borde={top:{style:"thin",color:{argb:"FFBFC5D2"}},left:{style:"thin",color:{argb:"FFBFC5D2"}},
               bottom:{style:"thin",color:{argb:"FFBFC5D2"}},right:{style:"thin",color:{argb:"FFBFC5D2"}}};
  const usados=new Set();
  arts.forEach(a=>{
    let nom=nombreArchivo(a.art).slice(0,28)||"ART"; let k=2; while(usados.has(nom)) nom=nom.slice(0,26)+"_"+(k++); usados.add(nom);
    const ws=wb.addWorksheet(nom,{views:[{showGridLines:false}],pageSetup:{orientation:"landscape",paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0}});
    ws.columns=[{width:3},{width:16},{width:14},{width:7},{width:52},{width:9},{width:9},{width:8},{width:9},{width:13},{width:9},{width:9}];
    ws.mergeCells("E2:K2"); ws.getCell("E2").value="BALANCE DE LINEA";
    ws.getCell("E2").font={name:"Century Gothic",bold:true,size:16}; ws.getCell("E2").alignment={horizontal:"center"};
    ws.mergeCells("E3:K3"); ws.getCell("E3").value="AREA: "+CB.area;
    ws.getCell("E3").font={name:"Century Gothic",bold:true,size:11}; ws.getCell("E3").alignment={horizontal:"center"};
    const datos=[["Meta:",a.p.meta],["Horas Disp.",a.p.horas],["Pers. Disp.:",null],["Eficiencia:",a.p.ef],
                 ["Articulo:",a.art],["Prenda",a.prenda],["Cliente:",a.cliente]];
    datos.forEach(([t,v],i)=>{
      const r=5+i, ct=ws.getCell("B"+r), cv=ws.getCell("C"+r);
      ct.value=t; ct.font={name:"Century Gothic",bold:true,size:8}; ct.border=borde;
      cv.value=v; cv.font={name:"Century Gothic",bold:true,size:8}; cv.border=borde; cv.alignment={horizontal:"center"};
      // Amarillo = manual (Meta, Eficiencia, Artículo, Prenda, Cliente), como en la hoja original.
      if(i!==1&&i!==2) cv.fill={type:"pattern",pattern:"solid",fgColor:{argb:AMAR}};
    });
    ws.getCell("C8").numFmt="0%";
    let r=14; const subtot=[];
    a.bloques.forEach(bl=>{
      ["Módulo","","N°","Operaciones","S.A.M","PPH","EFIC.","PxH","H. Req.","N° Pers"].forEach((t,i)=>{
        const c=ws.getRow(r).getCell(2+i); c.value=t||null;
        c.font={bold:true,color:{argb:"FFFFFFFF"},name:"Century Gothic",size:9};
        c.fill={type:"pattern",pattern:"solid",fgColor:{argb:GRIS}}; c.alignment={horizontal:"center"};
      });
      ws.mergeCells(r,2,r,3);
      const ini=r+1;
      bl.ops.forEach((o,i)=>{
        const f=ini+i, row=ws.getRow(f);
        row.getCell(4).value=o.n??null; row.getCell(5).value=o.op; row.getCell(6).value=o.sam;
        row.getCell(7).value={formula:`IF(F${f}>0,60/F${f},"")`};
        row.getCell(8).value={formula:"$C$8"};
        row.getCell(9).value={formula:`IF(F${f}>0,H${f}*G${f},"")`};
        row.getCell(10).value={formula:`IF(F${f}>0,$C$5/I${f},"")`};
        row.getCell(11).value={formula:`IF(F${f}>0,J${f}/$C$6,"")`};
        for(let c=4;c<=11;c++){ const x=row.getCell(c); x.border=borde; x.font={name:"Century Gothic",size:8,color:{argb:"FF3C4050"}};
          x.alignment={horizontal:"center"}; if(c>=6) x.numFmt=c===8?"0%":"0.00"; }
      });
      const fin=ini+bl.ops.length-1;
      ws.mergeCells(ini,2,fin,3);
      const m=ws.getCell(ini,2); m.value=bl.nombre; m.font={bold:true,size:12,color:{argb:GRIS},name:"Century Gothic"};
      m.alignment={horizontal:"center",vertical:"middle",wrapText:true}; m.border=borde;
      const s=fin+1;
      [[6,`SUM(F${ini}:F${fin})`],[11,`SUM(K${ini}:K${fin})`]].forEach(([c,fx])=>{
        const x=ws.getCell(s,c); x.value={formula:fx}; x.numFmt="0.00";
        x.font={bold:true,color:{argb:"FFFFFFFF"}}; x.alignment={horizontal:"center"};
        x.fill={type:"pattern",pattern:"solid",fgColor:{argb:GRIS}};
      });
      subtot.push(s); r=s+3;
    });
    const fT=r, fP=r+1;
    ws.getCell(fT,5).value="TIEMPO ESTANDAR DE PRENDA";
    ws.getCell(fP,5).value="N° PERS";
    [[fT,"F",6],[fP,"K",11]].forEach(([fila,col])=>{
      const c=ws.getCell(fila,6); c.value={formula:subtot.map(x=>col+x).join("+")}; c.numFmt="0.00";
      c.font={bold:true}; c.alignment={horizontal:"center"}; c.border=borde;
      c.fill={type:"pattern",pattern:"solid",fgColor:{argb:AMAR}};
      const t=ws.getCell(fila,5); t.font={bold:true,size:8}; t.alignment={horizontal:"right"};
    });
    ws.getCell("C7").value={formula:`ROUNDUP(F${fP},0)`};
    ws.getCell("D5").value={formula:`F${fT}`}; ws.getCell("D5").numFmt="0.00"; ws.getCell("D5").font={size:16};
    ws.mergeCells("E5:I11"); const t=ws.getCell("E5"); t.value=a.cliente||a.art;
    t.font={name:"Times New Roman",bold:true,size:28}; t.alignment={horizontal:"center",vertical:"middle"};
    // Recuadro negro de totales (como TE5247): N° de personas y S.A.M de la prenda.
    [["N° PERSONAS",`F${fP}`],["SAM",`F${fT}`]].forEach(([tx,fx],i)=>{
      const l=ws.getCell(5+i,10), v=ws.getCell(5+i,11);
      l.value=tx; v.value={formula:fx}; v.numFmt="0.00";
      [l,v].forEach(c=>{ c.font={name:"Century Gothic",bold:true,size:9,color:{argb:"FFFFFFFF"}};
        c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF000000"}}; c.alignment={horizontal:"center"}; });
    });
    // Producción posible (hoja META): personas × minutos / SAM × eficiencia.
    const r0=fP+3, cPers=ws.getCell(r0,3);
    ws.getCell(r0,2).value="Personas:"; ws.getCell(r0,2).font={name:"Century Gothic",bold:true,size:8}; ws.getCell(r0,2).border=borde;
    cPers.value=a.personas; cPers.font={name:"Century Gothic",bold:true,size:8}; cPers.border=borde; cPers.alignment={horizontal:"center"};
    cPers.fill={type:"pattern",pattern:"solid",fgColor:{argb:AMAR}};
    ws.mergeCells(r0,5,r0,12); const tp=ws.getCell(r0,5);
    tp.value={formula:`"PRODUCCIÓN POSIBLE CON "&C${r0}&" PERSONAS"`};
    tp.font={name:"Century Gothic",bold:true,size:10}; tp.alignment={horizontal:"center"};
    const hP=r0+1;
    ["Minutos disp.",...CB_EFS].forEach((v,i)=>{
      const c=ws.getCell(hP,5+i); c.value=v; if(i) c.numFmt="0%";
      c.font={bold:true,color:{argb:"FFFFFFFF"},name:"Century Gothic",size:9};
      c.fill={type:"pattern",pattern:"solid",fgColor:{argb:GRIS}}; c.alignment={horizontal:"center"};
    });
    CB_MIN.forEach((min,j)=>{
      const f=hP+1+j, cm=ws.getCell(f,5); cm.value=min; cm.font={name:"Century Gothic",bold:true,size:8}; cm.border=borde; cm.alignment={horizontal:"center"};
      CB_EFS.forEach((e,i)=>{
        const col=String.fromCharCode(70+i), c=ws.getCell(f,6+i);
        c.value={formula:`IF($F$${fT}>0,$C$${r0}*$E${f}/$F$${fT}*${col}$${hP},"")`}; c.numFmt="#,##0";
        c.font={name:"Century Gothic",size:8,color:{argb:"FF3C4050"}}; c.border=borde; c.alignment={horizontal:"center"};
      });
    });
  });
  const buf=await wb.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  const l=document.createElement("a"); l.href=url; l.download=cbNombreDescarga(arts,"xlsx");
  document.body.appendChild(l); l.click(); l.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
}

/* ================= REPORTE DE HOY (parche 138) =================
   Todo lo que pasó por producción en el día. La jornada de cada persona viene
   de _disp_reparto (la regla de la eficiencia): si solo tiene tickets en otra
   área, va completa a esa área. "Según el área" toma la penúltima operación en
   CAMISA COSTURA y la última en el resto; cambiar la operación no vuelve a
   pedir datos. La OF de Costos es de 10 dígitos: 4 + ceros + la OF de planta. */
let CH={fecha:"", area:null, tk:[], ult:{}, sam:{}, per:[], est:{}, inc:[], op:"a", fInc:"sin", abiertas:new Set()};
const CH_PENULTIMA=new Set(["CAMISA COSTURA"]);
const ofCostos = o => /^\d{1,9}$/.test(String(o||"").trim()) ? "4"+String(o).trim().padStart(9,"0") : "";
const areaCorta = a => String(a||"").replace(" COSTURA","");
const n0 = v => v==null||v==="" ? "" : qtyI(v);
function chInit(){
  costosAreas("chArea", true);
  if(!$("chFecha").value) $("chFecha").value=hoyISO();
  cargarCostosHoy();
}
function chOpcion(m){
  CH.op=m;
  document.querySelectorAll("#chOpTabs .tab").forEach(b=>b.classList.toggle("activo", b.dataset.op===m));
  pintarCostosHoy();
}
function chIncFiltro(f){
  CH.fInc=f;
  document.querySelectorAll("#chIncChips .dyn-chip").forEach(b=>b.classList.toggle("on", b.dataset.f===f));
  pintarCostosHoy();
}
function chOfAbrir(k){ CH.abiertas.has(k)?CH.abiertas.delete(k):CH.abiertas.add(k); pintarCostosHoy(); }
async function cargarCostosHoy(){
  const f=$("chFecha").value, area=$("chArea").value;
  if(!f){ mostrarError("Indica la fecha"); return; }
  ["chTablaArea","chTablaMov","chTablaTk","chTablaInc"].forEach(t=>pintarCargando($(t),"Cargando…"));
  const limpiar=()=>["chTablaArea","chTablaMov","chTablaTk","chTablaInc"].forEach(t=>$(t).innerHTML="");
  try{
    const r=await rpc("fn_costos_reporte_dia",{p_dni:ING.dni,p_token:ING.token,p_fecha:f,p_area:area});
    if(!r||!r.ok){ limpiar(); mostrarError((r&&r.error)||"No se pudo cargar el reporte"); return; }
    CH={...CH, fecha:f, area, tk:r.tickets||[], inc:r.incidencias||[], per:r.personal||[], ult:{}, sam:{}, est:{}, abiertas:new Set()};
    (r.ultimas||[]).forEach(u=>{ CH.ult[u.area+"|"+u.articulo]=u; });
    (r.sam||[]).forEach(s=>{ CH.sam[s.area+"|"+s.articulo]=Number(s.sam)||0; });
    (r.estructura||[]).forEach(e=>{ CH.est[e.area]=Number(e.personas)||0; });
    pintarCostosHoy();
  }catch(e){
    limpiar();
    mostrarError(/Could not find the function/i.test(e.message) ? "Falta correr el parche 138 en Supabase" : e.message);
  }
}
function chModo(area){
  if(CH.op==="a") return CH_PENULTIMA.has(area)?"p":"u";
  return CH.op;
}
/* Una fila por área + OF + artículo, con sus operaciones dentro. */
function chOfs(){
  const grp={}; let sinNop=0, sinBase=0;
  CH.tk.forEach(t=>{
    const k=t.area+"|"+(t.of||"")+"|"+t.articulo;
    const g=grp[k]=grp[k]||{k, area:t.area, of:norm(t.of)||"(sin OF)", of10:ofCostos(t.of), articulo:t.articulo||"",
      prenda:t.prenda||"", sam:CH.sam[t.area+"|"+t.articulo]||0, modo:chModo(t.area), min:0, tks:0, per:0, cant:null, ops:[]};
    const u=CH.ult[t.area+"|"+t.articulo], obj=u ? (g.modo==="u"?u.n1:u.n2) : null;
    const cuenta = obj!=null && t.nop!=null && Number(t.nop)===Number(obj);
    if(!u) sinBase+=Number(t.tks)||0; else if(t.nop==null) sinNop+=Number(t.tks)||0;
    g.min+=Number(t.minutos)||0; g.tks+=Number(t.tks)||0; g.per=Math.max(g.per, Number(t.personas)||0);
    if(cuenta) g.cant=(g.cant||0)+(Number(t.cant)||0);
    g.ops.push({nop:t.nop, op:norm(t.op)||"(sin operación)", std:Number(t.std)||0, cant:Number(t.cant)||0,
      min:Number(t.minutos)||0, tks:Number(t.tks)||0, per:Number(t.personas)||0, cuenta});
  });
  const toks=String($("chBuscar").value||"").split(/\s+/).map(normKey).filter(Boolean);
  const filas=Object.values(grp).filter(g=>!toks.length || toks.every(x=>normKey([g.of,g.of10,g.articulo,g.prenda,g.area].join(" ")).includes(x)));
  filas.forEach(g=>{ g.eq=g.sam?g.min/g.sam:null; g.ops.sort((a,b)=>(Number(a.nop)||0)-(Number(b.nop)||0)); });
  return {filas, sinNop, sinBase};
}
/* Personal: por persona, sus áreas del día. */
function chPersonas(){
  const p={};
  CH.per.forEach(x=>{ const k=x.nombre+"|"+x.area_est;
    (p[k]=p[k]||{nombre:x.nombre, cargo:x.cargo||"", est:x.area_est||"", modo:x.modo||"", areas:[]}).areas.push(x); });
  return Object.values(p);
}
function pintarCostosHoy(){
  const {filas, sinNop, sinBase}=chOfs();
  const pers=chPersonas(), todas=!CH.area;
  const fuera=pers.filter(p=>p.areas.some(a=>a.area!==p.est));
  const he=CH.inc.filter(o=>o.tipo==="HORA_EXTRA"), noHe=CH.inc.filter(o=>o.tipo!=="HORA_EXTRA");
  const minHe=he.reduce((a,o)=>a+(Number(o.minutos)||0),0), minInc=noHe.reduce((a,o)=>a+(Number(o.minutos)||0),0);
  const jor=CH.per.filter(x=>todas||x.area===CH.area).reduce((a,x)=>a+(Number(x.jornada)||0),0);
  const prod=CH.tk.reduce((a,t)=>a+(Number(t.minutos)||0),0);
  const dia=fuera.filter(p=>p.areas.every(a=>a.area!==p.est)).length;
  $("chKpis").innerHTML = kpi("Personas que trabajaron", pers.filter(p=>todas||p.areas.some(a=>a.area===CH.area)).length)
    + kpi("Trabajaron fuera de su área", `${fuera.length}`, "var(--violeta)")
    + kpi("Minutos de jornada", qtyI(jor)) + kpi("Minutos producidos", qtyI(prod), "var(--azul)")
    + kpi("Minutos de horas extra", qtyI(minHe)) + kpi("Minutos en incidencias", qtyI(Math.abs(minInc)), "var(--alerta)");
  $("chSubArea").textContent = fuera.length ? `${dia} prestados todo el día · ${fuera.length-dia} en dos áreas` : "";

  // Por área
  const ar={}; const A=a=>ar[a]=ar[a]||{area:a, est:CH.est[a]||0, propia:0, dia:0, dos:0, rec:0, jor:0, he:0, inc:0, prod:0};
  pers.forEach(p=>{
    const enOtra=p.areas.some(a=>a.area!==p.est), soloOtra=p.areas.every(a=>a.area!==p.est);
    if(p.est){ const e=A(p.est); if(!enOtra) e.propia++; else if(soloOtra) e.dia++; else e.dos++; }
    p.areas.forEach(a=>{ const x=A(a.area); x.jor+=Number(a.jornada)||0; if(a.area!==p.est) x.rec++; });
  });
  CH.tk.forEach(t=>{ A(t.area).prod+=Number(t.minutos)||0; });
  CH.inc.forEach(o=>{ const x=A(o.area), m=Number(o.minutos)||0; if(o.tipo==="HORA_EXTRA") x.he+=m; else x.inc+=-m; });
  Object.keys(CH.est).forEach(A);
  const areas=Object.values(ar).filter(x=>todas||x.area===CH.area).filter(x=>x.prod||x.jor||x.inc||x.he).sort((a,b)=>a.area.localeCompare(b.area,"es"));
  const tot=areas.reduce((t,x)=>{ ["est","propia","dia","dos","rec","jor","he","inc","prod"].forEach(k=>t[k]+=x[k]); return t; },
    {area:"TOTAL", est:0, propia:0, dia:0, dos:0, rec:0, jor:0, he:0, inc:0, prod:0});
  const filaArea=(x,cls)=>`<tr${cls}><td class="izq"><b>${esc(x.area)}</b></td><td class="n">${x.est||""}</td><td class="n">${x.propia||""}</td>
    <td class="n">${x.dia?`<span class="ch-menos">−${x.dia}</span>`:""}</td><td class="n">${x.dos||""}</td>
    <td class="n">${x.rec?`<span class="ch-mas">+${x.rec}</span>`:""}</td><td class="n">${n0(x.jor)}</td><td class="n">${x.he?n0(x.he):""}</td>
    <td class="n">${x.inc?n0(x.inc):""}</td><td class="n"><b>${n0(x.prod)}</b></td></tr>`;
  $("chTablaArea").innerHTML = `<thead><tr><th class="izq">Área</th><th class="n">En estructura</th><th class="n">Trabajaron en su área</th>
    <th class="n">Prestados todo el día</th><th class="n">En dos áreas</th><th class="n">Recibidos de otra área</th><th class="n">Min. jornada</th>
    <th class="n">Horas extra (min)</th><th class="n">Incidencias (min)</th><th class="n">Min. producidos</th></tr></thead><tbody>`
    + (areas.length ? areas.map(x=>filaArea(x,"")).join("") + (areas.length>1?filaArea(tot,' class="cb-sub"'):"")
      : `<tr><td colspan="10"><div class="vacio-msg">Sin producción ese día</div></td></tr>`) + "</tbody>";

  // Fuera de su área
  const modoTxt=p=>{ const otras=p.areas.filter(a=>a.area!==p.est);
    if(p.areas.length===1) return `<span class="pill EN">Todo el día en ${esc(areaCorta(otras[0].area))}</span><span class="sub">no registró nada en ${esc(areaCorta(p.est))}</span>`;
    return `<span class="pill">${p.modo==="HORA"?"Según la hora del cambio de área":"Repartido según lo producido"}</span>`; };
  $("chTablaMov").innerHTML = `<thead><tr><th class="izq">Personal</th><th class="izq">Cargo</th><th class="izq">Área (estructura)</th>
    <th class="izq">Trabajó en</th><th class="n">Min. producidos</th><th class="n">Jornada asignada</th><th class="izq">Cómo se contó</th></tr></thead><tbody>`
    + (fuera.length ? fuera.sort((a,b)=>a.est.localeCompare(b.est,"es")||a.nombre.localeCompare(b.nombre,"es")).map(p=>
        p.areas.sort((a,b)=>(a.area===p.est?0:1)-(b.area===p.est?0:1)).map((a,i)=>`<tr>
          ${i?"":`<td class="izq" rowspan="${p.areas.length}"><b>${esc(p.nombre)}</b></td><td class="izq" rowspan="${p.areas.length}">${esc(p.cargo)}</td><td class="izq" rowspan="${p.areas.length}">${esc(areaCorta(p.est))}</td>`}
          <td class="izq">${a.area===p.est?`<span class="sub">${esc(areaCorta(a.area))}</span>`:`<span class="ch-fuera">${esc(areaCorta(a.area))}</span>`}</td>
          <td class="n">${n0(a.minutos)}</td><td class="n"><b>${n0(a.jornada)}</b></td>
          ${i?"":`<td class="izq ch-modo" rowspan="${p.areas.length}">${modoTxt(p)}</td>`}</tr>`).join("")).join("")
      : `<tr><td colspan="7"><div class="vacio-msg">Nadie trabajó fuera de su área ese día</div></td></tr>`) + "</tbody>";

  // Producción por OF, con sus operaciones dentro
  const m=CH.op;
  const etiqueta = m==="u"?"última operación":m==="p"?"penúltima operación"
    : (CH.area ? (CH_PENULTIMA.has(CH.area)?"penúltima operación":"última operación") : "penúltima en CAMISA, última en el resto");
  $("chTitTk").innerHTML = `Producción por OF <span class="sub">prendas en la ${esc(etiqueta)} · toca una OF para ver sus operaciones</span>`;
  const cols=(todas?[{k:"area",t:"Área",cls:"izq"}]:[]).concat([{k:"of",t:"OF",cls:"izq"},{k:"articulo",t:"Artículo",cls:"izq"},{k:"prenda",t:"Prenda",cls:"izq"},
    {k:"sam",t:"S.A.M",cls:"n"},{k:"cant",t:"Cantidad producida",cls:"n"},{k:"min",t:"Min. producidos",cls:"n"},{k:"eq",t:"Prendas equivalentes",cls:"n"},
    {k:"per",t:"Personas",cls:"n"},{k:"tks",t:"Tickets",cls:"n"}]);
  const porDef=(a,b)=>a.area.localeCompare(b.area,"es") || b.min-a.min;
  $("chTablaTk").innerHTML = ordThead("chTablaTk", cols, pintarCostosHoy) + "<tbody>"
    + (filas.length ? ordAplicar("chTablaTk", filas, porDef).map(g=>{ const ab=CH.abiertas.has(g.k);
        return `<tr class="ch-fila${ab?" abierta":""}" data-k="${esc(g.k)}" onclick="chOfAbrir(this.dataset.k)">
          ${todas?`<td class="izq">${esc(areaCorta(g.area))}</td>`:""}
          <td class="izq"><div class="ch-of">${esc(g.of10||g.of)}<small>${g.of10?"OF "+esc(g.of):"sin OF numérica"}</small></div></td>
          <td class="izq"><b>${esc(g.articulo)}</b></td><td class="izq">${esc(g.prenda)}</td><td class="n">${g.sam?g.sam.toFixed(2):""}</td>
          <td class="n">${!CH.ult[g.area+"|"+g.articulo]?'<span class="sub">sin BASE</span>':g.cant==null?'<span class="sub">en proceso</span>':qtyI(g.cant)+(g.modo==="p"?' <small class="sub">(penúlt.)</small>':"")}</td>
          <td class="n"><b>${qtyI(g.min)}</b></td><td class="n">${g.eq==null?"":qtyI(g.eq)}</td><td class="n">${g.per}</td><td class="n">${g.tks}</td></tr>`
          + g.ops.map(o=>`<tr class="ch-op${o.cuenta?" cuenta":""}"${ab?"":" hidden"}>${todas?"<td></td>":""}
            <td class="izq" colspan="3">${o.nop!=null?`<span class="sub">N°${esc(o.nop)}</span> `:""}${esc(o.op)}${o.cuenta?' <span class="pill CERRADO">cuenta</span>':""}</td>
            <td class="n">${o.std?num2(o.std):""}</td><td class="n">${qtyI(o.cant)}</td><td class="n">${qty(o.min)}</td><td></td>
            <td class="n">${o.per}</td><td class="n">${o.tks}</td></tr>`).join(""); }).join("")
      : `<tr><td colspan="${cols.length}"><div class="vacio-msg">Sin tickets ese día</div></td></tr>`)
    + "</tbody>";
  const out=[]; if(sinNop) out.push(`${sinNop} sin N°OP`); if(sinBase) out.push(`${sinBase} sin BASE del artículo`);
  $("chPieTk").textContent=(filas.length?`${filas.length} OF · ${qtyI(prod)} min producidos · prendas equivalentes = minutos ÷ S.A.M`:"")
    + (out.length?` · no cuentan para la cantidad: ${out.join(", ")} ticket(s)`:"");

  // Incidencias
  const lista = CH.fInc==="sin"?noHe : CH.fInc==="he"?he : CH.inc;
  const sum=lista.reduce((a,o)=>a+(Number(o.minutos)||0),0);
  const icol=(todas?[{k:"area",t:"Área",cls:"izq"}]:[]).concat([{k:"nombre",t:"Personal",cls:"izq"},{k:"tipo",t:"Tipo"},{k:"minutos",t:"Minutos",cls:"n"},{k:"detalle",t:"Descripción",cls:"izq"},{k:"hora",t:"Hora"}]);
  $("chTablaInc").innerHTML = ordThead("chTablaInc", icol, pintarCostosHoy) + "<tbody>"
    + (lista.length ? ordAplicar("chTablaInc", lista).map(o=>{ const mi=Number(o.minutos)||0;
        return `<tr>${todas?`<td class="izq">${esc(areaCorta(o.area))}</td>`:""}<td class="izq">${esc(o.nombre||"")}</td><td>${esc(TIPO_LBL(o.tipo))}</td>
          <td class="n rep-num" style="color:${mi<0?"var(--alerta)":"var(--exito)"}">${mi>0?"+":""}${mi}</td>
          <td class="izq desc">${esc(o.detalle||"")}</td><td>${esc(o.hora||"")}</td></tr>`; }).join("")
      : `<tr><td colspan="${icol.length}"><div class="vacio-msg">Sin incidencias con ese filtro</div></td></tr>`)
    + "</tbody>";
  $("chPieInc").textContent = lista.length ? `${lista.length} incidencia(s) · ${sum>0?"+":""}${Math.round(sum)} min` : "";
}
function chDescargar(){
  if(!CH.fecha){ mostrarError("Carga el reporte primero"); return; }
  const {filas}=chOfs();
  const ws1=XLSX.utils.aoa_to_sheet([["Área","OF Costos","OF","Artículo","Prenda","S.A.M","Cantidad producida","Cuenta","Min. producidos","Prendas equivalentes","Personas","Tickets"],
    ...filas.map(g=>[g.area,g.of10,g.of,g.articulo,g.prenda,g.sam||"",g.cant??"",g.modo==="p"?"Penúltima":"Última",Math.round(g.min*100)/100,g.eq==null?"":Math.round(g.eq*10)/10,g.per,g.tks])]);
  const ws2=XLSX.utils.aoa_to_sheet([["Área","OF Costos","OF","Artículo","Prenda","N°OP","Operación","STD","Cantidad","Minutos","Personas","Tickets","Cuenta"],
    ...filas.flatMap(g=>g.ops.map(o=>[g.area,g.of10,g.of,g.articulo,g.prenda,o.nop??"",o.op,o.std,o.cant,Math.round(o.min*100)/100,o.per,o.tks,o.cuenta?"Sí":""]))]);
  const ws3=XLSX.utils.aoa_to_sheet([["Personal","Cargo","Área (estructura)","Trabajó en","Min. producidos","Jornada asignada"],
    ...CH.per.map(x=>[x.nombre,x.cargo||"",x.area_est||"",x.area,Number(x.minutos)||0,Number(x.jornada)||0])]);
  const ws4=XLSX.utils.aoa_to_sheet([["Área","Personal","Minutos","Tipo","Descripción","Hora"],
    ...CH.inc.map(o=>[o.area,o.nombre,Number(o.minutos)||0,TIPO_LBL(o.tipo),o.detalle||"",o.hora||""])]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Producción por OF"); XLSX.utils.book_append_sheet(wb, ws2, "Por operación");
  XLSX.utils.book_append_sheet(wb, ws3, "Personal"); XLSX.utils.book_append_sheet(wb, ws4, "Incidencias");
  XLSX.writeFile(wb, `REPORTE_HOY_${nombreArchivo(CH.area||"TODAS")}_${CH.fecha}.xlsx`);
}

/* ================= INCIDENCIAS ================= */
let CI={items:[], pag:1, desde:"", hasta:""};
const CI_PAG=50;
function ciInit(){
  costosAreas("ciArea", true);
  if(!$("ciDesde").value){
    const h=hoyISO(), d=new Date(h+"T12:00:00"); d.setDate(d.getDate()-((d.getDay()+6)%7));
    $("ciDesde").value=d.toLocaleDateString("sv-SE"); $("ciHasta").value=h;
  }
  cargarCostosInc();
}
async function cargarCostosInc(){
  const d=$("ciDesde").value, h=$("ciHasta").value;
  if(!d||!h){ mostrarError("Indica el rango de fechas"); return; }
  pintarCargando($("ciTabla"),"Cargando…");
  try{
    const r=await rpc("fn_costos_incidencias",{p_dni:ING.dni,p_token:ING.token,p_area:$("ciArea").value,p_desde:d,p_hasta:h});
    if(!r||!r.ok){ $("ciTabla").innerHTML=""; mostrarError((r&&r.error)||"No se pudo cargar"); return; }
    CI={items:r.items||[], pag:1, desde:d, hasta:h};
    const tipos=[...new Set(CI.items.map(o=>o.tipo).filter(Boolean))].sort();
    const prev=$("ciTipo").value;
    $("ciTipo").innerHTML=`<option value="">Todos</option>`+tipos.map(t=>`<option value="${esc(t)}">${esc(TIPO_LBL(t))}</option>`).join("");
    if(tipos.includes(prev)) $("ciTipo").value=prev;
    pintarCostosInc();
  }catch(e){ $("ciTabla").innerHTML=""; mostrarError(e.message); }
}
function ciFiltradas(){
  const t=$("ciTipo").value, toks=String($("ciBuscar").value).split(/\s+/).map(normKey).filter(Boolean);
  return CI.items.filter(o=>(!t||o.tipo===t)
    && (!toks.length || toks.every(k=>normKey((o.nombre||"")+" "+(o.detalle||"")).includes(k))));
}
function pintarCostosInc(){
  const lista=ciFiltradas();
  const mas=lista.reduce((a,o)=>a+Math.max(0,Number(o.minutos)||0),0), menos=lista.reduce((a,o)=>a+Math.min(0,Number(o.minutos)||0),0);
  const porTipo={}; lista.forEach(o=>porTipo[o.tipo]=(porTipo[o.tipo]||0)+1);
  $("ciKpis").innerHTML = kpi("Incidencias", lista.length) + kpi("Personas", new Set(lista.map(o=>o.nombre)).size)
    + kpi("Minutos a favor", "+"+Math.round(mas), "var(--exito)") + kpi("Minutos en contra", Math.round(menos), "var(--alerta)")
    + Object.keys(porTipo).sort((a,b)=>porTipo[b]-porTipo[a]).slice(0,4).map(t=>kpi(TIPO_LBL(t), porTipo[t])).join("");
  const ord=ordAplicar("ciTabla", lista);
  const tot=Math.max(1,Math.ceil(ord.length/CI_PAG)); CI.pag=Math.min(Math.max(1,CI.pag),tot);
  $("ciTabla").innerHTML = ordThead("ciTabla",[{k:"fecha",t:"Fecha"},{k:"hora",t:"Hora"},{k:"area",t:"Área",cls:"izq"},
      {k:"nombre",t:"Personal",cls:"izq"},{k:"tipo",t:"Tipo"},{k:"minutos",t:"Minutos"},{k:"detalle",t:"Descripción",cls:"izq"},
      {k:"registrado_por",t:"Registró",cls:"izq"}], pintarCostosInc) + "<tbody>"
    + (ord.length ? ord.slice((CI.pag-1)*CI_PAG, CI.pag*CI_PAG).map(o=>{ const mi=Number(o.minutos)||0;
        return `<tr><td style="white-space:nowrap">${esc(o.fecha)}</td><td>${esc(o.hora||"")}</td><td class="izq">${esc(o.area||"")}</td>
          <td class="izq">${esc(o.nombre||"")}</td><td>${esc(TIPO_LBL(o.tipo))}</td>
          <td class="rep-num" style="color:${mi<0?"var(--alerta)":"var(--exito)"}">${mi>0?"+":""}${mi}</td>
          <td class="izq">${esc(o.detalle||"")}</td><td class="izq">${esc(o.registrado_por||"")}</td></tr>`; }).join("")
      : `<tr><td colspan="8"><div class="vacio-msg">Sin incidencias en el rango</div></td></tr>`)
    + "</tbody>";
  $("ciPager").innerHTML = tot>1
    ? `<button class="btn-mini" ${CI.pag<=1?"disabled":""} onclick="CI.pag--;pintarCostosInc()">‹ Anterior</button>
       <span class="sub" style="margin:0 8px;">${CI.pag}/${tot}</span>
       <button class="btn-mini" ${CI.pag>=tot?"disabled":""} onclick="CI.pag++;pintarCostosInc()">Siguiente ›</button>` : "";
}
function ciDescargar(){
  const lista=ciFiltradas(); if(!lista.length){ mostrarError("No hay incidencias para descargar"); return; }
  xlsxSimple(`INCIDENCIAS_${nombreArchivo($("ciArea").value||"TODAS")}_${CI.desde}_${CI.hasta}.xlsx`, "Incidencias",
    ["Fecha","Hora","Área","Personal","Tipo","Minutos","Descripción","Registró"],
    lista.map(o=>[o.fecha,o.hora||"",o.area||"",o.nombre||"",TIPO_LBL(o.tipo),Number(o.minutos)||0,o.detalle||"",o.registrado_por||""]));
}

/* ================= ASISTENCIA DEL DÍA =================
   Presentes = ACTIVO más los estados "EN …" (EN ACABADO, EN SACOS…: personal
   que vino y apoya en otra área). Sin marca ni tickets = sin marcar, aparte. */
let CA={fecha:"", area:null, personal:[]};
const SIN_MARCAR="SIN MARCAR";
const caEstado = p => p.estado || SIN_MARCAR;
const caPresente = e => e==="ACTIVO" || /^EN\s/.test(e);
function caInit(){
  costosAreas("caArea", true);
  if(!$("caFecha").value) $("caFecha").value=hoyISO();
  cargarCostosAsis();
}
async function cargarCostosAsis(){
  const f=$("caFecha").value; if(!f){ mostrarError("Indica la fecha"); return; }
  pintarCargando($("caTabla"),"Cargando…");
  try{
    const r=await rpc("fn_costos_asistencia",{p_dni:ING.dni,p_token:ING.token,p_area:$("caArea").value,p_fecha:f});
    if(!r||!r.ok){ $("caTabla").innerHTML=""; mostrarError((r&&r.error)||"No se pudo cargar"); return; }
    CA={fecha:r.fecha||f, area:$("caArea").value, personal:r.personal||[]};
    const est=[...new Set(CA.personal.map(caEstado))].sort(caOrdenEstado), prev=$("caEstado").value;
    $("caEstado").innerHTML=`<option value="">Todos</option><option value="__P">Presentes</option>`
      + est.map(e=>`<option>${esc(e)}</option>`).join("");
    if(prev && (prev==="__P"||est.includes(prev))) $("caEstado").value=prev;
    pintarCostosAsis();
  }catch(e){ $("caTabla").innerHTML=""; mostrarError(e.message); }
}
function caOrdenEstado(a,b){
  const peso=e=>e==="ACTIVO"?0:/^EN\s/.test(e)?1:e===SIN_MARCAR?9:2;
  return peso(a)-peso(b) || a.localeCompare(b,"es");
}
function caConteo(lista){
  const c={}; lista.forEach(p=>{ const e=caEstado(p); c[e]=(c[e]||0)+1; });
  return c;
}
function pintarCostosAsis(){
  const todo=CA.personal, c=caConteo(todo), est=Object.keys(c).sort(caOrdenEstado);
  const pres=todo.filter(p=>caPresente(caEstado(p))).length;
  const color=e=>e==="ACTIVO"?"var(--exito)":/^EN\s/.test(e)?"var(--violeta)":e===SIN_MARCAR?"var(--tenue)":"var(--alerta)";
  $("caKpis").innerHTML = kpi("Personal", todo.length) + kpi("Presentes", `${pres}/${todo.length}`, "var(--exito)")
    + est.filter(e=>e!=="ACTIVO").map(e=>kpi(e===SIN_MARCAR?"Sin marcar":e, c[e], color(e))).join("");
  // Resumen por área: solo con "Todas las áreas".
  const wrap=$("caAreasWrap"); wrap.hidden=!!CA.area || !todo.length;
  if(!wrap.hidden){
    const porArea={}; todo.forEach(p=>(porArea[p.area]=porArea[p.area]||[]).push(p));
    const filas=Object.keys(porArea).sort().map(a=>{ const ca=caConteo(porArea[a]);
      return {area:a, total:porArea[a].length, pres:porArea[a].filter(p=>caPresente(caEstado(p))).length, ...ca}; });
    const tot={area:"TOTAL", total:todo.length, pres, ...c};
    $("caTablaAreas").innerHTML = `<thead><tr><th class="izq">Área</th><th>Personal</th><th>Presentes</th>`
      + est.filter(e=>e!=="ACTIVO").map(e=>`<th>${esc(e===SIN_MARCAR?"Sin marcar":e)}</th>`).join("") + `</tr></thead><tbody>`
      + [...filas, tot].map(f=>`<tr${f.area==="TOTAL"?' class="cb-sub"':""}><td class="izq"><b>${esc(f.area)}</b></td><td>${f.total}</td>
          <td class="rep-num" style="color:var(--exito)">${f.pres}</td>`
          + est.filter(e=>e!=="ACTIVO").map(e=>`<td>${f[e]||""}</td>`).join("") + `</tr>`).join("") + `</tbody>`;
  }
  const fe=$("caEstado").value, toks=String($("caBuscar").value).split(/\s+/).map(normKey).filter(Boolean);
  const lista=todo.filter(p=>{ const e=caEstado(p);
    return (!fe || (fe==="__P"?caPresente(e):e===fe)) && (!toks.length || toks.every(k=>normKey(p.nombre).includes(k))); });
  $("caTabla").innerHTML = ordThead("caTabla",[{k:"area",t:"Área",cls:"izq"},{k:"nombre",t:"Personal",cls:"izq"},
      {k:"estado",t:"Estado"},{k:"tickets",t:"Tickets"},{k:"area_actual",t:"Trabaja hoy en",cls:"izq"}], pintarCostosAsis) + "<tbody>"
    + (lista.length ? ordAplicar("caTabla", lista).map(p=>{ const e=caEstado(p);
        const nota=(p.estado_guardado && p.estado_guardado!==e) ? ` <small class="sub" title="Marca guardada">(marcado ${esc(p.estado_guardado)})</small>` : "";
        return `<tr><td class="izq">${esc(p.area||"")}</td><td class="izq">${esc(p.nombre||"")}</td>
          <td><span class="pill ${esc(e.replace(/\s+/g,"_"))}">${esc(e)}</span>${nota}</td><td>${p.tickets||""}</td>
          <td class="izq">${p.area_actual&&p.area_actual!==p.area?esc(p.area_actual):""}</td></tr>`; }).join("")
      : `<tr><td colspan="5"><div class="vacio-msg">Sin personal con ese filtro</div></td></tr>`)
    + "</tbody>";
}
function caDescargar(){
  if(!CA.personal.length){ mostrarError("No hay asistencia para descargar"); return; }
  xlsxSimple(`ASISTENCIA_${nombreArchivo(CA.area||"TODAS")}_${CA.fecha}.xlsx`, "Asistencia",
    ["Área","Personal","Estado","Marca guardada","Tickets","Trabaja hoy en"],
    CA.personal.map(p=>[p.area||"",p.nombre||"",caEstado(p),p.estado_guardado||"",p.tickets||0,p.area_actual||""]));
}
