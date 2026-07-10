/* ============================================================
   SAMITEX — Tickets Virtuales · app.js (compartido)
   Páginas: index.html (login+área) · operario.html · supervisora.html
   ============================================================ */

/* ---------------- CONFIGURACIÓN (editar aquí) ---------------- */
const SUPABASE_URL  = "https://lmlwomurgbbzolgbkwtp.supabase.co";      // https://xxxx.supabase.co
const SUPABASE_ANON = "sb_publishable_UL22rxFy12xjwf4R9ReRNQ_igpA1hwJ";          // Settings → API → anon public

const MAPA_ESTANDAR = {                          // cabecera normalizada -> campo
  "PRENDA":"prenda","ARTICULO":"articulo","MODULO":"modulo","OP":"op",
  "STD":"std","OF":"of","TALLA":"talla","COLOR":"color","NCORTE":"corte",
  "CANT":"cant","CODIGO":"codigo","NOP":"nop","NUMERACION":"num"
};

const AREAS = {
  "CAMISA COSTURA": {
    habilitada: true,
    sheetId: "1fuqMApXsZg-0PW4ugqtnye6zysVtoSAS_o4hhN1WDlo",
    hoja: "ALMACEN",
    mapa: MAPA_ESTANDAR
  },
  "ACABADO": {
    habilitada: false,               // PENDIENTE: compartir libro como lector + confirmar cabeceras
    sheetId: "1R2FqLRZpFjdA7rzUk6dsTyj898yUYO0aKU_OYG4e0Xc",
    hoja: "ALMACEN",
    mapa: MAPA_ESTANDAR              // ajustar cuando se vean sus columnas reales
  },
  "PANTALON COSTURA": { habilitada:false },
  "SACO COSTURA":     { habilitada:false }
};
const SESION_HORAS = 4;

/* ---------------- UTILIDADES ---------------- */
const $ = id => document.getElementById(id);
const normKey = s => String(s==null?"":s).trim().toUpperCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[.°º"']/g,"").replace(/\s+/g,"");
const norm = s => String(s==null?"":s).trim();
const COLORES = {NEGRO:"#212529",ROSADO:"#e8a0b4",BLANCO:"#fafafa",AZUL:"#0D3B85",
  CELESTE:"#a8d0e6","CELESTECLARO":"#c9e4f5",CREMA:"#f5e9d0",MARFIL:"#f2ead9",
  "PLATACLARO":"#d9dde1",PLOMO:"#8d949c",GRIS:"#adb5bd",LILA:"#c8a2c8",
  VINO:"#722f37",VERDE:"#4a7c59"};
const colorDe = c => COLORES[normKey(c)] || "#ccc";
const esc = s => String(s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));

function irA(id){
  document.querySelectorAll(".pantalla").forEach(p=>p.classList.remove("activa"));
  const el = $(id); if(el) el.classList.add("activa");
  ocultarError();
}
function mostrarError(msg){ const b=$("bannerError"); if(b){b.textContent=msg;b.classList.add("visible");} }
function ocultarError(){ const b=$("bannerError"); if(b) b.classList.remove("visible"); }
function cargandoHTML(txt){ return `<div class="cargando"><div class="spinner"></div>${esc(txt)}</div>`; }

/* ---------------- SESIÓN (localStorage, 4h) ---------------- */
function guardarSesion(s){ s.exp = Date.now() + SESION_HORAS*3600*1000; localStorage.setItem("stx_sesion", JSON.stringify(s)); }
function sesionActual(){
  try{
    const s = JSON.parse(localStorage.getItem("stx_sesion")||"null");
    if(!s || Date.now() > s.exp){ localStorage.removeItem("stx_sesion"); return null; }
    return s;
  }catch(e){ return null; }
}
function cerrarSesion(){ localStorage.removeItem("stx_sesion"); location.href = "index.html"; }

/* ---------------- SUPABASE (RPC) ---------------- */
async function rpc(fn, args){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json",
      "apikey":SUPABASE_ANON, "Authorization":"Bearer "+SUPABASE_ANON },
    body: JSON.stringify(args)
  });
  if(!r.ok){
    const t = await r.text();
    if(t.includes("SESION_INVALIDA")) { cerrarSesion(); throw new Error("Sesión vencida"); }
    if(t.includes("NO_AUTORIZADA")) throw new Error("No autorizada para esta acción");
    throw new Error("Error de servidor ("+r.status+")");
  }
  return await r.json();
}

