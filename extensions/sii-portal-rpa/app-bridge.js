(() => {
  "use strict";

  const APP_SOURCE = "app-contable";
  const EXT_SOURCE = "app-contable-extension";
  const ALLOWED_TYPES = new Set([
    "APP_CONTABLE_EXTENSION_PING",
    "APP_CONTABLE_SII_BOLETA_JOB",
    "APP_CONTABLE_OPEN_EXTENSION_OPTIONS",
    "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS",
    "APP_CONTABLE_SIMPLEAPI_DTE_GENERAR",
    "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR",
    "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART",
  ]);

  function isAllowedOrigin(origin) {
    return origin === "https://app-contable-five.vercel.app" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  }

  function reportBridgeError(data, message) {
    postToPage({
      type: "APP_CONTABLE_SII_JOB_STATUS",
      job_id: data?.job?.job_id ?? data?.job_id ?? null,
      status: "error",
      recoverable: true,
      message,
    });
  }

  function postToPage(message) {
    window.postMessage({ source: EXT_SOURCE, protocol_version: 1, ...message }, window.location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!isAllowedOrigin(event.origin)) return;

    const data = event.data;
    if (!data || data.source !== APP_SOURCE || !ALLOWED_TYPES.has(data.type)) return;

    try {
      chrome.runtime.sendMessage(data, (response) => {
        if (chrome.runtime.lastError) {
          reportBridgeError(data, chrome.runtime.lastError.message || "No se pudo contactar la extension");
          return;
        }

        if (response) postToPage(response);
      });
    } catch (error) {
      reportBridgeError(data, error instanceof Error ? error.message : "Extension no disponible. Recarga la extension y esta pagina.");
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.source !== EXT_SOURCE) return;
    if (message.type === "APP_CONTABLE_SII_PAGE_MAP") {
      fetch("/api/sii-local/page-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: message.job_id ?? null, map: message.map ?? null }),
      }).catch(() => undefined);
    }
    if (message.type === "APP_CONTABLE_SII_JOB_RESULT") {
      fetch("/api/sii-local/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: message.job_id ?? null, result: message.result ?? null }),
      })
        .then((response) => response.json().catch(() => ({ ok: false, error: "BAD_JSON" })))
        .then((persisted) => postToPage({
          ...message,
          result: { ...(message.result ?? {}), persisted },
        }))
        .catch(() => postToPage({
          ...message,
          result: { ...(message.result ?? {}), persisted: { ok: false, error: "PERSISTENCE_FAILED" } },
        }));
      return;
    }
    if (message.type === "APP_CONTABLE_SII_CAPTURE_DEBUG") {
      fetch("/api/sii-local/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: message.job_id ?? null, result: message.result ?? null }),
      }).catch(() => undefined);
      return;
    }
    postToPage(message);
  });
})();
