/* Bases › Agregar artículo (sin SQL nuevo).
   Se arma un artículo copiando operaciones de uno o varios de referencia, se
   comparan los tiempos (STD y lo medido por el aplicativo de tiempos) y al
   guardar pasa por el mismo diff + fn_bases_subir que el Excel.
   Las imágenes de referencia viven solo en este navegador: nunca se envían. */
const BN={refs:[],rows:[],meds:{},imgs:[]};
const BN_DESV=0.15;   // diferencia con las referencias que se marca como aviso

function bnAbrir(){
  if(!(BASE||[]).length){ mostrarError("Carga una base primero"); return; }
  BN.refs=[]; BN.rows=[]; BN.meds={}; bnLimpiarImgs();
  $("basesLista").hidden=true;
  const area=$("areaBase").value;
  $("basesNuevo").hidden=false;
  $("basesNuevo").innerHTML=`
    <div class="seccion-cab"><h1>Agregar artículo · ${esc(area)}</h1>
      <p class="seccion-sub">Busca un artículo parecido, copia sus operaciones y ajusta los tiempos. Para subir un Excel sigue estando <b>SUBIR EXCEL</b> en la lista.</p></div>
    <div class="bn-grid">
      <div class="bn-col">
        <h3>1 · Artículo nuevo</h3>
        <div class="modal-2col">
          <div class="modal-campo"><label>Código del artículo</label><input id="bnArt" maxlength="80" placeholder="Ej. 2FZ880" oninput="bnResumen()"></div>
          <div class="modal-campo"><label>Prenda</label><input id="bnPrenda" maxlength="80"></div>
        </div>
        <div class="modal-2col">
          <div class="modal-campo"><label>Cliente</label><input id="bnCliente" maxlength="80"></div>
          <div class="modal-campo"><label>Módulo <span class="cf-detalle">(vacío = el de cada referencia)</span></label><input id="bnModulo" maxlength="80"></div>
        </div>
        <h3>2 · Buscar artículos de referencia</h3>
        <input type="text" id="bnBuscar" placeholder="Código, cliente, prenda, módulo u operación… (ej. 2FZ)" oninput="bnBuscar()">
        <div class="bn-res" id="bnRes"></div>
        <h3>Imágenes de referencia <span class="cf-detalle">solo en este navegador · no se suben al sistema</span></h3>
        <div class="fila-filtros">
          <label class="btn-mini gris" style="cursor:pointer;">+ AGREGAR IMAGEN
            <input type="file" accept="image/*" multiple style="display:none" onchange="bnImagenes(this.files);this.value=''"></label>
          <span class="cf-detalle">También puedes pegar una captura (Ctrl+V). Se pierden al cerrar esta pantalla.</span>
        </div>
        <div class="bn-imgs" id="bnImgs"></div>
      </div>
      <div class="bn-col bn-ancha">
        <h3>3 · Operaciones y comparación de tiempos</h3>
        <div id="bnRefs" class="bn-refs"></div>
        <div class="contenedor-ancho bn-scroll"><table class="tabla" id="bnTabla"></table></div>
        <div class="fila-filtros">
          <button class="btn-mini gris" onclick="bnAgregarFila()">+ OPERACIÓN PROPIA</button>
        </div>
        <div id="bnResumen" class="bn-resumen"></div>
        <div class="modal-acciones">
          <button class="btn-principal btn-modal-guardar" onclick="bnGuardar()">REVISAR Y GUARDAR</button>
          <button class="btn-secundario btn-modal-cancelar" onclick="bnCerrar()">CANCELAR</button>
        </div>
      </div>
    </div>`;
  bnPintar(); bnBuscar();
  window.scrollTo(0,0);
}
function bnCerrar(){
  bnLimpiarImgs();
  $("basesNuevo").hidden=true; $("basesNuevo").innerHTML="";
  $("basesLista").hidden=false;
}

