import { describe, expect, it, vi } from "vitest";

// Bug en vivo (2026-10-01, coordinador en Chrome, dev webpack): estaba en EMITIR, la
// pestaña oculta recargó sola y volvió a CHECK. Este test recorre el ciclo completo
// guardar → recargar → restaurar con módulos FRESCOS (como una recarga real) y con la
// mesa montando TARDE (dev compila /massdte en >8 s; en prod, chunks fríos).

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

const RUTA = "/massdte?date=2026-09-30&month=2026-8&view=day&mesa=boleta";

function instalarNavegador(storage: MemStorage) {
  const [pathname, q] = RUTA.split("?");
  vi.stubGlobal("window", { sessionStorage: storage, location: { pathname, search: "?" + q } });
}

// Una recarga real deja la pestaña con globalThis nuevo: se limpian los singletons.
function recargarPestana() {
  const g = globalThis as Record<string, unknown>;
  delete g.__massdtePiezas;
  delete g.__massdteBloqueos;
}

async function cargarPagina() {
  vi.resetModules();
  const piezas = await import("./piezas");
  const capturar = await import("./capturar");
  const estado = await import("./estado-guardado");
  return { ...piezas, ...capturar, ...estado };
}

describe("ciclo completo: guardar → recargar → restaurar (pestaña Emitir + doc del visor)", () => {
  it("la pestaña y el doc vuelven aunque la mesa monte 12 s después de cargar", async () => {
    const storage = new MemStorage();
    instalarNavegador(storage);
    recargarPestana();

    // Página vieja: TabsV5 en Emitir, MesaTab con doc-42 abierto.
    const vieja = await cargarPagina();
    vieja.registrarPieza("mesa.tab", { guardar: () => "emitir", restaurar: () => {} });
    vieja.registrarPieza("check.doc", { guardar: () => "doc-42", restaurar: () => {} });
    const e = vieja.capturarEstadoVisible({ raiz: { querySelectorAll: () => [] }, ruta: RUTA, ahora: 1_000, desde: "dev", foco: null, ventana: { x: 0, y: 0 } });
    expect(e.piezas).toEqual({ "mesa.tab": "emitir", "check.doc": "doc-42" });
    expect(e.tapar).toBe(true);
    vieja.guardarEstado(storage, e);

    // Recarga: módulos nuevos. El layout (ActualizadorInvisible) monta primero…
    vi.spyOn(Date, "now").mockReturnValue(1_500);
    recargarPestana();
    const nueva = await cargarPagina();
    expect(nueva.estadoARestaurar()?.piezas["mesa.tab"]).toBe("emitir");
    // …y la mesa recién llega 12 s después: NO se descartó por tiempo.
    expect(nueva.debeDescartarRestauracion({ msDesdeCarga: 12_000, msDesdePrimeraRestauracion: null, toco: false })).toBe(false);
    const tab = vi.fn();
    const doc = vi.fn();
    nueva.registrarPieza("mesa.tab", { guardar: () => "subidos", restaurar: tab });
    nueva.registrarPieza("check.doc", { guardar: () => null, restaurar: doc });
    expect(tab).toHaveBeenCalledWith("emitir");
    expect(doc).toHaveBeenCalledWith("doc-42");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("TabsV5 se monta DOS veces tras recargar (SSR fallido → render cliente, StrictMode, Mesa que llega con datos): sigue en Emitir", async () => {
    const storage = new MemStorage();
    instalarNavegador(storage);
    recargarPestana();
    const vieja = await cargarPagina();
    vieja.guardarEstado(storage, vieja.capturarEstadoVisible({ raiz: { querySelectorAll: () => [] }, ruta: RUTA, ahora: Date.now(), desde: "dev", foco: null, ventana: { x: 0, y: 0 } }));
    // (la página vieja no tenía piezas: se arma el estado a mano)
    const e = JSON.parse(storage.getItem(vieja.CLAVE_ESTADO)!);
    e.piezas = { "mesa.tab": "emitir" };
    storage.setItem(vieja.CLAVE_ESTADO, JSON.stringify(e));

    recargarPestana();
    const nueva = await cargarPagina();
    // 1.er montaje: restaura y se desmonta (el árbol se descarta).
    const tab1 = vi.fn();
    const desmontar1 = nueva.registrarPieza("mesa.tab", { guardar: () => "subidos", restaurar: tab1 });
    expect(tab1).toHaveBeenCalledWith("emitir");
    expect(nueva.piezasPorRestaurar()).toBe(0);
    desmontar1();
    // 2.º montaje nace con useState("subidos"): debe volver a recibir "emitir".
    const tab2 = vi.fn();
    nueva.registrarPieza("mesa.tab", { guardar: () => "subidos", restaurar: tab2 });
    expect(tab2).toHaveBeenCalledWith("emitir");
    // Cerrada la ventana (la clienta tocó algo / descarte), un remontaje ya no la mueve.
    nueva.descartarRestauracion();
    const tab3 = vi.fn();
    nueva.registrarPieza("mesa.tab", { guardar: () => "subidos", restaurar: tab3 });
    expect(tab3).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("un toque ANTES de restaurar (página sin hidratar: ese toque la hidrata) no descarta nada", async () => {
    const { debeDescartarRestauracion: d, toqueCierraVentana } = await cargarPagina();
    // Bug en vivo con 39d6542: el pointerdown que hidrataba la página descartaba la
    // restauración antes de que TabsV5 se registrara → nacía en Check.
    expect(toqueCierraVentana(null)).toBe(false);
    expect(toqueCierraVentana(200)).toBe(false);
    expect(toqueCierraVentana(1_000)).toBe(true);
    expect(d({ msDesdeCarga: 25_000, msDesdePrimeraRestauracion: null, toco: true })).toBe(false);
    expect(d({ msDesdeCarga: 25_000, msDesdePrimeraRestauracion: 200, toco: true })).toBe(false);

    // Ciclo: toque antes del registro → TabsV5 se registra después → igual restaura.
    const storage = new MemStorage();
    instalarNavegador(storage);
    recargarPestana();
    const vieja = await cargarPagina();
    vieja.registrarPieza("mesa.tab", { guardar: () => "emitir", restaurar: () => {} });
    vieja.guardarEstado(storage, vieja.capturarEstadoVisible({ raiz: { querySelectorAll: () => [] }, ruta: RUTA, ahora: Date.now(), desde: "dev", foco: null, ventana: { x: 0, y: 0 } }));
    recargarPestana();
    const nueva = await cargarPagina();
    nueva.estadoARestaurar();
    const primera = nueva.momentoPrimeraRestauracion();
    if (nueva.toqueCierraVentana(primera === null ? null : Date.now() - primera)) nueva.descartarRestauracion();
    const tab = vi.fn();
    nueva.registrarPieza("mesa.tab", { guardar: () => "subidos", restaurar: tab });
    expect(tab).toHaveBeenCalledWith("emitir");
    vi.unstubAllGlobals();
  });

  it("dos copias del módulo (chunks del layout y de la página) comparten piezas y bloqueos", async () => {
    vi.stubGlobal("window", { sessionStorage: new MemStorage(), location: { pathname: "/massdte", search: "" } });
    recargarPestana();
    vi.resetModules();
    const a = await import("./piezas");
    const oa = await import("./ocupado");
    vi.resetModules();
    const b = await import("./piezas");
    const ob = await import("./ocupado");
    expect(a).not.toBe(b);
    a.registrarPieza("mesa.tab", { guardar: () => "emitir", restaurar: () => {} });
    expect(b.capturarPiezas()).toEqual({ "mesa.tab": "emitir" });
    const soltar = oa.tomarBloqueo("emision_lote");
    expect(ob.bloqueosActivos()).toEqual(["emision_lote"]);
    soltar();
    expect(ob.bloqueosActivos()).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("se descarta al primer toque de la clienta, o 8 s después de la primera pieza, o al minuto", async () => {
    const { debeDescartarRestauracion: d } = await cargarPagina();
    expect(d({ msDesdeCarga: 5_000, msDesdePrimeraRestauracion: 1_000, toco: true })).toBe(true);
    expect(d({ msDesdeCarga: 9_000, msDesdePrimeraRestauracion: 8_001, toco: false })).toBe(true);
    expect(d({ msDesdeCarga: 9_000, msDesdePrimeraRestauracion: 2_000, toco: false })).toBe(false);
    expect(d({ msDesdeCarga: 60_001, msDesdePrimeraRestauracion: null, toco: false })).toBe(true);
  });
});
