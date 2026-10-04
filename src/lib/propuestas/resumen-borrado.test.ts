import { describe, expect, it } from "vitest";
import { resumenPropuestasABorrar, sanearResumen } from "./resumen-borrado";

describe("resumen de borrados — solo conteos, nunca PII", () => {
  it("deja pasar los conteos con claves de código", () => {
    const r = sanearResumen({
      total: 3, editadas: 1, sin_foto: 2,
      por_fuente: { regla: 2, ia_opencode: 1 }, por_estado: { pendiente: 3 },
      por_tipo_dte: { "41": 2, sin_tipo: 1 }, por_tipo_dte_fuente: { desconocido: 3 }, por_banda_confianza: { alta: 3 },
    });
    expect(r).toEqual({
      total: 3, editadas: 1, sin_foto: 2,
      por_fuente: { regla: 2, ia_opencode: 1 }, por_estado: { pendiente: 3 },
      por_tipo_dte: { "41": 2, sin_tipo: 1 }, por_tipo_dte_fuente: { desconocido: 3 }, por_banda_confianza: { alta: 3 },
    });
  });
  it("bota claves con texto libre y claves desconocidas (glosa, receptor, RUT)", () => {
    const r = sanearResumen({
      total: 1, descripcion: "TRANSF DE JUAN PEREZ", receptor_rut: "11.111.111-1",
      por_fuente: { "JUAN PEREZ 11.111.111-1": 1, regla: 1 }, por_estado: { pendiente: "x" },
    });
    expect(JSON.stringify(r)).not.toMatch(/JUAN|11\.111|descripcion|receptor/);
    expect(r?.por_fuente).toEqual({ regla: 1 });
    expect(r?.por_estado).toEqual({});
  });
  it("si la base no tiene la función (o falla) → null, sin lanzar", async () => {
    expect(await resumenPropuestasABorrar({ rpc: async () => ({ data: null, error: { message: "no existe" } }) }, { empresaId: "E1", documentoId: "D1" })).toBeNull();
    expect(await resumenPropuestasABorrar({ rpc: async () => { throw new Error("red"); } }, { empresaId: "E1", documentoId: "D1" })).toBeNull();
    expect(await resumenPropuestasABorrar({}, { empresaId: "E1", documentoId: "D1" })).toBeNull();
  });
  it("llama a la función con los parámetros de la migración", async () => {
    let args: unknown;
    await resumenPropuestasABorrar({ rpc: async (_f: string, a: unknown) => { args = a; return { data: { total: 0 }, error: null }; } }, { empresaId: "E1", propuestaId: "P1" });
    expect(args).toEqual({ p_empresa_id: "E1", p_documento_id: null, p_propuesta_id: "P1" });
  });
});
