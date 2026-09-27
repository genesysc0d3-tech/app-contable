import { describe, expect, it } from "vitest";
import { createVault, rehydrateReceptor, tokenizeForAI } from "./tokenize";

// Incidente LC 2026-09-27: DeepSeek V4.1 (Fireworks) devuelve el receptor con la
// forma jurídica pegada ("PER_2 Limitada"). El token exacto se re-pegaba; el
// token dentro de un texto no, y el fail-closed tumbaba la cartola entera.
describe("re-pegar un token que viene dentro de un texto", () => {
  const vault = createVault();
  tokenizeForAI("Transferencia a Proveedora Ficticia Limitada", vault);

  it("'PER_1 Limitada' vuelve con el nombre real y sin marcador", () => {
    const r = rehydrateReceptor({ receptor_nombre: "PER_1 Limitada", receptor_rut: null }, vault);
    expect(r.receptor_nombre).toBe("Proveedora Ficticia Limitada");
  });

  it("un token inventado dentro del texto se descarta, nunca pasa literal", () => {
    const r = rehydrateReceptor({ receptor_nombre: "PER_9 SpA", receptor_rut: null }, vault);
    expect(r.receptor_nombre).toBeNull();
  });

  it("un RUT con marcador adentro se descarta", () => {
    expect(rehydrateReceptor({ receptor_nombre: null, receptor_rut: "RUT PER_1" }, vault).receptor_rut).toBeNull();
    expect(rehydrateReceptor({ receptor_nombre: null, receptor_rut: "[NUM]" }, vault).receptor_rut).toBeNull();
  });

  it("un nombre normal no se toca", () => {
    const r = rehydrateReceptor({ receptor_nombre: "Comercial Andes SpA", receptor_rut: "76.123.456-7" }, vault);
    expect(r).toEqual({ receptor_nombre: "Comercial Andes SpA", receptor_rut: "76.123.456-7" });
  });
});
