/* =====================================================================
   SAMITEX · Ingeniería › Asistencia por confirmar (QA, parche 111)
   Quien registró tickets ya cuenta como presente. Aquí sale solo quien no
   registró nada y nadie le marcó estado: mientras nadie lo confirme, el
   sistema le exige sus 575 minutos y en Incentivos su día sale NO ENTREGÓ.
   Una sola RPC de lectura (fn_asistencia_por_confirmar) para la tabla; el
   botón "Confirmar" usa las mismas RPC de la supervisora.
   ===================================================================== */
let ACF={r:null, conf:null};
const ACF_DIAS=["dom","lun","mar","mié","jue","vie","sáb"];
const acfDM=f=>f.slice(8,10)+"/"+f.slice(5,7);
function acfHabilAnt(iso,n){ const [y,m,d]=iso.split("-").map(Number); const f=new Date(y,m-1,d); let k=0;
  while(k<n){ f.setDate(f.getDate()-1); if(f.getDay()!==0&&f.getDay()!==6) k++; } return f.toLocaleDateString("sv-SE"); }
function acfInit(){ acfCargar(); }
async function acfCargar(){
  const hoy=hoyLima(), hasta=acfHabilAnt(hoy,1), desde=acfHabilAnt(hoy,10);
  const box=$("acfCuerpo"); box.innerHTML=cargandoHTML("Revisando asistencia…"); $("acfKpis").innerHTML="";
  try{
    const r=await rpc("fn_asistencia_por_confirmar",{p_dni:ING.dni,p_token:ING.token,p_desde:desde,p_hasta:hasta});
    if(!r || !r.ok){ box.innerHTML=`<div class="acf-falta">${esc((r&&r.error)||"Error")}</div>`; return; }
    ACF.r=r; acfPintar();
  }catch(e){
    box.innerHTML = /fn_asistencia_por_confirmar|404|PGRST202|Could not find/i.test(e.message)
      ? `<div class="acf-falta"><b>Falta correr el parche 111 en la base.</b> Esta pantalla lee con la función nueva <code>fn_asistencia_por_confirmar</code> (solo lectura). La supervisora ya puede confirmar "Ayer" desde su celular sin el parche.</div>`
      : `<div class="acf-falta">${esc(e.message)}</div>`;
  }
}
function acfNivel(n,tot){ return !n?"ok":n>=Math.max(5,tot/2)?"grave":n>=5?"alto":"poco"; }
function acfQuien(a){
  const corto=String(a.area).replace(" COSTURA","");
  if(a.ult_sup) return `<span class="acf-q ok">La supervisora marca</span><small>última vez ${esc(acfDM(a.ult_sup))}</small>`;
  if(a.marca_ofi) return `<span class="acf-q mal">La supervisora no marcó</span><small>Ingeniería carga al cierre</small>`;
  return `<span class="acf-q mal">Nadie marca</span><small>${esc(corto)} sin asistencia</small>`;
}
function acfPintar(){
  const r=ACF.r, dias=r.dias||[], ult=dias[dias.length-1];
  const areas=(r.areas||[]).filter(a=>a.personas>0);
  const ayer=areas.reduce((s,a)=>s+((a.por_dia||{})[ult]||0),0);
  const conAyer=areas.filter(a=>(a.por_dia||{})[ult]).length;
  const tot=areas.reduce((s,a)=>s+Object.values(a.por_dia||{}).reduce((x,y)=>x+y,0),0);
  const alDia=areas.filter(a=>!Object.values(a.por_dia||{}).some(Boolean)).map(a=>a.area.replace(" COSTURA",""));
  $("acfKpis").innerHTML=`
    <div class="acf-k"><b class="rojo">${ayer}</b><span>personas por confirmar el ${esc(acfTxt(ult))}, en ${conAyer} área${conAyer===1?"":"s"}</span></div>
    <div class="acf-k"><b class="rojo">${tot}</b><span>días-persona sin confirmar en los últimos ${dias.length} días hábiles</span></div>
    <div class="acf-k"><b class="verde">${alDia.length}</b><span>área${alDia.length===1?"":"s"} al día${alDia.length?": "+esc(alDia.join(" y ")):""}</span></div>`;
  const filas=areas.map(a=>{
    const pd=a.por_dia||{}, n=pd[ult]||0;
    return `<tr><th scope="row">${esc(a.area)}<small>${a.personas} personas</small></th>
      <td class="acf-quien">${acfQuien(a)}</td>
      ${dias.map(d=>{ const v=pd[d]||0, nv=acfNivel(v,a.personas);
        return `<td class="acf-c"><span class="acf-n ${nv}" title="${esc(acfTxt(d))}: ${v} por confirmar">${v||"✓"}</span></td>`; }).join("")}
      <td>${n?`<button class="btn-mini acf-btn" onclick="acfConfirmar('${esc(a.area)}','${ult}')">Confirmar ${n}</button>`:""}</td></tr>`;
  }).join("");
  $("acfCuerpo").innerHTML=`<div class="contenedor-ancho tabla-scroll"><table class="tabla acf-tabla">
    <thead><tr><th>Área</th><th>Quién marca</th>${dias.map(d=>`<th class="acf-c${d===ult?" ult":""}">${esc(acfDM(d))}</th>`).join("")}<th></th></tr></thead>
    <tbody>${filas}</tbody></table></div>
    <div class="acf-ley"><span class="acf-n ok">✓</span> todos confirmados <span class="acf-n poco">2</span> pocos por confirmar
      <span class="acf-n alto">7</span> 5 o más <span class="acf-n grave">21</span> media área o más</div>`;
}
function acfTxt(iso){ const [y,m,d]=iso.split("-").map(Number); return `${ACF_DIAS[new Date(y,m-1,d).getDay()]} ${acfDM(iso)}`; }

