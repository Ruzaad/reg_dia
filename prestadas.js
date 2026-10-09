/* ================= SESIONES PRESTADAS (parche 109) =================
   "Entrar como operario" sin su PIN y con motivo, y "Operar como supervisora",
   con una sesión aparte que no toca el token del operario. Lo registrado con
   ella queda marcado; Gestión › Sesiones prestadas lo muestra.
   Sin el parche, "Entrar como" vuelve al modal de siempre (DNI y PIN). */

const PR={items:[], falta:false};
const prFalta = e => /Could not find the function|PGRST202/i.test(String(e&&e.message||e||""));
const prHM = t => t ? new Date(t).toLocaleTimeString("es-PE",{timeZone:"America/Lima",hour:"2-digit",minute:"2-digit",hour12:false}) : "—";
const PR_MOTIVOS=["Olvidó el celular","Celular sin batería","Le ayudo a registrar","Corregir un registro"];
const prEquipo = () => /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "Celular" : "PC";

/* Abre la sesión prestada y se va a la pantalla. tipo OP u SUP. */
async function prAbrir(tipo, comoDni, area, motivo){
  const r=await rpc("fn_prestar_sesion",{p_dni:ING.dni,p_token:ING.token,p_tipo:tipo,p_como_dni:comoDni||"",p_area:area||"",p_motivo:motivo||"",p_equipo:prEquipo()});
  if(!r.ok) return r;
  // Igual que antes (parche 92): la sesión prestada vive solo en esta pestaña.
  try{ sessionStorage.setItem("stx_volver_ing", localStorage.getItem("stx_sesion")||"1"); }catch(e){}
  guardarSesion({dni:r.dni, nombre:r.nombre, cargo:r.cargo, token:r.token, admin:r.es_admin,
    area: tipo==="SUP" ? area : (r.cargo==="ESTAJERO" ? null : (r.area_actual||null)),
    prestada:{id:r.id, tipo, ing:ING.dni, ing_nombre:ING.nombre||ING.dni}});
  location.href = tipo==="SUP" ? "supervisora.html" : "operario.html";
  return r;
}

/* Reemplaza al modal con PIN. Si la base aún no tiene el parche, cae al de siempre. */
function opPrestarModal(dni, nombre){
  if(PR.falta) return opPinModalPin(dni, nombre);
  abrirModal(`<h2>Entrar como ${esc(soloApellidos(nombre))}</h2>
    <div class="sub" style="margin-bottom:10px;">Sin su PIN y sin cerrarle el celular. Queda registrado quién entró, a qué hora y por qué.</div>
    <div class="modal-campo"><label id="prMotL">Motivo</label>
      <div class="lt-seg" role="radiogroup" aria-labelledby="prMotL" id="prMot">
        ${PR_MOTIVOS.map(m=>`<button type="button" role="radio" aria-checked="false" data-v="${esc(m)}">${esc(m)}</button>`).join("")}
        <button type="button" role="radio" aria-checked="false" data-v="">Otro</button></div>
      <input id="prMotOtro" maxlength="120" placeholder="Escribe el motivo" hidden style="margin-top:8px"></div>
    <div class="modal-msg" id="prMsg" role="alert"></div>
    <div class="modal-acciones">
      <button class="btn-principal btn-modal-guardar" id="prEntrar">ENTRAR COMO ${esc(soloApellidos(nombre))}</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button>
    </div>`);
  const g=$("prMot");
  g.onclick=e=>{ const b=e.target.closest("button"); if(!b) return;
    g.querySelectorAll("button").forEach(x=>x.setAttribute("aria-checked", x===b));
    const o=$("prMotOtro"); o.hidden = b.dataset.v!==""; if(!o.hidden) o.focus(); };
  $("prEntrar").onclick=()=>unaVez("prEntrar",[$("prEntrar")],async()=>{
    const b=g.querySelector("[aria-checked=true]"), msg=$("prMsg");
    const mot = !b ? "" : (b.dataset.v || $("prMotOtro").value.trim());
    if(!mot){ msg.textContent="Elige o escribe el motivo"; return; }
    try{ const r=await prAbrir("OP", dni, "", mot); if(r && !r.ok) msg.textContent=r.error||"No se pudo"; }
    catch(e){
      if(prFalta(e)){ PR.falta=true; cerrarModal(); opPinModalPin(dni, nombre); return; }
      msg.textContent = /NO_AUTORIZADA/.test(e.message) ? "No tienes permiso para entrar como operario en esa área" : e.message;
    }
  });
}

