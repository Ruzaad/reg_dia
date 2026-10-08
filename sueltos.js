/* ================= PAQUETES SUELTOS (parche 115) =================
   Paquetes que nadie reclamó en OFs que ya avanzaron. Solo lectura: una
   llamada al abrir la pestaña (fn_paquetes_sueltos) y otra al abrir una OF
   (fn_paquetes_sueltos_of). En la supervisora, lo mismo solo de su área. */

const PS={items:[], hoy:"", sin_generar:0, det:null, cargando:false};
const psN = n => Number(n||0).toLocaleString("es-PE");
const psDM = f => { const p=String(f||"").slice(0,10).split("-"); return p.length===3?`${p[2]}/${p[1]}`:""; };
const psSesion = () => (typeof ING!=="undefined" && ING && ING.dni) ? ING : sesionActual();
/* [1,2,3,5] → "1-3, 5" */
function psRangos(ps){
  const o=[]; for(let i=0;i<ps.length;i++){ let j=i; while(j+1<ps.length && ps[j+1]===ps[j]+1) j++;
    o.push(i===j?`${ps[i]}`:`${ps[i]}-${ps[j]}`); i=j; } return o.join(", ");
}
const psFalta = e => /Could not find the function|PGRST202/i.test(String(e&&e.message||e||""));
const PS_FALTA_HTML = `<div class="acf-falta"><b>Falta correr el parche 115 en la base.</b> Esta pantalla lista los paquetes que nadie reclamó en OFs que ya avanzaron, con quién hizo la mayoría de cada operación.</div>`;
const psEstado = r => r.parada
  ? `<span class="tag r">Parada desde ${esc(psDM(r.ult))}</span>`
  : `<span class="tag o">En curso · hueco desde ${esc(psDM(r.hueco))}</span>`;
function psBarra(r, cls){
  const t=(r.saltados+r.sin_registrar+r.nadie)||1, w=v=>(v/t*100).toFixed(1)+"%";
  return `<div class="${cls||"ps-bar"}" role="img" aria-label="${r.saltados} saltados, ${r.sin_registrar} sin registrar en la OF, ${r.nadie} que nadie registra">
    <i class="c-salt" style="width:${w(r.saltados)}"></i><i class="c-open" style="width:${w(r.sin_registrar)}"></i><i class="c-fant" style="width:${w(r.nadie)}"></i></div>`;
}

