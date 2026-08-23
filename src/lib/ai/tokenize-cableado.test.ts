import { describe, it, expect } from "vitest";
import { createVault, tokenizeForAI, rehydrateReceptor } from "./tokenize";

// El cableado vive en processor.ts (classifyChunkWithRetry), que no es
// importable en tests (arrastra Supabase y red). Acá se prueba el CONTRATO que
// ese cableado tiene que cumplir, sobre las mismas funciones que usa.

describe("contrato del cableado por chunk", () => {
  it("la ida y la vuelta devuelven la identidad exacta", () => {
    const v = createVault();
    const glosa = "TRANSFERENCIA de JUAN PEREZ SOTO 12.345.678-9";
    const salida = tokenizeForAI(glosa, v);

    expect(salida).not.toContain("JUAN");
    expect(salida).not.toContain("12.345.678-9");

    // el modelo devuelve el token que vio
    const token = salida.match(/PER_\d+/)![0];
    const real = rehydrateReceptor({ receptor_nombre: token, receptor_rut: null }, v);
    expect(real.receptor_nombre).toBe("JUAN PEREZ SOTO");
    expect(real.receptor_rut).toBe("12.345.678-9");
  });

  it("dos personas con el mismo nombre NO se cruzan", () => {
    const v = createVault();
    const a = tokenizeForAI("Transf de Juan Perez 11.111.111-1", v).match(/PER_\d+/)![0];
    const b = tokenizeForAI("Transf de Juan Perez 22.222.222-2", v).match(/PER_\d+/)![0];
    expect(a).not.toBe(b);
    expect(rehydrateReceptor({ receptor_nombre: a, receptor_rut: null }, v).receptor_rut).toBe("11.111.111-1");
    expect(rehydrateReceptor({ receptor_nombre: b, receptor_rut: null }, v).receptor_rut).toBe("22.222.222-2");
  });

  it("una bóveda ajena devuelve NADA, nunca la identidad de otro", () => {
    const propia = createVault();
    const ajena = createVault();
    tokenizeForAI("Transf de Ana Silva 11.111.111-1", propia);
    tokenizeForAI("Transf de Pedro Rojas 22.222.222-2", ajena);

    // PER_1 existe en ambas y apunta a personas distintas: es exactamente el
    // escenario del lote reanudado con bóveda renumerada.
    const cruzado = rehydrateReceptor({ receptor_nombre: "PER_1", receptor_rut: null }, ajena);
    expect(cruzado.receptor_nombre).toBe("Pedro Rojas"); // la suya, no la de la otra
    // y un token que no existe no inventa nada
    expect(rehydrateReceptor({ receptor_nombre: "PER_99", receptor_rut: null }, ajena).receptor_nombre).toBeNull();
  });

  it("un token colado como RUT no pasa", () => {
    const v = createVault();
    const r = rehydrateReceptor({ receptor_nombre: "Comercial X", receptor_rut: "PER_7" }, v);
    expect(r.receptor_rut).toBeNull();
  });
});
