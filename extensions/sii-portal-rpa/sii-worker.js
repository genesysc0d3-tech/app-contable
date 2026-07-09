(() => {
  "use strict";

  const EXT_SOURCE = "app-contable-extension";
  const OVERLAY_ID = "app-contable-sii-worker-overlay";
  let currentMode = null;
  let currentJobId = null;
  let automationClickInProgress = false;
  let autoCloseTimer = null;
  let capturedSharePdf = null; // PDF capturado vía COMPARTIR (hook MAIN world)
  let currentJobLogoutAfter = false; // boleta única → cerrar sesión SII al final

  // El hook en MAIN world (sii-notif-suppress.js) intercepta navigator.share y
  // nos manda el PDF de la boleta como base64. Lo guardamos para la captura.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d && d.source === "massdte-share-pdf" && typeof d.base64 === "string" && d.base64.length > 100) {
      capturedSharePdf = {
        source: "share_capture",
        base64: d.base64,
        content_type: typeof d.type === "string" && /pdf/i.test(d.type) ? d.type : "application/pdf",
        filename: typeof d.name === "string" && d.name ? d.name : "boleta.pdf",
        size: typeof d.size === "number" ? d.size : 0,
      };
    }
  }, false);

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.right = "0";
    overlay.style.top = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    overlay.style.boxSizing = "border-box";
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function renderOverlay(mode, message) {
    currentMode = mode;
    if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
    const overlay = ensureOverlay();
    const locked = mode === "LOCKED_AUTOMATION";
    const paused = mode === "PAUSED";
    const done = mode === "DONE";
    const panelBackground = locked
      ? "rgba(15,16,20,.96)"
      : done
        ? "rgba(20,120,78,.96)"
        : "rgba(232,85,62,.96)";
    const helperText = locked
      ? "Estamos trabajando. No escribas ni hagas click en esta ventana."
      : done
        ? "Proceso finalizado. Puedes cerrar esta ventana segura."
        : "Interaccion habilitada para login, captcha, 2FA o confirmacion.";
    const actions = paused
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button type="button" data-app-contable-action="capture" style="border:0;border-radius:999px;padding:7px 12px;background:#fff;color:#16181d;font-size:12px;font-weight:800;cursor:pointer;">Capturar folio</button>
          <button type="button" data-app-contable-action="retry" style="border:0;border-radius:999px;padding:7px 12px;background:#fff;color:#16181d;font-size:12px;font-weight:800;cursor:pointer;">Reintentar</button>
          <button type="button" data-app-contable-action="cancel" style="border:1px solid rgba(255,255,255,.45);border-radius:999px;padding:7px 12px;background:transparent;color:#fff;font-size:12px;font-weight:800;cursor:pointer;">Cancelar</button>
        </div>`
      : done
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            <button type="button" data-app-contable-action="${currentJobLogoutAfter ? "logout_and_close" : "close"}" style="border:0;border-radius:999px;padding:7px 12px;background:#fff;color:#0f5132;font-size:12px;font-weight:800;cursor:pointer;">${currentJobLogoutAfter ? "Cerrar sesión y ventana" : "Cerrar ventana"}</button>
          </div>`
        : "";

    overlay.style.pointerEvents = locked ? "auto" : "none";
    overlay.style.height = locked ? "100vh" : "auto";
    overlay.style.background = locked ? "rgba(8, 10, 14, 0.18)" : "transparent";
    overlay.innerHTML = `
      <div style="margin:12px auto 0;max-width:760px;padding:12px 14px;border-radius:14px;background:${panelBackground};color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.16);pointer-events:auto;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.02em;">App Contable · Ventana segura SII</div>
        <div style="font-size:12px;line-height:1.45;margin-top:4px;">${escapeHtml(message)}</div>
        <div style="font-size:10px;opacity:.78;margin-top:6px;">${helperText}</div>
        ${actions}
      </div>
    `;

    if (done) {
      // Ya emitió y la app guardó el folio: la ventana se cierra sola tras unos
      // segundos (deja ver el folio un momento). Es automático; el botón
      // "Cerrar ventana" queda solo por si quieres cerrarla antes.
      autoCloseTimer = setTimeout(() => {
        // Single: clickLogout hace power → confirmar CERRAR SESIÓN → y cierra la
        // ventana él mismo (en su confirm-handler). Si no encuentra el botón
        // power, cerramos igual. MassDTE por lote: cierre normal.
        if (currentJobLogoutAfter) {
          if (!clickLogout()) sendWorkerAction("close");
        } else {
          sendWorkerAction("close");
        }
      }, 5000);
    }
  }

  function sendWorkerAction(action) {
    try {
      chrome.runtime.sendMessage({
        source: EXT_SOURCE,
        type: "APP_CONTABLE_SII_WORKER_ACTION",
        job_id: currentJobId,
        action,
      }, () => {
        if (!chrome.runtime.lastError) return;
        renderOverlay("PAUSED", "La extensión fue recargada y esta ventana perdió conexión. Vuelve a la app para guardar el PDF SII detectado.");
      });
    } catch {
      renderOverlay("PAUSED", "La extensión fue recargada y esta ventana perdió conexión. Vuelve a la app para guardar el PDF SII detectado.");
    }
  }

  // Aviso INMEDIATO al librero de que el EMITIR real ya se cliqueó, sin esperar la
  // confirmación de 16s. Arma el candado anti-doble-emisión al instante y protege el
  // folio aunque el content script muera después (puerto cerrado). Fire-and-forget.
  function notifyFinalEmitClicked() {
    try {
      chrome.runtime.sendMessage({
        source: EXT_SOURCE,
        type: "APP_CONTABLE_SII_FINAL_EMIT_CLICKED",
        job_id: currentJobId,
      }, () => { void chrome.runtime.lastError; });
    } catch {
      // Sin conexión: el librero igual infiere post-emit por el cierre de puerto.
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute("data-app-contable-action");
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "logout_and_close") { clickLogout(); return; } // clickLogout cierra la ventana solo
    sendWorkerAction(action);
  }, true);

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function blockWhenLocked(event) {
    // Los eventos sintéticos del bot (isTrusted=false) SIEMPRE pasan: nunca
    // bloqueamos ni toleramos blur sobre la propia automatización (tecleo de
    // glosa, clicks de selects). Solo bloqueamos el input REAL del usuario.
    if (event && event.isTrusted === false) return;
    if (automationClickInProgress) return;
    if (currentMode !== "LOCKED_AUTOMATION") return; // solo mientras el bot trabaja
    event.preventDefault();
    event.stopImmediatePropagation();
    // Si tu click accidental cayó en un campo del SII, le quitamos el foco para
    // que ningún tecleo posterior entre a la boleta. Solo en pointer-down real
    // (no en cada tecla, para no pelear con el estado del formulario).
    if ((event.type === "mousedown" || event.type === "pointerdown") &&
        event.target && typeof event.target.closest === "function" &&
        !event.target.closest(`#${OVERLAY_ID}`)) {
      try {
        const active = document.activeElement;
        if (active && active !== document.body && typeof active.blur === "function") active.blur();
      } catch { /* noop */ }
    }
  }

  // Bloquea TODO input del usuario mientras el bot automatiza: incluye los
  // eventos de puntero/foco (mousedown/pointerdown dan foco y abren menús ANTES
  // del click) además de teclado/paste. El bot pasa porque usa
  // automationClickInProgress y despacha eventos sintéticos directos.
  [
    "click", "dblclick", "auxclick", "contextmenu",
    "mousedown", "mouseup", "pointerdown", "pointerup",
    "touchstart", "touchend", "wheel", "focusin",
    "keydown", "keypress", "keyup", "input", "beforeinput", "submit", "paste", "drop",
  ].forEach((eventName) => {
    window.addEventListener(eventName, blockWhenLocked, true);
  });

  function visibleText(element) {
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 160);
  }

  function pageText() {
    return (document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function cssPath(element) {
    if (!element || element === document.body) return "body";
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id}`;
        parts.unshift(part);
        break;
      }
      const className = String(current.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      if (className) part += `.${className}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function labelFor(control) {
    if (control.id) {
      const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      if (label) return visibleText(label);
    }
    const wrapped = control.closest("label");
    if (wrapped) return visibleText(wrapped);
    const parentText = visibleText(control.parentElement || control);
    return parentText || control.getAttribute("aria-label") || control.getAttribute("placeholder") || "";
  }

  function describeControl(control) {
    return {
      tag: control.tagName.toLowerCase(),
      type: control.getAttribute("type") || "",
      name: control.getAttribute("name") || "",
      id: control.id || "",
      label: labelFor(control),
      placeholder: control.getAttribute("placeholder") || "",
      required: Boolean(control.required),
      disabled: Boolean(control.disabled),
      selector: cssPath(control),
    };
  }

  function scanPage() {
    const controls = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter((control) => control instanceof HTMLElement)
      .map(describeControl)
      .slice(0, 80);

    const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"))
      .filter((element) => element instanceof HTMLElement)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: visibleText(element) || element.getAttribute("value") || element.getAttribute("title") || "",
        href: element.getAttribute("href") || "",
        selector: cssPath(element),
      }))
      .filter((item) => item.text || item.href)
      .slice(0, 100);

    const forms = Array.from(document.forms).map((form) => ({
      id: form.id || "",
      name: form.getAttribute("name") || "",
      action: form.getAttribute("action") || "",
      method: form.getAttribute("method") || "",
      selector: cssPath(form),
      controls: Array.from(form.querySelectorAll("input, select, textarea")).map((control) => describeControl(control)).slice(0, 40),
    })).slice(0, 20);

    const headings = Array.from(document.querySelectorAll("h1, h2, h3, legend, [role='heading']"))
      .map((element) => visibleText(element))
      .filter(Boolean)
      .slice(0, 40);

    return {
      captured_at: new Date().toISOString(),
      url: location.href,
      title: document.title,
      headings,
      forms,
      controls,
      buttons,
      body_excerpt: pageText().slice(0, 1200),
    };
  }

  function buttonByText(text) {
    const wanted = String(text).replace(/\s+/g, " ").trim().toUpperCase();
    return Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"))
      .find((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const label = (visibleText(element) || element.getAttribute("value") || "").replace(/\s+/g, " ").trim().toUpperCase();
        return label === wanted;
      });
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
  }

  function normalizeSearchText(value) {
    return normalizeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function isVisibleEnabled(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if (element.disabled || element.readOnly) return false;
      if (element.type === "hidden") return false;
    }
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && styles.visibility !== "hidden" && styles.display !== "none";
  }

  function controlText(control) {
    return normalizeSearchText([
      control.id,
      control.getAttribute("name"),
      control.getAttribute("autocomplete"),
      control.getAttribute("aria-label"),
      control.getAttribute("placeholder"),
      labelFor(control),
    ].filter(Boolean).join(" "));
  }

  function setControlValue(control, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value");
    automationClickInProgress = true;
    try {
      if (descriptor?.set) descriptor.set.call(control, value);
      else control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      // blur: Vuetify/Vue corren la VALIDACIÓN del campo al perder el foco (y el SII
      // dispara el lookup del RUT del receptor). Sin esto, el formulario quedaba en
      // estado "sin validar" y el botón EMITIR no se habilitaba con receptor.
      control.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      control.dispatchEvent(new Event("blur", { bubbles: true }));
    } finally {
      automationClickInProgress = false;
    }
  }

  function findRutInput() {
    const inputs = Array.from(document.querySelectorAll("input"))
      .filter((input) => input instanceof HTMLInputElement && isVisibleEnabled(input));
    return inputs.find((input) => /\bRUT\b|RUTCNTR|ROL|USUARIO|USERNAME|USER|CODIGO/.test(controlText(input)))
      || inputs.find((input) => input.type === "text" || input.type === "tel" || input.inputMode === "numeric")
      || null;
  }

  function findPasswordInput() {
    const inputs = Array.from(document.querySelectorAll("input"))
      .filter((input) => input instanceof HTMLInputElement && isVisibleEnabled(input));
    return inputs.find((input) => input.type === "password")
      || inputs.find((input) => /CLAVE|PASS|PASSWORD|CONTRASENA|CONTRASEÑA/.test(controlText(input)))
      || null;
  }

  function hasHumanChallenge() {
    const text = normalizeSearchText(pageText());
    return /CAPTCHA|RECAPTCHA|CODIGO DE SEGURIDAD|2FA|DOBLE FACTOR|VERIFICACION|AUTENTICADOR|TOKEN|CAMBIO DE CLAVE|ACTUALIZA TU CLAVE/.test(text);
  }

  function findLoginSubmit() {
    const candidates = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"))
      .filter((element) => element instanceof HTMLElement && isVisibleEnabled(element));
    const exact = candidates.find((element) => /^(INGRESAR|INICIAR SESION|INICIAR SESSION|ENTRAR|ACCEDER)$/.test(normalizeSearchText(visibleText(element) || element.getAttribute("value") || element.getAttribute("title"))));
    if (exact) return exact;
    return candidates.find((element) => /INGRESAR|INICIAR SESION|ENTRAR|ACCEDER/.test(normalizeSearchText(visibleText(element) || element.getAttribute("value") || element.getAttribute("title")))) || null;
  }

  async function attemptAutologin(credentials) {
    if (hasHumanChallenge()) {
      throw new Error("SII requiere captcha, 2FA, token o cambio de clave. Inicia sesión manualmente en esta ventana.");
    }

    const rutInput = findRutInput();
    const passwordInput = findPasswordInput();
    if (!rutInput || !passwordInput) {
      throw new Error("No encontré un formulario de login SII compatible. Inicia sesión manualmente en esta ventana.");
    }

    renderOverlay("LOCKED_AUTOMATION", "Completando login SII con la bóveda local desbloqueada.");
    setControlValue(rutInput, credentials.rut);
    setControlValue(passwordInput, credentials.clave);
    await new Promise((resolve) => setTimeout(resolve, 150));

    if (hasHumanChallenge()) {
      throw new Error("SII mostró una verificación humana. Inicia sesión manualmente en esta ventana.");
    }

    const submit = findLoginSubmit();
    if (submit) {
      await clickElement(submit);
    } else {
      const form = passwordInput.form || rutInput.form;
      if (!form) throw new Error("No encontré botón o formulario para enviar login SII.");
      automationClickInProgress = true;
      try {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      } finally {
        automationClickInProgress = false;
      }
    }

    renderOverlay("LOCKED_AUTOMATION", "Login SII enviado. Esperando respuesta del portal.");
    return true;
  }

  function visibleBoxForText(text, root = document) {
    const wanted = normalizeText(text);
    const elements = Array.from(root.querySelectorAll("button, .v-input__slot, .v-select__slot, .v-list-item, [role='button'], div"));
    const element = elements.find((candidate) => normalizeText(candidate.innerText || candidate.textContent || candidate.getAttribute("value")) === wanted)
      || elements.find((candidate) => normalizeText(candidate.innerText || candidate.textContent || candidate.getAttribute("value")).includes(wanted));
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { element, rect };
  }

  async function clickElement(element) {
    automationClickInProgress = true;
    try {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      automationClickInProgress = false;
    }
  }

  async function clickVisibleText(text, root = document) {
    const match = visibleBoxForText(text, root);
    if (!match) return false;
    await clickElement(match.element);
    return true;
  }

  async function _openSelectByValue(value) {
    const dialog = document.querySelector(".v-dialog.v-dialog--active") || document;
    const slots = Array.from(dialog.querySelectorAll(".v-select__slot, .v-input__slot"));
    const slot = slots.find((element) => normalizeText(element.innerText || element.textContent).includes(normalizeText(value)));
    if (!slot) return false;
    await clickElement(slot);
    return true;
  }

  async function _chooseMenuOption(option) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return clickVisibleText(option, document);
  }

  // Selección robusta de un v-select de Vuetify: abre el slot que contiene
  // `slotText` y elige la opción `optionText` del menú desplegable (que Vuetify
  // monta en el body como .v-menu__content, fuera del modal). Verifica que el
  // slot refleje el valor elegido. Devuelve true solo si quedó seleccionado.
  async function selectVuetifyOption(slotText, optionText) {
    const dialog = activeEmitDialog() || document;
    // Captura el slot por referencia: tras elegir, Vuetify actualiza su texto
    // EN ESE MISMO elemento (de "Elija método de pago" a "Efectivo"), así que
    // la verificación debe leer el mismo nodo, no re-buscar por el placeholder.
    const slot = Array.from(dialog.querySelectorAll(".v-select__slot, .v-input__slot"))
      .find((s) => normalizeSearchText(s.innerText || s.textContent).includes(normalizeSearchText(slotText)));
    if (!slot) return false;
    const shows = () => normalizeSearchText(slot.innerText || slot.textContent).includes(normalizeSearchText(optionText));
    if (shows()) return true;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await clickElement(slot);
      for (let i = 0; i < 16; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        const menus = Array.from(document.querySelectorAll(".v-menu__content"))
          .filter((m) => m.offsetWidth > 0 && m.offsetHeight > 0);
        for (const menu of menus) {
          const items = Array.from(menu.querySelectorAll(".v-list-item, [role='option'], .v-list__tile"));
          const opt = items.find((it) => normalizeSearchText(it.innerText || it.textContent) === normalizeSearchText(optionText))
            || items.find((it) => normalizeSearchText(it.innerText || it.textContent).includes(normalizeSearchText(optionText)));
          if (opt) {
            await clickElement(opt);
            await new Promise((resolve) => setTimeout(resolve, 250));
            if (shows()) return true;
          }
        }
      }
    }
    return shows();
  }

  // Abre el v-select cuyo slot contiene `slotText` y elige la PRIMERA opción.
  // Para la sucursal: a veces no auto-selecciona (carrera al cargar emisores)
  // y es requerida; elegir la primera disponible desbloquea el EMITIR.
  async function selectFirstVuetifyOption(slotText) {
    const dialog = activeEmitDialog() || document;
    const slot = Array.from(dialog.querySelectorAll(".v-select__slot, .v-input__slot"))
      .find((s) => normalizeSearchText(s.innerText || s.textContent).includes(normalizeSearchText(slotText)));
    if (!slot) return false;
    await clickElement(slot);
    for (let i = 0; i < 16; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      const menus = Array.from(document.querySelectorAll(".v-menu__content"))
        .filter((m) => m.offsetWidth > 0 && m.offsetHeight > 0);
      for (const menu of menus) {
        const items = Array.from(menu.querySelectorAll(".v-list-item, [role='option'], .v-list__tile"))
          .filter((it) => isVisibleEnabled(it) && (it.innerText || it.textContent || "").trim());
        if (items.length) { await clickElement(items[0]); await new Promise((resolve) => setTimeout(resolve, 250)); return true; }
      }
    }
    return false;
  }

  async function clickButtonText(text) {
    const button = buttonByText(text);
    if (!button) throw new Error(`Boton no encontrado: ${text}`);
    await clickElement(button);
  }

  function activeEmitDialog() {
    const dialogs = Array.from(document.querySelectorAll(".v-dialog.v-dialog--active"));
    return dialogs.find((dialog) => /Emitir\s+e-Boleta/i.test(dialog.innerText || dialog.textContent || "")) || null;
  }

  async function waitForEmitDialog(timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dialog = activeEmitDialog();
      if (dialog) return dialog;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  // Activa/desactiva un toggle/switch Vuetify (Receptor / Detalle). El input
  // real está oculto; se clickea el contenedor de controles.
  function findToggleRow(labelText) {
    const dialog = activeEmitDialog() || document;
    const wanted = normalizeSearchText(labelText);
    const rows = Array.from(dialog.querySelectorAll(".v-input--selection-controls, .v-input--switch, .v-input"));
    return rows.find((row) => normalizeSearchText(row.innerText || row.textContent).includes(wanted)) || null;
  }
  async function setDialogToggle(labelText, on) {
    const target = findToggleRow(labelText);
    if (!target) return false;
    const input = () => target.querySelector("input[type='checkbox'], input[role='switch']");
    if (Boolean(input()?.checked) === on) return true;
    const clickable = target.querySelector(".v-input--selection-controls__ripple, .v-input--selection-controls__input, label") || input() || target;
    await clickElement(clickable);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return Boolean(input()?.checked) === on;
  }
  async function enableDialogToggle(labelText) { return setDialogToggle(labelText, true); }

  function findDialogControl(pattern) {
    const dialog = activeEmitDialog() || document;
    return Array.from(dialog.querySelectorAll("input, textarea"))
      .find((el) => isVisibleEnabled(el) && pattern.test(controlText(el))) || null;
  }

  // El campo de glosa ("Detalle") del modal SII no tiene placeholder/label/name;
  // se identifica por su contenedor v-input, que muestra el contador "... / 80".
  function findGlosaInput() {
    const dialog = activeEmitDialog() || document;
    return Array.from(dialog.querySelectorAll("input[type='text'], textarea"))
      .find((el) => {
        if (!isVisibleEnabled(el)) return false;
        const cont = el.closest(".v-input") || el.parentElement;
        const txt = normalizeSearchText(cont?.innerText || cont?.textContent || "");
        return /detalle/.test(txt) && /\/\s*80/.test(txt)
          && !/vendedor|monto|receptor|sucursal|boleta|pago|rut/.test(txt);
      }) || null;
  }

  // --- RUT canónico (espejo de modules/rut.js — el content-script NO importa ESM;
  // misma lógica y mismos vectores de test). La regla del emisor exige comparación
  // EXACTA sobre "CUERPO-DV", nunca substring. ---
  function normalizeRut(value) {
    if (value == null) return null;
    const s = String(value).trim().toUpperCase().replace(/[^0-9K]/g, "");
    if (s.length < 2) return null;
    const dv = s.slice(-1);
    let cuerpo = s.slice(0, -1);
    if (!/^[0-9]+$/.test(cuerpo)) return null;
    cuerpo = cuerpo.replace(/^0+/, "") || "0";
    if (cuerpo.length < 1 || cuerpo.length > 8) return null;
    if (!/^[0-9K]$/.test(dv)) return null;
    return cuerpo + "-" + dv;
  }
  function extractRutTokens(text) {
    if (text == null) return [];
    const out = [];
    const seen = new Set();
    const matches = String(text).match(/\b\d{1,2}(?:\.?\d{3}){2}\s*-?\s*[0-9kK]\b/g) || [];
    for (const m of matches) {
      const canon = normalizeRut(m);
      if (canon && !seen.has(canon)) { seen.add(canon); out.push(canon); }
    }
    return out;
  }

  // ¿Está abierto el dropdown de emisor (la lista desplegada en el body)?
  function emisorMenuOpen() {
    return Array.from(document.querySelectorAll(".v-menu__content"))
      .some((m) => m.getBoundingClientRect().width > 0 && m.querySelector("[role='option'],.v-list-item"));
  }

  // Cierra cualquier dropdown abierto (Escape) para no dejar el portal "sucio" — clave
  // ante un error a mitad de la selección de empresa.
  async function closeEmisorDropdown() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Lee el RUT del EMISOR ACTIVO desde el .v-select__selections del selector superior.
  // EXCLUYE cualquier selección que esté dentro de un menú desplegado (.v-menu__content):
  // con el dropdown abierto, leer la lista causaba el "salto" CONSTANZA↔MV que colgaba
  // la emisión en cuentas multi-empresa. Devuelve canónico o null.
  function readActiveEmisorRut() {
    for (const sel of document.querySelectorAll(".v-select__selections")) {
      if (sel.closest(".v-menu__content")) continue; // no leer la lista desplegada
      const toks = extractRutTokens(sel.textContent || "");
      if (toks.length) return toks[0];
    }
    return null;
  }

  // Espera a que el emisor activo se ESTABILICE: mismo RUT en ≥2 lecturas seguidas, con
  // el dropdown CERRADO. Cambiar de empresa re-renderiza el portal y el valor oscila unos
  // instantes; leer durante ese re-render era la causa del congelamiento. Acotado por
  // timeout → NUNCA cuelga (devuelve la última lectura como último recurso).
  async function waitStableEmisorRut(timeoutMs = 6000) {
    const start = Date.now();
    let prev = null;
    let stable = 0;
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (emisorMenuOpen()) { prev = null; stable = 0; continue; }
      const cur = readActiveEmisorRut();
      if (cur && cur === prev) { stable += 1; if (stable >= 2) return cur; }
      else { stable = 0; }
      prev = cur;
    }
    return readActiveEmisorRut();
  }

  // ¿El portal está recargando la lista de empresas ("Cargando Emisores…")? Cambiar de
  // empresa dispara ese re-render; leer/actuar DURANTE él era la causa del cuelgue.
  function emisoresCargando() {
    return /Cargando Emisores/i.test(document.body?.innerText || document.body?.textContent || "");
  }
  // Espera a que el portal termine de cargar la empresa (sin "Cargando Emisores" y con un
  // emisor legible). Acotado por timeout: no cuelga.
  async function waitEmisoresReady(timeoutMs = 9000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!emisoresCargando() && readActiveEmisorRut()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  // Un intento de abrir el dropdown, encontrar la empresa objetivo (match EXACTO por RUT,
  // 0 o >1 = THROW) y clickearla. Devuelve tras cerrar el dropdown; el caller confirma.
  async function selectEmisorOnce(objetivo, rutObjetivo) {
    const emisorSelect = Array.from(document.querySelectorAll(".v-select"))
      .find((vs) => extractRutTokens(vs.querySelector(".v-select__selections")?.textContent || "").length > 0);
    if (!emisorSelect) throw new Error("No encontré el selector de emisor en el portal. Selecciónalo a mano arriba y reintenta.");
    await clickElement(emisorSelect.querySelector(".v-input__slot") || emisorSelect);
    let options = [];
    for (let i = 0; i < 24; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const menu = Array.from(document.querySelectorAll(".v-menu__content"))
        .find((m) => m.getBoundingClientRect().width > 0 && m.querySelector("[role='option'],.v-list-item"));
      if (menu) { options = Array.from(menu.querySelectorAll("[role='option'],.v-list-item")); if (options.length) break; }
    }
    if (!options.length) throw new Error("No pude abrir la lista de empresas del portal. Selecciona la empresa a mano arriba y reintenta.");
    const candidatos = options.filter((opt) => extractRutTokens(opt.textContent || "").includes(objetivo));
    if (candidatos.length !== 1) {
      throw new Error(`No pude seleccionar la empresa ${rutObjetivo}: ${candidatos.length === 0 ? "no está entre tus empresas habilitadas en el SII" : "coincidencia ambigua"}. Selecciónala a mano arriba y reintenta.`);
    }
    await clickElement(candidatos[0]);
    await closeEmisorDropdown();
  }

  // SELECCIÓN ACTIVA del emisor (cuentas multi-empresa). Espera a que el portal esté
  // listo, y si la empresa activa no es la objetivo la cambia — con REINTENTOS: cambiar de
  // empresa re-renderiza el portal ("Cargando Emisores") y a veces la selección no "toma"
  // al primer intento. Match EXACTO por RUT; confirma ESTABLE que quedó la correcta antes
  // de seguir. Fail-CLOSED: si tras varios intentos no queda la objetivo → THROW (nunca
  // emite bajo la equivocada). Todo acotado: no cuelga. Fallback: elegir a mano + Reintentar.
  async function selectEmisorByRut(rutObjetivo) {
    const objetivo = normalizeRut(rutObjetivo);
    if (!objetivo) throw new Error("Sin RUT de empresa objetivo: no puedo seleccionar el emisor. Abortado por seguridad.");
    await waitEmisoresReady();
    if ((await waitStableEmisorRut(1500)) === objetivo) return; // ya está la correcta y estable

    let ultimo = null;
    for (let intento = 0; intento < 3; intento += 1) {
      try {
        await selectEmisorOnce(objetivo, rutObjetivo);
        await waitEmisoresReady(); // esperar a que el portal recargue para la empresa nueva
        ultimo = await waitStableEmisorRut();
        if (ultimo === objetivo) return; // ✓ quedó estable en la objetivo
      } catch (error) {
        await closeEmisorDropdown();
        if (intento === 2) throw error; // último intento: propagar el mensaje concreto
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    throw new Error(`Intenté seleccionar ${rutObjetivo} varias veces pero el emisor activo quedó en ${ultimo || "ilegible"}. Elige la empresa a mano en el selector de arriba y aprieta Reintentar.`);
  }

  // Verifica (fail-CLOSED) que el EMISOR ACTIVO del portal sea EXACTO al del job. Ante
  // cualquier duda (sin RUT objetivo, emisor activo no legible, o distinto) → THROW.
  // Preferimos NO emitir a emitir bajo el emisor equivocado (incidente tributario). Corre
  // ANTES del modal, con el selector superior visible.
  function assertEmisorRut(job) {
    const objetivo = normalizeRut(job?.emisor_rut);
    if (!objetivo) {
      throw new Error("Sin RUT de empresa emisora en el trabajo: no puedo confirmar por cuál empresa emitir. Abortado por seguridad.");
    }
    const activo = readActiveEmisorRut();
    if (!activo) {
      throw new Error(`No pude leer el emisor activo del portal para confirmar que es ${job.emisor_rut}. Selecciona el emisor arriba y reintenta.`);
    }
    if (activo !== objetivo) {
      throw new Error(`El emisor activo del portal es ${activo}, no ${job.emisor_rut}. Elige la empresa correcta en el selector superior y reintenta.`);
    }
  }

  // Última compuerta JUSTO antes del EMITIR: si el emisor activo cambió a otro legible
  // distinto del objetivo (re-render, reset del portal), abortar. Suave ante "no legible"
  // por si el modal tapa el selector — la verificación dura ya corrió antes (arriba).
  function assertEmisorNoCambio(job) {
    const objetivo = normalizeRut(job?.emisor_rut);
    if (!objetivo) return;
    const activo = readActiveEmisorRut();
    if (activo && activo !== objetivo) {
      throw new Error(`El emisor cambió en el portal (ahora ${activo}, no ${job.emisor_rut}). Abortado antes de emitir; revisa el selector y reintenta.`);
    }
  }

  // Espera (best-effort) a que el botón EMITIR se HABILITE — el SII lo deshabilita un
  // instante mientras valida el receptor (lookup del RUT). NO bloquea: apenas está
  // habilitado, o al agotar el timeout, retorna y el caller lo clickea igual. Antes
  // esto LANZABA si creía el botón deshabilitado → el robot NUNCA apretaba EMITIR con
  // receptor (bug). Si de verdad quedara deshabilitado, el click es no-op y el bucle
  // de confirmación de 16s lo detecta; nunca inventa un folio.
  async function waitFinalEmitEnabled(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dlg = activeEmitDialog();
      const btn = dlg && Array.from(dlg.querySelectorAll("button")).reverse()
        .find((b) => normalizeText(b.innerText || b.textContent || b.getAttribute("value")) === "EMITIR");
      if (btn) {
        const disabled = btn.disabled
          || btn.getAttribute("aria-disabled") === "true"
          || (typeof btn.className === "string" && /v-btn--disabled/.test(btn.className));
        if (!disabled) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    // Timeout: seguimos igual — no bloqueamos el EMITIR (la detección de "disabled"
    // puede dar falso positivo en Vuetify).
  }

  async function clickFinalEmitInDialog(dialog) {
    const buttons = Array.from(dialog.querySelectorAll("button"));
    const finalEmit = buttons.reverse().find((button) => normalizeText(button.innerText || button.textContent || button.getAttribute("value")) === "EMITIR");
    if (!finalEmit) throw new Error("Boton final EMITIR no encontrado en el modal");
    await clickElement(finalEmit);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  async function clickFirstAvailable(texts) {
    for (const text of texts) {
      const button = buttonByText(text);
      if (!button) continue;
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return true;
    }
    return false;
  }

  function artifactLinks() {
    return Array.from(document.querySelectorAll("a"))
      .filter((element) => element instanceof HTMLAnchorElement)
      .map((anchor) => {
        const href = anchor.href || "";
        const text = visibleText(anchor);
        const probe = `${href} ${text}`.toLowerCase();
        const kind = probe.includes("xml")
          ? "xml"
          : probe.includes("pdf") || probe.includes("descargar")
            ? "pdf"
            : probe.includes("imprimir") || probe.includes("print") || probe.includes("boleta")
              ? "html"
              : "link";
        return { kind, href, text };
      })
      .filter((link) => link.href && link.kind !== "link")
      .slice(0, 12);
  }

  function capturePdfArtifactFolio(links) {
    for (const link of links) {
      const href = String(link?.href || "");
      if (!href) continue;
      let decoded = href;
      try {
        decoded = decodeURIComponent(href);
      } catch {
        decoded = href;
      }
      const pdfMatch = decoded.match(/https:\/\/[^\s"']+\.pdf(?:\?[^\s"']*)?/i);
      const pdfUrl = pdfMatch?.[0] ?? (/\.pdf(?:\?|$)/i.test(href) ? href : "");
      const folioMatch = pdfUrl.match(/folio(\d+)_/i);
      const folio = folioMatch ? parseFolio(folioMatch[1]) : null;
      if (!folio) continue;
      return {
        folio,
        confidence: "high",
        evidence: {
          source: "sii_pdf_download_link",
          matched_text: `folio${folio}`,
        },
      };
    }
    return null;
  }

  function hasPdfArtifact(result) {
    return Array.isArray(result?.artifact_links) && result.artifact_links.some((link) => {
      const href = String(link?.href || "");
      const text = String(link?.text || "");
      return link?.kind === "pdf" || /\.pdf(?:\?|$)/i.test(href) || /DESCARGAR|PDF/i.test(text);
    });
  }

  function stripRut(value) {
    return String(value || "").replace(/[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-[0-9Kk]/g, "[RUT]");
  }

  function parseFolio(value) {
    const match = String(value || "").match(/\b(\d{1,10})\b(?![-.])/);
    if (!match) return null;
    const folio = Number(match[1]);
    return Number.isSafeInteger(folio) && folio > 0 ? folio : null;
  }

  function captureExplicitFolio(text) {
    // El portal real muestra "BOLETA ELECTRÓNICA NÚMERO: 2" (sin afecta/exenta).
    const match = text.match(/(?:Nro\.?\s*)?Folio\s*(?:Nro\.?|N(?:°|o)|Numero|#)?\s*[:#-]?\s*(\d{1,10})/i)
      || text.match(/BOLETA(?:\s+(?:AFECTA|EXENTA))?\s+ELECTR[OÓ]NICA\s+N[UÚ]MERO\s*[:#-]?\s*(\d{1,10})/i);
    const folio = match ? parseFolio(match[1]) : null;
    if (!folio) return null;
    return {
      folio,
      confidence: "high",
      evidence: {
        source: "explicit_folio_label",
        matched_text: match[0].slice(0, 120),
      },
    };
  }

  function captureReportTableFolio() {
    if (!location.href.includes("/reportes")) return null;
    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td")).map((cell) => normalizeText(cell.innerText || cell.textContent));
      const folioIndex = headers.findIndex((header) => /NRO\.?\s*FOLIO|FOLIO/.test(header));
      if (folioIndex < 0 || !headers.some((header) => /ACCIONES/.test(header))) continue;

      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      const rows = bodyRows.length > 0 ? bodyRows : Array.from(table.querySelectorAll("tr")).slice(1);
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td, th"));
        const cell = cells[folioIndex];
        const folio = parseFolio(stripRut(cell?.innerText || cell?.textContent || ""));
        if (!folio) continue;
        return {
          folio,
          confidence: "high",
          evidence: {
            source: "reportes_table_folio_column",
            matched_text: stripRut(row.innerText || row.textContent || "").slice(0, 180),
          },
        };
      }
    }
    return null;
  }

  function captureReportTextFolio(text) {
    const reportTable = /Nro\s*Folio/i.test(text) && /Acciones/i.test(text) && location.href.includes("/reportes");
    if (!reportTable) return null;
    const reportTail = text.split(/Acciones/i).slice(1).join(" ").slice(0, 360);
    const folio = parseFolio(reportTail);
    if (!folio) return null;
    return {
      folio,
      confidence: "medium",
      evidence: {
        source: "reportes_text_after_header",
        matched_text: reportTail.slice(0, 180),
      },
    };
  }

  function hasStrongFolioResult(result) {
    return Boolean(result?.folio && result.folio_confidence === "high" && hasPdfArtifact(result));
  }

  function captureResult(job) {
    const text = pageText().slice(0, 2400);
    const withoutRut = stripRut(text);
    const links = artifactLinks();
    const captured = captureExplicitFolio(withoutRut) || capturePdfArtifactFolio(links) || captureReportTableFolio() || captureReportTextFolio(withoutRut);
    const folio = captured?.folio ?? null;
    const strongFolio = captured?.confidence === "high";
    return {
      folio,
      folio_confidence: captured?.confidence ?? "none",
      folio_evidence: captured?.evidence ?? null,
      // RUT del emisor ACTIVO del portal al momento de capturar: permite al server
      // detectar si la boleta salió bajo otra empresa que la registrada en la app.
      emisor_rut_activo: readActiveEmisorRut(),
      tipo_dte: job?.tipo_dte ?? null,
      fecha_emision: job?.fecha_emision ?? null,
      estado: strongFolio ? "emitida_capturada" : folio ? "resultado_requiere_revision" : "resultado_no_detectado",
      monto_total: job?.totales?.monto_total ?? null,
      receptor: job?.receptor ?? null,
      detalles: Array.isArray(job?.detalles) ? job.detalles : [],
      totales: job?.totales ?? null,
      artifact_links: links,
      page: {
        url: location.href,
        title: document.title,
        excerpt: text,
      },
    };
  }

  // Captura el PDF oficial vía COMPARTIR: clickea el botón del recibo; el hook
  // en MAIN world intercepta navigator.share y nos manda el PDF como base64.
  // Es la vía primaria (PDF oficial, sin 403 de S3, sin diálogo, sin OCR).
  async function tryCaptureSharePdf() {
    const btn = Array.from(document.querySelectorAll("button"))
      .find((b) => /compartir/i.test(b.innerText || b.textContent || ""));
    if (!btn) return null;
    capturedSharePdf = null;
    await clickElement(btn);
    for (let i = 0; i < 24; i += 1) {
      if (capturedSharePdf) return capturedSharePdf;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return capturedSharePdf;
  }

  // Boleta única: clickea el botón de "Cerrar sesión" del SII. En e-Boleta es el
  // botón REDONDO NARANJA con ícono de power (⏻) arriba a la derecha — sin texto.
  // Lo buscamos por varias señales: aria-label/title, el ícono de power, y como
  // respaldo el FAB redondo posicionado arriba a la derecha.
  function clickLogout() {
    const clickables = Array.from(document.querySelectorAll("button, a, [role='button']"));
    const iconBlob = (el) =>
      (typeof el.className === "string" ? el.className : "") + " " +
      Array.from(el.querySelectorAll("i, .v-icon, svg, use"))
        .map((n) => `${n.className?.baseVal || (typeof n.className === "string" ? n.className : "")} ${n.textContent || ""} ${n.getAttribute?.("href") || ""}`)
        .join(" ");
    const semantic = (el) => {
      const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").toLowerCase();
      if (/cerrar\s*sesi[oó]n|salir|logout/.test(aria)) return true;
      if (/cerrar\s*sesi[oó]n/i.test((el.innerText || el.textContent || "").trim())) return true;
      return /power_settings_new|mdi-power|fa-power|power-off|\bpower\b/i.test(iconBlob(el));
    };
    let btn = clickables.find(semantic);
    if (!btn) {
      // Respaldo: FAB/icon redondo arriba a la derecha de la ventana.
      btn = clickables
        .filter((el) => /v-btn--(fab|icon|round)/.test(typeof el.className === "string" ? el.className : ""))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.top < 160 && r.right > window.innerWidth - 220 && r.width > 28)
        .sort((a, b) => b.r.right - a.r.right)[0]?.el;
    }
    if (!btn) return false;
    automationClickInProgress = true;
    try { btn.click(); } finally { setTimeout(() => { automationClickInProgress = false; }, 50); }
    // El logout abre un diálogo "¿Está seguro? / CERRAR SESIÓN". Confirmamos
    // buscando ese botón en TODO el documento (Vuetify monta el contenido del
    // diálogo fuera del overlay), con reintentos por si tarda en aparecer. El
    // texto exacto "cerrar sesión" no matchea el botón de power (es un ícono).
    let confirmTries = 0;
    const confirmLogout = () => {
      const ok = Array.from(document.querySelectorAll("button, a, [role='button']")).find((el) => {
        if (!/^cerrar\s*sesi[oó]n$/i.test((el.innerText || el.textContent || "").trim())) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (ok) {
        automationClickInProgress = true;
        try { ok.click(); } finally { setTimeout(() => { automationClickInProgress = false; }, 50); }
        // El click ya corrió el handler de logout del SII (cierra la sesión) →
        // pedir el cierre de la ventana AHORA, síncrono, antes de que la
        // navegación del logout destruya este contexto. Cierre confiable.
        sendWorkerAction("close");
        return;
      }
      if (++confirmTries < 5) { setTimeout(confirmLogout, 400); }
      else { sendWorkerAction("close"); } // no apareció el confirm → cerrar igual
    };
    setTimeout(confirmLogout, 500);
    return true;
  }

  async function fillAndEmit(job) {
    const amount = String(Math.max(0, Math.round(Number(job?.totales?.monto_total ?? 0))));
    if (!amount || amount === "0") throw new Error("Monto invalido para e-Boleta");
    if (!buttonByText("EMITIR")) throw new Error("Pantalla e-Boleta no lista");

    // Cuentas multi-empresa: dejar seleccionada la EMPRESA correcta antes de nada.
    // Cambiar el emisor puede refrescar el portal para esa empresa, así que esperamos a
    // que el EMITIR vuelva a estar listo. Luego verificación fail-closed del emisor activo.
    await selectEmisorByRut(job?.emisor_rut);
    for (let i = 0; i < 20 && !buttonByText("EMITIR"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!buttonByText("EMITIR")) throw new Error("La pantalla e-Boleta no volvió a estar lista tras seleccionar la empresa.");
    assertEmisorRut(job);

    renderOverlay("LOCKED_AUTOMATION", "Preparando e-Boleta. No escribas ni hagas click.");

    // Cinturón anti-concatenación: si el pad trae un botón de borrado, limpiarlo
    // antes de teclear (inofensivo con el display en cero). La garantía dura es el
    // reload pre-retry del librero (background.js), que deja la calculadora virgen;
    // sin ambas, un reintento tecleaba el monto ENCIMA del anterior y podía emitir
    // una boleta real por los dos montos pegados.
    for (const clearText of ["C", "CE", "AC", "BORRAR"]) {
      const clearBtn = buttonByText(clearText);
      if (clearBtn) {
        await clickElement(clearBtn);
        await new Promise((resolve) => setTimeout(resolve, 150));
        break;
      }
    }

    for (const digit of amount) {
      await clickButtonText(digit);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    renderOverlay("LOCKED_AUTOMATION", "Abriendo formulario de e-Boleta.");
    await clickButtonText("EMITIR");
    let dialog = await waitForEmitDialog();
    if (!dialog) {
      throw new Error("El modal Emitir e-Boleta no se abrio; no se presiono el EMITIR final.");
    }

    // Sucursal: requerida. A veces auto-selecciona (una sola dirección) y a
    // veces queda en "Elija sucursal" por carrera de carga; si está vacía,
    // elegir la primera disponible.
    const dlgSucursal = activeEmitDialog();
    if (dlgSucursal && /elija sucursal/i.test(dlgSucursal.innerText || dlgSucursal.textContent || "")) {
      await selectFirstVuetifyOption("elija sucursal");
    }

    // Tipo de boleta: el select muestra el valor por defecto; lo abrimos por
    // el slot que contiene "Boleta" y elegimos el tipo deseado (afecta/exenta).
    const wantedType = job?.tipo_dte === 41 ? "Boleta exenta" : "Boleta afecta";
    await selectVuetifyOption("Boleta", wantedType);

    // Método de pago: el SII NO registra la boleta sin él. Si no se logra
    // seleccionar, abortamos antes del EMITIR para no clickear un form inválido.
    const paymentMethod = job?.payment_method || "Efectivo";
    const pagoOk = await selectVuetifyOption("metodo de pago", paymentMethod)
      || await selectVuetifyOption("elija metodo", paymentMethod);
    if (!pagoOk) {
      throw new Error("No pude seleccionar el método de pago en el modal SII (campo requerido). Selecciónalo manualmente y usa Capturar folio.");
    }

    // Glosa de la boleta (campo "Detalle" del SII, máx 80 caracteres): texto
    // libre opcional que el usuario define en Revisar / boleta única. Viaja en
    // job.glosa (separado del ítem de detalle). Se activa el toggle "Detalle",
    // se escribe el campo (identificado por el contador "/ 80") y se verifica.
    // Best-effort: si no se logra escribir con certeza, se APAGA el toggle para
    // no dejar el formulario en mal estado — la emisión siempre tiene prioridad.
    const glosa = String(job?.glosa || "").trim().slice(0, 80);
    if (glosa) {
      renderOverlay("LOCKED_AUTOMATION", "Escribiendo la glosa de la boleta.");
      let glosaOk = false;
      if (await enableDialogToggle("Detalle")) {
        for (let i = 0; i < 12 && !glosaOk; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const glosaInput = findGlosaInput();
          if (glosaInput) {
            setControlValue(glosaInput, glosa);
            await new Promise((resolve) => setTimeout(resolve, 150));
            glosaOk = normalizeText(glosaInput.value) === normalizeText(glosa);
          }
        }
      }
      if (!glosaOk) await setDialogToggle("Detalle", false);
    }

    // Receptor OPCIONAL — espejo del formulario SII: RUT, Nombre, Dirección, E-mail,
    // Teléfono. Cada campo se escribe solo si el job lo trae (best-effort: si el SII no
    // muestra ese input, se salta sin romper — NO relanza, para no reintroducir fragilidad).
    // Se activa si viene CUALQUIER dato del receptor, no solo el RUT (todos opcionales).
    const r = job?.receptor || {};
    if (r.rut || r.razon_social || r.direccion || r.email || r.telefono) {
      renderOverlay("LOCKED_AUTOMATION", "Completando datos del receptor.");
      const toggled = await enableDialogToggle("Receptor");
      if (toggled) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const fill = (pattern, value) => {
          if (!value) return;
          const input = findDialogControl(pattern);
          if (input) setControlValue(input, String(value));
        };
        fill(/RUT.*RECEPTOR|RECEPTOR.*RUT|RUT\s*CON\s*DV/, r.rut);
        fill(/NOMBRE.*RECEPTOR|RECEPTOR.*NOMBRE/, r.razon_social);
        fill(/DIRECCION.*RECEPTOR|RECEPTOR.*DIRECCION/, r.direccion);
        fill(/(E-?MAIL|CORREO).*RECEPTOR|RECEPTOR.*(E-?MAIL|CORREO)/, r.email);
        fill(/(TELEFONO|FONO|CELULAR).*RECEPTOR|RECEPTOR.*(TELEFONO|FONO|CELULAR)/, r.telefono);
      }
    }

    if (job?.allow_final_emit !== true) {
      renderOverlay("PAUSED", "Formulario listo. Falta autorizacion explicita para emitir la boleta final.");
      return;
    }

    renderOverlay("LOCKED_AUTOMATION", "Validando datos y emitiendo boleta en SII.");
    // Esperar a que el SII habilite EMITIR (deshabilitado mientras valida el receptor:
    // lookup del RUT, e-mail/teléfono). Convierte el cuelgue silencioso en éxito (si solo
    // faltaba asentarse) o error claro (si un dato del receptor no pasa). PRE-emit.
    await waitFinalEmitEnabled();
    dialog = activeEmitDialog(); // re-capturar: el modal pudo re-renderizarse al validar
    if (!dialog) throw new Error("Modal Emitir e-Boleta cerrado antes de emitir; no se presiono el EMITIR final.");
    assertEmisorNoCambio(job); // ÚLTIMA COMPUERTA: aborta si el emisor cambió (THROW aquí = ANTES de notifyFinalEmitClicked → job reintentable, sin folio, sin doble emisión)
    await clickFinalEmitInDialog(dialog);
    notifyFinalEmitClicked(); // arma el candado en el librero AL INSTANTE (no espera los 16s)
    // ⚠️ ZONA POST-EMIT: el EMITIR real YA se cliqueó. Cualquier fallo de aquí en
    // adelante puede significar un folio emitido en el SII pero aún sin confirmar.
    // Marcamos el error con finalEmitClicked para que el librero (background.js) NO
    // cierre el trabajo ni permita re-emitir, y pase a CAPTURA: así nunca se pierde
    // el folio ni se emite dos veces. (No cambia CÓMO se detecta/cliquea el EMITIR.)
    try {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await clickFirstAvailable(["ACEPTAR", "CONFIRMAR", "SÍ", "CONTINUAR"]);

    // Verificar que la emisión realmente quedó: el modal habilita Imprimir/
    // Descargar/Compartir y aparece el folio. Si no, no se emitió (form inválido).
    const emitConfirmed = await (async () => {
      for (let i = 0; i < 16; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const dlg = activeEmitDialog();
        if (!dlg) return true; // el modal se cerró tras emitir
        // Imprimir/Descargar se habilitan SOLO tras emitir (Compartir está
        // habilitado siempre, así que no sirve como señal).
        const enabled = Array.from(dlg.querySelectorAll("button")).some((b) =>
          /IMPRIMIR|DESCARGAR/.test(normalizeText(b.innerText || b.textContent)) && !b.disabled);
        if (enabled) return true;
        if (/BOLETA ELECTR[OÓ]NICA N[UÚ]MERO|FOLIO/i.test(dlg.innerText || dlg.textContent || "")) return true;
      }
      return false;
    })();
    if (!emitConfirmed) {
      throw new Error("Cliqué EMITIR pero el SII no confirmó la boleta (revisa método de pago u otra validación). Buscaré el folio para no perderlo.");
    }
    renderOverlay("LOCKED_AUTOMATION", "Boleta emitida en SII. Capturando folio y respaldo.");
    } catch (error) {
      const tagged = error instanceof Error ? error : new Error(String(error));
      tagged.finalEmitClicked = true;
      throw tagged;
    }
  }

  async function captureResultWhenReady(job) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 1500));
      const result = captureResult(job);
      if (hasStrongFolioResult(result)) {
        // Folio fuerte + estamos en el recibo → capturar el PDF oficial vía
        // COMPARTIR (primario). Si no se logra, el background cae a DESCARGAR.
        if (!result.pdf?.base64) {
          renderOverlay("LOCKED_AUTOMATION", "Capturando el PDF de la boleta.");
          const sharePdf = await tryCaptureSharePdf();
          if (sharePdf) result.pdf = sharePdf;
        }
        renderOverlay("DONE", `Boleta emitida. Folio ${result.folio}.`);
        return result;
      }
    }

    const lastScreenResult = captureResult(job);
    if (lastScreenResult.folio || /Descargar|Imprimir|Compartir|Folio|Boleta emitida|Emitida/i.test(lastScreenResult.page.excerpt)) {
      renderOverlay("PAUSED", "SII parece haber respondido, pero no pude confirmar el folio automaticamente. Usa Capturar folio si lo ves en pantalla.");
      return lastScreenResult;
    }

    renderOverlay("LOCKED_AUTOMATION", "No encontre folio en la pantalla actual. Revisando reportes SII.");
    if (!location.href.includes("/reportes")) {
      location.href = "https://eboleta.sii.cl/reportes";
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const reportResult = captureResult(job);
      if (hasStrongFolioResult(reportResult) || reportResult.folio || /Nro Folio|Acciones|EXPORTAR|Descargar/i.test(reportResult.page.excerpt)) {
        reportResult.estado = hasStrongFolioResult(reportResult) ? "emitida_capturada_reportes" : reportResult.folio ? "resultado_requiere_revision" : "reportes_sin_folio_detectado";
        renderOverlay(
          hasStrongFolioResult(reportResult) ? "DONE" : "PAUSED",
          hasStrongFolioResult(reportResult)
            ? `Boleta encontrada en reportes. Folio ${reportResult.folio}.`
            : "Revise reportes SII, pero no pude confirmar el folio automaticamente.",
        );
        return reportResult;
      }
    }

    const result = captureResult(job);
    renderOverlay("PAUSED", "No pude detectar folio ni respaldo despues de emitir. Revisa la pantalla SII y reintenta captura.");
    return result;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== EXT_SOURCE) return;
    if (message.job_id) currentJobId = message.job_id;
    if (message.job && typeof message.job.logout_after === "boolean") currentJobLogoutAfter = message.job.logout_after;
    if (message.type === "APP_CONTABLE_SII_WORKER_OVERLAY") {
      renderOverlay(message.mode || "HUMAN_REQUIRED", message.message || "Ventana segura SII activa.");
      return;
    }
    if (message.type === "APP_CONTABLE_SII_SCAN_PAGE") {
      sendResponse({ map: scanPage() });
      return;
    }
    if (message.type === "APP_CONTABLE_SII_FILL_AND_EMIT") {
      fillAndEmit(message.job)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          // El librero usa esto para NO cerrar el trabajo ni re-emitir tras el emit real.
          final_emit_clicked: error?.finalEmitClicked === true,
        }));
      return true;
    }
    if (message.type === "APP_CONTABLE_SII_ATTEMPT_AUTOLOGIN") {
      attemptAutologin(message.credentials || {})
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          renderOverlay("HUMAN_REQUIRED", error instanceof Error ? error.message : String(error));
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    }
    if (message.type === "APP_CONTABLE_SII_CAPTURE_RESULT") {
      captureResultWhenReady(message.job)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  });
})();
