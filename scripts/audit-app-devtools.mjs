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
  npm run audit:app -- [options]

Options:
  --base-url URL       App URL. Default: AUDIT_BASE_URL or http://localhost:3001
  --state PATH         Playwright storage state. Default: AUDIT_STATE or /tmp/e2e-state.json
  --capture-login      Open Chrome headed, wait for manual login, save --state, then exit
  --headed             Run visible Chrome for the audit
  --keep-open          Keep the last browser open after the audit
  --require-auth       Exit non-zero when no storage state or env login is available
  --expect-dev         Assert the authenticated session can access /dev/cuentas
  --no-expect-dev      Do not assert /dev/cuentas access for the main session
  --lighthouse         Run optional Lighthouse if local dependencies exist
  --help               Show this message

Login env vars:
  AUDIT_EMAIL / AUDIT_PASSWORD or APP_EMAIL / APP_PASS

Optional comparison:
  AUDIT_NONDEV_STATE=/tmp/nondev-state.json verifies a non-dev session cannot see /dev/cuentas.
`);
}

if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

const BASE_URL = trimTrailingSlash(argValue("--base-url", process.env.AUDIT_BASE_URL ?? "http://localhost:3001"));
const STATE_PATH = argValue("--state", process.env.AUDIT_STATE ?? "/tmp/e2e-state.json");
const CAPTURE_LOGIN = hasFlag("--capture-login");
const HEADED = hasFlag("--headed") || process.env.AUDIT_HEADED === "1";
const KEEP_OPEN = hasFlag("--keep-open");
const REQUIRE_AUTH = hasFlag("--require-auth") || process.env.AUDIT_REQUIRE_AUTH === "1";
const RUN_LIGHTHOUSE = hasFlag("--lighthouse") || process.env.AUDIT_LIGHTHOUSE === "1";
const EXPECT_DEV = hasFlag("--no-expect-dev") ? false : hasFlag("--expect-dev") || process.env.AUDIT_EXPECT_DEV !== "0";
const EMAIL = process.env.AUDIT_EMAIL ?? process.env.APP_EMAIL;
const PASSWORD = process.env.AUDIT_PASSWORD ?? process.env.APP_PASS;
const NONDEV_STATE = process.env.AUDIT_NONDEV_STATE;

const startedAt = new Date();
const localDate = formatLocalDate(startedAt);
const isoStamp = startedAt.toISOString().replace(/[:.]/g, "-");
const screenshotDir = path.join("/tmp", `massdte-audit-${isoStamp}`);
const reportPath = nextReportPath(path.join(ROOT, "artifacts", "runs"), `${localDate}-massdte-dev-audit.md`);

const protectedRoutes = [
  {
    name: "dev-cuentas",
    path: "/dev/cuentas",
    authRequired: true,
    devOnly: true,
    signals: ["Panel operador", "Account 360", "Ver cliente", "Detalle"],
  },
  {
    name: "dev-diagnostico",
    path: "/dev/diagnostico",
    authRequired: true,
    devOnly: true,
    signals: ["Diagnostico", "Genesys", "operador"],
  },
  {
    name: "massdte",
    path: "/massdte",
    authRequired: true,
    signals: ["Uso del mes", "Equipo", "Modo soporte Genesys", "Cambiar empresa", "Emitir bloqueado"],
  },
  {
    name: "empresa",
    path: "/empresa",
    authRequired: true,
    signals: ["Empresa", "Datos del emisor", "Formatos de cartola", "Folios CAF", "Agregar persona"],
  },
  {
    name: "revisar",
    path: "/revisar",
    authRequired: true,
    signals: ["Revisar", "propuestas", "pendientes"],
  },
  {
    name: "subir",
    path: "/subir",
    authRequired: true,
    signals: ["Subir", "documento", "cartola"],
  },
  {
    name: "clientes",
    path: "/clientes",
    authRequired: true,
    signals: ["Clientes", "cliente"],
  },
  {
    name: "boletas-reportes",
    path: "/boletas/reportes",
    authRequired: true,
    signals: ["Reporte RCV", "Registro de ventas"],
  },
  {
    name: "planes",
    path: "/planes",
    authRequired: true,
    signals: ["Start", "Pro", "Business", "Mercado Pago"],
  },
];

const audit = {
  startedAt,
  baseUrl: BASE_URL,
  statePath: STATE_PATH,
  screenshotDir,
  reportPath,
  authSource: "none",
  hadAuthState: false,
  routes: [],
  dynamicRoutes: [],
  businessChecks: [],
  console: [],
  pageErrors: [],
  failedRequests: [],
  httpIssues: [],
  responses: [],
  storage: [],
  findings: [],
  lighthouse: [],
};

if (CAPTURE_LOGIN) {
  await captureLogin();
  process.exit(0);
}

await main();

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  await assertBaseReachable();

  const stateExistsBeforeLogin = fs.existsSync(STATE_PATH);
  if (!stateExistsBeforeLogin && EMAIL && PASSWORD) {
    await programmaticLogin();
  }

  audit.hadAuthState = fs.existsSync(STATE_PATH);
  audit.authSource = audit.hadAuthState
    ? stateExistsBeforeLogin
      ? "storage-state"
      : "env-login"
    : "none";

  if (!audit.hadAuthState) {
    audit.findings.push({
      severity: "blocked",
      title: "Auditoria autenticada no ejecutada",
      detail: "No existe storage state en /tmp ni se recibieron credenciales por variables de entorno. La corrida valida redirects y salud basica, pero no prueba reglas de negocio autenticadas.",
      evidence: STATE_PATH,
    });
    if (REQUIRE_AUTH) {
      await writeReport();
      throw new Error(`No auth state available at ${STATE_PATH}`);
    }
  }

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: audit.hadAuthState ? STATE_PATH : undefined,
  });
  wireContext(context, audit);
  const page = await context.newPage();
  await runRouteAudit(page, audit, protectedRoutes);
  await runDevSpecificFlows(page, audit);
  await runMassdteBusinessSignals(page, audit);
  await collectStorageSummary(context, audit);

  if (NONDEV_STATE) {
    await runNonDevCheck(browser, audit, NONDEV_STATE);
  }

  if (RUN_LIGHTHOUSE) {
    await runOptionalLighthouse(audit);
  }

  await classifyFindings(audit);
  await writeReport();

  if (KEEP_OPEN) {
    console.log("Audit complete. Browser left open because --keep-open was provided.");
    await new Promise((resolve) => context.on("close", resolve));
  } else {
    await browser.close();
  }

  console.log(`Audit report: ${reportPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  console.log(`Findings: ${audit.findings.length}`);
}

