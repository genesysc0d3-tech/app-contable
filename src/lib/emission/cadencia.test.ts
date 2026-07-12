import { describe, it, expect } from "vitest";
import { nextDelayMs, estimateWaitMs, CADENCIA_DEFAULT, type CadenciaConfig } from "./cadencia";

// rand determinista: devuelve en orden los valores dados y luego repite el último.
// nextDelayMs consume DOS tiradas (tirada de pausa larga + magnitud).
function randSeq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const CFG: CadenciaConfig = {
  baseMs: 2_000,
  jitterMs: 4_000,
  longPauseChance: 0.1,
  longPauseMinMs: 10_000,
  longPauseMaxMs: 30_000,
  sessionCap: 20,
};

describe("nextDelayMs — espera normal (sin pausa larga)", () => {
  it("piso exacto: tirada sobre el umbral, magnitud 0 → baseMs", () => {
    // tirada 0.5 (≥ 0.1, no hay pausa larga), magnitud 0 → base
    expect(nextDelayMs(CFG, randSeq(0.5, 0))).toBe(2_000);
  });

  it("techo normal: magnitud 1 → base + jitter", () => {
    expect(nextDelayMs(CFG, randSeq(0.5, 1))).toBe(6_000);
  });

  it("punto medio: magnitud 0.5 → base + jitter/2", () => {
    expect(nextDelayMs(CFG, randSeq(0.9, 0.5))).toBe(4_000);
  });

  it("la espera normal SIEMPRE cae en [base, base+jitter]", () => {
    for (let m = 0; m <= 1; m += 0.05) {
      const d = nextDelayMs(CFG, randSeq(0.99, m));
      expect(d).toBeGreaterThanOrEqual(CFG.baseMs);
      expect(d).toBeLessThanOrEqual(CFG.baseMs + CFG.jitterMs);
    }
  });
});

describe("nextDelayMs — pausa larga", () => {
  it("tirada bajo el umbral → cae en el rango de pausa larga", () => {
    // tirada 0.05 (< 0.1) → pausa larga; magnitud 0 → mínimo
    expect(nextDelayMs(CFG, randSeq(0.05, 0))).toBe(10_000);
    // magnitud 1 → máximo
    expect(nextDelayMs(CFG, randSeq(0.05, 1))).toBe(30_000);
    // magnitud 0.5 → medio
    expect(nextDelayMs(CFG, randSeq(0.09, 0.5))).toBe(20_000);
  });

  it("una pausa larga NUNCA es más corta que una espera normal máxima del perfil default", () => {
    // Con el default, longPauseMin (12s) > base+jitter (6s): la pausa larga se distingue.
    expect(CADENCIA_DEFAULT.longPauseMinMs).toBeGreaterThan(CADENCIA_DEFAULT.baseMs + CADENCIA_DEFAULT.jitterMs);
  });
});

describe("nextDelayMs — jitter real (no determinista) rompe el patrón de reloj", () => {
  it("100 esperas normales consecutivas dan valores variados (no un intervalo fijo)", () => {
    const vistos = new Set<number>();
    for (let k = 0; k < 100; k++) vistos.add(nextDelayMs(CADENCIA_DEFAULT));
    // Un bot de reloj daría 1 solo valor; exigimos dispersión amplia.
    expect(vistos.size).toBeGreaterThan(50);
  });

  it("todo valor del default está en un rango humano razonable (2,5 s – 45 s)", () => {
    for (let k = 0; k < 500; k++) {
      const d = nextDelayMs(CADENCIA_DEFAULT);
      expect(d).toBeGreaterThanOrEqual(CADENCIA_DEFAULT.baseMs);
      expect(d).toBeLessThanOrEqual(CADENCIA_DEFAULT.longPauseMaxMs);
    }
  });
});

describe("estimateWaitMs — hint de duración", () => {
  it("0 o 1 boleta → sin esperas", () => {
    expect(estimateWaitMs(0, CFG).expectedMs).toBe(0);
    expect(estimateWaitMs(1, CFG).expectedMs).toBe(0);
  });

  it("n boletas → n-1 huecos; el esperado cae entre min y max", () => {
    const e = estimateWaitMs(10, CFG);
    expect(e.minMs).toBe(9 * CFG.baseMs);
    expect(e.maxMs).toBe(9 * CFG.longPauseMaxMs);
    expect(e.expectedMs).toBeGreaterThan(e.minMs);
    expect(e.expectedMs).toBeLessThan(e.maxMs);
  });

  it("el esperado crece monótono con n", () => {
    expect(estimateWaitMs(20, CFG).expectedMs).toBeGreaterThan(estimateWaitMs(10, CFG).expectedMs);
  });
});
