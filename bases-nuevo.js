/* Bases › Agregar artículo (sin SQL nuevo).
   Se arma un artículo copiando operaciones de uno o varios de referencia, se
   comparan los tiempos (STD y lo medido por el aplicativo de tiempos) y al
   guardar pasa por el mismo diff + fn_bases_subir que el Excel.
   Las imágenes de referencia viven solo en este navegador (IndexedDB): nunca se envían. */
/* Un bloque = un artículo nuevo (referencias, operaciones y comparación). «Agregar artículo» abre uno;
   «Varios artículos» abre tantos como se necesiten, cada uno con sus propias referencias.
   BN apunta al bloque activo (se fija al tocar cualquier cosa dentro de él, ver bnCtx). */
const BNS=[]; let BN=null, BX=0, BN_MULTI=false;
const bnEstado=i=>({i,refs:[],rows:[],meds:{},imgs:[],art:"",prenda:"",cliente:"",modulo:""});   // imgs: [{id,url}]
function bnCtx(i){ if(BNS[i]){ BX=i; BN=BNS[i]; } }
const bq=id=>$(id+"_"+BX);
const BN_DESV=0.15;   // diferencia con las referencias que se marca como aviso

function bnBloqueHTML(i){
  const B=BNS[i], multi=BN_MULTI, s="_"+i;
  return `<div class="bn-blk" id="bnBlk_${i}" data-bk="${i}">
    ${multi?`<div class="fila-filtros bn-blk-cab"><h2>Artículo ${i+1}</h2>${BNS.length>1?`<button class="btn-mini rojo" onclick="bnQuitarBloque(${i})">QUITAR ARTÍCULO</button>`:""}</div>
    <div class="modal-msg" id="bnMsg${s}"></div>`:""}
    <div class="bn-grid">
      <div class="bn-col">
        <h3>1 · Artículo nuevo</h3>
        <div class="modal-2col">
          <div class="modal-campo"><label>Código del artículo</label><input id="bnArt${s}" maxlength="80" placeholder="Ej. 2FZ880" value="${esc(B.art)}" oninput="bnResumen()" onchange="${multi?"":"bnImgDeArticulo()"}"></div>
          <div class="modal-campo"><label>Prenda</label><input id="bnPrenda${s}" maxlength="80" value="${esc(B.prenda)}"></div>
        </div>
        <div class="modal-2col">
          <div class="modal-campo"><label>Cliente</label><input id="bnCliente${s}" maxlength="80" value="${esc(B.cliente)}"></div>
          <div class="modal-campo"><label>Módulo <span class="cf-detalle">(vacío = el de cada referencia)</span></label><input id="bnModulo${s}" maxlength="80" value="${esc(B.modulo)}"></div>
        </div>
        <h3>2 · Buscar artículos de referencia</h3>
        <input type="text" id="bnBuscar${s}" placeholder="Código, cliente, prenda, módulo u operación… (ej. 2FZ)" value="${esc(B.q||"")}" oninput="bnBuscar()">
        <div class="bn-res" id="bnRes${s}"></div>
        ${multi?"":`<h3>Imágenes de referencia <span class="cf-detalle">se guardan en este navegador · no se suben al sistema</span></h3>
        <div class="fila-filtros">
          <label class="btn-mini gris" style="cursor:pointer;">+ AGREGAR IMAGEN
            <input type="file" accept="image/*" multiple style="display:none" onchange="bnImagenes(this.files);this.value=''"></label>
          <span class="cf-detalle">También puedes pegar una captura (Ctrl+V). Quedan guardadas en este navegador y equipo; si borras los datos del navegador se pierden.</span>
        </div>
        <div class="bn-imgs" id="bnImgs${s}"></div>`}
      </div>
      <div class="bn-col bn-ancha">
        <h3>3 · Operaciones y comparación de tiempos</h3>
        <div id="bnRefs${s}" class="bn-refs"></div>
        <div class="contenedor-ancho bn-scroll"><table class="tabla sin-orden sin-filtro" id="bnTabla${s}"></table></div>
        <div class="fila-filtros">
          <button class="btn-mini gris" onclick="bnAgregarFila()">+ OPERACIÓN PROPIA</button>
          ${multi?`<button class="btn-mini gris" onclick="bnPegarOps()">PEGAR OPERACIONES</button>`:""}
        </div>
        <div id="bnResumen${s}" class="bn-resumen"></div>
        ${multi?"":`<div class="modal-acciones">
          <button class="btn-principal btn-modal-guardar" onclick="bnGuardar()">REVISAR Y GUARDAR</button>
          <button class="btn-secundario btn-modal-cancelar" onclick="bnCerrar()">CANCELAR</button>
        </div>`}
      </div>
    </div>${multi?"<hr class=\"bn-sep\">":""}</div>`;
}
/* Lo escrito en los campos vuelve al estado del bloque, para repintar sin perderlo. */
function bnGuardarCampos(){
  BNS.forEach((B,i)=>{
    const v=id=>{ const e=$(id+"_"+i); return e?e.value:null; };
    const g=(k,id)=>{ const x=v(id); if(x!==null) B[k]=x; };
    g("art","bnArt"); g("prenda","bnPrenda"); g("cliente","bnCliente"); g("modulo","bnModulo"); g("q","bnBuscar");
  });
}
function bnRender(){
  const area=$("areaBase").value;
  $("basesNuevo").innerHTML=(BN_MULTI
    ?`<div class="seccion-cab"><h1>Varios artículos · ${esc(area)}</h1></div><div id="bnInforme"></div>`
    :`<div class="seccion-cab"><h1>Agregar artículo · ${esc(area)}</h1>
      <p class="seccion-sub">Busca un artículo parecido, copia sus operaciones y ajusta los tiempos. Para subir un Excel sigue estando <b>SUBIR EXCEL</b> en la lista.</p></div>`)
    +BNS.map((_,i)=>bnBloqueHTML(i)).join("")
    +(BN_MULTI?`<div class="fila-filtros">
        <button class="btn-mini azul" onclick="bnAgregarBloque()">+ OTRO ARTÍCULO</button></div>
      <div class="modal-acciones">
        <button class="btn-principal btn-modal-guardar" id="bnTodosOk" onclick="bnRegistrarTodos()">REGISTRAR TODOS</button>
        <button class="btn-secundario btn-modal-cancelar" onclick="bnCerrar()">CANCELAR</button>
      </div>`:"");
  const z=$("basesNuevo");
  if(!z.dataset.ctx){            // al tocar algo de un bloque, ese bloque pasa a ser el activo
    z.dataset.ctx="1";
    ["pointerdown","focusin","click","input","change","paste"].forEach(ev=>z.addEventListener(ev,e=>{
      const b=e.target.closest&&e.target.closest(".bn-blk"); if(b) bnCtx(+b.dataset.bk);
    },true));
  }
  BNS.forEach((_,i)=>{ bnCtx(i); bnPintar(); bnBuscar(); });
  bnCtx(0);
}
function bnAbrir(multi){
  if(!(BASE||[]).length){ mostrarError("Carga una base primero"); return; }
  BN_MULTI=multi===true;
  BNS.length=0; BNS.push(bnEstado(0)); bnCtx(0);
  $("basesLista").hidden=true;
  $("basesNuevo").hidden=false;
  bnRender();
  if(!BN_MULTI){ bnLimpiarImgs(); bnImgCargar("_borrador"); }
  window.scrollTo(0,0);
}
function bnAgregarBloque(){
  bnGuardarCampos(); BNS.push(bnEstado(BNS.length)); bnRender();
  const e=$("bnBlk_"+(BNS.length-1)); if(e) e.scrollIntoView({behavior:"smooth",block:"start"});
}
function bnQuitarBloque(i){
  bnGuardarCampos(); BNS.splice(i,1); BNS.forEach((b,k)=>{ b.i=k; }); bnRender();
}
function bnCerrar(){
  if(!BN_MULTI) bnLimpiarImgs();
  BNS.length=0; BNS.push(bnEstado(0)); bnCtx(0);
  $("basesNuevo").hidden=true; $("basesNuevo").innerHTML="";
  $("basesLista").hidden=false;
}
/* Pegar operaciones desde Excel: Operación, STD y Módulo (tabuladas, una por fila). */
async function bnPegarOps(){
  const B=BN;
  try{
    const txt=await navigator.clipboard.readText();
    const filas=String(txt||"").replace(/\r/g,"").split("\n").map(l=>l.split("\t")).filter(c=>norm(c[0]));
    if(!filas.length){ mostrarError("No hay filas copiadas"); return; }
    filas.forEach(c=>{
      const std=parseFloat(String(c[1]||"").replace(",","."));
      B.rows.push({manual:true,ok:"",operacion:norm(c[0]),modulo:norm(c[2]),std:isFinite(std)?std:0,on:true,refs:{},sel:""});
    });
    bnCtx(B.i); bnPintar(); mostrarOk(`${filas.length} operación(es) pegadas`);
  }catch(e){ mostrarError("Copia las filas en Excel (Operación, STD, Módulo) y vuelve a pulsar"); }
}

