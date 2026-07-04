import { describe, expect, it } from "vitest";
import { selectAdapterForEmpresa, type AdapterOwnership } from "./adapter-store";

// Regresión del fix cross-tenant (auditoría 2026-07-04): el mapeo 'manual' de una
// empresa NO debe aplicarse a las cartolas de otra con el mismo formato de banco.
const A = "empresa-A";
const B = "empresa-B";
const row = (o: Partial<AdapterOwnership>): AdapterOwnership => ({
  confianza: 1,
  disabled_until: null,
  creado_por_empresa_id: null,
  ...o,
});

describe("selectAdapterForEmpresa — aislamiento cross-tenant del parser", () => {
  it("NO aplica el adapter manual de otra empresa (raíz del envenenamiento)", () => {
    const rows = [row({ creado_por_empresa_id: A })];
    expect(selectAdapterForEmpresa(rows, B)).toBeNull();
  });

  it("prefiere el adapter propio de la empresa", () => {
    const propio = row({ creado_por_empresa_id: A });
    const rows = [row({ creado_por_empresa_id: null }), propio];
    expect(selectAdapterForEmpresa(rows, A)).toBe(propio);
  });

  it("cae a un adapter global sin dueño (heurístico), seguro de compartir", () => {
    const global = row({ creado_por_empresa_id: null });
    const rows = [row({ creado_por_empresa_id: A }), global];
    expect(selectAdapterForEmpresa(rows, B)).toBe(global);
  });

  it("descarta filas deshabilitadas y de confianza bajo el umbral", () => {
    const now = new Date("2026-07-04T00:00:00Z");
    const futuro = new Date("2026-07-04T01:00:00Z").toISOString();
    const rows = [
      row({ creado_por_empresa_id: null, disabled_until: futuro }),
      row({ creado_por_empresa_id: null, confianza: 0.2 }),
    ];
    expect(selectAdapterForEmpresa(rows, B, now)).toBeNull();
  });

  it("sin empresaId, solo usa globales (nunca un manual ajeno)", () => {
    expect(selectAdapterForEmpresa([row({ creado_por_empresa_id: A })], undefined)).toBeNull();
    const global = row({ creado_por_empresa_id: null });
    expect(selectAdapterForEmpresa([global], undefined)).toBe(global);
  });
});
