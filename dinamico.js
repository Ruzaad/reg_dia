/* =====================================================================
   SAMITEX · Capa dinámica (propuesta)
   Se carga DESPUÉS de app.js / ingenieria.js. No reemplaza ninguna
   función de la app: usa las mismas funciones de carga, los mismos
   campos y las mismas RPC. Lo que agrega:
   - Una barra de contexto fija con fecha (o rango) y área que valen
     para todas las pestañas: se eligen una vez y cada pestaña se carga
     sola con esos valores, sin botón "Cargar".
   - Pestañas del día "en vivo": se refrescan solas cada 30 s y al
     instante cuando otra pantalla escribe en la base.
   - Todas las tablas se pueden ordenar por cualquier columna (las que
     ya se ordenaban siguen con su orden propio) y el orden se mantiene
     al refrescar.
   - Buscador Ctrl+K de pestañas, personas y OF, iconos y contadores
     en el menú.
   ===================================================================== */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const PAG=document.body&&document.body.dataset.pagina;

/* ---------- tema claro/oscuro ----------
   Corre en TODAS las páginas (login incluido), no solo en las que tienen
   pestañas propias: el rediseño con tema oscuro aplica a toda la maqueta.
   Sigue el mismo patrón que la maqueta de referencia que Ruzaad aprobó:
   dataset.theme manda sobre la preferencia del sistema, y se guarda tal
   cual dinamico.js ya guarda otros valores (localStorage directo, con
   try/catch, sin pasar por __LS). */
(function temaInit(){
  const CLAVE="ing-maq-tema";
  let guardado=null;try{guardado=localStorage.getItem(CLAVE);}catch(e){}
  if(guardado==="light"||guardado==="dark")document.documentElement.dataset.theme=guardado;
  function alternar(){
    const d=document.documentElement;
    const oscuroAhora=d.dataset.theme?d.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches;
    d.dataset.theme=oscuroAhora?"light":"dark";
    try{localStorage.setItem(CLAVE,d.dataset.theme);}catch(e){}
  }
  function inyectar(){
    const hdr=document.querySelector("header");
    if(!hdr||$("btnTema"))return;
    const b=document.createElement("button");b.type="button";b.id="btnTema";b.className="btn-hdr-icon";
    b.setAttribute("aria-label","Cambiar tema claro/oscuro");b.title="Tema claro/oscuro";
    b.onclick=alternar;
    const menu=$("btnMenu");menu?menu.before(b):hdr.appendChild(b);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",inyectar);else inyectar();
})();
const pad=n=>String(n).padStart(2,"0");
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const hoy=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"America/Lima"});
const fechaDe=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);};
const mas=(s,n)=>{const d=fechaDe(s);d.setDate(d.getDate()+n);return iso(d);};
const DIAS=["dom","lun","mar","mié","jue","vie","sáb"], MESES=["ene","feb","mar","abr","may","jun","jul","ago","set","oct","nov","dic"];
const txtFecha=s=>{if(!s)return"";const d=fechaDe(s);return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;};
const escH=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const vis=el=>!!(el&&el.offsetParent!==null);

/* ---------- rangos predefinidos ---------- */
function labsHasta(h,n){let d=h,k=0,out=h;while(k<n){const w=fechaDe(d).getDay();if(w!==0&&w!==6){k++;out=d;}d=mas(d,-1);}return out;}
const RANGOS={
  hoy:{t:"Hoy",f:h=>[h,h]},
  lab5:{t:"5 días lab.",f:h=>[labsHasta(h,5),h]},
  semana:{t:"Esta semana",f:h=>{const w=(fechaDe(h).getDay()+6)%7;return [mas(h,-w),h];}},
  quin:{t:"Quincena",f:h=>{const d=+h.slice(8);return [h.slice(0,8)+(d<=15?"01":"16"),h];}},
  mes:{t:"Este mes",f:h=>[h.slice(0,8)+"01",h]},
  d30:{t:"30 días",f:h=>[mas(h,-29),h]},
  m3:{t:"3 meses",f:h=>{const d=fechaDe(h);return [iso(new Date(d.getFullYear(),d.getMonth()-2,1)),h];}}
};
function quincenas(h){
  const d=fechaDe(h),y=d.getFullYear(),m=d.getMonth(),ult=new Date(y,m+1,0).getDate();
  const act=+h.slice(8)<=15?[iso(new Date(y,m,1)),iso(new Date(y,m,15))]:[iso(new Date(y,m,16)),iso(new Date(y,m,ult))];
  const ant=+h.slice(8)<=15?[iso(new Date(y,m-1,16)),iso(new Date(y,m,0))]:[iso(new Date(y,m,1)),iso(new Date(y,m,15))];
  return {act,ant};
}

/* ---------- estado global (se recuerda por pestaña del navegador) ---------- */
const G={fecha:hoy(),area:"",rango:null,desde:null,hasta:null,quin:"act"};
/* parche 95: quien no lee todas las áreas no tiene la opción "Todas". */
const todasOk=()=>{try{return leeTodas();}catch(e){return true;}};
try{Object.assign(G,JSON.parse(sessionStorage.getItem("stx-dyn")||"{}"));}catch(e){}
if(G.fecha>hoy())G.fecha=hoy();
const guardar=()=>{try{sessionStorage.setItem("stx-dyn",JSON.stringify(G));}catch(e){}};
function rangoDe(v){
  if(G.rango==="custom"&&G.desde&&G.hasta) return [G.desde,G.hasta];
  const k=G.rango||v.def||"lab5"; return RANGOS[k].f(hoy());
}
const rangoKey=v=>G.rango||v.def||"lab5";

/* ---------- utilidades para escribir en los campos de la app ---------- */
function put(id,v){const el=$(id);if(!el||v==null)return false;
  if(el.tagName==="SELECT"&&![...el.options].some(o=>o.value===v||o.text===v))return false;
  if(el.value===v)return false; el.value=v; return true;}
function putFp(id,d,h,cb){const el=$(id);if(!el)return false;const fp=el._flatpickr;
  if(!fp){el.value=d+" a "+h;return false;}
  const cur=fp.selectedDates.map(iso).join("|"); if(cur===d+"|"+h) return false;
  fp.setDate([d,h],true); if(cb)cb(); return true;}
const llamar=(nombre,...a)=>{const f=window[nombre]||(typeof globalThis[nombre]==="function"?globalThis[nombre]:null);
  try{ if(typeof f==="function") return f(...a); return eval(nombre)(...a);}catch(e){console.warn("dyn",nombre,e);}};

/* =====================================================================
   INGENIERÍA
   ===================================================================== */