/* ---------------- Gestión › Sesiones prestadas ---------------- */
async function prCargar(){
  const z=$("prZona"); if(!z) return;
  const f=$("prFecha"), a=$("prArea");
  if(a && a.options.length<2){ const v=a.value;
    a.innerHTML=`<option value="">Todas mis áreas</option>`+(AREAS_LISTA||[]).map(x=>`<option>${esc(x)}</option>`).join(""); a.value=v; }
  pintarCargando(z,"Cargando sesiones…");
  try{
    const r=await rpc("fn_sesiones_prestadas",{p_dni:ING.dni,p_token:ING.token,p_fecha:(f&&f.value)||null,p_area:a?a.value:""});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    PR.items=r.items||[]; PR.admin=r.admin; prPintar();
  }catch(e){ z.innerHTML = prFalta(e)
    ? `<div class="acf-falta"><b>Falta correr el parche 109 en la base.</b> Con él, "Entrar como" deja de pedir el PIN del operario, no le cierra el celular y queda registrado quién entró y qué hizo.</div>`
    : `<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function prEstado(x){
  if(!x.fin) return `<span class="lt-vivo">Abierta</span>`;
  const c=x.cierre||"";
  return `<span class="tag g">${c==="VOLVIO"?"Volvió":c==="VENCIO"?"Venció (60 min sin uso)":c==="REEMPLAZADA"?"Abrió otra":/^CERRADA_POR/.test(c)?"La cerró "+esc(c.slice(12)):esc(c)} · ${prHM(x.fin)}</span>`;
}
function prPintar(){
  const z=$("prZona"); if(!z) return;
  const xs=PR.items, kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num"${c?` style="color:${c}"`:""}>${v}</div><div class="kpi-lbl">${t}</div></div>`;
  const abiertas=xs.filter(x=>!x.fin).length, reg=xs.reduce((s,x)=>s+x.reclamos+x.incidencias+x.movimientos,0);
  z.innerHTML=`<div class="kpis" style="margin-bottom:14px">${kpi("Sesiones del día",xs.length)}${kpi("Abiertas ahora",abiertas,abiertas?"var(--exito)":"")}
      ${kpi("Como operario",xs.filter(x=>x.tipo==="OP").length)}${kpi("Como supervisora",xs.filter(x=>x.tipo==="SUP").length)}${kpi("Registros hechos",reg)}</div>
    ${xs.length?`<div class="contenedor-ancho tabla-scroll"><table class="tabla"><thead><tr><th class="izq">Quién entró</th><th class="izq">Como</th><th>Área</th>
      <th class="izq">Motivo</th><th>Desde</th><th>Estado</th><th>Tickets</th><th>Incid.</th><th>Cambios de área</th><th></th></tr></thead><tbody>
      ${xs.map(x=>`<tr><td class="izq"><b>${esc(x.ing_nombre||x.ing_dni)}</b></td>
        <td class="izq">${x.tipo==="SUP"?`<span class="tag a">Supervisora</span>`:`${esc(soloApellidos(x.como_nombre||x.como_dni))}<small>DNI ${esc(x.como_dni)}</small>`}</td>
        <td>${esc(x.area||"")}</td><td class="izq">${esc(x.motivo||"—")}${x.equipo?`<small>${esc(x.equipo)}</small>`:""}</td><td>${prHM(x.inicio)}</td><td>${prEstado(x)}</td>
        <td>${x.reclamos||"—"}</td><td>${x.incidencias||"—"}</td><td>${x.movimientos||"—"}</td>
        <td class="nw"><button class="btn-mini gris" onclick="prVer(${x.id})">Ver</button>
          ${!x.fin && (PR.admin || x.ing_dni===ING.dni)?`<button class="btn-mini rojo" onclick="prCerrar(${x.id})">Cerrar ya</button>`:""}</td></tr>`).join("")}
      </tbody></table></div>`:`<div class="vacio-msg">Nadie entró como otra persona ese día.</div>`}
    <p class="sub" style="margin-top:12px">Solo cuenta desde que se corrió el parche 109. Lo de antes se hizo con el PIN del operario y no dejó rastro de quién entró.</p>`;
}
async function prVer(id){
  const x=PR.items.find(i=>i.id===id); if(!x) return;
  abrirModal(`<div id="prDet">${cargandoHTML("Cargando…")}</div>`);
  try{
    const r=await rpc("fn_sesion_prestada_detalle",{p_dni:ING.dni,p_token:ING.token,p_id:id});
    const d=$("prDet"); if(!d) return;
    if(!r.ok){ d.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    const sec=(t,rows,cab,fila)=>rows.length?`<h3 class="pr-h3">${t} (${rows.length})</h3><div class="tabla-scroll" style="max-height:30vh"><table class="tabla"><thead><tr>${cab}</tr></thead><tbody>${rows.map(fila).join("")}</tbody></table></div>`:"";
    d.innerHTML=`<h2>${esc(x.ing_nombre||x.ing_dni)} como ${x.tipo==="SUP"?"supervisora de "+esc(x.area):esc(soloApellidos(x.como_nombre||x.como_dni))}</h2>
      <div class="sub" style="margin-bottom:10px">${prHM(x.inicio)} a ${x.fin?prHM(x.fin):"ahora"} · ${esc(x.motivo||"sin motivo")}</div>
      ${sec("Tickets",r.reclamos,`<th>Hora</th><th>OF</th><th class="izq">Operación</th><th>Numeración</th><th>Min</th><th>Estado</th>`,
        t=>`<tr><td>${prHM(t.creado)}</td><td>${esc(t.o_f)}</td><td class="izq">${esc(t.op||"")}</td><td>${esc(t.numeracion||"")}</td><td>${t.minutos??""}</td><td>${esc(t.estado||"")}</td></tr>`)}
      ${sec("Incidencias",r.incidencias,`<th>Hora</th><th>Tipo</th><th>Min</th><th class="izq">Detalle</th>`,
        t=>`<tr><td>${prHM(t.creado)}</td><td>${esc(t.tipo||"")}</td><td>${t.minutos}</td><td class="izq">${esc(t.detalle||"")}</td></tr>`)}
      ${sec("Cambios de área",r.movimientos,`<th>Hora</th><th>De</th><th>A</th>`,
        t=>`<tr><td>${prHM(t.creado)}</td><td>${esc(t.area_anterior||"")}</td><td>${esc(t.area_nueva||"")}</td></tr>`)}
      ${!(r.reclamos.length+r.incidencias.length+r.movimientos.length)?`<div class="vacio-msg">No registró nada con esta sesión.</div>`:""}
      <div class="modal-acciones"><button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CERRAR</button></div>`;
  }catch(e){ const d=$("prDet"); if(d) d.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
}
async function prCerrar(id){
  if(!confirm("¿Cerrar esta sesión? Quien la esté usando tendrá que volver a Ingeniería.")) return;
  try{ const r=await rpc("fn_prestada_cerrar",{p_dni:ING.dni,p_token:ING.token,p_id:id});
    if(!r.ok){ mostrarError(r.error||"No se pudo"); return; } mostrarOk("Sesión cerrada"); prCargar();
  }catch(e){ mostrarError(e.message); }
}
