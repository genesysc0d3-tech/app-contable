import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTENSION_ZIP_DOWNLOAD_PROPS,
  EXTENSION_ZIP_FILENAME,
  EXTENSION_ZIP_URL,
  EXTENSION_VERSION_ACTUAL,
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
