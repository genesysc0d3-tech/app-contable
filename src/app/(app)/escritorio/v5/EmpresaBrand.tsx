"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarEmpresaActiva, crearEmpresaAdicional } from "./actions";

export type EmpresaSelectorItem = {
  id: string;
  nombre: string;
  rut: string | null;
  activaActual: boolean;
  esPrincipal: boolean;
  logoUrl: string;
};

export default function EmpresaBrand({
  nombre,
  logoUrl,
  empresas = [],
  multiempresa = false,
  puedeAgregar = false,
  size = 34,
  textSize = 18,
  maxWidth = 260,
}: {
  nombre: string;
  logoUrl: string;
  empresas?: EmpresaSelectorItem[];
  multiempresa?: boolean;
  puedeAgregar?: boolean;
  size?: number;
  textSize?: number;
  maxWidth?: number;
}) {
  const router = useRouter();
  const [logoOk, setLogoOk] = useState(Boolean(logoUrl));
  const [open, setOpen] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLSpanElement>(null);
  // El menú abre si hay más de una empresa (cambiar) O si el titular Business
  // aún puede agregar la siguiente (aunque hoy tenga una sola).
  const canSwitch = multiempresa && (empresas.length > 1 || puedeAgregar);

  useEffect(() => {
    setLogoOk(Boolean(logoUrl));
  }, [logoUrl]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function switchEmpresa(empresaId: string) {
    const selected = empresas.find((empresa) => empresa.id === empresaId);
    if (!selected || selected.activaActual || pending) {
      setOpen(false);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await cambiarEmpresaActiva(empresaId);
      if (!result.ok) {
        setError(result.detalle ?? "No se pudo cambiar de empresa.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const brandContent = (
    <>
      {logoOk ? (
        <span style={{ width: maxWidth, maxWidth, height: size, display: "flex", alignItems: "center", justifyContent: "flex-start", overflow: "visible", flexShrink: 0 }}>
          <LogoImage src={logoUrl} alt={`Logo de ${nombre}`} maxHeight={size} onError={() => setLogoOk(false)} />
        </span>
      ) : (
        <span style={{ fontSize: textSize, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{nombre}</span>
      )}
      {canSwitch && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text2)", flexShrink: 0 }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      )}
    </>
  );

  return (
    <span ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: logoOk ? 0 : 9, minWidth: 0, width: "fit-content", maxWidth, whiteSpace: "nowrap", flexShrink: 0, overflow: "visible" }}>
      {canSwitch ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Cambiar empresa"
          style={{ display: "flex", alignItems: "center", gap: logoOk ? 6 : 9, minWidth: 0, maxWidth, border: 0, padding: 0, margin: 0, background: "transparent", color: "inherit", cursor: pending ? "wait" : "pointer", textAlign: "left" }}
        >
          {brandContent}
        </button>
      ) : (
        brandContent
      )}

      {open && canSwitch && (
        <div className="eb-pop" style={{ position: "absolute", left: 0, top: size + 10, zIndex: 90, width: `min(${agregando ? 340 : 320}px, calc(100vw - 28px))`, padding: 8, borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 24px 70px rgba(0,0,0,.34), inset 0 1px 0 var(--border)", color: "var(--text)", whiteSpace: "normal", transformOrigin: "top left" }}>
          {/* Entrada con resorte sutil; el nowrap del brand NO se hereda (los
              textos del panel deben envolver, no escaparse del borde). */}
          <style>{`
            @keyframes ebPopIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
            .eb-pop{animation:ebPopIn .18s cubic-bezier(.22,1,.36,1) both;}
            @media (prefers-reduced-motion: reduce){.eb-pop{animation:none;}}
          `}</style>
          {agregando ? (
            <AgregarEmpresaForm
              onListo={(empresaId) => {
                setAgregando(false);
                setOpen(false);
                startTransition(async () => {
                  await cambiarEmpresaActiva(empresaId);
                  router.refresh();
                });
              }}
              onCancelar={() => setAgregando(false)}
            />
          ) : (<>
          <div style={{ padding: "7px 8px 9px", fontSize: 9, fontWeight: 850, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Cambiar empresa</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {empresas.map((empresa) => (
              <button
                key={empresa.id}
                type="button"
                onClick={() => switchEmpresa(empresa.id)}
                disabled={pending}
                style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: 9, width: "100%", minHeight: 42, padding: "7px 8px", borderRadius: 9, border: empresa.activaActual ? "1px solid rgba(232,85,62,.22)" : "1px solid transparent", background: empresa.activaActual ? "rgba(232,85,62,.09)" : "transparent", color: "var(--text)", cursor: pending ? "wait" : empresa.activaActual ? "default" : "pointer", textAlign: "left" }}
              >
                <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: empresa.activaActual ? "rgba(232,85,62,.14)" : "var(--bg-muted)", color: empresa.activaActual ? "var(--accent)" : "var(--text2)", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>
                  {empresa.nombre.slice(0, 2).toUpperCase()}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{empresa.nombre}</span>
                  <span style={{ display: "block", marginTop: 1, fontSize: 9, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{empresa.rut ?? "Empresa"}</span>
                </span>
                {empresa.activaActual && <span style={{ fontSize: 9, fontWeight: 850, color: "var(--accent)" }}>Actual</span>}
              </button>
            ))}
          </div>
          {puedeAgregar && (
            <button
              type="button"
              onClick={() => setAgregando(true)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 6, padding: "9px 8px", borderRadius: 9, border: "1px dashed var(--border)", background: "transparent", color: "var(--text2)", fontSize: 11, fontWeight: 800, cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg-muted)", fontSize: 15, fontWeight: 700 }}>+</span>
              Agregar empresa
            </button>
          )}
          {error && <div style={{ margin: "8px 8px 2px", color: "var(--red)", fontSize: 9, lineHeight: 1.35 }}>{error}</div>}
          </>)}
        </div>
      )}
    </span>
  );
}

/**
 * Alta de empresa adicional (Business): RUT verificado EN VIVO contra la nómina
 * pública de personas jurídicas del SII — al encontrarla, la razón social se
 * autocompleta y el usuario CONFIRMA viendo el nombre (un typo con DV válido
 * muestra otra empresa y se delata solo). El RUT queda inmutable tras la
 * primera emisión, así que este es EL momento de escribirlo bien.
 */
function AgregarEmpresaForm({ onListo, onCancelar }: { onListo: (empresaId: string) => void; onCancelar: () => void }) {
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
          Al crearla verás su mesa vacía; el logo y sus datos se configuran después
          en «Empresa». El RUT queda fijo tras la primera boleta emitida.
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

/**
 * La silueta blanca (brightness(0) invert(1)) existe para que un logo oscuro
 * monocromo no desaparezca sobre el dashboard oscuro. Pero aplicarla siempre
 * mata los logos con color. Acá se analiza el logo (same-origin → canvas
 * legible) y la silueta se activa SOLO si es oscuro y sin color; además solo
 * rige en tema oscuro (vía CSS .dark).
 */
function LogoImage({ src, alt, maxHeight, onError }: { src: string; alt: string; maxHeight: number; onError: () => void }) {
  const [silhouette, setSilhouette] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = src;
    img.onload = () => {
      try {
        const S = 24;
        const canvas = document.createElement("canvas");
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        let n = 0, lumSum = 0, colorful = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue; // transparente: fuera
          const r = data[i], g = data[i + 1], b = data[i + 2];
          n++;
          lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 > 0.22) colorful++;
        }
        if (!cancelled && n > 0) {
          setSilhouette(lumSum / n < 0.45 && colorful / n < 0.08);
        }
      } catch {
        /* canvas tainted u otro fallo: se queda el logo original */
      }
    };
    return () => { cancelled = true; };
  }, [src]);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: maxHeight, maxWidth: "100%", overflow: "visible" }}>
      <style>{`.eb-sil{display:none}.dark .eb-sil{display:block}`}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- API same-origin con cookies (el optimizer de next/image no autentica) + tamaño natural */}
      <img
        src={src}
        alt={alt}
        onError={onError}
        style={{ maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }}
      />
      {silhouette && (
        // eslint-disable-next-line @next/next/no-img-element -- overlay silueta del mismo recurso
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="eb-sil"
          style={{ position: "absolute", inset: 0, maxHeight, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", filter: "brightness(0) invert(1)", mixBlendMode: "lighten", pointerEvents: "none" }}
        />
      )}
    </span>
  );
}
