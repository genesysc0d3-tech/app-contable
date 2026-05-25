"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDatosEmisor, setEmpresaLogo, type DatosEmisor } from "./actions";
import { formatRut, validarRut, cleanRut } from "@/lib/sii/validation";
import { useToast } from "@/components/Toast";

interface Props {
  inicial: DatosEmisor;
  variant?: "page" | "popup";
}

export default function EmisorForm({ inicial, variant = "page" }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [logoPending, startLogo] = useTransition();
  const compact = variant === "popup";

  const [rut, setRut] = useState(inicial.rut ? formatRut(inicial.rut) : "");
  const [razonSocial, setRazonSocial] = useState(inicial.razon_social ?? "");
  const [giro, setGiro] = useState(inicial.giro ?? "");
  const [direccion, setDireccion] = useState(inicial.direccion ?? "");
  const [comuna, setComuna] = useState(inicial.comuna ?? "");
  const [emailSii, setEmailSii] = useState(inicial.email_sii ?? "");
  const [hasLogo, setHasLogo] = useState(Boolean(inicial.logo_storage_path));
  const [logoVersion, setLogoVersion] = useState(0);
  const [tipoContribuyente, setTipoContribuyente] = useState(
    inicial.tipo_contribuyente ?? "auto"
  );

  const rutOk = !rut || validarRut(rut);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (rut && !validarRut(rut)) {
      toast("RUT inválido", "error");
      return;
    }

    if (!razonSocial.trim()) {
      toast("Razón social obligatoria", "error");
      return;
    }

    start(async () => {
      const r = await setDatosEmisor({
        rut: rut ? cleanRut(rut) : null,
        razon_social: razonSocial,
        giro,
        direccion,
        comuna,
        email_sii: emailSii,
        tipo_contribuyente: tipoContribuyente,
      });

      if (r.error) toast(r.error, "error");
      else toast("Datos del emisor guardados");
    });
  }

  function handleLogoChange(file: File | null) {
    if (!file) return;
    const formData = new FormData();
    formData.set("logo", file);
    startLogo(async () => {
      const r = await setEmpresaLogo(formData);
      if (r.error) {
        toast(r.error, "error");
        return;
      }
      setHasLogo(true);
      setLogoVersion((v) => v + 1);
      router.refresh();
      toast("Logo de empresa guardado");
    });
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

            <label style={{
              marginLeft: "auto",
              width: compact ? 118 : 150,
              minHeight: compact ? 54 : 66,
              borderRadius: compact ? 12 : 16,
              border: "1px dashed rgba(232,85,62,0.30)",
              background: "rgba(232,85,62,0.055)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: compact ? 6 : 8,
              cursor: logoPending ? "wait" : "pointer",
              color: "#FDBA74",
              flexShrink: 0,
              overflow: "hidden",
              textAlign: "center",
            }}>
              <input
                type="file"
                accept="image/png,image/svg+xml,image/webp,image/gif,image/jpeg"
                disabled={logoPending}
                onChange={(e) => handleLogoChange(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
              {hasLogo ? (
                <img
                  src={`/api/empresa/logo/current?v=${logoVersion}`}
                  alt="Logo de la empresa"
                  style={{ maxWidth: "100%", maxHeight: compact ? 38 : 48, objectFit: "contain", display: "block" }}
                />
              ) : (
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: compact ? 9 : 10, fontWeight: 750, lineHeight: 1.15 }}>
                  <span>{logoPending ? "Subiendo..." : "Subir logo"}</span>
                  <span style={{ color: "rgba(255,255,255,.42)", fontSize: compact ? 8 : 9, fontWeight: 600 }}>PNG/SVG transparente</span>
                </span>
              )}
            </label>
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
