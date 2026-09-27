import { beforeEach, describe, expect, it, vi } from "vitest";

// Recorrido COMPLETO del PR 7a con la ingesta real y una base en memoria:
// foto ambigua → se guarda la pregunta → bot pregunta con botones → la clienta
// aprieta → se crea el movimiento + propuesta → segundo apretón no duplica.
type Fila = Record<string, unknown>;
const db: Record<string, Fila[]> = {};
let seq = 0;

function tabla(nombre: string) {
  db[nombre] ??= [];
  const filtros: Array<[string, unknown]> = [];
  let op: "select" | "update" | "insert" | "delete" = "select";
  let payload: Fila | null = null;
  let insertados: Fila[] = [];
  const filtrar = () => db[nombre].filter((f) => filtros.every(([c, v]) => f[c] === v));
  const ejecutar = () => {
    if (op === "insert") return { data: insertados, error: null };
    if (op === "update") { for (const f of filtrar()) Object.assign(f, payload); return { data: null, error: null }; }
    if (op === "delete") { db[nombre] = db[nombre].filter((f) => !filtrar().includes(f)); return { data: null, error: null }; }
    return { data: filtrar(), error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
    in: () => q, order: () => q, limit: () => q, gte: () => q, lt: () => q,
    insert: (v: Fila | Fila[]) => {
      op = "insert";
      insertados = (Array.isArray(v) ? v : [v]).map((f) => ({ id: `${nombre}-${++seq}`, ...f }));
      db[nombre].push(...insertados);
      return q;
    },
    update: (v: Fila) => { op = "update"; payload = v; return q; },
    delete: () => { op = "delete"; return q; },
    single: async () => { const r = ejecutar(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: d ? null : { message: "no rows" } }; },
    maybeSingle: async () => { const r = ejecutar(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, ko),
  };
  return q;
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (t: string) => tabla(t) }) }));

const enviados: Array<{ texto: string; teclado?: unknown }> = [];
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: async (_c: number, texto: string, o?: { replyMarkup?: unknown }) => { enviados.push({ texto, teclado: o?.replyMarkup }); return { message_id: 1 }; },
}));
vi.mock("@/lib/telegram/propuestas", () => ({
  enviarResumenPropuestas: async () => {}, registrarMensajeTelegram: async () => {}, mensajeLeiEsto: (t: string) => t,
}));
const iaLlamadas: unknown[] = [];
vi.mock("@/lib/ai/processor", () => ({ procesarDocumento: async (...a: unknown[]) => { iaLlamadas.push(a); return {}; } }));
vi.mock("@/lib/storage", () => ({ defaultStorageProvider: () => "r2", subirDocumentoR2: async () => ({ key: "k" }) }));

const E = "emp-1";
const DOC = "123e4567-e89b-12d3-a456-426614174000";
const OCR = ["Transferiste $80.000", "a Pedro Rojas", "Comprobante", "Fecha 20/09/2026"].join("\n");

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  enviados.length = 0; iaLlamadas.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  db.empresas = [{ id: E, razon_social: "Comercial Andes SpA", rut: "76.123.456-7", tipo_contribuyente: "exento" }];
  db.empresa_identidades = [];
  db.documentos_subidos = [{ id: DOC, empresa_id: E, estado: "procesando", movimientos_detectados: 0, progreso_ia: {} }];
  db.movimientos_raw = [];
  db.propuestas_ia = [];
});

describe("PR 7a de punta a punta", () => {
  it("foto ambigua → pregunta con botones → 'Me llegó' crea movimiento + propuesta; repetir no duplica", async () => {
    const { clasificarComprobanteTelegram, responderAclaracionTelegram } = await import("./ingesta");
    const { leerCallbackAclaracion } = await import("./aclaracion");

    const r1 = await clasificarComprobanteTelegram({ documentoId: DOC, empresaId: E, groupedText: OCR, chatId: 1, receivedAt: Date.parse("2026-09-27T15:00:00Z") / 1000 });
    expect(r1.movimientos_total).toBe(0);
    expect(iaLlamadas).toHaveLength(0); // no se fue a la IA
    const doc = db.documentos_subidos[0];
    const prog = doc.progreso_ia as Record<string, unknown>;
    expect(prog.estado).toBe("requiere_revision");
    expect((prog.aclaracion as Record<string, unknown>).pendientes).toEqual(["direccion"]);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain("$80.000");
    const botones = (enviados[0].teclado as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard.flat();
    const meLlego = botones.find((b) => b.text === "Me llegó")!;

    const r2 = await responderAclaracionTelegram({ empresaId: E, respuesta: leerCallbackAclaracion(meLlego.callback_data)! });
    expect(r2).toEqual({ estado: "listo", monto: 80000, tipo_flujo: "entrada" });
    expect(db.movimientos_raw).toHaveLength(1);
    expect(db.movimientos_raw[0]).toMatchObject({ monto: 80000, tipo_flujo: "entrada", fecha: "2026-09-20" });
    expect(db.propuestas_ia).toHaveLength(1);
    expect(db.propuestas_ia[0]).toMatchObject({ estado: "pendiente", total: 80000, tipo_propuesto: "exenta", confianza: 0.92 });
    expect((db.documentos_subidos[0].progreso_ia as Record<string, unknown>).estado).toBe("completado");

    const r3 = await responderAclaracionTelegram({ empresaId: E, respuesta: leerCallbackAclaracion(meLlego.callback_data)! });
    expect(r3.estado).toBe("ya_resuelto");
    expect(db.movimientos_raw).toHaveLength(1);
  });

  it("'No es una transferencia mía' descarta sin crear nada", async () => {
    const { clasificarComprobanteTelegram, responderAclaracionTelegram } = await import("./ingesta");
    const { leerCallbackAclaracion } = await import("./aclaracion");
    await clasificarComprobanteTelegram({ documentoId: DOC, empresaId: E, groupedText: OCR, chatId: 1 });
    const r = await responderAclaracionTelegram({ empresaId: E, respuesta: leerCallbackAclaracion(`ac:x:${DOC}`)! });
    expect(r.estado).toBe("descartado");
    expect(db.movimientos_raw).toHaveLength(0);
  });

  it("un botón de OTRA empresa no toca el documento", async () => {
    const { clasificarComprobanteTelegram, responderAclaracionTelegram } = await import("./ingesta");
    const { leerCallbackAclaracion } = await import("./aclaracion");
    await clasificarComprobanteTelegram({ documentoId: DOC, empresaId: E, groupedText: OCR, chatId: 1 });
    const r = await responderAclaracionTelegram({ empresaId: "otra", respuesta: leerCallbackAclaracion(`ac:e:${DOC}`)! });
    expect(r.estado).toBe("ya_resuelto");
    expect(db.movimientos_raw).toHaveLength(0);
  });
});
