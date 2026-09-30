// Candados de background.js y app-bridge.js que NO pueden aflojarse por accidente.
// No hay arnés que monte background.js (usa chrome.* por todos lados), así que
// acá se asegura a nivel de FUENTE lo que muerde en prod; el bridge sí se monta
// con fakes (mismo truco que app-bridge.contract.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// MASSDTE_BACKGROUND_SRC=<ruta>: correr contra otra versión (p. ej. la 0.2.8) para ver fallar lo nuevo.
const BACKGROUND_SRC = readFileSync(process.env.MASSDTE_BACKGROUND_SRC || join(__dirname, "background.js"), "utf8");
const BRIDGE_SRC = readFileSync(join(__dirname, "app-bridge.js"), "utf8");

describe("background.js — flags de producción", () => {
  it("FACT_WORKER_EN_PESTANA queda en false (ventana con candado, no pestaña mirable)", () => {
    expect(BACKGROUND_SRC).toContain("const FACT_WORKER_EN_PESTANA = false;");
    expect(BACKGROUND_SRC).not.toMatch(/const FACT_WORKER_EN_PESTANA = true/);
  });
});

describe("background.js — tanda 2 (BG1/BG2/BG3) a nivel de fuente", () => {
  it("el gate de boletas lee el botón del libreto (botones.emitir) y no hardcodea EMITIR", () => {
    expect(BACKGROUND_SRC).toMatch(/libreto\?\.botones\?\.emitir/);
    expect(BACKGROUND_SRC).not.toMatch(/button\?\.text === "EMITIR"/);
  });

  it("existe la rama else con PANTALLA_SIN_EMITIR + ancla botones.emitir, una vez por job", () => {
    expect(BACKGROUND_SRC).toContain('"PANTALLA_SIN_EMITIR"');
    expect(BACKGROUND_SRC).toContain('ancla: "botones.emitir"');
    expect(BACKGROUND_SRC).toContain('page_kind: "sin_emitir"');
    expect(BACKGROUND_SRC).toMatch(/state\.sinEmitirAvisado = true/);
  });

  it("el aviso CAMBIO_SII se arma con baseMessage (EXT_SOURCE no existe en background.js)", () => {
    expect(BACKGROUND_SRC).not.toMatch(/^\s*source: EXT_SOURCE,/m);
    expect(BACKGROUND_SRC).toMatch(/type: "APP_CONTABLE_SII_CAMBIO_SII"/);
  });
});

// Monta el bridge real con window/chrome/fetch falsos y dispara un CAMBIO_SII
// desde el "service worker" para ver qué llega al servidor.
function mountBridge() {
  const fetches = [];
  let runtimeHandler = null;
  const fakeWindow = {
    location: { origin: "https://app.massdte.cl" },
    addEventListener: () => {},
    postMessage: () => {},
  };
  const fakeChrome = {
    runtime: {
      lastError: null,
      sendMessage: () => {},
      onMessage: { addListener: (h) => { runtimeHandler = h; } },
      getManifest: () => ({ version: "9.9.9-test" }),
    },
  };
  const fakeFetch = (url, opts) => {
    fetches.push({ url, body: JSON.parse(opts.body) });
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  };
  new Function("window", "chrome", "fetch", BRIDGE_SRC)(fakeWindow, fakeChrome, fakeFetch);
  return { fetches, extSends: (m) => runtimeHandler(m) };
}

describe("app-bridge.js — allowlist de APP_CONTABLE_SII_CAMBIO_SII (BG2)", () => {
  it("reenvía code, paso, mapa y posible_cambio_sii a /api/sii-local/cambio-sii", () => {
    const b = mountBridge();
    b.extSends({
      source: "app-contable-extension",
      type: "APP_CONTABLE_SII_CAMBIO_SII",
      job_id: "job-1",
      portal: "boletas",
      ancla: "botones.emitir",
      posible_cambio_sii: true,
      error: "sin botón",
      page_kind: "sin_emitir",
      libreto_version: "lib-7",
      ext_version: "0.2.3",
      code: "PANTALLA_SIN_EMITIR",
      paso: "gate_emitir",
      mapa: { buttons: ["0", "1"] },
      rut_cliente: "NO-DEBE-VIAJAR",
    });
    expect(b.fetches).toHaveLength(1);
    expect(b.fetches[0].url).toBe("/api/sii-local/cambio-sii");
    expect(b.fetches[0].body).toEqual({
      job_id: "job-1",
      portal: "boletas",
      ancla: "botones.emitir",
      error: "sin botón",
      page_kind: "sin_emitir",
      libreto_version: "lib-7",
      extension_version: "0.2.3",
      code: "PANTALLA_SIN_EMITIR",
      paso: "gate_emitir",
      mapa: { buttons: ["0", "1"] },
      posible_cambio_sii: true,
    });
    expect(b.fetches[0].body).not.toHaveProperty("rut_cliente");
  });

  it("sin los campos nuevos: nulls y posible_cambio_sii=false (error pre-emit sin ancla)", () => {
    const b = mountBridge();
    b.extSends({ source: "app-contable-extension", type: "APP_CONTABLE_SII_CAMBIO_SII", job_id: "job-2", portal: "facturas", error: "SIN_BOTON_VALIDAR" });
    expect(b.fetches[0].body).toMatchObject({ code: null, paso: null, mapa: null, posible_cambio_sii: false, extension_version: "9.9.9-test" });
  });
});


// 0.2.9 — PONG con la versión REAL instalada (plan §0.4) y telemetría de arranques del
// service worker (plan §4). A nivel de fuente: el PONG vive dentro del listener y no se
// puede extraer solo. FALLAN con el background 0.2.8.
describe("background.js — PONG y telemetría del service worker (0.2.9)", () => {
  const pong = () => {
    const i = BACKGROUND_SRC.indexOf('type: "APP_CONTABLE_EXTENSION_PONG"');
    expect(i).toBeGreaterThan(0);
    return BACKGROUND_SRC.slice(i, BACKGROUND_SRC.indexOf("}));", i));
  };

  it("el PONG informa chrome.runtime.getManifest().version, no la constante de core.js", () => {
    expect(pong()).toMatch(/extension_version:\s*chrome\.runtime\.getManifest\(\)\.version/);
    expect(pong()).not.toMatch(/extension_version:\s*EXTENSION_VERSION\b/);
  });

  it("SW_BOOT_AT existe, se persiste en chrome.storage.local (anillo sw_boots) y viaja en el PONG", () => {
    expect(BACKGROUND_SRC).toMatch(/^const SW_BOOT_AT = Date\.now\(\);/m);
    expect(BACKGROUND_SRC).toMatch(/chrome\.storage\.local\.set\(\{ \[SW_BOOTS_KEY\]: lista \}\)/);
    expect(BACKGROUND_SRC).toMatch(/^registrarArranqueSw\(\);/m);
    expect(pong()).toMatch(/sw_boot_at:\s*SW_BOOT_AT/);
  });

  it("el resultado enviado a la app lleva diag (sw_boot_at) sin pisar sus campos", () => {
    expect(BACKGROUND_SRC).toMatch(/resultMessage\(state\.jobId, \{ \.\.\.resultWithPdf, job: state\.job, diag: diagResultado\(state\) \}/);
  });
});
