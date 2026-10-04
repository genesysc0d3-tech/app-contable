/**
 * Fase 3 — el clasificador respeta el ESTADO de la regla de usuario:
 *  - firme (las existentes): como hoy (tipo estampado, confianza de la regla → "listo").
 *  - a_prueba (nuevas): tipo PRE-estampado pero confianza ≤ 0.8 → nace PENDIENTE (la
 *    clienta la ve en Check; "Poner listas" la toma). Nunca "listo" sola.
 *  - en_disputa: no estampa tipo, confianza ≤ 0.5 (por decidir).
 * Las globales siempre firmes. El uso se suma ATÓMICO en la base (rpc), no leer-y-escribir.
 */
import { describe, expect, it, vi } from "vitest";
import { classifyWithRules, type ClasificacionRegla } from "./classifier";
import { decidirEstadoInicial } from "./tipo-dte-persistido";
import type { MovimientoExtraido } from "./types";

const mov = (d: string): MovimientoExtraido => ({ fecha: "2026-10-01", descripcion: d, monto: 50000, tipo_flujo: "entrada", origen: "otro" });
const regla = (p: Partial<ClasificacionRegla>): ClasificacionRegla => ({
  id: "r1", empresa_id: "E1", nombre: "Contraparte aprendida · Exenta", patron: "(^|[^a-zà-ÿ])juan perez([^a-zà-ÿ]|$)",
  patron_tipo: "regex", tipo_flujo_match: "entrada", tipo_propuesto: "exenta", receptor_nombre_default: null,
  receptor_rut_default: null, confianza: 0.95, prioridad: 50, tipo_dte: 41, ...p,
});

describe("clasificador × estado de la regla", () => {
  it("firme (o sin estado: las existentes) → como hoy: tipo 41 y confianza 0.95", () => {
    for (const estado of ["firme", undefined]) {
      const c = classifyWithRules([mov("TRANSFERENCIA DE JUAN PEREZ")], [regla({ estado })]).clasificados[0];
      expect(c).toMatchObject({ tipo_dte: 41, regla_estado: "firme" });
      expect(c.propuesta.confianza).toBe(0.95);
      expect(decidirEstadoInicial({ confianza: c.propuesta.confianza, reglaId: c.regla_id, tipoPropuesto: "exenta", reglaAPrueba: c.regla_estado === "a_prueba" })).toBe("listo");
    }
  });
  it("a_prueba → tipo pre-estampado, confianza ≤ 0.8 y nace PENDIENTE", () => {
    const c = classifyWithRules([mov("TRANSFERENCIA DE JUAN PEREZ")], [regla({ estado: "a_prueba" })]).clasificados[0];
    expect(c).toMatchObject({ tipo_dte: 41, regla_estado: "a_prueba" });
    expect(c.propuesta.confianza).toBeLessThanOrEqual(0.8);
    expect(decidirEstadoInicial({ confianza: c.propuesta.confianza, reglaId: c.regla_id, tipoPropuesto: "exenta", reglaAPrueba: true })).toBe("pendiente");
  });
  it("decidirEstadoInicial: una regla a prueba nunca nace listo, aunque traiga confianza alta", () => {
    expect(decidirEstadoInicial({ confianza: 0.95, reglaId: "r1", tipoPropuesto: "exenta", reglaAPrueba: true })).toBe("pendiente");
  });
  it("en_disputa → sin tipo y confianza ≤ 0.5", () => {
    const c = classifyWithRules([mov("TRANSFERENCIA DE JUAN PEREZ")], [regla({ estado: "en_disputa" })]).clasificados[0];
    expect(c.tipo_dte).toBeNull();
    expect(c.propuesta.confianza).toBeLessThanOrEqual(0.5);
  });
  it("la señal de marca viaja en el resultado (aprendida_bajo_marca), no en la confianza", () => {
    const c = classifyWithRules([mov("TRANSFERENCIA DE JUAN PEREZ")], [regla({ tipo_dte: 39, tipo_propuesto: "boleta", aprendida_bajo_marca: true })]).clasificados[0];
    expect(c.regla_bajo_marca).toBe(true);
    expect(c.propuesta.confianza).toBe(0.95);
  });
  it("M3: una regla 39 con la confianza 0.99 de la Fase 2 (sin el campo nuevo) sigue confirmada en la marca", () => {
    const c = classifyWithRules([mov("TRANSFERENCIA DE JUAN PEREZ")], [regla({ tipo_dte: 39, tipo_propuesto: "boleta", confianza: 0.99 })]).clasificados[0];
    expect(c.regla_bajo_marca).toBe(true);
    expect(c.propuesta.confianza).toBe(0.99);
  });
  it("una global marcada a_prueba por error igual se trata como firme", () => {
    const c = classifyWithRules([mov("TRANSFERENCIA DE JUAN PEREZ")], [regla({ empresa_id: null, estado: "a_prueba", confianza: 0.9 })]).clasificados[0];
    expect(c.regla_estado).toBe("firme");
    expect(c.propuesta.confianza).toBe(0.9);
  });
  it("deshecha/huérfana no clasifican aunque lleguen activas por error", () => {
    for (const estado of ["deshecha", "huerfana"]) {
      expect(classifyWithRules([mov("TRANSFERENCIA DE JUAN PEREZ")], [regla({ estado })]).clasificados).toHaveLength(0);
    }
  });
});

describe("uso atómico", () => {
  it("incrementRuleUsage manda los ids a la rpc incrementar_uso_reglas (sin leer-y-escribir)", async () => {
    vi.resetModules();
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    const from = vi.fn();
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc, from }) }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    const { incrementRuleUsage } = await import("./classifier");
    await incrementRuleUsage(["a", "a", "b"]);
    expect(rpc).toHaveBeenCalledWith("incrementar_uso_reglas", { p_regla_ids: ["a", "a", "b"] });
    expect(from).not.toHaveBeenCalled();
    vi.doUnmock("@supabase/supabase-js");
  });
});
