"use client";

import { useState } from "react";
import { setDocumentoMedioPago } from "@/app/(app)/subir/actions";
import { MEDIOS_PAGO_SII } from "@/lib/sii/medios-pago";
import { useToast } from "@/components/Toast";

/**
 * Método de pago para TODAS las boletas del documento (espejo de la glosa común).
 *
 * El SII lo exige en cada boleta. Sin esto, la app solo lo pedía en las de sobre
 * 135 UF y el resto salía como "Efectivo" (fallback del worker de la extensión):
 * en beta, 65 boletas de una cartola bancaria se emitieron como efectivo siendo
 * transferencias. En una cartola eso es incorrecto por definición — nada entra
 * en efectivo a una cuenta bancaria — así que ahí se sugiere Transferencia.
 */
export default function MedioPagoControl({
  documentoId,
  esCartola,
  medioInicial,
}: {
  documentoId: string;
  /** Documento con movimientos bancarios: la plata llegó por el banco, no en mano. */
  esCartola: boolean;
  medioInicial: string | null;
}) {
  const { toast } = useToast();
  const sugerido = esCartola ? "Transferencia" : "";
  const [medio, setMedio] = useState<string>(medioInicial ?? "");
  const [saving, setSaving] = useState(false);
  // Sin elegir + cartola = la boleta saldría "Efectivo" siendo transferencia.
  const avisa = !medio && esCartola;

  async function cambiar(valor: string) {
    const previo = medio;
    setMedio(valor);
    setSaving(true);
    const res = await setDocumentoMedioPago(documentoId, valor || null);
    setSaving(false);
    if (res.error) {
      setMedio(previo);
      toast(`Error: ${res.error}`, "error");
      return;
    }
    toast(valor ? `Todas las boletas de este documento: ${valor}` : "Sin método de pago fijado");
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 0, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: avisa ? "var(--amber)" : "var(--text3)", textTransform: "uppercase", letterSpacing: ".07em" }}>
        Pago
      </span>
      <select
        value={medio}
        onChange={(e) => cambiar(e.target.value)}
        disabled={saving}
        aria-label="Método de pago de todas las boletas de este documento"
        title="El SII pide el método de pago en cada boleta. Acá lo fijas para todas las de este documento."
        style={{
          height: 30, borderRadius: 9, border: `1px solid ${avisa ? "rgba(245,158,11,.45)" : "var(--border)"}`,
          background: "var(--bg-muted)", color: medio ? "var(--text)" : "var(--text3)",
          padding: "0 9px", fontSize: 11, fontWeight: 700, outline: "none", cursor: "pointer",
        }}
      >
        <option value="">{sugerido ? `Elegir (sugerido: ${sugerido})` : "Elegir…"}</option>
        {MEDIOS_PAGO_SII.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      {avisa && (
        <button
          type="button"
          onClick={() => cambiar(sugerido)}
          disabled={saving}
          style={{
            fontSize: 10.5, fontWeight: 800, padding: "6px 12px", borderRadius: 99,
            border: "1px solid rgba(34,197,94,.35)", background: "rgba(34,197,94,.1)",
            color: "var(--green)", cursor: "pointer",
          }}
        >
          Usar {sugerido}
        </button>
      )}
      {avisa && (
        <span style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Es una cartola bancaria: sin elegir, las boletas salen como <b>Efectivo</b>.
        </span>
      )}
    </div>
  );
}
