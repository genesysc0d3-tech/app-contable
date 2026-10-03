import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

/** Revisión adversarial 2026-10-02 (juez y formatos conocidos). */
let cache: Record<string, unknown> | null = null;
const guardados: unknown[] = [];
/** Tabla parser_adapters EN MEMORIA (vuelta 2: N lecturas → 1 fila). Solo cuando `tabla` está activa. */
let tabla: Record<string, unknown>[] | null = null;
vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async (fp: string, emp?: string) => (tabla ? tabla.find((r) => r.fingerprint === fp && r.creado_por_empresa_id === emp && !r.oculto) ?? null : cache),
  getAdaptersConfirmadosEmpresa: async () => [],
  confirmarAdapter: async () => true,
  saveAdapter: async (a: Record<string, unknown>) => {
    guardados.push(a);
    if (!tabla) return "adapter-nuevo";
    const id = `fila-${tabla.length + 1}`;
    tabla.push({ id, fingerprint: a.fingerprint, creado_por_empresa_id: a.empresaId, source: a.source, config: a.config, estado: a.confirmadoPor ? "confirmado" : "provisorio", confirmado_por: a.confirmadoPor ?? null });
    return id;
  },
  adapterPropioMismoMapa: async (fp: string, emp: string, config: AdapterConfig) => {
    const { claveDeMapa } = await import("./mapa-clave");
    return tabla?.find((r) => r.fingerprint === fp && r.creado_por_empresa_id === emp && claveDeMapa(r.config as AdapterConfig) === claveDeMapa(config))?.id as string ?? null;
  },
  reusarAdapterPropio: async (id: string, o: { prueba?: string | null }) => {
    const f = tabla?.find((r) => r.id === id);
    if (f) { f.reusos = Number(f.reusos ?? 0) + 1; f.oculto = false; if (o.prueba === "saldo" || o.prueba === "total_banco") { f.estado = "confirmado"; f.confirmado_por = o.prueba; } }
    return id;
  },
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { cache = null; guardados.length = 0; tabla = null; });

import { parseExcelWithOrchestrator } from "./orchestrator";
import { inferirRangoFechas } from "./apply";
import { detectarResumenImpreso, sellarCartola } from "./juez-banco";
import type { AdapterConfig, Row } from "./types";

const libro = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Movimientos");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
/** Cartola con saldo corrido que cuadra, n filas; fechas `fmt(i)`. */
function cartola(n: number, fmt: (i: number) => string, arriba: unknown[][] = [], glosa = (i: number) => `Movimiento ${i}`) {
  let s = 500_000;
  const filas: unknown[][] = [];
  for (let i = 0; i < n; i++) {
    const m = 1_000 + i * 113; const c = i % 3 === 0; s += c ? -m : m;
    filas.push([fmt(i), glosa(i), c ? m : "", c ? "" : m, s]);
  }
  return [...arriba, ["Saldo anterior", 500_000], [], ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"], ...filas];
}

describe("1. fechas sin año sin período explícito → nunca sellada", () => {
  it("dd/mm sin período: el saldo cuadra pero NO hay sello (revisar)", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(cartola(14, (i) => `${String(1 + i).padStart(2, "0")}/03`)), {});
    expect(result.preExtracted?.length).toBe(14);
    expect(result.verificacion).toMatchObject({ tipo: "sin_comprobar", revisar: true });
  });
  it("con «Período: 01/03/2025 - 31/03/2025» arriba sí se sella", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(cartola(14, (i) => `${String(1 + i).padStart(2, "0")}/03`, [["Período: 01/03/2025 - 31/03/2025"]])), {});
    expect(result.verificacion?.tipo).toBe("saldo");
    expect(result.preExtracted?.[0].fecha).toBe("2025-03-01");
  });
  it("dd/mm/aaaa (con año) sigue sellando sin período", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(cartola(14, (i) => `${String(1 + i).padStart(2, "0")}/03/2026`)), {});
    expect(result.verificacion?.tipo).toBe("saldo");
  });
});

describe("2. el período se busca solo en el encabezado", () => {
  it("una glosa «PERIODO 01/03/2024 AL 31/03/2024» entre los movimientos no fija el año", () => {
    const rows = cartola(5, (i) => `0${1 + i}/03`, [], (i) => (i === 2 ? "PERIODO 01/03/2024 AL 31/03/2024" : `Mov ${i}`)) as Row[];
    const cfg = { header_row: 3, skip_rows_before_data: 4, columns: { fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4, n_documento: -1 } } as AdapterConfig;
    expect(inferirRangoFechas(rows, cfg)?.explicito ?? false).toBe(false);
  });
});

