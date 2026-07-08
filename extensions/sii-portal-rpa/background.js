"use strict";

import { EXTENSION_VERSION, baseMessage, isAllowedAppUrl } from "./modules/core.js";
import { SII_CAPABILITIES, SII_START_URL, isAllowedSiiUrl, validateSiiBoletaJob } from "./modules/sii-local.js";
import { SII_VAULT_CAPABILITIES, getSiiEmpresaRutDefault, getUnlockedSiiCredentials, handleSiiVaultMessage, siiVaultStatus } from "./modules/sii-vault.js";
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
    (result.pdf.source === "extension_session_fetch" || result.pdf.source === "share_capture"),
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
  sendToApp(state, resultMessage(state.jobId, { ...resultWithPdf, job: state.job }, msg));
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
  sendToSii(state.workerTabId, {
    type: "APP_CONTABLE_SII_WORKER_OVERLAY",
    job_id: state.jobId,
    mode: "HUMAN_REQUIRED",
    message,
  });
  sendToApp(state, statusMessage(state.jobId, "waiting_manual_login", message, true));
}

// Cuando el usuario desbloquea (o guarda) la bóveda SII desde las opciones,
// Ventana aislada de desbloqueo (compliant): al llegar un trabajo con la bóveda SII
// bloqueada, la abrimos sola. La clave local se tipea DENTRO de la extensión, nunca en
// la página de la app. Al desbloquear, resumeJobsAfterSiiUnlock continúa la emisión.
let siiUnlockWindowId = null;
function openSiiUnlockWindow() {
  if (siiUnlockWindowId != null) {
    chrome.windows.update(siiUnlockWindowId, { focused: true }, () => {
      if (chrome.runtime.lastError) siiUnlockWindowId = null;
    });
    return;
  }
  chrome.windows.create({
    url: chrome.runtime.getURL("unlock.html"),
    type: "popup",
    width: 400,
    height: 380,
    focused: true,
  }, (win) => {
    siiUnlockWindowId = win?.id ?? null;
  });
}
chrome.windows.onRemoved.addListener((winId) => {
  if (winId === siiUnlockWindowId) siiUnlockWindowId = null;
});

// reanudar solo los trabajos que quedaron esperando login: vuelve a escanear
// la ventana SII, que ahora encontrará credenciales y hará autologin. Esto
// es lo que hace que "desbloquear bóveda" continúe la emisión sin recargar nada.
function resumeJobsAfterSiiUnlock() {
  const credentials = getUnlockedSiiCredentials();
  if (!credentials?.rut || !credentials?.clave) return;
  for (const state of activeJobs.values()) {
    if (state.learnOnly || state.submitted || state.awaitingResult || state.finalEmitClicked) continue;
    state.humanRequired = false;
    state.autologinAttempted = false; // permitir un intento limpio ahora que hay clave
    sendToApp(state, statusMessage(state.jobId, "autologin_attempting", "Bóveda desbloqueada: reanudando inicio de sesión SII automático.", true));
    sendToSii(state.workerTabId, {
      type: "APP_CONTABLE_SII_WORKER_OVERLAY",
      job_id: state.jobId,
      mode: "LOCKED_AUTOMATION",
      message: "Bóveda desbloqueada. Reanudando inicio de sesión automático en SII.",
    });
    scanWorkerPage(state);
  }
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
        if (status.configured) {
          // Bóveda configurada pero bloqueada: abrir SOLO el mini-prompt de desbloqueo
          // (aislado en la extensión) — sin "mil pasos". Al desbloquear, la emisión sigue.
          openSiiUnlockWindow();
          focusWorkerForHuman(state, "Abrimos una ventana para desbloquear tu bóveda local: ingresa tu clave ahí y la emisión sigue sola. (También puedes iniciar sesión a mano aquí.)");
        } else {
          focusWorkerForHuman(state, "SII requiere inicio de sesión. Configura la bóveda SII en la extensión o inicia sesión manualmente; continuaremos automáticamente al entrar a e-Boleta.");
        }
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
    // Candado monótono: una vez que se cliqueó el EMITIR real, NUNCA se re-emite ni
    // se cierra el trabajo por "error" — solo se captura/recupera el folio.
    finalEmitClicked: false,
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

  // Aviso inmediato del worker: el EMITIR real ya se cliqueó. Arma el candado AL
  // INSTANTE (no espera la confirmación de 16s), así ninguna ruta de error post-emit
  // (captura, salida de dominio, ventana cerrada) cierra el job ni permite re-emitir.
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
    handleSiiVaultMessage(message)
      .then((response) => {
        sendResponse(baseMessage(response));
        // Desbloqueo o guardado exitoso → reanudar trabajos en espera de login.
        if ((message.type === "APP_CONTABLE_SII_VAULT_UNLOCK" || message.type === "APP_CONTABLE_SII_VAULT_SAVE") && response?.ok) {
          resumeJobsAfterSiiUnlock();
        }
      })
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
    // Override explícito del usuario: si configuró un RUT de empresa emisora en la
    // extensión, ESE manda (caso p.ej. cuenta con varias personas jurídicas donde la app
    // no puede saber cuál). Vacío = manda el emisor_rut que trae la app. La validación
    // (incluye el gate de emisor) corre DESPUÉS del override, sobre el RUT final.
    getSiiEmpresaRutDefault()
      .then((configEmpresaRut) => {
        if (configEmpresaRut) job.emisor_rut = configEmpresaRut;
        const validationError = validateSiiBoletaJob(job);
        if (validationError) {
          sendResponse(statusMessage(job?.job_id ?? null, "error", validationError, true));
          return;
        }
        return openWorkerWindow(job, sender.tab?.id).then((state) => {
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
    // Post-emit: no cerrar el job (perdería el folio). Pedir el folio a mano; el
    // backfill del servidor lo registra con evidencia fuerte aunque el job cierre.
    if (state.finalEmitClicked) {
      sendToApp(state, statusMessage(jobId, "result_needs_review", "Cerraste la ventana tras emitir. Si viste el folio, ingrésalo abajo para no perder la boleta; no re-emitas.", true));
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
