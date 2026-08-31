import { describe, expect, it } from "vitest";
import { getOperatorAal, type AalCheckClient } from "./operator-aal";

// El god-mode del operador puede migrar o purgar CUALQUIER empresa. Este test
// protege la propiedad central: SOLO abre con aal2, y ante cualquier duda
// (error del chequeo, niveles raros, null) queda CERRADO. Si alguien relaja
// el gate — p. ej. devolviendo ok cuando el chequeo falla, o aceptando aal1 —
// estos tests muerden.

function clientCon(aal: { currentLevel: string | null; nextLevel: string | null } | null): AalCheckClient {
  return { auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: aal }) } } };
}

function clientQueExplota(): AalCheckClient {
  return { auth: { mfa: { getAuthenticatorAssuranceLevel: async () => { throw new Error("network"); } } } };
}

describe("getOperatorAal — el gate MFA del god-mode", () => {
  it("abre SOLO con sesión aal2 verificada", async () => {
    const res = await getOperatorAal(clientCon({ currentLevel: "aal2", nextLevel: "aal2" }), {});
    expect(res).toEqual({ ok: true, enrolado: true });
  });

  it("factor enrolado pero sesión aal1: cerrado, pendiente el challenge", async () => {
    const res = await getOperatorAal(clientCon({ currentLevel: "aal1", nextLevel: "aal2" }), {});
    expect(res).toEqual({ ok: false, enrolado: true });
  });

  it("sin factor enrolado: cerrado, hay que enrolar", async () => {
    const res = await getOperatorAal(clientCon({ currentLevel: "aal1", nextLevel: "aal1" }), {});
    expect(res).toEqual({ ok: false, enrolado: false });
  });

  it("data null: cerrado (nunca abre por ausencia de señal)", async () => {
    const res = await getOperatorAal(clientCon(null), {});
    expect(res.ok).toBe(false);
  });

  it("FAIL-CLOSED: si el chequeo explota, cerrado — aunque el JWT traiga factor verificado", async () => {
    const res = await getOperatorAal(clientQueExplota(), { factors: [{ status: "verified" }] });
    expect(res.ok).toBe(false);
    // el factor del JWT solo elige el mensaje (challenge vs enrolar), jamás abre
    expect(res.enrolado).toBe(true);
  });

  it("si el chequeo explota y no hay factores, cerrado y manda a enrolar", async () => {
    const res = await getOperatorAal(clientQueExplota(), { factors: [] });
    expect(res).toEqual({ ok: false, enrolado: false });
  });
});
