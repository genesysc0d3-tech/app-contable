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

  // BALIZA DE DIAGNÓSTICO (auditoría titileo 2026-08-26): cada copia instalada
  // de la extensión imprime su ID al inyectarse. Si en la consola de la
  // pestaña SII aparecen DOS balizas, hay DOS copias conviviendo (p. ej. la
  // 0.1.8 de la Web Store + la carpeta dev) y la vieja puede estar conduciendo
  // la página por su cuenta. Un renglón, cero efectos.
  try {
    console.log("[FACT-worker] inyectado · ext:", chrome.runtime.id, "· v:", chrome.runtime.getManifest?.()?.version, "·", location.href);
  } catch { /* sin permiso runtime: igual seguimos */ }

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

  // Escribe respetando la naturaleza del control (cazado en vivo 2026-08-26):
  // cuando el SII CONOCE al receptor, campos como la dirección llegan como
  // <select> de valores registrados — escribirles texto arbitrario los deja
  // vacíos. En un select: match exacto por value → match por texto
  // normalizado (contiene) → primera opción con valor real.
  function setValInteligente(el, valor) {
    if (!el) return false;
    if (el.tagName === "SELECT") {
      const objetivo = String(valor ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const opciones = [...el.options].filter((o) => String(o.value ?? "").trim() !== "");
      const porValor = opciones.find((o) => String(o.value).trim().toLowerCase() === objetivo);
      const porTexto = opciones.find((o) => {
        const t = String(o.text ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        return t && (t.includes(objetivo) || objetivo.includes(t));
      });
      const elegida = porValor ?? porTexto ?? opciones[0];
      if (!elegida) return false;
      return setVal(el, elegida.value);
    }
    return setVal(el, valor);
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

  // ── Libreto: catálogo de nombres/regex/esperas del portal como DATO, con
  //    FALLBACK al hardcode. Sin job.libreto (o con un campo faltante) devuelve
  //    el literal de siempre → conducta BYTE-IDÉNTICA. El servidor manda el
  //    espejo exacto (src/lib/emission/sii-libreto.ts) para poder arreglar un
  //    cambio de selector del SII con un deploy, sin pasar por la Chrome Web
  //    Store. OJO: acá SOLO se resuelve QUÉ nombre/regex/espera usar. La
  //    coreografía (orden, el RUT que se pone una vez, los 3 reintentos, POST
  //    vs AJAX) y la SEGURIDAD (match del emisor, candado, TOTAL_MISMATCH,
  //    evidencia del folio) son CÓDIGO, jamás datos del servidor.
  // ── INVARIANTES EN CÓDIGO (C2 del red team 2026-09-10) ──────────────────
  // C2 del red team: la compuerta no puede depender del dato que verifica.
  // TOTAL_MISMATCH y TIPO_PORTAL_MISMATCH leen SIEMPRE estos nombres fijos,
  // aunque el libreto traiga `campos.monto_total` / `campos.tipo_verif` (se
  // siguen aceptando por compat, pero NO alimentan la compuerta). Con
  // `monto_total:"EFXP_PRC_01"` la compuerta comparaba el precio que el propio
  // worker acababa de escribir → pasaba siempre. Nunca más.
  const CAMPO_TOTAL_FIJO = "EFXP_MNT_TOTAL";
  const CAMPO_TIPO_FIJO = "PTDC_CODIGO";
  // F1 (tanda 3) — M3 del red team: permutar DENTRO de la whitelist cruzaba datos
  // con las compuertas verdes (rut_recep↔dv_recep, cantidad↔precio, razón social
  // del receptor en la del emisor…): el total cuadraba, el tipo cuadraba, y la
  // factura salía con el RUT y la razón social cambiados. Los campos CRÍTICOS se
  // escriben y leen SIEMPRE por estos nombres fijos; el libreto los sigue
  // aceptando (compat con el espejo TS) pero NO manda sobre ellos.
  const CAMPOS_CRITICOS_FIJOS = Object.freeze({
    rut_recep: "EFXP_RUT_RECEP",
    dv_recep: "EFXP_DV_RECEP",
    razon_soc_recep: "EFXP_RZN_SOC_RECEP",
    razon_soc_emisor: "EFXP_RZN_SOC",
    detalle_cantidad: "EFXP_QTY_01",
    detalle_precio: "EFXP_PRC_01",
    forma_pago: "EFXP_FMA_PAGO",
    fecha_emision: "EFXP_FCH_EMIS",
  });
  // Forma de pago del portal: 1=Contado · 2=Crédito · 3=Sin costo (JAMÁS). Un
  // libreto que traiga otro código (o los permute) no escribe nada: abort
  // pre-Validar con FORMA_PAGO_INVALIDA.
  const FORMA_PAGO_FIJA = { contado: "1", credito: "2" };
  const PDF_LINK_HARD = 'a[href*="mipeDisplayPDF.cgi"]';
  // Gracia pre-firma en página desconocida antes de avisar (F4). Es el único
  // knob de espera que NO está en el espejo TS (opcional en el libreto, solo
  // para poder acortarlo en el sintético); sin él, 20 s.
  const UNKNOWN_GRACE_HARD = 20000;

  // Una espera del libreto solo vale si es un ENTERO en [50, 60000] ms; un
  // string ("8000") daba `Date.now() > "abc"` siempre false → cuelgue eterno.
  const esperaOk = (v, hard) => (Number.isInteger(v) && v >= 50 && v <= 60000 ? v : hard);

  function resolverLibreto(job) {
    const L = job?.libreto ?? null;
    const c = L?.campos ?? {};
    const f = L?.forms ?? {};
    const d = L?.detectores ?? {};
    const s = L?.selectores ?? {};
    const e = L?.esperas ?? {};
    const p = L?.codigos?.forma_pago ?? {};
    // Un regex del libreto que no compila cae al hardcode. Lo demás (largo,
    // anidamiento, que no matchee "" ni "x") lo rechaza validateLibreto ANTES
    // de abrir la ventana; acá solo se resuelve.
    const re = (src, hard) => { try { return src ? new RegExp(src, "i") : hard; } catch { return hard; } };
    return {
      forms: {
        preview: f.preview ?? "PreViewDTE",
        formulario: f.formulario ?? "VIEW_EFXP",
        selector_empresa: f.selector_empresa ?? "fPrmEmpPOP",
      },
      det: {
        login: re(d.login, /clave\s+tributaria|iniciar\s+sesi|autenticaci/i),
        firma: re(d.firma, /certificado|firma/i),
        exito_a: re(d.exito_a, /ENVIADO\s+EXITOSAMENTE/i),
        exito_b: re(d.exito_b, /DOCUMENTO\s+TRIBUTARIO/i),
      },
      campos: {
        emisor_select: c.emisor_select ?? "RUT_EMP",
        tipo_verif: c.tipo_verif ?? "PTDC_CODIGO", // compat: NO alimenta la compuerta (CAMPO_TIPO_FIJO)
        // Críticos: FIJOS en código (F1) — el libreto no manda acá.
        rut_recep: CAMPOS_CRITICOS_FIJOS.rut_recep,
        dv_recep: CAMPOS_CRITICOS_FIJOS.dv_recep,
        razon_soc_recep: CAMPOS_CRITICOS_FIJOS.razon_soc_recep,
        dir_recep: c.dir_recep ?? "EFXP_DIR_RECEP",
        comuna_recep: c.comuna_recep ?? "EFXP_CMNA_RECEP",
        ciudad_recep: c.ciudad_recep ?? "EFXP_CIUDAD_RECEP",
        giro_recep: c.giro_recep ?? "EFXP_GIRO_RECEP",
        contacto: c.contacto ?? "EFXP_CONTACTO",
        comuna_origen: c.comuna_origen ?? "EFXP_CMNA_ORIGEN",
        ciudad_origen: c.ciudad_origen ?? "EFXP_CIUDAD_ORIGEN",
        razon_soc_emisor: CAMPOS_CRITICOS_FIJOS.razon_soc_emisor,
        giro_emisor: c.giro_emisor ?? "EFXP_GIRO_EMIS",
        fecha_emision: CAMPOS_CRITICOS_FIJOS.fecha_emision,
        forma_pago: CAMPOS_CRITICOS_FIJOS.forma_pago,
        detalle_nombre: c.detalle_nombre ?? "EFXP_NMB_01",
        detalle_cantidad: CAMPOS_CRITICOS_FIJOS.detalle_cantidad,
        detalle_precio: CAMPOS_CRITICOS_FIJOS.detalle_precio,
        glosa_checkbox: c.glosa_checkbox ?? "DESCRIP_01",
        glosa_textarea: c.glosa_textarea ?? "EFXP_DSC_ITEM_01",
        // Compat: se aceptan (el espejo TS los trae) pero NO alimentan ninguna
        // compuerta — ver CAMPO_TOTAL_FIJO / CAMPO_TIPO_FIJO.
        monto_total: c.monto_total ?? "EFXP_MNT_TOTAL",
        boton_validar: c.boton_validar ?? "Button_Update",
        boton_firmar: c.boton_firmar ?? "btnSign",
      },
      selectores: {
        submit_empresa: s.submit_empresa ?? 'button[type="submit"], input[type="submit"]',
        pdf_link: s.pdf_link ?? PDF_LINK_HARD,
      },
      codigos: { contado: p.contado ?? "1", credito: p.credito ?? "2" },
      esperas: {
        submit_empresa_cinturon: esperaOk(e.submit_empresa_cinturon, 2500),
        razon_recep: esperaOk(e.razon_recep, 8000),
        respiro_post_recep: esperaOk(e.respiro_post_recep, 700),
        reintento_override: esperaOk(e.reintento_override, 600),
        glosa_textarea: esperaOk(e.glosa_textarea, 3000),
        total_portal: esperaOk(e.total_portal, 6000),
        pagina_desconocida: esperaOk(e.pagina_desconocida, UNKNOWN_GRACE_HARD),
      },
    };
  }

  // ── Mapa SANEADO de la página (viaja con cada aviso de posible cambio del
  //    SII para que /dev vea QUÉ hay en la pantalla que no calzó): nombres de
  //    forms, `name` de inputs y textos de botones. JAMÁS valores de campos;
  //    los dígitos de 7+ seguidos (RUT, folio, teléfono, aun con puntos/guion)
  //    y los correos se tachan. Acotado a 2 KB (el background lo vuelve a
  //    acotar igual). Falla suave: null, nunca revienta el paso.
  const MAPA_MAX_BYTES = 2000;
  function textoSaneado(s, max = 40) {
    let t = String(s ?? "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    t = t.replace(/[^\s@]+@[^\s@]+/g, "@");
    t = t.replace(/\d(?:[.\-\s]?\d){6,}/g, "#");
    return t.slice(0, max);
  }
  function mapaSaneado() {
    try {
      const qsa = (sel) => { try { return [...(document.querySelectorAll?.(sel) ?? [])]; } catch { return []; } };
      const attr = (el, k) => (typeof el?.getAttribute === "function" ? el.getAttribute(k) : null) ?? el?.[k] ?? "";
      const forms = qsa("form").map((f) => textoSaneado(attr(f, "name") || attr(f, "id"))).filter(Boolean);
      const inputs = qsa("input, select, textarea")
        .map((el) => (String(attr(el, "type")).toLowerCase() === "password" ? "[password]" : textoSaneado(attr(el, "name"))))
        .filter(Boolean);
      const botones = qsa('button, input[type="submit"], input[type="button"]')
        .map((b) => textoSaneado(`${b.value ?? ""} ${b.textContent ?? ""}`, 30))
        .filter(Boolean);
      const mapa = {
        url: textoSaneado(String(location.href ?? "").split("?")[0], 80),
        forms: [...new Set(forms)].slice(0, 10),
        inputs: [...new Set(inputs)].slice(0, 40),
        botones: [...new Set(botones)].slice(0, 15),
      };
      // Recorte hasta caber: primero inputs, luego botones, luego forms.
      for (let guard = 0; guard < 80 && JSON.stringify(mapa).length > MAPA_MAX_BYTES; guard += 1) {
        if (mapa.inputs.length) mapa.inputs.pop();
        else if (mapa.botones.length) mapa.botones.pop();
        else if (mapa.forms.length) mapa.forms.pop();
        else break;
      }
      return mapa;
    } catch {
      return null;
    }
  }

  // Señal de POSIBLE CAMBIO DEL SII: se adjunta a un resultado cuando falla un
  // ANCLA ESTRUCTURAL del portal (un selector/form del libreto que SIEMPRE
  // debería existir y no está) — no un dato del cliente. Es aditiva: no cambia
  // ok/error/human/latches; si se quita, la conducta es byte-idéntica. Lleva
  // SOLO el rol del ancla del libreto (público), jamás RUT/nombre/monto.
  // Tanda 2 (contrato con background.js, SOLO campos agregados): además de
  // `ancla_faltante` (nombre viejo, se conserva) va `ancla` (mismo valor),
  // `code`, `page_kind`, `paso` (≤40) y `mapa` saneado.
  function cambioSii(ancla, extra = {}) {
    const out = { posible_cambio_sii: true, ancla_faltante: ancla, ancla };
    if (typeof extra.code === "string" && extra.code) out.code = extra.code.slice(0, 40);
    if (typeof extra.page_kind === "string" && extra.page_kind) out.page_kind = extra.page_kind;
    if (typeof extra.paso === "string" && extra.paso) out.paso = extra.paso.slice(0, 40);
    const mapa = mapaSaneado();
    if (mapa) out.mapa = mapa;
    return out;
  }

  // ── F5: marca "glosa omitida" que sobrevive a la navegación Validar→preview→
  //    firma→éxito (cada load mata este script). sessionStorage de sii.cl, solo
  //    el job_id (sin datos del cliente); se borra al leerla en post-firma.
  //    Falla suave: si el storage no existe (sintético) o revienta, nada cambia.
  const GLOSA_OMITIDA_KEY = "massdte:fact-glosa-omitida";
  function marcarGlosaOmitida(jobId) {
    try { if (jobId) sessionStorage.setItem(GLOSA_OMITIDA_KEY, String(jobId)); } catch { /* sin storage */ }
  }
  function leerGlosaOmitida(jobId) {
    try {
      const v = sessionStorage.getItem(GLOSA_OMITIDA_KEY);
      if (!v) return false;
      if (v !== String(jobId)) return false;
      sessionStorage.removeItem(GLOSA_OMITIDA_KEY);
      return true;
    } catch { return false; }
  }
  // F4 (tanda 3): al ARRANCAR el formulario del mismo job se borra la marca. Sin
  // esto, un reintento que SÍ escribió la glosa heredaba el `true` del intento
  // anterior y el resultado decía "glosa omitida" sobre una factura que la lleva.
  function limpiarGlosaOmitida(jobId) {
    try {
      if (sessionStorage.getItem(GLOSA_OMITIDA_KEY) === String(jobId)) sessionStorage.removeItem(GLOSA_OMITIDA_KEY);
    } catch { /* sin storage */ }
  }

  // Reloj inyectable SOLO para el sintético (window.__MASSDTE_TEST__.now); en
  // prod es Date.now. Nada del libreto ni del job puede tocarlo.
  const ahoraMs = () => {
    try {
      const h = typeof window !== "undefined" ? window.__MASSDTE_TEST__ : null;
      if (h && typeof h.now === "function") return Number(h.now());
    } catch { /* sin hooks */ }
    return Date.now();
  };

  // ── F4: página desconocida como ANCLA. Pre-firma, si el pageKind sigue
  //    `unknown` durante `esperas.pagina_desconocida` ms (20 s) desde el PRIMER
  //    unknown, el worker avisa UNA vez por job (PAGINA_DESCONOCIDA con
  //    page_kind:unknown + mapa) y devuelve error pre-emit, en vez de quedarse
  //    "observando" hasta que la app le ponga lápida a un documento que nunca
  //    se emitió. F3 (tanda 3): SOLO por tiempo (los "4 scans" vencían en 2 s
  //    con una ráfaga de onUpdated) y el "desde" se persiste en sessionStorage
  //    por job_id para sobrevivir a las navegaciones del portal (cada load mata
  //    este script y antes reiniciaba el reloj: nunca llegaba a los 20 s).
  //    Una pantalla conocida entre medio reinicia la cuenta (resetUnknown).
  const UNKNOWN_KEY = "massdte:fact-unknown";
  let unknownState = { jobId: null, desde: 0, avisado: false };
  function leerUnknownPersistido(jobId) {
    try {
      const raw = sessionStorage.getItem(UNKNOWN_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || p.job_id !== jobId || !Number.isFinite(p.desde)) return null;
      return { desde: p.desde, avisado: p.avisado === true };
    } catch { return null; }
  }
  function guardarUnknown(jobId, st) {
    try { sessionStorage.setItem(UNKNOWN_KEY, JSON.stringify({ job_id: jobId, desde: st.desde, avisado: st.avisado })); } catch { /* sin storage */ }
  }
  function registrarUnknown(job, gracia) {
    const jobId = String(job?.job_id ?? "");
    const ahora = ahoraMs();
    if (unknownState.jobId !== jobId) {
      const prev = leerUnknownPersistido(jobId);
      unknownState = { jobId, desde: prev?.desde ?? ahora, avisado: prev?.avisado ?? false };
      guardarUnknown(jobId, unknownState);
    }
    if (unknownState.avisado) return false;
    if (ahora - unknownState.desde < gracia) return false;
    unknownState.avisado = true;
    guardarUnknown(jobId, unknownState);
    return true;
  }
  function resetUnknown() {
    unknownState = { jobId: null, desde: 0, avisado: false };
    try { sessionStorage.removeItem(UNKNOWN_KEY); } catch { /* sin storage */ }
  }

  // Montos del portal: "1.000" / "1000" → entero.
  function montoPortal(raw) {
    const limpio = String(raw ?? "").replace(/[.\s$]/g, "").replace(",", ".");
    const n = Number(limpio);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  // ── Identidad de página (por estructura, no por URL: los CGIs redirigen) ─
  // PRECEDENCIA ENDURECIDA (auditoría 2026-08-26): el formulario y la vista
  // previa GANAN sobre el selector — el popup `fPrmEmpPOP` puede quedar
  // RESIDUAL en el DOM del formulario, y clasificar "selector_empresa" ahí
  // hacía re-clickear submit en cada recarga = titileo. Una página con
  // VIEW_EFXP/PreViewDTE ya pasó la selección de empresa, punto.
  function pageKind(job) {
    const LB = resolverLibreto(job);
    if (formEl(LB.forms.preview)) return "preview";
    if (formEl(LB.forms.formulario)) return "formulario";
    if (formEl(LB.forms.selector_empresa)) return "selector_empresa";
    const texto = (document.body?.innerText ?? "").slice(0, 4000);
    const pwd = document.querySelector('input[type="password"]');
    // LOGIN ANTES QUE FIRMA (bug cazado EN VIVO 2026-08-27, stream completo):
    // la página de login del SII tiene input password Y menciona "certificado
    // digital" como opción de entrada — con firma primero, el worker tipeaba
    // la CLAVE DEL CERTIFICADO como Clave Tributaria, el login rebotaba y el
    // flujo quedaba en unknown/observando para siempre (el titileo + modal
    // congelado). El login manda: RUT + Clave Tributaria es inconfundible.
    if (pwd && LB.det.login.test(texto)) return "login";
    if (pwd && LB.det.firma.test(texto)) return "firma";
    // Página de ÉXITO real del portal (capturada en vivo 2026-08-27, folios
    // 961/962): "DOCUMENTO TRIBUTARIO ELECTRÓNICO ENVIADO EXITOSAMENTE". El
    // folio NO está en el texto plano (vive en el iframe con la imagen del
    // documento) — el ancla basta para clasificar; stepPostFirma lo busca
    // también dentro de los iframes same-origin.
    if (LB.det.exito_a.test(texto) && LB.det.exito_b.test(texto)) return "post_firma";
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
    const LB = resolverLibreto(job);
    const form = formEl(LB.forms.selector_empresa);
    const sel = campo(form, LB.campos.emisor_select);
    if (!sel) return { ok: false, error: "SELECTOR_SIN_RUT_EMP", ...cambioSii("campos.emisor_select", { code: "SELECTOR_SIN_RUT_EMP", page_kind: "selector_empresa", paso: "selector_empresa:select" }) };
    // SEGURIDAD (no libreto): el match del emisor es CÓDIGO — el libreto solo
    // dice el NOMBRE del <select>, jamás afloja la comparación fail-closed.
    const objetivo = normalizeRutValue(job.emisor_rut);
    if (!objetivo) return { ok: false, error: "EMISOR_RUT_INVALID" };
    const candidatos = [...sel.options].filter((o) => normalizeRutValue(o.value) === objetivo);
    if (candidatos.length !== 1) {
      // human: reintentar no sirve de nada — el permiso se da en el SII.
      return { ok: false, error: "EMISOR_NO_AUTORIZADO", human: true, detalle: `Tu RUT no está autorizado en el SII para emitir por la empresa ${job.emisor_rut}. El representante legal de esa empresa tiene que autorizar tu RUT en el sitio del SII; desde acá no se puede habilitar.` };
    }
    setVal(sel, candidatos[0].value);
    const submit = form.querySelector(LB.selectores.submit_empresa);
    if (!clickEl(submit)) return { ok: false, error: "SELECTOR_SIN_SUBMIT", ...cambioSii("selectores.submit_empresa", { code: "SELECTOR_SIN_SUBMIT", page_kind: "selector_empresa", paso: "selector_empresa:submit" }) };
    // Cinturón (cazado en vivo 2026-08-27): el click sintético en Enviar puede
    // NO gatillar la navegación del CGI (la página quedó quieta con la empresa
    // elegida y el latch impedía reintentar). A los 2.5s forzamos el submit
    // nativo; si el click sí navegó, este timer muere con la página — jamás
    // doble-submite.
    setTimeout(() => {
      try {
        const f = formEl(LB.forms.selector_empresa);
        if (f && !formEl(LB.forms.formulario)) f.submit();
      } catch { /* la página ya navegó */ }
    }, LB.esperas.submit_empresa_cinturon);
    return { ok: true, action: "empresa_seleccionada" };
  }

  // Campos cuyo vacío haría rebotar validaFacEx con alert() invisible.
  // Devuelve las etiquetas que FALTAN (vacías). Aparte, `ausentesDe` separa el
  // caso ESTRUCTURAL: el control ni siquiera existe en el form (ancla del
  // libreto que desapareció = posible cambio del SII), distinto de "vacío".
  const CAMPOS_FORMULARIO = [
    ["razon_soc_emisor", "razón social del emisor"],
    ["giro_emisor", "giro del emisor"],
    ["comuna_origen", "comuna del emisor"],
    ["ciudad_origen", "ciudad del emisor"],
    ["rut_recep", "RUT del receptor"],
    ["razon_soc_recep", "razón social del receptor"],
    ["dir_recep", "dirección del receptor"],
    ["comuna_recep", "comuna del receptor"],
    ["ciudad_recep", "ciudad del receptor"],
    ["giro_recep", "giro del receptor"],
    ["detalle_nombre", "detalle"],
    ["detalle_cantidad", "cantidad"],
    ["detalle_precio", "precio"],
  ];
  function preValidar(form, job) {
    const c = resolverLibreto(job).campos;
    const faltas = [];
    for (const [rol, etiqueta] of CAMPOS_FORMULARIO) {
      if (!valorDe(form, c[rol])) faltas.push(etiqueta);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valorDe(form, c.fecha_emision))) faltas.push("fecha de emisión");
    // Forma de pago: contra los códigos FIJOS del portal, no los del libreto.
    const fma = valorDe(form, c.forma_pago);
    if (fma !== FORMA_PAGO_FIJA.contado && fma !== FORMA_PAGO_FIJA.credito) faltas.push("forma de pago");
    return faltas;
  }
  function ausentesDe(form, job) {
    const c = resolverLibreto(job).campos;
    const roles = [...CAMPOS_FORMULARIO.map(([rol]) => rol), "dv_recep", "fecha_emision", "forma_pago"];
    return roles.filter((rol) => !campo(form, c[rol]));
  }

  async function stepFormulario(job) {
    // REGLA DURA (cazada en la primera factura real 2026-08-26): el AJAX del
    // autocomplete puede REEMPLAZAR nodos del formulario — jamás retener una
    // referencia a `form`/campos a través de un await. Todo acceso pasa por
    // f() (form fresco) y los overrides se re-aplican con verificación.
    const LB = resolverLibreto(job);
    const c = LB.campos;
    const f = () => formEl(LB.forms.formulario);
    limpiarGlosaOmitida(job.job_id); // F4 (tanda 3): la marca es de ESTE intento
    // C2 del red team: la compuerta no puede depender del dato que verifica —
    // el tipo se lee del nombre FIJO, no de `campos.tipo_verif` del libreto.
    const codigo = valorDe(f(), CAMPO_TIPO_FIJO);
    if (codigo !== String(job.tipo_dte)) {
      // Campo AUSENTE (vacío) = ancla estructural desaparecida → posible cambio
      // del SII. Campo con OTRO valor = routing/dato, no estructura → sin señal.
      const structural = codigo === "" ? cambioSii("campos.tipo_verif", { code: "TIPO_PORTAL_MISMATCH", page_kind: "formulario", paso: "formulario:tipo_verif" }) : {};
      return { ok: false, error: "TIPO_PORTAL_MISMATCH", detalle: `El formulario es tipo ${codigo} y el job pide ${job.tipo_dte}.`, ...structural };
    }

    // INVARIANTE EN CÓDIGO: el código de forma de pago que se va a escribir
    // tiene que ser EXACTAMENTE el del portal para ese rol (1=Contado,
    // 2=Crédito). Un libreto que traiga "3" (Sin costo) o los permute aborta
    // acá, ANTES de escribir nada en el form (ni el RUT, que navega).
    const rolPago = job.forma_pago === "credito" ? "credito" : "contado";
    const codigoPago = LB.codigos[rolPago];
    if (codigoPago !== FORMA_PAGO_FIJA[rolPago]) {
      return { ok: false, error: "FORMA_PAGO_INVALIDA", detalle: `El código de forma de pago resuelto (${String(codigoPago)}) no es el del portal para ${rolPago} (${FORMA_PAGO_FIJA[rolPago]}). No se escribe nada.` };
    }

    // Anclas del formulario: si un control que SIEMPRE existe no está, es
    // estructura (posible cambio del SII), no un dato del cliente. Se mira
    // ANTES de escribir (el RUT del receptor puede navegar la página).
    const ausentes = ausentesDe(f(), job);
    if (ausentes.length > 0) {
      const rol = ausentes[0];
      return { ok: false, error: "FORMULARIO_SIN_CAMPO", detalle: `El formulario no tiene el control de ${rol} (${ausentes.length} ausente(s)).`, ...cambioSii(`campos.${rol}`, { code: "FORMULARIO_SIN_CAMPO", page_kind: "formulario", paso: `formulario:${rol}` }) };
    }

    // Receptor primero — MEDIDO EN VIVO 2026-08-27 (laboratorio con la página
    // real): el change del DV dispara enviaCGI y en este portal eso puede ser
    // un POST DE PÁGINA COMPLETA (no AJAX) — la página navega y vuelve con el
    // receptor autocompletado. Poner el RUT en cada pasada era el LOOP
    // infinito de recargas (titileo): cada reload re-ponía el RUT y re-POSTeaba.
    // Regla: el RUT se pone UNA vez; si la página ya lo trae (volvió del POST),
    // se salta el gatillo y se sigue con el resto. Los demás campos NO navegan
    // (detalle/cantidad/precio/forma de pago verificados en vivo).
    const rutRecep = splitRutCuerpoDv(job.receptor?.rut);
    if (!rutRecep) return { ok: false, error: "RECEPTOR_RUT_INVALID" };
    const rutYaPuesto = valorDe(f(), c.rut_recep) === rutRecep.cuerpo
      && valorDe(f(), c.dv_recep).toUpperCase() === rutRecep.dv;
    if (!rutYaPuesto) {
      setVal(campo(f(), c.rut_recep), rutRecep.cuerpo);
      setVal(campo(f(), c.dv_recep), rutRecep.dv);
      // Modo AJAX (existe también): la razón social aparece sin navegar y
      // seguimos en esta misma pasada. Modo POST: la página muere durante esta
      // espera, este script muere con ella, y el próximo load retoma con el
      // RUT ya puesto (rutYaPuesto=true) — sin re-gatillar. Convergente.
      const razonLlego = await waitFor(() => valorDe(formEl(LB.forms.formulario), c.razon_soc_recep), LB.esperas.razon_recep, 300);
      if (!razonLlego) {
        return { ok: true, action: "observando", detalle: "receptor enviado al SII, esperando autocomplete/recarga" };
      }
      // Respiro extra: que el re-pintado termine antes de escribir.
      await esperar(LB.esperas.respiro_post_recep);
    }

    const r = job.receptor ?? {};
    const det = Array.isArray(job.detalles) ? job.detalles[0] : null;
    if (!det) return { ok: false, error: "DETALLE_MISSING" };
    let glosaOmitida = false; // F5: la descripción larga no encontró textarea

    // Overrides idempotentes sobre el form FRESCO. Se aplican y se VERIFICAN;
    // si el portal re-pinta y pisa algo, la segunda/tercera vuelta lo repone.
    const aplicarTodo = () => {
      if (job.fecha_emision) setVal(campo(f(), c.fecha_emision), job.fecha_emision);
      // Ciudades: el autocomplete las deja vacías y SON obligatorias.
      if (!valorDe(f(), c.ciudad_origen)) {
        setVal(campo(f(), c.ciudad_origen), valorDe(f(), c.comuna_origen) || job.receptor?.ciudad || "");
      }
      if (r.razon_social) setValInteligente(campo(f(), c.razon_soc_recep), r.razon_social);
      if (r.direccion) setValInteligente(campo(f(), c.dir_recep), r.direccion);
      if (r.comuna) setValInteligente(campo(f(), c.comuna_recep), r.comuna);
      if (r.ciudad) setValInteligente(campo(f(), c.ciudad_recep), r.ciudad);
      if (r.giro) setValInteligente(campo(f(), c.giro_recep), r.giro);
      if (r.contacto || r.email) setVal(campo(f(), c.contacto), r.contacto || r.email);
      setVal(campo(f(), c.detalle_nombre), det.nombre);
      setVal(campo(f(), c.detalle_cantidad), det.cantidad ?? 1);
      setVal(campo(f(), c.detalle_precio), det.precio); // change → calculaRelacionadoFacEx
      // Forma de pago: 1=Contado · 2=Crédito (3=Sin Costo JAMÁS se usa). El
      // código ya se verificó arriba contra FORMA_PAGO_FIJA; se escribe el FIJO.
      setVal(campo(f(), c.forma_pago), FORMA_PAGO_FIJA[rolPago]);
    };

    let faltas = [];
    for (let intento = 0; intento < 3; intento += 1) {
      aplicarTodo();
      await esperar(LB.esperas.reintento_override);
      faltas = preValidar(f(), job);
      if (faltas.length === 0) break;
    }

    if (!r.giro && !valorDe(f(), c.giro_recep)) {
      // Persona natural sin giro y el autocomplete tampoco lo trajo: pausa
      // humana (criterio 8 de la espec: se informa, se ingresa a mano).
      return { ok: false, error: "GIRO_RECEPTOR_REQUERIDO", human: true, detalle: "El SII no informó giro para este receptor. Ingrésalo en la app (queda guardado en tu libreta de clientes) y reintenta." };
    }
    if (faltas.length > 0) {
      return { ok: false, error: "FORMULARIO_INCOMPLETO", human: true, detalle: `Faltan: ${faltas.join(", ")}. (3 intentos de escritura sobre el form fresco)` };
    }

    // Glosa extendida (>40 chars): checkbox Descrip. inserta el textarea.
    if (det.descripcion) {
      const chk = campo(f(), c.glosa_checkbox);
      if (chk && !chk.checked) clickEl(chk); // dibujaTextArea inserta el textarea de glosa
      const area = await waitFor(() => campo(formEl(LB.forms.formulario), c.glosa_textarea), LB.esperas.glosa_textarea, 150);
      if (area) {
        setVal(area, det.descripcion);
      } else {
        // El textarea no apareció (dibujaTextArea no corrió o el SII lo
        // renombró): la factura sale SIN la descripción larga. No se aborta
        // (el documento sigue siendo correcto en montos y receptor), pero se
        // marca para que el resultado post-firma lleve `glosa_omitida:true`
        // y nadie crea que la glosa viajó. Persistido en sessionStorage porque
        // Validar navega y este script muere con la página.
        glosaOmitida = true;
        marcarGlosaOmitida(job.job_id);
      }
    }

    // Totales del portal vs el job (±$1 de redondeo) — ANTES de validar.
    // SEGURIDAD (no libreto): el TOTAL_MISMATCH es CÓDIGO. C2 del red team: la
    // compuerta no puede depender del dato que verifica — se lee el campo FIJO
    // del total (CAMPO_TOTAL_FIJO), NO `campos.monto_total` del libreto (que
    // podía apuntar al precio recién escrito y pasar siempre).
    const totalEsperado = Number(job.totales?.monto_total);
    const totalPortal = await waitFor(() => {
      const t = montoPortal(valorDe(formEl(LB.forms.formulario), CAMPO_TOTAL_FIJO));
      return t && t > 0 ? t : null;
    }, LB.esperas.total_portal, 250);
    if (!totalPortal || !Number.isFinite(totalEsperado) || Math.abs(totalPortal - totalEsperado) > 1) {
      return { ok: false, error: "TOTAL_MISMATCH", detalle: `El portal calculó $${totalPortal ?? "?"} y el documento aprobado dice $${totalEsperado}. No se firma un documento descuadrado.` };
    }

    // "Validar y visualizar" NO emite ni asigna folio (la vista previa dice
    // "Documento NO válido") — es seguro pre-candado.
    if (job.learn_only === true) return { ok: true, action: "learn_stop_pre_validar", ...(glosaOmitida ? { glosa_omitida: true } : {}) };
    if (!clickEl(campo(formEl(LB.forms.formulario), c.boton_validar))) {
      return { ok: false, error: "SIN_BOTON_VALIDAR", ...cambioSii("campos.boton_validar", { code: "SIN_BOTON_VALIDAR", page_kind: "formulario", paso: "formulario:validar" }) };
    }
    return { ok: true, action: "validado", ...(glosaOmitida ? { glosa_omitida: true } : {}) }; // la página navega al preview
  }

  async function stepPreview(job) {
    const LB = resolverLibreto(job);
    const c = LB.campos;
    const form = formEl(LB.forms.preview);
    // Verificación cruzada final sobre los hidden del preview (es el
    // documento EXACTO que se firmaría). SEGURIDAD (no libreto): el
    // TOTAL_MISMATCH y el chequeo de tipo son CÓDIGO. C2 del red team: la
    // compuerta no puede depender del dato que verifica — nombres FIJOS, el
    // libreto no elige qué campo se compara.
    const totalPrev = montoPortal(valorDe(form, CAMPO_TOTAL_FIJO));
    const totalEsperado = Number(job.totales?.monto_total);
    if (totalPrev != null && Number.isFinite(totalEsperado) && Math.abs(totalPrev - totalEsperado) > 1) {
      return { ok: false, error: "TOTAL_MISMATCH", detalle: `La vista previa dice $${totalPrev} y el documento aprobado $${totalEsperado}.` };
    }
    const codigo = valorDe(form, CAMPO_TIPO_FIJO);
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

    const btn = campo(form, c.boton_firmar) ?? document.getElementById(c.boton_firmar);
    // btnSign no encontrado = ANTES de firmar (no hay folio en riesgo) → señal.
    if (!clickEl(btn)) return { ok: false, error: "SIN_BOTON_FIRMAR", ...cambioSii("campos.boton_firmar", { code: "SIN_BOTON_FIRMAR", page_kind: "preview", paso: "preview:firmar" }) };
    return { ok: true, action: "firmar_click" }; // navega a mipeGenXMLFirma
  }

  // Pantalla de la clave del certificado (post-Firmar). Solo pedir la clave si
  // el campo ya existe — si no, es la pantalla de espera "generando firma":
  // seguir observando (el próximo scan la retoma) sin gastar el único intento.
  function stepFirmaNecesitaClave() {
    const pwd = document.querySelector('input[type="password"]');
    if (!pwd) return { ok: true, action: "observando", detalle: "generando firma, esperando el campo de la clave" };
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
  // El folio de la página de éxito vive DENTRO del iframe con la imagen del
  // documento (mismo patrón que la vista previa) — sumar los iframes
  // same-origin al texto donde se busca.
  function textoConIframes() {
    let t = document.body?.innerText ?? "";
    for (const fr of document.querySelectorAll("iframe")) {
      try { t += "\n" + (fr.contentDocument?.body?.innerText ?? ""); } catch { /* cross-origin: ignorar */ }
    }
    return t;
  }

  // PDF de la factura recién emitida (medido en vivo 2026-08-27, folio 964):
  // la página de éxito (mipeSendXML.cgi) trae el link "Ver Documento" →
  // /cgi-bin/Portal001/mipeDisplayPDF.cgi?DHDR_CODIGO=... que responde
  // application/pdf directo (185KB, %PDF-1.4) con las cookies de la sesión.
  // Un fetch same-origin lo captura SIN navegar (la página de éxito sigue
  // viva para el resto de la captura). Falla suave: sin PDF el folio igual
  // se registra (pdf_pendiente, mismo contrato que boletas).
  async function capturarPdfFactura(job) {
    // F1: el selector viene del libreto (fallback PDF_LINK_HARD, byte-idéntico).
    let link = null;
    try { link = document.querySelector(resolverLibreto(job).selectores.pdf_link); } catch { link = null; }
    if (!link) return null;
    try {
      const resp = await fetch(link.getAttribute("href"), { credentials: "include" });
      // F2 (tanda 3): SOLO application/pdf y SOLO si los bytes parten con %PDF. Una
      // página de error/login del SII (text/html) NO se guarda como el PDF de la
      // factura; queda pdf:null (pdf_pendiente, mismo contrato que sin PDF).
      const ct = String(resp.headers.get("content-type") ?? "").toLowerCase();
      if (!resp.ok || !ct.startsWith("application/pdf")) return null;
      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 1000 || buf.byteLength > 15 * 1024 * 1024) return null;
      const bytes = new Uint8Array(buf);
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== "%PDF") return null;
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return {
        source: "fact_portal_pdf",
        base64: btoa(bin),
        content_type: "application/pdf",
        filename: `factura-${job?.tipo_dte ?? "34"}.pdf`,
        size: buf.byteLength,
        source_url: link.href,
      };
    } catch {
      return null;
    }
  }

  async function stepPostFirma(job) {
    const texto = textoConIframes();
    // Patrón primario: "folio NNN". Fallback: el "Nº962" del documento
    // impreso (cabecera roja), solo en página anclada como post_firma.
    const hit = extractFolioFromText(texto)
      ?? (() => {
        const m = texto.match(/N[°ºo]\s*:?\s*(\d{1,10})/);
        if (!m) return null;
        const folio = Number(m[1]);
        return Number.isSafeInteger(folio) && folio > 0 ? { folio, matched_text: m[0].slice(0, 60) } : null;
      })();
    // Emisor ACTIVO del portal ("Empresa: 77.155.156-4" en la cabecera): el
    // server lo cruza contra el RUT registrado — misma red que boletas.
    const emisorHit = texto.match(/Empresa:\s*([\d.]{7,12}-?[\dkK])/);
    const pdf = await capturarPdfFactura(job);
    const result = {
      emisor_rut_activo: emisorHit ? emisorHit[1] : null,
      folio: hit?.folio ?? null,
      folio_confidence: hit ? "high" : "none",
      pdf,
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
    // F5: si en el formulario la descripción larga no encontró textarea, el
    // resultado lo dice (la marca sobrevivió a las navegaciones en sessionStorage).
    if (leerGlosaOmitida(job.job_id)) result.glosa_omitida = true;
    return { ok: true, action: "captured", result };
  }

  async function handleDrive(message) {
    const job = message?.job;
    if (!job) return { ok: false, error: "JOB_MISSING" };
    // Deja respirar al DOM recién cargado (los CGIs inicializan con jQuery).
    await esperar(400);
    const kind = pageKind(job);
    if (kind !== "unknown") resetUnknown(); // F4: "consecutivos" — una pantalla conocida reinicia la cuenta
    console.log("[FACT-worker] handleDrive kind:", kind, "url:", location.href.split("/").pop(), "done:", JSON.stringify(message.done ?? {}));
    try {
      // CANDADO MONÓTONO: con Firmar ya clickeado, ni el formulario ni la
      // vista previa se vuelven a conducir (re-llenar + re-Firmar = posible
      // loop de firmas). Solo captura/clave; el humano decide el resto.
      if (message.final_emit_clicked === true && (kind === "formulario" || kind === "preview")) {
        return { kind, ok: false, error: "POST_FIRMA_REBOTO", human: true, detalle: "El portal volvió a una pantalla previa DESPUÉS de Firmar. No re-emito: verifica en el portal si la factura alcanzó a generarse." };
      }
      // LATCH DE PASO (auditoría 2026-08-26): un paso que NAVEGA no se repite.
      // El background lleva la cuenta (message.done = { empresa, validado });
      // si volvemos a aterrizar en un kind ya hecho, esperamos en vez de
      // re-clickear (matabas el titileo del selector que re-submitía).
      const done = message.done ?? {};
      if (kind === "selector_empresa") {
        if (done.empresa) return { kind, ok: true, action: "observando", detalle: "empresa ya seleccionada, esperando el formulario" };
        return { kind, ...stepSelectorEmpresa(job) };
      }
      if (kind === "formulario") {
        if (done.validado) return { kind, ok: true, action: "observando", detalle: "ya validado, esperando la vista previa" };
        return { kind, ...(await stepFormulario(job)) };
      }
      if (kind === "preview") return { kind, ...(await stepPreview(job)) };
      if (kind === "login") return { kind, ok: true, action: "needs_login" };
      if (kind === "firma") return { kind, ...stepFirmaNecesitaClave() };
      if (kind === "post_firma") return { kind, ...(await stepPostFirma(job)) };
      // F4: `unknown` pre-firma no puede ser eterno. Post-Firmar (candado
      // armado) se sigue observando: la pantalla "generando firma" y la de
      // éxito pasan por acá y ahí un error sería peor que esperar.
      if (message.final_emit_clicked !== true && registrarUnknown(job, resolverLibreto(job).esperas.pagina_desconocida)) {
        return {
          kind, ok: false, error: "PAGINA_DESCONOCIDA",
          detalle: "La página del SII no calza con ninguna pantalla conocida del portal de facturas (ni formulario, ni vista previa, ni login). No se emitió nada.",
          excerpt: excerpt(),
          ...cambioSii("page_kind:unknown", { code: "PAGINA_DESCONOCIDA", page_kind: "unknown", paso: "observando:unknown" }),
        };
      }
      return { kind, ok: true, action: "observando", excerpt: excerpt() };
    } catch (error) {
      return { kind, ok: false, error: "FACT_WORKER_ERROR", detalle: error instanceof Error ? error.message : String(error) };
    }
  }

  // PATRÓN PUSH (cazado en vivo 2026-08-26): mantener el canal del
  // sendMessage abierto durante los 15-20s del formulario moría con
  // "message channel closed before a response was received". El drive
  // responde 'accepted' AL TIRO y el resultado viaja como mensaje propio
  // (APP_CONTABLE_SII_FACT_STEP) cuando el paso termina — inmune a
  // navegaciones y a la vida del canal.
  let driveEnCurso = false;

  function pushStep(jobId, res) {
    try {
      chrome.runtime.sendMessage({ source: EXT_SOURCE, type: "APP_CONTABLE_SII_FACT_STEP", job_id: jobId, res }, () => {
        void chrome.runtime.lastError;
      });
    } catch { /* extensión recargada: el watchdog del próximo drive retoma */ }
  }

  // KEEP-ALIVE (causa raíz cazada 2026-08-26): un paso de facturas tarda
  // 15-20s llenando el formulario. En ese rato el service worker MV3 se queda
  // sin eventos y Chrome lo RECICLA a los ~30s → se pierde el estado del job
  // (activeJobs) y el pushStep del resultado cae en un SW vacío → el modal se
  // congela para siempre. Un latido cada 10s mientras el paso corre resetea
  // el timer de reciclado del SW y lo mantiene vivo hasta que el push llegue.
  function pingBackground() {
    try {
      chrome.runtime.sendMessage({ source: EXT_SOURCE, type: "APP_CONTABLE_SII_FACT_KEEPALIVE" }, () => { void chrome.runtime.lastError; });
    } catch { /* extensión recargada */ }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "APP_CONTABLE_SII_FACT_DRIVE") {
      if (driveEnCurso) {
        sendResponse({ ok: true, accepted: true, busy: true });
        return false;
      }
      driveEnCurso = true;
      sendResponse({ ok: true, accepted: true });
      pingBackground();
      const keepalive = setInterval(pingBackground, 10000);
      handleDrive(message)
        .then((res) => pushStep(message.job_id ?? message.job?.job_id ?? null, res))
        .catch((error) => pushStep(message.job_id ?? null, { ok: false, error: "FACT_WORKER_ERROR", detalle: error instanceof Error ? error.message : String(error) }))
        .finally(() => { clearInterval(keepalive); driveEnCurso = false; });
      return false;
    }
    if (message?.type === "APP_CONTABLE_SII_FACT_SIGN") {
      sendResponse({ ok: true, accepted: true });
      handleSign(message)
        .then((res) => pushStep(message.job_id ?? null, { ...res, kind: "firma" }))
        .catch((error) => pushStep(message.job_id ?? null, { ok: false, error: "FACT_WORKER_ERROR", detalle: error instanceof Error ? error.message : String(error), kind: "firma" }));
      return false;
    }
    return false;
  });
})();
