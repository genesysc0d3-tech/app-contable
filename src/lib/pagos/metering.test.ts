import { describe, it, expect } from "vitest";
import {
  periodoActual,
  periodoDePago,
  clpConIva,
  trialVigente,
  inicioTrial,
  chileMonthUtcRange,
  addDaysStr,
  addOneMonth,
  decidirGate,
  derechoDeEmision,
  type EstadoCuota,
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

describe("periodoDePago — acredita según fecha real de aprobación (auditoría #22)", () => {
  it("usa date_approved, no el checkout: cruce de mes en zona Chile", () => {
    // 03:59Z del 1-jul aún es 30-jun en Chile (UTC-4) → cae en junio.
    expect(periodoDePago({ date_approved: "2026-07-01T03:59:00Z" })).toBe("2026-06");
    expect(periodoDePago({ date_approved: "2026-07-01T04:00:00Z" })).toBe("2026-07");
  });

  it("cae a date_created si no hay date_approved", () => {
    expect(periodoDePago({ date_created: "2026-06-15T15:00:00Z" })).toBe("2026-06");
  });

  it("sin fechas válidas devuelve un período con formato YYYY-MM", () => {
    expect(periodoDePago({})).toMatch(/^\d{4}-\d{2}$/);
    expect(periodoDePago({ date_approved: "no-es-fecha" })).toMatch(/^\d{4}-\d{2}$/);
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

  // REGLA DEL FUNDADOR (2026-09-04): el reloj parte al ABRIR LA CUENTA, no con
  // la primera emisión. Estos tests muerden si alguien vuelve a atar el inicio
  // del trial al acto de emitir.
  it("inicioTrial: sin override manda la creación de la cuenta", () => {
    expect(inicioTrial({ trial_inicio: null, created_at: "2026-09-01T10:00:00Z" })).toBe("2026-09-01T10:00:00Z");
  });

  it("inicioTrial: el override de soporte gana (cortesía / reinicio)", () => {
    expect(inicioTrial({ trial_inicio: "2026-09-03T00:00:00Z", created_at: "2026-09-01T10:00:00Z" }))
      .toBe("2026-09-03T00:00:00Z");
  });

  it("el reloj corre desde la fecha de creación de la cuenta, haya emitido o no", () => {
    const creada = "2026-09-01T10:00:00Z";
    // Día 2 sin haber emitido NADA: sigue vigente.
    expect(trialVigente(creada, new Date("2026-09-03T09:00:00Z"), dias, 0, max).activo).toBe(true);
    // Día 4 sin haber emitido nada: se venció igual. El trial no espera.
    expect(trialVigente(creada, new Date("2026-09-05T09:00:00Z"), dias, 0, max).activo).toBe(false);
  });

  it("emitir no puede estirar el trial: lo que manda es la fecha de inicio", () => {
    const creada = "2026-09-01T10:00:00Z";
    const alDia4 = new Date("2026-09-05T09:00:00Z");
    // Con o sin consumo, al día 4 está vencido: el reloj es de calendario.
    expect(trialVigente(creada, alDia4, dias, 0, max).activo).toBe(false);
    expect(trialVigente(creada, alDia4, dias, 50, max).activo).toBe(false);
  });

  it("sin inicio: FAIL-CLOSED, no se regala acceso", () => {
    // created_at es NOT NULL: un null acá significa que la fila de empresas no
    // se pudo leer. Antes esto devolvía "vigente completo" y ese booleano hoy
    // abre 10 rutas de API (auditoría adversarial 2026-09-04).
    const r = trialVigente(null, new Date("2026-06-12T12:00:00Z"), dias, 0, max);
    expect(r.activo).toBe(false);
    expect(r.diasRestantes).toBe(0);
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

describe("derechoDeEmision — quién puede emitir (mismas puertas que decidirGate)", () => {
  const base = (over: Partial<EstadoCuota> = {}): EstadoCuota => ({
    plan: null, cuota: 0, refills: 0, uso: 0, disponible: 0,
    trial: null, suscripcionActiva: false, suscripcionEstado: null, ...over,
  });
  const trialOk = { activo: true, inicio: "2026-06-10T12:00:00Z", diasRestantes: 2, boletasUsadas: 0, boletasMax: 100 };

  it("plan activo → puede", () => {
    expect(derechoDeEmision(base({ suscripcionActiva: true }))).toBe(true);
  });

  it("trial vigente sin plan → puede", () => {
    expect(derechoDeEmision(base({ trial: trialOk }))).toBe(true);
  });

  it("trial vencido → no puede", () => {
    expect(derechoDeEmision(base({ trial: { ...trialOk, activo: false } }))).toBe(false);
  });

  // ★ El agujero que cazó la auditoría adversarial: un moroso que alcanzó a
  // crear una empresa nueva volvía al trial por esa empresa (created_at
  // reciente) y emitía boletas ÚNICAS ilimitadas, que no pasan por el gate de
  // cuota. decidirGate ya cerraba esta puerta; esta función no.
  it("suscripción morosa NO vuelve al trial aunque la empresa sea nueva", () => {
    expect(derechoDeEmision(base({ suscripcionEstado: "morosa", trial: trialOk }))).toBe(false);
    expect(derechoDeEmision(base({ suscripcionEstado: "cancelada", trial: trialOk }))).toBe(false);
    expect(derechoDeEmision(base({ suscripcionEstado: "pausada", trial: trialOk }))).toBe(false);
  });

  it("suscripción pendiente (nunca llegó a activarse) SÍ cae al trial", () => {
    expect(derechoDeEmision(base({ suscripcionEstado: "pendiente", trial: trialOk }))).toBe(true);
  });
});

describe("decidirGate — gate puro de emisión masiva (todas las ramas)", () => {
  const base = (over: Partial<EstadoCuota> = {}): EstadoCuota => ({
    plan: null, cuota: 0, refills: 0, uso: 0, disponible: 0,
    trial: null, suscripcionActiva: false, suscripcionEstado: null, ...over,
  });
  const trial = (over: Partial<NonNullable<EstadoCuota["trial"]>> = {}) => ({
    activo: true, inicio: "2026-06-10T12:00:00Z", diasRestantes: 2, boletasUsadas: 0, boletasMax: 100, ...over,
  });

  it("suscripción activa con cupo suficiente → permite", () => {
    expect(decidirGate(base({ suscripcionActiva: true, disponible: 50 }), 30)).toEqual({ ok: true });
  });

  it("suscripción activa, borde exacto (cantidad == disponible) → permite", () => {
    expect(decidirGate(base({ suscripcionActiva: true, disponible: 10 }), 10)).toEqual({ ok: true });
  });

  it("suscripción activa sin cupo → CUOTA_AGOTADA (fail-closed)", () => {
    const r = decidirGate(base({ suscripcionActiva: true, disponible: 5 }), 10);
    expect(r.ok).toBe(false);
    if (r.ok === false) { expect(r.codigo).toBe("CUOTA_AGOTADA"); expect(r.disponible).toBe(5); }
  });

  it("suscripción morosa (no activa, estado ≠ pendiente) → SIN_PLAN, no vuelve al trial", () => {
    const r = decidirGate(base({ suscripcionEstado: "morosa", trial: trial() }), 1);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.codigo).toBe("SIN_PLAN");
  });

  it("suscripción pendiente → cae al trial (no bloquea por la puerta de atrás)", () => {
    expect(decidirGate(base({ suscripcionEstado: "pendiente", trial: trial(), disponible: 100 }), 5))
      .toEqual({ ok: true });
  });

  it("sin trial y sin suscripción → SIN_PLAN", () => {
    const r = decidirGate(base({ trial: null }), 1);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.codigo).toBe("SIN_PLAN");
  });

  // El reloj parte al ABRIR LA CUENTA (fundador 2026-09-04): el gate ya no
  // "activa" nada, solo deja pasar o no. Emitir no puede correr la fecha.
  it("trial vigente y cabe (incluso al tope) → pasa", () => {
    expect(decidirGate(base({ trial: trial({ boletasMax: 100 }), disponible: 100 }), 100))
      .toEqual({ ok: true });
  });

  it("trial vigente pero excede el cupo → CUOTA_AGOTADA", () => {
    const r = decidirGate(base({ trial: trial({ boletasMax: 100 }), disponible: 100 }), 101);
    expect(r.ok).toBe(false);
    if (r.ok === false) { expect(r.codigo).toBe("CUOTA_AGOTADA"); expect(r.disponible).toBe(100); }
  });

  it("trial terminado → TRIAL_TERMINADO", () => {
    const r = decidirGate(base({ trial: trial({ activo: false }) }), 1);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.codigo).toBe("TRIAL_TERMINADO");
  });

  it("trial activo con cupo → permite", () => {
    expect(decidirGate(base({ disponible: 20, trial: trial({ activo: true }) }), 15)).toEqual({ ok: true });
  });

  it("trial activo sin cupo suficiente → CUOTA_AGOTADA", () => {
    const r = decidirGate(base({ disponible: 3, trial: trial({ activo: true }) }), 10);
    expect(r.ok).toBe(false);
    if (r.ok === false) { expect(r.codigo).toBe("CUOTA_AGOTADA"); expect(r.disponible).toBe(3); }
  });
});
