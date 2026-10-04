import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clasificarStartJob } from "./clasificar-start-job";
import {
  avisoSeQuedan,
  clasificarIntocables,
  contarIntocables,
  motivoJobIntocable,
  resumenRetroceso,
  separarIntocables,
} from "./propuestas-intocables";

// Incidente MH 2026-09-29: "Devolver a Check" bajó 684 propuestas de 'aprobado' a
// 'listo', incluidas 103 con boleta ya emitida en el SII.

const AHORA = new Date("2026-09-29T15:00:00Z");
const job = (over: Partial<{ estado: string; propuesta_id: string | null; expires_at: string | null; created_at: string }>) => ({
  estado: "running",
  propuesta_id: "p1",
  expires_at: "2026-09-29T15:05:00Z",
  created_at: "2026-09-29T14:59:00Z",
  ...over,
});

describe("motivoJobIntocable", () => {
  it("revision_pendiente = a medias", () => {
    expect(motivoJobIntocable(job({ estado: "revision_pendiente", expires_at: null }), AHORA)).toBe("a_medias");
  });
  it("running vencido (después del corte) = sin respuesta", () => {
    expect(motivoJobIntocable(job({ expires_at: "2026-09-29T14:00:00Z" }), AHORA)).toBe("sin_respuesta");
  });
  it("running vigente = en vuelo", () => {
    expect(motivoJobIntocable(job({}), AHORA)).toBe("en_vuelo");
  });
  it("job sin propuesta (boleta única) no bloquea", () => {
    expect(motivoJobIntocable(job({ propuesta_id: null }), AHORA)).toBeNull();
  });
  it("colgado viejo (antes del corte B3a) no bloquea, igual que la cola de Emitir", () => {
    expect(motivoJobIntocable(job({ created_at: "2026-09-20T10:00:00Z", expires_at: "2026-09-20T10:05:00Z" }), AHORA)).toBeNull();
  });
  it("completed/failed no bloquean", () => {
    expect(motivoJobIntocable(job({ estado: "completed" }), AHORA)).toBeNull();
    expect(motivoJobIntocable(job({ estado: "failed" }), AHORA)).toBeNull();
  });
});

describe("separarIntocables (caso MH: 684 aprobadas, 103 emitidas)", () => {
  const ids = Array.from({ length: 684 }, (_, i) => `p${i}`);
  const emitidas = ids.slice(0, 103);

  it("devuelve SOLO las sin boleta; las emitidas se quedan", () => {
    const sep = separarIntocables(ids, emitidas, [], AHORA);
    expect(sep.tocables).toHaveLength(581);
    expect(sep.tocables.some((id) => emitidas.includes(id))).toBe(false);
    expect(contarIntocables(sep.intocables)).toEqual({ emitidas: 103, aMedias: 0, enVuelo: 0 });
  });

  it("a medias, sin respuesta y en vuelo tampoco vuelven", () => {
    const sep = separarIntocables(ids, emitidas, [
      job({ propuesta_id: "p200", estado: "revision_pendiente" }),
      job({ propuesta_id: "p201", expires_at: "2026-09-29T14:00:00Z" }),
      job({ propuesta_id: "p202" }),
    ], AHORA);
    expect(sep.tocables).toHaveLength(578);
    expect(sep.tocables).not.toContain("p200");
    expect(sep.tocables).not.toContain("p201");
    expect(sep.tocables).not.toContain("p202");
    expect(contarIntocables(sep.intocables)).toEqual({ emitidas: 103, aMedias: 2, enVuelo: 1 });
  });

  it("emitida gana sobre la lápida (la misma propuesta no se cuenta dos veces)", () => {
    const sep = separarIntocables(["p0"], ["p0"], [job({ propuesta_id: "p0", estado: "revision_pendiente" })], AHORA);
    expect(sep.intocables.get("p0")).toBe("emitida");
  });

  it("boletas/jobs de propuestas no pedidas no ensucian el conteo", () => {
    const sep = separarIntocables(["a"], ["zz"], [job({ propuesta_id: "yy", estado: "revision_pendiente" })], AHORA);
    expect(sep.tocables).toEqual(["a"]);
    expect(sep.intocables.size).toBe(0);
  });

  it("el resumen dice cuántas volvieron y cuántas se quedan", () => {
    const sep = separarIntocables(ids, emitidas, [], AHORA);
    expect(resumenRetroceso(581, "devueltas a Check", sep.intocables)).toBe("581 devueltas a Check · 103 ya emitidas se quedan");
  });
});

