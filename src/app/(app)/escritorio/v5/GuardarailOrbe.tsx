"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GuardarailEmision } from "@/lib/intermediario/guardarail-emision";
import type { Urgencia, EstadoCierre } from "@/lib/sii/estado-cierre";
import { cambiarEmpresaActiva, type TeamEstado, type TeamMensaje, type TeamObjeto } from "./actions";
import { ultimoDocAbierto } from "./mesa-reload";
import { useTeamChat } from "./useTeamChat";
import { colorDeMiembro } from "./team-colores";

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
// Satélites: hasta 4 alrededor del globito, sobrepuestos, en estos ángulos.
const SAT_ANGULOS = [-125, -55, 15, 195];
const SAT_R = 31;

type Modo = { tipo: "avisos" } | { tipo: "lobby" } | { tipo: "conv"; con: string };

/**
 * El globito de avisos. Nació como guardarraíl de emisión (pendientes por
 * emitir con su semáforo) y desde 2026-09-06 es TAMBIÉN el chat del team
 * (diseño del fundador): el estado de aviso siempre manda —número y
 * triángulo nunca se sacrifican—; alrededor orbitan satélites con el color de
 * quien te escribió; tocar uno abre esa conversación ahí mismo; en modo team
 * ves al team y puedes "apuntar" lo que tienes abierto en el Check.
 * Sin pendientes y sin team, no existe.
 */
