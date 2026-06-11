// Pasada visual: captura las vistas principales de massdte usando la sesión
// guardada por login-capture.mjs. Screenshots en /tmp/shots (solo local).
import { chromium } from "@playwright/test";
import fs from "fs";

const BASE = "http://localhost:3001";
const STATE = "/tmp/e2e-state.json";
const SHOTS = "/tmp/shots";
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const errors = [];

function wire(page) {
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${page.url()} :: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${page.url()} :: ${String(e).slice(0, 160)}`));
}

async function shot(page, name, settle = 1600) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`${name} -> ${page.url()}`);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: STATE });
const page = await ctx.newPage();
wire(page);

const rutas = [
  ["10-massdte", "/massdte", 2600],
  ["11-empresa", "/empresa", 2000],
  ["12-revisar", "/revisar", 2000],
  ["13-subir", "/subir", 2000],
  ["14-resumen", "/resumen", 2000],
  ["15-clientes", "/clientes", 2000],
  ["16-boletas-reportes", "/boletas/reportes", 2000],
];

for (const [name, path, settle] of rutas) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await shot(page, name, settle);
}

// Interacciones en massdte: tabs del dashboard
await page.goto(`${BASE}/massdte`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2200);
for (const [name, label] of [["17-tab-agregados", "Agregados"], ["18-tab-emitir", "Emitir"], ["19-tab-boletas", "Boletas"]]) {
  const tab = page.locator(`button:has-text("${label}")`).first();
  if (await tab.count()) {
    await tab.click().catch(() => {});
    await shot(page, name, 1400);
  }
}

// Mobile
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: STATE, isMobile: true, hasTouch: true });
const mpage = await mctx.newPage();
wire(mpage);
await mpage.goto(`${BASE}/massdte`, { waitUntil: "networkidle" }).catch(() => {});
await shot(mpage, "20-massdte-mobile", 2400);
await mpage.goto(`${BASE}/revisar`, { waitUntil: "networkidle" }).catch(() => {});
await shot(mpage, "21-revisar-mobile", 2000);

await browser.close();
console.log("\n--- ERRORES ---");
console.log(errors.length ? [...new Set(errors)].slice(0, 12).join("\n") : "(ninguno)");
