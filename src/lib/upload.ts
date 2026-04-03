import { supabase } from "./supabase";
import type { Tables } from "./database.types";

export type DocumentoSubido = Tables<"documentos_subidos">;

type TipoDocumento = "excel" | "imagen" | "pdf" | "whatsapp" | "csv";

const MIME_TO_TIPO: Record<string, TipoDocumento> = {
  "image/jpeg": "imagen",
  "image/png": "imagen",
  "image/webp": "imagen",
  "image/heic": "imagen",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "text/csv": "csv",
  "text/plain": "whatsapp",
};

const ACCEPTED_MIME_TYPES = Object.keys(MIME_TO_TIPO);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return `Tipo de archivo no soportado: ${file.type || "desconocido"}`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `El archivo excede el límite de 50MB`;
  }
  return null;
}

export function getAcceptString(): string {
  return ACCEPTED_MIME_TYPES.join(",");
}

function detectTipo(file: File): TipoDocumento {
  return MIME_TO_TIPO[file.type] ?? "pdf";
}

export interface UploadResult {
  success: boolean;
  documento?: DocumentoSubido;
  error?: string;
}

export async function uploadDocumento(
  file: File,
  empresaId: string
): Promise<UploadResult> {
  const validationError = validateFile(file);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${empresaId}/${timestamp}_${safeName}`;

  // 1. Subir archivo a Storage
  const { error: storageError } = await supabase.storage
    .from("documentos")
    .upload(storagePath, file);

  if (storageError) {
    return { success: false, error: `Error subiendo archivo: ${storageError.message}` };
  }

  // 2. Crear registro en documentos_subidos
  const { data, error: dbError } = await supabase
    .from("documentos_subidos")
    .insert({
      empresa_id: empresaId,
      tipo: detectTipo(file),
      nombre_archivo: file.name,
      storage_path: storagePath,
      estado: "subido",
    })
    .select()
    .single();

  if (dbError) {
    // Rollback: eliminar archivo de storage si falla el registro
    await supabase.storage.from("documentos").remove([storagePath]);
    return { success: false, error: `Error registrando documento: ${dbError.message}` };
  }

  return { success: true, documento: data };
}

export async function getDocumentosRecientes(
  empresaId: string,
  limit = 20
): Promise<DocumentoSubido[]> {
  const { data } = await supabase
    .from("documentos_subidos")
    .select()
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}