const VISTAS=PAG==="ingenieria"?[
  {id:"tkActual",tab:"pasoTk",m:"tkActualView",modo:"dia",area:1,live:1,t:"Actual",
   aplicar(){const c=put("fechaTk",G.fecha); return c;},
   despues(){ const a=$("areaTk"); if(a){ conOpcion(a); if(a.value!==G.area){a.value=G.area; llamar("filtrarTkArea",G.area);} } },
   cargar:()=>llamar("cargarTk"),ocupada:()=>{try{return modoLibTk||Object.keys(libSel).length>0;}catch(e){return false;}},
   ocultar:["fechaTk","areaTk"]},
  {id:"tkOp",tab:"pasoTk",m:"tkOpView",modo:null,area:1,areaReq:1,t:"Reclamados x operación",
   aplicar(){return put("tkOpArea",G.area);},req:()=>$("tkOpArea").value&&$("tkOpOf").value.trim().length>=3,
   cargar:()=>llamar("cargarTkOp"),auto:["tkOpOf"],despues(){chipsOF(this,"tkOpOf");},ocupada:()=>{try{return Object.keys(tkOpMarc).length>0;}catch(e){return false;}},ocultar:["tkOpArea"]},
  {id:"tkRep",tab:"pasoTk",m:"tkRepView",modo:"dia",area:1,live:1,t:"Reporte de hoy",
   aplicar(){return put("repFecha",G.fecha);},
   despues(){llamar("poblarAreaRep");const a=$("repArea");if(a&&put("repArea",G.area)||(a&&!G.area&&a.value)){if(!G.area)a.value="";llamar("pintarRep");}},
   cargar:()=>llamar("cargarRep"),ocultar:["repFecha","repArea"]},
  {id:"tkOpe",tab:"pasoTk",m:"tkOpeView",modo:"rango",def:"lab5",area:1,t:"Resumen x operario",
   aplicar(){const [d,h]=rangoDe(this);let c=put("opeDesde",d);c=put("opeHasta",h)||c;c=put("opeArea",G.area)||c;if(!G.area&&$("opeArea")&&$("opeArea").value){$("opeArea").value="";c=true;}return c;},
   cargar:()=>llamar("cargarOpe"),ocultar:["opeDesde","opeHasta","opeArea"]},
  {id:"mod",tab:"pasoMod",m:"pasoMod",modo:"dia",area:1,areaReq:1,live:1,t:"Avance por módulo",
   aplicar(){let c=put("fechaMod",G.fecha);if(put("areaMod",G.area)){c=true;if($("artMod"))$("artMod").value="";}return c;},
   cargar:()=>llamar("cargarMod"),auto:["artMod"],ocultar:["fechaMod","areaMod"],despues(){chipsMod();}},
  {id:"gen",tab:"pasoGen",m:"pasoGen",modo:null,area:1,areaReq:1,soloSel:1,t:"Generar tickets",
   aplicar(){const a=$("areaGen");if(a&&G.area&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;llamar("genAreaChange");}return false;},ocultar:["areaGen"]},
  {id:"ofs",tab:"pasoOfs",m:"pasoOfs",modo:null,t:"OFs registradas",live:1,cargar:()=>llamar("cargarOfs")},
  {id:"avof",tab:"pasoAvOF",m:"pasoAvOF",modo:"rango",def:"m3",t:"Resumen de OF",
   aplicar(){const [d,h]=rangoDe(this);let c=put("avofDesde",d.slice(0,7));c=put("avofHasta",h.slice(0,7))||c;return c;},
   cargar:()=>llamar("cargarAvof"),ocultar:["avofDesde","avofHasta"]},
  {id:"vista",tab:"pasoVista",m:"pasoVista",modo:null,t:"Vista del personal"},
  {id:"ef",tab:"pasoEf",m:"pasoEf",modo:"dia",area:1,areaReq:1,live:1,t:"Eficiencia · día",
   aplicar(){return put("fechaEf",G.fecha);},
   despues(){const a=$("filtroAreaEf");if(a&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;try{if(EF)llamar("pintarEf");}catch(e){}}},
   cargar:()=>llamar("cargarEf"),ocultar:["fechaEf","filtroAreaEf"]},
  {id:"efR",tab:"pasoDia",m:"pasoDia",modo:"rango",def:"lab5",area:1,t:"Eficiencia · rango",
   aplicar(){const [d,h]=rangoDe(this);let c=putFp("rangoEf",d,h);try{if(efRangoSel.desde!==d||efRangoSel.hasta!==h){efRangoSel.desde=d;efRangoSel.hasta=h;c=true;}}catch(e){}
     const a=$("filtroAreaEfR");if(a&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;c=true;}return c;},
   cargar:()=>llamar("cargarEfRango"),ocultar:["rangoEf","filtroAreaEfR"]},
  {id:"audit",tab:"pasoAudit",m:"pasoAudit",modo:"rango",def:"d30",area:1,t:"Auditoría",
   aplicar(){const [d,h]=rangoDe(this);let c=put("audDesde",d);c=put("audHasta",h)||c;const a=$("audArea");if(a&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;c=true;}return c;},
   cargar:()=>llamar("cargarAudit"),auto:["audUmbral"],ocultar:["audDesde","audHasta","audArea"]},
  {id:"incQ",tab:"pasoInc",m:"incQView",modo:"quin",area:1,t:"Incentivos · quincena",
   aplicar(){let c=aplQuin();c=areaSel("incArea")||c;return c;},cargar:()=>llamar("cargarInc"),ocultar:["incArea"]},
  {id:"incMod",tab:"pasoInc",m:"incModView",modo:"quin",area:1,t:"Incentivos · bono modular",
   aplicar(){let c=aplQuin();c=areaSel("modArea")||c;return c;},cargar:()=>llamar("cargarModular"),ocultar:["modArea"],ocupada:()=>!!document.querySelector("#incModView .mod-in.cambiada")},
  {id:"incEfm",tab:"pasoInc",m:"incEfmView",modo:"quin",area:1,t:"Incentivos · eficiencia manual",
   aplicar(){let c=aplQuin();c=areaSel("efmArea")||c;return c;},cargar:()=>llamar("cargarEfManual"),ocultar:["efmArea"],ocupada:()=>!!document.querySelector("#incEfmView .efm-in.cambiada")},
  {id:"incCons",tab:"pasoInc",m:"incConsView",modo:"quin",area:1,t:"Incentivos · min. consideración",
   aplicar(){let c=aplQuin();c=areaSel("consArea")||c;return c;},cargar:()=>llamar("cargarCons"),ocultar:["consArea"]},
  {id:"incSus",tab:"pasoInc",m:"incSusView",modo:"quin",area:1,t:"Incentivos · sustento",
   aplicar(){const q=quincenas(hoy())[G.quin==="ant"?"ant":"act"];
     let c=put("susDesde",q[0]);c=put("susHasta",q[1])||c;
     if(c)try{llamar("susCmpAuto");}catch(e){}
     return c;},
   cargar:()=>llamar("armarSustento")},
  {id:"incTabla",tab:"pasoInc",m:"incTablaView",modo:null,t:"Incentivos · tabla"},
  {id:"dashAsis",tab:"pasoDash",m:"dbPanelAsis",modo:"rango",def:"semana",area:1,t:"Tableros · asistencia",
   aplicar(){const [d,h]=rangoDe(this);let c=false;const g=$("perDashGrano");if(g&&g.value!=="rango"){g.value="rango";llamar("perDashGranoChange");c=true;}
     try{if(PER.dashSel.desde!==d||PER.dashSel.hasta!==h){PER.dashSel.desde=d;PER.dashSel.hasta=h;c=true;}}catch(e){}
     putFp("perDashRango",d,h);c=areaSel("perDashArea")||c;return c;},
   cargar:()=>llamar("perCargarDash"),ocultar:["perDashGrano","perDashRango","perDashArea"]},
  {id:"dashEf",tab:"pasoDash",m:"dbPanelEf",modo:"rango",def:"semana",t:"Tableros · eficiencia",
   aplicar(){const [d,h]=rangoDe(this);let c=false;try{if(DB.efSel.desde!==d||DB.efSel.hasta!==h){DB.efSel.desde=d;DB.efSel.hasta=h;c=true;}}catch(e){}putFp("dbEfRango",d,h);return c;},
   cargar:()=>llamar("cargarDbEf"),ocultar:["dbEfRango"]},
  {id:"dashCant",tab:"pasoDash",m:"dbPanelCant",modo:"rango",def:"semana",t:"Tableros · cantidad",
   aplicar(){const [d,h]=rangoDe(this);let c=false;try{if(DB.cantSel.desde!==d||DB.cantSel.hasta!==h){DB.cantSel.desde=d;DB.cantSel.hasta=h;c=true;}}catch(e){}putFp("dbCantRango",d,h);return c;},
   cargar:()=>llamar("cargarDbCant"),ocultar:["dbCantRango"]},
  {id:"dashMod",tab:"pasoDash",m:"dbPanelMod",modo:"rango",def:"semana",area:1,areaReq:1,t:"Tableros · minutos por módulo",
   aplicar(){const [d,h]=rangoDe(this);let c=false;try{if(DB.modSel.desde!==d||DB.modSel.hasta!==h){DB.modSel.desde=d;DB.modSel.hasta=h;c=true;}}catch(e){}putFp("dbModRango",d,h);c=areaSel("dbModArea")||c;return c;},
   req:()=>$("dbModArea")&&$("dbModArea").value,cargar:()=>llamar("cargarDbMod"),ocultar:["dbModRango","dbModArea"]},
  {id:"perCrud",tab:"pasoAsis",m:"perCrud",modo:null,area:1,t:"Personal",aplicar(){return areaSel("perArea");},cargar:()=>llamar("perCargarCrud"),ocultar:["perArea"],
   ocupada:()=>{try{return Object.keys(PER.crudSel||{}).length>0;}catch(e){return false;}}},
  {id:"perRango",tab:"pasoAsis",m:"perRango",modo:"rango",def:"semana",area:1,t:"Personal · estados por rango",
   aplicar(){const [d,h]=rangoDe(this);put("perRangoDesde",d);put("perRangoHasta",h);return areaSel("perRangoArea");},cargar:()=>llamar("perCargarRango"),
   ocupada:()=>{try{return Object.keys(PER.rangoSel||{}).length>0;}catch(e){return false;}},ocultar:["perRangoArea"]},
  {id:"perMat",tab:"pasoAsis",m:"perMatriz",modo:"rango",def:"semana",area:1,t:"Personal · matriz",
   aplicar(){const [d,h]=rangoDe(this);let c=false;try{if(PER.matSel.desde!==d||PER.matSel.hasta!==h){PER.matSel.desde=d;PER.matSel.hasta=h;c=true;}}catch(e){}putFp("perMatRango",d,h);c=areaSel("perMatArea")||c;return c;},
   cargar:()=>llamar("perCargarMatriz"),ocultar:["perMatRango","perMatArea"]},
  {id:"perMov",tab:"pasoAsis",m:"perMov",modo:"dia",area:1,live:1,t:"Personal · movimientos",
   aplicar(){let c=put("movFecha",G.fecha);c=areaSel("movArea")||c;return c;},cargar:()=>llamar("cargarMovs"),ocultar:["movFecha","movArea"]},
  {id:"bases",tab:"pasoBases",m:"pasoBases",modo:null,area:1,areaReq:1,t:"Bases",
   aplicar(){return put("areaBase",G.area);},cargar:()=>llamar("cargarBases"),ocultar:["areaBase"],
   ocupada:()=>vis(document.querySelector("#pasoBases .base-edit-bar"))},
  {id:"baseLog",tab:"pasoBaseLog",m:"pasoBaseLog",modo:"rango",def:"semana",area:1,t:"Historial de tiempos",
   aplicar(){const [d,h]=rangoDe(this);let c=put("blDesde",d);c=put("blHasta",h)||c;c=areaSel("blArea")||c;return c;},
   cargar:()=>llamar("cargarBaseLog"),ocultar:["blDesde","blHasta","blArea"]},
  {id:"inciApl",tab:"pasoIncid",m:"inciAplicadas",modo:"rango",def:"semana",area:1,live:1,t:"Incidencias · aplicadas",
   aplicar(){const [d,h]=rangoDe(this);let c=put("fechaInciD",d);c=put("fechaInciH",h)||c;c=areaSel("areaInci")||c;return c;},
   cargar:()=>llamar("cargarOcurrencias"),ocultar:["fechaInciD","fechaInciH","areaInci"]},
  {id:"inciPend",tab:"pasoIncid",m:"inciPendientes",modo:null,area:1,live:1,t:"Incidencias · pendientes",
   despues(){const a=$("areaInciPend");if(a&&a.options.length){conOpcion(a);if(a.value!==G.area){a.value=G.area;llamar("pintarPendientesInci");}}},
   cargar:()=>llamar("cargarPendientesInci"),ocultar:["areaInciPend"]},
  {id:"inciHE",tab:"pasoIncid",m:"inciHE",modo:"dia",area:1,areaReq:1,t:"Incidencias · horas extras en lote",
   aplicar(){let c=put("heFecha",G.fecha);c=put("heArea",G.area)||c;return c;},cargar:()=>llamar("heCargar"),
   ocupada:()=>{try{return HE.marcados.size>0;}catch(e){return false;}},ocultar:["heFecha","heArea"]},
  {id:"fechas",tab:"pasoFechas",m:"pasoFechas",modo:"dia",area:1,areaReq:1,t:"Corregir fechas",
   aplicar(){let c=put("fechaFec",G.fecha);const a=$("areaFec");if(a&&G.area&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;llamar("cargarFecArea");}return c;},
   req:()=>$("opFec")&&$("opFec").value,cargar:()=>llamar("cargarReclamosFec"),auto:["opFec"],
   ocupada:()=>{try{return Object.keys(FEC_SEL).length>0;}catch(e){return false;}},ocultar:["fechaFec","areaFec"]},
  {id:"opsOf",tab:"pasoOpsOF",m:"pasoOpsOF",modo:null,area:1,areaReq:1,soloSel:1,t:"Operaciones por OF",
   aplicar(){const a=$("opfArea");if(a&&G.area&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;llamar("opfReset");}return false;},
   req:()=>$("opfArea").value&&$("opfOf").value.trim().length>=3,cargar:()=>llamar("opfCargarOF"),auto:["opfOf"],ocultar:["opfArea"],despues(){chipsOF(this,"opfOf");}},
  {id:"extra",tab:"pasoExtra",m:"pasoExtra",modo:null,area:1,t:"Operaciones sin OF",
   aplicar(){const a=$("exArea");if(a&&G.area&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;llamar("cargarExtra");}return false;},ocultar:["exArea"]},
  {id:"causas",tab:"pasoCausas",m:"pasoCausas",modo:null,t:"Causas de STD"},
  {id:"costosBase",tab:"pasoCostosBase",m:"pasoCostosBase",modo:null,area:1,areaReq:1,t:"Base y balance",
   aplicar(){return put("cbArea",G.area);},cargar:()=>llamar("cargarCostosBase"),ocultar:["cbArea"]},
  {id:"costosHoy",tab:"pasoCostosHoy",m:"pasoCostosHoy",modo:"dia",area:1,live:1,t:"Reporte de hoy",
   aplicar(){let c=put("chFecha",G.fecha);c=areaSel("chArea")||c;return c;},cargar:()=>llamar("cargarCostosHoy"),ocultar:["chFecha","chArea"]},
  {id:"costosInc",tab:"pasoCostosInc",m:"pasoCostosInc",modo:"rango",def:"semana",area:1,live:1,t:"Incidencias",
   aplicar(){const [d,h]=rangoDe(this);let c=put("ciDesde",d);c=put("ciHasta",h)||c;c=areaSel("ciArea")||c;return c;},
   cargar:()=>llamar("cargarCostosInc"),ocultar:["ciDesde","ciHasta","ciArea"]},
  {id:"costosAsis",tab:"pasoCostosAsis",m:"pasoCostosAsis",modo:"dia",area:1,live:1,t:"Asistencia",
   aplicar(){let c=put("caFecha",G.fecha);c=areaSel("caArea")||c;return c;},cargar:()=>llamar("cargarCostosAsis"),ocultar:["caFecha","caArea"]},
  {id:"supArea",tab:"pasoSupArea",m:"pasoSupArea",modo:null,t:"Operar como supervisora"},
  {id:"opArea",tab:"pasoOpArea",m:"pasoOpArea",modo:null,area:1,areaReq:1,t:"Operar como operario",
   aplicar(){const a=$("areaOp");if(a&&G.area&&a.value!==G.area&&[...a.options].some(o=>o.value===G.area)){a.value=G.area;llamar("cargarOpArea");}return false;},ocultar:["areaOp"]}
]:[];
/* ---------- OF en fichas: se elige tocando, sin escribir el número ---------- */
function fichas(ancla,id,lista,activo,pick){
  if(!ancla)return;let z=$(id);
  if(!z){z=document.createElement("div");z.id=id;z.className="dyn-ofs";ancla.after(z);
    z.addEventListener("click",e=>{const b=e.target.closest("[data-of]");if(b)z._pick(b.dataset.of,b.dataset.art);});}
  z._pick=pick;
  z.innerHTML=lista.length?`<span class="dyn-ofs-t">OF del área</span>`+lista.map(o=>`<button class="dyn-chip ${String(o.of)===String(activo)?"on":""}" data-of="${escH(o.of)}" data-art="${escH(o.art||"")}"><b>${escH(o.of)}</b>${o.art?` · ${escH(o.art)}`:""}${o.extra?`<small>${escH(o.extra)}</small>`:""}</button>`).join(""):"";
}
function chipsMod(){
  let arts=[];try{arts=MOD_ARTS||[];}catch(e){}
  const lista=[];arts.forEach(a=>(a.ofs||[]).forEach(of=>lista.push({of,art:a.articulo})));
  lista.sort((a,b)=>String(b.of).localeCompare(String(a.of),"es",{numeric:true}));
  const bc=document.querySelector("#pasoMod .barra-control");
  const cur=$("ofModSel")?$("ofModSel").value:"";
  const pick=(of,art)=>{$("artMod").value=art;llamar("poblarOfMod");$("ofModSel").value=of;llamar("cargarModOF");chipsMod();};
  fichas(bc,"dynOfsMod",lista.slice(0,14),cur,pick);
  if(!cur&&lista.length&&G.area)pick(lista[0].of,lista[0].art);
}
let OFS_CACHE=null;
function chipsOF(v,inputId){
  const area=G.area;const inp=$(inputId);if(!inp)return;
  const bc=inp.closest(".barra-control");
  const pintar=()=>{const pre=area.split(" ")[0];
    const lista=(OFS_CACHE||[]).filter(o=>area&&(area==="ACABADO"||String(o.prenda||"").toUpperCase().startsWith(pre)))
      .sort((a,b)=>String(b.of).localeCompare(String(a.of),"es",{numeric:true})).slice(0,10).map(o=>({of:o.of,art:o.articulo}));
    fichas(bc,"dynOfs_"+inputId,lista,inp.value.trim(),of=>{inp.value=of;refrescar(v,{forzar:true});});};
  if(OFS_CACHE)return pintar();
  try{rpc("fn_ofs_listar",{p_dni:ING.dni,p_token:ING.token,p_buscar:""}).then(r=>{OFS_CACHE=Array.isArray(r)?r:[];pintar();}).catch(()=>{});}catch(e){}
}
/* ---------- el área de cada vista ----------
   Cada vista tiene su propio select de área (el que la barra oculta). La barra
   marca como elegida el valor REAL de ese select, no solo el que se pidió: si
   una vista no admite esa área (Generar tickets solo lista áreas con Sheet),
   se ve qué área está usando de verdad en vez de un chip que no filtra. */
