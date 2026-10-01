/**
 * Revisión adversarial del fix (2026-09-30): rev 1 M4 (el 43 % de las boletas
 * aprobadas no tiene tipo_dte y se aceptaba ciegamente el 39/41 del navegador) y
 * rev 2 M1 (el texto de DATOS_CAMBIARON mentía a mitad de lote y decía "boleta" en
 * facturas).
 */
import { describe, expect, it } from "vitest";
import { compararDatosJob, textoDatosCambiaron, type PropuestaDatos } from "./datos-job";

const empresaAfecta = { giro: "Clases", razon_social: "Yoga SpA", tipo_contribuyente: "afecto", boletas_tipo_default: null, facturas_tipo_default: null, operacion_default: null };
const empresaExenta = { ...empresaAfecta, tipo_contribuyente: "exento" };

const base: PropuestaDatos = {
  mesa: "boleta",
  tipo_dte: null,
  estado: "aprobado",
  tipo_propuesto: null,
  total: 10000,
  notas: "Clase",
  detalle: null,
  receptor_rut: null,
  receptor_nombre: null,
  created_at: "2026-09-30T12:00:00Z",
  clientes: null,
  movimientos_raw: { monto: 10000, fecha: "2026-09-30", descripcion: "Transferencia de Ana", documentos_subidos: { glosa_comun: null, glosa_activa: false, tipo_operacion_hint: null } },
};
const env = { monto: 10000, receptor_rut: null, glosa: "Clase" };

describe("tipo sin persistir: el server lo recalcula con el MISMO motor de la mesa", () => {
  it("categoría exenta por naturaleza (P2P) → 41; un 39 del navegador se rechaza", () => {
    const p2p = { ...base, tipo_propuesto: "transferencia_p2p" };
    expect(compararDatosJob(p2p, 41, env, empresaAfecta)).toEqual({ ok: true });
    expect(compararDatosJob(p2p, 39, env, empresaAfecta)).toEqual({ ok: false, campos: ["tipo_dte"] });
  });
  it("hint de la cartola p2p_cripto → 41", () => {
    const hint = { ...base, movimientos_raw: { ...base.movimientos_raw as object, documentos_subidos: { glosa_comun: null, glosa_activa: false, tipo_operacion_hint: "p2p_cripto" } } } as PropuestaDatos;
    expect(compararDatosJob(hint, 39, env, empresaAfecta)).toEqual({ ok: false, campos: ["tipo_dte"] });
  });
  it("empresa que pasó a exenta: una pestaña vieja que pide 39 se rechaza", () => {
    expect(compararDatosJob(base, 39, env, empresaExenta)).toEqual({ ok: false, campos: ["tipo_dte"] });
    expect(compararDatosJob(base, 41, env, empresaExenta)).toEqual({ ok: true });
  });
  it("sin contexto de empresa (no se puede recalcular) → se rechaza, nunca a ciegas", () => {
    expect(compararDatosJob(base, 39, env)).toEqual({ ok: false, campos: ["tipo_dte"] });
  });
});

describe("textoDatosCambiaron — honesto a mitad de lote y con el documento correcto", () => {
  it("boleta y factura, sin 'No se emitió nada', sin 'glosa'", () => {
    const b = textoDatosCambiaron("boleta");
    const f = textoDatosCambiaron("factura");
    expect(b).toContain("Esta boleta cambió");
    expect(f).toContain("Esta factura cambió");
    expect(f).not.toContain("boleta");
    for (const t of [b, f]) {
      expect(t).not.toContain("No se emitió nada");
      expect(t).not.toContain("glosa");
      expect(t).toContain("Las que ya salieron quedaron guardadas");
    }
  });
});
