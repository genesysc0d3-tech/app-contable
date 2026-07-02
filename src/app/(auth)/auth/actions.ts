"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    return { error: error.message };
  }

  redirect(next ?? "/");
}

/**
 * Registra prueba INMUTABLE del consentimiento (Política de Privacidad + Términos).
 * Burden of proof (Ley 19.628; Ley 21.719 Art. 12 cuando rija): la carga de probar el
 * consentimiento es nuestra. Se escribe con service-role en `consentimientos`. Best-effort:
 * si falla no bloquea el registro (el usuario ya marcó el checkbox obligatorio).
 */
export async function registrarConsentimiento(userId: string, email: string): Promise<void> {
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
    return { error: error.message };
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
