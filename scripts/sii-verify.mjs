// Solo-lectura: navega al "Resumen de ventas diarias" del SII para confirmar
// si la boleta de prueba ($1 exenta, INMOBILIARIA) quedó emitida. NO emite.
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PROFILE = "/tmp/sii-real-test-profile";

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1380, height: 880 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--deny-permission-prompts"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://eboleta.sii.cl/emitir/", { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(5000);

// Abrir el menú (hamburguesa) y entrar a "Resumen de ventas diarias".
await page.locator("text=menu").first().click().catch(() => {});
await page.waitForTimeout(1200);
const resumen = page.locator("text=/Resumen de ventas/i").first();
if (await resumen.count()) { await resumen.click().catch(() => {}); }
await page.waitForTimeout(6000);
await page.screenshot({ path: "/tmp/sii-test/verify-resumen.png", fullPage: true });
const text = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")).replace(/\s+/g, " ");
console.log("RESUMEN_START");
console.log(text.slice(0, 1800));
console.log("RESUMEN_END");
await ctx.close();