/* ---------------- INGENIERÍA ---------------- */
async function psCargar(){
  const z=$("psZona"); if(!z || PS.cargando) return;
  const sa=$("psArea");
  if(sa && sa.options.length<2){ const v=sa.value;
    sa.innerHTML=`<option value="">Todas mis áreas</option>`+(AREAS_LISTA||[]).filter(a=>!/ACABADO|CORTE|REPROCESO|DESPACHO|UDP|ALMACEN/.test(a)).map(a=>`<option>${esc(a)}</option>`).join("");
    sa.value=v; }
  const s=psSesion(); PS.cargando=true;
  pintarCargando(z,"Revisando los paquetes de cada OF…");
  try{
    const r=await rpc("fn_paquetes_sueltos",{p_dni:s.dni,p_token:s.token,p_area:sa?sa.value:""});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    PS.items=r.items||[]; PS.hoy=r.hoy; PS.sin_generar=r.sin_generar||0;
    psPintar();
  }catch(e){ z.innerHTML = psFalta(e) ? PS_FALTA_HTML : `<div class="vacio-msg">${esc(e.message)}</div>`; }
  finally{ PS.cargando=false; }
}
function psFiltrar(){
  const ed=Number((($("psEdad")||{}).value)||0), mot=(($("psMot")||{}).value||""), q=normKey((($("psQ")||{}).value||""));
  return PS.items.filter(r=>
    (!ed || (ed===5 ? r.dias>=5&&r.dias<=10 : ed===11 ? r.dias>=11&&r.dias<=20 : r.dias>20)) &&
    (!mot || r[mot]>0) &&
    (!q || normKey(r.o_f+" "+r.articulo).includes(q)));
}
function psPintar(){
  const z=$("psZona"); if(!z) return;
  const xs=psFiltrar(), sum=(a,k)=>a.reduce((s,r)=>s+Number(r[k]||0),0);
  if(!PS.items.length){ z.innerHTML=`<div class="vacio-msg">Sin paquetes sueltos en tus áreas 👏</div>`; return; }
  const kpi=(t,v,c)=>`<div class="kpi"><div class="kpi-num"${c?` style="color:${c}"`:""}>${v}</div><div class="kpi-lbl">${t}</div></div>`;
  const areas=[...new Set(xs.map(r=>r.area))].sort((a,b)=>a.localeCompare(b,"es"));
  const tarj=`<div class="ps-areas">${areas.map(a=>{ const ys=xs.filter(r=>r.area===a);
    const t={saltados:sum(ys,"saltados"),sin_registrar:sum(ys,"sin_registrar"),nadie:sum(ys,"nadie")};
    return `<button type="button" class="ps-ar" onclick="psArea('${esc(a)}')"><span class="t">${esc(a)}</span>
      <span class="n">${psN(sum(ys,"paq"))} <small>paquetes en ${ys.length} OF</small></span>
      <span class="s">${psN(sum(ys,"min"))} min sin registrar · ${ys.filter(r=>r.parada).length} OF paradas</span>${psBarra(t)}</button>`; }).join("")}</div>`;
  const ley=`<div class="ps-ley"><span><i class="c-salt"></i>Saltados: la operación siguió con paquetes posteriores</span>
    <span><i class="c-open"></i>Operación que nadie registró en esa OF (sí en otras)</span>
    <span><i class="c-fant"></i>Operación que nadie registra en ninguna OF: revisar BASE</span></div>`;
  const fila=r=>`<tr><td class="izq"><b>${esc(r.o_f)}</b></td><td class="izq">${esc(r.articulo||"")}</td><td>${psEstado(r)}</td>
    <td>${r.acabado?`<span class="tag a">Sí · ${esc(psDM(r.acabado))}</span>`:`<span class="sub">Aún no</span>`}</td>
    <td><b>${psN(r.paq)}</b></td><td>${psN(r.min)}</td><td>${r.ops}</td><td class="nw">${psBarra(r,"ps-mini")}</td>
    <td><b${r.dias>20?' style="color:var(--alerta)"':""}>${r.dias}</b></td>
    <td class="nw"><button class="btn-mini gris" onclick="psVer('${esc(r.area)}','${esc(r.o_f)}')">Ver</button></td></tr>`;
  z.innerHTML=`<div class="kpis" style="margin-bottom:14px">
      ${kpi("Paquetes sueltos",psN(sum(xs,"paq")),"var(--alerta)")}${kpi("OF con sueltos",psN(xs.length))}
      ${kpi("Minutos sin registrar",psN(sum(xs,"min")))}${kpi("Ya pasaron a ACABADO",`${xs.filter(r=>r.acabado).length}/${xs.length}`)}
      ${kpi("Venían de un liberado",psN(sum(xs,"liberados")))}</div>
    ${tarj}${ley}
    ${PS.sin_generar?`<div class="ps-nota"><b>${PS.sin_generar} OF</b> registradas hace más de 2 semanas nunca generaron tickets. No salen aquí porque no tienen paquetes: se ven en Tickets › Generar tickets.</div>`:""}
    ${xs.length?`<div class="contenedor-ancho tabla-scroll"><table class="tabla ps-tabla"><thead><tr><th class="izq">OF</th><th class="izq">Artículo</th><th>Estado en el área</th>
      <th>ACABADO ya registró</th><th>Paquetes</th><th>Minutos</th><th>Operaciones</th><th>Por qué</th><th>Días hábiles</th><th></th></tr></thead><tbody>
      ${areas.map(a=>{ const ys=xs.filter(r=>r.area===a);
        return `<tr class="ir-grupo"><td colspan="10">${esc(a)}<span>${ys.length} OF · ${psN(sum(ys,"paq"))} paquetes</span></td></tr>${ys.map(fila).join("")}`; }).join("")}
      </tbody></table></div>`:`<div class="vacio-msg">Nada con ese filtro</div>`}`;
}
function psArea(a){ const s=$("psArea"); if(!s) return; s.value = s.value===a ? "" : a;
  if(typeof G!=="undefined" && G) G.area=s.value; psCargar(); }

