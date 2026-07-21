"use client";

import { useEffect, useRef, useState } from "react";
import type { GuardarailEmision } from "@/lib/intermediario/guardarail-emision";
import type { Urgencia, EstadoCierre } from "@/lib/sii/estado-cierre";

// ── Vocabulario y colores (mapeados a los tokens del v5: --green/--amber/--red) ──
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function nombreMes(mesVenta: string): string { const m = Number(mesVenta.slice(5, 7)); return MESES[m - 1] ?? mesVenta; }

const COLOR: Record<Urgencia, string> = { baja: "var(--green)", alta: "var(--amber)", critica: "var(--red)", maxima: "var(--red)" };
const TINT: Record<Urgencia, string> = { baja: "rgba(34,197,94,.12)", alta: "rgba(245,158,11,.13)", critica: "rgba(239,68,68,.13)", maxima: "rgba(239,68,68,.13)" };
const BORD: Record<Urgencia, string> = { baja: "rgba(34,197,94,.30)", alta: "rgba(245,158,11,.32)", critica: "rgba(239,68,68,.32)", maxima: "rgba(239,68,68,.32)" };
const CHIP_LABEL: Record<EstadoCierre, string> = { al_dia: "Al día", ultima_llamada: "Última llamada", ya_cerro: "Ya cerró", cruza_el_ano: "Cruzó el año" };

function copyEstado(estado: EstadoCierre, dias: number): string {
  switch (estado) {
    case "al_dia": return "Estás dentro del plazo — emítelas al tiro.";
    case "ultima_llamada": return `Emítelas antes del 12 y entran limpias en tu F29 — te queda${dias === 1 ? "" : "n"} ${Math.max(dias, 0)} día${dias === 1 ? "" : "s"}.`;
    case "ya_cerro": return "El mes ya cerró. Emítelas igual y avísale a tu contador.";
    case "cruza_el_ano": return "Son del año pasado — van en tu renta de abril. Avísale a tu contador.";
  }
}

const POS_KEY = "massdte:guardarail:pos";
const SZ = 47;

