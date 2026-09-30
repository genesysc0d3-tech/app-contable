import { describe, expect, it } from "vitest";
import { calcularCuadre } from "./cuadre";
import { leerCuadre } from "./cuadre-mesa";
import {
  checkConfirmaMapa,
  necesitaConfirmacion,
  saldoInicialParaConfirmar,
  sellarPorCliente,
  verificarSaldoCliente,
} from "./verificacion";
import type { CensoCartola } from "@/lib/parsers/types";

// Puntos 6-8 (2026-09-30): el sello de la cartola llega al cuadre (y a la UI), y
// el cliente puede sellar "cliente" revisando la muestra o tecleando el saldo
// final que ve en su portal. Aprobar en Check sin editar confirma el mapa.

const censo = (extra: Partial<CensoCartola> = {}): CensoCartola => ({
  hoja: "Cartola",
  filas_con_monto: 3,
  leidas: 3,
  descartes: [],
  otras_hojas_con_datos: [],
  ...extra,
});
const leidas = [
  { excel_row: 2, fecha: "2026-09-01", monto: 100_000, tipo_flujo: "entrada", descripcion: "a" },
  { excel_row: 3, fecha: "2026-09-02", monto: 30_000, tipo_flujo: "salida", descripcion: "b" },
  { excel_row: 4, fecha: "2026-09-03", monto: 50_000, tipo_flujo: "entrada", descripcion: "c" },
];

describe("el sello viaja al cuadre", () => {
  it("calcularCuadre copia verificacion, saldos, cuenta, muestra y mapa del censo", () => {
    const c = calcularCuadre({
      censo: censo({
        verificacion: { tipo: "sin_comprobar", detalle: "sin saldo" },
        saldo_inicial: 1_000, saldo_final: null,
        cuenta: { huella: "abcdabcdabcdabcd", sufijo: "7890" },
        muestra: [{ excel_row: 2, fecha: "2026-09-01", descripcion: "a", monto: 100_000, tipo_flujo: "entrada" }],
        mapa: { adapter_id: "ad-1", estado: "provisorio", nuevo: true },
      }),
      leidas, filasGuardadas: [2, 3, 4], filasDuplicadas: [], db: { movimientos: 3, propuestas: 3 },
    });
    expect(c.verificacion).toEqual({ tipo: "sin_comprobar", detalle: "sin saldo" });
    expect(c.saldo_inicial).toBe(1_000);
    expect(c.cuenta?.sufijo).toBe("7890");
    expect(c.muestra).toHaveLength(1);
    expect(c.mapa?.estado).toBe("provisorio");
    // Lo que quedó GUARDADO, para saber después si el cliente lo editó.
    expect(c.guardado).toEqual({ n: 3, entradas: 150_000, salidas: 30_000 });
  });

  it("un censo sin sello NO sale como OK: sin_comprobar", () => {
    const c = calcularCuadre({ censo: censo(), leidas, filasGuardadas: [2, 3, 4], filasDuplicadas: [], db: { movimientos: 3, propuestas: 3 } });
    expect(c.verificacion?.tipo).toBe("sin_comprobar");
  });

  it("leerCuadre conserva los campos nuevos (y tolera cuadres viejos sin ellos)", () => {
    const c = calcularCuadre({ censo: censo({ verificacion: { tipo: "saldo", detalle: "ok" }, saldo_final: 5 }), leidas, filasGuardadas: [2, 3, 4], filasDuplicadas: [], db: { movimientos: 3, propuestas: 3 } });
    const l = leerCuadre({ cuadre: JSON.parse(JSON.stringify(c)) })!;
    expect(l.verificacion?.tipo).toBe("saldo");
    expect(l.saldo_final).toBe(5);
    const viejo = leerCuadre({ cuadre: { perdidas: [], guardadas: 3 } })!;
    expect(viejo.verificacion).toBeUndefined();
  });
});

describe("¿hay que pedirle confirmación al cliente?", () => {
  it("sí si la cartola quedó sin_comprobar o el mapa es nuevo y provisorio; no si ya hay prueba", () => {
    expect(necesitaConfirmacion({ verificacion: { tipo: "sin_comprobar", detalle: "" } })).toBe(true);
    expect(necesitaConfirmacion({ verificacion: { tipo: "saldo", detalle: "" }, mapa: { adapter_id: "x", estado: "provisorio", nuevo: true } })).toBe(true);
    expect(necesitaConfirmacion({ verificacion: { tipo: "saldo", detalle: "" }, mapa: { adapter_id: "x", estado: "confirmado", nuevo: true } })).toBe(false);
    expect(necesitaConfirmacion({ verificacion: { tipo: "cliente", detalle: "" } })).toBe(false);
    // Cuadre viejo sin sello: no se molesta al cliente con documentos antiguos.
    expect(necesitaConfirmacion({})).toBe(false);
    // Mapa que el cliente ya confirmó antes, sin prueba nueva: no se insiste…
    const confirmadoViejo = { adapter_id: "x", estado: "confirmado" as const, nuevo: false };
    expect(necesitaConfirmacion({ verificacion: { tipo: "sin_comprobar", detalle: "" }, mapa: confirmadoViejo })).toBe(false);
    // …salvo que algo contradiga la lectura (el banco no calza, plata sin leer).
    expect(necesitaConfirmacion({ verificacion: { tipo: "sin_comprobar", detalle: "", alerta: true }, mapa: confirmadoViejo })).toBe(true);
  });
});

