"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

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

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const next = safeNextPath(formData.get("next"));
  const origin = await getRequestOrigin();
  const emailRedirectTo = next ? `${origin}/auth/callback?next=${encodeURIComponent(next)}` : `${origin}/auth/callback`;

  const { error } = await supabase.auth.signUp({
    email: formData.get("email") as string,
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
