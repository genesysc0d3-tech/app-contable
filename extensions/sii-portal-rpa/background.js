"use strict";

import { EXTENSION_VERSION, baseMessage, isAllowedAppUrl } from "./modules/core.js";
import { SII_CAPABILITIES, SII_START_URL, isAllowedSiiUrl, validateSiiBoletaJob } from "./modules/sii-local.js";
import { SII_VAULT_CAPABILITIES, getUnlockedSiiCredentials, handleSiiVaultMessage, siiVaultStatus } from "./modules/sii-vault.js";
import { SIMPLEAPI_CAPABILITIES, emitSimpleApiDteFromVault, generateSimpleApiDteFromVault, handleSimpleApiVaultMessage, postSimpleApiMultipartProxy } from "./modules/simpleapi-vault.js";

const CAPABILITIES = [...SII_CAPABILITIES, ...SII_VAULT_CAPABILITIES, ...SIMPLEAPI_CAPABILITIES];

const activeJobs = new Map();

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
    if (isLoginPageMap(map)) {
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

function isLoginPageMap(map) {
  const text = `${map.url || ""} ${map.title || ""} ${map.body_excerpt || ""}`;
  return /Clave Tributaria|RUT|Ingresar|Autenticaci[oó]n|Inicio de Sesi[oó]n/i.test(text)
    && !/Calculadora|Emitir e-Boleta|e-Boleta power_settings|Cargando Emisores/i.test(text);
}

function focusWorkerForHuman(state, message) {
  state.humanRequired = true;
  if (state.workerWindowId) chrome.windows.update(state.workerWindowId, { focused: true }).catch(() => undefined);
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "HUMAN_REQUIRED",
    message,
  });
  sendToApp(state, statusMessage(state.jobId, "waiting_manual_login", message, true));
}

function attemptSiiAutologin(state) {
  if (state.autologinAttempted) {
    focusWorkerForHuman(state, "No pudimos iniciar sesión automáticamente. SII puede pedir captcha, 2FA, cambio de clave o selección de contribuyente. Inicia sesión manualmente en esta ventana y continuaremos automáticamente.");
    return;
  }

  const credentials = getUnlockedSiiCredentials();
  if (!credentials?.rut || !credentials?.clave) {
    siiVaultStatus()
      .then((status) => {
        const message = status.configured
          ? "SII requiere inicio de sesión, pero la bóveda SII está bloqueada. Abre la extensión, ingresa tu PIN local y presiona Desbloquear; luego reintenta la emisión. También puedes iniciar sesión manualmente aquí."
          : "SII requiere inicio de sesión. Configura la bóveda SII en la extensión o inicia sesión manualmente; continuaremos automáticamente al entrar a e-Boleta.";
        focusWorkerForHuman(state, message);
      })
      .catch(() => focusWorkerForHuman(state, "SII requiere inicio de sesión. Desbloquea la bóveda SII en la extensión o inicia sesión manualmente; continuaremos automáticamente al entrar a e-Boleta."));
    return;
  }

  state.autologinAttempted = true;
  state.humanRequired = false;
  sendToApp(state, statusMessage(state.jobId, "autologin_attempting", "Intentando inicio de sesión SII con la bóveda local desbloqueada.", true));
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "LOCKED_AUTOMATION",
    message: "Intentando iniciar sesión en SII desde la bóveda local. Si SII pide captcha o 2FA, abriremos esta ventana para intervención manual.",
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
      pauseWorker(state, errorMessage);
      sendToApp(state, statusMessage(state.jobId, "error", errorMessage, true));
      return;
    }

    handleCapturedResult(state, captureResponse.result);
  });
}

async function openWorkerWindow(job, appTabId) {
  const worker = await chrome.windows.create({
    url: SII_START_URL,
    type: "popup",
    focused: false,
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
    autologinAttempted: false,
    humanRequired: false,
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

  if (message?.type?.startsWith("APP_CONTABLE_SIMPLEAPI_VAULT_") && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    handleSimpleApiVaultMessage(message)
      .then((response) => sendResponse(baseMessage(response)))
      .catch(() => sendResponse(baseMessage({ type: `${message.type}_RESULT`, ok: false, error: "VAULT_ERROR" })));
    return true;
  }

  if (message?.type?.startsWith("APP_CONTABLE_SII_VAULT_") && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    handleSiiVaultMessage(message)
      .then((response) => sendResponse(baseMessage(response)))
      .catch(() => sendResponse(baseMessage({ type: `${message.type}_RESULT`, ok: false, error: "SII_VAULT_ERROR" })));
    return true;
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

  if (message?.type === "APP_CONTABLE_SII_BOLETA_JOB") {
    const job = message.job;
    const validationError = validateSiiBoletaJob(job);
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
    generateSimpleApiDteFromVault({ appOrigin: origin, input: message.input })
      .then((response) => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_GENERAR_RESULT",
        ...response,
      })))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_GENERAR_RESULT",
        ok: false,
        error: "SIMPLEAPI_DTE_GENERAR_FAILED",
      })));
    return true;
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR") {
    const origin = sender.url ? new URL(sender.url).origin : "";
    emitSimpleApiDteFromVault({ appOrigin: origin, input: message.input })
      .then((response) => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR_RESULT",
        ...response,
      })))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR_RESULT",
        ok: false,
        error: "SIMPLEAPI_DTE_EMITIR_FAILED",
      })));
    return true;
  }

  if (message?.type === "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART") {
    const origin = sender.url ? new URL(sender.url).origin : "";
    postSimpleApiMultipartProxy({ appOrigin: origin, path: message.path, input: message.input, files: message.files })
      .then((response) => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART_RESULT",
        path: message.path,
        ...response,
      })))
      .catch(() => sendResponse(baseMessage({
        type: "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART_RESULT",
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
