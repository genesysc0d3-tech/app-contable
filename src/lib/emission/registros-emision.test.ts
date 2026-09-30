import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILTRO_TIPOS_REGISTRO_EMISION, TIPOS_REGISTRO_EMISION, boletasUnicasSinDocumento, esRegistroEmision } from "./registros-emision";

// Incidente LC 2026-09-27: la cartola BCI de las 18:08 quedó bajo 358 filas
// "Boleta SII #… - consumidor final" y la mesa (limit 50) dejó de mostrarla.

describe("criterio de registro interno de emisión", () => {
  it("son exactamente los tipos que insertan los resultados de emisión", () => {
    const siiLocal = readFileSync(join(__dirname, "../../app/api/sii-local/result/route.ts"), "utf8");
    const simpleapi = readFileSync(join(__dirname, "../../app/api/simpleapi/result/route.ts"), "utf8");
    expect(siiLocal).toMatch(/tipo: "boleta_sii_local"/);
    expect(simpleapi).toMatch(/tipo: "dte_simpleapi"/);
    expect([...TIPOS_REGISTRO_EMISION].sort()).toEqual(["boleta_sii_local", "dte_simpleapi"]);
    expect(FILTRO_TIPOS_REGISTRO_EMISION).toBe("(boleta_sii_local,dte_simpleapi)");
  });
  it("una cartola o una solicitud de boleta/factura única NO es registro interno", () => {
    expect(esRegistroEmision("boleta_sii_local")).toBe(true);
    expect(esRegistroEmision("dte_simpleapi")).toBe(true);
    for (const t of ["excel", "pdf", "csv", "imagen", "boleta_unica", "", null]) expect(esRegistroEmision(t)).toBe(false);
  });
});

describe("boletasUnicasSinDocumento", () => {
  it("las boletas de una cartola (con propuesta) no vuelven como tarjeta sintética", () => {
    const lote = Array.from({ length: 358 }, (_, i) => ({ id: `b${i}`, propuesta_id: `p${i}` }));
    expect(boletasUnicasSinDocumento(lote, [])).toEqual([]);
  });
  it("la boleta única directa (sin propuesta) sí aparece, salvo que ya tenga fila", () => {
    const unica = { id: "u1", propuesta_id: null };
    const conFila = { id: "u2", propuesta_id: null };
    const docs = [{ progreso_ia: { boleta_id: "u2" } }, { progreso_ia: null }];
    expect(boletasUnicasSinDocumento([unica, conFila], docs)).toEqual([unica]);
  });
});

const v5 = (f: string) => readFileSync(join(__dirname, "../../app/(app)/escritorio/v5", f), "utf8");

describe("las listas de documentos de la mesa excluyen los registros de emisión (fuente)", () => {
  it("mesa-data: lista de documentos (limit 50) y puntos del calendario", () => {
    const src = v5("mesa-data.ts");
    const docs = src.split("\n").filter((l) => l.includes('from("documentos_subidos")'));
    expect(docs.length).toBeGreaterThanOrEqual(2);
    for (const l of docs) expect(l).toContain('.not("tipo", "in", FILTRO_TIPOS_REGISTRO_EMISION)');
  });
  it("mesa-data: la tarjeta sintética solo nace de boletas sin propuesta", () => {
    const src = v5("mesa-data.ts");
    expect(src).toMatch(/boletasUnicasSinDocumento\(boletasRango, docsBase\)/);
    expect(src).toMatch(/monto_exento,iva,estado,detalles,propuesta_id,ref/);
    expect(src).toMatch(/monto_exento,iva,estado,detalles,propuesta_id"\)/); // fallback sin ref
  });
  it("page.tsx: el buscador/historial tampoco se llena de registros", () => {
    const src = v5("page.tsx");
    expect(src).toMatch(/from\("documentos_subidos"\)[\s\S]{0,400}\.not\("tipo", "in", FILTRO_TIPOS_REGISTRO_EMISION\)[\s\S]{0,80}\.limit\(100\)/);
  });
});
