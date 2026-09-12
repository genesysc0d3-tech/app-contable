import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTENSION_ZIP_DOWNLOAD_PROPS,
  EXTENSION_ZIP_FILENAME,
  EXTENSION_ZIP_URL,
  EXTENSION_VERSION_ACTUAL,
  EXTENSION_VERSION_MINIMA,
  compararVersiones,
  extensionDesactualizada,
  mensajeExtensionDesactualizada,
  hayVersionNuevaDeExtension,
  versionDisponibleDeExtension,
  type FilaTelemetriaExtension,
} from "./extension";

describe("extension installer download", () => {
  it("points the install action to the public Motor Local ZIP", () => {
    expect(EXTENSION_ZIP_URL).toBe("/descargas/massdte-motor-local.zip");
    expect(EXTENSION_ZIP_FILENAME).toBe("massdte-motor-local.zip");
    expect(EXTENSION_ZIP_DOWNLOAD_PROPS).toEqual({
      href: "/descargas/massdte-motor-local.zip",
      download: "massdte-motor-local.zip",
    });
  });

  // Guarda anti-drift: la versión que la app anuncia como "última" DEBE ser la del
  // paquete que realmente se distribuye. Si alguien bumpea el manifest y olvida el
  // constante (o al revés), este test falla antes del deploy.
  it("keeps EXTENSION_VERSION_ACTUAL in sync with the shipped extension manifest", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const manifest = JSON.parse(
      readFileSync(join(root, "extensions/sii-portal-rpa/manifest.prod.json"), "utf8"),
    ) as { version: string };
    expect(EXTENSION_VERSION_ACTUAL).toBe(manifest.version);
  });
});

