import { describe, expect, it } from "vitest";
import { classifyWithRules, ruleMatches } from "./classifier";

// Denylist de no-ventas (migración 20260902180000_denylist_no_venta.sql):
// patrones espejo 1:1 — si la migración cambia, esto debe cambiar.
const REGLAS_DENYLIST = [
  { nombre: "Sobregiro / línea de crédito (no es venta)", patron: "\\b(sobregiro|l[ií]nea\\s+(de\\s+)?(sobregiro|cr[eé]dito))\\b", tipo_flujo_match: "entrada", tipo_propuesto: "no_comercial", prioridad: 110 },
  { nombre: "Avance / préstamo del banco (no es venta)", patron: "\\b(avance\\s+en\\s+efectivo|desembolso\\s+(de\\s+)?cr[eé]dito|cr[eé]dito\\s+cursado)\\b", tipo_flujo_match: "entrada", tipo_propuesto: "no_comercial", prioridad: 111 },
].map((r, i) => ({
  id: `d-${i}`, empresa_id: null, patron_tipo: "regex", confianza: 0.9, activa: true,
  tipo_dte: null, receptor_nombre_default: null, receptor_rut_default: null,
  veces_aplicada: 0, created_by: null, last_used_at: null, created_at: "", ...r,
})) as never[];
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
  // Sufijo societario ⇒ el guard degrada la boleta P2P a FACTURA (auditoría
  // cerebro 2026-09-02: 26 transferencias de una SpA propuestas como boleta).
  ["TRANSFERENCIA DE EMPRESA SINTETICA SPA", "entrada", "factura"],
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

describe("denylist de no-ventas + guard societario (auditoría cerebro 2026-09-02)", () => {
  const TODAS = [...REGLAS_DENYLIST, ...REGLAS_TRANSFERENCIA] as never[];

  it("el sobregiro NO nace boleta: gana la denylist (prioridad 110 < 115)", () => {
    const r = classifyWithRules([mov("Transferencia Desde Linea Sobregiro a Cta Cte", "entrada")], TODAS);
    expect(r.clasificados[0].propuesta.tipo_propuesto).toBe("no_comercial");
  });

  it("línea de crédito y avance en efectivo tampoco son ventas", () => {
    for (const glosa of ["ABONO LINEA DE CREDITO", "AVANCE EN EFECTIVO TARJETA"]) {
      const r = classifyWithRules([mov(glosa, "entrada")], TODAS);
      expect(r.clasificados[0].propuesta.tipo_propuesto).toBe("no_comercial");
    }
  });

  it("transferencia de una SpA/Ltda/EIRL → FACTURA pendiente (jamás boleta), confianza ≤ 0.75", () => {
    for (const glosa of [
      "Transferencia recibida de M & E SpA",
      "TRANSFERENCIA DE COMERCIAL SINTETICA LTDA",
      "Transferencia recibida de NEGOCIO SINTETICO EIRL",
      "TRANSF DE INVERSIONES SINTETICAS S.A.",
    ]) {
      const r = classifyWithRules([mov(glosa, "entrada")], TODAS);
      expect(r.clasificados[0].propuesta.tipo_propuesto).toBe("factura");
      expect(r.clasificados[0].propuesta.confianza).toBeLessThanOrEqual(0.75);
    }
  });

  it("una persona natural sigue siendo boleta P2P (el guard no muerde apellidos)", () => {
    for (const glosa of [
      "Transferencia recibida de MARIA SINTETICA SALAZAR",
      "TRANSFER DE JUAN SALAS PEREZ",
    ]) {
      const r = classifyWithRules([mov(glosa, "entrada")], TODAS);
      expect(r.clasificados[0].propuesta.tipo_propuesto).toBe("transferencia_p2p");
    }
  });

  it("la regla de USUARIO no se degrada: su juicio manda aunque sea una SpA", () => {
    const reglaUsuario = {
      id: "u-1", empresa_id: "emp-1", nombre: "Mi cliente frecuente",
      patron: "EMPRESA FRECUENTE SPA", patron_tipo: "contains",
      tipo_propuesto: "exenta", tipo_flujo_match: "entrada",
      confianza: 0.95, prioridad: 50, activa: true, tipo_dte: 41,
      receptor_nombre_default: null, receptor_rut_default: null,
      veces_aplicada: 0, created_by: null, last_used_at: null, created_at: "",
    } as never;
    const r = classifyWithRules([mov("TRANSFERENCIA DE EMPRESA FRECUENTE SPA", "entrada")], [reglaUsuario, ...TODAS] as never[]);
    expect(r.clasificados[0].propuesta.tipo_propuesto).toBe("exenta");
    expect(r.clasificados[0].fuente).toBe("regla_usuario");
  });

  it("receptor extraído de las glosas reales (0/160 en la auditoría por el regex viejo)", () => {
    const r = classifyWithRules([mov("Transferencia recibida de YENNY SINTETICA LONCOPAN", "entrada")], TODAS);
    expect(r.clasificados[0].propuesta.receptor_nombre).toBe("YENNY SINTETICA LONCOPAN");
  });
});
