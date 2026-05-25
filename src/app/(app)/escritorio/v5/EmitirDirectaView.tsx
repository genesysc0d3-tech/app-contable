"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

type TipoDte = 39 | 41;

interface EmitirResponse {
  ok: boolean;
  error?: string;
  errores?: { code: string; message: string }[];
  folio?: number;
  boleta_id?: string;
  monto_total?: number;
  track_id?: string;
  estado?: string;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function parseAmount(value: string): number {
  return Number(value.replace(/[^0-9]/g, ""));
}

export default function EmitirDirectaView({ empresaTipo, onClose }: { empresaTipo?: string; onClose?: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const tipoInicial: TipoDte = empresaTipo === "exento" ? 41 : 39;
  const [tipoDte, setTipoDte] = useState<TipoDte>(tipoInicial);
  const [receptorRut, setReceptorRut] = useState("");
  const [receptorRazonSocial, setReceptorRazonSocial] = useState("");
  const [receptorDireccion, setReceptorDireccion] = useState("");
  const [receptorComuna, setReceptorComuna] = useState("");
  const [detalleNombre, setDetalleNombre] = useState("Servicio prestado");
  const [monto, setMonto] = useState("");
  const [emitiendo, setEmitiendo] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<EmitirResponse | null>(null);
  const [tipoDesbloqueado, setTipoDesbloqueado] = useState(false);

  const total = useMemo(() => parseAmount(monto), [monto]);
  const isAfecto = empresaTipo === "afecto";
  const isExento = empresaTipo === "exento";
  const hasEmpresaLock = isAfecto || isExento;
  const tipoLocked = hasEmpresaLock && !tipoDesbloqueado;
  const tipoEmpresa: TipoDte | null = isExento ? 41 : isAfecto ? 39 : null;
  const tipoDiferenteEmpresa = !!tipoEmpresa && tipoDte !== tipoEmpresa;
  const canSubmit = total > 0 && detalleNombre.trim().length > 0 && !emitiendo;

  function setTipo(tipo: TipoDte) {
    if (tipoLocked) return;
    setTipoDte(tipo);
  }

  function clearForm() {
    setReceptorRut("");
    setReceptorRazonSocial("");
    setReceptorDireccion("");
    setReceptorComuna("");
    setDetalleNombre("Servicio prestado");
    setMonto("");
    setErrors([]);
  }

  async function handleEmitir() {
    if (!canSubmit) return;
    setEmitiendo(true);
    setErrors([]);
    setLastResult(null);

    try {
      const body = {
        tipo_dte: tipoDte,
        receptor_rut: receptorRut.trim() || undefined,
        receptor_razon_social: receptorRazonSocial.trim() || undefined,
        receptor_direccion: receptorDireccion.trim() || undefined,
        receptor_comuna: receptorComuna.trim() || undefined,
        detalles: [{ nombre: detalleNombre.trim(), monto: total }],
        monto_total: total,
      };

      const res = await fetch("/api/intermediaria/emitir-boleta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as EmitirResponse;

      if (!res.ok || !json.ok) {
        const validationErrors = json.errores?.map((e) => e.message) ?? [json.error ?? "Error al emitir DTE"];
        setErrors(validationErrors);
        toast(validationErrors[0] ?? "Error al emitir DTE", "error");
        return;
      }

      setLastResult(json);
      toast(`DTE emitido: folio #${json.folio ?? "--"} por ${fmt(json.monto_total ?? total)}`);
      clearForm();
      router.refresh();
    } catch {
      setErrors(["Error de red al emitir el DTE"]);
      toast("Error de red al emitir el DTE", "error");
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{`
        .ed-shell{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:12px;height:100%}
        .ed-card{border:1px solid var(--border);background:var(--bg-muted);border-radius:12px;padding:10px}
        .ed-card-quiet{border:1px solid var(--border);background:transparent;border-radius:12px;padding:10px}
        .ed-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .ed-grid-detail{display:grid;grid-template-columns:1.35fr .75fr;gap:8px}
        .ed-label{font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
        .ed-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;border:1px solid var(--border);padding:4px 7px;font-size:9px;font-weight:700;color:var(--text2);background:var(--bg-muted)}
        .ed-type-button{min-height:44px;padding:8px;border-radius:10px;border:1px solid var(--border);cursor:pointer;text-align:left;transition:border-color .18s ease,background .18s ease,opacity .18s ease}
        .ed-type-button:disabled{cursor:not-allowed}
        .ed-sidebar{display:flex;flex-direction:column;gap:8px;min-height:0}
        @media (max-width: 720px){.ed-shell{grid-template-columns:1fr;height:auto}.ed-grid-2,.ed-grid-detail{grid-template-columns:1fr}.ed-sidebar{order:-1}.ed-body{overflow:auto!important}}
      `}</style>

      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button aria-label="Cerrar emisión directa" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 16 }}>
          ×
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span className="ed-label">DTE único</span>
            <span className="ed-chip">Manual</span>
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Emisión Directa</h2>
          <p style={{ fontSize: 10, color: "var(--text2)", marginTop: 1 }}>Emite una boleta manual cuando no viene desde una carga masiva.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <span style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tipo actual</span>
          <strong style={{ fontSize: 12, color: tipoDte === 39 ? "#E8553E" : "#5b9cf6" }}>{tipoDte === 39 ? "Afecta" : "Exenta"}</strong>
        </div>
      </div>

      <div className="ed-body" style={{ flex: 1, minHeight: 0, padding: "12px 18px", overflow: "hidden" }}>
        <div className="ed-shell">
          <main style={{ display: "flex", flexDirection: "column", gap: 9, minHeight: 0 }}>
            <section className="ed-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <div>
                  <span className="ed-label">1. Tipo de documento</span>
                  <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Bloqueado por empresa, desbloqueable para excepciones.</p>
                </div>
                {hasEmpresaLock && (
                  <button
                    onClick={() => setTipoDesbloqueado((v) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 34, padding: "6px 10px", borderRadius: 999, border: "1px solid var(--border)", background: tipoDesbloqueado ? "rgba(245,158,11,.1)" : "var(--surface)", color: tipoDesbloqueado ? "#f59e0b" : "var(--text2)", cursor: "pointer", fontSize: 9, fontWeight: 700 }}
                    title={tipoDesbloqueado ? "Volver a bloquear tipo por empresa" : "Desbloquear selección manual de tipo DTE"}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      {tipoDesbloqueado ? <path d="M7 11V7a5 5 0 019.6-2M5 11h14v10H5z" /> : <path d="M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z" />}
                    </svg>
                    {tipoDesbloqueado ? "Desbloqueado" : "Bloqueado"}
                  </button>
                )}
              </div>

              <div className="ed-grid-2">
                <button className="ed-type-button" onClick={() => setTipo(39)} disabled={tipoLocked} style={{ borderColor: tipoDte === 39 ? "rgba(232,85,62,.45)" : "var(--border)", background: tipoDte === 39 ? "var(--accent-light)" : "var(--surface)", color: tipoDte === 39 ? "#E8553E" : "var(--text2)", opacity: tipoLocked && tipoDte !== 39 ? 0.45 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>Boleta afecta</div>
                  <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 39 · IVA incluido</div>
                </button>
                <button className="ed-type-button" onClick={() => setTipo(41)} disabled={tipoLocked} style={{ borderColor: tipoDte === 41 ? "rgba(91,156,246,.45)" : "var(--border)", background: tipoDte === 41 ? "rgba(91,156,246,.12)" : "var(--surface)", color: tipoDte === 41 ? "#5b9cf6" : "var(--text2)", opacity: tipoLocked && tipoDte !== 41 ? 0.45 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>Boleta exenta</div>
                  <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 41 · Sin IVA</div>
                </button>
              </div>

              {tipoLocked && (
                <p style={{ fontSize: 9, color: "var(--text3)", marginTop: 8 }}>Tipo fijado por configuración de empresa: {isExento ? "exenta" : "afecta"}.</p>
              )}
            </section>

            <section className="ed-card-quiet">
              <div style={{ marginBottom: 8 }}>
                <span className="ed-label">2. Receptor</span>
                <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Datos opcionales del cliente cuando correspondan.</p>
              </div>
              <div className="ed-grid-2">
                <Field label="RUT receptor" value={receptorRut} onChange={setReceptorRut} placeholder="Opcional bajo $180.000" />
                <Field label="Razón social" value={receptorRazonSocial} onChange={setReceptorRazonSocial} placeholder="Cliente o consumidor" />
                <Field label="Dirección" value={receptorDireccion} onChange={setReceptorDireccion} placeholder="Opcional" />
                <Field label="Comuna" value={receptorComuna} onChange={setReceptorComuna} placeholder="Opcional" />
              </div>
            </section>

            <section className="ed-card-quiet">
              <div style={{ marginBottom: 8 }}>
                <span className="ed-label">3. Detalle y monto</span>
                <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Un concepto por emisión directa.</p>
              </div>
              <div className="ed-grid-detail">
                <Field label="Detalle" value={detalleNombre} onChange={setDetalleNombre} placeholder="Servicio prestado" />
                <Field label={tipoDte === 39 ? "Total bruto" : "Total exento"} value={monto} onChange={setMonto} placeholder="$0" inputMode="numeric" />
              </div>
            </section>
          </main>

          <aside className="ed-sidebar">
            <div className="ed-card" style={{ padding: 12 }}>
              <span className="ed-label">Resumen</span>
              <div style={{ fontSize: 22, color: "var(--text)", fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", marginTop: 6 }}>{fmt(total)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9, fontSize: 10, color: "var(--text2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>Documento</span><strong style={{ color: "var(--text)" }}>DTE {tipoDte}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>Tipo</span><strong style={{ color: tipoDte === 39 ? "#E8553E" : "#5b9cf6" }}>{tipoDte === 39 ? "Afecta" : "Exenta"}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>IVA</span><strong style={{ color: "var(--text)" }}>{tipoDte === 39 ? "Incluido" : "No aplica"}</strong></div>
              </div>
            </div>

            {tipoDiferenteEmpresa && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "#f59e0b", fontSize: 10, lineHeight: 1.45 }}>
                Estás emitiendo un DTE distinto al tipo configurado para la empresa. Úsalo solo si la operación corresponde tributariamente.
              </div>
            )}

            {errors.length > 0 && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.18)", color: "#ef4444", fontSize: 10, lineHeight: 1.5 }}>
                {errors.map((error) => <div key={error}>{error}</div>)}
              </div>
            )}

            {lastResult && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.18)", color: "#22c55e", fontSize: 10, lineHeight: 1.5 }}>
                Emitido folio #{lastResult.folio ?? "--"}<br />Track {lastResult.track_id ?? "--"}
              </div>
            )}

            <div style={{ padding: 11, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 10, color: "var(--text2)", lineHeight: 1.5 }}>
              La carga masiva sigue en <strong style={{ color: "var(--text)" }}>Subir documento</strong>. Este modal es solo para un DTE manual.
            </div>

            <div style={{ marginTop: "auto", paddingTop: 2 }}>
              <div style={{ marginBottom: 7, fontSize: 9, color: "var(--text2)", textAlign: "center" }}>
                {canSubmit ? "Listo para emitir." : "Ingresa detalle y monto."}
              </div>
              <button onClick={handleEmitir} disabled={!canSubmit} style={{ width: "100%", minHeight: 38, fontSize: 11, padding: "8px 14px", borderRadius: 10, border: "none", cursor: !canSubmit ? "not-allowed" : "pointer", fontWeight: 800, background: "#E8553E", color: "#fff", opacity: !canSubmit ? 0.45 : 1, boxShadow: canSubmit ? "0 10px 26px rgba(232,85,62,.24)" : "none" }}>
                {emitiendo ? "Emitiendo..." : "Emitir DTE"}
              </button>
            </div>
          </aside>
        </div>
      </div>

      <div style={{ padding: "8px 18px", borderTop: "1px solid var(--border)", flexShrink: 0, background: "var(--surface)", fontSize: 10, color: "var(--text2)" }}>
        La carga masiva sigue disponible en MassDTE.
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "numeric";
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        style={{ width: "100%", height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", padding: "0 9px", fontSize: 11, outline: "none" }}
      />
    </label>
  );
}
