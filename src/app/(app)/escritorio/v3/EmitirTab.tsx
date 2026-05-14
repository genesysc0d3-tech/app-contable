"use client";

import { useState, useEffect, useCallback } from "react";
import { FileArrowUp } from "@phosphor-icons/react";
import FileUpload from "@/components/upload/FileUpload";
import type { QueuedFile } from "@/components/upload/FileUpload";
import DocumentList from "@/components/upload/DocumentList";
import { getDocumentosRecientes } from "@/lib/upload";
import type { DocumentoSubido } from "@/lib/upload";
import { useToast } from "@/components/Toast";
import { useAppStore } from "@/store/appStore";
import { TabCard } from "./TabHelpers";

export default function EmitirTab({ empresaId }: { empresaId: string }) {
  const cached = useAppStore((s) => s.documentos);
  const setStoreDocumentos = useAppStore((s) => s.setDocumentos);
  const [documentos, setDocumentos] = useState<DocumentoSubido[]>(cached.data ?? []);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const fetchDocs = useCallback(async () => {
    const docs = await getDocumentosRecientes(empresaId);
    setDocumentos(docs);
    setStoreDocumentos(docs);
  }, [empresaId, setStoreDocumentos]);

  useEffect(() => {
    if (!cached.data || !cached.isFresh()) fetchDocs();
  }, []);

  const handleFiles = useCallback(async (files: QueuedFile[]) => {
    setUploading(true);
    let ok = 0, err = 0;
    for (const f of files) {
      try {
        const buf = await f.file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const res = await fetch("/api/subir-procesar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: f.customName || f.file.name, base64, tipo: f.file.name.endsWith(".pdf") ? "pdf" : "excel" }),
        });
        const d = await res.json();
        if (d.ok) { ok++; fetchDocs(); }
        else { err++; toast(`Error: ${d.error ?? "desconocido"}`, "error"); }
      } catch { err++; toast(`Error con ${f.file.name}`, "error"); }
    }
    if (ok > 0) toast(`${ok} archivo${ok !== 1 ? "s" : ""} subido${ok !== 1 ? "s" : ""}`);
    setUploading(false);
  }, [empresaId, fetchDocs, toast]);

  const processing = documentos.some((d) => d.estado === "procesando" || d.estado === "subido");
  useEffect(() => {
    if (!processing) return;
    const id = setInterval(fetchDocs, 3000);
    return () => clearInterval(id);
  }, [processing, fetchDocs]);

  return (
    <div className="space-y-3">
      {/* Upload area */}
      <TabCard>
        {uploading ? (
          <div className="flex items-center gap-3 py-4 animate-pulse">
            <div className="w-8 h-8 rounded-lg bg-[var(--surface)]" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-32 rounded bg-[var(--surface)]" />
              <div className="h-2 w-48 rounded bg-[var(--surface)]" />
            </div>
          </div>
        ) : (
          <FileUpload onFilesQueued={handleFiles} />
        )}
      </TabCard>

      {/* Status + docs list */}
      {documentos.length > 0 && (
        <TabCard title={`Documentos (${documentos.length})`}>
          <DocumentList documentos={documentos} onDocumentoUpdate={fetchDocs} />
        </TabCard>
      )}

      {/* RCV mensual */}
      <TabCard>
        <RcvMini />
      </TabCard>
    </div>
  );
}

function fmtCLP(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

function RcvMini() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    totales: { docs: number; neto: number; exento: number; iva: number; total: number };
  } | null>(null);
  const mes = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/sii-mock/rcv?mes=${mes}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!cancel && d.ok) setData(d); })
      .catch(() => {})
      .finally(() => { cancel = true; });
    return () => { cancel = true; };
  }, [mes]);

  if (loading) return <div className="h-12 animate-shimmer rounded-lg" />;
  if (!data || data.totales.docs === 0) return <p className="text-xs text-[var(--muted-light)] text-center py-2">Sin emisiones este mes</p>;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium text-[var(--muted)]">{data.totales.docs} boletas en {mes}</p>
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Neto", val: data.totales.neto },
          { label: "IVA", val: data.totales.iva },
          { label: "Total", val: data.totales.total, bold: true },
        ].map(({ label, val, bold }) => (
          <div key={label} className="rounded-lg bg-[var(--surface)] px-2 py-1.5 text-center">
            <p className="text-[8px] text-[var(--muted-light)]">{label}</p>
            <p className={`text-[11px] tabular-nums ${bold ? "font-bold" : "font-medium"}`}>{fmtCLP(val)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
