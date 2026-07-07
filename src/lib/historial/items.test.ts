import { describe, it, expect } from "vitest";
import { buildPropuestaItem, propuestaReceptorMinimizado } from "./items";
import { RECEPTOR_OBLIGATORIO_DESDE } from "../sii/validation";

const UMBRAL = RECEPTOR_OBLIGATORIO_DESDE; // ≈ $5.482.485 (135 UF)

const propBajoUmbral = {
  id: "abc",
  confianza: 0.95,
  created_at: "2026-01-20T12:00:00Z",
  receptor_rut: "18512171-2",
  receptor_razon_social: "YUNISBELL ALEJANDRA",
  movimientos_raw: {
    descripcion: "Transf de YUNISBELL ALEJANDRA",
    monto: 1000,
    fecha: "2026-01-20",
    documentos_subidos: { id: "doc-777" },
  },
};

const propSobreUmbral = {
  ...propBajoUmbral,
  id: "xyz",
  movimientos_raw: { ...propBajoUmbral.movimientos_raw, monto: 6_000_000 },
};

describe("propuestaReceptorMinimizado", () => {
  it("minimiza bajo umbral y NO sobre umbral (una sola fuente: receptorObligatorio)", () => {
    expect(propuestaReceptorMinimizado(1000, UMBRAL)).toBe(true);
    expect(propuestaReceptorMinimizado(6_000_000, UMBRAL)).toBe(false);
    // exactamente en el umbral: identificar es OPCIONAL → minimizado
    expect(propuestaReceptorMinimizado(UMBRAL, UMBRAL)).toBe(true);
  });
  it("trata monto nulo/negativo de forma conservadora (minimiza)", () => {
    expect(propuestaReceptorMinimizado(null, UMBRAL)).toBe(true);
    expect(propuestaReceptorMinimizado(-999, UMBRAL)).toBe(true);
  });
});

describe("buildPropuestaItem — minimización de terceros (Ley 19.628)", () => {
  it("bajo umbral: el nombre del tercero NO aparece en NINGUNA parte del item", () => {
    const item = buildPropuestaItem(propBajoUmbral, UMBRAL);
    expect(item.label).toBe("Propuesta · Consumidor final");
    expect(item.data?.receptor_minimizado).toBe(true);
    // el nombre no debe estar en el título, la data ni la glosa
    expect(item.data?.receptor_razon_social).toBeUndefined();
    expect(item.data?.receptor_rut).toBeUndefined();
    expect((item.data?.movimientos_raw as { descripcion?: string })?.descripcion).toBeUndefined();
    // prueba end-to-end: NADA de lo que viaja al cliente contiene el nombre
    // (lo que no está en el item no se puede mostrar ni buscar)
    expect(JSON.stringify(item).toLowerCase()).not.toContain("yunisbell");
  });

  it("bajo umbral: conserva lo NO identificatorio (monto, fecha, documento) para actuar", () => {
    const item = buildPropuestaItem(propBajoUmbral, UMBRAL);
    const mr = item.data?.movimientos_raw as { monto?: number; fecha?: string; documentos_subidos?: { id?: string } };
    expect(mr.monto).toBe(1000);
    expect(mr.fecha).toBe("2026-01-20");
    expect(mr.documentos_subidos?.id).toBe("doc-777"); // necesario para el salto massdte:open-doc
  });

  it("sobre umbral: la ley obliga a identificar → se conserva el nombre", () => {
    const item = buildPropuestaItem(propSobreUmbral, UMBRAL);
    expect(item.label).toBe("Propuesta · Transf de YUNISBELL ALEJANDRA");
    expect(item.data?.receptor_minimizado).toBe(false);
    expect(item.data?.receptor_razon_social).toBe("YUNISBELL ALEJANDRA");
    expect((item.data?.movimientos_raw as { descripcion?: string })?.descripcion).toBe("Transf de YUNISBELL ALEJANDRA");
  });
});
