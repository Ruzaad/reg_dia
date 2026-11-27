/* Detalle de una OF por módulo y operación: producida, cantidad y % de avance.
   Componente reutilizable (viene de Resumen de OF, que se quitó). Recibe el objeto
   de una OF como lo devuelve fn_avance_of: { modulos:[{area, modulo, estado, entrada,
   salida, es_acabado, ruta_base, operaciones:[{nop, operacion, producida, cant_prog,
   pct, estado, en_base}]}] }. Auditoría usa avofPct; avofDetalle queda listo para otras vistas. */
/* Estado del módulo/OF/operación → clase del pill. "EN PROCESO" son dos
   palabras, así que no se puede usar el estado como clase directamente. */
function avofPill(estado){
  const ok = estado==="TERMINADA" || estado==="TERMINADO" || estado==="COMPLETADO";
  return `<span class="pill ${ok?"ACTIVO":"PROCESO"}">${esc(estado||"—")}</span>`;
}
/* % de avance = producida / corte real. Barra + número, para leer de un golpe
   qué operación del balance va retrasada. */
function avofPct(p){
  if(p==null) return `<span class="sub">—</span>`;
  const v=Math.min(100,Math.max(0,+p||0)), cls=v>=100?"alto":(v<50?"bajo":"");
  return `<div class="avof-pct"><div class="avof-pct-fill ${cls}" style="width:${v}%"></div>
    <span class="avof-pct-lbl">${(+p).toFixed(1)}%</span></div>`;
}
/* Dos cuadros: costura arriba y ACABADO debajo, y este último solo si la OF
   pasó por ahí. La RPC marca cada módulo con `es_acabado`. */
function avofDetalle(r){
  const mods=r.modulos||[];
  const aca=mods.filter(m=>m.es_acabado);
  return `<div class="avof-det-wrap">`
    + avofCuadro("Costura — por módulo", mods.filter(m=>!m.es_acabado))
    + (aca.length ? avofCuadro("Acabado — por módulo", aca) : "")
    + `</div>`;
}
/* Una fila por OPERACIÓN del balance; área y módulo se agrupan con rowspan
   para no repetirlos en cada renglón. La última operación va marcada: es la
   que decide la salida y el estado del módulo. */
function avofCuadro(titulo, mods){
  const sinRuta=`<span class="avof-aviso" title="Este módulo no tiene ruta en BASE: se usa el mayor N°OP reclamado.">*</span>`;
  const body=mods.length? mods.map(m=>{
    const ops=(m.operaciones&&m.operaciones.length)? m.operaciones
      : [{nop:m.nop, operacion:m.operacion, producida:m.producida,
          cant_prog:m.cant_prog, pct:m.pct, estado:m.estado, en_base:m.ruta_base}];
    const n=ops.length;
    const cab=`<td rowspan="${n}">${esc(m.area)}</td>
      <td rowspan="${n}" class="izq"><b>${esc(m.modulo)}</b>${m.ruta_base===false?sinRuta:""}
        <div class="sub">${esc(m.entrada||"—")} → ${esc(m.salida||"—")}</div>
        <div>${avofPill(m.estado)}</div></td>`;
    return ops.map((o,j)=>`<tr${o.nop===m.nop?' class="avof-op-fin"':""}>
      ${j===0?cab:""}
      <td class="izq">${o.nop!=null?`<span class="avof-nop">${o.nop}</span> `:""}${esc(o.operacion||"—")}${o.en_base===false?sinRuta:""}</td>
      <td><b>${o.producida}</b> <span class="sub">/ ${o.cant_prog}</span></td>
      <td class="avof-pct-td">${avofPct(o.pct)}</td>
      <td>${avofPill(o.estado)}</td></tr>`).join("");
  }).join("")
    : `<tr><td colspan="6"><div class="vacio-msg">Sin módulos</div></td></tr>`;
  return `<div class="tk-ops-title">${titulo}</div>
    <table class="tabla avof-ops"><thead><tr><th>Área</th><th class="izq">Módulo</th>
      <th class="izq">Operación</th><th>Producida</th><th>%</th><th>Estado</th></tr></thead>
      <tbody>${body}</tbody></table>`;
}