/* ---- búsqueda de referencias (sobre la base del área ya cargada) ---- */
let BN_MEMO={b:null,m:null};
function bnArticulos(){
  if(BN_MEMO.b===BASE && BN_MEMO.m) return BN_MEMO.m;
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
  BN_MEMO={b:BASE,m};
  return m;
}
function bnBuscar(){
  const z=bq("bnRes"); if(!z) return;
  const toks=norm((bq("bnBuscar")||{}).value).split(/\s+/).map(normKey).filter(Boolean);
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
    BN.rows.forEach(r=>{ delete r.refs[k]; if(r.sel&&r.sel.replace("*","")===k) r.sel=""; });
    BN.rows=BN.rows.filter(r=>r.manual||Object.keys(r.refs).length);
  }else{
    const a=bnArticulos()[k]; if(!a) return;
    BN.refs.push(k);
    a.ops.forEach(b=>{
      const ok=normKey(b.operacion);
      let r=BN.rows.find(x=>!x.manual&&x.ok===ok);
      if(!r){ r={ok,operacion:norm(b.operacion),modulo:norm(b.modulo),std:Number(b.std)||0,on:true,refs:{},sel:k}; BN.rows.push(r); }
      r.refs[k]=Number(b.std)||0;
    });
    if(!norm(bq("bnPrenda").value)) bq("bnPrenda").value=a.prenda;
    if(!norm(bq("bnCliente").value)) bq("bnCliente").value=a.cliente;
    bnMedidos(a);
  }
  bnPintar(); bnBuscar();
}
/* Lo medido por el aplicativo de tiempos (parche 104). Si la persona no tiene
   esa pestaña la RPC falla y simplemente no se muestra la columna medida. */
