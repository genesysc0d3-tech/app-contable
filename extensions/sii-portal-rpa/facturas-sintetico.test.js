// SINTÉTICO del worker de FACTURAS: corre el facturas-worker.js REAL contra un
// DOM falso que GRABA cada escritura/click en orden, manejándolo igual que el
// background (mensaje APP_CONTABLE_SII_FACT_DRIVE → respuesta por
// APP_CONTABLE_SII_FACT_STEP). No toca el SII.
//
// Para qué: es la red de seguridad del refactor libreto→job. Establece la
// secuencia de acciones del worker ORIGINAL (el que ya funciona). Cuando el
// worker pase a leer `job.libreto` con fallback (fase 2), este mismo sintético
// prueba que CON libreto == SIN libreto == el original — la definición
// operativa de "pura mudanza".
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FACTURA_LIBRETO } from "../../src/lib/emission/sii-libreto.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SRC = readFileSync(join(__dirname, "facturas-worker.js"), "utf8");

// ── DOM falso que graba ──────────────────────────────────────────────────
// Un solo `document` (el IIFE lo captura al montarse); las páginas se cambian
// seteando `activeForms` antes de cada drive.
let activeForms = new Map();
let actions = []; // la grabación: [{op:"set",name,value} | {op:"click",name}]
let activeBodyText = ""; // texto de la página (para los detectores de pageKind)
let activePwd = false; // ¿hay input[type=password]? (login/firma)

function field(name, { tag = "INPUT", value = "", options = null, checked = false } = {}) {
  return {
    tagName: tag,
    name,
    _value: String(value),
    get value() { return this._value; },
    set value(v) { this._value = String(v); actions.push({ op: "set", name, value: String(v) }); },
    checked,
    options: options ? options.map((o) => ({ value: o.value, text: o.text })) : [],
    dispatchEvent() { return true; },
    click() { actions.push({ op: "click", name }); },
  };
}

function form(name, fields) {
  const byName = new Map(fields.map((f) => [f.name, f]));
  return {
    name, tagName: "FORM", _fields: fields,
    elements: { namedItem: (n) => byName.get(n) ?? null },
    querySelector: (sel) => (/submit/i.test(sel) ? byName.get("__submit__") ?? null : null),
    submit() { /* no navega en el sintético */ },
  };
}

const fakeDocument = {
  body: { get innerText() { return activeBodyText; } },
  getElementById: (id) => activeForms.get(id) ?? null,
  querySelector: (sel) => {
    const m = String(sel).match(/^form\[name="([^"]+)"\]$/);
    if (m) return activeForms.get(m[1]) ?? null;
    if (/password/i.test(sel)) return activePwd ? { tagName: "INPUT" } : null;
    return null;
  },
  // Para el `mapa` saneado (tanda 2): forms, controles y botones de la página.
  querySelectorAll: (sel) => {
    const s = String(sel);
    const forms = [...activeForms.values()];
    const campos = forms.flatMap((f) => f._fields ?? []);
    if (/^form$/i.test(s)) return forms;
    if (/^input, select, textarea$/i.test(s)) return campos.filter((c) => c.tagName !== "BUTTON");
    if (/^button/i.test(s)) return campos.filter((c) => c.tagName === "BUTTON");
    return [];
  },
};

// ── Arnés: monta el worker real y lo maneja como el background ─────────────
let driveListener = null;
let outgoing = [];

function mountWorker() {
  const win = {};
  const chrome = {
    runtime: {
      id: "sintetico",
      lastError: null,
      getManifest: () => ({ version: "sintetico" }),
      sendMessage: (msg, cb) => { outgoing.push(msg); if (cb) cb(); },
      onMessage: { addListener: (h) => { driveListener = h; } },
    },
  };
  const location = { href: "https://www1.sii.cl/cgi-bin/Portal001/mipeEmite.cgi" };
  const silent = { log() {}, warn() {}, error() {}, info() {} };
  class DomCtor {}
  class Evt { constructor(t) { this.type = t; } }
  new Function(
    "window", "chrome", "document", "location", "console",
    "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Event", "MouseEvent",
    WORKER_SRC,
  )(win, chrome, fakeDocument, location, silent, DomCtor, DomCtor, DomCtor, Evt, Evt);
}

