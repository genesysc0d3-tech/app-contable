"use client";

import { useState } from "react";
import { Eye } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { generarBoletaPDF, type BoletaPDFData } from "@/lib/pdf/boleta-pdf";
import { getBaseApiPdf, openBaseApiPdf } from "@/lib/pdf/baseapi-pdf";

interface BoletaRaw {
  folio: number;
  tipo_dte: number;
  fecha_emision: string;
  emisor_rut: string;
  emisor_razon_social: string;
  emisor_giro: string | null;
  emisor_direccion: string | null;
  emisor_comuna: string | null;
  receptor_rut: string | null;
  receptor_razon_social: string | null;
  receptor_direccion: string | null;
  receptor_comuna: string | null;
  monto_neto: number;
  monto_exento: number;
  iva: number;
  monto_total: number;
  detalles: { nombre?: string; cantidad?: number; precio_unitario?: number; monto?: number }[];
  ted: string;
  track_id: string;
  estado: string;
  emision_proveedor?: "mock" | "baseapi" | "sii_local";
  emision_sandbox?: boolean;
  proveedor_respuesta?: unknown;
}

export default function VerBoletaButton({ id }: { id: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function visualizar(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/intermediaria/boleta/${id}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        toast(j.error ?? "Error al cargar la boleta", "error");
        return;
      }
      const b = j.boleta as BoletaRaw;
      if (b.emision_proveedor === "sii_local") {
        const pdfRes = await fetch(`/api/intermediaria/boleta/${id}/pdf`, { cache: "no-store" });
        if (!pdfRes.ok) {
          const error = await pdfRes.json().catch(() => ({ error: "PDF_NO_DISPONIBLE" }));
          toast(error.error ?? "PDF SII no disponible en la app", "error");
          return;
        }
        const blob = await pdfRes.blob();
        const url = window.URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
        return;
      }

      if (b.emision_proveedor === "baseapi") {
        const pdf = getBaseApiPdf(b.proveedor_respuesta);
        if (!pdf) {
          toast("Esta emision de proveedor legado no tiene PDF guardado.", "error");
          return;
        }
        openBaseApiPdf(pdf);
        return;
      }

      const data: BoletaPDFData = {
        folio: b.folio,
        tipo_dte: b.tipo_dte,
        fecha_emision: b.fecha_emision,
        emisor: {
          rut: b.emisor_rut,
          razon_social: b.emisor_razon_social,
          giro: b.emisor_giro,
          direccion: b.emisor_direccion,
          comuna: b.emisor_comuna,
        },
        receptor: b.receptor_rut || b.receptor_razon_social
          ? {
              rut: b.receptor_rut,
              razon_social: b.receptor_razon_social,
              direccion: b.receptor_direccion,
              comuna: b.receptor_comuna,
            }
          : undefined,
        detalles: (Array.isArray(b.detalles) ? b.detalles : []).map((d) => ({
          nombre: d.nombre ?? "Item",
          cantidad: d.cantidad,
          precio: d.precio_unitario,
          monto: d.monto ?? 0,
        })),
        totales: {
          neto: b.monto_neto,
          exento: b.monto_exento,
          iva: b.iva,
          total: b.monto_total,
        },
        ted: b.ted,
        track_id: b.track_id,
        estado: b.estado,
        emision_proveedor: b.emision_proveedor === "mock" ? "mock" : undefined,
        emision_sandbox: b.emision_sandbox,
      };
      await generarBoletaPDF(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error al generar PDF", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={visualizar}
      disabled={loading}
      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[#E8553E] hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors"
      title="Ver PDF"
      aria-label="Ver PDF"
    >
      <Eye size={14} weight="bold" className={loading ? "animate-pulse" : ""} />
    </button>
  );
}
