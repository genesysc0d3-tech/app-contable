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
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Verificación en dos pasos</h1>
      <p className="text-sm text-neutral-500">
        Ingresa el código de 6 dígitos de tu app de autenticación.
      </p>

      {loading ? (
        <p className="text-sm text-neutral-500">Cargando…</p>
      ) : (
        <form onSubmit={onVerify} className="flex flex-col gap-3">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="rounded border border-neutral-300 px-3 py-2 text-center text-lg tracking-widest"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={verifying || code.length < 6 || !challengeId}
            className="rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
          >
            {verifying ? "Verificando…" : "Verificar"}
          </button>
        </form>
      )}

      <button onClick={onLogout} className="text-sm text-neutral-500 underline">
        Cerrar sesión
      </button>
    </div>
  );
}