async function bnMedidos(a){
  const B=BN;
  if(B.meds[a.k]) return;
  try{
    const r=await rpc("fn_tiempos_medidos",{p_dni:ING.dni,p_token:ING.token,p_area:$("areaBase").value,p_articulo:a.articulo});
    const m={};
    if(r&&r.ok) (r.items||[]).forEach(x=>{ if(x.te_min!=null) m[normKey(x.operacion)]={te:Number(x.te_min),nivel:x.nivel,n:x.n_operarios}; });
    B.meds[a.k]=m;
  }catch(e){ B.meds[a.k]={}; }
  if(B.refs.includes(a.k)){ bnCtx(B.i); bnPintar(); }
}

/* ---- tabla de operaciones ---- */
function bnPintar(){
  const t=bq("bnTabla"); if(!t) return;
  const arts=bnArticulos();
  bq("bnRefs").innerHTML = BN.refs.length
    ? BN.refs.map(k=>`<span class="bn-chip">${esc((arts[k]||{}).articulo||k)} <button onclick="bnUsar('${esc(k)}')" title="Quitar referencia">×</button></span>`).join("")
    : `<div class="cf-detalle">Aún sin referencias: busca a la izquierda y pulsa USAR, o agrega operaciones propias.</div>`;
  const cab=BN.refs.map(k=>`<th title="Elige de qué artículo tomar el tiempo de cada operación">${esc((arts[k]||{}).articulo||k)}<br><button class="btn-mini gris bn-todo" onclick="bnTodo('${esc(k)}')">usar todo</button></th>`).join("");
  t.innerHTML=`<thead><tr><th></th><th>#</th><th class="izq">Operación</th><th class="izq">Módulo</th>${cab}<th>STD nuevo <span class="cf-detalle">(o escribe uno)</span></th><th></th></tr></thead><tbody>`+
    BN.rows.map((r,i)=>{
      const celdas=BN.refs.map(k=>{
        const v=r.refs[k]; if(v==null) return `<td class="bn-ref">—</td>`;
        const m=(BN.meds[k]||{})[r.ok], me=m?Math.round(m.te*100)/100:null;
        return `<td class="bn-ref"><button class="bn-opt${r.sel===k?" on":""}" onclick="bnElegir(${i},'${esc(k)}')" title="Usar el STD de este artículo">${v}</button>`
          +(m?`<button class="bn-opt bn-med${r.sel===k+"*"?" on":""}" onclick="bnElegir(${i},'${esc(k)}*')" title="Tiempo medido (${esc(m.nivel||"")}, ${m.n||0} operario(s)): usarlo">⏱ ${me}</button>`:"")+`</td>`;
      }).join("");
      return `<tr><td><input type="checkbox" ${r.on?"checked":""} onchange="bnCampo(${i},'on',this.checked)" aria-label="Incluir"></td>
        <td class="bn-n">${bnPos(i)}</td>
        <td class="izq"><input class="base-in" value="${esc(r.operacion)}" maxlength="120" oninput="bnCampo(${i},'operacion',this.value)"></td>
        <td class="izq"><input class="base-in" value="${esc(r.modulo)}" maxlength="80" oninput="bnCampo(${i},'modulo',this.value)"></td>
        ${celdas}
        <td><input class="base-in num" type="number" step="0.01" min="0" value="${r.std}" oninput="bnCampo(${i},'std',this.value)"></td>
        <td class="bn-acc"><button class="btn-mini gris" onclick="bnMover(${i},-1)" title="Subir">↑</button><button class="btn-mini gris" onclick="bnMover(${i},1)" title="Bajar">↓</button><button class="btn-mini rojo" onclick="bnQuitar(${i})" title="Eliminar fila" aria-label="Eliminar fila">×</button></td></tr>`;
    }).join("")+"</tbody>";
  bnResumen();
}
function bnPos(i){ return BN.rows.slice(0,i+1).filter(r=>r.on).length||"–"; }
function bnCampo(i,k,v){
  const r=BN.rows[i]; if(!r) return;
  r[k]= k==="on" ? !!v : k==="std" ? (v===""?0:Number(v)) : v;
  if(k==="std") r.sel="";
  if(k==="on") bnPintar(); else bnResumen();
}
/* sel = clave de la referencia ("k"), su tiempo medido ("k*") o "" = STD propio. */
function bnValorSel(r,sel){
  const k=sel.replace("*",""), m=(BN.meds[k]||{})[r.ok];
  return sel.endsWith("*") ? (m?Math.round(m.te*100)/100:null) : (r.refs[k]!=null?r.refs[k]:null);
}
function bnElegir(i,sel){
  const r=BN.rows[i], v=bnValorSel(r,sel); if(v==null) return;
  r.sel=sel; r.std=v; bnPintar();
}
function bnTodo(k){
  BN.rows.forEach(r=>{ const v=bnValorSel(r,k); if(v!=null){ r.sel=k; r.std=v; } });
  bnPintar();
}
function bnMover(i,d){
  const j=i+d; if(j<0||j>=BN.rows.length) return;
  [BN.rows[i],BN.rows[j]]=[BN.rows[j],BN.rows[i]]; bnPintar();
}
function bnAgregarFila(){ BN.rows.push({manual:true,ok:"",operacion:"",modulo:"",std:0,on:true,refs:{},sel:""}); bnPintar(); }
function bnQuitar(i){ BN.rows.splice(i,1); bnPintar(); }

