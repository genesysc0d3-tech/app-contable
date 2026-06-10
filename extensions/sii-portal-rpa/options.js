(() => {
  "use strict";

  const elements = {
    globalStatus: document.getElementById("global-status"),
    siiDiagnostic: document.getElementById("sii-diagnostic"),
    siiVaultForm: document.getElementById("sii-vault-form"),
    siiRut: document.getElementById("sii-rut"),
    siiClave: document.getElementById("sii-clave"),
    siiPin: document.getElementById("sii-pin"),
    siiVaultRut: document.getElementById("sii-vault-rut"),
    siiVaultClave: document.getElementById("sii-vault-clave"),
    siiVaultEncrypted: document.getElementById("sii-vault-encrypted"),
    siiVaultUnlocked: document.getElementById("sii-vault-unlocked"),
    saveSiiVault: document.getElementById("save-sii-vault"),
    unlockSiiVault: document.getElementById("unlock-sii-vault"),
    clearSiiVault: document.getElementById("clear-sii-vault"),
    simpleApiStatusLabel: document.getElementById("simpleapi-status-label"),
    vaultPfx: document.getElementById("vault-pfx"),
    vaultCaf: document.getElementById("vault-caf"),
    vaultEncrypted: document.getElementById("vault-encrypted"),
    vaultUpdated: document.getElementById("vault-updated"),
    vaultUnlocked: document.getElementById("vault-unlocked"),
    simpleApiDiagnostic: document.getElementById("simpleapi-diagnostic"),
    vaultForm: document.getElementById("vault-form"),
    pfxFile: document.getElementById("pfx-file"),
    cafFile: document.getElementById("caf-file"),
    certificatePassword: document.getElementById("certificate-password"),
    certificateRut: document.getElementById("certificate-rut"),
    emisorRut: document.getElementById("emisor-rut"),
    resolutionDate: document.getElementById("resolution-date"),
    resolutionNumber: document.getElementById("resolution-number"),
    vaultPassphrase: document.getElementById("vault-passphrase"),
    refreshStatus: document.getElementById("refresh-status"),
    unlockVault: document.getElementById("unlock-vault"),
    clearVault: document.getElementById("clear-vault"),
    configureVault: document.getElementById("configure-vault"),
  };

  function formatDate(value) {
    if (!value) return "Nunca";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Nunca";
    return new Intl.DateTimeFormat("es-CL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function renderStatus(status) {
    const configured = Boolean(status?.configured);
    elements.globalStatus.textContent = "Extensión cargada";
    elements.simpleApiStatusLabel.textContent = configured ? "Configurado" : "Pendiente";
    elements.simpleApiStatusLabel.classList.toggle("module-ready", configured);
    elements.vaultPfx.textContent = status?.has_pfx ? "Configurado" : "Falta";
    elements.vaultCaf.textContent = status?.has_caf ? "Configurado" : "Falta";
    elements.vaultEncrypted.textContent = status?.encrypted ? "Cifrado local activo" : "Sin bóveda cifrada";
    elements.vaultUpdated.textContent = formatDate(status?.updated_at);
    elements.vaultUnlocked.textContent = status?.unlocked ? `Hasta ${formatDate(status.unlocked_until)}` : "Bloqueada";
    elements.simpleApiDiagnostic.textContent = configured
      ? "Bóveda local cifrada en este equipo. Desbloquéala sólo cuando vayas a emitir."
      : "Selecciona PFX, CAF, password y passphrase local. Se cifran sólo cuando presionas Guardar bóveda cifrada.";
  }

  function renderSiiStatus(status) {
    elements.siiVaultRut.textContent = status?.has_rut ? "Configurado" : "Falta";
    elements.siiVaultClave.textContent = status?.has_clave ? "Configurada" : "Falta";
    elements.siiVaultEncrypted.textContent = status?.encrypted ? "Cifrado local activo" : "Sin bóveda cifrada";
    elements.siiVaultUnlocked.textContent = status?.unlocked ? `Hasta ${formatDate(status.unlocked_until)}` : "Bloqueada";
  }

  function requestVaultStatus() {
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        elements.siiDiagnostic.textContent = "No se pudo leer el estado local de SII.";
        return;
      }
      renderSiiStatus(response.status);
    });

    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        elements.globalStatus.textContent = "Extensión cargada, sin estado";
        elements.simpleApiDiagnostic.textContent = "No se pudo leer el estado local de SimpleAPI.";
        return;
      }
      renderStatus(response.status);
    });
  }

  elements.refreshStatus?.addEventListener("click", () => {
    elements.siiDiagnostic.textContent = `Extensión cargada. Versión ${chrome.runtime.getManifest().version}. La sesión SII se valida al emitir.`;
    requestVaultStatus();
  });

  elements.siiVaultForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rut = elements.siiRut?.value || "";
    const clave = elements.siiClave?.value || "";
    const pin = elements.siiPin?.value || "";
    if (!rut.trim()) {
      elements.siiDiagnostic.textContent = "Ingresa el RUT SII.";
      return;
    }
    if (!clave) {
      elements.siiDiagnostic.textContent = "Ingresa la Clave Tributaria.";
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      elements.siiDiagnostic.textContent = "El PIN local debe tener 4 números.";
      return;
    }

    elements.saveSiiVault.disabled = true;
    elements.siiDiagnostic.textContent = "Cifrando clave SII localmente...";
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: { rut, clave, pin } }, (response) => {
      elements.saveSiiVault.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        elements.siiDiagnostic.textContent = errorMessage(response?.error || chrome.runtime.lastError?.message || "SII_SAVE_FAILED");
        return;
      }
      elements.siiClave.value = "";
      elements.siiPin.value = "";
      elements.siiDiagnostic.textContent = "Clave SII cifrada y desbloqueada temporalmente por 10 minutos.";
      renderSiiStatus(response.status);
    });
  });

  elements.unlockSiiVault?.addEventListener("click", () => {
    const pin = elements.siiPin?.value || "";
    if (!/^\d{4}$/.test(pin)) {
      elements.siiDiagnostic.textContent = "Ingresa el PIN local de 4 números para desbloquear.";
      return;
    }
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_UNLOCK", pin }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        elements.siiDiagnostic.textContent = errorMessage(response?.error || chrome.runtime.lastError?.message || "SII_UNLOCK_FAILED");
        return;
      }
      elements.siiPin.value = "";
      elements.siiDiagnostic.textContent = "Clave SII desbloqueada temporalmente en memoria por 10 minutos.";
      renderSiiStatus(response.status);
    });
  });

  elements.clearSiiVault?.addEventListener("click", () => {
    const confirmed = window.confirm("Esto elimina la Clave Tributaria cifrada de este navegador. ¿Continuar?");
    if (!confirmed) return;
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_CLEAR" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        elements.siiDiagnostic.textContent = "No se pudo eliminar la bóveda SII.";
        return;
      }
      elements.siiDiagnostic.textContent = "Bóveda SII eliminada.";
      renderSiiStatus(response.status);
    });
  });

  elements.vaultForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      elements.configureVault.disabled = true;
      elements.simpleApiDiagnostic.textContent = "Cifrando bóveda local...";
      const payload = await buildVaultPayload();
      chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_SAVE", payload }, (response) => {
        elements.configureVault.disabled = false;
        if (chrome.runtime.lastError || !response?.ok) {
          elements.simpleApiDiagnostic.textContent = errorMessage(response?.error || chrome.runtime.lastError?.message || "SAVE_FAILED");
          return;
        }
        elements.certificatePassword.value = "";
        elements.vaultPassphrase.value = "";
        renderStatus(response.status);
      });
    } catch (error) {
      elements.configureVault.disabled = false;
      elements.simpleApiDiagnostic.textContent = error instanceof Error ? error.message : "No se pudo preparar la bóveda.";
    }
  });

  elements.unlockVault?.addEventListener("click", () => {
    const passphrase = elements.vaultPassphrase?.value || "";
    if (passphrase.length < 10) {
      elements.simpleApiDiagnostic.textContent = "Ingresa la passphrase local para desbloquear. Mínimo 10 caracteres.";
      return;
    }
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_UNLOCK", passphrase }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        elements.simpleApiDiagnostic.textContent = errorMessage(response?.error || chrome.runtime.lastError?.message || "UNLOCK_FAILED");
        return;
      }
      elements.vaultPassphrase.value = "";
      elements.simpleApiDiagnostic.textContent = "Bóveda desbloqueada temporalmente en memoria por 10 minutos.";
      renderStatus(response.status);
    });
  });

  elements.clearVault?.addEventListener("click", () => {
    const confirmed = window.confirm("Esto elimina la bóveda local cifrada de este navegador. Tendrás que cargar nuevamente PFX y CAF. ¿Continuar?");
    if (!confirmed) return;
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_CLEAR" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        elements.simpleApiDiagnostic.textContent = "No se pudo eliminar la bóveda local.";
        return;
      }
      elements.simpleApiDiagnostic.textContent = "Bóveda local eliminada.";
      renderStatus(response.status);
    });
  });

  requestVaultStatus();

  async function buildVaultPayload() {
    const pfx = firstFile(elements.pfxFile);
    const caf = firstFile(elements.cafFile);
    const certificatePassword = elements.certificatePassword?.value || "";
    const certificateRut = elements.certificateRut?.value || "";
    const emisorRut = elements.emisorRut?.value || "";
    const resolutionDate = elements.resolutionDate?.value || "";
    const resolutionNumber = Number(elements.resolutionNumber?.value || "0");
    const passphrase = elements.vaultPassphrase?.value || "";
    if (!pfx) throw new Error("Selecciona el certificado PFX.");
    if (!caf) throw new Error("Selecciona el CAF XML.");
    if (!certificatePassword) throw new Error("Ingresa el password del certificado.");
    if (!certificateRut.trim()) throw new Error("Ingresa el RUT del certificado.");
    if (!emisorRut.trim()) throw new Error("Ingresa el RUT emisor.");
    if (!resolutionDate) throw new Error("Ingresa la fecha de resolución SII.");
    if (!Number.isInteger(resolutionNumber) || resolutionNumber < 0) throw new Error("Ingresa un número de resolución válido.");
    if (passphrase.length < 10) throw new Error("La passphrase local debe tener mínimo 10 caracteres.");
    return {
      pfx_name: pfx.name,
      pfx_base64: await fileToBase64(pfx),
      caf_name: caf.name,
      caf_text: await caf.text(),
      certificate_password: certificatePassword,
      certificate_rut: certificateRut.trim(),
      emisor_rut: emisorRut.trim(),
      resolution_date: resolutionDate,
      resolution_number: resolutionNumber,
      passphrase,
    };
  }

  function firstFile(input) {
    return input?.files?.[0] || null;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || "");
        const [, base64] = value.split(",");
        resolve(base64 || "");
      };
      reader.onerror = () => reject(new Error("No se pudo leer el certificado PFX."));
      reader.readAsDataURL(file);
    });
  }

  function errorMessage(code) {
    const messages = {
      PFX_REQUIRED: "Selecciona el certificado PFX.",
      CAF_REQUIRED: "Selecciona el CAF XML.",
      CERT_PASSWORD_REQUIRED: "Ingresa el password del certificado.",
      CERT_RUT_REQUIRED: "Ingresa el RUT del certificado.",
      EMISOR_RUT_REQUIRED: "Ingresa el RUT emisor.",
      RESOLUTION_DATE_REQUIRED: "Ingresa la fecha de resolución SII.",
      PASSPHRASE_TOO_SHORT: "La passphrase local debe tener mínimo 10 caracteres.",
      PASSPHRASE_INVALID: "Passphrase local incorrecta.",
      VAULT_NOT_CONFIGURED: "Primero guarda la boveda cifrada.",
      RUT_REQUIRED: "Ingresa el RUT SII.",
      CLAVE_REQUIRED: "Ingresa la Clave Tributaria.",
      PIN_INVALID: "El PIN local debe tener 4 números.",
      PFX_TOO_LARGE: "El certificado PFX supera 8 MB.",
      CAF_TOO_LARGE: "El CAF XML supera 8 MB.",
      CAF_INVALID: "El CAF XML no parece contener un rango de folios válido.",
      CAF_TIPO_DTE_MISMATCH: "El CAF cargado no corresponde al tipo de DTE seleccionado.",
      CAF_FOLIO_RANGE_EXHAUSTED: "El rango de folios del CAF está agotado.",
    };
    return messages[code] || "No se pudo guardar la boveda local.";
  }
})();
