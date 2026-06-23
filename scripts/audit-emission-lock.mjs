import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);

function hasFlag(name) {
  return argv.includes(name);
}

function argValue(name, fallback) {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const ix = argv.indexOf(name);
  if (ix >= 0 && argv[ix + 1] && !argv[ix + 1].startsWith("--")) return argv[ix + 1];
  return fallback;
}

function usage() {
  console.log(`Usage:
  npm run audit:locks -- [options]

Options:
  --base-url URL       App URL. Default: AUDIT_BASE_URL or http://localhost:3001
  --state PATH         Normal user Playwright storage state. Default: AUDIT_LOCK_STATE, AUDIT_STATE or /tmp/e2e-state-vercel.json
  --provider NAME      Provider to request. Default: sii_local
  --tipo-dte NUMBER    DTE type. Default: 39
  --headed             Run visible Chrome
  --keep-open          Keep browser open after audit
  --help               Show this message

Scope:
  Creates at most one temporary /api/emision/jobs lock in the authenticated
  account, validates GET/PATCH/UI, and cancels it with DELETE. It does not touch
  the extension, SII portal, SimpleAPI upstream or document emission endpoints.
`);
}

if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

const BASE_URL = trimTrailingSlash(argValue("--base-url", process.env.AUDIT_BASE_URL ?? "http://localhost:3001"));
const STATE_PATH = argValue("--state", process.env.AUDIT_LOCK_STATE ?? process.env.AUDIT_STATE ?? "/tmp/e2e-state-vercel.json");
const PROVIDER = argValue("--provider", process.env.AUDIT_LOCK_PROVIDER ?? "sii_local");
const TIPO_DTE = Number(argValue("--tipo-dte", process.env.AUDIT_LOCK_TIPO_DTE ?? "39"));
const HEADED = hasFlag("--headed") || process.env.AUDIT_HEADED === "1";
const KEEP_OPEN = hasFlag("--keep-open");

const startedAt = new Date();
const localDate = formatLocalDate(startedAt);
const isoStamp = startedAt.toISOString().replace(/[:.]/g, "-");
const screenshotDir = path.join("/tmp", `massdte-lock-audit-${isoStamp}`);
const reportPath = nextReportPath(path.join(ROOT, "artifacts", "runs"), `${localDate}-massdte-emission-lock-audit.md`);

const audit = {
  startedAt,
  baseUrl: BASE_URL,
  statePath: STATE_PATH,
  provider: PROVIDER,
  tipoDte: TIPO_DTE,
  screenshotDir,
  reportPath,
  checks: [],
  findings: [],
  console: [],
  pageErrors: [],
  failedRequests: [],
  httpIssues: [],
  createdJob: null,
  cleanup: null,
  before: null,
  afterCreate: null,
  afterPatch: null,
  afterCleanup: null,
  ui: null,
  screenshotCount: 0,
};

