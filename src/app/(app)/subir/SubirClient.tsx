"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import FileUpload from "@/components/upload/FileUpload";
import DocumentList from "@/components/upload/DocumentList";
import { getDocumentosRecientes } from "@/lib/upload";
import type { DocumentoSubido, UploadResult } from "@/lib/upload";

interface SubirClientProps {
  empresaId: string;
}

export default function SubirClient({ empresaId }: SubirClientProps) {
  const [documentos, setDocumentos] = useState<DocumentoSubido[]>([]);

  const fetchDocumentos = useCallback(async () => {
    const docs = await getDocumentosRecientes(empresaId);
    setDocumentos(docs);
  }, [empresaId]);

  useEffect(() => {
    fetchDocumentos();
  }, [fetchDocumentos]);

  useEffect(() => {
    const channel = supabase
      .channel("documentos-realtime")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "documentos_subidos",
          filter: `empresa_id=eq.${empresaId}`,
        },
        (payload) => {
          const updated = payload.new as DocumentoSubido;
          setDocumentos((prev) =>
            prev.map((doc) => (doc.id === updated.id ? updated : doc))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "documentos_subidos",
          filter: `empresa_id=eq.${empresaId}`,
        },
        (payload) => {
          const inserted = payload.new as DocumentoSubido;
          setDocumentos((prev) => [inserted, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [empresaId]);

  const handleUploadComplete = useCallback(
    (result: UploadResult) => {
      if (result.success && result.documento) {
        setDocumentos((prev) => {
          const exists = prev.some((d) => d.id === result.documento!.id);
          return exists ? prev : [result.documento!, ...prev];
        });
      }
    },
    []
  );

  return (
    <div className="flex-1 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111]">Subir documentos</h1>
          <p className="text-sm text-[#888] mt-1">
            Cartolas, boletas, screenshots o chats
          </p>
        </div>

        <FileUpload
          empresaId={empresaId}
          onUploadComplete={handleUploadComplete}
        />

        <div>
          <h2 className="text-lg font-semibold text-[#111] mb-3">
            Historial
          </h2>
          <DocumentList documentos={documentos} />
        </div>
      </div>
    </div>
  );
}
