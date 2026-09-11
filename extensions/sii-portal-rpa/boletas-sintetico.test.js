// SINTÉTICO del worker de BOLETAS (e-Boleta Vuetify). Corre el sii-worker.js
// REAL contra un DOM Vuetify falso que GRABA cada click/escritura (fixtures/
// eboleta-modal.js, con los textos reales del portal), manejándolo como el background
// (APP_CONTABLE_SII_FILL_AND_EMIT → sendResponse). No toca el SII. Es la red de
// seguridad del refactor libreto→job: prueba que con y sin libreto la secuencia es la
// MISMA (pura mudanza), que cada ancla del libreto MUERDE, y que las invariantes en
// código (afecta/exenta, pad, receptor, sucursal) abortan ANTES del EMITIR final.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BOLETA_LIBRETO } from "../../src/lib/emission/sii-libreto.ts";
import { validateLibretoBoleta } from "./modules/sii-local.js";
import { estado, fakeDocument, FakeHTMLElement, escenaEmision, EMISOR } from "./fixtures/eboleta-modal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SRC = readFileSync(join(__dirname, "sii-worker.js"), "utf8");

// ── Arnés: monta el worker real y lo maneja como el background ──────────────
let driveListener = null;
const testHooks = {}; // window.__MASSDTE_TEST__: el worker expone resolverLibreto acá

function mountWorker() {
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, getComputedStyle: () => ({ visibility: "visible", display: "block" }), __MASSDTE_TEST__: testHooks };
  const chrome = {
    runtime: {
      id: "sintetico", lastError: null,
      getManifest: () => ({ version: "sintetico" }),
      sendMessage: (m, cb) => { if (cb) cb(); },
      onMessage: { addListener: (h) => { driveListener = h; } },
    },
  };
  const location = { href: "https://eboleta.sii.cl/" };
  const silent = { log() {}, warn() {}, error() {}, info() {} };
  class Evt { constructor(t) { this.type = t; } }
  new Function(
    "window", "chrome", "document", "location", "console",
    "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSelectElement", "HTMLTextAreaElement",
    "Node", "CSS", "Event", "MouseEvent", "FocusEvent", "KeyboardEvent",
    WORKER_SRC,
  )(win, chrome, fakeDocument, location, silent,
    FakeHTMLElement, FakeHTMLElement, FakeHTMLElement, FakeHTMLElement, FakeHTMLElement,
    { ELEMENT_NODE: 1 }, { escape: (s) => s }, Evt, Evt, Evt, Evt);
}

async function drive(job) {
  estado.actions = [];
  let res;
  driveListener(
    { source: "app-contable-extension", type: "APP_CONTABLE_SII_FILL_AND_EMIT", job_id: job.job_id, job },
    {}, (r) => { res = r; },
  );
  await vi.runAllTimersAsync();
  return { res, actions: estado.actions.slice() };
}
async function capturar(job) {
  let res;
  driveListener({ source: "app-contable-extension", type: "APP_CONTABLE_SII_CAPTURE_RESULT", job_id: job.job_id, job }, {}, (r) => { res = r; });
  await vi.runAllTimersAsync();
  return res;
}

const jobBoleta = (over = {}) => ({
  job_id: "b1", empresa_id: "e1", emisor_rut: EMISOR, tipo_dte: 39,
  totales: { monto_total: 1 }, glosa: "",
  receptor: {}, learn_only: false, auto_emit: true,
  allow_final_emit: false, // se frena antes de firmar → 0 folios
  ...over,
});

