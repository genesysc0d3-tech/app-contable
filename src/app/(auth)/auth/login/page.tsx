"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, signInWithGoogle } from "../actions";
import BrandPanel from "../../BrandPanel";

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
    <div className="flex-1 min-h-screen">
      {/* Escena de fondo completa (boletas cayendo); la tarjeta flota encima */}
      <BrandPanel />

      <div className="relative z-10 min-h-screen flex items-center justify-center lg:justify-end px-4 py-12 lg:pr-[7vw]">
      <div className="w-full max-w-[500px] space-y-6 relative rounded-[22px] border border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] px-7 py-10 sm:px-12">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Iniciar sesión</h1>
          <p className="text-white/50 mt-2 text-sm">
            Tu escritorio de boletas del SII
          </p>
        </div>

        <div className="space-y-4">
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

          {/* divisor sin fondo sólido: la tarjeta es translúcida */}
          <div className="flex items-center gap-3 text-xs text-white/40">
            <div className="flex-1 border-t border-white/10" />
            <span>o</span>
            <div className="flex-1 border-t border-white/10" />
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
    </div>
  );
}

function safeNextPath(value: string | null): string | null {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
