"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import FileUpload from "@/components/upload/FileUpload";
import type { QueuedFile } from "@/components/upload/FileUpload";
import DocumentList from "@/components/upload/DocumentList";
import { getDocumentosRecientes, uploadDocumento } from "@/lib/upload";
import type { DocumentoSubido } from "@/lib/upload";
import { useToast } from "@/components/Toast";

interface SubirClientProps {
  empresaId: string;
}

export default function SubirClient({ empresaId }: SubirClientProps) {
  const [documentos, setDocumentos] = useState<DocumentoSubido[]>([]);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const fetchDocumentos = useCallback(async () => {
    const docs = await getDocumentosRecientes(empresaId);
    setDocumentos(docs);
  }, [empresaId]);

  useEffect(() => { fetchDocumentos(); }, [fetchDocumentos]);

  useEffect(() => {
    const channel = supabase
      .channel("documentos-realtime")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "documentos_subidos", filter: `empresa_id=eq.${empresaId}` },
        (payload) => {
          const updated = payload.new as DocumentoSubido;
          setDocumentos((prev) => prev.map((doc) => (doc.id === updated.id ? updated : doc)));
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "documentos_subidos", filter: `empresa_id=eq.${empresaId}` },
        (payload) => {
          const inserted = payload.new as DocumentoSubido;
          setDocumentos((prev) => {
            const exists = prev.some((d) => d.id === inserted.id);
            return exists ? prev : [inserted, ...prev];
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [empresaId]);

  const handleFilesQueued = useCallback(async (files: QueuedFile[]) => {
    setUploading(true);

    // Separate into groups: grandes (each alone) and grouped by badge number
    const grandes = files.filter((f) => f.category === "grande");
    const grouped = new Map<number, QueuedFile[]>();

    for (const f of files) {
      if (f.category === "grande") continue;
      const existing = grouped.get(f.group) ?? [];
      existing.push(f);
      grouped.set(f.group, existing);
    }

    // Process grandes individually
    for (const f of grandes) {
      const result = await uploadDocumento(f.file, empresaId);
      if (result.success && result.documento) {
        setDocumentos((prev) => {
          const exists = prev.some((d) => d.id === result.documento!.id);
          return exists ? prev : [result.documento!, ...prev];
        });
        fetch("/api/procesar-documento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documento_id: result.documento.id }),
        }).catch(() => {});
      }
    }

    // Process groups
    for (const [, groupFiles] of grouped) {
      const allImages = groupFiles.every((f) => f.category === "imagen");
      const groupName = groupFiles[0]?.customName || "Grupo";

      if (allImages && groupFiles.length > 1) {
        // Upload all images, then process as grouped OCR
        const uploadedPaths: { path: string; mime: string; name: string }[] = [];
        let firstDocId: string | null = null;

        for (const f of groupFiles) {
          const result = await uploadDocumento(f.file, empresaId);
          if (result.success && result.documento) {
            if (!firstDocId) {
              firstDocId = result.documento.id;
              // Update the document name to the group name
              await supabase.from("documentos_subidos")
                .update({ nombre_archivo: groupName })
                .eq("id", result.documento.id);
              setDocumentos((prev) => {
                const exists = prev.some((d) => d.id === result.documento!.id);
                const updated = { ...result.documento!, nombre_archivo: groupName };
                return exists ? prev : [updated, ...prev];
              });
            }
            uploadedPaths.push({
              path: result.documento.storage_path,
              mime: f.file.type,
              name: f.file.name,
            });
          }
        }

        if (firstDocId && uploadedPaths.length > 0) {
          fetch("/api/procesar-documento", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              documento_id: firstDocId,
              grouped_images: uploadedPaths,
            }),
          }).catch(() => {});
        }
      } else {
        // Non-image group or single file: upload and process each
        for (const f of groupFiles) {
          const result = await uploadDocumento(f.file, empresaId);
          if (result.success && result.documento) {
            if (f.customName !== f.file.name.replace(/\.[^.]+$/, "")) {
              await supabase.from("documentos_subidos")
                .update({ nombre_archivo: f.customName })
                .eq("id", result.documento.id);
            }
            setDocumentos((prev) => {
              const exists = prev.some((d) => d.id === result.documento!.id);
              return exists ? prev : [result.documento!, ...prev];
            });
            fetch("/api/procesar-documento", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ documento_id: result.documento.id }),
            }).catch(() => {});
          }
        }
      }
    }

    toast(`${files.length} archivo${files.length !== 1 ? "s" : ""} subido${files.length !== 1 ? "s" : ""}`);
    setUploading(false);
  }, [empresaId, toast]);

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
