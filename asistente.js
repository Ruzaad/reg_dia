/* =====================================================================
   CHRONOS · Asistente (Fase A: órdenes sin IA, gasto 0)
   Entiende frases cortas con reglas simples y llama a las RPC que ya existen:
   fn_incentivos_quincena, fn_cantidad_penultima, fn_avance_of, fn_of_ruta, fn_of_generar.
   Los permisos salen de PERM (puedeLeer / puedeEditar) y las RPC los vuelven a validar.
   Escribir siempre pide Confirmar. Lo que no entiende queda guardado en Ayuda para
   ampliar el manual. Solo Ingeniería de escritorio.
   ===================================================================== */
const AS={open:false,tab:"chat",busy:false,pend:null,cache:{},leer:false,rec:null,
  msgs:[],hist:[],fav:[],fallos:[],manual:[],notas:[],lastOf:"",ult:"",pendEns:null};
const AS_INT={avance:"Avance de una OF",ef:"Eficiencia de una persona",bonif:"Lo que va ganando",prendas:"Prendas por día",gen:"Generar tickets"};
const AS_AREAS=[["CAMISA COSTURA",/camisa|blusa/],["PANTALON COSTURA",/pantalon|falda/],["SACO COSTURA",/saco|casaca|chaleco/]];
const AS_SUGE=[["Avance de OF","¿Cómo va la OF 10188?"],["Eficiencia","Eficiencia de "],["Bonificación","¿Cuánto va ganando "],
  ["Prendas del día","¿Cuántas prendas hicieron las áreas ayer?"],["Generar tickets","Genera los tickets de la OF "]];
const asNrm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const asN=(n,d=0)=>(+n).toFixed(d).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g," ");
const asS=n=>"S/ "+(+n).toFixed(2).replace(".",",");
const asF=iso=>iso.split("-").reverse().join("/");
const asDia=iso=>["domingo","lunes","martes","miércoles","jueves","viernes","sábado"][new Date(iso+"T00:00:00Z").getUTCDay()];
const asHoy=()=>hoyLimaApp();
const asAyer=()=>new Date(Date.parse(asHoy()+"T00:00:00Z")-864e5).toISOString().slice(0,10);
const asKey=()=>"as-"+(ING&&ING.dni||"x");
function asLoad(){ try{ const j=JSON.parse(localStorage.getItem(asKey())||"{}"); AS.hist=j.h||[]; AS.fav=j.f||[]; AS.fallos=j.x||[]; AS.manual=j.m||[]; AS.notas=j.n||[]; }catch(e){} }
function asSave(){ try{ localStorage.setItem(asKey(),JSON.stringify({h:AS.hist.slice(-30),f:AS.fav.slice(-12),x:AS.fallos.slice(-20),m:AS.manual.slice(-60),n:AS.notas.slice(-30)})); }catch(e){} }

