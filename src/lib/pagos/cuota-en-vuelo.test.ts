import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Carrera de cuota compartida (Team Business fase 2, 2026-09-06). El candado
 * de emisión ya es por cuenta, pero expira a los 15 min y la boleta real se
 * inserta DESPUÉS de pasar el gate: dos personas de la misma cuenta pasaban
 * el chequeo con el mismo último cupo. Este censo sostiene que el cupo
 * descuenta lo que está en vuelo y que el trial cuenta la cuenta entera.
 */
const SRC = "src/lib/pagos/metering.ts";

describe("estadoCuota descuenta las masivas en vuelo", () => {
  const src = readFileSync(SRC, "utf8");
  const fn = src.slice(src.indexOf("async function contarEnVuelo"), src.indexOf("export interface EstadoCuota"));

  it("cuenta jobs vivos CON propuesta (los que consumen cupo), con 30 min de gracia tras expirar", () => {
    expect(fn).toMatch(/\.not\("propuesta_id", "is", null\)/);
    expect(fn).toMatch(/\.in\("estado", \["created", "running"\]\)/);
    expect(fn).toMatch(/30 \* 60 \* 1000/);
    expect(fn).toMatch(/\.gt\("expires_at", gracia\)/);
  });

  it("el disponible del plan Y del trial restan lo en vuelo", () => {
    expect(src).toMatch(/disponible: Math\.max\(0, cuota \+ refills - usoMes - enVuelo\)/);
    expect(src).toMatch(/Math\.max\(0, trialMax - boletasUsadas - enVuelo\)/);
  });

  it("el trial cuenta la CUENTA entera, no una empresa (N empresas ≠ N cupos)", () => {
    const trial = src.slice(src.indexOf("const boletasUsadas = inicio"), src.indexOf("const vigencia ="));
    expect(trial).toMatch(/contarMasivas\(sb, empresaIds, inicio\)/);
    expect(trial).not.toMatch(/\[empresaId\]/);
  });

  it("el conteo en vuelo corre en paralelo con el uso del mes (no encarece el gate en serie)", () => {
    expect(src).toMatch(/const \[suscripcionRes, usoMes, enVuelo\] = await Promise\.all\(/);
  });
});
