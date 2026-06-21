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
  npm run audit:roles -- [options]

Options:
  --base-url URL       App URL. Default: AUDIT_BASE_URL or http://localhost:3001
  --state PATH         Genesys Playwright storage state. Default: AUDIT_STATE or /tmp/e2e-state-vercel.json
  --capture-login      Open Chrome headed, wait for manual Genesys login, save --state, then exit
  --headed             Run visible Chrome
  --keep-open          Keep the last browser open after the audit
  --help               Show this message

Login env vars:
  AUDIT_EMAIL / AUDIT_PASSWORD or APP_EMAIL / APP_PASS

Optional comparison:
  AUDIT_NONDEV_STATE=/tmp/nondev-state.json validates that a non-dev session cannot see /dev/cuentas.

Scope:
  Uses Genesys support mode to inspect available Start/Pro/Business accounts.
  It does not create emission jobs, locks, uploads, payments or SII/extension actions.
`);
}

if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

const BASE_URL = trimTrailingSlash(argValue("--base-url", process.env.AUDIT_BASE_URL ?? "http://localhost:3001"));
const STATE_PATH = argValue("--state", process.env.AUDIT_STATE ?? "/tmp/e2e-state-vercel.json");
const NONDEV_STATE = process.env.AUDIT_NONDEV_STATE;
const CAPTURE_LOGIN = hasFlag("--capture-login");
const HEADED = hasFlag("--headed") || process.env.AUDIT_HEADED === "1";
const KEEP_OPEN = hasFlag("--keep-open");
const EMAIL = process.env.AUDIT_EMAIL ?? process.env.APP_EMAIL;
const PASSWORD = process.env.AUDIT_PASSWORD ?? process.env.APP_PASS;

const plans = [
  { code: "business", label: "Business", equipoExpected: true },
  { code: "pro", label: "Pro", equipoExpected: false },
  { code: "start", label: "Start", equipoExpected: false },
];

const startedAt = new Date();
const isoStamp = startedAt.toISOString().replace(/[:.]/g, "-");
const localDate = formatLocalDate(startedAt);
const screenshotDir = path.join("/tmp", `massdte-role-audit-${isoStamp}`);
const reportPath = nextReportPath(path.join(ROOT, "artifacts", "runs"), `${localDate}-massdte-role-matrix-audit.md`);

const audit = {
  startedAt,
  baseUrl: BASE_URL,
  statePath: STATE_PATH,
  screenshotDir,
  reportPath,
  hadAuthState: false,
  devPanel: null,
  scenarios: [],
  nonDev: null,
  checks: [],
  console: [],
  pageErrors: [],
  failedRequests: [],
  httpIssues: [],
  responses: [],
  findings: [],
};

await main();

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  if (CAPTURE_LOGIN) {
    await captureLogin();
    return;
  }

  if (!fs.existsSync(STATE_PATH) && EMAIL && PASSWORD) {
    await programmaticLogin();
  }

  audit.hadAuthState = fs.existsSync(STATE_PATH);
  if (!audit.hadAuthState) {
    audit.findings.push({
      severity: "blocked",
      title: "Sesion Genesys no disponible",
      detail: `No existe storage state en ${STATE_PATH}. Captura login con audit:app --capture-login o pasa --state.`,
      evidence: STATE_PATH,
    });
    await writeReport();
    throw new Error(`No auth state available at ${STATE_PATH}`);
  }

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: STATE_PATH,
  });
  wireContext(context, audit);
  const page = await context.newPage();

  await runDevPanelCheck(page);
  if (audit.devPanel?.status === "ok") {
    for (const plan of plans) {
      await runPlanScenario(page, plan);
    }
  }

  await runNonDevCheck(browser);
  await classifyFindings();
  await writeReport();

  if (KEEP_OPEN) {
    console.log("Role matrix audit complete. Browser left open because --keep-open was provided.");
    await new Promise((resolve) => context.on("close", resolve));
  } else {
    await browser.close();
  }

  console.log(`Role matrix report: ${reportPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  console.log(`Findings: ${audit.findings.length}`);
}

