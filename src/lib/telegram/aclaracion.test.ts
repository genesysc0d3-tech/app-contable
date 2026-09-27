import { describe, expect, it } from "vitest";
import { completarComprobante, leerComprobante } from "@/lib/lectura/comprobante";
import { aplicarRespuesta, leerCallbackAclaracion, preguntaAclaracion, sePuedePreguntar, type AclaracionGuardada } from "./aclaracion";

// Plan PR 7a/8 — si la lectura es ambigua, se le pregunta a la clienta con
// botones (nunca texto libre) y su respuesta completa la lectura.
const DOC = "123e4567-e89b-12d3-a456-426614174000";
const ctx = { identidades: ["COMERCIAL ANDES SPA"], fechaFallback: "2026-09-27" };

describe("pregunta a la clienta en Telegram", () => {
  it("'Transferiste' sin identidad → pregunta ¿te llegó o lo pagaste? → 'Me llegó' = entrada", () => {
    const r = leerComprobante(["Transferiste $80.000", "a Pedro Rojas", "Comprobante", "Fecha 20/09/2026"].join("\n"), { ...ctx, identidades: [] });
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    const a = r.aclaracion!;
    expect(a.pendientes).toEqual(["direccion"]);
    expect(sePuedePreguntar(a)).toBe(true);
    const { texto, teclado } = preguntaAclaracion(a, DOC);
    expect(texto).toContain("$80.000");
    const botones = teclado.inline_keyboard.flat();
    expect(botones.map((b) => b.text)).toEqual(["Me llegó", "La pagué yo", "No es una transferencia mía"]);
    for (const b of botones) expect(Buffer.byteLength(String(b.callback_data))).toBeLessThanOrEqual(64);

    const resp = leerCallbackAclaracion(`ac:e:${DOC}`)!;
    const nueva = aplicarRespuesta(a as AclaracionGuardada, resp)!;
    expect(nueva.pendientes).toEqual([]);
    const leido = completarComprobante(nueva, {})!;
    expect(leido.monto).toBe(80000);
    expect(leido.tipo_flujo).toBe("entrada");
    expect(leido.fecha).toBe("2026-09-20");
    expect(leido.direccionPorIdentidad).toBe(true); // lo dijo ella: confianza plena
  });

  it("monto en conflicto → botones con los montos → elegir uno completa la lectura", () => {
    const a: AclaracionGuardada = {
      pendientes: ["monto"], opcionesMonto: [53000, 5300], monto: null, tipo_flujo: "entrada", direccionPorIdentidad: true,
      fecha: "2026-09-14", fechaVisible: true, n_documento: null, origen: "Juan Perez", destino: "Comercial Andes SpA", rut: null, tipoVentaSiEntrada: null,
    };
    const { teclado } = preguntaAclaracion(a, DOC);
    expect(teclado.inline_keyboard[0].map((b) => b.text)).toEqual(["$53.000", "$5.300"]);
    const nueva = aplicarRespuesta(a, leerCallbackAclaracion(`ac:m:0:${DOC}`)!)!;
    expect(completarComprobante(nueva, {})?.monto).toBe(53000);
  });

  it("si faltan monto Y dirección, pregunta primero el monto y después la dirección", () => {
    const a: AclaracionGuardada = {
      pendientes: ["monto", "direccion"], opcionesMonto: [10000, 20000], monto: null, tipo_flujo: null, direccionPorIdentidad: false,
      fecha: "2026-09-14", fechaVisible: true, n_documento: null, origen: "", destino: "", rut: null, tipoVentaSiEntrada: null,
    };
    const tras1 = aplicarRespuesta(a, leerCallbackAclaracion(`ac:m:1:${DOC}`)!)!;
    expect(tras1.pendientes).toEqual(["direccion"]);
    expect(preguntaAclaracion(tras1, DOC).texto).toContain("$20.000");
    expect(completarComprobante(tras1, {})).toBeNull(); // todavía falta la dirección
  });

  it("respuestas fuera de lugar no hacen nada", () => {
    const a: AclaracionGuardada = {
      pendientes: ["direccion"], opcionesMonto: [], monto: 1000, tipo_flujo: null, direccionPorIdentidad: false,
      fecha: "2026-09-14", fechaVisible: true, n_documento: null, origen: "", destino: "", rut: null, tipoVentaSiEntrada: null,
    };
    expect(aplicarRespuesta(a, leerCallbackAclaracion(`ac:m:0:${DOC}`)!)).toBeNull();
    expect(leerCallbackAclaracion("ac:e:no-es-uuid")).toBeNull();
    expect(leerCallbackAclaracion(`ac:x:${DOC}`)?.tipo).toBe("descartar");
  });
});
