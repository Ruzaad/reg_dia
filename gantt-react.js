/* Gantt con React (solo Ingeniería de escritorio). React va en /vendor, sin build, y se descarga recién al abrir un Gantt:
   el celular del operario no lo carga. Si falla la carga, queda el Gantt simple que ya estaba dibujado.
   Uso: ganttMejorar(elementoHost, { desde, hasta, hoy, filas, leyenda, chips, vacio })
   fila = { id, t, sub, q, g, barras:[{ lane:0|1, thin, cls, i, f, pct, txt, tit }], det:[[etiqueta, valor]] } */
let _ganttLib = null;
function ganttCargar(){
  if(_ganttLib) return _ganttLib;
  const carga = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); });
  _ganttLib = carga("vendor/react.production.min.js?v=18.3.1")
    .then(() => Promise.all([carga("vendor/react-dom.production.min.js?v=18.3.1"), carga("vendor/htm.umd.js?v=3.1.1")]))
    .catch(e => { _ganttLib = null; throw e; });
  return _ganttLib;
}

function ganttMejorar(host, P){
  if(!host || window.innerWidth < 760) return;
  ganttCargar().then(() => {
    if(!host.isConnected) return;
    const { useState, useMemo, useRef, useLayoutEffect } = React, h = htm.bind(React.createElement);
    const dn = s => Math.floor(Date.parse(s) / 864e5), dm = n => { const d = new Date(n * 864e5).toISOString(); return d.slice(8, 10) + "/" + d.slice(5, 7); };
    const A = dn(P.desde), B = dn(P.hasta), HOY = dn(P.hoy), N = B - A + 1, LW = 230;
    function Gantt(){
      const [zoom, setZoom] = useState("mes"), [chip, setChip] = useState(""), [q, setQ] = useState(""), [sel, setSel] = useState(null), [ancho, setAncho] = useState(900);
      const ref = useRef(null);
      useLayoutEffect(() => { const m = () => ref.current && setAncho(ref.current.clientWidth); m(); const ro = new ResizeObserver(m); ref.current && ro.observe(ref.current); return () => ro.disconnect(); }, []);
      const z = zoom === "mes" ? Math.max(8, (ancho - LW - 4) / N) : zoom === "sem" ? 40 : 64;
      const x = d => (d - A) * z;
      const filas = useMemo(() => P.filas.filter(f => (!chip || f.g === chip) && (!q || f.q.includes(q.toLowerCase()))), [chip, q]);
      const ticks = []; for(let d = A; d <= B; d++) if(z >= 60 || d === A || (d - A >= 3 && new Date(d * 864e5).getUTCDay() === 1)) ticks.push(d);
      const barra = (b, f) => { if(!b.i) return null; const d1 = dn(b.i), d2 = dn(b.f || b.i), cls = "rg-b " + b.cls + (b.thin ? " rg-fino" : "") + (b.lane ? " rg-l1" : "");
        return h`<div class=${cls} role="button" tabIndex="0" key=${b.cls + b.i} title=${b.tit || ""} style=${{ left: x(d1), width: Math.max(10, x(d2 + 1) - x(d1)) }}
          onClick=${() => setSel(f)} onKeyDown=${e => { if(e.key === "Enter" || e.key === " ") setSel(f); }}>
          ${b.pct != null ? h`<i style=${{ width: Math.min(100, b.pct) + "%" }}></i>` : null}<span>${b.txt || ""}</span></div>`; };
      const W = N * z;
      return h`<div class="rg" ref=${ref}>
        <div class="rg-bar">
          ${P.chips ? h`<div class="rg-seg">${P.chips.map(c => h`<button type="button" key=${c.k} aria-pressed=${chip === c.k} class=${chip === c.k ? "activo" : ""} onClick=${() => setChip(c.k)}>${c.t}</button>`)}</div>` : null}
          <input type="search" class="gt-filtro" placeholder="Filtrar por OF, artículo o cliente" aria-label="Filtrar el Gantt" value=${q} onInput=${e => setQ(e.target.value)} />
          <span class="rg-n">${filas.length} OF</span><span class="rg-sp"></span>
          <div class="rg-seg" role="group" aria-label="Zoom">${[["mes", "Todo"], ["sem", "Semanas"], ["dia", "Días"]].map(([k, t]) => h`<button type="button" key=${k} aria-pressed=${zoom === k} class=${zoom === k ? "activo" : ""} onClick=${() => setZoom(k)}>${t}</button>`)}</div>
        </div>
        <div class="gt-leyenda">${P.leyenda.map(([c, t]) => h`<span key=${c}><i class=${"gt-k " + c}></i>${t}</span>`)}<span><i class="gt-k hoy"></i>Hoy</span></div>
        ${filas.length ? h`<div class="rg-sc"><div class="rg-g" style=${{ width: LW + W }}>
          <div class="rg-f rg-h"><div class="rg-l"><b>OF · artículo</b></div><div class="rg-t">${ticks.map(d => h`<span class="rg-tk" key=${d} style=${{ left: x(d) }}>${dm(d)}</span>`)}</div></div>
          ${filas.map(f => h`<div class=${"rg-f" + (sel === f ? " rg-sel" : "")} key=${f.id} onClick=${() => setSel(f)}>
            <div class="rg-l"><b>${f.t}</b>${f.sub ? h`<small>${f.sub}</small>` : null}</div>
            <div class="rg-t">${ticks.map(d => h`<span class="rg-gr" key=${d} style=${{ left: x(d) }}></span>`)}${f.barras.map(b => barra(b, f))}
              ${f.sin ? h`<span class="gt-sin">${f.sin}</span>` : null}
              ${HOY >= A && HOY <= B ? h`<span class="rg-ho" style=${{ left: x(HOY + .5) }}></span>` : null}</div></div>`)}
        </div></div>` : h`<p class="seccion-sub">${P.vacio || "Sin resultados"}</p>`}
        ${sel ? h`<div class="rg-det" aria-live="polite">${sel.det.map(([l, v]) => h`<div key=${l}><span>${l}</span><b>${v}</b></div>`)}<button type="button" class="rg-x" aria-label="Cerrar detalle" onClick=${() => setSel(null)}>×</button></div>` : null}
      </div>`;
    }
    ReactDOM.createRoot(host).render(h`<${Gantt}/>`);
  }).catch(() => {});
}
