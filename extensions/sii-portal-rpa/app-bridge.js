(() => {
  "use strict";

  const APP_SOURCE = "app-contable";
  const EXT_SOURCE = "app-contable-extension";

  // GUARDIA DE GENERACIÓN (cazado en vivo 2026-08-27, primer lote real).
  // Cuando la extensión se ACTUALIZA (auto-update de la store o recarga en dev),
  // el service worker reinyecta este archivo en las pestañas abiertas para que la
  // app siga funcionando sin recargar. Pero el puente VIEJO sigue escuchando: su
  // `chrome.runtime.sendMessage` ya no existe y lanza "Extension context
  // invalidated", que la app leía como FALLO de emisión — con la factura
  // emitiéndose de verdad en paralelo (folio 966).
  // Ahora cada inyección toma un número; solo la ÚLTIMA atiende. Las viejas
  // quedan inertes y calladas.
  const GEN = (window.__massdteBridgeGen = (window.__massdteBridgeGen ?? 0) + 1);
  const soyElVigente = () => window.__massdteBridgeGen === GEN;

  /** ¿El error es "me quedé sin extensión" (contexto invalidado)? */
  function esContextoInvalidado(error) {
    const texto = String(error?.message ?? error ?? "");
    return /context invalidated|Extension context|message port closed/i.test(texto);
  }
  const ALLOWED_TYPES = new Set([
    "APP_CONTABLE_EXTENSION_PING",
    "APP_CONTABLE_SII_BOLETA_JOB",
    // 0.2.0 — job de FACTURA (33/34, Sistema de Facturación Gratuito).
    "APP_CONTABLE_SII_FACT_JOB",
    "APP_CONTABLE_SII_JOB_CLOSE",
    "APP_CONTABLE_SII_VAULT_LOCAL_WIPE",
    "APP_CONTABLE_OPEN_EXTENSION_OPTIONS",
    "APP_CONTABLE_OPEN_EXTENSIONS_PAGE",
    "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS",
    "APP_CONTABLE_SIMPLEAPI_DTE_GENERAR",
    "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR",
    "APP_CONTABLE_SIMPLEAPI_PROXY_MULTIPART",
  ]);

  function isAllowedOrigin(origin) {
    // Transición de dominio: se aceptan el host nuevo (app.massdte.cl) y el viejo.
    return origin === "https://app.massdte.cl" || origin === "https://app-contable-five.vercel.app" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
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

  /**
   * La extensión se actualizó mientras la app la usaba. Estado NO terminal a
   * propósito: si había una emisión en vuelo, el folio puede existir — la app
   * debe verificar, nunca dar por fallido.
   */
  function reportBridgeRecargada(data) {
    postToPage({
      type: "APP_CONTABLE_SII_JOB_STATUS",
      job_id: data?.job?.job_id ?? data?.job_id ?? null,
      status: "extension_recargada",
      recoverable: true,
      message: "La extensión se actualizó. Recarga esta pestaña; si había una emisión en curso, verifica el folio antes de reintentar.",
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
    if (!soyElVigente()) return; // puente viejo tras una actualización: mudo

    // JOB_CLOSE es fire-and-forget: su fallo NO se reporta como status "error".
    // Reportarlo creaba un BUCLE infinito con la app cuando la extensión quedaba
    // huérfana (recargada/deshabilitada): error → JOB_CLOSE → error → JOB_CLOSE…
    const fireAndForget = data.type === "APP_CONTABLE_SII_JOB_CLOSE";
    try {
      chrome.runtime.sendMessage(data, (response) => {
        if (chrome.runtime.lastError) {
          // Contexto invalidado = la extensión se actualizó bajo los pies. NO es
          // un fallo de emisión: el trabajo puede estar corriendo. Se avisa con
          // un estado propio para que la app NO lo cuente como "no se emitió".
          if (esContextoInvalidado(chrome.runtime.lastError)) {
            if (!fireAndForget) reportBridgeRecargada(data);
            return;
          }
          if (!fireAndForget) reportBridgeError(data, chrome.runtime.lastError.message || "No se pudo contactar la extension");
          return;
        }

        if (response) postToPage(response);
      });
    } catch (error) {
      if (fireAndForget) return;
      if (esContextoInvalidado(error)) { reportBridgeRecargada(data); return; }
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
        // extension_version: telemetría de flota — el server anota qué versión
        // corre cada empresa (ext_last_version) sin preguntarle a nadie.
        body: JSON.stringify({ job_id: message.job_id ?? null, result: message.result ?? null, extension_version: chrome.runtime.getManifest().version }),
      })
        .then((response) => response.json().catch(() => ({ ok: false, error: "BAD_JSON" })))
        .then((persisted) => {
          // Ack al service worker: con ok=true limpia el stash anti-pérdida y marca
          // el job como guardado (desarma los avisos "sin resolver" al cerrar la
          // ventana). Sin ack, el stash reintenta en el próximo ping de la app.
          try {
            chrome.runtime.sendMessage({
              source: EXT_SOURCE,
              type: "APP_CONTABLE_SII_RESULT_PERSISTED",
              job_id: message.job_id ?? null,
              ok: persisted?.ok === true,
              error: persisted?.error ?? null,
            }, () => { void chrome.runtime.lastError; });
          } catch {
            // Extensión recargada: el stash reintenta solo.
          }
          postToPage({
            ...message,
            result: { ...(message.result ?? {}), persisted },
          });
        })
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
