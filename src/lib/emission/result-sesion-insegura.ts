// /api/sii-local/result con SESIÓN INSEGURA (inactividad vencida o MFA pendiente).
// (2026-09-28, revisión del guard de rutas excluidas del proxy)
//
// Dos cosas que no pueden pasar a la vez:
//   · "Nunca se pierde un folio": la boleta ya existe en el SII. Si la captura de la
//     extensión recibiera 401, la única copia quedaría en su stash local
//     (chrome.storage.local, best-effort, tope de 12 reentregas).
//   · Una sesión aal1 (contraseña robada, sin 2º factor) NO puede escribir libros:
//     con {job_id propio cerrado, result:{folio, folio_confidence:"high"…}} la red
//     "job cerrado" de la ruta lo daría de alta como boleta → libros/F29 corruptos.
//
// Salida: con sesión insegura la captura va SOLO al stash del servidor
// (sii_local_resultados, status "sesion_insegura") y se responde ok para que la
// extensión suelte su copia local — el folio vive en el servidor. NO se escribe
// ninguna boleta. Tras completar el MFA, "Recuperar folio" (recover_latest) lo
// promueve con todos los gates normales. Mientras la sesión siga insegura,
// recover_latest y las declaraciones humanas se bloquean (401).
// Usuarios SIN MFA con sesión al día nunca llegan acá: su sesión es segura.

export const STATUS_SESION_INSEGURA = "sesion_insegura";

export type PoliticaResultInseguro = "bloquear" | "solo_stash";

export function politicaResultSesionInsegura(payload: {
  registrar_folio_manual?: unknown;
  declarar_no_salio?: unknown;
  recover_latest?: unknown;
  result?: unknown;
  veredicto_verificacion?: unknown;
}): PoliticaResultInseguro {
  // Veredicto de una verificación (no salió): devuelve boletas a Listas → sesión segura.
  if (payload.veredicto_verificacion != null) return "bloquear";
  // Declaraciones humanas: el humano reintenta tras el MFA; nada que perder.
  if (payload.registrar_folio_manual != null || payload.declarar_no_salio === true) return "bloquear";
  // Promover el stash a boleta ES escribir libros: solo con sesión segura.
  if (payload.recover_latest === true) return "bloquear";
  if (payload.result == null || typeof payload.result !== "object") return "bloquear";
  // El formulario humano de EmitirDirectaView ("folio visible confirmado por el
  // usuario", monto tecleado) no es una captura del RPA: no hay folio que perder
  // (el humano lo tiene en pantalla) y no debe poder plantarse en el stash.
  const ev = (payload.result as { folio_evidence?: unknown }).folio_evidence;
  if (ev && typeof ev === "object" && (ev as { source?: unknown }).source === "manual_visible_receipt") return "bloquear";
  return "solo_stash";
}

/**
 * recover_latest: de las filas del stash (más reciente primero), prefiere una
 * capturada con sesión SEGURA; solo si no hay ninguna usa la de sesión insegura
 * (la que dejó una captura real mientras faltaba el MFA). Así una fila plantada
 * por una sesión aal1 no le gana a la captura legítima del mismo job.
 */
export function elegirResultadoRecuperable<T extends { status?: string | null; result?: unknown; job_id?: string | null }>(filas: T[] | null | undefined): T | undefined {
  const validas = (filas ?? []).filter((f) => f.result != null && typeof f.result === "object");
  if (validas.length === 0) return undefined;
  // Sin job_id pedido, las filas pueden ser de VARIOS jobs: primero se fija el job de
  // la fila más reciente y recién ahí se prefiere la segura DENTRO de ese job. Si no,
  // una segura vieja de otro job ganaba ("ya estaba") y el folio nuevo nunca se
  // registraba (revisión final 2026-09-28, I2).
  const job = validas[0].job_id ?? null;
  const delJob = validas.filter((f) => (f.job_id ?? null) === job);
  return delJob.find((f) => f.status !== STATUS_SESION_INSEGURA) ?? delJob[0];
}