describe("4. «Saldo Actual» / «Cargos / Giros» solo valen junto a Desde/Hasta", () => {
  it("planilla con «Saldo Actual $ x» suelto: no es el saldo final del resumen", () => {
    expect(detectarResumenImpreso([["Saldo Actual", "$ 1.234.567"], ["Fecha", "Glosa"]] as Row[])?.saldoFinal).toBeUndefined();
  });
  it("en el bloque Desde/Hasta de un estado de cuenta sí", () => {
    const r = detectarResumenImpreso([["Desde", "01-03-2022", "Hasta", "31-03-2022"], ["Saldo Anterior", "$ 100", "Saldo Actual", "$ 250"]] as Row[]);
    expect(r).toMatchObject({ saldoInicial: 100, saldoFinal: 250 });
  });
});

describe("5. el testigo «Saldo» respeta «solo abonos»", () => {
  // Saldo corrido real: cada abono suma 1.000 y cada 4ª fila hubo un cargo de 700 que el export filtró.
  let saldo = 100_000;
  const rows: Row[] = [["Fecha", "Descripción", "Abonos", "Saldo"],
    ...Array.from({ length: 12 }, (_, i) => { saldo += 1000 - (i % 4 === 3 ? 700 : 0); return [`${String(1 + i).padStart(2, "0")}/03/2026`, `Abono ${i}`, 1000, saldo]; })];
  const lines = rows.slice(1).map((r, i) => ({ tipo: "ENTRADA" as const, fecha: `2026-03-${String(1 + i).padStart(2, "0")}`, monto: 1000, descripcion: String(r[1]), n_documento: "", excel_row: i + 2 }));
  const cfg = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "transactions_log", default_tipo_flujo: "entrada",
    columns: { fecha: 0, descripcion: 1, monto: 2, cargo: 2, abono: 2, saldo: -1, n_documento: -1 } } as AdapterConfig;
  it("export filtrado a abonos: el testigo deja la salida «filtrada»", () => {
    expect(sellarCartola({ rows, cfg, lines, descartes: [], resumen: null, formulas: [] })).toMatchObject({ filtrada: "abonos" });
  });
  it("el cliente ya dijo «solo abonos»: el testigo no la vuelve a contradecir", () => {
    const v = sellarCartola({ rows, cfg: { ...cfg, revision_cliente: { documento_id: "d", firma: "f", solo_abonos: true } }, lines, descartes: [], resumen: null, formulas: [] });
    expect(v.contradice).toBeUndefined();
  });
});

describe("3. un mapa PROPIO confirmado le gana al formato conocido", () => {
  const misMov = (n: number) => [["Mis Movimientos"], ["Fecha Transacción", "Fecha Contable", "Descripción", "Egreso (-)", "Ingreso (+)"],
    ...Array.from({ length: n }, (_, i) => [`${String(1 + i).padStart(2, "0")}/03/2026`, `${String(1 + i).padStart(2, "0")}/03/2026`, `Transferencia ${i}`, "", 10_000 + i])];
  it("caché propia confirmada (por Check/saldo) → sigue por la caché, con su adapter_id", async () => {
    cache = { id: "propio-1", creado_por_empresa_id: "emp", estado: "confirmado", confirmado_por: "check", source: "heuristic",
      config: { header_row: 1, skip_rows_before_data: 2, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols", columns: { fecha: 0, descripcion: 2, n_documento: -1, cargo: 3, abono: 4, saldo: -1 } } };
    const { result } = await parseExcelWithOrchestrator(libro(misMov(12)), { empresa_id: "emp" });
    expect(result.capa_usada).toBe(0);
    expect(result.adapter_id).toBe("propio-1");
  });
  it("sin caché: entra por conocido y queda guardado como mapa de la empresa (adapter_id para Check)", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(misMov(12)), { empresa_id: "emp" });
    expect(result.capa_usada).toBe(1);
    expect(result.adapter_id).toBe("adapter-nuevo");
    expect(guardados).toHaveLength(1);
  });
});

describe("6. formatos editados por la clienta no son conocidos", () => {
  it("bci-mes-actual-xls queda fuera", async () => {
    const { FORMATOS_DE_SPECS, SPECS_EXCLUIDAS } = await import("./formatos-conocidos.specs");
    expect(FORMATOS_DE_SPECS.map((f) => f.id)).not.toContain("bci-mes-actual-xls");
    expect(SPECS_EXCLUIDAS["bci-mes-actual-xls"]).toBeTruthy();
  });
});

