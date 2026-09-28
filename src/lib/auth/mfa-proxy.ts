// ¿El proxy debe mandar a /auth/mfa? (2026-09-28, plan-costo-vercel §6 PR 3)
//
// Antes: `getAuthenticatorAssuranceLevel()` sin token calcula `nextLevel` con
// `session.user.factors` LEÍDO DE LA COOKIE (auth-js 2.101.1, _getAuthenticatorAssuranceLevel).
// `getUser()` NO reescribe ese usuario guardado, así que una cookie editada a mano
// sin factores dejaba pasar una sesión aal1 (solo contraseña) de alguien con MFA.
// Ahora: el nivel actual sale del JWT (firmado; getUser ya validó ese token contra
// Auth) y los factores del USUARIO QUE DEVOLVIÓ EL SERVIDOR (getUser), no de la cookie.

type Factor = { status?: string | null };

export function necesitaMfa(args: {
  /** aal del access token (claim `aal`), o null si no se pudo leer. */
  aalActual: string | null | undefined;
  /** user.factors tal como los devolvió GET /user (fuente de verdad). */
  factoresServidor: Factor[] | null | undefined;
}): boolean {
  const tieneFactorVerificado = (args.factoresServidor ?? []).some((f) => f.status === "verified");
  if (!tieneFactorVerificado) return false; // no enroló MFA: nada que completar
  // FAIL-CLOSED: con factor verificado, solo aal2 pasa (aal ilegible = no pasa).
  return args.aalActual !== "aal2";
}

/** Lee el claim `aal` de un JWT sin verificar la firma (el token ya lo validó getUser). */
export function aalDelToken(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const partes = accessToken.split(".");
  if (partes.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8")) as { aal?: unknown };
    return typeof json.aal === "string" ? json.aal : null;
  } catch {
    return null;
  }
}