// Maneja un drive y espera el push del resultado (APP_CONTABLE_SII_FACT_STEP).
async function drive(job, forms, { bodyText = "", pwd = false } = {}) {
  activeForms = new Map(forms.map((f) => [f.name, f]));
  activeBodyText = bodyText;
  activePwd = pwd;
  actions = [];
  outgoing = [];
  driveListener({ type: "APP_CONTABLE_SII_FACT_DRIVE", job, job_id: job.job_id, done: {} }, {}, () => {});
  // Espera activa hasta que el worker empuje su FACT_STEP (o timeout de test).
  for (let i = 0; i < 400; i += 1) {
    const step = outgoing.find((m) => m?.type === "APP_CONTABLE_SII_FACT_STEP");
    if (step) return { res: step.res, actions: actions.slice() };
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("el worker no empujó FACT_STEP (¿se colgó un waitFor?)");
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const EMISOR = "78.448.088-7";
const RECEPTOR = "77.155.156-4";

const jobFactura = (over = {}) => ({
  kind: "factura",
  job_id: "job-sint-1",
  emisor_rut: EMISOR,
  tipo_dte: 34,
  fecha_emision: "2026-08-30",
  forma_pago: "contado",
  receptor: {
    rut: RECEPTOR, razon_social: "MV SpA", direccion: "Mendoza 0932",
    comuna: "San Bernardo", ciudad: "San Bernardo", giro: "Asesorías", contacto: "mv@ej.cl",
  },
  detalles: [{ nombre: "Servicio de asesoría", cantidad: 1, precio: 100000 }],
  totales: { monto_total: 100000, monto_neto: 0, iva: 0, monto_exento: 100000 },
  learn_only: false,
  auto_emit: true,
  allow_final_emit: false, // se frena antes de firmar (no quema folio)
  ...over,
});

// Página FORMULARIO (VIEW_EFXP). El emisor viene autocompletado (lo trae el SII
// al elegir la empresa); el receptor lo escribe el worker.
function formularioPage() {
  return form("VIEW_EFXP", [
    field("PTDC_CODIGO", { value: "34" }),
    field("EFXP_RZN_SOC", { value: "AlphaCode SpA" }),
    field("EFXP_GIRO_EMIS", { value: "Servicios informáticos" }),
    field("EFXP_CMNA_ORIGEN", { value: "Las Condes" }),
    field("EFXP_CIUDAD_ORIGEN", { value: "" }),
    field("EFXP_RUT_RECEP", { value: "" }),
    field("EFXP_DV_RECEP", { value: "" }),
    field("EFXP_RZN_SOC_RECEP", { value: "MV SpA" }), // autocomplete ya llegó
    field("EFXP_DIR_RECEP", { value: "" }),
    field("EFXP_CMNA_RECEP", { value: "" }),
    field("EFXP_CIUDAD_RECEP", { value: "" }),
    field("EFXP_GIRO_RECEP", { value: "" }),
    field("EFXP_CONTACTO", { value: "" }),
    field("EFXP_NMB_01", { value: "" }),
    field("EFXP_QTY_01", { value: "" }),
    field("EFXP_PRC_01", { value: "" }),
    field("EFXP_FCH_EMIS", { value: "" }),
    field("EFXP_FMA_PAGO", { value: "" }),
    field("EFXP_MNT_TOTAL", { value: "100000" }),
    field("Button_Update", { tag: "BUTTON" }),
  ]);
}

function selectorEmpresaPage() {
  return form("fPrmEmpPOP", [
    field("RUT_EMP", {
      tag: "SELECT",
      options: [{ value: "11.111.111-1", text: "Otra" }, { value: EMISOR, text: "AlphaCode SpA" }],
    }),
    field("__submit__", { tag: "BUTTON" }),
  ]);
}

function previewPage() {
  return form("PreViewDTE", [
    field("EFXP_MNT_TOTAL", { value: "100000" }),
    field("PTDC_CODIGO", { value: "34" }),
    field("btnSign", { tag: "BUTTON" }),
  ]);
}

beforeAll(() => { mountWorker(); });

describe("sintético del worker de facturas (corre el original que ya funciona)", () => {
  it("selector_empresa: elige el emisor por match exacto y envía", async () => {
    const { res, actions: a } = await drive(jobFactura(), [selectorEmpresaPage()]);
    expect(res.ok).toBe(true);
    expect(res.action).toBe("empresa_seleccionada");
    expect(a).toEqual([{ op: "set", name: "RUT_EMP", value: EMISOR }, { op: "click", name: "__submit__" }]);
  });

  // El BASELINE: la secuencia EXACTA de escrituras del worker original. Cuando
  // el worker pase a leer job.libreto (fase 2), este mismo orden debe salir con
  // y sin libreto — cualquier `??` mal escrito cambia la secuencia y el test cae.
  const BASELINE_FORMULARIO = [
    { op: "set", name: "EFXP_RUT_RECEP", value: "77155156" },
    { op: "set", name: "EFXP_DV_RECEP", value: "4" },
    { op: "set", name: "EFXP_FCH_EMIS", value: "2026-08-30" },
    { op: "set", name: "EFXP_CIUDAD_ORIGEN", value: "Las Condes" },
    { op: "set", name: "EFXP_RZN_SOC_RECEP", value: "MV SpA" },
    { op: "set", name: "EFXP_DIR_RECEP", value: "Mendoza 0932" },
    { op: "set", name: "EFXP_CMNA_RECEP", value: "San Bernardo" },
    { op: "set", name: "EFXP_CIUDAD_RECEP", value: "San Bernardo" },
    { op: "set", name: "EFXP_GIRO_RECEP", value: "Asesorías" },
    { op: "set", name: "EFXP_CONTACTO", value: "mv@ej.cl" },
    { op: "set", name: "EFXP_NMB_01", value: "Servicio de asesoría" },
    { op: "set", name: "EFXP_QTY_01", value: "1" },
    { op: "set", name: "EFXP_PRC_01", value: "100000" },
    { op: "set", name: "EFXP_FMA_PAGO", value: "1" },
    { op: "click", name: "Button_Update" },
  ];

  it("formulario: escribe todos los campos en el orden exacto y valida (baseline)", async () => {
    const { res, actions: a } = await drive(jobFactura(), [formularioPage()]);
    expect(res.ok).toBe(true);
    expect(res.action).toBe("validado");
    expect(a).toEqual(BASELINE_FORMULARIO);
  }, 15000);

  it("preview con allow_final_emit=false: se frena SIN clickear Firmar", async () => {
    const { res, actions: a } = await drive(jobFactura(), [previewPage()]);
    expect(res.action).toBe("paused_preview");
    expect(a.find((x) => x.name === "btnSign")).toBeUndefined(); // el candado: no se firmó
  });

  // ── LA PRUEBA DE "PURA MUDANZA" ──────────────────────────────────────────
  // Con el libreto REAL de producción (espejo del hardcode), el worker tiene
  // que producir EXACTAMENTE la misma secuencia que sin libreto. Si el espejo
  // del servidor y el fallback del worker divergieran en un solo carácter, esta
  // igualdad cae. Es la definición operativa de que llamarlo distinto no cambia
  // cómo funciona.
  describe("con libreto == sin libreto == baseline (pura mudanza)", () => {
    it("formulario: misma secuencia con el libreto real", async () => {
      const { res, actions: a } = await drive(jobFactura({ libreto: FACTURA_LIBRETO }), [formularioPage()]);
      expect(res.action).toBe("validado");
      expect(a).toEqual(BASELINE_FORMULARIO);
    }, 15000);

    it("selector_empresa: misma secuencia con el libreto real", async () => {
      const { res, actions: a } = await drive(jobFactura({ libreto: FACTURA_LIBRETO }), [selectorEmpresaPage()]);
      expect(res.action).toBe("empresa_seleccionada");
      expect(a).toEqual([{ op: "set", name: "RUT_EMP", value: EMISOR }, { op: "click", name: "__submit__" }]);
    });

    it("preview: el candado aguanta también con libreto (no firma)", async () => {
      const { res, actions: a } = await drive(jobFactura({ libreto: FACTURA_LIBRETO }), [previewPage()]);
      expect(res.action).toBe("paused_preview");
      expect(a.find((x) => x.name === "btnSign")).toBeUndefined();
    });

    // GLOSA extendida: ejercita glosa_checkbox + glosa_textarea (no cubiertos
    // por el fixture base). Con y sin libreto deben grabar lo mismo.
    it("glosa: misma secuencia con y sin libreto (checkbox + textarea)", async () => {
      const jobGlosa = (over) => jobFactura({
        detalles: [{ nombre: "Asesoría", cantidad: 1, precio: 100000, descripcion: "Glosa larga con más de cuarenta caracteres de detalle." }],
        ...over,
      });
      const paginaGlosa = () => form("VIEW_EFXP", [
        field("PTDC_CODIGO", { value: "34" }),
        field("EFXP_RZN_SOC", { value: "AlphaCode SpA" }),
        field("EFXP_GIRO_EMIS", { value: "Servicios" }),
        field("EFXP_CMNA_ORIGEN", { value: "Las Condes" }),
        field("EFXP_CIUDAD_ORIGEN", { value: "" }),
        field("EFXP_RUT_RECEP", { value: "" }),
        field("EFXP_DV_RECEP", { value: "" }),
        field("EFXP_RZN_SOC_RECEP", { value: "MV SpA" }),
        field("EFXP_DIR_RECEP", { value: "" }),
        field("EFXP_CMNA_RECEP", { value: "" }),
        field("EFXP_CIUDAD_RECEP", { value: "" }),
        field("EFXP_GIRO_RECEP", { value: "" }),
        field("EFXP_CONTACTO", { value: "" }),
        field("EFXP_NMB_01", { value: "" }),
        field("EFXP_QTY_01", { value: "" }),
        field("EFXP_PRC_01", { value: "" }),
        field("EFXP_FCH_EMIS", { value: "" }),
        field("EFXP_FMA_PAGO", { value: "" }),
        field("EFXP_MNT_TOTAL", { value: "100000" }),
        field("DESCRIP_01", { checked: false }),
        field("EFXP_DSC_ITEM_01", { tag: "TEXTAREA", value: "" }),
        field("Button_Update", { tag: "BUTTON" }),
      ]);
      const sin = await drive(jobGlosa(), [paginaGlosa()]);
      const con = await drive(jobGlosa({ libreto: FACTURA_LIBRETO }), [paginaGlosa()]);
      expect(sin.res.action).toBe("validado");
      expect(con.actions).toEqual(sin.actions);
      // y la glosa efectivamente se escribió
      expect(con.actions).toContainEqual({ op: "click", name: "DESCRIP_01" });
      expect(con.actions).toContainEqual({ op: "set", name: "EFXP_DSC_ITEM_01", value: "Glosa larga con más de cuarenta caracteres de detalle." });
    }, 15000);

    // DETECCIÓN DE POSIBLE CAMBIO DEL SII: una página sin un ancla ESTRUCTURAL
    // marca posible_cambio_sii; un error de DATO del cliente, no.
    it("formulario sin el botón Validar → posible_cambio_sii en boton_validar", async () => {
      // la página completa MENOS el botón Validar: el ancla estructural desaparece
      const campos = [
        ["PTDC_CODIGO", "34"], ["EFXP_RZN_SOC", "AlphaCode SpA"], ["EFXP_GIRO_EMIS", "Serv"],
        ["EFXP_CMNA_ORIGEN", "Las Condes"], ["EFXP_CIUDAD_ORIGEN", ""], ["EFXP_RUT_RECEP", ""],
        ["EFXP_DV_RECEP", ""], ["EFXP_RZN_SOC_RECEP", "MV SpA"], ["EFXP_DIR_RECEP", ""],
        ["EFXP_CMNA_RECEP", ""], ["EFXP_CIUDAD_RECEP", ""], ["EFXP_GIRO_RECEP", ""],
        ["EFXP_CONTACTO", ""], ["EFXP_NMB_01", ""], ["EFXP_QTY_01", ""], ["EFXP_PRC_01", ""],
        ["EFXP_FCH_EMIS", ""], ["EFXP_FMA_PAGO", ""], ["EFXP_MNT_TOTAL", "100000"],
      ];
      const sinBoton = form("VIEW_EFXP", campos.map(([n, v]) => field(n, { value: v })));
      const { res } = await drive(jobFactura(), [sinBoton]);
      expect(res.error).toBe("SIN_BOTON_VALIDAR");
      expect(res.posible_cambio_sii).toBe(true);
      expect(res.ancla_faltante).toBe("campos.boton_validar");
    }, 15000);

    it("receptor sin giro (dato del cliente) → NO dispara la alerta", async () => {
      const jobSinGiro = jobFactura({
        receptor: { rut: RECEPTOR, razon_social: "MV SpA", direccion: "Mendoza 0932", comuna: "San Bernardo", ciudad: "San Bernardo", contacto: "mv@ej.cl" },
      });
      const { res } = await drive(jobSinGiro, [formularioPage()]);
      expect(res.error).toBe("GIRO_RECEPTOR_REQUERIDO");
      expect(res.human).toBe(true);
      expect(res.posible_cambio_sii).toBeUndefined();
    }, 15000);

    // DETECTORES de página (login/firma/éxito): clasificación por texto. Con y
    // sin libreto tienen que clasificar igual (mismos regex).
    it("clasifica login / firma / post_firma igual con y sin libreto", async () => {
      const casos = [
        { kind: "login", pwd: true, bodyText: "Ingrese su RUT y Clave Tributaria para iniciar sesión" },
        { kind: "firma", pwd: true, bodyText: "Ingrese la clave de su certificado digital para la firma" },
        { kind: "post_firma", pwd: false, bodyText: "DOCUMENTO TRIBUTARIO ELECTRÓNICO ENVIADO EXITOSAMENTE" },
      ];
      for (const caso of casos) {
        const sin = await drive(jobFactura(), [], { bodyText: caso.bodyText, pwd: caso.pwd });
        const con = await drive(jobFactura({ libreto: FACTURA_LIBRETO }), [], { bodyText: caso.bodyText, pwd: caso.pwd });
        expect(sin.res.kind).toBe(caso.kind);
        expect(con.res.kind).toBe(caso.kind);
      }
    }, 15000);
  });
});

// ── TANDA 2 (red team 2026-09-10) ─────────────────────────────────────────
// (1) Cada ancla del libreto MUERDE: un valor distinto (válido para el
// validador) cambia la conducta o falla con la ancla correcta. Si un `??` mal
// escrito hiciera que el worker ignore el libreto, este test cae.
// (2) Compuertas que no dependen del dato que verifican (C2).
// (3) `unknown` pre-firma no es eterno (PAGINA_DESCONOCIDA con mapa saneado).
import { validateLibreto } from "./modules/facturas-portal.js";

const libretoCon = (path, value) => {
  const l = JSON.parse(JSON.stringify(FACTURA_LIBRETO));
  const [grupo, rol] = path.split(".");
  l[grupo][rol] = value;
  return l;
};
let seq = 100;
const jobId = () => `job-t2-${seq += 1}`;

describe("tanda 2 · cada ancla del libreto muerde", () => {
  const casos = [
    { ancla: "forms.preview", valor: "PreViewDTE_X", page: previewPage, antes: "paused_preview", espera: (r) => expect(r.kind).toBe("unknown") },
    { ancla: "forms.formulario", valor: "VIEW_EFXP_X", page: formularioPage, antes: "validado", espera: (r) => expect(r.kind).toBe("unknown") },
    { ancla: "forms.selector_empresa", valor: "fPrmEmpPOP_X", page: selectorEmpresaPage, antes: "empresa_seleccionada", espera: (r) => expect(r.kind).toBe("unknown") },
    { ancla: "campos.emisor_select", valor: "EFXP_RUT_EMP_X", page: selectorEmpresaPage, antes: "empresa_seleccionada", espera: (r) => { expect(r.error).toBe("SELECTOR_SIN_RUT_EMP"); expect(r.ancla).toBe("campos.emisor_select"); } },
    { ancla: "campos.boton_validar", valor: "EFXP_BTN_VALIDAR_X", page: formularioPage, antes: "validado", espera: (r) => { expect(r.error).toBe("SIN_BOTON_VALIDAR"); expect(r.ancla).toBe("campos.boton_validar"); } },
  ];
  // CAMPOS CRÍTICOS FIJOS EN CÓDIGO (F1 tanda 3 = M3 del red team). Estos roles
  // NO deben poder cambiarse desde el libreto: permutarlos dentro de la whitelist
  // `EFXP_*` producía una factura REAL con los datos cruzados (cantidad↔precio,
  // razón social del receptor sobre la del emisor) y TODAS las compuertas verdes,
  // porque `preValidar` y `TOTAL_MISMATCH` releían por los mismos nombres malos.
  // Ahora el worker escribe/lee el nombre hardcodeado: sabotear el libreto NO
  // cambia nada. Este test es el candado de eso — si algún día vuelve a "morder",
  // es que el rol se volvió configurable y el hoyo se reabrió.
  const rolesFijos = [
    { ancla: "campos.rut_recep", valor: "EFXP_RUT_RECEP_X" },
    { ancla: "campos.forma_pago", valor: "EFXP_FMA_PAGO_X" },
    { ancla: "campos.detalle_cantidad", valor: "EFXP_QTY_XX" },
    { ancla: "campos.razon_soc_recep", valor: "EFXP_RZN_SOC_RECEP_XX" },
  ];

  // La PERMUTA exacta del red team (cantidad↔precio, receptor sobre emisor) ni
  // siquiera llega al worker: el validador la caza como campo duplicado.
  it("permutar dos roles dentro de EFXP_* lo rechaza el validador", () => {
    expect(validateLibreto(libretoCon("campos.detalle_cantidad", "EFXP_PRC_01"))).toBe("LIBRETO_CAMPO_DUPLICADO");
    expect(validateLibreto(libretoCon("campos.razon_soc_recep", "EFXP_RZN_SOC"))).toBe("LIBRETO_CAMPO_DUPLICADO");
  });

  // Un selector de submit fuera de la whitelist tampoco llega al worker.
  it("selectores.submit_empresa fuera de la whitelist lo rechaza el validador", () => {
    expect(validateLibreto(libretoCon("selectores.submit_empresa", "button.no-existe"))).toBe("LIBRETO_SELECTOR_NO_PERMITIDO");
    expect(validateLibreto(libretoCon("selectores.submit_empresa", "a"))).toBe("LIBRETO_SELECTOR_NO_PERMITIDO");
  });
  for (const caso of rolesFijos) {
    it(`campo FIJO en código: ${caso.ancla} → ${caso.valor} NO cambia la conducta`, async () => {
      const lib = libretoCon(caso.ancla, caso.valor);
      expect(validateLibreto(lib)).toBe(null);
      const base = await drive(jobFactura({ job_id: jobId() }), [formularioPage()]);
      expect(base.res.action).toBe("validado");
      const { res } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [formularioPage()]);
      expect(res.action).toBe("validado"); // idéntico: el libreto no manda acá
      expect(res.error).toBeUndefined();
    }, 15000);
  }

  for (const caso of casos) {
    it(`${caso.ancla} → ${caso.valor}`, async () => {
      const lib = libretoCon(caso.ancla, caso.valor);
      expect(validateLibreto(lib)).toBe(null); // valor válido: el que muerde es el worker
      const base = await drive(jobFactura({ job_id: jobId() }), [caso.page()]);
      expect(base.res.action).toBe(caso.antes);
      const { res } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [caso.page()]);
      expect(res.action).not.toBe(caso.antes);
      caso.espera(res);
      if (res.ancla) {
        expect(res.posible_cambio_sii).toBe(true);
        expect(res.ancla_faltante).toBe(res.ancla); // nombre viejo se conserva
        expect(typeof res.paso).toBe("string");
        expect(res.paso.length).toBeLessThanOrEqual(40);
        expect(res.mapa).toBeTruthy();
      }
    }, 15000);
  }

  it("campos.boton_firmar → SIN_BOTON_FIRMAR con ancla, sin clickear btnSign", async () => {
    const lib = libretoCon("campos.boton_firmar", "EFXP_BTN_SIGN_X");
    expect(validateLibreto(lib)).toBe(null);
    const { res, actions: a } = await drive(jobFactura({ job_id: jobId(), allow_final_emit: true, libreto: lib }), [previewPage()]);
    expect(res.error).toBe("SIN_BOTON_FIRMAR");
    expect(res.ancla).toBe("campos.boton_firmar");
    expect(res.paso).toBe("preview:firmar");
    expect(a.find((x) => x.name === "btnSign")).toBeUndefined();
  });

  it("detectores.login distinto → la página de login ya no se clasifica como login", async () => {
    const lib = libretoCon("detectores.login", "clave\\s+secreta\\s+galactica");
    expect(validateLibreto(lib)).toBe(null);
    const texto = "Ingrese su RUT y Clave Tributaria para iniciar sesión";
    const base = await drive(jobFactura({ job_id: jobId() }), [], { bodyText: texto, pwd: true });
    expect(base.res.kind).toBe("login");
    const { res } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [], { bodyText: texto, pwd: true });
    expect(res.kind).not.toBe("login");
  });

  it("detectores.exito_a distinto → la página de éxito ya no es post_firma (no hay folio fantasma)", async () => {
    const lib = libretoCon("detectores.exito_a", "ENVIADO\\s+FRACASADAMENTE");
    expect(validateLibreto(lib)).toBe(null);
    const texto = "DOCUMENTO TRIBUTARIO ELECTRÓNICO ENVIADO EXITOSAMENTE";
    const base = await drive(jobFactura({ job_id: jobId() }), [], { bodyText: texto });
    expect(base.res.kind).toBe("post_firma");
    const { res } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [], { bodyText: texto });
    expect(res.kind).not.toBe("post_firma");
  });

  // (2) Libreto distinto cambia la conducta aunque el nombre no pase el
  // vocabulario del validador (defensa en profundidad: el worker no confía).
  it("campos.boton_validar:'btnValidar' → SIN_BOTON_VALIDAR con paso y mapa", async () => {
    const { res } = await drive(jobFactura({ job_id: jobId(), libreto: libretoCon("campos.boton_validar", "btnValidar") }), [formularioPage()]);
    expect(res.error).toBe("SIN_BOTON_VALIDAR");
    expect(res.ancla).toBe("campos.boton_validar");
    expect(res.paso).toBe("formulario:validar");
    expect(res.mapa.forms).toEqual(["VIEW_EFXP"]);
    expect(res.mapa.inputs).toContain("EFXP_RUT_RECEP");
  }, 15000);
});

