(() => {
  "use strict";

  const EXT_SOURCE = "app-contable-extension";
  const OVERLAY_ID = "app-contable-sii-worker-overlay";
  let currentMode = null;
  let currentJobId = null;
  let automationClickInProgress = false;

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
            <button type="button" data-app-contable-action="close" style="border:0;border-radius:999px;padding:7px 12px;background:#fff;color:#0f5132;font-size:12px;font-weight:800;cursor:pointer;">Cerrar ventana</button>
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

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute("data-app-contable-action");
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
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
    if (automationClickInProgress) return;
    if (currentMode !== "LOCKED_AUTOMATION") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  ["click", "dblclick", "keydown", "keypress", "keyup", "input", "submit", "paste", "drop"].forEach((eventName) => {
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

  async function openSelectByValue(value) {
    const dialog = document.querySelector(".v-dialog.v-dialog--active") || document;
    const slots = Array.from(dialog.querySelectorAll(".v-select__slot, .v-input__slot"));
    const slot = slots.find((element) => normalizeText(element.innerText || element.textContent).includes(normalizeText(value)));
    if (!slot) return false;
    await clickElement(slot);
    return true;
  }

  async function chooseMenuOption(option) {
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

  // El contador puede operar varias empresas en e-Boleta (selector superior):
  // antes de emitir se verifica que el RUT emisor visible sea el del job.
  function assertEmisorRut(job) {
    const want = String(job?.emisor_rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
    if (!want) return;
    const rutsVisibles = (pageText().match(/\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]/g) || [])
      .map((r) => r.replace(/[^0-9kK]/g, "").toUpperCase());
    if (rutsVisibles.length > 0 && !rutsVisibles.includes(want)) {
      throw new Error(`El portal SII tiene seleccionada otra empresa. Elige el emisor RUT ${job.emisor_rut} en el selector superior y reintenta.`);
    }
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

  async function fillAndEmit(job) {
    const amount = String(Math.max(0, Math.round(Number(job?.totales?.monto_total ?? 0))));
    if (!amount || amount === "0") throw new Error("Monto invalido para e-Boleta");
    if (!buttonByText("EMITIR")) throw new Error("Pantalla e-Boleta no lista");

    // Verificación de emisor antes de tocar nada (cuentas multi-empresa).
    assertEmisorRut(job);

    renderOverlay("LOCKED_AUTOMATION", "Preparando e-Boleta. No escribas ni hagas click.");

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

    // Glosa de la boleta (toggle "Detalle", máx 80 caracteres): identifica el
    // movimiento de origen — clave para la trazabilidad MASSDTE. Es best-effort:
    // si no se logra escribir de forma confiable, se APAGA el toggle Detalle
    // para no dejar un campo requerido vacío que bloquee el EMITIR. La emisión
    // siempre tiene prioridad sobre la glosa.
    const glosa = String(job?.detalles?.[0]?.nombre || "").trim().slice(0, 80);
    if (glosa) {
      renderOverlay("LOCKED_AUTOMATION", "Escribiendo la glosa de la boleta.");
      let glosaOk = false;
      const toggled = await enableDialogToggle("Detalle");
      if (toggled) {
        // El campo de glosa aparece tras activar el toggle; esperar a que monte.
        for (let i = 0; i < 10 && !glosaOk; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const dlg = activeEmitDialog() || document;
          const glosaInput = Array.from(dlg.querySelectorAll("input, textarea")).find((el) => {
            if (!isVisibleEnabled(el)) return false;
            const ph = normalizeSearchText(el.getAttribute("placeholder") || "");
            const lbl = normalizeSearchText(labelFor(el));
            // Campo "Detalle" (placeholder/label), excluyendo monto/receptor/etc.
            return (ph === "detalle" || lbl === "detalle" || /glosa/.test(ph + lbl))
              && !/monto|total|rut|nombre|mail|telefono|direccion|vendedor/.test(ph + lbl);
          });
          if (glosaInput) {
            setControlValue(glosaInput, glosa);
            await new Promise((resolve) => setTimeout(resolve, 150));
            glosaOk = normalizeText(glosaInput.value) === normalizeText(glosa);
          }
        }
      }
      if (!glosaOk) {
        // No se pudo escribir la glosa con certeza: apagar Detalle para que el
        // formulario quede válido y la boleta se emita igual (sin glosa).
        await setDialogToggle("Detalle", false);
      }
    }

    // Receptor opcional: solo si el job lo trae (legal sin receptor < $180.000).
    if (job?.receptor?.rut) {
      renderOverlay("LOCKED_AUTOMATION", "Completando datos del receptor.");
      const toggled = await enableDialogToggle("Receptor");
      if (toggled) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const rutInput = findDialogControl(/RUT.*RECEPTOR|RECEPTOR.*RUT|RUT\s*CON\s*DV/);
        if (rutInput) setControlValue(rutInput, String(job.receptor.rut));
        if (job.receptor.razon_social) {
          const nombreInput = findDialogControl(/NOMBRE.*RECEPTOR|RECEPTOR.*NOMBRE/);
          if (nombreInput) setControlValue(nombreInput, String(job.receptor.razon_social));
        }
      }
    }

    if (job?.allow_final_emit !== true) {
      renderOverlay("PAUSED", "Formulario listo. Falta autorizacion explicita para emitir la boleta final.");
      return;
    }

    renderOverlay("LOCKED_AUTOMATION", "Emitiendo boleta final en SII.");
    dialog = activeEmitDialog();
    if (!dialog) throw new Error("Modal Emitir e-Boleta cerrado antes de emitir; no se presiono el EMITIR final.");
    await clickFinalEmitInDialog(dialog);
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
      throw new Error("Cliqué EMITIR pero el SII no confirmó la boleta (revisa método de pago u otra validación). No se marcará como emitida.");
    }
    renderOverlay("LOCKED_AUTOMATION", "Boleta emitida en SII. Capturando folio y respaldo.");
  }

  async function captureResultWhenReady(job) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 1500));
      const result = captureResult(job);
      if (hasStrongFolioResult(result)) {
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
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
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
