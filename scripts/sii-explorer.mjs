#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const START_URL = "https://eboleta.sii.cl/emitir/";
const ALLOWED_HOSTS = new Set(["eboleta.sii.cl"]);
const MAX_PAGES = Number(process.env.SII_EXPLORER_MAX_PAGES || 24);
const ARTIFACT_ROOT = process.env.SII_EXPLORER_OUTPUT || "artifacts/sii-explorer";
const PROFILE_DIR = process.env.SII_EXPLORER_PROFILE || ".sii-explorer-profile";
const AMOUNT_ONLY = process.env.SII_EXPLORER_AMOUNT_ONLY === "1";
const AMOUNT_TO_ENTER = String(process.env.SII_EXPLORER_AMOUNT || "").replace(/[^0-9]/g, "");
const CLICK_CALCULATOR_EMITIR = process.env.SII_EXPLORER_CLICK_CALCULATOR_EMITIR === "1";
const CLEAR_BEFORE_AMOUNT = process.env.SII_EXPLORER_CLEAR_BEFORE_AMOUNT === "1";
const SNAPSHOT_ONLY = process.env.SII_EXPLORER_SNAPSHOT_ONLY === "1";
const OPEN_FORM_SELECTS = process.env.SII_EXPLORER_OPEN_FORM_SELECTS === "1";
const PROBE_FORM_SECTIONS = process.env.SII_EXPLORER_PROBE_FORM_SECTIONS === "1";
const NETWORK_SCAN = process.env.SII_EXPLORER_NETWORK_SCAN === "1";
const NETWORK_RESPONSE_BODY = process.env.SII_EXPLORER_NETWORK_RESPONSE_BODY === "1";
const MAX_CAPTURED_BODY_CHARS = Number(process.env.SII_EXPLORER_MAX_BODY_CHARS || 6000);
const MAX_CAPTURED_RESPONSE_BYTES = Number(process.env.SII_EXPLORER_MAX_RESPONSE_BYTES || 200000);

const DANGEROUS_TEXT = [
  "EMITIR",
  "ENVIAR",
  "CONFIRMAR",
  "ACEPTAR",
  "SÍ",
  "FIRMAR",
  "PAGAR",
  "ELIMINAR",
  "BORRAR",
  "ANULAR",
  "ACTUALIZAR CLAVE",
  "INGRESAR",
  "VERIFICAR",
];

const SAFE_NAV_TEXT = [
  "MENU",
  "EMITIR BOLETA",
  "RESUMEN DE VENTAS DIARIAS",
  "USUARIOS",
  "CONTRIBUYENTE",
  "DOCUMENTOS EMITIDOS",
  "REPORTES",
  "CONSULTA",
  "AYUDA",
  "DISPOSITIVOS OFFLINE",
  "MENSAJERÍA",
  "MENSAJERIA",
];

const MENU_ITEMS = [
  "Emitir Boleta",
  "Resumen de ventas diarias",
  "Usuarios",
  "Contribuyente",
  "Dispositivos Offline",
  "Mensajería",
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitize(value) {
  return normalizeText(value)
    .replace(/[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-[0-9Kk]/g, "[RUT]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/([?&](?:code|state|token|access_token|id_token|csrf|sid|session)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/("(?:code|state|token|access_token|id_token|csrf|password|clave|secret|authorization|cookie)"\s*:\s*")[^"]+/gi, "$1[REDACTED]")
    .slice(0, 2000);
}

function sanitizeBody(value) {
  return sanitize(String(value || "").slice(0, MAX_CAPTURED_BODY_CHARS));
}

function sanitizeHeaders(headers) {
  const safe = {};
  const blocked = /authorization|cookie|set-cookie|x-csrf|csrf|token|secret|password|clave/i;
  for (const [key, value] of Object.entries(headers || {})) {
    safe[key] = blocked.test(key) ? "[REDACTED]" : sanitize(String(value));
  }
  return safe;
}

function isAllowedNetworkUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, START_URL);
    return url.protocol === "https:" && (/(^|\.)sii\.cl$/.test(url.hostname) || url.hostname === "eboleta.s3.amazonaws.com");
  } catch {
    return false;
  }
}

function shouldCaptureResource(type) {
  return ["document", "xhr", "fetch", "script"].includes(type);
}

function isAllowedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, START_URL);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function canonicalUrl(rawUrl) {
  const url = new URL(rawUrl, START_URL);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("token");
  return url.toString();
}

