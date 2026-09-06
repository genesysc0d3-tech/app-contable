import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Team Business fase 4 (2026-09-06): gris de emisión con dueño y avance, y
 * microatribución. Regla de mantención: piezas cuyo modo de falla es "no pasa
 * nada visible". Este censo sostiene que el avance y la atribución solo se
 * calculan con equipo, que se leen del estado REAL (jobs completados, auditoría
 * existente) y que fallan en silencio.
 */
const JOBS = "src/app/api/emision/jobs/route.ts";
const ACTIONS = "src/app/(app)/escritorio/v5/actions.ts";
const ATRIB = "src/app/(app)/escritorio/v5/AtribucionDoc.tsx";
const MESA = "src/app/(app)/escritorio/v5/MesaTab.tsx";

describe("gris de emisión con dueño y avance", () => {
  const src = readFileSync(JOBS, "utf8");
  const fn = src.slice(src.indexOf("async function bloqueoActual"), src.indexOf("async function serviceClientOrResponse"));

  it("el avance se lee de jobs COMPLETADOS con propuesta del mismo usuario en la última hora — y solo en businessMode", () => {
    expect(fn).toMatch(/const \[usuario, avance\] = businessMode\s*\? await Promise\.all\(/);
    expect(fn).toMatch(/\.eq\("usuario_id", lock\.usuario_id\)[\s\S]*?\.eq\("estado", "completed"\)[\s\S]*?\.not\("propuesta_id", "is", null\)/);
    expect(fn).toMatch(/60 \* 60 \* 1000/);
    expect(fn).toMatch(/: \[null, 0\];/);
    expect(fn).toMatch(/avance,\s*\}\);/);
  });
});

describe("microatribución", () => {
  const src = readFileSync(ACTIONS, "utf8");
  const fn = src.slice(src.indexOf("export async function atribucionDeDoc"));

  it("solo con equipo; lee la auditoría existente por recurso_id; jamás lanza", () => {
    expect(fn).toMatch(/if \(plan\?\.equipo !== true\) return null;/);
    expect(fn).toMatch(/from\("cuenta_audit_events"\)[\s\S]*?\.eq\("recurso_id", id\)/);
    expect(fn).toMatch(/\} catch \{\s*return null;\s*\}/);
  });

  it("el componente no pinta nada si no hay atribución, y la mesa lo monta sobre el visor por documento", () => {
    const comp = readFileSync(ATRIB, "utf8");
    expect(comp).toMatch(/if \(!a\) return null;/);
    const mesa = readFileSync(MESA, "utf8");
    expect(mesa).toMatch(/\{selDoc && <AtribucionDoc key=\{selDoc\.id\} documentoId=\{selDoc\.id\} \/>\}/);
  });
});
