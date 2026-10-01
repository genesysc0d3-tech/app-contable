/**
 * El servidor manda en los datos (adversarial H3 / mesa 2.1, 2026-09-30): el lote
 * emitía monto/tipo/receptor/glosa sacados de la caché del navegador y el server no
 * los comparaba con la propuesta. Una pestaña vieja podía emitir $10.000 cuando la
 * propuesta ya decía $12.000. Ahora el POST de jobs compara y responde 409.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compararDatosJob, datosParaJob, leerDatosEnviados, type PropuestaDatos } from "./datos-job";

const base: PropuestaDatos = {
  mesa: "boleta",
  tipo_dte: 41,
  total: 10000,
  notas: null,
  detalle: null,
  receptor_rut: null,
  clientes: { rut: "12.345.678-5" },
  movimientos_raw: { monto: 10000, documentos_subidos: { glosa_comun: "Clases de yoga", glosa_activa: true } },
};
const ok = { monto: 10000, receptor_rut: "12345678-5", glosa: "Clases de yoga" };

describe("leerDatosEnviados", () => {
  it("sin datos (pestaña con JS viejo) → null", () => {
    expect(leerDatosEnviados(undefined)).toBeNull();
    expect(leerDatosEnviados({ monto: "x" })).toBeNull();
  });
  it("lee monto, receptor y glosa", () => {
    expect(leerDatosEnviados({ monto: 10000, receptor_rut: null, glosa: "a" })).toEqual({ monto: 10000, receptor_rut: null, glosa: "a" });
  });
});

describe("compararDatosJob", () => {
  it("lo mismo que la propuesta (RUT con o sin puntos) → ok", () => {
    expect(compararDatosJob(base, 41, ok)).toEqual({ ok: true });
  });
  it("monto distinto → DATOS_CAMBIARON por monto", () => {
    expect(compararDatosJob({ ...base, total: 12000 }, 41, ok)).toEqual({ ok: false, campos: ["monto"] });
  });
  it("tipo persistido distinto (otra persona la cambió a afecta) → tipo_dte", () => {
    expect(compararDatosJob({ ...base, tipo_dte: 39 }, 41, ok)).toEqual({ ok: false, campos: ["tipo_dte"] });
  });
  it("tipo de otra mesa (factura pedida sobre una boleta) → tipo_dte", () => {
    expect(compararDatosJob(base, 33, ok)).toMatchObject({ ok: false, campos: ["tipo_dte"] });
  });
  it("sin tipo persistido y sin contexto de empresa → ya NO se acepta el del navegador (rev. adversarial M4)", () => {
    expect(compararDatosJob({ ...base, tipo_dte: null }, 39, ok)).toEqual({ ok: false, campos: ["tipo_dte"] });
  });
  it("receptor distinto o borrado → receptor_rut", () => {
    expect(compararDatosJob({ ...base, receptor_rut: "11.111.111-1" }, 41, ok)).toEqual({ ok: false, campos: ["receptor_rut"] });
    expect(compararDatosJob({ ...base, clientes: null }, 41, ok)).toEqual({ ok: false, campos: ["receptor_rut"] });
  });
  it("glosa editada en otra pestaña (notas manda) → glosa", () => {
    expect(compararDatosJob({ ...base, notas: "Clase particular" }, 41, ok)).toEqual({ ok: false, campos: ["glosa"] });
    expect(compararDatosJob({ ...base, notas: "Clase particular" }, 41, { ...ok, glosa: "Clase  particular " })).toEqual({ ok: true });
  });
  it("sin glosa propia, el genérico (cualquiera de los dos) calza; una glosa inventada no", () => {
    const sinGlosa = { ...base, movimientos_raw: { monto: 10000, documentos_subidos: null } };
    expect(compararDatosJob(sinGlosa, 41, { ...ok, glosa: "Venta exenta" })).toEqual({ ok: true });
    expect(compararDatosJob(sinGlosa, 41, { ...ok, glosa: "Servicio prestado" })).toEqual({ ok: true });
    expect(compararDatosJob(sinGlosa, 41, { ...ok, glosa: "Otra cosa" })).toEqual({ ok: false, campos: ["glosa"] });
  });
  it("factura: glosa = detalle; total cae al monto del movimiento si no hay total", () => {
    const fact: PropuestaDatos = { ...base, mesa: "factura", tipo_dte: 33, total: null, detalle: "Asesoría", receptor_rut: "76.000.000-0", clientes: null };
    expect(compararDatosJob(fact, 33, { monto: 10000, receptor_rut: "76000000-0", glosa: "Asesoría" })).toEqual({ ok: true });
    expect(compararDatosJob(fact, 33, { monto: 10000, receptor_rut: "76000000-0", glosa: "Otra" })).toEqual({ ok: false, campos: ["glosa"] });
  });
  it("varios campos a la vez se listan todos", () => {
    expect(compararDatosJob({ ...base, total: 1, notas: "x" }, 39, ok)).toEqual({ ok: false, campos: ["monto", "tipo_dte", "glosa"] });
  });
});

describe("datosParaJob — el lote manda EXACTAMENTE lo que va a teclear", () => {
  it("monto, receptor y glosa del ítem (los mismos campos que van a buildBoletaJob/buildFacturaJob)", () => {
    expect(datosParaJob({ monto: 5000, receptorRut: "1-9", detalle: "Clase" })).toEqual({ monto: 5000, receptor_rut: "1-9", glosa: "Clase" });
    expect(datosParaJob({ monto: 5000, receptorRut: undefined, detalle: "Clase" }).receptor_rut).toBeNull();
  });
  it("useEmisionLote manda `datos` en el POST del job (y el builder usa los mismos campos)", () => {
    const hook = readFileSync(join(__dirname, "../../app/(app)/escritorio/v5/useEmisionLote.ts"), "utf8");
    expect(hook).toContain("datos: datosParaJob(full)");
    expect(hook).toContain("startJob(full)");
  });
});
