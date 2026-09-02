"use client";

import { useState } from "react";
import { setDocumentoGlosa } from "@/app/(app)/subir/actions";
import { useToast } from "@/components/Toast";

// Default de glosa según el tipo de operación marcado en el documento. Para
// exentas (cripto/forex) sustenta la naturaleza exenta ante el SII; para el
// resto, una descripción genérica sensata. Vacío = el usuario decide.
const GLOSA_DEFAULT: Record<string, string> = {
  p2p_cripto: "Compraventa de criptoactivos",
  forex_divisas: "Operación de cambio de divisas",
  servicios: "Servicios prestados",
  ventas: "Venta de bienes",
  mixto: "",
};

export default function GlosaComunControl({
  documentoId,
  hint,
  glosaInicial,
  activaInicial,
  mesa = "boleta",
}: {
  documentoId: string;
  hint: string | null;
  glosaInicial: string | null;
  activaInicial: boolean;
  /** Vocabulario por mesa: en facturas no se habla de "boletas". */
  mesa?: "boleta" | "factura";
}) {
  const { toast } = useToast();
  const placeholder = mesa === "factura"
    ? "Detalle de las facturas (ej. Servicios contables de agosto)"
    : (GLOSA_DEFAULT[hint ?? "mixto"] || "Detalle de las boletas (ej. Compraventa USDT)");
  const [activa, setActiva] = useState(activaInicial);
  const [glosa, setGlosa] = useState(glosaInicial ?? "");
  const [saving, setSaving] = useState(false);

  async function persist(nextActiva: boolean, nextGlosa: string) {
    setSaving(true);
    const res = await setDocumentoGlosa(documentoId, nextGlosa.trim() || null, nextActiva);
    setSaving(false);
    if (res.error) { toast(`Error: ${res.error}`, "error"); return false; }
    return true;
  }

  async function toggle() {
    const next = !activa;
    setActiva(next);
    if (!(await persist(next, glosa))) setActiva(!next);
    else toast(next ? "Detalle activado para este documento" : "Boletas de este documento sin detalle");
  }

  async function saveGlosa() {
    const trimmed = glosa.trim();
    if (trimmed === (glosaInicial ?? "").trim()) return;
    if (await persist(activa, trimmed)) toast("Detalle común guardado");
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
      <button
        type="button"
        role="switch"
        aria-checked={activa}
        aria-label="Detalle para todas las boletas de este documento"
        onClick={toggle}
        disabled={saving}
        title="Activa o desactiva el detalle para todas las boletas de este documento"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
          background: "transparent", color: activa ? "var(--green)" : "var(--text3)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".02em",
        }}
      >
        <span style={{
          width: 32, height: 18, borderRadius: 999, padding: 2, background: activa ? "rgba(34,197,94,.35)" : "var(--bg-muted)",
          border: "1px solid var(--border)", display: "inline-flex", alignItems: "center",
          justifyContent: activa ? "flex-end" : "flex-start", transition: "all .15s",
        }}>
          <span style={{ width: 13, height: 13, borderRadius: "50%", background: activa ? "var(--green)" : "var(--text3)", boxShadow: activa ? "0 0 8px rgba(34,197,94,.6)" : "none", transition: "all .15s" }} />
        </span>
        Detalle
      </button>
      {activa && (
        <input
          value={glosa}
          onChange={(e) => setGlosa(e.target.value.slice(0, 80))}
          onBlur={saveGlosa}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder={placeholder}
          maxLength={80}
          aria-label="Detalle común de las boletas de este documento"
          title="Mismo detalle para todas las boletas de este documento (máx 80). Vacío usa el default por tipo."
          style={{
            flex: 1, minWidth: 190, height: 30, borderRadius: 9, border: "1px solid var(--border)",
            background: "var(--bg-muted)", color: "var(--text)", padding: "0 11px", fontSize: 11.5, outline: "none",
          }}
        />
      )}
      {activa && (
        <span style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: glosa.length >= 80 ? "var(--red)" : "var(--text3)" }}>{glosa.length}/80</span>
      )}
    </div>
  );
}
