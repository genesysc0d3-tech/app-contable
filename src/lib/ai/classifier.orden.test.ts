import { describe, expect, it } from "vitest";
import { classifyWithRules, ordenarReglas, type ClasificacionRegla } from "./classifier";
import type { MovimientoExtraido } from "./types";

// Orden determinista de reglas (plan cirujano, Fase 2): antes el orden de los
// empates de `prioridad` lo decidía Postgres (sin ORDER BY de desempate) y dos
// corridas de la misma cartola podían clasificar distinto.
function mov(descripcion: string): MovimientoExtraido {
  return { fecha: "2026-10-01", descripcion, monto: 50000, tipo_flujo: "entrada", origen: "otro" };
}
function regla(p: Partial<ClasificacionRegla>): ClasificacionRegla {
  return {
    id: "r", empresa_id: null, nombre: "regla", patron: "juan", patron_tipo: "contains",
    tipo_flujo_match: null, tipo_propuesto: "boleta", receptor_nombre_default: null,
    receptor_rut_default: null, confianza: 0.9, prioridad: 50, tipo_dte: null,
    created_at: "2026-01-01T00:00:00Z", ...p,
  };
}
function ganadora(reglas: ClasificacionRegla[], glosa = "TRANSF DE JUAN PEREZ"): string | null {
  return classifyWithRules([mov(glosa)], reglas).clasificados[0]?.regla_id ?? null;
}

describe("orden determinista de reglas — A,B y B,A gana la misma", () => {
  const casos: Array<[string, ClasificacionRegla, ClasificacionRegla, string]> = [
    ["usuario antes que global (aunque la global tenga menor prioridad)",
      regla({ id: "global", empresa_id: null, prioridad: 10 }),
      regla({ id: "usuario", empresa_id: "emp-1", prioridad: 50 }), "usuario"],
    ["prioridad ascendente",
      regla({ id: "p80", prioridad: 80 }), regla({ id: "p50", prioridad: 50 }), "p50"],
    ["empate de prioridad → patrón más largo (más específico)",
      regla({ id: "corto", patron: "juan" }), regla({ id: "largo", patron: "juan perez" }), "largo"],
    ["empate de largo → la más antigua",
      regla({ id: "nueva", patron: "juan", created_at: "2026-09-01T00:00:00Z" }),
      regla({ id: "vieja", patron: "pere", created_at: "2026-02-01T00:00:00Z" }), "vieja"],
    ["empate total → id",
      regla({ id: "b-id", patron: "juan" }), regla({ id: "a-id", patron: "pere" }), "a-id"],
  ];
  for (const [nombre, a, b, esperada] of casos) {
    it(nombre, () => {
      expect(ganadora([a, b])).toBe(esperada);
      expect(ganadora([b, a])).toBe(esperada);
    });
  }

  it("ordenarReglas no muta la entrada", () => {
    const entrada = [regla({ id: "p80", prioridad: 80 }), regla({ id: "p50", prioridad: 50 })];
    const copia = entrada.map((r) => r.id);
    expect(ordenarReglas(entrada).map((r) => r.id)).toEqual(["p50", "p80"]);
    expect(entrada.map((r) => r.id)).toEqual(copia);
  });
});
