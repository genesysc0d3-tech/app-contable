"use client";

import { useEffect, useState, useRef, useId, isValidElement, cloneElement, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { setDatosEmisor, removeEmpresaLogo, type DatosEmisor } from "./actions";
import { formatRut, validarRut, cleanRut } from "@/lib/sii/validation";
import { useToast } from "@/components/Toast";

interface Props {
  inicial: DatosEmisor;
  variant?: "page" | "popup";
  /** C1: el popup lo consulta en goToStep/handleClose para auto-guardar de forma awaitable. */
  submitRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export default function EmisorForm({ inicial, variant = "page", submitRef }: Props) {
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
  // Confirmado por onLoad del <img>; sin marco visible hasta entonces (evita
  // el recuadro fantasma cuando la empresa aún no tiene logo).
  const [logoListo, setLogoListo] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [tipoContribuyente, setTipoContribuyente] = useState(
    inicial.tipo_contribuyente ?? "auto"
  );
  // "" = sin default (la IA decide). Semilla para auto-clasificar la 1ª cartola.
  const [operacionHint, setOperacionHint] = useState(inicial.operacion_hint_default ?? "");

  // Errores inline: el RUT se valida recién al salir del campo (touched), no
  // por keystroke; razón social se marca cuando la validación del submit falla.
  const [rutTouched, setRutTouched] = useState(false);
  const [razonTouched, setRazonTouched] = useState(false);
  const rutError = rutTouched && rut && !validarRut(rut) ? "RUT inválido (dígito verificador)" : null;
  const razonError = razonTouched && !razonSocial.trim() ? "Razón social obligatoria" : null;

  // Último snapshot guardado; base del dirty-check del auto-save al navegar.
  const ultimoGuardado = useRef({
    rut: inicial.rut ? cleanRut(inicial.rut) : null,
    razon_social: inicial.razon_social ?? "",
    giro: inicial.giro ?? "",
    direccion: inicial.direccion ?? "",
    comuna: inicial.comuna ?? "",
    email_sii: inicial.email_sii ?? "",
    tipo_contribuyente: inicial.tipo_contribuyente ?? "auto",
    operacion_hint_default: inicial.operacion_hint_default ?? null,
  });

  // Validación + guardado compartidos por el submit del form y por submitRef
  // (C1). Retorna true si guardó OK (o si no había cambios, con soloSiCambio);
  // false si la validación o el server fallaron.
  async function guardar(opts?: { soloSiCambio?: boolean }): Promise<boolean> {
    if (logoPending) {
      toast("Espera a que termine de subir el logo", "error");
      return false;
    }

    const datos = {
      rut: rut ? cleanRut(rut) : null,
      razon_social: razonSocial,
      giro,
      direccion,
      comuna,
      email_sii: emailSii,
      tipo_contribuyente: tipoContribuyente,
      operacion_hint_default: operacionHint || null,
    };

    // Dirty-check ANTES de validar: si nada cambió respecto del último guardado,
    // navegar no debe castigar con toasts/pulsos/escrituras redundantes.
    const prev = ultimoGuardado.current;
    const sinCambios =
      datos.rut === prev.rut &&
      datos.razon_social === prev.razon_social &&
      datos.giro === prev.giro &&
      datos.direccion === prev.direccion &&
      datos.comuna === prev.comuna &&
      datos.email_sii === prev.email_sii &&
      datos.tipo_contribuyente === prev.tipo_contribuyente &&
      (datos.operacion_hint_default ?? null) === (prev.operacion_hint_default ?? null);
    if (opts?.soloSiCambio && sinCambios) return true;

    const rutInvalido = !!rut && !validarRut(rut);
    const razonVacia = !razonSocial.trim();
    if (rutInvalido || razonVacia) {
      if (rutInvalido) setRutTouched(true);
      if (razonVacia) setRazonTouched(true);
      toast(rutInvalido ? "RUT inválido" : "Razón social obligatoria", "error");
      return false;
    }

    setPending(true);
    try {
      const r = await setDatosEmisor(datos);
      if (r.error) { toast(r.error, "error"); return false; }
      ultimoGuardado.current = datos;
      toast("Datos del emisor guardados");
      // Éxito real: avisa al v5 (pulse "Empresa guardada"); antes lo disparaba
      // el popup a ciegas aunque la validación fallara.
      window.dispatchEvent(new CustomEvent("v5-popup-saved", { detail: { label: "Empresa guardada" } }));
      return true;
    } catch { toast("Error al guardar", "error"); return false; }
    finally { setPending(false); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void guardar();
  }

  // C1: expone el guardado awaitable al popup (goToStep/handleClose). Sin deps:
  // se reasigna en cada render para que el closure vea siempre el estado vigente.
  useEffect(() => {
    if (!submitRef) return;
    const ref = submitRef;
    ref.current = () => guardar({ soloSiCambio: true });
    return () => { ref.current = null; };
  });

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
    height: compact ? 38 : 48,
    borderRadius: compact ? 10 : 16,
    // El borde vive en la clase .ef-input (habilita :focus-visible y error por CSS).
    background: "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
    padding: compact ? "0 12px" : "0 16px",
    fontSize: compact ? 13 : 15,
    color: "var(--text, #e8eaf0)",
    outline: "none",
    transition: "all 160ms ease",
    boxSizing: "border-box" as const,
  };

  return (
    <>
      <style>{`
        .ef-input { border: 1px solid var(--border, rgba(255,255,255,.06)); }
        .ef-input::placeholder { color: color-mix(in srgb, var(--text, #e8eaf0) 32%, transparent); }
        .ef-input.ef-input-error { border-color: color-mix(in srgb, var(--red, #ef4444) 80%, transparent); }
        .ef-input:focus-visible { border-color: color-mix(in srgb, var(--accent, #E8553E) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #E8553E) 15%, transparent); }
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
      style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 16 }}
    >
      {/* CARD 1: DATOS DEL EMISOR */}
      <div style={{
        borderRadius: compact ? 14 : 22,
        border: "1px solid var(--border, rgba(255,255,255,.06))",
        background: "color-mix(in srgb, var(--text, #e8eaf0) 3%, transparent)",
        boxShadow: "inset 0 1px 0 var(--border, rgba(255,255,255,.06))",
      }}>
        <div style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: compact ? "14px 16px" : "36px 40px",
        }}>
          {/* HEADER */}
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: compact ? 10 : 20,
            marginBottom: compact ? 12 : 36,
          }}>
            <div style={{
              width: compact ? 34 : 48, height: compact ? 34 : 48, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: compact ? 10 : 16,
              border: "1px solid rgba(232,85,62,0.25)",
              background: "rgba(232,85,62,0.12)",
              color: "var(--accent, #E8553E)",
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
                  letterSpacing: "-0.04em", color: "var(--text, #e8eaf0)",
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
                  color: "var(--accent, #E8553E)",
                }}>
                  Requerido
                </span>
              </div>
              <p style={{
                marginTop: compact ? 3 : 8, fontSize: compact ? 11 : 14, lineHeight: 1.35,
                color: "var(--text3, #697080)",
              }}>
                Información tributaria que aparecerá en tus documentos.
              </p>
            </div>

            {/* Drag & drop: soltar un archivo acá sube el logo (antes el browser navegaba a la imagen) */}
            <div
              style={{ position: "relative", marginLeft: "auto", flexShrink: 0 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0] ?? null;
                handleLogoChange(f);
              }}
            >
              <input ref={logoInputRef} type="file" accept="image/png,image/webp,image/gif,image/jpeg" disabled={logoPending}
                onChange={(e) => { const f = e.target.files?.[0] ?? null; handleLogoChange(f); e.target.value = ""; }}
                style={{ display: "none" }}
              />
              {hasLogo ? (
                <div className="ef-logo-card" style={{ width: compact ? 118 : 150, minHeight: compact ? 54 : 66, borderRadius: compact ? 12 : 16, border: logoListo ? "1px dashed rgba(232,85,62,0.30)" : "1px dashed transparent", background: logoListo ? "rgba(232,85,62,0.055)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? 6 : 8, overflow: "hidden", position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- logo servido por API same-origin; next/image no aplica */}
                  <img
                    src={`/api/empresa/logo/current?v=${logoVersion}`}
                    alt="Logo"
                    onLoad={() => setLogoListo(true)}
                    onError={() => { setLogoListo(false); setHasLogo(false); }}
                    style={{ maxWidth: "100%", maxHeight: compact ? 38 : 48, objectFit: "contain", display: "block", opacity: logoListo ? 1 : 0, transition: "opacity 160ms ease, filter 160ms ease, transform 160ms ease" }}
                  />
                  {logoListo && <div className="ef-logo-fade" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,10,12,.08), rgba(10,10,12,.46))", backdropFilter: "blur(1px)", transition: "opacity 160ms ease", pointerEvents: "none" }} />}
                  {logoListo && (
                  <div className="ef-logo-actions" style={{ position: "absolute", left: "50%", bottom: 7, display: "flex", gap: 5, transform: "translate(-50%, 4px) scale(.98)", transition: "opacity 160ms ease, transform 160ms ease" }}>
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoPending} aria-label="Cambiar logo" style={{ width: compact ? 25 : 29, height: compact ? 25 : 29, borderRadius: 999, border: "1px solid rgba(255,255,255,.22)", background: "rgba(15,15,18,.72)", color: "#fff", display: "grid", placeItems: "center", cursor: logoPending ? "wait" : "pointer", backdropFilter: "blur(8px)", boxShadow: "0 8px 18px rgba(0,0,0,.24)" }}>
                      {logoPending ? <span style={{ fontSize: 10, fontWeight: 800 }}>...</span> : <svg viewBox="0 0 24 24" fill="none" width={compact ? 13 : 14} height={compact ? 13 : 14} aria-hidden="true"><path d="m4 16.5-.5 4 4-.5L18.9 8.6a2.1 2.1 0 0 0 0-3L18.4 5a2.1 2.1 0 0 0-3 0L4 16.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m13.8 6.6 3.6 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                    </button>
                    <button type="button" onClick={handleRemoveLogo} disabled={logoPending} aria-label="Eliminar logo" style={{ width: compact ? 25 : 29, height: compact ? 25 : 29, borderRadius: 999, border: "1px solid rgba(255,255,255,.18)", background: "rgba(190,34,28,.78)", color: "#fff", display: "grid", placeItems: "center", cursor: logoPending ? "wait" : "pointer", backdropFilter: "blur(8px)", boxShadow: "0 8px 18px rgba(0,0,0,.24)" }}>
                      <svg viewBox="0 0 24 24" fill="none" width={compact ? 13 : 14} height={compact ? 13 : 14} aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 7l.7-2h4.6L15 7M7 7l.8 13h8.4L17 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                  )}
                </div>
              ) : (
                <div role="button" tabIndex={logoPending ? -1 : 0} aria-label="Subir logo de la empresa (PNG o WebP transparente)"
                  onClick={() => logoInputRef.current?.click()}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !logoPending) { e.preventDefault(); logoInputRef.current?.click(); } }}
                  style={{ width: compact ? 118 : 150, minHeight: compact ? 54 : 66, borderRadius: compact ? 12 : 16, border: "1px dashed rgba(232,85,62,0.30)", background: "rgba(232,85,62,0.055)", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? 6 : 8, cursor: logoPending ? "wait" : "pointer", color: "var(--accent, #E8553E)", overflow: "hidden", textAlign: "center" }}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 750, lineHeight: 1.2 }}>
                    <span>{logoPending ? "Subiendo…" : "Subir logo"}</span>
                    <span style={{ color: logoStatus && logoStatus !== "Logo guardado" ? "var(--red, #ef4444)" : "var(--text3, #697080)", fontSize: 11, fontWeight: 600 }}>{logoStatus ?? "PNG/WebP transparente"}</span>
                  </span>
                </div>
              )}
              {hasLogo && logoStatus && (
                <div style={{ marginTop: 5, maxWidth: compact ? 118 : 150, color: logoStatus === "Logo guardado" ? "var(--green, #22c55e)" : "var(--red, #ef4444)", fontSize: 11, fontWeight: 700, lineHeight: 1.2, textAlign: "center" }}>
                  {logoStatus}
                </div>
              )}
            </div>
          </div>

          {/* FIELDS GRID */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: compact ? "10px 14px" : "28px 32px",
          }}>
            <Field
              label="RUT del emisor"
              compact={compact}
              error={rutError}
              hint="El de tu empresa (77.xxx.xxx) o el tuyo si trabajas como persona natural con giro"
            >
              <input
                type="text"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                onBlur={() => { if (rut) setRut(formatRut(rut)); setRutTouched(true); }}
                placeholder="12.345.678-9"
                className={`ef-input${rutError ? " ef-input-error" : ""}`}
                style={inputBase}
              />
            </Field>

            <Field
              label="Razón social"
              compact={compact}
              required
              error={razonError}
              hint="Persona natural: escribe tu nombre completo tal como aparece en el SII"
            >
              <input
                type="text"
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Osvaldo Pérez / Mi Empresa SpA"
                className={`ef-input${razonError ? " ef-input-error" : ""}`}
                style={inputBase}
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
              />
            </Field>

            <Field
              label="Email para el SII"
              compact={compact}
              style={{ gridColumn: "span 2" }}
              hint="El correo de contacto que aparecerá en tus documentos (usa el tuyo habitual)"
            >
              <input
                type="email"
                value={emailSii}
                onChange={(e) => setEmailSii(e.target.value)}
                placeholder="sii@miempresa.cl"
                className="ef-input"
                style={inputBase}
              />
            </Field>
          </div>
        </div>
      </div>

      {/* CARD 2: TIPO DE CONTRIBUYENTE */}
      <div style={{
        borderRadius: compact ? 14 : 18,
        border: "1px solid var(--border, rgba(255,255,255,.06))",
        background: "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
        padding: compact ? 12 : 24,
        boxShadow: "inset 0 1px 0 var(--border, rgba(255,255,255,.06))",
      }}>
        <div style={{ marginBottom: compact ? 8 : 16 }}>
          <div style={{
            fontSize: compact ? 12 : 13, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text, #e8eaf0)",
          }}>
            Tipo de contribuyente
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: "var(--text2, #8b92a3)" }}>
            Define el tipo de boleta por defecto.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: compact ? 7 : 10 }}>
          <button
            type="button"
            onClick={() => setTipoContribuyente("afecto")}
            style={{
              borderRadius: 12,
              border: tipoContribuyente === "afecto"
                ? "1px solid color-mix(in srgb, var(--green, #22c55e) 35%, transparent)"
                : "1px solid var(--border, rgba(255,255,255,.06))",
              background: tipoContribuyente === "afecto"
                ? "color-mix(in srgb, var(--green, #22c55e) 18%, transparent)"
                : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
              padding: compact ? "7px 8px" : "12px 12px",
              fontSize: compact ? 10 : 12, fontWeight: 700,
              color: tipoContribuyente === "afecto" ? "var(--green, #22c55e)" : "var(--text2, #8b92a3)",
              boxShadow: tipoContribuyente === "afecto"
                ? "0 14px 34px color-mix(in srgb, var(--green, #22c55e) 12%, transparent)"
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
                ? "1px solid color-mix(in srgb, var(--accent, #E8553E) 35%, transparent)"
                : "1px solid var(--border, rgba(255,255,255,.06))",
              background: tipoContribuyente === "auto"
                ? "color-mix(in srgb, var(--accent, #E8553E) 18%, transparent)"
                : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
              padding: compact ? "7px 8px" : "12px 12px",
              fontSize: compact ? 10 : 12, fontWeight: 700,
              color: tipoContribuyente === "auto" ? "var(--accent, #E8553E)" : "var(--text2, #8b92a3)",
              boxShadow: tipoContribuyente === "auto"
                ? "0 14px 34px color-mix(in srgb, var(--accent, #E8553E) 12%, transparent)"
                : "none",
              cursor: "pointer",
              transition: "all 160ms ease",
            }}
          >
            AUTO
            <span style={{ display: "block", marginTop: compact ? 2 : 4, fontSize: compact ? 9 : 10, fontWeight: 500, opacity: 0.7 }}>
              La app elige según cada venta
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTipoContribuyente("exento")}
            style={{
              borderRadius: 12,
              border: tipoContribuyente === "exento"
                ? "1px solid color-mix(in srgb, var(--blue, #5b9cf6) 35%, transparent)"
                : "1px solid var(--border, rgba(255,255,255,.06))",
              background: tipoContribuyente === "exento"
                ? "color-mix(in srgb, var(--blue, #5b9cf6) 18%, transparent)"
                : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
              padding: compact ? "7px 8px" : "12px 16px",
              fontSize: compact ? 10 : 12, fontWeight: 700,
              color: tipoContribuyente === "exento" ? "var(--blue, #5b9cf6)" : "var(--text2, #8b92a3)",
              boxShadow: tipoContribuyente === "exento"
                ? "0 14px 34px color-mix(in srgb, var(--blue, #5b9cf6) 12%, transparent)"
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

        {/* Consecuencia tributaria de elegir EXENTO (hallazgo del contador) */}
        {tipoContribuyente === "exento" && (
          <div style={{
            marginTop: compact ? 8 : 12,
            fontSize: compact ? 11 : 12, lineHeight: 1.45,
            color: "var(--amber, #f59e0b)",
          }}>
            Solo si NINGUNA de tus ventas lleva IVA (cripto, divisas, servicios exentos). Si vendes
            productos o servicios normales, emitirías boletas sin el IVA que debes — el SII lo cobra
            igual, con multa.
          </div>
        )}

        <div style={{
          marginTop: compact ? 8 : 12,
          borderRadius: 12,
          border: "1px solid var(--border, rgba(255,255,255,.06))",
          background: "var(--bg-muted, rgba(0,0,0,0.15))",
          padding: compact ? "8px 10px" : "10px 12px",
          fontSize: compact ? 11 : 12, lineHeight: 1.5,
          color: "var(--text2, #8b92a3)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <div><strong style={{ color: "var(--text, #e8eaf0)" }}>Afecto:</strong> boletas con IVA 19%.</div>
          <div><strong style={{ color: "var(--text, #e8eaf0)" }}>Exento:</strong> boletas sin IVA (cripto, divisas, servicios exentos).</div>
          <div><strong style={{ color: "var(--text, #e8eaf0)" }}>Auto:</strong> la app elige según cada venta (recomendado si no estás seguro).</div>
          <div>Se aplica a todas tus ventas, salvo que fijes un tipo distinto para un cliente.</div>
        </div>

        {/* Aviso BHE: evita que independientes confundan boleta de venta con boleta de honorarios */}
        <div style={{
          marginTop: compact ? 8 : 12,
          fontSize: compact ? 10 : 11, lineHeight: 1.4,
          color: "var(--text3, #697080)",
        }}>
          massdte emite boletas de venta electrónicas. Las boletas de honorarios (profesionales
          independientes) se emiten en sii.cl — esta app no las reemplaza.
        </div>
      </div>

      {/* CARD 3: TIPO DE OPERACIÓN HABITUAL — semilla para clasificar la 1ª cartola */}
      <div style={{
        borderRadius: compact ? 14 : 18,
        border: "1px solid var(--border, rgba(255,255,255,.06))",
        background: "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
        padding: compact ? 12 : 24,
        boxShadow: "inset 0 1px 0 var(--border, rgba(255,255,255,.06))",
      }}>
        <div style={{ marginBottom: compact ? 8 : 12 }}>
          <div style={{
            fontSize: compact ? 12 : 13, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text, #e8eaf0)",
          }}>
            Tipo de operación habitual
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: "var(--text2, #8b92a3)" }}>
            Ayuda a clasificar tu primera cartola, antes de que la app aprenda tus movimientos.
            Podés cambiarlo por cartola al subirla.
          </div>
        </div>

        <select
          value={operacionHint}
          onChange={(e) => setOperacionHint(e.target.value)}
          style={{
            width: "100%",
            borderRadius: 12,
            border: "1px solid var(--border, rgba(255,255,255,.06))",
            background: "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
            color: "var(--text, #e8eaf0)",
            padding: compact ? "9px 10px" : "12px 12px",
            fontSize: compact ? 12 : 13, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <option value="">Sin definir — la app decide en cada venta</option>
          <option value="p2p_cripto">P2P / Cripto (exenta)</option>
          <option value="forex_divisas">Forex / Divisas (exenta)</option>
          <option value="servicios">Servicios</option>
          <option value="ventas">Venta de productos</option>
          <option value="mixto">Mixto (varios tipos)</option>
        </select>
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
            background: "linear-gradient(135deg, var(--accent, #E8553E), #cd5832)",
            color: "#fff",
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
  hint,
  compact,
  style,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  compact?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  // Asocia label ↔ input (htmlFor/id) y anuncia el error (aria-invalid + aria-describedby
  // + role="alert") para lectores de pantalla. Si el child es un elemento simple, se le
  // inyectan los ids/aria; si no, degrada sin romper.
  const autoId = useId();
  const msgId = `${autoId}-msg`;
  let control = children;
  if (isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const childId = (child.props.id as string | undefined) ?? autoId;
    control = cloneElement(child, {
      id: childId,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": (error || hint) ? msgId : child.props["aria-describedby"],
    });
  }
  const controlId = isValidElement(children)
    ? ((children as ReactElement<Record<string, unknown>>).props.id as string | undefined) ?? autoId
    : undefined;

  return (
    <div style={style}>
      <label htmlFor={controlId} style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: compact ? 6 : 10,
        fontSize: compact ? 11 : 13,
        fontWeight: 600,
        color: "var(--text2, #8b92a3)",
      }}>
        {label}
        {required && <span style={{ color: "var(--accent, #E8553E)" }}>*</span>}
      </label>

      {control}

      {error ? (
        <p id={msgId} role="alert" style={{ marginTop: compact ? 4 : 8, fontSize: compact ? 11 : 12, fontWeight: 500, lineHeight: 1.35, color: "var(--red, #ef4444)" }}>
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} style={{ marginTop: compact ? 4 : 8, fontSize: compact ? 11 : 12, fontWeight: 500, lineHeight: 1.35, color: "var(--text3, #697080)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
