"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Visualizador de comprobante. Una foto suelta = zoom + pan (idéntico al visor de
// hoy). Si el comprobante es un ÁLBUM de Telegram (varias fotos), suma flechas ‹ ›
// + contador "2 / 3" para navegar. El patrón de zoom/pan (estado zoom/pan,
// transform, drag) está calcado de EditorAmpliado para que el caso de 1 imagen
// quede igual. Pensado para vivir dentro de un contenedor posicionado (rellena
// width/height 100%): el visor le da un escenario, el editor su panel izquierdo.
export default function GaleriaComprobante({ images, alt = "comprobante" }: {
  images: string[];
  alt?: string;
}) {
  const multi = images.length > 1;
  const [idx, setIdx] = useState(0);
  // Índice saneado en render (sin efecto): si el álbum encoge/cambia, nunca apunta fuera.
  const cur = images.length > 0 ? Math.min(idx, images.length - 1) : 0;

  // Zoom/pan — mismo patrón que EditorAmpliado: zoom 1→4 (paso .3), pan en px,
  // drag con el mouse solo cuando zoom>1, doble-click resetea. zoomRef guarda el
  // valor vivo para calcular el delta sin re-crear el handler (la rueda usa un
  // listener nativo estable).
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fija el zoom (clamp 1→4) y recentra al volver a 1×. Siempre desde un handler
  // (click/rueda/doble-click/navegación), nunca desde un efecto.
  const setZoomTo = useCallback((next: number) => {
    const z = Math.min(4, Math.max(1, Math.round(next * 10) / 10));
    zoomRef.current = z;
    setZoom(z);
    if (z === 1) setPan({ x: 0, y: 0 });
  }, []);
  const onZoom = useCallback((d: number) => setZoomTo(zoomRef.current + d), [setZoomTo]);
  const resetZoom = useCallback(() => setZoomTo(1), [setZoomTo]);

  // Navegar entre fotos del álbum → resetea zoom/pan (cada foto arranca limpia).
  const go = useCallback((dir: 1 | -1) => {
    if (!multi) return;
    setIdx((i) => {
      const c = Math.min(i, images.length - 1);
      return (c + dir + images.length) % images.length;
    });
    resetZoom();
  }, [multi, images.length, resetZoom]);

  // Teclas ←/→ para el álbum — pero IGNORA si el foco está en un input/textarea/
  // select (el editor tiene campos editables). Solo se engancha si hay >1 imagen.
  useEffect(() => {
    if (!multi) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") { e.stopPropagation(); go(-1); }
      else if (e.key === "ArrowRight") { e.stopPropagation(); go(1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [multi, go]);

  // Rueda = zoom (listener nativo no-pasivo para poder preventDefault sin warning).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onZoom(e.deltaY < 0 ? 0.3 : -0.3);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoom]);

  // Estética frosted, alineada con el pill de zoom del editor y el botón Cerrar del visor.
  const frost = {
    background: "rgba(20,20,26,.65)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
    border: "1px solid rgba(255,255,255,.08)", color: "var(--text2)",
  } as const;
  const arrow = {
    position: "absolute", top: "50%", transform: "translateY(-50%)", width: 38, height: 38,
    borderRadius: 999, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 2, ...frost,
  } as const;

  const src = images[cur];
  if (!src) return null;

  return (
    <div ref={rootRef} onClick={(e) => e.stopPropagation()}
      style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} draggable={false}
        onDoubleClick={resetZoom}
        onMouseDown={(e) => { dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; setDragging(true); }}
        onMouseMove={(e) => { if (dragRef.current && zoom > 1) setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y }); }}
        onMouseUp={() => { dragRef.current = null; setDragging(false); }}
        onMouseLeave={() => { dragRef.current = null; setDragging(false); }}
        style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain", borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,.32)", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default", transition: dragging ? "none" : "transform .12s ease", userSelect: "none" }} />

      {/* Contador + flechas: SOLO si es álbum (foto suelta = sin chrome de navegación). */}
      {multi && (
        <>
          <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 2, ...frost, borderRadius: 999, padding: "4px 12px", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: ".02em" }}>
            {cur + 1} / {images.length}
          </div>
          <button onClick={(e) => { e.stopPropagation(); go(-1); }} title="Anterior" aria-label="Imagen anterior" style={{ ...arrow, left: 12 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); go(1); }} title="Siguiente" aria-label="Imagen siguiente" style={{ ...arrow, right: 12 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </>
      )}

      {/* Pill de zoom (siempre): − % + */}
      <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 2, display: "flex", alignItems: "center", gap: 6, ...frost, borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 600 }}>
        <button onClick={(e) => { e.stopPropagation(); onZoom(-0.3); }} aria-label="Alejar" style={{ width: 22, height: 22, border: "none", background: "transparent", color: "var(--text2)", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>−</button>
        <span style={{ minWidth: 34, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{Math.round(zoom * 100)}%</span>
        <button onClick={(e) => { e.stopPropagation(); onZoom(0.3); }} aria-label="Acercar" style={{ width: 22, height: 22, border: "none", background: "transparent", color: "var(--text2)", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>+</button>
      </div>
    </div>
  );
}