// Libreto "completo" de tanda 2: el BOLETA_LIBRETO del servidor + los bloques nuevos si
// el TS aún no los trae (los agrega otro agente en paralelo; acá se consumen con fallback).
const BLOQUES_NUEVOS = {
  glosa: {
    candidatos: "input[type='text'], textarea",
    excluir_dentro_de: ".v-select, .v-autocomplete",
    ancla_contador: "\\/\\s*80",
    ancla_label: "DETALLE",
    excluir_texto: "VENDEDOR|RECEPTOR|SUCURSAL|MONTO|\\bRUT\\b|PAGO|BOLETA",
  },
  modal: { titulo: "EMITIR\\s+E-BOLETA" },
  emisor: { cargando: "CARGANDO EMISORES" },
  monto_alto: { texto: "DESEA CONTINUAR|ESTA A PUNTO DE EMITIR" },
};
const libretoCompleto = () => ({ ...BLOQUES_NUEVOS, ...JSON.parse(JSON.stringify(BOLETA_LIBRETO)) });
const clonLibreto = () => JSON.parse(JSON.stringify(libretoCompleto()));
const setPath = (obj, path, value) => {
  const ks = path.split("."); let cur = obj;
  for (const k of ks.slice(0, -1)) { cur[k] = cur[k] ?? {}; cur = cur[k]; }
  cur[ks[ks.length - 1]] = value;
};
const clicks = (a) => a.filter((x) => x.op === "click").map((x) => x.role);
const noFirmo = (a) => expect(a.find((x) => x.role === "btn_emitir_final")).toBeUndefined();

beforeAll(() => { mountWorker(); });