/* ---- búsqueda de referencias (sobre la base del área ya cargada) ---- */
function bnArticulos(){
  const m={};
  (BASE||[]).forEach(b=>{
    const k=normKey(b.articulo); if(!k) return;
    const a=m[k]=m[k]||{k,articulo:norm(b.articulo),prenda:"",cliente:"",mods:new Set(),ops:[],texto:"",std:0};
    if(!a.prenda) a.prenda=norm(b.prenda);
    if(!a.cliente) a.cliente=norm(b.cliente);
    if(norm(b.modulo)) a.mods.add(norm(b.modulo));
    a.ops.push(b); a.std+=Number(b.std)||0;
    a.texto+=" "+normKey(b.operacion);
  });
  Object.values(m).forEach(a=>{
    a.ops.sort((x,y)=>(Number(x.n_op)||0)-(Number(y.n_op)||0));
    a.texto=normKey(a.articulo+a.prenda+a.cliente+[...a.mods].join(""))+a.texto;
  });
  return m;
}
function bnBuscar(){
  const z=$("bnRes"); if(!z) return;
  const toks=norm(($("bnBuscar")||{}).value).split(/\s+/).map(normKey).filter(Boolean);
  const todos=Object.values(bnArticulos());
  let lista=todos.filter(a=>toks.every(t=>a.texto.includes(t)));
  const t0=toks[0]||"";
  lista.sort((x,y)=>(y.k.startsWith(t0)-x.k.startsWith(t0))||x.articulo.localeCompare(y.articulo,"es",{numeric:true}));
  const total=lista.length;
  lista=lista.slice(0,40);
  z.innerHTML = !total ? `<div class="vacio-msg">Sin coincidencias</div>`
    : lista.map(a=>{
        const usada=BN.refs.includes(a.k);
        return `<div class="bn-item${usada?" usada":""}">
          <div><b>${esc(a.articulo)}</b> <span class="cf-detalle">${esc(a.prenda)}${a.cliente?" · "+esc(a.cliente):""}</span>
            <div class="cf-detalle">${a.ops.length} op. · ${Math.round(a.std*100)/100} min${a.mods.size?" · "+esc([...a.mods].slice(0,3).join(", ")):""}</div></div>
          <button class="btn-mini ${usada?"gris":""}" onclick="bnUsar('${esc(a.k)}')">${usada?"QUITAR":"USAR"}</button>
        </div>`;
      }).join("")+(total>40?`<div class="cf-detalle">Mostrando 40 de ${total}: afina la búsqueda.</div>`:"");
}
async function bnUsar(k){
  const i=BN.refs.indexOf(k);
  if(i>=0){
    BN.refs.splice(i,1);
    BN.rows.forEach(r=>delete r.refs[k]);
    BN.rows=BN.rows.filter(r=>r.manual||Object.keys(r.refs).length);
  }else{
    const a=bnArticulos()[k]; if(!a) return;
    BN.refs.push(k);
    a.ops.forEach(b=>{
      const ok=normKey(b.operacion);
      let r=BN.rows.find(x=>!x.manual&&x.ok===ok);
      if(!r){ r={ok,operacion:norm(b.operacion),modulo:norm(b.modulo),std:Number(b.std)||0,on:true,refs:{}}; BN.rows.push(r); }
      r.refs[k]=Number(b.std)||0;
    });
    if(!norm($("bnPrenda").value)) $("bnPrenda").value=a.prenda;
    if(!norm($("bnCliente").value)) $("bnCliente").value=a.cliente;
    bnMedidos(a);
  }
  bnPintar(); bnBuscar();
}
/* Lo medido por el aplicativo de tiempos (parche 104). Si la persona no tiene
   esa pestaña la RPC falla y simplemente no se muestra la columna medida. */
async function bnMedidos(a){
  if(BN.meds[a.k]) return;
  try{
    const r=await rpc("fn_tiempos_medidos",{p_dni:ING.dni,p_token:ING.token,p_area:$("areaBase").value,p_articulo:a.articulo});
    const m={};
    if(r&&r.ok) (r.items||[]).forEach(x=>{ if(x.te_min!=null) m[normKey(x.operacion)]={te:Number(x.te_min),nivel:x.nivel,n:x.n_operarios}; });
    BN.meds[a.k]=m;
  }catch(e){ BN.meds[a.k]={}; }
  if(BN.refs.includes(a.k)) bnPintar();
}

