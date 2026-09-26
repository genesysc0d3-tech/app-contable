// Arnés FUNCIONAL de las rutas de rescate del librero (background.js), que no se
// puede montar entero (usa chrome.* por todos lados): se extraen las funciones
// REALES del fuente por nombre y se ejecutan con fakes de sus dependencias.
// Cubre: rescatarFolioFactura / handleFolioBuscadoFactura (cierre del ciclo de
// facturas) y verificarEnReportes (verificación por evento de boletas).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "background.js"), "utf8");

// Corta `function NOMBRE(...) { ... }` contando llaves (ignora las de strings/regex
// simples: el código de estas funciones no tiene llaves dentro de strings).
function extraer(nombre) {
  const ini = SRC.search(new RegExp(`(^|\\n)(async\\s+)?function ${nombre}\\(`));
  if (ini < 0) throw new Error(`no encontré ${nombre}`);
  const desde = SRC.indexOf("function", ini);
  let i = SRC.indexOf("{", SRC.indexOf(")", desde));
  let prof = 0;
  for (; i < SRC.length; i += 1) {
    const ch = SRC[i];
    if (ch === "`") { i = SRC.indexOf("`", i + 1); continue; }
    if (ch === "{") prof += 1;
    else if (ch === "}") { prof -= 1; if (prof === 0) return SRC.slice(ini, i + 1); }
  }
  throw new Error(`no cerré ${nombre}`);
}

let enviados; let tabsMsgs; let tabsCbs; let capturados; let pausas; let debugs; let activeJobs; let chromeFake;
function montar() {
  enviados = []; tabsMsgs = []; tabsCbs = []; capturados = []; pausas = []; debugs = [];
  activeJobs = new Map();
  const fuente = [
    extraer("hasStrongFolioEvidence"),
    extraer("rescatarFolioFactura"),
    extraer("handleFolioBuscadoFactura"),
    extraer("verificarEnReportes"),
    "return { rescatarFolioFactura, handleFolioBuscadoFactura, verificarEnReportes };",
  ].join("\n\n");
  const chrome = {
    runtime: { lastError: null },
    // El callback se guarda: el test decide cuándo y con qué "responde" el worker.
    tabs: { sendMessage: (_tab, msg, cb) => { tabsMsgs.push(msg); tabsCbs.push(cb || null); } },
  };
  chromeFake = chrome;
  const deps = {
    chrome,
    activeJobs,
    sendToApp: (_s, m) => enviados.push(m),
    statusMessage: (jobId, status, message, recoverable, extra) => ({ type: "STATUS", job_id: jobId, status, message, ...(extra || {}) }),
    baseMessage: (m) => m,
    handleCapturedResult: (_s, r) => capturados.push(r),
    captureDebugMessage: (jobId, r, msg) => { debugs.push({ r, msg }); return { type: "DEBUG", job_id: jobId }; },
    pauseWorker: (_s, msg) => pausas.push(msg),
  };
  // eslint-disable-next-line no-new-func
  return new Function(...Object.keys(deps), fuente)(...Object.values(deps));
}

const terminales = () => enviados.filter((m) => m.type === "STATUS" && (m.status === "result_needs_review" || m.status === "error"));
const estado = () => { const s = { jobId: "f1", workerTabId: 9, job: { job_id: "f1" }, kind: "factura" }; activeJobs.set("f1", s); return s; };
const high = (folio) => ({ folio, folio_confidence: "high", folio_evidence: { source: "emitidos_calce_unico" } });

describe("librero · cierre del ciclo de facturas (rescatarFolioFactura / handleFolioBuscadoFactura)", () => {
  let fx; beforeEach(() => { vi.useFakeTimers(); fx = montar(); });

  it("pide la búsqueda al worker con el snapshot y, con folio fuerte, lo registra (sin terminal de a medias)", () => {
    const s = estado(); s.factSnapshot = [970];
    fx.rescatarFolioFactura(s, "motivo");
    expect(tabsMsgs[0]).toMatchObject({ type: "APP_CONTABLE_SII_FACT_BUSCAR_FOLIO", snapshot_emitidos: [970], solo_sugerir: false });
    fx.handleFolioBuscadoFactura(s, { result: high(971) });
    expect(capturados.map((r) => r.folio)).toEqual([971]);
    expect(terminales()).toHaveLength(0);
  });

  it("un segundo disparo EN VUELO no manda un terminal que frene el lote", () => {
    const s = estado();
    fx.rescatarFolioFactura(s, "primero");
    fx.rescatarFolioFactura(s, "segundo");
    expect(tabsMsgs).toHaveLength(1);
    expect(terminales()).toHaveLength(0);
  });

  it("la búsqueda que PUEDE cerrar es una sola: un tercer pedido ya no busca, contesta a medias", () => {
    const s = estado();
    fx.rescatarFolioFactura(s, "a");
    fx.handleFolioBuscadoFactura(s, { result: { folio: null, folio_confidence: "none", emitidos_leido: true } });
    const antes = tabsMsgs.length;
    fx.rescatarFolioFactura(s, "b");
    expect(tabsMsgs.length).toBe(antes);
    expect(terminales().at(-1)).toMatchObject({ status: "result_needs_review", message: "b" });
  });

  it("solo-sugerencia en vuelo + llega la página de éxito → se encola y corre al terminar, con su PDF", () => {
    const s = estado();
    fx.rescatarFolioFactura(s, "clave reapareció", { soloSugerir: true });
    const captura = { folio: null, pdf: { base64: "UERG" } };
    fx.rescatarFolioFactura(s, "página de éxito sin folio", { captura });
    expect(tabsMsgs).toHaveLength(1);
    fx.handleFolioBuscadoFactura(s, { result: { folio: 971, folio_confidence: "medium", folio_evidence: { source: "emitidos_ambiguo" } } });
    expect(tabsMsgs).toHaveLength(2); // corrió la encolada
    expect(tabsMsgs[1]).toMatchObject({ solo_sugerir: false });
    fx.handleFolioBuscadoFactura(s, { result: high(971) });
    expect(capturados.at(-1)).toMatchObject({ folio: 971, pdf: { base64: "UERG" } });
  });

  it("folio de la página ≠ folio de la búsqueda → medium (contradice_pagina) y SIN el PDF de la página", () => {
    const s = estado();
    fx.rescatarFolioFactura(s, "m", { captura: { folio: 962, pdf: { base64: "X" } } });
    fx.handleFolioBuscadoFactura(s, { result: high(971) });
    const r = capturados.at(-1);
    expect(r.folio_confidence).toBe("medium");
    expect(r.folio_evidence.motivo).toBe("contradice_pagina");
    expect(r.pdf).toBeNull();
  });

  it("nada en Documentos emitidos → a medias con motivo + rastro de la página post-firma", () => {
    const s = estado();
    fx.rescatarFolioFactura(s, "no leí el folio", { captura: { folio: null, excerpt: "..." } });
    fx.handleFolioBuscadoFactura(s, { result: { folio: null, folio_confidence: "none", emitidos_leido: true } });
    expect(debugs).toHaveLength(1);
    expect(pausas).toHaveLength(1);
    expect(terminales().at(-1).message).toMatch(/no aparece una factura nueva/);
  });

  it("el worker no contesta en 45 s → a medias con el motivo; la respuesta tardía se ignora", () => {
    const s = estado();
    fx.rescatarFolioFactura(s, "motivo lento");
    vi.advanceTimersByTime(45_001);
    expect(terminales().at(-1)).toMatchObject({ status: "result_needs_review", message: "motivo lento" });
    fx.handleFolioBuscadoFactura(s, { result: high(971) });
    expect(capturados).toHaveLength(0);
  });
});