/* Confirmar desde Ingeniería: la misma lista que ve la supervisora en "Ayer". */
async function acfConfirmar(area, fecha){
  try{
    const r=await rpc("fn_asistencia_marcar_lista",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_fecha:fecha});
    if(!r || r.ok===false){ mostrarError((r&&r.error)||"Error"); return; }
    const pend=(r.personal||[]).filter(p=>!(Number(p.tickets)>0) && !p.estado_guardado);
    ACF.conf={area, fecha, pend, dec:{}};
    acfConfPintar();
  }catch(e){ mostrarError(e.message); }
}
function acfConfPintar(){
  const c=ACF.conf, n=Object.keys(c.dec).length;
  const b=(p,e,t)=>`<button type="button" class="asy-b${e==="ACTIVO"?" vino":""}${c.dec[p.dni]===e?" sel":""}" onclick="acfSet('${esc(p.dni)}','${e}')">${t}</button>`;
  abrirModal(`<h2>${esc(c.area)} · ${esc(acfTxt(c.fecha))}</h2>
    <p class="seccion-sub">${c.pend.length} sin tickets ni estado. "Vino" lo deja en Boletas sin llenar para avisarle.</p>
    <div class="acf-todos"><button type="button" class="btn-mini" onclick="acfTodos('ACTIVO')">Todos vinieron</button>
      <button type="button" class="btn-mini" onclick="acfTodos('FALTA')">Todos faltaron</button></div>
    <div class="acf-lista">${c.pend.map(p=>`<div class="acf-p"><div><b>${esc(p.nombre)}</b><small>DNI ${esc(p.dni)}</small></div>
      <div class="acf-pb">${b(p,"ACTIVO","✓ Vino")}${b(p,"FALTA","Faltó")}${b(p,"DM","DM")}${b(p,"VACACIONES","Vacaciones")}</div></div>`).join("")}</div>
    <div class="modal-acciones"><button class="btn-principal" onclick="acfGuardar()" ${n?"":"disabled"}>GUARDAR (${n} de ${c.pend.length})</button>
      <button class="btn-secundario btn-modal-cancelar" onclick="cerrarModal()">CANCELAR</button></div>`, "modal-ancho");
}
function acfSet(dni,e){ const c=ACF.conf; if(c.dec[dni]===e) delete c.dec[dni]; else c.dec[dni]=e; acfConfPintar(); }
function acfTodos(e){ const c=ACF.conf; c.pend.forEach(p=>c.dec[p.dni]=e); acfConfPintar(); }
async function acfGuardar(){
  const c=ACF.conf, marcas=Object.keys(c.dec).map(d=>({dni:d,estado:c.dec[d]}));
  try{
    const r=await rpc("fn_asistencia_marcar_guardar",{p_dni:ING.dni,p_token:ING.token,p_fecha:c.fecha,p_marcas:marcas});
    if(r && r.ok===false){ mostrarError(r.error||"No se pudo guardar"); return; }
    cerrarModal(); mostrarOk(`${c.area}: asistencia del ${acfTxt(c.fecha)} guardada (${(r&&r.afectados)||marcas.length}).`);
    acfCargar();
  }catch(e){ mostrarError(e.message); }
}
