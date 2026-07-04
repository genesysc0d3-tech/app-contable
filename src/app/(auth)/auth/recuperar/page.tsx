"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { solicitarRecuperacion } from "../actions";

export default function RecuperarPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <RecuperarContent />
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

function RecuperarContent() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [enviado, setEnviado] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    await solicitarRecuperacion(formData);
    // Respuesta neutra: mismo mensaje exista o no la cuenta (no revelar emails).
    setEnviado(true);
    setLoading(false);
  }

  const loginHref = next ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login";

  return (
    <div className="mesh-bg flex-1 flex items-center justify-center px-4 py-12 min-h-screen">
      <div className="w-full max-w-sm space-y-6 relative">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Recuperar contraseña</h1>
          <p className="text-white/50 mt-2 text-sm">
            Te enviamos un enlace para crear una nueva
          </p>
        </div>

        <div className="glass rounded-2xl p-6 space-y-4 glow-accent-soft">
          {enviado ? (
            <p className="text-sm text-white/70">
              Si el correo existe, te enviamos un enlace para crear una nueva
              contraseña. Revisa tu bandeja de entrada (y el spam).
            </p>
          ) : (
            <form action={handleSubmit} className="space-y-3">
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
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
              >
                {loading ? "Enviando..." : "Enviar enlace"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-white/40">
          <Link href={loginHref} className="text-[#e8553e] hover:text-[#e8553e]/80">
            Volver a iniciar sesión
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
