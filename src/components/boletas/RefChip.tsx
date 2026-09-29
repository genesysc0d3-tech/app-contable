"use client";

import { useState } from "react";

/**
 * ID interno R-XXX-XXX con botón copiar (para dictarlo a soporte o buscarlo).
 * "—" en documentos antiguos sin ref. Solo pantalla: NO va en el PDF ni en lo
 * que se imprime. Lo usan el Registro de Ventas y "Últimas emitidas" de la mesa
 * (boletas y facturas).
 */
export default function RefChip({ ref_ }: { ref_: string | null }) {
  const [copiado, setCopiado] = useState(false);
  if (!ref_) return <span style={{ fontSize: 10, color: "var(--text3)" }}>—</span>;
  return (
    <button type="button" title="Copiar ID" aria-label={`Copiar ID ${ref_}`}
      onClick={() => { void navigator.clipboard?.writeText(ref_).then(() => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1200); }).catch(() => {}); }}
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 9.5, fontWeight: 650, color: copiado ? "var(--green, #22c55e)" : "var(--text2)", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", letterSpacing: ".02em", fontVariantNumeric: "tabular-nums" }}>
      {copiado ? "Copiado" : ref_}
    </button>
  );
}
