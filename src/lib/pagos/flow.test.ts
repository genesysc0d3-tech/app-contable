import { afterEach, describe, expect, it } from "vitest";
import { decidirReversaFlow, firmarFlow, flowAmbiente, flowConfigurado, ordenDeCobro, ordenDeRefill, prorratearUpgrade } from "./flow";

// La firma es la pieza que hay que poder probar sola: si está mal, TODA llamada
// a Flow falla con el mismo error genérico y no se distingue de una llave
// equivocada. El vector de abajo está verificado CONTRA LA API REAL de Flow
// (sandbox respondió 200 con esta misma mecánica).
describe("firmarFlow — firma HMAC de Flow", () => {
  const secret = "secreto-de-prueba";

  it("ordena los parámetros alfabéticamente, no en el orden en que llegan", () => {
    const a = firmarFlow({ zeta: "1", alfa: "2", medio: "3" }, secret);
    const b = firmarFlow({ alfa: "2", medio: "3", zeta: "1" }, secret);
    expect(a).toBe(b);
  });

  it("excluye el propio parámetro `s` (si no, firmaría sobre sí misma)", () => {
    const sin = firmarFlow({ apiKey: "k", amount: "1000" }, secret);
    const con = firmarFlow({ apiKey: "k", amount: "1000", s: "basura-previa" }, secret);
    expect(con).toBe(sin);
  });

  it("concatena nombre+valor sin separadores", () => {
    // 'ab'+'c' y 'a'+'bc' concatenan igual: si Flow usara un separador estas
    // dos firmas serían distintas. Que sean IGUALES confirma que no lo hay —
    // y de paso deja anotado el borde por el que un separador se colaría.
    expect(firmarFlow({ ab: "c" }, secret)).toBe(firmarFlow({ a: "bc" }, secret));
  });

  it("un cambio mínimo en un valor cambia la firma entera", () => {
    const uno = firmarFlow({ amount: "20207" }, secret);
    const otro = firmarFlow({ amount: "20208" }, secret);
    expect(uno).not.toBe(otro);
  });

  it("la misma carga con otra secretKey da otra firma", () => {
    const carga = { apiKey: "k", customerId: "cus_1" };
    expect(firmarFlow(carga, secret)).not.toBe(firmarFlow(carga, "otro-secreto"));
  });

  it("devuelve hexadecimal de 64 caracteres (SHA-256)", () => {
    expect(firmarFlow({ apiKey: "k" }, secret)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Equivocarse de ambiente con una pasarela cuesta plata de verdad, así que la
// única cadena que abre producción es "production" exacta.
describe("flowAmbiente — el ambiente por omisión es el inofensivo", () => {
  const original = process.env.FLOW_ENV;
  afterEach(() => {
    if (original === undefined) delete process.env.FLOW_ENV;
    else process.env.FLOW_ENV = original;
  });

  it("'production' exacto → producción", () => {
    process.env.FLOW_ENV = "production";
    expect(flowAmbiente()).toBe("production");
  });

  it("con espacios alrededor sigue siendo producción (se hace trim)", () => {
    process.env.FLOW_ENV = "  production  ";
    expect(flowAmbiente()).toBe("production");
  });

  it.each(["prod", "PRODUCTION", "produccion", "live", "", "sandbox", "cualquier cosa"])(
    "%o → sandbox (un typo jamás cobra de verdad)",
    (valor) => {
      process.env.FLOW_ENV = valor;
      expect(flowAmbiente()).toBe("sandbox");
    },
  );

  it("sin la variable → sandbox", () => {
    delete process.env.FLOW_ENV;
    expect(flowAmbiente()).toBe("sandbox");
  });
});

describe("flowConfigurado — gate: Flow necesita las DOS llaves", () => {
  const previas = { api: process.env.FLOW_API_KEY, secret: process.env.FLOW_SECRET_KEY };
  afterEach(() => {
    for (const [k, v] of [["FLOW_API_KEY", previas.api], ["FLOW_SECRET_KEY", previas.secret]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("con ambas → true", () => {
    process.env.FLOW_API_KEY = "api";
    process.env.FLOW_SECRET_KEY = "secreto";
    expect(flowConfigurado()).toBe(true);
  });

  it("solo apiKey → false (sin secretKey no se puede firmar nada)", () => {
    process.env.FLOW_API_KEY = "api";
    delete process.env.FLOW_SECRET_KEY;
    expect(flowConfigurado()).toBe(false);
  });

  it("solo secretKey → false", () => {
    delete process.env.FLOW_API_KEY;
    process.env.FLOW_SECRET_KEY = "secreto";
    expect(flowConfigurado()).toBe(false);
  });

  it("llaves solo-espacios → false", () => {
    process.env.FLOW_API_KEY = "   ";
    process.env.FLOW_SECRET_KEY = "   ";
    expect(flowConfigurado()).toBe(false);
  });
});

// La orden es lo que impide el doble cobro: Flow rechaza un commerceOrder
// repetido, así que la forma de esta cadena es la que convierte "no cobrar dos
// veces el mismo mes" en algo que hace cumplir la PASARELA y no nuestro código.
// Si dejara de ser estable por período, el candado se abre en silencio.
describe("ordenDeCobro — el candado anti-doble-cobro", () => {
  const cuenta = "a1b2c3d4-0000-0000-0000-000000000000";
  const otra = "ffffffff-0000-0000-0000-000000000000";

  it("la misma cuenta y el mismo período dan SIEMPRE la misma orden", () => {
    expect(ordenDeCobro(cuenta, "pro", "2026-09")).toBe(ordenDeCobro(cuenta, "pro", "2026-09"));
  });

  it("otro período da otra orden (si no, el mes 2 rebotaría contra el mes 1)", () => {
    expect(ordenDeCobro(cuenta, "pro", "2026-09")).not.toBe(ordenDeCobro(cuenta, "pro", "2026-10"));
  });

  it("otra cuenta da otra orden (si no, un cliente bloquearía el cobro de otro)", () => {
    expect(ordenDeCobro(cuenta, "pro", "2026-09")).not.toBe(ordenDeCobro(otra, "pro", "2026-09"));
  });

  it("otro plan da otra orden: subir de plan a mitad de mes SÍ se cobra", () => {
    // Sin esto el cobro del plan nuevo rebotaba como "ya pagado" y el cliente
    // se llevaba el plan caro gratis hasta el mes siguiente.
    expect(ordenDeCobro(cuenta, "pro", "2026-09")).not.toBe(ordenDeCobro(cuenta, "business", "2026-09"));
  });

  it("no lleva azar: dos llamadas seguidas no divergen", () => {
    const muestras = new Set(Array.from({ length: 50 }, () => ordenDeCobro(cuenta, "pro", "2026-09")));
    expect(muestras.size).toBe(1);
  });

  it("cabe holgado en el campo de Flow y no lleva caracteres raros", () => {
    const orden = ordenDeCobro(cuenta, "pro", "2026-09");
    expect(orden.length).toBeLessThanOrEqual(45);
    expect(orden).toMatch(/^[a-z0-9-]+$/);
  });
});

// A diferencia de la suscripción (una por mes), los refills se permiten varios
// por período: el correlativo separa compras legítimas y a la vez convierte el
// doble click en la MISMA orden, que Flow rebota.
describe("ordenDeRefill — varios por mes, pero no por doble click", () => {
  const cuenta = "a1b2c3d4-0000-0000-0000-000000000000";

  it("el mismo correlativo da la misma orden (doble click → rebote en Flow)", () => {
    expect(ordenDeRefill(cuenta, "2026-09", 1)).toBe(ordenDeRefill(cuenta, "2026-09", 1));
  });

  it("el correlativo siguiente da otra orden (el 2º refill del mes SÍ se cobra)", () => {
    expect(ordenDeRefill(cuenta, "2026-09", 1)).not.toBe(ordenDeRefill(cuenta, "2026-09", 2));
  });

  it("no choca con la orden de la suscripción del mismo mes", () => {
    expect(ordenDeRefill(cuenta, "2026-09", 1)).not.toBe(ordenDeCobro(cuenta, "start", "2026-09"));
  });
});

// El prorrateo del upgrade es plata que se le cobra al cliente: cada rama va
// probada con números redondos que se puedan verificar a mano.
describe("prorratearUpgrade — se cobra solo la diferencia por los días que faltan", () => {
  // UF ficticia de 40.000 para que las cuentas salgan redondas:
  // Start 0,5 → 20.000 neto; Pro 1,0 → 40.000 neto; dif neta 20.000 (23.800 con IVA).
  const base = { ufViejo: 0.5, ufNuevo: 1.0, ufClp: 40_000 };

  it("a mitad de período paga la mitad de la diferencia", () => {
    // Período 24-08 → 24-09 (31 días); al 09-09 quedan 15.
    const monto = prorratearUpgrade({ ...base, hoy: "2026-09-09", periodoHasta: "2026-09-24" });
    expect(monto).toBe(Math.round(20_000 * 1.19 * (15 / 31)));
  });

  it("recién contratado paga casi la diferencia completa", () => {
    const monto = prorratearUpgrade({ ...base, hoy: "2026-08-25", periodoHasta: "2026-09-24" });
    expect(monto).toBe(Math.round(20_000 * 1.19 * (30 / 31)));
  });

  it("el último día paga casi nada, pero nunca negativo", () => {
    expect(prorratearUpgrade({ ...base, hoy: "2026-09-24", periodoHasta: "2026-09-24" })).toBe(0);
    expect(prorratearUpgrade({ ...base, hoy: "2026-09-30", periodoHasta: "2026-09-24" })).toBe(0);
  });

  it("usa el largo REAL del período (febrero no es un mes de 30)", () => {
    // 24-01 → 24-02: 31 días de período; quedan 10 al 14-02.
    const m = prorratearUpgrade({ ...base, hoy: "2026-02-14", periodoHasta: "2026-02-24" });
    expect(m).toBe(Math.round(20_000 * 1.19 * (10 / 31)));
  });

  it("nunca cobra más que la diferencia del mes completo", () => {
    // periodo_hasta corrupto muy en el futuro no puede inflar el cobro.
    const m = prorratearUpgrade({ ...base, hoy: "2026-08-25", periodoHasta: "2027-08-24" });
    expect(m).toBeLessThanOrEqual(Math.round(20_000 * 1.19));
  });
});

describe("decidirReversaFlow — un cobro que se dio vuelta apaga el plan, la duda NO", () => {
  // FLOW_PAGO: 1 pendiente · 2 pagada · 3 rechazada · 4 anulada
  it("Flow dice ANULADA sobre un pago que dábamos por bueno → revertir", () => {
    expect(decidirReversaFlow({ statusFlow: 4, estadoLocal: "aprobado" })).toBe("revertir");
  });

  it("Flow dice PAGADA → no se toca nada", () => {
    expect(decidirReversaFlow({ statusFlow: 2, estadoLocal: "aprobado" })).toBe("sin_cambio");
  });

  // ★ Lo importante: la incertidumbre NUNCA baja un plan. Bajárselo a alguien
  // que sí pagó, por un hipo de la red, es peor que tardar un día en detectar
  // una reversa — el cron corre todos los días.
  it("la consulta a Flow falló (null/undefined) → NO se revierte", () => {
    expect(decidirReversaFlow({ statusFlow: null, estadoLocal: "aprobado" })).toBe("sin_cambio");
    expect(decidirReversaFlow({ statusFlow: undefined, estadoLocal: "aprobado" })).toBe("sin_cambio");
  });

  it("un status raro o desconocido tampoco revierte", () => {
    for (const raro of [0, 1, 3, 5, 99, -1, NaN]) {
      expect(decidirReversaFlow({ statusFlow: raro, estadoLocal: "aprobado" })).toBe("sin_cambio");
    }
  });

  it("es idempotente: un pago ya revertido no se vuelve a procesar", () => {
    expect(decidirReversaFlow({ statusFlow: 4, estadoLocal: "revertido" })).toBe("sin_cambio");
  });

  it("un pago rechazado o pendiente no gatilla nada (nunca encendió el plan)", () => {
    expect(decidirReversaFlow({ statusFlow: 4, estadoLocal: "rechazado" })).toBe("sin_cambio");
    expect(decidirReversaFlow({ statusFlow: 4, estadoLocal: "pendiente" })).toBe("sin_cambio");
    expect(decidirReversaFlow({ statusFlow: 4, estadoLocal: null })).toBe("sin_cambio");
  });
});