export default function GuardarailOrbe({ guardarail, team = null, empresaId = null, mesActual = null }: {
  guardarail: GuardarailEmision | null;
  team?: TeamEstado | null;
  empresaId?: string | null;
  mesActual?: string | null;
}) {
  const router = useRouter();
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLSpanElement | null>(null);
  const posRef = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<Modo>({ tipo: "avisos" });
  const st = useRef({ x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, raf: 0, dragging: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0, open: false, satelite: null as string | null });
  const hayAvisosRef = useRef(false);

  const buckets = guardarail?.resumen.buckets ?? [];
  const hero = buckets[0];
  const total = guardarail?.resumen.totalPendientes ?? 0;
  const peor = guardarail?.resumen.peorUrgencia ?? "baja";
  const hayAvisos = Boolean(guardarail && total > 0 && hero);
  hayAvisosRef.current = hayAvisos;

  const teamOn = Boolean(team && team.ok && team.equipo && team.miembros.length > 1);
  const usuarioId = team && team.ok && team.equipo ? team.usuarioId : null;
  const chat = useTeamChat(teamOn, usuarioId);
  const miembros = team && team.ok && team.equipo ? team.miembros : [];
  const colorDe = (id: string) => colorDeMiembro(Math.max(0, miembros.findIndex((m) => m.id === id)));
  const miembro = (id: string | null) => miembros.find((m) => m.id === id) ?? null;
  const satelites = Array.from(chat.noLeidosPor.keys()).slice(0, SAT_ANGULOS.length);
  const existe = hayAvisos || teamOn;

  // ── Física de arrastre (resorte/boing) + posición persistida ──
  useEffect(() => {
    const orb = orbRef.current;
    if (!orb || !existe) return;
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
    posRef.current = posBubble;
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
      // Un satélite bajo el dedo: se recuerda AHORA (tras la captura, el
      // target de los eventos siguientes es el globito).
      s.satelite = (e.target as HTMLElement | null)?.closest?.("[data-satelite]")?.getAttribute("data-satelite") ?? null;
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
      if (s.moved) return;
      if (s.satelite) {
        // Recibir NO requiere toggle: el satélite abre la conversación directo.
        setModo({ tipo: "conv", con: s.satelite });
        setOpen(true);
        s.satelite = null;
        return;
      }
      if (s.open) { cerrar(); return; }
      // Al abrir, el AVISO manda si hay pendientes; si no, el team.
      setModo(hayAvisosRef.current ? { tipo: "avisos" } : { tipo: "lobby" });
      setOpen(true);
    };
    // Al cerrar, el globito VUELVE SOLO a modo aviso.
    function cerrar() { setOpen(false); setModo({ tipo: "avisos" }); }
    const onResize = () => { s.tx = clampX(s.tx); s.ty = clampY(s.ty); s.x = clampX(s.x); s.y = clampY(s.y); render(); };
    const onDocDown = (e: PointerEvent) => {
      if (orb!.contains(e.target as Node) || bubbleRef.current?.contains(e.target as Node)) return;
      cerrar();
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
  }, [hero?.mesVenta, existe]);

  useEffect(() => { st.current.open = open; }, [open]);

  // La burbuja cambia de tamaño con el contenido (lobby, conversación): se
  // reposiciona tras cada render que la afecte, para que la cola no se descuadre.
  useEffect(() => {
    if (open) posRef.current?.();
  }, [open, modo, chat.mensajes.length]);

  // Abrir una conversación marca leído lo de esa persona.
  useEffect(() => {
    if (open && modo.tipo === "conv") chat.leer(modo.con);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modo, chat.mensajes.length]);

  if (!existe) return null;

  const color = hayAvisos ? COLOR[peor] : "var(--text2)";
  const animar = hayAvisos && peor !== "baja";
  const otros = buckets.slice(1, 4);
  const cssVars = {
    ["--gr-color" as string]: color,
    ["--gr-tint" as string]: hayAvisos ? TINT[peor] : "rgba(120,130,150,.12)",
    ["--gr-bord" as string]: hayAvisos ? BORD[peor] : "rgba(120,130,150,.30)",
  } as React.CSSProperties;
  const badge = hayAvisos ? total : chat.noLeidos;
  const ariaLabel = hayAvisos
    ? `${total} boleta${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"} por emitir${chat.noLeidos ? ` · ${chat.noLeidos} mensaje${chat.noLeidos === 1 ? "" : "s"} del team` : ""}`
    : `Team${chat.noLeidos ? ` · ${chat.noLeidos} mensaje${chat.noLeidos === 1 ? "" : "s"} sin leer` : ""}`;

  // ── Salto a un objeto apuntado (pide permiso; cruza de empresa si hace falta) ──
  async function irA(obj: TeamObjeto) {
    const cruza = Boolean(empresaId && obj.empresaId !== empresaId);
    const ok = window.confirm(`¿Ir a «${obj.label}»${cruza ? " (está en otra empresa)" : ""}? Termina o guarda lo que estás haciendo.`);
    if (!ok) return;
    try {
      sessionStorage.setItem("massdte:volver", JSON.stringify({ empresaId, month: mesActual, documentoId: ultimoDocAbierto.doc?.id ?? null, label: ultimoDocAbierto.doc?.label ?? "donde estabas" }));
    } catch { /* sin volver */ }
    setOpen(false); setModo({ tipo: "avisos" });
    if (cruza) {
      const r = await cambiarEmpresaActiva(obj.empresaId);
      if (!r.ok) { window.alert(r.detalle ?? "No se pudo cambiar de empresa."); return; }
      try { sessionStorage.setItem("massdte:salto", JSON.stringify({ documentoId: obj.id, month: obj.mes || undefined })); } catch { /* noop */ }
      router.refresh();
      return;
    }
    window.dispatchEvent(new CustomEvent("massdte:open-doc", { detail: { documentoId: obj.id, month: obj.mes || undefined } }));
  }

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
        .gr-orb.gr-team-only .gr-badge{ color:#fff; }
        .gr-orb:hover, .gr-orb.gr-open, .gr-orb.gr-sat{ opacity:1; filter:grayscale(0); color:var(--gr-color); border-color:var(--gr-bord);
          box-shadow:0 0 0 6px var(--gr-tint), 0 8px 22px -6px rgba(0,0,0,.5); }
        .gr-orb:hover, .gr-orb.gr-open{ transform:scale(1.07); }
        .gr-orb.gr-grab{ cursor:grabbing; opacity:1; filter:grayscale(0); transform:scale(1.13); }
        .gr-orb.gr-press{ transform:scale(.9); }
        .gr-orb:focus-visible{ outline:2px solid var(--accent); outline-offset:3px; }
        .gr-anim svg.gr-danger{ transform-origin:center; animation:grBreathe 2.5s ease-in-out infinite; }
        .gr-anim svg.gr-danger .gr-excl{ animation:grExcl 2.5s ease-in-out infinite; }
        @keyframes grBreathe{ 0%,100%{ transform:scale(1) } 50%{ transform:scale(1.07) } }
        @keyframes grExcl{ 0%,100%{ opacity:.45 } 50%{ opacity:1 } }
        /* Satélites: quién te escribió, sobrepuestos al globito con SU color. */
        .gr-sat-dot{ position:absolute; width:19px; height:19px; border-radius:50%; border:2px solid var(--bg); display:flex; align-items:center; justify-content:center;
          font-size:8.5px; font-weight:900; color:#fff; letter-spacing:.02em; cursor:pointer; box-shadow:0 3px 10px -3px rgba(0,0,0,.55);
          animation:grSatIn .5s cubic-bezier(.34,1.56,.64,1) both; }
        @keyframes grSatIn{ from{ transform:scale(0) } to{ transform:scale(1) } }
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
        /* Toggle aviso | team, arriba a la derecha de la burbuja. */
        .gr-modo{ display:inline-flex; gap:2px; padding:2px; border-radius:999px; background:var(--bg-muted); }
        .gr-modo button{ border:0; background:transparent; color:var(--text3); font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; padding:4px 9px; border-radius:999px; cursor:pointer; font-family:inherit; }
        .gr-modo button.on{ background:var(--surface); color:var(--text); box-shadow:0 1px 3px rgba(0,0,0,.18); }
        .gr-lnk{ border:0; background:transparent; color:var(--text2); font-size:11px; font-weight:700; cursor:pointer; padding:0; font-family:inherit; }
        .gr-lnk:hover{ color:var(--text); }
        .gr-row{ display:flex; align-items:center; gap:9px; width:100%; padding:7px 6px; border-radius:9px; border:0; background:transparent; color:var(--text); text-align:left; cursor:pointer; font-family:inherit; }
        .gr-row:hover{ background:var(--bg-muted); }
        .gr-av{ width:26px; height:26px; border-radius:8px; display:grid; place-items:center; color:#fff; font-size:9.5px; font-weight:900; flex-shrink:0; }
        .gr-msgs{ display:flex; flex-direction:column; gap:6px; max-height:240px; overflow-y:auto; margin-top:10px; padding-right:2px; scrollbar-width:thin; }
        .gr-msg{ max-width:86%; padding:7px 10px; border-radius:11px; font-size:12px; line-height:1.4; color:var(--text); background:var(--bg-muted); white-space:pre-wrap; word-break:break-word; }
        .gr-msg.mio{ align-self:flex-end; background:rgba(232,85,62,.12); }
        .gr-obj{ display:inline-flex; align-items:center; gap:6px; margin-top:5px; padding:4px 8px; border-radius:8px; border:1px dashed var(--border); background:var(--surface); color:var(--text2); font-size:10.5px; font-weight:700; cursor:pointer; font-family:inherit; max-width:100%; }
        .gr-obj:hover{ color:var(--accent); border-color:rgba(232,85,62,.4); }
        .gr-obj span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .gr-compose{ display:flex; flex-direction:column; gap:6px; margin-top:10px; }
        .gr-compose textarea{ width:100%; box-sizing:border-box; resize:none; min-height:38px; max-height:96px; padding:8px 10px; border-radius:10px; border:1px solid var(--border); background:var(--bg-muted); color:var(--text); font-size:12px; line-height:1.4; outline:none; font-family:inherit; }
        .gr-compose textarea:focus{ border-color:rgba(232,85,62,.4); }
        .gr-apuntar{ display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:8px; border:1px dashed var(--border); background:transparent; color:var(--text3); font-size:10.5px; font-weight:700; cursor:pointer; font-family:inherit; max-width:100%; }
        .gr-apuntar.on{ color:var(--accent); border-color:rgba(232,85,62,.45); border-style:solid; background:rgba(232,85,62,.07); }
        .gr-apuntar span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .gr-send{ font-size:11.5px; font-weight:800; color:#fff; background:var(--accent); border:none; border-radius:9px; padding:7px 13px; cursor:pointer; font-family:inherit; }
        .gr-send:disabled{ opacity:.5; cursor:default; }
        @media(prefers-reduced-motion:reduce){ .gr-orb,.gr-bubble,.gr-cta{ transition:opacity .15s ease; } .gr-anim svg.gr-danger,.gr-anim svg.gr-danger .gr-excl,.gr-sat-dot{ animation:none; } }
      `}</style>

      <button
        ref={orbRef}
        className={`gr-orb${open ? " gr-open" : ""}${animar ? " gr-anim" : ""}${!hayAvisos ? " gr-team-only" : ""}${satelites.length ? " gr-sat" : ""}`}
        style={cssVars}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {badge > 0 && <span className="gr-badge">{badge}</span>}
        {hayAvisos ? (
          <svg className="gr-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4.2c.62 0 1.2.33 1.5.87l7.4 13.1c.6 1.06-.16 2.38-1.5 2.38H4.6c-1.34 0-2.1-1.32-1.5-2.38l7.4-13.1c.3-.54.88-.87 1.5-.87z" />
            <path className="gr-excl" d="M12 9.4v4.1" />
            <circle className="gr-excl" cx="12" cy="16.7" r="0.95" fill="currentColor" stroke="none" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="8.5" r="3.2" /><path d="M2.8 19c.5-3.3 3-5.2 6.2-5.2s5.7 1.9 6.2 5.2" />
            <circle cx="17" cy="9.5" r="2.4" /><path d="M15.6 13.4c2.9-.3 5.1 1.3 5.6 4.3" />
          </svg>
        )}
        {satelites.map((id, i) => {
          const ang = (SAT_ANGULOS[i] * Math.PI) / 180;
          const cx = SZ / 2 + Math.cos(ang) * SAT_R - 9.5, cy = SZ / 2 + Math.sin(ang) * SAT_R - 9.5;
          const m = miembro(id);
          return (
            <span key={id} data-satelite={id} className="gr-sat-dot" title={`${m?.nombre ?? "Alguien"} te escribió`}
              style={{ left: cx, top: cy, background: colorDe(id), animationDelay: `${i * 60}ms` }}>
              {(m?.iniciales ?? "?").slice(0, 2)}
            </span>
          );
        })}
      </button>

      <div ref={bubbleRef} className={`gr-bubble${open ? " gr-show" : ""}`} style={cssVars} role="dialog" aria-label={modo.tipo === "avisos" ? "Pendientes por emitir" : "Team"}>
        <span ref={tailRef} className="gr-tail" />

        {modo.tipo === "avisos" && hayAvisos && hero && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div className="gr-eb">Pendientes por emitir</div>
              {teamOn && <ModoToggle modo="avisos" onTeam={() => setModo({ tipo: "lobby" })} onAvisos={() => setModo({ tipo: "avisos" })} />}
            </div>
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
                onClick={() => { window.dispatchEvent(new CustomEvent("switch-tab", { detail: "emitir" })); setOpen(false); setModo({ tipo: "avisos" }); }}
              >
                Emitir estas &rarr;
              </button>
            </div>
          </>
        )}

        {modo.tipo === "lobby" && teamOn && usuarioId && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div className="gr-eb">Team</div>
              {hayAvisos && <ModoToggle modo="team" onTeam={() => setModo({ tipo: "lobby" })} onAvisos={() => setModo({ tipo: "avisos" })} />}
            </div>
            <VolverChip onIr={irA} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
              {miembros.filter((m) => m.id !== usuarioId).map((m) => {
                const n = chat.noLeidosPor.get(m.id) ?? 0;
                const ultimo = chat.conversacion(m.id).at(-1);
                return (
                  <button key={m.id} type="button" className="gr-row" onClick={() => setModo({ tipo: "conv", con: m.id })}>
                    <span className="gr-av" style={{ background: colorDe(m.id) }}>{m.iniciales}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nombre}</span>
                      <span style={{ display: "block", fontSize: 10.5, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ultimo ? `${ultimo.de === usuarioId ? "Tú: " : ""}${ultimo.texto}` : "Escríbele"}
                      </span>
                    </span>
                    {n > 0 && <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: colorDe(m.id), color: "#fff", fontSize: 10, fontWeight: 800, display: "grid", placeItems: "center" }}>{n}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {modo.tipo === "conv" && teamOn && usuarioId && (
          <Conversacion
            con={miembro(modo.con)}
            color={colorDe(modo.con)}
            yo={usuarioId}
            mensajes={chat.conversacion(modo.con)}
            onVolver={() => setModo({ tipo: "lobby" })}
            onEnviar={(texto, objeto) => chat.enviar(modo.con, texto, objeto)}
            onIr={irA}
          />
        )}
      </div>
    </>
  );
}

function ModoToggle({ modo, onAvisos, onTeam }: { modo: "avisos" | "team"; onAvisos: () => void; onTeam: () => void }) {
  return (
    <span className="gr-modo" role="tablist" aria-label="Aviso o team">
      <button type="button" role="tab" aria-selected={modo === "avisos"} className={modo === "avisos" ? "on" : ""} onClick={onAvisos}>Aviso</button>
      <button type="button" role="tab" aria-selected={modo === "team"} className={modo === "team" ? "on" : ""} onClick={onTeam}>Team</button>
    </span>
  );
}

/** "← Volver donde estabas": queda después de un salto, hasta que se usa. */
function VolverChip({ onIr }: { onIr: (obj: TeamObjeto) => void }) {
  // Se lee al montar (la burbuja se monta con el globito; el chip aparece al
  // abrir el lobby después de un salto). Sin window (SSR) no hay nada.
  const [volver, setVolver] = useState<{ empresaId: string | null; month: string | null; documentoId: string | null; label: string } | null>(() => {
    if (typeof window === "undefined") return null;
    try { const raw = sessionStorage.getItem("massdte:volver"); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  if (!volver?.empresaId || !volver.documentoId) return null;
  return (
    <button type="button" className="gr-obj" style={{ marginTop: 8 }}
      onClick={() => { try { sessionStorage.removeItem("massdte:volver"); } catch { /* noop */ } setVolver(null); onIr({ tipo: "documento", id: volver.documentoId!, empresaId: volver.empresaId!, label: volver.label, mes: volver.month ?? "" }); }}>
      ← <span>Volver a {volver.label}</span>
    </button>
  );
}

function Conversacion({ con, color, yo, mensajes, onVolver, onEnviar, onIr }: {
  con: { id: string; nombre: string; iniciales: string } | null;
  color: string;
  yo: string;
  mensajes: TeamMensaje[];
  onVolver: () => void;
  onEnviar: (texto: string, objeto: TeamObjeto | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  onIr: (obj: TeamObjeto) => void;
}) {
  const [texto, setTexto] = useState("");
  const [apuntar, setApuntar] = useState(false);
  const [doc, setDoc] = useState(ultimoDocAbierto.doc);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Si lo abierto desaparece, la referencia cae sola (derivado, no estado).
  const apuntando = apuntar && Boolean(doc);

  // Lo abierto en el visor cambia sin que el chat se entere: se escucha.
  useEffect(() => {
    const h = () => setDoc(ultimoDocAbierto.doc);
    window.addEventListener("massdte:doc-abierto", h);
    return () => window.removeEventListener("massdte:doc-abierto", h);
  }, []);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [mensajes.length]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true); setError(null);
    const objeto: TeamObjeto | null = apuntando && doc ? { tipo: "documento", id: doc.id, empresaId: doc.empresaId, label: doc.label, mes: doc.month } : null;
    const r = await onEnviar(t, objeto);
    setEnviando(false);
    if (!r.ok) { setError(r.error); return; }
    setTexto(""); setApuntar(false);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <button type="button" className="gr-lnk" onClick={onVolver} aria-label="Volver al team">←</button>
        <span className="gr-av" style={{ background: color }}>{con?.iniciales ?? "?"}</span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{con?.nombre ?? "Ex-miembro"}</span>
      </div>
      <div ref={listRef} className="gr-msgs">
        {mensajes.length === 0 && <div style={{ fontSize: 11.5, color: "var(--text3)", padding: "6px 2px" }}>Todavía nada. Escríbele — lo ve aunque esté desconectado.</div>}
        {mensajes.slice(-60).map((m) => (
          <div key={m.id} className={`gr-msg${m.de === yo ? " mio" : ""}`}>
            {m.texto}
            {m.objeto && (
              <button type="button" className="gr-obj" onClick={() => onIr(m.objeto!)} title="Ir a este documento">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
                <span>{m.objeto.label}</span>
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="gr-compose">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={`Mensaje para ${con?.nombre?.split(" ")[0] ?? "el team"}`} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {doc ? (
            <button type="button" className={`gr-apuntar${apuntando ? " on" : ""}`} onClick={() => setApuntar((v) => !v)} title={apuntando ? "Quitar la referencia" : "Adjuntar lo que tienes abierto en el Check"}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.5 12 21.5a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a1.5 1.5 0 0 1-2.1-2.1L15.5 8" /></svg>
              <span>{apuntando ? "Apuntando: " : "Apuntar "}{doc.label}</span>
            </button>
          ) : <span style={{ fontSize: 10.5, color: "var(--text3)" }}>Abre algo en el Check para apuntarlo</span>}
          <button type="button" className="gr-send" disabled={!texto.trim() || enviando} onClick={() => void enviar()}>{enviando ? "…" : "Enviar"}</button>
        </div>
        {error && <div style={{ fontSize: 10.5, color: "var(--red)", lineHeight: 1.4 }}>{error}</div>}
      </div>
    </>
  );
}
