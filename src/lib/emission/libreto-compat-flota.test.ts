/**
 * COMPATIBILIDAD DEL LIBRETO CON LA FLOTA INSTALADA.
 *
 * El libreto viaja como dato dentro del job y cada extensión instalada lo
 * valida fail-closed ANTES de abrir la ventana del SII. Si el server manda un
 * libreto que una versión en la calle rechaza, esa versión deja de emitir por
 * completo (no "emite raro": no emite). Este test saca de git los validadores
 * REALES de cada versión publicada (EXTENSION_RELEASES.json) y les pasa el
 * libreto actual. Si muerde: NO subiste versión, NO renombraste una clave y
 * NO saliste de la whitelist de selectores — o alguien lo hizo por ti.
 *
 * Requiere el repo git con esos commits (en CI: fetch-depth suficiente). Si
 * git no responde, el test falla explícito: un "skip" silencioso acá sería
 * justo lo que este test existe para impedir.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BOLETA_LIBRETO, FACTURA_LIBRETO } from "./sii-libreto";

const REPO = process.cwd();
const RELEASES_PATH = join(REPO, "extensions/sii-portal-rpa/EXTENSION_RELEASES.json");
const MODULOS = ["modules/sii-local.js", "modules/facturas-portal.js", "modules/rut.js"];

interface Release { version: string; sha: string; valida: Array<"facturas" | "boletas"> }

function gitShow(sha: string, ruta: string): string {
  return execFileSync("git", ["show", `${sha}:extensions/sii-portal-rpa/${ruta}`], { cwd: REPO, encoding: "utf8" });
}

async function cargarRelease(r: Release) {
  const dir = mkdtempSync(join(tmpdir(), `massdte-ext-${r.version}-`));
  mkdirSync(join(dir, "modules"), { recursive: true });
  for (const m of MODULOS) writeFileSync(join(dir, m), gitShow(r.sha, m));
  const sl = (await import(/* @vite-ignore */ pathToFileURL(join(dir, "modules/sii-local.js")).href)) as Record<string, unknown>;
  const fp = (await import(/* @vite-ignore */ pathToFileURL(join(dir, "modules/facturas-portal.js")).href)) as Record<string, unknown>;
  return { sl, fp };
}

const releases = (JSON.parse(readFileSync(RELEASES_PATH, "utf8")) as { releases: Release[] }).releases;

describe("libreto vs flota instalada (validadores reales sacados de git)", () => {
  it("EXTENSION_RELEASES.json lista al menos las tres versiones en la calle", () => {
    expect(releases.map((r) => r.version)).toEqual(expect.arrayContaining(["0.2.1", "0.2.2", "0.2.3"]));
  });

  for (const r of releases) {
    it(`extensión ${r.version} (${r.sha}) acepta FACTURA_LIBRETO y BOLETA_LIBRETO actuales`, async () => {
      const { sl, fp } = await cargarRelease(r);
      if (r.valida.includes("facturas")) {
        const validateLibreto = fp.validateLibreto as (l: unknown) => string | null;
        expect(typeof validateLibreto).toBe("function");
        expect(validateLibreto(FACTURA_LIBRETO)).toBeNull();
        // Sanidad del propio validador: un libreto con versión desconocida se rechaza.
        expect(validateLibreto({ ...FACTURA_LIBRETO, libreto_version: 99 })).toBe("LIBRETO_SCHEMA_UNKNOWN");
      }
      if (r.valida.includes("boletas")) {
        const validateLibretoBoleta = sl.validateLibretoBoleta as (l: unknown) => string | null;
        expect(typeof validateLibretoBoleta).toBe("function");
        expect(validateLibretoBoleta(BOLETA_LIBRETO)).toBeNull();
        expect(validateLibretoBoleta({ ...BOLETA_LIBRETO, libreto_version: 99 })).toBe("LIBRETO_SCHEMA_UNKNOWN");
        // Los bloques nuevos (glosa/modal/emisor/monto_alto) son invisibles para
        // esta versión: quitarlos tampoco cambia el veredicto.
        const { glosa: _g, modal: _m, emisor: _e, monto_alto: _ma, ...sinNuevos } = BOLETA_LIBRETO;
        expect(validateLibretoBoleta(sinNuevos)).toBeNull();
      }
    });
  }
});