/* Detalle de una OF: panel lateral (Ingeniería) o tarjeta abierta (supervisora). */
async function psCargarOF(area, of){
  const s=psSesion();
  const r=await rpc("fn_paquetes_sueltos_of",{p_dni:s.dni,p_token:s.token,p_area:area,p_of:of});
  if(!r.ok) throw new Error(r.error||"No se pudo");
  return r.ops||[];
}
async function psVer(area, of){
  const r=PS.items.find(x=>x.area===area&&x.o_f===of); if(!r) return;
  psCerrar();
  const v=document.createElement("div"); v.className="ps-velo"; v.onclick=psCerrar;
  const p=document.createElement("aside"); p.className="ps-panel"; p.setAttribute("role","dialog"); p.setAttribute("aria-label","OF "+of);
  p.innerHTML=`<div class="ps-cab"><div><h2>OF ${esc(of)} · ${esc(r.articulo||"")}</h2>
      <p class="sub">${esc(area)} · ${psN(r.paq)} paquetes sueltos · ${psN(r.min)} min · ${psEstado(r)}
      ${r.acabado?` <span class="tag a">ACABADO registró hasta el ${esc(psDM(r.acabado))}</span>`:""}</p></div>
      <button class="btn-mini gris" onclick="psCerrar()" aria-label="Cerrar">✕</button></div>
    <div id="psDet">${cargandoHTML("Cargando operaciones…")}</div>`;
  document.body.append(v,p);
  document.addEventListener("keydown", psEsc);
  try{
    const ops=await psCargarOF(area, of); PS.det={area, of, r, ops};
    const fila=o=>`<tr><td class="izq">${esc(o.modulo||"")}</td><td class="izq"><b>${esc(o.op)}</b></td><td><b>${o.paqs.length}</b></td>
      <td class="izq ps-rng">${esc(psRangos(o.paqs))}</td><td>${psN(o.min)}</td>
      <td class="izq ps-quien">${o.nombre?`<b>${esc(o.nombre)}</b><small>registró ${o.n} de ${o.tot} paq. de esta operación</small>`
        : o.motivo==="NADIE"?`<span class="tag p">Nadie la registra en ninguna OF: revisar BASE</span>`:`<span class="tag o">Nadie la registró en esta OF</span>`}</td>
      <td>${o.desde?esc(psDM(o.desde)):"—"}</td></tr>`;
    $("psDet").innerHTML=`<div class="tabla-scroll"><table class="tabla ps-tabla"><thead><tr><th class="izq">Módulo</th><th class="izq">Operación</th><th>Paq.</th>
        <th class="izq">Paquetes sueltos</th><th>Min</th><th class="izq">Quién hizo la mayoría</th><th>Saltado desde</th></tr></thead>
        <tbody>${ops.map(fila).join("")}</tbody></table></div>
      <div class="ps-pie"><button class="btn-mini" onclick="psCopiar()">📋 Copiar lista para WhatsApp</button>
        <button class="btn-mini gris" onclick="psCerrar();irAvanceModulo('${esc(area)}','${esc(of)}')">Abrir en Avance por módulo</button></div>
      <p class="sub ps-pista">"Quién hizo la mayoría" es solo una pista: es quien registró más paquetes de esa operación en esta OF. Nada se asigna solo.</p>`;
  }catch(e){ $("psDet").innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
}
function psEsc(e){ if(e.key==="Escape") psCerrar(); }
function psCerrar(){ document.querySelectorAll(".ps-velo,.ps-panel").forEach(x=>x.remove()); document.removeEventListener("keydown", psEsc); }
function irAvanceModulo(area, of){
  if(typeof activarTab!=="function") return;
  activarTab("pasoMod");
  setTimeout(()=>{ const a=$("areaMod"); if(a){ a.value=area; a.dispatchEvent(new Event("change")); }
    const o=$("ofMod")||$("modOF"); if(o){ o.value=of; o.dispatchEvent(new Event("change")); } }, 50);
}
/* Texto para WhatsApp: OF, operación y paquetes. */
function psTexto(of, ops, area){
  return `*OF ${of}* · ${area}\nPaquetes sin registrar:\n`
    + ops.map(o=>`• ${o.op}: ${psRangos(o.paqs)}${o.nombre?` (la hizo más ${soloApellidos(o.nombre)})`:""}`).join("\n");
}
async function psCopiar(){
  const d=PS.det; if(!d) return;
  try{ await navigator.clipboard.writeText(psTexto(d.of, d.ops, d.area)); mostrarOk("Lista copiada"); }
  catch(e){ mostrarError("No se pudo copiar"); }
}
function psDescargar(){
  const xs=psFiltrar(); if(!xs.length){ mostrarError("No hay datos para descargar"); return; }
  const CAB=["Área","OF","Artículo","Estado","Último reclamo","Hueco desde","Días hábiles","Paquetes","Minutos","Operaciones","Saltados","Sin registrar en la OF","Nadie la registra","Venían de un liberado","ACABADO registró"];
  const filas=xs.map(r=>[r.area,r.o_f,r.articulo,r.parada?"PARADA":"EN CURSO",r.ult||"",r.hueco||"",r.dias,r.paq,r.min,r.ops,r.saltados,r.sin_registrar,r.nadie,r.liberados,r.acabado||""]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CAB,...filas]), "PAQUETES SUELTOS");
  XLSX.writeFile(wb, `PAQUETES_SUELTOS_${PS.hoy||""}.xlsx`);
}