const selArea=v=>{const id=v.sel||(v.ocultar||[]).find(x=>/area/i.test(x));return id?$(id):null;};
/* Selects que la app llena recién al entrar a la vista. Si se llenan antes,
   la primera carga ya sale con el área elegida (sin esto se pedía "Todas" y
   luego el área, y la respuesta que llegaba última, a veces "Todas", era la
   que quedaba en pantalla con el chip marcando otra cosa). Mismo formato que
   el que usa cada una. */
const LLENAR={repArea:"Todas las áreas",opeArea:"Todas las áreas",audArea:"Todas las áreas",blArea:"Todas las áreas",
  incArea:"Todas las áreas",modArea:"Todas las áreas",efmArea:"Todas las áreas",consArea:"Todas las áreas",tkOpArea:"— Elige área —",heArea:null,
  cbArea:null,chArea:"Todas las áreas",ciArea:"Todas las áreas",caArea:"Todas las áreas"};
function llenarArea(v){
  const a=selArea(v);if(!a||!(a.id in LLENAR)||a.options.length>1)return;
  let L=[];try{L=AREAS_LISTA||[];}catch(e){}if(!L.length)return;
  const ph=LLENAR[a.id]==="Todas las áreas"&&!todasOk()?null:LLENAR[a.id],prev=a.value;
  a.innerHTML=(ph?`<option value="">${ph}</option>`:"")+L.map(x=>`<option>${escH(x)}</option>`).join("");
  if(prev&&L.includes(prev))a.value=prev;
}
/* Selects armados con lo que hay en los datos (áreas con tickets hoy, con
   pendientes): si el área elegida no tiene nada, se agrega igual para que el
   filtro diga "nada en esta área" en vez de soltarse y mostrar todas. */