/* ---- tabla de operaciones ---- */
function bnPintar(){
  const t=$("bnTabla"); if(!t) return;
  const arts=bnArticulos();
  $("bnRefs").innerHTML = BN.refs.length
    ? BN.refs.map(k=>`<span class="bn-chip">${esc((arts[k]||{}).articulo||k)} <button onclick="bnUsar('${esc(k)}')" title="Quitar referencia">×</button></span>`).join("")
    : `<div class="cf-detalle">Aún sin referencias: busca a la izquierda y pulsa USAR, o agrega operaciones propias.</div>`;
  const cab=BN.refs.map(k=>`<th title="STD de la referencia (⏱ = tiempo medido)">${esc((arts[k]||{}).articulo||k)}</th>`).join("");
  t.innerHTML=`<thead><tr><th></th><th>#</th><th class="izq">Operación</th><th class="izq">Módulo</th>${cab}<th>STD nuevo</th><th></th></tr></thead><tbody>`+
    BN.rows.map((r,i)=>{
      const celdas=BN.refs.map(k=>{
        const v=r.refs[k]; if(v==null) return `<td class="bn-ref">—</td>`;
        const m=(BN.meds[k]||{})[r.ok];
        return `<td class="bn-ref"><span class="bn-pick" onclick="bnPoner(${i},${v})" title="Usar este STD">${v}</span>`
          +(m?`<span class="bn-med" onclick="bnPoner(${i},${Math.round(m.te*100)/100})" title="Medido (${esc(m.nivel||"")}, ${m.n||0} operario(s)): usar">⏱ ${Math.round(m.te*100)/100}</span>`:"")+`</td>`;
      }).join("");
      return `<tr id="bnF${i}"><td><input type="checkbox" ${r.on?"checked":""} onchange="bnCampo(${i},'on',this.checked)" aria-label="Incluir"></td>
        <td class="bn-n">${bnPos(i)}</td>
        <td class="izq"><input class="base-in" value="${esc(r.operacion)}" maxlength="120" oninput="bnCampo(${i},'operacion',this.value)"></td>
        <td class="izq"><input class="base-in" value="${esc(r.modulo)}" maxlength="80" oninput="bnCampo(${i},'modulo',this.value)"></td>
        ${celdas}
        <td><input class="base-in num" id="bnS${i}" type="number" step="0.01" min="0" value="${r.std}" oninput="bnCampo(${i},'std',this.value)"></td>
        <td class="bn-acc"><button class="btn-mini gris" onclick="bnMover(${i},-1)" title="Subir">↑</button><button class="btn-mini gris" onclick="bnMover(${i},1)" title="Bajar">↓</button>${r.manual?`<button class="btn-mini rojo" onclick="bnQuitar(${i})" title="Quitar">×</button>`:""}</td></tr>`;
    }).join("")+"</tbody>";
  bnResumen();
}
function bnPos(i){ return BN.rows.slice(0,i+1).filter(r=>r.on).length||"–"; }
function bnCampo(i,k,v){
  const r=BN.rows[i]; if(!r) return;
  r[k]= k==="on" ? !!v : k==="std" ? (v===""?0:Number(v)) : v;
  if(k==="on") bnPintar(); else bnResumen();
}
function bnPoner(i,v){ BN.rows[i].std=v; const e=$("bnS"+i); if(e) e.value=v; bnResumen(); }
function bnMover(i,d){
  const j=i+d; if(j<0||j>=BN.rows.length) return;
  [BN.rows[i],BN.rows[j]]=[BN.rows[j],BN.rows[i]]; bnPintar();
}
function bnAgregarFila(){ BN.rows.push({manual:true,ok:"",operacion:"",modulo:"",std:0,on:true,refs:{}}); bnPintar(); }
function bnQuitar(i){ BN.rows.splice(i,1); bnPintar(); }

