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
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 0, minWidth: 0 }}>
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
          height: 30, borderRadius: 999, border: `1px solid ${avisa ? "rgba(245,158,11,.4)" : "color-mix(in srgb, var(--text) 14%, transparent)"}`,
          background: `${avisa ? "rgba(245,158,11,.06)" : "color-mix(in srgb, var(--text) 4%, transparent)"} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 11px center`,
          color: medio ? "var(--text)" : avisa ? "var(--amber)" : "var(--text3)",
          padding: "0 26px 0 13px", fontSize: 11, fontWeight: 700, outline: "none", cursor: "pointer",
          appearance: "none", WebkitAppearance: "none", minWidth: 0, flexShrink: 0, textOverflow: "ellipsis",
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
            color: "var(--green)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          Usar {sugerido}
        </button>
      )}
      {avisa && (
        <span style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1, maxWidth: 170 }}>
          Es una cartola bancaria: sin elegir, las boletas salen como <b>Efectivo</b>.
        </span>
      )}
    </div>
  );
}
