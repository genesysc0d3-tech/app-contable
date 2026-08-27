"use strict";

import { EXTENSION_VERSION, baseMessage, isAllowedAppUrl, versionBajoObjetivo } from "./modules/core.js";
import { SII_CAPABILITIES, SII_START_URL, isAllowedSiiUrl, validateSiiBoletaJob } from "./modules/sii-local.js";
import { FACT_AUTO_EMIT_READY, FACT_CAPABILITIES, validateSiiFacturaJob } from "./modules/facturas-portal.js";
import { SII_VAULT_CAPABILITIES, getUnlockedSiiCredentials, handleSiiVaultMessage, rememberAppOrigin, siiVaultStatus, wipeLocalVault } from "./modules/sii-vault.js";
import { SIMPLEAPI_CAPABILITIES, emitSimpleApiDteFromVault, generateSimpleApiDteFromVault, handleSimpleApiVaultMessage, postSimpleApiMultipartProxy } from "./modules/simpleapi-vault.js";

// Las capabilities de FACTURAS solo se anuncian cuando el fillAndEmit del
// portal existe (fase 3): la app gatea el carril por el PONG, así que anunciar
// antes de tiempo dejaría a un usuario emitiendo contra un worker que no está.
const CAPABILITIES = [
  ...SII_CAPABILITIES,
  ...(FACT_AUTO_EMIT_READY ? FACT_CAPABILITIES : []),
  ...SII_VAULT_CAPABILITIES,
  ...SIMPLEAPI_CAPABILITIES,
];

const activeJobs = new Map();

// ===== Auto-actualización silenciosa (estilo Chrome/VS Code) =====
// Gatillo por USO, no por reloj: cada vez que la app le habla a la extensión
// (el PING que ya existe) se le pide a Chrome un chequeo inmediato, con freno
// de 10 min para no abusar (Chrome además throttlea el suyo). Mientras el
// cliente sube su cartola y emite, la versión nueva se descarga por detrás y
// se aplica con runtime.reload() — JAMÁS a mitad de una emisión: con jobs
// activos se posterga y se reintenta al cerrar cada job. El usuario no ve nada.
// Sin app abierta no hay pings, pero tampoco urgencia: el ciclo ~5h de Chrome
// sigue corriendo solo. (Sin permiso 'alarms': puro event-driven.)
const UPDATE_CHECK_FRENO_MS = 10 * 60 * 1000;
let updateListo = false;
let ultimoUpdateCheck = 0;

function aplicarUpdateSiOcioso() {
  if (!updateListo) return;
  if (activeJobs.size > 0) return; // emisión en curso: ni tocarla
  chrome.runtime.reload();
}

chrome.runtime.onUpdateAvailable.addListener(() => {
  updateListo = true;
  aplicarUpdateSiOcioso();
});

function maybeCheckUpdate() {
  const ahora = Date.now();
  if (ahora - ultimoUpdateCheck < UPDATE_CHECK_FRENO_MS) return;
  ultimoUpdateCheck = ahora;
  try {
    chrome.runtime.requestUpdateCheck((status) => {
      void chrome.runtime.lastError;
      // El estado también llega por onUpdateAvailable; esto cubre el caso en que
      // el service worker durmió y perdió el flag (updateListo no persiste).
      if (status === "update_available") {
        updateListo = true;
        aplicarUpdateSiOcioso();
      }
    });
  } catch {
    // requestUpdateCheck no disponible: el ciclo normal ~5h de Chrome manda.
  }
}

// Al INSTALAR la extensión, Chrome NO inyecta el content script (app-bridge.js) en
// las pestañas que ya estaban abiertas → la app se queda en "extensión no detectada"
// hasta que el usuario recargue a mano. En una instalación NUEVA recargamos las
// pestañas de la app para que el puente se inyecte y la app la reconozca sola (el
// "que se recargue sola"). En 'update' NO recargamos: el usuario podría estar
// trabajando y perdería el estado; para ese caso la app re-chequea sola por polling
// (useExtensionStatus). El host_permission de la app habilita tabs.query/reload.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install" && details.reason !== "update") return;
  chrome.tabs.query(
    { url: ["https://app.massdte.cl/*", "https://app-contable-five.vercel.app/*", "http://localhost/*", "http://127.0.0.1/*"] },
    (tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        if (details.reason === "install") {
          // Instalación nueva: recarga completa (la pestaña nunca tuvo puente).
          chrome.tabs.reload(tab.id).catch(() => {});
        } else {
          // AUTO-UPDATE silencioso: el puente viejo murió con la extensión —
          // re-INYECTAR (no recargar: el cliente no pierde lo que estaba
          // haciendo). Al próximo ping de la app, todo sigue como si nada.
          chrome.scripting
            .executeScript({ target: { tabId: tab.id }, files: ["app-bridge.js"] })
            .catch(() => {});
        }
      }
    },
  );
});

function statusMessage(jobId, status, message, recoverable = true) {
  return baseMessage({
    type: "APP_CONTABLE_SII_JOB_STATUS",
    job_id: jobId,
    status,
    message,
    recoverable,
  });
}

function resultMessage(jobId, result, message = "Resultado SII capturado.") {
  return baseMessage({
    type: "APP_CONTABLE_SII_JOB_RESULT",
    job_id: jobId,
    status: "emitted",
    message,
    result,
  });
}

function captureDebugMessage(jobId, result, message = "Captura SII sin folio confirmado.") {
  return baseMessage({
    type: "APP_CONTABLE_SII_CAPTURE_DEBUG",
    job_id: jobId,
    status: "result_needs_review",
    message,
    result,
  });
}

function hasStrongFolioEvidence(result) {
  return Boolean(
    result?.folio &&
    result.folio_confidence === "high" &&
    result.folio_evidence?.source,
  );
}

function hasCapturedPdf(result) {
  return Boolean(
    result?.pdf?.base64 &&
    result.pdf.content_type === "application/pdf" &&
    // fact_portal_pdf = facturas: el worker lo fetchea de mipeDisplayPDF.cgi
    // en la propia página de éxito (2026-08-27, folio 964).
    (result.pdf.source === "extension_session_fetch" || result.pdf.source === "share_capture" || result.pdf.source === "fact_portal_pdf"),
  );
}

function extractPdfUrl(result) {
  const links = Array.isArray(result?.artifact_links) ? result.artifact_links : [];
  for (const link of links) {
    const href = String(link?.href || "");
    if (!href) continue;
    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      decoded = href;
    }
    const match = decoded.match(/https:\/\/[^\s"']+\.pdf(?:\?[^\s"']*)?/i);
    if (match?.[0]) return match[0];
    if (/\.pdf(?:\?|$)/i.test(href)) return href;
  }
  return null;
}

function pdfFilename(pdfUrl, result) {
  try {
    const pathname = new URL(pdfUrl).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    if (name && /\.pdf$/i.test(name)) return name;
  } catch {
    // Fall through to the deterministic filename.
  }
  return `boleta-sii-${result?.tipo_dte || "dte"}-${result?.folio || "folio"}.pdf`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function capturePdfBytes(result) {
  if (hasCapturedPdf(result)) return result.pdf;
  const pdfUrl = extractPdfUrl(result);
  if (!pdfUrl) return null;

  const response = await fetch(pdfUrl, { cache: "no-store", credentials: "include" });
  if (!response.ok) throw new Error(`PDF_FETCH_${response.status}`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error("PDF_INVALID");
  }
  if (bytes.length > 8 * 1024 * 1024) throw new Error("PDF_TOO_LARGE");

  return {
    source: "extension_session_fetch",
    base64: arrayBufferToBase64(buffer),
    content_type: "application/pdf",
    filename: pdfFilename(pdfUrl, result),
    size: bytes.length,
    source_url: pdfUrl,
  };
}

async function handleCapturedResult(state, result) {
  // PRINCIPIO DE CONFIANZA: el folio con evidencia fuerte ES la prueba de que
  // el SII emitió la boleta. Una boleta emitida SIEMPRE debe quedar registrada
  // en la app — nunca se pierde por un fallo de descarga del PDF. El PDF es un
  // respaldo adjuntable/reintentable, no un requisito para reconocer la emisión.
  // (Sin esto, un folio real podría quedar invisible en el sistema: el peor
  // caso para el contador y para MassDTE a escala.)
  if (!hasStrongFolioEvidence(result)) {
    const reason = result?.folio
      ? `folio ${result.folio} con evidencia insuficiente (${result.folio_confidence || "sin confianza"})`
      : "folio no detectado";
    sendToApp(state, captureDebugMessage(state.jobId, result, `Resultado SII requiere revision: ${reason}.`));
    pauseWorker(state, `SII respondio, pero ${reason}. No se marcara como emitida.`);
    sendToApp(state, statusMessage(state.jobId, "result_needs_review", `Resultado SII requiere revision: ${reason}.`, true));
    return;
  }

  // Folio fuerte: intentar el PDF (best-effort) y registrar la boleta igual.
  let resultWithPdf = result;
  let pdfError = null;
  try {
    const pdf = await capturePdfBytes(result);
    if (pdf) resultWithPdf = { ...result, pdf };
  } catch (error) {
    pdfError = error instanceof Error ? error.message : String(error);
    resultWithPdf = { ...result, pdf_capture_error: pdfError };
  }

  const conPdf = hasCapturedPdf(resultWithPdf);
  const msg = conPdf
    ? `Boleta emitida en SII. Folio ${result.folio}. PDF de respaldo capturado.`
    : `Boleta emitida en SII. Folio ${result.folio}. El PDF de respaldo quedó pendiente (se puede adjuntar luego); la boleta ya quedó registrada.`;
  const message = resultMessage(state.jobId, { ...resultWithPdf, job: state.job }, msg);
  // PRIMERO el stash, DESPUÉS la entrega: si la pestaña de la app está cerrada,
  // el folio sobrevive en storage y se reentrega al próximo ping de la app.
  await stashPendingResult(state.jobId, message, state.job?.empresa_id ?? null);
  sendToApp(state, message);
  state.awaitingResult = false;
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "DONE",
    message: conPdf ? `Boleta emitida. Folio ${result.folio}. PDF capturado.` : `Boleta emitida. Folio ${result.folio}. PDF pendiente.`,
  });
}