function conOpcion(a){if(G.area&&![...a.options].some(o=>o.value===G.area)){const o=document.createElement("option");o.textContent=G.area;a.appendChild(o);}}
function areaVista(v){const a=selArea(v);return a&&a.options.length>1?a.value:G.area;}
function aplQuin(){const q=quincenas(hoy())[G.quin==="ant"?"ant":"act"];let c=put("incDesde",q[0]);c=put("incHasta",q[1])||c;return c;}
function areaSel(id){const a=$(id);if(!a)return false;const v=[...a.options].some(o=>o.value===G.area)?G.area:(G.area?null:"");if(v===null||a.value===v)return false;a.value=v;return true;}

/* ¿Qué vista está en pantalla? La primera cuya pestaña está activa y cuyo contenedor se ve. */
function vistaActual(){
  const act=document.querySelector(".pantalla.activa");if(!act)return null;
  return VISTAS.find(v=>act.id===v.tab&&$(v.m)&&(v.m===v.tab||!$(v.m).hidden&&vis($(v.m))))||VISTAS.find(v=>act.id===v.tab)||null;
}

/* ---------- ocultar lo que ya maneja la barra ---------- */
function envoltorio(el){return el.closest(".campo,label,.campo-check")||el;}
function ocultarCampos(v){
  (v.ocultar||[]).forEach(id=>{const el=$(id);if(!el)return;const w=envoltorio(el);
    if(w.closest(".barra-control,.fila-filtros")&&w!==w.closest(".barra-control,.fila-filtros"))w.classList.add("dyn-oculto");});
  const cont=$(v.m);if(!cont)return;
  const nombres=[v.cargar&&String(v.cargar).match(/llamar\("(\w+)"/)].filter(Boolean).map(m=>m[1]);
  cont.querySelectorAll("button[onclick]").forEach(b=>{const oc=b.getAttribute("onclick").replace(/\s|;/g,"");
    if(nombres.some(n=>oc===n+"()")||/^↻?\s*cargar$/i.test(b.textContent.trim())&&nombres.length)b.classList.add("dyn-oculto");});
  cont.querySelectorAll(".barra-control").forEach(b=>{const hay=[...b.children].some(c=>!c.classList.contains("dyn-oculto")&&getComputedStyle(c).display!=="none");b.classList.toggle("dyn-vacia",!hay);});
}

/* ---------- cargar la vista con el contexto ---------- */
let ultimaCarga=0, cargando=false;
const claveDe=v=>JSON.stringify([v.modo==="dia"?G.fecha:v.modo==="rango"?rangoDe(v):v.modo==="quin"?G.quin:"",v.area?G.area:""]);
/* Reemplaza, en cada función de carga de la app, el "vaciar a un
   esqueleto y volver a pintar" por algo que no se sienta como recargar
   la página: si el contenedor ya tenía datos, los deja puestos y solo
   los atenúa hasta que llega la respuesta nueva; recién si está vacío
   (primera vez que se entra a esa pantalla) muestra el esqueleto. Se
   limpia sola en cuanto la propia función pinta el contenido nuevo. */
function pintarCargando(el,txt){
  if(typeof el==="string")el=$(el);
  if(!el)return;
  if(el.children.length&&!el.querySelector(":scope > .cargando")){
    el.classList.add("dyn-suave");
    let listo=false;
    const quitar=()=>{if(listo)return;listo=true;mo.disconnect();clearTimeout(tSeg);
      el.classList.remove("dyn-suave");el.classList.add("dyn-llego");setTimeout(()=>el.classList.remove("dyn-llego"),500);};
    const mo=new MutationObserver(quitar);
    mo.observe(el,{childList:true});
    /* Si la carga falla a mitad de camino (RPC caída, excepción) y nadie
       vuelve a tocar este contenedor, que NO se quede atenuado y sin clics
       para siempre: es justo lo que se ve como "la pantalla se rompió". */
    const tSeg=setTimeout(quitar,4000);
    return;
  }
  el.classList.remove("dyn-suave");
  el.innerHTML=cargandoHTML(txt);
}
/* app.js/ingenieria.js llaman a esta función directamente (se les
   insertó la llamada al armar la maqueta), y ellos corren fuera de este
   cierre, así que tiene que quedar accesible como global. */
window.pintarCargando=pintarCargando;

async function refrescar(v,{forzar=false,vivo=false}={}){
  if(!v)return;
  llenarArea(v);
  const cambio=v.aplicar?v.aplicar.call(v):false;
  if(v.despues)v.despues.call(v);
  const k=claveDe(v);
  if(!v.cargar){v.clave=k;return pintarCtx();}
  if(!forzar&&!cambio&&v.clave===k)return pintarCtx();
  if(v.req&&!v.req()){if(v.despues)v.despues.call(v);return pintarCtx();}
  if(v.areaReq&&v.area&&!G.area&&!v.req)return pintarCtx();
  v.clave=k;
  const main=document.querySelector(".ing-main"),y=main?main.scrollTop:0;
  /* En un refresco en vivo (nadie tocó nada) no repintamos toda la barra
     de contexto, solo su pastilla de estado: así no parpadean los chips
     de área ni el resto mientras el usuario está leyendo. */
  cargando=true;if(vivo)estadoVivo();else pintarCtx();
  try{await v.cargar();}catch(e){}
  cargando=false;ultimaCarga=Date.now();
  if(v.despues)v.despues.call(v);
  if(vivo&&main)main.scrollTop=y;
  if(vivo)estadoVivo();else pintarCtx();
  contadores();
}
function estadoVivo(){const el=document.querySelector(".dyn-live");if(!el){pintarCtx();return;}
  el.classList.toggle("car",cargando);
  const b=el.querySelector("b");if(b)b.textContent=cargando?"Actualizando":(el.classList.contains("on")?"En vivo":"Actualizado");}
let tEntrar=null;
function alEntrar(forzar){clearTimeout(tEntrar);tEntrar=setTimeout(()=>{const v=vistaActual();if(!v){pintarCtx();return;}ocultarCampos(v);refrescar(v,{forzar});},30);}

/* Las funciones de navegación de la app siguen siendo las mismas; solo se
   avisa a la capa dinámica después de que corren. */
function envolver(nombre,antes){
  let f;try{f=eval(nombre);}catch(e){return;}if(typeof f!=="function")return;
  const w=function(...a){if(antes)try{antes(...a);}catch(e){}const r=f.apply(this,a);alEntrar();return r;};
  try{eval(nombre+"=w");}catch(e){window[nombre]=w;}
}
/* Antes de la primera visita se escriben los valores del contexto en los
   campos, para que la carga inicial de la app ya salga con ellos. */
function preEscribir(tab){VISTAS.filter(v=>v.tab===tab).forEach(v=>{try{llenarArea(v);if(v.aplicar)v.aplicar.call(v);}catch(e){}});}

/* =====================================================================
   BARRA DE CONTEXTO
   ===================================================================== */
let ctx=null;
function crearCtx(){
  const main=document.querySelector(".ing-main");if(!main||ctx)return;
  ctx=document.createElement("div");ctx.className="dyn-ctx";ctx.setAttribute("role","toolbar");ctx.setAttribute("aria-label","Fecha y área");
  main.prepend(ctx);
  ctx.addEventListener("click",e=>{const b=e.target.closest("[data-dyn]");if(!b)return;const [k,val]=b.dataset.dyn.split(":");
    if(k==="dia"){G.fecha=val==="hoy"?hoy():mas(hoy(),-1);}
    else if(k==="rango"){G.rango=val;G.desde=G.hasta=null;}
    else if(k==="quin"){G.quin=val;}
    else if(k==="area"){G.area=val;}
    else if(k==="ref"){guardar();return refrescar(vistaActual(),{forzar:true});}
    guardar();refrescar(vistaActual());});
  ctx.addEventListener("change",e=>{const t=e.target;
    if(t.id==="dynFecha"&&t.value){G.fecha=t.value>hoy()?hoy():t.value;}
    else if(t.id==="dynDesde"||t.id==="dynHasta"){const d=$("dynDesde").value,h=$("dynHasta").value;if(!d||!h)return;G.rango="custom";G.desde=d<=h?d:h;G.hasta=d<=h?h:d;}
    else if(t.id==="dynArea"){G.area=t.value;}
    else return;
    guardar();refrescar(vistaActual());});
}
function pintarCtx(){
  if(!ctx)return;const v=vistaActual();
  const nav=document.querySelector(".nav-item.activo");const grp=nav&&nav.closest("details")&&nav.closest("details").querySelector("summary");
  const tit=v?v.t:(nav?(nav.firstChild&&nav.firstChild.nodeType===3?nav.firstChild.textContent:nav.textContent).trim():"");
  let fecha="";
  if(v&&v.modo==="dia"){const h=hoy(),ay=mas(h,-1);
    fecha=`<div class="dyn-seg" role="group" aria-label="Día"><button data-dyn="dia:hoy" class="${G.fecha===h?"on":""}">Hoy</button><button data-dyn="dia:ayer" class="${G.fecha===ay?"on":""}">Ayer</button></div>
      <label class="dyn-fecha"><span class="dyn-sr">Fecha</span><input type="date" id="dynFecha" value="${G.fecha}" max="${h}"></label><span class="dyn-dtxt">${txtFecha(G.fecha)}</span>`;}
  if(v&&v.modo==="rango"){const [d,h]=rangoDe(v),k=rangoKey(v);
    fecha=`<div class="dyn-seg dyn-rangos" role="group" aria-label="Rango">${Object.entries(RANGOS).map(([kk,r])=>`<button data-dyn="rango:${kk}" class="${k===kk?"on":""}">${r.t}</button>`).join("")}</div>
      <span class="dyn-rango"><input type="date" id="dynDesde" value="${d}" max="${hoy()}" aria-label="Desde"><span>a</span><input type="date" id="dynHasta" value="${h}" max="${hoy()}" aria-label="Hasta"></span>`;}
  if(v&&v.modo==="quin"){const q=quincenas(hoy());
    fecha=`<div class="dyn-seg" role="group" aria-label="Quincena"><button data-dyn="quin:act" class="${G.quin!=="ant"?"on":""}">Quincena actual</button><button data-dyn="quin:ant" class="${G.quin==="ant"?"on":""}">Anterior</button></div>
      <span class="dyn-dtxt">${txtFecha((G.quin==="ant"?q.ant:q.act)[0])} – ${txtFecha((G.quin==="ant"?q.ant:q.act)[1])}</span>`;}
  let areas="";
  if(v&&v.area){let L=[];try{L=AREAS_LISTA||[];}catch(e){}
    const s=selArea(v);if(v.soloSel&&s&&s.options.length>1)L=[...s.options].map(o=>o.value).filter(Boolean);
    const act=areaVista(v);
    const opc=(v.areaReq||!todasOk()?[]:[["","Todas"]]).concat(L.map(a=>[a,a.replace(" COSTURA","")]));
    areas=`<div class="dyn-areas" role="group" aria-label="Área">${opc.map(([k,t])=>`<button data-dyn="area:${escH(k)}" class="dyn-chip ${act===k?"on":""}" aria-pressed="${act===k}"><i data-a="${escH(k)}"></i>${escH(t)}</button>`).join("")}</div>
      <select id="dynArea" class="dyn-area-sel" aria-label="Área">${v.areaReq&&!act?'<option value="">Elige área…</option>':""}${opc.map(([k,t])=>`<option value="${escH(k)}" ${act===k?"selected":""}>${escH(t)}</option>`).join("")}</select>`;}
  const esHoy=v&&(v.modo==="dia"?G.fecha===hoy():v.modo==="rango"?rangoDe(v)[1]===hoy():true);
  const vivo=v&&v.live&&esHoy;
  const estado=v&&v.cargar?`<span class="dyn-live ${vivo?"on":""} ${cargando?"car":""}"><b>${cargando?"Actualizando":vivo?"En vivo":"Actualizado"}</b><span id="dynHace">${hace()}</span></span><button class="dyn-ref" data-dyn="ref" title="Actualizar ahora" aria-label="Actualizar ahora"></button>`:"";
  ctx.innerHTML=`<div class="dyn-crumb">${grp?escH(grp.textContent.trim())+" <i>›</i> ":""}<b>${escH(tit)}</b></div>${fecha}${areas}<span class="dyn-sp"></span>${estado}`;
  ctx.hidden=!(fecha||areas||estado);
  try{aplicarSoloLectura();}catch(e){}
}
function hace(){if(!ultimaCarga)return"";const s=Math.round((Date.now()-ultimaCarga)/1000);return s<60?`hace ${s} s`:`hace ${Math.round(s/60)} min`;}
setInterval(()=>{const e=$("dynHace");if(e)e.textContent=hace();},1000);

/* ---------- en vivo ---------- */
function puedeVivo(v){
  if(!v||!v.live||!v.cargar||cargando||document.hidden)return false;
  if(v.modo==="dia"&&G.fecha!==hoy())return false;
  if(v.modo==="rango"&&rangoDe(v)[1]!==hoy())return false;
  if(document.querySelector(".modal-overlay.visible,.aud-drawer.visible,.dyn-cmdk.on"))return false;
  const a=document.activeElement;if(a&&a.closest&&a.closest(".ing-main,.pantalla")&&/INPUT|SELECT|TEXTAREA/.test(a.tagName)&&a.type!=="checkbox")return false;
  if(v.ocupada&&v.ocupada())return false;
  return true;
}
function latido(){const v=vistaActual();if(puedeVivo(v))refrescar(v,{forzar:true,vivo:true});}
setInterval(latido,30000);
let tCambio=null;
window.addEventListener("datos-cambiaron",()=>{clearTimeout(tCambio);tCambio=setTimeout(()=>{latido();contadores();},700);});

/* ---------- campos propios de cada vista que ahora cargan solos ---------- */
let tAuto=null;
function alEscribir(e){const v=vistaActual();if(!v||!v.auto||!v.auto.includes(e.target.id))return;
  clearTimeout(tAuto);tAuto=setTimeout(()=>{if(!v.req||v.req())refrescar(v,{forzar:true});},e.type==="input"?650:50);}
document.addEventListener("input",alEscribir,true);document.addEventListener("change",alEscribir,true);

/* =====================================================================
   TABLAS ORDENABLES (todas)
   ===================================================================== */
const ORD={};             // clave de tabla -> {col,dir}
let ordenando=false;
function claveTabla(t){if(t.id)return t.id;const s=t.closest("[id]");const all=s?[...s.querySelectorAll("table")]:[];return (s?s.id:"x")+":"+all.indexOf(t);}
function filaCab(t){const th=t.tHead;if(!th||!th.rows.length)return null;return th.rows[th.rows.length-1];}
function colDe(th){let i=0;for(const c of th.parentNode.cells){if(c===th)return i;i+=c.colSpan||1;}return i;}
function celda(tr,col){let i=0;for(const c of tr.cells){if(i===col)return c;i+=c.colSpan||1;if(i>col)return null;}return null;}
function valor(td){if(!td)return {n:null,s:""};const inp=td.querySelector("input:not([type=checkbox]),select");let s=(inp?inp.value:td.textContent).trim();
  if(!s||s==="—"||s==="-")return {n:null,s:""};
  const f=s.match(/^(\d{4})-(\d{2})-(\d{2})/)||null;if(f)return {n:+(f[1]+f[2]+f[3]),s};
  const f2=s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);if(f2&&!/\d-\d/.test(s))return {n:+((f2[3]||"2026").padStart(4,"20")+f2[2].padStart(2,"0")+f2[1].padStart(2,"0")),s};
  const h=s.match(/^(\d{1,2}):(\d{2})$/);if(h)return {n:+h[1]*60+ +h[2],s};
  const n=s.replace(/[▲▼+\s]|min|und|%|S\/\.?/gi,"").replace(/,(?=\d{3}\b)/g,"").replace(",",".");
  if(/^-?\d+(\.\d+)?$/.test(n))return {n:parseFloat(n),s};
  const r=s.match(/^(\d+)\s*-\s*\d+$/);if(r)return {n:+r[1],s};
  return {n:null,s};}
