/* =====================================================================
   CHRONOS · Ingeniería › PCP › seguimiento (parche 146)
   Cronograma de corte (PDF), cumplimiento corte/costura, Gantt por OF de lo que
   arranca costura sin corte completo, minutaje semanal, minutaje y eficiencia
   diaria, y el endpoint para que PCP mida sus tiempos reales.
   Una sola RPC de lectura (fn_pcp_seguimiento) y las de claves del endpoint.
   ===================================================================== */
let PCPS={r:null, ch:{}};
const PCPS_PDFJS="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const pcpDn=s=>Math.round(Date.parse(String(s).slice(0,10)+"T00:00:00Z")/864e5);
const pcpIso=n=>new Date(n*864e5).toISOString().slice(0,10);

/* ---------- PDF del cronograma de corte ---------- */
/* paginas: [[{s,x,y,w}]] (texto con posición). Las columnas salen de la fila de cabeceras de cada página y cada
   registro se ancla en su fecha de inicio de corte; lo que sobra en otra línea (cliente o material partidos) se
   suma al registro más cercano en vertical. */
function pcpParsearCronograma(paginas){
  const COLS=["pedido","cliente","of","cantidad","articulo","material","ini_corte","fin_corte","ini_costura","obs"];
  const fechaIso=s=>{ const m=String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/); return m?`${m[3]}-${m[2]}-${m[1]}`:null; };
  const out=[];
  paginas.forEach(items=>{
    const it=items.filter(i=>String(i.s).trim()).map(i=>({s:String(i.s).trim(),x:i.x,y:i.y,c:i.x+i.w/2}));
    const hp=it.find(i=>i.s==="Pedido"); if(!hp) return;
    const hy=hp.y, fo=it.find(i=>/^Generado/.test(i.s)), fy=fo?fo.y+3:-1e9;
    const cab=it.filter(i=>Math.abs(i.y-hy)<=10).sort((a,b)=>a.c-b.c), grupos=[];
    cab.forEach(i=>{ const g=grupos[grupos.length-1]; if(g && i.c-g.c<=14){ g.c=(g.c*g.n+i.c)/(g.n+1); g.n++; } else grupos.push({c:i.c,n:1}); });
    if(grupos.length<COLS.length-1) return;   // Observaciones puede venir vacía pero su cabecera siempre está
    const cuerpo=it.filter(i=>i.y<hy-12 && i.y>fy);
    const anclas=cuerpo.filter(i=>/^\d{2}-\d{2}-\d{4}$/.test(i.s) && Math.abs(i.c-grupos[6].c)<=18).sort((a,b)=>b.y-a.y);
    if(!anclas.length) return;
    const reg=anclas.map(a=>({y:a.y,cel:COLS.map(()=>[])}));
    cuerpo.forEach(i=>{
      let r=reg[0]; reg.forEach(q=>{ if(Math.abs(q.y-i.y)<Math.abs(r.y-i.y)) r=q; });
      let k=0; grupos.forEach((g,j)=>{ if(Math.abs(g.c-i.c)<Math.abs(grupos[k].c-i.c)) k=j; });
      r.cel[k].push(i);
    });
    reg.forEach(r=>{
      const t=k=>r.cel[k].sort((a,b)=>b.y-a.y||a.x-b.x).map(i=>i.s).join(" ").trim();
      const of=t(2), cant=Number(t(3).replace(/[^\d.]/g,""));
      out.push({pedido:t(0),cliente:t(1),of:/^\d+$/.test(of)?of:"",cantidad:cant||0,articulo:t(4),material:t(5),
        ini_corte:fechaIso(t(6)),fin_corte:fechaIso(t(7)),ini_costura:fechaIso(t(8)),obs:COLS.length>9?t(9):""});
    });
  });
  return out.filter(f=>f.articulo && f.ini_corte);
}
async function pcpCargarPdfJs(){
  if(window.pdfjsLib) return;
  await new Promise((ok,ko)=>{ const s=document.createElement("script"); s.src=PCPS_PDFJS+"pdf.min.js"; s.onload=ok;
    s.onerror=()=>ko(new Error("No cargó el lector de PDF (revisa tu conexión y vuelve a intentar)")); document.head.appendChild(s); });
  pdfjsLib.GlobalWorkerOptions.workerSrc=PCPS_PDFJS+"pdf.worker.min.js";
}
async function pcpSubirCronograma(input){
  const file=input.files[0]; input.value=""; if(!file) return;
  try{
    pcpEstado("Leyendo "+file.name+"…");
    await pcpCargarPdfJs();
    const doc=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise, pags=[];
    for(let i=1;i<=doc.numPages;i++){
      const t=await (await doc.getPage(i)).getTextContent();
      pags.push(t.items.map(x=>({s:x.str,x:x.transform[4],y:x.transform[5],w:x.width})));
    }
    const filas=pcpParsearCronograma(pags);
    if(!filas.length) throw new Error("no encontré filas con las columnas Pedido, Cliente, OF, Cantidad, Artículo y fechas");
    pcpEstado(`Subiendo ${filas.length} órdenes del cronograma…`);
    const r=await rpc("fn_pcp_cronograma_cargar",{p_dni:ING.dni,p_token:ING.token,p_archivo:file.name,p_filas:filas});
    if(!r || !r.ok) throw new Error((r&&r.error)||"No se subió");
    pcpEstado(`Cronograma subido: ${r.filas} órdenes`,"ok"); pcpCargar();
  }catch(e){ pcpEstado("No se subió el cronograma: "+(e.message||e),"err"); }
}

function pcpColor(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim()||"#888"; }
function pcpGrafico(id,cfg){
  const cv=$(id); if(!cv || typeof Chart==="undefined") return;
  if(PCPS.ch[id]) PCPS.ch[id].destroy();
  const txt=pcpColor("--suave"), lin=pcpColor("--linea");
  cfg.options=Object.assign({responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false}},cfg.options||{});
  cfg.options.plugins=Object.assign({legend:{position:"bottom",labels:{color:txt,usePointStyle:true,boxWidth:8,padding:14}}},cfg.options.plugins||{});
  cfg.options.scales=cfg.options.scales||{};
  Object.keys(cfg.options.scales).forEach(k=>{ const s=cfg.options.scales[k]; s.ticks=Object.assign({color:txt},s.ticks||{}); s.grid=Object.assign({color:lin},s.grid||{}); });
  PCPS.ch[id]=new Chart(cv,cfg);
}
if(typeof module!=="undefined") module.exports={pcpParsearCronograma};
