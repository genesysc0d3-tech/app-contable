import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { decidirSesionSegura, mockSiiHttpHabilitado } from "./sesion-segura";

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

/**
 * QUE NO SE NOS OLVIDE: toda ruta FUERA del matcher del proxy pierde el MFA y la
 * inactividad del proxy. La lista de exclusiones se lee de src/proxy.ts (no a mano):
 * una exclusión nueva entra sola a este test. Se buscan LLAMADAS sin los imports (la
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

/** Alternativas `api/...` del lookahead negativo del matcher de src/proxy.ts. */
function exclusionesApiDelMatcher(): RegExp[] {
  const fuente = readFileSync("src/proxy.ts", "utf8");
  const m = fuente.match(/"\/\(\(\?!([^"]*)\)\.\*\)"/);
  if (!m) throw new Error("No se encontró el matcher en src/proxy.ts");
  // El string TS trae los backslashes escapados (\\.) → a regex real.
  const cuerpo = m[1].replace(/\\\\/g, "\\");
  // Separar por "|" de primer nivel (no dentro de paréntesis).
  const alts: string[] = [];
  let nivel = 0, actual = "";
  for (const c of cuerpo) {
    if (c === "(") nivel++;
    if (c === ")") nivel--;
    if (c === "|" && nivel === 0) { alts.push(actual); actual = ""; } else actual += c;
  }
  alts.push(actual);
  return alts.filter((a) => a.startsWith("api/")).map((a) => new RegExp(`^(?:${a})`));
}

/** src/app/api/foo/[id]/route.ts → "api/foo/[id]" (la ruta URL, como la ve el matcher). */
const rutaUrl = (archivo: string) => relative("src/app", archivo).split(sep).slice(0, -1).join("/");

/**
 * Rutas MÁQUINA excluidas a propósito: NO usan la cookie de sesión del usuario y
 * tienen su propia autenticación. Si una ruta de acá empieza a usar la sesión, el
 * test de abajo la obliga a pasar por el guard.
 */
const MAQUINA: Record<string, string> = {
  "api/sw-config": "pieza pública del Service Worker, sin datos",
  "api/telegram/webhook": "header secreto de Telegram",
  "api/pagos/webhook": "firma HMAC de MercadoPago",
  "api/pagos/flow/inscripcion": "callback de Flow (token de Flow)",
  "api/pagos/cron": "CRON_SECRET",
  "api/ops/cron": "CRON_SECRET",
  "api/document-processing/cron": "CRON_SECRET",
  "api/document-processing/kick": "CRON_SECRET",
  "api/audit/cron": "CRON_SECRET",
  "api/mcp": "Bearer OAuth del conector MCP",
  "api/oauth/register": "registro dinámico OAuth (público por estándar, rate limit)",
  "api/oauth/token": "PKCE + código de un solo uso",
};

const GUARD = /\b(requireSesionSegura|requireAccountApiAccess)\(/;
const USA_SESION = /auth\.getUser\(|@\/lib\/supabase\/server|cookies\(\)/;

describe("las rutas excluidas del matcher (leídas de src/proxy.ts) exigen sesión segura", () => {
  const exclusiones = exclusionesApiDelMatcher();
  const excluidas = rutasBajo("src/app/api").filter((f) => exclusiones.some((re) => re.test(rutaUrl(f))));

  it("el matcher se pudo leer (si esto da 0, cambió el formato y el test miente)", () => {
    expect(exclusiones.length).toBeGreaterThanOrEqual(10);
    expect(excluidas.map(rutaUrl)).toEqual(expect.arrayContaining(["api/sii-local/result", "api/extension/vault-key", "api/archivo/[id]"]));
  });

  it.each(excluidas.map((f) => [rutaUrl(f), f]))("%s: guard de sesión segura o ruta máquina declarada", (url, archivo) => {
    const src = sinImports(archivo);
    if (GUARD.test(src)) return;
    expect(MAQUINA[url], `${url} está fuera del matcher sin guard: pásala a requireSesionSegura o declárala en MAQUINA con su autenticación`).toBeDefined();
  });

  it.each(excluidas.map((f) => [rutaUrl(f), f]))("%s: si usa la cookie de sesión, llama al guard (si no, se salta el MFA)", (_url, archivo) => {
    const src = sinImports(archivo);
    if (USA_SESION.test(src)) expect(src).toMatch(GUARD);
  });

  it("ninguna excluida valida la sesión a mano con getUser", () => {
    for (const f of excluidas) expect(sinImports(f)).not.toContain("auth.getUser(");
  });

  it("sii-mock/dte (sin protección propia) exige sesión y cierra en producción", () => {
    for (const ruta of rutasBajo("src/app/api/sii-mock/dte")) {
      expect(sinImports(ruta)).toMatch(GUARD);
      expect(sinImports(ruta)).toContain("mockSiiHttpHabilitado(");
    }
  });

  it("el guard de cuenta aplica la misma regla (MFA incluido) — de ahí la hereda vault-key", () => {
    expect(sinImports("src/lib/api/account-guard.ts")).toContain("verificarSesionSegura(");
    expect(sinImports("src/lib/api/sesion-segura.ts")).toContain("necesitaMfa(");
  });
});
