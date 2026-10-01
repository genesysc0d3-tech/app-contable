import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CuadreCartola } from "@/lib/cartola/cuadre";

// El popup "Revisa las columnas" REEMPLAZA la tarjeta "Así la leímos"
// (2026-09-30): una sola pantalla. En el visor queda solo un aviso de una línea
// con el botón para volver a abrirlo, por si la clienta lo cerró.

vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("./cuadre-actions", () => ({ agregarFilasFaltantes: async () => ({ ok: true }) }));
vi.mock("./revisar-shared", () => ({ fmt: (n: number) => `$${Math.round(n).toLocaleString("es-CL")}` }));

const cuadre: CuadreCartola = {
  ok: true, hoja: "Cartola", filas_con_monto: 3, guardadas: 3, duplicadas: 0, descartes_legitimos: 0,
  perdidas: [], monto_perdido: 0, abonos: 150_000, cargos: 30_000, otras_hojas_con_datos: [],
  db: { movimientos: 3, propuestas: 3, ok: true }, calculado_en: "2026-09-30T00:00:00Z",
  verificacion: { tipo: "sin_comprobar", detalle: "No trae saldo ni totales" },
  mapa: { adapter_id: "a", estado: "provisorio", nuevo: true },
};
const doc = (c: CuadreCartola) => ({ id: "d1", nombre_archivo: "cartola.xlsx", movimientos_detectados: 3, progreso_ia: { cuadre: c } });
const props = (c: CuadreCartola) => ({ doc: doc(c), propuestas: [], empresaId: "e", onClose: () => {}, onEditar: () => {}, onAprobar: () => {}, onRevisarColumnas: () => {} });

describe("la tarjeta 'Así la leímos' ya no existe", () => {
  it("LecturaMuestra y su server action se borraron", () => {
    expect(existsSync("src/app/(app)/escritorio/v5/LecturaMuestra.tsx")).toBe(false);
    expect(existsSync("src/app/(app)/escritorio/v5/lectura-actions.ts")).toBe(false);
  });

  it("revisión de columnas pendiente: el visor deja un CTA grande 'Revisar columnas' con el porqué, sin Editar ni Aprobar", async () => {
    const { default: VeredictoCartola } = await import("./VeredictoCartola");
    const html = renderToStaticMarkup(createElement(VeredictoCartola, props(cuadre)));
    expect(html).toContain('data-testid="cta-columnas"');
    expect(html).toContain("Revisar columnas");
    expect(html).toMatch(/no pudimos comprobar/i);
    expect(html).not.toMatch(/>\s*Editar\s*</);
    expect(html).not.toContain("Aprobar");
    expect(html).not.toContain("Así la leímos");
    expect(html).not.toContain("Se ve bien");
    expect(html).not.toContain("Saldo final en tu portal");
  });

  it("sin revisión pendiente (formato confirmado, nada raro): el visor de siempre, intacto", async () => {
    const { default: VeredictoCartola } = await import("./VeredictoCartola");
    const ok: CuadreCartola = { ...cuadre, mapa: { adapter_id: "a", estado: "confirmado", nuevo: false } };
    const html = renderToStaticMarkup(createElement(VeredictoCartola, props(ok)));
    expect(html).not.toContain('data-testid="cta-columnas"');
    expect(html).not.toContain("Revisar columnas");
    expect(html).toMatch(/Editar/);
    expect(html).toContain("Aprobar");
  });

  it("cartola comprobada sola (saldo) o confirmada por el cliente: el visor de siempre", async () => {
    const { default: VeredictoCartola } = await import("./VeredictoCartola");
    for (const v of [{ tipo: "saldo" as const, detalle: "" }, { tipo: "cliente" as const, detalle: "" }]) {
      const html = renderToStaticMarkup(createElement(VeredictoCartola, props({ ...cuadre, verificacion: v })));
      expect(html).not.toContain('data-testid="cta-columnas"');
      expect(html).toContain("Aprobar");
    }
  });

  it("formato confirmado pero ESTE archivo no calza: el CTA dice por qué", async () => {
    const { default: VeredictoCartola } = await import("./VeredictoCartola");
    const raro: CuadreCartola = { ...cuadre, verificacion: { tipo: "sin_comprobar", alerta: true, detalle: "2 fila(s) oculta(s) con plata" }, mapa: { adapter_id: "a", estado: "confirmado", nuevo: false } };
    const html = renderToStaticMarkup(createElement(VeredictoCartola, props(raro)));
    expect(html).toContain('data-testid="cta-columnas"');
    expect(html).toContain("Esta vez algo no calza");
  });
});

