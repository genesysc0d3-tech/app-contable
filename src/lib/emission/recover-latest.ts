// Recuperación del folio "a medias": pide al server que rescate el último resultado
// SII stasheado (sii_local_resultados, 24h) para este job y registre la boleta. Es
// la MISMA llamada que usa boleta única (persistLatestSiiPdf), extraída para que el
// modal del lote la reuse sin duplicar el contrato.
//
// Al registrar la boleta, el backend levanta la lápida (revision_pendiente →
// completed): la propuesta deja de estar bloqueada. Un 404 significa que no hay
// resultado stasheado → probablemente NO se emitió nada (pero el tombstone NO se
// levanta solo: conservador, para no habilitar un re-emit que podría duplicar).

export type RecoverLatestResult =
  | { estado: "recuperado"; folio: number | null; boletaId: string | null; already: boolean }
  | { estado: "sin_resultado" } // 404: no hay folio stasheado (probable "no se emitió nada")
  | { estado: "error"; mensaje: string };

/**
 * RESCATE MANUAL: el usuario leyó el folio en la ventana del SII y lo declara.
 * Es la salida cuando el RPA emitió de verdad pero no capturó la pantalla del
 * folio — el caso donde `recoverLatestFolio` responde "sin_resultado" pese a
 * existir el documento en el SII. El server exige que el intento tenga lápida
 * y deriva monto/tipo de la propuesta: el humano aporta el número, no la plata.
 */
export async function registrarFolioAMano(jobId: string | null, folio: number): Promise<RecoverLatestResult> {
  try {
    const res = await fetch("/api/sii-local/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, registrar_folio_manual: folio }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok) {
      return {
        estado: "recuperado",
        folio: typeof json.folio === "number" ? json.folio : folio,
        boletaId: json.boleta_id ?? null,
        already: Boolean(json.already_exists),
      };
    }
    return { estado: "error", mensaje: json?.detalle ?? json?.error ?? "No se pudo registrar el folio." };
  } catch {
    return { estado: "error", mensaje: "Error de red al registrar el folio." };
  }
}

export async function recoverLatestFolio(jobId: string | null): Promise<RecoverLatestResult> {
  try {
    const res = await fetch("/api/sii-local/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, recover_latest: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok) {
      return {
        estado: "recuperado",
        folio: typeof json.folio === "number" ? json.folio : null,
        boletaId: json.boleta_id ?? null,
        already: Boolean(json.already_exists),
      };
    }
    if (res.status === 404 || json?.error === "SIN_RESULTADO_SII_RECUPERABLE") {
      return { estado: "sin_resultado" };
    }
    return { estado: "error", mensaje: json?.detalle ?? json?.error ?? "No se pudo recuperar el folio." };
  } catch {
    return { estado: "error", mensaje: "Error de red al recuperar el folio." };
  }
}