/* ---------- interfaz ---------- */
function asReloj(){
  return `<svg class="as-reloj" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" class="as-r-f"/>
    <path d="M38 15A17 17 0 1 0 38 33" class="as-r-c"/><line x1="24" y1="24" x2="24" y2="12" class="as-r-m" id="asMin"/>
    <line x1="24" y1="24" x2="34" y2="24" class="as-r-s" id="asSeg"/><circle cx="24" cy="24" r="2.2" class="as-r-p"/></svg>`;
}
function asInit(){
  if(document.getElementById("asFab")||typeof ING==="undefined"||!ING) return;
  asLoad();
  const d=document.createElement("div");
  d.innerHTML=`<button type="button" class="as-fab" id="asFab" aria-label="Abrir el asistente Chronos" onclick="asAbrir()">
      <img src="asistente-logo.png" alt=""><i class="as-fab-p"></i></button>
    <section class="as-panel" id="asPanel" hidden aria-label="Asistente Chronos">
      <header class="as-hd">${asReloj()}<div><b>Chronos</b><small>Agente del sistema</small></div>
        <span class="as-on">En línea</span>
        <button type="button" class="as-ib" id="asLeer" title="Leer las respuestas en voz alta" onclick="asToggleLeer()">🔈</button>
        <button type="button" class="as-ib" title="Cerrar" onclick="asCerrar()">✕</button></header>
      <nav class="as-tabs" id="asTabs"></nav>
      <div class="as-cuerpo" id="asCuerpo"></div>
      <div class="as-chips" id="asChips"></div>
      <form class="as-in" onsubmit="asEnviar(event)"><input id="asTxt" placeholder="Escribe tu consulta u orden…" autocomplete="off">
        <button type="submit" class="as-send" aria-label="Enviar">➤</button>
        <button type="button" class="as-mic" id="asMic" aria-label="Hablar" onclick="asVoz()">🎤</button></form>
      <div class="as-voz" id="asVoz" hidden><button type="button" class="as-ib as-voz-x" onclick="asVozParar()">✕</button>
        <div class="as-vozm"><img src="as-escucha.gif" alt=""></div>
        <div class="as-onda"><s></s><s></s><s></s><s></s><s></s><s></s><s></s><s></s><s></s></div>
        <b id="asVozT">Te escucho…</b></div>
    </section>`;
  document.body.append(d);
  document.addEventListener("click",e=>{ const b=e.target.closest("[data-cmd],[data-conf],[data-fav],[data-tab],[data-ens],[data-ens2],[data-delm],[data-copiar]"); if(!b||!document.getElementById("asPanel").contains(b)) return;
    if(b.dataset.cmd!=null) asCorrer(b.dataset.cmd);
    else if(b.dataset.conf) asConfirmar(b.dataset.conf);
    else if(b.dataset.fav!=null) asFavorito(+b.dataset.fav);
    else if(b.dataset.tab){ AS.tab=b.dataset.tab; asPintar(); }
    else if(b.dataset.ens) asEnsenar(b.dataset.ens,AS.ult);
    else if(b.dataset.ens2){ const [i,k]=b.dataset.ens2.split("|"); asEnsenar(i,AS.fallos[+k]); }
    else if(b.dataset.delm!=null){ AS.manual.splice(+b.dataset.delm,1); asSave(); asPintar(); }
    else if(b.dataset.copiar){ const t=AS.notas.map(n=>`• «${n.f}» → ${n.n}`).join("\n"); try{ navigator.clipboard.writeText(t); }catch(e){} b.textContent="Copiado ✓"; } });
  setInterval(asTic,1000); asTic(); asPintar();
  if(!AS.msgs.length) asDi(`<b>¡Hola! Soy Chronos.</b> Hoy es ${asDia(asHoy())} ${asF(asHoy())}. Toca una opción o escríbeme.`,"saluda");
}
function asTic(){ const a=document.getElementById("asSeg"), m=document.getElementById("asMin"); if(!a||!m) return;
  const n=new Date(), s=n.getSeconds(), mi=n.getMinutes()+s/60; a.style.transform=`rotate(${s*6+90}deg)`; m.style.transform=`rotate(${mi*6}deg)`; }
