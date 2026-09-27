import { describe, expect, it } from "vitest";
import { leerComprobante } from "./comprobante";

// Anclas de la lectura determinística única (plan PR 4/8). Comprobantes
// SINTÉTICOS con la forma de los reales. Si un cambio altera una de estas
// lecturas, tiene que ser a propósito.
const ID = ["COMERCIAL ANDES SPA", "76.123.456-7"];
const leer = (t: string, identidades = ID) => leerComprobante(t, { identidades, fechaFallback: "2026-09-27" });

describe("leerComprobante — anclas", () => {
  it("comprobante recibido con la empresa en destino → entrada segura, fecha visible", () => {
    const r = leer(["Comprobante de transferencia", "Monto: $53.000", "Fecha: 14/09/2026", "De: Juan Perez Soto", "Para: Comercial Andes SpA", "RUT: 76.123.456-7", "Número de operación: 998877AB"].join("\n"));
    expect(r.kind).toBe("parsed");
    if (r.kind !== "parsed") return;
    expect(r.parsed.monto).toBe(53000);
    expect(r.parsed.tipo_flujo).toBe("entrada");
    expect(r.parsed.fecha).toBe("2026-09-14");
    expect(r.parsed.fechaVisible).toBe(true);
    expect(r.parsed.direccionPorIdentidad).toBe(true);
    expect(r.parsed.n_documento).toBe("998877AB");
  });

  it("pantallazo del QUE PAGA ('Transferiste … a la empresa') → entrada para la clienta", () => {
    const r = leer(["Transferiste $120.000", "Para", "Comercial Andes SpA", "Cuenta corriente 12345678", "15 de septiembre de 2026"].join("\n"));
    expect(r.kind).toBe("parsed");
    if (r.kind === "parsed") expect(r.parsed.tipo_flujo).toBe("entrada");
  });

  it("'Recibiste' sin identidad → entrada, pero NO por identidad (confianza menor en la ingesta)", () => {
    const r = leer(["Recibiste una transferencia", "Monto $45.000", "De: Maria Lopez"].join("\n"), []);
    expect(r.kind).toBe("parsed");
    if (r.kind === "parsed") { expect(r.parsed.tipo_flujo).toBe("entrada"); expect(r.parsed.direccionPorIdentidad).toBe(false); }
  });

  it("'Transferiste' sin identidad → ambiguo (puede ser el pantallazo del comprador)", () => {
    const r = leer(["Transferiste $80.000", "a Pedro Rojas", "Comprobante"].join("\n"), []);
    expect(r.kind).toBe("ambiguous");
  });

  it("un chat sin transferencia → no reconocido (sigue la IA)", () => {
    expect(leer("hola, te pago mañana los 30 lucas del usdt").kind).toBe("unrecognized");
  });
});
