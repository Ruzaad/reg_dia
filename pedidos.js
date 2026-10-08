/* ================= PEDIDOS DE TIEMPO EN EL CELULAR (parche 114) =================
   Supervisora: POR REVISAR (visto bueno o devolver; lo chico lo aprueba ella),
   EN INGENIERÍA (en qué va cada pedido) y LISTAS (lo resuelto en 3 días). Una
   sola llamada: fn_solicitudes_panel. Operario: Mis pedidos de tiempo, con el
   motivo del rechazo (fn_solicitudes_mias). Sin el parche, todo como antes. */

const PED={v2:null, items:[], vista:"rev", dev:null};
const pedFalta = e => /Could not find the function|PGRST202/i.test(String(e&&e.message||e||""));
const pedDM = f => { const p=String(f||"").slice(0,10).split("-"); return p.length===3?`${p[2]}/${p[1]}`:""; };
const pedHM = f => String(f||"").slice(11,16);
const pedTipo = t => ({MAQUINA:"MÁQUINA PARADA"})[String(t||"").toUpperCase()] || String(t||"").replace(/_/g," ");
const pedQue = x => {
  if(x.area_trabajo) return esc(x.motivo||("TRABAJÉ EN "+x.area_trabajo));
  const ex=[];
  if(x.area_causa) ex.push("de "+x.area_causa);
  if(x.o_f) ex.push("OF "+x.o_f);
  return `${esc(pedTipo(x.tipo))} · ${esc(x.motivo||"")}${ex.length?` · ${esc(ex.join(" · "))}`:""}`;
};
/* Tira Pidió › Supervisora › Ingeniería. */
const pedPasos = (a,b,c) => `<div class="cel-pasos" aria-hidden="true"><span class="${a}">Pidió</span><span class="${b}">Supervisora</span>${c===null?"":`<span class="${c}">Ingeniería</span>`}</div>`;
function pedAlertasSup(x){
  const r=[];
  if(x.rep) r.push(x.rep.estado==="APROBADO" ? "Ya tiene lo mismo aprobado ese día" : `Repetido: igual al de las ${x.rep.hora}`);
  if(x.igual) r.push("Ya existe una incidencia igual ese día");
  if(x.reg!=null){ const tot=Number(x.reg)+Number(x.inc)+Number(x.pide), disp=575+Number(x.he||0);
    if(tot>disp) r.push(`Con esto pasa el turno por ${Math.round(tot-disp)} min`); }
  return r;
}

