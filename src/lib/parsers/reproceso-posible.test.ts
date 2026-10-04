import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reprocesoPosible } from "./reproceso-posible";

/** Cliente falso: respuestas por tabla (sin movimientos → sin bloqueo de emisión). */
function svc(tablas: Record<string, { data: unknown; error: unknown }>) {
  return {
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "limit", "not", "order"]) b[op] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(tablas[t] ?? { data: [], error: null }).then(ok);
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("reprocesoPosible (mismo candado que /api/procesar-documento)", () => {
  it("sin cliente de servicio → 503 (no se puede revisar)", async () => {
    expect(await reprocesoPosible(null, "d")).toMatchObject({ ok: false, status: 503 });
  });
  it("job en curso → 409", async () => {
    expect(await reprocesoPosible(svc({ document_processing_jobs: { data: [{ id: "j" }], error: null } }), "d")).toMatchObject({ ok: false, status: 409 });
  });
  it("sin movimientos ni job → se puede", async () => {
    expect(await reprocesoPosible(svc({}), "d")).toEqual({ ok: true });
  });
});
