// Prueba real de emisión SII: abre Chromium con la extensión Motor Local
// cargada, apuntando a la app local. El humano hace los logins (app + SII);
// la extensión emite y la app persiste. Este script solo observa y loguea.
//
// Uso: node scripts/sii-real-test.mjs [puerto-app]
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PORT = process.argv[2] || "3001";
const BASE = `http://localhost:${PORT}`;
const PROFILE = "/tmp/sii-real-test-profile";

console.log(`Extensión: ${EXT_PATH}`);
console.log(`App: ${BASE}/massdte`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1380, height: 880 },
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
  ],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());

// Log de todo lo que la app y la extensión conversan (postMessage) + consola.
await page.addInitScript(() => {
  window.addEventListener("message", (event) => {
    const d = event.data;
    if (d && (d.source === "app-contable" || d.source === "app-contable-extension")) {
      console.log(`[bridge] ${d.source} :: ${d.type} :: ${d.status ?? ""} :: ${(d.message ?? "").slice(0, 140)}`);
    }
  });
});
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("[bridge]") || t.includes("app-contable")) console.log(t);
});

await page.goto(`${BASE}/massdte`, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log(`
=== PRUEBA REAL SII — pasos ===
1. Logéate en la app si te lo pide.
2. EMITIR BOLETA ÚNICA → Boleta exenta → monto 1 → detalle "PRUEBA MASSDTE"
   → Emitir en SII.
3. En la ventana SII que se abre: inicia sesión con la clave del contador
   (captcha/2FA manual si aparece). El bot continúa solo al entrar a e-Boleta.
4. Observa el overlay: rellena $1, abre el modal, elige Boleta exenta,
   método de pago, escribe la glosa y emite.
5. Al capturar folio + PDF, la boleta queda guardada en la app (tab Boletas).

Este terminal muestra todos los mensajes app ↔ extensión.
El navegador queda abierto hasta que cierres este proceso (Ctrl+C).
`);

// Mantener vivo hasta que el usuario cierre el browser o mate el proceso.
await new Promise((resolve) => ctx.on("close", resolve));
console.log("Navegador cerrado. Fin de la prueba.");
