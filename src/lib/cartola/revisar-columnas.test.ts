import { describe, expect, it } from "vitest";
import { leerCuadre } from "./cuadre-mesa";
import { revisarColumnas } from "./verificacion";
import type { MapaUsado } from "@/lib/parsers/types";

// DISPARADOR del popup "Revisa las columnas" (2026-09-30). Meta: preguntar lo
// menos posible, solo cuando de verdad no se puede saber. Una vez por FORMATO:
// con un mapa ya confirmado para ese formato no se vuelve a preguntar, salvo que
// un chequeo de ESTE archivo falle (y entonces se dice por qué en una línea).

const nuevo: MapaUsado = { adapter_id: "a", estado: "provisorio", nuevo: true };
const confirmadoCliente: MapaUsado & { confirmado_por?: string } = { adapter_id: "a", estado: "confirmado", nuevo: false, confirmado_por: "cliente" };

describe("revisarColumnas: ¿se abre solo el popup?", () => {
  it("ABRE: sin prueba y el formato es nuevo (nadie confirmó sus columnas)", () => {
    const r = revisarColumnas({ verificacion: { tipo: "sin_comprobar", detalle: "No trae saldo" }, mapa: nuevo });
    expect(r.abrir).toBe(true);
    expect(r.otraVez).toBe(false);
    expect(r.motivo).toBeTruthy();
  });

  it("ABRE: con alerta y formato nuevo, el motivo es la alerta", () => {
    const r = revisarColumnas({ verificacion: { tipo: "sin_comprobar", alerta: true, detalle: "El banco no calza: total cargos" }, mapa: nuevo });
    expect(r.abrir).toBe(true);
    expect(r.motivo).toMatch(/banco no calza/);
  });

  it("NO abre: ese formato ya tiene columnas confirmadas y este archivo no trae nada raro", () => {
    expect(revisarColumnas({ verificacion: { tipo: "sin_comprobar", detalle: "No trae saldo" }, mapa: confirmadoCliente }).abrir).toBe(false);
  });

  it("NO abre: la cartola quedó comprobada (saldo al peso o total del banco) o ya la confirmó el cliente", () => {
    expect(revisarColumnas({ verificacion: { tipo: "saldo", detalle: "" }, mapa: nuevo }).abrir).toBe(false);
    expect(revisarColumnas({ verificacion: { tipo: "total_banco", detalle: "" }, mapa: nuevo }).abrir).toBe(false);
    expect(revisarColumnas({ verificacion: { tipo: "cliente", detalle: "" }, mapa: nuevo }).abrir).toBe(false);
  });

  it("NO abre en la plantilla massDTE (columnas fijas): una alerta ahí es de FILAS, va a Editar", () => {
    const plantilla: MapaUsado = { adapter_id: "p", estado: "confirmado", nuevo: false, confirmado_por: "plantilla" };
    expect(revisarColumnas({ verificacion: { tipo: "sin_comprobar", alerta: true, detalle: "Posible subtotal" }, mapa: plantilla }).abrir).toBe(false);
  });

  it("NO abre en cuadres viejos sin sello (documentos antiguos no molestan)", () => {
    expect(revisarColumnas({}).abrir).toBe(false);
  });

  it("REABRE con motivo: formato confirmado pero ESTE archivo falla un chequeo (alerta)", () => {
    const r = revisarColumnas({ verificacion: { tipo: "sin_comprobar", alerta: true, detalle: "2 fila(s) oculta(s) con plata" }, mapa: confirmadoCliente });
    expect(r.abrir).toBe(true);
    expect(r.otraVez).toBe(true);
    expect(r.motivo).toMatch(/^Esta vez algo no calza: 2 fila\(s\) oculta\(s\) con plata/);
  });

  it("REABRE con motivo: formato confirmado pero el signo del monto no dice la dirección (revisar)", () => {
    const r = revisarColumnas({ verificacion: { tipo: "sin_comprobar", revisar: true, detalle: "nada dice si el signo es cargo o abono" }, mapa: confirmadoCliente });
    expect(r.abrir).toBe(true);
    expect(r.motivo).toMatch(/^Esta vez algo no calza/);
  });

  it("el disparador funciona con lo que la mesa lee de progreso_ia (leerCuadre conserva revisar, filtrada y contradice)", () => {
    const q = leerCuadre({ cuadre: { perdidas: [], guardadas: 3, verificacion: { tipo: "sin_comprobar", detalle: "x", revisar: true, filtrada: "abonos", contradice: "saldo" }, mapa: confirmadoCliente } })!;
    expect(q.verificacion).toMatchObject({ revisar: true, filtrada: "abonos", contradice: "saldo" });
    expect(revisarColumnas(q).abrir).toBe(true);
  });
});