function esTotal(tr){const t=(tr.cells[0]&&tr.cells[0].textContent||"").trim().toUpperCase();return /^TOTAL|^PROMEDIO/.test(t)||tr.classList.contains("total");}
function ordenar(t,col,dir){
  const tb=t.tBodies[0];if(!tb)return;
  if(tb.querySelector("td[rowspan]:not([rowspan='1'])"))return;
  const filas=[...tb.rows];const bloques=[];let grupo=[];const segs=[];
  filas.forEach(tr=>{
    if(tr.classList.contains("grupo-area")){if(grupo.length)segs.push(grupo);segs.push({g:tr});grupo=[];return;}
    const soloDet=tr.cells.length===1&&tr.cells[0].colSpan>1;
    if(soloDet&&grupo.length){grupo[grupo.length-1].det.push(tr);return;}
    grupo.push({tr,det:[]});});
  if(grupo.length)segs.push(grupo);
  const cmp=(a,b)=>{if(esTotal(a.tr)!==esTotal(b.tr))return esTotal(a.tr)?1:-1;const va=valor(celda(a.tr,col)),vb=valor(celda(b.tr,col));
    if(va.s===""&&vb.s!=="")return 1;if(vb.s===""&&va.s!=="")return -1;
    if(va.n!=null&&vb.n!=null)return (va.n-vb.n)*dir;return va.s.localeCompare(vb.s,"es",{numeric:true,sensitivity:"base"})*dir;};
  ordenando=true;const frag=document.createDocumentFragment();
  segs.forEach(s=>{if(s.g){frag.appendChild(s.g);return;}s.sort(cmp).forEach(x=>{frag.appendChild(x.tr);x.det.forEach(d=>frag.appendChild(d));});});
  tb.appendChild(frag);obs.takeRecords();ordenando=false;
}
function marcarCab(t,col,dir){const fc=filaCab(t);if(!fc)return;[...fc.cells].forEach(th=>{th.classList.remove("dyn-asc","dyn-desc");if(colDe(th)===col)th.classList.add(dir>0?"dyn-asc":"dyn-desc");th.setAttribute("aria-sort",colDe(th)===col?(dir>0?"ascending":"descending"):"none");});}
function prepararTabla(t){
  const fc=filaCab(t);if(!fc||fc.dataset.dyn)return;fc.dataset.dyn="1";
  if(fc.querySelector("th.ord,th[onclick]"))return;             // la app ya la ordena
  if(!t.tBodies[0]||t.tBodies[0].querySelector("td[rowspan]:not([rowspan='1'])"))return;
  const k=claveTabla(t);
  [...fc.cells].forEach(th=>{if(!th.textContent.trim()||th.querySelector("input"))return;th.classList.add("dyn-ord");th.tabIndex=0;
    const go=()=>{const col=colDe(th);const s=ORD[k];const dir=s&&s.col===col?-s.dir:1;ORD[k]={col,dir};ordenar(t,col,dir);marcarCab(t,col,dir);};
    th.addEventListener("click",go);th.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go();}});});
  const s=ORD[k];if(s){ordenar(t,s.col,s.dir);marcarCab(t,s.col,s.dir);}
}
/* Matrices: columnas de referencia fijas al desplazar a la derecha. Incentivos
   fija Personal, DNI, Área y Cat.; el resto, su primera columna. El `left` de
   cada una es la suma de los anchos de las anteriores; el ResizeObserver lo
   recalcula cuando la tabla cambia de ancho o pasa de oculta a visible. */
