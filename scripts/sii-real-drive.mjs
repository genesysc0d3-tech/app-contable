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
const EMISOR = (process.argv[4] || "").trim(); // RUT emisor para el job (prueba)
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
// Estado del job tomado de los mensajes del bridge (no del texto de la app,
// que contiene "Folio" en el dashboard y causaba falsos positivos).
let jobStatus = "";
let jobResult = null;
page.on("console", (m) => {
  const t = m.text();
  if (!/\[bridge\]/.test(t)) return;
  log(`  ↪ ${t.slice(0, 150)}`);
  const st = t.match(/SII_JOB_STATUS :: (\w+)/);
  if (st) jobStatus = st[1];
  if (/SII_JOB_RESULT/.test(t)) jobResult = t;
});
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
if (EMISOR) {
  // Modo prueba: el portal tiene seleccionada esa empresa; postear el job
  // directamente con ese RUT emisor para que la verificación coincida y el
  // bot emita ahí. Boleta exenta (41) de $1 con glosa "PRUEBA MASSDTE".
  log(`→ emitiendo job directo (emisor ${EMISOR}, exenta $1)`);
  await page.evaluate((emisor) => {
    const id = `test-${Date.now()}`;
    window.postMessage({
      source: "app-contable", type: "APP_CONTABLE_SII_BOLETA_JOB", protocol_version: 1,
      job: {
        job_id: id, expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
        empresa_id: "test", emisor_rut: emisor, tipo_dte: 41,
        fecha_emision: new Date().toISOString().slice(0, 10),
        receptor: {}, glosa: "PRUEBA GLOSA MASSDTE", detalles: [{ nombre: "PRUEBA MASSDTE", cantidad: 1, monto_total: 1 }],
        totales: { monto_total: 1, monto_neto: 0, iva: 0, monto_exento: 1 },
        learn_only: false, auto_emit: true, allow_final_emit: true,
        payment_method: "Efectivo", confirmation_required: false,
      },
    }, window.location.origin);
  }, EMISOR);
  log("→ job enviado a la extensión");
} else {
  log("→ EMITIR BOLETA ÚNICA (vía UI)");
  await page.bringToFront();
  await page.locator("text=EMITIR BOLETA ÚNICA").first().click({ timeout: 15000 }).catch((e) => log("✗ botón boleta única: " + e.message));
  await page.waitForTimeout(1500);
  await shot(page, "modal-emision");
  const exentaBtn = page.locator('button:has-text("Boleta exenta")').first();
  if (await exentaBtn.count()) { await exentaBtn.click().catch(() => {}); log("· tipo: exenta"); }
  const detalle = page.locator('input[placeholder="Servicio prestado"]').first();
  if (await detalle.count()) { await detalle.fill("PRUEBA MASSDTE"); log("· detalle: PRUEBA MASSDTE"); }
  const monto = page.locator('input[placeholder="$0"]').first();
  if (await monto.count()) { await monto.fill("1"); log("· monto: $1"); }
  else log("✗ no encontré el campo de monto ($0)");
  await page.waitForTimeout(700);
  await shot(page, "boleta-lista");
  const emitirBtn = page.locator('button:has-text("Emitir en SII"), button:has-text("Emitir DTE")').first();
  if (await emitirBtn.count()) { await emitirBtn.click().catch(() => {}); log("→ Emitir en SII (job enviado)"); }
  else log("✗ no encontré el botón Emitir en SII");
}

// ── Seguir la ventana SII hasta estado terminal (máx 6 min) ──
// La terminación se basa en los mensajes del bridge (jobStatus), no en el
// texto de la app. Screenshot continuo de la ventana SII para ver el EMITIR.
log("⏳ siguiendo el proceso SII...");
const t0 = Date.now();
let lastOverlay = "";
let shotIdx = 0;
while (Date.now() - t0 < 360000) {
  await page.waitForTimeout(4000);
  const siiPage = siiPages[siiPages.length - 1];
  if (siiPage && !siiPage.isClosed()) {
    const overlay = await siiPage.evaluate(() => {
      const o = document.getElementById("app-contable-sii-worker-overlay");
      return o ? (o.innerText || "").replace(/\s+/g, " ").slice(0, 180) : null;
    }).catch(() => null);
    if (overlay && overlay !== lastOverlay) { log(`  SII overlay: ${overlay}`); lastOverlay = overlay; }
    await siiPage.screenshot({ path: `/tmp/sii-test/sii-${String(++shotIdx).padStart(2, "0")}.png` }).catch(() => {});
  }
  // Estado terminal por bridge.
  if (jobResult || jobStatus === "emitted") { log(`✅ resultado: ${jobStatus} ${jobResult ? "(JOB_RESULT recibido)" : ""}`); break; }
  if (jobStatus === "result_needs_review") { log("⚠️  result_needs_review (revisar captura)"); break; }
  if (jobStatus === "error") { log("✗ error en el job (ver overlay)"); break; }
}

await shot(page, "final-app");
log(`— driver en espera. jobStatus final: ${jobStatus}`);
await new Promise((r) => ctx.on("close", r));
