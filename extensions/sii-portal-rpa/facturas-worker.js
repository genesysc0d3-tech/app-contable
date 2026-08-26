"use strict";

// Worker del PORTAL DE FACTURAS (Sistema de Facturación Gratuito del SII,
// tipos 33/34). El hermano de sii-worker.js, pero para el portal CLÁSICO
// (HTML + jQuery, forms con names EFXP_*), no el Vuetify de e-Boleta.
//
// Mapa de verdad: docs/facturas-portal-page-map.md (levantado EN VIVO
// 2026-08-26 hasta la vista previa, sin firmar).
//
// División del trabajo en la misma pestaña (*.sii.cl inyecta AMBOS workers):
// - sii-worker.js: overlay/candado de UI, SCAN_PAGE (learn + detección de
//   login para el autologin del background). No conduce facturas.
// - facturas-worker.js (este archivo): SOLO responde mensajes
//   APP_CONTABLE_SII_FACT_* del background y conduce el portal de facturas.
//
// Doctrina heredada de boletas (no negociable):
// - Fail-closed en el emisor: la empresa se selecciona por MATCH EXACTO del
//   value del <select name=RUT_EMP> (RUT con DV normalizado). 0 o >1 → abort.
// - Pre-validación TOTAL antes de "Validar y visualizar": los errores del
//   portal son alert() del MAIN world, invisibles desde este isolated world.
// - TOTAL_MISMATCH: si el total que calculó el portal difiere del job (±$1),
//   se aborta SIN validar ni firmar.
// - Candado monótono: APP_CONTABLE_SII_FINAL_EMIT_CLICKED se manda ANTES de
//   clickear Firmar (el acto que puede quemar folio).
// - La clave del certificado se pide al background SOLO al llegar a la
//   pantalla de firma, se usa UNA vez y no se retiene.
// - Folio: solo evidencia fuerte (match explícito con la palabra "folio").