// Fake mínimo del query builder de supabase-js: registra filtros y resuelve.
function fakeSb(resp: (tabla: string, filtros: Record<string, unknown>) => { data: unknown[] | null; error: { message: string } | null }) {
  const llamadas: Array<{ tabla: string; filtros: Record<string, unknown> }> = [];
  return {
    llamadas,
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros[`eq:${c}`] = v; return q; },
        neq: (c: string, v: unknown) => { filtros[`neq:${c}`] = v; return q; },
        in: (c: string, v: unknown) => { filtros[`in:${c}`] = v; return q; },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          llamadas.push({ tabla, filtros });
          return Promise.resolve(resp(tabla, filtros)).then(ok, ko);
        },
      };
      return q;
    },
  };
}

describe("clasificarIntocables (lectura en la base)", () => {
  it("excluye anuladas, trocea en 100 y separa", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const sb = fakeSb((tabla, f) => {
      const pedidos = f["in:propuesta_id"] as string[];
      if (tabla === "boletas_emitidas") return { data: pedidos.filter((id) => id === "p5" || id === "p150").map((propuesta_id) => ({ propuesta_id })), error: null };
      return { data: pedidos.includes("p220") ? [job({ propuesta_id: "p220", estado: "revision_pendiente" })] : [], error: null };
    });
    const sep = await clasificarIntocables(sb, "emp", ids, AHORA);
    if ("error" in sep) throw new Error(sep.error);
    expect(sep.tocables).toHaveLength(247);
    expect(contarIntocables(sep.intocables)).toEqual({ emitidas: 2, aMedias: 1, enVuelo: 0 });
    const bols = sb.llamadas.filter((l) => l.tabla === "boletas_emitidas");
    expect(bols).toHaveLength(3);
    expect(bols.every((l) => l.filtros["neq:estado"] === "anulada" && l.filtros["eq:empresa_id"] === "emp")).toBe(true);
    expect(bols.every((l) => (l.filtros["in:propuesta_id"] as string[]).length <= 100)).toBe(true);
  });

  it("FAIL-CLOSED: si no se puede leer boletas, no devuelve nada tocable", async () => {
    const sb = fakeSb((tabla) => (tabla === "boletas_emitidas" ? { data: null, error: { message: "URI too long" } } : { data: [], error: null }));
    const sep = await clasificarIntocables(sb, "emp", ["a", "b"], AHORA);
    expect("error" in sep).toBe(true);
  });

  it("FAIL-CLOSED: si no se pueden leer los jobs, tampoco", async () => {
    const sep = await clasificarIntocables(fakeSb((tabla) => (tabla === "emision_jobs" ? { data: null, error: { message: "x" } } : { data: [], error: null })), "emp", ["a"], AHORA);
    expect("error" in sep).toBe(true);
  });
});

// Test de FUENTE: las acciones de retroceso pasan por el guard.
const acciones = readFileSync(join(__dirname, "../../app/(app)/revisar/actions.ts"), "utf8");
const cuerpo = (fn: string) => {
  const i = acciones.indexOf(`export async function ${fn}(`);
  if (i < 0) throw new Error(`no existe ${fn}`);
  const j = acciones.indexOf("\nexport async function", i + 10);
  return acciones.slice(i, j < 0 ? undefined : j);
};

