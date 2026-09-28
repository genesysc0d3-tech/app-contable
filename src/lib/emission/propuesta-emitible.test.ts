import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revisarPostCandado, revisarPropuestaEmitible, revisarYaEmitida } from "./propuesta-emitible";

type Resp = { data: unknown; error: { message: string } | null };

// Cliente falso: "boletas" (ya emitida, maybeSingle), "revision" (lápidas: lista de
// jobs, se espera con await), "vuelo" (en curso, maybeSingle). Lleva la cuenta.
function fakeSb(respuestas: { boletas?: Resp; revision?: Resp; vuelo?: Resp }) {
  const consultas: string[] = [];
  const sb = {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        in: () => q,
        gt: () => q,
        limit: () => q,
        async maybeSingle(): Promise<Resp> {
          const cual = table === "boletas_emitidas" ? "boletas" : "vuelo";
          consultas.push(cual);
          return respuestas[cual] ?? { data: null, error: null };
        },
        then(ok: (v: Resp) => unknown, ko?: (e: unknown) => unknown) {
          consultas.push("revision");
          return Promise.resolve(respuestas.revision ?? { data: [], error: null }).then(ok, ko);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, consultas };
}

// Lápidas como las devuelve la base.
const lapida = { data: [{ estado: "revision_pendiente", propuesta_id: "p", expires_at: null, created_at: "2026-09-28T01:00:00Z" }], error: null };
const colgado = { data: [{ estado: "running", propuesta_id: "p", expires_at: "2026-09-28T02:52:07Z", created_at: "2026-09-28T02:37:07Z" }], error: null };

const falla = { data: null, error: { message: "timeout" } };

describe("revisarPropuestaEmitible — falla CERRADA", () => {
  it("todo limpio → ok", async () => {
    const { sb, consultas } = fakeSb({});
    expect(await revisarPropuestaEmitible(sb, "p")).toEqual({ ok: true });
    expect([...consultas].sort()).toEqual(["boletas", "revision", "vuelo"]);
  });

  it("error al consultar boletas → rechaza (antes pasaba de largo)", async () => {
    const { sb } = fakeSb({ boletas: falla });
    const r = await revisarPropuestaEmitible(sb, "p");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
  });

  it("error al consultar la lápida → rechaza", async () => {
    const { sb } = fakeSb({ revision: falla });
    expect((await revisarPropuestaEmitible(sb, "p")).ok).toBe(false);
  });

  it("error al consultar jobs en vuelo → rechaza", async () => {
    const { sb } = fakeSb({ vuelo: falla });
    expect((await revisarPropuestaEmitible(sb, "p")).ok).toBe(false);
  });

  it("ya emitida → 409 PROPUESTA_YA_EMITIDA (el lote la salta sin pausar)", async () => {
    const { sb } = fakeSb({ boletas: { data: { id: "b1" }, error: null } });
    const r = await revisarPropuestaEmitible(sb, "p");
    expect(r).toMatchObject({ ok: false, status: 409, error: "PROPUESTA_YA_EMITIDA" });
  });

  it("precedencia intacta aunque vayan en paralelo: ya emitida gana a a-medias y en-vuelo", async () => {
    const r = await revisarPropuestaEmitible(fakeSb({
      boletas: { data: { id: "b1", folio: 7 }, error: null },
      revision: lapida,
      vuelo: { data: { job_id: "k" }, error: null },
    }).sb, "p");
    expect(r).toMatchObject({ error: "PROPUESTA_YA_EMITIDA", folio: 7 });
    const r2 = await revisarPropuestaEmitible(fakeSb({
      revision: lapida,
      vuelo: { data: { job_id: "k" }, error: null },
    }).sb, "p");
    expect(r2).toMatchObject({ error: "REVISION_PENDIENTE" });
  });

  it("a medias → 409 REVISION_PENDIENTE; en vuelo → 409 EMISION_EN_CURSO", async () => {
    expect(await revisarPropuestaEmitible(fakeSb({ revision: lapida }).sb, "p"))
      .toMatchObject({ status: 409, error: "REVISION_PENDIENTE" });
    expect(await revisarPropuestaEmitible(fakeSb({ vuelo: { data: { job_id: "j" }, error: null } }).sb, "p"))
      .toMatchObject({ status: 409, error: "EMISION_EN_CURSO" });
  });

  it("re-chequeo con candado: error → rechaza", async () => {
    expect((await revisarYaEmitida(fakeSb({ boletas: falla }).sb, "p")).ok).toBe(false);
  });
});

describe("revisarPostCandado — con el candado tomado", () => {
  it("ya emitida → 409 con folio y boleta_id (la verificación la cierra como emitida)", async () => {
    const r = await revisarPostCandado(fakeSb({ boletas: { data: { id: "b1", folio: 24133 }, error: null } }).sb, "p");
    expect(r).toMatchObject({ ok: false, status: 409, error: "PROPUESTA_YA_EMITIDA", folio: 24133, boletaId: "b1" });
  });
  it("quedó a medias entre el chequeo y el candado → 409 REVISION_PENDIENTE", async () => {
    const r = await revisarPostCandado(fakeSb({ revision: lapida }).sb, "p");
    expect(r).toMatchObject({ ok: false, status: 409, error: "REVISION_PENDIENTE" });
  });
  it("NO mira 'en vuelo' (el job propio recién creado)", async () => {
    const { sb, consultas } = fakeSb({ vuelo: { data: { job_id: "propio" }, error: null } });
    expect(await revisarPostCandado(sb, "p")).toEqual({ ok: true });
    expect(consultas).toEqual(["boletas", "revision"]);
  });
  it("error de consulta → rechaza", async () => {
    expect((await revisarPostCandado(fakeSb({ revision: falla }).sb, "p")).ok).toBe(false);
  });
});

describe("sin respuesta (caso LC 27-sep) — job del lote vencido y abierto bloquea", () => {
  it("antes quedaba re-emitible; ahora 409 SIN_RESPUESTA", async () => {
    const r = await revisarPropuestaEmitible(fakeSb({ revision: colgado }).sb, "p", new Date("2026-09-28T12:00:00Z"));
    expect(r).toMatchObject({ ok: false, status: 409, error: "SIN_RESPUESTA" });
  });
  it("con el candado tomado también se ve", async () => {
    const r = await revisarPostCandado(fakeSb({ revision: colgado }).sb, "p");
    expect(r).toMatchObject({ ok: false, status: 409, error: "SIN_RESPUESTA" });
  });
});
