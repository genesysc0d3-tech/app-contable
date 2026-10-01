import { describe, expect, it } from "vitest";
import { traerTodasLasFilas } from "./paginar";

// Simula PostgREST: corta cada respuesta en max-rows (1000) aunque se pida más.
function tablaFalsa(n: number, maxRows = 1000) {
  const filas = Array.from({ length: n }, (_, i) => ({ id: i, monto_total: 1000 }));
  const pedidos: Array<[number, number]> = [];
  const pagina = (desde: number, hasta: number) => {
    pedidos.push([desde, hasta]);
    const fin = Math.min(hasta + 1, desde + maxRows);
    return Promise.resolve({ data: filas.slice(desde, fin), error: null });
  };
  return { pagina, pedidos };
}

describe("traerTodasLasFilas", () => {
  it("1437 boletas (caso real sept 2026) → suma y conteo EXACTOS, no 1000", async () => {
    const { pagina, pedidos } = tablaFalsa(1437);
    const r = await traerTodasLasFilas(pagina);
    expect(r.data.length).toBe(1437);
    expect(r.data.reduce((s, b) => s + b.monto_total, 0)).toBe(1_437_000);
    expect(r.truncado).toBe(false);
    expect(pedidos).toEqual([[0, 999], [1000, 1999]]);
  });

  it("múltiplo exacto de 1000: una página vacía cierra el bucle", async () => {
    const { pagina, pedidos } = tablaFalsa(2000);
    const r = await traerTodasLasFilas(pagina);
    expect(r.data.length).toBe(2000);
    expect(pedidos.length).toBe(3);
  });

  it("menos de una página: un solo pedido", async () => {
    const { pagina, pedidos } = tablaFalsa(12);
    expect((await traerTodasLasFilas(pagina)).data.length).toBe(12);
    expect(pedidos.length).toBe(1);
  });

  it("tope de páginas → truncado true (se avisa, no se miente)", async () => {
    const { pagina } = tablaFalsa(5000);
    const r = await traerTodasLasFilas(pagina, { topePaginas: 2 });
    expect(r.data.length).toBe(2000);
    expect(r.truncado).toBe(true);
  });

  it("un error corta y se devuelve", async () => {
    const r = await traerTodasLasFilas(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    expect(r.error?.message).toBe("boom");
  });
});
