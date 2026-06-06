"use strict";

const EXT_SOURCE = "app-contable-extension";
const PROTOCOL_VERSION = 1;
const EXTENSION_VERSION = "0.1.0";
const SII_START_URL = "https://eboleta.sii.cl/emitir/";
const CAPABILITIES = [
  "sii_portal_boleta_39",
  "sii_portal_boleta_41",
  "dedicated_worker_window",
  "learn_only",
  "auto_emit",
  "result_capture",
  "pdf_byte_capture",
];

const activeJobs = new Map();

function isAllowedAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://app-contable-five.vercel.app" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(parsed.origin);
  } catch {
    return false;
  }
}

function isAllowedSiiUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /(^|\.)sii\.cl$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

function baseMessage(message) {
  return {
    source: EXT_SOURCE,
    protocol_version: PROTOCOL_VERSION,
    ...message,
  };
}

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
    result.pdf.source === "extension_session_fetch",
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
  let resultWithPdf = result;
  if (hasStrongFolioEvidence(result)) {
    try {
      const pdf = await capturePdfBytes(result);
      resultWithPdf = pdf ? { ...result, pdf } : result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const message = `SII entrego folio ${result?.folio}, pero no pude descargar el PDF localmente (${errorMessage}). No se marcara como emitida.`;
      sendToApp(state, captureDebugMessage(state.jobId, { ...result, pdf_capture_error: errorMessage }, message));
      pauseWorker(state, message);
      sendToApp(state, statusMessage(state.jobId, "result_needs_review", message, true));
      return;
    }
  }

  if (!hasStrongFolioEvidence(resultWithPdf) || !hasCapturedPdf(resultWithPdf)) {
    const reason = resultWithPdf?.folio
      ? hasStrongFolioEvidence(resultWithPdf)
        ? "PDF SII no descargado"
        : `folio ${resultWithPdf.folio} con evidencia insuficiente (${resultWithPdf.folio_confidence || "sin confianza"})`
      : "folio no detectado";
    sendToApp(state, captureDebugMessage(state.jobId, resultWithPdf, `Resultado SII requiere revision: ${reason}.`));
    pauseWorker(state, `SII respondio, pero ${reason}. No se marcara como emitida.`);
    sendToApp(state, statusMessage(state.jobId, "result_needs_review", `Resultado SII requiere revision: ${reason}.`, true));
    return;
  }

  sendToApp(state, resultMessage(state.jobId, { ...resultWithPdf, job: state.job }, "Boleta emitida en SII."));
  state.awaitingResult = false;
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "DONE",
    message: resultWithPdf?.folio ? `Boleta emitida. Folio ${resultWithPdf.folio}. PDF capturado.` : "Resultado SII capturado.",
  });
}

async function sendToApp(jobState, message) {
  if (!jobState?.appTabId) return;
  try {
    await chrome.tabs.sendMessage(jobState.appTabId, message);
  } catch {
    // The app tab may have been closed; the job remains recoverable from the app.
  }
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
  }
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
    if (state.awaitingResult) {
      sendToApp(state, statusMessage(state.jobId, "capturing_result", "Reintentando captura de resultado SII.", true));
      captureWorkerResult(state);
      sendResponse?.({ ok: true });
      return false;
    }

    state.filledDraft = false;
    state.submitted = false;
    sendToApp(state, statusMessage(state.jobId, "retrying", "Reintentando deteccion de e-Boleta.", true));
    scanWorkerPage(state);
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.action === "capture") {
    state.awaitingResult = true;
    sendToApp(state, statusMessage(state.jobId, "capturing_result", "Capturando folio desde la pantalla SII actual.", true));
    captureWorkerResult(state);
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.action === "cancel") {
    sendToApp(state, statusMessage(state.jobId, "cancelled", "Operacion SII cancelada por el usuario.", true));
    closeWorker(state);
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.action === "close") {
    sendToApp(state, statusMessage(state.jobId, "closed", "Ventana segura SII cerrada.", false));
    closeWorker(state);
    sendResponse?.({ ok: true });
    return false;
  }

  sendResponse?.({ ok: false, error: "ACTION_INVALID" });
  return false;
}

function scanWorkerPage(state, attempt = 1) {
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

    const excerpt = String(map.body_excerpt || "");
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
    if (!state.submitted && hasEmitButton && hasNumberPad) {
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
      pauseWorker(state, errorMessage);
      sendToApp(state, statusMessage(state.jobId, "error", errorMessage, true));
      return;
    }

    handleCapturedResult(state, captureResponse.result);
  });
}