describe("saldo final del portal del banco", () => {
  it("cuadra si saldo inicial + abonos − cargos = lo que el cliente ve en su banco", () => {
    expect(verificarSaldoCliente({ saldoFinalCliente: 1_120_000, saldoInicial: 1_000_000, abonos: 150_000, cargos: 30_000 })).toMatchObject({ ok: true, diferencia: 0 });
  });
  it("FIXTURE NEGATIVO: no cuadra → dice cuánto esperábamos y la diferencia", () => {
    const r = verificarSaldoCliente({ saldoFinalCliente: 1_100_000, saldoInicial: 1_000_000, abonos: 150_000, cargos: 30_000 });
    expect(r).toMatchObject({ ok: false, esperado: 1_120_000, diferencia: -20_000 });
  });
  it("sella 'cliente' sin tocar el resto del cuadre", () => {
    const c = calcularCuadre({ censo: censo({ verificacion: { tipo: "sin_comprobar", detalle: "x" } }), leidas, filasGuardadas: [2, 3, 4], filasDuplicadas: [], db: { movimientos: 3, propuestas: 3 } });
    const s = sellarPorCliente(c, "Tu saldo final cuadra");
    expect(s.verificacion).toEqual({ tipo: "cliente", detalle: "Tu saldo final cuadra" });
    expect(s.guardadas).toBe(3);
  });
});

describe("encadenar con la cartola anterior de la misma cuenta", () => {
  const cuenta = { huella: "h1", sufijo: "1234" };
  it("sin saldo inicial propio, se usa el saldo final de la cartola anterior de la MISMA cuenta", () => {
    const r = saldoInicialParaConfirmar({ saldo_inicial: null, cuenta }, [{ cuenta: { huella: "otra", sufijo: "9" }, saldo_final: 5 }, { cuenta, saldo_final: 900_000 }]);
    expect(r).toEqual({ valor: 900_000, fuente: "anterior", empalma: null });
  });
  it("con los dos datos, dice si empalman (prueba adicional) o no", () => {
    expect(saldoInicialParaConfirmar({ saldo_inicial: 900_000, cuenta }, [{ cuenta, saldo_final: 900_000 }])).toEqual({ valor: 900_000, fuente: "cartola", empalma: true });
    expect(saldoInicialParaConfirmar({ saldo_inicial: 900_000, cuenta }, [{ cuenta, saldo_final: 800_000 }]).empalma).toBe(false);
  });
  it("sin nada → null (se le pide al cliente)", () => {
    expect(saldoInicialParaConfirmar({ saldo_inicial: null, cuenta: null }, [])).toEqual({ valor: null, fuente: null, empalma: null });
  });
});

describe("aprobar en Check sin editar confirma el mapa", () => {
  const guardado = { n: 3, entradas: 150_000, salidas: 30_000 };
  const movs = [{ monto: 100_000, tipo_flujo: "entrada" }, { monto: 30_000, tipo_flujo: "salida" }, { monto: 50_000, tipo_flujo: "entrada" }];
  it("todo decidido, lo guardado intacto → confirma", () => {
    expect(checkConfirmaMapa({ guardado, movimientos: movs, estados: ["aprobado", "aprobado", "rechazado"] })).toBe(true);
  });
  it("FIXTURE NEGATIVO: un monto editado → NO confirma", () => {
    expect(checkConfirmaMapa({ guardado, movimientos: [{ ...movs[0], monto: 99_000 }, movs[1], movs[2]], estados: ["aprobado", "aprobado", "aprobado"] })).toBe(false);
  });
  it("FIXTURE NEGATIVO: algo pendiente o editado → todavía no", () => {
    expect(checkConfirmaMapa({ guardado, movimientos: movs, estados: ["aprobado", "pendiente", "aprobado"] })).toBe(false);
    expect(checkConfirmaMapa({ guardado, movimientos: movs, estados: ["aprobado", "editado", "aprobado"] })).toBe(false);
  });
  it("FIXTURE NEGATIVO: menos de 3 filas decididas, o ninguna aprobada, no es evidencia", () => {
    expect(checkConfirmaMapa({ guardado: { n: 2, entradas: 100_000, salidas: 30_000 }, movimientos: movs.slice(0, 2), estados: ["aprobado", "rechazado"] })).toBe(false);
    expect(checkConfirmaMapa({ guardado, movimientos: movs, estados: ["rechazado", "rechazado", "rechazado"] })).toBe(false);
  });
});
