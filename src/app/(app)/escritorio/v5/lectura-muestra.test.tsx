import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CuadreCartola } from "@/lib/cartola/cuadre";

// Punto 8: la tarjeta "Así la leímos" (render estático, sin DOM ni red).
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("./lectura-actions", () => ({ confirmarLecturaCartola: async () => ({ ok: true, mensaje: "ok" }) }));
vi.mock("./revisar-shared", () => ({ fmt: (n: number) => `$${Math.round(n).toLocaleString("es-CL")}` }));

const cuadre: CuadreCartola = {
  ok: true, hoja: "Cartola", filas_con_monto: 3, guardadas: 3, duplicadas: 0, descartes_legitimos: 0,
  perdidas: [], monto_perdido: 0, abonos: 150_000, cargos: 30_000, otras_hojas_con_datos: [],
  db: { movimientos: 3, propuestas: 3, ok: true }, calculado_en: "2026-09-30T00:00:00Z",
  verificacion: { tipo: "sin_comprobar", detalle: "sin saldo" },
  saldo_inicial: null, saldo_final: null, cuenta: null,
  muestra: [
    { excel_row: 2, fecha: "2026-09-01", descripcion: "Transferencia recibida", monto: 100_000, tipo_flujo: "entrada" },
    { excel_row: 3, fecha: "2026-09-02", descripcion: "Pago proveedor", monto: 30_000, tipo_flujo: "salida" },
  ],
};

describe("LecturaMuestra", () => {
  it("muestra la muestra, los dos botones y el campo del saldo final, en chileno simple", async () => {
    const { default: LecturaMuestra } = await import("./LecturaMuestra");
    const html = renderToStaticMarkup(createElement(LecturaMuestra, { documentoId: "d1", cuadre, onCorregirColumnas: () => {} }));
    expect(html).toContain("Revisa cómo leímos tu cartola");
    expect(html).toContain("Así la leímos");
    expect(html).toContain("Transferencia recibida");
    expect(html).toContain("Se ve bien");
    expect(html).toContain("Corregir columnas");
    expect(html).toContain("Saldo final en tu portal del banco");
    // Sin saldo inicial conocido ni cuenta para encadenar: pide también el inicio.
    expect(html).toContain("Saldo al inicio");
    // Colores por variables del tema (claro/oscuro), nada fijo.
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("sin mapeador disponible no ofrece 'Corregir columnas'", async () => {
    const { default: LecturaMuestra } = await import("./LecturaMuestra");
    const html = renderToStaticMarkup(createElement(LecturaMuestra, { documentoId: "d1", cuadre }));
    expect(html).not.toContain("Corregir columnas");
  });
});
