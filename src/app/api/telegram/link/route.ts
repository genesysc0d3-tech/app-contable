import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Estado de vinculación del Telegram de la empresa del usuario autenticado.
 * Lo usa el panel de empresa para mostrar "Conectado" / "Sin conectar".
 */
export async function GET() {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const botConfigured = Boolean(botUsername && process.env.TELEGRAM_BOT_TOKEN);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ botConfigured, vinculado: false });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ botConfigured, vinculado: false });
  const svc = createServiceClient<Database>(url, key);

  const { data: chat } = await svc
    .from("telegram_chats")
    .select("chat_id")
    .eq("empresa_id", usuario.empresa_id)
    .eq("activo", true)
    .maybeSingle();

  return NextResponse.json({ botConfigured, vinculado: Boolean(chat) });
}

/**
 * Genera un link de vinculación de Telegram para el usuario autenticado.
 * El token vive 15 minutos, es de un solo uso, y el webhook lo canjea por
 * una fila en telegram_chats (chat -> empresa).
 */
export async function POST() {
  // Degrada elegante: sin bot configurado, la UI muestra "próximamente".
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername || !process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: "TELEGRAM_NO_CONFIGURADO" }, { status: 503 });
  }

  // Auth + empresa (mismo patrón que /api/intermediaria/emitir-boleta).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    return NextResponse.json({ error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  }
  const svc = createServiceClient<Database>(url, key);

  const token = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error } = await svc.from("telegram_link_tokens").insert({
    token,
    empresa_id: usuario.empresa_id,
    usuario_id: user.id,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[telegram-link] insert fallo:", error.message);
    return NextResponse.json({ error: "DB_INSERT_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    link: `https://t.me/${botUsername}?start=${token}`,
    expiraEn: "15 minutos",
  });
}

export const dynamic = "force-dynamic";