describe("sintético del worker de boletas (corre el original que ya funciona)", () => {
  beforeAll(() => { vi.useFakeTimers(); });

  it("baseline: teclea el monto y abre el modal, sin firmar (candado)", async () => {
    escenaEmision();
    const { res, actions: a } = await drive(jobBoleta());
    expect(res.ok).toBe(true);
    noFirmo(a);
    expect(a).toContainEqual({ op: "click", role: "digit_1" });
    expect(a).toContainEqual({ op: "click", role: "btn_emitir" });
  });

  it("escribe la glosa en el campo Detalle del modal (fix glosa muda 2026-09-10)", async () => {
    escenaEmision();
    const { actions: a } = await drive(jobBoleta({ glosa: "Ventas 01-09 al 07-09" }));
    expect(a).toContainEqual({ op: "click", role: "chk_detalle" });
    expect(a).toContainEqual({ op: "set", role: "glosa_input", value: "Ventas 01-09 al 07-09" });
    // NUNCA escribir la glosa en el campo Vendedor (hallazgo adversarial 2026-09-10).
    expect(a.some((x) => x.op === "set" && x.role === "vendedor_input")).toBe(false);
  });

  it("con libreto == sin libreto (pura mudanza), incluidos los bloques de tanda 2", async () => {
    escenaEmision();
    const sin = await drive(jobBoleta({ glosa: "x", receptor: { rut: "12.345.678-5", razon_social: "Cliente" } }));
    escenaEmision();
    const con = await drive(jobBoleta({ glosa: "x", receptor: { rut: "12.345.678-5", razon_social: "Cliente" }, libreto: libretoCompleto() }));
    expect(con.actions).toEqual(sin.actions);
  });

  it("deriva: resolverLibreto(null) == BOLETA_LIBRETO del servidor (+ bloques nuevos) normalizado", () => {
    expect(typeof testHooks.resolverLibreto).toBe("function");
    const norm = (v) => (v instanceof RegExp ? `/${v.source}/${v.flags}` : v);
    const deep = (o) => (o && typeof o === "object" && !(o instanceof RegExp) && !Array.isArray(o)
      ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : norm(o));
    const hard = deep(testHooks.resolverLibreto(null));
    const server = deep(testHooks.resolverLibreto({ libreto: libretoCompleto() }));
    // DIVERGENCIA DELIBERADA (F6, tanda 3): `emisor.cargando` del servidor es un
    // SUPERCONJUNTO. El hardcode de ESTE worker es /Cargando Emisores/i, pero el
    // de background.js trae además el "Cargando" genérico; el libreto tiene que
    // cubrir a los dos, así que no puede ser byte-idéntico a este fallback.
    // Todo lo demás SÍ debe coincidir: si diverge, es deriva de verdad.
    const { emisor: emisorServer, ...serverResto } = server;
    const { emisor: emisorHard, ...hardResto } = hard;
    expect(serverResto).toEqual(hardResto);
    const reServer = testHooks.resolverLibreto({ libreto: libretoCompleto() }).emisor.cargando;
    expect(reServer.test("Cargando Emisores")).toBe(true); // lo que mira este worker
    expect(reServer.test("Cargando…")).toBe(true); // lo que mira background.js
    const reHard = testHooks.resolverLibreto(null).emisor.cargando;
    expect(reHard.test("Cargando Emisores")).toBe(true);
    expect(reHard.test("Cargando…")).toBe(false); // el fallback de ESTE worker es el estricto
    expect(emisorServer.cargando).not.toBe(emisorHard.cargando);
    // y el libreto del servidor (con los bloques nuevos) pasa el validador de la extensión
    expect(validateLibretoBoleta(libretoCompleto())).toBe(null);
  });

  it("un libreto DISTINTO cambia la conducta (toggles.detalle = 'Descripción')", async () => {
    escenaEmision();
    const lb = clonLibreto(); lb.toggles.detalle = "Descripción";
    const { res, actions: a } = await drive(jobBoleta({ glosa: "x", libreto: lb }));
    expect(res.ok).toBe(true);
    expect(a.some((x) => x.role === "chk_detalle")).toBe(false); // ya no encuentra "Detalle"
    expect(a.some((x) => x.op === "set" && x.role === "glosa_input")).toBe(false);
  });

  it("dato del cliente (monto 0) NO dispara la alerta", async () => {
    escenaEmision();
    const { res } = await drive(jobBoleta({ totales: { monto_total: 0 } }));
    expect(res.ok).toBe(false);
    expect(res.posible_cambio_sii).not.toBe(true);
  });

  it("detección: sin el botón EMITIR → posible_cambio_sii + paso + mapa saneado", async () => {
    escenaEmision({ conEmitir: false });
    const { res } = await drive(jobBoleta());
    expect(res.ok).toBe(false);
    expect(res.posible_cambio_sii).toBe(true);
    expect(res.ancla_faltante).toBe("botones.emitir");
    expect(res.paso).toBe("monto");
    expect(res.mapa).toBeTruthy();
    const json = JSON.stringify(res.mapa);
    expect(json.length).toBeLessThanOrEqual(2048);
    expect(json).not.toMatch(/\d{7,}/); // sin RUT ni corridas largas de dígitos
    expect(json).not.toMatch(/@/);
  });

  // ── MUERDE por ancla ────────────────────────────────────────────────────────
  // Cada caso: valor válido para el validador pero inexistente en el fixture → o la
  // emisión se corta con ESA ancla (res.ok=false) o la conducta cambia (sin firmar).
  const CASOS = [
    // [ancla, valor, job extra, escena extra, esperado]
    ["botones.emitir", "ZZEMITIR", {}, {}, { ancla: "botones.emitir", code: "PANTALLA_NO_LISTA" }],
    ["slots.sucursal", "zzz sucursal", {}, { sucursalTexto: "Elija sucursal" }, { conducta: (a) => !clicks(a).includes("opt_sucursal:Apoquindo 6410 Of 605") }],
    ["slots.metodo_pago", "zzz pago", {}, {}, { ancla: "slots.metodo_pago", code: "PAGO_NO_SELECCIONADO" }],
    ["slots.tipo", "ZzzNoExiste", {}, {}, { ancla: "slots.tipo", code: "TIPO_NO_CONFIRMADO" }],
    ["toggles.detalle", "Zzz", { glosa: "hola" }, {}, { conducta: (a) => !clicks(a).includes("chk_detalle") }],
    ["toggles.receptor", "Zzz", { receptor: { rut: "12.345.678-5" } }, { conReceptor: true }, { ancla: "toggles.receptor", code: "RECEPTOR_NO_ESCRITO" }],
    ["selectores.dialogo_activo", ".v-dialog.v-zzz", {}, {}, { ancla: "selectores.dialogo_activo", code: "MODAL_NO_ABRE" }],
    ["selectores.slot", ".v-zzz", {}, {}, { ancla: "selectores.slot", code: "SIN_SLOTS_MODAL" }],
    ["selectores.menu", ".v-zzz", { tipo_dte: 41 }, {}, { ancla: "selectores.menu", code: "TIPO_NO_CONFIRMADO" }],
    ["selectores.opcion", ".v-zzz", { tipo_dte: 41 }, {}, { ancla: "selectores.opcion", code: "TIPO_NO_CONFIRMADO" }],
    ["selectores.toggle_row", ".v-zzz", { receptor: { rut: "12.345.678-5" } }, { conReceptor: true }, { ancla: "toggles.receptor", code: "RECEPTOR_NO_ESCRITO" }],
    ["selectores.emisor_select", ".v-zzz", { emisor_rut: "76.123.456-K" }, {}, { ancla: "selectores.emisor_select", code: "SELECTOR_EMISOR_AUSENTE" }],
    ["receptor_campos.rut", "ZZZ.*RUT", { receptor: { rut: "12.345.678-5" } }, { conReceptor: true }, { ancla: "receptor_campos.rut", code: "RECEPTOR_NO_ESCRITO" }],
    ["glosa.ancla_contador", "\\/\\s*99", { glosa: "hola" }, { glosaContTexto: "0 / 80" }, { conducta: (a) => !a.some((x) => x.op === "set" && x.role === "glosa_input") }],
    ["glosa.ancla_label", "zzz", { glosa: "hola" }, { glosaContTexto: "Detalle" }, { conducta: (a) => !a.some((x) => x.op === "set" && x.role === "glosa_input") }],
    ["modal.titulo", "Zzz\\s+Modal", {}, {}, { ancla: "modal.titulo", code: "MODAL_NO_ABRE" }],
  ];
  for (const [ancla, valor, jobExtra, escenaExtra, esperado] of CASOS) {
    it(`MUERDE: ${ancla}`, async () => {
      escenaEmision(escenaExtra);
      const lb = clonLibreto(); setPath(lb, ancla, valor);
      expect(validateLibretoBoleta(lb)).toBe(null); // el validador lo deja pasar: muerde el worker
      const { res, actions: a } = await drive(jobBoleta({ ...jobExtra, libreto: lb }));
      noFirmo(a);
      if (esperado.ancla) {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(esperado.code);
        expect(res.ancla_faltante).toBe(esperado.ancla);
        expect(res.posible_cambio_sii).toBe(true);
        expect(typeof res.paso).toBe("string");
      } else {
        // control: con el libreto sano la conducta es la contraria
        escenaEmision(escenaExtra);
        const sano = await drive(jobBoleta({ ...jobExtra, libreto: clonLibreto() }));
        expect(esperado.conducta(sano.actions)).toBe(false);
        expect(esperado.conducta(a)).toBe(true);
      }
    });
  }
  // selectores.toggle_click NO muerde: si el ripple no existe, el worker cae al input
  // del switch (fallback estructural, por diseño — el input real también togglea).
  it("selectores.toggle_click: fallback al input del switch (documentado, no muerde)", async () => {
    escenaEmision();
    const lb = clonLibreto(); lb.selectores.toggle_click = ".v-zzz";
    const { res, actions: a } = await drive(jobBoleta({ glosa: "hola", libreto: lb }));
    expect(res.ok).toBe(true);
    expect(a).toContainEqual({ op: "click", role: "chk_detalle" });
  });

  // ── Invariantes en CÓDIGO (aunque el validador se salte) ─────────────────
  it("afecta/exenta permutados: el validador rechaza y, saltándolo, el worker aborta TIPO_NO_CONFIRMADO", async () => {
    const lb = clonLibreto(); lb.slots.tipo_afecta = "Boleta exenta"; lb.slots.tipo_exenta = "Boleta afecta";
    expect(validateLibretoBoleta(lb)).toBe("LIBRETO_TIPO_AMBIGUO");
    escenaEmision(); // job 39 → el libreto permutado elige "Boleta exenta" → el modal muestra EXENTA
    const { res, actions: a } = await drive(jobBoleta({ libreto: lb }));
    noFirmo(a);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("TIPO_NO_CONFIRMADO");
    expect(res.ancla_faltante).toBe("slots.tipo");
  });
  it("tipo 41 de verdad: elige 'Boleta exenta' y pasa la invariante", async () => {
    escenaEmision();
    const { res, actions: a } = await drive(jobBoleta({ tipo_dte: 41 }));
    expect(res.ok).toBe(true);
    expect(clicks(a)).toContain("opt_tipo:Boleta exenta");
  });
  it("limpiar_pad:['1']: el validador rechaza y, saltándolo, el worker NO clickea el 1 de más", async () => {
    const lb = clonLibreto(); lb.botones.limpiar_pad = ["1"];
    expect(validateLibretoBoleta(lb)).toBe("LIBRETO_PAD_NO_PERMITIDO");
    escenaEmision();
    const { res, actions: a } = await drive(jobBoleta({ totales: { monto_total: 5 }, libreto: lb }));
    expect(res.ok).toBe(true);
    expect(clicks(a).filter((r) => r.startsWith("digit_"))).toEqual(["digit_5"]);
  });
  it("esperas/regex malos: el validador rechaza; el worker cae al literal y no revienta", async () => {
    expect(validateLibretoBoleta({ ...clonLibreto(), esperas: { modal_emision: "abc" } })).toBe("LIBRETO_ESPERA_INVALIDA");
    expect(validateLibretoBoleta({ ...clonLibreto(), glosa: { ancla_label: "(a+)+$" } })).toBe("LIBRETO_REGEX_INVALIDO");
    expect(validateLibretoBoleta({ ...clonLibreto(), modal: { titulo: "Emitir(" } })).toBe("LIBRETO_REGEX_INVALIDO");
    const lb = { ...clonLibreto(), esperas: { modal_emision: "abc" }, modal: { titulo: "Emitir(" } };
    lb.receptor_campos.rut = "RUT(";
    escenaEmision();
    const { res } = await drive(jobBoleta({ libreto: lb }));
    expect(res.ok).toBe(true); // fallback a los literales duros
  });

  // ── Sucursal, receptor y monto alto ─────────────────────────────────────────
  it("sucursal vacía: elige la primera; si NO hay opciones → SUCURSAL_NO_SELECCIONADA pre-emit", async () => {
    escenaEmision({ sucursalTexto: "Elija sucursal" });
    const ok = await drive(jobBoleta());
    expect(ok.res.ok).toBe(true);
    expect(clicks(ok.actions)).toContain("opt_sucursal:Apoquindo 6410 Of 605");
    escenaEmision({ sucursalTexto: "Elija sucursal", sucursalOpciones: [] });
    const { res, actions: a } = await drive(jobBoleta({ allow_final_emit: true }));
    noFirmo(a);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("SUCURSAL_NO_SELECCIONADA");
    expect(res.ancla_faltante).toBe("slots.sucursal");
    expect(res.paso).toBe("sucursal");
  });
  it("receptor.rut y el modal SIN campo RUT → RECEPTOR_NO_ESCRITO, sin clickear el EMITIR final", async () => {
    escenaEmision({ conReceptor: false });
    const { res, actions: a } = await drive(jobBoleta({ receptor: { rut: "12.345.678-5", razon_social: "Cliente" }, allow_final_emit: true }));
    noFirmo(a);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("RECEPTOR_NO_ESCRITO");
    expect(res.ancla_faltante).toBe("receptor_campos.rut");
    expect(res.paso).toBe("receptor");
    expect(res.final_emit_clicked).toBe(false);
  });
  it("camino feliz con receptor: escribe RUT y nombre; glosa_omitida/receptor_omitido en el resultado", async () => {
    escenaEmision({ conReceptor: true });
    const job = jobBoleta({ glosa: "Ventas", receptor: { rut: "12.345.678-5", razon_social: "Cliente", email: "a@b.cl" } });
    const { res, actions: a } = await drive(job);
    expect(res.ok).toBe(true);
    expect(a).toContainEqual({ op: "set", role: "receptor_rut", value: "12.345.678-5" });
    expect(a).toContainEqual({ op: "set", role: "receptor_nombre", value: "Cliente" });
    const cap = await capturar(job);
    expect(cap.ok).toBe(true);
    expect(cap.result.glosa_omitida).toBe(false);
    expect(cap.result.receptor_omitido).toBe(true); // el fixture no tiene campo e-mail → caja negra, no aborta
    // y sin datos de contacto faltantes queda en false (reset por emisión)
    escenaEmision({ conReceptor: true });
    const job2 = jobBoleta({ receptor: { rut: "12.345.678-5", razon_social: "Cliente" } });
    await drive(job2);
    const cap2 = await capturar(job2);
    expect(cap2.result.receptor_omitido).toBe(false);
    expect(cap2.result.glosa_omitida).toBe(false);
  });
  it("REGRESIÓN falso positivo (ensayo 2026-09-11): el label del RUT flota al tener valor → NO aborta", async () => {
    // BUG cazado en vivo: con el campo RUT cuyo "RUT" vive solo en el label (Vuetify lo
    // flota fuera del texto al tener valor), la re-búsqueda con el guard `includes("RUT")`
    // devolvía null y abortaba TODA boleta con receptor con un RECEPTOR_RUT_NO_ACEPTADO
    // FALSO — incluso con un RUT real que el SII acepta. El worker ahora relee el mismo
    // input que escribió, no lo re-busca. Este test MUERDE si se revierte el fix.
    escenaEmision({ conReceptor: true, receptorRutLabelFlota: true });
    const job = jobBoleta({ receptor: { rut: "19.427.394-0", razon_social: "Cliente Real" } });
    const { res, actions: a } = await drive(job);
    noFirmo(a); // el candado (allow_final_emit=false) frena antes del EMITIR final
    expect(res.ok).toBe(true); // llegó hasta el final SIN abortar por el falso positivo
    expect(res.code).not.toBe("RECEPTOR_RUT_NO_ACEPTADO");
    expect(a).toContainEqual({ op: "set", role: "receptor_rut", value: "19.427.394-0" });
  });
  it("el freno real sigue: si el SII BORRA el RUT tras escribirlo → RECEPTOR_RUT_NO_ACEPTADO", async () => {
    // La protección legítima NO se pierde: si el portal deja el campo distinto/vacío del
    // valor pedido (rechazo real), el worker aborta antes del EMITIR final.
    escenaEmision({ conReceptor: true });
    const job = jobBoleta({ receptor: { rut: "12.345.678-5", razon_social: "Cliente" }, allow_final_emit: true });
    const rutInput = estado.modalNode?._children?.find((n) => n.role === "receptor_rut");
    if (rutInput) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(rutInput), "value").set;
      Object.defineProperty(rutInput, "value", {
        get() { return ""; }, // el portal lo dejó vacío (RUT no aceptado)
        set(v) { setter.call(rutInput, v); },
        configurable: true,
      });
    }
    const { res, actions: a } = await drive(job);
    noFirmo(a);
    expect(res.code).toBe("RECEPTOR_RUT_NO_ACEPTADO");
    expect(res.final_emit_clicked).toBe(false);
  });
  it("monto alto: confirma SÍ (nunca NO) y sigue al modal", async () => {
    escenaEmision({ montoAlto: true });
    const { res, actions: a } = await drive(jobBoleta({ totales: { monto_total: 6000000 } }));
    expect(res.ok).toBe(true);
    expect(clicks(a)).toContain("alerta_si");
    expect(clicks(a)).not.toContain("alerta_no");
  });
});
