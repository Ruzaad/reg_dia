/* CHRONOS · intro animada (horizontal y vertical) y barra de carga.
   Va en el <head> para que la intro tape la página desde el primer cuadro.
   La intro sale una vez por sesión (al abrir la app), se salta con un toque,
   y la página carga por debajo. ?intro=1 la fuerza, ?intro=0 la quita. */
(function(){
  var d=document.documentElement;
  try{var t=localStorage.getItem("ing-maq-tema");if(t==="light"||t==="dark")d.dataset.theme=t;}catch(e){}

  /* ---------- barra de carga: solo si una consulta pasa de 0,4 s ---------- */
  var n=0,tm,barra;
  function pintar(on){
    if(!barra){barra=document.createElement("div");barra.id="chronos-barra";barra.setAttribute("aria-hidden","true");barra.innerHTML="<i></i>";d.appendChild(barra);}
    barra.classList.toggle("on",on);
  }
  var f=window.fetch;
  if(f)window.fetch=function(u){
    var url=typeof u==="string"?u:(u&&u.url)||"";
    if(url.indexOf("/rest/v1/rpc/")<0)return f.apply(this,arguments);
    n++;clearTimeout(tm);tm=setTimeout(function(){if(n>0)pintar(true);},400);
    return f.apply(this,arguments).finally(function(){n--;if(n<=0){n=0;clearTimeout(tm);pintar(false);}});
  };

  /* ---------- intro ---------- */
  var q=location.search,visto=false;
  try{visto=sessionStorage.getItem("chronos-intro")==="1";}catch(e){}
  if(/[?&]intro=0/.test(q)||(visto&&!/[?&]intro=1/.test(q)))return;
  try{sessionStorage.setItem("chronos-intro","1");}catch(e){}

  var L=[[226.56,"-16.2px","16.7px","-67.9deg"],[276.46,"-11.7px","2.2px","-14deg"],[325.43,"-107.2px","3.3px","-20.8deg"],[374.88,"99.6px","-113.6px","31.5deg"],[427.63,"-139.2px","86.7px","-31deg"],[480.38,"-155.8px","135px","-74.4deg"],[525.1,"52.3px","32.4px","54.8deg"]],
      P=[42,88,134,180,226,272,318],LT="CHRONOS";
  function escena(v,id){
    var vert=v==="v",vb=vert?"0 0 360 640":"0 0 640 360",gx=vert?180:140.72,gy=vert?250:160,
        rel=vert?'<svg x="132" y="198" width="96" height="96" viewBox="0 0 100 100" overflow="visible">':'<svg x="98.72" y="118" width="84" height="84" viewBox="0 0 100 100" overflow="visible">',
        s='<svg class="scene" viewBox="'+vb+'" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs><radialGradient id="g-'+id+'" cx=".5" cy=".5" r=".5"><stop offset="0" style="stop-color:var(--i-glow);stop-opacity:.55"/><stop offset="1" style="stop-color:var(--i-glow);stop-opacity:0"/></radialGradient></defs>'
        +'<circle class="glow only-color" cx="'+gx+'" cy="'+gy+'" r="230" fill="url(#g-'+id+')"/>'+rel
        +'<path class="arc" pathLength="100" d="M68.78 14.68 A40 40 0 1 0 90 50"/><g class="needle-rot"><g class="needle-fade"><line class="needle" x1="50" y1="50" x2="33.38" y2="28.72"/></g></g><circle class="hub" cx="50" cy="50" r="6"/><g class="head-rot"><circle class="aura only-color" cx="90" cy="50" r="21"/><circle class="head" cx="90" cy="50" r="9.5"/></g></svg>';
    for(var i=0;i<7;i++){
      s+='<text class="ltr'+(i===5?" acc":"")+'" x="'+(vert?P[i]:L[i][0])+'" y="'+(vert?372:180)+'" style="--i:'+i+';--dx:'+L[i][1]+';--dy:'+L[i][2]+';--r:'+L[i][3]+(vert?';font-size:46px':'')+'">'+LT[i]+'</text>';
    }
    s+='<text class="tag1" x="'+(vert?181.75:321.75)+'" y="'+(vert?428:262)+'">TIEMPO · MINUTAJE · PLANTA</text><text class="tag2" x="'+(vert?180:320)+'" y="'+(vert?458:292)+'">El tiempo de tu planta, medido.</text>'
      +'<g class="barwrap"><rect class="track" x="'+(vert?80:220)+'" y="'+(vert?560:334.5)+'" width="200" height="3" rx="1.5" style="opacity:.28"/><rect class="fillbar" x="'+(vert?80:220)+'" y="'+(vert?560:334.5)+'" width="200" height="3" rx="1.5"/></g></svg>';
    return s;
  }
  var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches,
      v=(window.innerHeight>window.innerWidth)?"v":"h",
      el=document.createElement("div");
  el.id="chronos-intro";el.setAttribute("role","dialog");el.setAttribute("aria-label","CHRONOS");
  el.innerHTML='<div class="layer gray">'+escena(v,"a")+'</div><div class="layer color">'+escena(v,"b")+'</div><button class="skip" type="button">Saltar</button>';
  d.appendChild(el);
  var fin,quitar;
  function cerrar(){clearTimeout(fin);if(quitar)return;el.classList.add("out");quitar=setTimeout(function(){el.remove();},320);document.removeEventListener("keydown",tecla);}
  function tecla(e){if(e.key==="Escape"||e.key==="Enter"||e.key===" "){e.preventDefault();cerrar();}}
  el.addEventListener("click",cerrar);document.addEventListener("keydown",tecla);
  var go=false;
  function iniciar(){
    if(go)return;go=true;
    if(reduce){el.classList.add("still");fin=setTimeout(cerrar,1200);}
    else{el.classList.add("run");fin=setTimeout(cerrar,3500+700);}
  }
  if(document.fonts&&document.fonts.load){document.fonts.load("700 56px Cinzel").then(iniciar,iniciar);}
  setTimeout(iniciar,900);
})();
