import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  esErrorCandadoBD,
  propuestasDeMovimientos,
  revisarBloqueoBorrado,
  revisarBloqueoDocumento,
} from "./bloqueo-borrado";

// Doble candado 2026-09-30: "las emitidas nunca vuelven; si falla uno tenemos otro".

type Resp = { data?: unknown[] | null; error: { message: string } | null; count?: number | null };
type Llamada = { tabla: string; filtros: Record<string, unknown> };

function fakeSb(resp: (tabla: string, filtros: Record<string, unknown>) => Resp) {
  const llamadas: Llamada[] = [];
  const sb = {
    llamadas,
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros[`eq:${c}`] = v; return q; },
        neq: (c: string, v: unknown) => { filtros[`neq:${c}`] = v; return q; },
        in: (c: string, v: unknown) => { filtros[`in:${c}`] = v; return q; },
        then: (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => {
          llamadas.push({ tabla, filtros });
          return Promise.resolve(resp(tabla, filtros)).then(ok, ko);
        },
      };
      return q;
    },
  };
  return sb;
}

const ids = (n: number, p = "x") => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("revisarBloqueoBorrado (candado 1)", () => {
  it("trocea en 100 y suma boletas + jobs abiertos", async () => {
    const sb = fakeSb((tabla) => (tabla === "boletas_emitidas" ? { count: 1, error: null } : { count: 2, error: null }));
    const r = await revisarBloqueoBorrado(sb, ids(250));
    expect(r).toEqual({ emitidas: 3, emisionesAbiertas: 6 });
    const bols = sb.llamadas.filter((l) => l.tabla === "boletas_emitidas");
    const jobs = sb.llamadas.filter((l) => l.tabla === "emision_jobs");
    expect(bols).toHaveLength(3);
    expect(jobs).toHaveLength(3);
    for (const l of [...bols, ...jobs]) expect((l.filtros["in:propuesta_id"] as string[]).length).toBeLessThanOrEqual(100);
    expect(bols.every((l) => l.filtros["neq:estado"] === "anulada")).toBe(true);
    // created/running (vencido o no) y lápida: mismo set que el trigger.
    expect(jobs.every((l) => JSON.stringify(l.filtros["in:estado"]) === JSON.stringify(["created", "running", "revision_pendiente"]))).toBe(true);
  });

  it("★ fail-closed: error en boletas_emitidas → error (no 'cero boletas')", async () => {
    const sb = fakeSb((tabla) => (tabla === "boletas_emitidas" ? { count: null, error: { message: "timeout" } } : { count: 0, error: null }));
    expect(await revisarBloqueoBorrado(sb, ids(3))).toHaveProperty("error");
  });

  it("★ fail-closed: error en emision_jobs → error", async () => {
    const sb = fakeSb((tabla) => (tabla === "emision_jobs" ? { count: null, error: { message: "URI too long" } } : { count: 0, error: null }));
    expect(await revisarBloqueoBorrado(sb, ids(3))).toHaveProperty("error");
  });

  it("fail-closed: count null sin error (respuesta rara) → error", async () => {
    const sb = fakeSb(() => ({ count: null, error: null }));
    expect(await revisarBloqueoBorrado(sb, ids(3))).toHaveProperty("error");
  });

  it("error en el TERCER trozo también frena (no basta con que pasen los primeros)", async () => {
    const sb = fakeSb((tabla, f) =>
      tabla === "boletas_emitidas" && (f["in:propuesta_id"] as string[]).includes("x220")
        ? { count: null, error: { message: "boom" } }
        : { count: 0, error: null },
    );
    expect(await revisarBloqueoBorrado(sb, ids(250))).toHaveProperty("error");
  });
});

describe("propuestasDeMovimientos / revisarBloqueoDocumento", () => {
  it("lee las propuestas en trozos de 100 movimientos", async () => {
    const sb = fakeSb((tabla, f) =>
      tabla === "propuestas_ia"
        ? { data: (f["in:movimiento_id"] as string[]).map((m) => ({ id: `p-${m}` })), error: null }
        : { count: 0, error: null },
    );
    const r = await propuestasDeMovimientos(sb, ids(230, "m"));
    if ("error" in r) throw new Error(r.error);
    expect(r.ids).toHaveLength(230);
    const props = sb.llamadas.filter((l) => l.tabla === "propuestas_ia");
    expect(props.map((l) => (l.filtros["in:movimiento_id"] as string[]).length)).toEqual([100, 100, 30]);
  });

  it("★ fail-closed: si no se pueden leer las propuestas, error (antes: [] → 'sin boletas' → borraba)", async () => {
    const sb = fakeSb((tabla) => (tabla === "propuestas_ia" ? { data: null, error: { message: "boom" } } : { count: 0, error: null }));
    expect(await revisarBloqueoDocumento(sb, ids(5, "m"))).toHaveProperty("error");
  });

  it("sin movimientos: nada que revisar", async () => {
    const sb = fakeSb(() => ({ error: { message: "no debería consultar" } }));
    expect(await revisarBloqueoDocumento(sb, [])).toEqual({ emitidas: 0, emisionesAbiertas: 0, propIds: [] });
    expect(sb.llamadas).toHaveLength(0);
  });
});

