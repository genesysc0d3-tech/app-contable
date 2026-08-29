/**
 * CANCELAR NO PUEDE COSTAR UN COBRO MÁS.
 *
 * La página prometía «cancela cuando quieras» sin tener botón. Ahora lo tiene,
 * y con eso aparece un riesgo nuevo que antes no existía: que el cron cobre la
 * renovación y recién después cierre la suscripción. Sería exactamente lo que
 * la gente teme de las suscripciones, y con la tarjeta ya inscrita en Flow el
 * cobro es inmediato y sin confirmación — no hay dónde arrepentirse.
 *
 * Estos tests miran el ORDEN del código, no su resultado, porque el orden es la
 * garantía: el corte tiene que estar antes del cobro.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cron = readFileSync("src/app/api/pagos/cron/route.ts", "utf8");
const accion = readFileSync("src/app/(paywall)/planes/cancelar.ts", "utf8");

describe("el cron respeta la cancelación", () => {
  it("corta ANTES de calcular o cobrar nada", () => {
    const corte = cron.indexOf("if (s.cancela_al_terminar)");
    const cobro = cron.indexOf("await cobrarCuenta(");
    expect(corte).toBeGreaterThan(0);
    expect(cobro).toBeGreaterThan(0);
    // Si algún día el corte queda después del cobro, se le cobra a alguien que
    // canceló. Este número es la garantía.
    expect(corte).toBeLessThan(cobro);
  });

  it("cierra la suscripción y le apaga el plan a la cuenta", () => {
    expect(cron).toContain('estado: "cancelada"');
    expect(cron).toContain("syncPlanActivo(sb, { cuentaId: s.cuenta_id, empresaId: s.empresa_id }, s.plan_codigo, false)");
  });

  it("lee la marca en la consulta, o nunca se enteraría", () => {
    expect(cron).toMatch(/select\([^)]*cancela_al_terminar/);
  });
});

describe("la cancelación es justa y reversible", () => {
  it("NO corta al instante: el mes pagado se respeta", () => {
    // Se marca la intención; la suscripción sigue 'activa' hasta su fecha.
    expect(accion).toContain("cancela_al_terminar: cancelar");
    expect(accion).not.toMatch(/estado:\s*"cancelada"/);
  });

  it("se puede deshacer", () => {
    expect(accion).toContain("export async function deshacerCancelacion");
  });

  it("solo puede cancelar quien paga", () => {
    expect(accion).toContain("Solo quien paga la cuenta puede cancelar el plan.");
    expect(accion).toContain("es_titular");
  });

  it("queda registrado quién canceló y cuándo", () => {
    expect(accion).toContain("suscripcion_cancelada_por_cliente");
  });
});

describe("la página ya no promete lo que no tiene", () => {
  const pagina = readFileSync("src/app/(paywall)/planes/page.tsx", "utf8");

  it("muestra el botón cuando hay suscripción activa", () => {
    expect(pagina).toContain("<CancelarPlan");
  });

  it("y dejó de mandar a soporte para algo que ya se puede hacer solo", () => {
    expect(pagina).not.toMatch(/para cancelar, escríbenos/);
  });
});
