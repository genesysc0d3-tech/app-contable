import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { telegramHabilitadoEmpresa } from "@/lib/entitlements";
import { esRolEmision } from "@/lib/auth/roles";
import { sendMessage } from "@/lib/telegram/api";

const MSG_DESCONECTADO_PANEL =
  "🔌 <b>Este chat fue desconectado desde massDTE.</b>\n" +
  "Para volver a usarlo, genera un link nuevo en <b>Empresa → Bot de Telegram</b>.";

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
    return NextResponse.json({ botConfigured, vinculado: false, enPlan: false });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ botConfigured, vinculado: false, enPlan: false });
  const svc = createServiceClient<Database>(url, key);

  const enPlan = await telegramHabilitadoEmpresa(svc, usuario.empresa_id);

  // order+limit en vez de maybeSingle: con 2+ filas activas maybeSingle ERRA y
  // el panel mostraba "Sin conectar" mientras los chats seguían emitiendo por
  // atrás. El índice único (migración 20260822170000) garantiza 1 activo, pero
  // la lectura queda defensiva igual.
  const { data: chats } = await svc
    .from("telegram_chats")
    .select("chat_id, vinculado_at, usuario_id")
    .eq("empresa_id", usuario.empresa_id)
    .eq("activo", true)
    .order("vinculado_at", { ascending: false })
    .limit(1);
  const chat = chats?.[0] ?? null;

  // Quién conectó y cuándo: el panel lo muestra para que el titular detecte
  // al tiro un Telegram ajeno colgado de su empresa.
  let vinculadoPor: string | null = null;
  if (chat?.usuario_id) {
    const { data: quien } = await svc
      .from("usuarios")
      .select("nombre, email")
      .eq("id", chat.usuario_id)
      .maybeSingle();
    vinculadoPor = quien?.nombre || quien?.email || null;
  }

  return NextResponse.json({
    botConfigured,
    vinculado: Boolean(chat),
    enPlan,
    vinculadoPor,
    vinculadoAt: chat?.vinculado_at ?? null,
  });
}

/**
 * Desconecta el Telegram activo de la empresa (mismo gate de rol que vincular:
 * cortar el canal de comprobantes es un acto de emisión, no de viewer). Avisa
 * al chat desconectado para que el takeover/corte nunca sea silencioso.
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol, vetado")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  if (usuario.vetado === true || !esRolEmision(usuario.rol)) {
    return NextResponse.json({ error: "ROL_SIN_PERMISO" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const svc = createServiceClient<Database>(url, key);

  const { data: desconectados, error } = await svc
    .from("telegram_chats")
    .update({ activo: false })
    .eq("empresa_id", usuario.empresa_id)
    .eq("activo", true)
    .select("chat_id");
  if (error) {
    console.error("[telegram-link] desconectar fallo:", error.message);
    return NextResponse.json({ error: "DB_UPDATE_FAILED" }, { status: 500 });
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    for (const chat of desconectados ?? []) {
      try {
        await sendMessage(chat.chat_id, MSG_DESCONECTADO_PANEL, { html: true });
      } catch { /* chat cerrado/bloqueado: la desconexión en la base ya está hecha */ }
    }
  }

  return NextResponse.json({ ok: true, desconectados: (desconectados ?? []).length });
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
    .select("empresa_id, rol, vetado")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  // El chat de Telegram aprueba/edita propuestas (acto tributario): solo roles de
  // emisión pueden vincularlo, no un 'viewer'. (El webhook debería además revalidar
  // rol/vetado del que vinculó y desactivar su chat al removerlo — pendiente para
  // cuando el bot esté vivo; hoy la ruta ya devuelve 503 sin TELEGRAM_BOT_TOKEN.)
  if (usuario.vetado === true || !esRolEmision(usuario.rol)) {
    return NextResponse.json({ error: "ROL_SIN_PERMISO" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    return NextResponse.json({ error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  }
  const svc = createServiceClient<Database>(url, key);

  if (!(await telegramHabilitadoEmpresa(svc, usuario.empresa_id))) {
    return NextResponse.json({ error: "TELEGRAM_NO_EN_PLAN" }, { status: 403 });
  }

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