async function captureLogin() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/auth/login?next=/dev/cuentas`, { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log(`Chrome abierto en ${BASE_URL}/auth/login?next=/dev/cuentas`);
  console.log(`Inicia sesion Genesys manualmente. Se guardara storageState en ${STATE_PATH}.`);

  const timeoutMs = Number(process.env.AUDIT_LOGIN_TIMEOUT_MS ?? 10 * 60 * 1000);
  const deadline = Date.now() + timeoutMs;
  let authed = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const pathname = pathnameFromUrl(page.url());
    if (/^\/(dev|massdte|escritorio|onboarding|empresa|revisar|subir|resumen|clientes|boletas)(\/|$)/.test(pathname)) {
      authed = true;
      break;
    }
  }

  if (!authed) {
    await browser.close();
    throw new Error("No se detecto una ruta autenticada antes del timeout.");
  }

  await page.waitForTimeout(1200);
  await context.storageState({ path: STATE_PATH });
  await browser.close();
  console.log(`Sesion capturada en ${STATE_PATH}`);
}

async function programmaticLogin() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/auth/login?next=/dev/cuentas`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL, { timeout: 5000 });
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD, { timeout: 5000 });
  await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Ingresar")').first().click({ timeout: 5000 });
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(2500);
  await page.goto(`${BASE_URL}/dev/cuentas`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1200);
  if (/\/auth\/login/.test(page.url())) {
    await browser.close();
    throw new Error("Login programatico no dejo una sesion autenticada.");
  }
  await context.storageState({ path: STATE_PATH });
  await browser.close();
}

function wireContext(context, target) {
  context.on("page", (page) => wirePage(page, target));
}

