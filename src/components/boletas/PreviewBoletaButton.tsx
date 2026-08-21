"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Eye, X } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import DescargarBoletaButton from "./DescargarBoletaButton";

interface BoletaData {
  folio: number;
  tipo_dte: number;
  fecha_emision: string;
  emisor_razon_social: string;
  emisor_rut: string;
  emisor_giro: string | null;
  receptor_rut: string | null;
  receptor_razon_social: string | null;
  monto_neto: number;
  monto_exento: number;
  iva: number;
  monto_total: number;
  detalles: { nombre?: string }[];
  estado: string;
}

const clp = (n: number) => `$${Math.round(n || 0).toLocaleString("es-CL")}`;
const tipoLabel = (t: number) =>
  t === 41 ? "Boleta exenta" : t === 39 ? "Boleta afecta" : t === 34 ? "Factura exenta" : t === 33 ? "Factura" : "DTE";
const esExenta = (t: number) => t === 41 || t === 34;
const fmtFecha = (s: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split("-"); return `${d}-${m}-${y}`; }
  try { return new Date(s).toLocaleDateString("es-CL"); } catch { return s; }
};

// Preview LIVIANO: renderiza la boleta desde sus DATOS (no descarga el PDF).
// El PDF original se baja aparte, on-demand, desde R2. Funciona incluso si el
// PDF quedó pendiente — la info siempre se ve.
export default function PreviewBoletaButton({ id }: { id: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [b, setB] = useState<BoletaData | null>(null);
  // URL blob de la boleta PERSONALIZADA (la cara con la marca del emisor).
  // null = no disponible (sin PDF oficial del cual extraer el timbre) → se
  // muestra el preview de datos de siempre.
  const [persUrl, setPersUrl] = useState<string | null>(null);

  async function abrir(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/intermediaria/boleta/${id}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast(j.error ?? "Error al cargar la boleta", "error"); return; }
      setB(j.boleta as BoletaData);
      // La personalizada en paralelo, tolerante a fallo (mock viejo sin PDF
      // oficial, timbre no extraíble, etc. → preview de datos como siempre).
      try {
        const pres = await fetch(`/api/intermediaria/boleta/${id}/pdf-personalizada`, { cache: "no-store" });
        if (pres.ok) {
          const blob = await pres.blob();
          setPersUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        } else {
          setPersUrl(null);
        }
      } catch { setPersUrl(null); }
      setOpen(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error al cargar la boleta", "error");
    } finally {
      setLoading(false);
    }
  }

  const exenta = b ? esExenta(b.tipo_dte) : false;
  const receptor = b && (b.receptor_razon_social || b.receptor_rut)
    ? `${b.receptor_razon_social ?? ""}${b.receptor_rut ? ` · ${b.receptor_rut}` : ""}`.trim()
    : "Consumidor final";
  const detalle = b?.detalles?.[0]?.nombre?.trim();

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={loading}
        className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[#E8553E] hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors"
        title="Vista previa"
        aria-label="Vista previa de la boleta"
      >
        <Eye size={14} weight="bold" className={loading ? "animate-pulse" : ""} />
      </button>

      {open && b && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px,96vw)", maxHeight: "92vh", overflowY: "auto", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}
          >
            {/* Cabecera */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{tipoLabel(b.tipo_dte)}</span>
                <span style={{ fontSize: 8, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: exenta ? "rgba(91,156,246,.14)" : "rgba(180,240,39,.14)", color: exenta ? "#5b9cf6" : "#8fb91e" }}>
                  {exenta ? "EXENTA" : "AFECTA"}
                </span>
              </span>
              <button onClick={() => setOpen(false)} aria-label="Cerrar" style={{ border: "none", background: "transparent", color: "var(--text2)", cursor: "pointer", display: "grid", placeItems: "center" }}>
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* Cuerpo: la PERSONALIZADA es la protagonista cuando existe */}
            {persUrl ? (
              <div style={{ padding: 12, background: "var(--bg-muted)" }}>
                <iframe title="Boleta personalizada" src={`${persUrl}#toolbar=0&navpanes=0`} style={{ width: "100%", height: "min(58vh, 520px)", border: "none", borderRadius: 10, background: "#fff" }} />
              </div>
            ) : (
            <div style={{ padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>Folio</span>
                <span style={{ fontSize: 22, fontWeight: 900, color: "#E8553E" }}>N° {b.folio}</span>
              </div>

              <Row label="Emisor" value={b.emisor_razon_social} sub={`${b.emisor_rut}${b.emisor_giro ? ` · ${b.emisor_giro}` : ""}`} />
              <Row label="Receptor" value={receptor} />
              {detalle && <Row label="Detalle" value={detalle} />}
              <Row label="Fecha" value={fmtFecha(b.fecha_emision)} />

              {/* Montos */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)", display: "flex", flexDirection: "column", gap: 5 }}>
                {exenta ? (
                  <MontoRow label="Exento" value={clp(b.monto_exento || b.monto_total)} />
                ) : (
                  <>
                    <MontoRow label="Neto" value={clp(b.monto_neto)} />
                    <MontoRow label="IVA (19%)" value={clp(b.iva)} />
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>Total</span>
                  <span style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{clp(b.monto_total)}</span>
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 9, color: "var(--text3)", textAlign: "center" }}>
                Vista previa · datos de la boleta. El documento oficial está en el PDF.
              </div>
            </div>
            )}

            {/* Footer: personalizada (primaria) + oficial SII */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              {persUrl && (
                <button
                  type="button"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = persUrl;
                    a.download = `boleta-${b.tipo_dte}-${b.folio}.pdf`;
                    document.body.appendChild(a); a.click(); a.remove();
                  }}
                  style={{ border: "none", cursor: "pointer", background: "var(--accent, #E8553E)", color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "8px 14px", borderRadius: 10 }}
                >
                  ⤓ Descargar personalizada
                </button>
              )}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text2)", fontWeight: 600 }}>{persUrl ? "PDF oficial del SII" : "Descargar PDF original"}</span>
                <DescargarBoletaButton id={id} />
              </span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", alignItems: "baseline" }}>
      <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, textAlign: "right" }}>
        {value}
        {sub && <span style={{ display: "block", fontSize: 9, color: "var(--text3)", fontWeight: 500 }}>{sub}</span>}
      </span>
    </div>
  );
}

function MontoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
      <span style={{ color: "var(--text3)" }}>{label}</span>
      <span style={{ color: "var(--text2)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}
