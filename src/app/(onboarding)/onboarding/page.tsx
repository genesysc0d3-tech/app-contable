"use client";

import { useState } from "react";
import { crearEmpresa } from "./actions";

export default function OnboardingPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await crearEmpresa(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Tu empresa</h1>
          <p className="text-white/50 mt-2 text-sm">
            Datos basicos para emitir documentos tributarios
          </p>
        </div>

        <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300 mb-4">
              {error}
            </div>
          )}

          <form action={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="rut" className="block text-sm text-white/70 mb-1">
                RUT de la empresa
              </label>
              <input
                id="rut"
                name="rut"
                type="text"
                required
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="12.345.678-9"
              />
            </div>
            <div>
              <label
                htmlFor="razon_social"
                className="block text-sm text-white/70 mb-1"
              >
                Razon social
              </label>
              <input
                id="razon_social"
                name="razon_social"
                type="text"
                required
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="Nombre legal de tu empresa"
              />
            </div>
            <div>
              <label htmlFor="giro" className="block text-sm text-white/70 mb-1">
                Giro
              </label>
              <input
                id="giro"
                name="giro"
                type="text"
                required
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="Actividad economica principal"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors mt-2"
            >
              {loading ? "Guardando..." : "Continuar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
