import { describe, expect, it } from "vitest";
import { aalDelToken, necesitaMfa } from "./mfa-proxy";

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

describe("necesitaMfa — factores del SERVIDOR, no de la cookie", () => {
  it("sin factor verificado → no pide MFA", () => {
    expect(necesitaMfa({ aalActual: "aal1", factoresServidor: [] })).toBe(false);
    expect(necesitaMfa({ aalActual: "aal1", factoresServidor: [{ status: "unverified" }] })).toBe(false);
  });
  it("factor verificado + aal1 → pide MFA (aunque la cookie diga que no hay factores)", () => {
    expect(necesitaMfa({ aalActual: "aal1", factoresServidor: [{ status: "verified" }] })).toBe(true);
  });
  it("factor verificado + aal2 → pasa", () => {
    expect(necesitaMfa({ aalActual: "aal2", factoresServidor: [{ status: "verified" }] })).toBe(false);
  });
  it("factor verificado + aal ilegible → FAIL-CLOSED", () => {
    expect(necesitaMfa({ aalActual: null, factoresServidor: [{ status: "verified" }] })).toBe(true);
  });
});

describe("aalDelToken", () => {
  it("lee el claim aal", () => {
    expect(aalDelToken(jwt({ aal: "aal2", sub: "u" }))).toBe("aal2");
  });
  it("token raro → null", () => {
    expect(aalDelToken("no-es-jwt")).toBeNull();
    expect(aalDelToken(null)).toBeNull();
    expect(aalDelToken("a.@@@.c")).toBeNull();
  });
});
