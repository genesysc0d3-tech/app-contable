"use client";

import { useState } from "react";
import { elegirEmpresaOperativa } from "./actions";

/**
 * Modal BLOQUEANTE post-downgrade (Business→Pro con varias empresas): el
 * titular elige LA empresa operativa, una sola vez. Las demás salen de la
 * interfaz (sus datos quedan intactos; volver a Business las revive). No hay
 * botón de cerrar: la cuenta no opera hasta decidir — regla del fundador.
 */
export default function EleccionEmpresaModal({
  esTitular,
  empresas,
}: {
  esTitular: boolean;
  empresas: { id: string; nombre: string; rut: string | null }[];
}) {
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [armado, setArmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (!seleccion || enviando) return;
    if (!armado) { setArmado(true); return; }
    setEnviando(true);
    setError(null);
    const r = await elegirEmpresaOperativa(seleccion);
    if (!r.ok) {
      setError(r.detalle ?? "No se pudo guardar la elección. Intenta de nuevo.");
      setEnviando(false);
      setArmado(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, display: "grid", placeItems: "center", background: "rgba(0,0,0,.66)", backdropFilter: "blur(6px)", padding: 16 }}>
      <div style={{ width: "min(440px, 100%)", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", padding: 22, boxShadow: "0 40px 120px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize: 15, fontWeight: 850 }}>Tu plan cambió</div>
        {esTitular ? (
          <>
            <p style={{ margin: "8px 0 14px", fontSize: 12, lineHeight: 1.55, color: "var(--text2)" }}>
              Tu plan actual incluye <b>una empresa</b>. Elige cuál sigue operativa.
              Las otras salen de la vista — <b>nada se borra</b>: sus boletas y su historial
              quedan guardados, y vuelven completos si contratas Business de nuevo.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {empresas.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => { setSeleccion(e.id); setArmado(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 11, textAlign: "left", cursor: "pointer", border: seleccion === e.id ? "1px solid var(--accent)" : "1px solid var(--border)", background: seleccion === e.id ? "rgba(232,85,62,.09)" : "var(--bg-muted)", color: "var(--text)" }}
                >
                  <span style={{ width: 16, height: 16, borderRadius: 999, flexShrink: 0, border: seleccion === e.id ? "5px solid var(--accent)" : "2px solid var(--border)" }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nombre}</span>
                    {e.rut && <span style={{ display: "block", fontSize: 10, color: "var(--text2)" }}>{e.rut}</span>}
                  </span>
                </button>
              ))}
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 10, lineHeight: 1.5, color: "var(--text3)" }}>
              Esta elección es definitiva para este plan. Para operar varias empresas a la vez, el plan Business es el camino.
            </p>
            {error && <p style={{ margin: "10px 0 0", fontSize: 10.5, color: "var(--red)" }}>{error}</p>}
            <button
              type="button"
              onClick={confirmar}
              disabled={!seleccion || enviando}
              style={{ marginTop: 14, width: "100%", padding: "11px 0", borderRadius: 10, border: 0, background: armado ? "var(--red, #ef4444)" : "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 850, cursor: !seleccion || enviando ? "default" : "pointer", opacity: !seleccion || enviando ? 0.55 : 1 }}
            >
              {enviando ? "Guardando…" : armado ? "¿Seguro? Es definitivo — Confirmar" : "Continuar con esta empresa"}
            </button>
          </>
        ) : (
          <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--text2)" }}>
            El plan de la cuenta cambió y el titular debe elegir la empresa operativa
            antes de seguir. Avísale para que entre a massDTE y elija — después de eso,
            todo vuelve a la normalidad.
          </p>
        )}
      </div>
    </div>
  );
}