const FIJAS={tablaInc:4,tablaModular:1,tablaEfm:1,dbEfTabla:1};
const nFijas=t=>FIJAS[t.id]||(t.classList.contains("ope-tabla")?1:0);
const roFijas=window.ResizeObserver?new ResizeObserver(es=>es.forEach(e=>fijarColumnas(e.target))):null;
function fijarColumnas(t){
  const n=nFijas(t),fc=filaCab(t);if(!n||!fc||!t.offsetWidth)return;
  const lefts=[];let x=0;[...fc.cells].slice(0,n).forEach(c=>{lefts.push(x);x+=c.offsetWidth;});
  [...t.rows].forEach(tr=>{let col=0;[...tr.cells].forEach(c=>{const sp=c.colSpan||1,f=col<n&&sp===1&&lefts[col]!=null;
    c.classList.toggle("col-fija",f);c.classList.toggle("col-fija-ult",f&&col===n-1);c.style.left=f?lefts[col]+"px":"";col+=sp;});});
}
function vigilarFijas(t){if(!nFijas(t))return;if(roFijas&&!t.dataset.fijas){t.dataset.fijas="1";roFijas.observe(t);}fijarColumnas(t);}
let tObs=null;
const obs=new MutationObserver(()=>{if(ordenando)return;cancelAnimationFrame(tObs);tObs=requestAnimationFrame(()=>{
  document.querySelectorAll(".pantalla table").forEach(t=>{const fc=filaCab(t);vigilarFijas(t);
    if(fc&&!fc.dataset.dyn)prepararTabla(t);
    else if(fc&&t.tBodies[0]&&!t.tBodies[0].dataset.dyn){t.tBodies[0].dataset.dyn="1";const s=ORD[claveTabla(t)];if(s&&fc.querySelector(".dyn-ord")){ordenar(t,s.col,s.dir);marcarCab(t,s.col,s.dir);}}});
  const v=vistaActual();if(v)ocultarCampos(v);});});

/* =====================================================================
   BUSCADOR (Ctrl + K)
   ===================================================================== */
