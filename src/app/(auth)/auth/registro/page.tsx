"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signUp, signInWithGoogle } from "../actions";
import { POLICY_VERSION } from "@/lib/legal/version";

export default function RegistroPage() {
  return (
    <Suspense fallback={null}>
      <RegistroContent />
    </Suspense>
  );
}

function RegistroContent() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);

  // El landing manda ?plan= acá; el flujo de auth (callback → onboarding) no
  // preserva query params, así que lo guardamos en cookie. crearEmpresa la lee al
  // terminar el onboarding y manda a /planes con ese plan resaltado.
  const planParam = searchParams.get("plan");
  useEffect(() => {
    const safe = (planParam ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    if (safe) document.cookie = `massdte_plan=${safe}; path=/; max-age=3600; samesite=lax`;
  }, [planParam]);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await signUp(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    // OAuth no pasa por signUp: dejamos la prueba de consentimiento en cookie para que el
    // callback la registre (el botón ya exige el checkbox marcado).
    document.cookie = `massdte_consent=${POLICY_VERSION}; path=/; max-age=600; samesite=lax`;
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
          <h1 className="text-3xl font-bold">Crear cuenta</h1>
          <p className="text-white/50 mt-2 text-sm">
            Empieza a automatizar tu contabilidad
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
              <label htmlFor="nombre" className="block text-sm text-white/70 mb-1">
                Nombre
              </label>
              <input
                id="nombre"
                name="nombre"
                type="text"
                required
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="Tu nombre"
              />
            </div>
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
                Contrasena
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="Minimo 6 caracteres"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-white/50 cursor-pointer select-none">
              <input
                type="checkbox"
                name="consentimiento"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#e8553e]"
              />
              <span>
                Acepto la{" "}
                <Link href="/legal/privacidad" target="_blank" className="text-[#e8553e] hover:text-[#e8553e]/80 underline">Politica de Privacidad</Link>
                {" "}y los{" "}
                <Link href="/legal/terminos" target="_blank" className="text-[#e8553e] hover:text-[#e8553e]/80 underline">Terminos</Link>.
              </span>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
            >
              {loading ? "Creando cuenta..." : "Crear cuenta"}
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
            disabled={loading || !consent}
            title={!consent ? "Primero acepta la Politica de Privacidad y los Terminos" : undefined}
            className="w-full rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 border border-white/10 px-4 py-3 text-sm font-medium text-white/90 transition-colors"
          >
            Continuar con Google
          </button>

          <p className="text-xs text-white/30 text-center">
            Tu cuenta quedara sujeta a aprobacion
          </p>
        </div>

        <p className="text-center text-sm text-white/40">
          Ya tienes cuenta?{" "}
          <Link
            href={next ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login"}
            className="text-[#e8553e] hover:text-[#e8553e]/80"
          >
            Iniciar sesion
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