/* ---------------- SUPERVISORA (celular) ---------------- */
async function psCargarSup(){
  const z=$("psSupZona"); if(!z) return;
  const s=sesionActual(); if(!s) return;
  pintarCargando(z,"Revisando los paquetes de tu área…");
  try{
    const r=await rpc("fn_paquetes_sueltos",{p_dni:s.dni,p_token:s.token,p_area:areaSup()});
    if(!r.ok){ z.innerHTML=`<div class="vacio-msg">${esc(r.error||"No se pudo")}</div>`; return; }
    PS.items=r.items||[];
    const q=PS.items.filter(x=>x.parada).length, h=PS.items.length-q;
    z.innerHTML = PS.items.length ? `<div class="cel-res"><div class="r"><b>${q}</b>OF paradas</div><div><b>${h}</b>en curso con huecos</div></div>`
      + PS.items.map((r,i)=>`<div class="cel-card ${r.parada?"r":"o"}" id="psc${i}">
          <div class="cel-top"><b>OF ${esc(r.o_f)}</b><span class="tag ${r.parada?"r":"o"}">${r.dias} días háb.</span></div>
          <div class="cel-l">${esc(r.articulo||"")} · ${psN(r.paq)} paquetes · ${r.ops} operaciones · ${r.parada?`parada desde ${esc(psDM(r.ult))}`:`hueco desde ${esc(psDM(r.hueco))}`}</div>
          <div class="ps-ops" id="psOps${i}"></div>
          <div class="cel-btns"><button type="button" class="az" onclick="psAbrirSup(${i})" style="grid-column:1/-1" aria-expanded="false">Ver operaciones</button></div></div>`).join("")
      : `<div class="vacio-msg">Sin paquetes sueltos en tu área 👏</div>`;
  }catch(e){ z.innerHTML = psFalta(e) ? PS_FALTA_HTML : `<div class="vacio-msg">${esc(e.message)}</div>`; }
}
async function psAbrirSup(i){
  const r=PS.items[i], z=$("psOps"+i), b=document.querySelector(`#psc${i} .cel-btns button`); if(!r||!z) return;
  if(b && b.getAttribute("aria-expanded")==="true" && PS.det && PS.det.of===r.o_f){ psCopiar(); return; }
  pintarCargando(z,"Cargando…");
  try{
    const ops=await psCargarOF(r.area, r.o_f); PS.det={area:r.area, of:r.o_f, r, ops};
    const max=8;
    z.innerHTML=ops.slice(0,max).map(o=>`<div class="ps-op"><div class="o">${esc(o.op)}</div>
        <div class="p">${o.paqs.length} paq. · ${esc(psRangos(o.paqs))}</div>
        ${o.nombre?`<div class="q">Hizo la mayoría: <b>${esc(soloApellidos(o.nombre))}</b> (${o.n} de ${o.tot})</div>`:`<div class="q nadie">${o.motivo==="NADIE"?"Nadie la registra en ninguna OF: revisar BASE":"Nadie la registró en esta OF"}</div>`}</div>`).join("")
      + (ops.length>max?`<div class="cel-l">… y ${ops.length-max} operaciones más (salen en la lista copiada)</div>`:"");
    if(b){ b.textContent="📋 Copiar lista para WhatsApp"; b.setAttribute("aria-expanded","true"); }
  }catch(e){ z.innerHTML=`<div class="vacio-msg">${esc(e.message)}</div>`; }
}
