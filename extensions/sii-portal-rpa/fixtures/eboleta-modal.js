// FIXTURE del portal e-Boleta (eboleta.sii.cl, Vuetify 2) para el sintético del worker
// de boletas. DOM FALSO que GRABA cada click/escritura y reproduce los TEXTOS REALES del
// portal (verificados en vivo): título "Emitir e-Boleta", "Elija sucursal", "Boleta
// afecta"/"Boleta exenta", "Método de pago"/"Efectivo", toggles "Detalle"/"Receptor",
// contenedor de glosa "Detalle 0 / 80", vendedor con valor y label flotado, "RUT
// receptor"/"Nombre receptor", EMITIR final, alerta de monto alto "¿Desea continuar?"
// con SÍ/NO. No toca el SII. Lo usa boletas-sintetico.test.js; si el SII renombra algo
// de verdad, ESTE archivo es lo que hay que actualizar (y los tests MUERDEN).
export const estado = {
  actions: [],
  scene: [],        // nodos "sueltos" en el document
  modalOpen: false, // el modal aparece tras clickear EMITIR
  modalNode: null,
  menus: [],        // menús Vuetify desplegados (.v-menu__content) — viven en el body
  alertaAbierta: false, // alerta de monto alto (tapa el modal hasta apretar SÍ)
  alertaNodes: [],
};

export class FakeHTMLElement {}
Object.defineProperty(FakeHTMLElement.prototype, "value", {
  get() { return this._value ?? ""; },
  set(v) { this._value = String(v); estado.actions.push({ op: "set", role: this.role, value: String(v) }); },
  configurable: true,
});

export function el({ tag = "DIV", sel = [], text = "", role = null, value = "", disabled = false, children = [], attrs = {} } = {}) {
  const node = Object.create(FakeHTMLElement.prototype);
  node.tagName = tag;
  node._sel = sel;
  node._text = text;
  node.role = role;
  node._value = value;
  node._attrs = attrs;
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
  // innerText/textContent como en el DOM real: texto propio + el de los hijos (el modal
  // "ve" sus slots, toggles y botones; así el worker detecta "Elija sucursal" en el diálogo).
  const textoCompleto = () => [node._text, ...node._children.map((c) => c.innerText)].filter(Boolean).join("\n");
  Object.defineProperty(node, "innerText", { get() { return textoCompleto(); }, set(v) { node._text = String(v); }, configurable: true });
  Object.defineProperty(node, "parentNode", { value: null, configurable: true });
  Object.defineProperty(node, "textContent", { get() { return textoCompleto(); }, configurable: true });
  node.getAttribute = (a) => (a === "value" ? node._value : (node._attrs[a] ?? null));
  node.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 });
  node.offsetWidth = 10; node.offsetHeight = 10; node.offsetParent = {};
  node.closest = () => null;
  node.contains = (other) => other === node || node._children.some((c) => c === other || (typeof c.contains === "function" && c.contains(other)));
  node.dispatchEvent = () => true;
  node.click = () => { estado.actions.push({ op: "click", role: node.role }); if (node.onClick) node.onClick(); };
  node.querySelectorAll = (s) => matchAll(node._children, s);
  node.querySelector = (s) => matchAll(node._children, s)[0] ?? null;
  node.scrollIntoView = () => {};
  node.focus = () => {};
  return node;
}

// matchAll: un selector puede traer varios tokens separados por coma; un nodo
// matchea si alguno de sus `sel` coincide con algún token.
export function matchAll(nodes, selector) {
  const toks = String(selector).split(",").map((t) => t.trim());
  return nodes.filter((n) => n._sel && n._sel.some((s) => toks.includes(s)));
}

function allNodes() {
  const out = [...estado.scene, ...estado.menus];
  if (estado.alertaAbierta) out.push(...estado.alertaNodes);
  if (estado.modalOpen && estado.modalNode) out.push(estado.modalNode);
  return out;
}
function bodyText() {
  return estado.alertaAbierta ? "Está a punto de emitir una boleta por $ 6.000.000 ¿Desea continuar?" : "";
}

