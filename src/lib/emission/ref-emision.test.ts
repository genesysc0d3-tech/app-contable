import { describe, expect, it } from "vitest";
import { ALFABETO_REF, controlRef, formatoRef, normalizarRef, refValida } from "./ref-emision";

describe("ref interna R-XXX-XXX", () => {
  it("alfabeto sin vocales ni confundibles (0/O, 1/I/L, U, V)", () => {
    expect(ALFABETO_REF).toHaveLength(24);
    for (const ch of "AEIOU01LV") expect(ALFABETO_REF).not.toContain(ch);
  });
  it("vectores dorados (paridad con la función SQL emision_ref_nueva)", () => {
    expect(formatoRef("7F3KX")).toBe("R-7F3-KXH");
    expect(formatoRef("22222")).toBe("R-222-222");
    expect(formatoRef("ZZZZZ")).toBe("R-ZZZ-ZZ7");
    expect(formatoRef("BCD9M")).toBe("R-BCD-9MF");
  });
  it("formato y dígito de control", () => {
    const r = formatoRef("7F3KX")!;
    expect(r).toMatch(/^R-[23456789BCDFGHJKMNPRSTXZ]{3}-[23456789BCDFGHJKMNPRSTXZ]{3}$/);
    expect(refValida(r)).toBe(true);
  });
  it("detecta cualquier carácter cambiado", () => {
    const r = formatoRef("7F3KX")!;
    const cuerpo = r.replace(/[R-]/g, "");
    for (let i = 0; i < 6; i++) {
      for (const ch of ALFABETO_REF) {
        if (ch === cuerpo[i]) continue;
        const mal = cuerpo.slice(0, i) + ch + cuerpo.slice(i + 1);
        expect(refValida(mal)).toBe(false);
      }
    }
  });
  it("detecta dos vecinos invertidos", () => {
    const r = formatoRef("7F3KX")!;
    const c = r.replace(/[R-]/g, "");
    for (let i = 0; i < 5; i++) {
      if (c[i] === c[i + 1]) continue;
      const inv = c.slice(0, i) + c[i + 1] + c[i] + c.slice(i + 2);
      expect(refValida(inv)).toBe(false);
    }
  });
  it("normaliza lo dictado o tipeado", () => {
    const r = formatoRef("7F3KX")!;
    const cuerpo = r.replace(/[R-]/g, "");
    expect(normalizarRef(cuerpo.toLowerCase())).toBe(r);
    expect(normalizarRef(`r ${cuerpo.slice(0, 3)} ${cuerpo.slice(3)}`)).toBe(r);
    expect(normalizarRef("R-7F0-KX9")).toBeNull(); // 0 no existe en el alfabeto
    expect(controlRef("7F3K")).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("la ref se VE (fuente) y NO se imprime", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
  it("columna 'Ref.' en la tabla de Boletas/Facturas y junto al folio en la mesa", () => {
    expect(leer("src/app/(app)/escritorio/v5/sections/BoletasMensualesView.tsx")).toContain("<span>Ref.</span>");
    expect(leer("src/app/(app)/escritorio/v5/Mesa.tsx")).toContain("b.ref &&");
  });
  it("el doble folio lleva la MISMA ref de la propuesta (queda visible)", () => {
    const src = leer("src/app/api/sii-local/result/route.ts");
    expect(src).toContain("propuesta_id: null, ref: await refDePropuesta(sb, args.empresaId, args.propuestaId)");
    expect(src).toContain("propuesta_id: null, ref: await refDePropuesta(sb, empresaId, job.propuesta_id)");
  });
  it("el trigger nunca bloquea guardar una boleta", () => {
    expect(leer("supabase/migrations/20260928120000_emision_refs.sql")).toMatch(/exception when others then\s+new\.ref := null;/);
  });
  it("nunca viaja a la boleta del SII (no está en el payload del job)", () => {
    expect(leer("src/lib/emission/boleta-job-payload.ts")).not.toMatch(/\bref\b/);
  });
  it("la regex de la migración calza con el formato de la app", () => {
    const sql = leer("supabase/migrations/20260928120000_emision_refs.sql");
    expect(sql).toContain("'^R-[23456789BCDFGHJKMNPRSTXZ]{3}-[23456789BCDFGHJKMNPRSTXZ]{3}$'");
    expect(sql).toContain(`alfabeto constant text := '${ALFABETO_REF}'`);
  });
});