function validateJob(job) {
  if (!job || typeof job !== "object") return "JOB_INVALID";
  if (!job.job_id || typeof job.job_id !== "string") return "JOB_ID_MISSING";
  if (job.tipo_dte !== 39 && job.tipo_dte !== 41) return "TIPO_DTE_INVALID";
  if (!job.expires_at || Number.isNaN(Date.parse(job.expires_at))) return "EXPIRES_AT_INVALID";
  if (Date.parse(job.expires_at) <= Date.now()) return "JOB_EXPIRED";
  if (job.learn_only !== true && job.auto_emit !== true) return "AUTO_EMIT_OR_LEARN_ONLY_REQUIRED";
  return null;
}

async function openWorkerWindow(job, appTabId) {
  const worker = await chrome.windows.create({
    url: SII_START_URL,
    type: "popup",
    focused: true,
    width: 1120,
    height: 820,
  });

  const workerTabId = worker.tabs?.[0]?.id;
  if (!worker.id || !workerTabId) throw new Error("SII_WORKER_WINDOW_FAILED");

  const state = {
    jobId: job.job_id,
    job,
    appTabId,
    workerWindowId: worker.id,
    workerTabId,
    createdAt: new Date().toISOString(),
    learnOnly: job.learn_only === true,
    learningScanCount: 0,
    learningTimer: null,
    filledDraft: false,
    submitted: false,
    awaitingResult: false,
  };
  activeJobs.set(job.job_id, state);

  await sendToSii(workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: job.job_id,
    mode: "HUMAN_REQUIRED",
    message: state.learnOnly
      ? "Modo aprendizaje: inicia sesion y navega el flujo SII. La extension solo observa mapas sanitizados; no emitira."
      : "Inicia sesion en SII. Cuando estes dentro, vuelve a App Contable para continuar.",
  });

  return state;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "APP_CONTABLE_SII_WORKER_ACTION" && isAllowedSiiUrl(sender.url || "")) {
    return handleWorkerAction(message, sender, sendResponse);
  }

  if (!isAllowedAppUrl(sender.url || "")) return false;

  if (message?.type === "APP_CONTABLE_EXTENSION_PING") {
    sendResponse(baseMessage({
      type: "APP_CONTABLE_EXTENSION_PONG",
      extension_version: EXTENSION_VERSION,
      capabilities: CAPABILITIES,
      nonce: message.nonce,
    }));
    return false;
  }

  if (message?.type === "APP_CONTABLE_SII_BOLETA_JOB") {
    const job = message.job;
    const validationError = validateJob(job);
    if (validationError) {
      sendResponse(statusMessage(job?.job_id ?? null, "error", validationError, true));
      return false;
    }

    openWorkerWindow(job, sender.tab?.id)
      .then((state) => {
        sendResponse(statusMessage(job.job_id, "opening_sii", "Ventana segura SII creada.", true));
        sendToApp(state, statusMessage(
          job.job_id,
          "waiting_sii_login",
          state.learnOnly ? "Modo aprendizaje activo. Inicia sesion y navega el flujo SII." : "Inicia sesion en la ventana SII dedicada.",
          true,
        ));
      })
      .catch((error) => {
        sendResponse(statusMessage(job.job_id, "error", error instanceof Error ? error.message : String(error), true));
      });

    return true;
  }

  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [jobId, state] of activeJobs.entries()) {
    if (state.workerWindowId !== windowId) continue;
    activeJobs.delete(jobId);
    sendToApp(state, statusMessage(jobId, "cancelled", "La ventana segura SII fue cerrada.", true));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  for (const state of activeJobs.values()) {
    if (state.workerTabId !== tabId) continue;
    const url = tab.url || "";
    if (!/^https:\/\/([^/]+\.)?sii\.cl\//.test(url)) {
      pauseWorker(state, "La ventana segura salio del dominio SII.");
      sendToApp(state, statusMessage(state.jobId, "error", "La ventana segura salio del dominio SII.", true));
      continue;
    }
    sendToSii(tabId, {
      type: "APP_CONTABLE_SII_WORKER_OVERLAY",
      job_id: state.jobId,
      mode: "HUMAN_REQUIRED",
      message: state.learnOnly
        ? "Modo aprendizaje activo. Navega SII normalmente; no se emitira desde la extension."
        : "Inicia sesion en SII. No cierres esta ventana.",
    });
    scanWorkerPage(state);
  }
});
