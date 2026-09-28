import { describe, expect, it } from "vitest";
import { cadenciaDocs, crearEspaciador, crearRecargador, mergeRcv, DEBOUNCE_MS, type Timers } from "./mesa-frescura";

// Reloj falso: los timers corren solo al avanzar.
function relojFalso() {
  let t = 0;
  let id = 0;
  const cola = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    ahora: () => t,
    programar: (fn, ms) => { const h = ++id; cola.set(h, { at: t + ms, fn }); return h; },
    cancelar: (h) => { cola.delete(h as number); },
  };
  const avanzar = (ms: number) => {
    const fin = t + ms;
    for (;;) {
      const prox = [...cola.entries()].filter(([, v]) => v.at <= fin).sort((a, b) => a[1].at - b[1].at)[0];
      if (!prox) break;
      cola.delete(prox[0]);
      t = prox[1].at;
      prox[1].fn();
    }
    t = fin;
  };
  return { timers, avanzar };
}

function diferido<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("crearRecargador", () => {
  it("3 pedidos con una carga en vuelo → 2 cargas en total; la 2ª con los params recientes", async () => {
    const rango = "A";
    const cargas: string[] = [];
    const pendientes: Array<ReturnType<typeof diferido<string>>> = [];
    const aplicados: string[] = [];
    const r = crearRecargador({
      params: () => rango,
      clave: (p) => p,
      cargar: (p) => { cargas.push(p); const d = diferido<string>(); pendientes.push(d); return d.promise; },
      aplicar: (_p, res) => { aplicados.push(res); },
    });
    r.pedir(); r.pedir(); r.pedir();
    expect(cargas).toEqual(["A"]);
    pendientes[0].resolve("resA");
    await tick();
    expect(cargas).toEqual(["A", "A"]);
    pendientes[1].resolve("resA2");
    await tick();
    expect(cargas.length).toBe(2);
    expect(aplicados).toEqual(["resA", "resA2"]);
    expect(r.enVuelo()).toBe(false);
  });

  it("descarta la respuesta de un rango viejo (el usuario navegó mientras cargaba)", async () => {
    let rango = "enero";
    const d = diferido<string>();
    const aplicados: string[] = [];
    const r = crearRecargador({ params: () => rango, clave: (p) => p, cargar: () => d.promise, aplicar: (_p, x) => { aplicados.push(x); } });
    r.pedir();
    rango = "febrero";
    d.resolve("datos-enero");
    await tick();
    expect(aplicados).toEqual([]);
  });

  it("un error libera el flag (no queda trabado para siempre)", async () => {
    let n = 0;
    const r = crearRecargador({
      params: () => "A", clave: (p) => p,
      cargar: async () => { n++; if (n === 1) throw new Error("red"); return "ok"; },
      aplicar: () => {},
    });
    r.pedir();
    await tick();
    expect(r.enVuelo()).toBe(false);
    r.pedir();
    await tick();
    expect(n).toBe(2);
  });
});

describe("crearEspaciador (throttle del lote)", () => {
  it("un evento suelto dispara tras el debounce", () => {
    const { timers, avanzar } = relojFalso();
    let n = 0;
    const e = crearEspaciador(() => { n++; }, () => 15_000, timers);
    e.evento();
    avanzar(DEBOUNCE_MS - 1);
    expect(n).toBe(0);
    avanzar(1);
    expect(n).toBe(1);
  });

  it("100 eventos en 60 s con intervalo 15 s → ≤ 5 recargas, y la última siempre llega", () => {
    const { timers, avanzar } = relojFalso();
    let n = 0;
    const e = crearEspaciador(() => { n++; }, () => 15_000, timers);
    for (let i = 0; i < 100; i++) { e.evento(); avanzar(600); }
    avanzar(20_000); // cola
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);
    const antes = n;
    avanzar(60_000);
    expect(n).toBe(antes); // nada pendiente: no dispara de más
  });

  it("boletas cada 40 s con lote activo (60 s) → menos de una recarga por boleta", () => {
    const { timers, avanzar } = relojFalso();
    let n = 0;
    const e = crearEspaciador(() => { n++; }, () => 60_000, timers);
    for (let i = 0; i < 30; i++) { e.evento(); e.evento(); e.evento(); avanzar(40_000); }
    expect(n).toBeLessThanOrEqual(21);
  });

  it("vaciar() dispara YA lo pendiente (fin de lote) y no dispara si no hay nada", () => {
    const { timers, avanzar } = relojFalso();
    let n = 0;
    const e = crearEspaciador(() => { n++; }, () => 60_000, timers);
    e.vaciar();
    expect(n).toBe(0);
    e.evento(); avanzar(DEBOUNCE_MS); // 1ª
    e.evento(); avanzar(DEBOUNCE_MS); // queda de cola a 60 s
    expect(n).toBe(1);
    e.vaciar();
    expect(n).toBe(2);
    avanzar(120_000);
    expect(n).toBe(2);
  });
});

describe("cadenciaDocs", () => {
  it("oculta o sin nada procesando → null", () => {
    expect(cadenciaDocs({ oculta: true, hayProcesando: true, intento: 0 })).toBeNull();
    expect(cadenciaDocs({ oculta: false, hayProcesando: false, intento: 0 })).toBeNull();
  });
  it("5 → 10 → 30 → 60 y se queda en 60 (sin tope por tiempo)", () => {
    const seq = [0, 1, 2, 3, 4, 50].map((i) => cadenciaDocs({ oculta: false, hayProcesando: true, intento: i }));
    expect(seq).toEqual([5_000, 10_000, 30_000, 60_000, 60_000, 60_000]);
  });
});

describe("mergeRcv", () => {
  const f = (id: string, fecha: string, folio: number | null) => ({ id, fecha_emision: fecha, folio });
  it("agrega al mes, ordena fecha desc + folio desc", () => {
    const out = mergeRcv([f("a", "2026-09-10", 5), f("b", "2026-09-01", 1)], f("c", "2026-09-10", 6), "2026-09");
    expect(out.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("dedup por id (evento repetido)", () => {
    const out = mergeRcv([f("a", "2026-09-10", 5)], f("a", "2026-09-10", 5), "2026-09");
    expect(out).toHaveLength(1);
  });
  it("folio null va primero dentro del día (como Postgres DESC)", () => {
    const out = mergeRcv([f("a", "2026-09-10", 5)], f("n", "2026-09-10", null), "2026-09");
    expect(out.map((x) => x.id)).toEqual(["n", "a"]);
  });
  it("otro mes → no toca la lista", () => {
    const filas = [f("a", "2026-09-10", 5)];
    expect(mergeRcv(filas, f("z", "2026-08-31", 9), "2026-09")).toBe(filas);
  });
});
