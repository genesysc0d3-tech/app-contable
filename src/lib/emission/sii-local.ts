export const SII_LOCAL_BACKEND_BLOCK = {
  error: "SII_LOCAL_REQUIERE_EXTENSION",
  detalle: "La emisión SII local debe continuar en la ventana segura de e-Boleta.",
  status: 409,
} as const;

export function siiLocalBackendBlocked() {
  return SII_LOCAL_BACKEND_BLOCK;
}

export function siiLocalBatchBlocked(propuestaId: string) {
  return {
    propuesta_id: propuestaId,
    ok: false,
    error_code: SII_LOCAL_BACKEND_BLOCK.error,
    error_message: SII_LOCAL_BACKEND_BLOCK.detalle,
  } as const;
}
