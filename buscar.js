/* ================= BUSCAR Y SEGUIR (parche 106) =================
   Un solo buscador para OF, artículo, N° de prenda, OF/prenda, nombre o DNI.
   Tres fichas de solo lectura: paquete (sigue la NUMERACIÓN por todas las
   operaciones de la BASE, porque el número de paquete cambia con el troceo),
   OF y persona. El servidor solo devuelve las áreas que quien busca puede ver
   en Permisos; la supervisora, solo la suya. Lo usan Ingeniería (buscador fijo
   arriba, tecla /) y la supervisora (Más › Buscar). */

const BUS={t:null, q:"", res:null, sel:0, pedido:0, ficha:null, mod:null};
const busSes = () => (typeof ING!=="undefined" && ING) ? ING : sesionActual();
const busEsIng = () => document.body.dataset.pagina==="ingenieria";
const busDM = f => f ? f.slice(8,10)+"/"+f.slice(5,7) : "—";
const busDMH = f => f ? `${f.slice(8,10)}/${f.slice(5,7)} ${f.slice(11,16)}` : "—";
const busApe = n => soloApellidos(n||"");
function busFalta(e){ return /fn_buscar|fn_traza|PGRST202|Could not find|404/i.test(String(e&&e.message||e)); }
const BUS_FALTA_HTML=`<div class="acf-falta"><b>Falta correr el parche 106 en la base.</b> El buscador usa funciones nuevas de solo lectura (<code>fn_buscar</code>, <code>fn_traza_paquete</code>, <code>fn_traza_of</code> y <code>fn_traza_persona</code>).</div>`;

/* ---------- Recientes (solo en este navegador) ---------- */
function busRecientes(){ try{ return JSON.parse(localStorage.getItem("stx_bus_rec")||"[]"); }catch(e){ return []; } }
function busGuardarReciente(r){
  try{ const L=busRecientes().filter(x=>x.k!==r.k); L.unshift(r); localStorage.setItem("stx_bus_rec",JSON.stringify(L.slice(0,6))); }catch(e){}
}
function busPintarRecientes(){
  const z=$("busRec"); if(!z) return;
  const L=busRecientes();
  z.innerHTML = L.length ? `Recientes: ${L.map((r,i)=>`<button type="button" onclick="busAbrirReciente(${i})">${esc(r.t)}</button>`).join(" · ")}` : "";
  z.hidden=!L.length;
}
function busAbrirReciente(i){ const r=busRecientes()[i]; if(r) busAbrir(r.tipo, r.a, r.b); }

