"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signUp, signInWithGoogle } from "../actions";
import BrandPanel from "../../BrandPanel";
import { POLICY_VERSION } from "@/lib/legal/version";

export default function RegistroPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <RegistroContent />
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
    <div className="flex-1 min-h-svh">
      {/* Escena de fondo completa (boletas cayendo); la tarjeta flota encima */}
      <BrandPanel />

      <div className="relative z-10 min-h-svh flex items-center justify-center lg:justify-end px-4 py-4 lg:pr-[7vw]">
      <div className="w-full max-w-[500px] space-y-[clamp(12px,2.4svh,24px)] relative rounded-[22px] border border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] px-7 py-[clamp(18px,4.2svh,40px)] sm:px-12">
        <div className="text-center">
          <h1 className="text-[clamp(22px,3.2svh,30px)] font-bold">Crear cuenta</h1>
          <p className="text-white/50 mt-2 text-sm">
            Tu escritorio de boletas del SII
          </p>
        </div>

        <div className="space-y-[clamp(10px,1.8svh,16px)]">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-[clamp(8px,1.6svh,12px)] text-sm text-red-300">
              {error}
            </div>
          )}

          <form action={handleSubmit} className="space-y-[clamp(8px,1.4svh,12px)]">
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
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-[clamp(8px,1.6svh,12px)] text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
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
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-[clamp(8px,1.6svh,12px)] text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
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
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-[clamp(8px,1.6svh,12px)] text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="Mínimo 6 caracteres"
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
                <Link href="/legal/privacidad" target="_blank" className="text-[#e8553e] hover:text-[#e8553e]/80 underline">Política de Privacidad</Link>
                {" "}y los{" "}
                <Link href="/legal/terminos" target="_blank" className="text-[#e8553e] hover:text-[#e8553e]/80 underline">Términos</Link>.
              </span>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-[clamp(8px,1.6svh,12px)] text-sm font-semibold text-white transition-colors"
            >
              {loading ? "Creando cuenta..." : "Crear cuenta"}
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
            disabled={loading || !consent}
            title={!consent ? "Primero acepta la Política de Privacidad y los Términos" : undefined}
            className="w-full rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 border border-white/10 px-4 py-[clamp(8px,1.6svh,12px)] text-sm font-medium text-white/90 transition-colors"
          >
            Continuar con Google
          </button>
        </div>

        <p className="text-center text-sm text-white/40">
          ¿Ya tienes cuenta?{" "}
          <Link
            href={next ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login"}
            className="text-[#e8553e] hover:text-[#e8553e]/80"
          >
            Iniciar sesión
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