function isDangerousLabel(label) {
  const normalized = normalizeText(label).toUpperCase();
  return DANGEROUS_TEXT.some((danger) => normalized === danger || normalized.includes(danger));
}

function isSafeNavLabel(label) {
  const normalized = normalizeText(label).toUpperCase();
  return SAFE_NAV_TEXT.some((safe) => normalized === safe || normalized.includes(safe));
}

async function waitForEboletaReady(page) {
  console.log("Inicia sesion en la ventana de Chrome si SII lo pide. No presiones EMITIR.");
  console.log("El explorador continuara solo cuando detecte e-Boleta cargada.");

  const deadline = Date.now() + Number(process.env.SII_EXPLORER_LOGIN_TIMEOUT_MS || 10 * 60 * 1000);
  let ticks = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    ticks += 1;
    if (ticks % 8 === 0) console.log(`Esperando e-Boleta... URL actual: ${page.url()}`);
    const currentUrl = page.url();
    if (!isAllowedUrl(currentUrl)) continue;

    const ready = await page.evaluate(() => {
      const text = String(document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ");
      return /e-Boleta|Calculadora|Emitir Boleta|Resumen de ventas/i.test(text);
    }).catch(() => false);
    if (ready) return;
  }

  throw new Error("TIMEOUT_WAITING_FOR_EBOLETA_READY");
}

async function snapshot(page, label) {
  return page.evaluate(({ label, dangerousText }) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const cssPath = (element) => {
      if (!element || element === document.body) return "body";
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += `#${current.id}`;
          parts.unshift(part);
          break;
        }
        const classes = String(current.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        if (classes) part += `.${classes}`;
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const visibleText = (element) => normalize(element?.innerText || element?.textContent || "").slice(0, 180);
    const dangerous = (text) => dangerousText.some((item) => normalize(text).toUpperCase().includes(item));

    return {
      label,
      captured_at: new Date().toISOString(),
      url: location.href,
      title: document.title,
      headings: Array.from(document.querySelectorAll("h1, h2, h3, h4, legend, [role='heading']"))
        .map(visibleText)
        .filter(Boolean)
        .slice(0, 80),
      controls: Array.from(document.querySelectorAll("input, select, textarea"))
        .filter((control) => control instanceof HTMLElement)
        .map((control) => ({
          tag: control.tagName.toLowerCase(),
          type: control.getAttribute("type") || "",
          name: control.getAttribute("name") || "",
          id: control.id || "",
          context: normalize(control.closest(".v-input, .col, .row, label, form")?.innerText || control.parentElement?.innerText || "").slice(0, 260),
          placeholder: control.getAttribute("placeholder") || "",
          disabled: Boolean(control.disabled),
          required: Boolean(control.required),
          selector: cssPath(control),
        }))
        .slice(0, 120),
      actions: Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a, [role='button'], .v-list-item, .v-list-item--link, [tabindex]"))
        .filter((element) => element instanceof HTMLElement)
        .map((element) => {
          const text = visibleText(element) || element.getAttribute("value") || element.getAttribute("title") || element.getAttribute("aria-label") || "";
          const href = element.getAttribute("href") || "";
          return {
            tag: element.tagName.toLowerCase(),
            text,
            href,
            dangerous: dangerous(text),
            selector: cssPath(element),
          };
        })
        .filter((action) => action.text || action.href)
        .slice(0, 160),
      body_excerpt: normalize(document.body?.innerText || document.body?.textContent || "").slice(0, 2400),
    };
  }, { label, dangerousText: DANGEROUS_TEXT });
}

async function safeClickByLabel(page, label) {
  if (isDangerousLabel(label) || !isSafeNavLabel(label)) return false;
  const locator = page.locator("button, a, [role='button'], .v-list-item, .v-list-item--link, [tabindex]").filter({ hasText: label }).first();
  if (await locator.count() === 0) return false;
  await locator.click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(900);
  return true;
}

async function openMenu(page) {
  await safeClickByLabel(page, "menu");
  await page.waitForTimeout(350);
}

