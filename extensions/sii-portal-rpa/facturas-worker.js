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
  function pageKind() {
    if (formEl("PreViewDTE")) return "preview";
    if (formEl("VIEW_EFXP")) return "formulario";
    if (formEl("fPrmEmpPOP")) return "selector_empresa";
    const texto = (document.body?.innerText ?? "").slice(0, 4000);
    const pwd = document.querySelector('input[type="password"]');
    // LOGIN ANTES QUE FIRMA (bug cazado EN VIVO 2026-08-27, stream completo):
    // la página de login del SII tiene input password Y menciona "certificado
    // digital" como opción de entrada — con firma primero, el worker tipeaba
    // la CLAVE DEL CERTIFICADO como Clave Tributaria, el login rebotaba y el
    // flujo quedaba en unknown/observando para siempre (el titileo + modal
    // congelado). El login manda: RUT + Clave Tributaria es inconfundible.
    if (pwd && /clave\s+tributaria|iniciar\s+sesi|autenticaci/i.test(texto)) return "login";
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
    // REGLA DURA (cazada en la primera factura real 2026-08-26): el AJAX del
    // autocomplete puede REEMPLAZAR nodos del formulario — jamás retener una
    // referencia a `form`/campos a través de un await. Todo acceso pasa por
    // f() (form fresco) y los overrides se re-aplican con verificación.
    const f = () => formEl("VIEW_EFXP");
    const codigo = valorDe(f(), "PTDC_CODIGO");
    if (codigo !== String(job.tipo_dte)) {
      return { ok: false, error: "TIPO_PORTAL_MISMATCH", detalle: `El formulario es tipo ${codigo} y el job pide ${job.tipo_dte}.` };
    }

    // Receptor primero: el change del DV dispara enviaCGI (AJAX) — que corra
    // mientras seguimos con el resto.
    const rutRecep = splitRutCuerpoDv(job.receptor?.rut);
    if (!rutRecep) return { ok: false, error: "RECEPTOR_RUT_INVALID" };
    setVal(campo(f(), "EFXP_RUT_RECEP"), rutRecep.cuerpo);
    setVal(campo(f(), "EFXP_DV_RECEP"), rutRecep.dv);

    // Esperar el autocomplete (<2s medido; 8s de margen), SIEMPRE contra el
    // form fresco. Si no llega, no importa: el job trae el receptor completo.
    await waitFor(() => valorDe(f(), "EFXP_RZN_SOC_RECEP"), 8000, 300);
    // Respiro extra: que el AJAX termine de re-pintar antes de escribir.
    await esperar(700);

    const r = job.receptor ?? {};
    const det = Array.isArray(job.detalles) ? job.detalles[0] : null;
    if (!det) return { ok: false, error: "DETALLE_MISSING" };

    // Overrides idempotentes sobre el form FRESCO. Se aplican y se VERIFICAN;
    // si el portal re-pinta y pisa algo, la segunda/tercera vuelta lo repone.
    const aplicarTodo = () => {
      if (job.fecha_emision) setVal(campo(f(), "EFXP_FCH_EMIS"), job.fecha_emision);
      // Ciudades: el autocomplete las deja vacías y SON obligatorias.
      if (!valorDe(f(), "EFXP_CIUDAD_ORIGEN")) {
        setVal(campo(f(), "EFXP_CIUDAD_ORIGEN"), valorDe(f(), "EFXP_CMNA_ORIGEN") || job.receptor?.ciudad || "");
      }
      if (r.razon_social) setValInteligente(campo(f(), "EFXP_RZN_SOC_RECEP"), r.razon_social);
      if (r.direccion) setValInteligente(campo(f(), "EFXP_DIR_RECEP"), r.direccion);
      if (r.comuna) setValInteligente(campo(f(), "EFXP_CMNA_RECEP"), r.comuna);
      if (r.ciudad) setValInteligente(campo(f(), "EFXP_CIUDAD_RECEP"), r.ciudad);
      if (r.giro) setValInteligente(campo(f(), "EFXP_GIRO_RECEP"), r.giro);
      if (r.contacto || r.email) setVal(campo(f(), "EFXP_CONTACTO"), r.contacto || r.email);
      setVal(campo(f(), "EFXP_NMB_01"), det.nombre);
      setVal(campo(f(), "EFXP_QTY_01"), det.cantidad ?? 1);
      setVal(campo(f(), "EFXP_PRC_01"), det.precio); // change → calculaRelacionadoFacEx
      // Forma de pago: 1=Contado · 2=Crédito (3=Sin Costo JAMÁS se usa).
      setVal(campo(f(), "EFXP_FMA_PAGO"), job.forma_pago === "credito" ? "2" : "1");
    };

    let faltas = [];
    for (let intento = 0; intento < 3; intento += 1) {
      aplicarTodo();
      await esperar(600);
      faltas = preValidar(f(), job);
      if (faltas.length === 0) break;
    }

    if (!r.giro && !valorDe(f(), "EFXP_GIRO_RECEP")) {
      // Persona natural sin giro y el autocomplete tampoco lo trajo: pausa
      // humana (criterio 8 de la espec: se informa, se ingresa a mano).
      return { ok: false, error: "GIRO_RECEPTOR_REQUERIDO", human: true, detalle: "El SII no informó giro para este receptor. Ingrésalo en la app (queda guardado en tu libreta de clientes) y reintenta." };
    }
    if (faltas.length > 0) {
      return { ok: false, error: "FORMULARIO_INCOMPLETO", human: true, detalle: `Faltan: ${faltas.join(", ")}. (3 intentos de escritura sobre el form fresco)` };
    }

    // Glosa extendida (>40 chars): checkbox Descrip. inserta el textarea.
    if (det.descripcion) {
      const chk = campo(f(), "DESCRIP_01");
      if (chk && !chk.checked) clickEl(chk); // dibujaTextArea inserta EFXP_DSC_ITEM_01
      const area = await waitFor(() => campo(formEl("VIEW_EFXP"), "EFXP_DSC_ITEM_01"), 3000, 150);
      if (area) setVal(area, det.descripcion);
    }

    // Totales del portal vs el job (±$1 de redondeo) — ANTES de validar.
    const totalEsperado = Number(job.totales?.monto_total);
    const totalPortal = await waitFor(() => {
      const t = montoPortal(valorDe(formEl("VIEW_EFXP"), "EFXP_MNT_TOTAL"));
      return t && t > 0 ? t : null;
    }, 6000, 250);
    if (!totalPortal || !Number.isFinite(totalEsperado) || Math.abs(totalPortal - totalEsperado) > 1) {
      return { ok: false, error: "TOTAL_MISMATCH", detalle: `El portal calculó $${totalPortal ?? "?"} y el documento aprobado dice $${totalEsperado}. No se firma un documento descuadrado.` };
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
      if (kind === "post_firma") return { kind, ...stepPostFirma(job) };
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
