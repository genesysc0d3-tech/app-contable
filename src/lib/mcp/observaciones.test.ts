import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * CUARENTENA del texto del asistente (fundador 2026-09-06, "lo que haría
 * Anthropic"): lo que escribe el modelo del cliente es texto de un tercero.
 * Se guarda enlazado al documento para aprender DE LO QUE HIZO EL HUMANO
 * después, nunca del texto. Este censo sostiene las tres propiedades que
 * hacen eso verdad: (1) la tabla es de solo-lectura para el cliente y con tope
 * de largo; (2) la ruta registra solo lo que de verdad cambió; (3) nadie en la
 * capa de IA lee `motivo`.
 */
const MIG = "supabase/migrations/20260906120000_asistente_observaciones.sql";
const DOWN = "supabase/migrations/20260906120000_asistente_observaciones_DOWN.sql";
const ROUTE = "src/app/api/mcp/route.ts";

describe("asistente_observaciones — la migración deja el texto en cuarentena", () => {
  const sql = readFileSync(MIG, "utf8");

  it("RLS encendido y SOLO policy de select (escribe únicamente el service role)", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/for select/);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/);
  });

  it("lectura por la regla única de la cuenta (empresa_autorizada), no por usuario suelto", () => {
    expect(sql).toMatch(/empresa_id = \(select public\.empresa_autorizada\(\)\)/);
  });

  it("motivo con tope duro en la base y accion acotada a los dos verbos del conector", () => {
    expect(sql).toMatch(/char_length\(motivo\) <= 300/);
    expect(sql).toMatch(/accion in \('dejar_en_emitir', 'devolver_a_revision'\)/);
  });

  it("enlazada al documento (propuesta_id) y a la cuenta, con borrado en cascada", () => {
    expect(sql).toMatch(/propuesta_id uuid not null references public\.propuestas_ia\(id\) on delete cascade/);
    expect(sql).toMatch(/empresa_id uuid not null references public\.empresas\(id\) on delete cascade/);
    // si el token se borra la observación queda: es del cliente, no del token
    expect(sql).toMatch(/token_id uuid references public\.mcp_tokens\(id\) on delete set null/);
  });

  it("tiene vuelta atrás que borra la tabla y la policy", () => {
    const down = readFileSync(DOWN, "utf8");
    expect(down).toMatch(/drop table if exists public\.asistente_observaciones/);
    expect(down).toMatch(/drop policy if exists/);
  });
});

describe("la ruta del MCP registra observaciones solo de lo que cambió", () => {
  const src = readFileSync(ROUTE, "utf8");

  it("las DOS escrituras piden las filas tocadas (.select('id')) y registran ESOS ids, no los pedidos", () => {
    const bloques = src.match(/\.update\(\{ estado: "(aprobado|pendiente)" \}\)[\s\S]*?\.select\("id"\);[\s\S]*?const idsTocados = \(tocadas \?\? \[\]\)\.map\(\(r\) => r\.id\);[\s\S]*?await registrarObservaciones\("(dejar_en_emitir|devolver_a_revision)", idsTocados, motivo\)/g) ?? [];
    expect(bloques).toHaveLength(2);
  });

  it("el registro nunca tumba la escritura: va en try/catch y recorta a 300", () => {
    expect(src).toMatch(/const registrarObservaciones = async[\s\S]*?try \{[\s\S]*?motivo: motivo\.slice\(0, 300\)[\s\S]*?\} catch \{/);
  });
});

describe("cuarentena: nadie en la capa de IA lee el motivo del asistente", () => {
  it("ningún archivo de src/lib/ai ni de prompts menciona asistente_observaciones", () => {
    const ocurrencias = execSync(
      `grep -rl "asistente_observaciones" src/lib/ai src/lib/sii src/lib/intermediario 2>/dev/null || true`,
      { encoding: "utf8" },
    ).trim();
    expect(ocurrencias).toBe("");
  });

  it("la migración existe una sola vez (sin duplicados con otro timestamp)", () => {
    const iguales = readdirSync("supabase/migrations").filter((f) => f.includes("asistente_observaciones") && !f.includes("_DOWN"));
    expect(iguales).toHaveLength(1);
  });
});
