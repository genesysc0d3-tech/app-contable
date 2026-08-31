/**
 * Acuña un token del conector MCP para un usuario (por email).
 *
 *   npx tsx scripts/crear-mcp-token.mts correo@dominio.cl "mi conector"
 *
 * Usa el service role de .env.local. El token se imprime UNA sola vez
 * (en la base queda solo el hash) — guárdalo en el gestor de claves.
 * Requiere la migración 20260831180000_mcp_tokens aplicada.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { generarMcpToken, hashMcpToken } from "../src/lib/mcp/token";

function envLocal(name: string): string {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const line = raw.split("\n").find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim() ?? "";
  if (!value) throw new Error(`Falta ${name} en .env.local`);
  return value;
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
const nombre = (process.argv[3] ?? "conector").trim().slice(0, 60);
if (!email) {
  console.error("Uso: npx tsx scripts/crear-mcp-token.mts <email> [nombre]");
  process.exit(1);
}

const svc = createClient(envLocal("NEXT_PUBLIC_SUPABASE_URL"), envLocal("SUPABASE_SERVICE_ROLE_KEY"));

const { data: usuario, error } = await svc
  .from("usuarios")
  .select("id, email, empresa_id, vetado")
  .eq("email", email)
  .maybeSingle();
if (error) throw error;
if (!usuario) throw new Error(`No existe usuario con email ${email}`);
if (usuario.vetado) throw new Error("Usuario vetado: no se acuñan tokens");
if (!usuario.empresa_id) throw new Error("Usuario sin empresa: el conector no tendría a quién mirar");

const token = generarMcpToken();
const { error: insertError } = await svc.from("mcp_tokens").insert({
  usuario_id: usuario.id,
  token_hash: hashMcpToken(token),
  nombre,
});
if (insertError) throw insertError;

console.log("Token del conector MCP (se muestra UNA vez):\n");
console.log(`  ${token}\n`);
console.log("Conectar desde Claude Code:");
console.log(`  claude mcp add --transport http massdte https://app.massdte.cl/api/mcp --header "Authorization: Bearer ${token.slice(0, 12)}…"`);
console.log("\n(usa el token completo en el header; acá va recortado para no dejarlo en el scrollback)");
