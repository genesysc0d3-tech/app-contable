// SINTÉTICO del worker de BOLETAS (e-Boleta Vuetify). Corre el sii-worker.js
// REAL contra un DOM Vuetify falso que GRABA cada click/escritura, manejándolo
// como el background (APP_CONTABLE_SII_FILL_AND_EMIT → sendResponse). No toca el
// SII. Es la red de seguridad del refactor libreto→job: prueba que con y sin
// libreto la secuencia es la MISMA (pura mudanza) y que MUERDE.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BOLETA_LIBRETO } from "../../src/lib/emission/sii-libreto.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SRC = readFileSync(join(__dirname, "sii-worker.js"), "utf8");

// ── DOM Vuetify falso que graba ─────────────────────────────────────────────
let actions = [];
let scene = [];        // nodos "sueltos" en el document
let modalOpen = false; // el modal aparece tras clickear EMITIR
let modalNode = null;

class FakeHTMLElement {}
Object.defineProperty(FakeHTMLElement.prototype, "value", {
  get() { return this._value ?? ""; },
  set(v) { this._value = String(v); actions.push({ op: "set", role: this.role, value: String(v) }); },
  configurable: true,
});

function el({ tag = "DIV", sel = [], text = "", role = null, value = "", disabled = false, children = [] } = {}) {
  const node = Object.create(FakeHTMLElement.prototype);
  node.tagName = tag;
  node._sel = sel;
  node._text = text;
  node.role = role;
  node._value = value;
  node.disabled = disabled;
  node._children = children;
  node.checked = false;
  node.style = {};
  node.classList = { add() {}, remove() {}, contains: () => false, toggle() {} };
  node.setAttribute = () => {};
  node.removeAttribute = () => {};
  node.appendChild = (c) => c;
  node.removeChild = () => {};
  node.remove = () => {};
  node.insertBefore = (c) => c;
  Object.defineProperty(node, "innerText", { get() { return node._text; }, set(v) { node._text = String(v); }, configurable: true });
  Object.defineProperty(node, "parentNode", { value: null, configurable: true });
  Object.defineProperty(node, "textContent", { get() { return node._text; }, configurable: true });
  node.getAttribute = (a) => (a === "value" ? node._value : null);
  node.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 });
  node.offsetWidth = 10; node.offsetHeight = 10; node.offsetParent = {};
  node.closest = () => null;
  node.dispatchEvent = () => true;
  node.click = () => { actions.push({ op: "click", role: node.role }); if (node.onClick) node.onClick(); };
  node.querySelectorAll = (s) => matchAll(node._children, s);
  node.querySelector = (s) => matchAll(node._children, s)[0] ?? null;
  node.scrollIntoView = () => {};
  node.focus = () => {};
  return node;
}

// matchAll: un selector puede traer varios tokens separados por coma; un nodo
// matchea si alguno de sus `sel` coincide con algún token.
function matchAll(nodes, selector) {
  const toks = String(selector).split(",").map((t) => t.trim());
  return nodes.filter((n) => n._sel && n._sel.some((s) => toks.includes(s)));
}

const fakeDocument = {
  body: { get innerText() { return ""; }, get textContent() { return ""; }, appendChild(c) { return c; }, removeChild() {}, style: {}, contains: () => false },
  documentElement: { appendChild(c) { return c; }, removeChild() {}, style: {} },
  getElementsByTagName: () => [],
  createElement: () => el(),
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: (s) => allNodes().filter((n) => n._sel?.some((x) => String(s).split(",").map((t) => t.trim()).includes(x)))[0] ?? null,
  querySelectorAll: (s) => matchAll(allNodes(), s),
};
function allNodes() { return modalOpen && modalNode ? [...scene, modalNode] : [...scene]; }

// ── Arnés: monta el worker real y lo maneja como el background ──────────────
let driveListener = null;

function mountWorker() {
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, getComputedStyle: () => ({ visibility: "visible", display: "block" }) };
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

// ── Escena: emisor ya seleccionado + pad + EMITIR; el modal aparece al emitir ─
const EMISOR = "78.448.088-7";