async function captureLogin() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log(`Chrome abierto en ${BASE_URL}/auth/login`);
  console.log(`Inicia sesion manualmente. Se guardara storageState en ${STATE_PATH}.`);

  const timeoutMs = Number(process.env.AUDIT_LOGIN_TIMEOUT_MS ?? 10 * 60 * 1000);
  const deadline = Date.now() + timeoutMs;
  let authed = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (/\/(massdte|escritorio|onboarding|empresa|revisar|subir|resumen|clientes|boletas|dev)/.test(url)) {
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
  await page.goto(`${BASE_URL}/massdte`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1200);
  if (/\/auth\/login/.test(page.url())) {
    await browser.close();
    throw new Error("Login programatico no dejo una sesion autenticada.");
  }
  await context.storageState({ path: STATE_PATH });
  await browser.close();
}

async function assertBaseReachable() {
  try {
    const response = await fetch(BASE_URL, { method: "HEAD", redirect: "manual" });
    audit.baseStatus = response.status;
  } catch (error) {
    audit.findings.push({
      severity: "high",
      title: "Servidor local no responde",
      detail: `No se pudo conectar a ${BASE_URL}.`,
      evidence: sanitizeText(error instanceof Error ? error.message : String(error)),
    });
    await writeReport();
    throw error;
  }
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
    const request = response.request();
    target.responses.push({
      status,
      method: request.method(),
      url: sanitizeUrl(response.url()),
      resourceType: request.resourceType(),
    });
    if (status < 400) return;
    target.httpIssues.push({
      status,
      method: request.method(),
      url: sanitizeUrl(response.url()),
      resourceType: request.resourceType(),
    });
  });
}

async function runRouteAudit(page, target, routes) {
  for (const route of routes) {
    const started = Date.now();
    const responseStart = target.responses.length;
    const expectedRedirectToLogin = route.authRequired && !target.hadAuthState;
    let gotoStatus = null;
    let error = null;
    try {
      const response = await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
      gotoStatus = response?.status() ?? null;
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(900);
    } catch (err) {
      error = sanitizeText(err instanceof Error ? err.message : String(err));
    }

    const finalUrl = page.url();
    const finalPath = pathFromUrl(finalUrl);
    const redirectedToLogin = /\/auth\/login/.test(finalPath);
    const screenshotPath = await screenshot(page, route.name);
    const signals = await collectSignals(page, route.signals);
    const metrics = await collectPageMetrics(page);
    const uiSnapshot = await collectUiSnapshot(page);
    const networkSummary = summarizeResponses(target.responses.slice(responseStart));
    const durationMs = Date.now() - started;
    const hasDevPanelSignals = signals.some((signal) =>
      ["Panel operador", "Account 360", "Ver cliente", "Detalle"].includes(signal.needle) && signal.found
    );

    const status = error
      ? "error"
      : expectedRedirectToLogin && redirectedToLogin
        ? "auth-redirect"
        : route.authRequired && target.hadAuthState && redirectedToLogin
          ? "unexpected-login-redirect"
        : route.name === "dev-cuentas" && target.hadAuthState && EXPECT_DEV && !hasDevPanelSignals
            ? "missing-dev-panel"
            : "ok";

    target.routes.push({
      ...route,
      finalPath: sanitizePath(finalPath),
      gotoStatus,
      status,
      screenshot: screenshotPath,
      durationMs,
      signals,
      metrics,
      uiSnapshot,
      networkSummary,
      error,
    });

    if (status === "unexpected-login-redirect") {
      target.findings.push({
        severity: "high",
        title: `Ruta autenticada redirige a login: ${route.name}`,
        detail: `${route.path} termino en ${sanitizePath(finalPath)} usando storageState.`,
        evidence: screenshotPath,
      });
    }
    if (status === "missing-dev-panel") {
      target.findings.push({
        severity: "high",
        title: "Genesys no ve el panel dev",
        detail: "/dev/cuentas no mostro senales suficientes de panel dev.",
        evidence: screenshotPath,
      });
    }
  }
}

