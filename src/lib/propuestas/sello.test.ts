import { describe, expect, it } from "vitest";
import { canalDeOrigen, CANALES_DECISION, sello } from "./sello";

describe("sello de decisión", () => {
  it("arma las 6 columnas decision_* con un lote nuevo por gesto", () => {
    const a = sello("check_lote", { usuarioId: "U1", loteN: 300 });
    const b = sello("check_lote", { usuarioId: "U1", loteN: 300 });
    expect(a).toMatchObject({ decision_canal: "check_lote", decision_por: "U1", decision_lote_n: 300, decision_abierta: false, decision_soporte: null });
    expect(a.decision_lote).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.decision_lote).not.toBe(b.decision_lote);
  });
  it("respeta el lote compartido entre trozos del mismo gesto", () => {
    expect(sello("aprobar_cartola", { usuarioId: "U1", loteN: 120, lote: "L" }).decision_lote).toBe("L");
  });
  it("abierta por defecto: detalle=true, lote/fila/propagación=false, canales externos=null", () => {
    expect(sello("check_detalle", { usuarioId: null, loteN: 1 }).decision_abierta).toBe(true);
    expect(sello("check_fila", { usuarioId: null, loteN: 1 }).decision_abierta).toBe(false);
    expect(sello("propagacion", { usuarioId: null, loteN: 3 }).decision_abierta).toBe(false);
    expect(sello("mcp", { usuarioId: null, loteN: 3 }).decision_abierta).toBeNull();
    expect(sello("telegram", { usuarioId: null, loteN: 1 }).decision_abierta).toBeNull();
  });
  it("lote_n nunca baja de 1 (CHECK decision_lote_n > 0)", () => {
    expect(sello("sistema", { usuarioId: null, loteN: 0 }).decision_lote_n).toBe(1);
  });
  it("un canal fuera de la lista cerrada revienta", () => {
    expect(() => sello("inventado" as never, { usuarioId: null, loteN: 1 })).toThrow();
    expect(CANALES_DECISION).not.toContain("sin_sello"); // ese lo pone SOLO el trigger
  });
});

describe("canalDeOrigen — el origen que manda el navegador se valida", () => {
  it("acepta solo check_fila/check_detalle/check_lote", () => {
    expect(canalDeOrigen("check_detalle", 1)).toBe("check_detalle");
    expect(canalDeOrigen("check_lote", 1)).toBe("check_lote");
  });
  it("fuera de lista (o un canal que el navegador no puede reclamar) → se deduce por cantidad", () => {
    expect(canalDeOrigen("mcp", 1)).toBe("check_fila");
    expect(canalDeOrigen("aprobar_cartola", 5)).toBe("check_lote");
    expect(canalDeOrigen(undefined, 1)).toBe("check_fila");
    expect(canalDeOrigen({ x: 1 }, 2)).toBe("check_lote");
  });
});
