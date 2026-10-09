/* ================= MODO SIN SEÑAL (parche 110) =================
   Si al registrar se corta la señal, los paquetes se guardan en el celular con
   la hora en que se marcaron y se mandan solos al volver la señal
   (fn_reclamar_lote_hora). Si otra persona los tomó mientras tanto, el inicio
   lo avisa. El service worker no cambia: sigue yendo primero a la red. */

const SS={enviando:false, timer:null, ultimo:null};
const ssClave = dni => "stx_cola_" + dni;
function ssLeer(dni){ try{ return JSON.parse(localStorage.getItem(ssClave(dni))||"[]"); }catch(e){ return []; } }
function ssGuardar(dni, xs){ try{ if(xs.length) localStorage.setItem(ssClave(dni), JSON.stringify(xs)); else localStorage.removeItem(ssClave(dni)); }catch(e){} }
const ssEsSinSenal = e => !navigator.onLine || (e && (e.message||e)===MSG_SIN_SENAL);
const ssCodigosEnCola = dni => new Set(ssLeer(dni).flatMap(x=>x.tickets.map(t=>t.codigo)));

/* Guarda un lote (formato de fn_reclamar_lote). Devuelve cuántos quedaron en cola. */
function ssEncolar(s, area, tickets, op){
  const xs=ssLeer(s.dni), ya=ssCodigosEnCola(s.dni);
  const nuevos=tickets.filter(t=>!ya.has(t.codigo));
  if(nuevos.length) xs.push({area, tickets:nuevos, op:op||"", marcado:new Date().toISOString()});
  ssGuardar(s.dni, xs); ssPintar(); ssProgramar();
  return nuevos.length;
}
function ssProgramar(){
  clearInterval(SS.timer); SS.timer=null;
  const s=sesionActual(); if(!s || !ssLeer(s.dni).length) return;
  SS.timer=setInterval(ssEnviar, 45000);
}
async function ssEnviar(){
  const s=sesionActual(); if(!s || SS.enviando) return;
  let xs=ssLeer(s.dni); if(!xs.length){ ssPintar(); return; }
  if(!navigator.onLine) return;
  SS.enviando=true;
  const res={ok:0, tomados:[], vencidos:0};
  try{
    while(xs.length){
      const x=xs[0]; let r;
      try{
        r=await rpc("fn_reclamar_lote_hora",{p_dni:s.dni,p_token:s.token,p_area:x.area,p_tickets:x.tickets,p_marcado:x.marcado});
      }catch(e){
        if(/Could not find the function|PGRST202/i.test(e.message||"")){
          // Sin el parche: solo se puede mandar lo de hoy (quedaría con la fecha de hoy).
          if(new Date(x.marcado).toDateString()!==new Date().toDateString()){ res.vencidos+=x.tickets.length; xs.shift(); ssGuardar(s.dni,xs); continue; }
          try{ r=await rpc("fn_reclamar_lote",{p_dni:s.dni,p_token:s.token,p_area:x.area,p_tickets:x.tickets}); }
          catch(e2){ break; }
        } else break;   // sigue sin señal o la sesión venció: se intenta después
      }
      if(r && r.ok){
        res.ok += r.reclamados||0;
        // Los "tomados" que en verdad son suyos (reintento) no se avisan.
        const otros=(r.conflictos||[]);
        if(otros.length){ try{ const rec=await rpc("fn_reclamados",{p_dni:s.dni,p_token:s.token,p_area:x.area});
            const mios=new Set((rec||[]).filter(y=>esMio(y.nombre,s)).map(y=>y.codigo));
            x.tickets.forEach(t=>{ if(otros.includes(t.num) && !mios.has(t.codigo)) res.tomados.push(`${t.num}${x.op?" ("+x.op+")":""}`); });
          }catch(e){ res.tomados.push(...otros); } }
      } else if(r && r.vencido){ res.vencidos+=x.tickets.length; }
      else if(r){ res.tomados.push(...x.tickets.map(t=>t.num)); }
      xs.shift(); ssGuardar(s.dni, xs);
    }
  } finally { SS.enviando=false; }
  if(res.ok || res.tomados.length || res.vencidos){ SS.ultimo=res; if(typeof opPintarHoy==="function") opPintarHoy(); }
  ssPintar(); ssProgramar();
  if(res.ok && typeof refrescarReclamos==="function") refrescarReclamos(s);
}
/* Aviso ámbar en el inicio: lo que espera señal y el resultado del último envío. */
function ssPintar(){
  const z=$("ssAviso"); if(!z) return;
  const s=sesionActual(); const xs=s?ssLeer(s.dni):[];
  const n=xs.reduce((a,x)=>a+x.tickets.length,0), u=SS.ultimo;
  let h="";
  if(n) h+=`<div class="ss-aviso"><b>${n} paquete${n===1?"":"s"} guardado${n===1?"":"s"} en tu celular</b>
      <span>Se envían solos cuando vuelva la señal. No los registres otra vez.</span>
      <button type="button" onclick="ssEnviar()">Enviar ahora</button></div>`;
  if(u){
    h+=`<div class="ss-aviso ${u.tomados.length||u.vencidos?"mal":"ok"}">`
      +(u.ok?`<b>Se enviaron ${u.ok} paquete${u.ok===1?"":"s"} que estaban sin señal</b>`:"")
      +(u.tomados.length?`<span>No entraron porque otra persona ya los tenía: ${esc(u.tomados.join(", "))}. Avisa a tu supervisora.</span>`:"")
      +(u.vencidos?`<span>${u.vencidos} se marcaron hace más de un día: pide a Ingeniería que los registre.</span>`:"")
      +`<button type="button" onclick="SS.ultimo=null;ssPintar()">Entendido</button></div>`;
  }
  z.innerHTML=h; z.hidden=!h;
}
window.addEventListener("online", ()=>setTimeout(ssEnviar, 1500));
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") ssEnviar(); });
