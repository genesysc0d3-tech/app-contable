// Driver de prueba real SII: lanza Chromium con la extensión Motor Local
// sobre el perfil persistente (login de la app sobrevive) y MANEJA el flujo:
// desbloquea la bóveda (PIN por arg) → EMITIR BOLETA ÚNICA exenta $1 con glosa
// → Emitir en SII → observa la ventana SII (autologin) → captura folio + PDF.
//
// Uso: node scripts/sii-real-drive.mjs [puerto] [PIN]
// El PIN NO se guarda en el archivo; se pasa por la línea de comandos.
// Emite una boleta REAL al SII (autorizado: exenta $1, permiso del contador).
import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PORT = process.argv[2] || "3001";
const PIN = process.argv[3] || "";
const BASE = `http://localhost:${PORT}`;
const PROFILE = "/tmp/sii-real-test-profile";
const SHOTS = "/tmp/sii-test";
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
let shotN = 0;
async function shot(pg, tag) {
  try { await pg.screenshot({ path: `${SHOTS}/${String(++shotN).padStart(2, "0")}-${tag}.png` }); log(`📸 ${tag}`); } catch {}
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1380, height: 880 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--deny-permission-prompts"],
});

const siiPages = [];
ctx.on("page", (pg) => {
  pg.on("load", () => { if (/sii\.cl/.test(pg.url())) { log(`🪟 ventana SII: ${pg.url()}`); siiPages.push(pg); } });
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (m) => { const t = m.text(); if (/\[bridge\]/.test(t)) log(`  ↪ ${t.slice(0, 150)}`); });
await page.addInitScript(() => {
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (d && (d.source === "app-contable" || d.source === "app-contable-extension"))
      console.log(`[bridge] ${d.source} :: ${d.type} :: ${d.status ?? ""} :: ${(d.message ?? "").slice(0, 120)}`);
  });
});

async function getExtId() {
  for (let i = 0; i < 14; i++) {
    const sws = ctx.serviceWorkers();
    if (sws.length) return new URL(sws[0].url()).host;
    await new Promise((r) => setTimeout(r, 500));
  }
  const sw = await ctx.waitForEvent("serviceworker", { timeout: 6000 }).catch(() => null);
  return sw ? new URL(sw.url()).host : null;
}

log("→ abriendo app");
await page.goto(`${BASE}/massdte`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2500);
if (/\/auth\/login/.test(page.url())) {
  log("⚠️  la app pide login — inicia sesión; reintento hasta 2 min");
  await page.waitForURL((u) => /massdte/.test(String(u)), { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2000);
}
await shot(page, "app-massdte");

// ── Desbloquear la bóveda SII vía la página de opciones (PIN por arg) ──
const extId = await getExtId();
log(`extensión: ${extId ?? "no detectada"}`);
if (extId && PIN) {
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await opt.waitForTimeout(800);
  await opt.fill("#sii-pin", PIN).catch((e) => log("✗ no pude escribir el PIN: " + e.message));
  await opt.click("#unlock-sii-vault").catch((e) => log("✗ no pude clickear desbloquear: " + e.message));
  await opt.waitForTimeout(1800);
  const diag = await opt.textContent("#sii-diagnostic").catch(() => null);
  log(`🔓 unlock: ${(diag || "").trim().slice(0, 120)}`);
  await opt.close();
} else if (!PIN) {
  log("ℹ️  sin PIN por arg: el autologin pedirá desbloqueo manual.");
}

// ── EMITIR BOLETA ÚNICA exenta $1 ──
log("→ EMITIR BOLETA ÚNICA");
await page.bringToFront();
await page.locator("text=EMITIR BOLETA ÚNICA").first().click({ timeout: 15000 }).catch((e) => log("✗ botón boleta única: " + e.message));
await page.waitForTimeout(1500);
await shot(page, "modal-emision");

const exentaBtn = page.locator('button:has-text("Boleta exenta")').first();
if (await exentaBtn.count()) { await exentaBtn.click().catch(() => {}); log("· tipo: exenta"); }
const detalle = page.locator('input[placeholder="Servicio prestado"]').first();
if (await detalle.count()) { await detalle.fill("PRUEBA MASSDTE"); log("· detalle: PRUEBA MASSDTE"); }
const monto = page.locator('input[placeholder="$0"]').first();  // campo de monto, NO el folio
if (await monto.count()) { await monto.fill("1"); log("· monto: $1"); }
else log("✗ no encontré el campo de monto ($0)");
await page.waitForTimeout(700);
await shot(page, "boleta-lista");

const emitirBtn = page.locator('button:has-text("Emitir en SII"), button:has-text("Emitir DTE")').first();
if (await emitirBtn.count()) { await emitirBtn.click().catch(() => {}); log("→ Emitir en SII (job enviado)"); }
else log("✗ no encontré el botón Emitir en SII");

// ── Seguir la ventana SII (máx 6 min) ──
log("⏳ siguiendo el proceso SII...");
const t0 = Date.now();
let lastBody = "", lastOverlay = "";
while (Date.now() - t0 < 360000) {
  await page.waitForTimeout(5000);
  const appState = await page.evaluate(() => {
    const el = document.querySelector(".ed-sidebar") || document.body;
    const m = el.textContent?.match(/(opening_sii|waiting_sii_login|waiting_manual_login|autologin_\w+|sii_page_ready|submitting|capturing_result|emitted|result_needs_review|error|Boleta emitida|Folio[^.]*)/);
    return m ? m[0] : null;
  }).catch(() => null);
  if (appState && appState !== lastBody) { log(`  app: ${appState}`); lastBody = appState; }

  const siiPage = siiPages[siiPages.length - 1];
  if (siiPage && !siiPage.isClosed()) {
    const overlay = await siiPage.evaluate(() => {
      const o = document.getElementById("app-contable-sii-worker-overlay");
      return o ? (o.innerText || "").replace(/\s+/g, " ").slice(0, 180) : null;
    }).catch(() => null);
    if (overlay && overlay !== lastOverlay) { log(`  SII: ${overlay}`); lastOverlay = overlay; }
    await shot(siiPage, "sii-portal");
  }
  await shot(page, "app-progress");
  if (/emitted|Boleta emitida|Folio/.test(lastBody)) { log("✅ emisión confirmada"); break; }
}

await shot(page, "final-app");
await page.locator('button:has-text("Boletas")').first().click().catch(() => {});
await page.waitForTimeout(2500);
await shot(page, "final-boletas");

log("— driver en espera (Ctrl+C para cerrar).");
await new Promise((r) => ctx.on("close", r));