async function clickCalculatorButton(page, label) {
  const allowed = new Set(["delete", "backspace", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  if (!allowed.has(label)) return false;
  const box = await page.evaluate((wanted) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => normalize(element.innerText || element.textContent || element.getAttribute("value")) === normalize(wanted));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  }, label);
  if (!box) return false;
  console.log(`Click calculadora: ${label} (${Math.round(box.x)}, ${Math.round(box.y)})`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(350);
  return true;
}

async function clickCalculatorEmitir(page) {
  const beforeUrl = page.url();
  const box = await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => normalize(element.innerText || element.textContent || element.getAttribute("value")) === "EMITIR");
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  });
  if (!box) throw new Error("CALCULATOR_EMITIR_NOT_FOUND");
  console.log(`Click calculadora: EMITIR (${Math.round(box.x)}, ${Math.round(box.y)})`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(2500);
  const afterUrl = page.url();
  if (afterUrl === beforeUrl) {
    await page.waitForLoadState("domcontentloaded", { timeout: 2500 }).catch(() => undefined);
  }
}

async function enterCalculatorAmount(page, amount) {
  if (!amount) throw new Error("SII_EXPLORER_AMOUNT_REQUIRED");
  if (CLEAR_BEFORE_AMOUNT) await clickCalculatorButton(page, "delete");
  for (const digit of amount) {
    const clicked = await clickCalculatorButton(page, digit);
    if (!clicked) throw new Error(`CALCULATOR_DIGIT_NOT_FOUND_${digit}`);
  }
}

async function _clickTextBox(page, text) {
  const box = await page.evaluate((wanted) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
    const elements = Array.from(document.querySelectorAll(".v-input, .v-select__slot, .v-input__slot, [role='button'], div, button"));
    const element = elements.find((candidate) => normalize(candidate.innerText || candidate.textContent || "") === normalize(wanted)
      || normalize(candidate.innerText || candidate.textContent || "").includes(normalize(wanted)));
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, text);
  if (!box) return false;
  console.log(`Click texto: ${text} (${Math.round(box.x)}, ${Math.round(box.y)})`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(700);
  return true;
}

async function clickInDialogByText(page, text) {
  const box = await page.evaluate((wanted) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
    const dialog = document.querySelector(".v-dialog.v-dialog--active") || document.body;
    const candidates = Array.from(dialog.querySelectorAll("button, .v-input__slot, .v-select__slot, .v-expansion-panel-header, .v-card__title, .v-list-item, [role='button'], div"));
    const exact = candidates.find((element) => normalize(element.innerText || element.textContent || element.getAttribute("value")) === normalize(wanted));
    const partial = exact || candidates.find((element) => normalize(element.innerText || element.textContent || element.getAttribute("value")).includes(normalize(wanted)));
    if (!partial) return null;
    const rect = partial.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + Math.min(rect.width / 2, Math.max(12, rect.width - 12)), y: rect.top + rect.height / 2 };
  }, text);
  if (!box) return false;
  console.log(`Click modal: ${text} (${Math.round(box.x)}, ${Math.round(box.y)})`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
  return true;
}

