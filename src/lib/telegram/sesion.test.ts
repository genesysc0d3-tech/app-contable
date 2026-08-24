/**
 * La sesión es lo que permite NO adivinar qué fotos son el mismo comprobante:
 * el usuario abre una, elige empresa y mesa, y todo lo que llega mientras esté
 * viva pertenece a ese comprobante. Estos tests cubren las transiciones y —sobre
 * todo— los casos donde NO debe avanzar: token de un menú viejo, sesión vencida,
 * saltarse un paso.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import {
  abrirSesion,
  sesionDe,
  elegirEmpresa,
  elegirMesa,
  fijarDocumento,
  cerrarSesion,
  parseOpcionesSesion,
  SESION_TTL_MS,
} from "./sesion";

type Fila = Record<string, unknown> | null;
let fila: Fila = null;

/** Supabase de mentira: una sola fila (chat_id es PK, una sesión por chat). */
function fakeSvc(): SupabaseClient<Database> {
  const builder = () => {
    const filtros: Record<string, unknown> = {};
    let nullCheck: string | null = null;
    const api: Record<string, unknown> = {
      upsert(valores: Record<string, unknown>) {
        fila = { ...valores };
        return api;
      },
      update(valores: Record<string, unknown>) {
        api.__update = valores;
        return api;
      },
      delete() {
        api.__delete = true;
        return api;
      },
      select() { return api; },
      eq(col: string, val: unknown) { filtros[col] = val; return api; },
      is(col: string, val: unknown) { if (val === null) nullCheck = col; return api; },
      maybeSingle: async () => ({ data: aplicar(), error: null }),
      single: async () => {
        const d = aplicar();
        return d ? { data: d, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (res: (v: { data: null; error: null }) => void) => { aplicar(); res({ data: null, error: null }); },
    };
    function coincide(): boolean {
      if (!fila) return false;
      return Object.entries(filtros).every(([k, v]) => fila![k] === v);
    }
    function aplicar(): Fila {
      if (api.__delete) { if (coincide()) fila = null; return null; }
      if (api.__update) {
        if (!coincide()) return null;
        if (nullCheck && fila![nullCheck] != null) return null;
        fila = { ...fila, ...(api.__update as Record<string, unknown>) };
        return fila;
      }
      return coincide() ? fila : null;
    }
    return api;
  };
  return { from: () => builder() } as unknown as SupabaseClient<Database>;
}

const svc = fakeSvc();
const CHAT = 12345;
const EMPRESAS = [
  { id: "emp-1", rut: "76.111.111-1", nombre: "Uno SpA" },
  { id: "emp-2", rut: "77.222.222-2", nombre: "Dos SpA" },
];

describe("sesión de Telegram", () => {
  beforeEach(() => { fila = null; vi.useRealTimers(); });

  it("abre en 'eligiendo_empresa' y guarda las opciones", async () => {
    const s = await abrirSesion(svc, CHAT, EMPRESAS);
    expect(s?.estado).toBe("eligiendo_empresa");
    expect(s?.opciones).toHaveLength(2);
    expect(s?.empresa_id).toBeNull();
  });

  it("con UNA sola empresa igual abre el paso (decisión de producto)", async () => {
    const s = await abrirSesion(svc, CHAT, [EMPRESAS[0]]);
    expect(s?.opciones).toHaveLength(1);
  });

  it("recorre el flujo: empresa → mesa → esperando fotos", async () => {
    const s = await abrirSesion(svc, CHAT, EMPRESAS);
    const elegida = await elegirEmpresa(svc, CHAT, s!.token, 1);
    expect(elegida?.empresa.id).toBe("emp-2");
    expect(elegida?.sesion.estado).toBe("eligiendo_mesa");

    const lista = await elegirMesa(svc, CHAT, s!.token, "boleta");
    expect(lista?.mesa).toBe("boleta");
    expect(lista?.estado).toBe("esperando_fotos");
  });

  it("rechaza el token de un menú viejo", async () => {
    const s = await abrirSesion(svc, CHAT, EMPRESAS);
    expect(await elegirEmpresa(svc, CHAT, "token-viejo", 0)).toBeNull();
    expect(s!.token).not.toBe("token-viejo");
  });

  it("rechaza un índice de empresa que no existe", async () => {
    const s = await abrirSesion(svc, CHAT, EMPRESAS);
    expect(await elegirEmpresa(svc, CHAT, s!.token, 99)).toBeNull();
  });

  it("no deja elegir mesa sin haber elegido empresa", async () => {
    const s = await abrirSesion(svc, CHAT, EMPRESAS);
    expect(await elegirMesa(svc, CHAT, s!.token, "boleta")).toBeNull();
  });

  it("la sesión vencida se trata como inexistente", async () => {
    await abrirSesion(svc, CHAT, EMPRESAS);
    (fila as Record<string, unknown>).expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await sesionDe(svc, CHAT)).toBeNull();
  });

  it("el vencimiento es de 15 minutos", async () => {
    const s = await abrirSesion(svc, CHAT, EMPRESAS);
    const restante = new Date(s!.expires_at).getTime() - Date.now();
    expect(restante).toBeGreaterThan(SESION_TTL_MS - 5_000);
    expect(restante).toBeLessThanOrEqual(SESION_TTL_MS);
  });

  it("abrir de nuevo reemplaza la sesión anterior (una viva por chat)", async () => {
    const a = await abrirSesion(svc, CHAT, EMPRESAS);
    const b = await abrirSesion(svc, CHAT, EMPRESAS);
    expect(b!.token).not.toBe(a!.token);
    expect(await elegirEmpresa(svc, CHAT, a!.token, 0)).toBeNull();
  });

  it("solo la PRIMERA foto fija el documento del comprobante", async () => {
    const s = await abrirSesion(svc, CHAT, EMPRESAS);
    await elegirEmpresa(svc, CHAT, s!.token, 0);
    await elegirMesa(svc, CHAT, s!.token, "boleta");
    expect(await fijarDocumento(svc, CHAT, s!.token, "doc-1")).toBe(true);
    expect(await fijarDocumento(svc, CHAT, s!.token, "doc-2")).toBe(false);
  });

  it("cancelar borra la sesión", async () => {
    await abrirSesion(svc, CHAT, EMPRESAS);
    await cerrarSesion(svc, CHAT);
    expect(await sesionDe(svc, CHAT)).toBeNull();
  });

  it("parseOpcionesSesion ignora basura y filas sin id", () => {
    expect(parseOpcionesSesion(null)).toEqual([]);
    expect(parseOpcionesSesion([{ rut: "x" }, "no-objeto", { id: "ok" }] as never)).toEqual([
      { id: "ok", rut: null, nombre: null },
    ]);
  });
});
