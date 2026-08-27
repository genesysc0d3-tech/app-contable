"use client";

import { useEffect, useRef, useState } from "react";
import CalendarStrip from "@/app/(app)/escritorio/v5/CalendarStrip";
import GlowWrap from "@/app/(app)/escritorio/v5/GlowWrap";
import type { MesaDateDependent } from "@/app/(app)/escritorio/v5/mesa-data";

/**
 * Mock vivo de la MESA FACTURAS con componentes reales del v5.
 * Data 100% falsa; ninguna acción llama al servidor.
 */

// ── Calendario falso para el CalendarStrip REAL ──
const calFake = {
  y: 2026, m: 7, monthName: "Agosto", daysInMonth: 31,
  byDay: { 18: { p: 2, a: 1 }, 19: { p: 0, a: 3 }, 21: { p: 3, a: 0 }, 22: { p: 1, a: 2 } },
  today: 22, isThisMonth: true, selDay: 22,
  weekRange: { start: "2026-08-16", end: "2026-08-23" },
  prevMonthParam: "2026-6", nextMonthParam: "2026-8",
  selectedDateLabel: "semana 16–22 agosto",
  workMode: "week", selDate: "2026-08-22",
} as unknown as MesaDateDependent["calendar"];

const LOGO_URL = "/api/empresa/logo/current";

