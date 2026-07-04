// Login programático a la app + valida que la sesión PEGUE (carga /massdte, no
// /onboarding). Usa el mismo perfil persistente que la emisión, así la sesión
// queda lista para sii-real-drive. Credenciales por ENV (no se commitean):
//   APP_EMAIL=... APP_PASS=... node scripts/app-login.mjs
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PROFILE = "/tmp/sii-real-test-profile";
const BASE = "http://localhost:3001";
const EMAIL = process.env.APP_EMAIL;
const PASS = process.env.APP_PASS;
if (!EMAIL || !PASS) { console.log("Faltan APP_EMAIL / APP_PASS"); process.exit(1); }

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 880 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--deny-permission-prompts"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

// Limpiar datos de la página (cookies + storage) para que no quede sesión vieja
// que mande a onboarding.
console.log("→ limpiando datos del perfil (cookies + storage)…");
await ctx.clearCookies().catch(() => {});
await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* noop */ } }).catch(() => {});

console.log("→ /auth/login");
await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" }).catch(() => {});
await page.fill('input[name="email"]', EMAIL).catch((e) => console.log("✗ email:", e.message));
await page.fill('input[name="password"]', PASS).catch((e) => console.log("✗ pass:", e.message));
console.log("→ Entrar");
await page.click('button:has-text("Entrar"), button[type="submit"]').catch((e) => console.log("✗ submit:", e.message));
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);
console.log("tras login →", page.url());

// Navegación fresca a /massdte.
await page.goto(`${BASE}/massdte`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(1500);
const url = page.url();
console.log("tras /massdte →", url);
if (/\/massdte/.test(url)) console.log("✅ SESIÓN OK — dashboard carga. La sesión quedó persistida en el perfil.");
else console.log(`✗ SESIÓN NO PEGA — redirige a ${url}. La cookie no se relee.`);

// Verificación del fix del embed: fetch del endpoint que fallaba con
// USUARIO_SIN_EMPRESA. Con la desambiguación debería devolver datos (o lista
// vacía), no ese error.
const endpointCheck = await page.evaluate(async () => {
  try {
    const r = await fetch("/api/intermediaria/pendientes-emision", { cache: "no-store" });
    const t = await r.text();
    return `HTTP ${r.status} :: ${t.slice(0, 180)}`;
  } catch (e) { return `fetch error: ${e.message}`; }
}).catch((e) => `evaluate error: ${e.message}`);
console.log("\n=== /api/intermediaria/pendientes-emision ===");
console.log(endpointCheck);
console.log(/USUARIO_SIN_EMPRESA/.test(endpointCheck) ? "✗ SIGUE roto" : "✅ FIX OK — sin USUARIO_SIN_EMPRESA");

console.log("— navegador abierto (Ctrl+C para cerrar).");
await new Promise((r) => ctx.on("close", r));