/* ---------- Caja de búsqueda ---------- */
function busInit(){
  const q=$("busQ"); if(!q || q.dataset.ok) return;
  q.dataset.ok="1";
  q.addEventListener("input", ()=>{ clearTimeout(BUS.t); BUS.t=setTimeout(busBuscar, 250); });
  q.addEventListener("keydown", e=>{
    const it=busItems();
    if(e.key==="ArrowDown"){ e.preventDefault(); BUS.sel=Math.min(it.length-1,BUS.sel+1); busPintarDrop(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); BUS.sel=Math.max(0,BUS.sel-1); busPintarDrop(); }
    else if(e.key==="Enter"){ e.preventDefault(); clearTimeout(BUS.t);
      if(BUS.q!==busNorm(q.value)) busBuscar().then(()=>{ const x=busItems()[0]; if(x) busElegir(0); });
      else if(it[BUS.sel]) busElegir(BUS.sel); }
    else if(e.key==="Escape"){ busCerrarDrop(); q.blur(); }
  });
  q.addEventListener("focus", ()=>{ if(BUS.res && q.value.trim()) busPintarDrop(); });
  document.addEventListener("click", e=>{ if(!e.target.closest(".bus-caja")) busCerrarDrop(); });
}
const busNorm = v => String(v||"").trim().toUpperCase().replace(/\s*\/\s*/,"/");
async function busBuscar(){
  const q=busNorm($("busQ").value), s=busSes(); if(!s) return;
  BUS.q=q; BUS.sel=0;
  if(q.length<3 && !/^\d+\/\d+$/.test(q)){ BUS.res=null; busCerrarDrop(); return; }
  const n=++BUS.pedido;
  try{
    const r=await rpc("fn_buscar",{p_dni:s.dni,p_token:s.token,p_q:q});
    if(n!==BUS.pedido) return;
    BUS.res = r&&r.ok ? r : {error:(r&&r.error)||"No se pudo buscar"};
  }catch(e){ if(n!==BUS.pedido) return; BUS.res={error: busFalta(e) ? "Falta correr el parche 106 en la base" : e.message}; }
  busPintarDrop();
}
function busItems(){
  const r=BUS.res; if(!r||r.error) return [];
  return [...(r.prendas||[]).map(x=>({tipo:"paquete",x})), ...(r.ofs||[]).map(x=>({tipo:"of",x})), ...(r.personas||[]).map(x=>({tipo:"persona",x}))];
}
function busPintarDrop(){
  const d=$("busDrop"); if(!d) return;
  const r=BUS.res; if(!r){ busCerrarDrop(); return; }
  if(r.error){ d.innerHTML=`<div class="bus-vacio">${esc(r.error)}</div>`; d.hidden=false; return; }
  const it=busItems(); let i=0, h="";
  const fila=(ico,t,s,der,cls)=>{ const k=i++; return `<button type="button" class="bus-it${k===BUS.sel?" sel":""}" role="option" aria-selected="${k===BUS.sel}" onmousedown="event.preventDefault()" onclick="busElegir(${k})">
      <span class="bus-ico ${cls||""}">${esc(ico)}</span><span class="bus-tx"><b>${t}</b><span>${s}</span></span>${der?`<span class="bus-der">${esc(der)}</span>`:""}</button>`; };
  if((r.prendas||[]).length){
    const n=/\d+$/.exec(r.q); h+=`<div class="bus-g">Prenda N° ${esc(n?n[0]:"")}${r.prendas.length>1?` · está en ${r.prendas.length} hojas de numeración`:""}</div>`;
    r.prendas.forEach(p=>{ h+=fila(p.paq,`OF ${esc(p.of)}${p.articulo?` · ${esc(p.articulo)}`:""} · paquete ${esc(p.paq)} de la HN`,
      `Prendas ${p.desde}-${p.hasta} · talla ${esc(p.talla||"—")} · ${esc(p.color||"")} · ${qty(p.cant)} und · ${p.ops_reg} de ${p.ops_tot} operaciones registradas`, p.area,"oc"); });
  }
  if((r.ofs||[]).length){
    h+=`<div class="bus-g">OF</div>`;
    r.ofs.forEach(o=>{ h+=fila("OF",`OF ${esc(o.of)}${o.articulo?` · ${esc(o.articulo)}`:""}`,`${esc(o.prenda||"")}${o.cant_prog?` · ${qty(o.cant_prog)} prendas`:""}`,(o.areas||[]).join(", ")); });
  } else if(/^\d+$/.test(r.q) && r.rango_of && !(r.prendas||[]).length){
    h+=`<div class="bus-g">OF</div><div class="bus-vacio">Ninguna OF empieza con ${esc(r.q)}. Las OF van de ${esc(r.rango_of.min)} a ${esc(r.rango_of.max)}.</div>`;
  }
  if((r.personas||[]).length){
    h+=`<div class="bus-g">Personas</div>`;
    r.personas.forEach(p=>{ h+=fila((p.nombre||"?").charAt(0),esc(p.nombre),`DNI ${esc(p.dni)}${p.estado!=="ACTIVO"?` · ${esc(p.estado)}`:""}`,p.area,"per"); });
  }
  if(!it.length && !h) h=`<div class="bus-vacio">Nada coincide con "${esc(r.q)}".</div>`;
  h+=`<div class="bus-ayuda">Puedes escribir <code>10397</code> una OF · <code>LXI499</code> un artículo · <code>1350</code> un N° de prenda · <code>10397/1350</code> la prenda dentro de la OF · un nombre o DNI. Enter abre el primero.</div>`;
  d.innerHTML=h; d.hidden=false;
}
function busCerrarDrop(){ const d=$("busDrop"); if(d) d.hidden=true; }
function busElegir(k){
  const it=busItems()[k]; if(!it) return;
  busCerrarDrop();
  if(it.tipo==="paquete") busAbrir("paquete", it.x.of, it.x.desde);
  else if(it.tipo==="of") busAbrir("of", it.x.of);
  else busAbrir("persona", it.x.dni);
}

