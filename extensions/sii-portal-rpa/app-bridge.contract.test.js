// PRUEBA SINTÉTICA del contrato de comunicación app ↔ extensión.
//
// Carga el app-bridge.js REAL (el content script que traduce window.postMessage
// de la página ↔ chrome.runtime de la extensión) contra un harness con
// window/chrome/fetch falsos, y simula el handshake completo. No toca el SII:
// valida que los dos lados "se comuniquen bien" (mismos tipos, nonce, origins,
// persistencia y ack), que es el punto débil real entre app y extensión.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SRC = readFileSync(join(__dirname, "app-bridge.js"), "utf8");

const PROD_ORIGIN = "https://app-contable-five.vercel.app";
const PREVIEW_ORIGIN = "https://app-contable-git-fix-emision-2930f4-genesysc0d3-1037s-projects.vercel.app";
const LOCALHOST = "http://localhost:3000";

// Monta un bridge fresco sobre fakes controlables. Devuelve los ganchos para
// simular ambas direcciones y observar lo que sale hacia la página / el SW.
function mountBridge({ pageOrigin = PROD_ORIGIN } = {}) {
  const toPage = [];          // window.postMessage(...) del bridge → lo que recibe la app
  const toBackground = [];    // chrome.runtime.sendMessage(...) → lo que recibe el SW
  const fetches = [];         // fetch(...) → persistencia server-side
  let messageHandler = null;  // listener window 'message' del bridge (app → ext)
  let runtimeHandler = null;  // chrome.runtime.onMessage listener (ext → app)
  let fetchResult = { ok: true };

  const fakeWindow = {
    location: { origin: pageOrigin },
    addEventListener: (type, handler) => { if (type === "message") messageHandler = handler; },
    postMessage: (msg) => { toPage.push(msg); },
  };
  const fakeChrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => { toBackground.push({ msg, cb }); },
      onMessage: { addListener: (handler) => { runtimeHandler = handler; } },
      // El bridge adjunta la versión (telemetría de flota) en el POST del resultado.
      getManifest: () => ({ version: "9.9.9-test" }),
    },
  };
  const fakeFetch = (url, opts) => {
    fetches.push({ url, opts });
    return Promise.resolve({ json: () => Promise.resolve(fetchResult) });
  };

  // Ejecuta el IIFE del bridge con los globales inyectados.
  new Function("window", "chrome", "fetch", BRIDGE_SRC)(fakeWindow, fakeChrome, fakeFetch);

  return {
    toPage, toBackground, fetches,
    setFetchResult: (r) => { fetchResult = r; },
    setLastError: (e) => { fakeChrome.runtime.lastError = e; },
    // App → extensión: la página postea; event.source debe ser window.
    appPosts: (data, origin = pageOrigin) =>
      messageHandler({ source: fakeWindow, origin, data }),
    // Extensión → app: el SW manda un runtime message.
    extSends: (message) => runtimeHandler(message),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("app-bridge — dirección app → extensión", () => {
  let b;
  beforeEach(() => { b = mountBridge(); });

  it("reenvía un PING válido al background y devuelve el PONG a la página con el mismo nonce", () => {
    b.appPosts({ source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce: "n-123" });
    expect(b.toBackground).toHaveLength(1);
    expect(b.toBackground[0].msg.type).toBe("APP_CONTABLE_EXTENSION_PING");
    expect(b.toBackground[0].msg.nonce).toBe("n-123");
    // El SW responde PONG (vía el callback de sendMessage).
    b.toBackground[0].cb({ source: "app-contable-extension", type: "APP_CONTABLE_EXTENSION_PONG", nonce: "n-123", extension_version: "0.1.0" });
    const pong = b.toPage.find((m) => m.type === "APP_CONTABLE_EXTENSION_PONG");
    expect(pong).toBeTruthy();
    expect(pong.nonce).toBe("n-123");
    expect(pong.source).toBe("app-contable-extension");
    expect(pong.protocol_version).toBe(1);
  });

  it("reenvía un BOLETA_JOB con el emisor_rut intacto (fail-closed depende de esto)", () => {
    const job = { job_id: "job-1", emisor_rut: "76269769-6", tipo_dte: 41, monto: 1000 };
    b.appPosts({ source: "app-contable", type: "APP_CONTABLE_SII_BOLETA_JOB", protocol_version: 1, job });
    expect(b.toBackground).toHaveLength(1);
    expect(b.toBackground[0].msg.job.emisor_rut).toBe("76269769-6");
    expect(b.toBackground[0].msg.job.tipo_dte).toBe(41);
  });

  it("DESCARTA en silencio un mensaje desde el origin del PREVIEW (no está en la allowlist)", () => {
    b.appPosts(
      { source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce: "x" },
      PREVIEW_ORIGIN,
    );
    expect(b.toBackground).toHaveLength(0); // ← no se comunica en el preview
    expect(b.toPage).toHaveLength(0);
  });

  it("acepta el DOMINIO NUEVO app.massdte.cl (transición de dominio, ambos hosts conviven)", () => {
    const NUEVO = "https://app.massdte.cl";
    const b2 = mountBridge({ pageOrigin: NUEVO });
    b2.appPosts({ source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce: "n" }, NUEVO);
    expect(b2.toBackground).toHaveLength(1); // ← el nuevo host se comunica igual que el viejo
  });

  it("acepta localhost con puerto (dev)", () => {
    const b2 = mountBridge({ pageOrigin: LOCALHOST });
    b2.appPosts({ source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce: "y" }, LOCALHOST);
    expect(b2.toBackground).toHaveLength(1);
  });

  it("descarta un source falso (anti-spoofing de la página)", () => {
    b.appPosts({ source: "sitio-malicioso", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1 });
    expect(b.toBackground).toHaveLength(0);
  });

  it("descarta un tipo fuera de la allowlist del bridge", () => {
    // JOB_RESULT es inbound-only (ext→app); la app NUNCA debe poder empujarlo hacia el SW.
    b.appPosts({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_RESULT", protocol_version: 1 });
    expect(b.toBackground).toHaveLength(0);
  });

  it("JOB_CLOSE es fire-and-forget: si la extensión está huérfana NO reporta error (evita el bucle infinito)", () => {
    b.appPosts({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_CLOSE", protocol_version: 1, job_id: "job-1" });
    expect(b.toBackground).toHaveLength(1);
    b.setLastError({ message: "Could not establish connection" });
    b.toBackground[0].cb(undefined); // el SW no respondió (huérfano)
    const errStatus = b.toPage.find((m) => m.type === "APP_CONTABLE_SII_JOB_STATUS" && m.status === "error");
    expect(errStatus).toBeUndefined(); // ← sin bucle error→JOB_CLOSE→error
  });

  it("un envío normal que falla SÍ reporta status error recoverable a la página", () => {
    b.appPosts({ source: "app-contable", type: "APP_CONTABLE_SII_BOLETA_JOB", protocol_version: 1, job: { job_id: "job-1" } });
    b.setLastError({ message: "boom" });
    b.toBackground[0].cb(undefined);
    const errStatus = b.toPage.find((m) => m.type === "APP_CONTABLE_SII_JOB_STATUS" && m.status === "error");
    expect(errStatus).toBeTruthy();
    expect(errStatus.recoverable).toBe(true);
    expect(errStatus.job_id).toBe("job-1");
  });
});

describe("app-bridge — dirección extensión → app (persistencia del folio)", () => {
  let b;
  beforeEach(() => { b = mountBridge(); });

  it("JOB_RESULT con folio: persiste en /api/sii-local/result, ackea RESULT_PERSISTED y reenvía a la página con persisted", async () => {
    b.setFetchResult({ ok: true, boleta_id: "bol-1" });
    b.extSends({ source: "app-contable-extension", type: "APP_CONTABLE_SII_JOB_RESULT", job_id: "job-1", result: { folio: 12345, tipo: 41 } });
    await flush();

    // 1) Persistió server-side con el job_id correcto.
    const persistCall = b.fetches.find((f) => f.url === "/api/sii-local/result");
    expect(persistCall).toBeTruthy();
    expect(JSON.parse(persistCall.opts.body).job_id).toBe("job-1");
    expect(JSON.parse(persistCall.opts.body).result.folio).toBe(12345);

    // 2) Ackeó al SW con RESULT_PERSISTED ok:true (desarma el stash anti-pérdida).
    const ack = b.toBackground.find((m) => m.msg.type === "APP_CONTABLE_SII_RESULT_PERSISTED");
    expect(ack).toBeTruthy();
    expect(ack.msg.job_id).toBe("job-1");
    expect(ack.msg.ok).toBe(true);

    // 3) Reenvió a la página con result.persisted para la UI.
    const toPage = b.toPage.find((m) => m.type === "APP_CONTABLE_SII_JOB_RESULT");
    expect(toPage).toBeTruthy();
    expect(toPage.result.persisted.ok).toBe(true);
  });

  it("JOB_RESULT con folio pero persistencia FALLIDA: ackea ok:false y la página recibe persisted.ok:false (dispara Recuperar)", async () => {
    b.setFetchResult({ ok: false, error: "DB_INSERT_FAILED" });
    b.extSends({ source: "app-contable-extension", type: "APP_CONTABLE_SII_JOB_RESULT", job_id: "job-2", result: { folio: 999 } });
    await flush();

    const ack = b.toBackground.find((m) => m.msg.type === "APP_CONTABLE_SII_RESULT_PERSISTED");
    expect(ack.msg.ok).toBe(false); // el stash reintenta
    const toPage = b.toPage.find((m) => m.type === "APP_CONTABLE_SII_JOB_RESULT");
    expect(toPage.result.persisted.ok).toBe(false);
  });

  it("CAPTURE_DEBUG persiste best-effort y NO reenvía a la página (es telemetría, no UI)", async () => {
    b.extSends({ source: "app-contable-extension", type: "APP_CONTABLE_SII_CAPTURE_DEBUG", job_id: "job-3", result: { evidencia: "x" } });
    await flush();
    expect(b.fetches.find((f) => f.url === "/api/sii-local/result")).toBeTruthy();
    expect(b.toPage.find((m) => m.type === "APP_CONTABLE_SII_CAPTURE_DEBUG")).toBeUndefined();
  });

  it("descarta un runtime message con source ajeno (no EXT_SOURCE)", async () => {
    b.extSends({ source: "otra-extension", type: "APP_CONTABLE_SII_JOB_RESULT", job_id: "z", result: {} });
    await flush();
    expect(b.fetches).toHaveLength(0);
    expect(b.toPage).toHaveLength(0);
  });
});

// Cross-check del contrato: todo tipo que la APP emite debe estar en la allowlist
// del bridge, si no el bridge lo descarta en silencio ("no se comunican").
describe("app-bridge — completitud del contrato (tipos que la app emite ⊆ allowlist)", () => {
  const APP_EMITE = [
    "APP_CONTABLE_EXTENSION_PING",
    "APP_CONTABLE_SII_BOLETA_JOB",
    "APP_CONTABLE_SII_JOB_CLOSE",
    "APP_CONTABLE_SII_VAULT_LOCAL_WIPE",
    "APP_CONTABLE_OPEN_EXTENSION_OPTIONS",
    "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS",
    "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR",
  ];

  it.each(APP_EMITE)("el bridge acepta %s (está en ALLOWED_TYPES)", (tipo) => {
    const b = mountBridge();
    b.appPosts({ source: "app-contable", type: tipo, protocol_version: 1 });
    expect(b.toBackground).toHaveLength(1);
  });
});