/* ---------------- LECTOR DE ALMACÉN (Google Sheets CSV) ---------------- */
function parseCSV(texto){
  const filas=[]; let fila=[], campo="", dentro=false;
  for(let i=0;i<texto.length;i++){
    const c=texto[i];
    if(dentro){
      if(c==='"'){ if(texto[i+1]==='"'){campo+='"';i++;} else dentro=false; }
      else campo+=c;
    } else {
      if(c==='"') dentro=true;
      else if(c===','){ fila.push(campo); campo=""; }
      else if(c==='\n'){ fila.push(campo); filas.push(fila); fila=[]; campo=""; }
      else if(c!=='\r') campo+=c;
    }
  }
  if(campo!=="" || fila.length){ fila.push(campo); filas.push(fila); }
  return filas;
}

async function cargarAlmacen(nombreArea){
  const cfg = AREAS[nombreArea];
  if(!cfg || !cfg.habilitada) throw new Error("Área no habilitada todavía");
  const url = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.hoja)}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("No se pudo leer el almacén (¿libro compartido como lector?)");
  const filas = parseCSV(await r.text());
  if(filas.length < 2) throw new Error("El almacén está vacío");

  const idx = {};
  filas[0].forEach((h,i)=>{ const k = normKey(h); if(cfg.mapa[k]) idx[cfg.mapa[k]] = i; });
  if(idx.codigo===undefined || idx.op===undefined || idx.of===undefined)
    throw new Error("El almacén no tiene las columnas esperadas (CÓDIGO/OP/O.F)");

  const tickets=[]; const vistos={}; const duplicados=[];
  for(let i=1;i<filas.length;i++){
    const f = filas[i];
    const codigo = norm(f[idx.codigo]);
    if(!codigo) continue;
    if(vistos[codigo]){ duplicados.push(codigo); continue; }
    vistos[codigo]=true;
    const std  = parseFloat(f[idx.std])  || 0;
    const cant = parseFloat(f[idx.cant]) || 0;
    tickets.push({
      codigo, std, cant,
      of:      norm(f[idx.of]),
      modulo:  norm(f[idx.modulo]),
      op:      norm(f[idx.op]),
      talla:   norm(f[idx.talla]),
      color:   norm(f[idx.color]),
      corte:   norm(f[idx.corte]),
      num:     norm(f[idx.num]),
      articulo:norm(f[idx.articulo]),
      minutos: Math.round(std*cant*10)/10
    });
  }
  return { tickets, duplicados };
}

/* ============================================================
   PÁGINA: LOGIN + ÁREA (index.html)
   ============================================================ */
function initLogin(){
  const s = sesionActual();
  if(s && s.area){ location.href = s.cargo==="SUPERVISORA" ? "supervisora.html" : "operario.html"; return; }

  let dni="", pin="", foco="dni";
  const pintar = ()=>{
    $("dispDni").textContent = dni.padEnd(8,"•");
    $("dispPin").textContent = "•".repeat(pin.length).padEnd(4,"·");
    $("dispDni").style.borderColor = foco==="dni" ? "var(--enlace)" : "var(--azul)";
    $("dispPin").style.borderColor = foco==="pin" ? "var(--enlace)" : "var(--azul)";
  };
  $("dispDni").onclick = ()=>{ foco="dni"; pintar(); };
  $("dispPin").onclick = ()=>{ foco="pin"; pintar(); };

  const teclas=[1,2,3,4,5,6,7,8,9,"BORRAR",0,"ENTRAR"];
  teclas.forEach(k=>{
    const b=document.createElement("button");
    b.className="tecla"+(k==="BORRAR"?" borrar":k==="ENTRAR"?" accion":"");
    b.textContent=k;
    b.onclick=()=>{
      if(k==="BORRAR"){ if(foco==="dni") dni=dni.slice(0,-1); else pin=pin.slice(0,-1); }
      else if(k==="ENTRAR"){ intentarLogin(); return; }
      else {
        if(foco==="dni"){ if(dni.length<8) dni+=String(k); if(dni.length===8) foco="pin"; }
        else if(pin.length<4) pin+=String(k);
      }
      pintar();
    };
    $("tecladoLogin").appendChild(b);
  });
  pintar();

  async function intentarLogin(){
    $("msgLogin").textContent="";
    if(dni.length!==8){ $("msgLogin").textContent="El DNI debe tener 8 dígitos"; return; }
    if(pin.length!==4){ $("msgLogin").textContent="La clave debe tener 4 dígitos"; return; }
    $("msgLogin").textContent="Verificando…";
    try{
      const r = await rpc("fn_login", {p_dni:dni, p_pin:pin});
      if(!r.ok){ $("msgLogin").textContent=r.error; pin=""; pintar(); return; }
      guardarSesion({dni:r.dni, nombre:r.nombre, cargo:r.cargo, token:r.token, area:null});
      $("nombreSaludo").textContent = "Hola, " + r.nombre.split(" ")[0];
      pintarAreas(r.cargo);
      irA("pasoArea");
    }catch(e){ $("msgLogin").textContent = e.message; }
  }

  function pintarAreas(cargo){
    const g=$("gridAreas"); g.innerHTML="";
    Object.keys(AREAS).forEach(a=>{
      const cfg=AREAS[a];
      const c=document.createElement("div");
      c.className="card-area"+(cfg.habilitada?"":" off");
      c.innerHTML=`<div class="ca-nombre">${esc(a)}</div>
        <div class="ca-sub">${cfg.habilitada?"Disponible":"Próximamente"}</div>`;
      if(cfg.habilitada){
        c.onclick=()=>{
          const s=sesionActual(); s.area=a; guardarSesion(s);
          location.href = cargo==="SUPERVISORA" ? "supervisora.html" : "operario.html";
        };
      }
      g.appendChild(c);
    });
  }
}