async function clickSelectByVisibleValue(page, value) {
  const box = await page.evaluate((wanted) => {
    const normalize = (text) => String(text || "").replace(/\s+/g, " ").trim().toUpperCase();
    const dialog = document.querySelector(".v-dialog.v-dialog--active") || document.body;
    const slots = Array.from(dialog.querySelectorAll(".v-select__slot, .v-input__slot"));
    const slot = slots.find((element) => normalize(element.innerText || element.textContent || "").includes(normalize(wanted)));
    if (!slot) return null;
    const rect = slot.getBoundingClientRect();
    return { x: rect.right - 24, y: rect.top + rect.height / 2 };
  }, value);
  if (!box) return false;
  console.log(`Click select: ${value} (${Math.round(box.x)}, ${Math.round(box.y)})`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
  return true;
}

function sanitizeMap(map) {
  return {
    ...map,
    url: sanitize(map.url),
    title: sanitize(map.title),
    headings: map.headings.map(sanitize),
    controls: map.controls.map((control) => ({
      ...control,
      name: sanitize(control.name),
      id: sanitize(control.id),
      placeholder: sanitize(control.placeholder),
      selector: sanitize(control.selector),
    })),
    actions: map.actions.map((action) => ({
      ...action,
      text: sanitize(action.text),
      href: sanitize(action.href),
      selector: sanitize(action.selector),
    })),
    body_excerpt: sanitize(map.body_excerpt),
  };
}

function discoverUrls(map) {
  return map.actions
    .filter((action) => action.href && !action.dangerous)
    .map((action) => {
      try {
        return canonicalUrl(action.href);
      } catch {
        return null;
      }
    })
    .filter((url) => url && isAllowedUrl(url));
}

function toMarkdown(maps) {
  const lines = ["# SII e-Boleta Exploration", "", `Generated: ${new Date().toISOString()}`, ""];
  for (const map of maps) {
    lines.push(`## ${map.label}`);
    lines.push("");
    lines.push(`- URL: ${map.url}`);
    lines.push(`- Title: ${map.title}`);
    lines.push(`- Controls: ${map.controls.length}`);
    lines.push(`- Actions: ${map.actions.length}`);
    lines.push("");
    if (map.headings.length) {
      lines.push("Headings:");
      for (const heading of map.headings) lines.push(`- ${heading}`);
      lines.push("");
    }
    lines.push("Safe-looking actions:");
    for (const action of map.actions.filter((item) => !item.dangerous).slice(0, 40)) {
      lines.push(`- ${action.text || action.href} (${action.tag})`);
    }
    lines.push("");
    lines.push("Dangerous/blocked actions:");
    for (const action of map.actions.filter((item) => item.dangerous).slice(0, 40)) {
      lines.push(`- ${action.text || action.href} (${action.tag})`);
    }
    lines.push("");
    lines.push("Excerpt:");
    lines.push("");
    lines.push(map.body_excerpt || "N/A");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function networkToMarkdown(events) {
  const lines = ["# SII e-Boleta Network Exploration", "", `Generated: ${new Date().toISOString()}`, ""];
  for (const event of events) {
    lines.push(`## ${event.method || "GET"} ${event.url}`);
    lines.push("");
    lines.push(`- Type: ${event.resource_type || "unknown"}`);
    lines.push(`- Status: ${event.status ?? "pending"}`);
    lines.push(`- Request body: ${event.request_body ? "captured" : "none"}`);
    lines.push(`- Response body: ${event.response_body ? "captured" : "not captured"}`);
    if (event.request_body) {
      lines.push("", "Request body excerpt:", "", "```txt", event.request_body, "```");
    }
    if (event.response_body) {
      lines.push("", "Response body excerpt:", "", "```txt", event.response_body, "```");
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function attachNetworkCapture(page, networkEvents) {
  if (!NETWORK_SCAN) return;
  const requestIds = new WeakMap();
  let seq = 0;

  page.on("request", (request) => {
    if (!isAllowedNetworkUrl(request.url()) || !shouldCaptureResource(request.resourceType())) return;
    const id = `${Date.now()}-${seq += 1}`;
    requestIds.set(request, id);
    networkEvents.push({
      id,
      captured_at: new Date().toISOString(),
      phase: "request",
      url: sanitize(request.url()),
      method: request.method(),
      resource_type: request.resourceType(),
      headers: sanitizeHeaders(request.headers()),
      request_body: request.postData() ? sanitizeBody(request.postData()) : null,
      status: null,
      response_headers: null,
      response_body: null,
    });
  });

  page.on("response", async (response) => {
    const request = response.request();
    const id = requestIds.get(request);
    if (!id) return;
    const event = networkEvents.find((item) => item.id === id);
    if (!event) return;
    event.status = response.status();
    event.response_headers = sanitizeHeaders(response.headers());

    const contentType = response.headers()["content-type"] || "";
    const contentLength = Number(response.headers()["content-length"] || 0);
    const canCaptureBody = NETWORK_RESPONSE_BODY && /json|text|xml|javascript|html/i.test(contentType) && (!contentLength || contentLength <= MAX_CAPTURED_RESPONSE_BYTES);
    if (!canCaptureBody) return;
    try {
      event.response_body = sanitizeBody(await response.text());
    } catch {
      event.response_body = "[UNREADABLE_RESPONSE_BODY]";
    }
  });
}

async function writeExplorationArtifacts(outDir, payload, maps, networkEvents) {
  const jsonPath = path.join(outDir, "site-map.json");
  const mdPath = path.join(outDir, "site-map.md");
  await writeFile(jsonPath, JSON.stringify({ ...payload, maps }, null, 2));
  await writeFile(mdPath, toMarkdown(maps));

  if (NETWORK_SCAN) {
    const networkJsonPath = path.join(outDir, "network-map.json");
    const networkMdPath = path.join(outDir, "network-map.md");
    await writeFile(networkJsonPath, JSON.stringify({ ...payload, network_events: networkEvents }, null, 2));
    await writeFile(networkMdPath, networkToMarkdown(networkEvents));
    return { jsonPath, mdPath, networkJsonPath, networkMdPath };
  }

  return { jsonPath, mdPath, networkJsonPath: null, networkMdPath: null };
}

function logArtifacts(label, artifacts) {
  const lines = [`${label}:`, `- ${artifacts.jsonPath}`, `- ${artifacts.mdPath}`];
  if (artifacts.networkJsonPath && artifacts.networkMdPath) {
    lines.push(`- ${artifacts.networkJsonPath}`, `- ${artifacts.networkMdPath}`);
  }
  console.log(lines.join("\n"));
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(ARTIFACT_ROOT, runId);
  await mkdir(outDir, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1360, height: 900 },
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(3500);

  const maps = [];
  const networkEvents = [];
  const queue = [START_URL];
  const visited = new Set();
  attachNetworkCapture(page, networkEvents);

  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  await waitForEboletaReady(page);

  if (SNAPSHOT_ONLY) {
    const map = sanitizeMap(await snapshot(page, "current-page"));
    maps.push(map);
    const artifacts = await writeExplorationArtifacts(outDir, { start_url: START_URL, mode: "snapshot_only", network_scan: NETWORK_SCAN }, maps, networkEvents);
    logArtifacts("SII snapshot saved", artifacts);
    await context.close();
    return;
  }

  if (AMOUNT_ONLY) {
    console.log(`Ingresando monto ${AMOUNT_TO_ENTER} en calculadora...`);
    await enterCalculatorAmount(page, AMOUNT_TO_ENTER);
    await page.waitForTimeout(1000);
    maps.push(sanitizeMap(await snapshot(page, `amount-${AMOUNT_TO_ENTER}-calculator`)));

    if (CLICK_CALCULATOR_EMITIR) {
      console.log("Presionando EMITIR de calculadora para abrir formulario siguiente...");
      await clickCalculatorEmitir(page);
      maps.push(sanitizeMap(await snapshot(page, `amount-${AMOUNT_TO_ENTER}-after-calculator-emitir`)));

      if (OPEN_FORM_SELECTS) {
        for (const label of ["Boleta afecta", "Elija método de pago", "COLON 141"]) {
          const clicked = await clickSelectByVisibleValue(page, label);
          if (!clicked) continue;
          maps.push(sanitizeMap(await snapshot(page, `form-select-${label}`)));
          await page.keyboard.press("Escape").catch(() => undefined);
          await page.waitForTimeout(350);
        }
      }

      if (PROBE_FORM_SECTIONS) {
        for (const label of ["Receptor", "Detalle", "Vendedor"] ) {
          const clicked = await clickInDialogByText(page, label);
          if (!clicked) continue;
          maps.push(sanitizeMap(await snapshot(page, `form-section-${label}`)));
        }
      }
    }

    const artifacts = await writeExplorationArtifacts(outDir, {
      start_url: START_URL,
      mode: "amount_only",
      amount: AMOUNT_TO_ENTER,
      clicked_calculator_emitir: CLICK_CALCULATOR_EMITIR,
      network_scan: NETWORK_SCAN,
    }, maps, networkEvents);

    logArtifacts("SII amount inspection saved", artifacts);
    await context.close();
    return;
  }

  await openMenu(page);

  while (queue.length && maps.length < MAX_PAGES) {
    const nextUrl = queue.shift();
    if (!nextUrl || visited.has(nextUrl) || !isAllowedUrl(nextUrl)) continue;
    visited.add(nextUrl);

    await page.goto(nextUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(1600);
    await openMenu(page);

    const map = sanitizeMap(await snapshot(page, `page-${maps.length + 1}`));
    maps.push(map);

    for (const discovered of discoverUrls(map)) {
      if (!visited.has(discovered) && queue.length < MAX_PAGES * 2) queue.push(discovered);
    }
  }

  for (const label of MENU_ITEMS) {
    if (maps.length >= MAX_PAGES) break;
    await openMenu(page);
    const clicked = await safeClickByLabel(page, label);
    if (!clicked) continue;
    await page.waitForTimeout(1600);
    await openMenu(page);
    const key = `${label}:${canonicalUrl(page.url())}`;
    if (visited.has(key)) continue;
    visited.add(key);
    maps.push(sanitizeMap(await snapshot(page, `menu-${label}`)));
  }

  const artifacts = await writeExplorationArtifacts(outDir, { start_url: START_URL, network_scan: NETWORK_SCAN }, maps, networkEvents);

  logArtifacts("SII exploration saved", artifacts);
  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
