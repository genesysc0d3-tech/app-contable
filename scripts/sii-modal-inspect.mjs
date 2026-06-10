// Inspección SEGURA del modal "Emitir e-Boleta" (NO emite): postea un job con
// allow_final_emit=false, el bot abre y llena el modal y se detiene antes del
// EMITIR final. Volcamos la estructura real del modal para arreglar el clic.
// Uso: node scripts/sii-modal-inspect.mjs [puerto] [PIN] [emisorRUT]
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
page.on("console", (m) => { const t = m.text(); if (/\[bridge\]/.test(t)) log(`  ↪ ${t.slice(0, 130)}`); });
await page.addInitScript(() => window.addEventListener("message", (e) => {
  const d = e.data; if (d && (d.source === "app-contable" || d.source === "app-contable-extension"))
    console.log(`[bridge] ${d.source} :: ${d.type} :: ${d.status ?? ""} :: ${(d.message ?? "").slice(0, 110)}`);
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
  await opt.waitForTimeout(700);
  await opt.fill("#sii-pin", PIN).catch(() => {});
  await opt.click("#unlock-sii-vault").catch(() => {});
  await opt.waitForTimeout(1600);
  log("🔓 bóveda desbloqueada");
  await opt.close();
}

log("→ posteando job SIN emitir (allow_final_emit=false)");
await page.evaluate((emisor) => {
  window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_BOLETA_JOB", protocol_version: 1, job: {
    job_id: `inspect-${Date.now()}`, expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
    empresa_id: "test", emisor_rut: emisor, tipo_dte: 41, fecha_emision: new Date().toISOString().slice(0, 10),
    receptor: {}, detalles: [{ nombre: "PRUEBA MASSDTE", cantidad: 1, monto_total: 1 }],
    totales: { monto_total: 1, monto_neto: 0, iva: 0, monto_exento: 1 },
    learn_only: false, auto_emit: true, allow_final_emit: false, payment_method: "Efectivo", confirmation_required: false,
  }}, window.location.origin);
}, EMISOR);

// Esperar a que el modal se abra y llene (overlay PAUSED), luego volcar DOM.
let dumped = false;
for (let i = 0; i < 40 && !dumped; i++) {
  await page.waitForTimeout(3000);
  const sii = siiPages[siiPages.length - 1];
  if (!sii || sii.isClosed()) continue;
  const info = await sii.evaluate(() => {
    const dlg = document.querySelector(".v-dialog.v-dialog--active") || document.querySelector(".v-dialog");
    if (!dlg) return { open: false };
    const txt = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return {
      open: true,
      dialogText: txt(dlg).slice(0, 400),
      buttons: Array.from(dlg.querySelectorAll("button")).map(b => ({ t: txt(b).slice(0, 40), cls: b.className.slice(0, 60), disabled: b.disabled })),
      selects: Array.from(dlg.querySelectorAll(".v-select__slot, .v-input__slot")).map(s => txt(s).slice(0, 50)),
      inputs: Array.from(dlg.querySelectorAll("input, textarea")).map(inp => ({ ph: inp.placeholder || "", val: (inp.value || "").slice(0, 30), type: inp.type })),
    };
  }).catch(() => null);
  await sii.screenshot({ path: "/tmp/sii-test/modal-inspect.png" }).catch(() => {});
  if (info?.open) {
    console.log("MODAL_DUMP_START");
    console.log(JSON.stringify(info, null, 2));
    console.log("MODAL_DUMP_END");
    dumped = true;
  } else {
    const overlay = await sii.evaluate(() => { const o = document.getElementById("app-contable-sii-worker-overlay"); return o ? (o.innerText || "").replace(/\s+/g, " ").slice(0, 120) : null; }).catch(() => null);
    if (overlay) log(`  overlay: ${overlay}`);
  }
}
if (!dumped) log("⚠️ no se detectó el modal abierto");
await ctx.close();
