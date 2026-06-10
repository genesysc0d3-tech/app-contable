// Abre un navegador visible para que el usuario inicie sesión manualmente.
// Cuando detecta una ruta autenticada, guarda el storageState en
// /tmp/e2e-state.json (solo local) y cierra el navegador.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3001";
const STATE = "/tmp/e2e-state.json";

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("Navegador abierto. Esperando login manual (máx 10 min)...");

const deadline = Date.now() + 10 * 60 * 1000;
let authed = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(1000);
  const url = page.url();
  if (/\/(massdte|escritorio|onboarding|empresa|revisar|subir|resumen|clientes|boletas)/.test(url)) {
    authed = true;
    break;
  }
}

if (!authed) {
  console.log("TIMEOUT: no se detectó login en 10 minutos.");
  await browser.close();
  process.exit(1);
}

await page.waitForTimeout(1500);
await ctx.storageState({ path: STATE });
console.log(`SESION CAPTURADA en ${page.url()} -> ${STATE}`);
await browser.close();
