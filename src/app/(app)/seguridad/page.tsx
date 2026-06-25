"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string | null; status: string };
type Enrolling = { factorId: string; qr: string; secret: string };

// Seguridad de la cuenta: enrolar / quitar MFA (TOTP) con Supabase Auth nativo.
// Es opt-in: hasta verificar un factor, el login no cambia.
export default function SeguridadPage() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFactors = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.all ?? []) as Factor[]);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      if (active) setFactors((data?.all ?? []) as Factor[]);
    })();
    return () => {
      active = false;
    };
  }, []);

  const startEnroll = useCallback(async () => {
    setError(null);
    setMsg(null);
    setBusy(true);
    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `TOTP ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? "No se pudo iniciar el enrolamiento.");
      return;
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }, []);

  const confirmEnroll = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!enrolling || busy) return;
      setBusy(true);
      setError(null);
      const supabase = createClient();
      const ch = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (ch.error || !ch.data) {
        setError("No se pudo verificar el factor.");
        setBusy(false);
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: ch.data.id,
        code,
      });
      setBusy(false);
      if (verifyError) {
        setError("Código incorrecto. Intenta de nuevo.");
        return;
      }
      setEnrolling(null);
      setCode("");
      setMsg("Autenticación en dos pasos activada ✅");
      loadFactors();
    },
    [enrolling, code, busy, loadFactors],
  );

  const cancelEnroll = useCallback(async () => {
    if (enrolling) {
      const supabase = createClient();
      await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {});
    }
    setEnrolling(null);
    setCode("");
  }, [enrolling]);

  const removeFactor = useCallback(
    async (id: string) => {
      const supabase = createClient();
      await supabase.auth.mfa.unenroll({ factorId: id }).catch(() => {});
      loadFactors();
    },
    [loadFactors],
  );

  return (
    <div className="mx-auto max-w-xl flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Seguridad</h1>
        <p className="text-sm text-neutral-500">Autenticación en dos pasos (MFA).</p>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Apps de autenticación</h2>
        {factors.filter((f) => f.status === "verified").length === 0 ? (
          <p className="text-sm text-neutral-500">No tienes MFA configurado.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {factors
              .filter((f) => f.status === "verified")
              .map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded border border-neutral-200 px-3 py-2">
                  <span className="text-sm">{f.friendly_name || "TOTP"}</span>
                  <button onClick={() => removeFactor(f.id)} className="text-sm text-red-600 underline">
                    Quitar
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      {!enrolling ? (
        <button onClick={startEnroll} disabled={busy} className="self-start rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50">
          Activar autenticación en dos pasos
        </button>
      ) : (
        <section className="flex flex-col gap-3 rounded border border-neutral-200 p-4">
          <p className="text-sm">1. Escanea el código con tu app (Google Authenticator, Authy, etc.):</p>
          <div className="w-44" dangerouslySetInnerHTML={{ __html: enrolling.qr }} />
          <p className="text-xs text-neutral-500 break-all">
            ¿No puedes escanear? Clave: <code>{enrolling.secret}</code>
          </p>
          <form onSubmit={confirmEnroll} className="flex flex-col gap-2">
            <p className="text-sm">2. Ingresa el código de 6 dígitos para confirmar:</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="rounded border border-neutral-300 px-3 py-2 text-center text-lg tracking-widest"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy || code.length < 6} className="rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50">
                Confirmar
              </button>
              <button type="button" onClick={cancelEnroll} className="rounded border border-neutral-300 px-3 py-2">
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