export const fakeDocument = {
  body: { get innerText() { return bodyText(); }, get textContent() { return bodyText(); }, appendChild(c) { return c; }, removeChild() {}, style: {}, contains: () => false },
  documentElement: { appendChild(c) { return c; }, removeChild() {}, style: {} },
  getElementsByTagName: () => [],
  createElement: () => el(),
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true, // closeEmisorDropdown manda un Escape al document
  querySelector: (s) => matchAll(allNodes(), s)[0] ?? null,
  querySelectorAll: (s) => matchAll(allNodes(), s),
};

export const EMISOR = "78.448.088-7";
export const VENDEDOR_RUT = "19427394-0";

// Un v-select Vuetify falso, como el real: el slot trae el LABEL (texto propio) y un
// .v-select__selections > .v-select__selection con lo ELEGIDO (vacío si no hay nada).
// Al clickear el slot se despliega un .v-menu__content con las opciones; al clickear
// una opción la selección pasa a mostrarla (mismo nodo, texto nuevo) y el menú se cierra.
function vSelect({ label, seleccion = "", opciones, roleSlot, roleOpcion }) {
  const selection = el({ tag: "DIV", sel: [".v-select__selection"], text: seleccion });
  const selections = el({ tag: "DIV", sel: [".v-select__selections"], children: [selection] });
  const slot = el({ tag: "DIV", sel: [".v-select__slot", ".v-input__slot"], text: label, role: roleSlot, children: [selections] });
  const items = opciones.map((o) => {
    const it = el({ tag: "DIV", sel: [".v-list-item", "[role='option']"], text: o, role: `${roleOpcion}:${o}` });
    it.onClick = () => { selection._text = o; estado.menus = estado.menus.filter((m) => m !== menu); };
    return it;
  });
  const menu = el({ tag: "DIV", sel: [".v-menu__content"], children: items });
  slot.onClick = () => { if (!estado.menus.includes(menu)) estado.menus.push(menu); };
  return slot;
}

// Toggle Vuetify (v-switch): el input está oculto; clickear el contenedor/ripple lo prende.
function vSwitch({ label, roleChk, roleRow }) {
  const chk = el({ tag: "INPUT", sel: ["input[type='checkbox']", "input"], role: roleChk });
  chk.click = () => { chk.checked = !chk.checked; estado.actions.push({ op: "click", role: roleChk }); };
  // El ripple graba con el MISMO rol que el checkbox: para el test da lo mismo por dónde
  // se prendió el switch (ripple o input), lo que importa es que quedó prendido.
  const ripple = el({ tag: "DIV", sel: [".v-input--selection-controls__ripple"], role: roleChk });
  ripple.onClick = () => { chk.checked = !chk.checked; };
  return el({ tag: "DIV", sel: [".v-input--switch", ".v-input", ".v-input--selection-controls"], text: label, role: roleRow, children: [chk, ripple] });
}

// Campo de texto Vuetify: el input dentro de un .v-input cuyo innerText es el label (+ contador).
function vTextField({ contTexto, role, value = "", attrs = {} }) {
  const cont = el({ tag: "DIV", sel: [".v-input"], text: contTexto });
  const input = el({ tag: "INPUT", sel: ["input[type='text']", "input"], role, value, attrs });
  input.closest = (s) => (String(s).split(",").map((t) => t.trim()).includes(".v-input") ? cont : null);
  return input;
}

/**
 * Escena: emisor ya seleccionado + pad + EMITIR; el modal "Emitir e-Boleta" aparece al
 * emitir (o tras la alerta de monto alto si montoAlto=true). Devuelve la escena.
 *  - sucursalTexto: "Elija sucursal" (sin auto-selección, el worker debe elegir) o
 *    "Sucursal <dirección>" (label "Sucursal" + selección). sucursalLabel/sucursalSeleccion
 *    los pisan por separado (p. ej. label "Elija sucursal" CON selección: no se toca).
 *  - sucursalOpciones: [] simula el hoyo real: slot vacío y menú sin opciones.
 *  - tipoTexto / pagoTexto: lo SELECCIONADO en tipo y pago (label fijo del portal).
 *  - glosaContTexto: "Detalle 0 / 80" real; "0 / 80" = label flotado; "Detalle" = sin contador.
 *  - conReceptor: agrega los campos RUT/Nombre receptor (labels reales del SII).
 */
