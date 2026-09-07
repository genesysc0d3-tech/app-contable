"use client";

import type { Colaboracion } from "./actions";

/**
 * "Colaboras en" (fundador 2026-09-06): siempre visible, en cualquier plan.
 * Gris si nadie te invitó; si te invitaron, una fila por team → tocarla te
 * lleva a colaborar. Vive en dos lugares (popup del logo y wizard de
 * configuración) — el mismo componente, sin copias.
 */
export default function ColaborasEn({ colaboraciones, pending = false, onIr }: {
  colaboraciones: Colaboracion[];
  pending?: boolean;
  onIr: (empresaId: string) => void;
}) {
  return (
    <div style={{ marginTop: 6, borderTop: "1px solid var(--border)" }}>
      <div style={{ padding: "9px 8px 7px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em", opacity: colaboraciones.length ? 1 : 0.7 }}>Colaboras en</div>
      {colaboraciones.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 8px 8px", opacity: 0.55 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", color: "var(--text3)", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>·</span>
          <span style={{ fontSize: 10.5, color: "var(--text2)", lineHeight: 1.35 }}>No te han invitado a ningún team. Cuando alguien lo haga, entras a colaborar desde acá.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {colaboraciones.map((c) => (
            <button key={c.cuentaId} type="button" onClick={() => onIr(c.empresas[0].id)} disabled={pending}
              title={`Ir a colaborar en ${c.nombre}`}
              style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: 9, width: "100%", minHeight: 40, padding: "6px 8px", borderRadius: 9, border: "1px solid transparent", background: "transparent", color: "var(--text)", cursor: pending ? "wait" : "pointer", textAlign: "left", font: "inherit" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{c.nombre.slice(0, 2).toUpperCase()}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.empresas.length === 1 ? c.empresas[0].nombre : `${c.empresas.length} empresas`}</span>
              </span>
              <span style={{ fontSize: 9, fontWeight: 800, color: "var(--accent)" }}>Colaborar →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
