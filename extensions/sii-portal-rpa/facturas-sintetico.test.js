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

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SRC = readFileSync(join(__dirname, "facturas-worker.js"), "utf8");

// ── DOM falso que graba ──────────────────────────────────────────────────
// Un solo `document` (el IIFE lo captura al montarse); las páginas se cambian
// seteando `activeForms` antes de cada drive.
let activeForms = new Map();
let actions = []; // la grabación: [{op:"set",name,value} | {op:"click",name}]

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
    name, tagName: "FORM",
    elements: { namedItem: (n) => byName.get(n) ?? null },
    querySelector: (sel) => (/submit/i.test(sel) ? byName.get("__submit__") ?? null : null),
    submit() { /* no navega en el sintético */ },
  };
}

const fakeDocument = {
  body: { get innerText() { return ""; } },
  querySelector: (sel) => {
    const m = String(sel).match(/^form\[name="([^"]+)"\]$/);
    if (m) return activeForms.get(m[1]) ?? null;
    return null; // input[type=password] etc. → no hay en estas páginas
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
async function drive(job, forms) {
  activeForms = new Map(forms.map((f) => [f.name, f]));
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
});