function escenaEmision({ conEmitir = true, tipoTexto = "Boleta afecta", pagoTexto = "Método de pago Efectivo" } = {}) {
  scene = [];
  scene.push(el({ tag: "DIV", sel: [".v-select__selections"], text: EMISOR })); // emisor activo
  for (const d of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    scene.push(el({ tag: "BUTTON", sel: ["button"], text: d, role: `digit_${d}` }));
  }
  if (conEmitir) {
    const emitir = el({ tag: "BUTTON", sel: ["button"], text: "EMITIR", role: "btn_emitir" });
    emitir.onClick = () => { modalOpen = true; };
    scene.push(emitir);
  }
  // el modal (aparece al abrir): trae los slots de tipo y pago ya mostrando el valor
  modalNode = el({
    tag: "DIV", sel: [".v-dialog.v-dialog--active"], text: "Emitir e-Boleta",
    children: [
      el({ tag: "DIV", sel: [".v-select__slot", ".v-input__slot"], text: tipoTexto, role: "slot_tipo" }),
      el({ tag: "DIV", sel: [".v-select__slot", ".v-input__slot"], text: pagoTexto, role: "slot_pago" }),
      el({ tag: "BUTTON", sel: ["button"], text: "EMITIR", role: "btn_emitir_final" }),
    ],
  });
  modalOpen = false;
  return scene;
}

async function drive(job) {
  actions = [];
  let res;
  driveListener(
    { source: "app-contable-extension", type: "APP_CONTABLE_SII_FILL_AND_EMIT", job_id: job.job_id, job },
    {}, (r) => { res = r; },
  );
  await vi.runAllTimersAsync();
  return { res, actions: actions.slice() };
}

const jobBoleta = (over = {}) => ({
  job_id: "b1", empresa_id: "e1", emisor_rut: EMISOR, tipo_dte: 39,
  totales: { monto_total: 1 }, glosa: "",
  receptor: {}, learn_only: false, auto_emit: true,
  allow_final_emit: false, // se frena antes de firmar → 0 folios
  ...over,
});

beforeAll(() => { mountWorker(); });

describe("sintético del worker de boletas (corre el original que ya funciona)", () => {
  beforeAll(() => { vi.useFakeTimers(); });

  it("baseline: teclea el monto y abre el modal, sin firmar (candado)", async () => {
    escenaEmision();
    const { res, actions: a } = await drive(jobBoleta());
    // No se clickeó el EMITIR final del modal (candado con allow_final_emit=false)
    expect(a.find((x) => x.role === "btn_emitir_final")).toBeUndefined();
    // sí tecleó el dígito y abrió el modal con el primer EMITIR
    expect(a).toContainEqual({ op: "click", role: "digit_1" });
    expect(a).toContainEqual({ op: "click", role: "btn_emitir" });
  });

  it("con libreto == sin libreto (pura mudanza)", async () => {
    escenaEmision();
    const sin = await drive(jobBoleta());
    escenaEmision();
    const con = await drive(jobBoleta({ libreto: BOLETA_LIBRETO }));
    expect(con.actions).toEqual(sin.actions);
  });

  it("MUERDE: un libreto con el slot de tipo saboteado hace fallar la emisión", async () => {
    escenaEmision();
    const bad = JSON.parse(JSON.stringify(BOLETA_LIBRETO));
    bad.slots.tipo = "ZzzNoExiste";
    const { res } = await drive(jobBoleta({ libreto: bad }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("TIPO_NO_CONFIRMADO");
  });

  it("detección: sin el botón EMITIR → posible_cambio_sii en botones.emitir", async () => {
    escenaEmision({ conEmitir: false });
    const { res } = await drive(jobBoleta());
    expect(res.ok).toBe(false);
    expect(res.posible_cambio_sii).toBe(true);
    expect(res.ancla_faltante).toBe("botones.emitir");
  });

  it("dato del cliente (monto 0) NO dispara la alerta", async () => {
    escenaEmision();
    const { res } = await drive(jobBoleta({ totales: { monto_total: 0 } }));
    expect(res.ok).toBe(false);
    expect(res.posible_cambio_sii).not.toBe(true);
  });
});
