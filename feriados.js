/* =====================================================================
   SAMITEX · Ingeniería › Feriados y fin de semana (QA, parche 120)
   Un feriado no exige minutos a nadie ni anula la quincena. Sábado, domingo
   y feriado no tienen jornada: si alguien trabaja, Ingeniería tiene que poner
   sus horas, que entran como hora extra y son su disponible de ese día.
   Una RPC de lectura (fn_dias_no_laborables) y dos de escritura.
   ===================================================================== */
let FER={r:null, h:null};
const FER_DIAS=["dom","lun","mar","mié","jue","vie","sáb"];
const FER_TIPO={SABADO:"Sábado",DOMINGO:"Domingo",FERIADO:"Feriado"};
const ferDM=f=>f.slice(8,10)+"/"+f.slice(5,7);
const ferDia=iso=>{ const [y,m,d]=iso.split("-").map(Number); return new Date(y,m-1,d); };
const ferTxt=iso=>`${FER_DIAS[ferDia(iso).getDay()]} ${ferDM(iso)}`;
const ferSuma=(iso,n)=>{ const f=ferDia(iso); f.setDate(f.getDate()+n); return f.toLocaleDateString("sv-SE"); };
const ferHoras=m=>{ const h=Number(m)/60; return (Number.isInteger(h)?h:h.toFixed(1))+" h"; };
const ferFinde=iso=>[0,6].includes(ferDia(iso).getDay());
const ferPend=d=>d.jornada==0 ? (d.personas||[]).filter(p=>!(Number(p.horas_min)>0)) : [];

function ferInit(){ ferCargar(); }
async function ferCargar(){
  const hoy=hoyLima(), box=$("ferCuerpo");
  box.innerHTML=cargandoHTML("Revisando sábados, domingos y feriados…"); $("ferKpis").innerHTML="";
  try{
    const r=await rpc("fn_dias_no_laborables",{p_dni:ING.dni,p_token:ING.token,p_desde:ferSuma(hoy,-45),p_hasta:ferSuma(hoy,7)});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    FER.r=r; ferPintar(); ferNav(r);
  }catch(e){
    box.innerHTML = /fn_dias_no_laborables|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 120 en la base.</b> Esta pantalla usa las funciones nuevas <code>fn_dias_no_laborables</code>, <code>fn_feriado_guardar</code> y <code>fn_jornada_horas_guardar</code>.</div>`
      : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}
/* Contador en el menú: personas que trabajaron un día no laborable y siguen sin horas. */
function ferNav(r){
  const n=(r.dias||[]).reduce((s,d)=>s+ferPend(d).length,0);
  const it=document.querySelector('.nav-item[data-tab="pasoFeriados"]'); if(!it) return;
  let b=it.querySelector(".dyn-cnt"); if(!b){ b=document.createElement("b"); b.className="dyn-cnt"; it.appendChild(b); }
  b.textContent=n; b.hidden=!n; b.title=n+" persona(s) sin horas en sábado, domingo o feriado";
}

function ferPintar(){
  const r=FER.r, hoy=r.hoy, dias=r.dias||[];
  const pend=dias.reduce((s,d)=>s+ferPend(d).length,0), diasPend=dias.filter(d=>ferPend(d).length).length;
  const prox=(r.feriados||[]).find(f=>f.fecha>=hoy);
  $("ferKpis").innerHTML=`
    <div class="acf-k"><b class="${pend?"rojo":"verde"}">${pend||"✓"}</b><span>${pend
      ? `persona${pend===1?"":"s"} trabajaron sin que nadie ponga sus horas, en ${diasPend} día${diasPend===1?"":"s"}. Hasta ponerlas su disponible es 0`
      : "todos los que trabajaron en sábado, domingo o feriado tienen sus horas"}</span></div>
    <div class="acf-k"><b>${(r.feriados||[]).length}</b><span>feriado${(r.feriados||[]).length===1?"":"s"} marcado${(r.feriados||[]).length===1?"":"s"}${prox?`; el próximo es el ${esc(ferTxt(prox.fecha))}`:""}</span></div>`;

  const feriado = r.puede_feriado ? `
    <form class="barra-control fer-form" onsubmit="event.preventDefault();ferGuardarFeriado()">
      <label class="campo"><span>Día</span><input type="date" id="ferFecha" required min="${ferSuma(hoy,-62)}" max="${ferSuma(hoy,366)}"></label>
      <label class="campo fer-mot"><span>Motivo</span><input type="text" id="ferMotivo" maxlength="80" placeholder="Combate de Angamos" required></label>
      <button class="btn-mini" type="submit">Marcar feriado</button>
    </form>` : `<p class="seccion-sub">Marcar o quitar un feriado lo hace quien edita todas las áreas.</p>`;
  const lista=(r.feriados||[]).map(f=>`<li><b>${esc(ferTxt(f.fecha))}</b> ${esc(f.motivo)}<small>por ${esc(f.por||"")}</small>${
      r.puede_feriado?`<button type="button" class="btn-mini rojo" onclick="ferQuitar('${f.fecha}')">Quitar</button>`:""}</li>`).join("");

  const tarjetas=dias.map(d=>{
    const pe=ferPend(d), ps=d.personas||[], fut=d.fecha>hoy;
    const tit=d.tipo==="FERIADO" ? `Feriado · ${esc(d.motivo||"")}` : FER_TIPO[d.tipo];
    const est = d.jornada>0 ? `<span class="fer-est">Antes de la regla: cuenta con 575 min</span>`
      : !ps.length ? `<span class="fer-est ok">Nadie trabajó</span>`
      : pe.length ? `<span class="fer-est mal">${pe.length} sin horas</span>` : `<span class="fer-est ok">Horas completas</span>`;
    const filas=ps.map(p=>{ const h=Number(p.horas_min)>0, ed=puedeEditar(p.area);
      return `<tr><th scope="row">${esc(p.nombre)}<small>${esc(String(p.area).replace(" COSTURA",""))}</small></th>
        <td class="num">${p.tk?`${Math.round(p.min_tk)} min <small>${p.tk} ticket${p.tk===1?"":"s"}</small>`:'<span class="ini-tenue">sin tickets</span>'}</td>
        <td class="num">${d.jornada>0?'<span class="ini-tenue">—</span>':h?`<span class="acf-n ok fer-h">${ferHoras(p.horas_min)}</span>`:`<span class="acf-n grave">Falta</span>`}</td>
        <td>${d.jornada==0&&ed?`<button type="button" class="btn-mini gris" onclick="ferHoras1('${d.fecha}','${esc(p.dni)}')">${h?"Cambiar":"Poner"}</button>`:""}</td></tr>`; }).join("");
    return `<section class="fer-dia${pe.length?" pend":""}">
      <div class="fer-cab"><div><h3>${esc(ferTxt(d.fecha))} · ${tit}</h3>${est}</div>
        ${d.jornada==0?`<button type="button" class="btn-mini${pe.length?"":" gris"}" onclick="ferAbrir('${d.fecha}')">${pe.length?`Poner horas a ${pe.length}`:fut?"Programar quién viene":"Agregar o cambiar"}</button>`:""}</div>
      ${ps.length?`<div class="tabla-scroll"><table class="tabla fer-tabla"><thead><tr><th>Persona</th><th>Registró</th><th>Horas</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
        : `<p class="seccion-sub">${d.tipo==="FERIADO"?"Nadie registró tickets. No se exige nada y la quincena no se anula.":"Sin registros."}</p>`}
    </section>`;
  }).join("");

  $("ferCuerpo").innerHTML=`
    <div class="fer-grid">
      <section class="fer-card"><h2>Feriados</h2>${feriado}${lista?`<ul class="fer-lista">${lista}</ul>`:`<p class="seccion-sub">Ningún feriado marcado en los últimos dos meses.</p>`}</section>
      <section class="fer-card"><h2>¿Se trabaja este fin de semana?</h2>
        <p class="seccion-sub">Pon las horas antes o después del día. Quien registre tickets y no tenga horas aparece abajo en rojo.</p>
        <div class="fer-prog">${[1,2,3,4,5,6,7].map(n=>ferSuma(hoy,n)).filter(f=>ferFinde(f)||(r.feriados||[]).some(x=>x.fecha===f))
          .map(f=>`<button type="button" class="asy-b" onclick="ferAbrir('${f}')">${esc(ferTxt(f))}</button>`).join("")}</div></section>
    </div>
    <h2 class="fer-sub">Últimos 45 días</h2>
    ${tarjetas || `<div class="vacio-msg">Nadie trabajó en sábado, domingo ni feriado en los últimos 45 días.</div>`}`;
}

