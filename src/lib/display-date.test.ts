import { describe, expect, it } from "vitest";
import {
  chileDisplayDateKey,
  chileDisplayMonthKey,
  formatDisplayDateEsCl,
  formatShortDateEsCl,
  parseDisplayDate,
} from "./display-date";

// Las aserciones de formato usan timestamps con zona (sufijo Z) para fijar un
// instante absoluto; así el día/mes en Chile es determinista sin importar la
// zona horaria del runner.

describe("parseDisplayDate — string → Date | null", () => {
  it("null / undefined / vacío / espacios → null", () => {
    expect(parseDisplayDate(null)).toBeNull();
    expect(parseDisplayDate(undefined)).toBeNull();
    expect(parseDisplayDate("")).toBeNull();
    expect(parseDisplayDate("   ")).toBeNull();
  });

  it("basura no parseable → null", () => {
    expect(parseDisplayDate("no-es-fecha")).toBeNull();
  });

  it("YYYY-MM-DD pelado → Date válido (ancla mediodía para no saltar de día)", () => {
    const d = parseDisplayDate("2026-06-14");
    expect(d).toBeInstanceOf(Date);
    expect(Number.isNaN((d as Date).getTime())).toBe(false);
  });

  it("timestamp ISO con zona → instante absoluto exacto", () => {
    const d = parseDisplayDate("2026-06-14T15:00:00Z");
    expect((d as Date).getTime()).toBe(Date.parse("2026-06-14T15:00:00Z"));
  });
});

describe("formatShortDateEsCl — 'D mes' en español, hora de Chile", () => {
  it("formato corto sin año", () => {
    // 15:00Z del 14-jun → 11:00 en Chile (UTC-4) → 14 jun
    expect(formatShortDateEsCl("2026-06-14T15:00:00Z")).toBe("14 jun");
  });

  it("incluye el año cuando se solicita", () => {
    expect(formatShortDateEsCl("2026-06-14T15:00:00Z", true)).toBe("14 jun 2026");
  });

  it("usa hora de Chile: 02:00Z del 14 cae el 13 en Chile", () => {
    expect(formatShortDateEsCl("2026-06-14T02:00:00Z")).toBe("13 jun");
  });

  it("valor vacío → string vacío", () => {
    expect(formatShortDateEsCl(null)).toBe("");
    expect(formatShortDateEsCl("")).toBe("");
  });
});

describe("formatDisplayDateEsCl — Intl es-CL con fallback", () => {
  it("formatea con las opciones dadas en hora de Chile", () => {
    const out = formatDisplayDateEsCl("2026-06-14T15:00:00Z", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    expect(out).toBe("14-06-2026");
  });

  it("mes largo en español", () => {
    const out = formatDisplayDateEsCl("2026-06-14T15:00:00Z", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    expect(out).toBe("14 de junio de 2026");
  });

  it("valor vacío → fallback por defecto", () => {
    expect(formatDisplayDateEsCl(null, { year: "numeric" })).toBe("Sin fecha");
  });

  it("fallback personalizado", () => {
    expect(formatDisplayDateEsCl("", { year: "numeric" }, "—")).toBe("—");
  });
});

describe("chileDisplayDateKey / chileDisplayMonthKey — claves de agrupación", () => {
  it("clave de día YYYY-MM-DD en hora de Chile", () => {
    expect(chileDisplayDateKey("2026-06-14T15:00:00Z")).toBe("2026-06-14");
  });

  it("agrupa por el día de Chile en el borde de medianoche", () => {
    // 02:00Z del 14-jun → 13-jun en Chile → cae en el grupo del 13
    expect(chileDisplayDateKey("2026-06-14T02:00:00Z")).toBe("2026-06-13");
  });

  it("clave de mes YYYY-MM", () => {
    expect(chileDisplayMonthKey("2026-06-14T15:00:00Z")).toBe("2026-06");
  });

  it("sin fecha → 'sin-fecha' en día y en mes", () => {
    expect(chileDisplayDateKey(null)).toBe("sin-fecha");
    expect(chileDisplayMonthKey(null)).toBe("sin-fecha");
  });
});
