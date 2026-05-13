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

  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-[28px] font-extrabold text-[var(--foreground)]">Subir documentos</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Cartolas, boletas, screenshots o chats</p>
        </div>

        {uploading ? (
          <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none p-8 text-center animate-pulse">
            <p className="text-sm text-[var(--muted)]">Subiendo archivos...</p>
          </div>
        ) : (
          <FileUpload onFilesQueued={handleFilesQueued} />
        )}

        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">Historial</h2>
          <DocumentList documentos={documentos} onDocumentoUpdate={fetchDocumentos} />
        </div>
      </div>
    </div>
  );
}
