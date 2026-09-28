import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revisarPostCandado, revisarPropuestaEmitible, revisarYaEmitida } from "./propuesta-emitible";

type Resp = { data: unknown; error: { message: string } | null };

// Cliente falso: cada tabla devuelve una respuesta fija; lleva la cuenta de consultas.
function fakeSb(respuestas: { boletas?: Resp; revision?: Resp; vuelo?: Resp }) {
  const consultas: string[] = [];
  const sb = {
    from(table: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
        neq: () => q,
        in: (c: string) => { filtros[c] = "in"; return q; },
        gt: () => q,
        limit: () => q,
        async maybeSingle(): Promise<Resp> {
          const cual = table === "boletas_emitidas" ? "boletas" : filtros.estado === "revision_pendiente" ? "revision" : "vuelo";
          consultas.push(cual);
          return respuestas[cual as keyof typeof respuestas] ?? { data: null, error: null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, consultas };
}

const falla = { data: null, error: { message: "timeout" } };

describe("revisarPropuestaEmitible — falla CERRADA", () => {
  it("todo limpio → ok", async () => {
    const { sb, consultas } = fakeSb({});
    expect(await revisarPropuestaEmitible(sb, "p")).toEqual({ ok: true });
    expect(consultas).toEqual(["boletas", "revision", "vuelo"]);
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
    const { sb, consultas } = fakeSb({ boletas: { data: { id: "b1" }, error: null } });
    const r = await revisarPropuestaEmitible(sb, "p");
    expect(r).toMatchObject({ ok: false, status: 409, error: "PROPUESTA_YA_EMITIDA" });
    expect(consultas).toEqual(["boletas"]);
  });

  it("a medias → 409 REVISION_PENDIENTE; en vuelo → 409 EMISION_EN_CURSO", async () => {
    expect(await revisarPropuestaEmitible(fakeSb({ revision: { data: { job_id: "j" }, error: null } }).sb, "p"))
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
    const r = await revisarPostCandado(fakeSb({ revision: { data: { job_id: "j" }, error: null } }).sb, "p");
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
