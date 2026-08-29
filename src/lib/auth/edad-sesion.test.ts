import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EDAD_MAXIMA_SESION_MS,
  diasRestantesDeSesion,
  inicioDeSesion,
  sesionVencidaPorEdad,
} from "./edad-sesion";

/** Arma un access token de mentira con el `amr` que se le pida. */
function token(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma-de-mentira`;
}
const HACE = (dias: number) => Math.floor((Date.now() - dias * 24 * 60 * 60 * 1000) / 1000);

describe("edad de la sesión", () => {
  it("lee el sello del login desde amr", () => {
    const t = token({ amr: [{ method: "password", timestamp: HACE(3) }] });
    const inicio = inicioDeSesion(t)!;
    expect(Math.round((Date.now() - inicio) / (24 * 60 * 60 * 1000))).toBe(3);
  });

  it("una sesión de ayer NO está vencida", () => {
    expect(sesionVencidaPorEdad(token({ amr: [{ method: "oauth", timestamp: HACE(1) }] }))).toBe(false);
  });

  it("una sesión de 45 días SÍ está vencida", () => {
    expect(sesionVencidaPorEdad(token({ amr: [{ method: "password", timestamp: HACE(45) }] }))).toBe(true);
  });

  it("manda el amr MÁS ANTIGUO: sumar un segundo factor no rejuvenece la sesión", () => {
    const t = token({
      amr: [
        { method: "password", timestamp: HACE(40) },
        { method: "totp", timestamp: HACE(1) },
      ],
    });
    expect(sesionVencidaPorEdad(t)).toBe(true);
  });

  it("`iat` NO sirve para esto: se renueva cada hora y mentiría eternamente", () => {
    // Token sin amr pero con iat reciente: la edad NO se puede determinar.
    expect(inicioDeSesion(token({ iat: Math.floor(Date.now() / 1000) }))).toBeNull();
  });

  it("si no se puede leer la edad, no se cierra a nadie (esto es la 2ª muralla, no la auth)", () => {
    expect(sesionVencidaPorEdad(null)).toBe(false);
    expect(sesionVencidaPorEdad("no-es-un-jwt")).toBe(false);
    expect(sesionVencidaPorEdad(token({}))).toBe(false);
  });

  it("avisa cuántos días quedan", () => {
    expect(diasRestantesDeSesion(token({ amr: [{ method: "password", timestamp: HACE(28) }] }))).toBe(2);
    expect(diasRestantesDeSesion(token({ amr: [{ method: "password", timestamp: HACE(90) }] }))).toBe(0);
  });

  it("el tope es de 30 días", () => {
    expect(EDAD_MAXIMA_SESION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

/**
 * QUE NO SE NOS OLVIDE.
 *
 * La debilidad de tener esta regla en nuestro código —y no en el interruptor de
 * Supabase, que es insaltable— es que alguien la desconecte sin darse cuenta.
 * Estos dos tests son el recordatorio: si el guard compartido o el middleware
 * dejan de llamarla, la suite se cae y dice exactamente qué se rompió.
 */
// Mirar si el NOMBRE aparece en el archivo no basta: la línea del `import` lo
// mantiene aunque nadie lo llame. (Comprobado: con la regla desconectada a
// mano, la primera versión de estos tests seguía pasando.) Así que se borran
// los imports y recién ahí se busca la LLAMADA.
const sinImports = (ruta: string) =>
  readFileSync(ruta, "utf8").replace(/^\s*import[\s\S]*?;\s*$/gm, "");

describe("la regla sigue enchufada donde corresponde", () => {
  it("el guard de las rutas la LLAMA (de ahí la hereda /api/extension/vault-key)", () => {
    expect(sinImports("src/lib/api/account-guard.ts")).toContain("sesionVencidaPorEdad(");
  });

  it("el middleware la LLAMA y cierra la sesión (signOut revoca también para la extensión)", () => {
    const proxy = sinImports("src/lib/supabase/proxy.ts");
    expect(proxy).toContain("sesionVencidaPorEdad(");
    expect(proxy).toContain("signOut(");
  });

  it("la ruta de la bóveda sigue pasando por el guard y no por su propia puerta", () => {
    const ruta = readFileSync("src/app/api/extension/vault-key/route.ts", "utf8");
    expect(ruta).toContain("requireAccountApiAccess");
  });
});