describe("tanda 2 · compuertas en código (C2: no dependen del dato que verifican)", () => {
  const paginaConTotalDistinto = () => {
    const f = formularioPage();
    f.elements.namedItem("EFXP_MNT_TOTAL")._value = "119000"; // el portal calculó IVA que el job no trae
    return f;
  };

  it("monto_total:'EFXP_PRC_01' en el libreto NO afloja: TOTAL_MISMATCH igual salta", async () => {
    const lib = libretoCon("campos.monto_total", "EFXP_PRC_01");
    const { res, actions: a } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [paginaConTotalDistinto()]);
    expect(res.error).toBe("TOTAL_MISMATCH");
    expect(a.find((x) => x.name === "Button_Update")).toBeUndefined(); // no se validó
  }, 15000);

  it("sin libreto, el mismo descuadre también aborta (baseline de la compuerta)", async () => {
    const { res } = await drive(jobFactura({ job_id: jobId() }), [paginaConTotalDistinto()]);
    expect(res.error).toBe("TOTAL_MISMATCH");
  }, 15000);

  it("tipo_verif:'EFXP_CONTACTO' en el libreto NO afloja: el tipo se lee de PTDC_CODIGO", async () => {
    const lib = libretoCon("campos.tipo_verif", "EFXP_CONTACTO");
    const pagina33 = formularioPage();
    pagina33.elements.namedItem("PTDC_CODIGO")._value = "33"; // el portal abrió una afecta, el job pide 34
    pagina33.elements.namedItem("EFXP_CONTACTO")._value = "34";
    const { res } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [pagina33]);
    expect(res.error).toBe("TIPO_PORTAL_MISMATCH");
  }, 15000);

  it("forma de pago contado:'3' → FORMA_PAGO_INVALIDA antes de escribir nada", async () => {
    const lib = JSON.parse(JSON.stringify(FACTURA_LIBRETO));
    lib.codigos.forma_pago.contado = "3";
    const { res, actions: a } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [formularioPage()]);
    expect(res.error).toBe("FORMA_PAGO_INVALIDA");
    expect(a).toEqual([]);
  });

  it("forma de pago permutada (contado:'2') → FORMA_PAGO_INVALIDA; jamás se escribe '2' por contado", async () => {
    const lib = JSON.parse(JSON.stringify(FACTURA_LIBRETO));
    lib.codigos.forma_pago = { contado: "2", credito: "1" };
    const { res, actions: a } = await drive(jobFactura({ job_id: jobId(), libreto: lib }), [formularioPage()]);
    expect(res.error).toBe("FORMA_PAGO_INVALIDA");
    expect(a.find((x) => x.name === "EFXP_FMA_PAGO")).toBeUndefined();
  });

  it("glosa: sin textarea (esperas.glosa_textarea corta) → glosa_omitida:true y sigue validando", async () => {
    const lib = JSON.parse(JSON.stringify(FACTURA_LIBRETO));
    lib.esperas.glosa_textarea = 100;
    const f = formularioPage(); // sin DESCRIP_01 ni EFXP_DSC_ITEM_01
    const job = jobFactura({ job_id: jobId(), libreto: lib, detalles: [{ nombre: "Asesoría", cantidad: 1, precio: 100000, descripcion: "Glosa larga con más de cuarenta caracteres de detalle." }] });
    const { res } = await drive(job, [f]);
    expect(res.action).toBe("validado");
    expect(res.glosa_omitida).toBe(true);
  }, 15000);

  it("glosa: con textarea NO se marca glosa_omitida", async () => {
    const { res } = await drive(jobFactura({ job_id: jobId() }), [formularioPage()]);
    expect(res.action).toBe("validado");
    expect(res.glosa_omitida).toBeUndefined();
  }, 15000);
});