async function ferGuardarFeriado(){
  const f=$("ferFecha").value, m=$("ferMotivo").value.trim();
  if(!f || !m) return;
  try{
    const r=await rpc("fn_feriado_guardar",{p_dni:ING.dni,p_token:ING.token,p_fecha:f,p_motivo:m,p_quitar:false});
    if(!r || !r.ok){ mostrarError((r&&r.error)||"No se pudo guardar"); return; }
    mostrarOk(`${ferTxt(f)} marcado como feriado.${r.trabajaron?` ${r.trabajaron} persona(s) registraron tickets ese día: ponles sus horas.`:""}`);
    ferCargar();
  }catch(e){ mostrarError(e.message); }
}
async function ferQuitar(f){
  if(!confirm(`¿Quitar el feriado del ${ferTxt(f)}? Ese día vuelve a exigir 575 min y las horas puestas por feriado se borran.`)) return;
  try{
    const r=await rpc("fn_feriado_guardar",{p_dni:ING.dni,p_token:ING.token,p_fecha:f,p_motivo:null,p_quitar:true});
    if(!r || !r.ok){ mostrarError((r&&r.error)||"No se pudo quitar"); return; }
    mostrarOk(`Feriado del ${ferTxt(f)} quitado.`); ferCargar();
  }catch(e){ mostrarError(e.message); }
}

