#!/usr/bin/env node
// Imprime los chat_id recientes del bot de alertas, para configurar OPS_TG_CHAT_ID.
//
// Pasos:
//   1) Crea el bot con @BotFather en Telegram (/newbot) → copia el token.
//   2) Crea un grupo privado (p.ej. "MassDTE Alertas") y AGREGA el bot al grupo.
//   3) Escribe cualquier mensaje en el grupo.
//   4) OPS_TG_BOT_TOKEN=<token> node scripts/ops-telegram-chatid.mjs
//
// Usa el id del GRUPO (suele ser negativo) como OPS_TG_CHAT_ID.

const token = process.env.OPS_TG_BOT_TOKEN;
if (!token) {
  console.error("Falta OPS_TG_BOT_TOKEN=<token> en el entorno.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const json = await res.json().catch(() => null);
if (!json?.ok) {
  console.error("Error de Telegram:", json?.description || `HTTP ${res.status}`);
  process.exit(1);
}

const chats = new Map();
for (const u of json.result || []) {
  const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
  if (c) chats.set(c.id, `${c.type}${c.title ? " — " + c.title : ""}`);
}

if (chats.size === 0) {
  console.log("Sin chats aún. Escribe un mensaje en el grupo (con el bot dentro) y reintenta.");
  process.exit(0);
}

console.log("Chats detectados (usa el id del GRUPO como OPS_TG_CHAT_ID):");
for (const [id, label] of chats) console.log(`  ${id}  (${label})`);