let cmdk=null,PERS=null,OFSL=null,sel=0,items=[];
function abrirCmdk(){
  if(!cmdk){cmdk=document.createElement("div");cmdk.className="dyn-cmdk";cmdk.innerHTML=`<div class="dyn-cmdk-box" role="dialog" aria-label="Buscar"><input id="dynCk" placeholder="Busca una pestaña, una persona o una OF…" autocomplete="off"><div class="dyn-ck-l" id="dynCkL"></div><div class="dyn-ck-pie"><span>↑↓ moverse</span><span>Enter abrir</span><span>Esc cerrar</span><span>? atajos</span></div></div>`;
    document.body.appendChild(cmdk);cmdk.addEventListener("click",e=>{if(e.target===cmdk)cerrarCmdk();const b=e.target.closest("[data-i]");if(b)ir(items[+b.dataset.i]);});
    $("dynCk").addEventListener("input",()=>{sel=0;listaCk();});
    $("dynCk").addEventListener("keydown",e=>{if(e.key==="ArrowDown"){sel=Math.min(items.length-1,sel+1);listaCk();e.preventDefault();}else if(e.key==="ArrowUp"){sel=Math.max(0,sel-1);listaCk();e.preventDefault();}else if(e.key==="Enter"&&items[sel])ir(items[sel]);else if(e.key==="Escape")cerrarCmdk();});}
  cmdk.classList.add("on");$("dynCk").value="";sel=0;listaCk();setTimeout(()=>$("dynCk").focus(),10);
  try{if(!PERS&&ING)rpc("fn_personal_listar",{p_dni:ING.dni,p_token:ING.token,p_area:""}).then(r=>{PERS=(r.items||r||[]).filter?(r.items||r):[];listaCk();}).catch(()=>{});}catch(e){}
  try{if(!OFSL&&ING)rpc("fn_ofs_listar",{p_dni:ING.dni,p_token:ING.token,p_buscar:""}).then(r=>{OFSL=Array.isArray(r)?r:[];listaCk();}).catch(()=>{});}catch(e){}
}
function cerrarCmdk(){if(cmdk)cmdk.classList.remove("on");}
const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
function listaCk(){
  const q=norm($("dynCk").value);const out=[];
  const tabs=[...document.querySelectorAll(".nav-item[data-tab]")].map(a=>({g:"Pestañas",t:a.textContent.trim(),k:a.closest("details")?a.closest("details").querySelector("summary").textContent.trim():"",go:()=>activarTab(a.dataset.tab)}));
  VISTAS.filter(v=>/·|Reclamados|Reporte|Resumen x/.test(v.t)).forEach(v=>tabs.push({g:"Pestañas",t:v.t,k:"",go:()=>irVista(v)}));
  tabs.filter(x=>!q||norm(x.t+" "+x.k).includes(q)).slice(0,q?8:12).forEach(x=>out.push(x));
  if(q&&PERS)PERS.filter(p=>norm((p.nombres||p.nombre)+" "+p.dni).includes(q)).slice(0,6).forEach(p=>out.push({g:"Personas",t:p.nombres||p.nombre,k:(p.area_actual||p.area||"")+" · "+p.dni,go:()=>{activarTab("pasoAsis");setTimeout(()=>{try{perTab("crud");}catch(e){}const b=$("perBuscar");if(b){b.value=p.dni;b.dispatchEvent(new Event("input",{bubbles:true}));}},250);}}));
  if(q&&OFSL)OFSL.filter(o=>norm(o.of+" "+o.articulo+" "+(o.cliente||"")).includes(q)).slice(0,6).forEach(o=>out.push({g:"OF",t:"OF "+o.of+" · "+o.articulo,k:(o.prenda||"")+" · "+(o.cant_prog||o.cantidad||"")+" und",go:()=>{activarTab("pasoAvOF");setTimeout(()=>{const b=$("avofBuscar");if(b){b.value=String(o.of);b.dispatchEvent(new Event("input",{bubbles:true}));}},400);}}));
  items=out;let g="";
  $("dynCkL").innerHTML=out.map((x,i)=>{const h=x.g!==g?`<div class="g">${x.g}</div>`:"";g=x.g;return h+`<button data-i="${i}" class="${i===sel?"on":""}"><span>${escH(x.t)}</span><span class="k">${escH(x.k)}</span></button>`;}).join("")||'<p class="dyn-ck-v">Nada coincide.</p>';
  const on=$("dynCkL").querySelector(".on");if(on)on.scrollIntoView({block:"nearest"});
}
function ir(x){cerrarCmdk();x.go();}
function irVista(v){activarTab(v.tab);setTimeout(()=>{const m={tkOp:()=>tkVista("op"),tkRep:()=>tkVista("rep"),tkOpe:()=>tkVista("ope"),tkActual:()=>tkVista("actual"),efR:()=>efVista("dia"),
  incMod:()=>incVista("mod"),incEfm:()=>incVista("efm"),incCons:()=>incVista("cons"),incTabla:()=>incVista("tabla"),dashEf:()=>dashTab("ef"),dashCant:()=>dashTab("cant"),dashMod:()=>dashTab("mod"),
  perRango:()=>perTab("rango"),perMat:()=>perTab("matriz"),perMov:()=>perTab("mov"),inciPend:()=>inciVista("pend"),inciHE:()=>inciVista("he"),inciApl:()=>inciVista("apl")}[v.id];if(m)m();},60);}
/* =====================================================================
   TECLADO · INGENIERÍA
   Ctrl+K buscador · Alt+1…9 secciones del menú · Shift+←/→ sub-pestañas ·
   / al primer filtro · Alt+R recargar · ? lista de atajos · Esc cierra.
   Enter en un filtro = su botón Cargar; Enter en un modal = Guardar.
   Clic fuera de un modal, del panel de Auditoría o del menú lo cierra.
   ===================================================================== */
