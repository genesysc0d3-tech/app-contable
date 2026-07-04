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
      status?.has_pfx ? "PFX OK" : "falta PFX",
      status?.has_caf ? "CAF OK" : "falta CAF",
      status?.encrypted ? "cifrado local activo" : "sin cifrado local",
      status?.unlocked ? "desbloqueada" : "bloqueada",
    ].join(", ");
  }

  function siiDetailForStatus(status) {
    return [
      status?.has_rut ? "RUT OK" : "falta RUT",
      status?.has_clave ? "clave cifrada" : "falta clave",
      status?.encrypted ? "cifrado local activo" : "sin bóveda cifrada",
      status?.unlocked ? "desbloqueada" : "bloqueada",
    ].join(", ");
  }

  function setSiiState(state, status) {
    siiDot.className = "dot";
    if (state === "ready") {
      siiText.textContent = "Disponible";
      siiDetail.textContent = siiDetailForStatus(status);
      siiText.classList.add("ready");
      siiDot.classList.add("dot-green");
    } else if (state === "pending") {
      siiText.textContent = "Disponible";
      siiDetail.textContent = siiDetailForStatus(status);
      siiText.classList.remove("ready");
      siiDot.classList.add("dot-yellow");
    } else {
      siiText.textContent = "Error";
      siiDetail.textContent = "No se pudo leer la bóveda SII.";
      siiText.classList.remove("ready");
      siiDot.classList.add("dot-red");
    }
  }

  function setSimpleApiState(state, status) {
    simpleapiDot.className = "dot";
    if (state === "ready") {
      simpleapiText.textContent = "Boveda configurada";
      simpleapiDetail.textContent = detailForStatus(status);
      simpleapiText.classList.add("ready");
      simpleapiDot.classList.add("dot-green");
    } else if (state === "pending") {
      simpleapiText.textContent = "Boveda pendiente";
      simpleapiDetail.textContent = detailForStatus(status);
      simpleapiText.classList.remove("ready");
      simpleapiDot.classList.add("dot-yellow");
    } else {
      simpleapiText.textContent = "Error";
      simpleapiDetail.textContent = "No se pudo leer el estado local.";
      simpleapiText.classList.remove("ready");
      simpleapiDot.classList.add("dot-red");
    }
  }

  function refreshStatus() {
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        setSiiState("error", null);
        return;
      }
      if (response.status?.configured && response.status?.encrypted && response.status?.has_rut && response.status?.has_clave) {
        setSiiState("ready", response.status);
      } else {
        setSiiState("pending", response.status);
      }
    });

    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        setSimpleApiState("error", null);
        return;
      }
      if (isVaultReady(response.status)) {
        setSimpleApiState("ready", response.status);
      } else {
        setSimpleApiState("pending", response.status);
      }
    });
  }

  openOptions?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  refreshStatus();
})();