describe("librero · verificación por evento de boletas (verificarEnReportes)", () => {
  let fx; beforeEach(() => { vi.useFakeTimers(); fx = montar(); });
  const estadoV = () => { const s = { jobId: "v1", workerTabId: 9, job: { job_id: "v1", verify_only: true, verify_window: { desde_ms: 1_000_000, hasta_ms: 1_120_000 } } }; activeJobs.set("v1", s); return s; };
  const responder = (resp, lastError = null) => { chromeFake.runtime.lastError = lastError; tabsCbs.at(-1)(resp); chromeFake.runtime.lastError = null; };

  it("manda VERIFICAR_REPORTES con la ventana del intento (min = duración + 2)", () => {
    fx.verificarEnReportes(estadoV());
    expect(tabsMsgs[0]).toMatchObject({ type: "APP_CONTABLE_SII_VERIFICAR_REPORTES", ctx: { final_emit_at: 1_120_000, ventana_antes_min: 4, ventana_despues_min: 6 } });
  });

  it("dos disparos seguidos (page_ready repetido) → una sola verificación", () => {
    const s = estadoV();
    fx.verificarEnReportes(s);
    fx.verificarEnReportes(s);
    expect(tabsMsgs).toHaveLength(1);
  });

  it("folio fuerte → se registra; folio ambiguo → también pasa por handleCapturedResult (queda rastro)", () => {
    const s = estadoV();
    fx.verificarEnReportes(s);
    responder({ ok: true, result: { folio: 1241, folio_confidence: "high", folio_evidence: { source: "reportes_calce_unico" } } });
    expect(capturados.at(-1).folio).toBe(1241);
    const s2 = { ...estadoV(), verifyEnCurso: false, verifyTerminal: false };
    activeJobs.set("v1", s2);
    fx.verificarEnReportes(s2);
    responder({ ok: true, result: { folio: 1242, folio_confidence: "medium", folio_evidence: { source: "reportes_ambiguo" } } });
    expect(capturados.at(-1).folio).toBe(1242);
    expect(terminales()).toHaveLength(0);
  });

  it("tabla leída y 0 candidatas → 'no salió' con verificado_sin_folio (la app la deja re-emitible)", () => {
    fx.verificarEnReportes(estadoV());
    responder({ ok: true, result: { folio: null, folio_confidence: "none", reportes_tabla_leida: true } });
    expect(terminales().at(-1)).toMatchObject({ status: "error", verificado_sin_folio: true });
  });

  it("sin tabla legible → a medias (NUNCA 'no salió' sin haber leído)", () => {
    fx.verificarEnReportes(estadoV());
    responder({ ok: true, result: { folio: null, folio_confidence: "none", reportes_tabla_leida: false } });
    const t = terminales().at(-1);
    expect(t.status).toBe("result_needs_review");
    expect(t.verificado_sin_folio).toBeUndefined();
  });

  it("canal muerto / worker sin respuesta → a medias", () => {
    fx.verificarEnReportes(estadoV());
    responder(undefined, { message: "Receiving end does not exist" });
    expect(terminales().at(-1).status).toBe("result_needs_review");
  });

  it("después de un terminal, un nuevo disparo no habla por el job", () => {
    const s = estadoV();
    fx.verificarEnReportes(s);
    responder({ ok: true, result: { folio: null, reportes_tabla_leida: true } });
    const n = tabsMsgs.length;
    fx.verificarEnReportes(s);
    expect(tabsMsgs.length).toBe(n);
  });
});