describe("acciones de retroceso respetan lo emitido (fuente)", () => {
  it("devolverCartola solo actualiza las tocables y reporta las que se quedan", () => {
    const src = cuerpo("devolverCartola");
    expect(src).toMatch(/clasificarIntocables\(ctx\.sb, ctx\.empresaId, ids\)/);
    expect(src).toMatch(/if \("error" in sep\) return/);
    expect(src).toMatch(/sep\.tocables\.slice\(i, i \+ BATCH_SIZE\)/);
    expect(src).not.toMatch(/ids\.slice\(i, i \+ BATCH_SIZE\)/);
    expect(src).toMatch(/resumenRetroceso\(devueltas, "devueltas a Check"/);
  });
  it.each(["descartarPropuesta", "ocultarPropuesta", "restaurarPropuesta", "rechazarPropuesta", "devolverAOmitidos"])(
    "%s bloquea si la propuesta ya se emitió / está a medias / en vuelo",
    (fn) => {
      expect(cuerpo(fn)).toMatch(/const bloqueo = await bloqueoRetroceso\(ctx\.sb, ctx\.empresaId, propuestaId\);\s*if \(bloqueo\) return \{ error: bloqueo \};/);
    },
  );
  it.each(["volverAPendientes", "rechazarPropuestas", "cambiarTipoPropuestas", "restaurarPropuestas"])(
    "%s filtra las intocables antes de actualizar",
    (fn) => {
      const src = cuerpo(fn);
      expect(src).toMatch(/clasificarIntocables\(ctx\.sb, ctx\.empresaId, propuestaIds\)/);
      const trasGuard = src.slice(src.indexOf("const tocables"));
      expect(trasGuard).not.toMatch(/propuestaIds/);
    },
  );
});

// Revisión adversarial: "devolver" con un lote corriendo y el conector MCP.
describe("cierres de la revisión adversarial", () => {
  it("el server solo crea jobs de lote para propuestas APROBADAS (salvo verificación)", () => {
    const src = readFileSync(join(__dirname, "../../app/api/emision/jobs/route.ts"), "utf8");
    // El select ahora trae también los datos a comparar (seguridad 2026-09-30, datos-job.ts).
    expect(src).toMatch(/\.select\(SELECT_PROPUESTA_DATOS\)/);
    expect(readFileSync(join(__dirname, "datos-job.ts"), "utf8")).toMatch(/SELECT_PROPUESTA_DATOS =\s*"id, empresa_id, estado,/);
    expect(src).toMatch(/!cleanText\(payload\.adopta_job_id\) && \(prop as \{ estado\?: string \| null \}\)\.estado !== "aprobado"/);
    expect(src).toMatch(/error: "PROPUESTA_NO_APROBADA"/);
  });
  it("el lote se FRENA (no marca fallida) si la cartola volvió a Check", () => {
    expect(clasificarStartJob(409, { ok: false, error: "PROPUESTA_NO_APROBADA" }).tipo).toBe("frenada");
  });
  it("MCP devolver_a_revision pasa por el guard antes del update", () => {
    const src = readFileSync(join(__dirname, "../../app/api/mcp/route.ts"), "utf8");
    const i = src.indexOf("clasificarIntocables(ctx.svc, ctx.empresaId, ids)");
    // (el payload lleva además el sello de decisión: ...sello("mcp", …), Fase 1 medición)
    const j = src.indexOf('.update({ estado: "pendiente"');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(src.slice(j, j + 220)).toMatch(/\.in\("id", sep\.tocables\)/);
  });
  it("los bulk avisan lo que se quedó", () => {
    expect(avisoSeQuedan(new Map([["a", "emitida"], ["b", "a_medias"]]))).toBe("1 ya emitida se queda · 1 a medias se queda (verifícala en A medias)");
    expect(avisoSeQuedan(new Map())).toBe("");
    for (const fn of ["volverAPendientes", "rechazarPropuestas", "restaurarPropuestas"]) {
      expect(cuerpo(fn)).toMatch(/aviso: avisoSeQuedan\(sepR\.intocables\) \|\| undefined/);
    }
    // cambiarTipoPropuestas junta el aviso de intocables con el de la regla (Fase 3).
    expect(cuerpo("cambiarTipoPropuestas")).toMatch(/\[\.\.\.avisosRegla, avisoSeQuedan\(sepR\.intocables\)\]/);
    expect(cuerpo("cambiarTipoPropuestas")).toMatch(/aviso: avisoFinal \|\| undefined/);
  });
});
