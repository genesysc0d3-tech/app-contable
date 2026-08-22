"use client";

import { useEffect, useState } from "react";
import { crearEmpresa } from "./actions";
import { signOut } from "@/app/(auth)/auth/actions";
import { createClient } from "@/lib/supabase/client";

type VerifRut =
  | { estado: "idle" | "buscando" }
  | { estado: "encontrada"; razon: string; terminoGiro: string | null }
  | { estado: "no_encontrada" }
  | { estado: "dv_malo" };

export default function OnboardingPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rut, setRut] = useState("");
  const [razon, setRazon] = useState("");
  const [verif, setVerif] = useState<VerifRut>({ estado: "idle" });

  // Verificación en vivo contra la nómina pública de personas jurídicas del
  // SII: al encontrar el RUT, la razón social se autocompleta y el usuario
  // CONFIRMA viendo el nombre (el RUT queda inmutable tras la primera
  // emisión). RUTs bajo ~50M son personas naturales: no están en la nómina y
  // no se buscan (solo se valida el dígito).
  async function verificarRut() {
    const limpio = rut.replace(/[^0-9kK]/g, "");
    const cuerpo = Number(limpio.slice(0, -1));
    if (limpio.length < 7 || !Number.isFinite(cuerpo) || cuerpo < 50_000_000) {
      setVerif({ estado: "idle" });
      return;
    }
    setVerif({ estado: "buscando" });
    try {
      const res = await fetch(`/api/empresa/verificar-rut?rut=${encodeURIComponent(rut)}`);
      const data = await res.json();
      if (!data?.ok || data.dv_valido === false || data.dv_coincide === false) { setVerif({ estado: "dv_malo" }); return; }
      if (data.encontrado) {
        setVerif({ estado: "encontrada", razon: data.razon_social, terminoGiro: data.termino_giro ?? null });
        setRazon((prev) => prev || data.razon_social);
      } else setVerif({ estado: "no_encontrada" });
    } catch { setVerif({ estado: "idle" }); }
  }
  // Email de la sesión activa: quien entró con la cuenta equivocada (ej. otro
  // Google) necesita verlo y poder salir sin quedar atrapado en el onboarding.
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

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
            Datos básicos para emitir documentos tributarios
          </p>
          <p className="text-white/35 mt-3 text-xs leading-relaxed">
            Si trabajas a tu nombre (persona natural), usa tu RUT personal y tu
            nombre completo como razón social.
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
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                onBlur={verificarRut}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                placeholder="12.345.678-9"
              />
              {verif.estado === "buscando" && (
                <p className="mt-1.5 text-xs text-white/40">Buscando en el registro del SII…</p>
              )}
              {verif.estado === "encontrada" && (
                <p className="mt-1.5 text-xs text-emerald-400/90 leading-relaxed">
                  ✓ {verif.razon}
                  {verif.terminoGiro && (
                    <span className="block text-amber-400/90">⚠ Registra término de giro ({verif.terminoGiro}) ante el SII.</span>
                  )}
                </p>
              )}
              {verif.estado === "no_encontrada" && (
                <p className="mt-1.5 text-xs text-white/40 leading-relaxed">
                  No aparece en el registro público del SII. Si tu empresa es nueva es normal — revisa que el RUT esté bien y continúa.
                </p>
              )}
              {verif.estado === "dv_malo" && (
                <p className="mt-1.5 text-xs text-red-300">Ese RUT no cuadra — revisa los números y el dígito verificador.</p>
              )}
            </div>
            <div>
              <label
                htmlFor="razon_social"
                className="block text-sm text-white/70 mb-1"
              >
                Razón social
              </label>
              <input
                id="razon_social"
                name="razon_social"
                type="text"
                required
                value={razon}
                onChange={(e) => setRazon(e.target.value)}
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
                placeholder="Actividad económica principal"
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

        {email && (
          <p className="text-center text-sm text-white/40">
            Conectado como <span className="text-white/60">{email}</span>
            {" · "}
            <button
              type="button"
              onClick={() => signOut()}
              className="text-[#e8553e] hover:text-[#e8553e]/80 transition-colors"
            >
              Cerrar sesión
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
