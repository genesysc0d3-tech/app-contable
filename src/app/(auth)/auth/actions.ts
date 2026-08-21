"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { POLICY_VERSION } from "@/lib/legal/version";

function safeNextPath(value: FormDataEntryValue | string | null): string | null {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

async function getRequestOrigin(): Promise<string> {
  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) return origin;

  const host = headersList.get("x-forwarded-host") || "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

// Supabase Auth responde en inglés; el usuario final debe ver el error en español.
function traducirErrorAuth(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes("invalid login credentials")) return "Email o contraseña incorrectos";
  if (msg.includes("user already registered")) return "Ese email ya tiene una cuenta — inicia sesión";
  if (msg.includes("password should be at least")) return "La contraseña debe tener al menos 6 caracteres";
  if (msg.includes("rate limit")) return "Demasiados intentos — espera un momento";
  return "No se pudo completar. Intenta de nuevo.";
}

/** IP del cliente para rate-limit (server actions no reciben Request). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

/** Honeypot clásico: campo invisible que solo los bots rellenan. */
function esBot(formData: FormData): boolean {
  return String(formData.get("sitio_web") ?? "").trim().length > 0;
}

export async function signIn(formData: FormData) {
  // Freno anti fuerza-bruta por IP+email (además del rate-limit de Supabase):
  // 8 intentos por 5 minutos. In-memory por instancia — no es perfecto en
  // serverless, pero Fluid reusa instancias y Supabase es la red de fondo.
  const ip = await clientIp();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const rl = checkRateLimit({ key: rateLimitKey("login", ip, email), limit: 8, windowMs: 5 * 60 * 1000 });
  if (!rl.ok) return { error: "Demasiados intentos — espera un momento" };

  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    return { error: traducirErrorAuth(error.message) };
  }

  redirect(next ?? "/");
}

export async function solicitarRecuperacion(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: true };

  const supabase = await createClient();
  const origin = await getRequestOrigin();

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/auth/nueva-clave")}`,
  });

  // Respuesta SIEMPRE neutra (exista o no la cuenta): evita enumerar emails.
  return { ok: true };
}

/**
 * Registra prueba INMUTABLE del consentimiento (Política de Privacidad + Términos).
 * Burden of proof (Ley 19.628; Ley 21.719 Art. 12 cuando rija): la carga de probar el
 * consentimiento es nuestra. Se escribe con service-role en `consentimientos`. Best-effort:
 * si falla no bloquea el registro (el usuario ya marcó el checkbox obligatorio).
 *
 * NO exportada a propósito: este módulo es "use server", así que un export la volvería
 * un endpoint POST público que insertaría filas de consentimiento forjadas
 * (user_id/email/ip arbitrarios) con service-role SIN autenticación. Solo la llama
 * signUp con el userId real recién creado.
 */
async function registrarConsentimiento(userId: string, email: string): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const headersList = await headers();
    const ip = (headersList.get("x-forwarded-for") ?? "").split(",")[0].trim() || headersList.get("x-real-ip") || null;
    const userAgent = headersList.get("user-agent") || null;
    const sb = createServiceClient(url, key);
    await sb.from("consentimientos").insert({
      user_id: userId,
      email,
      documento: "politica-privacidad+terminos",
      version: POLICY_VERSION,
      ip,
      user_agent: userAgent,
    });
  } catch {
    // no bloquear el registro si el log de consentimiento falla
  }
}

export async function signUp(formData: FormData) {
  // Honeypot: los humanos no ven el campo "sitio_web"; los bots lo rellenan.
  // Respuesta genérica a propósito (no revelar el mecanismo).
  if (esBot(formData)) return { error: "No se pudo completar. Intenta de nuevo." };
  // Registro también con freno por IP: 5 cuentas / hora por IP es más que
  // suficiente para humanos y corta el registro masivo automatizado.
  {
    const ip = await clientIp();
    const rl = checkRateLimit({ key: rateLimitKey("signup", ip), limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return { error: "Demasiados intentos — espera un momento" };
  }
  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));
  const origin = await getRequestOrigin();
  const emailRedirectTo = next ? `${origin}/auth/callback?next=${encodeURIComponent(next)}` : `${origin}/auth/callback`;

  // Consentimiento obligatorio (defensa en profundidad: el checkbox del form ya es
  // `required`, pero igual lo validamos en el server).
  if (!formData.get("consentimiento")) {
    return { error: "Debes aceptar la Política de Privacidad y los Términos para crear la cuenta." };
  }

  const email = formData.get("email") as string;
  const { data, error } = await supabase.auth.signUp({
    email,
    password: formData.get("password") as string,
    options: {
      emailRedirectTo,
      data: {
        nombre: formData.get("nombre") as string,
      },
    },
  });

  if (error) {
    return { error: traducirErrorAuth(error.message) };
  }

  if (data.user) {
    await registrarConsentimiento(data.user.id, email);
  }

  redirect(next ?? "/onboarding");
}

export async function signInWithGoogle(nextPath?: string | null) {
  const supabase = await createClient();
  const origin = await getRequestOrigin();
  const next = safeNextPath(nextPath ?? null);
  const callbackUrl = next ? `${origin}/auth/callback?next=${encodeURIComponent(next)}` : `${origin}/auth/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl,
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}
