// Investiga qué hacen IMPRIMIR y COMPARTIR del recibo e-Boleta, SIN colgar nada:
// parcha window.print / navigator.share / window.open antes de clickear, y
// detecta downloads y tabs nuevas. NO emite — tú llegas a un recibo (emite una
// boleta de $1 o abre una del Resumen) y el harness inspecciona los botones.
// Uso: node scripts/sii-buttons-inspect.mjs
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PROFILE = "/tmp/sii-buttons-profile";
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--deny-permission-prompts"],
});

// Parche en MAIN world: neutraliza diálogos nativos y reporta qué se invocó.
await ctx.addInitScript(() => {
  const tag = "[BTN-PROBE]";
  const origPrint = window.print;
  window.print = function () { console.log(`${tag} window.print() LLAMADO (dialogo nativo — colgaria el bot)`); };
  void origPrint;
  if (navigator.share) {
    navigator.share = async function (data) {
      const f = data && data.files && data.files[0];
      console.log(`${tag} navigator.share() LLAMADO — title="${data && data.title}"`);
      if (f) {
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          const head = Array.from(buf.slice(0, 8)).map((b) => String.fromCharCode(b)).join("");
          console.log(`${tag} >>> FILE: name="${f.name}" type="${f.type}" size=${f.size}b head="${head}" esPDF=${head.startsWith("%PDF")}`);
        } catch (e) { console.log(`${tag} no pude leer el file: ${e.message}`); }
      } else {
        console.log(`${tag} navigator.share SIN files`);
      }
      return Promise.resolve();
    };
  } else {
    console.log(`${tag} navigator.share NO existe en este contexto`);
  }
  const origOpen = window.open;
  window.open = function (url, ...rest) { console.log(`${tag} window.open() -> ${url}`); return origOpen.call(window, url, ...rest); };
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (m) => { const t = m.text(); if (t.includes("[BTN-PROBE]")) log("  " + t); });
page.on("download", (d) => log(`  ⬇ DOWNLOAD disparado -> ${d.suggestedFilename()} (url: ${d.url().slice(0, 80)})`));
ctx.on("page", (p) => p.on("load", () => log(`  🪟 tab/ventana nueva -> ${p.url().slice(0, 90)}`)));

await page.goto("https://eboleta.sii.cl/emitir/", { waitUntil: "domcontentloaded" }).catch(() => {});
log("→ Logéate en el SII y llega a un RECIBO (emite una boleta de $1 o abre una del Resumen).");
log("  El harness detecta cuando aparecen IMPRIMIR/COMPARTIR y los inspecciona solo.");

async function findBtn(label) {
  for (const fr of page.frames()) {
    const b = fr.locator(`button:has-text("${label}"), :text("${label}")`).first();
    if (await b.count().catch(() => 0)) return b;
  }
  return null;
}

// Esperar a que aparezca el recibo (botón IMPRIMIR), hasta 5 min.
let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  await page.waitForTimeout(3000);
  const imp = await findBtn("IMPRIMIR");
  if (imp && await imp.isVisible().catch(() => false)) ready = true;
}
if (!ready) { log("⚠ no apareció el recibo (IMPRIMIR) en 5 min."); await ctx.close(); process.exit(0); }

log("✓ recibo detectado. Inspeccionando botones…");
for (const label of ["IMPRIMIR", "COMPARTIR"]) {
  const btn = await findBtn(label);
  if (!btn) { log(`  ${label}: no encontrado`); continue; }
  const html = await btn.evaluate((el) => (el.closest("button") || el).outerHTML.slice(0, 200)).catch(() => "");
  log(`\n=== ${label} ===`);
  log(`  html: ${html.replace(/\s+/g, " ")}`);
  log(`  clickeando ${label} (con print/share parchados)…`);
  await btn.click({ timeout: 4000 }).catch((e) => log(`  click falló: ${e.message}`));
  await page.waitForTimeout(2500);
}
log("\n— fin inspección. Revisa arriba qué disparó cada botón. (Ctrl+C para cerrar)");
await new Promise((r) => ctx.on("close", r));