export function escenaEmision({
  conEmitir = true,
  tipoTexto = "Boleta afecta",
  pagoTexto = "Método de pago Efectivo",
  sucursalTexto = "Sucursal Apoquindo 6410 Of 605",
  sucursalOpciones = ["Apoquindo 6410 Of 605"],
  sucursalLabel = /^elija/i.test(sucursalTexto) ? sucursalTexto : "Sucursal",
  sucursalSeleccion = /^elija/i.test(sucursalTexto) ? "" : sucursalTexto.replace(/^Sucursal\s+/, ""),
  glosaContTexto = "Detalle 0 / 80",
  conReceptor = false,
  montoAlto = false,
} = {}) {
  estado.scene = [];
  estado.menus = [];
  estado.alertaAbierta = false;
  estado.modalOpen = false;
  // Selector superior de empresa (emisor activo): .v-select > .v-select__selections.
  const selecciones = el({ tag: "DIV", sel: [".v-select__selections"], text: EMISOR });
  const emisorSelect = el({ tag: "DIV", sel: [".v-select"], text: EMISOR, role: "emisor_select", children: [selecciones] });
  estado.scene.push(selecciones, emisorSelect);
  for (const d of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    estado.scene.push(el({ tag: "BUTTON", sel: ["button"], text: d, role: `digit_${d}` }));
  }
  if (conEmitir) {
    const emitir = el({ tag: "BUTTON", sel: ["button"], text: "EMITIR", role: "btn_emitir" });
    emitir.onClick = () => { if (montoAlto) estado.alertaAbierta = true; else estado.modalOpen = true; };
    estado.scene.push(emitir);
  }
  // Alerta de monto alto (persistente, tapa el modal): NO (rojo) / SÍ (verde).
  const btnNo = el({ tag: "BUTTON", sel: ["button"], text: "NO", role: "alerta_no" });
  const btnSi = el({ tag: "BUTTON", sel: ["button"], text: "SÍ", role: "alerta_si" });
  btnSi.onClick = () => { estado.alertaAbierta = false; estado.modalOpen = true; };
  estado.alertaNodes = [btnNo, btnSi];

  const toggleDetalle = vSwitch({ label: "Detalle", roleChk: "chk_detalle", roleRow: "toggle_detalle" });
  const toggleReceptor = vSwitch({ label: "Receptor", roleChk: "chk_receptor", roleRow: "toggle_receptor" });
  // Campo glosa: sin placeholder/label/name; su contenedor v-input muestra "Detalle 0 / 80".
  const glosaInput = vTextField({ contTexto: glosaContTexto, role: "glosa_input" });
  // Campo "Vendedor" CON valor: su label "Vendedor" ya flotó fuera del innerText (queda
  // solo el RUT), como en el bug real. NO debe ser candidato a glosa (no tiene contador).
  const vendedorInput = vTextField({ contTexto: VENDEDOR_RUT, role: "vendedor_input", value: VENDEDOR_RUT });
  const children = [
    vSelect({ label: sucursalLabel, seleccion: sucursalSeleccion, opciones: sucursalOpciones, roleSlot: "slot_sucursal", roleOpcion: "opt_sucursal" }),
    vSelect({ label: "Tipo de boleta", seleccion: tipoTexto, opciones: ["Boleta afecta", "Boleta exenta"], roleSlot: "slot_tipo", roleOpcion: "opt_tipo" }),
    vSelect({ label: "Método de pago", seleccion: pagoTexto.replace(/^M[ée]todo de pago\s*/i, ""), opciones: ["Efectivo", "Tarjeta"], roleSlot: "slot_pago", roleOpcion: "opt_pago" }),
    toggleDetalle,
    toggleReceptor,
    glosaInput,
    vendedorInput,
  ];
  if (conReceptor) {
    children.push(
      vTextField({ contTexto: "RUT receptor", role: "receptor_rut", attrs: { "aria-label": "RUT receptor" } }),
      vTextField({ contTexto: "Nombre receptor", role: "receptor_nombre", attrs: { "aria-label": "Nombre receptor" } }),
    );
  }
  children.push(el({ tag: "BUTTON", sel: ["button"], text: "EMITIR", role: "btn_emitir_final" }));
  estado.modalNode = el({ tag: "DIV", sel: [".v-dialog.v-dialog--active"], text: "Emitir e-Boleta", children });
  return estado.scene;
}
