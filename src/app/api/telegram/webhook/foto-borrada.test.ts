import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recorrido real del webhook con la foto de un comprobante: se copia a nuestro
 * almacenamiento y recién ahí se borra del chat (Telegram no tiene contrato de
 * tratamiento de datos). Supabase, R2 y la Bot API van simulados; la ruta y
 * api.ts son los reales, así que se verifica la llamada HTTP a deleteMessage.
 */

vi.mock("server-only", () => ({}));
const pendientes: Promise<unknown>[] = [];
vi.mock("next/server", () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ body: b, status: i?.status ?? 200 }) },
  after: (fn: () => Promise<unknown>) => { pendientes.push(fn()); },
}));

const orden: string[] = [];
vi.mock("@/lib/storage", () => ({
  subirDocumentoR2: vi.fn(async () => { orden.push("subida_r2"); return { key: "r2/foto.jpg" }; }),
}));
vi.mock("@/lib/entitlements", () => ({
  telegramHabilitadoEmpresa: vi.fn(async () => true),
  contextoCuentaPorEmpresa: vi.fn(async () => null),
}));
vi.mock("@/lib/telegram/sesion", async (orig) => ({
  ...(await orig<typeof import("@/lib/telegram/sesion")>()),
  sesionDe: vi.fn(async () => ({
    chat_id: 555, token: "tok", empresa_id: "E1", mesa: "boletas", estado: "fotos",
    opciones: [], documento_id: null, message_id: null, expires_at: "2099-01-01T00:00:00Z",
  })),
  tocarSesion: vi.fn(async () => {}),
  recordarMensaje: vi.fn(async () => {}),
}));

// Supabase mínimo: solo lo que toca la recepción de una foto.
function tabla(nombre: string) {
  let op = "select";
  const b: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "lt"]) {
    b[m] = (..._a: unknown[]) => { if (["insert", "update", "delete"].includes(m)) op = m; return b; };
  }
  const resolver = () => {
    if (nombre === "telegram_album_buffer" && op === "select") return { count: 0, error: null };
    return { data: null, error: null };
  };
  b.maybeSingle = async () => {
    if (nombre === "telegram_chats") return { data: { empresa_id: "E1", activo: true, usuario_id: "U1" } };
    if (nombre === "usuarios") return { data: { empresa_id: "E1", rol: "owner", vetado: false } };
    return { data: null };
  };
  b.single = async () => ({ data: { id: "buf1", created_at: new Date().toISOString() }, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(resolver()).then(ok);
  return b;
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: tabla }) }));

type Llamada = { metodo: string; body: Record<string, unknown> };
let llamadas: Llamada[] = [];
let deleteOk = true;

beforeEach(() => {
  llamadas = []; orden.length = 0; pendientes.length = 0; deleteOk = true;
  process.env.TELEGRAM_WEBHOOK_SECRET = "s";
  process.env.TELEGRAM_BOT_TOKEN = "t";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.includes("/file/bot")) return new Response(new Uint8Array([1, 2, 3]));
    const metodo = url.split("/").pop()!;
    const body = init?.body ? JSON.parse(init.body) : {};
    llamadas.push({ metodo, body });
    if (metodo === "deleteMessage") orden.push("borrado");
    if (metodo === "getFile") return Response.json({ ok: true, result: { file_path: "photos/a.jpg" } });
    if (metodo === "deleteMessage" && !deleteOk) return Response.json({ ok: false, description: "message can't be deleted" }, { status: 400 });
    return Response.json({ ok: true, result: metodo === "sendMessage" ? { message_id: 900 } : true });
  }));
});

async function mandarFoto(tipoChat: string) {
  const { POST } = await import("./route");
  const update = {
    message: {
      message_id: 77, chat: { id: 555, type: tipoChat }, date: 1,
      photo: [{ file_id: "F1", file_unique_id: "u", width: 800, height: 600, file_size: 1000 }],
    },
  };
  await POST(new Request("http://x", {
    method: "POST", headers: { "x-telegram-bot-api-secret-token": "s" }, body: JSON.stringify(update),
  }));
  await Promise.all(pendientes);
}

describe("la foto del comprobante sale del chat de Telegram", () => {
  it("chat privado: se copia a R2, DESPUÉS se borra, y se le avisa al cliente", async () => {
    await mandarFoto("private");
    const del = llamadas.find((l) => l.metodo === "deleteMessage");
    expect(del?.body).toEqual({ chat_id: 555, message_id: 77 });
    expect(orden).toEqual(["subida_r2", "borrado"]);
    const aviso = llamadas.find((l) => l.metodo === "sendMessage");
    expect(String(aviso?.body.text)).toContain("Saqué la foto de este chat");
  });

  it("si Telegram no deja borrar, el comprobante igual queda recibido y no se promete nada", async () => {
    deleteOk = false;
    await mandarFoto("private");
    const aviso = llamadas.find((l) => l.metodo === "sendMessage");
    expect(String(aviso?.body.text)).toContain("Recibí");
    expect(String(aviso?.body.text)).not.toContain("Saqué la foto");
  });

  it("en un grupo no intenta borrar", async () => {
    await mandarFoto("group");
    expect(llamadas.some((l) => l.metodo === "deleteMessage")).toBe(false);
  });
});