(() => {
  if (window.__appContableFactWorker) return;
  window.__appContableFactWorker = true;

  const EXT_SOURCE = "app-contable-extension";

  // ── Espejos inline de modules/facturas-portal.js (los content scripts no
  //    importan ESM; el módulo es la fuente de verdad y tiene los tests) ──
  function splitRutCuerpoDv(rut) {
    const limpio = String(rut ?? "").replace(/\./g, "").replace(/\s/g, "").toUpperCase();
    const m = limpio.match(/^(\d{1,8})-?([\dK])$/);
    if (!m) return null;
    return { cuerpo: m[1], dv: m[2] };
  }
  function normalizeRutValue(v) {
    const s = splitRutCuerpoDv(v);
    return s ? `${s.cuerpo}-${s.dv}` : null;
  }
  function extractFolioFromText(text) {
    const t = String(text ?? "");
    const patrones = [
      /folio\s*(?:n(?:ro)?\.?\s*[°ºo]?\s*)?[:#]?\s*(\d{1,10})/i,
      /n[°ºo]\s*folio\s*[:#]?\s*(\d{1,10})/i,
    ];
    for (const re of patrones) {
      const m = t.match(re);
      if (m) {
        const folio = Number(m[1]);
        if (Number.isSafeInteger(folio) && folio > 0) return { folio, matched_text: m[0].slice(0, 60) };
      }
    }
    return null;
  }

  // ── Primitivas del portal clásico ──────────────────────────────────────
  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(fn, timeoutMs, intervalMs = 250) {
    const limite = Date.now() + timeoutMs;
    for (;;) {
      let value = null;
      try { value = fn(); } catch { value = null; }
      if (value) return value;
      if (Date.now() > limite) return null;
      await esperar(intervalMs);
    }
  }

  // Setter nativo + eventos: los handlers del portal cuelgan de onchange
  // inline (enviaCGI, calculaRelacionadoFacEx) — un change sintético los corre.
  function setVal(el, value) {
    if (!el) return false;
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, String(value)); else el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function clickEl(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
    return true;
  }

  const formEl = (name) => document.querySelector(`form[name="${name}"]`);
  const campo = (form, name) => (form?.elements?.namedItem?.(name) ?? null);
  const valorDe = (form, name) => String(campo(form, name)?.value ?? "").trim();

  // Montos del portal: "1.000" / "1000" → entero.
  function montoPortal(raw) {
    const limpio = String(raw ?? "").replace(/[.\s$]/g, "").replace(",", ".");
    const n = Number(limpio);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  // ── Identidad de página (por estructura, no por URL: los CGIs redirigen) ─
  function pageKind() {
    if (formEl("fPrmEmpPOP")) return "selector_empresa";
    if (formEl("VIEW_EFXP")) return "formulario";
    if (formEl("PreViewDTE")) return "preview";
    const texto = (document.body?.innerText ?? "").slice(0, 4000);
    const pwd = document.querySelector('input[type="password"]');
    if (pwd && /certificado|firma/i.test(texto)) return "firma";
    if (extractFolioFromText(texto) && /factura|documento tributario/i.test(texto)) return "post_firma";
    return "unknown";
  }

  function excerpt() {
    return (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 500);
  }

  // ── Pasos ──────────────────────────────────────────────────────────────

  // Selector de empresa: match EXACTO por value normalizado. La lista trae
  // las N empresas donde el usuario está autorizado — el RUT del job manda.
  function stepSelectorEmpresa(job) {
    const form = formEl("fPrmEmpPOP");
    const sel = campo(form, "RUT_EMP");
    if (!sel) return { ok: false, error: "SELECTOR_SIN_RUT_EMP" };
    const objetivo = normalizeRutValue(job.emisor_rut);
    if (!objetivo) return { ok: false, error: "EMISOR_RUT_INVALID" };
    const candidatos = [...sel.options].filter((o) => normalizeRutValue(o.value) === objetivo);
    if (candidatos.length !== 1) {
      return { ok: false, error: "EMISOR_NO_AUTORIZADO", detalle: `El RUT ${job.emisor_rut} no está entre las empresas autorizadas de esta sesión SII.` };
    }
    setVal(sel, candidatos[0].value);
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!clickEl(submit)) return { ok: false, error: "SELECTOR_SIN_SUBMIT" };
    return { ok: true, action: "empresa_seleccionada" };
  }

  // Campos cuyo vacío haría rebotar validaFacEx con alert() invisible.
  function preValidar(form, job) {
    const faltas = [];
    const exige = (name, etiqueta) => { if (!valorDe(form, name)) faltas.push(etiqueta); };
    exige("EFXP_RZN_SOC", "razón social del emisor");
    exige("EFXP_GIRO_EMIS", "giro del emisor");
    exige("EFXP_CMNA_ORIGEN", "comuna del emisor");
    exige("EFXP_CIUDAD_ORIGEN", "ciudad del emisor");
    exige("EFXP_RUT_RECEP", "RUT del receptor");
    exige("EFXP_RZN_SOC_RECEP", "razón social del receptor");
    exige("EFXP_DIR_RECEP", "dirección del receptor");
    exige("EFXP_CMNA_RECEP", "comuna del receptor");
    exige("EFXP_CIUDAD_RECEP", "ciudad del receptor");
    exige("EFXP_GIRO_RECEP", "giro del receptor");
    exige("EFXP_NMB_01", "detalle");
    exige("EFXP_QTY_01", "cantidad");
    exige("EFXP_PRC_01", "precio");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valorDe(form, "EFXP_FCH_EMIS"))) faltas.push("fecha de emisión");
    const fma = valorDe(form, "EFXP_FMA_PAGO");
    if (fma !== "1" && fma !== "2") faltas.push("forma de pago");
    return faltas;
  }

  async function stepFormulario(job) {
    const form = formEl("VIEW_EFXP");
    const codigo = valorDe(form, "PTDC_CODIGO");
    if (codigo !== String(job.tipo_dte)) {
      return { ok: false, error: "TIPO_PORTAL_MISMATCH", detalle: `El formulario es tipo ${codigo} y el job pide ${job.tipo_dte}.` };
    }

    // Fecha (editable; el guardarraíl de período vive en la app — acá se obedece).
    if (job.fecha_emision) setVal(campo(form, "EFXP_FCH_EMIS"), job.fecha_emision);

    // Ciudad del emisor: el autocomplete del portal la deja vacía y ES
    // obligatoria (verificado en vivo). Fallback: la comuna del emisor.
    if (!valorDe(form, "EFXP_CIUDAD_ORIGEN")) {
      setVal(campo(form, "EFXP_CIUDAD_ORIGEN"), valorDe(form, "EFXP_CMNA_ORIGEN") || job.receptor?.ciudad || "");
    }

    // Receptor: RUT en dos cajas; el change del DV dispara enviaCGI (AJAX).
    const rutRecep = splitRutCuerpoDv(job.receptor?.rut);
    if (!rutRecep) return { ok: false, error: "RECEPTOR_RUT_INVALID" };
    setVal(campo(form, "EFXP_RUT_RECEP"), rutRecep.cuerpo);
    setVal(campo(form, "EFXP_DV_RECEP"), rutRecep.dv);

    // Esperar el autocomplete (<2s medido; 8s de margen). Si no llega, no
    // importa: el job trae el receptor COMPLETO y lo escribimos igual.
    await waitFor(() => valorDe(form, "EFXP_RZN_SOC_RECEP"), 8000, 300);

    // El documento nace de la APP (receptor completo obligatorio, decisión
    // del fundador): los datos del job PISAN lo que haya autocompletado.
    const r = job.receptor ?? {};
    if (r.razon_social) setVal(campo(form, "EFXP_RZN_SOC_RECEP"), r.razon_social);
    if (r.direccion) setVal(campo(form, "EFXP_DIR_RECEP"), r.direccion);
    if (r.comuna) setVal(campo(form, "EFXP_CMNA_RECEP"), r.comuna);
    if (r.ciudad) setVal(campo(form, "EFXP_CIUDAD_RECEP"), r.ciudad);
    if (r.giro) setVal(campo(form, "EFXP_GIRO_RECEP"), r.giro);
    else if (!valorDe(form, "EFXP_GIRO_RECEP")) {
      // Persona natural sin giro y el autocomplete tampoco lo trajo: pausa
      // humana (criterio 8 de la espec: se informa, se ingresa a mano).
      return { ok: false, error: "GIRO_RECEPTOR_REQUERIDO", human: true, detalle: "El SII no informó giro para este receptor. Ingrésalo en la app (queda guardado en tu libreta de clientes) y reintenta." };
    }
    if (r.contacto || r.email) setVal(campo(form, "EFXP_CONTACTO"), r.contacto || r.email);

    // Detalle (1 línea, criterio del masivo simple).
    const det = Array.isArray(job.detalles) ? job.detalles[0] : null;
    if (!det) return { ok: false, error: "DETALLE_MISSING" };
    setVal(campo(form, "EFXP_NMB_01"), det.nombre);
    if (det.descripcion) {
      const chk = campo(form, "DESCRIP_01");
      if (chk && !chk.checked) clickEl(chk); // dibujaTextArea inserta EFXP_DSC_ITEM_01
      const area = await waitFor(() => campo(formEl("VIEW_EFXP"), "EFXP_DSC_ITEM_01"), 3000, 150);
      if (area) setVal(area, det.descripcion);
    }
    setVal(campo(form, "EFXP_QTY_01"), det.cantidad ?? 1);
    setVal(campo(form, "EFXP_PRC_01"), det.precio); // change → calculaRelacionadoFacEx

    // Forma de pago: 1=Contado · 2=Crédito (3=Sin Costo JAMÁS se usa).
    setVal(campo(form, "EFXP_FMA_PAGO"), job.forma_pago === "credito" ? "2" : "1");

    // Totales del portal vs el job (±$1 de redondeo) — ANTES de validar.
    const totalEsperado = Number(job.totales?.monto_total);
    const totalPortal = await waitFor(() => {
      const t = montoPortal(valorDe(formEl("VIEW_EFXP"), "EFXP_MNT_TOTAL"));
      return t && t > 0 ? t : null;
    }, 6000, 250);
    if (!totalPortal || !Number.isFinite(totalEsperado) || Math.abs(totalPortal - totalEsperado) > 1) {
      return { ok: false, error: "TOTAL_MISMATCH", detalle: `El portal calculó $${totalPortal ?? "?"} y el documento aprobado dice $${totalEsperado}. No se firma un documento descuadrado.` };
    }

    const faltas = preValidar(formEl("VIEW_EFXP"), job);
    if (faltas.length > 0) {
      return { ok: false, error: "FORMULARIO_INCOMPLETO", human: true, detalle: `Faltan: ${faltas.join(", ")}.` };
    }

    // "Validar y visualizar" NO emite ni asigna folio (la vista previa dice
    // "Documento NO válido") — es seguro pre-candado.
    if (job.learn_only === true) return { ok: true, action: "learn_stop_pre_validar" };
    if (!clickEl(campo(formEl("VIEW_EFXP"), "Button_Update"))) {
      return { ok: false, error: "SIN_BOTON_VALIDAR" };
    }
    return { ok: true, action: "validado" }; // la página navega al preview
  }

  async function stepPreview(job) {
    const form = formEl("PreViewDTE");
    // Verificación cruzada final sobre los hidden del preview (es el
    // documento EXACTO que se firmaría).
    const totalPrev = montoPortal(valorDe(form, "EFXP_MNT_TOTAL"));
    const totalEsperado = Number(job.totales?.monto_total);
    if (totalPrev != null && Number.isFinite(totalEsperado) && Math.abs(totalPrev - totalEsperado) > 1) {
      return { ok: false, error: "TOTAL_MISMATCH", detalle: `La vista previa dice $${totalPrev} y el documento aprobado $${totalEsperado}.` };
    }
    const codigo = valorDe(form, "PTDC_CODIGO");
    if (codigo && codigo !== String(job.tipo_dte)) {
      return { ok: false, error: "TIPO_PORTAL_MISMATCH" };
    }

    if (job.allow_final_emit !== true || job.learn_only === true) {
      return { ok: true, action: "paused_preview", human: true };
    }

    // CANDADO ANTES DE FIRMAR: desde este click puede quemarse folio. El
    // background arma finalEmitClicked al instante; ninguna ruta de error
    // posterior re-emite ni cierra el job.
    await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ source: EXT_SOURCE, type: "APP_CONTABLE_SII_FINAL_EMIT_CLICKED", job_id: job.job_id }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch { resolve(); }
    });

    const btn = campo(form, "btnSign") ?? document.getElementById("btnSign");
    if (!clickEl(btn)) return { ok: false, error: "SIN_BOTON_FIRMAR" };
    return { ok: true, action: "firmar_click" }; // navega a mipeGenXMLFirma
  }

  // Pantalla de la clave del certificado (post-Firmar; estructura por
  // confirmar en la fase 4 — este handler es defensivo por diseño).
  function stepFirmaNecesitaClave() {
    return { ok: true, action: "needs_cert_password" };
  }

  async function handleSign(message) {
    const clave = message?.clave_certificado;
    if (!clave) return { ok: false, error: "CERT_PASSWORD_MISSING" };
    const pwd = document.querySelector('input[type="password"]');
    if (!pwd) return { ok: false, error: "FIRMA_SIN_CAMPO_CLAVE" };
    setVal(pwd, clave);
    // Botón de confirmación: PRIMERO dentro del form de la clave (no pegarle
    // a otro control de la página); el documento entero es solo fallback.
    const alcance = pwd.form ?? document;
    let botones = [...alcance.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .filter((b) => /firmar|aceptar|enviar|continuar/i.test(`${b.value ?? ""} ${b.textContent ?? ""}`));
    if (botones.length === 0 && pwd.form) {
      botones = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')]
        .filter((b) => /firmar|aceptar|enviar|continuar/i.test(`${b.value ?? ""} ${b.textContent ?? ""}`));
    }
    const btn = botones[0] ?? pwd.form?.querySelector('[type="submit"]');
    if (!clickEl(btn)) {
      if (pwd.form) { pwd.form.submit(); } else { return { ok: false, error: "FIRMA_SIN_BOTON" }; }
    }
    return { ok: true, action: "clave_enviada" };
  }

  // Página post-firma: capturar folio con evidencia fuerte y construir el
  // resultado en el MISMO contrato que boletas (handleCapturedResult).
  function stepPostFirma(job) {
    const texto = document.body?.innerText ?? "";
    const hit = extractFolioFromText(texto);
    // Emisor ACTIVO del portal ("Empresa: 77.155.156-4" en la cabecera): el
    // server lo cruza contra el RUT registrado — misma red que boletas.
    const emisorHit = texto.match(/Empresa:\s*([\d.]{7,12}-?[\dkK])/);
    const result = {
      emisor_rut_activo: emisorHit ? emisorHit[1] : null,
      folio: hit?.folio ?? null,
      folio_confidence: hit ? "high" : "none",
      folio_evidence: hit ? { source: "fact_portal_text", matched_text: hit.matched_text } : null,
      tipo_dte: job.tipo_dte,
      fecha_emision: job.fecha_emision ?? null,
      estado: "emitido",
      monto_total: job.totales?.monto_total ?? null,
      forma_pago: job.forma_pago === "credito" ? "Crédito" : "Contado",
      receptor: {
        rut: job.receptor?.rut ?? null,
        razon_social: job.receptor?.razon_social ?? null,
        giro: job.receptor?.giro ?? null,
        direccion: job.receptor?.direccion ?? null,
        comuna: job.receptor?.comuna ?? null,
      },
      detalles: (job.detalles ?? []).map((d) => ({ nombre: d.nombre, cantidad: d.cantidad ?? 1, monto_total: job.totales?.monto_total ?? null })),
      totales: job.totales ?? null,
      artifact_links: [...document.querySelectorAll("a")]
        .map((a) => ({ kind: "link", text: (a.textContent ?? "").trim().slice(0, 40), href: a.href }))
        .filter((l) => /\.pdf(\?|$)|folio/i.test(l.href))
        .slice(0, 6),
      page: { url: location.href, title: document.title, excerpt: excerpt() },
    };
    return { ok: true, action: "captured", result };
  }

  async function handleDrive(message) {
    const job = message?.job;
    if (!job) return { ok: false, error: "JOB_MISSING" };
    // Deja respirar al DOM recién cargado (los CGIs inicializan con jQuery).
    await esperar(400);
    const kind = pageKind();
    try {
      if (kind === "selector_empresa") return { kind, ...stepSelectorEmpresa(job) };
      if (kind === "formulario") return { kind, ...(await stepFormulario(job)) };
      if (kind === "preview") return { kind, ...(await stepPreview(job)) };
      if (kind === "firma") return { kind, ...stepFirmaNecesitaClave() };
      if (kind === "post_firma") return { kind, ...stepPostFirma(job) };
      return { kind, ok: true, action: "observando", excerpt: excerpt() };
    } catch (error) {
      return { kind, ok: false, error: "FACT_WORKER_ERROR", detalle: error instanceof Error ? error.message : String(error) };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "APP_CONTABLE_SII_FACT_DRIVE") {
      handleDrive(message).then(sendResponse).catch(() => sendResponse({ ok: false, error: "FACT_WORKER_ERROR" }));
      return true;
    }
    if (message?.type === "APP_CONTABLE_SII_FACT_SIGN") {
      handleSign(message).then(sendResponse).catch(() => sendResponse({ ok: false, error: "FACT_WORKER_ERROR" }));
      return true;
    }
    return false;
  });
})();
