import { describe, expect, it } from "vitest";
import {
  mensajeMovimientoSinBoleta,
  mensajeConfirmarIngreso,
  mensajeConfirmarCompra,
  type MovimientoBot,
} from "./propuestas";
import { resolverDireccionTelegram } from "./deterministico";

// El fundador opera P2P como persona (Osvaldo / DOMIDOG SPA / sus cuentas).
const identidades = ["Osvaldo Cuellar", "18512171", "DOMIDOG SPA", "56113251"];

const movCompra: MovimientoBot = {
  id: "m1",
  documento_id: "d1",
  fecha: "2026-06-08",
  descripcion: "Compra USDT P2P: 540.47 USDT de Ikigai Spa",
  monto: 500000,
  tipo_flujo: "salida",
  origen: "telegram",
  n_documento: null,
};

describe("dirección sales-only (resolverDireccionTelegram)", () => {
  it("COMPRA: la empresa en ORIGEN + 'monto transferido' → salida (no debe emitir boleta)", () => {
    const lines = ["Transferencia enviada", "De Osvaldo Cuellar", "Para Ikigai Spa", "monto transferido $500.000"];
    const d = resolverDireccionTelegram({
      text: lines.join("\n"),
      destino: "Ikigai Spa",
      origen: "Osvaldo Cuellar",
      identidades,
    });
    expect(d?.tipo_flujo).toBe("salida");
  });

  it("VENTA: la empresa en DESTINO + 'te transfirió/pago recibido' → entrada (boleta)", () => {
    const lines = ["Pago recibido", "De Juan Perez", "Para DOMIDOG SPA", "te transfirió $500.000"];
    const d = resolverDireccionTelegram({
      text: lines.join("\n"),
      destino: "DOMIDOG SPA",
      origen: "Juan Perez",
      identidades,
    });
    expect(d?.tipo_flujo).toBe("entrada");
  });

  it("ambiguo: ninguna parte es la empresa y sin verbo claro → NO fuerza venta", () => {
    const d = resolverDireccionTelegram({
      text: "transferencia",
      destino: "Juan",
      origen: "Pedro",
      identidades,
    });
    expect(d?.tipo_flujo).not.toBe("entrada"); // la clave: no inventa una venta
  });
});

describe("flujo de confirmación compra/venta en el bot (sales-only)", () => {
  const datasDe = (kb?: { inline_keyboard: { callback_data?: string }[][] }) =>
    (kb?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

  it("una SALIDA se presenta como COMPRA y pregunta ingreso/compra", () => {
    const { text, keyboard } = mensajeMovimientoSinBoleta(movCompra);
    expect(text.toLowerCase()).toContain("compra");
    expect(text.toLowerCase()).toMatch(/solo de ventas|no genera boleta/);
    const datas = datasDe(keyboard);
    expect(datas).toContain("mv:m1:i1"); // 💰 Es ingreso (venta)
    expect(datas).toContain("mv:m1:c1"); // 🛒 Es compra
  });

  it("confirmar INGRESO muestra el PORQUÉ (la descripción leída) + doble confirmación", () => {
    const { text, keyboard } = mensajeConfirmarIngreso(movCompra);
    expect(text.toLowerCase()).toContain("seguro");
    expect(text).toContain("Compra USDT P2P"); // el porqué = lo que leyó
    const datas = datasDe(keyboard);
    expect(datas).toContain("mv:m1:i2"); // ✅ sí, emitir boleta
    expect(datas).toContain("mv:m1:bk"); // ↩︎ no, volver
  });

  it("confirmar COMPRA → descartar, con doble confirmación (no emite)", () => {
    const { text, keyboard } = mensajeConfirmarCompra(movCompra);
    expect(text.toLowerCase()).toContain("compra");
    const datas = datasDe(keyboard);
    expect(datas).toContain("mv:m1:c2"); // ✓ sí, descartar
    expect(datas).toContain("mv:m1:bk"); // ↩︎ no, volver
  });
});
