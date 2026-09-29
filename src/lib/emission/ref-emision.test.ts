import { describe, expect, it } from "vitest";
import { ALFABETO_REF, consultaConRef, controlRef, faltaColumnaRef, formatoRef, normalizarRef, refValida } from "./ref-emision";

describe("consultaConRef (Registro de Ventas con la columna Ref.)", () => {
  it("pide `ref` junto a las columnas base y devuelve esa respuesta", async () => {
    const pedidas: string[] = [];
    const r = await consultaConRef(async (cols) => { pedidas.push(cols); return { data: [{ id: "1", ref: "R-7F3-KXH" }], error: null }; }, "id,folio");
    expect(pedidas).toEqual(["id,folio,ref"]);
    expect(r.data).toEqual([{ id: "1", ref: "R-7F3-KXH" }]);
  });
  it("sin la columna (migración sin aplicar) repite sin `ref` y no se cae", async () => {
    const pedidas: string[] = [];
    const r = await consultaConRef(async (cols) => {
      pedidas.push(cols);
      return cols.endsWith(",ref")
        ? { data: null, error: { code: "42703", message: "column boletas_emitidas.ref does not exist" } }
        : { data: [{ id: "1" }], error: null };
    }, "id,folio");
    expect(pedidas).toEqual(["id,folio,ref", "id,folio"]);
    expect(r).toEqual({ data: [{ id: "1" }], error: null });
  });
  it("otro error NO se oculta con un reintento", async () => {
    let n = 0;
    const r = await consultaConRef(async () => { n++; return { data: null, error: { code: "57014", message: "timeout" } }; }, "id");
    expect(n).toBe(1);
    expect(r.error?.code).toBe("57014");
    expect(faltaColumnaRef(null)).toBe(false);
  });
});

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
    const tabla = leer("src/app/(app)/escritorio/v5/sections/BoletasMensualesView.tsx");
    expect(tabla).toContain("<span>Ref.</span>");
    expect(tabla).toContain('import RefChip from "@/components/boletas/RefChip"');
    expect(tabla).toContain("<RefChip ref_={b.ref ?? null} />");
  });
  it("'Últimas emitidas' de la mesa (boletas Y facturas) usa el mismo RefChip, al lado del folio", () => {
    const mesa = leer("src/app/(app)/escritorio/v5/Mesa.tsx");
    expect(mesa).toContain('import RefChip from "@/components/boletas/RefChip"');
    // La MISMA lista sirve a las dos mesas (pestaña "Boletas"/"Facturas"): sin rama por tipo.
    expect(mesa).toContain('boletasLabel={mesa.mesaActiva === "factura" ? "Facturas" : "Boletas"}');
    const folio = mesa.indexOf("#{b.folio}</span>");
    const chip = mesa.indexOf("<RefChip ref_={b.ref ?? null} />");
    expect(folio).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(folio);
    // Nada entre el folio y la ref salvo el comentario y el contenedor de ancho fijo.
    expect(mesa.slice(folio, chip)).not.toMatch(/etiquetaTipo|es_unica/);
    // La lista de la mesa de facturas trae la ref del server (33/34 viven en boletas_emitidas).
    const data = leer("src/app/(app)/escritorio/v5/mesa-data.ts");
    expect(data).toContain('const tiposDteMesa = mesaActiva === "factura" ? [33, 34] : [39, 41];');
    expect(data).toMatch(/select\("id,folio,tipo_dte,[^"]*,ref"\)\.eq\("empresa_id", empresaId\)\.in\("tipo_dte", tiposDteMesa\)/);
  });
  it("el Registro de Ventas pide `ref` también en la carga inicial (antes: '—' en todo el mes actual)", () => {
    const page = leer("src/app/(app)/escritorio/v5/page.tsx");
    expect(page).toMatch(/consultaConRef\(\(columnas\) => supabase\.from\("boletas_emitidas"\)\s*\.select\(columnas\)/);
    expect(page).not.toContain('.select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")\n      .eq("empresa_id", empresaId)\n      .gte("fecha_emision", firstThisMonth)');
  });
  it("RefChip es solo pantalla: ni el PDF ni la vista previa imprimible la usan", () => {
    for (const f of [
      "src/lib/pdf/boleta-pdf.ts",
      "src/lib/pdf/boleta-personalizada.ts",
      "src/lib/pdf/factura-personalizada.ts",
      "src/lib/pdf/baseapi-pdf.ts",
      "src/lib/pdf/datos-oficiales-dte.ts",
      "src/components/boletas/PreviewBoletaButton.tsx",
      "src/components/boletas/DescargarBoletaButton.tsx",
    ]) {
      const src = leer(f);
      // `.ref` / `ref:` / `"ref"` = la columna; un `ref={...}` de React no cuenta.
      expect(src, f).not.toMatch(/\.ref\b|\bref\s*:|["'`]ref["'`]|RefChip|ref_/);
    }
  });
  it("el buscador del historial (boletas Y facturas) encuentra por ref y la muestra en la ficha", () => {
    const page = leer("src/app/(app)/escritorio/v5/page.tsx");
    expect(page).toMatch(/consultaConRef\(\(columnas\) => supabase\.from\("boletas_emitidas"\)\.select\(columnas\)\s*\.eq\("empresa_id", empresaId\)\.order\("fecha_emision",\{ascending:false\}\)\.order\("folio",\{ascending:false\}\)\.limit\(100\)/);
    const vista = leer("src/app/(app)/escritorio/v5/SearchHistoryView.tsx");
    expect(vista).toContain('String(d.ref ?? "").replace(/-/g, "")');
    expect(vista).toContain('<Row label="Ref.">{String(d.ref ?? "—")}</Row>');
  });
  it("el doble folio lleva la MISMA ref de la propuesta (queda visible)", () => {
    const src = leer("src/app/api/sii-local/result/route.ts");
    expect(src).toContain("propuesta_id: null, ...(await conRef(sb, args.empresaId, args.propuestaId))");
    expect(src).toContain("propuesta_id: null, ...(await conRef(sb, empresaId, job.propuesta_id))");
    // Sin la migración, mandar `ref` (aunque sea null) rompería el insert de un folio real.
    expect(src).toContain("return ref ? { ref } : {};");
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
