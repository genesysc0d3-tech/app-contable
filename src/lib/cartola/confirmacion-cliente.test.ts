import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkConfirmaMapa, filtradaPermitida, mensajeSaldoNoCuadra, seVeBienPermitido } from "./verificacion";
import { hayConsensoParaGlobal } from "@/lib/parsers/adapter-store";
import type { CuadreCartola } from "./cuadre";
import type { AdapterConfig } from "@/lib/parsers/types";

// Revisiones adversariales 2026-09-30 (adversarial-2 A2/A3/A4, adversarial-1 falla 6/10):
//  - "Se ve bien" sobre 3 filas NO puede sellar si el banco/saldo contradice la
//    lectura o faltan filas (UI lo esconde, el server lo rechaza).
//  - "No cuadra" no le dicta la respuesta al cliente (no revela el saldo esperado).
//  - "Aprobar cartola" en bloque NO confirma el mapa; Check lo confirma solo sin
//    alerta ni pérdidas.
//  - Un mapa confirmado por saldo es de ESA empresa; se vuelve global solo con 2+
//    empresas distintas que confirmaron el mismo mapa.

const base: CuadreCartola = {
  ok: true, hoja: "Cartola", filas_con_monto: 3, guardadas: 3, duplicadas: 0, descartes_legitimos: 0,
  perdidas: [], monto_perdido: 0, abonos: 150_000, cargos: 30_000, otras_hojas_con_datos: [],
  db: { movimientos: 3, propuestas: 3, ok: true }, calculado_en: "2026-09-30T00:00:00Z",
  verificacion: { tipo: "sin_comprobar", detalle: "sin saldo" },
};

describe("'Se ve bien' no puede tapar una contradicción", () => {
  it("sin alerta ni pérdidas: permitido", () => {
    expect(seVeBienPermitido(base).ok).toBe(true);
  });
  it("con alerta (el banco no calza, disputa, plata sin leer): rechazado", () => {
    expect(seVeBienPermitido({ ...base, verificacion: { tipo: "sin_comprobar", alerta: true, detalle: "El banco no calza" } }).ok).toBe(false);
  });
  it("con filas perdidas o con otra hoja sin leer: rechazado", () => {
    expect(seVeBienPermitido({ ...base, perdidas: [{ excel_row: 7, fecha: null, monto: 1, tipo_flujo: null, motivo: "sin_fecha", descripcion: "" }] }).ok).toBe(false);
    expect(seVeBienPermitido({ ...base, otras_hojas_con_datos: ["Septiembre"] }).ok).toBe(false);
  });
});

describe("'No cuadra' no dicta la respuesta", () => {
  it("el mensaje no trae ningún monto", () => {
    const m = mensajeSaldoNoCuadra();
    expect(m).toMatch(/no coincide/i);
    expect(m).not.toMatch(/\d/);
  });
});

describe("Check confirma el mapa solo sin alerta ni pérdidas", () => {
  const guardado = { n: 3, entradas: 150_000, salidas: 30_000 };
  const movimientos = [{ monto: 100_000, tipo_flujo: "entrada" }, { monto: 50_000, tipo_flujo: "entrada" }, { monto: 30_000, tipo_flujo: "salida" }];
  const estados = ["aprobado", "aprobado", "rechazado"];
  it("sin alerta: confirma", () => {
    expect(checkConfirmaMapa({ guardado, movimientos, estados, cuadre: base, aprobadasFilaAFila: true })).toBe(true);
  });
  it("con alerta o pérdidas: no confirma", () => {
    expect(checkConfirmaMapa({ guardado, movimientos, estados, cuadre: { ...base, verificacion: { tipo: "sin_comprobar", alerta: true, detalle: "x" } } })).toBe(false);
    expect(checkConfirmaMapa({ guardado, movimientos, estados, cuadre: { ...base, perdidas: [{ excel_row: 7, fecha: null, monto: 1, tipo_flujo: null, motivo: "sin_leer", descripcion: "" }] } })).toBe(false);
  });
  // Vuelta 2, N3: "Aprobar cartola" en bloque + 1 fila a mano NO confirma.
  it("si alguna aprobada no fue aprobada FILA A FILA, no confirma", () => {
    expect(checkConfirmaMapa({ guardado, movimientos, estados, cuadre: base, aprobadasFilaAFila: false })).toBe(false);
    expect(checkConfirmaMapa({ guardado, movimientos, estados, cuadre: base, aprobadasFilaAFila: true })).toBe(true);
    expect(checkConfirmaMapa({ guardado, movimientos, estados, cuadre: base })).toBe(false);
  });
  it("'Aprobar cartola' (en bloque) ya no llama a la confirmación del mapa", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/revisar/actions.ts"), "utf8");
    const cuerpo = src.slice(src.indexOf("export async function aprobarCartola"), src.indexOf("export async function editarMovimientoPropuesta"));
    expect(cuerpo).not.toContain("confirmarMapaPorCheck");
  });
});

describe("mapa global solo por consenso de 2+ empresas", () => {
  const cfg: AdapterConfig = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
    columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } };
  const invertido: AdapterConfig = { ...cfg, columns: { ...cfg.columns, cargo: 3, abono: 2 } };
  it("una sola empresa (aunque confirme por saldo) no basta", () => {
    expect(hayConsensoParaGlobal([{ creado_por_empresa_id: "a", estado: "confirmado", config: cfg }], cfg)).toBe(false);
  });
  // Vuelta 2 (N1): además exige prueba objetiva, dueños y cuentas bancarias distintas.
  it("dos empresas de dueños y cuentas distintas, confirmadas por saldo, con el MISMO mapa: sí", () => {
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "a", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c1", config: { ...cfg, cuenta_huella: "h1" } },
      { creado_por_empresa_id: "b", estado: "confirmado", confirmado_por: "saldo", cuenta_id: "c2", config: { ...cfg, titulos: ["x"], cuenta_huella: "h2" } },
    ], cfg)).toBe(true);
  });
  it("dos empresas con mapas distintos, o una provisoria: no", () => {
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "a", estado: "confirmado", config: cfg },
      { creado_por_empresa_id: "b", estado: "confirmado", config: invertido },
    ], cfg)).toBe(false);
    expect(hayConsensoParaGlobal([
      { creado_por_empresa_id: "a", estado: "confirmado", config: cfg },
      { creado_por_empresa_id: "b", estado: "provisorio", config: cfg },
    ], cfg)).toBe(false);
  });
});

// Vuelta 2, N4: una cartola filtrada (solo abonos) queda con alerta perpetua: el
// cliente tiene una salida EXPLÍCITA ("mi cartola es solo abonos") que sella
// `cliente` con esa razón. Solo si el lector la reconoció como filtrada.
describe("salida para la cartola filtrada", () => {
  it("permitida solo si el sello dice 'filtrada' y no hay pérdidas", () => {
    const filtrada = { ...base, verificacion: { tipo: "sin_comprobar" as const, alerta: true, filtrada: "abonos" as const, detalle: "x" } };
    expect(filtradaPermitida(filtrada)).toBe(true);
    expect(filtradaPermitida({ ...base, verificacion: { tipo: "sin_comprobar", alerta: true, detalle: "El banco no calza" } })).toBe(false);
    expect(filtradaPermitida({ ...filtrada, perdidas: [{ excel_row: 7, fecha: null, monto: 1, tipo_flujo: null, motivo: "sin_leer", descripcion: "" }] })).toBe(false);
  });
});
