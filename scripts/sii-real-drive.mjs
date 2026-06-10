// Driver de prueba real SII: lanza Chromium con la extensión Motor Local
// sobre el perfil persistente (login de la app sobrevive), y MANEJA el flujo:
// EMITIR BOLETA ÚNICA → exenta → $1 → glosa → Emitir en SII, observando la
// ventana SII que abre la extensión y registrando toda la conversación.
//
// Emite una boleta REAL al SII (autorizado: exenta $1, permiso del contador).
import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PORT = process.argv[2] || "3001";
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
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

// Capturar la ventana SII (la extensión la abre como nueva página).
const siiPages = [];
ctx.on("page", (pg) => {
  pg.on("load", () => { if (/sii\.cl/.test(pg.url())) { log(`🪟 ventana SII: ${pg.url()}`); siiPages.push(pg); } });
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (m) => { const t = m.text(); if (/\[bridge\]|app-contable|SII|folio|Folio/.test(t)) log(`  ↪ ${t.slice(0, 160)}`); });
await page.addInitScript(() => {
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (d && (d.source === "app-contable" || d.source === "app-contable-extension"))
      console.log(`[bridge] ${d.source} :: ${d.type} :: ${d.status ?? ""} :: ${(d.message ?? "").slice(0, 130)}`);
  });
});

log("→ abriendo app");
await page.goto(`${BASE}/massdte`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2500);
if (/\/auth\/login/.test(page.url())) {
  log("⚠️  la app pide login — inicia sesión en la ventana y el script reintenta en 30s");
  await page.waitForURL((u) => /massdte/.test(String(u)), { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2000);
}
await shot(page, "app-massdte");

// Estado de la bóveda SII (vía la extensión). Al reiniciar el navegador el
// desbloqueo en memoria se pierde; si quedó bloqueada, esperar a que el
// usuario reingrese el PIN para que el autologin funcione.
async function getSW() {
  for (let i = 0; i < 12; i++) {
    const sws = ctx.serviceWorkers();
    if (sws.length) return sws[0];
    await new Promise((r) => setTimeout(r, 500));
  }
  return await ctx.waitForEvent("serviceworker", { timeout: 5000 }).catch(() => null);
}
async function vaultStatus() {
  const sw = await getSW();
  if (!sw) return null;
  return await sw.evaluate(async () => await new Promise((res) => {
    chrome.runtime.sendMessage({ type: "APP_CONTABLE_SII_VAULT_STATUS" }, (r) => res(r?.status ?? null));
  })).catch(() => null);
}
let vault = await vaultStatus();
log(`🔐 bóveda SII: ${vault ? JSON.stringify(vault) : "no consultable"}`);
if (vault && vault.configured && !vault.unlocked) {
  log("🔑 la bóveda quedó BLOQUEADA tras reabrir. Abre la extensión (Motor Local) → pestaña SII → ingresa el PIN → Desbloquear con PIN. Esperando hasta 3 min...");
  const tWait = Date.now();
  while (Date.now() - tWait < 180000) {
    await page.waitForTimeout(5000);
    vault = await vaultStatus();
    if (vault?.unlocked) { log("✅ bóveda desbloqueada — sigo con la emisión"); break; }
  }
  if (!vault?.unlocked) log("⚠️  sigue bloqueada; el bot pedirá login manual en la ventana SII.");
}

// EMITIR BOLETA ÚNICA
log("→ EMITIR BOLETA ÚNICA");
await page.locator("text=EMITIR BOLETA ÚNICA").first().click().catch((e) => log("✗ no encontré el botón: " + e.message));
await page.waitForTimeout(1800);
await shot(page, "modal-emision");

// Boleta exenta
const exentaBtn = page.locator('button:has-text("Boleta exenta")').first();
if (await exentaBtn.count()) { await exentaBtn.click().catch(() => {}); log("· tipo: exenta"); }

// Monto 1 + detalle
const detalle = page.locator('input[placeholder="Servicio prestado"]').first();
if (await detalle.count()) { await detalle.fill("PRUEBA MASSDTE"); log("· detalle: PRUEBA MASSDTE"); }
const monto = page.locator('input[inputmode="numeric"]').last();
if (await monto.count()) { await monto.fill("1"); log("· monto: $1"); }
await page.waitForTimeout(800);
await shot(page, "boleta-lista");

// Emitir en SII
const emitirBtn = page.locator('button:has-text("Emitir en SII"), button:has-text("Emitir DTE")').first();
if (await emitirBtn.count()) { await emitirBtn.click().catch(() => {}); log("→ Emitir en SII (job enviado a la extensión)"); }
else log("✗ no encontré el botón Emitir en SII");

// Seguir la ventana SII y el progreso por 6 minutos.
log("⏳ siguiendo el proceso SII (máx 6 min)...");
const t0 = Date.now();
let lastBody = "";
let lastOverlay = "";
let reloadedAfterUnlock = false;
let vaultUnlockedSeen = vault?.unlocked === true;
while (Date.now() - t0 < 360000) {
  await page.waitForTimeout(5000);
  // Estado en el panel de la app (localWorker).
  const appState = await page.evaluate(() => {
    const el = document.querySelector('.ed-sidebar') || document.body;
    const m = el.textContent?.match(/(opening_sii|waiting_sii_login|autologin_\w+|sii_page_ready|submitting|capturing_result|emitted|result_needs_review|error|Boleta emitida|Folio[^.]*)/);
    return m ? m[0] : null;
  }).catch(() => null);
  if (appState && appState !== lastBody) { log(`  app: ${appState}`); lastBody = appState; }

  const siiPage = siiPages[siiPages.length - 1];
  let overlay = null;
  if (siiPage && !siiPage.isClosed()) {
    overlay = await siiPage.evaluate(() => {
      const o = document.getElementById("app-contable-sii-worker-overlay");
      return o ? (o.innerText || "").replace(/\s+/g, " ").slice(0, 200) : null;
    }).catch(() => null);
    if (overlay && overlay !== lastOverlay) { log(`  SII overlay: ${overlay}`); lastOverlay = overlay; }
    await shot(siiPage, "sii-portal");
  }
  await shot(page, "app-progress");

  // Respaldo: si la bóveda pasó a desbloqueada pero la ventana SII sigue en
  // login (caso borde de timing), recargarla una vez para gatillar el scan.
  if (!vaultUnlockedSeen) {
    const v = await vaultStatus();
    if (v?.unlocked) { vaultUnlockedSeen = true; log("🔓 bóveda desbloqueada detectada"); }
  }
  if (vaultUnlockedSeen && !reloadedAfterUnlock && siiPage && !siiPage.isClosed()
      && /bloqueada|inicia sesi|requiere inicio/i.test(overlay || "")) {
    log("↻ respaldo: recargo la ventana SII para reanudar autologin");
    await siiPage.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    reloadedAfterUnlock = true;
  }

  // ¿Terminó?
  if (/emitted|Boleta emitida|Folio/.test(lastBody)) { log("✅ emisión confirmada"); break; }
}

await shot(page, "final-app");
// Verificar en el tab Boletas
await page.locator('button:has-text("Boletas")').first().click().catch(() => {});
await page.waitForTimeout(2500);
await shot(page, "final-boletas");

log("— driver en espera (Ctrl+C para cerrar). El navegador queda abierto.");
await new Promise((r) => ctx.on("close", r));
