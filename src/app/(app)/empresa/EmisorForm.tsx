"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { setDatosEmisor, removeEmpresaLogo, type DatosEmisor } from "./actions";
import { formatRut, validarRut, cleanRut } from "@/lib/sii/validation";
import { useToast } from "@/components/Toast";

interface Props {
  inicial: DatosEmisor;
  variant?: "page" | "popup";
}

export default function EmisorForm({ inicial, variant = "page" }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [logoPending, setLogoPending] = useState(false);
  const compact = variant === "popup";

  const [rut, setRut] = useState(inicial.rut ? formatRut(inicial.rut) : "");
  const [razonSocial, setRazonSocial] = useState(inicial.razon_social ?? "");
  const [giro, setGiro] = useState(inicial.giro ?? "");
  const [direccion, setDireccion] = useState(inicial.direccion ?? "");
  const [comuna, setComuna] = useState(inicial.comuna ?? "");
  const [emailSii, setEmailSii] = useState(inicial.email_sii ?? "");
  const [hasLogo, setHasLogo] = useState(true);
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [tipoContribuyente, setTipoContribuyente] = useState(
    inicial.tipo_contribuyente ?? "auto"
  );

  const rutOk = !rut || validarRut(rut);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (logoPending) return;

    if (rut && !validarRut(rut)) {
      toast("RUT inválido", "error");
      return;
    }

    if (!razonSocial.trim()) {
      toast("Razón social obligatoria", "error");
      return;
    }

    setPending(true);
    try {
      const r = await setDatosEmisor({
        rut: rut ? cleanRut(rut) : null,
        razon_social: razonSocial,
        giro,
        direccion,
        comuna,
        email_sii: emailSii,
        tipo_contribuyente: tipoContribuyente,
      });
      if (r.error) { toast(r.error, "error"); return; }
      toast("Datos del emisor guardados");
    } catch { toast("Error al guardar", "error"); }
    finally { setPending(false); }
  }

  async function handleLogoChange(file: File | null) {
    if (!file || logoPending) return;
    const formData = new FormData();
    formData.set("logo", file);
    setLogoStatus(null);
    setLogoPending(true);
    try {
      const res = await fetch("/api/empresa/upload-logo", { method: "POST", body: formData, credentials: "same-origin" });
      if (!res.ok) {
        let message = `Error ${res.status}`;
        try {
          const r = await res.json();
          message = r.error || message;
        } catch {}
        setLogoStatus(message);
        toast(message, "error");
        return;
      }
      setHasLogo(true);
      setLogoVersion((v) => v + 1);
      setLogoStatus("Logo guardado");
      toast("Logo de empresa guardado");
      router.refresh();
    } catch {
      setLogoStatus("Error de conexión");
      toast("Error de conexión", "error");
    }
    finally { setLogoPending(false); }
  }

  async function handleRemoveLogo() {
    const r = await removeEmpresaLogo();
    if (r.error) { toast(r.error, "error"); return; }
    setHasLogo(false);
    setLogoVersion((v) => v + 1);
    toast("Logo eliminado");
    router.refresh();
  }

  const inputBase = {
    width: "100%",
    height: compact ? 34 : 48,
    borderRadius: compact ? 10 : 16,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.032)",
    padding: compact ? "0 10px" : "0 16px",
    fontSize: compact ? 12 : 15,
    color: "#ffffff",
    outline: "none",
    transition: "all 160ms ease",
    boxSizing: "border-box" as const,
  };

  const inputFocus = {
    borderColor: "rgba(167,139,250,0.45)",
    background: "rgba(255,255,255,0.055)",
  };

  return (
    <>
      <style>{`
        .ef-input::placeholder { color: rgba(255,255,255,0.20); }
        .ef-logo-card .ef-logo-fade,
        .ef-logo-card .ef-logo-actions { opacity: 0; }
        .ef-logo-card:hover .ef-logo-fade,
        .ef-logo-card:focus-within .ef-logo-fade { opacity: 1; }
        .ef-logo-card:hover .ef-logo-actions,
        .ef-logo-card:focus-within .ef-logo-actions { opacity: 1; transform: translate(-50%, 0) scale(1); }
        @keyframes ef-spin { to { transform: rotate(360deg); } }
      `}</style>
      <form id="empresa-emisor-form"
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 16 }}
    >
      {/* CARD 1: DATOS DEL EMISOR */}
      <div style={{
        borderRadius: compact ? 14 : 22,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.025)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
      }}>
        <div style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: compact ? "12px 14px" : "36px 40px",
        }}>
          {/* HEADER */}
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: compact ? 10 : 20,
            marginBottom: compact ? 10 : 36,
          }}>
            <div style={{
              width: compact ? 34 : 48, height: compact ? 34 : 48, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: compact ? 10 : 16,
              border: "1px solid rgba(232,85,62,0.25)",
              background: "rgba(232,85,62,0.12)",
              color: "#FDBA74",
            }}>
              <svg viewBox="0 0 24 24" fill="none" width={compact ? 16 : 20} height={compact ? 16 : 20} aria-hidden="true">
                <path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 8h2M12 8h1M8 12h2M12 12h1M8 16h2M12 16h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>

            <div style={{ minWidth: 0, paddingTop: compact ? 0 : 4, flex: 1 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <h3 style={{
                  fontSize: compact ? 15 : 22, fontWeight: 700, lineHeight: 1.2,
                  letterSpacing: "-0.04em", color: "#ffffff",
                }}>
                  Datos del emisor
                </h3>
                <span style={{
                  display: "inline-block",
                  borderRadius: 9999,
                  border: "1px solid rgba(232,85,62,0.20)",
                  background: "rgba(232,85,62,0.15)",
                   padding: compact ? "2px 7px" : "4px 10px",
                   fontSize: compact ? 9 : 11, fontWeight: 700,
                  color: "#FDBA74",
                }}>
                  Requerido
                </span>
              </div>
              <p style={{
                marginTop: compact ? 3 : 8, fontSize: compact ? 10 : 14, lineHeight: 1.35,
                color: "rgba(255,255,255,0.45)",
              }}>
                Información tributaria que aparecerá en tus documentos.
              </p>
            </div>

            <div style={{ position: "relative", marginLeft: "auto", flexShrink: 0 }}>
              <input ref={logoInputRef} type="file" accept="image/png,image/webp,image/gif,image/jpeg" disabled={logoPending}
                onChange={(e) => { const f = e.target.files?.[0] ?? null; handleLogoChange(f); e.target.value = ""; }}
                style={{ display: "none" }}
              />
              {hasLogo ? (
                <div className="ef-logo-card" style={{ width: compact ? 118 : 150, minHeight: compact ? 54 : 66, borderRadius: compact ? 12 : 16, border: "1px dashed rgba(232,85,62,0.30)", background: "rgba(232,85,62,0.055)", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? 6 : 8, overflow: "hidden", position: "relative" }}>
                  <img
                    src={`/api/empresa/logo/current?v=${logoVersion}`}
                    alt="Logo"
                    onError={() => setHasLogo(false)}
                    style={{ maxWidth: "100%", maxHeight: compact ? 38 : 48, objectFit: "contain", display: "block", transition: "filter 160ms ease, transform 160ms ease" }}
                  />
                  <div className="ef-logo-fade" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,10,12,.08), rgba(10,10,12,.46))", backdropFilter: "blur(1px)", transition: "opacity 160ms ease", pointerEvents: "none" }} />
                  <div className="ef-logo-actions" style={{ position: "absolute", left: "50%", bottom: 7, display: "flex", gap: 5, transform: "translate(-50%, 4px) scale(.98)", transition: "opacity 160ms ease, transform 160ms ease" }}>
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoPending} aria-label="Cambiar logo" style={{ width: compact ? 25 : 29, height: compact ? 25 : 29, borderRadius: 999, border: "1px solid rgba(255,255,255,.22)", background: "rgba(15,15,18,.72)", color: "#fff", display: "grid", placeItems: "center", cursor: logoPending ? "wait" : "pointer", backdropFilter: "blur(8px)", boxShadow: "0 8px 18px rgba(0,0,0,.24)" }}>
                      {logoPending ? <span style={{ fontSize: 10, fontWeight: 800 }}>...</span> : <svg viewBox="0 0 24 24" fill="none" width={compact ? 13 : 14} height={compact ? 13 : 14} aria-hidden="true"><path d="m4 16.5-.5 4 4-.5L18.9 8.6a2.1 2.1 0 0 0 0-3L18.4 5a2.1 2.1 0 0 0-3 0L4 16.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m13.8 6.6 3.6 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                    </button>
                    <button type="button" onClick={handleRemoveLogo} disabled={logoPending} aria-label="Eliminar logo" style={{ width: compact ? 25 : 29, height: compact ? 25 : 29, borderRadius: 999, border: "1px solid rgba(255,255,255,.18)", background: "rgba(190,34,28,.78)", color: "#fff", display: "grid", placeItems: "center", cursor: logoPending ? "wait" : "pointer", backdropFilter: "blur(8px)", boxShadow: "0 8px 18px rgba(0,0,0,.24)" }}>
                      <svg viewBox="0 0 24 24" fill="none" width={compact ? 13 : 14} height={compact ? 13 : 14} aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 7l.7-2h4.6L15 7M7 7l.8 13h8.4L17 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div onClick={() => logoInputRef.current?.click()} style={{ width: compact ? 118 : 150, minHeight: compact ? 54 : 66, borderRadius: compact ? 12 : 16, border: "1px dashed rgba(232,85,62,0.30)", background: "rgba(232,85,62,0.055)", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? 6 : 8, cursor: logoPending ? "wait" : "pointer", color: "#FDBA74", overflow: "hidden", textAlign: "center" }}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: compact ? 9 : 10, fontWeight: 750, lineHeight: 1.15 }}>
                    <span>{logoPending ? "Subiendo..." : "Subir logo"}</span>
                    <span style={{ color: logoStatus && logoStatus !== "Logo guardado" ? "#fca5a5" : "rgba(255,255,255,.42)", fontSize: compact ? 8 : 9, fontWeight: 600 }}>{logoStatus ?? "PNG/WebP transparente"}</span>
                  </span>
                </div>
              )}
              {hasLogo && logoStatus && (
                <div style={{ marginTop: 5, maxWidth: compact ? 118 : 150, color: logoStatus === "Logo guardado" ? "#86EFAC" : "#fca5a5", fontSize: compact ? 8 : 9, fontWeight: 700, lineHeight: 1.2, textAlign: "center" }}>
                  {logoStatus}
                </div>
              )}
            </div>
          </div>

          {/* FIELDS GRID */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: compact ? "8px 12px" : "28px 32px",
          }}>
            <Field label="RUT" compact={compact} error={!rutOk ? "RUT inválido (dígito verificador)" : null}>
              <input
                type="text"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                onBlur={(e) => {
                  if (rut) setRut(formatRut(rut));
                  if (rutOk) { e.target.style.borderColor = "rgba(255,255,255,0.09)"; e.target.style.background = "rgba(255,255,255,0.032)"; }
                }}
                placeholder="12.345.678-9"
                className="ef-input"
                style={{
                  ...inputBase,
                  border: rutOk ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(239,68,68,0.80)",
                }}
                onFocus={(e) => { if (rutOk) e.target.style.borderColor = "rgba(167,139,250,0.45)"; e.target.style.background = "rgba(255,255,255,0.055)"; }}
              />
            </Field>

            <Field label="Razón social" compact={compact} required>
              <input
                type="text"
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Mi Empresa SpA"
                className="ef-input"
                style={inputBase}
                onFocus={(e) => { e.target.style.borderColor = "rgba(167,139,250,0.45)"; e.target.style.background = "rgba(255,255,255,0.055)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.09)"; e.target.style.background = "rgba(255,255,255,0.032)"; }}
              />
            </Field>

            <Field label="Giro" compact={compact} style={{ gridColumn: "span 2" }}>
              <input
                type="text"
                value={giro}
                onChange={(e) => setGiro(e.target.value)}
                placeholder="Servicios de software"
                className="ef-input"
                style={inputBase}
                onFocus={(e) => { e.target.style.borderColor = "rgba(167,139,250,0.45)"; e.target.style.background = "rgba(255,255,255,0.055)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.09)"; e.target.style.background = "rgba(255,255,255,0.032)"; }}
              />
            </Field>

            <Field label="Dirección" compact={compact}>
              <input
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Av. Apoquindo 123"
                className="ef-input"
                style={inputBase}
                onFocus={(e) => { e.target.style.borderColor = "rgba(167,139,250,0.45)"; e.target.style.background = "rgba(255,255,255,0.055)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.09)"; e.target.style.background = "rgba(255,255,255,0.032)"; }}
              />
            </Field>

            <Field label="Comuna" compact={compact}>
              <input
                type="text"
                value={comuna}
                onChange={(e) => setComuna(e.target.value)}
                placeholder="Las Condes"
                className="ef-input"
                style={inputBase}
                onFocus={(e) => { e.target.style.borderColor = "rgba(167,139,250,0.45)"; e.target.style.background = "rgba(255,255,255,0.055)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.09)"; e.target.style.background = "rgba(255,255,255,0.032)"; }}
              />
            </Field>

            <Field label="Email para el SII" compact={compact} style={{ gridColumn: "span 2" }}>
              <input
                type="email"
                value={emailSii}
                onChange={(e) => setEmailSii(e.target.value)}
                placeholder="sii@miempresa.cl"
                className="ef-input"
                style={inputBase}
                onFocus={(e) => { e.target.style.borderColor = "rgba(167,139,250,0.45)"; e.target.style.background = "rgba(255,255,255,0.055)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.09)"; e.target.style.background = "rgba(255,255,255,0.032)"; }}
              />
            </Field>
          </div>
        </div>
      </div>

      {/* CARD 2: TIPO DE CONTRIBUYENTE */}
      <div style={{
        borderRadius: compact ? 14 : 18,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.035)",
        padding: compact ? 10 : 24,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: compact ? 7 : 16,
        }}>
          <div>
            <div style={{
              fontSize: compact ? 12 : 13, fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff",
            }}>
              Tipo de contribuyente
            </div>
            <div style={{ marginTop: 2, fontSize: compact ? 10 : 11, color: "rgba(255,255,255,0.50)" }}>
              Define el tipo de boleta por defecto.
            </div>
          </div>

          <span style={{
            borderRadius: 9999,
            border: `1px solid ${
              tipoContribuyente === "afecto" ? "rgba(52,211,153,0.20)"
                : tipoContribuyente === "exento" ? "rgba(101,184,255,0.20)"
                : "rgba(167,139,250,0.20)"
            }`,
            background: `${
              tipoContribuyente === "afecto" ? "rgba(52,211,153,0.15)"
                : tipoContribuyente === "exento" ? "rgba(101,184,255,0.15)"
                : "rgba(167,139,250,0.15)"
            }`,
            padding: compact ? "3px 8px" : "4px 10px", fontSize: compact ? 9 : 10, fontWeight: 700,
            color: tipoContribuyente === "afecto" ? "#86EFAC" : tipoContribuyente === "exento" ? "#BFDBFE" : "#C4B5FD",
          }}>
            {tipoContribuyente === "afecto" ? "AFECTO" : tipoContribuyente === "exento" ? "EXENTO" : "AUTO"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: compact ? 7 : 10 }}>
          <button
            type="button"
            onClick={() => setTipoContribuyente("afecto")}
            style={{
              borderRadius: 12,
              border: tipoContribuyente === "afecto"
                ? "1px solid rgba(52,211,153,0.35)"
                : "1px solid rgba(255,255,255,0.10)",
              background: tipoContribuyente === "afecto"
                ? "rgba(52,211,153,0.18)"
                : "rgba(255,255,255,0.035)",
              padding: compact ? "7px 8px" : "12px 12px",
              fontSize: compact ? 10 : 12, fontWeight: 700,
              color: tipoContribuyente === "afecto" ? "#86EFAC" : "rgba(255,255,255,0.55)",
              boxShadow: tipoContribuyente === "afecto"
                ? "0 14px 34px rgba(52,211,153,0.12)"
                : "none",
              cursor: "pointer",
              transition: "all 160ms ease",
            }}
          >
            AFECTO
            <span style={{ display: "block", marginTop: compact ? 2 : 4, fontSize: compact ? 9 : 10, fontWeight: 500, opacity: 0.7 }}>
              Boleta con IVA 19%
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTipoContribuyente("auto")}
            style={{
              borderRadius: 12,
              border: tipoContribuyente === "auto"
                ? "1px solid rgba(167,139,250,0.35)"
                : "1px solid rgba(255,255,255,0.10)",
              background: tipoContribuyente === "auto"
                ? "rgba(167,139,250,0.18)"
                : "rgba(255,255,255,0.035)",
              padding: compact ? "7px 8px" : "12px 12px",
              fontSize: compact ? 10 : 12, fontWeight: 700,
              color: tipoContribuyente === "auto" ? "#C4B5FD" : "rgba(255,255,255,0.55)",
              boxShadow: tipoContribuyente === "auto"
                ? "0 14px 34px rgba(167,139,250,0.12)"
                : "none",
              cursor: "pointer",
              transition: "all 160ms ease",
            }}
          >
            AUTO
            <span style={{ display: "block", marginTop: compact ? 2 : 4, fontSize: compact ? 9 : 10, fontWeight: 500, opacity: 0.7 }}>
              Programa decide
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTipoContribuyente("exento")}
            style={{
              borderRadius: 12,
              border: tipoContribuyente === "exento"
                ? "1px solid rgba(101,184,255,0.35)"
                : "1px solid rgba(255,255,255,0.10)",
              background: tipoContribuyente === "exento"
                ? "rgba(101,184,255,0.18)"
                : "rgba(255,255,255,0.035)",
              padding: compact ? "7px 8px" : "12px 16px",
              fontSize: compact ? 10 : 12, fontWeight: 700,
              color: tipoContribuyente === "exento" ? "#BFDBFE" : "rgba(255,255,255,0.55)",
              boxShadow: tipoContribuyente === "exento"
                ? "0 14px 34px rgba(101,184,255,0.12)"
                : "none",
              cursor: "pointer",
              transition: "all 160ms ease",
            }}
          >
            EXENTO
            <span style={{ display: "block", marginTop: compact ? 2 : 4, fontSize: compact ? 9 : 10, fontWeight: 500, opacity: 0.7 }}>
              Boleta sin IVA
            </span>
          </button>
        </div>

        <div style={{
          marginTop: compact ? 7 : 12,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(0,0,0,0.15)",
          padding: compact ? "6px 9px" : "8px 12px",
          fontSize: compact ? 9 : 11, lineHeight: compact ? 1.35 : 1.5,
          color: "rgba(255,255,255,0.55)",
        }}>
          <strong style={{ color: "rgba(255,255,255,0.75)" }}>Afecto:</strong>{" "}
          emite boletas con IVA 19% tipo 39.{" "}
          <strong style={{ color: "rgba(255,255,255,0.75)" }}>Exento:</strong>{" "}
          emite boletas sin IVA tipo 41.{" "}
          <strong style={{ color: "rgba(255,255,255,0.75)" }}>Auto:</strong>{" "}
          el clasificador decide por cada movimiento. Esto aplica por defecto para todos los clientes,
          salvo que configures un tipo distinto en cada cliente.
        </div>
      </div>

      {/* SUBMIT */}
      {!compact && (
        <button
          type="submit"
          disabled={pending}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            height: 48,
            borderRadius: 12,
            border: "1px solid rgba(232,85,62,0.35)",
            background: "linear-gradient(135deg, #E8553E, #cd5832)",
            boxShadow: "0 18px 38px rgba(232,85,62,0.28), inset 0 1px 0 rgba(255,255,255,0.22)",
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? (
            <>
              <span style={{
                display: "inline-block",
                width: 16, height: 16,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.30)",
                borderTopColor: "#ffffff",
                animation: "ef-spin 0.5s linear infinite",
              }} />
              Guardando…
            </>
          ) : (
            <>
              <span>✓</span>
              Guardar datos del emisor
            </>
          )}
        </button>
      )}
    </form>
    </>
  );
}

function Field({
  label,
  required,
  error,
  compact,
  style,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  compact?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div style={style}>
      <label style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: compact ? 5 : 10,
        fontSize: compact ? 10 : 13,
        fontWeight: 600,
        color: "rgba(255,255,255,0.48)",
      }}>
        {label}
        {required && <span style={{ color: "#E8553E" }}>*</span>}
      </label>

      {children}

      {error && (
        <p style={{ marginTop: compact ? 4 : 8, fontSize: compact ? 10 : 12, fontWeight: 500, color: "rgba(239,68,68,1)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
