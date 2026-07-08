(() => {
  "use strict";

  const siiText = document.getElementById("sii-text");
  const siiDetail = document.getElementById("sii-detail");
  const siiDot = document.getElementById("sii-dot");
  const simpleapiText = document.getElementById("simpleapi-text");
  const simpleapiDetail = document.getElementById("simpleapi-detail");
  const simpleapiDot = document.getElementById("simpleapi-dot");
  const openOptions = document.getElementById("open-options");

  function isVaultReady(status) {
    return Boolean(status?.configured && status?.encrypted && status?.has_pfx && status?.has_caf);
  }

  function detailForStatus(status) {
    return [
      status?.has_pfx ? "certificado OK" : "falta certificado",
      status?.has_caf ? "CAF OK" : "falta CAF",
      status?.unlocked ? "desbloqueada" : "bloqueada",
    ].join(" · ");
  }

  function siiDetailForStatus(status) {
    return [
      status?.has_rut ? "RUT OK" : "falta RUT",
      status?.has_clave ? "clave cifrada" : "falta clave",
      status?.unlocked ? "desbloqueada" : "bloqueada",
    ].join(" · ");
  }

  // El TEXTO carga el estado, no sólo el color del punto. Sin parpadeo.
  function paint(dot, textEl, detailEl, dotClass, stateClass, text, detail) {
    dot.className = "dot " + dotClass;
    textEl.className = "state" + (stateClass ? " " + stateClass : "");
    textEl.textContent = text;
    detailEl.textContent = detail;
  }

  function setSiiState(state, status) {
    if (state === "ready") paint(siiDot, siiText, siiDetail, "dot-green", "ready", "Listo para emitir", siiDetailForStatus(status));
    else if (state === "pending") paint(siiDot, siiText, siiDetail, "dot-yellow", "pending", "Falta configurar", siiDetailForStatus(status));
    else paint(siiDot, siiText, siiDetail, "dot-red", "", "No se pudo leer", "Abre la extensión y reintenta.");
  }

  function setSimpleApiState(state, status) {
    if (state === "locked") paint(simpleapiDot, simpleapiText, simpleapiDetail, "dot-idle", "locked", "No disponible aún", "Se habilita desde tu empresa.");
    else if (state === "ready") paint(simpleapiDot, simpleapiText, simpleapiDetail, "dot-green", "ready", "Listo para emitir", detailForStatus(status));
    else if (state === "pending") paint(simpleapiDot, simpleapiText, simpleapiDetail, "dot-yellow", "pending", "Falta configurar", detailForStatus(status));
    else paint(simpleapiDot, simpleapiText, simpleapiDetail, "dot-red", "", "No se pudo leer", "Abre la extensión y reintenta.");
  }

  function refreshSii() {
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        setSiiState("error", null);
        return;
      }
      const s = response.status;
      setSiiState(s.configured && s.encrypted && s.has_rut && s.has_clave ? "ready" : "pending", s);
    });
  }

  function refreshSimpleApi() {
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        setSimpleApiState("error", null);
        return;
      }
      setSimpleApiState(isVaultReady(response.status) ? "ready" : "pending", response.status);
    });
  }

  function refreshStatus() {
    refreshSii();
    // Facturas: bloqueado hasta que la empresa lo habilite (mismo flag que la app).
    chrome.storage?.local?.get?.(["facturas_habilitado"], (data) => {
      if (!chrome.runtime.lastError && data?.facturas_habilitado === true) refreshSimpleApi();
      else setSimpleApiState("locked", null);
    });
  }

  openOptions?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  refreshStatus();
})();