async function sendToApp(jobState, message) {
  if (!jobState?.appTabId) return;
  try {
    await chrome.tabs.sendMessage(jobState.appTabId, message);
  } catch {
    // The app tab may have been closed. Los RESULTADOS no dependen de este envío:
    // quedan en el stash de chrome.storage.local y se reentregan al próximo ping
    // de la app (redeliverPendingResults). Los STATUS sí son best-effort.
  }
}

// ── Stash anti-pérdida de folio ─────────────────────────────────────────────
// El folio solo llegaba al servidor VÍA la pestaña de la app (app-bridge hace el
// POST). Si esa pestaña estaba cerrada/navegando cuando terminó la emisión, la
// boleta REAL quedaba invisible para siempre (auditoría: crítico). Ahora todo
// resultado se guarda primero en chrome.storage.local y se reentrega a cualquier
// pestaña de la app que haga ping, hasta que el POST confirme (ack PERSISTED).
// El server dedupea por UNIQUE(empresa,tipo,folio), así que reentregar es seguro.
// Una CLAVE POR JOB (no un objeto compartido): get→mutar→set sobre una clave
// única no es atómico en el SW MV3 y dos escrituras concurrentes se pisaban
// (lost update) — justo el respaldo que no puede perderse. set/remove por clave
// individual no compiten entre jobs distintos.
const PENDING_RESULT_KEY_PREFIX = "sii_pending_result:";
const PENDING_RESULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const PENDING_RESULT_MAX_ATTEMPTS = 12; // tope: un POST que falla PERMANENTE no reintenta para siempre

function slimResultForStash(message) {
  // Sin el PDF base64 (puede pesar MBs y reventar la cuota de storage): lo que
  // importa registrar es el folio con su evidencia; el PDF es respaldo reintentable.
  if (!message?.result || typeof message.result !== "object") return message;
  const hadPdf = Boolean(message.result.pdf?.base64);
  const result = { ...message.result, pdf: undefined };
  // El texto congelado decía "PDF capturado" aunque acá lo soltamos: sincerarlo
  // (el server lo registrará como pdf_pendiente y se adjunta después).
  const msg = hadPdf && typeof message.message === "string"
    ? message.message.replace(/PDF de respaldo capturado\.?/, "El PDF de respaldo quedó pendiente; la boleta queda registrada igual.")
    : message.message;
  return { ...message, message: msg, result };
}

async function stashPendingResult(jobId, message, empresaId) {
  if (!jobId) return;
  try {
    await chrome.storage.local.set({
      [PENDING_RESULT_KEY_PREFIX + jobId]: {
        message: slimResultForStash(message),
        empresa_id: empresaId ?? null,
        saved_at: Date.now(),
        attempts: 0,
      },
    });
  } catch {
    // Best-effort: si storage falla, queda la entrega directa por la pestaña.
  }
}

async function clearPendingResult(jobId) {
  if (!jobId) return;
  try {
    await chrome.storage.local.remove(PENDING_RESULT_KEY_PREFIX + jobId);
  } catch {
    // Best-effort.
  }
}

async function redeliverPendingResults(tabId, empresaId) {
  if (!tabId) return;
  try {
    const stored = await chrome.storage.local.get(null);
    const now = Date.now();
    for (const [key, entry] of Object.entries(stored || {})) {
      if (!key.startsWith(PENDING_RESULT_KEY_PREFIX)) continue;
      if (!entry?.message || (now - (entry.saved_at || 0)) > PENDING_RESULT_TTL_MS
        || (entry.attempts || 0) >= PENDING_RESULT_MAX_ATTEMPTS) {
        chrome.storage.local.remove(key).catch(() => undefined);
        continue;
      }
      // Solo a la MISMA empresa que emitió: sin este filtro, otro usuario logueado
      // en el mismo navegador re-POSTeaba resultados ajenos bajo SU sesión
      // (contaminaba su historial y le bloqueaba Emitir con avisos de otro).
      if (!entry.empresa_id || !empresaId || entry.empresa_id !== empresaId) continue;
      chrome.storage.local.set({ [key]: { ...entry, attempts: (entry.attempts || 0) + 1 } }).catch(() => undefined);
      // Reentrega al tab que hizo ping; app-bridge re-POSTea (idempotente) y al
      // confirmar llega el ack PERSISTED que limpia esta entrada.
      chrome.tabs.sendMessage(tabId, entry.message).catch(() => undefined);
    }
  } catch {
    // Best-effort.
  }
}

// ── Expiración de jobs dentro de la extensión ───────────────────────────────
// expires_at solo se validaba al RECIBIR el job; después el state vivía para
// siempre. Un worker viejo abandonado + un job nuevo podían emitir LOS DOS al
// desbloquear la bóveda (auditoría: crítico → doble boleta real). Pre-emit un
// job vencido se cierra; post-emit NUNCA se expira (protege el folio).
function jobExpired(state) {
  const t = Date.parse(state?.job?.expires_at || "");
  return Number.isFinite(t) && t <= Date.now();
}

function expireWorker(state) {
  sendToApp(state, statusMessage(
    state.jobId,
    "cancelled",
    "Este intento de emisión expiró (pasaron más de 15 minutos sin completarse). No se emitió nada; vuelve a la app y emite de nuevo.",
    true,
  ));
  closeWorker(state);
}

async function sendToSii(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, baseMessage(message));
  } catch {
    // Content script may not be ready on the first navigation.
  }
}

function stateForWorkerTab(tabId) {
  for (const state of activeJobs.values()) {
    if (state.workerTabId === tabId) return state;
  }
  return null;
}

function pauseWorker(state, message) {
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "PAUSED",
    message,
  });
}

function closeWorker(state) {
  activeJobs.delete(state.jobId);
  if (state.learningTimer) clearTimeout(state.learningTimer);
  if (state.workerWindowId) {
    chrome.windows.remove(state.workerWindowId).catch(() => undefined);
  } else if (state.workerTabId) {
    // Modo pestaña (dev facturas): cerrar SOLO la pestaña del worker — el
    // workerWindowId null es la ventana principal del usuario, intocable.
    chrome.tabs.remove(state.workerTabId).catch(() => undefined);
  }
  // Si un update quedó pendiente durante la emisión, este es el momento seguro.
  aplicarUpdateSiOcioso();
}