const enCampo=el=>!!el&&(el.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
const visible=el=>!!el&&el.offsetParent!==null&&!el.disabled&&!el.hidden;
const FOCOS='a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const modalAbierto=()=>document.querySelector(".modal-overlay.visible");
const drawerAbierto=()=>document.querySelector(".aud-drawer.visible");
function cerrarCapa(){
  if(cmdk&&cmdk.classList.contains("on")){cerrarCmdk();return true;}
  if(modalAbierto()){try{cerrarModal();}catch(e){}return true;}
  if(drawerAbierto()){try{audCerrar();}catch(e){}return true;}
  if($("dynAtajos")&&$("dynAtajos").classList.contains("on")){$("dynAtajos").classList.remove("on");return true;}
  const sb=document.querySelector(".ing-sidebar");
  if(sb&&sb.contains(document.activeElement)){document.activeElement.blur();return true;}
  if(window.innerWidth<=900&&!document.body.classList.contains("sidebar-cerrada")){document.body.classList.add("sidebar-cerrada");return true;}
  return false;
}
/* Botón principal de un contenedor: Guardar/Cargar, no Cancelar ni Descargar. */
function botonPrincipal(c){
  /* Los Cargar que oculta la barra de contexto (dyn-oculto) siguen valiendo: son la misma carga. */
  const bs=[...c.querySelectorAll("button")].filter(b=>(visible(b)||b.classList.contains("dyn-oculto"))&&!b.disabled&&!/cancel|cerrar|descargar|xlsx|limpiar|borrar|eliminar/i.test(b.textContent+" "+b.className));
  return bs.find(b=>/guardar|btn-principal/i.test(b.className))||bs.find(b=>/cargar|buscar|aplicar|guardar|confirmar|aceptar/i.test(b.textContent))||null;
}
function moverSubtab(d){
  const p=document.querySelector(".pantalla.activa");if(!p)return;
  const ts=[...p.querySelectorAll(".tabs .tab")].filter(visible);if(ts.length<2)return;
  const i=ts.findIndex(t=>t.classList.contains("activo"));const n=ts[(Math.max(i,0)+d+ts.length)%ts.length];
  n.click();n.focus({preventScroll:true});
}
function abrirAtajos(){
  let a=$("dynAtajos");
  if(!a){a=document.createElement("div");a.id="dynAtajos";a.className="dyn-cmdk";
    const f=(k,t)=>`<div class="dyn-at-f"><span>${t}</span><span>${k.map(x=>`<kbd>${x}</kbd>`).join(" ")}</span></div>`;
    a.innerHTML=`<div class="dyn-cmdk-box dyn-atajos" role="dialog" aria-label="Atajos de teclado"><h3>Atajos de teclado</h3>`
      +f(["Ctrl","K"],"Buscar pestaña, persona u OF")+f(["Alt","1…9"],"Ir a la sección 1 a 9 del menú")
      +f(["Shift","←"],"Sub-pestaña anterior")+f(["Shift","→"],"Sub-pestaña siguiente")
      +f(["/"],"Ir al primer filtro de la vista")+f(["Alt","R"],"Recargar la vista")
      +f(["Enter"],"En un filtro: Cargar · En un formulario: Guardar")+f(["Tab"],"Pasar al siguiente campo")
      +f(["Esc"],"Cerrar ventana, panel o menú")+f(["?"],"Ver esta lista")+`</div>`;
    document.body.appendChild(a);a.addEventListener("click",e=>{if(e.target===a)a.classList.remove("on");});}
  a.classList.add("on");
}
if(PAG==="ingenieria"){
  document.addEventListener("keydown",e=>{
    const k=e.key,el=document.activeElement,campo=enCampo(el);
    if((e.ctrlKey||e.metaKey)&&k.toLowerCase()==="k"){e.preventDefault();abrirCmdk();return;}
    if(k==="Escape"){if(cerrarCapa())e.preventDefault();return;}
    /* Tab no se escapa de un modal o del panel abierto hacia la página de atrás. */
    if(k==="Tab"){const cap=modalAbierto()?$("modalBox"):drawerAbierto();if(!cap)return;
      const fs=[...cap.querySelectorAll(FOCOS)].filter(visible);if(!fs.length)return;
      const i=fs.indexOf(el);
      if(i<0){e.preventDefault();fs[0].focus();}
      else if(e.shiftKey&&i===0){e.preventDefault();fs[fs.length-1].focus();}
      else if(!e.shiftKey&&i===fs.length-1){e.preventDefault();fs[0].focus();}
      return;}
    if(k==="Enter"&&campo&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&el.tagName!=="TEXTAREA"){
      if(el.onkeydown||el.closest(".dyn-cmdk,.autocomplete,.tabla,.tabla-asis-mes"))return;
      const c=el.closest(".modal-box,.barra-control,.fila-filtros,.aud-drawer");if(!c)return;
      const b=botonPrincipal(c);if(b){e.preventDefault();b.click();}return;}
    if(campo||e.ctrlKey||e.metaKey||modalAbierto()||(cmdk&&cmdk.classList.contains("on")))return;
    if(e.altKey&&/^[1-9]$/.test(k)){const its=[...document.querySelectorAll(".nav-item[data-tab]")];const it=its[+k-1];
      if(it){e.preventDefault();activarTab(it.dataset.tab);}return;}
    if(e.altKey&&k.toLowerCase()==="r"){const b=document.querySelector('.dyn-ctx [data-dyn^="ref"]')||$("btnRecargar");if(b){e.preventDefault();b.click();}return;}
    if(e.shiftKey&&(k==="ArrowLeft"||k==="ArrowRight")){e.preventDefault();moverSubtab(k==="ArrowLeft"?-1:1);return;}
    if(k==="/"){const p=document.querySelector(".pantalla.activa");const f=p&&[...p.querySelectorAll("input:not([type=checkbox]):not([type=hidden]),select")].find(visible);
      if(f){e.preventDefault();f.focus();if(f.select)try{f.select();}catch(x){}}return;}
    if(k==="?"){e.preventDefault();abrirAtajos();}
  });
  /* Clic fuera: el fondo del modal lo cierra (antes solo CANCELAR); un clic en
     el contenido suelta el foco del menú, que si no se quedaba desplegado. */
  document.addEventListener("click",e=>{
    const o=modalAbierto();if(o&&e.target===o){try{cerrarModal();}catch(x){}return;}
    const sb=document.querySelector(".ing-sidebar");
    if(sb&&sb.contains(document.activeElement)&&!sb.contains(e.target))document.activeElement.blur();
    const it=e.target.closest(".nav-item[data-tab]");if(it&&e.detail>0)it.blur();
  });
  /* Al abrir un modal, el cursor va directo al primer campo. */
  const mo=$("modalOverlay");
  if(mo)new MutationObserver(()=>{if(!mo.classList.contains("visible"))return;
    setTimeout(()=>{const f=[...$("modalBox").querySelectorAll("input:not([type=hidden]):not([type=checkbox]),select,textarea")].find(visible)||[...$("modalBox").querySelectorAll(FOCOS)].find(visible);if(f)f.focus();},30);
  }).observe(mo,{attributes:true,attributeFilter:["class"]});
}else document.addEventListener("keydown",e=>{if(e.key==="Escape")cerrarCmdk();});

/* ---------- contadores del menú ---------- */
let tCont=0;
function contadores(){
  if(PAG!=="ingenieria"||Date.now()-tCont<8000)return;tCont=Date.now();
  try{rpc("fn_solicitudes_listar",{p_dni:ING.dni,p_token:ING.token,p_area:""}).then(r=>{
    const n=(r.items||[]).filter(x=>!x.estado||x.estado==="PENDIENTE").length;
    const it=document.querySelector('.nav-item[data-tab="pasoIncid"]');if(!it)return;let b=it.querySelector(".dyn-cnt");
    if(!b){b=document.createElement("b");b.className="dyn-cnt";it.appendChild(b);}b.textContent=n;b.hidden=!n;b.title=n+" pendiente(s) por resolver";}).catch(()=>{});}catch(e){}
}

/* =====================================================================
   ARRANQUE · INGENIERÍA
   ===================================================================== */
const GRUPOS={pasoTk:"Tickets",pasoMod:"Tickets",pasoGen:"Tickets",pasoOfs:"Tickets",pasoAvOF:"Tickets",pasoVista:"Tickets",
  pasoEf:"Eficiencia",pasoAudit:"Eficiencia",pasoInc:"Eficiencia",pasoDash:"Dashboards",pasoCarga:"Planificación",
  pasoAsis:"Gestión",pasoBases:"Gestión",pasoBaseLog:"Gestión",pasoCalBase:"Gestión",pasoIncid:"Gestión",pasoFechas:"Gestión",pasoPermisos:"Gestión",
  pasoCostosBase:"Costos",pasoCostosHoy:"Costos",pasoCostosInc:"Costos",pasoCostosAsis:"Costos",
  pasoSupArea:"Operar como",pasoOpArea:"Operar como"};
function etiquetarGrupos(){
  document.querySelectorAll(".pantalla").forEach(p=>{const g=GRUPOS[p.id];const c=p.querySelector(".seccion-cab");
    if(g&&c)c.dataset.grupo=g;});
}
function iniciarIng(){
  /* parche 95: al abrir la pestaña del navegador, quien maneja áreas arranca en la suya. */
  try{const nuevo=!sessionStorage.getItem("stx-dyn"),mias=areasEdita().filter(a=>AREAS_LISTA.includes(a));
    if(!PERM_LIBRE()&&((nuevo&&!G.area)||(G.area?!AREAS_LISTA.includes(G.area):!todasOk()))){G.area=mias[0]||AREAS_LISTA[0]||"";guardar();}}catch(e){}
  crearCtx();
  etiquetarGrupos();
  const hdr=document.querySelector("header");
  if(hdr&&!$("dynBuscar")){const b=document.createElement("button");b.type="button";b.id="dynBuscar";b.className="btn-hdr-icon dyn-buscar";
    b.innerHTML='<span class="dyn-buscar-t">Buscar pestaña, persona u OF</span><kbd>Ctrl K</kbd>';b.setAttribute("aria-label","Buscar");b.onclick=abrirCmdk;
    const q=$("quienBadge");q?q.before(b):hdr.appendChild(b);}
  /* Pestañas cuya primera visita ya carga sola (con los valores ya escritos):
     se da por cargada para no pedir lo mismo dos veces a la base. */
  const INIT_CARGA=["pasoTk","pasoAudit","pasoAsis","pasoIncid","pasoDash","pasoOfs","pasoInc","pasoBaseLog",
    "pasoCostosBase","pasoCostosHoy","pasoCostosInc","pasoCostosAsis"];
  envolver("activarTab",t=>{if(typeof t==="string"&&!TABS_VISTAS.has(t)){preEscribir(t);
    if(INIT_CARGA.includes(t))setTimeout(()=>{const v=vistaActual();if(v&&v.tab===t&&v.cargar){const c=v.aplicar?v.aplicar.call(v):false;if(!c){v.clave=claveDe(v);ultimaCarga=Date.now();}}},0);}});
  ["tkVista","perTab","dashTab","inciVista","incVista","efVista"].forEach(n=>envolver(n));
  obs.observe(document.querySelector(".ing-main")||document.body,{childList:true,subtree:true});
  { const v=vistaActual(); if(v&&v.cargar){ const c=v.aplicar?v.aplicar.call(v):false; if(!c){ v.clave=claveDe(v); ultimaCarga=Date.now(); } } }
  alEntrar();contadores();
}
/* ingenieria.js arranca después de validar la sesión: se espera a que exista ING. */
function esperarIng(n){let ok=false;try{ok=!!ING&&typeof activarTab==="function"&&document.querySelector(".pantalla.activa");}catch(e){}
  if(ok)return iniciarIng();if(n<200)setTimeout(()=>esperarIng(n+1),50);}

/* =====================================================================
   SUPERVISORA Y OPERARIO
   Mismo criterio: lo que depende del día se refresca solo, las fechas
   cargan al cambiarlas y las tablas se ordenan.
   ===================================================================== */
function iniciarOtras(){
  obs.observe(document.querySelector("main")||document.body,{childList:true,subtree:true});
  if(PAG==="supervisora"){
    const vivos=[["pasoAvance","cargarAvance"],["pasoIncidencias","cargarIncidencias"],["pasoEfPersonal","cargarEfPersonal"],["pasoSupRec","cargarSupRec",true]];
    const f=$("fechaEfPer");if(f)f.addEventListener("change",()=>llamar("cargarEfPersonal"));
    document.querySelectorAll('#pasoEfPersonal button[onclick^="cargarEfPersonal"]').forEach(b=>b.classList.add("dyn-oculto"));
    const pulso=()=>{if(document.hidden||document.querySelector(".modal-overlay.visible"))return;
      const act=document.querySelector(".pantalla.activa");if(!act)return;const x=vivos.find(v=>v[0]===act.id);
      if(x&&!(x[0]==="pasoEfPersonal"&&$("fechaEfPer")&&$("fechaEfPer").value!==hoy())){const y=window.scrollY;Promise.resolve(llamar(x[1],...x.slice(2))).then(()=>window.scrollTo(0,y));}};
    setInterval(pulso,30000);let t=null;window.addEventListener("datos-cambiaron",()=>{clearTimeout(t);t=setTimeout(pulso,700);});
  }
  if(PAG==="operario"){
    /* El avance del día en el encabezado se mantiene al día sin tocar nada. */
    const pulso=()=>{if(document.hidden||document.querySelector(".modal-overlay.visible"))return;try{llamar("recargarMiEficiencia");}catch(e){}};
    setInterval(pulso,60000);
  }
}

if(PAG==="ingenieria")esperarIng(0);
else if(PAG==="supervisora"||PAG==="operario")setTimeout(iniciarOtras,300);
})();
