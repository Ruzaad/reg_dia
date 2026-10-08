/* ================= SUPERVISORA EN EL CELULAR =================
   "Hoy" es la primera pantalla: lo que le toca según la hora, en tarjetas.
   Abajo hay 4 botones fijos (Hoy · Personal · Avance · Más) en vez de las 8
   pestañas que se desplazaban de lado. Las demás pantallas son las de
   siempre; solo cambia cómo se llega a ellas.
   Horas extra: la supervisora las registra directo (parche 112), solo hoy o
   ayer y hasta 4 h por persona. Ingeniería, operando como supervisora, las
   registra con fn_ocurrencia como en Incidencias. */

const SH={datos:null, cargado:0, cargando:null};
const SH_MESES=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const SH_DIAS_L=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const shIcono={
  cal:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>',
  mano:'<svg viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 6 17l-2-3.5a1.5 1.5 0 0 1 2.6-1.5L8 14"/></svg>',
  reloj:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  hoja:'<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  vuelta:'<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  ok:'<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>'
};

const shHoyIso = () => aswHoy();
function shAyerIso(){ const f=asyFecha(shHoyIso()); f.setDate(f.getDate()-1); return asyIso(f); }   // calendario: el domingo también se trabaja horas extra
function shHoraLima(){ const a=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Lima"})); return a.getHours()+a.getMinutes()/60; }
const shTarde = () => shHoraLima() >= 14;
function shFechaLarga(iso){ const f=asyFecha(iso); return `${SH_DIAS_L[f.getDay()]} ${f.getDate()}`; }
function shFaltaParche(e){ return /fn_sup_he|404|PGRST202|Could not find/i.test(String(e&&e.message||e)); }
function shNombres(lista){
  const n=lista.map(x=>{ const ap=soloApellidos(x.nombre||x).split(" ")[0]; return ap.charAt(0)+ap.slice(1).toLowerCase(); });
  return n.length<=3 ? n.join(", ").replace(/, ([^,]*)$/," y $1") : `${n.slice(0,3).join(", ")} y ${n.length-3} más`;
}

/* ---------- Navegación de abajo ---------- */
const SH_NAV_DE={pasoHoy:"hoy",pasoAsistencia:"hoy",pasoHE:"hoy",pasoIncidencias:"hoy",
  pasoPersonal:"personal",pasoAlcance:"personal",pasoSeleccion:"personal",pasoTipo:"personal",pasoMinutos:"personal",pasoMoverSel:"personal",pasoMoverArea:"personal",
  pasoAvance:"avance"};
function shMarcarNav(paso){
  const sec=SH_NAV_DE[paso]||"mas";
  document.querySelectorAll(".sh-nav button").forEach(b=>{
    const on=b.dataset.ir===sec; b.classList.toggle("sel",on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
}
function shIr(sec){
  pararAvance();
  if(sec==="hoy"){ irA("pasoHoy"); shCargar(); }
  else if(sec==="personal") $("tabPersonal").click();
  else if(sec==="avance") $("tabAvance").click();
  else irA("pasoMas");
  window.scrollTo(0,0);
}
/* Abre una pantalla de las de siempre usando su pestaña (que ya sabe cargarla). */
function shAbrir(tab){ const t=$(tab); if(t) t.click(); window.scrollTo(0,0); }

function shInit(){
  document.body.classList.add("sh-on");
  const prev=window.onCambioPaso;
  window.onCambioPaso=id=>{ if(prev) prev(id); shMarcarNav(id); if(id==="pasoHoy" && SH.datos) shPintar(); };
  Object.assign(window.VOLVER_MAP||(window.VOLVER_MAP={}),{
    pasoMas:"pasoHoy", pasoAsistencia:"pasoHoy", pasoHE:"pasoHoy", pasoIncidencias:"pasoHoy",
    pasoPersonal:"pasoHoy", pasoAvance:"pasoHoy",
    pasoSupBases:"pasoMas", pasoBuscar:"pasoMas", pasoEfPersonal:"pasoMas", pasoSupRec:"pasoMas", pasoBoletasSup:"pasoMas", pasoSueltosSup:"pasoMas"});
  const s=sesionActual()||{};
  const mp=$("shMasPin"); if(mp) mp.onclick=abrirCambioPin;
  const ms=$("shMasSalir"); if(ms) ms.onclick=cerrarSesion;
  $("shMasSub").textContent=areaSup();
  irA("pasoHoy"); shCargar(true);
}

/* ---------- Hoy ---------- */
async function shCargar(forzar){
  const s=sesionActual(); if(!s) return;
  if(!forzar && SH.datos && Date.now()-SH.cargado<60000){ shPintar(); return; }
  if(SH.cargando) return SH.cargando;
  if(!SH.datos) $("shCuerpo").innerHTML=cargandoHTML("Revisando lo de hoy…");
  const tarde=shTarde(), hoy=shHoyIso(), ayer=asyAyerIso(), heDia=tarde?hoy:shAyerIso(), area=areaSup();
  const b={p_dni:s.dni,p_token:s.token};
  const pr=(fn,args)=>rpc(fn,{...b,...args}).then(r=>({r}),e=>({e}));
  SH.cargando=Promise.all([
    pr("fn_asistencia_marcar_lista",{p_area:area,p_fecha:ayer}),
    pr("fn_asistencia_marcar_lista",{p_area:area,p_fecha:hoy}),
    pr("fn_solicitudes_listar",{p_area:area}),
    pr("fn_retornos_pendientes",{p_area:area}),
    pr("fn_sup_he_lista",{p_area:area,p_fecha:heDia}),
    tarde ? cargarBoletasSup(true).then(()=>({r:BOLSUP}),e=>({e})) : Promise.resolve({r:null})
  ]).then(([asAyer,asHoy,ped,ret,he,bol])=>{
    SH.datos={tarde,hoy,ayer,heDia,asAyer,asHoy,ped,ret,he,bol};
    SH.cargado=Date.now();
  }).finally(()=>{ SH.cargando=null; });
  await SH.cargando;
  shPintar();
}

function shTarjetas(){
  const D=SH.datos, ahora=[], listo=[];
  const ok=x=>x&&x.r&&x.r.ok!==false;
  // Asistencia de ayer: quien no registró tickets ni tiene estado.
  if(ok(D.asAyer)){
    const L=D.asAyer.r.personal||[], sinTk=ASY_SIN_TICKETS.includes(normKey(areaSup())) || (L.length && !L.some(p=>Number(p.tickets)>0));
    const pend=L.filter(asyPorConf);
    if(sinTk && pend.length) ahora.push({ic:"cal",t:`Confirma quién vino ${asyTxt(D.ayer)}`,s:`${pend.length} personas sin marcar. Si vinieron todos, es un toque.`,go:"shIrAsis('ayer')"});
    else if(pend.length) ahora.push({ic:"cal",t:`Confirma ${pend.length} persona${pend.length===1?"":"s"} de ayer`,s:`No registraron tickets ni tienen estado: ${shNombres(pend)}.`,go:"shIrAsis('ayer')"});
    else if(L.length) listo.push({ic:"ok",t:`Asistencia de ${asyTxt(D.ayer)}`,s:"Completa: todos tienen tickets o estado.",go:"shIrAsis('ayer')"});
  }
  // Asistencia de hoy: en la mañana, si todavía no se guardó nada.
  if(ok(D.asHoy)){
    const L=D.asHoy.r.personal||[], marcados=L.filter(p=>p.estado_guardado).length;
    if(!D.tarde && !marcados && L.length) ahora.push({ic:"cal",t:"Marca quién faltó hoy",s:`${L.length} personas. Toca solo a quien no vino; los demás quedan presentes.`,go:"shIrAsis('hoy')"});
    else if(marcados) listo.push({ic:"ok",t:"Asistencia de hoy",s:`${marcados} marca${marcados===1?"":"s"} guardada${marcados===1?"":"s"}.`,go:"shIrAsis('hoy')"});
  }
  // Pedidos del personal.
  if(ok(D.ped)){
    const it=D.ped.r.items||[];
    if(it.length) ahora.push({ic:"mano",t:`Revisa ${it.length} pedido${it.length===1?"":"s"} del personal`,s:shPedidoSub(it),go:"shAbrir('tabIncidencias')"});
  }
  // Regresos de permiso o seguro.
  const ret=D.ret&&Array.isArray(D.ret.r)?D.ret.r:[];
  if(ret.length) ahora.push({ic:"vuelta",t:`Confirma ${ret.length} regreso${ret.length===1?"":"s"}`,s:`Salieron con permiso o seguro: ${shNombres(ret)}. Mientras no se confirme se les descuenta hasta el cierre.`,go:"shAbrir('tabIncidencias')"});
  // Horas extra.
  {
    const he=D.he, items=ok(he)?(he.r.items||[]):[], con=items.filter(p=>Number(p.he_min)>0);
    const dia=D.tarde?"hoy":shFechaLarga(D.heDia);
    if(con.length) listo.push({ic:"ok",t:`Horas extra de ${D.tarde?"hoy":dia}`,s:`${con.length} persona${con.length===1?"":"s"} registrada${con.length===1?"":"s"}.`,go:`shIrHE('${D.tarde?"hoy":"ayer"}')`});
    else if(D.tarde) ahora.push({ic:"reloj",t:"¿Quién se queda hoy?",s:"Registra las horas extra antes de salir; entran al instante en su eficiencia.",go:"shIrHE('hoy')"});
    else ahora.push({ic:"reloj",t:"¿Alguien se quedó ayer?",s:`No hay horas extra registradas para el ${dia}. Si hubo, regístralas aquí.`,go:"shIrHE('ayer')"});
  }
  // Boletas de hoy (al cierre).
  if(D.tarde && D.bol && D.bol.r){
    const p=D.bol.r.personas||[];
    if(p.length) ahora.push({ic:"hoja",rojo:true,t:`${p.length} persona${p.length===1?"":"s"} sin tickets hoy`,s:`Avísales antes de que salgan: ${shNombres(p)}.`,go:"shAbrir('tabBoletas')"});
    else listo.push({ic:"ok",t:"Boletas de hoy",s:"Todos registraron tickets.",go:"shAbrir('tabBoletas')"});
  }
  return {ahora,listo};
}
function shPedidoSub(it){
  const t=it.map(x=>Date.parse(`${x.fecha}T${(x.hora||"00:00").slice(0,5)}:00-05:00`)).filter(n=>!isNaN(n));
  if(!t.length) return "Ajustes de tiempo que pidió el personal.";
  const h=Math.round((Date.now()-Math.min(...t))/3600000);
  return h<1 ? "El más antiguo llegó hace menos de una hora." : `El más antiguo espera hace ${h} h.`;
}
function shPintar(){
  if(!SH.datos) return;
  const s=sesionActual()||{}, h=shHoraLima();
  const saludo=h<12?"Buenos días":h<19?"Buenas tardes":"Buenas noches";
  const nom=String(s.nombre||"").split(",").pop().trim().split(" ")[0]||"";
  const f=asyFecha(SH.datos.hoy), hora=new Date().toLocaleTimeString("es-PE",{timeZone:"America/Lima",hour:"numeric",minute:"2-digit"});
  $("shSaludo").textContent=`${saludo}${nom?", "+nom.charAt(0)+nom.slice(1).toLowerCase():""}`;
  $("shFecha").textContent=`${SH_DIAS_L[f.getDay()].replace(/^./,c=>c.toUpperCase())} ${f.getDate()} de ${["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][f.getMonth()]} · ${hora}`;
  const {ahora,listo}=shTarjetas();
  const card=(c,i,hecho)=>`<button type="button" class="sh-card${hecho?" hecho":""}${!hecho&&i===0?" prim":""}${c.rojo?" rojo":""}" onclick="${c.go}">
      <span class="sh-ic ${c.ic}" aria-hidden="true">${shIcono[c.ic]}</span>
      <span class="sh-tx"><b>${esc(c.t)}</b><span>${esc(c.s)}</span></span>
      ${hecho?"":'<span class="sh-fl" aria-hidden="true">›</span>'}</button>`;
  $("shCuerpo").innerHTML=
    `<div class="sh-h">${SH.datos.tarde?"Al cierre":"Ahora"}</div>`
    +(ahora.length?ahora.map((c,i)=>card(c,i)).join(""):`<div class="sh-vacio">${shIcono.ok}<span>No tienes nada pendiente. 👏</span></div>`)
    +(listo.length?`<div class="sh-h">Ya está</div>`+listo.map(c=>card(c,0,true)).join(""):"");
  const nb=$("shNavHoyN"); if(nb){ nb.textContent=ahora.length||""; nb.hidden=!ahora.length; }
}
function shIrAsis(modo){
  pararAvance(); marcarTab("tabAsistencia"); irA("pasoAsistencia"); window.scrollTo(0,0);
  asisEntrar(false, modo);
}

function shIrBuscar(){ pararAvance(); irA("pasoBuscar"); window.scrollTo(0,0); buscarInit(); }
function shIrSueltos(){ pararAvance(); irA("pasoSueltosSup"); window.scrollTo(0,0); psCargarSup(); }

/* ---------- Horas extra ---------- */
const SHE={dia:"hoy", h:2, items:[], marc:new Set(), ultima:null, guardando:false, falta:false};
function shIrHE(dia){
  pararAvance(); irA("pasoHE"); window.scrollTo(0,0);
  SHE.dia=dia||"hoy"; SHE.marc.clear(); $("sheBuscar").value="";
  sheCargar();
}
function sheFecha(){ return SHE.dia==="hoy"?shHoyIso():shAyerIso(); }
async function sheCargar(){
  const s=sesionActual(); if(!s) return;
  $("sheSegHoy").innerHTML=`Hoy<small>${esc(asyTxt(shHoyIso()))}</small>`;
  $("sheSegAyer").innerHTML=`Ayer<small>${esc(asyTxt(shAyerIso()))}</small>`;
  ["Hoy","Ayer"].forEach(k=>{ const b=$("sheSeg"+k), on=SHE.dia===k.toLowerCase(); b.classList.toggle("sel",on); b.setAttribute("aria-selected",on); });
  $("sheSub").textContent=areaSup();
  const L=$("sheLista"); L.innerHTML=cargandoHTML("Cargando personal…");
  SHE.items=[]; SHE.ultima=null; SHE.falta=false;
  try{
    const r=await rpc("fn_sup_he_lista",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),p_fecha:sheFecha()});
    if(!r||r.ok===false){ mostrarError((r&&r.error)||"No se pudo cargar"); }
    else { SHE.items=r.items||[]; SHE.ultima=r.ultima||null; }
  }catch(e){
    if(shFaltaParche(e)) SHE.falta=true; else mostrarError(e.message);
  }
  shePintar();
}
const sheHtxt = h => (Math.round(h*10)/10).toString().replace(".",",")+" h";
function sheCabe(p){ return !p.ausente && (Number(p.he_min)||0)+SHE.h*60 <= 240; }
function shePintar(){
  $("sheHoras").textContent=sheHtxt(SHE.h);
  $("sheHorasSub").textContent=`por persona · ${Math.round(SHE.h*60)} min`;
  $("sheMenos").disabled=SHE.h<=0.5; $("sheMas").disabled=SHE.h>=4;
  const L=$("sheLista"), M=$("sheMismos");
  if(SHE.falta){
    M.hidden=true;
    L.innerHTML=`<div class="acf-falta"><b>Falta correr el parche 112 en la base</b> para que la supervisora registre horas extra. Mientras tanto se registran en Ingeniería › Incidencias › Horas extra.</div>`;
    sheResumen(); return;
  }
  const ult=SHE.ultima, ultP=ult?SHE.items.filter(p=>(ult.dnis||[]).includes(p.dni)):[];
  M.hidden=!ultP.length;
  if(ultP.length){
    const f=asyFecha(ult.fecha);
    M.innerHTML=`<span class="sh-ic vuelta" aria-hidden="true">${shIcono.vuelta}</span><span class="sh-tx"><b>Los mismos de la última vez</b>
      <span>${esc(SH_DIAS_L[f.getDay()].replace(/^./,c=>c.toUpperCase()))} ${f.getDate()}-${SH_MESES[f.getMonth()]} · ${esc(shNombres(ultP))}</span></span>`;
  }
  const q=normKey($("sheBuscar").value);
  const lista=SHE.items.filter(p=>!q||normKey(p.nombre+" "+p.dni).includes(q));
  if(!lista.length){ L.innerHTML=`<div class="vacio-msg">${SHE.items.length?"Nadie coincide con la búsqueda":"Sin personal en el área"}</div>`; sheResumen(); return; }
  L.innerHTML=lista.map(p=>{
    const m=SHE.marc.has(p.dni), cabe=sheCabe(p), ya=(Number(p.he_min)||0)/60;
    const ap=String(p.nombre||"").split(","), sub=[];
    if(ap[1]) sub.push(esc(ap[1].trim()));
    if(p.ausente) sub.push(`<em>${esc(p.estado)}: no se registra</em>`);
    else {
      sub.push(`${SHE.dia} ${Number(p.tickets)||0} tickets`);
      if(ya>0) sub.push(cabe?`ya tiene ${sheHtxt(ya)}`:`<em>ya tiene ${sheHtxt(ya)}; el tope es 4 h</em>`);
    }
    return `<button type="button" class="she-p${m?" sel":""}" role="checkbox" aria-checked="${m}" ${cabe?"":"disabled"} onclick="sheToggle('${esc(p.dni)}')">
      <span class="she-ck" aria-hidden="true">${m?shIcono.ok:""}</span>
      <span class="sh-tx"><b>${esc(ap[0].trim())}</b><span>${sub.join(" · ")}</span></span></button>`;
  }).join("");
  sheResumen();
}
function sheResumen(){
  const n=SHE.items.filter(p=>SHE.marc.has(p.dni)&&sheCabe(p)).length;
  const b=$("sheGuardar");
  b.disabled=!n||SHE.guardando||SHE.falta;
  b.textContent=SHE.guardando?"Registrando…":n?`Registrar ${sheHtxt(SHE.h)} a ${n} persona${n===1?"":"s"}`:"Marca a quién se quedó";
}
function sheToggle(dni){ SHE.marc.has(dni)?SHE.marc.delete(dni):SHE.marc.add(dni); shePintar(); }
function sheHorasMas(d){ SHE.h=Math.min(4,Math.max(0.5,SHE.h+d)); shePintar(); }
function sheDia(d){ if(SHE.dia===d) return; SHE.dia=d; SHE.marc.clear(); sheCargar(); }
function sheMismos(){
  const u=SHE.ultima; if(!u) return;
  (u.dnis||[]).forEach(d=>{ const p=SHE.items.find(x=>x.dni===d); if(p&&sheCabe(p)) SHE.marc.add(d); });
  if(u.minutos){ const h=Math.min(4,Math.max(0.5,Math.round(u.minutos/30)/2)); SHE.h=h; }
  shePintar();
}
async function sheRegistrar(){
  if(SHE.guardando) return;
  const s=sesionActual(); if(!s) return;
  const sel=SHE.items.filter(p=>SHE.marc.has(p.dni)&&sheCabe(p)).map(p=>p.dni);
  if(!sel.length) return;
  SHE.guardando=true; sheResumen();
  const min=Math.round(SHE.h*60), fecha=sheFecha();
  try{
    const r = s.cargo==="SUPERVISORA"
      ? await rpc("fn_sup_horas_extra",{p_dni:s.dni,p_token:s.token,p_fecha:fecha,p_minutos:min,p_dnis:sel})
      : await rpc("fn_ocurrencia",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),p_tipo:"HORA_EXTRA",p_minutos:min,p_detalle:"Horas extra (vista de supervisora)",p_dnis:sel,p_fecha:fecha});
    if(!r||!r.ok){ mostrarError((r&&r.error)||"No se pudo registrar"); }
    else {
      const om=r.omitidos||[];
      mostrarOk(`Horas extra registradas a ${r.afectados} persona${r.afectados===1?"":"s"}`+(om.length?` · sin registrar: ${om.join(", ")}`:""));
      SHE.marc.clear(); SH.cargado=0;
    }
  }catch(e){ mostrarError(shFaltaParche(e)?"Falta correr el parche 112 en la base":e.message); }
  finally{ SHE.guardando=false; }
  await sheCargar();
}