// ── Conductor del portal de FACTURAS (facturas-worker.js) ────────────────────
// Un drive por carga de página (tabs.onUpdated → scanWorkerPage → acá). El
// worker mira el DOM, ejecuta el paso que corresponda y responde; los pasos
// que navegan (seleccionar empresa, validar, firmar) provocan el próximo
// onUpdated y con él el próximo drive. Sin bucles: el motor es la navegación.
// UN SOLO watchdog por job (auditoría 2026-08-26): antes cada onUpdated
// arrancaba su propia cadena de 30 reintentos → tormenta de FACT_DRIVE sobre
// una página recargándose ("no respondió"/"channel closed"). Ahora hay UN
// timer por state, se cancela al re-entrar, y la cadena se ABORTA si cambió la
// URL de la pestaña (una navegación nueva ya traerá su propio scan).
function driveFacturaPage(state, attempt = 1) {
  if (!activeJobs.has(state.jobId)) return;
  if (attempt === 1 && state.factDriveTimer) {
    clearTimeout(state.factDriveTimer);
    state.factDriveTimer = null;
  }
  chrome.tabs.get(state.workerTabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    const urlActual = tab.url ?? "";
    if (attempt === 1) {
      state.factDriveUrl = urlActual;
    } else if (state.factDriveUrl && urlActual !== state.factDriveUrl) {
      // Cambió la URL desde que arrancó esta cadena → la abortamos; el
      // onUpdated de la página nueva arranca una cadena fresca.
      return;
    }
    console.log("[FACT] drive attempt", attempt, "url:", String(urlActual).split("/").pop(), "empresaSel:", state.empresaSeleccionada, "validado:", state.formularioValidado, "finalEmit:", state.finalEmitClicked);

    chrome.tabs.sendMessage(state.workerTabId, baseMessage({
      type: "APP_CONTABLE_SII_FACT_DRIVE",
      job_id: state.jobId,
      job: state.job,
      // Candado post-Firmar: nunca re-llenar formulario ni re-Firmar.
      final_emit_clicked: state.finalEmitClicked === true,
      // Latches de paso: un paso que navega no se repite (mata el titileo).
      done: { empresa: state.empresaSeleccionada === true, validado: state.formularioValidado === true },
    }), (res) => {
      const lastErr = chrome.runtime.lastError?.message ?? null;
      if (lastErr || !res) {
        // Content script aún no inyectado (document_idle llega tras onUpdated):
        // reintentar acotado (8×1.5s ≈ 12s); después, pausa humana con causa.
        state.lastDriveError = lastErr ?? "respuesta vacía";
        if (attempt < 8) {
          state.factDriveTimer = setTimeout(() => driveFacturaPage(state, attempt + 1), 1500);
        } else {
          sendToApp(state, statusMessage(state.jobId, "error", `La ventana SII no respondió al conductor de facturas (${state.lastDriveError}). Reintenta la emisión.`, true));
        }
        return;
      }
      // Patrón push: el worker ACUSA RECIBO acá; el resultado del paso llega
      // aparte como APP_CONTABLE_SII_FACT_STEP.
      if (res.accepted) return;
      handleFactDriveResponse(state, res).catch((error) => {
        sendToApp(state, statusMessage(state.jobId, "error", `Conductor de facturas falló: ${error instanceof Error ? error.message : String(error)}`, true));
      });
    });
  });
}

// Resultado de un paso del portal de facturas, EMPUJADO por facturas-worker
// al terminar (patrón push). Llega por runtime.onMessage (handler abajo).
function handleFactStepPush(state, res) {
  if (!res || res.busy) return;
  sendToApp(state, statusMessage(state.jobId, "fact_drive", `Portal: ${res.kind ?? "?"} → ${res.action ?? res.error ?? "?"}`, true));
  handleFactDriveResponse(state, res).catch((error) => {
    sendToApp(state, statusMessage(state.jobId, "error", `Conductor de facturas falló: ${error instanceof Error ? error.message : String(error)}`, true));
  });
}

async function handleFactDriveResponse(state, res) {
  if (!activeJobs.has(state.jobId)) return;

  if (res.ok === false) {
    const detalle = res.detalle ? `${res.error}: ${res.detalle}` : String(res.error ?? "FACT_ERROR");
    if (state.finalEmitClicked) {
      // Post-Firmar NADA cierra el job ni re-emite: posible folio real vivo.
      sendToApp(state, statusMessage(state.jobId, "result_needs_review", `No pude confirmar la factura (${detalle}). No la re-emitas: verifica el folio en el portal.`, true));
      return;
    }
    state.humanRequired = Boolean(res.human) || state.humanRequired;
    sendToApp(state, statusMessage(state.jobId, "error", detalle, true));
    return;
  }

  if (res.action === "needs_cert_password") {
    // Doctrina: UN intento con la clave del certificado. Si la pantalla de
    // firma reaparece tras haberla enviado, la clave es mala — jamás
    // reintentar solo (el SII puede bloquear el certificado).
    if (state.certPasswordSent) {
      sendToApp(state, statusMessage(state.jobId, "result_needs_review", "CERT_PASSWORD_INVALID: la clave del certificado parece incorrecta. Corrígela en Opciones de la extensión y verifica en el portal si la factura alcanzó a emitirse — no la re-emitas.", true));
      return;
    }
    const creds = await getUnlockedSiiCredentials(state.appOrigin);
    if (!creds.ok || !creds.clave_certificado) {
      sendToApp(state, statusMessage(state.jobId, "result_needs_review", "CERT_PASSWORD_MISSING: falta la clave del certificado digital en la extensión (Opciones). El documento quedó a un paso de firmarse — verifica en el portal, no lo re-emitas.", true));
      return;
    }
    state.certPasswordSent = true;
    sendToApp(state, statusMessage(state.jobId, "signing", "Firmando la factura en el SII…", true));
    chrome.tabs.sendMessage(state.workerTabId, baseMessage({
      type: "APP_CONTABLE_SII_FACT_SIGN",
      job_id: state.jobId,
      clave_certificado: creds.clave_certificado,
    }), () => { void chrome.runtime.lastError; });
    return;
  }

  if (res.action === "captured" && res.result) {
    state.awaitingResult = false;
    handleCapturedResult(state, res.result);
    return;
  }

  // Login real del SII: el worker de FACTURAS lo detecta y lo pide (el motor
  // de boletas ya NO toca las páginas del portal de facturas). Un solo intento
  // de autologin; si reaparece, pausa humana.
  if (res.action === "needs_login") {
    if (state.factLoginIntentado) {
      state.humanRequired = true;
      sendToApp(state, statusMessage(state.jobId, "waiting_sii_login", "Inicia sesión en la ventana del SII a mano y la extensión sigue sola.", true));
      return;
    }
    state.factLoginIntentado = true;
    attemptSiiAutologin(state, res.map ?? null);
    return;
  }

  // LATCHES DE PASO: al confirmar un paso que navega, se marca para no
  // repetirlo si volvemos a aterrizar en su misma página (mata el titileo).
  if (res.action === "empresa_seleccionada") state.empresaSeleccionada = true;
  if (res.action === "validado") state.formularioValidado = true;

  // POLL de la fase de FIRMA: el campo de la clave del certificado (y el folio
  // final) pueden aparecer por JS SIN recargar → no hay onUpdated que re-drive.
  // Tras Firmar, si el worker sigue "observando", re-escanear cada 2s hasta
  // ~40s para pillar el campo/folio en cuanto aparezcan (sin re-navegar).
  if (res.action === "observando" && state.finalEmitClicked) {
    state.factSignPolls = (state.factSignPolls ?? 0) + 1;
    if (state.factSignPolls <= 20) {
      if (state.factSignTimer) clearTimeout(state.factSignTimer);
      state.factSignTimer = setTimeout(() => { if (activeJobs.has(state.jobId)) driveFacturaPage(state); }, 2000);
      // DIAGNÓSTICO POST-FIRMA (2026-08-27): la página de éxito del SII no
      // calzó con el detector de folio y quedó "unknown" — el excerpt viaja
      // en el status para VER qué dice esa pantalla y afinar el matcher.
      sendToApp(state, statusMessage(state.jobId, "fact_sign_poll", `Post-firma (${state.factSignPolls}/20): ${String(res.excerpt ?? res.detalle ?? "sin texto").slice(0, 400)}`, true));
      return;
    }
    sendToApp(state, statusMessage(state.jobId, "result_needs_review", "La firma no avanzó tras varios intentos. Revisa la ventana del SII: si viste un folio, la factura se emitió — no la re-emitas.", true));
    return;
  }

  // NOTA: se ELIMINÓ la re-navegación a start_url ante "observando" — el
  // watchdog ya re-conduce sola la página actual, y re-navegar descartaba el
  // progreso del POST (fuente del titileo). "observando" = seguir mirando.

  const mensajes = {
    empresa_seleccionada: "Empresa seleccionada en el portal de facturas…",
    validado: "Documento validado. Revisando la vista previa…",
    firmar_click: "Firmando la factura (no cierres la ventana)…",
    paused_preview: "Vista previa lista en la ventana SII. Revísala ahí.",
    learn_stop_pre_validar: "Aprendizaje: formulario llenado, sin validar ni firmar.",
    observando: "Navegando el portal de facturas…",
  };
  sendToApp(state, statusMessage(state.jobId, res.action ?? "working", mensajes[res.action] ?? "Trabajando en el portal de facturas…", true));
}

