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
    name, tagName: "FORM",
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
