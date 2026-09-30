import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { cambioDeEncabezado } from "./cambio-formato";

// Punto 10 (fixtures de cambio de huella): cuando el banco cambia el formato de
// un mapa CONFIRMADO de la empresa, el lector no re-adivina en silencio: dice
// "esperaba encabezado X, llegó Y" y la cartola queda sin_comprobar si nada la
// prueba.

let confirmados: Array<{ config: { titulos?: string[] } }> = [];
vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => confirmados,
  saveAdapter: async () => "adapter-test",
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => true,
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { confirmados = []; });

describe("cambioDeEncabezado", () => {
  const conocido = ["fecha", "descripcion", "cargos", "abonos", "saldo"];
  it("una letra cambiada / una columna nueva → mensaje esperaba/llegó con el diff", () => {
    const m = cambioDeEncabezado([conocido], ["fecha", "detalle", "cargos", "abonos", "saldo"]);
    expect(m).toMatch(/esperaba encabezado «fecha \| descripcion \| cargos \| abonos \| saldo» y llegó «fecha \| detalle \| cargos \| abonos \| saldo»/);
    expect(m).toMatch(/ya no viene «descripcion»/);
    expect(m).toMatch(/viene nuevo «detalle»/);
  });
  it("mismo encabezado → sin aviso; formato totalmente distinto → sin aviso (es nuevo, no un cambio)", () => {
    expect(cambioDeEncabezado([conocido], conocido)).toBeNull();
    expect(cambioDeEncabezado([conocido], ["date", "amount", "memo"])).toBeNull();
  });
  it("columnas movidas → lo dice", () => {
    expect(cambioDeEncabezado([conocido], ["descripcion", "fecha", "cargos", "abonos", "saldo"])).toMatch(/cambiaron de orden/);
  });
});

describe("el orquestador avisa el cambio de formato de un confirmado", () => {
  it("huella nueva parecida a un mapa confirmado de la empresa → warning + sin_comprobar con el mensaje", async () => {
    confirmados = [{ config: { titulos: ["fecha", "descripcion", "cargos", "abonos"] } }];
    const filas = [["Fecha", "Detalle", "Cargos", "Abonos"], ...Array.from({ length: 8 }, (_, i) => [
      `${String(i + 1).padStart(2, "0")}/09/2026`, `Movimiento ${i} de la cuenta`, i % 2 ? `${(i + 1) * 3}.000` : "", i % 2 ? "" : `${(i + 2) * 7}.000`,
    ])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Cartola");
    const { parseExcelWithOrchestrator } = await import("./orchestrator");
    const { result } = await parseExcelWithOrchestrator(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, { empresa_id: "emp-A" });
    expect(result.warnings.join(" ")).toMatch(/esperaba encabezado «fecha \| descripcion \| cargos \| abonos» y llegó «fecha \| detalle \| cargos \| abonos»/);
    expect(result.verificacion?.tipo).toBe("sin_comprobar");
    expect(result.verificacion?.detalle).toMatch(/cambió el formato/);
  });
});
