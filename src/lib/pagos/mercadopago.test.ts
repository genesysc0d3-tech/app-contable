import { afterEach, describe, expect, it, vi } from "vitest";

// mercadopago.ts importa getUfClp desde el alias "@/lib/sii/uf" (import de
// valor). Vitest no resuelve el alias "@/" salvo que esté mockeado, así que lo
// stubeamos: mpConfigurado no lo usa, solo necesitamos que el módulo cargue.
vi.mock("@/lib/sii/uf", () => ({ getUfClp: vi.fn(async () => 39_000) }));

import { mpConfigurado } from "./mercadopago";

// mpConfigurado es el gate puro del módulo: decide si MP está operativo según
// MP_ACCESS_TOKEN. Toda función de red lo consulta primero (sin token →
// MP_NO_CONFIGURADO), así que su comportamiento es load-bearing. El resto del
// módulo es red/DB (crearSuscripcion, webhooks, etc.) y queda fuera del test.
describe("mpConfigurado — gate de configuración de Mercado Pago", () => {
  const original = process.env.MP_ACCESS_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = original;
  });

  it("sin token → false (módulo dormido)", () => {
    delete process.env.MP_ACCESS_TOKEN;
    expect(mpConfigurado()).toBe(false);
  });

  it("token presente → true", () => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-token-de-prueba";
    expect(mpConfigurado()).toBe(true);
  });

  it("token vacío → false", () => {
    process.env.MP_ACCESS_TOKEN = "";
    expect(mpConfigurado()).toBe(false);
  });

  it("token solo-espacios → false (se hace trim)", () => {
    process.env.MP_ACCESS_TOKEN = "   ";
    expect(mpConfigurado()).toBe(false);
  });
});
