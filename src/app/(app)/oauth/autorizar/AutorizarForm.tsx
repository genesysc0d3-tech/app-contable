"use client";

import { useState, useTransition } from "react";
import { autorizarConector, type SolicitudOauth } from "./actions";

export default function AutorizarForm({ clienteNombre, solicitud }: { clienteNombre: string; solicitud: SolicitudOauth }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center", background: "rgba(232,85,62,.12)", color: "var(--accent, #e8553e)", fontSize: 19, fontWeight: 900, marginBottom: 14 }}>⇄</div>
      <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-.02em" }}>
        «{clienteNombre}» quiere conectarse a tu massDTE
      </h1>
      <p style={{ marginTop: 10, fontSize: 13, color: "var(--text2, #8b867e)", lineHeight: 1.6 }}>
        Podrá <b style={{ color: "var(--text, #f1efeb)" }}>leer</b> tus pendientes de emisión y resúmenes para ayudarte con la revisión.
      </p>
      <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 12.5, color: "var(--text2, #8b867e)", display: "grid", gap: 7 }}>
        <li>✅ Ve pendientes y resúmenes de tu empresa</li>
        <li>🚫 No emite documentos — emitir es siempre un acto tuyo en la app</li>
        <li>🚫 No ve ni toca tu clave del SII</li>
        <li>🔌 Lo desconectas cuando quieras desde tu empresa en la app</li>
      </ul>
      {error && (
        <p style={{ marginTop: 14, padding: "9px 12px", borderRadius: 10, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#f0a9a0", fontSize: 12.5 }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await autorizarConector(solicitud);
              // Si autoriza, el action redirige y no volvemos; si volvió, es error.
              if (res && "error" in res) setError(res.error);
            })
          }
          style={{ flex: 1, border: "none", borderRadius: 12, background: "var(--accent, #e8553e)", color: "white", padding: "11px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: pending ? 0.7 : 1 }}
        >
          {pending ? "Conectando…" : "Autorizar"}
        </button>
        <button
          disabled={pending}
          onClick={() => window.close()}
          style={{ border: "1px solid var(--border, #26262b)", borderRadius: 12, background: "transparent", color: "var(--text2, #8b867e)", padding: "11px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Cancelar
        </button>
      </div>
    </>
  );
}