/* ============================================================
   PÁGINA: OPERARIO (operario.html)
   OF → módulos → operaciones → tickets → confirmación → éxito
   ============================================================ */
let ALM=null, RECL={}, sel={of:null,modulo:null,op:null,ticket:null};

function initOperario(){
  const s = sesionActual();
  if(!s || !s.area){ location.href="index.html"; return; }
  $("tituloArea").textContent = s.area;
  $("quienBadge").textContent = s.nombre; $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  cargarTodo(s);
  $("inputOF").addEventListener("input", pintarSugerencias);
}

async function cargarTodo(s){
  irA("pasoCarga");
  $("zonaCarga").innerHTML = cargandoHTML("Cargando almacén de "+s.area+"…");
  try{
    const [alm, recl, dia] = await Promise.all([
      cargarAlmacen(s.area),
      rpc("fn_reclamados", {p_dni:s.dni, p_token:s.token, p_area:s.area}),
      rpc("fn_mi_dia", {p_dni:s.dni, p_token:s.token})
    ]);
    ALM = alm;
    RECL = {}; recl.forEach(x=>{ RECL[x.codigo]={nombre:x.nombre,hora:x.hora}; });
    setAvance(dia);
    if(alm.duplicados.length) console.warn("Códigos duplicados en almacén:", alm.duplicados);
    irA("pasoOF");
  }catch(e){
    $("zonaCarga").innerHTML = `<div class="vacio-msg">${esc(e.message)}</div>`;
    mostrarError("No se pudo cargar. Revisa la conexión y vuelve a intentar.");
  }
}
function setAvance(d){
  const b=$("badgeAvance");
  b.textContent = `Hoy: ${d.eficiencia}% · ${d.minutos_prod} de ${d.minutos_disp} min`;
  b.classList.add("visible");
}
const libre = t => !RECL[t.codigo];

/* --- paso OF: buscador con sugerencias --- */
function pintarSugerencias(){
  const q = $("inputOF").value.replace(/\D/g,"");
  $("inputOF").value = q;
  const z = $("sugerenciasOF"); z.innerHTML="";
  if(!q){ return; }
  const ofs = {};
  ALM.tickets.forEach(t=>{
    if(t.of.includes(q)){
      if(!ofs[t.of]) ofs[t.of]={total:0,libres:0};
      ofs[t.of].total++; if(libre(t)) ofs[t.of].libres++;
    }
  });
  Object.keys(ofs).sort().slice(0,8).forEach(of=>{
    const d=document.createElement("div");
    d.className="sug";
    d.innerHTML=`<span>OF ${esc(of)}</span><small>${ofs[of].libres} de ${ofs[of].total} libres</small>`;
    d.onclick=()=>{ sel.of=of; pintarModulos(); irA("pasoModulos"); };
    z.appendChild(d);
  });
  if(!Object.keys(ofs).length) z.innerHTML=`<div class="vacio-msg">Ninguna OF contiene "${esc(q)}"</div>`;
}