await main();

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  if (!fs.existsSync(STATE_PATH)) {
    audit.findings.push({
      severity: "blocked",
      title: "Sesion normal no disponible",
      detail: `No existe storage state en ${STATE_PATH}.`,
      evidence: STATE_PATH,
    });
    await writeReport();
    throw new Error(`No auth state available at ${STATE_PATH}`);
  }

  await assertBaseReachable();

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: STATE_PATH,
  });
  wireContext(context);
  const page = await context.newPage();

  try {
    await runAudit(page);
  } finally {
    if (audit.createdJob && !audit.cleanup) {
      audit.cleanup = await deleteJob(page, audit.createdJob.job_id);
    }
    await classifyFindings();
    await writeReport();
    if (KEEP_OPEN) {
      console.log("Emission lock audit complete. Browser left open because --keep-open was provided.");
      await new Promise((resolve) => context.on("close", resolve));
    } else {
      await browser.close();
    }
  }

  console.log(`Emission lock audit report: ${reportPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  console.log(`Findings: ${audit.findings.length}`);
}

async function runAudit(page) {
  await page.goto(`${BASE_URL}/massdte`, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const initialShot = await screenshot(page, "massdte-before-lock");

  audit.before = await getLockStatus(page);
  addCheck(
    "lock-api-before",
    audit.before.status === 200 && audit.before.body?.ok ? "pass" : "fail",
    `GET inicial /api/emision/jobs devolvio HTTP ${audit.before.status}.`,
    initialShot,
  );

  if (audit.before.body?.locked) {
    addCheck("preexisting-lock", "blocked", "Ya existe un lock activo; la auditoria no crea ni cancela locks ajenos.", initialShot);
    return;
  }

  const authorization = await ensureEmissionAuthorization(page);
  addCheck(
    "emission-authorization",
    authorization.ok ? "pass" : "fail",
    authorization.ok
      ? `Autorizacion de emision ${authorization.created ? "registrada" : "vigente"} para ${sanitizeText(PROVIDER)}.`
      : `No se pudo preparar autorizacion de emision: HTTP ${authorization.status}, error ${sanitizeText(authorization.body?.error ?? "sin error")}.`,
  );
  if (!authorization.ok) return;

  const created = await createJob(page);
  if (!created.ok) {
    addCheck(
      "lock-create",
      isCreateBlocked(created) ? "blocked" : "fail",
      `POST /api/emision/jobs devolvio HTTP ${created.status}, error ${sanitizeText(created.body?.error ?? "sin error")}.`,
    );
    return;
  }

  audit.createdJob = created.body;
  addCheck("lock-create", "pass", `Job temporal creado: ${sanitizeJobId(created.body.job_id)}.`);

  audit.afterCreate = await getLockStatus(page);
  const createVisible = audit.afterCreate.status === 200
    && audit.afterCreate.body?.locked === true
    && audit.afterCreate.body?.bloqueo?.job_id === audit.createdJob.job_id;
  addCheck(
    "lock-api-after-create",
    createVisible ? "pass" : "fail",
    createVisible
      ? "GET /api/emision/jobs muestra el lock temporal creado."
      : `GET despues de crear no mostro el lock esperado: HTTP ${audit.afterCreate.status}.`,
  );

  const patched = await patchJob(page, audit.createdJob.job_id);
  addCheck(
    "lock-heartbeat-patch",
    patched.status === 200 && patched.body?.ok ? "pass" : "fail",
    patched.status === 200 && patched.body?.ok
      ? `PATCH actualizo estado visible a ${sanitizeText(patched.body.estado ?? "n/a")}.`
      : `PATCH devolvio HTTP ${patched.status}, error ${sanitizeText(patched.body?.error ?? "sin error")}.`,
  );

  audit.afterPatch = await getLockStatus(page);
  const statusVisible = audit.afterPatch.body?.bloqueo?.estado_visible === "audit_probe";
  addCheck(
    "lock-status-visible",
    statusVisible ? "pass" : "warn",
    statusVisible
      ? "GET refleja estado_visible audit_probe."
      : `GET no reflejo audit_probe; estado=${sanitizeText(audit.afterPatch.body?.bloqueo?.estado_visible ?? "n/a")}.`,
  );

  await page.goto(`${BASE_URL}/massdte`, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const lockShot = await screenshot(page, "massdte-active-lock");
  const bodyText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  audit.ui = {
    finalPath: sanitizePath(pathFromUrl(page.url())),
    screenshot: lockShot,
    hasBlockedText: /Emisi[oó]n bloqueada|Emisi[oó]n en curso|Hay una emisi[oó]n en curso/i.test(bodyText),
  };
  addCheck(
    "lock-ui-visible",
    audit.ui.hasBlockedText ? "pass" : "warn",
    audit.ui.hasBlockedText
      ? "La UI muestra texto de emision bloqueada/en curso con lock activo."
      : "La UI no mostro texto de bloqueo detectable; revisar screenshot.",
    lockShot,
  );

  audit.cleanup = await deleteJob(page, audit.createdJob.job_id);
  addCheck(
    "lock-cleanup",
    audit.cleanup.status === 200 && audit.cleanup.body?.ok ? "pass" : "fail",
    audit.cleanup.status === 200 && audit.cleanup.body?.ok
      ? `Job temporal cancelado con estado ${sanitizeText(audit.cleanup.body.estado ?? "n/a")}.`
      : `DELETE devolvio HTTP ${audit.cleanup.status}, error ${sanitizeText(audit.cleanup.body?.error ?? "sin error")}.`,
  );

  audit.afterCleanup = await getLockStatus(page);
  addCheck(
    "lock-api-after-cleanup",
    audit.afterCleanup.status === 200 && audit.afterCleanup.body?.locked === false ? "pass" : "fail",
    audit.afterCleanup.status === 200 && audit.afterCleanup.body?.locked === false
      ? "GET final confirma que no queda lock activo."
      : `GET final aun reporta locked=${String(audit.afterCleanup.body?.locked)}.`,
  );
}

async function assertBaseReachable() {
  try {
    const response = await fetch(BASE_URL, { method: "HEAD", redirect: "manual" });
    audit.baseStatus = response.status;
  } catch (error) {
    audit.findings.push({
      severity: "high",
      title: "Base URL no responde",
      detail: `No se pudo conectar a ${BASE_URL}.`,
      evidence: sanitizeText(error instanceof Error ? error.message : String(error)),
    });
    await writeReport();
    throw error;
  }
}

function wireContext(context) {
  context.on("page", (page) => wirePage(page));
}

function wirePage(page) {
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    audit.console.push({
      type: message.type(),
      url: sanitizeUrl(page.url()),
      text: sanitizeText(message.text()),
    });
  });
  page.on("pageerror", (error) => {
    audit.pageErrors.push({
      url: sanitizeUrl(page.url()),
      text: sanitizeText(error.message),
    });
  });
  page.on("requestfailed", (request) => {
    audit.failedRequests.push({
      method: request.method(),
      url: sanitizeUrl(request.url()),
      resourceType: request.resourceType(),
      failure: sanitizeText(request.failure()?.errorText ?? "unknown"),
    });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    audit.httpIssues.push({
      status,
      method: request.method(),
      url: sanitizeUrl(response.url()),
      resourceType: request.resourceType(),
    });
  });
}

async function getLockStatus(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/emision/jobs", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    return {
      status: response.status,
      body,
    };
  }).catch((error) => ({ status: 0, body: { ok: false, error: sanitizeText(error.message) } }));
}

async function createJob(page) {
  return page.evaluate(async ({ provider, tipoDte }) => {
    const response = await fetch("/api/emision/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        tipo_dte: tipoDte,
        origin: "audit_lock",
        expected_emisor_rut: "11111111-1",
      }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok && body?.ok === true, body };
  }, { provider: PROVIDER, tipoDte: TIPO_DTE }).catch((error) => ({ status: 0, ok: false, body: { error: sanitizeText(error.message) } }));
}

async function ensureEmissionAuthorization(page) {
  return page.evaluate(async ({ provider, tipoDte }) => {
    const params = new URLSearchParams({ provider });
    const statusResponse = await fetch(`/api/emision/authorizations?${params.toString()}`, { cache: "no-store" });
    const statusBody = await statusResponse.json().catch(() => null);
    if (statusResponse.ok && statusBody?.ok === true && statusBody?.authorized === true) {
      return { status: statusResponse.status, ok: true, created: false, body: statusBody };
    }

    const response = await fetch("/api/emision/authorizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        tipo_dte: tipoDte,
        ui_context: "audit_lock",
      }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok && body?.ok === true && body?.authorized === true, created: true, body };
  }, { provider: PROVIDER, tipoDte: TIPO_DTE }).catch((error) => ({ status: 0, ok: false, created: false, body: { error: sanitizeText(error.message) } }));
}

async function patchJob(page, jobId) {
  return page.evaluate(async ({ jobId }) => {
    const response = await fetch("/api/emision/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, status: "audit_probe" }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }, { jobId }).catch((error) => ({ status: 0, body: { error: sanitizeText(error.message) } }));
}

async function deleteJob(page, jobId) {
  return page.evaluate(async ({ jobId }) => {
    const response = await fetch("/api/emision/jobs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, estado: "cancelled" }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }, { jobId }).catch((error) => ({ status: 0, body: { error: sanitizeText(error.message) } }));
}

function isCreateBlocked(result) {
  return [400, 401, 402, 403, 409, 422, 428].includes(result.status);
}

async function classifyFindings() {
  const failedChecks = audit.checks.filter((item) => item.status === "fail");
  const blockedChecks = audit.checks.filter((item) => item.status === "blocked");
  const pageErrors = uniqueBy(audit.pageErrors, (item) => `${item.url}:${item.text}`);
  const consoleErrors = uniqueBy(audit.console.filter((item) => item.type === "error" && !isExpectedConsoleError(item)), (item) => `${item.url}:${item.text}`);
  const failedRequests = uniqueBy(audit.failedRequests.filter((item) => !isExpectedRequestFailure(item)), (item) => `${item.method}:${item.url}:${item.failure}`);
  const http5xx = audit.httpIssues.filter((item) => item.status >= 500);
  const http4xx = audit.httpIssues.filter((item) => item.status >= 400 && item.status < 500 && !isExpectedHttpIssue(item));

  if (failedChecks.length > 0) {
    audit.findings.push({
      severity: "high",
      title: "Checks de lock fallidos",
      detail: `${failedChecks.length} check(s) fallaron.`,
      evidence: failedChecks.map((item) => `${item.name}: ${item.detail}`).join("\n"),
    });
  }
  if (blockedChecks.length > 0) {
    audit.findings.push({
      severity: "blocked",
      title: "Auditoria de lock no pudo crear lock temporal",
      detail: blockedChecks.map((item) => `${item.name}: ${item.detail}`).join("\n"),
      evidence: "No se ejecuto extension/SII y no se cancelo ningun lock ajeno.",
    });
  }
  if (pageErrors.length > 0) {
    audit.findings.push({
      severity: "high",
      title: "Page errors durante lock audit",
      detail: `${pageErrors.length} pageerror(s) no capturados.`,
      evidence: pageErrors.slice(0, 3).map((item) => `${item.url} :: ${item.text}`).join("\n"),
    });
  }
  if (consoleErrors.length > 0) {
    audit.findings.push({
      severity: "medium",
      title: "Console errors durante lock audit",
      detail: `${consoleErrors.length} console.error distinto(s).`,
      evidence: consoleErrors.slice(0, 5).map((item) => `${item.url} :: ${item.text}`).join("\n"),
    });
  }
  if (failedRequests.length > 0) {
    audit.findings.push({
      severity: "medium",
      title: "Network request failures",
      detail: `${failedRequests.length} request(s) fallaron a nivel red.`,
      evidence: failedRequests.slice(0, 5).map((item) => `${item.method} ${item.url} :: ${item.failure}`).join("\n"),
    });
  }
  if (http5xx.length > 0) {
    audit.findings.push({
      severity: "high",
      title: "HTTP 5xx durante lock audit",
      detail: `${http5xx.length} respuesta(s) 5xx detectadas.`,
      evidence: http5xx.slice(0, 5).map((item) => `${item.status} ${item.method} ${item.url}`).join("\n"),
    });
  }
  if (http4xx.length > 0) {
    audit.findings.push({
      severity: "medium",
      title: "HTTP 4xx no clasificados",
      detail: `${http4xx.length} respuesta(s) 4xx detectadas.`,
      evidence: http4xx.slice(0, 5).map((item) => `${item.status} ${item.method} ${item.url}`).join("\n"),
    });
  }
}

function isExpectedHttpIssue(item) {
  const route = pathFromUrl(item.url);
  if (route === "/api/emision/jobs" && ["POST", "PATCH", "DELETE", "GET"].includes(item.method)) return true;
  return false;
}

function isExpectedConsoleError(item) {
  if (!/Failed to load resource: the server responded with a status of/i.test(item.text)) return false;
  return audit.httpIssues.some(isExpectedHttpIssue);
}

function isExpectedRequestFailure(item) {
  if (item.failure !== "net::ERR_ABORTED") return false;
  try {
    const base = new URL(BASE_URL);
    const url = new URL(item.url);
    if (url.origin !== base.origin) return false;
    return item.resourceType === "fetch" || url.searchParams.has("_rsc") || item.method === "POST";
  } catch {
    return false;
  }
}

async function writeReport() {
  const status = audit.findings.some((finding) => finding.severity === "blocked")
    ? "blocked"
    : audit.findings.some((finding) => finding.severity === "high")
      ? "open"
      : "done";
  const expectedFailedRequests = audit.failedRequests.filter(isExpectedRequestFailure);
  const unexpectedFailedRequests = audit.failedRequests.filter((item) => !isExpectedRequestFailure(item));
  const checkCounts = audit.checks.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    "---",
    "kind: run",
    `status: ${status}`,
    `created_at: ${startedAt.toISOString()}`,
    "tags: [audit, emission-locks, playwright, massdte]",
    "---",
    "",
    "# MassDTE Emission Lock Audit",
    "",
    "## Trigger",
    "",
    "Auditoria controlada de lock remoto de emision. Puede crear un job temporal y lo cancela con DELETE. No se probo extension SII, portal SII, SimpleAPI upstream ni emision real.",
    "",
    "## Run",
    "",
    `- Base URL: ${BASE_URL}`,
    `- State path: ${STATE_PATH}`,
    `- Provider requested: ${PROVIDER}`,
    `- Tipo DTE: ${TIPO_DTE}`,
    `- Screenshots: ${screenshotDir}`,
    `- Report: ${reportPath}`,
    `- Base status: ${audit.baseStatus ?? "n/a"}`,
    "",
    "## Summary",
    "",
    `- Checks: ${audit.checks.length} (${formatObject(checkCounts)})`,
    `- Created job: ${audit.createdJob?.job_id ? sanitizeJobId(audit.createdJob.job_id) : "no"}`,
    `- Cleanup: ${audit.cleanup ? `HTTP ${audit.cleanup.status}` : "n/a"}`,
    `- Console errors: ${audit.console.filter((item) => item.type === "error").length}`,
    `- Console warnings: ${audit.console.filter((item) => item.type === "warning").length}`,
    `- Page errors: ${audit.pageErrors.length}`,
    `- Failed requests: ${audit.failedRequests.length} (${unexpectedFailedRequests.length} unexpected, ${expectedFailedRequests.length} expected navigation aborts)`,
    `- HTTP 4xx/5xx: ${audit.httpIssues.length}`,
    `- Findings: ${audit.findings.length}`,
    "",
    "## Findings",
    "",
  ];

  if (audit.findings.length === 0) {
    lines.push("- Sin hallazgos en esta corrida.");
  } else {
    audit.findings.forEach((finding, index) => {
      lines.push(`${index + 1}. **${finding.severity.toUpperCase()} - ${finding.title}**`);
      lines.push(`   ${finding.detail}`);
      if (finding.evidence) lines.push(`   Evidence: ${formatEvidence(finding.evidence)}`);
    });
  }

  lines.push("", "## Checks", "");
  lines.push("| Check | Status | Detail | Evidence |");
  lines.push("|---|---|---|---|");
  for (const item of audit.checks) {
    lines.push(`| ${item.name} | ${item.status} | ${escapeCell(item.detail)} | ${item.evidence ?? ""} |`);
  }

  lines.push("", "## Lock Snapshots", "");
  lines.push(`- Before: ${formatLock(audit.before)}`);
  lines.push(`- After create: ${formatLock(audit.afterCreate)}`);
  lines.push(`- After patch: ${formatLock(audit.afterPatch)}`);
  lines.push(`- After cleanup: ${formatLock(audit.afterCleanup)}`);
  if (audit.ui) {
    lines.push(`- UI path: ${audit.ui.finalPath}`);
    lines.push(`- UI blocked text: ${audit.ui.hasBlockedText ? "yes" : "no"}`);
    lines.push(`- UI screenshot: ${audit.ui.screenshot}`);
  }

  lines.push("", "## Browser Diagnostics", "");
  lines.push("### Console");
  const consoleItems = uniqueBy(audit.console, (item) => `${item.type}:${item.url}:${item.text}`).slice(0, 20);
  if (consoleItems.length === 0) lines.push("- Sin errores ni warnings de consola registrados.");
  for (const item of consoleItems) lines.push(`- ${item.type}: ${item.url} :: ${item.text}`);

  lines.push("", "### Page Errors");
  if (audit.pageErrors.length === 0) lines.push("- Sin pageerror.");
  for (const item of uniqueBy(audit.pageErrors, (entry) => `${entry.url}:${entry.text}`).slice(0, 20)) {
    lines.push(`- ${item.url} :: ${item.text}`);
  }

  lines.push("", "### Network");
  const networkRows = [
    ...uniqueBy(audit.failedRequests, (item) => `${item.method}:${item.url}:${item.failure}`)
      .map((item) => `- FAILED ${item.method} ${item.url} :: ${item.failure}${isExpectedRequestFailure(item) ? " (esperado: navegacion Next cancelada)" : ""}`),
    ...uniqueBy(audit.httpIssues, (item) => `${item.status}:${item.method}:${item.url}`)
      .map((item) => `- HTTP ${item.status} ${item.method} ${item.url}${isExpectedHttpIssue(item) ? " (esperado/clasificado)" : ""}`),
  ].slice(0, 40);
  if (networkRows.length === 0) lines.push("- Sin fallos de red ni HTTP 4xx/5xx registrados.");
  lines.push(...networkRows);

  lines.push("", "## Privacy And Scope", "");
  lines.push("- No se guardan cookies, tokens, contrasenas ni valores de storage.");
  lines.push("- Job IDs se muestran truncados; no se copian payloads privados.");
  lines.push("- Si la corrida crea un job temporal, lo cancela con `DELETE /api/emision/jobs`.");
  lines.push("- Extension SII, SII real y SimpleAPI upstream quedan fuera del alcance.");
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  lines.push(`- ${startedAt.toISOString()}: corrida generada por scripts/audit-emission-lock.mjs.`);

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function screenshot(page, name) {
  const fileName = `${String(++audit.screenshotCount).padStart(2, "0")}-${slug(name)}.png`;
  const output = path.join(screenshotDir, fileName);
  await page.screenshot({ path: output, fullPage: true }).catch((error) => {
    audit.findings.push({
      severity: "medium",
      title: `No se pudo capturar screenshot: ${name}`,
      detail: sanitizeText(error.message),
      evidence: output,
    });
  });
  return output;
}

function addCheck(name, status, detail, evidence = "") {
  audit.checks.push({ name, status, detail, evidence });
}

function formatLock(result) {
  if (!result) return "n/a";
  const body = result.body ?? {};
  return `HTTP ${result.status}, ok=${String(body.ok)}, locked=${String(body.locked)}, business_mode=${String(body.business_mode)}, job=${sanitizeJobId(body.bloqueo?.job_id ?? "")}, status=${sanitizeText(body.bloqueo?.estado_visible ?? "n/a")}`;
}

function formatEvidence(evidence) {
  if (Array.isArray(evidence)) return evidence.map(escapeCell).join("; ");
  return String(evidence).includes("\n") ? `\n${evidence}` : evidence;
}

function formatObject(value) {
  const entries = Object.entries(value ?? {});
  if (entries.length === 0) return "n/a";
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function pathFromUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

function sanitizePath(raw) {
  return sanitizeText(raw).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":uuid");
}

function sanitizeUrl(raw) {
  try {
    const url = new URL(raw);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|secret|password|pass|key|code|access|refresh|credential/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return sanitizePath(`${url.origin}${url.pathname}${url.search}`);
  } catch {
    return sanitizeText(raw);
  }
}

function sanitizeText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/(access_token|refresh_token|password|passwd|secret|apikey|api_key|service_role)["'=:\s]+[^&\s"']+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function sanitizeJobId(value) {
  const text = sanitizeText(value ?? "");
  if (!text) return "n/a";
  return text.length > 28 ? `${text.slice(0, 28)}...` : text;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function formatLocalDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nextReportPath(dir, baseName) {
  fs.mkdirSync(dir, { recursive: true });
  const first = path.join(dir, baseName);
  if (!fs.existsSync(first)) return first;
  const parsed = path.parse(baseName);
  return path.join(dir, `${parsed.name}-${isoStamp}${parsed.ext}`);
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
