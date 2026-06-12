import { describe, it, expect } from "vitest";
import {
  periodoActual,
  clpConIva,
  trialVigente,
  chileMonthUtcRange,
  addDaysStr,
  addOneMonth,
} from "./metering";

describe("periodoActual — período mensual en zona Chile", () => {
  it("usa la fecha chilena, no la UTC", () => {
    // Junio = invierno chileno (UTC-4): 03:59Z del 1 de junio aún es 31 de mayo en Chile.
    expect(periodoActual(new Date("2026-06-01T03:59:00Z"))).toBe("2026-05");
    expect(periodoActual(new Date("2026-06-01T04:00:00Z"))).toBe("2026-06");
  });

  it("respeta el horario de verano (UTC-3)", () => {
    // Enero = verano chileno: la medianoche del 1 es a las 03:00Z.
    expect(periodoActual(new Date("2026-01-01T02:59:00Z"))).toBe("2025-12");
    expect(periodoActual(new Date("2026-01-01T03:00:00Z"))).toBe("2026-01");
  });

  it("caso normal a mitad de mes", () => {
    expect(periodoActual(new Date("2026-06-15T15:00:00Z"))).toBe("2026-06");
  });
});

describe("clpConIva — monto CLP total desde UF", () => {
  it("aplica IVA 19% y redondea a peso", () => {
    expect(clpConIva(1, 100)).toBe(119);
    expect(clpConIva(2, 39_000)).toBe(92_820);
  });

  it("redondea al peso más cercano con decimales de UF", () => {
    // 0.85 UF * $38.500 = $32.725 neto → $38.942,75 con IVA → $38.943
    expect(clpConIva(0.85, 38_500)).toBe(38_943);
  });
});

describe("trialVigente — ventana del período de prueba (pura, fechas inyectadas)", () => {
  const dias = 3;
  const max = 100;

  it("sin inicio: el trial aún no parte y se considera vigente completo", () => {
    const r = trialVigente(null, new Date("2026-06-12T12:00:00Z"), dias, 0, max);
    expect(r.activo).toBe(true);
    expect(r.diasRestantes).toBe(dias);
  });

  it("dentro de la ventana y bajo el cupo: activo", () => {
    const inicio = "2026-06-10T12:00:00Z";
    const r = trialVigente(inicio, new Date("2026-06-11T12:00:00Z"), dias, 40, max);
    expect(r.activo).toBe(true);
    expect(r.diasRestantes).toBe(2);
  });

  it("ventana expirada: inactivo con 0 días restantes", () => {
    const inicio = "2026-06-01T12:00:00Z";
    const r = trialVigente(inicio, new Date("2026-06-10T12:00:00Z"), dias, 0, max);
    expect(r.activo).toBe(false);
    expect(r.diasRestantes).toBe(0);
  });

  it("límite exacto del plazo: ya no está activo", () => {
    const inicio = "2026-06-09T12:00:00Z";
    const r = trialVigente(inicio, new Date("2026-06-12T12:00:00Z"), dias, 0, max);
    expect(r.activo).toBe(false);
  });

  it("cupo de boletas agotado dentro de la ventana: inactivo", () => {
    const inicio = "2026-06-12T00:00:00Z";
    const r = trialVigente(inicio, new Date("2026-06-12T06:00:00Z"), dias, max, max);
    expect(r.activo).toBe(false);
    expect(r.diasRestantes).toBeGreaterThan(0);
  });

  it("una boleta antes del cupo: sigue activo", () => {
    const inicio = "2026-06-12T00:00:00Z";
    const r = trialVigente(inicio, new Date("2026-06-12T06:00:00Z"), dias, max - 1, max);
    expect(r.activo).toBe(true);
  });

  it("inicio malformado: inactivo (no regala cupo)", () => {
    const r = trialVigente("no-es-fecha", new Date(), dias, 0, max);
    expect(r.activo).toBe(false);
  });
});

describe("chileMonthUtcRange — mes calendario chileno en instantes UTC", () => {
  it("invierno (UTC-4): la medianoche del 1 de junio es 04:00Z", () => {
    const r = chileMonthUtcRange("2026-06");
    expect(r.desde).toBe("2026-06-01T04:00:00.000Z");
    expect(r.hasta).toBe("2026-07-01T04:00:00.000Z");
  });

  it("verano (UTC-3): la medianoche del 1 de enero es 03:00Z", () => {
    const r = chileMonthUtcRange("2026-01");
    expect(r.desde).toBe("2026-01-01T03:00:00.000Z");
  });

  it("diciembre cruza al año siguiente", () => {
    const r = chileMonthUtcRange("2026-12");
    expect(r.hasta.startsWith("2027-01-01")).toBe(true);
  });
});

describe("helpers de fecha calendario", () => {
  it("addDaysStr resta y suma cruzando meses y años", () => {
    expect(addDaysStr("2026-06-12", -5)).toBe("2026-06-07");
    expect(addDaysStr("2026-03-02", -5)).toBe("2026-02-25");
    expect(addDaysStr("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysStr("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("addOneMonth con clamp de día en meses cortos", () => {
    expect(addOneMonth("2026-01-31")).toBe("2026-02-28");
    expect(addOneMonth("2024-01-31")).toBe("2024-02-29"); // bisiesto
    expect(addOneMonth("2026-12-15")).toBe("2027-01-15");
    expect(addOneMonth("2026-06-12")).toBe("2026-07-12");
  });
});
