"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import FileUpload from "@/components/upload/FileUpload";
import type { QueuedFile } from "@/components/upload/FileUpload";
import DocumentList from "@/components/upload/DocumentList";
import { getDocumentosRecientes } from "@/lib/upload";
import type { DocumentoSubido } from "@/lib/upload";
import { useToast } from "@/components/Toast";
import { useAppStore } from "@/store/appStore";
import { DownloadSimple, CaretDown, Receipt, ArrowClockwise } from "@phosphor-icons/react";

interface SubirClientProps {
  empresaId: string;
}

export default function SubirClient({ empresaId }: SubirClientProps) {
  const cached = useAppStore((s) => s.documentos);
  const setStoreDocumentos = useAppStore((s) => s.setDocumentos);
  const updateStoreDoc = useAppStore((s) => s.updateDocumento);
  const addStoreDoc = useAppStore((s) => s.addDocumento);

  const [documentos, setDocumentos] = useState<DocumentoSubido[]>(cached.data ?? []);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const fetchDocumentos = useCallback(async () => {
    const docs = await getDocumentosRecientes(empresaId);
    setDocumentos(docs);
    setStoreDocumentos(docs);
  }, [empresaId, setStoreDocumentos]);

  // On mount, fetch from server if cache is stale. When cache is fresh we
  // already seeded `documentos` from the initial useState — no setState needed.
  useEffect(() => {
    if (!cached.data || !cached.isFresh()) {
      fetchDocumentos();
    }
    // Intentional: we only want this to run on mount, cached is a snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("documentos-realtime")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "documentos_subidos", filter: `empresa_id=eq.${empresaId}` },
        (payload) => {
          const updated = payload.new as DocumentoSubido;
          setDocumentos((prev) => prev.map((doc) => (doc.id === updated.id ? updated : doc)));
          updateStoreDoc(updated);
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "documentos_subidos", filter: `empresa_id=eq.${empresaId}` },
        (payload) => {
          const inserted = payload.new as DocumentoSubido;
          addStoreDoc(inserted);
          setDocumentos((prev) => {
            const exists = prev.some((d) => d.id === inserted.id);
            return exists ? prev : [inserted, ...prev];
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // Zustand store actions are stable references across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  // Backup polling + focus refetch in case realtime misses the final UPDATE.
  // Only runs while at least one doc is being processed — zero cost otherwise.
  const hasProcessing = documentos.some(
    (d) => d.estado === "procesando" || d.estado === "subido"
  );
  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(() => {
      fetchDocumentos();
    }, 3000);
    return () => clearInterval(interval);
  }, [hasProcessing, fetchDocumentos]);

  useEffect(() => {
    const onFocus = () => fetchDocumentos();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchDocumentos]);

  const handleFilesQueued = useCallback(async (files: QueuedFile[]) => {
    setUploading(true);
    let subidos = 0;
    let errores = 0;

    for (const f of files) {
      try {
        // Read file as base64
        const arrayBuf = await f.file.arrayBuffer();
        const base64 = Buffer.from(arrayBuf).toString("base64");

        const res = await fetch("/api/subir-procesar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: f.customName || f.file.name,
            base64,
            tipo: f.file.name.endsWith(".pdf") ? "pdf" : "excel",
          }),
        });

        const data = await res.json();
        if (data.ok) {
          subidos++;
          fetchDocumentos();
        } else {
          errores++;
          toast(`Error: ${data.error ?? "desconocido"}`, "error");
        }
      } catch {
        errores++;
        toast(`Error procesando ${f.file.name}`, "error");
      }
    }

    const totalOk = subidos > 0 ? `${subidos} procesado${subidos !== 1 ? "s" : ""}` : "";
    const totalErr = errores > 0 ? `${errores} con error` : "";
    toast([totalOk, totalErr].filter(Boolean).join(", "));
    setUploading(false);
  }, [empresaId, fetchDocumentos, toast]);

  const [historialAbierto, setHistorialAbierto] = useState(false);

  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold text-[var(--foreground)]">Emitir</h1>
            <p className="text-sm text-[var(--muted)] mt-1">Subí cartolas o el Excel modelo para emitir</p>
          </div>
          <button onClick={() => {
            const a = document.createElement("a");
            a.href = "/api/generar-template";
            a.download = "plantilla-boletas.xlsx";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }}
            className="btn-press flex items-center gap-1.5 rounded-xl bg-white dark:bg-white/5 border border-[var(--border)] hover:bg-[var(--accent-light)] px-3 py-2 text-[11px] font-medium text-[var(--foreground)] transition-all duration-150 shrink-0 cursor-pointer">
            <DownloadSimple size={14} weight="bold" className="text-[#E8553E]" />
            Plantilla Excel
          </button>
        </div>

        {uploading ? (
          <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none p-8 text-center animate-pulse">
            <p className="text-sm text-[var(--muted)]">Subiendo archivos...</p>
          </div>
        ) : (
          <FileUpload onFilesQueued={handleFilesQueued} />
        )}

        {/* RCV - Resumen mensual siempre visible */}
        <ResumenMensual />

        {/* Historial colapsable */}
        <div>
          <button onClick={() => setHistorialAbierto(!historialAbierto)}
            className="w-full flex items-center justify-between text-left">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Historial
              {documentos.length > 0 && (
                <span className="text-sm font-normal text-[var(--muted-light)] ml-2">
                  ({documentos.length} documento{documentos.length !== 1 ? "s" : ""})
                </span>
              )}
            </h2>
            <CaretDown size={16} className={`text-[var(--muted)] transition-transform ${historialAbierto ? "rotate-180" : ""}`} />
          </button>
          {historialAbierto && (
            <div className="mt-3">
              <DocumentList documentos={documentos} onDocumentoUpdate={fetchDocumentos} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- RCV: resumen mensual de boletas emitidas ---

function fmtCLP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

interface RCVRow {
  id: string; tipo_dte: number; folio: number; fecha_emision: string;
  receptor_rut: string | null; receptor_razon_social: string | null;
  monto_neto: number; monto_exento: number; iva: number; monto_total: number; estado: string;
}

function ResumenMensual() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    totales: { docs: number; neto: number; exento: number; iva: number; total: number };
    resumen_por_tipo: Record<string, { docs: number; neto: number; exento: number; iva: number; total: number }>;
    detalle: RCVRow[];
  } | null>(null);
  const [expandido, setExpandido] = useState(false);

  const mes = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sii-mock/rcv?mes=${mes}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.ok) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mes]);

  return (
    <div className="rounded-[20px] bg-[var(--surface)] shadow-[var(--card-shadow)] dark:shadow-none p-4">
      <div className="flex items-center gap-2 mb-3">
        <Receipt size={16} weight="fill" className="text-[#E8553E]" />
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Registro de Ventas</h2>
        <span className="text-[10px] text-[var(--muted-light)] font-medium">{mes}</span>
      </div>

      {loading ? (
        <div className="flex gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 animate-shimmer h-12 rounded-xl bg-[var(--surface)]" />
          ))}
        </div>
      ) : data && data.totales.docs > 0 ? (
        <>
          <p className="text-[11px] font-medium text-[var(--foreground)] mb-3">
            {data.totales.docs} boleta{data.totales.docs !== 1 ? "s" : ""} emitida{data.totales.docs !== 1 ? "s" : ""} este mes
          </p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Neto", val: data.totales.neto },
              { label: "IVA", val: data.totales.iva },
              { label: "Exento", val: data.totales.exento },
              { label: "Total", val: data.totales.total, bold: true },
            ].map(({ label, val, bold }) => (
              <div key={label} className="rounded-xl bg-[var(--surface)] px-2 py-2 text-center">
                <p className="text-[9px] text-[var(--muted-light)]">{label}</p>
                <p className={`text-[13px] tabular-nums ${bold ? "font-bold text-[var(--foreground)]" : "font-medium text-[var(--foreground)]"}`}>
                  {fmtCLP(val)}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--muted-light)] text-center py-3">
          No hay boletas emitidas este mes
        </p>
      )}
    </div>
  );
}