/* --- paso módulos --- */
function pintarModulos(){
  $("tituloModulos").textContent = "OF " + sel.of;
  const l=$("listaModulos"); l.innerHTML="";
  const mods={};
  ALM.tickets.forEach(t=>{
    if(t.of!==sel.of) return;
    if(!mods[t.modulo]) mods[t.modulo]={total:0,libres:0};
    mods[t.modulo].total++; if(libre(t)) mods[t.modulo].libres++;
  });
  Object.keys(mods).sort().forEach(m=>{
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div class="cf-titulo">${esc(m)}</div>
      <div class="badge-disp ${mods[m].libres===0?'vacio':''}">${mods[m].libres} de ${mods[m].total} libres</div>`;
    c.onclick=()=>{ sel.modulo=m; pintarOperaciones(); irA("pasoOps"); };
    l.appendChild(c);
  });
}

/* --- paso operaciones (con STD visible) --- */
function pintarOperaciones(){
  $("tituloOps").textContent = sel.modulo + " · OF " + sel.of;
  const l=$("listaOps"); l.innerHTML="";
  const ops={};
  ALM.tickets.forEach(t=>{
    if(t.of!==sel.of || t.modulo!==sel.modulo) return;
    if(!ops[t.op]) ops[t.op]={std:t.std,total:0,libres:0};
    ops[t.op].total++; if(libre(t)) ops[t.op].libres++;
  });
  Object.keys(ops).sort().forEach(op=>{
    const o=ops[op];
    const c=document.createElement("div");
    c.className="card-fila";
    c.innerHTML=`<div>
        <div class="cf-titulo">${esc(op)}</div>
        <div class="cf-detalle">STD <b>${o.std.toFixed(2)}</b> min</div>
      </div>
      <div class="badge-disp ${o.libres===0?'vacio':''}">${o.libres} de ${o.total} libres</div>`;
    c.onclick=()=>{ sel.op=op; pintarTickets(); irA("pasoTickets"); };
    l.appendChild(c);
  });
}

/* --- paso tickets (numeración protagonista) --- */
function pintarTickets(){
  $("tituloTickets").textContent = sel.op;
  const l=$("listaTickets"); l.innerHTML="";
  ALM.tickets
    .filter(t=>t.of===sel.of && t.modulo===sel.modulo && t.op===sel.op)
    .forEach(t=>{
      const r = RECL[t.codigo];
      const c=document.createElement("div");
      c.className="card-ticket"+(r?" tomado":"");
      c.innerHTML=`
        <div class="tk-min">${t.minutos} min</div>
        <div class="tk-label">Numeración</div>
        <div class="tk-numeracion">${esc(t.num)}</div>
        <div class="tk-fila">
          <div><span class="chip-color" style="background:${colorDe(t.color)}"></span>${esc(t.color)}</div>
          <div>Talla <b>${esc(t.talla)}</b></div>
          <div><b>${t.cant}</b> und</div>
          <div>Corte <b>${esc(t.corte)}</b></div>
        </div>
        ${r?`<div class="tk-tomado-por">Tomado por ${esc(r.nombre)} · ${esc(r.hora)}</div>`:""}`;
      if(!r){
        c.onclick=()=>{
          sel.ticket=t;
          $("confNum").textContent=t.num;
          $("confDet").innerHTML=
            `${esc(sel.op)}<br>OF ${esc(t.of)} · ${esc(t.color)} · Talla ${esc(t.talla)} · <b>${t.cant} und</b><br>`+
            `<span style="color:#5a6270">STD ${t.std.toFixed(2)} min · vale <b>${t.minutos} min</b></span>`;
          $("btnRegistrar").disabled=false;
          irA("pasoConf");
        };
      }
      l.appendChild(c);
    });
}

/* --- reclamar --- */
async function registrar(){
  const s=sesionActual(); if(!s){ location.href="index.html"; return; }
  const t=sel.ticket, btn=$("btnRegistrar");
  btn.disabled=true; btn.textContent="REGISTRANDO…";
  try{
    const r = await rpc("fn_reclamar", {p_dni:s.dni,p_token:s.token,p_area:s.area,
      p_codigo:t.codigo,p_of:t.of,p_modulo:t.modulo,p_op:t.op,p_std:t.std,p_cant:t.cant,
      p_numeracion:t.num,p_articulo:t.articulo,p_color:t.color,p_talla:t.talla,p_corte:t.corte});
    btn.textContent="SÍ, REGISTRAR";
    if(!r.ok){
      mostrarError(r.error||"No se pudo registrar");
      if(r.conflicto){ await refrescarReclamos(s); pintarTickets(); irA("pasoTickets"); }
      btn.disabled=false; return;
    }
    RECL[t.codigo]={nombre:s.nombre,hora:"ahora"};
    setAvance(r);
    $("exTitulo").textContent="¡Listo, "+s.nombre.split(" ")[0]+"!";
    $("exDetalle").innerHTML=`${esc(sel.op)}<br>Numeración <b>${esc(t.num)}</b> · ${t.cant} und · +${t.minutos} min`;
    $("exAvance").textContent=`Tu día: ${r.eficiencia}%`;
    mostrarExito();
  }catch(e){
    btn.textContent="SÍ, REGISTRAR"; btn.disabled=false;
    mostrarError(e.message==="Sesión vencida"?e.message:"Sin conexión, no se registró. Intenta de nuevo.");
  }
}
async function refrescarReclamos(s){
  try{
    const recl = await rpc("fn_reclamados",{p_dni:s.dni,p_token:s.token,p_area:s.area});
    RECL={}; recl.forEach(x=>{RECL[x.codigo]={nombre:x.nombre,hora:x.hora};});
  }catch(e){}
}
let timerReset=null;
function mostrarExito(){
  const ex=$("exito"); ex.classList.add("visible");
  let seg=4; $("exTimer").textContent="Volviendo en "+seg+"…";
  clearInterval(timerReset);
  timerReset=setInterval(()=>{
    seg--;
    if(seg<=0){ clearInterval(timerReset); ex.classList.remove("visible");
      pintarTickets(); irA("pasoTickets"); }
    else $("exTimer").textContent="Volviendo en "+seg+"…";
  },1000);
}

/* ============================================================
   PÁGINA: SUPERVISORA (supervisora.html)
   ============================================================ */
let PERSONAL=[], oc={tipo:null,minutos:0,dnis:[]};

function initSupervisora(){
  const s=sesionActual();
  if(!s || !s.area){ location.href="index.html"; return; }
  if(s.cargo!=="SUPERVISORA"){ location.href="operario.html"; return; }
  $("tituloArea").textContent = s.area + " · Supervisión";
  $("quienBadge").textContent = s.nombre; $("quienBadge").classList.add("visible");
  $("btnSalir").onclick = cerrarSesion;
  $("filtroNombre").addEventListener("input", pintarPersonal);
  cargarPersonal(s);
}
async function cargarPersonal(s){
  $("gridPersonal").innerHTML = cargandoHTML("Cargando personal…");
  try{
    PERSONAL = await rpc("fn_personal",{p_dni:s.dni,p_token:s.token,p_area:s.area});
    pintarPersonal();
  }catch(e){
    $("gridPersonal").innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`;
  }
}
function pintarPersonal(){
  const q = normKey($("filtroNombre").value);
  const g = oc.multiple ? $("gridPersonalSel") : $("gridPersonal");
  g.innerHTML="";
  const lista = (q.length>=3)
    ? PERSONAL.filter(p=>normKey(p.nombre).includes(q))
    : PERSONAL;
  if(!lista.length){ g.innerHTML=`<div class="vacio-msg">Sin coincidencias</div>`; return; }
  lista.forEach(p=>{
    const c=document.createElement("div");
    c.className="card-persona"+(oc.dnis.includes(p.dni)?" marcada":"");
    c.innerHTML=`<div>
        <div class="cp-nombre">${esc(p.nombre)}</div>
        <div class="cp-dni">DNI ${esc(p.dni)}</div>
      </div>
      <div class="cp-disp">${p.disp} min</div>`;
    c.onclick=()=>{
      if(oc.multiple){
        const i=oc.dnis.indexOf(p.dni);
        if(i>=0) oc.dnis.splice(i,1); else oc.dnis.push(p.dni);
        pintarPersonal();
        $("btnContinuarSel").disabled = oc.dnis.length===0;
      } else {
        oc.dnis=[p.dni];
        $("nombreAfectado").textContent = p.nombre;
        irA("pasoTipo");
      }
    };
    g.appendChild(c);
  });
}

/* --- selección de tipo --- */
function elegirTipo(tipo){
  oc.tipo=tipo; oc.minutos=0;
  if(tipo==="HORA_EXTRA"){
    oc.horas=1;
    $("tituloMin").textContent="Horas extra";
    $("subMin").textContent="Cada hora suma 60 minutos disponibles";
    $("zonaStepper").style.display="flex"; $("zonaMinutos").style.display="none";
    $("valorStepper").textContent="1 h";
  } else {
    $("tituloMin").textContent = tipo==="MAQUINA" ? "Minutos de máquina parada" : "Minutos (Otros)";
    $("subMin").textContent = tipo==="MAQUINA"
      ? "Se restan de los minutos disponibles del día"
      : "Elige si suma o resta minutos disponibles";
    $("zonaStepper").style.display="none"; $("zonaMinutos").style.display="block";
    $("inputMinutos").value="";
    $("segSigno").style.display = tipo==="OTROS" ? "flex" : "none";
    oc.signo = tipo==="MAQUINA" ? -1 : -1;
    if(tipo==="OTROS") marcarSigno(-1);
  }
  irA("pasoMinutos");
}
function stepper(d){
  oc.horas=Math.max(1, Math.min(6,(oc.horas||1)+d));
  $("valorStepper").textContent=oc.horas+" h";
}
function marcarSigno(s){
  oc.signo=s;
  $("btnResta").classList.toggle("activo",s===-1);
  $("btnSuma").classList.toggle("activo",s===1);
}

/* --- confirmar ocurrencia --- */
async function confirmarOcurrencia(){
  const s=sesionActual(); if(!s){location.href="index.html";return;}
  let minutos;
  if(oc.tipo==="HORA_EXTRA") minutos = oc.horas*60;
  else {
    const v=parseInt($("inputMinutos").value,10);
    if(!v || v<=0){ mostrarError("Ingresa los minutos"); return; }
    minutos = v * oc.signo;
  }
  const btn=$("btnGuardarOc"); btn.disabled=true; btn.textContent="GUARDANDO…";
  try{
    const r = await rpc("fn_ocurrencia",{p_dni:s.dni,p_token:s.token,p_area:s.area,
      p_tipo:oc.tipo,p_minutos:minutos,p_detalle:oc.tipo,p_dnis:oc.dnis});
    btn.disabled=false; btn.textContent="GUARDAR";
    if(!r.ok){ mostrarError(r.error||"No se pudo guardar"); return; }
    $("exTitulo").textContent="Registrado";
    $("exDetalle").innerHTML=`${oc.tipo.replace("_"," ")} · <b>${minutos>0?"+":""}${minutos} min</b> · ${r.afectados} persona(s)`;
    $("exAvance").textContent="";
    const ex=$("exito"); ex.classList.add("visible");
    setTimeout(async ()=>{
      ex.classList.remove("visible");
      oc={tipo:null,minutos:0,dnis:[],multiple:false};
      $("filtroNombre").value="";
      await cargarPersonal(s);
      irA("pasoPersonal");
    },2500);
  }catch(e){ btn.disabled=false; btn.textContent="GUARDAR"; mostrarError(e.message); }
}

/* --- flujo OTROS: alcance todos / específicos --- */
function ocurrenciaGrupal(){ oc={tipo:null,minutos:0,dnis:[],multiple:false}; irA("pasoAlcance"); }
function alcanceTodos(){
  oc.dnis = PERSONAL.map(p=>p.dni); oc.multiple=false;
  $("nombreAfectado").textContent = "Todo el personal del área ("+oc.dnis.length+")";
  elegirTipo("OTROS");
}
function alcanceAlgunos(){
  oc.dnis=[]; oc.multiple=true;
  $("btnContinuarSel").disabled=true;
  pintarPersonal();
  irA("pasoSeleccion");
}
function continuarSeleccion(){
  oc.multiple=false;
  $("nombreAfectado").textContent = oc.dnis.length+" persona(s) seleccionada(s)";
  elegirTipo("OTROS");
}

/* ---------------- PWA ---------------- */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
}

/* ---------------- ARRANQUE POR PÁGINA ---------------- */
document.addEventListener("DOMContentLoaded",()=>{
  const pagina = document.body.dataset.pagina;
  if(pagina==="login") initLogin();
  if(pagina==="operario") initOperario();
  if(pagina==="supervisora") initSupervisora();
});
