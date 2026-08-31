// Chequeo de nivel de aseguramiento (AAL) para el god-mode del operador.
// Separado de support-mode.ts (que es server-only) para poder testearlo:
// esta decisión es la que convierte una password robada en "no basta".
//
// Contrato:
//  - ok=true SOLO con sesión aal2 verificada.
//  - Si el chequeo falla (throw), CERRADO — "enrolado" se estima por los
//    factores del JWT únicamente para elegir el mensaje, nunca para abrir.

export type AalCheckClient = {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: () => Promise<{
        data: { currentLevel: string | null; nextLevel: string | null } | null;
      }>;
    };
  };
};

export type AalUserLike = { factors?: Array<{ status?: string | null }> | null };

export async function getOperatorAal(
  supabase: AalCheckClient,
  user: AalUserLike,
): Promise<{ ok: boolean; enrolado: boolean }> {
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const ok = aal?.currentLevel === "aal2";
    return { ok, enrolado: ok || aal?.nextLevel === "aal2" };
  } catch {
    const enrolado = (user.factors ?? []).some((f) => f.status === "verified");
    return { ok: false, enrolado };
  }
}