describe("esErrorCandadoBD", () => {
  it("reconoce el error del trigger por mensaje o por código", () => {
    expect(esErrorCandadoBD({ message: "PROPUESTA_CON_EMISION: la propuesta …" })).toBe(true);
    expect(esErrorCandadoBD({ message: "x", code: "MDE01" })).toBe(true);
    expect(esErrorCandadoBD({ message: "timeout" })).toBe(false);
    expect(esErrorCandadoBD(null)).toBe(false);
  });
});

describe("candado 2: migración del trigger (fuente)", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const up = readFileSync(join(dir, "20260930120000_candado_borrar_propuesta_emitida.sql"), "utf8");
  const down = readFileSync(join(dir, "20260930120000_candado_borrar_propuesta_emitida_DOWN.sql"), "utf8");
  // Sin comentarios: que las aserciones muerdan el SQL ejecutable, no la prosa.
  const sql = up.replace(/--.*$/gm, "");

  it("crea un trigger BEFORE DELETE FOR EACH ROW en propuestas_ia", () => {
    expect(sql).toMatch(/create trigger trg_propuestas_ia_candado_emision\s+before delete on public\.propuestas_ia\s+for each row execute function public\.propuestas_ia_candado_emision\(\)/);
    expect(sql).toMatch(/drop trigger if exists trg_propuestas_ia_candado_emision on public\.propuestas_ia/);
  });

  it("bloquea boletas no anuladas y no sandbox (NULL cuenta como real)", () => {
    expect(sql).toMatch(/b\.propuesta_id = old\.id/);
    expect(sql).toMatch(/b\.estado is distinct from 'anulada'/);
    expect(sql).toMatch(/b\.emision_sandbox is not true/);
    // No exime mock (DEFAULT 'mock' podría etiquetar mal una real).
    expect(sql).not.toMatch(/emision_proveedor/);
  });

  it("bloquea jobs created/running/revision_pendiente sin mirar vencimiento", () => {
    expect(sql).toMatch(/j\.propuesta_id = old\.id/);
    expect(sql).toMatch(/j\.estado in \('created', 'running', 'revision_pendiente'\)/);
    expect(sql).not.toMatch(/expires_at/);
  });

  it("lanza PROPUESTA_CON_EMISION con código propio y es security definer con search_path fijo", () => {
    expect(sql).toMatch(/raise exception 'PROPUESTA_CON_EMISION/);
    expect(sql).toMatch(/errcode = 'MDE01'/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public, pg_temp/);
  });

  it("bypass: solo local, ignorado para anon/authenticated y auditado", () => {
    expect(sql).toMatch(/current_setting\('massdte\.permitir_borrado_emitidas', true\)/);
    expect(sql).toMatch(/not in \('anon', 'authenticated'\)/);
    expect(sql).toMatch(/insert into public\.propuestas_borradas_con_emision/);
    expect(sql).toMatch(/enable row level security/);
  });

  it("el DOWN quita trigger, función y tabla de auditoría", () => {
    const d = down.replace(/--.*$/gm, "");
    expect(d).toMatch(/drop trigger if exists trg_propuestas_ia_candado_emision on public\.propuestas_ia/);
    expect(d).toMatch(/drop function if exists public\.propuestas_ia_candado_emision\(\)/);
    expect(d).toMatch(/drop table if exists public\.propuestas_borradas_con_emision/);
  });

  it("limpiar-test conserva propuestas con job abierto; reset-completo usa el bypass local", () => {
    const limpia = readFileSync(join(process.cwd(), "scripts/limpiar-test.sql"), "utf8");
    expect(limpia).toMatch(/j\.estado IN \('created', 'running', 'revision_pendiente'\)/);
    expect(limpia).not.toMatch(/^SELECT set_config\('massdte/m);
    const reset = readFileSync(join(process.cwd(), "scripts/reset-completo.sql"), "utf8");
    expect(reset).toMatch(/^SELECT set_config\('massdte\.permitir_borrado_emitidas', 'on', true\);/m);
  });
});