describe("vuelta 2 · 1. un formato conocido NO inserta un adaptador por lectura", () => {
  const dia = (d: number) => `${String(d).padStart(2, "0")}/03/2026`;
  /** BCI Detallado (formato conocido): n filas en orden inverso con «Saldo inicial» abajo. */
  function bci(n: number) {
    let saldo = 1_000_000;
    const asc = Array.from({ length: n }, (_, i) => {
      const egreso = i % 6 === 2; const m = 10_000 + i * 700; saldo += egreso ? -m : m;
      return [dia(1 + (i % 25)), `HASH|${9010716960000 + i}`, `Transferencia recibida de Cliente ${i}`, egreso ? null : m, egreso ? m : null, saldo];
    });
    return [["Fecha de transacción", "Código de transacción", "Glosa detalle", "Ingreso (+)", "Egreso (-)", "Saldo contable"], ...asc.reverse(), ["", "", "Saldo inicial", null, null, 1_000_000]];
  }
  it("3 lecturas sin prueba → 1 sola fila provisoria; una con prueba → la MISMA fila pasa a confirmado", async () => {
    tabla = [];
    for (let k = 0; k < 3; k++) {
      const { result } = await parseExcelWithOrchestrator(libro(bci(5)), { empresa_id: "emp" });
      expect(result.capa_usada).toBe(1);
      expect(result.verificacion?.tipo).toBe("sin_comprobar");
    }
    expect(tabla).toHaveLength(1);
    expect(tabla[0].estado).toBe("provisorio");
    const { result } = await parseExcelWithOrchestrator(libro(bci(14)), { empresa_id: "emp" });
    expect(result.verificacion?.tipo).toBe("saldo");
    expect(result.adapter_id).toBe("fila-1");
    expect(tabla).toHaveLength(1);
    expect(tabla[0]).toMatchObject({ id: "fila-1", estado: "confirmado", confirmado_por: "saldo" });
  });
});

describe("vuelta 2 · 5. el aviso del año es cumplible en el popup", () => {
  it("dice qué año confirmar y que «Listo» lo confirma", async () => {
    const { result } = await parseExcelWithOrchestrator(libro(cartola(14, (i) => `${String(1 + i).padStart(2, "0")}/03`)), {});
    expect(result.verificacion?.detalle).toMatch(/confirma que estos movimientos son del año \d{4}.*Listo/);
  });
});

describe("vuelta 2 · 4. BancoEstado chequera: el año y el resumen salen de su hoja «Resumen»", () => {
  it("chequera completa y solo-abonos entran por conocido con el año del período", async () => {
    const { leerSpecs, rendir } = await import("../../../scripts/corpus-cartolas/generador");
    const specs = leerSpecs();
    for (const id of ["bancoestado-chequera-completa", "bancoestado-chequera-solo-abonos"]) {
      const c = rendir(specs.find((s) => s.id === id)!, 11, { mes: 3 });
      const { result } = await parseExcelWithOrchestrator(c.buf, {});
      expect({ id, conocido: result.censo?.mapa?.formato_conocido }).toEqual({ id, conocido: id });
      const leido = (result.preExtracted ?? []).map((m) => `${m.fecha}|${m.monto}`).sort();
      expect(leido).toEqual(c.verdad.map((v) => `${v.fecha}|${v.monto}`).sort());
    }
  });
});

