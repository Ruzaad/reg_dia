/* SIMULADOR QA — se carga antes que app.js en cada pantalla.
   Todo lo que la app manda a Supabase lo atiende la copia de la base que corre
   dentro del navegador (página madre). Nada sale a la base real. */
(function(){
  var madre = window.parent && window.parent !== window ? window.parent : null;
  var marco = (window.frameElement && window.frameElement.name) || "solo";
  // localStorage propio por marco: el celular y la PC tienen sesiones distintas
  try{
    var real = window.localStorage, pre = "sim:" + marco + ":";
    var propio = {
      getItem: function(k){ return real.getItem(pre + k); },
      setItem: function(k, v){ real.setItem(pre + k, String(v)); },
      removeItem: function(k){ real.removeItem(pre + k); },
      clear: function(){ Object.keys(real).forEach(function(k){ if(k.indexOf(pre)===0) real.removeItem(k); }); },
      key: function(i){ return Object.keys(real).filter(function(k){ return k.indexOf(pre)===0; }).map(function(k){ return k.slice(pre.length); })[i] || null; },
      get length(){ return Object.keys(real).filter(function(k){ return k.indexOf(pre)===0; }).length; }
    };
    Object.defineProperty(window, "localStorage", { configurable: true, get: function(){ return propio; } });
  }catch(e){}
  // sin service worker dentro del simulador
  try{ if(navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, "register", { value: function(){ return Promise.resolve(); } }); }catch(e){}
  var SUPA = "https://lmlwomurgbbzolgbkwtp.supabase.co";
  var fetchReal = window.fetch.bind(window);
  window.fetch = async function(entrada, opts){
    var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
    if(url.indexOf(SUPA) !== 0) return fetchReal(entrada, opts);
    if(!madre || !madre.SIM) return new Response(JSON.stringify({message:"Simulador sin base"}), {status:503});
    var cuerpo = {}; try{ cuerpo = JSON.parse((opts && opts.body) || "{}"); }catch(e){}
    var ruta = url.slice(SUPA.length);
    var r = await madre.SIM.atender(ruta, cuerpo, marco);
    return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  // aviso fijo para que nadie confunda el simulador con la app de verdad
  document.addEventListener("DOMContentLoaded", function(){
    var b = document.createElement("div");
    b.textContent = "SIMULADOR · copia del 8-oct · no toca la base real";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#b45309;color:#fff;font:600 11px/1.9 'Fira Sans',system-ui,sans-serif;text-align:center;letter-spacing:.3px;pointer-events:none";
    document.body.appendChild(b);
    if(madre && madre.SIM) madre.SIM.pantalla(marco, location.pathname.split("/").pop());
  });
})();
