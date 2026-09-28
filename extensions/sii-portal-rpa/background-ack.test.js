// 0.2.9 · H2 — "la carrera de los 5 s" (causa CONFIRMADA con datos 2026-09-28: 18/18
// avisos "Cerraste tras emitir…" desde el 25-sep tenían la boleta SÍ guardada).
// El librero mandaba el overlay DONE apenas ENVIABA el resultado; el DONE arma un
// autocierre de 5 s en el worker; si el POST /api/sii-local/result tardaba más, el
// "close" llegaba sin ack → result_needs_review → el lote se frenaba en falso.
//
// Mismo arnés que background-rescate.test.js: se extraen las funciones REALES de
// background.js por nombre y se corren con fakes. MASSDTE_BACKGROUND_SRC=<ruta> corre
// la suite contra otro background (0.2.8: `git show 19effe7:extensions/sii-portal-rpa/
// background.js > /tmp/bg.js`): estos tests FALLAN ahí y pasan con la 0.2.9.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(process.env.MASSDTE_BACKGROUND_SRC || join(__dirname, "background.js"), "utf8");

function extraer(nombre) {
  const ini = SRC.search(new RegExp(`(^|\\n)(async\\s+)?function ${nombre}\\(`));
  if (ini < 0) return null;
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
// Una función que no existe en la versión bajo prueba (p. ej. la 0.2.8) se reemplaza por
// un stub que revienta: el test que la usa FALLA en vez de no poder montarse.
const extraerOStub = (nombre) => extraer(nombre) ?? `function ${nombre}() { throw new Error("${nombre} no existe en este background"); }`;

let app; let overlays; let stashes; let limpiados; let activeJobs; let cerrados;
function montar() {
  app = []; overlays = []; stashes = []; limpiados = []; cerrados = [];
  activeJobs = new Map();
  const fuente = [
    extraer("hasStrongFolioEvidence"),
    extraer("hasCapturedPdf"),
    extraer("handleCapturedResult"),
    extraer("handleWorkerAction"),
    extraerOStub("diagResultado"),
    extraerOStub("armarEsperaAck"),
    extraerOStub("sinAckAunDelGuardado"),
    extraerOStub("handleResultPersisted"),
    extraerOStub("avisoCierrePostEmit"),
    "return { handleCapturedResult, handleWorkerAction, handleResultPersisted };",
  ].join("\n\n");
  const chrome = {
    runtime: { lastError: null, getManifest: () => ({ version: "0.2.9-test" }) },
    tabs: { reload: () => Promise.resolve(), sendMessage: () => {} },
  };
  const deps = {
    chrome,
    activeJobs,
    SW_BOOT_AT: 1_700_000_000_000,
    swBoots24h: 3,
    ACK_TIMEOUT_MS: 60_000,
    sendToApp: (_s, m) => app.push(m),
    sendToSii: (_tab, m) => overlays.push(m),
    statusMessage: (jobId, status, message, recoverable, extra) => ({ type: "STATUS", job_id: jobId, status, message, recoverable, ...(extra || {}) }),
    resultMessage: (jobId, result, message) => ({ type: "APP_CONTABLE_SII_JOB_RESULT", job_id: jobId, status: "emitted", message, result }),
    captureDebugMessage: (jobId) => ({ type: "DEBUG", job_id: jobId }),
    capturePdfBytes: async () => null,
    stashPendingResult: async (jobId) => { stashes.push(jobId); },
    clearPendingResult: (jobId) => { limpiados.push(jobId); },
    pauseWorker: (_s, msg) => overlays.push({ mode: "PAUSED", message: msg }),
    closeWorker: (s) => { cerrados.push(s.jobId); activeJobs.delete(s.jobId); if (s.ackTimer) clearTimeout(s.ackTimer); },
    stateForWorkerTab: (tabId) => Array.from(activeJobs.values()).find((s) => s.workerTabId === tabId) ?? null,
    captureWorkerResult: () => {},
    driveFacturaPage: () => {},
    jobExpired: () => false,
    expireWorker: () => {},
    detenerVigiliaSinEmitir: () => {},
    scanWorkerPage: () => {},
  };
  return new Function(...Object.keys(deps), fuente)(...Object.values(deps));
}

const FOLIO = 24531;
const fuerte = () => ({ folio: FOLIO, folio_confidence: "high", folio_evidence: { source: "dialog_text" }, tipo_dte: 39 });
const postEmit = () => {
  const s = { jobId: "j1", kind: "boleta", workerTabId: 9, workerWindowId: 77, job: { job_id: "j1", empresa_id: "e1" }, createdAt: "2026-09-28T12:00:00.000Z", finalEmitClicked: true, submitted: true, awaitingResult: true, resultPersisted: false };
  activeJobs.set("j1", s);
  return s;
};
const statuses = () => app.filter((m) => m.type === "STATUS");
const frenos = () => statuses().filter((m) => m.status === "result_needs_review");
const cerrar = (fx) => { const r = []; fx.handleWorkerAction({ action: "close" }, { tab: { id: 9 } }, (x) => r.push(x)); return r; };

describe("0.2.9 · DONE y autocierre recién tras el ACK del guardado (H2)", () => {
  let fx;
  beforeEach(() => { vi.useFakeTimers(); fx = montar(); });
  afterEach(() => { vi.useRealTimers(); });

  it("enviar el resultado NO manda DONE (el DONE arma el autocierre de 5 s en el worker)", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    expect(app.some((m) => m.type === "APP_CONTABLE_SII_JOB_RESULT")).toBe(true);
    expect(stashes).toEqual(["j1"]);
    expect(overlays.some((o) => o.mode === "DONE")).toBe(false);
    expect(overlays.at(-1)).toMatchObject({ mode: "LOCKED_AUTOMATION" });
    expect(overlays.at(-1).message).toContain(String(FOLIO));
  });

  it("close a los 5 s SIN ack (POST lento) → NO frena el lote: estado no terminal honesto, jamás result_needs_review", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    vi.advanceTimersByTime(5_000);
    cerrar(fx);
    expect(frenos()).toHaveLength(0);
    expect(statuses().at(-1)).toMatchObject({ status: "result_awaiting_ack", folio: FOLIO, recoverable: true });
    expect(cerrados).toEqual(["j1"]);
  });

  it("el ack llega a los 8 s → DONE con auto_close:true, y el close posterior no manda nada", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    vi.advanceTimersByTime(8_000);
    fx.handleResultPersisted({ type: "APP_CONTABLE_SII_RESULT_PERSISTED", job_id: "j1", ok: true });
    expect(s.resultPersisted).toBe(true);
    expect(limpiados).toEqual(["j1"]);
    const done = overlays.filter((o) => o.mode === "DONE");
    expect(done).toHaveLength(1);
    expect(done[0].auto_close).toBe(true);
    expect(done[0].message).toContain(String(FOLIO));
    const antes = statuses().length;
    cerrar(fx);
    expect(statuses().length).toBe(antes);
    expect(frenos()).toHaveLength(0);
  });

  it("sin ack en 60 s → overlay AWAITING_ACK (sin autocierre) + result_awaiting_ack a la app; nunca result_needs_review", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    vi.advanceTimersByTime(59_000);
    expect(overlays.some((o) => o.mode === "AWAITING_ACK")).toBe(false);
    vi.advanceTimersByTime(1_500);
    const aw = overlays.filter((o) => o.mode === "AWAITING_ACK");
    expect(aw).toHaveLength(1);
    expect(aw[0].auto_close).toBeUndefined();
    expect(statuses().at(-1)).toMatchObject({ status: "result_awaiting_ack", folio: FOLIO });
    expect(frenos()).toHaveLength(0);
    expect(activeJobs.has("j1")).toBe(true); // la ventana NO se cierra sola
  });

  it("el ack que llega después del plazo igual cierra el ciclo con DONE + autocierre", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    vi.advanceTimersByTime(61_000);
    fx.handleResultPersisted({ job_id: "j1", ok: true });
    expect(overlays.at(-1)).toMatchObject({ mode: "DONE", auto_close: true });
  });

  it("ack con ok:false (el server lo rechazó) → AWAITING_ACK honesto, sin DONE ni autocierre", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    fx.handleResultPersisted({ job_id: "j1", ok: false, error: "FOLIO_DE_OTRO_DOCUMENTO" });
    expect(s.resultPersisted).toBe(false);
    expect(limpiados).toEqual(["j1"]); // rechazo permanente: no se reintenta
    expect(overlays.some((o) => o.mode === "DONE")).toBe(false);
    expect(overlays.at(-1).mode).toBe("AWAITING_ACK");
  });

  it("revisión I2: ack FALLIDO (server no guardó) y después cerrar → result_needs_review, nunca 'se está guardando'", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    fx.handleResultPersisted({ job_id: "j1", ok: false, error: "PERSISTENCE_FAILED" });
    cerrar(fx);
    expect(statuses().some((m) => m.status === "result_awaiting_ack")).toBe(false);
    expect(frenos()).toHaveLength(1);
  });

  it("close post-emit SIN resultado enviado (no hubo folio fuerte) → se mantiene el aviso de siempre", () => {
    postEmit();
    cerrar(fx);
    expect(frenos()).toHaveLength(1);
    expect(frenos()[0].message).toMatch(/Cerraste tras emitir/);
  });

  it("pre-emit: close sigue siendo 'closed' (sin cambios)", () => {
    const s = postEmit(); s.finalEmitClicked = false;
    cerrar(fx);
    expect(statuses().at(-1).status).toBe("closed");
  });

  it("telemetría: el resultado lleva diag con sw_boot_at, job_created_at y la versión del manifest", async () => {
    const s = postEmit();
    await fx.handleCapturedResult(s, fuerte());
    const r = app.find((m) => m.type === "APP_CONTABLE_SII_JOB_RESULT").result;
    expect(r.diag).toMatchObject({ sw_boot_at: 1_700_000_000_000, sw_boots_24h: 3, job_created_at: Date.parse("2026-09-28T12:00:00.000Z"), ext_version: "0.2.9-test" });
    // sin pisar campos del resultado
    expect(r.folio).toBe(FOLIO);
    expect(r.folio_confidence).toBe("high");
  });
});