describe("el popup muestra fechas y montos legibles (solo presentación)", () => {
  it("serial de Excel → dd/mm/aaaa; monto sin formato → $94.000; el resto tal cual", async () => {
    const { celdaLegible } = await import("@/components/upload/FieldMapper");
    expect(celdaLegible("46296.375", "fecha")).toBe("01/10/2026");
    expect(celdaLegible("05/10/2026", "fecha")).toBe("05/10/2026");
    expect(celdaLegible("94000", "abono")).toBe("$94.000");
    expect(celdaLegible("-12500.5", "monto")).toBe("-$12.501");
    expect(celdaLegible("$ 1.234", "cargo")).toBe("$ 1.234");
    expect(celdaLegible("100201", "n_documento")).toBe("100201");
    expect(celdaLegible("94000", "ignorar")).toBe("94000");
  });
});

describe("resumen en vivo del popup", () => {
  it("una frase en chileno simple, sin jerga", async () => {
    const { LineaResumen } = await import("@/components/upload/FieldMapper");
    const html = renderToStaticMarkup(createElement(LineaResumen, {
      cargando: false,
      resumen: { valido: true, entradas: { n: 30, monto: 1_234_000 }, salidas: { n: 10, monto: 56_700 }, desde: "2026-09-01", hasta: "2026-09-28", estado: "sin_comprobar", motivo: "No trae saldo", contradice: false, soloAbonos: false, noLeidas: 0, guardable: true, firma: "x" },
    }));
    expect(html).toContain("Con estas columnas quedan");
    expect(html).toMatch(/30.*entradas.*1\.234\.000/);
    expect(html).toMatch(/10.*salidas.*56\.700/);
    expect(html).toContain("del 01/09 al 28/09");
    expect(html).not.toMatch(/adapter|mapeo|sello/i);
  });

  it("si el banco contradice las columnas lo dice claro", async () => {
    const { LineaResumen } = await import("@/components/upload/FieldMapper");
    const html = renderToStaticMarkup(createElement(LineaResumen, {
      cargando: false,
      resumen: { valido: true, entradas: { n: 1, monto: 1 }, salidas: { n: 1, monto: 1 }, desde: null, hasta: null, estado: "alerta", motivo: "El saldo corrido no cierra", contradice: true, soloAbonos: false, noLeidas: 0, guardable: false, firma: "x" },
    }));
    expect(html).toContain("no calza con tu banco");
  });
});

describe("el popup se abre SOLO una vez, donde la clienta está mirando", () => {
  const ahora = new Date("2026-09-30T12:00:00Z").getTime();
  const reciente = { id: "d1", estado: "procesado", created_at: "2026-09-30T11:55:00Z", progreso_ia: { cuadre } };
  it("abre la cartola recién procesada que lo necesita", async () => {
    const { docParaAbrirSolo } = await import("./revisar-columnas-auto");
    expect(docParaAbrirSolo([reciente], { vistosProcesando: new Set(), yaAbiertos: new Set(), ahora })?.id).toBe("d1");
  });
  it("no la vuelve a abrir si ya se abrió (la cerró: queda el aviso)", async () => {
    const { docParaAbrirSolo } = await import("./revisar-columnas-auto");
    expect(docParaAbrirSolo([reciente], { vistosProcesando: new Set(), yaAbiertos: new Set(["d1"]), ahora })).toBeNull();
  });
  it("no abre cartolas viejas (solo las que se subieron hace poco o se vieron procesando)", async () => {
    const { docParaAbrirSolo } = await import("./revisar-columnas-auto");
    const vieja = { ...reciente, created_at: "2026-09-01T10:00:00Z" };
    expect(docParaAbrirSolo([vieja], { vistosProcesando: new Set(), yaAbiertos: new Set(), ahora })).toBeNull();
    expect(docParaAbrirSolo([vieja], { vistosProcesando: new Set(["d1"]), yaAbiertos: new Set(), ahora })?.id).toBe("d1");
  });
  it("no abre si la cartola entró sola (formato confirmado) o sigue procesando", async () => {
    const { docParaAbrirSolo } = await import("./revisar-columnas-auto");
    const sola = { ...reciente, progreso_ia: { cuadre: { ...cuadre, mapa: { adapter_id: "a", estado: "confirmado", nuevo: false } } } };
    expect(docParaAbrirSolo([sola], { vistosProcesando: new Set(), yaAbiertos: new Set(), ahora })).toBeNull();
    expect(docParaAbrirSolo([{ ...reciente, estado: "procesando" }], { vistosProcesando: new Set(), yaAbiertos: new Set(), ahora })).toBeNull();
  });
});

describe("la mesa no repite documentos", () => {
  it("sinDocsRepetidos deja una sola vez cada id (la primera)", async () => {
    const { sinDocsRepetidos } = await import("./mesa-data-util");
    expect(sinDocsRepetidos([{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "a", n: 3 }]).map((d) => d.n)).toEqual([1, 2]);
  });
});