function scheduleLearningScan(state, delayMs = 1500) {
  if (!state.learnOnly || !activeJobs.has(state.jobId)) return;
  if (state.learningScanCount >= 160) return;
  if (state.learningTimer) clearTimeout(state.learningTimer);
  state.learningTimer = setTimeout(() => {
    state.learningScanCount += 1;
    scanWorkerPage(state);
  }, delayMs);
}

function handleWorkerAction(message, sender, sendResponse) {
  const state = stateForWorkerTab(sender.tab?.id);
  if (!state) {
    sendResponse?.({ ok: false, error: "JOB_NOT_FOUND" });
    return false;
  }

  if (message.action === "retry") {
    // Facturas: reintentar = volver a conducir la página actual (el estado
    // vive en los forms del CGI; recargar lo borraría). El candado
    // finalEmitClicked sigue mandando: post-Firmar el drive solo captura.
    if (state.kind === "factura") {
      sendToApp(state, statusMessage(state.jobId, "retrying", "Reintentando en el portal de facturas.", true));
      driveFacturaPage(state);
      sendResponse?.({ ok: true });
      return false;
    }
    if (state.awaitingResult) {
      sendToApp(state, statusMessage(state.jobId, "capturing_result", "Reintentando captura de resultado SII.", true));
      captureWorkerResult(state);
      sendResponse?.({ ok: true });
      return false;
    }

    // Candado anti-doble-emisión: si el EMITIR real ya se cliqueó una vez en este
    // trabajo, "Reintentar" NUNCA vuelve a emitir (eso duplicaría la boleta). Solo
    // reintenta capturar el folio que ya se emitió.
    if (state.finalEmitClicked) {
      state.awaitingResult = true;
      sendToApp(state, statusMessage(state.jobId, "capturing_result", "Ya se emitió en este trabajo; no re-emito. Reintentando capturar el folio.", true));
      captureWorkerResult(state);
      sendResponse?.({ ok: true });
      return false;
    }

    // Un intento vencido no se reanuda: la app pudo cerrar el job y volver a
    // emitir. (learn_only queda exento, igual que en scan/resume: una sesión de
    // aprendizaje larga no emite nada y no debe cortarse a los 15 minutos.)
    if (!state.learnOnly && jobExpired(state)) {
      expireWorker(state);
      sendResponse?.({ ok: true });
      return false;
    }

    state.filledDraft = false;
    state.submitted = false;
    sendToApp(state, statusMessage(state.jobId, "retrying", "Reintentando deteccion de e-Boleta.", true));
    if (state.learnOnly) {
      // Aprendizaje: solo re-escanear (recargar le pisaría la navegación al usuario).
      scanWorkerPage(state);
      sendResponse?.({ ok: true });
      return false;
    }
    // Recargar la página ANTES de re-intentar: la calculadora vuelve a cero. Sin
    // esto, re-teclear el monto CONCATENABA dígitos sobre lo ya tecleado y podía
    // salir una boleta real por un monto gigante (auditoría: crítico). El reload
    // dispara tabs.onUpdated → scanWorkerPage sobre una pantalla limpia.
    chrome.tabs.reload(state.workerTabId).catch(() => scanWorkerPage(state));
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.action === "capture") {
    if (state.kind === "factura") {
      sendToApp(state, statusMessage(state.jobId, "capturing_result", "Capturando folio desde el portal de facturas.", true));
      driveFacturaPage(state);
      sendResponse?.({ ok: true });
      return false;
    }
    state.awaitingResult = true;
    sendToApp(state, statusMessage(state.jobId, "capturing_result", "Capturando folio desde la pantalla SII actual.", true));
    captureWorkerResult(state);
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.action === "cancel") {
    // Post-emit: NO enviar "cancelled" (la app cerraría el job y se perdería el folio
    // YA emitido). El usuario puede cerrar la ventana, pero el trabajo queda vivo
    // pidiendo el folio; el backfill del servidor lo registra con evidencia fuerte.
    if (state.finalEmitClicked) {
      sendToApp(state, statusMessage(state.jobId, "result_needs_review", "Cerraste tras emitir. Si viste el folio, ingrésalo abajo para no perder la boleta; no re-emitas.", true));
      closeWorker(state);
      sendResponse?.({ ok: true });
      return false;
    }
    sendToApp(state, statusMessage(state.jobId, "cancelled", "Operacion SII cancelada por el usuario.", true));
    closeWorker(state);
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.action === "close") {
    // Post-emit sin confirmación de guardado: NO mandar "closed" (la app lo trata
    // como terminal y re-habilitaba Emitir con una boleta real emitida y no
    // guardada → doble emisión; auditoría: crítico). El stash + reentrega ya
    // protegen el folio; el estado no-cerrante mantiene el candado en la app.
    if (state.finalEmitClicked && !state.resultPersisted) {
      sendToApp(state, statusMessage(state.jobId, "result_needs_review", "Cerraste tras emitir y la boleta aún no se confirma guardada. Se guardará sola al volver a la app; no re-emitas.", true));
      closeWorker(state);
      sendResponse?.({ ok: true });
      return false;
    }
    // Guardado confirmado: no mandar nada (la app ya muestra "Boleta emitida";
    // pisarla con "Ventana cerrada" solo confunde). Pre-emit: cierre normal.
    if (!state.finalEmitClicked) {
      sendToApp(state, statusMessage(state.jobId, "closed", "Ventana segura SII cerrada.", false));
    }
    closeWorker(state);
    sendResponse?.({ ok: true });
    return false;
  }

  sendResponse?.({ ok: false, error: "ACTION_INVALID" });
  return false;
}

function scanWorkerPage(state, attempt = 1) {
  // Pre-emit vencido → cerrar, no seguir automatizando. (Post-emit jamás se
  // expira: la prioridad es capturar el folio ya emitido.)
  if (!state.learnOnly && !state.finalEmitClicked && jobExpired(state)) {
    expireWorker(state);
    return;
  }
  chrome.tabs.sendMessage(state.workerTabId, baseMessage({
    type: "APP_CONTABLE_SII_SCAN_PAGE",
    job_id: state.jobId,
  }), (scanResponse) => {
    if (chrome.runtime.lastError || !scanResponse?.map) return;
    const map = scanResponse.map;
    console.info("[app-contable-sii-page-map]", map);
    sendToApp(state, baseMessage({
      type: "APP_CONTABLE_SII_PAGE_MAP",
      job_id: state.jobId,
      map,
    }));
    sendToApp(state, statusMessage(
      state.jobId,
      "sii_page_ready",
      `Pagina SII lista: ${map.controls?.length ?? 0} campos y ${map.buttons?.length ?? 0} acciones detectadas.`,
      true,
    ));

    // FACTURAS: su conductor es autónomo (facturas-worker.js) y detecta el
    // login él mismo (→ needs_login). El motor de boletas —incluido su
    // autologin por heurística de "RUT"— NO toca las páginas de facturas:
    // ahí vivía el loop menú↔login que titilaba. Ruteo directo y salir.
    if (state.kind === "factura") {
      const formNames = (Array.isArray(map.forms) ? map.forms : []).map((f) => f?.name).filter(Boolean).join(",");
      console.log("[FACT] scan complete → drive. forms:", formNames || "(ninguno)", "url:", String(map.url || "").split("/").pop());
      driveFacturaPage(state);
      return;
    }

    const excerpt = String(map.body_excerpt || "");
    // Autologin de BOLETAS: post-emit jamás tipear credenciales (la password
    // visible podría ser otra).
    if (!state.finalEmitClicked && isLoginPageMap(map)) {
      attemptSiiAutologin(state, map);
      return;
    }

    if (attempt < 8 && /Cargando Emisores|Cargando/i.test(excerpt)) {
      setTimeout(() => scanWorkerPage(state, attempt + 1), 1500);
      return;
    }

    if (state.learnOnly) {
      sendToApp(state, statusMessage(
        state.jobId,
        "learning_observing",
        `Modo aprendizaje activo: ${map.url || "pagina SII"}`,
        true,
      ));
      scheduleLearningScan(state);
      return;
    }

    const hasEmitButton = Array.isArray(map.buttons) && map.buttons.some((button) => button?.text === "EMITIR");
    const hasNumberPad = Array.isArray(map.buttons) && ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].every((digit) => map.buttons.some((button) => button?.text === digit));
    if (!state.submitted && !state.finalEmitClicked && hasEmitButton && hasNumberPad) {
      state.filledDraft = true;
      state.submitted = true;
      sendToApp(state, statusMessage(
        state.jobId,
        "submitting",
        "Emitiendo boleta en SII desde la extension local.",
        true,
      ));
      chrome.tabs.sendMessage(state.workerTabId, baseMessage({
        type: "APP_CONTABLE_SII_FILL_AND_EMIT",
        job_id: state.jobId,
        job: state.job,
      }), (emitResponse) => {
        if (chrome.runtime.lastError || !emitResponse?.ok) {
          const errorMessage = emitResponse?.error || chrome.runtime.lastError?.message || "No se pudo emitir en e-Boleta.";
          // Post-emit si: (a) el worker lo confirmó, o (b) el candado ya se armó por el
          // aviso inmediato (notifyFinalEmitClicked, apenas se cliqueó el EMITIR real).
          // En ese caso NO cerrar ni re-emitir: capturar el folio. Una muerte de puerto
          // SIN el candado armado se trata como PRE-emit (no hubo folio) → se permite
          // reintentar, sin inventar una emisión que no ocurrió (evita folio fantasma).
          if (emitResponse?.final_emit_clicked || state.finalEmitClicked) {
            state.finalEmitClicked = true;
            state.awaitingResult = true;
            sendToApp(state, statusMessage(
              state.jobId,
              "capturing_result",
              "Cliqué EMITIR y el SII aún no confirma. Busco el folio para no perderlo (no re-emito).",
              true,
            ));
            captureWorkerResult(state);
            return;
          }
          pauseWorker(state, errorMessage);
          sendToApp(state, statusMessage(
            state.jobId,
            "error",
            errorMessage,
            true,
          ));
          return;
        }
        state.awaitingResult = true;
        captureWorkerResult(state);
      });
    }
  });
}