describe("tanda 2 · page_kind:unknown como ancla", () => {
  it("unknown pre-firma MÁS DE LA GRACIA → PAGINA_DESCONOCIDA una sola vez, sin clickear nada", async () => {
    // F3 (tanda 3): el aviso se decide por TIEMPO, no por cantidad de scans. Un
    // portal lento que rebota 4 veces en 6 s NO es un cambio del SII; una pantalla
    // que no calza durante 20 s sí. Acá se acorta la gracia a 50 ms (mínimo que
    // acepta el validador) para no dormir 20 s en el test.
    const libCorto = libretoCon("esperas.pagina_desconocida", 50);
    expect(validateLibreto(libCorto)).toBe(null);
    const job = jobFactura({ job_id: jobId(), libreto: libCorto });
    const opts = { bodyText: "Sistema en mantención. Vuelva a intentar más tarde. Contacto: soporte@sii.cl, RUT 12.345.678-9" };
    // Dentro de la gracia: observa y NO avisa.
    const r1 = await drive(job, [], opts);
    expect(r1.res.kind).toBe("unknown");
    expect(r1.res.action).toBe("observando");
    await new Promise((resolve) => setTimeout(resolve, 80)); // se pasa la gracia
    const { res, actions: a } = await drive(job, [], opts);
    expect(res.error).toBe("PAGINA_DESCONOCIDA");
    expect(res.ancla).toBe("page_kind:unknown");
    expect(res.page_kind).toBe("unknown");
    expect(res.code).toBe("PAGINA_DESCONOCIDA");
    expect(res.posible_cambio_sii).toBe(true);
    expect(res.paso).toBe("observando:unknown");
    expect(a).toEqual([]);
    // una vez por job: el scan siguiente vuelve a observar, no re-avisa
    const r5 = await drive(job, [], opts);
    expect(r5.res.action).toBe("observando");
  });

  it("con el candado armado (final_emit_clicked) NUNCA avisa: 'generando firma' pasa por unknown", async () => {
    const job = jobFactura({ job_id: jobId() });
    activeForms = new Map(); activeBodyText = "Generando firma electrónica, espere..."; activePwd = false;
    for (let i = 0; i < 6; i += 1) {
      actions = []; outgoing = [];
      driveListener({ type: "APP_CONTABLE_SII_FACT_DRIVE", job, job_id: job.job_id, done: {}, final_emit_clicked: true }, {}, () => {});
      let step = null;
      for (let k = 0; k < 200 && !step; k += 1) { step = outgoing.find((m) => m?.type === "APP_CONTABLE_SII_FACT_STEP"); if (!step) await new Promise((r) => setTimeout(r, 20)); }
      expect(step.res.action).toBe("observando");
    }
  });

  it("una pantalla conocida entre medio reinicia la cuenta", async () => {
    const job = jobFactura({ job_id: jobId() });
    const opts = { bodyText: "pantalla rara" };
    await drive(job, [], opts); await drive(job, [], opts); await drive(job, [], opts);
    await drive(job, [previewPage()]); // conocida
    const { res } = await drive(job, [], opts);
    expect(res.action).toBe("observando");
  });

  it("el mapa que viaja está SANEADO: sin valores de campos, sin RUT ni correos", async () => {
    const job = jobFactura({ job_id: jobId(), libreto: libretoCon("campos.emisor_select", "EFXP_RUT_EMP_X") });
    const { res } = await drive(job, [selectorEmpresaPage()]);
    expect(res.error).toBe("SELECTOR_SIN_RUT_EMP");
    const json = JSON.stringify(res.mapa);
    expect(json.length).toBeLessThanOrEqual(2048);
    expect(res.mapa.forms).toEqual(["fPrmEmpPOP"]);
    expect(res.mapa.inputs).toContain("RUT_EMP");
    expect(json).not.toContain(EMISOR);
    expect(json).not.toContain("78448088");
    expect(json).not.toContain("@");
    expect(Object.keys(res.mapa).sort()).toEqual(["botones", "forms", "inputs", "url"]);
  });
});
