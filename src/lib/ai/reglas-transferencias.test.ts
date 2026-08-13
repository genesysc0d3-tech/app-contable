import { describe, expect, it } from "vitest";
import { classifyWithRules, ruleMatches } from "./classifier";
import type { MovimientoExtraido } from "./types";

// Reglas de transferencias (migración 20260814*_reglas_transferencias.sql).
// Validadas contra las 675 glosas reales de la Cartola N°02: 100% cobertura,
// 99,3% acuerdo con la clasificación IA (las divergencias favorecían a la
// regla: la IA fue inconsistente con textos idénticos). Historia: la versión
// original de estas reglas (PR #54) se aplicó a mano y se perdió — por eso
// este test fija patrón por patrón: si la migración cambia, esto debe cambiar.
const REGLAS_TRANSFERENCIA = [
  { nombre: "Transferencia recibida (P2P)", patron: "\\btransf(er(encia)?)?\\.?\\s+(de|desde|recibida)\\b", tipo_flujo_match: "entrada", tipo_propuesto: "transferencia_p2p", prioridad: 115 },
  { nombre: "Abono por transferencia", patron: "\\babono\\s+(por\\s+tra?n?s?f|tercero)", tipo_flujo_match: "entrada", tipo_propuesto: "transferencia_p2p", prioridad: 116 },
  { nombre: "Transferencia enviada", patron: "\\btransf(er(encia)?)?\\.?\\s+(a|hacia|enviada)\\b", tipo_flujo_match: "salida", tipo_propuesto: "gasto_egreso", prioridad: 117 },
  { nombre: "Cargo por transferencia", patron: "\\bcargo\\s+por\\s+tra?n?s?f", tipo_flujo_match: "salida", tipo_propuesto: "gasto_egreso", prioridad: 118 },
].map((r, i) => ({
  id: `t-${i}`, empresa_id: null, patron_tipo: "regex", confianza: 0.8, activa: true,
  tipo_dte: null, receptor_nombre_default: null, receptor_rut_default: null,
  veces_aplicada: 0, created_by: null, last_used_at: null, created_at: "", ...r,
})) as never[];

// Regla específica existente (Boleta Honorarios, prioridad 91 < 115): debe
// seguir ganándole a las genéricas de transferencia.
const REGLA_HONORARIOS = {
  id: "h-1", empresa_id: null, nombre: "Boleta Honorarios",
  patron: "\\b(honorarios?|servicios?\\s+profesionales?)", patron_tipo: "regex",
  tipo_propuesto: "boleta_honorarios", tipo_flujo_match: "entrada",
  confianza: 0.9, prioridad: 91, activa: true, tipo_dte: null,
  receptor_nombre_default: null, receptor_rut_default: null,
  veces_aplicada: 0, created_by: null, last_used_at: null, created_at: "",
} as never;

function mov(descripcion: string, tipo_flujo: "entrada" | "salida"): MovimientoExtraido {
  return { fecha: "2026-08-13", descripcion, monto: 10000, tipo_flujo, origen: "cartola" };
}

// Los 8 patrones sintéticos que replican las glosas reales de bancos chilenos.
const CASOS: [string, "entrada" | "salida", string][] = [
  ["ABONO POR TRF DESDE OTRO BANCO EN LINEA", "entrada", "transferencia_p2p"],
  ["ABONO TERCEROS 11111111-1 J.EJEMPLO SINTETICO", "entrada", "transferencia_p2p"],
  ["TRANSFER DE PERSONA SINTETICA", "entrada", "transferencia_p2p"],
  ["TRANSFERENCIA DE EMPRESA SINTETICA SPA", "entrada", "transferencia_p2p"],
  ["Transferencia recibida de: Cliente Sintetico", "entrada", "transferencia_p2p"],
  ["CARGO POR TRANSF DE FONDOS AUTOSERVICIO", "salida", "gasto_egreso"],
  ["TRANSFER A PROVEEDOR SINTETICO SP", "salida", "gasto_egreso"],
  ["Transferencia enviada a Proveedor Sintetico", "salida", "gasto_egreso"],
];

describe("reglas de transferencias — cobertura de los patrones bancarios", () => {
  it.each(CASOS)("%s [%s] → %s", (desc, flujo, esperado) => {
    const r = classifyWithRules([mov(desc, flujo)], REGLAS_TRANSFERENCIA);
    expect(r.noClasificados).toHaveLength(0);
    expect(r.clasificados[0].propuesta.tipo_propuesto).toBe(esperado);
    expect(r.clasificados[0].fuente).toBe("regla_global");
  });

  it("nunca nacen listas: confianza 0.80 < umbral de auto-stage 0.85 (juicio SIEMPRE humano)", () => {
    const r = classifyWithRules([mov("TRANSFER DE ALGUIEN SINTETICO", "entrada")], REGLAS_TRANSFERENCIA);
    expect(r.clasificados[0].propuesta.confianza).toBeLessThan(0.85);
    // Globales jamás recuerdan tipo_dte (eso es de las reglas de usuario).
    expect(r.clasificados[0].tipo_dte).toBeNull();
  });

  it("la dirección del flujo es sagrada: una salida jamás cae en la regla de entrada", () => {
    const r = classifyWithRules([mov("TRANSFER DE FONDOS PROPIOS", "salida")], REGLAS_TRANSFERENCIA);
    // "TRANSFER DE" pero salida: la regla 1 (entrada) no aplica; ninguna otra matchea "de".
    expect(r.clasificados.every((c) => c.propuesta.tipo_propuesto !== "transferencia_p2p")).toBe(true);
  });

  it("las reglas específicas siguen ganando (prioridad ascendente)", () => {
    const todas = [REGLA_HONORARIOS, ...REGLAS_TRANSFERENCIA].sort(
      (a, b) => (a as { prioridad: number }).prioridad - (b as { prioridad: number }).prioridad,
    ) as never[];
    // Glosa que matchea AMBAS: honorarios (91) debe ganarle a transferencia (115).
    const r = classifyWithRules([mov("TRANSFERENCIA DE HONORARIOS PROFESIONALES", "entrada")], todas);
    expect(r.clasificados[0].propuesta.tipo_propuesto).toBe("boleta_honorarios");
  });

  it("no matchea texto sin transferencia (va a la IA como corresponde)", () => {
    const r = classifyWithRules([mov("COMPRA SUPERMERCADO SINTETICO", "salida")], REGLAS_TRANSFERENCIA);
    expect(r.clasificados).toHaveLength(0);
    expect(r.noClasificados).toHaveLength(1);
  });

  it("los patrones del test y de la MIGRACIÓN son idénticos (sync 1:1)", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync(
      new URL("../../../supabase/migrations/20260814000000_reglas_transferencias.sql", import.meta.url),
      "utf8",
    );
    for (const regla of REGLAS_TRANSFERENCIA as { patron: string }[]) {
      // El SQL guarda el patrón tal cual (standard_conforming_strings): debe
      // aparecer literal en el archivo. Si la migración cambia, esto revienta.
      expect(sql).toContain(`'${regla.patron.replaceAll("\\", "\\")}'`);
    }
  });

  it("los patrones regex compilan (un regex roto = regla muda silenciosa)", () => {
    for (const regla of REGLAS_TRANSFERENCIA as { patron: string }[]) {
      expect(() => new RegExp(regla.patron, "i")).not.toThrow();
      // Y ruleMatches no lanza con glosa vacía / rara
      expect(ruleMatches(mov("", "entrada"), regla as never)).toBe(false);
    }
  });
});