function asAbrir(){ AS.open=true; $("asPanel").hidden=false; $("asFab").classList.add("off"); asPintar(); setTimeout(()=>{ const t=$("asTxt"); t&&t.focus(); },200); }
function asCerrar(){ AS.open=false; $("asPanel").hidden=true; $("asFab").classList.remove("off"); asVozParar(); }
function asToggleLeer(){ AS.leer=!AS.leer; $("asLeer").textContent=AS.leer?"🔊":"🔈"; $("asLeer").classList.toggle("on",AS.leer); if(!AS.leer&&window.speechSynthesis) speechSynthesis.cancel(); }
const AS_GIF={idle:"as-responde.gif",saluda:"as-responde.gif",responde:"as-responde.gif",piensa:"as-piensa.gif",busca:"as-busca.gif",exito:"as-exito.gif",escucha:"as-escucha.gif",alerta:"as-responde.gif"};
const AS_ETQ={idle:["Listo para ayudarte",""],saluda:["¡Hola!",""],responde:["Aquí tienes",""],piensa:["Pensando…",""],busca:["Consultando el sistema…",""],exito:["¡Listo!",""],escucha:["Te escucho…",""],alerta:["Atención",""]};
function asEstado(e){
  AS.estado=e; clearTimeout(AS.tEst);
  const oscuro=(document.documentElement.dataset.theme||"")==="dark", g=document.getElementById("asMasc"); if(!g) return;
  const f=(oscuro&&(e==="idle"||e==="saluda"||e==="responde"||e==="alerta"))?"as-idle_oscuro.gif":AS_GIF[e]||AS_GIF.idle;
  if(!g.src.endsWith(f)) g.src=f;
  g.parentNode.dataset.e=e; const t=document.getElementById("asEstT"); if(t) t.textContent=(AS_ETQ[e]||AS_ETQ.idle)[0];
  if(e==="exito"||e==="alerta"||e==="responde") AS.tEst=setTimeout(()=>asEstado("idle"),3500);
}
function asPintar(){
  $("asTabs").innerHTML=[["chat","Chat"],["consultas","Consultas"],["hist","Historial"],["fav","Favoritos"],["ayuda","Ayuda"]]
    .map(([k,t])=>`<button type="button" class="${AS.tab===k?"on":""}" data-tab="${k}">${t}</button>`).join("");
  $("asChips").innerHTML=AS.tab==="chat"?AS_SUGE.map(([t,c])=>`<button type="button" data-cmd="${esc(c)}" ${/ $/.test(c)?'data-poner="1"':""}>${t}</button>`).join(""):"";
  document.querySelectorAll("#asChips [data-poner]").forEach(b=>b.onclick=e=>{ e.stopPropagation(); const t=$("asTxt"); t.value=b.dataset.cmd; t.focus(); });
  const z=$("asCuerpo"); z.className="as-cuerpo";
  if(AS.tab==="chat"){
    z.innerHTML=`<div class="as-estado" data-e="${AS.estado||"idle"}"><img id="asMasc" src="as-responde.gif" alt=""><b id="asEstT"></b></div>
      <div class="as-msgs" id="asMsgs">${AS.msgs.map((m,i)=>`<div class="as-m ${m.r}">${m.h}${m.r==="u"?`<button type="button" class="as-st ${AS.fav.includes(m.t)?"on":""}" data-fav="${i}" aria-label="Favorito">★</button>`:""}</div>`).join("")}</div>`;
    const mm=$("asMsgs"); if(mm) mm.scrollTop=mm.scrollHeight; z.className="as-cuerpo chat"; asEstado(AS.estado||"idle");
  }else if(AS.tab==="consultas"){
    z.innerHTML=`<div class="as-lista"><h4>Lo que sé hacer</h4>`+[["Avance de una OF","¿Cómo va la OF 10188?"],["Eficiencia de una persona","Eficiencia de Quispe esta quincena"],["Eficiencia, quincena anterior","Eficiencia de Quispe quincena anterior"],
      ["Lo que va ganando en bonificación","¿Cuánto va ganando Quispe en bonificaciones?"],["Prendas de las áreas en un día","¿Cuántas prendas hicieron las áreas el "+asF(asAyer())+"?"],
      ["Generar tickets, últimas operaciones","Genera los tickets de la OF 9898 camisa, últimas 2 operaciones"],["Generar tickets, desde un módulo","Genera los tickets de la OF 10104 pantalón desde el módulo 3, cantidad 20"]]
      .map(([t,c])=>`<button type="button" class="as-fila" data-cmd="${esc(c)}"><b>${t}</b><small>${esc(c)}</small></button>`).join("")+`</div>`;
  }else if(AS.tab==="hist"){
    z.innerHTML=`<div class="as-lista"><h4>Lo último que pediste</h4>`+(AS.hist.slice().reverse().map(c=>`<button type="button" class="as-fila" data-cmd="${esc(c)}"><b>${esc(c)}</b></button>`).join("")||`<p class="as-vacio">Aún no hay nada.</p>`)+`</div>`;
  }else if(AS.tab==="fav"){
    z.innerHTML=`<div class="as-lista"><h4>Tus favoritos</h4>`+(AS.fav.map(c=>`<button type="button" class="as-fila" data-cmd="${esc(c)}"><b>${esc(c)}</b></button>`).join("")||`<p class="as-vacio">Toca la ★ de una frase tuya en el chat.</p>`)+`</div>`;
  }else{
    const op=Object.entries(AS_INT);
    z.innerHTML=`<div class="as-lista"><h4>Ayuda</h4><p>Pide una cosa por vez: nombre de la persona, número de OF o fecha. Escribir (generar tickets) siempre pide tu OK.</p>
      <h4>Frases que no entendí · enséñame</h4>`+(AS.fallos.map((c,k)=>`<div class="as-fila"><b>${esc(c)}</b><div class="as-btns">${op.map(([i,t])=>`<button type="button" data-ens2="${i}|${k}">${t}</button>`).join("")}</div></div>`).reverse().join("")||`<p class="as-vacio">Ninguna.</p>`)
      +`<h4>Lo que ya aprendí</h4>`+(AS.manual.map((m,k)=>`<div class="as-fila"><b>${esc(m.f)}</b><small>${AS_INT[m.i]}</small><button type="button" class="as-x" data-delm="${k}" aria-label="Olvidar">✕</button></div>`).join("")||`<p class="as-vacio">Aún nada.</p>`)
      +`<h4>Pendiente de construir</h4>`+(AS.notas.map(n=>`<div class="as-fila"><b>${esc(n.f)}</b><small>${esc(n.n)}</small></div>`).join("")||`<p class="as-vacio">Nada.</p>`)
      +(AS.notas.length?`<div class="as-btns"><button type="button" data-copiar="1">Copiar para el equipo</button></div>`:"")+`</div>`;
  }
}
function asMsg(r,h,t){ AS.msgs.push({r,h,t}); if(AS.tab==="chat") asPintar(); }
function asDi(h,e){ asEstado(e||"responde"); asMsg("a",h); if(AS.leer&&window.speechSynthesis){ const t=h.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); const u=new SpeechSynthesisUtterance(t); u.lang="es-PE"; speechSynthesis.cancel(); speechSynthesis.speak(u); } }
function asEnviar(ev){ ev.preventDefault(); const t=$("asTxt"); const v=t.value.trim(); if(!v) return; t.value=""; asCorrer(v); }
function asFavorito(i){ const m=AS.msgs[i]; if(!m) return; const k=AS.fav.indexOf(m.t); k>=0?AS.fav.splice(k,1):AS.fav.push(m.t); asSave(); asPintar(); }

