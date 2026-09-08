"use client";

import { useState } from "react";
import { crearEmpresaAdicional } from "./actions";

/**
 * Alta de empresa adicional (Business): RUT verificado EN VIVO contra la nómina
 * pública de personas jurídicas del SII — al encontrarla, la razón social se
 * autocompleta y el usuario CONFIRMA viendo el nombre (un typo con DV válido
 * muestra otra empresa y se delata solo). El RUT queda inmutable tras la
 * primera emisión, así que este es EL momento de escribirlo bien.
 */
export default function AgregarEmpresaForm({ onListo, onCancelar, nota }: {
  onListo: (empresaId: string) => void;
  onCancelar: () => void;
  /** Qué pasa después de crearla: en el logo te lleva a su mesa; en el wizard te quedas configurándola. */
  nota?: string;
}) {
  const [rut, setRut] = useState("");
  const [razon, setRazon] = useState("");
  const [verif, setVerif] = useState<
    | { estado: "idle" | "buscando" }
    | { estado: "encontrada"; razon: string; terminoGiro: string | null }
    | { estado: "no_encontrada" }
    | { estado: "dv_malo" }
  >({ estado: "idle" });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verificar() {
    const limpio = rut.replace(/[^0-9kK]/g, "");
    // Bajo ~50M es RUT de persona natural: no está en la nómina de jurídicas
    // y no se busca en fuentes públicas (solo validación de dígito).
    const cuerpo = Number(limpio.slice(0, -1));
    if (limpio.length < 7 || !Number.isFinite(cuerpo) || cuerpo < 50_000_000) { setVerif({ estado: "idle" }); return; }
    setVerif({ estado: "buscando" });
    try {
      const res = await fetch(`/api/empresa/verificar-rut?rut=${encodeURIComponent(rut)}`);
      const data = await res.json();
      if (!data?.ok || data.dv_valido === false || data.dv_coincide === false) { setVerif({ estado: "dv_malo" }); return; }
      if (data.encontrado) {
        setVerif({ estado: "encontrada", razon: data.razon_social, terminoGiro: data.termino_giro ?? null });
        setRazon((prev) => prev || data.razon_social);
      } else {
        setVerif({ estado: "no_encontrada" });
      }
    } catch { setVerif({ estado: "no_encontrada" }); }
  }

  async function enviar() {
    if (enviando) return;
    setError(null);
    setEnviando(true);
    const r = await crearEmpresaAdicional({ rut, razon_social: razon });
    setEnviando(false);
    if (!r.ok) { setError(r.detalle ?? "No se pudo crear la empresa."); return; }
    onListo(r.empresa_id);
  }

  const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", fontSize: 12, outline: "none", lineHeight: 1.3 };
  return (
    <div style={{ padding: 8 }}>
      <div style={{ padding: "2px 2px 12px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Agregar empresa</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <input value={rut} onChange={(e) => setRut(e.target.value)} onBlur={verificar}
            placeholder="RUT de la empresa (76.123.456-7)" style={inputStyle} autoFocus />
          {verif.estado === "buscando" && <div style={{ marginTop: 4, fontSize: 9, color: "var(--text3)" }}>Buscando en el registro del SII…</div>}
          {verif.estado === "encontrada" && (
            <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--green)", lineHeight: 1.4 }}>
              ✓ {verif.razon}
              {verif.terminoGiro && <span style={{ display: "block", color: "var(--amber)" }}>⚠ Esta empresa registra término de giro ({verif.terminoGiro}) ante el SII.</span>}
            </div>
          )}
          {verif.estado === "no_encontrada" && (
            <div style={{ marginTop: 4, fontSize: 9, color: "var(--text2)", lineHeight: 1.4 }}>
              No aparece en el registro público del SII. Si la empresa es nueva es normal (el registro se actualiza con rezago) — revisa que el RUT esté bien y continúa.
            </div>
          )}
          {verif.estado === "dv_malo" && (
            <div style={{ marginTop: 4, fontSize: 9, color: "var(--red)" }}>Ese RUT no cuadra — revisa los números y el dígito verificador.</div>
          )}
        </div>
        {/* Razón social: la autocompleta el registro del SII; solo se pide a
            mano si el RUT no aparece (empresa nueva / persona natural). */}
        {verif.estado !== "encontrada" && (
          <input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Razón social" style={inputStyle} />
        )}
        <div style={{ fontSize: 9.5, color: "var(--text3)", lineHeight: 1.55, padding: "0 2px" }}>
          {nota ?? "Al crearla verás su mesa vacía; el logo y sus datos se configuran después en «Empresa». El RUT queda fijo tras la primera boleta emitida."}
        </div>
        {error && <div style={{ color: "var(--red)", fontSize: 9.5, lineHeight: 1.4 }}>{error}</div>}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={onCancelar} disabled={enviando}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Cancelar
          </button>
          <button type="button" onClick={enviar} disabled={enviando || !rut || !razon || verif.estado === "dv_malo"}
            style={{ flex: 2, padding: "10px 0", borderRadius: 10, border: 0, background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 800, cursor: enviando ? "wait" : "pointer", opacity: enviando || !rut || !razon ? 0.55 : 1, transition: "opacity .15s" }}>
            {enviando ? "Creando…" : "Crear empresa"}
          </button>
        </div>
      </div>
    </div>
  );
}
