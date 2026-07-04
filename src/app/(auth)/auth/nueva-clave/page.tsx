"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Destino del enlace de recuperación: el callback ya canjeó el code y dejó la
// sesión activa, así que basta updateUser({ password }) con el cliente browser.
export default function NuevaClavePage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    const confirmacion = String(formData.get("confirmacion") ?? "");
    if (password !== confirmacion) {
      setError("Las contraseñas no coinciden");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      const msg = updateError.message.toLowerCase();
      setError(
        msg.includes("different")
          ? "La nueva contraseña debe ser distinta a la anterior"
          : msg.includes("at least")
            ? "La contraseña debe tener al menos 6 caracteres"
            : "No se pudo guardar la contraseña. Pide un nuevo enlace de recuperación."
      );
      setLoading(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <div className="mesh-bg flex-1 flex items-center justify-center px-4 py-12 min-h-screen">
      <div className="w-full max-w-sm space-y-6 relative">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Nueva contraseña</h1>
          <p className="text-white/50 mt-2 text-sm">
            Elige una contraseña para tu cuenta
          </p>
        </div>

        <div className="glass rounded-2xl p-6 space-y-4 glow-accent-soft">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <form action={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="password" className="block text-sm text-white/70 mb-1">
                Nueva contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label htmlFor="confirmacion" className="block text-sm text-white/70 mb-1">
                Repite la contraseña
              </label>
              <input
                id="confirmacion"
                name="confirmacion"
                type="password"
                required
                minLength={6}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
            >
              {loading ? "Guardando..." : "Guardar contraseña"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-white/40">
          ¿El enlace expiró?{" "}
          <Link href="/auth/recuperar" className="text-[#e8553e] hover:text-[#e8553e]/80">
            Pedir uno nuevo
          </Link>
        </p>
      </div>
    </div>
  );
}