/* ---------- voz del navegador (gratis) ---------- */
function asVoz(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ asDi("Este navegador no tiene reconocimiento de voz. Escríbeme la orden.","alerta"); return; }
  asVozParar(); const r=new SR(); r.lang="es-PE"; r.interimResults=true; r.maxAlternatives=1; AS.rec=r;
  $("asVoz").hidden=false; $("asVozT").textContent="Te escucho…"; $("asMic").classList.add("on");
  let fin="";
  r.onresult=e=>{ let t=""; for(const x of e.results){ t+=x[0].transcript; if(x.isFinal) fin=t; } $("asVozT").textContent=t||"Te escucho…"; };
  r.onerror=()=>{ $("asVozT").textContent="No te escuché. Toca para cerrar."; };
  r.onend=()=>{ AS.rec=null; $("asMic").classList.remove("on"); const v=fin.trim(); setTimeout(()=>{ $("asVoz").hidden=true; if(v){ const l=AS.leer; AS.leer=true; asCorrer(v).finally(()=>{ AS.leer=l; }); } },350); };
  try{ r.start(); }catch(e){ $("asVoz").hidden=true; }
}
function asVozParar(){ try{ AS.rec&&AS.rec.abort(); }catch(e){} AS.rec=null; const v=$("asVoz"); if(v) v.hidden=true; const m=$("asMic"); if(m) m.classList.remove("on"); }