function wirePage(page, target) {
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    target.console.push({
      type: message.type(),
      url: sanitizeUrl(page.url()),
      text: sanitizeText(message.text()),
    });
  });
  page.on("pageerror", (error) => {
    target.pageErrors.push({
      url: sanitizeUrl(page.url()),
      text: sanitizeText(error.message),
    });
  });
  page.on("requestfailed", (request) => {
    target.failedRequests.push({
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
    target.httpIssues.push({
      status,
      method: request.method(),
      url: sanitizeUrl(response.url()),
      resourceType: request.resourceType(),
    });
  });
}

async function runDevPanelCheck(page) {
  const started = Date.now();
  let gotoStatus = null;
  let error = null;
  try {
    const response = await page.goto(`${BASE_URL}/dev/cuentas`, { waitUntil: "domcontentloaded", timeout: 25000 });
    gotoStatus = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(900);
  } catch (err) {
    error = sanitizeText(err instanceof Error ? err.message : String(err));
  }

  const finalPath = sanitizePath(pathFromUrl(page.url()));
  const hasPanel = await includesText(page, "Panel operador");
  const hasAccount360 = await includesText(page, "Account 360");
  const hasClientButton = await page.getByRole("button", { name: /Ver cliente/i }).count().catch(() => 0);
  const screenshotPath = await screenshot(page, "dev-cuentas-role-matrix");
  const status = error
    ? "error"
    : hasPanel && hasAccount360 && hasClientButton > 0
      ? "ok"
      : "missing-dev-signals";

  audit.devPanel = {
    status,
    finalPath,
    gotoStatus,
    durationMs: Date.now() - started,
    hasPanel,
    hasAccount360,
    clientButtons: hasClientButton,
    screenshot: screenshotPath,
    error,
  };
  audit.checks.push(check(
    "genesys-dev-panel",
    status === "ok" ? "pass" : "fail",
    status === "ok"
      ? `Genesys ve /dev/cuentas con ${hasClientButton} entrada(s) a modo cliente.`
      : `No se pudo confirmar panel dev. path=${finalPath}, error=${error ?? "n/a"}.`,
    screenshotPath,
  ));
}

async function runPlanScenario(page, plan) {
  const scenario = {
    plan: plan.label,
    query: plan.code,
    status: "unknown",
    searchPath: `/dev/cuentas?q=${plan.code}`,
    supportPath: "",
    screenshots: {},
    candidate: null,
    signals: {},
    emissionApi: null,
    checks: [],
  };
  audit.scenarios.push(scenario);

  await page.goto(`${BASE_URL}/dev/cuentas?q=${encodeURIComponent(plan.code)}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1000);
  scenario.screenshots.search = await screenshot(page, `search-${plan.code}`);

  const candidates = await collectClientCandidates(page, plan.label);
  const candidate = candidates.find((item) => item.matchesPlan && !item.disabled) ?? candidates.find((item) => item.matchesPlan);
  scenario.candidate = candidate
    ? {
        buttonIndex: candidate.buttonIndex,
        matchesPlan: candidate.matchesPlan,
        disabled: candidate.disabled,
        rowTextSample: sanitizeText(candidate.rowText),
      }
    : null;

  if (!candidate) {
    scenario.status = "skipped";
    const item = check(
      `plan-${plan.code}-available`,
      "skipped",
      `No se encontro una cuenta ${plan.label} con boton Ver cliente en /dev/cuentas?q=${plan.code}.`,
      scenario.screenshots.search,
    );
    scenario.checks.push(item);
    audit.checks.push(item);
    return;
  }

  if (candidate.disabled) {
    scenario.status = "skipped";
    const item = check(
      `plan-${plan.code}-support-entry`,
      "skipped",
      `La cuenta ${plan.label} encontrada no tiene empresa principal disponible para modo cliente.`,
      scenario.screenshots.search,
    );
    scenario.checks.push(item);
    audit.checks.push(item);
    return;
  }

  await page.getByRole("button", { name: /Ver cliente/i }).nth(candidate.buttonIndex).click().catch((error) => {
    const item = check(`plan-${plan.code}-support-entry`, "fail", `Click Ver cliente fallo: ${sanitizeText(error.message)}`);
    scenario.checks.push(item);
    audit.checks.push(item);
  });
  await page.waitForURL((url) => /\/massdte$/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1400);

  scenario.supportPath = sanitizePath(pathFromUrl(page.url()));
  scenario.screenshots.support = await screenshot(page, `support-${plan.code}-massdte`);
  scenario.signals = await collectMassdteSignals(page);
  scenario.emissionApi = await readEmissionJobs(page);
  scenario.status = "checked";

  addScenarioCheck(
    scenario,
    `plan-${plan.code}-support-banner`,
    scenario.signals.supportBanner ? "pass" : "fail",
    scenario.signals.supportBanner
      ? `${plan.label}: banner Modo soporte Genesys visible.`
      : `${plan.label}: no se encontro banner de modo soporte.`,
    scenario.screenshots.support,
  );
  addScenarioCheck(
    scenario,
    `plan-${plan.code}-usage`,
    scenario.signals.usoDelMes ? "pass" : "warn",
    scenario.signals.usoDelMes
      ? `${plan.label}: Uso del mes visible.`
      : `${plan.label}: no se encontro Uso del mes en /massdte.`,
    scenario.screenshots.support,
  );

  if (scenario.emissionApi.status === 200 && scenario.emissionApi.body?.ok) {
    const businessMode = scenario.emissionApi.body.business_mode === true;
    addScenarioCheck(
      scenario,
      `plan-${plan.code}-business-mode-api`,
      businessMode === plan.equipoExpected ? "pass" : "fail",
      `${plan.label}: /api/emision/jobs business_mode=${businessMode}; esperado=${plan.equipoExpected}.`,
    );
    addScenarioCheck(
      scenario,
      `plan-${plan.code}-team-panel`,
      scenario.signals.equipo === plan.equipoExpected ? "pass" : "fail",
      plan.equipoExpected
        ? scenario.signals.equipo
          ? `${plan.label}: panel Equipo visible.`
          : `${plan.label}: falta panel Equipo.`
        : scenario.signals.equipo
          ? `${plan.label}: aparece Equipo aunque el plan no debe mostrarlo.`
          : `${plan.label}: Equipo oculto como corresponde.`,
      scenario.screenshots.support,
    );

    if (scenario.emissionApi.body.locked) {
      addScenarioCheck(
        scenario,
        `plan-${plan.code}-active-lock-ui`,
        scenario.signals.emitirBloqueado ? "pass" : "fail",
        scenario.signals.emitirBloqueado
          ? `${plan.label}: hay lock activo y la UI muestra Emitir bloqueado.`
          : `${plan.label}: hay lock activo pero no se encontro Emitir bloqueado.`,
        scenario.screenshots.support,
      );
    } else {
      addScenarioCheck(
        scenario,
        `plan-${plan.code}-active-lock-ui`,
        "skipped",
        `${plan.label}: no hay lock activo; no se creo uno para mantener la corrida sin mutaciones de emision.`,
      );
    }
  } else {
    addScenarioCheck(
      scenario,
      `plan-${plan.code}-emission-api`,
      "warn",
      `${plan.label}: GET /api/emision/jobs devolvio HTTP ${scenario.emissionApi.status}.`,
    );
  }

  await leaveSupportMode(page, scenario);
}

function addScenarioCheck(scenario, name, status, detail, evidence = "") {
  const item = check(name, status, detail, evidence);
  scenario.checks.push(item);
  audit.checks.push(item);
}

async function collectClientCandidates(page, expectedPlanLabel) {
  return page.evaluate((planLabel) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const planRegex = new RegExp(planLabel, "i");
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter((button) => visible(button) && clean(button.textContent).includes("Ver cliente"));

    return buttons.map((button, buttonIndex) => {
      let node = button.parentElement;
      let rowText = clean(button.textContent);
      while (node && node !== document.body) {
        const text = clean(node.textContent);
        if (text.includes("Detalle") && text.includes("Empresas") && text.includes("Personas")) {
          rowText = text;
          break;
        }
        node = node.parentElement;
      }
      return {
        buttonIndex,
        disabled: button.disabled,
        matchesPlan: planRegex.test(rowText),
        rowText,
      };
    });
  }, expectedPlanLabel).catch(() => []);
}

async function collectMassdteSignals(page) {
  return {
    supportBanner: await includesText(page, "Modo soporte Genesys"),
    volverDev: await includesText(page, "Volver a dev"),
    usoDelMes: await includesText(page, "Uso del mes"),
    equipo: await includesText(page, "Equipo"),
    cambiarEmpresa: await includesText(page, "Cambiar empresa"),
    emitirBloqueado: await includesText(page, "Emitir bloqueado"),
  };
}

async function readEmissionJobs(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/emision/jobs", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    return {
      status: response.status,
      body: body
        ? {
            ok: body.ok === true,
            locked: body.locked === true,
            business_mode: body.business_mode === true,
            status_message: body.status_message ?? null,
          }
        : null,
    };
  }).catch((error) => ({ status: 0, body: { ok: false, error: sanitizeText(error.message) } }));
}

async function leaveSupportMode(page, scenario) {
  const volver = page.getByRole("button", { name: /Volver a dev/i }).first();
  if (!(await volver.count())) {
    addScenarioCheck(
      scenario,
      `plan-${scenario.query}-support-exit`,
      "fail",
      "No se encontro boton Volver a dev para cerrar modo soporte.",
      scenario.screenshots.support,
    );
    return;
  }

  await volver.click().catch((error) => {
    addScenarioCheck(
      scenario,
      `plan-${scenario.query}-support-exit`,
      "fail",
      `Click Volver a dev fallo: ${sanitizeText(error.message)}`,
      scenario.screenshots.support,
    );
  });
  await page.waitForURL((url) => /\/dev\/cuentas$/.test(url.pathname), { timeout: 12000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const returned = /\/dev\/cuentas$/.test(pathFromUrl(page.url()));
  addScenarioCheck(
    scenario,
    `plan-${scenario.query}-support-exit`,
    returned ? "pass" : "fail",
    returned
      ? `${scenario.plan}: Volver a dev retorna a /dev/cuentas.`
      : `${scenario.plan}: Volver a dev termino en ${sanitizePath(pathFromUrl(page.url()))}.`,
  );
}

async function runNonDevCheck(browser) {
  if (!NONDEV_STATE) {
    audit.nonDev = {
      status: "skipped",
      detail: "AUDIT_NONDEV_STATE no fue configurado; no se valido sesion real no-dev.",
    };
    audit.checks.push(check("nondev-dev-panel", "skipped", audit.nonDev.detail));
    return;
  }
  if (!fs.existsSync(NONDEV_STATE)) {
    audit.nonDev = {
      status: "skipped",
      detail: `AUDIT_NONDEV_STATE no existe: ${NONDEV_STATE}`,
    };
    audit.checks.push(check("nondev-dev-panel", "skipped", audit.nonDev.detail));
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: NONDEV_STATE });
  wireContext(context, audit);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/dev/cuentas`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1200);
  const finalPath = sanitizePath(pathFromUrl(page.url()));
  const hasPanel = await includesText(page, "Panel operador");
  const hasAccount360 = await includesText(page, "Account 360");
  const shot = await screenshot(page, "nondev-dev-cuentas-role-matrix");
  const passed = !hasPanel && !hasAccount360;
  audit.nonDev = {
    status: passed ? "pass" : "fail",
    finalPath,
    screenshot: shot,
  };
  audit.checks.push(check(
    "nondev-dev-panel",
    passed ? "pass" : "fail",
    passed
      ? `Sesion no-dev no ve panel dev; termino en ${finalPath}.`
      : "Sesion no-dev ve senales de panel dev.",
    shot,
  ));
  await context.close();
}

async function classifyFindings() {
  const pageErrors = uniqueBy(audit.pageErrors, (item) => `${item.url}:${item.text}`);
  const consoleErrors = uniqueBy(
    audit.console.filter((item) => item.type === "error" && !isExpectedConsoleError(item)),
    (item) => `${item.url}:${item.text}`,
  );
  const failedRequests = uniqueBy(
    audit.failedRequests.filter((item) => !isExpectedRequestFailure(item)),
    (item) => `${item.method}:${item.url}:${item.failure}`,
  );
  const http5xx = audit.httpIssues.filter((item) => item.status >= 500);
  const http4xx = audit.httpIssues.filter((item) => item.status >= 400 && item.status < 500 && !isExpectedHttpIssue(item));
  const failedChecks = audit.checks.filter((item) => item.status === "fail");

  if (pageErrors.length > 0) {
    audit.findings.push({
      severity: "high",
      title: "Page errors en matriz de roles",
      detail: `${pageErrors.length} pageerror(s) no capturados.`,
      evidence: pageErrors.slice(0, 3).map((item) => `${item.url} :: ${item.text}`).join("\n"),
    });
  }
  if (consoleErrors.length > 0) {
    audit.findings.push({
      severity: "medium",
      title: "Console errors en matriz de roles",
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
      title: "HTTP 5xx durante matriz de roles",
      detail: `${http5xx.length} respuesta(s) 5xx detectadas.`,
      evidence: http5xx.slice(0, 5).map((item) => `${item.status} ${item.method} ${item.url}`).join("\n"),
    });
  }
  if (http4xx.length > 0) {
    audit.findings.push({
      severity: "medium",
      title: "HTTP 4xx no clasificados",
      detail: `${http4xx.length} respuesta(s) 4xx detectadas con sesion autenticada.`,
      evidence: http4xx.slice(0, 5).map((item) => `${item.status} ${item.method} ${item.url}`).join("\n"),
    });
  }
  if (failedChecks.length > 0) {
    audit.findings.push({
      severity: "high",
      title: "Reglas de rol/plan fallidas",
      detail: `${failedChecks.length} check(s) de matriz de roles fallaron.`,
      evidence: failedChecks.map((item) => `${item.name}: ${item.detail}`).join("\n"),
    });
  }
}

function isExpectedHttpIssue(item) {
  void item;
  return false;
}

function isExpectedConsoleError(item) {
  void item;
  return false;
}

function isExpectedRequestFailure(item) {
  return isExpectedNextNavigationAbort(item);
}

function isExpectedNextNavigationAbort(item) {
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
    "tags: [audit, roles, dev-operator, playwright, massdte]",
    "---",
    "",
    "# MassDTE Role Matrix Audit",
    "",
    "## Trigger",
    "",
    "Auditoria enfocada en matriz Start/Pro/Business usando sesion Genesys y modo soporte read-only. No se probo extension SII ni se crearon jobs, locks, uploads o pagos.",
    "",
    "## Run",
    "",
    `- Base URL: ${BASE_URL}`,
    `- Genesys state path: ${audit.hadAuthState ? STATE_PATH : "no disponible"}`,
    `- Non-dev state: ${NONDEV_STATE ? sanitizePath(NONDEV_STATE) : "no configurado"}`,
    `- Screenshots: ${screenshotDir}`,
    `- Report: ${reportPath}`,
    "",
    "## Summary",
    "",
    `- Dev panel status: ${audit.devPanel?.status ?? "not-run"}`,
    `- Plan scenarios: ${audit.scenarios.length}`,
    `- Checks: ${audit.checks.length} (${formatObject(checkCounts)})`,
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

  lines.push("", "## Dev Panel", "");
  if (!audit.devPanel) {
    lines.push("- No ejecutado.");
  } else {
    lines.push(`- Status: ${audit.devPanel.status}`);
    lines.push(`- Final path: ${audit.devPanel.finalPath}`);
    lines.push(`- HTTP: ${audit.devPanel.gotoStatus ?? "n/a"}`);
    lines.push(`- Client buttons: ${audit.devPanel.clientButtons}`);
    lines.push(`- Screenshot: ${audit.devPanel.screenshot}`);
  }

  lines.push("", "## Plan Matrix", "");
  lines.push("| Plan | Scenario | Support path | Banner | Uso | Equipo UI | business_mode | Lock | Screenshot |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const scenario of audit.scenarios) {
    const api = scenario.emissionApi?.body;
    lines.push([
      scenario.plan,
      scenario.status,
      scenario.supportPath || "n/a",
      boolCell(scenario.signals.supportBanner),
      boolCell(scenario.signals.usoDelMes),
      boolCell(scenario.signals.equipo),
      typeof api?.business_mode === "boolean" ? String(api.business_mode) : "n/a",
      typeof api?.locked === "boolean" ? String(api.locked) : "n/a",
      scenario.screenshots.support ?? scenario.screenshots.search ?? "",
    ].map(escapeCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push("", "## Checks", "");
  lines.push("| Check | Status | Detail | Evidence |");
  lines.push("|---|---|---|---|");
  for (const item of audit.checks) {
    lines.push(`| ${item.name} | ${item.status} | ${escapeCell(item.detail)} | ${item.evidence ?? ""} |`);
  }

  lines.push("", "## Non-Dev Access", "");
  if (!audit.nonDev) {
    lines.push("- No ejecutado.");
  } else {
    lines.push(`- Status: ${audit.nonDev.status}`);
    lines.push(`- Detail: ${audit.nonDev.detail ?? "n/a"}`);
    if (audit.nonDev.finalPath) lines.push(`- Final path: ${audit.nonDev.finalPath}`);
    if (audit.nonDev.screenshot) lines.push(`- Screenshot: ${audit.nonDev.screenshot}`);
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
  lines.push("- Emails, UUIDs y parametros sensibles se redactan en diagnosticos.");
  lines.push("- Entrar/salir de modo soporte puede dejar eventos de auditoria operativa en la cuenta; no modifica documentos, pagos, jobs, locks ni emision.");
  lines.push("- Extension SII y SII real quedan fuera del alcance.");
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  lines.push(`- ${startedAt.toISOString()}: corrida generada por scripts/audit-role-matrix.mjs.`);

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function includesText(page, needle) {
  const text = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  return text.toLocaleLowerCase("es-CL").includes(needle.toLocaleLowerCase("es-CL"));
}

async function screenshot(page, name) {
  const fileName = `${String(audit.scenarios.length + 1).padStart(2, "0")}-${slug(name)}.png`;
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

function check(name, status, detail, evidence = "") {
  return { name, status, detail, evidence };
}

function boolCell(value) {
  if (typeof value !== "boolean") return "n/a";
  return value ? "yes" : "no";
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

function pathnameFromUrl(raw) {
  try {
    return new URL(raw).pathname;
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
