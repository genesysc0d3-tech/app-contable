(() => {
  "use strict";

  const elements = {
    siiStatusLabel: document.getElementById("sii-status-label"),
    siiDiagnostic: document.getElementById("sii-diagnostic"),
    siiVaultForm: document.getElementById("sii-vault-form"),
    siiRut: document.getElementById("sii-rut"),
    siiClave: document.getElementById("sii-clave"),
    // Card Facturas: la clave del certificado digital (bóveda compartida).
    siiCertForm: document.getElementById("sii-cert-form"),
    siiClaveCert: document.getElementById("sii-clave-cert"),
    siiVaultClaveCert: document.getElementById("sii-vault-clave-cert"),
    saveSiiCert: document.getElementById("save-sii-cert"),
    siiCertDiagnostic: document.getElementById("sii-cert-diagnostic"),
    siiPin: document.getElementById("sii-pin"),
    siiVaultRut: document.getElementById("sii-vault-rut"),
    siiVaultClave: document.getElementById("sii-vault-clave"),
    siiVaultEncrypted: document.getElementById("sii-vault-encrypted"),
    siiVaultUnlocked: document.getElementById("sii-vault-unlocked"),
    saveSiiVault: document.getElementById("save-sii-vault"),
    unlockSiiVault: document.getElementById("unlock-sii-vault"),
    clearSiiVault: document.getElementById("clear-sii-vault"),
    // Facturas (SimpleAPI) — bloqueado hasta habilitar en la empresa
    simpleApiCard: document.getElementById("simpleapi-card"),
    simpleApiLock: document.getElementById("simpleapi-lock"),
    simpleApiConfig: document.getElementById("simpleapi-config"),
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
    siiEnvironment: document.getElementById("sii-environment"),
    vaultAmbiente: document.getElementById("vault-ambiente"),
    vaultPassphrase: document.getElementById("vault-passphrase"),
    refreshStatus: document.getElementById("refresh-status"),
    unlockVault: document.getElementById("unlock-vault"),
    clearVault: document.getElementById("clear-vault"),
    configureVault: document.getElementById("configure-vault"),
  };

  // Feedback semántico: éxito (verde), error (rojo) o neutro (gris).
  function setDiag(el, kind, text) {
    if (!el) return;
    el.classList.remove("diag-ok", "diag-error");
    if (kind === "ok") el.classList.add("diag-ok");
    else if (kind === "error") el.classList.add("diag-error");
    el.textContent = text;
  }

  function formatDate(value) {
    if (!value) return "Nunca";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Nunca";
    return new Intl.DateTimeFormat("es-CL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  // ---- Estado honesto de los módulos: el verde se gana ----
  function setModuleStatus(label, ready, texts) {
    if (!label) return;
    label.textContent = ready ? texts.ready : texts.pending;
    label.classList.toggle("module-ready", ready);
  }

  function renderSiiStatus(status) {
    // Prefill del RUT de empresa guardado (sin pisar lo que el usuario esté tipeando).
    elements.siiVaultRut.textContent = status?.has_rut ? "Configurado" : "Falta";
    elements.siiVaultClave.textContent = status?.has_clave ? "Configurada" : "Falta";
    if (elements.siiVaultClaveCert) {
      elements.siiVaultClaveCert.textContent = status?.has_clave_certificado ? "Configurada" : "Falta";
    }
    // El estado de la card Facturas lo manda la clave del certificado (el
    // carril del portal gratuito); el carril avanzado SimpleAPI tiene su
    // propia grilla interna.
    setModuleStatus(elements.simpleApiStatusLabel, Boolean(status?.has_clave_certificado), {
      ready: "Lista para firmar",
      pending: "Falta la clave del certificado",
    });
    elements.siiVaultEncrypted.textContent = status?.encrypted ? "Activo" : "Sin bóveda";
    // v2: se desbloquea con la sesión de la app, no con passphrase.
    elements.siiVaultUnlocked.textContent = status?.needs_migration
      ? "Reconecta tu clave"
      : status?.configured
        ? (status?.unlocked ? "Lista (sesión activa)" : "Se activa con tu sesión")
        : "Sin conectar";

    const ready = Boolean(status?.has_rut && status?.has_clave && status?.encrypted);
    const partial = Boolean(status?.has_rut || status?.has_clave);
    setModuleStatus(elements.siiStatusLabel, ready, {
      ready: "Conectada — emite sola",
      pending: status?.needs_migration ? "Reconecta tu clave" : partial ? "Falta completar" : "Sin conectar",
    });
  }

  function renderSimpleApiStatus(status) {
    // El label de la card lo maneja renderSiiStatus (clave del certificado);
    // acá solo la grilla del carril avanzado SimpleAPI.
    elements.vaultPfx.textContent = status?.has_pfx ? "Configurado" : "Falta";
    elements.vaultCaf.textContent = status?.has_caf ? "Configurado" : "Falta";
    elements.vaultEncrypted.textContent = status?.encrypted ? "Activo" : "Sin bóveda";
    elements.vaultAmbiente.textContent = status?.ambiente === 1 ? "Producción" : "Certificación";
    elements.vaultUpdated.textContent = formatDate(status?.updated_at);
    elements.vaultUnlocked.textContent = status?.unlocked ? `Hasta ${formatDate(status.unlocked_until)}` : "Bloqueada";
    setDiag(elements.simpleApiDiagnostic, "info", status?.encrypted
      ? "Bóveda local cifrada en este equipo. Desbloquéala sólo cuando vayas a emitir."
      : "Sube tu certificado, CAF y clave local. Se cifran sólo cuando presionas Guardar bóveda cifrada.");
  }

  function requestSiiStatus() {
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        setDiag(elements.siiDiagnostic, "error", "No se pudo leer el estado local del SII.");
        return;
      }
      renderSiiStatus(response.status);
    });
  }

  function requestSimpleApiStatus() {
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response?.status) {
        setDiag(elements.simpleApiDiagnostic, "error", "No se pudo leer el estado local de Facturas.");
        return;
      }
      renderSimpleApiStatus(response.status);
    });
  }

  // ---- Facturas: bloqueado hasta que la empresa lo habilite ----
  // Un solo origen de verdad: el flag `facturasProveedor` de la empresa. La app lo
  // escribe en chrome.storage.local cuando actualizas la config de tu empresa; acá
  // sólo lo leemos. Mientras esté en false, la sección se muestra bloqueada.
  function applyFacturasHabilitado(habilitado) {
    // La card ya no se "apaga" entera: el carril del portal gratuito (clave
    // del certificado) siempre está disponible; el candado es solo para la
    // sección avanzada SimpleAPI (.pfx + CAF).
    elements.simpleApiLock?.classList.toggle("hidden", habilitado);
    elements.simpleApiConfig?.classList.toggle("hidden", !habilitado);
    if (!habilitado) {
      setModuleStatus(elements.simpleApiStatusLabel, false, { ready: "", pending: "No disponible aún" });
    } else {
      requestSimpleApiStatus();
    }
  }

  function loadFacturasFlag() {
    applyFacturasHabilitado(false); // por defecto bloqueado, sin parpadeo
    chrome.storage?.local?.get?.(["facturas_habilitado"], (data) => {
      if (chrome.runtime.lastError) return;
      applyFacturasHabilitado(data?.facturas_habilitado === true);
    });
  }

  // Si la app habilita facturas mientras la config está abierta, se desbloquea sola.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.facturas_habilitado) {
      applyFacturasHabilitado(changes.facturas_habilitado.newValue === true);
    }
  });

  // ---- Mostrar / ocultar contraseña ----
  document.querySelectorAll("[data-eye]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.getAttribute("data-eye"));
      if (!input) return;
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      btn.textContent = revealing ? "ocultar" : "ver";
      btn.setAttribute("aria-label", revealing ? "Ocultar clave" : "Mostrar clave");
    });
  });

  elements.refreshStatus?.addEventListener("click", () => {
    requestSiiStatus();
    loadFacturasFlag();
  });

  // Validación local del DV del RUT (módulo 11). Espejo de modules/rut.js — NO se
  // importa porque options.js es script clásico, no módulo. Evita conectar con un
  // RUT mal tipeado (DV incorrecto) que recién fallaría al emitir en el SII.
  function rutDvValido(value) {
    const clean = String(value || "").replace(/[.\s-]/g, "").toUpperCase();
    const m = clean.match(/^(\d{1,8})([\dK])$/);
    if (!m) return false;
    let suma = 0;
    let mul = 2;
    for (let i = m[1].length - 1; i >= 0; i -= 1) {
      suma += parseInt(m[1][i], 10) * mul;
      mul = mul === 7 ? 2 : mul + 1;
    }
    const resto = 11 - (suma % 11);
    const dv = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
    return m[2] === dv;
  }

  elements.siiVaultForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rut = elements.siiRut?.value || "";
    const clave = elements.siiClave?.value || "";
    if (!rut.trim()) {
      setDiag(elements.siiDiagnostic, "error", "Ingresa el RUT del SII.");
      return;
    }
    if (!clave) {
      setDiag(elements.siiDiagnostic, "error", "Ingresa la Clave Tributaria.");
      return;
    }
    if (!rutDvValido(rut)) {
      setDiag(elements.siiDiagnostic, "error", "El RUT del SII no es válido — revisa el dígito verificador.");
      return;
    }
    // 0.1.8: ya NO se pide el RUT de la empresa acá. La app es la única fuente
    // (empresas.rut quedó INMUTABLE tras la primera emisión — trigger en DB) y
    // cada job trae su emisor_rut; el worker además verifica el emisor ACTIVO
    // del portal antes de emitir. Menos fricción, mismo candado, sin doble tipeo.

    elements.saveSiiVault.disabled = true;
    setDiag(elements.siiDiagnostic, "info", "Cifrando y conectando tu clave del SII…");
    // v2: sin passphrase. La clave se cifra localmente con una llave aleatoria y se
    // conecta a tu sesión de la app (se desbloquea sola al emitir). Debes tener la
    // app abierta y con sesión iniciada para conectar.
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: { rut, clave } }, (response) => {
      elements.saveSiiVault.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        const err = response?.error || chrome.runtime.lastError?.message || "SII_SAVE_FAILED";
        setDiag(elements.siiDiagnostic, "error", err === "APP_ORIGIN_DESCONOCIDO"
          ? "Abre la app (con tu sesión iniciada) en otra pestaña y vuelve a intentar: la conexión necesita tu sesión."
          : errorMessage(err));
        return;
      }
      elements.siiClave.value = "";
      setDiag(elements.siiDiagnostic, "ok", "✓ Clave del SII conectada. Se usa sola cuando emites, mientras tengas tu sesión iniciada. No necesitas ninguna clave local.");
      renderSiiStatus(response.status);
    });
  });

  // Card Facturas: guarda SOLO la clave del certificado. La bóveda reusa el
  // RUT + Clave Tributaria ya conectados (exige bóveda conectada y sesión).
  elements.siiCertForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const claveCert = elements.siiClaveCert?.value || "";
    if (!claveCert) {
      setDiag(elements.siiCertDiagnostic, "error", "Ingresa la clave del certificado digital (la que usas al Firmar en el SII).");
      return;
    }
    if (elements.saveSiiCert) elements.saveSiiCert.disabled = true;
    setDiag(elements.siiCertDiagnostic, "info", "Cifrando la clave del certificado…");
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_SAVE", payload: { clave_certificado: claveCert } }, (response) => {
      if (elements.saveSiiCert) elements.saveSiiCert.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        const err = response?.error || chrome.runtime.lastError?.message || "SII_SAVE_FAILED";
        setDiag(elements.siiCertDiagnostic, "error",
          err === "VAULT_NOT_CONFIGURED"
            ? "Primero conecta tu clave del SII en la tarjeta de arriba; la clave del certificado se guarda en esa misma bóveda."
            : err === "APP_ORIGIN_DESCONOCIDO" || err === "SESSION_EXPIRED"
              ? "Abre la app (con tu sesión iniciada) en otra pestaña y vuelve a intentar."
              : errorMessage(err));
        return;
      }
      if (elements.siiClaveCert) elements.siiClaveCert.value = "";
      setDiag(elements.siiCertDiagnostic, "ok", "✓ Clave del certificado guardada. Se usa sola al firmar tus facturas.");
      renderSiiStatus(response.status);
    });
  });

  elements.clearSiiVault?.addEventListener("click", () => {
    const confirmed = window.confirm("Esto elimina la Clave Tributaria cifrada de este navegador y revoca su llave en el servidor. ¿Continuar?");
    if (!confirmed) return;
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_CLEAR" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        setDiag(elements.siiDiagnostic, "error", "No se pudo eliminar la bóveda del SII.");
        return;
      }
      setDiag(elements.siiDiagnostic, "info", "Bóveda del SII eliminada.");
      renderSiiStatus(response.status);
    });
  });

  elements.vaultForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      elements.configureVault.disabled = true;
      setDiag(elements.simpleApiDiagnostic, "info", "Cifrando tu bóveda local…");
      const payload = await buildVaultPayload();
      chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_SAVE", payload }, (response) => {
        elements.configureVault.disabled = false;
        if (chrome.runtime.lastError || !response?.ok) {
          setDiag(elements.simpleApiDiagnostic, "error", errorMessage(response?.error || chrome.runtime.lastError?.message || "SAVE_FAILED"));
          return;
        }
        elements.certificatePassword.value = "";
        elements.vaultPassphrase.value = "";
        renderSimpleApiStatus(response.status);
        setDiag(elements.simpleApiDiagnostic, "ok", "✓ Bóveda de facturas guardada y desbloqueada por 10 minutos.");
      });
    } catch (error) {
      elements.configureVault.disabled = false;
      setDiag(elements.simpleApiDiagnostic, "error", error instanceof Error ? error.message : "No se pudo preparar la bóveda.");
    }
  });

  elements.unlockVault?.addEventListener("click", () => {
    const passphrase = elements.vaultPassphrase?.value || "";
    if (passphrase.length < 10) {
      setDiag(elements.simpleApiDiagnostic, "error", "Ingresa tu clave local para desbloquear. Mínimo 10 caracteres.");
      return;
    }
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_UNLOCK", passphrase }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        setDiag(elements.simpleApiDiagnostic, "error", errorMessage(response?.error || chrome.runtime.lastError?.message || "UNLOCK_FAILED"));
        return;
      }
      elements.vaultPassphrase.value = "";
      setDiag(elements.simpleApiDiagnostic, "ok", "✓ Bóveda de facturas desbloqueada por 10 minutos.");
      renderSimpleApiStatus(response.status);
    });
  });

  elements.clearVault?.addEventListener("click", () => {
    const confirmed = window.confirm("Esto elimina la bóveda local cifrada de este navegador. Tendrás que cargar nuevamente el certificado y el CAF. ¿Continuar?");
    if (!confirmed) return;
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SIMPLEAPI_VAULT_CLEAR" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        setDiag(elements.simpleApiDiagnostic, "error", "No se pudo eliminar la bóveda local.");
        return;
      }
      setDiag(elements.simpleApiDiagnostic, "info", "Bóveda local eliminada.");
      renderSimpleApiStatus(response.status);
    });
  });

  requestSiiStatus();
  loadFacturasFlag();

  async function buildVaultPayload() {
    const pfx = firstFile(elements.pfxFile);
    const caf = firstFile(elements.cafFile);
    const certificatePassword = elements.certificatePassword?.value || "";
    const certificateRut = elements.certificateRut?.value || "";
    const emisorRut = elements.emisorRut?.value || "";
    const resolutionDate = elements.resolutionDate?.value || "";
    const resolutionNumber = Number(elements.resolutionNumber?.value || "0");
    const ambiente = Number(elements.siiEnvironment?.value || "0");
    const passphrase = elements.vaultPassphrase?.value || "";
    if (!pfx) throw new Error("Selecciona el certificado (.pfx).");
    if (!caf) throw new Error("Selecciona el CAF (.xml).");
    if (!certificatePassword) throw new Error("Ingresa la contraseña del certificado.");
    if (!certificateRut.trim()) throw new Error("Ingresa el RUT del certificado.");
    if (!emisorRut.trim()) throw new Error("Ingresa el RUT emisor.");
    if (!resolutionDate) throw new Error("Ingresa la fecha de resolución del SII.");
    if (!Number.isInteger(resolutionNumber) || resolutionNumber < 0) throw new Error("Ingresa un número de resolución válido.");
    if (ambiente !== 0 && ambiente !== 1) throw new Error("Selecciona el ambiente del SII.");
    if (passphrase.length < 10) throw new Error("La clave local debe tener mínimo 10 caracteres.");
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
      ambiente,
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
      reader.onerror = () => reject(new Error("No se pudo leer el certificado (.pfx)."));
      reader.readAsDataURL(file);
    });
  }

  function errorMessage(code) {
    const messages = {
      PFX_REQUIRED: "Selecciona el certificado (.pfx).",
      CAF_REQUIRED: "Selecciona el CAF (.xml).",
      CERT_PASSWORD_REQUIRED: "Ingresa la contraseña del certificado.",
      CERT_RUT_REQUIRED: "Ingresa el RUT del certificado.",
      EMISOR_RUT_REQUIRED: "Ingresa el RUT emisor.",
      RESOLUTION_DATE_REQUIRED: "Ingresa la fecha de resolución del SII.",
      AMBIENTE_INVALID: "Selecciona el ambiente del SII (certificación o producción).",
      PASSPHRASE_TOO_SHORT: "La clave local debe tener mínimo 10 caracteres.",
      PASSPHRASE_INVALID: "Clave local incorrecta.",
      VAULT_NOT_CONFIGURED: "Primero guarda la bóveda cifrada.",
      RUT_REQUIRED: "Ingresa el RUT del SII.",
      CLAVE_REQUIRED: "Ingresa la Clave Tributaria.",
      SII_PASSPHRASE_INVALID: "Clave local del SII inválida o incorrecta. Debe tener mínimo 12 caracteres y no ser sólo números.",
      VAULT_LOCKED_RETRY_LATER: "Demasiados intentos fallidos. Espera 5 minutos y vuelve a intentar.",
      PFX_TOO_LARGE: "El certificado (.pfx) supera 8 MB.",
      CAF_TOO_LARGE: "El CAF (.xml) supera 8 MB.",
      CAF_INVALID: "El CAF no parece contener un rango de folios válido.",
      CAF_TIPO_DTE_MISMATCH: "El CAF cargado no corresponde al tipo de DTE seleccionado.",
      CAF_FOLIO_RANGE_EXHAUSTED: "El rango de folios del CAF está agotado.",
      SESSION_EXPIRED: "Inicia sesión en massDTE en este mismo Chrome (deja la pestaña abierta) y vuelve a intentar.",
      EMPRESA_RUT_REQUIRED: "Ingresa el RUT de la empresa a emitir (el mismo de tu empresa en massDTE).",
    };
    return messages[code] || "No se pudo guardar la bóveda local.";
  }

  function isStrongSiiPassphrase(value) {
    return typeof value === "string" && value.length >= 12 && !/^\d+$/.test(value);
  }
})();
