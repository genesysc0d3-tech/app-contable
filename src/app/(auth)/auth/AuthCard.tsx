"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, signUp, signInWithGoogle } from "./actions";
import { POLICY_VERSION } from "@/lib/legal/version";

type Modo = "login" | "registro";

/**
 * Tarjeta única de login/registro. Alternar entre ambos NO navega (la página
 * no recarga y la escena de fondo sigue corriendo): cambia el contenido con
 * un fade y la tarjeta ANIMA su cambio de forma (alto medido con
 * ResizeObserver + transition). La URL se mantiene honesta con
 * history.replaceState para deep-links y refresh.
 */
export default function AuthCard({ inicial }: { inicial: Modo }) {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [modo, setModo] = useState<Modo>(inicial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);

  // El landing manda ?plan= al registro; el flujo de auth (callback → onboarding)
  // no preserva query params, así que va a cookie (crearEmpresa la lee al final).
  const planParam = searchParams.get("plan");
  useEffect(() => {
    const safe = (planParam ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    if (safe) document.cookie = `massdte_plan=${safe}; path=/; max-age=3600; samesite=lax`;
  }, [planParam]);

  // Morph del alto: se mide el contenido y el contenedor lo transiciona.
  const medidorRef = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState<number | null>(null);
  useEffect(() => {
    const el = medidorRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAlto(el.offsetHeight));
    ro.observe(el);
    setAlto(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    setError(null);
    setLoading(false);
    const qs = searchParams.toString();
    window.history.replaceState(null, "", `/auth/${nuevo}${qs ? `?${qs}` : ""}`);
  }

  async function handleLogin(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await signIn(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleRegistro(formData: FormData) {
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
    if (modo === "registro") {
      // OAuth no pasa por signUp: la prueba de consentimiento va en cookie para
      // que el callback la registre (el botón ya exige el checkbox marcado).
      document.cookie = `massdte_consent=${POLICY_VERSION}; path=/; max-age=600; samesite=lax`;
    }
    const result = await signInWithGoogle(next);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl bg-white/5 border border-white/10 px-4 py-[clamp(8px,1.6svh,12px)] text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors";

  return (
    <div className="w-full max-w-[500px] relative rounded-[22px] border border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] px-7 sm:px-12">
      <div
        style={{ height: alto ?? "auto" }}
        className="overflow-hidden transition-[height] duration-300 ease-out"
      >
        <div ref={medidorRef}>
          <div key={modo} className="animate-auth-swap space-y-[clamp(12px,2.4svh,24px)] py-[clamp(18px,4.2svh,40px)]">
            <div className="text-center">
              <h1 className="text-[clamp(22px,3.2svh,30px)] font-bold">
                {modo === "login" ? "Iniciar sesión" : "Crear cuenta"}
              </h1>
              <p className="text-white/50 mt-2 text-sm">Tu escritorio de boletas del SII</p>
            </div>

            <div className="space-y-[clamp(10px,1.8svh,16px)]">
              {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {modo === "login" ? (
                <form action={handleLogin} className="space-y-[clamp(8px,1.4svh,12px)]">
                  {next && <input type="hidden" name="next" value={next} />}
                  <div>
                    <label htmlFor="email" className="block text-sm text-white/70 mb-1">Email</label>
                    <input id="email" name="email" type="email" required className={inputCls} placeholder="tu@email.com" />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-sm text-white/70 mb-1">Contraseña</label>
                    <input id="password" name="password" type="password" required minLength={6} className={inputCls} placeholder="••••••••" />
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
                    className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-[clamp(8px,1.6svh,12px)] text-sm font-semibold text-white transition-colors"
                  >
                    {loading ? "Entrando..." : "Entrar"}
                  </button>
                </form>
              ) : (
                <form action={handleRegistro} className="space-y-[clamp(8px,1.4svh,12px)]">
                  {next && <input type="hidden" name="next" value={next} />}
                  <div>
                    <label htmlFor="nombre" className="block text-sm text-white/70 mb-1">Nombre</label>
                    <input id="nombre" name="nombre" type="text" required className={inputCls} placeholder="Tu nombre" />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm text-white/70 mb-1">Email</label>
                    <input id="email" name="email" type="email" required className={inputCls} placeholder="tu@email.com" />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-sm text-white/70 mb-1">Contraseña</label>
                    <input id="password" name="password" type="password" required minLength={6} className={inputCls} placeholder="Mínimo 6 caracteres" />
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
              )}

              {/* divisor sin fondo sólido: la tarjeta es translúcida */}
              <div className="flex items-center gap-3 text-xs text-white/40">
                <div className="flex-1 border-t border-white/10" />
                <span>o</span>
                <div className="flex-1 border-t border-white/10" />
              </div>

              <button
                onClick={handleGoogle}
                disabled={loading || (modo === "registro" && !consent)}
                title={modo === "registro" && !consent ? "Primero acepta la Política de Privacidad y los Términos" : undefined}
                className="w-full rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 border border-white/10 px-4 py-[clamp(8px,1.6svh,12px)] text-sm font-medium text-white/90 transition-colors"
              >
                Continuar con Google
              </button>
            </div>

            <p className="text-center text-sm text-white/40">
              {modo === "login" ? (
                <>
                  ¿No tienes cuenta?{" "}
                  <button type="button" onClick={() => cambiarModo("registro")} className="text-[#e8553e] hover:text-[#e8553e]/80 font-medium">
                    Crear cuenta
                  </button>
                </>
              ) : (
                <>
                  ¿Ya tienes cuenta?{" "}
                  <button type="button" onClick={() => cambiarModo("login")} className="text-[#e8553e] hover:text-[#e8553e]/80 font-medium">
                    Iniciar sesión
                  </button>
                </>
              )}
            </p>
          </div>
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
