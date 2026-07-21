import { describe, it, expect, beforeEach, vi } from "vitest";
import { guardarLotePendiente, leerLotePendiente, limpiarLotePendiente } from "./lote-persist";

// Mock de localStorage (vitest node no lo trae). El módulo chequea `typeof window`.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
});

const KEY = "massdte:lote-pendiente:emp1";

describe("lote-persist — reanudación segura del lote", () => {
  it("guarda y devuelve los IDs que faltan (nunca PII)", () => {
    guardarLotePendiente("emp1", { remainingIds: ["p2", "p3"], total: 3 });
    const p = leerLotePendiente("emp1");
    expect(p?.remainingIds).toEqual(["p2", "p3"]);
    expect(p?.total).toBe(3);
    // Sanidad de privacidad: lo persistido son solo IDs, sin receptor/RUT/nombre.
    const raw = store.get(KEY)!;
    expect(raw).not.toMatch(/receptor|rut|nombre|email|telefono/i);
  });

  it("guardar con lista VACÍA limpia (no deja lote fantasma)", () => {
    guardarLotePendiente("emp1", { remainingIds: ["p1"], total: 2 });
    guardarLotePendiente("emp1", { remainingIds: [], total: 2 });
    expect(leerLotePendiente("emp1")).toBeNull();
  });

  it("NO devuelve un lote caducado (>24h)", () => {
    store.set(KEY, JSON.stringify({ remainingIds: ["p1"], total: 2, at: Date.now() - 25 * 60 * 60 * 1000 }));
    expect(leerLotePendiente("emp1")).toBeNull();
  });

  it("descarta datos corruptos sin lanzar", () => {
    store.set(KEY, "no es json {{{");
    expect(leerLotePendiente("emp1")).toBeNull();
    store.set(KEY, JSON.stringify({ total: 2 })); // sin remainingIds
    expect(leerLotePendiente("emp1")).toBeNull();
    store.set(KEY, JSON.stringify({ remainingIds: [1, 2], total: 2, at: Date.now() })); // IDs no-string
    expect(leerLotePendiente("emp1")).toBeNull();
  });

  it("limpiar borra el pendiente", () => {
    guardarLotePendiente("emp1", { remainingIds: ["p1"], total: 1 });
    limpiarLotePendiente("emp1");
    expect(leerLotePendiente("emp1")).toBeNull();
  });

  it("aísla por empresa", () => {
    guardarLotePendiente("emp1", { remainingIds: ["p1", "p2"], total: 2 });
    expect(leerLotePendiente("emp2")).toBeNull();
    expect(leerLotePendiente("emp1")).not.toBeNull();
  });
});
