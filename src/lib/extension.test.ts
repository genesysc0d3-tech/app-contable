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