describe("vuelta 3 · 1. reusar SOLO la fila con el mismo mapa", () => {
  const dia = (d: number) => `${String(d).padStart(2, "0")}/03/2026`;
  function bci(n: number) {
    let saldo = 1_000_000;
    const asc = Array.from({ length: n }, (_, i) => {
      const egreso = i % 6 === 2; const m = 10_000 + i * 700; saldo += egreso ? -m : m;
      return [dia(1 + (i % 25)), `HASH|${9010716960000 + i}`, `Transferencia recibida de Cliente ${i}`, egreso ? null : m, egreso ? m : null, saldo];
    });
    return [["Fecha de transacción", "Código de transacción", "Glosa detalle", "Ingreso (+)", "Egreso (-)", "Saldo contable"], ...asc.reverse(), ["", "", "Saldo inicial", null, null, 1_000_000]];
  }
  async function huella() {
    const { computeFingerprint } = await import("./fingerprint");
    return computeFingerprint(bci(5) as Row[]);
  }
  it("fila propia con OTRO mapa (M1): la lectura con el conocido (M2) inserta aparte y NO reescribe M1", async () => {
    const m1 = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols", columns: { fecha: 0, descripcion: 2, n_documento: -1, cargo: 3, abono: 4, saldo: 5 } };
    tabla = [{ id: "m1", fingerprint: await huella(), creado_por_empresa_id: "emp", source: "heuristic", config: m1, estado: "provisorio" }];
    const { result } = await parseExcelWithOrchestrator(libro(bci(5)), { empresa_id: "emp" });
    expect(result.capa_usada).toBe(1);
    expect(tabla).toHaveLength(2);
    expect(tabla[0].config).toBe(m1);
    expect(result.adapter_id).toBe("fila-2");
    const { claveDeMapa } = await import("./mapa-clave");
    expect(result.censo?.mapa?.clave).toBe(claveDeMapa(tabla[1].config as AdapterConfig));
  });
  it("fila propia con el MISMO mapa pero invisible (confianza baja/deshabilitada) → se reusa y vuelve a verse, sin duplicar", async () => {
    tabla = [];
    await parseExcelWithOrchestrator(libro(bci(5)), { empresa_id: "emp" });
    tabla[0].oculto = true;
    await parseExcelWithOrchestrator(libro(bci(5)), { empresa_id: "emp" });
    expect(tabla).toHaveLength(1);
    expect(tabla[0]).toMatchObject({ reusos: 1, oculto: false });
  });
  it("Check confirma solo si el adaptador sigue teniendo el mapa con que se leyó el documento", async () => {
    const { adapterSigueSiendoElDelDocumento, claveDeMapa } = await import("./mapa-clave");
    const m1 = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols", columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } } as AdapterConfig;
    const m2 = { ...m1, columns: { ...m1.columns, cargo: 3, abono: 2 } } as AdapterConfig;
    expect(adapterSigueSiendoElDelDocumento(claveDeMapa(m1), m1)).toBe(true);
    expect(adapterSigueSiendoElDelDocumento(claveDeMapa(m1), m2)).toBe(false);
    expect(adapterSigueSiendoElDelDocumento(undefined, m2)).toBe(true);
    const src = (await import("fs")).readFileSync("src/lib/cartola/confirmacion-mapa.ts", "utf8");
    expect(src).toContain("adapterSigueSiendoElDelDocumento(cuadre.mapa?.clave, adapter.config)");
    const prev = (await import("fs")).readFileSync("src/app/api/parser/preview/route.ts", "utf8");
    expect(prev).toContain("mapa?.config");
  });
});

describe("vuelta 3 · 4-5. BancoEstado: el período del Resumen se cruza con las fechas; el popup juzga igual", () => {
  async function chequera(mesResumen?: number) {
    const { leerSpecs, rendir } = await import("../../../scripts/corpus-cartolas/generador");
    const c = rendir(leerSpecs().find((s) => s.id === "bancoestado-chequera-completa")!, 11, { mes: 3 });
    const wb = XLSX.read(c.buf, { type: "array" });
    if (mesResumen) {
      const ws = wb.Sheets["Resumen"];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      for (const r of aoa) {
        const t = String(r[0] ?? "").toLowerCase();
        if (/fecha (inicio|final)/.test(t)) {
          const j = r.findIndex((v, k) => k > 0 && /\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(String(v)));
          if (j > 0) r[j] = String(r[j]).replace(/^(\d{1,2})([\/-])(\d{1,2})/, (_m, d, sep) => `${d}${sep}${String(mesResumen).padStart(2, "0")}`);
        }
      }
      wb.Sheets["Resumen"] = XLSX.utils.aoa_to_sheet(aoa);
    }
    return { c, buf: XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, wb };
  }
  it("Resumen de OTRO mes → nunca sellada (el banco contradice)", async () => {
    const { buf } = await chequera(7);
    const { result } = await parseExcelWithOrchestrator(buf, {});
    expect(["saldo", "total_banco"]).not.toContain(result.verificacion?.tipo);
  });
  it("el popup (juzgarMapaEnLibro) usa el período del Resumen: no pide confirmar el año", async () => {
    const { buf, wb } = await chequera();
    const { result } = await parseExcelWithOrchestrator(buf, {});
    const { juzgarMapaEnLibro } = await import("./orchestrator");
    const cfg = { ...(result.censo!.mapa!.config as AdapterConfig) };
    const j = juzgarMapaEnLibro(XLSX.read(buf, { type: "array", cellDates: true }), cfg);
    expect(j.ok).toBe(true);
    if (j.ok) expect(j.verificacion.detalle ?? "").not.toMatch(/año/);
    void wb;
  });
});
