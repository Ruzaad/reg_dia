/* =====================================================================
   CHRONOS · Ingeniería › PCP (parche 144)
   PCP pone la meta del mes por área; la meta del día sale de dividirla entre
   los días laborables, y cada persona ve en su celular su parte (fn_mi_meta).
   Se alimenta a mano: el Excel del programa de costura y la hoja NOTI_CORTE
   (lo que sale de corte), leída del Google Sheets o subida como archivo.
   El cronograma (pcp-cronograma.js) lee con fn_pcp_costura; aquí solo quedan las cargas.
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
function pcpCargar(){ pcsCargar(); }

const pcpNum=v=>{ if(typeof v==="number") return v; const s=String(v==null?"":v).replace(/[^\d.,\-]/g,""); return s?Number(s.replace(/,/g,"")):NaN; };
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
        cant:pcpNum(g(r,"CANT"))||null,cant_prog:cp,std,ini:pcpFecha(g(r,"INICOSTURA")),fin:pcpFecha(g(r,"FINCOSTURA")),target:pcpFecha(g(r,"TARGET")),operarios:pcpNum(g(r,"OPERARIOS"))||null,
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
