import { describe, expect, it } from "vitest";
import { contraparteVisible, mensajeDeshacer, ordenarAprendidas, textoAciertos, type ReglaAprendida } from "./lo-que-aprendi-util";

describe("Lo que aprendí — piezas puras", () => {
  it("la contraparte sale de la glosa viva, en tipo título; sin glosa → null (cartola borrada)", () => {
    expect(contraparteVisible("TRANSFERENCIA DE JUAN PEREZ 14:02")).toBe("Juan Perez");
    expect(contraparteVisible(null)).toBeNull();
    expect(contraparteVisible("  ")).toBeNull();
    // sin nombre reconocible NO se muestra la glosa cruda
    expect(contraparteVisible("TRANSFERENCIA 12.345.678-9 OP 99881")).toBeNull();
  });
  it("orden: no estoy seguro → aprendiendo → segura; más aciertos arriba", () => {
    const r = (id: string, estado: ReglaAprendida["estado"], aciertos: number): ReglaAprendida => ({ id, contraparte: null, tipo: "Exenta", aciertos, estado });
    expect(ordenarAprendidas([r("a", "firme", 9), r("b", "a_prueba", 1), r("c", "en_disputa", 0), r("d", "firme", 20)]).map((x) => x.id))
      .toEqual(["c", "b", "d", "a"]);
  });
  it("textos en idioma de la clienta", () => {
    expect(textoAciertos(0)).toBe("Todavía no acierta en una boleta");
    expect(textoAciertos(1)).toBe("Acertó 1 vez");
    expect(textoAciertos(1200)).toMatch(/^Acertó 1.200 veces$/);
    expect(mensajeDeshacer({ reevaluadas: 3, sinRegla: 2, enEmitir: 1 }))
      .toBe("Listo, ya no lo aplico. 3 movimientos volvieron a revisarse. 2 te esperan en Check. 1 ya estaba en Emitir: esa no la toqué.");
  });
});