/* ---------- Fichas ---------- */
function busIrPantalla(){
  if(busEsIng()){ if(typeof activarTab==="function" && pasoActivo()!=="pasoBuscar") activarTab("pasoBuscar"); }
  else { if(typeof pararAvance==="function") pararAvance(); irA("pasoBuscar"); }
  window.scrollTo(0,0);
}
async function busAbrir(tipo, a, b){
  const s=busSes(); if(!s) return;
  busIrPantalla();
  const z=$("busCuerpo"); pintarCargando(z,"Buscando…");
  BUS.mod=null;
  try{
    let r;
    if(tipo==="paquete") r=await rpc("fn_traza_paquete",{p_dni:s.dni,p_token:s.token,p_of:String(a),p_prenda:Number(b)});
    else if(tipo==="of") r=await rpc("fn_traza_of",{p_dni:s.dni,p_token:s.token,p_of:String(a)});
    else r=await rpc("fn_traza_persona",{p_dni:s.dni,p_token:s.token,p_persona:String(a)});
    if(!r||!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc((r&&r.error)||"No se encontró")}</div>`; return; }
    BUS.ficha={tipo,a,b,r};
    if(tipo==="paquete"){ busPintarPaquete(); const h=(r.hn||[])[0]; busGuardarReciente({k:`p${a}/${b}`,tipo,a,b,t:`${a}/${b}`}); }
    else if(tipo==="of"){ busPintarOF(); busGuardarReciente({k:`o${a}`,tipo,a,t:`OF ${a}`}); }
    else { busPintarPersona(); busGuardarReciente({k:`d${a}`,tipo,a,t:busApe(r.persona.nombre)}); }
    busPintarRecientes();
  }catch(e){ z.innerHTML = busFalta(e) ? BUS_FALTA_HTML : `<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function busKpi(n, t, cls){ return `<div class="bus-kpi ${cls||""}"><b>${n}</b><span>${t}</span></div>`; }
function busMigas(partes){ return `<nav class="bus-migas" aria-label="Ruta">${partes.join(' <span aria-hidden="true">›</span> ')}</nav>`; }

/* Estado de cada operación del paquete. */
function busEstadoOp(o){
  const regs=o.regs||[], act=regs.find(r=>r.estado==="ACTIVO"), lib=regs.filter(r=>r.estado==="LIBERADO");
  return {act, lib, nadie:!act, retomada:!!act && lib.length>0, otro:!!act && !!act.motivo_fecha};
}
function busPintarPaquete(){
  const r=BUS.ficha.r, z=$("busCuerpo"), of=r.of||{}, hn=(r.hn||[])[0]||{}, ofTxt=esc(of.of||BUS.ficha.a);
  const ops=[], personas=new Set(), fechas=[];
  (r.areas||[]).forEach(a=>(a.ops||[]).forEach(o=>{ const e=busEstadoOp(o); ops.push({a:a.area,o,e});
    (o.regs||[]).forEach(x=>{ personas.add(x.dni); if(x.estado==="ACTIVO") fechas.push(x.fecha); }); }));
  const reg=ops.filter(x=>!x.e.nadie).length, nadie=ops.filter(x=>x.e.nadie), ret=ops.filter(x=>x.e.retomada), otro=ops.filter(x=>x.e.otro);
  fechas.sort();
  const titulo = hn.paq!=null ? `Paquete ${esc(hn.paq)} de la HN · ${hn.desde}-${hn.hasta}` : `Prenda ${esc(r.prenda)}`;
  let h=busMigas([`<button type="button" onclick="busInicio()">Buscar</button>`,`<button type="button" onclick="busAbrir('of','${ofTxt}')">OF ${ofTxt}</button>`,hn.paq!=null?`Prendas ${hn.desde}-${hn.hasta}`:`Prenda ${esc(r.prenda)}`])
    + `<div class="bus-sup">OF ${ofTxt}${of.articulo?` · ${esc(of.articulo)}`:""}${of.prenda?` · ${esc(of.prenda)}`:""} · ${esc((r.areas||[]).map(a=>a.area).join(", "))}</div>
      <div class="bus-tit"><h2>${titulo}</h2><span>${hn.talla?`Talla <b>${esc(hn.talla)}</b> · `:""}${hn.color?`<b>${esc(hn.color)}</b> · `:""}${hn.cant!=null?`<b>${qty(hn.cant)}</b> und`:""}</span>
      ${of.fecha_carga?`<span>OF cargada <b>${busDMH(of.fecha_carga)}</b>${of.cargado_por?` por <b>${esc(of.cargado_por)}</b>`:""}</span>`:""}</div>
      <div class="bus-kpis">${busKpi(`${reg}/${ops.length}`,"operaciones registradas","ok")}${busKpi(nadie.length,"operaciones que nadie registró","nadie")}
      ${busKpi(ret.length,`liberada${ret.length===1?"":"s"} y retomada${ret.length===1?"":"s"}`,"lib")}${busKpi(otro.length,"registradas otro día","otro")}
      ${busKpi(personas.size,`personas lo tocaron${fechas.length?` · ${busDM(fechas[0])} → ${busDM(fechas[fechas.length-1])}`:""}`,"")}</div>`;
  if(!ops.length) h+=`<div class="vacio-msg">Esta OF todavía no tiene tickets generados para esta prenda.</div>`;
  else {
    // Por dónde pasó: por área y módulo, un cuadro por operación.
    let mapa="";
    (r.areas||[]).forEach(a=>{
      const mods=[]; (a.ops||[]).forEach(o=>{ let m=mods.find(x=>x.m===o.modulo); if(!m){ m={m:o.modulo,ops:[]}; mods.push(m); } m.ops.push(o); });
      if((r.areas||[]).length>1) mapa+=`<div class="bus-area">${esc(a.area)}</div>`;
      mods.forEach(m=>{
        const n=m.ops.filter(o=>!busEstadoOp(o).nadie).length, k=a.area+"|"+m.m;
        mapa+=`<div class="bus-mod${BUS.mod===k?" sel":""}"><button type="button" class="bus-mod-n" onclick="busVerModulo('${esc(k)}')"><b>${esc(m.m)}</b><span>${n}/${m.ops.length}</span></button><div class="bus-cuadros">`
          + m.ops.map(o=>{ const e=busEstadoOp(o), cls=e.nadie?"nadie":e.retomada?"lib":"ok";
              const t=`${o.n_op} · ${o.op} · ${e.nadie?"nadie la registró":busApe(e.act.nombre)+" "+busDM(e.act.fecha)}${e.otro?" · registrada otro día":""}`;
              return `<button type="button" class="bus-c ${cls}${e.otro?" otro":""}" title="${esc(t)}" aria-label="${esc(t)}" onclick="busVerModulo('${esc(k)}')">${o.n_op??"·"}</button>`; }).join("")
          + `</div></div>`;
      });
    });
    mapa+=`<div class="bus-ley"><span class="bus-c ok"></span>Registrada <span class="bus-c nadie"></span>Nadie la registró <span class="bus-c lib"></span>Liberada y retomada <span class="bus-c ok otro"></span>Registrada otro día (punto azul)</div>`;
    const troceo=ops.filter(x=>hn.desde!=null && (x.o.desde!==hn.desde || x.o.hasta!==hn.hasta));
    if(troceo.length){
      const ej=troceo[0].o; mapa+=`<div class="bus-nota">${esc(ej.modulo)} trabaja estas prendas en paquetes distintos a la HN (su paquete ${esc(ej.paq)} son las prendas ${ej.desde}-${ej.hasta}). Por eso la ficha sigue la <b>numeración</b>, no el número de paquete.</div>`;
    }
    h+=`<div class="bus-dos"><section class="bus-caja-b"><h3>Por dónde pasó</h3><p class="bus-sub">Cada cuadro es una operación de la BASE en orden. Toca un módulo para ver quién y cuándo.</p>${mapa}</section>
      <section class="bus-caja-b"><h3>Lo que pasó</h3><p class="bus-sub">Solo lo que se sale de lo normal, en orden.</p>${busLineaPaquete(r, ops, nadie)}</section></div>
      <div id="busDet"></div>`;
  }
  h+=busAcciones(of.of||BUS.ficha.a);
  z.innerHTML=h;
  if(BUS.mod) busVerModulo(BUS.mod, true);
}
function busLineaPaquete(r, ops, nadie){
  const ev=[], of=r.of||{};
  if(of.fecha_carga) ev.push({t:of.fecha_carga, c:"gris", h:`OF cargada`, s:esc(of.cargado_por||"")});
  const act=ops.filter(x=>x.e.act).sort((a,b)=>a.e.act.creado.localeCompare(b.e.act.creado));
  if(act.length) ev.push({t:act[0].e.act.creado, c:"ok", h:`Primer registro: ${esc(act[0].o.op)}`, s:esc(busApe(act[0].e.act.nombre))});
  // Registrado otro día: agrupado por persona y momento.
  const g={}; ops.filter(x=>x.e.otro && !x.e.retomada).forEach(x=>{ const a=x.e.act, k=a.dni+"|"+a.creado.slice(0,13); (g[k]=g[k]||{a,n:0}).n++; });
  Object.values(g).forEach(({a,n})=>ev.push({t:a.creado, c:"azul", h:`${esc(busApe(a.nombre))} registra ${n} operaci${n===1?"ón":"ones"} con fecha ${busDM(a.fecha)}`, s:`Motivo que eligió: ${esc(a.motivo_fecha)}`}));
  // Liberados.
  ops.forEach(x=>(x.e.lib||[]).forEach(l=>{
    ev.push({t:l.creado, c:"ok", h:`${esc(busApe(l.nombre))} registra ${esc(x.o.op)}`, s:""});
    const sig=(x.o.regs||[]).find(y=>y.creado>l.creado);
    const quien = l.lib ? `Liberó <b>${esc(l.lib.por)}</b> el ${busDMH(l.lib.cuando)}`
      : `Quién liberó y a qué hora: <span class="bus-sd">no se guardaba antes del 7-oct</span>${sig?` · fue entre el ${busDMH(l.creado)} y el ${busDMH(sig.creado)} (estimado)`:""}`;
    ev.push({t:(l.lib&&l.lib.cuando)||l.creado, c:"lib", h:`Liberado: "${esc(l.motivo_lib||"sin motivo")}"`, s:quien});
    if(sig) ev.push({t:sig.creado, c:"lib", h:`${esc(busApe(sig.nombre))} lo ${sig.dni===l.dni?"vuelve a registrar":"retoma"}${sig.fecha!==sig.creado.slice(0,10)?` con fecha ${busDM(sig.fecha)}`:""}`, s:sig.motivo_fecha?`Motivo: ${esc(sig.motivo_fecha)}`:""});
  }));
  // Movidos de día (desde el 7-oct).
  ops.forEach(x=>{ const a=x.e.act; if(a&&a.movido) ev.push({t:a.movido.cuando, c:"azul", h:`${esc(a.movido.por)} movió ${esc(x.o.op)} del ${busDM(a.movido.de)} al ${busDM(a.movido.a)}`, s:a.movido.motivo?`Motivo: ${esc(a.movido.motivo)}`:""}); });
  // Registradas después de la última operación de la ruta.
  (r.areas||[]).forEach(ar=>{
    const L=(ar.ops||[]).filter(o=>o.n_op!=null); if(!L.length) return;
    const fin=L.reduce((m,o)=>o.n_op>m.n_op?o:m,L[0]), ef=busEstadoOp(fin).act; if(!ef) return;
    const tarde=ops.filter(x=>x.a===ar.area && x.o!==fin && x.e.act && x.e.act.creado>ef.creado);
    if(tarde.length) ev.push({t:tarde.map(x=>x.e.act.creado).sort().pop(), c:"mal",
      h:`${tarde.length} operaci${tarde.length===1?"ón registrada":"ones registradas"} después de ${esc(fin.op)}`,
      s:tarde.slice(0,4).map(x=>`${esc(x.o.op)} (${esc(busApe(x.e.act.nombre))})`).join(", ")+(tarde.length>4?"…":"")});
  });
  ev.sort((a,b)=>String(a.t).localeCompare(String(b.t)));
  if(nadie.length) ev.push({t:"", tt:"hoy", c:"aviso", h:`${nadie.length} operaci${nadie.length===1?"ón":"ones"} sin registrar`, s:nadie.map(x=>x.o.n_op).join(", ")});
  if(r.acabado && r.acabado.registros) ev.push({t:"", tt:r.acabado.desde?`${busDM(r.acabado.desde)} → ${busDM(r.acabado.hasta)}`:"", c:"gris",
    h:"ACABADO registra la OF por cantidad, no por paquete", s:`${r.acabado.registros} registros, ${r.acabado.personas} personas · ${qty(r.acabado.und)} und`});
  return `<ol class="bus-linea">${ev.map(e=>`<li class="${e.c}"><time>${e.tt!=null?esc(e.tt):e.t.length>10?busDMH(e.t):busDM(e.t)}</time><div><b>${e.h}</b>${e.s?`<span>${e.s}</span>`:""}</div></li>`).join("")}</ol>`;
}
function busVerModulo(k, quieto){
  BUS.mod=k;
  const [area,mod]=k.split("|"), r=BUS.ficha&&BUS.ficha.r, z=$("busDet"); if(!r||!z) return;
  document.querySelectorAll(".bus-mod").forEach(x=>x.classList.toggle("sel", x.querySelector(".bus-mod-n b").textContent===mod));
  const ops=((r.areas||[]).find(a=>a.area===area)||{ops:[]}).ops.filter(o=>o.modulo===mod);
  z.innerHTML=`<section class="bus-caja-b"><h3>${esc(mod)} · detalle</h3><div class="tabla-wrap"><table class="tabla bus-tabla"><thead><tr><th>N°</th><th class="izq">Operación</th><th class="izq">Quién</th><th>Fecha</th><th>Lo registró</th><th class="izq">Estado</th></tr></thead><tbody>`
    + ops.map(o=>{ const e=busEstadoOp(o), a=e.act, l=e.lib[e.lib.length-1];
        const quien = a ? (l?`<s>${esc(busApe(l.nombre))}</s> → `:"")+`<b>${esc(busApe(a.nombre))}</b>` : "—";
        const est = e.nadie ? `<span class="bus-est nadie">Nadie la registró</span>` : e.retomada ? `<span class="bus-est lib">Liberado y retomado</span>` : `<span class="bus-est ok">Registrado</span>`;
        return `<tr class="${e.retomada?"lib":""}"><td>${o.n_op??"—"}</td><td class="izq">${esc(o.op)}</td><td class="izq">${quien}</td><td>${a?busDM(a.fecha):"—"}</td><td>${a?busDMH(a.creado):"—"}</td>
          <td class="izq">${est}${a&&a.motivo_fecha?` <small>${esc(a.motivo_fecha)}</small>`:""}</td></tr>`; }).join("")
    + `</tbody></table></div></section>`;
  if(!quieto) z.scrollIntoView({behavior:"smooth",block:"start"});
}
function busAcciones(of){
  return `<div class="bus-acc"><button type="button" class="bus-btn" onclick="busAbrir('of','${esc(of)}')">Ver la OF completa</button>
    <button type="button" class="bus-btn" onclick="busCopiar()">Copiar como texto</button>
    ${busEsIng()?`<button type="button" class="bus-btn" onclick="activarTab('pasoTk')">Liberar o mover… (Tickets › Actual)</button>`:""}</div>`;
}
function busCopiar(){
  const z=$("busCuerpo"); if(!z) return;
  const t=z.innerText.replace(/\n{3,}/g,"\n\n");
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(()=>mostrarOk("Copiado"),()=>mostrarError("No se pudo copiar"));
}
function busPintarOF(){
  const r=BUS.ficha.r, of=r.of||{}, z=$("busCuerpo"), o=esc(of.of||BUS.ficha.a);
  let h=busMigas([`<button type="button" onclick="busInicio()">Buscar</button>`,`OF ${o}`])
    + `<div class="bus-sup">${of.articulo?esc(of.articulo):""}${of.prenda?` · ${esc(of.prenda)}`:""}${of.cant_prog?` · ${qty(of.cant_prog)} prendas programadas`:""}${of.paquetes?` · ${of.paquetes} paquetes en la HN`:""}</div>
      <div class="bus-tit"><h2>OF ${o}</h2>${of.fecha_carga?`<span>Cargada <b>${busDMH(of.fecha_carga)}</b>${of.cargado_por?` por <b>${esc(of.cargado_por)}</b>`:""}</span>`:""}</div>`;
  (r.areas||[]).forEach(a=>{
    const pct=a.tickets?Math.round(a.registrados/a.tickets*100):0;
    h+=`<section class="bus-caja-b"><h3>${esc(a.area)}</h3>
      <div class="bus-kpis">${busKpi(`${pct}%`,`${a.registrados} de ${a.tickets} tickets registrados`,"ok")}${busKpi(a.personas,`personas · ${busDM(a.primero)} → ${busDM(a.ultimo)}`,"")}
      ${busKpi(a.otro_dia,"registrados otro día","otro")}${busKpi((a.liberados||[]).reduce((s,x)=>s+x.n,0),"liberados","lib")}</div>
      <div class="bus-mods">${(a.modulos||[]).map(m=>{ const p=m.tickets?Math.round(m.registrados/m.tickets*100):0;
        return `<div class="bus-modbar"><span>${esc(m.modulo)}</span><div class="opi-barra"><i style="width:${p}%"></i></div><b>${p}%</b></div>`; }).join("")}</div>
      ${(a.huecos||[]).length?`<h4>Paquetes con hueco</h4><p class="bus-sub">Prendas que avanzaron pero con operaciones sin registrar. Toca uno para ver su ficha.</p>
        <div class="bus-huecos">${a.huecos.map(x=>`<button type="button" onclick="busAbrir('paquete','${o}',${x.desde})"><b>${x.desde}-${x.hasta}</b><span>faltan ${x.faltan} de ${x.ops}</span></button>`).join("")}</div>`:""}
      ${(a.liberados||[]).length?`<h4>Liberados por motivo</h4><ul class="bus-lib">${a.liberados.map(x=>`<li><span>${esc(x.motivo)}</span><b>${x.n}</b></li>`).join("")}</ul>`:""}
    </section>`;
  });
  if(r.acabado && r.acabado.registros) h+=`<section class="bus-caja-b"><h3>ACABADO</h3><p class="bus-sub">Registra por cantidad, no por paquete: ${r.acabado.registros} registros de ${r.acabado.personas} personas, ${qty(r.acabado.und)} und, del ${busDM(r.acabado.desde)} al ${busDM(r.acabado.hasta)}.</p></section>`;
  if(!(r.areas||[]).length && !(r.acabado&&r.acabado.registros)) h+=`<div class="vacio-msg">Esta OF todavía no tiene tickets generados.</div>`;
  h+=`<div class="bus-acc"><button type="button" class="bus-btn" onclick="busCopiar()">Copiar como texto</button></div>`;
  z.innerHTML=h;
}
function busPintarPersona(){
  const r=BUS.ficha.r, p=r.persona, z=$("busCuerpo");
  let h=busMigas([`<button type="button" onclick="busInicio()">Buscar</button>`,esc(busApe(p.nombre))])
    + `<div class="bus-sup">DNI ${esc(p.dni)} · ${esc(p.area||"")}${p.area_actual&&p.area_actual!==p.area?` (hoy en ${esc(p.area_actual)})`:""} · ${esc(p.cargo)}${p.estado!=="ACTIVO"?` · ${esc(p.estado)}`:""}</div>
      <div class="bus-tit"><h2>${esc(p.nombre)}</h2></div>
      <section class="bus-caja-b"><h3>Sus últimos días</h3><div class="tabla-wrap"><table class="tabla bus-tabla"><thead><tr><th>Día</th><th>Tickets</th><th>Minutos</th><th>Liberados</th><th class="izq">OF</th><th class="izq">Registrado otro día</th></tr></thead><tbody>`
    + (r.dias||[]).map(d=>`<tr><td>${busDM(d.fecha)}</td><td>${d.tickets}</td><td>${d.minutos??0}</td><td>${d.liberados||""}</td><td class="izq">${esc(d.ofs||"")}</td>
        <td class="izq">${(d.otro_dia||[]).map(x=>`${x.n} · ${esc(x.motivo)} (lo registró ${busDMH(x.creado)})`).join("<br>")}</td></tr>`).join("")
    + `</tbody></table></div>${(r.dias||[]).length?"":`<div class="vacio-msg">Sin registros en las últimas tres semanas.</div>`}</section>`;
  z.innerHTML=h;
}
function busInicio(){
  const z=$("busCuerpo"); if(z) z.innerHTML="";
  busPintarRecientes();
  const q=$("busQ"); if(q){ q.focus(); q.select(); }
}
function buscarInit(){ busInit(); busPintarRecientes(); }
/* Desde el buscador Ctrl+K: abre esta pantalla con el texto ya buscado. */
function busDesde(txt){
  busIrPantalla(); busInit();
  const q=$("busQ"); if(!q) return;
  q.value=txt; q.focus();
  busBuscar();
}
document.addEventListener("DOMContentLoaded", ()=>{ if($("busQ")) buscarInit(); });