describe("piso de versión de la extensión", () => {
  it("el piso nunca supera a la versión que se distribuye (bloquearía a TODOS)", () => {
    expect(compararVersiones(EXTENSION_VERSION_MINIMA, EXTENSION_VERSION_ACTUAL)).toBeLessThanOrEqual(0);
  });

  it("compara versiones numéricamente, no como texto", () => {
    expect(compararVersiones("0.1.5", "0.1.6")).toBeLessThan(0);
    expect(compararVersiones("0.1.10", "0.1.9")).toBeGreaterThan(0); // "0.1.10" < "0.1.9" como string
    expect(compararVersiones("0.1.6", "0.1.6")).toBe(0);
    expect(compararVersiones("0.2", "0.1.9")).toBeGreaterThan(0);
    expect(compararVersiones("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("bloquea bajo el piso y deja pasar desde el piso hacia arriba", () => {
    expect(extensionDesactualizada("0.0.9")).toBe(true);
    expect(extensionDesactualizada(EXTENSION_VERSION_MINIMA)).toBe(false);
    expect(extensionDesactualizada("9.9.9")).toBe(false);
  });

  it("ante dato ausente o raro NO bloquea (mejor un intento que un falso candado)", () => {
    expect(extensionDesactualizada(null)).toBe(false);
    expect(extensionDesactualizada(undefined)).toBe(false);
    expect(extensionDesactualizada("")).toBe(false);
    expect(extensionDesactualizada("abc")).toBe(false);
  });

  it("el copy del bloqueo nombra la versión detectada y la mínima", () => {
    const msg = mensajeExtensionDesactualizada("0.1.5");
    expect(msg).toContain("0.1.5");
    expect(msg).toContain(EXTENSION_VERSION_MINIMA);
    expect(msg).toContain("chrome://extensions");
  });
});

describe("versión DISPONIBLE derivada de telemetría (no de la constante)", () => {
  const AHORA = new Date("2026-09-12T00:00:00Z");
  const RECIENTE = "2026-09-11T12:00:00Z";
  const RANCIO = "2026-06-01T00:00:00Z"; // > 30 días antes de AHORA
  const OPTS = {
    tope: "0.2.4", minima: "0.1.8",
    denylist: new Set(["interna1", "interna2"]),
    ventanaDias: 30, nMinimo: 2,
  };
  const fila = (empresa_id: string, version: string, seen_at: string): FilaTelemetriaExtension =>
    ({ empresa_id, version, seen_at });

  it("filtra internas + rancio + dato>tope, y exige ≥2 empresas reales", () => {
    const r = versionDisponibleDeExtension([
      fila("interna1", "0.2.4", RECIENTE), // denylist → NO cuenta (aunque = tope)
      fila("rancioX", "0.2.5", RANCIO),    // fuera de ventana → NO cuenta
      fila("sucioX", "9.9.9", RECIENTE),   // > tope → NO cuenta
      fila("realA", "0.2.1", RECIENTE),
      fila("realB", "0.2.1", RECIENTE),
    ], AHORA, OPTS);
    expect(r).toBe("0.2.1");
  });

  it("EL BUG (2026-09-12): 2 internas en la versión nueva, reales en la vieja → NO se anuncia la nueva", () => {
    const disponible = versionDisponibleDeExtension([
      fila("interna1", "0.2.4", RECIENTE),
      fila("interna2", "0.2.4", RECIENTE), // las 2 únicas en 0.2.4 son internas
      fila("realA", "0.2.1", RECIENTE),
      fila("realB", "0.2.1", RECIENTE),
    ], AHORA, OPTS);
    expect(disponible).toBe("0.2.1");
    // un cliente en 0.2.3 NO debe ver nag hacia una versión que solo corren internas
    expect(hayVersionNuevaDeExtension("0.2.3", disponible)).toBe(false);
  });

  it("un solo canario real NO voltea la flota (umbral ≥2)", () => {
    const r = versionDisponibleDeExtension([
      fila("realA", "0.2.4", RECIENTE), // 1 sola empresa real en 0.2.4
      fila("realB", "0.2.1", RECIENTE),
    ], AHORA, OPTS);
    expect(r).toBe("0.1.8"); // sin ≥2 en ninguna versión "nueva" → piso, no anuncia
  });

  it("sin señal viva → devuelve el piso (nunca sobre-anuncia)", () => {
    expect(versionDisponibleDeExtension([], AHORA, OPTS)).toBe("0.1.8");
  });

  it("hayVersionNuevaDeExtension usa el 'disponible' inyectado, no la constante", () => {
    expect(hayVersionNuevaDeExtension("0.2.1", "0.2.3")).toBe(true);  // instalada < disponible
    expect(hayVersionNuevaDeExtension("0.2.3", "0.2.3")).toBe(false);
    expect(hayVersionNuevaDeExtension("0.2.4", "0.2.3")).toBe(false); // instalada más nueva
  });

  it("versión RANCIA no cuenta aunque tenga ≥2 reales (muerde el filtro de recencia)", () => {
    const r = versionDisponibleDeExtension([
      fila("realA", "0.2.3", RANCIO), // 2 reales en 0.2.3 pero VIEJAS
      fila("realB", "0.2.3", RANCIO),
      fila("realC", "0.2.1", RECIENTE),
      fila("realD", "0.2.1", RECIENTE),
    ], AHORA, OPTS);
    expect(r).toBe("0.2.1"); // sin el filtro de recencia daría 0.2.3
  });

  it("versión > tope no cuenta aunque tenga ≥2 (muerde el filtro >tope del loop, separado del clamp)", () => {
    const r = versionDisponibleDeExtension([
      fila("realA", "0.2.5", RECIENTE), // 2 reales en 0.2.5 (> tope 0.2.4)
      fila("realB", "0.2.5", RECIENTE),
      fila("realC", "0.2.1", RECIENTE),
      fila("realD", "0.2.1", RECIENTE),
    ], AHORA, OPTS);
    expect(r).toBe("0.2.1"); // sin el filtro del loop, el clamp daría 0.2.4, no 0.2.1
  });

  it("agrupa versiones equivalentes de formato distinto (0.2.1 y 0.2.1.0 = ≥2)", () => {
    const r = versionDisponibleDeExtension([
      fila("realA", "0.2.1", RECIENTE),
      fila("realB", "0.2.1.0", RECIENTE), // misma versión, otro formato
    ], AHORA, OPTS);
    expect(r).toBe("0.2.1"); // sin canonicalizar, 2 buckets de 1 → caería al piso
  });
});