/* Resumen: total del nuevo contra cada referencia, y avisos por operación. */
function bnResumen(){
  const z=bq("bnResumen"); if(!z) return;
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
  z.innerHTML=`<div class="bn-cmp bn-tot"><span>${esc(norm((bq("bnArt")||{}).value).toUpperCase()||"Artículo nuevo")}</span><b>${redo(tot)} min</b><span class="cf-detalle">${inc.length} operación(es)</span></div>${comp}`
    +(av.length?`<div class="hn-rev">${av.map(t=>`<div class="hn-rev-l av"><i>!</i><span>${esc(t)}</span></div>`).join("")}<div class="sub">Son avisos: puedes guardar igual.</div></div>`:"");
}

/* ---- imágenes de referencia: IndexedDB del navegador, jamás van a la base ----
   Se achican a 1280 px (JPEG) para no llenar el disco; un "slot" agrupa las del
   borrador o las de un artículo ya guardado. */
const BN_MAX_IMG=12;
function bnDB(){
  return new Promise((ok,no)=>{
    const q=indexedDB.open("chronos-bn",1);
    q.onupgradeneeded=()=>q.result.createObjectStore("imgs",{keyPath:"id",autoIncrement:true}).createIndex("slot","slot");
    q.onsuccess=()=>ok(q.result); q.onerror=()=>no(q.error);
  });
}
const bnReq=r=>new Promise((ok,no)=>{ r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error); });
async function bnReducir(f){
  const bm=await createImageBitmap(f), e=Math.min(1,1280/Math.max(bm.width,bm.height));
  const c=document.createElement("canvas"); c.width=Math.round(bm.width*e); c.height=Math.round(bm.height*e);
  c.getContext("2d").drawImage(bm,0,0,c.width,c.height);
  return new Promise(ok=>c.toBlob(ok,"image/jpeg",0.82));
}
async function bnImgCargar(slot){
  bnLimpiarImgs();
  try{
    const db=await bnDB();
    const fs=await bnReq(db.transaction("imgs").objectStore("imgs").index("slot").getAll(slot));
    BN.imgs=fs.map(x=>({id:x.id,url:URL.createObjectURL(x.blob)}));
  }catch(e){ BN.imgs=[]; }
  bnPintarImgs();
}
/* Al escribir un código que ya tiene imágenes guardadas, y el borrador está vacío, se muestran. */
function bnImgDeArticulo(){
  const k=normKey(bq("bnArt").value);
  if(k && !BN.imgs.length) bnImgCargar(k);
}
async function bnImagenes(files){
  const fs=[...(files||[])].filter(f=>/^image\//.test(f.type)).slice(0,BN_MAX_IMG-BN.imgs.length);
  if(!fs.length) return;
  try{
    const db=await bnDB();
    for(const f of fs){
      const blob=await bnReducir(f);
      const id=await bnReq(db.transaction("imgs","readwrite").objectStore("imgs").add({slot:"_borrador",blob}));
      BN.imgs.push({id,url:URL.createObjectURL(blob)});
    }
    if(navigator.storage&&navigator.storage.persist) navigator.storage.persist();
  }catch(e){ mostrarError("No se pudo guardar la imagen en este navegador"); }
  bnPintarImgs();
}
function bnPintarImgs(){
  const z=bq("bnImgs"); if(!z) return;
  z.innerHTML=BN.imgs.map((x,i)=>`<div class="bn-img"><img src="${x.url}" alt="Referencia ${i+1}" onclick="window.open('${x.url}','_blank')"><button onclick="bnQuitarImg(${i})" title="Quitar">×</button></div>`).join("");
}
async function bnQuitarImg(i){
  const x=BN.imgs[i]; if(!x) return;
  try{ const db=await bnDB(); await bnReq(db.transaction("imgs","readwrite").objectStore("imgs").delete(x.id)); }catch(e){}
  URL.revokeObjectURL(x.url); BN.imgs.splice(i,1); bnPintarImgs();
}
function bnLimpiarImgs(){ BN.imgs.forEach(x=>URL.revokeObjectURL(x.url)); BN.imgs=[]; }
/* Al guardar el artículo, las del borrador pasan a su código. */
async function bnImgAArticulo(art){
  try{
    const db=await bnDB(), st=db.transaction("imgs","readwrite").objectStore("imgs");
    const fs=await bnReq(st.index("slot").getAll("_borrador"));
    for(const f of fs){ f.slot=normKey(art); st.put(f); }
  }catch(e){}
}
document.addEventListener("paste",e=>{
  if(BN_MULTI||!$("basesNuevo")||$("basesNuevo").hidden) return;
  const fs=[...(e.clipboardData&&e.clipboardData.files||[])];
  if(fs.length) bnImagenes(fs);
});

/* ---- guardar: reutiliza el diff y la subida del Excel ---- */
function bnGuardar(){
  bnCtx(0);
  const art=norm(bq("bnArt").value).toUpperCase();
  if(!art){ mostrarError("Escribe el código del artículo"); return; }
  if((BASE||[]).some(b=>normKey(b.articulo)===normKey(art))){
    mostrarError(`${art} ya existe en ${$("areaBase").value}: edítalo con EDITAR ARTÍCULO`); return;
  }
  const inc=BN.rows.filter(r=>r.on);
  if(!inc.length){ mostrarError("Marca al menos una operación"); return; }
  if(inc.some(r=>!norm(r.operacion))){ mostrarError("Hay operaciones sin nombre"); return; }
  const prenda=norm(bq("bnPrenda").value).toUpperCase(), cliente=norm(bq("bnCliente").value).toUpperCase(), mod=norm(bq("bnModulo").value);
  const filas=inc.map((r,i)=>({prenda,cliente,modulo:mod||norm(r.modulo),articulo:art,
    operacion:norm(r.operacion),std:Number(r.std)||0,max_op:inc.length,n_op:i+1}));
  bnImgAArticulo(art);
  bnCerrar();
  mostrarDiff(filas);
}

/* ---- registrar todos los bloques en UNA sola llamada ---- */
async function bnRegistrarTodos(){
  bnGuardarCampos();
  const area=$("areaBase").value, exist=new Set((BASE||[]).map(b=>normKey(b.articulo))), vistos=new Set(), filas=[];
  BNS.forEach((B,i)=>{
    const art=norm(B.art).toUpperCase(), k=normKey(art), inc=B.rows.filter(r=>r.on);
    let err="";
    if(!art) err="Escribe el código del artículo";
    else if(exist.has(k)) err=`${art} ya existe en ${area}`;
    else if(vistos.has(k)) err=`${art} está repetido en otro bloque`;
    else if(!inc.length) err="Marca al menos una operación";
    else if(inc.some(r=>!norm(r.operacion))) err="Hay operaciones sin nombre";
    else{
      const rep=[...new Set(inc.map(r=>normKey(r.operacion)).filter((x,j,a)=>a.indexOf(x)!==j))];
      if(rep.length) err="Operaciones repetidas: "+rep.join(", ");
    }
    B.err=err;
    if(!err){
      vistos.add(k);
      inc.forEach((r,j)=>filas.push({articulo:art,prenda:norm(B.prenda).toUpperCase(),cliente:norm(B.cliente).toUpperCase(),
        modulo:norm(B.modulo)||norm(r.modulo),operacion:norm(r.operacion),std:String(Number(r.std)||0),n_op:String(j+1)}));
    }
  });
  const pintaErr=()=>BNS.forEach((B,i)=>{ const m=$("bnMsg_"+i); if(m) m.textContent=B.err||""; });
  if(!filas.length){ pintaErr(); mostrarError("Ningún artículo está listo: revisa los avisos en rojo"); return; }
  const b=$("bnTodosOk"); if(b) b.disabled=true;
  try{
    const r=await rpc("fn_bases_agregar_varios",{p_dni:ING.dni,p_token:ING.token,p_area:area,p_filas:filas});
    if(!r||r.ok===false){ pintaErr(); mostrarError((r&&r.error)||"No se pudo registrar"); if(b) b.disabled=false; return; }
    const hechos=new Set((r.creados||[]).map(normKey));
    const dup=new Set((r.duplicados||[]).map(normKey)), inv={}; (r.invalidos||[]).forEach(x=>{ inv[normKey(x.articulo)]=x.motivo; });
    BNS.forEach(B=>{ const k=normKey(B.art);
      if(!B.err && dup.has(k)) B.err="Ya existe en la base";
      else if(!B.err && inv[k]) B.err=inv[k]; });
    const quedan=BNS.filter(B=>!hechos.has(normKey(B.art)));
    BNS.length=0; quedan.forEach((B,i)=>{ B.i=i; BNS.push(B); }); if(!BNS.length) BNS.push(bnEstado(0));
    bnRender();
    BNS.forEach((B,i)=>{ const m=$("bnMsg_"+i); if(m) m.textContent=B.err||""; });
    const li=(t,a,cls)=>a&&a.length?`<div class="${cls}"><b>${t} (${a.length}):</b> ${a.map(x=>esc(typeof x==="string"?x:`${x.articulo} · ${x.motivo}`)).join(" · ")}</div>`:"";
    $("bnInforme").innerHTML=`<div class="diff-box"><h3>Resumen</h3>${li("Registrados",r.creados,"diff-add")}${li("Ya existían",r.duplicados,"diff-mod")}${li("Con errores",r.invalidos,"diff-del")}
      ${(r.creados||[]).length?`<div class="cf-detalle">${r.filas} operación(es) guardadas</div>`:""}</div>`;
    window.scrollTo(0,0);
    delete BASES_CACHE[area];
    if((r.creados||[]).length){ mostrarOk(`${r.creados.length} artículo(s) registrados`); await cargarBases(); }
  }catch(e){ mostrarError(e.message); }
  finally{ const x=$("bnTodosOk"); if(x) x.disabled=false; }
}
