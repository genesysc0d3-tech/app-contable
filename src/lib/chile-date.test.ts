import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  chileDateString,
  chileDayOfMonth,
  chileDayStartUtc,
} from "./chile-date";

// Vercel corre en UTC y Chile es UTC-4 (invierno) / UTC-3 (verano). Estos tests
// usan instantes absolutos (sufijo Z) para ser deterministas sin importar la
// zona horaria del runner.

describe("chileDateString — día calendario en hora de Chile", () => {
  it("formatea un instante absoluto como YYYY-MM-DD en America/Santiago", () => {
    // 05:00Z del 14-jun ya es 01:00 en Chile (UTC-4) → mismo día
    expect(chileDateString(new Date("2026-06-14T05:00:00Z"))).toBe("2026-06-14");
  });

  it("cruza el borde de medianoche: 02:00Z sigue siendo el día anterior en Chile", () => {
    // 02:00Z del 14-jun → 22:00 del 13-jun en Chile (UTC-4)
    expect(chileDateString(new Date("2026-06-14T02:00:00Z"))).toBe("2026-06-13");
  });

  it("verano chileno (UTC-3): 02:00Z del 15-ene sigue siendo 14-ene en Chile", () => {
    // 02:00Z del 15-ene → 23:00 del 14-ene en Chile (UTC-3)
    expect(chileDateString(new Date("2026-01-15T02:00:00Z"))).toBe("2026-01-14");
  });
});

describe("chileDayStartUtc — inicio del día de Chile expresado en UTC", () => {
  it("invierno (UTC-4): la medianoche de Chile son las 04:00 UTC", () => {
    expect(chileDayStartUtc("2026-06-14")).toBe("2026-06-14T04:00:00.000Z");
  });

  it("verano (UTC-3): la medianoche de Chile son las 03:00 UTC", () => {
    expect(chileDayStartUtc("2026-01-15")).toBe("2026-01-15T03:00:00.000Z");
  });

  it("acepta un Date y usa su día EN CHILE, no el día UTC", () => {
    // 02:00Z del 14-jun cae el 13-jun en Chile → toma el inicio del 13
    expect(chileDayStartUtc(new Date("2026-06-14T02:00:00Z"))).toBe(
      "2026-06-13T04:00:00.000Z",
    );
  });

  it("el inicio va 3-4 h por delante de la medianoche UTC pelada (corrige el offset)", () => {
    const start = chileDayStartUtc("2026-06-14");
    expect(new Date(start).getTime()).toBeGreaterThan(
      new Date("2026-06-14T00:00:00Z").getTime(),
    );
  });
});

describe("addDaysIso — aritmética de calendario sin zona horaria", () => {
  it("suma días dentro del mes", () => {
    expect(addDaysIso("2026-06-14", 1)).toBe("2026-06-15");
    expect(addDaysIso("2026-06-14", 10)).toBe("2026-06-24");
  });

  it("rueda al mes y al año siguientes", () => {
    expect(addDaysIso("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("resta días cruzando hacia atrás de mes", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("respeta años bisiestos", () => {
    expect(addDaysIso("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysIso("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("sumar 0 es identidad", () => {
    expect(addDaysIso("2026-06-14", 0)).toBe("2026-06-14");
  });
});

describe("chileDayOfMonth — día del mes (1-31) en hora de Chile", () => {
  it("devuelve el día de Chile de un instante", () => {
    expect(chileDayOfMonth(new Date("2026-06-14T05:00:00Z"))).toBe(14);
  });

  it("cruza el borde: 02:00Z del 14-jun es día 13 en Chile", () => {
    expect(chileDayOfMonth(new Date("2026-06-14T02:00:00Z"))).toBe(13);
  });
});