/* ---------------- SUPERVISORA ---------------- */
async function pedCargarSup(){
  const s=sesionActual(), z=$("listaIncidencias"); if(!s||!z) return false;
  pintarCargando(z,"Cargando pedidos…");
  let r;
  try{ r=await rpc("fn_solicitudes_panel",{p_dni:s.dni,p_token:s.token,p_area:areaSup(),p_dias:3}); }
  catch(e){ if(pedFalta(e)){ PED.v2=false; return false; } z.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; return true; }
  if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"Error")}</div>`; return true; }
  PED.v2=true; PED.items=r.items||[]; PED.ing=r.cargo==="INGENIERIA";
  $("pedTabsSup").hidden=false; $("pedResSup").hidden=false; $("pedPieSup").hidden=false;
  { const t=$("pedSubSup"); if(t) t.textContent=`${areaSup()} · lo que pidió tu personal`; }
  pedPintarSup();
  cargarRetornos();
  return true;
}
const pedRev = x => x.estado==="PENDIENTE" && !x.visto_bueno && !x.solo_ing;
const pedIng = x => x.estado==="PENDIENTE" && (x.visto_bueno || x.solo_ing);
function pedVistaSup(v){ PED.vista=v; PED.dev=null; pedPintarSup(); }
function pedPintarSup(){
  const z=$("listaIncidencias"); if(!z) return;
  const rev=PED.items.filter(pedRev), ing=PED.items.filter(pedIng), ok=PED.items.filter(x=>x.estado!=="PENDIENTE");
  const v=PED.vista;
  [...$("pedTabsSup").children].forEach((b,i)=>b.setAttribute("aria-pressed",["rev","ing","ok"][i]===v?"true":"false"));
  $("pedNRev").textContent=rev.length?"· "+rev.length:""; $("pedNIng").textContent=ing.length?"· "+ing.length:"";
  const rojas=rev.filter(x=>pedAlertasSup(x).length).length;
  $("pedResSup").innerHTML=`${rojas?`<div class="r"><b>${rojas}</b>con alerta</div>`:""}<div><b>${rev.length}</b>sin revisar</div><div><b>${ing.length}</b>esperan a Ingeniería</div>`;
  const lista = v==="rev"?rev : v==="ing"?ing : ok;
  if(!lista.length){
    z.innerHTML=`<div class="vacio-msg">${v==="rev"?"Nada por revisar":v==="ing"?"Nada esperando a Ingeniería":"Nada resuelto en los últimos 3 días"}</div>`; return; }
  z.innerHTML = lista.map(x => v==="rev" ? pedCardRev(x) : pedCardEstado(x, true)).join("");
}
function pedCardRev(x){
  const al=pedAlertasSup(x), nom=soloApellidos(x.nombre||"");
  const directa = x.aprueba;           // lo chico (o ingeniería con Aprueba)
  const dev = PED.dev===x.id;
  return `<div class="cel-card ${al.length?"r":""}">
    <div class="cel-top"><b>${esc(nom)}</b><span class="m">${x.minutos} min</span></div>
    <div class="cel-l t">${pedQue(x)}</div>
    <div class="cel-l">Pidió ${esc(pedDM(x.pidio))} ${esc(pedHM(x.pidio))}${x.reg!=null?` · registró ${x.reg} min ese día`:""}</div>
    ${al.length||x.area_trabajo?`<div class="cel-tags">${x.area_trabajo?`<span class="tag p">Trabajo en ${esc(x.area_trabajo)}</span>`:""}${al.map(t=>`<span class="tag r">${esc(t)}</span>`).join("")}</div>`:""}
    ${dev ? `<div class="cel-dev"><label class="op-lbl" for="pedDev${x.id}">¿Por qué ${directa?"la rechazas":"la devuelves"}? Lo ve ${esc(nom.split(" ")[0])}</label>
        <input id="pedDev${x.id}" maxlength="160" placeholder="Ej: ya está registrada">
        <div class="cel-btns"><button type="button" class="no" onclick="pedDevolver(${x.id})">${directa?"RECHAZAR":"DEVOLVER"}</button>
        <button type="button" class="az" onclick="PED.dev=null;pedPintarSup()">CANCELAR</button></div></div>`
      : `<div class="cel-btns">${directa
        ? `<button type="button" class="ok" onclick="pedAprobarSup(${x.id})">APROBAR</button>`
        : PED.ing ? `<button type="button" class="az" disabled>LA APRUEBA QUIEN TIENE PERMISO</button>`
        : `<button type="button" class="az" onclick="pedVistoBueno(${x.id})">VISTO BUENO</button>`}
        <button type="button" class="no" onclick="PED.dev=${x.id};pedPintarSup();setTimeout(()=>{const i=$('pedDev${x.id}');if(i)i.focus();},50)">${directa?"RECHAZAR":"DEVOLVER"}</button></div>`}
  </div>`;
}
/* Tarjeta de estado (supervisora: EN INGENIERÍA / LISTAS; operario: mis pedidos). */
function pedCardEstado(x, sup){
  const nom = sup ? soloApellidos(x.nombre||"") : `${pedDM(x.fecha)} · ${x.minutos} min`;
  const quien = soloApellidos(x.resuelto_por||"");
  const supApr = x.estado==="APROBADO" && (x.chica && !x.visto_bueno) && !x.solo_ing;
  let cls, der, txt, pasos;
  if(x.estado==="PENDIENTE"){
    cls="o"; der= sup ? `${x.minutos} min` : "Esperando";
    if(x.visto_bueno || x.solo_ing){
      txt = (sup?"Esperando a Ingeniería":"Tu supervisora ya le dio visto bueno. Falta Ingeniería")
        + (x.visto_bueno_en&&sup?` desde el ${pedDM(x.visto_bueno_en)} ${pedHM(x.visto_bueno_en)}`:"") + ".";
      pasos=pedPasos("ok","ok","now");
    } else {
      txt = "Tu supervisora todavía no lo revisa.";
      pasos=pedPasos("ok","now", x.chica?null:"");
    }
    if(sup){ const al=pedAlertasSup(x); if(al.length) txt+=` <b style="color:var(--alerta)">${esc(al[0])}</b>`; }
  } else if(x.estado==="APROBADO"){
    cls="v"; der= sup ? `${x.minutos_final||x.minutos} min` : "Aprobada";
    txt=`Aprobada por ${esc(quien||"Ingeniería")} el ${pedDM(x.resuelto_en)}${sup?"":". Ya cuenta en tu día"}.`
      + (x.minutos_final && x.minutos_final!==x.minutos ? ` Quedó en ${x.minutos_final} min.` : "");
    pasos = supApr ? pedPasos("ok","ok",null) : pedPasos("ok","ok","ok");
  } else if(x.estado==="ANULADO"){
    cls="g"; der= sup ? `${x.minutos} min` : "Anulada";
    txt=`<b>Anulada</b>: ${esc(x.motivo_rechazo||"se borró la incidencia")}. Ya no cuenta.`;
    pasos=pedPasos("ok","ok","no");
  } else {   // RECHAZADO o DEVUELTO
    const dev = x.estado==="DEVUELTO";
    cls="r"; der= sup ? `${x.minutos} min` : (dev?"Devuelta":"Rechazada");
    txt=`${dev?"Devuelta":"Rechazada"} por ${esc(quien||"")}${x.motivo_rechazo?`: «${esc(x.motivo_rechazo)}»`:""}.`
      + (sup?"":dev?" Si corresponde, pídela otra vez corregida.":" No tienes que hacer nada.");
    pasos = dev || x.resuelto_sup ? pedPasos("ok","no",null) : pedPasos("ok","ok","no");
  }
  return `<div class="cel-card ${cls}"><div class="cel-top"><b>${esc(nom)}</b><span class="m">${esc(der)}</span></div>
    <div class="cel-l t">${pedQue(x)}</div>${pasos}
    <div class="cel-l" style="margin-top:6px">${txt}</div></div>`;
}
async function pedVistoBueno(id){
  const s=sesionActual();
  return unaVez("ped"+id, botonesDe(`#listaIncidencias button`), async ()=>{
    try{
      const r=await rpc("fn_solicitud_visto_bueno",{p_dni:s.dni,p_token:s.token,p_id:id,p_ok:true,p_motivo:null});
      if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
      mostrarOk("Visto bueno · pasa a Ingeniería"); await pedCargarSup();
    }catch(e){ mostrarError(e.message); }
  });
}
async function pedAprobarSup(id){
  const s=sesionActual(), x=PED.items.find(y=>y.id===id); if(!x) return;
  const al=pedAlertasSup(x);
  if(al.length && !confirm(`${soloApellidos(x.nombre)}: ${al.join(". ")}.\n\n¿Aprobar igual?`)) return;
  return unaVez("ped"+id, botonesDe(`#listaIncidencias button`), async ()=>{
    try{
      const r=await rpc("fn_solicitud_resolver",{p_dni:s.dni,p_token:s.token,p_id:id,p_aprobar:true,p_minutos_final:null});
      if(!r.ok){ mostrarError(r.error||"No se pudo"); await pedCargarSup(); return; }
      mostrarOk(`Aprobado · ${x.minutos} min`); await pedCargarSup();
    }catch(e){ mostrarError(e.message); }
  });
}
async function pedDevolver(id){
  const s=sesionActual(), x=PED.items.find(y=>y.id===id); if(!x) return;
  const m=(($("pedDev"+id)||{}).value||"").trim();
  if(!m){ mostrarError("Escribe el motivo: el operario lo ve"); return; }
  return unaVez("ped"+id, botonesDe(`#listaIncidencias button`), async ()=>{
    try{
      const r = x.aprueba
        ? await rpc("fn_solicitud_resolver",{p_dni:s.dni,p_token:s.token,p_id:id,p_aprobar:false,p_minutos_final:null,p_motivo:m})
        : await rpc("fn_solicitud_visto_bueno",{p_dni:s.dni,p_token:s.token,p_id:id,p_ok:false,p_motivo:m});
      if(!r.ok){ mostrarError(r.error||"No se pudo"); return; }
      PED.dev=null; mostrarOk(x.aprueba?"Rechazado":"Devuelto al operario"); await pedCargarSup();
    }catch(e){ mostrarError(e.message); }
  });
}

/* ---------------- OPERARIO ---------------- */
async function abrirMisPedidos(){
  const s=sesionActual(), z=$("pedCuerpo"); if(!s||!z) return;
  irA("pasoPedidos"); window.scrollTo(0,0);
  pintarCargando(z,"Cargando tus pedidos…");
  try{
    const r=await rpc("fn_solicitudes_mias",{p_dni:s.dni,p_token:s.token});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    if(typeof SA_MIAS!=="undefined") SA_MIAS=r.items||[];
    z.innerHTML = (r.items||[]).length
      ? r.items.map(x=>pedCardEstado(x,false)).join("")
      : `<div class="vacio-msg">No pediste descuentos de tiempo estos días</div>`;
  }catch(e){
    z.innerHTML = pedFalta(e)
      ? `<div class="vacio-msg">Pronto vas a poder ver aquí en qué va cada pedido.</div>`
      : `<div class="vacio-msg">${esc(e.message)}</div>`;
  }
}
