import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  generarCodigoAutorizacion,
  redirectEnAllowlistConector,
  urisNormalizadas,
  generarRefreshToken,
  hashOauthSecreto,
  metadataAuthorizationServer,
  redirectCoincide,
  redirectUriValida,
  validarRegistroCliente,
  verificarPkce,
} from "./oauth";

// Protege las decisiones de seguridad del OAuth del conector. Si alguien
// relaja PKCE (acepta "plain"), afloja el calce de redirect (prefijos → open
// redirect con el código adentro) o deja registrar URIs http, muerde.

function pkcePar() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

describe("verificarPkce — S256 obligatorio", () => {
  it("el par correcto pasa", () => {
    const { verifier, challenge } = pkcePar();
    expect(verificarPkce(verifier, challenge)).toBe(true);
  });

  it("un verifier ajeno NO pasa (el código robado no sirve sin el verifier)", () => {
    const { challenge } = pkcePar();
    const { verifier: otro } = pkcePar();
    expect(verificarPkce(otro, challenge)).toBe(false);
  });

  it("método 'plain' NO se acepta (challenge == verifier)", () => {
    const verifier = randomBytes(48).toString("base64url");
    expect(verificarPkce(verifier, verifier)).toBe(false);
  });

  it("verifier corto o con caracteres ilegales, fuera", () => {
    const { challenge } = pkcePar();
    expect(verificarPkce("corto", challenge)).toBe(false);
    expect(verificarPkce("x".repeat(43) + "\n", challenge)).toBe(false);
  });
});

describe("redirect_uri — calce EXACTO o nada", () => {
  it("https válida y registrada, pasa", () => {
    expect(redirectUriValida("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectCoincide("https://claude.ai/cb", ["https://claude.ai/cb"])).toBe(true);
  });

  it("prefijos y variantes NO calzan (open redirect con el código adentro)", () => {
    const registradas = ["https://claude.ai/cb"];
    expect(redirectCoincide("https://claude.ai/cb/../evil", registradas)).toBe(false);
    expect(redirectCoincide("https://claude.ai/cb?x=1", registradas)).toBe(false);
    expect(redirectCoincide("https://evil.com/https://claude.ai/cb", registradas)).toBe(false);
  });

  it("http solo en loopback (clientes nativos)", () => {
    expect(redirectUriValida("http://127.0.0.1:33418/cb")).toBe(true);
    expect(redirectUriValida("http://localhost:8080/cb")).toBe(true);
    expect(redirectUriValida("http://massdte.cl/cb")).toBe(false);
    expect(redirectUriValida("javascript:alert(1)")).toBe(false);
    expect(redirectUriValida("no-es-url")).toBe(false);
  });
});

describe("registro dinámico — metadata estricta", () => {
  it("registro sano pasa con nombre recortado", () => {
    const r = validarRegistroCliente({ client_name: "  Claude  ", redirect_uris: ["https://claude.ai/cb"] });
    expect(r).toEqual({ client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] });
  });

  it("sin redirect_uris válidas, fuera", () => {
    expect("error" in validarRegistroCliente({ redirect_uris: [] })).toBe(true);
    expect("error" in validarRegistroCliente({ redirect_uris: ["http://evil.com/cb"] })).toBe(true);
    expect("error" in validarRegistroCliente(null)).toBe(true);
  });

  it("máximo 10 URIs (nada de registrar un diccionario)", () => {
    const muchas = Array.from({ length: 11 }, (_, i) => `https://a.com/cb${i}`);
    expect("error" in validarRegistroCliente({ redirect_uris: muchas })).toBe(true);
  });
});

describe("allowlist de callbacks — la consola curada (decisión del fundador)", () => {
  it("claude.ai y OpenAI pasan", () => {
    expect(redirectEnAllowlistConector("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectEnAllowlistConector("https://claude.com/callback")).toBe(true);
    expect(redirectEnAllowlistConector("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
  });

  it("dominios desconocidos NO pasan — aunque sean https válidos", () => {
    expect(redirectEnAllowlistConector("https://evil.com/cb")).toBe(false);
    expect(redirectEnAllowlistConector("https://claude.ai.evil.com/cb")).toBe(false);
    expect(redirectEnAllowlistConector("https://cursor.sh/cb")).toBe(false); // hasta que se agregue a la lista
  });

  it("loopback NO pasa en el registro de prod (dev local usa tokens manuales)", () => {
    expect(redirectEnAllowlistConector("http://127.0.0.1:33418/cb")).toBe(false);
    expect(redirectEnAllowlistConector("http://localhost:8080/cb")).toBe(false);
  });
});

describe("urisNormalizadas — la firma del registro idempotente", () => {
  it("el orden no importa: mismas URIs ⇒ misma firma", () => {
    expect(urisNormalizadas(["https://a.com/1", "https://b.com/2"]))
      .toBe(urisNormalizadas(["https://b.com/2", "https://a.com/1"]));
  });

  it("URIs distintas ⇒ firmas distintas", () => {
    expect(urisNormalizadas(["https://a.com/1"])).not.toBe(urisNormalizadas(["https://a.com/2"]));
  });
});

describe("secretos y metadata", () => {
  it("código y refresh llevan prefijos reconocibles y solo se guardan hasheados", () => {
    const code = generarCodigoAutorizacion();
    const refresh = generarRefreshToken();
    expect(code.startsWith("mdtc_")).toBe(true);
    expect(refresh.startsWith("mdtr_")).toBe(true);
    expect(hashOauthSecreto(code)).not.toContain("mdtc_");
    expect(hashOauthSecreto(code)).toBe(hashOauthSecreto(code));
  });

  it("la metadata declara S256 y SOLO code (nada de implicit)", () => {
    const m = metadataAuthorizationServer("https://app.massdte.cl");
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.response_types_supported).toEqual(["code"]);
    expect(m.grant_types_supported).toContain("refresh_token");
  });
});
