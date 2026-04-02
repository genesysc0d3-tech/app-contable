"use client";

import { useState, useEffect, useCallback } from "react";
import FileUpload from "@/components/upload/FileUpload";
import DocumentList from "@/components/upload/DocumentList";
import { getDocumentosRecientes } from "@/lib/upload";
import type { DocumentoSubido, UploadResult } from "@/lib/upload";

// TODO: obtener desde sesión del usuario autenticado
const EMPRESA_ID_PLACEHOLDER = "demo";

export default function SubirPage() {
  const [documentos, setDocumentos] = useState<DocumentoSubido[]>([]);

  const fetchDocumentos = useCallback(async () => {
    const docs = await getDocumentosRecientes(EMPRESA_ID_PLACEHOLDER);
    setDocumentos(docs);
  }, []);

  useEffect(() => {
    fetchDocumentos();
  }, [fetchDocumentos]);

  const handleUploadComplete = useCallback(
    (result: UploadResult) => {
      if (result.success) {
        fetchDocumentos();
      }
    },
    [fetchDocumentos]
  );

  return (
    <div className="flex-1 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Subir documentos</h1>
          <p className="text-sm text-white/50 mt-1">
            Cartolas, boletas, screenshots o chats
          </p>
        </div>

        {/* Upload */}
        <FileUpload
          empresaId={EMPRESA_ID_PLACEHOLDER}
          onUploadComplete={handleUploadComplete}
        />

        {/* Historial */}
        <div>
          <h2 className="text-lg font-semibold text-white/90 mb-3">
            Historial
          </h2>
          <DocumentList documentos={documentos} />
        </div>
      </div>
    </div>
  );
}