/* ---------- Poner horas: personas del día + cualquiera de un área que edite ---------- */
function ferHoras1(fecha, dni){ ferAbrir(fecha, [dni]); }
function ferAbrir(fecha, solo){
  const d=(FER.r.dias||[]).find(x=>x.fecha===fecha) || {fecha, personas:[]};
  const ps=(d.personas||[]).filter(p=>puedeEditar(p.area));
  const sel={}; ps.forEach(p=>{ if(solo ? solo.includes(p.dni) : !(Number(p.horas_min)>0)) sel[p.dni]=true; });
  const h0=solo&&ps.find(p=>p.dni===solo[0]&&Number(p.horas_min)>0);
  FER.h={fecha, gente:ps.map(p=>({dni:p.dni,nombre:p.nombre,area:p.area,tk:p.tk,horas_min:p.horas_min})), sel, min:h0?Number(h0.horas_min):null};
  ferModal();
}
function ferModal(){
  const H=FER.h, n=Object.keys(H.sel).filter(k=>H.sel[k]).length;
  const areas=(AREAS_LISTA||[]).filter(a=>a && a!=="INGENIERIA" && puedeEditar(a));
  const chip=m=>`<button type="button" class="asy-b${H.min===m?" sel":""}" onclick="FER.h.min=${m};ferModal()">${ferHoras(m)}</button>`;
  abrirModal(`<h2>${esc(ferTxt(H.fecha))} · horas trabajadas</h2>
    <p class="seccion-sub">Cuentan como hora extra y son el disponible de ese día para la eficiencia. Volver a guardar reemplaza; 0 h las quita.</p>
    <div class="barra-control fer-chips">${[240,300,360,480].map(chip).join("")}
      <label class="campo fer-otro"><span>Otra (h)</span><input type="number" min="0" max="12" step="0.5" value="${H.min!=null&&![240,300,360,480].includes(H.min)?H.min/60:""}"
        oninput="FER.h.min=this.value===''?null:Math.round(Number(this.value)*60);ferModalBtn()"></label></div>
    <div class="barra-control fer-agregar"><label class="campo"><span>Agregar gente de</span><select onchange="ferArea(this.value)">
      <option value="">Elige un área…</option>${areas.map(a=>`<option>${esc(a)}</option>`).join("")}</select></label>
      <button type="button" class="btn-mini gris" onclick="ferTodos(true)">Todos</button><button type="button" class="btn-mini gris" onclick="ferTodos(false)">Ninguno</button></div>
    <div class="acf-lista" id="ferLista">${H.gente.length?H.gente.map(p=>`<label class="acf-p fer-p">
      <input type="checkbox" class="sw" ${H.sel[p.dni]?"checked":""} onchange="FER.h.sel['${esc(p.dni)}']=this.checked;ferModalBtn()">
      <div><b>${esc(p.nombre)}</b><small>${esc(String(p.area).replace(" COSTURA",""))} · ${p.tk?`${p.tk} tickets`:"sin tickets"}${Number(p.horas_min)>0?` · ya tiene ${ferHoras(p.horas_min)}`:""}</small></div></label>`).join("")
      : `<div class="vacio-msg">Nadie registró todavía. Elige un área para marcar quién viene.</div>`}</div>
    <div class="modal-acciones"><button class="btn-principal" id="ferBtn" onclick="ferGuardarHoras()"></button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`, "modal-ancho");
  ferModalBtn();
}
function ferModalBtn(){
  const H=FER.h, n=Object.keys(H.sel).filter(k=>H.sel[k]).length, b=$("ferBtn"); if(!b) return;
  const ok=n && H.min!=null && H.min>=0 && H.min<=720;
  b.disabled=!ok; b.textContent= ok ? `GUARDAR ${H.min?ferHoras(H.min):"0 h (quitar)"} A ${n}` : n ? "ELIGE LAS HORAS" : "ELIGE A ALGUIEN";
}
function ferTodos(v){ FER.h.gente.forEach(p=>FER.h.sel[p.dni]=v); ferModal(); }
async function ferArea(area){
  if(!area) return;
  try{
    const r=await rpc("fn_asistencia_marcar_lista",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_fecha:FER.h.fecha});
    if(!r || r.ok===false){ mostrarError((r&&r.error)||"Error"); return; }
    const ya=new Set(FER.h.gente.map(p=>p.dni));
    (r.personal||[]).forEach(p=>{ if(!ya.has(p.dni)) FER.h.gente.push({dni:p.dni,nombre:p.nombre,area,tk:Number(p.tickets)||0,horas_min:0}); });
    ferModal();
  }catch(e){ mostrarError(e.message); }
}
async function ferGuardarHoras(){
  const H=FER.h, dnis=Object.keys(H.sel).filter(k=>H.sel[k]);
  try{
    const r=await rpc("fn_jornada_horas_guardar",{p_dni:ING.dni,p_token:ING.token,p_fecha:H.fecha,p_minutos:H.min,p_dnis:dnis});
    if(!r || !r.ok){ mostrarError((r&&r.error)||"No se pudo guardar"); return; }
    cerrarModal();
    mostrarOk(`${ferTxt(H.fecha)}: horas guardadas a ${r.afectados}.${(r.omitidos||[]).length?" Sin cambio: "+r.omitidos.join(", "):""}`);
    ferCargar();
  }catch(e){ mostrarError(e.message); }
}