export default function MockFacturasClient() {
  const [mesa, setMesa] = useState<"boletas" | "facturas">("facturas");
  const esFacturas = mesa === "facturas";
  return (
    <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", color: "var(--text)", minHeight: "100vh", padding: "20px 20px 20px", background: "var(--bg)" }}>
      <style>{`
        .app{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(0,7.7fr);max-width:1400px;margin:0 auto;gap:20px;height:calc(100vh - 94px);padding:0;position:relative;min-height:0;overflow:visible}
        .left-col{display:flex;flex-direction:column;gap:10px;overflow:visible;min-height:0;padding-left:8px}
        .mfx-note{max-width:1400px;margin:0 auto 10px;font-size:10.5px;color:var(--text3)}
        .mfx-note b{color:var(--text2)}
      `}</style>

      <div className="mfx-note"><b>MOCK · solo dev</b> — mesa Facturas con componentes reales y data falsa. Toca el logo para el conmutador BO|FA. Nada de lo que hagas acá toca datos.</div>

      {/* ── HEADER: misma geometría que el v5 real (brand 137 / rail 141 / acciones 178) ── */}
      <div style={{ position: "relative", height: 38, marginBottom: 12, maxWidth: 1400, marginLeft: "auto", marginRight: "auto" }}>
        <div style={{ position: "absolute", left: 0, top: -14, height: 52, width: 200, display: "flex", alignItems: "flex-start", flexDirection: "column", zIndex: 5 }}>
          <div style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: ".14em", lineHeight: 1, marginBottom: 3, color: esFacturas ? "var(--lime)" : "var(--accent)", textTransform: "uppercase" }}>
            {esFacturas ? "Mesa Facturas" : "Mesa Boletas"}
          </div>
          <MockBrand mesa={mesa} onMesa={setMesa} />
        </div>
        <CalendarStrip cal={calFake} navigate={() => {}} />
        <div style={{ position: "absolute", right: 0, top: 0, height: 38, width: 178, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          {["🔍", "📊", "🌙", "⎋"].map((ic, i) => (
            <span key={i} style={{ width: 34, height: 34, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", display: "grid", placeItems: "center", fontSize: 13, color: "var(--text2)" }}>{ic}</span>
          ))}
        </div>
      </div>

      {/* ── CUERPO ── */}
      <div className="app">
        <div className="left-col">
          {/* REGISTRO DE FACTURAS (estructura de RegistrosToggleCard) */}
          <GlowWrap glow style={{ borderRadius: 16, overflow: "visible" }}>
            <div style={{ background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "12px 12px" }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(201,242,75,.10)", border: "1px solid rgba(201,242,75,.16)", display: "grid", placeItems: "center", color: "var(--lime)", flexShrink: 0 }}>
                  <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, letterSpacing: "-.01em" }}>REGISTRO DE FACTURAS</span>
                  <span style={{ display: "block", fontSize: 9.5, color: "var(--text2)", marginTop: 1 }}>agosto · 11 facturas · $9,4M neto</span>
                </span>
                <span style={{ marginLeft: "auto", color: "var(--lime)" }}>›</span>
              </div>
              <div style={{ width: 74, borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "8px 6px" }}>
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".06em", color: "var(--text3)" }}>ACUSES</span>
                <span style={{ fontSize: 16, fontWeight: 800, background: "var(--bg-muted)", borderRadius: 8, padding: "2px 10px" }}>1</span>
              </div>
            </div>
          </GlowWrap>

          {/* SUBIR PLANILLA DE FACTURAS (card acción, acento lime) */}
          <GlowWrap glow style={{ borderRadius: 16, overflow: "visible" }}>
            <div style={{ background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "rgba(201,242,75,.05)", borderBottom: "1px solid rgba(201,242,75,.08)", cursor: "pointer" }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(201,242,75,.16)", background: "rgba(201,242,75,.08)", display: "grid", placeItems: "center", color: "var(--lime)", flexShrink: 0 }}>
                  <Icon d="M12 16V4m0 0L7 9m5-5l5 5M4 20h16" size={14} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 800, letterSpacing: "-.02em", color: "var(--lime)" }}>SUBIR PLANILLA DE FACTURAS</span>
                  <span style={{ display: "block", fontSize: 9, color: "var(--text2)", marginTop: 1 }}>Excel estructurado → facturas 33/34</span>
                </span>
              </div>
              <div style={{ padding: "9px 14px", fontSize: 9.5, color: "var(--text3)" }}>
                fecha · RUT receptor · monto · detalle — <span style={{ color: "var(--lime)", fontWeight: 700 }}>descargar plantilla ↓</span>
              </div>
            </div>
          </GlowWrap>

          {/* FACTURA ÚNICA */}
          <GlowWrap glow style={{ borderRadius: 16, overflow: "visible" }}>
            <div style={{ background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-muted)", display: "grid", placeItems: "center", color: "var(--text2)", flexShrink: 0 }}>
                  <Icon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" size={14} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 800, letterSpacing: "-.02em" }}>FACTURA ÚNICA</span>
                  <span style={{ display: "block", fontSize: 9, color: "var(--text2)", marginTop: 1 }}>Formulario, de a una</span>
                </span>
              </div>
            </div>
          </GlowWrap>

          {/* USO DEL MES (cupo compartido) */}
          <div style={{ background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", padding: "14px 16px", marginTop: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>Uso del mes</span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", color: "var(--accent)", border: "1px solid rgba(232,85,62,.3)", borderRadius: 9, padding: "4px 10px" }}>PLAN<br />Business</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 11.5 }}>
              <span>
                <b>Documentos masivos</b>
                <span style={{ display: "block", fontSize: 9, color: "var(--text3)" }}>cupo compartido boletas + facturas</span>
              </span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>50 / 3.000</b>
            </div>
            <div style={{ height: 4, borderRadius: 99, background: "rgba(255,255,255,.06)", marginTop: 8 }}><div style={{ width: "2%", height: "100%", borderRadius: 99, background: "var(--green)" }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text2)", marginTop: 12 }}><span>🏢 Empresas</span><b>1 / 3</b></div>
          </div>
        </div>

        {/* ── PANEL DERECHO ── */}
        <div style={{ background: "var(--surface)", borderRadius: 18, border: "1px solid var(--border)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {/* tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--accent)", color: "#fff", borderRadius: 999, padding: "9px 18px", fontWeight: 800, fontSize: 13, boxShadow: "0 6px 24px rgba(232,85,62,.35)" }}>
              <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" size={15} color="#fff" /> Check de facturas <span style={{ background: "rgba(0,0,0,.22)", borderRadius: 99, fontSize: 10, padding: "1px 8px" }}>»</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text2)", fontWeight: 700, fontSize: 13 }}><Icon d="M13 10V3L4 14h7v7l9-11h-7z" size={14} /> Emitir</span>
            <span style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text2)", fontWeight: 700, fontSize: 13 }}><Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={14} /> Facturas</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--text3)" }}><b style={{ color: "var(--lime)" }}>12</b> esperando · <b style={{ color: "var(--lime)" }}>0</b> aprobadas <span style={{ marginLeft: 8 }}>semana 16–22 agosto</span></span>
          </div>

          {/* vacío central */}
          <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text3)", minHeight: 140 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 64, height: 64, margin: "0 auto 14px", borderRadius: 16, border: "2px solid rgba(201,242,75,.5)", display: "grid", placeItems: "center", color: "var(--lime)" }}>
                <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={30} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>Selecciona una planilla</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Elige una fila de abajo y su detalle aparece acá para revisarla o emitirla.</div>
            </div>
          </div>

          {/* paneles inferiores */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid var(--border)", minHeight: 200 }}>
            <div style={{ borderRight: "1px solid var(--border)", padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 800, paddingBottom: 8 }}>
                <span style={{ color: "var(--text3)" }}>⠿</span> Planillas <span style={{ fontWeight: 600, color: "var(--text3)", fontSize: 11 }}>facturas</span>
                <span style={{ marginLeft: "auto", color: "var(--text3)" }}>1</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, cursor: "pointer", border: "1px solid transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-muted)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--green)", flexShrink: 0 }} />
                <span style={{ fontWeight: 800, fontSize: 12.5 }}>FACTURAS AGOSTO M&E</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text3)", whiteSpace: "nowrap" }}>12 filas · hoy 15:40</span>
              </div>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 800, paddingBottom: 8 }}>
                <span style={{ color: "var(--text3)" }}>⠿</span> Factura única <span style={{ fontWeight: 600, color: "var(--text3)", fontSize: 11 }}>formulario</span>
                <span style={{ marginLeft: "auto", color: "var(--text3)" }}>0</span>
              </div>
              <div style={{ color: "var(--text3)", fontSize: 12, padding: "10px 12px" }}>Sin facturas únicas.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Icon({ d, size = 16, color = "currentColor" }: { d: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

/**
 * Brand + popup calcados del código REAL de EmpresaBrand (estructura, gaps,
 * radios, sombras y animación ebPopIn idénticos), extendido con el
 * conmutador de mesas BO|FA. Handlers 100% locales — cero server actions.
 */
function MockBrand({ mesa, onMesa }: { mesa: "boletas" | "facturas"; onMesa: (m: "boletas" | "facturas") => void }) {
  const [open, setOpen] = useState(false);
  const [variante, setVariante] = useState<"business" | "startpro">("business");
  const [logoOk, setLogoOk] = useState(true);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const empresas = [
    { ini: "AL", nombre: "ALPHA CODE SPA", rut: "78.448.088-7", actual: true },
    { ini: "ME", nombre: "M & E SpA", rut: "76.998.221-4", actual: false },
  ];

  function BoFa({ actual }: { actual: boolean }) {
    return (
      <span style={{ marginLeft: "auto", display: "flex", gap: 5, flexShrink: 0 }}>
        <button type="button" onClick={() => { onMesa("boletas"); setOpen(false); }}
          style={{ width: 34, height: 26, borderRadius: 8, fontSize: 10, fontWeight: 900, cursor: "pointer", font: "inherit",
            border: actual && mesa === "boletas" ? "1px solid rgba(232,85,62,.5)" : "1px solid var(--border)",
            background: actual && mesa === "boletas" ? "rgba(232,85,62,.1)" : "transparent",
            color: actual && mesa === "boletas" ? "var(--accent)" : "var(--text3)" }}>BO</button>
        <button type="button" onClick={() => { onMesa("facturas"); setOpen(false); }}
          style={{ width: 34, height: 26, borderRadius: 8, fontSize: 10, fontWeight: 900, cursor: "pointer", font: "inherit",
            border: actual && mesa === "facturas" ? "1px solid rgba(201,242,75,.5)" : "1px solid var(--border)",
            background: actual && mesa === "facturas" ? "rgba(201,242,75,.1)" : "transparent",
            color: actual && mesa === "facturas" ? "var(--lime)" : "var(--text3)" }}>FA</button>
      </span>
    );
  }

  return (
    <span ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center", minWidth: 0, width: "fit-content", whiteSpace: "nowrap", flexShrink: 0, overflow: "visible" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, border: 0, padding: 0, margin: 0, background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left", font: "inherit" }}>
        {logoOk ? (
          <span style={{ maxWidth: 116, height: 38, display: "flex", alignItems: "center", overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_URL} alt="Logo" style={{ maxHeight: 38, maxWidth: "100%", objectFit: "contain", display: "block" }} onError={() => setLogoOk(false)} />
          </span>
        ) : (
          <span style={{ fontSize: 18, fontWeight: 700 }}>AlphaCode</span>
        )}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text2)", flexShrink: 0 }}><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="eb-pop-mock" style={{ position: "absolute", left: 0, top: 48, zIndex: 90, width: "min(320px, calc(100vw - 28px))", padding: 8, borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 24px 70px rgba(0,0,0,.34), inset 0 1px 0 var(--border)", color: "var(--text)", whiteSpace: "normal", transformOrigin: "top left" }}>
          <style>{`
            @keyframes ebPopInMock{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
            .eb-pop-mock{animation:ebPopInMock .18s cubic-bezier(.22,1,.36,1) both;}
          `}</style>

          {variante === "business" ? (
            <>
              <div style={{ padding: "7px 8px 9px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Cambiar empresa · y mesa</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {empresas.map((e) => (
                  <div key={e.ini} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 42, padding: "7px 8px", borderRadius: 9, border: e.actual ? "1px solid rgba(232,85,62,.22)" : "1px solid transparent", background: e.actual ? "rgba(232,85,62,.09)" : "transparent" }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: e.actual ? "rgba(232,85,62,.14)" : "var(--bg-muted)", color: e.actual ? "var(--accent)" : "var(--text2)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{e.ini}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nombre}</span>
                      <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)" }}>{e.rut}</span>
                    </span>
                    <BoFa actual={e.actual} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 8px", borderRadius: 9, border: "1px dashed var(--border)", color: "var(--text2)", fontSize: 11, fontWeight: 700, marginTop: 6 }}>＋ &nbsp;Agregar empresa</div>
            </>
          ) : (
            <>
              <div style={{ padding: "7px 8px 9px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Tu empresa</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 42, padding: "7px 8px", borderRadius: 9, border: "1px solid rgba(232,85,62,.22)", background: "rgba(232,85,62,.09)" }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(232,85,62,.14)", color: "var(--accent)", fontSize: 10, fontWeight: 900 }}>AL</span>
                <span><span style={{ display: "block", fontSize: 11, fontWeight: 800 }}>ALPHA CODE SPA</span><span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)" }}>78.448.088-7</span></span>
                <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 850, color: "var(--accent)" }}>Actual</span>
              </div>
              <div style={{ padding: "12px 8px 7px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Mesa de trabajo</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <button type="button" onClick={() => { onMesa("boletas"); setOpen(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 9px", borderRadius: 9, font: "inherit", cursor: "pointer", textAlign: "left",
                    border: mesa === "boletas" ? "1px solid rgba(232,85,62,.35)" : "1px solid var(--border)", background: mesa === "boletas" ? "rgba(232,85,62,.07)" : "transparent", color: "var(--text)" }}>
                  <Icon d="M9 14l2 2 4-4m5-2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2h8l6 6z" size={15} />
                  <span><span style={{ display: "block", fontSize: 11.5, fontWeight: 800 }}>Mesa Boletas</span><span style={{ display: "block", fontSize: 9, color: "var(--text3)" }}>cartolas → boletas · 39 este mes</span></span>
                  {mesa === "boletas" && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 850, color: "var(--accent)" }}>Actual</span>}
                </button>
                <button type="button" onClick={() => { onMesa("facturas"); setOpen(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 9px", borderRadius: 9, font: "inherit", cursor: "pointer", textAlign: "left",
                    border: mesa === "facturas" ? "1px solid rgba(201,242,75,.4)" : "1px solid var(--border)", background: mesa === "facturas" ? "rgba(201,242,75,.06)" : "transparent", color: "var(--text)" }}>
                  <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={15} />
                  <span><span style={{ display: "block", fontSize: 11.5, fontWeight: 800 }}>Mesa Facturas</span><span style={{ display: "block", fontSize: 9, color: "var(--text3)" }}>planillas → facturas 33/34 · 11 este mes</span></span>
                  {mesa === "facturas" && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 850, color: "var(--lime)" }}>Actual</span>}
                </button>
              </div>
            </>
          )}

          <button type="button" onClick={() => setVariante(variante === "business" ? "startpro" : "business")}
            style={{ width: "100%", marginTop: 8, padding: "7px 8px", borderRadius: 9, border: "none", background: "transparent", color: "var(--text3)", fontSize: 9.5, fontWeight: 700, cursor: "pointer", font: "inherit", textAlign: "center" }}>
            ver variante {variante === "business" ? "Start/Pro (1 empresa)" : "Business (multiempresa)"} →
          </button>
        </div>
      )}
    </span>
  );
}
