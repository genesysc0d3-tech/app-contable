import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decidirSesionSegura,
  mockSiiHttpHabilitado,
  resultSoloRegistraSesionInsegura,
} from "./sesion-segura";

const AHORA = Date.parse("2026-09-28T12:00:00Z");
const HACE_DIAS = (d: number) => new Date(AHORA - d * 24 * 3600 * 1000).toISOString();
const base = {
  hayUsuario: true,
  ultimoAcceso: HACE_DIAS(1),
  ultimoLogin: HACE_DIAS(1),
  aalActual: "aal1",
  factoresServidor: [] as Array<{ status?: string | null }>,
  ahora: AHORA,
};

describe("decidirSesionSegura — la MISMA regla que el proxy", () => {
  it("sin usuario → NO_AUTH", () => {
    expect(decidirSesionSegura({ ...base, hayUsuario: false })).toEqual({ ok: false, motivo: "NO_AUTH" });
  });

  it("sesión aal1 de alguien con MFA enrolado → MFA_REQUERIDO (el hueco de las rutas excluidas)", () => {
    expect(decidirSesionSegura({ ...base, factoresServidor: [{ status: "verified" }] }))
      .toEqual({ ok: false, motivo: "MFA_REQUERIDO" });
  });

  it("aal ilegible con factor verificado → FAIL-CLOSED", () => {
    expect(decidirSesionSegura({ ...base, aalActual: null, factoresServidor: [{ status: "verified" }] }))
      .toEqual({ ok: false, motivo: "MFA_REQUERIDO" });
  });

  it("MFA completo (aal2) → pasa", () => {
    expect(decidirSesionSegura({ ...base, aalActual: "aal2", factoresServidor: [{ status: "verified" }] }))
      .toEqual({ ok: true });
  });

  it("sin MFA enrolado, aal1 → pasa (MFA es opt-in)", () => {
    expect(decidirSesionSegura({ ...base, factoresServidor: [{ status: "unverified" }] })).toEqual({ ok: true });
  });

  it("8 días sin aparecer → SESSION_EXPIRED, y gana a MFA (mismo orden que el proxy)", () => {
    expect(decidirSesionSegura({
      ...base, ultimoAcceso: HACE_DIAS(8), ultimoLogin: HACE_DIAS(8), factoresServidor: [{ status: "verified" }],
    })).toEqual({ ok: false, motivo: "SESSION_EXPIRED" });
  });

  it("login recién hecho rescata un ultimo_acceso viejo (incidente 2026-09-22)", () => {
    expect(decidirSesionSegura({ ...base, ultimoAcceso: HACE_DIAS(30), ultimoLogin: HACE_DIAS(0) })).toEqual({ ok: true });
  });

  it("sin dato de ultimo_acceso (sin service key) → fail-open en inactividad, igual que el proxy", () => {
    expect(decidirSesionSegura({ ...base, ultimoAcceso: undefined, ultimoLogin: null })).toEqual({ ok: true });
  });
});

describe("sii-mock/dte por HTTP: solo fuera de producción", () => {
  it("producción → cerrado", () => {
    expect(mockSiiHttpHabilitado({ NODE_ENV: "production" })).toBe(false);
  });
  it("dev/test → abierto", () => {
    expect(mockSiiHttpHabilitado({ NODE_ENV: "development" })).toBe(true);
    expect(mockSiiHttpHabilitado({ NODE_ENV: "test" })).toBe(true);
  });
  it("producción con el interruptor explícito → abierto", () => {
    expect(mockSiiHttpHabilitado({ NODE_ENV: "production", MASSDTE_ENABLE_SII_MOCK_HTTP: "1" })).toBe(true);
  });
});

describe("/api/sii-local/result con sesión insegura: nunca perder un folio", () => {
  it("captura del folio de la extensión → solo registra, no bloquea", () => {
    expect(resultSoloRegistraSesionInsegura({ result: { folio: 123, folio_confidence: "high" } })).toBe(true);
  });
  it("rescate del stash del servidor (recover_latest) → solo registra", () => {
    expect(resultSoloRegistraSesionInsegura({ recover_latest: true })).toBe(true);
  });
  it("declaraciones HUMANAS → se bloquean (aunque traigan result)", () => {
    expect(resultSoloRegistraSesionInsegura({ registrar_folio_manual: 55 })).toBe(false);
    expect(resultSoloRegistraSesionInsegura({ declarar_no_salio: true, result: {} })).toBe(false);
  });
  it("body sin resultado → se bloquea", () => {
    expect(resultSoloRegistraSesionInsegura({})).toBe(false);
    expect(resultSoloRegistraSesionInsegura({ result: null })).toBe(false);
  });
});

/**
 * QUE NO SE NOS OLVIDE: toda ruta FUERA del matcher del proxy debe llamar a un
 * guard que aplique inactividad + MFA. Se buscan LLAMADAS sin los imports (la
 * línea del import mantiene el nombre aunque nadie llame).
 */
const sinImports = (ruta: string) => readFileSync(ruta, "utf8").replace(/^\s*import[\s\S]*?;\s*$/gm, "");

function rutasBajo(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...rutasBajo(p));
    else if (nombre === "route.ts") out.push(p);
  }
  return out;
}

describe("las rutas excluidas del matcher exigen sesión segura", () => {
  const excluidas = [
    ...rutasBajo("src/app/api/sii-local"),
    ...rutasBajo("src/app/api/archivo"),
    ...rutasBajo("src/app/api/extension"),
    ...rutasBajo("src/app/api/sii-mock/dte"),
  ];

  it("hay rutas que revisar (si esto da 0, cambió la estructura y el test miente)", () => {
    expect(excluidas.length).toBeGreaterThanOrEqual(8);
  });

  it.each(excluidas)("%s llama requireSesionSegura o requireAccountApiAccess", (ruta) => {
    expect(sinImports(ruta)).toMatch(/\b(requireSesionSegura|requireAccountApiAccess)\(/);
  });

  it("ninguna excluida valida la sesión a mano con getUser (se saltaría el MFA)", () => {
    for (const ruta of excluidas) expect(sinImports(ruta)).not.toContain("auth.getUser(");
  });

  it("el guard de cuenta aplica la misma regla (MFA incluido) — de ahí la hereda vault-key", () => {
    expect(sinImports("src/lib/api/account-guard.ts")).toContain("verificarSesionSegura(");
    expect(sinImports("src/lib/api/sesion-segura.ts")).toContain("necesitaMfa(");
  });

  it("sii-mock/dte cierra en producción", () => {
    for (const ruta of rutasBajo("src/app/api/sii-mock/dte")) {
      expect(sinImports(ruta)).toContain("mockSiiHttpHabilitado(");
    }
  });
});
