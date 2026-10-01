import { beforeEach, describe, expect, it, vi } from "vitest";
import { CABECERA_ACTUALIZAR, CABECERA_VERSION, versionPublicada } from "./version";
import { crearActualizador, rutaPermiteRecarga, type DepsActualizador } from "./actualizador";
import { _reiniciarBloqueos, motivoOcupado, tomarBloqueo, bloqueosActivos } from "./ocupado";
import { anotarRecarga, decidirRecarga, ESPERA_TRAS_RECARGA_MS, leerRegistro, guardarRegistro } from "./anti-bucle";
import { ATRIBUTO_RESTAURANDO, CLAVE_ESTADO, guardarEstado, leerEstado, SCRIPT_ANTES_DE_PINTAR, TTL_ESTADO_MS, type EstadoGuardado } from "./estado-guardado";
import { _reiniciarPiezas, capturarPiezas, estadoARestaurar, piezasPorRestaurar, registrarPieza } from "./piezas";
import { aplicarScroll, capturarScroll } from "./scroll";

// Actualización invisible (2026-09-30): al publicar, cada pestaña se pone al día
// SOLA, en un momento seguro y volviendo exactamente donde estaba la clienta.

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

const cab = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

type DocFalso = { querySelector: (s: string) => unknown; activeElement: unknown };
const docLibre: DocFalso = { querySelector: () => null, activeElement: null };

function armar(over: Partial<DepsActualizador> = {}) {
  const sesion = new MemStorage();
  let t = 1_000_000;
  const recargar = vi.fn();
  const guardar = vi.fn();
  const deps: DepsActualizador = {
    versionPropia: "aaa111",
    ahora: () => t,
    sesion,
    oculta: () => true,
    enLinea: () => true,
    ruta: () => "/massdte",
    ocupado: () => null,
    ultimaInteraccion: () => 0,
    guardarEstado: guardar,
    recargar,
    ...over,
  };
  const act = crearActualizador(deps);
  return { act, recargar, guardar, sesion, avanzar: (ms: number) => { t += ms; }, ahora: () => t };
}