export default function GuardarailOrbe({ guardarail }: { guardarail: GuardarailEmision | null }) {
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const st = useRef({ x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, raf: 0, dragging: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0, open: false });

  const buckets = guardarail?.resumen.buckets ?? [];
  const hero = buckets[0];
  const total = guardarail?.resumen.totalPendientes ?? 0;
  const peor = guardarail?.resumen.peorUrgencia ?? "baja";

  // ── Física de arrastre (resorte/boing) + posición persistida ──
  useEffect(() => {
    const orb = orbRef.current;
    if (!orb || !hero) return;
    const s = st.current;
    const clampX = (v: number) => Math.max(8, Math.min(v, window.innerWidth - SZ - 8));
    const clampY = (v: number) => Math.max(8, Math.min(v, window.innerHeight - SZ - 8));

    let px = window.innerWidth - SZ - 26, py = window.innerHeight - SZ - 26;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) { const p = JSON.parse(raw); if (typeof p.x === "number" && typeof p.y === "number") { px = p.x; py = p.y; } }
    } catch { /* sin posición guardada */ }
    s.x = s.tx = clampX(px); s.y = s.ty = clampY(py);
    render();

    function render() {
      orb!.style.left = s.x + "px"; orb!.style.top = s.y + "px";
      if (s.open) posBubble();
    }
    function posBubble() {
      const b = bubbleRef.current, tl = tailRef.current; if (!b || !tl) return;
      const bw = b.offsetWidth, bh = b.offsetHeight, ocx = s.x + SZ / 2;
      const left = Math.max(8, Math.min(ocx - bw / 2, window.innerWidth - bw - 8));
      let top = s.y - bh - 14; let below = false;
      if (top < 8) { top = s.y + SZ + 14; below = true; }
      b.style.left = left + "px"; b.style.top = top + "px";
      b.style.transformOrigin = (ocx - left) + "px " + (below ? "0" : "100%");
      const t = Math.max(12, Math.min(ocx - left - 6, bw - 24));
      tl.style.left = t + "px";
      if (below) { tl.style.top = "-6px"; tl.style.transform = "rotate(225deg)"; }
      else { tl.style.top = (bh - 6) + "px"; tl.style.transform = "rotate(45deg)"; }
    }
    function step() {
      const k = 0.16, d = 0.74;
      s.vx = (s.vx + (s.tx - s.x) * k) * d; s.vy = (s.vy + (s.ty - s.y) * k) * d;
      s.x += s.vx; s.y += s.vy;
      if (s.x < 8) { s.x = 8; s.vx *= -0.35; } if (s.x > window.innerWidth - SZ - 8) { s.x = window.innerWidth - SZ - 8; s.vx *= -0.35; }
      if (s.y < 8) { s.y = 8; s.vy *= -0.35; } if (s.y > window.innerHeight - SZ - 8) { s.y = window.innerHeight - SZ - 8; s.vy *= -0.35; }
      render();
      const quiet = Math.abs(s.vx) < 0.08 && Math.abs(s.vy) < 0.08 && Math.abs(s.tx - s.x) < 0.08 && Math.abs(s.ty - s.y) < 0.08;
      if (s.dragging || !quiet) { s.raf = requestAnimationFrame(step); }
      else { s.raf = 0; s.x = s.tx; s.y = s.ty; render(); }
    }
    function kick() { if (!s.raf) s.raf = requestAnimationFrame(step); }

    const onDown = (e: PointerEvent) => {
      s.dragging = true; s.moved = false; s.sx = e.clientX; s.sy = e.clientY; s.ox = s.x; s.oy = s.y;
      orb!.setPointerCapture(e.pointerId); orb!.classList.add("gr-grab", "gr-press");
    };
    const onMove = (e: PointerEvent) => {
      if (!s.dragging) return;
      const dx = e.clientX - s.sx, dy = e.clientY - s.sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) { s.moved = true; orb!.classList.remove("gr-press"); }
      s.tx = clampX(s.ox + dx); s.ty = clampY(s.oy + dy); kick();
    };
    const onUp = () => {
      s.dragging = false; orb!.classList.remove("gr-grab", "gr-press"); kick();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: s.tx, y: s.ty })); } catch { /* noop */ }
      if (!s.moved) setOpen((o) => !o);
    };
    const onResize = () => { s.tx = clampX(s.tx); s.ty = clampY(s.ty); s.x = clampX(s.x); s.y = clampY(s.y); render(); };
    const onDocDown = (e: PointerEvent) => {
      if (orb!.contains(e.target as Node) || bubbleRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };

    orb.addEventListener("pointerdown", onDown);
    orb.addEventListener("pointermove", onMove);
    orb.addEventListener("pointerup", onUp);
    orb.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onDocDown);
    return () => {
      if (s.raf) cancelAnimationFrame(s.raf);
      orb.removeEventListener("pointerdown", onDown);
      orb.removeEventListener("pointermove", onMove);
      orb.removeEventListener("pointerup", onUp);
      orb.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onDocDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero?.mesVenta]);

  // Mantener el estado 'open' sincronizado con el ref (para la física) + reposicionar al abrir.
  useEffect(() => {
    st.current.open = open;
    if (open) {
      const orb = orbRef.current, b = bubbleRef.current, tl = tailRef.current;
      if (orb && b && tl) {
        const s = st.current, bw = b.offsetWidth, bh = b.offsetHeight, ocx = s.x + SZ / 2;
        const left = Math.max(8, Math.min(ocx - bw / 2, window.innerWidth - bw - 8));
        let top = s.y - bh - 14; let below = false;
        if (top < 8) { top = s.y + SZ + 14; below = true; }
        b.style.left = left + "px"; b.style.top = top + "px";
        b.style.transformOrigin = (ocx - left) + "px " + (below ? "0" : "100%");
        const t = Math.max(12, Math.min(ocx - left - 6, bw - 24));
        tl.style.left = t + "px";
        if (below) { tl.style.top = "-6px"; tl.style.transform = "rotate(225deg)"; }
        else { tl.style.top = (bh - 6) + "px"; tl.style.transform = "rotate(45deg)"; }
      }
    }
  }, [open]);

  if (!guardarail || total === 0 || !hero) return null;

  const color = COLOR[peor];
  const animar = peor !== "baja";
  const otros = buckets.slice(1, 4);
  const cssVars = { ["--gr-color" as string]: color, ["--gr-tint" as string]: TINT[peor], ["--gr-bord" as string]: BORD[peor] } as React.CSSProperties;

  return (
    <>
      <style>{`
        .gr-orb{ position:fixed; width:${SZ}px; height:${SZ}px; border-radius:50%; display:flex; align-items:center; justify-content:center;
          background:var(--surface2); border:1px solid var(--border); color:var(--text3); cursor:grab; user-select:none; opacity:.42; filter:grayscale(.5);
          z-index:60; will-change:left,top,transform;
          transition:opacity .25s ease, filter .25s ease, color .2s ease, border-color .2s ease, box-shadow .25s ease, transform .4s cubic-bezier(.34,1.56,.64,1); }
        .gr-orb svg{ width:21px; height:21px; }
        .gr-orb .gr-badge{ position:absolute; top:-4px; right:-4px; min-width:17px; height:17px; padding:0 5px; border-radius:999px;
          background:var(--gr-color); color:#0f1014; font-size:10.5px; font-weight:700; display:flex; align-items:center; justify-content:center; border:2px solid var(--bg); }
        .gr-orb:hover, .gr-orb.gr-open{ opacity:1; filter:grayscale(0); color:var(--gr-color); border-color:var(--gr-bord);
          transform:scale(1.07); box-shadow:0 0 0 6px var(--gr-tint), 0 8px 22px -6px rgba(0,0,0,.5); }
        .gr-orb.gr-grab{ cursor:grabbing; opacity:1; filter:grayscale(0); transform:scale(1.13); }
        .gr-orb.gr-press{ transform:scale(.9); }
        .gr-orb:focus-visible{ outline:2px solid var(--accent); outline-offset:3px; }
        .gr-anim svg.gr-danger{ transform-origin:center; animation:grBreathe 2.5s ease-in-out infinite; }
        .gr-anim svg.gr-danger .gr-excl{ animation:grExcl 2.5s ease-in-out infinite; }
        @keyframes grBreathe{ 0%,100%{ transform:scale(1) } 50%{ transform:scale(1.07) } }
        @keyframes grExcl{ 0%,100%{ opacity:.45 } 50%{ opacity:1 } }
        .gr-bubble{ position:fixed; width:344px; max-width:calc(100vw - 16px); background:var(--surface); border:1px solid var(--border); border-radius:15px;
          padding:14px 16px; z-index:61; box-shadow:0 16px 44px -12px rgba(0,0,0,.62); opacity:0; transform:scale(.94) translateY(6px); pointer-events:none;
          transition:opacity .2s ease, transform .34s cubic-bezier(.22,1.2,.36,1); }
        .gr-bubble.gr-show{ opacity:1; transform:scale(1) translateY(0); pointer-events:auto; }
        .gr-bubble .gr-tail{ position:absolute; width:12px; height:12px; background:var(--surface); border-right:1px solid var(--border); border-bottom:1px solid var(--border); }
        .gr-eb{ font-size:10px; font-weight:600; letter-spacing:.11em; text-transform:uppercase; color:var(--text3); }
        .gr-top{ display:flex; align-items:center; gap:11px; margin-top:9px; }
        .gr-n{ font-size:30px; font-weight:700; letter-spacing:-.03em; color:var(--gr-color); line-height:1; }
        .gr-l{ font-size:14px; color:var(--text); font-weight:500; }
        .gr-amt{ font-size:12.5px; color:var(--text3); font-variant-numeric:tabular-nums; }
        .gr-chip{ margin-left:auto; align-self:flex-start; font-size:10.5px; font-weight:600; padding:4px 9px; border-radius:999px;
          color:var(--gr-color); background:var(--gr-tint); border:1px solid var(--gr-bord); white-space:nowrap; }
        .gr-state{ font-size:12.5px; line-height:1.5; color:var(--text2); margin-top:11px; }
        .gr-foot{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:13px; flex-wrap:wrap; }
        .gr-other{ display:inline-flex; align-items:center; gap:8px; font-size:11.5px; color:var(--text3); }
        .gr-pill{ display:inline-flex; align-items:center; gap:5px; }
        .gr-dot{ width:6px; height:6px; border-radius:50%; }
        .gr-cta{ font-size:12.5px; font-weight:600; color:#fff; background:var(--accent); border:none; border-radius:9px; padding:9px 16px; cursor:pointer; white-space:nowrap; }
        .gr-cta:hover{ background:var(--accent-hover); }
        @media(prefers-reduced-motion:reduce){ .gr-orb,.gr-bubble,.gr-cta{ transition:opacity .15s ease; } .gr-anim svg.gr-danger,.gr-anim svg.gr-danger .gr-excl{ animation:none; } }
      `}</style>

      <button
        ref={orbRef}
        className={`gr-orb${open ? " gr-open" : ""}${animar ? " gr-anim" : ""}`}
        style={cssVars}
        aria-label={`${total} boleta${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"} por emitir`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="gr-badge">{total}</span>
        <svg className="gr-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4.2c.62 0 1.2.33 1.5.87l7.4 13.1c.6 1.06-.16 2.38-1.5 2.38H4.6c-1.34 0-2.1-1.32-1.5-2.38l7.4-13.1c.3-.54.88-.87 1.5-.87z" />
          <path className="gr-excl" d="M12 9.4v4.1" />
          <circle className="gr-excl" cx="12" cy="16.7" r="0.95" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <div ref={bubbleRef} className={`gr-bubble${open ? " gr-show" : ""}`} style={cssVars} role="dialog" aria-label="Pendientes por emitir">
        <span ref={tailRef} className="gr-tail" />
        <div className="gr-eb">Pendientes por emitir</div>
        <div className="gr-top">
          <span className="gr-n">{hero.cantidad}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="gr-l">boleta{hero.cantidad === 1 ? "" : "s"} de {nombreMes(hero.mesVenta)}</span>
            <span className="gr-amt">${hero.monto.toLocaleString("es-CL")}</span>
          </span>
          <span className="gr-chip">{CHIP_LABEL[hero.estado]}</span>
        </div>
        <div className="gr-state">{copyEstado(hero.estado, hero.diasAlCierre)}</div>
        <div className="gr-foot">
          {otros.length > 0 ? (
            <span className="gr-other">
              {otros.map((b) => (
                <span key={b.mesVenta} className="gr-pill">
                  <span className="gr-dot" style={{ background: COLOR[b.urgencia] }} />
                  {nombreMes(b.mesVenta)} · {b.cantidad}
                </span>
              ))}
            </span>
          ) : <span />}
          <button
            className="gr-cta"
            onClick={() => { window.dispatchEvent(new CustomEvent("switch-tab", { detail: "emitir" })); setOpen(false); }}
          >
            Emitir estas &rarr;
          </button>
        </div>
      </div>
    </>
  );
}