async function runDevSpecificFlows(page, target) {
  if (!target.hadAuthState || !EXPECT_DEV) {
    target.businessChecks.push(check("dev-flow", "skipped", "Sin sesion dev esperada; no se entro a detalle ni modo cliente."));
    return;
  }

  const devRoute = target.routes.find((route) => route.name === "dev-cuentas");
  if (!devRoute || devRoute.status !== "ok") {
    target.businessChecks.push(check("dev-flow", "blocked", "No se pudo usar /dev/cuentas como punto de partida."));
    return;
  }

  await page.goto(`${BASE_URL}/dev/cuentas`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1000);

  const detailLink = page.locator('a[href^="/dev/cuentas/"]').first();
  if (await detailLink.count()) {
    const href = await detailLink.getAttribute("href");
    if (href) {
      await page.goto(`${BASE_URL}${href}`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(900);
      const screenshotPath = await screenshot(page, "dev-cuenta-detalle");
      const hasPriority = await includesText(page, "Prioridad");
      target.dynamicRoutes.push({
        name: "dev-cuenta-detalle",
        finalPath: sanitizePath(pathFromUrl(page.url())),
        screenshot: screenshotPath,
        status: hasPriority ? "ok" : "missing-priority",
      });
      target.businessChecks.push(check("detalle-cuenta", hasPriority ? "pass" : "warn", hasPriority ? "Detalle de cuenta carga con prioridad." : "Detalle carga sin senal de prioridad.", screenshotPath));
    }
  } else {
    target.businessChecks.push(check("detalle-cuenta", "blocked", "No hay link Detalle disponible en /dev/cuentas."));
  }

  await page.goto(`${BASE_URL}/dev/cuentas`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1000);
  const verCliente = page.getByRole("button", { name: /Ver cliente/i }).first();
  if (!(await verCliente.count())) {
    target.businessChecks.push(check("modo-cliente", "blocked", "No hay boton Ver cliente disponible."));
    return;
  }

  await verCliente.click().catch((error) => {
    target.businessChecks.push(check("modo-cliente", "fail", `Click Ver cliente fallo: ${sanitizeText(error.message)}`));
  });
  await page.waitForURL((url) => /\/massdte$/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const supportShot = await screenshot(page, "modo-cliente-massdte");
  const supportBanner = await includesText(page, "Modo soporte Genesys");
  target.businessChecks.push(check("modo-cliente-banner", supportBanner ? "pass" : "fail", supportBanner ? "Banner de modo soporte visible." : "No se encontro banner de modo soporte.", supportShot));

  if (supportBanner) {
    await probeReadOnlyBlocks(page, target);
    const volver = page.getByRole("button", { name: /Volver a dev/i }).first();
    if (await volver.count()) {
      await volver.click().catch(() => {});
      await page.waitForURL((url) => /\/dev\/cuentas$/.test(url.pathname), { timeout: 12000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const backToDev = /\/dev\/cuentas/.test(pathFromUrl(page.url()));
      target.businessChecks.push(check("modo-cliente-volver", backToDev ? "pass" : "fail", backToDev ? "Volver a dev retorna a /dev/cuentas." : `Volver a dev termino en ${sanitizePath(pathFromUrl(page.url()))}.`));
    } else {
      target.businessChecks.push(check("modo-cliente-volver", "fail", "No se encontro boton Volver a dev."));
    }
  }
}

async function probeReadOnlyBlocks(page, target) {
  const probes = [
    {
      name: "support-block-upload",
      url: "/api/subir-procesar",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "audit.txt", base64: "YQ==", tipo: "txt", mime: "text/plain" }),
      },
    },
    {
      name: "support-block-checkout",
      url: "/api/pagos/checkout",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "persona_adicional" }),
      },
    },
    {
      name: "support-block-emission-job",
      url: "/api/emision/jobs",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "sii_local", tipo_dte: 39, origen: "audit", expected_emisor_rut: "11111111-1" }),
      },
    },
    {
      name: "support-block-emitir-boleta",
      url: "/api/intermediaria/emitir-boleta",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit: true }),
      },
    },
  ];

  for (const probe of probes) {
    const result = await page.evaluate(async ({ url, init }) => {
      const response = await fetch(url, init);
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return {
        status: response.status,
        ok: response.ok,
        error: parsed?.error ?? null,
        detalle: parsed?.detalle ?? null,
      };
    }, probe).catch((error) => ({ status: 0, ok: false, error: "EVALUATE_FAILED", detalle: sanitizeText(error.message) }));

    const passed = result.status === 403 && result.error === "DEV_SUPPORT_READ_ONLY";
    target.businessChecks.push(check(
      probe.name,
      passed ? "pass" : "fail",
      passed
        ? "Escritura bloqueada con DEV_SUPPORT_READ_ONLY."
        : `Respuesta inesperada: HTTP ${result.status}, error ${sanitizeText(result.error ?? "sin error")}.`,
    ));
  }
}

