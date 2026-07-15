"use client";

// Resiliencia del lote masivo: el motor corre 100% en el navegador (RPA). Si el
// usuario cierra la pestaña —o el SII congela el lote en una boleta "a medias"— a
// mitad de emitir, el loop JS muere. Esto persiste QUÉ FALTA por emitir para poder
// REANUDAR desde donde quedó.
//
// SEGURO contra doble emisión: al reanudar NO se re-corre una lista congelada. Se
// guardan solo los IDs de propuesta que faltan; al reabrir se RE-HIDRATAN contra la
// lista de pendientes del SERVIDOR (la fuente de verdad). Una boleta que ya se
// emitió salió de "pendientes" → no vuelve al lote. Residual conocido (ver M-1 de
// la auditoría): si la pestaña muere en los ~segundos entre "el SII dio folio" y
// "la app guardó la boleta", esa propuesta sigue figurando pendiente y podría
// re-incluirse. La red real ahí NO es el enlace por propuesta (el job expira a los
// 15 min), sino UNIQUE(empresa,tipo,folio) + el stash de 30 días de la extensión +
// la confirmación humana en la 2ª ventana. Es angosto pero no hermético.
//
// PRIVACIDAD: se guardan SOLO IDs de propuesta (UUID opacos), NUNCA receptor / RUT /
// nombre / email / teléfono de terceros. El receptor se re-hidrata del server al
// reabrir, que ya aplica la minimización por monto (135 UF, Res. 44/2025). Caduca a
// 24h en la lectura.

const KEY = (empresaId: string) => `massdte:lote-pendiente:${empresaId}`;
const MAX_EDAD_MS = 24 * 60 * 60 * 1000; // 24h

export interface LotePendiente {
  /** propuestaIds que faltan por emitir, en orden. */
  remainingIds: string[];
  /** total ORIGINAL del lote (para un banner honesto entre reanudaciones). */
  total: number;
  at: number; // Date.now() al persistir
}

/** Guarda qué falta del lote en curso (best-effort; un fallo no rompe la emisión). */
export function guardarLotePendiente(
  empresaId: string,
  data: { remainingIds: string[]; total: number },
): void {
  if (!empresaId || typeof window === "undefined") return;
  // Nada pendiente = nada que reanudar: limpiar en vez de guardar basura.
  if (!data.remainingIds.length) {
    limpiarLotePendiente(empresaId);
    return;
  }
  try {
    window.localStorage.setItem(
      KEY(empresaId),
      JSON.stringify({ remainingIds: data.remainingIds, total: data.total, at: Date.now() }),
    );
  } catch {
    /* localStorage lleno / bloqueado: la reanudación no es crítica */
  }
}

/** Lee un lote a medias reanudable (con IDs y no caducado). null si no hay. */
export function leerLotePendiente(empresaId: string): LotePendiente | null {
  if (!empresaId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY(empresaId));
    if (!raw) return null;
    const p = JSON.parse(raw) as LotePendiente;
    const valido =
      p &&
      Array.isArray(p.remainingIds) &&
      p.remainingIds.length > 0 &&
      p.remainingIds.every((x) => typeof x === "string") &&
      typeof p.total === "number" &&
      typeof p.at === "number" &&
      Date.now() - p.at < MAX_EDAD_MS;
    if (!valido) {
      limpiarLotePendiente(empresaId);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/** Borra el lote pendiente (al terminar, detener, descartar, o quedar vacío). */
export function limpiarLotePendiente(empresaId: string): void {
  if (!empresaId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY(empresaId));
  } catch {
    /* no-op */
  }
}
