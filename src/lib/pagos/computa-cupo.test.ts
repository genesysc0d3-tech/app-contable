import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "Únicas ilimitadas" tiene que ser verdad para la FACTURA única también
 * (fundador 2026-09-06). El sello vive en la base (trigger al insertar en
 * boletas_emitidas) y el conteo lo respeta. Este censo sostiene las dos
 * mitades: sin el trigger la única volvería a contar; sin el filtro en
 * `contarMasivas` el sello no serviría de nada.
 */
const MIG = "supabase/migrations/20260906140000_computa_cupo.sql";
const DOWN = "supabase/migrations/20260906140000_computa_cupo_DOWN.sql";
const METERING = "src/lib/pagos/metering.ts";

describe("computa_cupo — el sello se pone al emitir, en la base", () => {
  const sql = readFileSync(MIG, "utf8");

  it("columna con default TRUE (nada de lo ya emitido cambia de cuenta)", () => {
    expect(sql).toMatch(/add column if not exists computa_cupo boolean not null default true/);
  });

  it("trigger BEFORE INSERT sobre boletas_emitidas, para TODOS los caminos de emisión", () => {
    expect(sql).toMatch(/create trigger trg_sellar_computa_cupo\s+before insert on public\.boletas_emitidas\s+for each row execute function public\.sellar_computa_cupo\(\)/);
  });

  it("la factura única (fuente_clasificacion = 'factura_unica') sella FALSE; la boleta sin propuesta también", () => {
    expect(sql).toMatch(/p\.fuente_clasificacion = 'factura_unica'/);
    expect(sql).toMatch(/if new\.propuesta_id is null then\s+[\s\S]*?new\.computa_cupo := false/);
  });

  it("NO vacía propuesta_id (lo necesita la protección de doble folio)", () => {
    expect(sql).not.toMatch(/propuesta_id\s*:=\s*null/i);
    expect(sql).not.toMatch(/set propuesta_id/i);
  });

  it("tiene vuelta atrás completa: trigger, función y columna", () => {
    const down = readFileSync(DOWN, "utf8");
    expect(down).toMatch(/drop trigger if exists trg_sellar_computa_cupo/);
    expect(down).toMatch(/drop function if exists public\.sellar_computa_cupo/);
    expect(down).toMatch(/drop column if exists computa_cupo/);
  });
});

describe("contarMasivas respeta el sello", () => {
  const src = readFileSync(METERING, "utf8");

  it("filtra computa_cupo = true además de propuesta_id no nulo (el sello manda, el enlace queda)", () => {
    const fn = src.slice(src.indexOf("async function contarMasivas"), src.indexOf("export interface EstadoCuota"));
    expect(fn).toMatch(/\.eq\("computa_cupo", true\)/);
    expect(fn).toMatch(/\.not\("propuesta_id", "is", null\)/);
  });

  it("el conteo NO reimplementa la regla (nada de fuente_clasificacion acá): la verdad está sellada en la fila", () => {
    expect(src).not.toMatch(/fuente_clasificacion/);
  });
});