/* Resumen: total del nuevo contra cada referencia, y avisos por operación. */
function bnResumen(){
  const z=$("bnResumen"); if(!z) return;
  const inc=BN.rows.filter(r=>r.on);
  const tot=inc.reduce((a,r)=>a+(Number(r.std)||0),0);
  const arts=bnArticulos();
  const redo=x=>Math.round(x*100)/100;
  const comp=BN.refs.map(k=>{
    const a=arts[k]; if(!a) return "";
    const d=a.std>0?Math.round((tot/a.std-1)*100):0;
    return `<div class="bn-cmp"><span>${esc(a.articulo)}</span><b>${redo(a.std)} min</b><span class="${Math.abs(d)>=BN_DESV*100?"bn-warn":"cf-detalle"}">${d>0?"+":""}${d}%</span></div>`;
  }).join("");
  const av=[];
  const sinStd=inc.filter(r=>!(Number(r.std)>0));
  if(sinStd.length) av.push(`${sinStd.length} operación(es) sin STD: ${sinStd.slice(0,4).map(r=>r.operacion||"(sin nombre)").join(" · ")}`);
  const lejos=inc.filter(r=>{
    const v=Object.values(r.refs).filter(x=>x>0); if(!v.length||!(Number(r.std)>0)) return false;
    const prom=v.reduce((a,b)=>a+b,0)/v.length;
    return Math.abs(r.std/prom-1)>=BN_DESV;
  });
  if(lejos.length) av.push(`${lejos.length} operación(es) se alejan ${Math.round(BN_DESV*100)}% o más del promedio de las referencias: ${lejos.slice(0,4).map(r=>r.operacion).join(" · ")}`);
  const dup={}; inc.forEach(r=>{ const k=normKey(r.operacion); if(k) dup[k]=(dup[k]||0)+1; });
  const rep=Object.keys(dup).filter(k=>dup[k]>1);
  if(rep.length) av.push("Operaciones repetidas: "+rep.join(", "));
  z.innerHTML=`<div class="bn-cmp bn-tot"><span>${esc(norm(($("bnArt")||{}).value).toUpperCase()||"Artículo nuevo")}</span><b>${redo(tot)} min</b><span class="cf-detalle">${inc.length} operación(es)</span></div>${comp}`
    +(av.length?`<div class="hn-rev">${av.map(t=>`<div class="hn-rev-l av"><i>!</i><span>${esc(t)}</span></div>`).join("")}<div class="sub">Son avisos: puedes guardar igual.</div></div>`:"");
}

/* ---- imágenes de referencia: URL locales, jamás van a la base ---- */
function bnImagenes(files){
  [...(files||[])].filter(f=>/^image\//.test(f.type)).slice(0,12-BN.imgs.length).forEach(f=>BN.imgs.push(URL.createObjectURL(f)));
  bnPintarImgs();
}
function bnPintarImgs(){
  const z=$("bnImgs"); if(!z) return;
  z.innerHTML=BN.imgs.map((u,i)=>`<div class="bn-img"><img src="${u}" alt="Referencia ${i+1}" onclick="window.open('${u}','_blank')"><button onclick="bnQuitarImg(${i})" title="Quitar">×</button></div>`).join("");
}
function bnQuitarImg(i){ URL.revokeObjectURL(BN.imgs[i]); BN.imgs.splice(i,1); bnPintarImgs(); }
function bnLimpiarImgs(){ BN.imgs.forEach(u=>URL.revokeObjectURL(u)); BN.imgs=[]; }
document.addEventListener("paste",e=>{
  if(!$("basesNuevo")||$("basesNuevo").hidden) return;
  const fs=[...(e.clipboardData&&e.clipboardData.files||[])];
  if(fs.length) bnImagenes(fs);
});

/* ---- guardar: reutiliza el diff y la subida del Excel ---- */
function bnGuardar(){
  const art=norm($("bnArt").value).toUpperCase();
  if(!art){ mostrarError("Escribe el código del artículo"); return; }
  if((BASE||[]).some(b=>normKey(b.articulo)===normKey(art))){
    mostrarError(`${art} ya existe en ${$("areaBase").value}: edítalo con EDITAR ARTÍCULO`); return;
  }
  const inc=BN.rows.filter(r=>r.on);
  if(!inc.length){ mostrarError("Marca al menos una operación"); return; }
  if(inc.some(r=>!norm(r.operacion))){ mostrarError("Hay operaciones sin nombre"); return; }
  const prenda=norm($("bnPrenda").value).toUpperCase(), cliente=norm($("bnCliente").value).toUpperCase(), mod=norm($("bnModulo").value);
  const filas=inc.map((r,i)=>({prenda,cliente,modulo:mod||norm(r.modulo),articulo:art,
    operacion:norm(r.operacion),std:Number(r.std)||0,max_op:inc.length,n_op:i+1}));
  bnCerrar();
  mostrarDiff(filas);
}