async function runMassdteBusinessSignals(page, target) {
  if (!target.hadAuthState) {
    target.businessChecks.push(check("app-business-signals", "skipped", "Sin sesion autenticada."));
    return;
  }

  await page.goto(`${BASE_URL}/massdte`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(1200);

  const textSignals = {
    equipo: await includesText(page, "Equipo"),
    usoDelMes: await includesText(page, "Uso del mes"),
    cambiarEmpresa: await includesText(page, "Cambiar empresa"),
    emitirBloqueado: await includesText(page, "Emitir bloqueado"),
  };

  target.businessChecks.push(check("uso-del-mes", textSignals.usoDelMes ? "pass" : "warn", textSignals.usoDelMes ? "Contador Uso del mes visible." : "No se encontro Uso del mes en /massdte."));

  const lockStatus = await page.evaluate(async () => {
    const response = await fetch("/api/emision/jobs", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }).catch((error) => ({ status: 0, body: { error: sanitizeText(error.message) } }));

  if (lockStatus.status === 200 && lockStatus.body?.ok) {
    const businessMode = lockStatus.body.business_mode === true;
    target.businessChecks.push(check("plan-equipo-signal", businessMode === textSignals.equipo ? "pass" : "fail", businessMode
      ? textSignals.equipo
        ? "Cuenta Business: panel Equipo visible."
        : "Cuenta Business: no se encontro Equipo."
      : textSignals.equipo
        ? "Cuenta no Business: aparece senal Equipo."
        : "Cuenta no Business: Equipo oculto."));

    if (lockStatus.body.locked) {
      target.businessChecks.push(check("lock-emision-visible", textSignals.emitirBloqueado ? "pass" : "fail", textSignals.emitirBloqueado ? "Hay lock activo y la UI muestra emision bloqueada." : "Hay lock activo pero no se encontro Emitir bloqueado."));
    } else {
      target.businessChecks.push(check("lock-emision-visible", "skipped", "No hay lock activo para validar bloqueo visual."));
    }
  } else {
    target.businessChecks.push(check("emission-lock-api", "warn", `GET /api/emision/jobs devolvio HTTP ${lockStatus.status}.`));
  }
}

async function runNonDevCheck(browser, target, statePath) {
  if (!fs.existsSync(statePath)) {
    target.businessChecks.push(check("nondev-dev-panel", "blocked", `AUDIT_NONDEV_STATE no existe: ${statePath}`));
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: statePath });
  wireContext(context, target);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/dev/cuentas`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1200);
  const finalPath = sanitizePath(pathFromUrl(page.url()));
  const hasPanel = await includesText(page, "Panel operador");
  const shot = await screenshot(page, "nondev-dev-cuentas");
  target.businessChecks.push(check("nondev-dev-panel", !hasPanel ? "pass" : "fail", !hasPanel ? `Sesion no dev no ve panel dev; termino en ${finalPath}.` : "Sesion no dev ve Panel operador.", shot));
  await context.close();
}

async function collectStorageSummary(context, target) {
  const cookies = await context.cookies(BASE_URL).catch(() => []);
  target.storage.push({
    scope: "cookies",
    names: cookies.map((cookie) => cookie.name).sort(),
  });
}

async function collectSignals(page, needles) {
  const text = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  return needles.map((needle) => ({ needle, found: text.includes(needle) }));
}

async function includesText(page, needle) {
  const text = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  return text.toLocaleLowerCase("es-CL").includes(needle.toLocaleLowerCase("es-CL"));
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
    const storageKeys = {
      localStorage: Object.keys(localStorage ?? {}).sort(),
      sessionStorage: Object.keys(sessionStorage ?? {}).sort(),
    };
    return {
      title: document.title,
      h1,
      resourceCount: resources.length,
      transferSizeKb: Math.round(resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) / 1024),
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
      storageKeys,
    };
  }).catch((error) => ({
    title: "",
    h1: "",
    resourceCount: 0,
    transferSizeKb: 0,
    domContentLoadedMs: null,
    loadEventMs: null,
    storageKeys: { localStorage: [], sessionStorage: [] },
    error: sanitizeText(error.message),
  }));
}

async function collectUiSnapshot(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const text = (element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const all = (selector) => Array.from(document.querySelectorAll(selector));
    const visibleButtons = all("button").filter(visible);
    const visibleLinks = all("a[href]").filter(visible);
    const inputs = all("input, textarea, select").filter(visible);
    const labelNeedles = [
      "Account 360",
      "Agregar persona",
      "Buscar",
      "Cambiar empresa",
      "Contratar con Mercado Pago",
      "Detalle",
      "Diagnostico",
      "Emitir",
      "Emitir bloqueado",
      "Empresa",
      "Equipo",
      "Folios CAF",
      "Limpiar",
      "Modo soporte Genesys",
      "Reporte RCV",
      "Revisar",
      "Subir",
      "Uso del mes",
      "Ver cliente",
      "Volver a dev",
    ];
    const bodyText = text(document.body);
    const inputTypes = inputs.reduce((acc, element) => {
      const tag = element.tagName.toLowerCase();
      const type = tag === "input" ? (element.getAttribute("type") || "text").toLowerCase() : tag;
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});
    const buttonLabels = visibleButtons
      .map(text)
      .filter((label) => labelNeedles.some((needle) => label.includes(needle)))
      .slice(0, 30);
    const linkLabels = visibleLinks
      .map(text)
      .filter((label) => labelNeedles.some((needle) => label.includes(needle)))
      .slice(0, 30);

    return {
      visibleTextChars: bodyText.length,
      scrollHeight: Math.round(document.documentElement.scrollHeight),
      viewportHeight: Math.round(window.innerHeight),
      counts: {
        headings: all("h1,h2,h3").filter(visible).length,
        h1: all("h1").filter(visible).length,
        sections: all("section").filter(visible).length,
        main: all("main").filter(visible).length,
        forms: all("form").filter(visible).length,
        buttons: visibleButtons.length,
        disabledButtons: visibleButtons.filter((button) => button.disabled).length,
        links: visibleLinks.length,
        inputs: inputs.length,
        images: all("img").filter(visible).length,
        imagesWithoutAlt: all("img").filter((img) => visible(img) && !img.getAttribute("alt")).length,
        tables: all("table").filter(visible).length,
        dialogs: all("[role='dialog'], dialog").filter(visible).length,
        ariaLive: all("[aria-live]").filter(visible).length,
      },
      inputTypes,
      allowedButtonLabels: [...new Set(buttonLabels)],
      allowedLinkLabels: [...new Set(linkLabels)],
      allowedTextHits: labelNeedles.filter((needle) => bodyText.includes(needle)),
    };
  }).catch((error) => ({
    visibleTextChars: 0,
    scrollHeight: 0,
    viewportHeight: 0,
    counts: {},
    inputTypes: {},
    allowedButtonLabels: [],
    allowedLinkLabels: [],
    allowedTextHits: [],
    error: sanitizeText(error.message),
  }));
}

function summarizeResponses(responses) {
  const status = {};
  const methods = {};
  const resourceTypes = {};
  const endpoints = {};
  for (const response of responses) {
    const statusKey = String(response.status);
    status[statusKey] = (status[statusKey] ?? 0) + 1;
    methods[response.method] = (methods[response.method] ?? 0) + 1;
    resourceTypes[response.resourceType] = (resourceTypes[response.resourceType] ?? 0) + 1;
    const endpoint = endpointKey(response.url);
    endpoints[endpoint] = (endpoints[endpoint] ?? 0) + 1;
  }
  return {
    total: responses.length,
    status,
    methods,
    resourceTypes,
    endpoints: Object.entries(endpoints)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 25)
      .map(([url, count]) => ({ url, count })),
  };
}

async function screenshot(page, name) {
  const fileName = `${String(audit.routes.length + audit.dynamicRoutes.length + 1).padStart(2, "0")}-${slug(name)}.png`;
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

async function runOptionalLighthouse(target) {
  let lighthouse;
  let chromeLauncher;
  try {
    lighthouse = (await import("lighthouse")).default;
    chromeLauncher = await import("chrome-launcher");
  } catch {
    target.lighthouse.push({
      status: "skipped",
      reason: "El paquete lighthouse no esta instalado localmente. Instalarlo o usar Chrome DevTools manualmente para esta medicion.",
    });
    return;
  }

  const urls = [`${BASE_URL}/massdte`, `${BASE_URL}/dev/cuentas`];
  for (const url of urls) {
    let chrome;
    try {
      chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--disable-gpu"] });
      const result = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        onlyCategories: ["performance", "accessibility", "best-practices"],
      });
      const categories = result?.lhr?.categories ?? {};
      target.lighthouse.push({
        status: "ok",
        url: sanitizeUrl(url),
        performance: score(categories.performance?.score),
        accessibility: score(categories.accessibility?.score),
        bestPractices: score(categories["best-practices"]?.score),
      });
    } catch (error) {
      target.lighthouse.push({
        status: "error",
        url: sanitizeUrl(url),
        reason: sanitizeText(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      await chrome?.kill().catch(() => {});
    }
  }
}

function score(value) {
  return typeof value === "number" ? Math.round(value * 100) : null;
}

async function classifyFindings(target) {
  const uniqueConsoleErrors = uniqueBy(
    target.console.filter((item) => item.type === "error" && !isExpectedConsoleError(item, target)),
    (item) => `${item.url}:${item.text}`,
  );
  const uniquePageErrors = uniqueBy(target.pageErrors, (item) => `${item.url}:${item.text}`);
  const uniqueFailed = uniqueBy(
    target.failedRequests.filter((item) => !isExpectedRequestFailure(item)),
    (item) => `${item.method}:${item.url}:${item.failure}`,
  );
  const http5xx = target.httpIssues.filter((item) => item.status >= 500);
  const http4xx = target.httpIssues.filter((item) => item.status >= 400 && item.status < 500 && !isExpectedHttpIssue(item));
  const failedBusiness = target.businessChecks.filter((item) => item.status === "fail");

  if (uniquePageErrors.length > 0) {
    target.findings.push({
      severity: "high",
      title: "Page errors en navegador",
      detail: `${uniquePageErrors.length} error(es) no capturados en runtime.`,
      evidence: uniquePageErrors.slice(0, 3).map((item) => `${item.url} :: ${item.text}`).join("\n"),
    });
  }
  if (uniqueConsoleErrors.length > 0) {
    target.findings.push({
      severity: "medium",
      title: "Console errors",
      detail: `${uniqueConsoleErrors.length} console.error distinto(s).`,
      evidence: uniqueConsoleErrors.slice(0, 5).map((item) => `${item.url} :: ${item.text}`).join("\n"),
    });
  }
  if (uniqueFailed.length > 0) {
    target.findings.push({
      severity: "medium",
      title: "Network request failures",
      detail: `${uniqueFailed.length} request(s) fallaron a nivel red.`,
      evidence: uniqueFailed.slice(0, 5).map((item) => `${item.method} ${item.url} :: ${item.failure}`).join("\n"),
    });
  }
  if (http5xx.length > 0) {
    target.findings.push({
      severity: "high",
      title: "HTTP 5xx durante auditoria",
      detail: `${http5xx.length} respuesta(s) 5xx detectadas.`,
      evidence: http5xx.slice(0, 5).map((item) => `${item.status} ${item.method} ${item.url}`).join("\n"),
    });
  }
  if (http4xx.length > 0 && target.hadAuthState) {
    target.findings.push({
      severity: "medium",
      title: "HTTP 4xx no clasificados",
      detail: `${http4xx.length} respuesta(s) 4xx detectadas con sesion autenticada.`,
      evidence: http4xx.slice(0, 5).map((item) => `${item.status} ${item.method} ${item.url}`).join("\n"),
    });
  }
  if (failedBusiness.length > 0) {
    target.findings.push({
      severity: "high",
      title: "Reglas de negocio fallidas",
      detail: `${failedBusiness.length} check(s) de reglas de negocio fallaron.`,
      evidence: failedBusiness.map((item) => `${item.name}: ${item.detail}`).join("\n"),
    });
  }
}

function isExpectedAuthIssue(item) {
  return !audit.hadAuthState && (item.status === 401 || item.status === 403 || /\/auth\/login/.test(item.url));
}

function isExpectedHttpIssue(item) {
  return isExpectedAuthIssue(item) || isExpectedSupportReadOnlyProbe(item);
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

function isExpectedSupportReadOnlyProbe(item) {
  if (item.status !== 403 || item.method !== "POST") return false;
  const path = pathFromUrl(item.url);
  return [
    "/api/subir-procesar",
    "/api/pagos/checkout",
    "/api/emision/jobs",
    "/api/intermediaria/emitir-boleta",
  ].includes(path);
}

function isExpectedConsoleError(item, target) {
  if (!/Failed to load resource: the server responded with a status of 403/i.test(item.text)) return false;
  return target.httpIssues.some(isExpectedSupportReadOnlyProbe);
}

async function writeReport() {
  const status = audit.findings.some((finding) => finding.severity === "blocked")
    ? "blocked"
    : audit.findings.some((finding) => finding.severity === "high")
      ? "open"
      : "done";
  const expectedFailedRequests = audit.failedRequests.filter(isExpectedRequestFailure);
  const unexpectedFailedRequests = audit.failedRequests.filter((item) => !isExpectedRequestFailure(item));

  const lines = [
    "---",
    "kind: run",
    `status: ${status}`,
    `created_at: ${startedAt.toISOString()}`,
    "tags: [audit, devtools, playwright, massdte]",
    "---",
    "",
    "# MassDTE DevTools Audit",
    "",
    "## Trigger",
    "",
    "Auditoria real de app con Playwright como reproductor verificable y Chrome DevTools MCP como inspector interactivo configurado localmente. La extension SII queda fuera del alcance.",
    "",
    "## Run",
    "",
    `- Base URL: ${BASE_URL}`,
    `- Auth source: ${audit.authSource}`,
    `- Storage state path: ${audit.hadAuthState ? STATE_PATH : "no disponible"}`,
    `- Screenshots: ${screenshotDir}`,
    `- Report: ${reportPath}`,
    `- Base status: ${audit.baseStatus ?? "n/a"}`,
    "",
    "## Summary",
    "",
    `- Routes visited: ${audit.routes.length + audit.dynamicRoutes.length}`,
    `- Business checks: ${audit.businessChecks.length}`,
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

  lines.push("", "## Routes", "");
  lines.push("| Route | Status | Final path | HTTP | ms | Screenshot | Signals |");
  lines.push("|---|---|---|---:|---:|---|---|");
  for (const route of audit.routes) {
    lines.push(`| ${route.name} | ${route.status} | ${route.finalPath} | ${route.gotoStatus ?? ""} | ${route.durationMs ?? ""} | ${route.screenshot} | ${formatSignals(route.signals)} |`);
  }
  for (const route of audit.dynamicRoutes) {
    lines.push(`| ${route.name} | ${route.status} | ${route.finalPath} |  |  | ${route.screenshot} | dynamic |`);
  }

  lines.push("", "## Route Deep Detail", "");
  for (const route of audit.routes) {
    lines.push(`### ${route.name}`);
    lines.push(`- Final path: ${route.finalPath}`);
    lines.push(`- Status: ${route.status}`);
    lines.push(`- Screenshot: ${route.screenshot}`);
    lines.push(`- Page title: ${escapeCell(route.metrics?.title ?? "")}`);
    lines.push(`- H1: ${escapeCell(route.metrics?.h1 ?? "")}`);
    lines.push(`- DOMContentLoaded ms: ${route.metrics?.domContentLoadedMs ?? "n/a"}`);
    lines.push(`- Load event ms: ${route.metrics?.loadEventMs ?? "n/a"}`);
    lines.push(`- Resource count from Performance API: ${route.metrics?.resourceCount ?? "n/a"}`);
    lines.push(`- Transfer size KB from Performance API: ${route.metrics?.transferSizeKb ?? "n/a"}`);
    lines.push(`- Visible text chars: ${route.uiSnapshot?.visibleTextChars ?? "n/a"}`);
    lines.push(`- Scroll height / viewport: ${route.uiSnapshot?.scrollHeight ?? "n/a"} / ${route.uiSnapshot?.viewportHeight ?? "n/a"}`);
    lines.push(`- UI counts: ${formatObject(route.uiSnapshot?.counts ?? {})}`);
    lines.push(`- Input types: ${formatObject(route.uiSnapshot?.inputTypes ?? {})}`);
    lines.push(`- Allowed text hits: ${formatList(route.uiSnapshot?.allowedTextHits ?? [])}`);
    lines.push(`- Allowed button labels: ${formatList(route.uiSnapshot?.allowedButtonLabels ?? [])}`);
    lines.push(`- Allowed link labels: ${formatList(route.uiSnapshot?.allowedLinkLabels ?? [])}`);
    lines.push(`- Storage keys: local=${formatList(route.metrics?.storageKeys?.localStorage ?? [])}; session=${formatList(route.metrics?.storageKeys?.sessionStorage ?? [])}`);
    lines.push(`- Network total responses: ${route.networkSummary?.total ?? 0}`);
    lines.push(`- Network status counts: ${formatObject(route.networkSummary?.status ?? {})}`);
    lines.push(`- Network method counts: ${formatObject(route.networkSummary?.methods ?? {})}`);
    lines.push(`- Network resource types: ${formatObject(route.networkSummary?.resourceTypes ?? {})}`);
    lines.push("- Top endpoints:");
    if (!route.networkSummary?.endpoints?.length) {
      lines.push("  - n/a");
    } else {
      for (const endpoint of route.networkSummary.endpoints) {
        lines.push(`  - ${endpoint.count}x ${endpoint.url}`);
      }
    }
    lines.push("");
  }

  lines.push("", "## Business Checks", "");
  lines.push("| Check | Status | Detail | Evidence |");
  lines.push("|---|---|---|---|");
  for (const item of audit.businessChecks) {
    lines.push(`| ${item.name} | ${item.status} | ${escapeCell(item.detail)} | ${item.evidence ?? ""} |`);
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
      .map((item) => `- FAILED ${item.method} ${item.url} :: ${item.failure}${isExpectedRequestFailure(item) ? " (esperado: navegación Next cancelada)" : ""}`),
    ...uniqueBy(audit.httpIssues, (item) => `${item.status}:${item.method}:${item.url}`).map((item) => `- HTTP ${item.status} ${item.method} ${item.url}${isExpectedSupportReadOnlyProbe(item) ? " (esperado: modo soporte read-only)" : ""}`),
  ].slice(0, 40);
  if (networkRows.length === 0) lines.push("- Sin fallos de red ni HTTP 4xx/5xx registrados.");
  lines.push(...networkRows);

  lines.push("", "### Network Totals");
  const globalNetwork = summarizeResponses(audit.responses);
  lines.push(`- Total responses: ${globalNetwork.total}`);
  lines.push(`- Status counts: ${formatObject(globalNetwork.status)}`);
  lines.push(`- Method counts: ${formatObject(globalNetwork.methods)}`);
  lines.push(`- Resource types: ${formatObject(globalNetwork.resourceTypes)}`);

  lines.push("", "## Storage Privacy Snapshot", "");
  if (audit.storage.length === 0) lines.push("- Sin snapshot de storage.");
  for (const storage of audit.storage) {
    lines.push(`- ${storage.scope}: ${storage.names.length ? storage.names.join(", ") : "(sin cookies)"}`);
  }
  lines.push("- Valores de cookies, localStorage y sessionStorage no se escriben en este reporte.");

  lines.push("", "## Lighthouse", "");
  if (audit.lighthouse.length === 0) lines.push("- No solicitado.");
  for (const item of audit.lighthouse) {
    if (item.status === "ok") {
      lines.push(`- ${item.url}: performance ${item.performance}, accessibility ${item.accessibility}, best-practices ${item.bestPractices}`);
    } else {
      lines.push(`- ${item.status}: ${item.reason}${item.url ? ` (${item.url})` : ""}`);
    }
  }

  lines.push("", "## Validation", "");
  lines.push("- Script ejecutado localmente contra la app en Chrome/Playwright.");
  if (!audit.hadAuthState) {
    lines.push("- Validacion autenticada pendiente: ejecutar captura manual o login por env y repetir.");
  }
  lines.push("- No se probo extension SII ni flujos reales contra SII.");
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  lines.push(`- ${startedAt.toISOString()}: corrida generada por scripts/audit-app-devtools.mjs.`);
  lines.push("");

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function formatEvidence(evidence) {
  if (Array.isArray(evidence)) return evidence.map(escapeCell).join("; ");
  return String(evidence).includes("\n") ? `\n${evidence}` : evidence;
}

function formatSignals(signals) {
  return signals
    .map((signal) => `${signal.found ? "yes" : "no"}:${signal.needle}`)
    .join("<br>");
}

function formatObject(value) {
  const entries = Object.entries(value ?? {});
  if (entries.length === 0) return "n/a";
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

function formatList(value) {
  if (!value || value.length === 0) return "n/a";
  return value.map((item) => escapeCell(item)).join(", ");
}

function endpointKey(raw) {
  try {
    const url = new URL(raw);
    const pathname = sanitizePath(url.pathname)
      .replace(/\/\d{4,}(?=\/|$)/g, "/:num")
      .replace(/\/[A-Za-z0-9_-]{18,}(?=\/|$)/g, "/:id");
    const params = new URLSearchParams(url.search);
    for (const key of Array.from(params.keys())) {
      if (/token|secret|password|pass|key|code|access|refresh|credential/i.test(key)) {
        params.set(key, "[redacted]");
      } else {
        params.set(key, ":value");
      }
    }
    const qs = params.toString();
    return `${pathname}${qs ? `?${qs}` : ""}`;
  } catch {
    return sanitizeText(raw);
  }
}

function check(name, status, detail, evidence = "") {
  return { name, status, detail, evidence };
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
    .slice(0, 400);
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
