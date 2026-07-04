export interface BaseApiPdfPayload {
  filename?: string;
  content_type?: string;
  base64?: string;
}

export function getBaseApiPdf(proveedorRespuesta: unknown): BaseApiPdfPayload | null {
  if (!proveedorRespuesta || typeof proveedorRespuesta !== "object") return null;
  const data = proveedorRespuesta as { pdf?: unknown };
  const pdf = data.pdf;

  if (typeof pdf === "string" && pdf.trim()) {
    return { base64: pdf.trim(), content_type: "application/pdf", filename: "baseapi-dte.pdf" };
  }

  if (!pdf || typeof pdf !== "object") return null;
  const payload = pdf as BaseApiPdfPayload;
  if (!payload.base64) return null;
  return payload;
}

export function base64ToPdfBlob(base64: string): Blob {
  const clean = base64.includes(",") ? base64.split(",").pop() ?? "" : base64;
  const binary = window.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

export function downloadBaseApiPdf(pdf: BaseApiPdfPayload, fallbackName: string) {
  if (!pdf.base64) throw new Error("PDF BaseAPI no disponible");
  const blob = base64ToPdfBlob(pdf.base64);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pdf.filename || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export function openBaseApiPdf(pdf: BaseApiPdfPayload) {
  if (!pdf.base64) throw new Error("PDF BaseAPI no disponible");
  const blob = base64ToPdfBlob(pdf.base64);
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
}