function isLoginPageMap(map) {
  const text = `${map.url || ""} ${map.title || ""} ${map.body_excerpt || ""}`;
  return /Clave Tributaria|RUT|Ingresar|Autenticaci[oó]n|Inicio de Sesi[oó]n/i.test(text)
    && !/Calculadora|Emitir e-Boleta|e-Boleta power_settings|Cargando Emisores/i.test(text);
}

function focusWorkerForHuman(state, message) {
  state.humanRequired = true;
  if (state.workerWindowId) chrome.windows.update(state.workerWindowId, { focused: true }).catch(() => undefined);
  else if (state.workerTabId) chrome.tabs.update(state.workerTabId, { active: true }).catch(() => undefined); // modo pestaña: frontearla
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "HUMAN_REQUIRED",
    message,
  });
  sendToApp(state, statusMessage(state.jobId, "waiting_manual_login", message, true));
}

// Bóveda v2: NO hay popup de passphrase. Al llegar a la pantalla de login del SII,
// la extensión pide WS al servidor con la sesión de la app y desbloquea sola. Si no
// puede (sesión expirada, bóveda no conectada/revocada), se lo dice al usuario en
// humano y ofrece el login manual — nunca una clave local. Traduce el código del
// unlock a un mensaje simple.
function mapUnlockError(error) {
  switch (error) {
    case "SESSION_EXPIRED":
      return "Tu sesión de la app se cerró. Entra de nuevo a la app y la emisión sigue sola (o inicia sesión en el SII a mano aquí).";
    case "VAULT_REVOKED":
      return "La conexión con el SII fue revocada en este equipo. Reconéctala desde la app para emitir automáticamente (o inicia sesión a mano aquí).";
    case "VAULT_NEEDS_MIGRATION":
      return "Actualizamos la seguridad: reconecta tu clave del SII una vez desde la app (ya no necesitas clave local). Mientras, puedes iniciar sesión a mano aquí.";
    case "VAULT_OTHER_USER":
      return "Esta cuenta no tiene su clave del SII conectada en este equipo. Conéctala desde la app (o inicia sesión a mano aquí).";
    case "VAULT_NOT_CONFIGURED":
      return "Aún no conectas tu clave del SII. Hazlo desde la app para emitir automáticamente (o inicia sesión a mano aquí).";
    case "APP_ORIGIN_DESCONOCIDO":
      return "Abre la app y vuelve a intentar para conectar el desbloqueo automático (o inicia sesión a mano aquí).";
    default:
      return "No pude desbloquear tu clave del SII automáticamente. Inicia sesión a mano en esta ventana y continúo.";
  }
}

// Reanuda los trabajos en espera de login tras (re)conectar la bóveda desde la app:
// vuelve a escanear; attemptSiiAutologin desbloqueará solo con la sesión.
function resumeJobsAfterSiiUnlock() {
  for (const state of activeJobs.values()) {
    if (state.learnOnly || state.submitted || state.awaitingResult || state.finalEmitClicked) continue;
    // Un worker viejo abandonado NO se reanuda: sin este check, reconectar la
    // bóveda hacía emitir al job nuevo Y al viejo (dos boletas idénticas).
    if (jobExpired(state)) {
      expireWorker(state);
      continue;
    }
    state.humanRequired = false;
    state.autologinAttempted = false; // permitir un intento limpio ahora que hay clave
    state.autologinInFlight = false;
    state.unlockError = null;
    sendToApp(state, statusMessage(state.jobId, "autologin_attempting", "Clave SII conectada: reanudando inicio de sesión automático.", true));
    sendToSii(state.workerTabId, {
      type: "APP_CONTABLE_SII_WORKER_OVERLAY",
      job_id: state.jobId,
      mode: "LOCKED_AUTOMATION",
      message: "Clave SII conectada. Reanudando inicio de sesión automático en SII.",
    });
    scanWorkerPage(state);
  }
}

// La app volvió a estar viva (PING): reintenta los jobs que quedaron esperando por
// un fallo TRANSITORIO (sesión caducada / origen desconocido). Esto cumple la
// promesa "entra de nuevo a la app y la emisión sigue sola" sin exigir re-guardar
// toda la clave. Los permanentes (revocada/otro usuario) no se tocan.
function retryTransientUnlocks() {
  for (const state of activeJobs.values()) {
    if (state.learnOnly || state.submitted || state.awaitingResult || state.finalEmitClicked) continue;
    if (!state.unlockError || !UNLOCK_TRANSIENT.has(state.unlockError)) continue;
    if (jobExpired(state)) { expireWorker(state); continue; }
    state.humanRequired = false;
    state.autologinAttempted = false;
    state.autologinInFlight = false;
    state.unlockError = null;
    scanWorkerPage(state);
  }
}

// Errores de desbloqueo TRANSITORIOS (la sesión de la app puede volver): no
// consumen el intento — al reloguear/volver a la app (PING) se reintenta solo.
// Los permanentes (revocada / otro usuario / no conectada) sí lo consumen.
const UNLOCK_TRANSIENT = new Set(["SESSION_EXPIRED", "APP_ORIGIN_DESCONOCIDO"]);

async function attemptSiiAutologin(state) {
  // Candado de reentrancia ANTES del await: getUnlockedSiiCredentials hace un
  // round-trip de red (fetch de WS), y scanWorkerPage puede reinvocar en paralelo
  // (varios 'complete' del login del SII). Sin este flag síncrono, dos intentos
  // concurrentes tecleaban RUT+Clave y clickeaban Ingresar DOS veces (riesgo de
  // bloqueo de la cuenta SII).
  if (state.autologinAttempted || state.autologinInFlight) {
    if (state.autologinAttempted) {
      focusWorkerForHuman(state, "No pudimos iniciar sesión automáticamente. SII puede pedir captcha, 2FA, cambio de clave o selección de contribuyente. Inicia sesión manualmente en esta ventana y continuaremos automáticamente.");
    }
    return;
  }
  state.autologinInFlight = true;

  // Desbloqueo v2: pide WS al servidor con la sesión (dentro del módulo de bóveda).
  const unlock = await getUnlockedSiiCredentials(state.appOrigin);
  if (!unlock.ok) {
    state.autologinInFlight = false;
    // Transitorio → NO consumir el intento: reloguear en la app y volver dispara el
    // reintento (retryTransientUnlocks en el PING). Permanente → consumir + login manual.
    if (!UNLOCK_TRANSIENT.has(unlock.error)) state.autologinAttempted = true;
    state.unlockError = unlock.error;
    focusWorkerForHuman(state, mapUnlockError(unlock.error));
    return;
  }
  const credentials = { rut: unlock.rut, clave: unlock.clave };

  state.autologinAttempted = true;
  state.autologinInFlight = false;
  state.unlockError = null;
  state.humanRequired = false;
  sendToApp(state, statusMessage(state.jobId, "autologin_attempting", "Iniciando sesión en el SII con tu clave (desbloqueada por tu sesión).", true));
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "LOCKED_AUTOMATION",
    message: "Iniciando sesión en SII. Si SII pide captcha o 2FA, esta ventana quedará lista para tu intervención.",
  });

  chrome.tabs.sendMessage(state.workerTabId, baseMessage({
    type: "APP_CONTABLE_SII_ATTEMPT_AUTOLOGIN",
    job_id: state.jobId,
    credentials,
  }), (response) => {
    if (!chrome.runtime.lastError && response?.ok) {
      setTimeout(() => scanWorkerPage(state), 3500);
      return;
    }

    attemptSiiAutologinInFrames(state, credentials, response?.error || chrome.runtime.lastError?.message);
  });
}