/* ---------- entender la frase ---------- */
const AS_VACIAS=new Set("de del la el los las en a y con por para me mi que cual cuanto cuantas cuantos como va van ganando gana gano dime dame dar eficiencia bonificacion bonificaciones incentivo esta este quincena actual anterior pasada previa periodo persona operario operaria del dia hoy ayer prendas areas of genera generar tickets saco camisa pantalon modular cuanta tiene".split(" "));
function asNum(t){ return (t.match(/\b\d{4,6}\b/)||[])[0]||""; }
function asFecha(t){
  const m=t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if(m){ const y0=asHoy().slice(0,4); let y=m[3]?(m[3].length===2?"20"+m[3]:m[3]):y0; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  if(/ayer/.test(t)) return asAyer(); if(/\bhoy\b/.test(t)) return asHoy(); return null;
}
async function asCorrer(texto){
  if(AS.busy) return; const t=asNrm(texto).trim();
  AS.tab="chat"; asMsg("u",esc(texto),texto); AS.hist=AS.hist.filter(x=>x!==texto).concat(texto); asSave();
  AS.busy=true; asEstado("piensa");
  try{
    let h;
    if(AS.pendEns){ AS.notas.push({f:AS.pendEns,n:texto}); AS.fallos=AS.fallos.filter(x=>asNrm(x)!==asNrm(AS.pendEns)); AS.pendEns=null; asSave(); h=["Anotado. Quedó en Ayuda, en «Pendiente de construir», para que el equipo me enseñe a hacerlo.","exito"]; }
    else if(/^(cancel|no$|cancelar)/.test(t) && AS.pend){ AS.pend=null; h=["Listo, no hice nada.","saluda"]; }
    else if(AS.pend && AS.pend.tipo==="gen" && !/\b(eficiencia|avance|prendas)\b/.test(t)) h=await asGenerar(texto,AS.pend);
    else{
      let it=(asManual(t)||{}).i;
      const misma=/misma of|esa of|la misma|esta of|mismo/.test(t)&&AS.lastOf;
      if(!it){
        if(/genera|generar|troce|ticket/.test(t)) it="gen";
        else if(/prendas|cantidad/.test(t) && !/\bof\b/.test(t) && !misma) it="prendas";
        else if((/avance|como va|porcentaje|cuanto va(?! gan)|cuanto lleva|\bof\b/.test(t)||misma) && (asNum(t)||misma)) it="avance";
        else if(/bonific|ganando|gana|incentiv|cuanto.*(tiene|lleva)/.test(t)) it="bonif";
        else if(/eficien/.test(t)) it="ef";
      }
      if(it){ asEstado("busca"); h=await asHacer(it,texto,t); }
      else{ AS.ult=texto; AS.fallos=AS.fallos.filter(x=>x!==texto).concat(texto); asSave();
        h=[`No sé hacer eso todavía. ¿Me enseñas? ¿Qué debo hacer con esa frase?<div class="as-btns">`+Object.entries(AS_INT).map(([i,l])=>`<button type="button" data-ens="${i}">${l}</button>`).join("")+`<button type="button" data-ens="otra">Otra cosa</button></div>`,"alerta"]; }
    }
    asDi(h[0],h[1]);
  }catch(e){ asDi(`No pude hacerlo: ${esc(e.message||e)}`,"alerta"); }
  finally{ AS.busy=false; }
}
function asManual(t){
  const tk=x=>new Set(asNrm(x).replace(/[^a-z\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!AS_VACIAS.has(w)));
  const T=tk(t); let best=null,bs=0;
  AS.manual.forEach(m=>{ const F=tk(m.f); if(asNrm(m.f)===t){ best=m; bs=9; return; } if(F.size<2) return;
    let c=0; F.forEach(w=>{ if(T.has(w)) c++; }); const sc=c/F.size; if(sc>=0.7&&sc>bs){ best=m; bs=sc; } });
  return best;
}
async function asHacer(it,texto,t){
  if(it==="avance") return asAvance(t);
  if(it==="ef") return asPersona(texto,t,"ef");
  if(it==="bonif") return asPersona(texto,t,"bonif");
  if(it==="prendas") return asPrendas(t);
  return asGenerar(texto);
}
function asEnsenar(i,frase){
  if(!frase) return;
  if(i==="otra"){ AS.pendEns=frase; asDi(`Cuéntame con tus palabras qué debo hacer con «${esc(frase)}» y con qué datos. Lo anoto para aprenderlo.`,"escucha"); return; }
  AS.manual=AS.manual.filter(m=>m.f!==asNrm(frase)).concat({f:asNrm(frase),i}); AS.fallos=AS.fallos.filter(x=>x!==frase); asSave();
  asDi(`Aprendido: «${esc(frase)}» es <b>${AS_INT[i]}</b>.`,"exito"); setTimeout(()=>asCorrer(frase),600);
}
const asBtn=(t,c)=>`<button type="button" data-cmd="${esc(c)}">${esc(t)}</button>`;
const asKV=L=>`<div class="as-kv">`+L.map(([a,b])=>`<span>${a}</span><b>${b}</b>`).join("")+`</div>`;

/* ---------- eficiencia y bonificación ---------- */
async function asQuincena(p){
  const [d,h]=bolPreset(p), k=p+d+h, c=AS.cache[k];
  if(c&&Date.now()-c.t<60000) return c;
  const r=await rpc("fn_incentivos_quincena",{p_dni:ING.dni,p_token:ING.token,p_desde:d,p_hasta:h,p_area:""});
  if(!r.ok) throw new Error(r.error||"no pude leer la quincena");
  return (AS.cache[k]={t:Date.now(),r,d,h});
}
async function asPersona(texto,t,que){
  const p=/anterior|pasada|previa/.test(t)?"qa":"q";
  const toks=t.replace(/[^a-z\s]/g," ").split(/\s+/).filter(w=>w.length>=3&&!AS_VACIAS.has(w));
  if(!toks.length) return [`¿De quién? Dime el apellido o el nombre.${que==="ef"?"":""}`,"piensa"];
  const q=await asQuincena(p), r=q.r;
  const hit=(r.personas||[]).filter(x=>!x.supervisora&&x.area!=="UDP"&&toks.every(w=>asNrm(x.nombre).includes(w)));
  if(!hit.length) return [`No encuentro a <b>${esc(toks.join(" "))}</b> en esa quincena. Revisa el apellido.`,"alerta"];
  if(hit.length>1){ const pre=que==="ef"?"Eficiencia de ":"¿Cuánto va ganando ";
    return [`Hay ${hit.length} personas. ¿Cuál?<div class="as-btns">${hit.slice(0,6).map(x=>asBtn(x.nombre+" · "+x.area,pre+x.nombre+(p==="qa"?" quincena anterior":" esta quincena")+(que==="ef"?"":" en bonificaciones"))).join("")}</div>`,"piensa"]; }
  const x=hit[0];
  if(!puedeLeer(x.area)) return [`No tienes permiso de lectura en <b>${esc(x.area)}</b>.`,"alerta"];
  const cab=`Hoy es <b>${asDia(asHoy())} ${asF(asHoy())}</b> · quincena ${p==="q"?"en curso":"anterior"}: <b>${asF(q.d)} al ${asF(q.h)}</b>.<div class="as-nom">${esc(x.nombre)}</div>`;
  const lab=new Set((r.dias||[]).filter(d=>d.laborable).map(d=>d.fecha));
  let sol=0,n=0; Object.keys(x.dias||{}).forEach(f=>{ if(!lab.has(f)) return; const d=x.dias[f]; sol+=+d.soles||0; if(d.ef!=null) n++; });
  const otra=asBtn(p==="q"?"Ver quincena anterior":"Ver quincena actual",(que==="ef"?"Eficiencia de ":"¿Cuánto va ganando ")+x.nombre+(p==="q"?" quincena anterior":" esta quincena")+(que==="ef"?"":" en bonificaciones"));
  const pen=(+x.boleta>0||+x.faltas>0)?`<div class="as-av">${+x.boleta>0?"Tiene boleta sin entregar. ":""}${+x.faltas>0?"Tiene faltas. ":""}Eso anula el incentivo de la quincena.</div>`:"";
  if(que==="ef"){
    return [cab+`<div class="as-big">${x.prom_ef==null?"—":asN(x.prom_ef,1)+" %"}</div>`+asKV([["Área",esc(x.area)],["Categoría",esc(x.categoria||"—")],["Días con eficiencia",n+" de "+lab.size]])+pen+`<div class="as-btns">${otra}</div>`,"exito"];
  }
  let h=cab+`<div class="as-big">${asS(sol)}</div>`+asKV([["Incentivo individual","tabla actual"],["Días con eficiencia",n+" de "+lab.size]])+pen;
  if(/modular/.test(t)) h+=asKV([["Bono modular",asS(+x.bono_total||0)]]);
  return [h+`<div class="as-btns">${otra}</div>`,"exito"];
}

/* ---------- prendas por área y día ---------- */
async function asPrendas(t){
  const f=asFecha(t)||asAyer();
  const r=await rpc("fn_cantidad_penultima",{p_dni:ING.dni,p_token:ING.token,p_desde:f,p_hasta:f});
  if(!r||r.ok===false) throw new Error((r&&r.error)||"no pude leer las prendas");
  const L=(r.areas||[]).filter(a=>a.area!=="UDP"&&puedeLeer(a.area)), tot=L.reduce((s,a)=>s+(+a.cantidad||0),0);
  if(!L.length) return [`No hay prendas registradas el <b>${asDia(f)} ${asF(f)}</b> en las áreas que puedes ver.`,"piensa"];
  return [`Prendas del <b>${asDia(f)} ${asF(f)}</b> (penúltima operación):`+asKV(L.map(a=>[esc(a.area),asN(a.cantidad)]))+`<div class="as-big">${asN(tot)}</div>`,"exito"];
}

/* ---------- avance de una OF ---------- */
/* Por etapa (corte, costura, acabado) y con la operación pedida: por defecto la penúltima de cada área
   (prendas reales). Usa fn_asistente_avance_of (parche 186); si aún no está en la base, cae al cálculo por módulos. */
async function asAvance(t){
  const of=asNum(t)||AS.lastOf; AS.lastOf=of;
  const mop=t.match(/\b(?:operacion|op)\s*(?:n[°o.]?\s*)?(\d{1,3})\b/), ult=!mop&&/\bultima\b/.test(t);
  let r; try{ r=await rpc("fn_asistente_avance_of",{p_dni:ING.dni,p_token:ING.token,p_of:of,p_n_op:mop?+mop[1]:null}); }catch(e){ r={ok:false,error:String(e.message||e)}; }
  if(!r||r.ok===false){
    const er=(r&&r.error)||"";
    if(/does not exist|no existe|could not find|schema cache/i.test(er)) return asAvanceViejo(t,of);
    if(/no registrada/i.test(er)) return [`La OF <b>${esc(of)}</b> no está registrada: falta subir su hoja de numeración.`,"alerta"];
    throw new Error(er||"no pude leer el avance");
  }
  const fmt=(p,c)=>c>0?asN(p/c*100,1)+" %":"—", barra=x=>`<div class="as-bar"><i style="width:${Math.max(0,Math.min(100,x))}%"></i></div>`;
  const cp=+r.cant_prog||0, txt=mop?"la operación "+mop[1]:ult?"la última operación":"la penúltima operación";
  let h=`<b>OF ${esc(r.of)} · ${esc(r.articulo)}</b> · ${asN(cp)} prendas<div class="as-nom">Calculado con ${txt} de cada área</div>`;
  // Corte
  h+=`<div class="as-etapa"><b>Corte</b>`+(r.corte&&+r.corte.programado>0?(()=>{ const c=+r.corte.real||0, p=+r.corte.programado; return `<span>${asN(c)} de ${asN(p)} cortadas</span><em>${fmt(c,p)}</em>${barra(c/p*100)}`; })():`<span>Sin datos de corte</span>`)+`</div>`;
  const orden=a=>a.area==="ACABADO"?9:0;
  (r.areas||[]).slice().sort((a,b)=>orden(a)-orden(b)||a.area.localeCompare(b.area)).filter(a=>puedeLeer(a.area)).forEach(a=>{
    const costura=a.area!=="ACABADO", n=ult?a.ultima:a.n_op, pr=ult?+a.ultima_prendas:+a.prendas;
    h+=`<div class="as-etapa"><b>${costura?"Costura · "+esc(a.area):"Acabado"}</b>`;
    if(mop&&!a.operacion) h+=`<span>Esta área no tiene la operación ${mop[1]}</span>`;
    else if(!a.con_registros) h+=`<span>Sin registros todavía</span>`;
    else h+=`<span>Op. ${n}${a.operacion&&!ult?" · "+esc(a.operacion):""} · ${asN(pr)} de ${asN(cp)} prendas</span><em>${fmt(pr,cp)}</em>${barra(cp?pr/cp*100:0)}`;
    h+=`</div>`;
  });
  if(!(r.areas||[]).some(a=>puedeLeer(a.area))&&!(r.corte)) h+=`<div class="as-av">No tienes permiso de lectura en las áreas de esta OF.</div>`;
  h+=`<div class="as-btns">${asBtn("Con la última operación","la misma OF con la última operación")}${asBtn("Con la penúltima","la misma OF con la penúltima operación")}</div>`;
  return [h,"exito"];
}
async function asAvanceViejo(t,of){
  let ar=AS_AREAS.filter(a=>a[1].test(t)).map(a=>a[0]);
  if(!ar.length) ar=AS_AREAS.map(a=>a[0]);
  ar=ar.filter(a=>puedeLeer(a));
  if(!ar.length) return [`No tienes permiso de lectura en esas áreas.`,"alerta"];
  const res=await Promise.all(ar.map(a=>rpc("fn_avance_of",{p_dni:ING.dni,p_token:ING.token,p_area:a}).then(r=>[a,r]).catch(()=>[a,null])));
  const hits=res.map(([a,r])=>[a,((r&&r.items)||[]).find(i=>String(i.of).trim()===of)]).filter(x=>x[1]);
  if(!hits.length) return [`La OF <b>${esc(of)}</b> no está en curso en ${ar.map(esc).join(", ")}: ya terminó, aún no empieza o no tiene registros.`,"alerta"];
  return [hits.map(([a,i])=>`<b>OF ${esc(i.of)}</b> · ${esc(i.articulo)} · ${esc(a)}<div class="as-big">${asN(i.pct,1)} %</div><div class="as-bar"><i style="width:${Math.min(100,+i.pct)}%"></i></div>`
    +asKV([["Prendas programadas",asN(i.cant_prog)],["Módulos listos",i.n_listos+" de "+i.n_mods]])).join("<hr>"),"exito"];
}

/* ---------- generar tickets (escritura con Confirmar) ---------- */
const AS_PAL={uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5};
async function asGenerar(texto,pend){
  const t=asNrm(texto), P=pend||{};
  const of=asNum(t)||P.of; if(of) AS.lastOf=of;
  if(!of) return [`¿De qué OF? Escribe el número, por ejemplo "genera los tickets de la OF 9898 camisa".`,"piensa"];
  const ar=(AS_AREAS.find(a=>a[1].test(t))||[])[0]||P.area;
  if(!ar){ AS.pend={tipo:"gen",of,modo:P.modo}; return [`¿De qué área es la OF <b>${of}</b>?<div class="as-btns">${AS_AREAS.map(a=>asBtn(a[0],"genera OF "+of+" "+a[1].source.split("|")[0]+(P.modo?" "+P.modo.txt:""))).join("")}</div>`,"piensa"]; }
  if(!puedeEditar(ar)) return [`No tienes permiso de <b>edición</b> en ${esc(ar)}. Pídeselo a quien tenga EDITAR en esa área.`,"alerta"];
  const r=await rpc("fn_of_ruta",{p_dni:ING.dni,p_token:ING.token,p_area:ar,p_of:of});
  if(!r.ok) return [`<div class="as-chk x"><i>!</i><span>No puedo generar la <b>OF ${of}</b>: <b>falta subir la hoja de numeración</b>. Súbela en OFs registradas › Dar de alta una OF y me lo vuelves a pedir.</span></div>`,"alerta"];
  const ruta=r.ruta||[], chk=(ok,tx)=>`<div class="as-chk ${ok?"":"x"}"><i>${ok?"✓":"!"}</i><span>${tx}</span></div>`;
  const hoja=chk(+r.paquetes>0,+r.paquetes>0?`Hoja de numeración cargada · <b>${asN(r.cant_prog)} prendas</b> en ${r.paquetes} paquetes`:`La OF no tiene desglose de paquetes: completa su hoja primero`);
  const base=chk(ruta.length>0,ruta.length?`Base de operaciones del artículo ${esc(r.articulo)} · <b>${ruta.length} operaciones</b>`:`El artículo ${esc(r.articulo)} no tiene base de operaciones en ${esc(ar)}`);
  if(!(+r.paquetes>0)||!ruta.length){ AS.pend=null; return [hoja+base,"alerta"]; }
  if(r.con_reclamos){ AS.pend=null; return [hoja+base+chk(false,`Ya tiene tickets reclamados en el área: no se puede cambiar el troceo sin liberarlos.`),"alerta"]; }
  // modo de troceo
  let modo=P.modo||null;
  const mU=t.match(/ultim[oa]s?\s+(\d+|uno|una|dos|tres|cuatro|cinco)/), mM=t.match(/modulo\s+([a-z0-9 ]+?)(?=\s+(hacia|cantidad|de \d|en paquetes)|,|$)/);
  if(mU) modo={tipo:"ult",k:AS_PAL[mU[1]]||+mU[1],txt:"últimas "+(AS_PAL[mU[1]]||mU[1])+" operaciones"};
  else if(mM) modo={tipo:"mod",m:mM[1].trim(),txt:"desde el módulo "+mM[1].trim()};
  let n=P.n; const mN=t.match(/(?:cantidad|paquetes? de|de)\s+(\d{1,3})\b/)||(pend&&/^\s*\d{1,3}\s*$/.test(t)?[0,t.trim()]:null);
  if(mN&&!(mM&&mM[1]===mN[1]&&!/cantidad/.test(t))) n=+mN[1];
  let tro=[], desc="sin trocear ninguna operación";
  if(modo){
    let sel;
    if(modo.tipo==="ult") sel=ruta.slice().sort((a,b)=>a.n_op-b.n_op).slice(-modo.k);
    else{ const k=asNrm(modo.m), i=ruta.findIndex(o=>asNrm(o.modulo)===k||asNrm(o.modulo).includes(k)||/^\d+$/.test(k)&&String(o.modulo).trim()===k);
      if(i<0){ const mods=[...new Set(ruta.map(o=>o.modulo))];
        AS.pend=null; return [hoja+base+`Módulos de esta OF:<div class="as-btns">${mods.slice(0,8).map(m=>asBtn(m,`genera OF ${of} ${ar.split(" ")[0].toLowerCase()} desde el módulo ${m}${n?" cantidad "+n:""}`)).join("")}</div>No encontré el módulo "${esc(modo.m)}". Elige uno.`,"piensa"]; }
      sel=ruta.slice(i); }
    if(!n){ AS.pend={tipo:"gen",of,area:ar,modo}; return [hoja+base+`Voy a trocear ${esc(modo.txt)}${modo.tipo==="mod"?` (${sel.length} operaciones)`:""}. ¿En paquetes de cuántas prendas?<div class="as-btns">${[10,20,30].map(v=>asBtn(v,String(v))).join("")}</div>`,"piensa"]; }
    tro=sel.map(o=>({op_id:o.op_id,n_op:o.n_op,n})); desc=`${esc(modo.txt)} · ${sel.length} operaciones, paquetes de ${n}`;
  }
  AS.pend=null;
  const tk=ruta.reduce((a,o)=>{ const x=tro.find(q=>q.n_op===o.n_op); return a+(x?Math.ceil(r.cant_prog/x.n):+r.paquetes); },0);
  const id="g"+Date.now(); AS.cache[id]={ar,of,tro,tk};
  return [hoja+base+chk(true,`Tienes permiso de edición en ${esc(ar)}`)
    +`<div class="as-conf"><b>Resumen</b>`+asKV([["OF",esc(r.of)+" · "+esc(r.articulo)],["Área",esc(ar)],["Troceo",desc],["Tickets",asN(tk)]])
    +(r.generada?`<div class="as-av">Esta OF ya estaba generada: se regenera.</div>`:"")+`</div>`
    +`<div class="as-btns"><button type="button" class="as-ok" data-conf="${id}">Confirmar</button><button type="button" data-cmd="cancelar">Cancelar</button></div>`,"piensa"];
}
async function asConfirmar(id){
  const c=AS.cache[id]; if(!c||AS.busy) return; document.querySelectorAll(`[data-conf="${id}"]`).forEach(b=>b.parentNode.remove()); AS.busy=true; asEstado("piensa"); delete AS.cache[id];
  try{
    const g=await rpc("fn_of_generar",{p_dni:ING.dni,p_token:ING.token,p_area:c.ar,p_of:c.of,p_troceo:c.tro});
    if(!g.ok) asDi(`No se pudo generar: ${esc(g.error||"error")}`,"alerta");
    else{ asDi(`<div class="as-chk"><i>✓</i><span>OF <b>${esc(g.of)}</b> generada · <b>${asN(g.tickets)}</b> tickets · ${g.troceadas} operación(es) troceada(s).</span></div>`,"exito");
      if(typeof genOfsRecargar==="function") genOfsRecargar().catch(()=>{}); }
  }catch(e){ asDi(`No se pudo generar: ${esc(e.message||e)}`,"alerta"); }
  finally{ AS.busy=false; }
}
if(typeof window!=="undefined") window.addEventListener("load",()=>{ let n=0; const t=setInterval(()=>{ asInit(); if(document.getElementById("asFab")||++n>300) clearInterval(t); },1000); });
