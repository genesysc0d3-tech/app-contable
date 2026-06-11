// Inspección quirúrgica del campo "Detalle" (glosa) del modal e-Boleta. NO emite.
// Postea job con allow_final_emit=false, el bot abre/llena el modal y pausa;
// luego ESTE script activa el toggle Detalle y vuelca el campo revelado.
// Uso: node scripts/sii-detalle-inspect.mjs [puerto] [PIN] [emisorRUT]
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PORT = process.argv[2] || "3001";
const PIN = process.argv[3] || "";
const EMISOR = (process.argv[4] || "").trim();
const BASE = `http://localhost:${PORT}`;
const PROFILE = "/tmp/sii-real-test-profile";
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1380, height: 880 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--deny-permission-prompts"],
});
const siiPages = [];
ctx.on("page", (pg) => pg.on("load", () => { if (/sii\.cl/.test(pg.url())) siiPages.push(pg); }));
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (m) => { const t = m.text(); if (/\[bridge\].*STATUS/.test(t)) log(`  ↪ ${t.slice(0, 120)}`); });
await page.addInitScript(() => window.addEventListener("message", (e) => {
  const d = e.data; if (d && d.source === "app-contable-extension") console.log(`[bridge] ${d.type} :: ${d.status ?? ""}`);
}));
await page.goto(`${BASE}/massdte`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2500);

async function getExtId() {
  for (let i = 0; i < 14; i++) { const s = ctx.serviceWorkers(); if (s.length) return new URL(s[0].url()).host; await new Promise(r => setTimeout(r, 500)); }
  return null;
}
const extId = await getExtId();
if (extId && PIN) {
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await opt.waitForTimeout(700); await opt.fill("#sii-pin", PIN).catch(() => {}); await opt.click("#unlock-sii-vault").catch(() => {});
  await opt.waitForTimeout(1600); log("🔓 bóveda desbloqueada"); await opt.close();
}

log("→ job sin emitir (allow_final_emit=false), sin glosa automática");
await page.evaluate((emisor) => {
  window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_BOLETA_JOB", protocol_version: 1, job: {
    job_id: `detalle-${Date.now()}`, expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
    empresa_id: "test", emisor_rut: emisor, tipo_dte: 41, fecha_emision: new Date().toISOString().slice(0, 10),
    receptor: {}, detalles: [{ nombre: "PRUEBA GLOSA", cantidad: 1, monto_total: 1 }],
    totales: { monto_total: 1, monto_neto: 0, iva: 0, monto_exento: 1 },
    learn_only: false, auto_emit: true, allow_final_emit: false, payment_method: "Efectivo", confirmation_required: false,
  }}, window.location.origin);
}, EMISOR);

// Esperar a que el modal esté abierto y lleno (overlay PAUSED).
let sii = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(2000);
  sii = siiPages[siiPages.length - 1];
  if (!sii || sii.isClosed()) continue;
  const paused = await sii.evaluate(() => {
    const dlg = document.querySelector(".v-dialog.v-dialog--active");
    const o = document.getElementById("app-contable-sii-worker-overlay");
    return Boolean(dlg) && /Formulario listo|autorizacion explicita|No escribas/.test(o?.innerText || "");
  }).catch(() => false);
  if (paused) break;
}
if (!sii) { log("no hubo ventana SII"); await ctx.close(); process.exit(1); }

// Activar el toggle Detalle desde Playwright y volcar el campo revelado.
const dump = await sii.evaluate(async () => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const dlg = document.querySelector(".v-dialog.v-dialog--active");
  if (!dlg) return { error: "no dialog" };
  // Encontrar la fila/switch "Detalle".
  const rows = Array.from(dlg.querySelectorAll(".v-input--selection-controls, .v-input--switch, .v-input"));
  const detRow = rows.find((r) => /detalle/i.test(norm(r.innerText)));
  const before = Array.from(dlg.querySelectorAll("input, textarea")).length;
  let toggled = false;
  if (detRow) {
    const clickable = detRow.querySelector(".v-input--selection-controls__ripple, .v-input--selection-controls__input, label") || detRow.querySelector("input") || detRow;
    clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    clickable.click();
    toggled = true;
  }
  await new Promise((r) => setTimeout(r, 700));
  const fields = Array.from(dlg.querySelectorAll("input, textarea")).map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.type || "",
    id: el.id || "",
    name: el.getAttribute("name") || "",
    placeholder: el.getAttribute("placeholder") || "",
    ariaLabel: el.getAttribute("aria-label") || "",
    maxlength: el.getAttribute("maxlength") || "",
    required: el.required || el.getAttribute("aria-required") || false,
    value: norm(el.value).slice(0, 40),
    visible: !!(el.offsetWidth || el.offsetHeight),
    nearText: norm((el.closest(".v-input") || el.parentElement)?.innerText).slice(0, 50),
  }));
  return { toggled, before, after: fields.length, fields };
});
console.log("DETALLE_DUMP_START");
console.log(JSON.stringify(dump, null, 2));
console.log("DETALLE_DUMP_END");
await sii.screenshot({ path: "/tmp/sii-test/detalle-inspect.png" }).catch(() => {});
await ctx.close();