function attemptSiiAutologinInFrames(state, credentials, previousError) {
  chrome.scripting.executeScript({
    target: { tabId: state.workerTabId, allFrames: true },
    args: [credentials],
    func: (vaultCredentials) => {
      const normalize = (value) => String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      if (/CAPTCHA|RECAPTCHA|CODIGO DE SEGURIDAD|2FA|DOBLE FACTOR|VERIFICACION|AUTENTICADOR|TOKEN|CAMBIO DE CLAVE|ACTUALIZA TU CLAVE/.test(pageText)) {
        return { ok: false, error: "SII requiere verificacion humana." };
      }
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
        if (element instanceof HTMLInputElement && (element.disabled || element.readOnly || element.type === "hidden")) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const labelFor = (control) => {
        if (control.id) {
          const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
          if (label) return label.innerText || label.textContent || "";
        }
        return control.closest("label")?.innerText || control.getAttribute("aria-label") || control.getAttribute("placeholder") || "";
      };
      const controlText = (input) => normalize([
        input.id,
        input.name,
        input.autocomplete,
        input.placeholder,
        input.getAttribute("aria-label"),
        labelFor(input),
      ].filter(Boolean).join(" "));
      const inputs = Array.from(document.querySelectorAll("input")).filter((input) => input instanceof HTMLInputElement && visible(input));
      const passwordInput = inputs.find((input) => input.type === "password")
        || inputs.find((input) => /CLAVE|PASSWORD|CONTRASENA/.test(controlText(input)));
      const rutInput = inputs.find((input) => /RUT|RUTCNTR|ROL|USUARIO|USER|CODIGO/.test(controlText(input)) && input !== passwordInput)
        || inputs.find((input) => input !== passwordInput && ["text", "tel", "number"].includes(input.type || "text"));
      if (!rutInput || !passwordInput) return { ok: false, error: "Formulario SII no encontrado en este frame." };
      const setValue = (input, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
        if (descriptor?.set) descriptor.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setValue(rutInput, vaultCredentials.rut);
      setValue(passwordInput, vaultCredentials.clave);
      const buttonText = (element) => normalize(element.innerText || element.textContent || element.getAttribute("value") || element.getAttribute("title") || "");
      const submit = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"))
        .filter((element) => element instanceof HTMLElement && visible(element))
        .find((element) => /^(INGRESAR|INICIAR SESION|INICIAR SESSION|ENTRAR|ACCEDER)$/.test(buttonText(element)))
        || Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"))
          .filter((element) => element instanceof HTMLElement && visible(element))
          .find((element) => /INGRESAR|INICIAR SESION|ENTRAR|ACCEDER/.test(buttonText(element)));
      if (submit) {
        submit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        submit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        submit.click();
      } else {
        const form = passwordInput.form || rutInput.form;
        if (!form) return { ok: false, error: "Boton de login SII no encontrado." };
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      }
      return { ok: true };
    },
  }, (results) => {
    if (chrome.runtime.lastError) {
      focusWorkerForHuman(state, previousError || chrome.runtime.lastError.message || "Autologin SII no disponible. Inicia sesión manualmente y continuaremos automáticamente.");
      return;
    }

    const success = Array.isArray(results) && results.some((result) => result?.result?.ok);
    if (success) {
      sendToApp(state, statusMessage(state.jobId, "autologin_sent", "Login SII enviado desde la bóveda local.", true));
      setTimeout(() => scanWorkerPage(state), 3500);
      return;
    }

    const error = Array.isArray(results)
      ? results.map((result) => result?.result?.error).filter(Boolean)[0]
      : null;
    focusWorkerForHuman(state, error || previousError || "Autologin SII no encontró un formulario compatible. Inicia sesión manualmente y continuaremos automáticamente.");
  });
}

function captureWorkerResult(state) {
  sendToApp(state, statusMessage(
    state.jobId,
    "capturing_result",
    "Capturando folio y respaldo desde SII.",
    true,
  ));
  chrome.tabs.sendMessage(state.workerTabId, baseMessage({
    type: "APP_CONTABLE_SII_CAPTURE_RESULT",
    job_id: state.jobId,
    job: state.job,
  }), (captureResponse) => {
    if (chrome.runtime.lastError || !captureResponse?.ok) {
      const errorMessage = captureResponse?.error || chrome.runtime.lastError?.message || "No se pudo capturar el resultado SII.";
      // Post-emit: NUNCA subir "error" (la app cerraría el job y perdería el folio ya
      // emitido). Pausar en un estado NO-cerrante para reintentar captura o ingresar
      // el folio a mano. El candado sigue impidiendo re-emitir.
      if (state.finalEmitClicked) {
        pauseWorker(state, "Emitiste, pero no pude capturar el folio automáticamente. Reintenta captura o ingresa el folio visible. NO re-emitas.");
        sendToApp(state, statusMessage(state.jobId, "result_needs_review", "Emitiste, pero no pude capturar el folio. Reintenta captura o ingrésalo abajo; no re-emitas.", true));
        return;
      }
      pauseWorker(state, errorMessage);
      sendToApp(state, statusMessage(state.jobId, "error", errorMessage, true));
      return;
    }

    handleCapturedResult(state, captureResponse.result);
  });
}

// Modo del worker de FACTURAS.
//   false = VENTANA dedicada con overlay y candado de clicks (UX de producción).
//   true  = PESTAÑA: auditable paso a paso con herramientas (depuración).
// En VENTANA para la 0.2.0: el cliente no debe poder escribir encima del RPA
// mientras emite. El modo pestaña queda disponible para depurar el carril.
const FACT_WORKER_EN_PESTANA = false;

async function openWorkerWindow(job, appTabId, appOrigin) {
  // Facturas: la URL de arranque viaja EN el job (validada: solo sii.cl por
  // https). Boletas siguen en la constante de e-Boleta.
  const startUrl = job.kind === "factura" && job.start_url ? job.start_url : SII_START_URL;
  let workerWindowId = null;
  let workerTabId = null;
  if (job.kind === "factura" && FACT_WORKER_EN_PESTANA) {
    const tab = await chrome.tabs.create({ url: startUrl, active: false });
    workerTabId = tab.id ?? null;
    // workerWindowId queda null A PROPÓSITO: es la ventana principal del
    // usuario — closeWorker jamás debe cerrarla (solo cierra la pestaña).
  } else {
    const worker = await chrome.windows.create({
      url: startUrl,
      type: "popup",
      focused: false,
      width: 1120,
      height: 820,
    });
    workerWindowId = worker.id ?? null;
    workerTabId = worker.tabs?.[0]?.id ?? null;
    if (!workerWindowId) throw new Error("SII_WORKER_WINDOW_FAILED");
  }
  if (!workerTabId) throw new Error("SII_WORKER_WINDOW_FAILED");

  const state = {
    jobId: job.job_id,
    job,
    // "factura" (Sistema de Facturación Gratuito) | "boleta" (e-Boleta). Las
    // ramas de conducción específicas de e-Boleta chequean esto y NUNCA
    // corren sobre el portal de facturas.
    kind: job.kind === "factura" ? "factura" : "boleta",
    appTabId,
    appOrigin: appOrigin ?? null, // origen de la app para pedir WS (desbloqueo v2)
    workerWindowId,
    workerTabId,
    createdAt: new Date().toISOString(),
    learnOnly: job.learn_only === true,
    learningScanCount: 0,
    learningTimer: null,
    filledDraft: false,
    submitted: false,
    // Candado monótono: una vez que se cliqueó el EMITIR real, NUNCA se re-emite ni
    // se cierra el trabajo por "error" — solo se captura/recupera el folio.
    finalEmitClicked: false,
    // Facturas: la clave del certificado se envía UNA vez; si la pantalla de
    // firma reaparece, es clave mala → pausa humana, jamás reintento solo.
    certPasswordSent: false,
    // Facturas: latches de paso (un paso que navega no se repite → sin titileo),
    // un solo autologin, y watchdog único cancelable por cambio de URL.
    empresaSeleccionada: false,
    formularioValidado: false,
    factLoginIntentado: false,
    factDriveTimer: null,
    factDriveUrl: null,
    awaitingResult: false,
    autologinAttempted: false,
    humanRequired: false,
    // true cuando la app confirmó (ack) que el POST del resultado quedó guardado.
    resultPersisted: false,
  };
  activeJobs.set(job.job_id, state);

  await sendToSii(workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: job.job_id,
    mode: "LOCKED_AUTOMATION",
    message: state.learnOnly
      ? "Modo aprendizaje: si SII pide login, inicia sesión manualmente. La extensión solo observa mapas sanitizados; no emitirá."
      : "Preparando SII local. Si no hay sesión, intentaremos autologin local o pediremos intervención manual.",
  });

  return state;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "APP_CONTABLE_SII_WORKER_ACTION" && isAllowedSiiUrl(sender.url || "")) {
    return handleWorkerAction(message, sender, sendResponse);
  }

  // Aviso inmediato del worker: el EMITIR real ya se cliqueó. Arma el candado AL
  // INSTANTE (no espera la confirmación de 16s), así ninguna ruta de error post-emit
  // (captura, salida de dominio, ventana cerrada) cierra el job ni permite re-emitir.
  // Latido del worker de facturas: solo recibirlo ya resetea el timer de
  // reciclado del service worker MV3 → lo mantiene vivo durante el paso largo
  // (llenado del formulario) para que el estado del job no se pierda.
  if (message?.type === "APP_CONTABLE_SII_FACT_KEEPALIVE") {
    sendResponse?.({ ok: true });
    return false;
  }

  // Paso del portal de facturas empujado por facturas-worker (patrón push).
  if (message?.type === "APP_CONTABLE_SII_FACT_STEP" && isAllowedSiiUrl(sender.url || "")) {
    const state = stateForWorkerTab(sender.tab?.id);
    if (state) {
      handleFactStepPush(state, message.res);
    } else {
      // Red de seguridad: si el SW se recicló y perdió activeJobs, el push
      // llega a un cerebro vacío. Al menos avisar (y NO quedar mudo): la app
      // muestra el error y el usuario reintenta sin ambigüedad.
      console.warn("[facturas] FACT_STEP sin state (SW reciclado); res:", message.res?.action ?? message.res?.error);
    }
    sendResponse?.({ ok: true });
    return false;
  }

  if (message?.type === "APP_CONTABLE_SII_FINAL_EMIT_CLICKED" && isAllowedSiiUrl(sender.url || "")) {
    const state = stateForWorkerTab(sender.tab?.id);
    if (state) state.finalEmitClicked = true;
    sendResponse?.({ ok: true });
    return false;
  }

  if (message?.type?.startsWith("APP_CONTABLE_SIMPLEAPI_VAULT_") && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    handleSimpleApiVaultMessage(message)
      .then((response) => sendResponse(baseMessage(response)))
      .catch(() => sendResponse(baseMessage({ type: `${message.type}_RESULT`, ok: false, error: "VAULT_ERROR" })));
    return true;
  }

  if (message?.type?.startsWith("APP_CONTABLE_SII_VAULT_") && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    // El SAVE (setup) viene de la página de la extensión (chrome-extension://), que
    // no conoce el origen de la app; el módulo usa el último origen visto (stash de
    // rememberAppOrigin, seteado por el ping/job de la app). message.app_origin es un
    // hint opcional si la app abrió el setup pasándolo.
    handleSiiVaultMessage(message, message.app_origin)
      .then((response) => {
        sendResponse(baseMessage(response));
        // (Re)conexión exitosa → reanudar trabajos en espera de login.
        if (message.type === "APP_CONTABLE_SII_VAULT_SAVE" && response?.ok) {
          resumeJobsAfterSiiUnlock();
        }
      })
      .catch(() => sendResponse(baseMessage({ type: `${message.type}_RESULT`, ok: false, error: "SII_VAULT_ERROR" })));
    return true;
  }

  if (!isAllowedAppUrl(sender.url || "")) return false;

  // Aprende el origen de la app de cualquier mensaje suyo: lo usa el setup (SAVE) y
  // el desbloqueo v2 para el fetch de WS al casillero del servidor.
  try { void rememberAppOrigin(new URL(sender.url).origin); } catch { /* ignore */ }

  // Wipe LOCAL desde la app (tras revocar en el servidor con "Desconectar en todos
  // mis equipos"): solo borra datos locales, no lee secretos → no viola la frontera.
  if (message?.type === "APP_CONTABLE_SII_VAULT_LOCAL_WIPE") {
    wipeLocalVault().catch(() => undefined);
    sendResponse(baseMessage({ type: "APP_CONTABLE_SII_VAULT_LOCAL_WIPE_RESULT", ok: true }));
    return false;
  }

  if (message?.type === "APP_CONTABLE_EXTENSION_PING") {
    // Auto-update SOLO con brecha conocida: la app manda en el ping cuál es la
    // última versión publicada (constante que mantiene sincronizada un test).
    // Si esta extensión ya la tiene, a Google no se le pide NADA — cero ruido.
    // Con brecha, el chequeo va frenado a 1 vez / 10 min igual.
    if (versionBajoObjetivo(EXTENSION_VERSION, message.ultima_version)) maybeCheckUpdate();
    // La app está viva: si hay folios pendientes de entrega (pestaña cerrada
    // cuando terminó una emisión), reentregarlos ahora a ESTA pestaña — solo
    // los de la MISMA empresa que declara el ping.
    redeliverPendingResults(sender.tab?.id, message.empresa_id ?? null);
    // La sesión pudo restablecerse: reintenta jobs colgados por un fallo transitorio.
    retryTransientUnlocks();
    sendResponse(baseMessage({
      type: "APP_CONTABLE_EXTENSION_PONG",
      extension_version: EXTENSION_VERSION,
      capabilities: CAPABILITIES,
      nonce: message.nonce,
    }));
    return false;
  }

  // Ack de app-bridge: el POST /api/sii-local/result respondió ok → el folio quedó
  // guardado en la app. Limpia el stash y desarma los avisos "sin resolver".
  if (message?.type === "APP_CONTABLE_SII_RESULT_PERSISTED") {
    if (message.ok === true && message.job_id) {
      clearPendingResult(message.job_id);
      const state = activeJobs.get(message.job_id);
      if (state) state.resultPersisted = true;
    } else if (message.job_id && ["USUARIO_BLOQUEADO", "ROL_SIN_PERMISO"].includes(message.error)) {
      // Rechazo PERMANENTE de la cuenta: reintentar jamás va a funcionar.
      // (FORBIDDEN no limpia: el resultado es de otra sesión y su dueño lo
      // reintenta desde la suya; el filtro por empresa evita el spam acá.)
      clearPendingResult(message.job_id);
    }
    sendResponse?.({ ok: true });
    return false;
  }

  // La app cerró/canceló el job (error, reset del usuario): cerrar también la
  // ventana worker para que no queden DOS cerebros vivos (el "Reintentar" de la
  // ventana + el botón Emitir re-habilitado de la app = dos boletas reales).
  // Post-emit NUNCA se cierra desde aquí: el folio manda.
  if (message?.type === "APP_CONTABLE_SII_JOB_CLOSE") {
    const state = message.job_id ? activeJobs.get(message.job_id) : null;
    // Pre-emit: cierre normal. Post-emit: SOLO si el folio ya quedó guardado
    // (resultPersisted = ack del POST). Esto deja que el motor masivo recupere la
    // ventana entre boletas sin arriesgar el folio: mientras no esté persistido, la
    // ventana se mantiene (el stash + reentrega siguen protegiendo la boleta).
    if (state && (!state.finalEmitClicked || state.resultPersisted)) closeWorker(state);
    sendResponse(baseMessage({ type: "APP_CONTABLE_SII_JOB_CLOSE_RESULT", ok: true }));
    return false;
  }

  if (message?.type === "APP_CONTABLE_OPEN_EXTENSION_OPTIONS") {
    chrome.runtime.openOptionsPage(() => {
      sendResponse(baseMessage({
        type: "APP_CONTABLE_OPEN_EXTENSION_OPTIONS_RESULT",
        ok: !chrome.runtime.lastError,
        error: chrome.runtime.lastError?.message ?? null,
      }));
    });
    return true;
  }

  // Autoactualización guiada: la app detectó versión bajo el piso → abrir
  // chrome://extensions (una página web NO puede navegar a chrome://, la
  // extensión sí) y de paso pedirle a Chrome el update check inmediato.
  if (message?.type === "APP_CONTABLE_OPEN_EXTENSIONS_PAGE") {
    try { chrome.runtime.requestUpdateCheck?.(() => void chrome.runtime.lastError); } catch { /* best effort */ }
    chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id }, () => {
      sendResponse(baseMessage({
        type: "APP_CONTABLE_OPEN_EXTENSIONS_PAGE_RESULT",
        ok: !chrome.runtime.lastError,
        error: chrome.runtime.lastError?.message ?? null,
      }));
    });
    return true;
  }

  if (message?.type === "APP_CONTABLE_SII_FACT_JOB") {
    const job = message.job;
    let jobAppOrigin = null;
    try { jobAppOrigin = new URL(sender.url).origin; } catch { jobAppOrigin = null; }
    Promise.resolve()
      .then(async () => {
        const validationError = validateSiiFacturaJob(job);
        if (validationError) {
          sendResponse(statusMessage(job?.job_id ?? null, "error", validationError, true));
          return;
        }
        // Compuerta de fase: hasta que el fillAndEmit del portal exista, solo
        // se aceptan sesiones learn (mapear sin emitir). Fail-closed.
        if (job.auto_emit === true && !FACT_AUTO_EMIT_READY) {
          sendResponse(statusMessage(job.job_id, "error", "FACT_AUTO_EMIT_NO_DISPONIBLE", true));
          return;
        }
        // La clave del certificado se exige ANTES de abrir la ventana: sin ella
        // el paso Firmar es un callejón sin salida. El copy de la app manda a
        // Opciones de la extensión a configurarla.
        if (job.auto_emit === true) {
          const status = await siiVaultStatus();
          if (!status.has_clave_certificado) {
            sendResponse(statusMessage(job.job_id, "error", "CERT_PASSWORD_MISSING", true));
            return;
          }
        }
        return openWorkerWindow(job, sender.tab?.id, jobAppOrigin).then((state) => {
          sendResponse(statusMessage(job.job_id, "opening_sii", "Ventana segura SII creada.", true));
          sendToApp(state, statusMessage(
            job.job_id,
            "waiting_sii_login",
            state.learnOnly
              ? "Modo aprendizaje activo (portal de facturas). Inicia sesion y navega el flujo."
              : "Inicia sesion en la ventana SII dedicada.",
            true,
          ));
        });
      })
      .catch((error) => {
        sendResponse(statusMessage(job?.job_id ?? null, "error", error instanceof Error ? error.message : String(error), true));
      });

    return true;
  }

  if (message?.type === "APP_CONTABLE_SII_BOLETA_JOB") {
    const job = message.job;
    let jobAppOrigin = null;
    try { jobAppOrigin = new URL(sender.url).origin; } catch { jobAppOrigin = null; }
    // 0.1.8: sin RUT de empresa en la config. La app es la fuente única del
    // emisor (empresas.rut es INMUTABLE tras la primera boleta — trigger en la
    // base), cada job viaja con emisor_rut y el worker verifica el emisor
    // ACTIVO del portal antes de emitir (selectEmisorByRut, fail-closed). El
    // doble tipeo del RUT ya no aporta seguridad y bloqueaba multiempresa.
    Promise.resolve()
      .then(() => {
        const validationError = validateSiiBoletaJob(job);
        if (validationError) {
          sendResponse(statusMessage(job?.job_id ?? null, "error", validationError, true));
          return;
        }
        return openWorkerWindow(job, sender.tab?.id, jobAppOrigin).then((state) => {
          sendResponse(statusMessage(job.job_id, "opening_sii", "Ventana segura SII creada.", true));
          sendToApp(state, statusMessage(
            job.job_id,
            "waiting_sii_login",
            state.learnOnly ? "Modo aprendizaje activo. Inicia sesion y navega el flujo SII." : "Inicia sesion en la ventana SII dedicada.",
            true,
          ));
        });
      })
      .catch((error) => {
        sendResponse(statusMessage(job?.job_id ?? null, "error", error instanceof Error ? error.message : String(error), true));
      });

    return true;
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS") {
    handleSimpleApiVaultMessage(message)
      .then((response) => sendResponse(baseMessage(response)))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS_RESULT",
        status: { configured: false, encrypted: false, has_pfx: false, has_caf: false, updated_at: null },
      })));
    return true;
  }

  if (message?.type === "APP_CONTABLE_SII_VAULT_STATUS") {
    handleSiiVaultMessage(message)
      .then((response) => sendResponse(baseMessage(response)))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SII_VAULT_STATUS_RESULT",
        status: { configured: false, encrypted: false, has_rut: false, has_clave: false, updated_at: null, unlocked: false },
      })));
    return true;
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_DTE_GENERAR") {
    const origin = sender.url ? new URL(sender.url).origin : "";
    generateSimpleApiDteFromVault({ appOrigin: origin, input: message.input, jobId: message.job_id, reservedFolio: message.reserved_folio })
      .then((response) => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_GENERAR_RESULT",
        job_id: message.job_id ?? null,
        reserved_folio: message.reserved_folio ?? null,
        ...response,
      })))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_GENERAR_RESULT",
        job_id: message.job_id ?? null,
        reserved_folio: message.reserved_folio ?? null,
        ok: false,
        error: "SIMPLEAPI_DTE_GENERAR_FAILED",
      })));
    return true;
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR") {
    const origin = sender.url ? new URL(sender.url).origin : "";
    emitSimpleApiDteFromVault({ appOrigin: origin, input: message.input, jobId: message.job_id, reservedFolio: message.reserved_folio })
      .then((response) => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR_RESULT",
        job_id: message.job_id ?? null,
        reserved_folio: message.reserved_folio ?? null,
        ...response,
      })))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR_RESULT",
        job_id: message.job_id ?? null,
        reserved_folio: message.reserved_folio ?? null,
        ok: false,
        error: "SIMPLEAPI_DTE_EMITIR_FAILED",
      })));
    return true;
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART") {
    const origin = sender.url ? new URL(sender.url).origin : "";
    postSimpleApiMultipartProxy({ appOrigin: origin, path: message.path, input: message.input, files: message.files, jobId: message.job_id })
      .then((response) => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART_RESULT",
        job_id: message.job_id ?? null,
        path: message.path,
        ...response,
      })))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART_RESULT",
        job_id: message.job_id ?? null,
        path: message.path,
        ok: false,
        error: "SIMPLEAPI_PROXY_MULTIPART_FAILED",
      })));
    return true;
  }

  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [jobId, state] of activeJobs.entries()) {
    if (state.workerWindowId !== windowId) continue;
    activeJobs.delete(jobId);
    // Post-emit: no cerrar el job (perdería el folio). Pero si el guardado YA se
    // confirmó, no mandar nada — pisar "Boleta emitida" con "sin resolver" por
    // cerrar la ventana con la X asustaba y volvía a bloquear el botón.
    if (state.finalEmitClicked) {
      if (!state.resultPersisted) {
        sendToApp(state, statusMessage(jobId, "result_needs_review", "Cerraste la ventana tras emitir y la boleta aún no se confirma guardada. Se guardará sola al volver a la app; no re-emitas.", true));
      }
      continue;
    }
    sendToApp(state, statusMessage(jobId, "cancelled", "La ventana segura SII fue cerrada.", true));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  for (const state of activeJobs.values()) {
    if (state.workerTabId !== tabId) continue;
    const url = tab.url || "";
    if (!/^https:\/\/([^/]+\.)?sii\.cl\//.test(url)) {
      // Post-emit: no cerrar el job por salir del dominio (descarga de PDF, compartir,
      // logout) — un folio ya pudo emitirse. Estado no-cerrante para capturar/ingresar.
      if (state.finalEmitClicked) {
        pauseWorker(state, "Saliste del dominio SII tras emitir. Si ves el folio, usa Capturar folio o ingrésalo. NO re-emitas.");
        sendToApp(state, statusMessage(state.jobId, "result_needs_review", "Saliste del dominio SII tras emitir. Captura o ingresa el folio para no perderlo; no re-emitas.", true));
        continue;
      }
      pauseWorker(state, "La ventana segura salio del dominio SII.");
      sendToApp(state, statusMessage(state.jobId, "error", "La ventana segura salio del dominio SII.", true));
      continue;
    }
    sendToSii(tabId, {
      type: "APP_CONTABLE_SII_WORKER_OVERLAY",
      job_id: state.jobId,
      mode: state.learnOnly || state.humanRequired ? "HUMAN_REQUIRED" : "LOCKED_AUTOMATION",
      message: state.learnOnly
        ? "Modo aprendizaje activo. Navega SII normalmente; no se emitira desde la extension."
        : state.humanRequired
          ? "Inicia sesion en SII. No cierres esta ventana. Continuaremos automaticamente al entrar a e-Boleta."
          : "SII cargo una nueva pantalla. La extension continuara automaticamente si el portal esta listo.",
    });
    scanWorkerPage(state);
  }
});
