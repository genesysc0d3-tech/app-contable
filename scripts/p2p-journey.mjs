// Recorrido como cliente P2P Binance: subir cartola → hint cripto →
// revisar propuestas → boleta manual → historial/búsqueda.
// Screenshots en /tmp/shots-p2p (solo local).
import { chromium } from "@playwright/test";
import fs from "fs";

const BASE = "http://localhost:3001";
const SHOTS = "/tmp/shots-p2p";
const CARTOLA = "/tmp/cartola-p2p-binance-junio.xlsx";
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/e2e-state.json" });
const page = await ctx.newPage();
const notas = [];

async function shot(name, settle = 1200) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`shot: ${name} @ ${page.url()}`);
}

// ---- 1. Dashboard inicial
await page.goto(`${BASE}/massdte`, { waitUntil: "networkidle" }).catch(() => {});
await shot("01-dashboard", 2400);

// ---- 2. Abrir subida masiva (EMITIR MASSDTE)
const massdteBtn = page.locator("text=EMITIR MASSDTE").first();
if (await massdteBtn.count()) {
  await massdteBtn.click().catch(() => {});
  await shot("02-panel-subida", 1600);
} else {
  notas.push("No encontré el botón EMITIR MASSDTE");
}

// ---- 3. Subir la cartola por el input del dropzone
const fileInputs = page.locator('input[type="file"]');
const nInputs = await fileInputs.count();
let uploaded = false;
for (let i = 0; i < nInputs; i++) {
  const accept = (await fileInputs.nth(i).getAttribute("accept")) || "";
  if (accept.includes("xls")) {
    await fileInputs.nth(i).setInputFiles(CARTOLA).catch((e) => notas.push("setInputFiles falló: " + e.message));
    uploaded = true;
    break;
  }
}
if (!uploaded) notas.push(`No encontré input de archivo con accept xls (hay ${nInputs} inputs)`);
await shot("03-archivo-en-cola", 1500);

// Botón "Subir todo"
const subirTodo = page.locator('button:has-text("Subir todo")').first();
if (await subirTodo.count()) {
  await subirTodo.click().catch(() => {});
  await shot("04-subiendo", 2000);
} else {
  notas.push("No encontré botón 'Subir todo'");
}

// ---- 4. Poll del procesamiento IA (hasta 4 min) mirando el tab Agregados
const agregadosTab = page.locator('button:has-text("Agregados")').first();
if (await agregadosTab.count()) await agregadosTab.click().catch(() => {});
await shot("05-agregados-procesando", 2500);

let procesado = false;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(10000);
  const body = await page.textContent("body").catch(() => "");
  if (/procesado|Procesado/.test(body) && !/procesando|Procesando/.test(body)) { procesado = true; break; }
  if (i % 3 === 2) await page.screenshot({ path: `${SHOTS}/05b-poll-${i}.png` });
}
notas.push(procesado ? "Documento procesado por la IA" : "TIMEOUT: documento no terminó de procesar en 4 min");
await shot("06-agregados-final", 1500);

// ---- 5. Hint "P2P cripto" si hay selector visible
const hintBtn = page.locator('button:has-text("Tipo:")').first();
if (await hintBtn.count()) {
  await hintBtn.click().catch(() => {});
  await shot("07-hint-abierto", 900);
  const opcion = page.locator('button:has-text("P2P cripto")').first();
  if (await opcion.count()) {
    await opcion.click().catch(() => {});
    notas.push("Hint P2P cripto aplicado");
  }
  await shot("08-hint-aplicado", 1200);
} else {
  notas.push("No vi selector de hint 'Tipo:' en Agregados");
}

// ---- 6. Tab Revisar: propuestas clasificadas
const revisarTab = page.locator('button:has-text("Revisar")').first();
if (await revisarTab.count()) await revisarTab.click().catch(() => {});
await shot("09-revisar-propuestas", 2500);

// ---- 7. Boleta manual (EMITIR BOLETA ÚNICA)
const unicaBtn = page.locator("text=EMITIR BOLETA ÚNICA").first();
if (await unicaBtn.count()) {
  await unicaBtn.click().catch(() => {});
  await shot("10-boleta-unica-vacia", 1500);

  // RUT inválido a propósito (validación)
  const rutInput = page.locator('input[placeholder*="180.000"]').first();
  if (await rutInput.count()) {
    await rutInput.fill("12345678-0");
    const detalle = page.locator('input[placeholder="Servicio prestado"]').first();
    if (await detalle.count()) await detalle.fill("Venta USDT P2P Binance");
    const monto = page.locator('input[inputmode="numeric"]').last();
    await monto.fill("185000").catch(() => {});
    await shot("11-boleta-rut-invalido", 1200);

    await rutInput.fill("11111111-1");
    await shot("12-boleta-lista", 1200);

    const emitir = page.locator('button:has-text("Emitir en SII"), button:has-text("Emitir DTE")').first();
    if (await emitir.count()) {
      await emitir.click().catch(() => {});
      await shot("13-boleta-emitir-click", 2500);
    }
  } else {
    notas.push("No encontré el input de RUT receptor en boleta única");
  }
  // Cerrar modal
  await page.locator('button[aria-label="Cerrar emisión directa"]').first().click().catch(() => {});
} else {
  notas.push("No encontré EMITIR BOLETA ÚNICA");
}

// ---- 8. Historial / búsqueda fullscreen
await page.waitForTimeout(800);
// Intento encontrar el control real primero
const expandBtn = page.locator('button[title*="istorial"], button[aria-label*="istorial"], button[title*="xpandir"], button[aria-label*="xpandir"]').first();
if (await expandBtn.count()) {
  await expandBtn.click().catch(() => {});
  notas.push("Abrí historial con botón visible");
} else {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("toggle-dashboard-fullscreen", { detail: { open: true } })));
  notas.push("HALLAZGO UX: no encontré botón visible para abrir el historial; lo abrí por evento JS");
}
await shot("14-historial", 2200);

const searchBox = page.locator('input[placeholder*="uscar"], input[type="search"]').first();
if (await searchBox.count()) {
  await searchBox.fill("soto");
  await shot("15-busqueda-soto", 1400);
  await searchBox.fill("12");
  await shot("16-busqueda-folio-12", 1400);
  await searchBox.fill("185000");
  await shot("17-busqueda-monto", 1400);
  await searchBox.fill("");
} else {
  // La búsqueda puede vivir en el header (search-history-query-change)
  const headerSearch = page.locator("input").filter({ hasNot: page.locator('[type="file"]') });
  notas.push("No encontré caja de búsqueda obvia en el historial");
  await shot("15-historial-sin-busqueda", 800);
}

await browser.close();
console.log("\n--- NOTAS DEL RECORRIDO ---");
for (const n of notas) console.log("• " + n);