describe("detección por cabecera (cero pedidos extra)", () => {
  it("una respuesta con OTRA versión deja la actualización pendiente y recarga si está libre", () => {
    const { act, recargar, guardar } = armar();
    act.observar(cab({ [CABECERA_VERSION]: "bbb222" }));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("misma versión o sin cabecera: no pasa nada", () => {
    const { act, recargar } = armar();
    act.observar(cab({ [CABECERA_VERSION]: "aaa111" }));
    act.observar(cab({}));
    expect(act.pendiente()).toBeNull();
    expect(recargar).not.toHaveBeenCalled();
  });

  it("la marca del server 'esta pestaña es vieja' fuerza la puesta al día aunque la versión calce", () => {
    const { act, recargar } = armar();
    act.observar(cab({ [CABECERA_VERSION]: "aaa111", [CABECERA_ACTUALIZAR]: "1" }));
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("el server publica su versión; kill switch y dev con valor fijo", () => {
    expect(versionPublicada({ nodeEnv: "production", app: "abc123" })).toBe("abc123");
    expect(versionPublicada({ nodeEnv: "development", app: "local-xyz" })).toBe("dev");
    expect(versionPublicada({ nodeEnv: "production", app: "abc123", auto: "false" })).toBeNull();
    expect(versionPublicada({ nodeEnv: "development", app: "x", simulada: "otra" })).toBe("otra");
  });

  it("no recarga en /auth, /legal, /oauth ni páginas públicas", () => {
    expect(rutaPermiteRecarga("/massdte")).toBe(true);
    expect(rutaPermiteRecarga("/boletas/reportes")).toBe(true);
    for (const r of ["/auth/login", "/legal/terminos", "/oauth/autorizar", "/shell", "/instalar-extension", "/bloqueado"]) {
      expect(rutaPermiteRecarga(r)).toBe(false);
    }
    const { act, recargar } = armar({ ruta: () => "/auth/login" });
    act.observar(cab({ [CABECERA_VERSION]: "bbb222" }));
    expect(recargar).not.toHaveBeenCalled();
  });

  it("sin conexión no recarga (el SW serviría el shell y se perdería la vista)", () => {
    const { act, recargar } = armar({ enLinea: () => false });
    act.observar(cab({ [CABECERA_VERSION]: "bbb222" }));
    expect(recargar).not.toHaveBeenCalled();
  });
});

describe("solo en momento seguro", () => {
  beforeEach(() => _reiniciarBloqueos());

  it("NUNCA durante una emisión: espera y recarga cuando se libera", () => {
    let ocupado: string | null = "emision_lote";
    const { act, recargar } = armar({ ocupado: () => ocupado });
    act.observar(cab({ [CABECERA_VERSION]: "bbb222" }));
    expect(recargar).not.toHaveBeenCalled();
    expect(act.intentar()).toBe("ocupada");
    ocupado = null;
    expect(act.intentar()).toBe("recargada");
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("bloqueos explícitos: emisión, subida; se liberan una sola vez", () => {
    const soltarEmision = tomarBloqueo("emision_directa");
    const soltarSubida = tomarBloqueo("subida");
    expect(motivoOcupado({ bloqueos: bloqueosActivos(), mutacionesEnVuelo: 0, doc: docLibre })).toBe("emision_directa");
    soltarEmision(); soltarEmision();
    expect(motivoOcupado({ bloqueos: bloqueosActivos(), mutacionesEnVuelo: 0, doc: docLibre })).toBe("subida");
    soltarSubida();
    expect(motivoOcupado({ bloqueos: bloqueosActivos(), mutacionesEnVuelo: 0, doc: docLibre })).toBeNull();
  });

  it("un pedido que escribe en vuelo (subida, guardar, server action) bloquea", () => {
    expect(motivoOcupado({ bloqueos: [], mutacionesEnVuelo: 1, doc: docLibre })).toBe("pedido_en_vuelo");
  });

  it("un popup/formulario abierto bloquea", () => {
    const doc = { querySelector: (s: string) => (s.includes("data-actualizacion-espera") ? {} : null), activeElement: null };
    expect(motivoOcupado({ bloqueos: [], mutacionesEnVuelo: 0, doc })).toBe("popup_abierto");
  });

  it("un campo con texto y foco bloquea; un campo vacío o un botón no", () => {
    const con = (activeElement: unknown) => motivoOcupado({ bloqueos: [], mutacionesEnVuelo: 0, doc: { querySelector: () => null, activeElement } });
    expect(con({ tagName: "INPUT", type: "text", value: "12.345.678-5" })).toBe("escribiendo");
    expect(con({ tagName: "TEXTAREA", value: "glosa" })).toBe("escribiendo");
    expect(con({ tagName: "DIV", isContentEditable: true, textContent: "x" })).toBe("escribiendo");
    expect(con({ tagName: "INPUT", type: "text", value: "" })).toBeNull();
    expect(con({ tagName: "INPUT", type: "checkbox", value: "on" })).toBeNull();
    expect(con({ tagName: "BUTTON" })).toBeNull();
  });

  it("pestaña visible: no recarga en medio de un clic/tecla; sí cuando queda quieta", () => {
    let interaccion = 0;
    const h = armar({ oculta: () => false, ultimaInteraccion: () => interaccion });
    interaccion = h.ahora() - 500;
    h.act.observar(cab({ [CABECERA_VERSION]: "bbb222" }));
    expect(h.recargar).not.toHaveBeenCalled();
    h.avanzar(5_000);
    expect(h.act.intentar()).toBe("recargada");
  });
});

describe("anti-bucle", () => {
  it("máximo UNA recarga automática por versión", () => {
    const reg = anotarRecarga({ intentos: [] }, "bbb222", 0);
    expect(decidirRecarga(reg, "bbb222", ESPERA_TRAS_RECARGA_MS * 5)).toEqual({ ok: false, motivo: "ya_intentada" });
  });

  it("si tras recargar la versión sigue distinta, no reintenta en 10 min", () => {
    const reg = anotarRecarga({ intentos: [] }, "bbb222", 0);
    expect(decidirRecarga(reg, "ccc333", ESPERA_TRAS_RECARGA_MS - 1)).toEqual({ ok: false, motivo: "enfriando" });
    expect(decidirRecarga(reg, "ccc333", ESPERA_TRAS_RECARGA_MS)).toEqual({ ok: true });
  });

  it("versiones alternadas durante el rollout: una sola recarga en la pestaña", () => {
    const h = armar();
    h.act.observar(cab({ [CABECERA_VERSION]: "bbb222" }));
    expect(h.recargar).toHaveBeenCalledTimes(1);
    // "Recarga": nueva instancia con la misma sessionStorage; el server alterna.
    const tras = crearActualizador({ ...armarDeps(h), versionPropia: "bbb222" });
    tras.observar(cab({ [CABECERA_VERSION]: "aaa111" }));
    tras.observar(cab({ [CABECERA_VERSION]: "bbb222" }));
    tras.observar(cab({ [CABECERA_VERSION]: "aaa111" }));
    expect(h.recargar).toHaveBeenCalledTimes(1);
  });

  it("el registro sobrevive en sessionStorage y tolera basura", () => {
    const s = new MemStorage();
    guardarRegistro(s, anotarRecarga({ intentos: [] }, "v1", 5));
    expect(leerRegistro(s).intentos).toEqual([{ version: "v1", at: 5 }]);
    s.setItem("massdte:actualizacion:recargas", "{no json");
    expect(leerRegistro(s)).toEqual({ intentos: [] });
  });
});

function armarDeps(h: ReturnType<typeof armar>): DepsActualizador {
  return {
    versionPropia: "aaa111", ahora: h.ahora, sesion: h.sesion, oculta: () => true, enLinea: () => true,
    ruta: () => "/massdte", ocupado: () => null, ultimaInteraccion: () => 0, guardarEstado: () => {}, recargar: h.recargar,
  };
}

const estadoBase = (over: Partial<EstadoGuardado> = {}): EstadoGuardado => ({
  formato: 1, desde: "aaa111", at: 1_000, ruta: "/massdte?date=2026-09-12&month=2026-8&view=month&mesa=boleta",
  piezas: { "mesa.tab": "emitir", "check.doc": "doc-42" }, scroll: [{ clave: "emitir.lista", top: 640, left: 0 }], foco: null, ventana: { x: 0, y: 0 },
  ...over,
});

describe("guardar y restaurar el estado", () => {
  beforeEach(() => _reiniciarPiezas(() => null));

  it("captura pestaña, doc seleccionado y filtros desde las piezas registradas", () => {
    registrarPieza("mesa.tab", { guardar: () => "emitir", restaurar: () => {} });
    registrarPieza("check.doc", { guardar: () => "doc-42", restaurar: () => {} });
    registrarPieza("vacia", { guardar: () => undefined, restaurar: () => {} });
    expect(capturarPiezas()).toEqual({ "mesa.tab": "emitir", "check.doc": "doc-42" });
  });

  it("tras recargar cada pieza recibe su valor al montarse (aunque monte tarde)", () => {
    const s = new MemStorage();
    guardarEstado(s, estadoBase());
    const ruta = estadoBase().ruta;
    _reiniciarPiezas(() => leerEstado(s, { ahora: 1_500, ruta }));
    const tab = vi.fn();
    const doc = vi.fn();
    registrarPieza("mesa.tab", { guardar: () => "subidos", restaurar: tab });
    expect(tab).toHaveBeenCalledWith("emitir");
    expect(piezasPorRestaurar()).toBe(1);
    registrarPieza("check.doc", { guardar: () => null, restaurar: doc });
    expect(doc).toHaveBeenCalledWith("doc-42");
    expect(piezasPorRestaurar()).toBe(0);
    // Se consume UNA vez: otra recarga manual no vuelve a aplicarlo.
    expect(s.getItem(CLAVE_ESTADO)).toBeNull();
  });

  it("una pieza que revienta al restaurar no rompe nada", () => {
    _reiniciarPiezas(() => estadoBase());
    expect(() => registrarPieza("mesa.tab", { guardar: () => null, restaurar: () => { throw new Error("x"); } })).not.toThrow();
    expect(estadoARestaurar()?.piezas["check.doc"]).toBe("doc-42");
  });

  it("el mes/día viajan en la URL: si la ruta no calza, se descarta", () => {
    const s = new MemStorage();
    guardarEstado(s, estadoBase());
    expect(leerEstado(s, { ahora: 1_500, ruta: "/massdte?date=2026-09-30&month=2026-8&view=day&mesa=boleta" })).toBeNull();
  });

  it("scroll de los contenedores principales: se captura y se re-aplica", () => {
    const lista = { scrollTop: 640, scrollLeft: 0, getAttribute: (n: string) => (n === "data-restaurar-scroll" ? "emitir.lista" : null) };
    const anonimo = { scrollTop: 120, scrollLeft: 0, getAttribute: () => null };
    const quieto = { scrollTop: 0, scrollLeft: 0, getAttribute: () => null };
    const raiz = { querySelectorAll: () => [lista, anonimo, quieto] };
    const cap = capturarScroll(raiz);
    expect(cap).toEqual([{ clave: "emitir.lista", top: 640, left: 0 }, { clave: "r-scroll:0", top: 120, left: 0 }]);
    const nuevaLista = { scrollTop: 0, scrollLeft: 0, getAttribute: lista.getAttribute };
    const nuevoAnon = { scrollTop: 0, scrollLeft: 0, getAttribute: () => null };
    expect(aplicarScroll({ querySelectorAll: () => [nuevaLista, nuevoAnon] }, cap)).toBe(0);
    expect(nuevaLista.scrollTop).toBe(640);
    expect(nuevoAnon.scrollTop).toBe(120);
  });

  it("si la lista aún no creció lo suficiente, queda pendiente para el próximo cuadro", () => {
    const el = { scrollLeft: 0, getAttribute: () => "x", _t: 0, get scrollTop() { return this._t; }, set scrollTop(v: number) { this._t = Math.min(v, 100); } };
    expect(aplicarScroll({ querySelectorAll: () => [el] }, [{ clave: "x", top: 640, left: 0 }])).toBe(1);
  });
});

describe("TTL del estado guardado", () => {
  it("vale 2 minutos; después se descarta (y se borra)", () => {
    const s = new MemStorage();
    const e = estadoBase();
    guardarEstado(s, e);
    expect(leerEstado(s, { ahora: e.at + TTL_ESTADO_MS + 1, ruta: e.ruta })).toBeNull();
    expect(s.getItem(CLAVE_ESTADO)).toBeNull();
    guardarEstado(s, e);
    expect(leerEstado(s, { ahora: e.at + TTL_ESTADO_MS - 1, ruta: e.ruta })?.piezas["mesa.tab"]).toBe("emitir");
  });

  it("basura, formato viejo o fecha futura: se descarta sin romper", () => {
    const s = new MemStorage();
    s.setItem(CLAVE_ESTADO, "{roto");
    expect(leerEstado(s, { ahora: 0, ruta: "/massdte" })).toBeNull();
    s.setItem(CLAVE_ESTADO, JSON.stringify({ ...estadoBase(), formato: 0 }));
    expect(leerEstado(s, { ahora: 1_500, ruta: estadoBase().ruta })).toBeNull();
    s.setItem(CLAVE_ESTADO, JSON.stringify(estadoBase({ at: 999_999 })));
    expect(leerEstado(s, { ahora: 1_500, ruta: estadoBase().ruta })).toBeNull();
  });
});

describe("tapado antes de pintar (script inline)", () => {
  function correr(estado: unknown, { ahora, pathname, search }: { ahora: number; pathname: string; search: string }) {
    const attrs = new Map<string, string>();
    const s = new MemStorage();
    if (estado !== undefined) s.setItem(CLAVE_ESTADO, JSON.stringify(estado));
    const documentFalso = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) } };
    const DateFalso = { now: () => ahora };
    new Function("sessionStorage", "location", "document", "setTimeout", "Date", SCRIPT_ANTES_DE_PINTAR)(s, { pathname, search }, documentFalso, () => 0, DateFalso);
    return { tapado: attrs.has(ATRIBUTO_RESTAURANDO), consumido: s.getItem(CLAVE_ESTADO) === null };
  }
  const e = estadoBase();
  const [pathname, search] = [e.ruta.split("?")[0], "?" + e.ruta.split("?")[1]];

  it("tapa con la silueta solo si el estado está vigente para ESTA ruta (y no lo consume)", () => {
    expect(correr(e, { ahora: e.at + 1_000, pathname, search })).toEqual({ tapado: true, consumido: false });
  });

  it("vencido, otra ruta, sin estado o fuera de la mesa: no tapa", () => {
    expect(correr(e, { ahora: e.at + TTL_ESTADO_MS + 1, pathname, search }).tapado).toBe(false);
    expect(correr(e, { ahora: e.at + 1_000, pathname, search: "?date=otra" }).tapado).toBe(false);
    expect(correr(undefined, { ahora: e.at, pathname, search }).tapado).toBe(false);
    expect(correr({ ...e, ruta: "/boletas/reportes" }, { ahora: e.at + 1_000, pathname: "/boletas/reportes", search: "" }).tapado).toBe(false);
  });
});
