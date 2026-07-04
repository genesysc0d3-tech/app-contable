"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, signInWithGoogle } from "../actions";

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <LoginContent />
    </Suspense>
  );
}

// Evita el flash negro mientras carga el contenido (useSearchParams exige Suspense).
function AuthFallback() {
  return (
    <div className="mesh-bg flex-1 flex items-center justify-center min-h-screen">
      <div className="h-8 w-8 rounded-full border-2 border-white/15 border-t-[#e8553e] animate-spin" />
    </div>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await signIn(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    const result = await signInWithGoogle(next);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="mesh-bg flex-1 flex items-center justify-center px-4 py-12 min-h-screen">
      <div className="w-full max-w-sm space-y-6 relative">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Iniciar sesión</h1>
          <p className="text-white/50 mt-2 text-sm">
            Contabilidad inteligente para Chile
          </p>
        </div>

        <div className="glass rounded-2xl p-6 space-y-4 glow-accent-soft">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <form action={handleSubmit} className="space-y-3">
            {next && <input type="hidden" name="next" value={next} />}
            <div>
              <label htmlFor="email" className="block text-sm text-white/70 mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="tu@email.com"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-sm text-white/70 mb-1"
              >
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="••••••••"
              />
              <div className="text-right mt-1.5">
                <Link
                  href={next ? `/auth/recuperar?next=${encodeURIComponent(next)}` : "/auth/recuperar"}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#0a0a0a] px-2 text-white/40">o</span>
            </div>
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 border border-white/10 px-4 py-3 text-sm font-medium text-white/90 transition-colors"
          >
            Continuar con Google
          </button>
        </div>

        <p className="text-center text-sm text-white/40">
          ¿No tienes cuenta?{" "}
          <Link
            href={next ? `/auth/registro?next=${encodeURIComponent(next)}` : "/auth/registro"}
            className="text-[#e8553e] hover:text-[#e8553e]/80"
          >
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}

function safeNextPath(value: string | null): string | null {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
