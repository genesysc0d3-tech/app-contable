"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Paso de verificación MFA (AAL2). Solo llega aquí quien tiene un factor TOTP
// verificado y está en aal1 (el proxy lo trae). Quien no tiene MFA nunca pasa.
export default function MfaChallengePage() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      const totp = data?.totp?.[0];
      if (listError || !totp) {
        setError("No tienes una app de autenticación configurada.");
        setLoading(false);
        return;
      }
      setFactorId(totp.id);
      const ch = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (!active) return;
      if (ch.error || !ch.data) {
        setError("No se pudo iniciar la verificación. Recarga la página.");
        setLoading(false);
        return;
      }
      setChallengeId(ch.data.id);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const onVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!factorId || !challengeId || verifying) return;
      setVerifying(true);
      setError(null);
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (verifyError) {
        setError("Código incorrecto. Intenta de nuevo.");
        const ch = await supabase.auth.mfa.challenge({ factorId });
        if (ch.data) setChallengeId(ch.data.id);
        setCode("");
        setVerifying(false);
        return;
      }
      window.location.assign("/");
    },
    [factorId, challengeId, code, verifying],
  );

  const onLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/auth/login");
  }, []);

  return (
    <div className="mesh-bg flex-1 flex items-center justify-center px-4 py-12 min-h-screen">
      <div className="w-full max-w-sm space-y-6 relative">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Verificación en dos pasos</h1>
          <p className="text-white/50 mt-2 text-sm">
            Ingresa el código de 6 dígitos de tu app de autenticación.
          </p>
        </div>

        <div className="glass rounded-2xl p-6 space-y-4 glow-accent-soft">
          {loading ? (
            <p className="text-sm text-white/50 text-center">Cargando…</p>
          ) : (
            <form onSubmit={onVerify} className="space-y-3">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-center text-lg tracking-widest text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8553e]/60 transition-colors"
                autoFocus
              />
              {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={verifying || code.length < 6 || !challengeId}
                className="w-full rounded-xl bg-[#e8553e] hover:bg-[#e8553e]/90 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
              >
                {verifying ? "Verificando…" : "Verificar"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-white/40">
          <button onClick={onLogout} className="hover:text-white/70 underline transition-colors">
            Cerrar sesión
          </button>
        </p>
      </div>
    </div>
  );
}
