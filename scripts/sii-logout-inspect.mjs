// Verifica que clickLogout() del worker agarre el botón REAL de cerrar sesión
// (FAB naranja ⏻ arriba-derecha) y observa qué pasa al clickearlo (logout
// directo o diálogo de confirmación). NO emite boletas. El click SÍ cierra la
// sesión SII (es la prueba) — vuelve a loguearte para uso real.
// Uso: node scripts/sii-logout-inspect.mjs
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../extensions/sii-portal-rpa");
const PROFILE = "/tmp/sii-logout-profile";
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

// Misma lógica que clickLogout() del worker, pero reporta qué elemento agarra.
const SELECTOR_FN = `(() => {
  const clickables = Array.from(document.querySelectorAll("button, a, [role='button']"));
  const iconBlob = (el) => (typeof el.className === "string" ? el.className : "") + " " +
    Array.from(el.querySelectorAll("i, .v-icon, svg, use"))
      .map((n) => (n.className?.baseVal || (typeof n.className === "string" ? n.className : "")) + " " + (n.textContent || "") + " " + (n.getAttribute?.("href") || "")).join(" ");
  const semantic = (el) => {
    const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").toLowerCase();
    if (/cerrar\\s*sesi[oó]n|salir|logout/.test(aria)) return "aria";
    if (/cerrar\\s*sesi[oó]n/i.test((el.innerText || el.textContent || "").trim())) return "text";
    if (/power_settings_new|mdi-power|fa-power|power-off|\\bpower\\b/i.test(iconBlob(el))) return "icon";
    return null;
  };
  let matchedBy = null;
  let btn = clickables.find((el) => { const m = semantic(el); if (m) { matchedBy = m; return true; } return false; });
  if (!btn) {
    const fab = clickables.filter((el) => /v-btn--(fab|icon|round)/.test(typeof el.className === "string" ? el.className : ""))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top < 160 && r.right > window.innerWidth - 220 && r.width > 28)
      .sort((a, b) => b.r.right - a.r.right)[0];
    if (fab) { btn = fab.el; matchedBy = "fab-position"; }
  }
  return { btn, matchedBy };
})`;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--deny-permission-prompts"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://eboleta.sii.cl/emitir/", { waitUntil: "domcontentloaded" }).catch(() => {});
log("→ Logéate en el SII hasta ver la pantalla de e-Boleta (con el botón ⏻ naranja arriba a la derecha).");

// Esperar a que el selector encuentre el botón (hasta 5 min).
let info = null;
for (let i = 0; i < 100; i += 1) {
  await page.waitForTimeout(3000);
  info = await page.evaluate(`(() => {
    const { btn, matchedBy } = ${SELECTOR_FN}();
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    return { found: true, matchedBy, tag: btn.tagName,
      classes: (typeof btn.className === "string" ? btn.className : "").slice(0,160),
      aria: btn.getAttribute("aria-label") || btn.getAttribute("title") || "",
      icon: (btn.querySelector("i, .v-icon, svg")?.outerHTML || "").slice(0,140),
      text: (btn.innerText || btn.textContent || "").trim().slice(0,40),
      rect: { top: Math.round(r.top), right: Math.round(r.right), w: Math.round(r.width) }, winW: window.innerWidth };
  })()`).catch(() => null);
  if (info?.found) break;
}

if (!info?.found) { log("⚠ no encontré el botón en 5 min (¿llegaste a e-Boleta?)."); await new Promise((r) => ctx.on("close", r)); }

log("\n=== ELEMENTO QUE AGARRA clickLogout ===");
log(`  matchedBy: ${info.matchedBy}  (icon=ícono power, aria=aria-label, text=texto, fab-position=respaldo posición)`);
log(`  tag: ${info.tag} | text: "${info.text}" | aria: "${info.aria}"`);
log(`  classes: ${info.classes}`);
log(`  icon: ${info.icon.replace(/\s+/g, " ")}`);
log(`  posición: top=${info.rect.top} right=${info.rect.right} (ancho ventana ${info.winW}) → ¿arriba-derecha? ${info.rect.top < 160 && info.rect.right > info.winW - 220}`);

log("\n→ Ejecutando LOGOUT COMPLETO (power → confirmar CERRAR SESIÓN)…");
const urlBefore = page.url();
// 1) click power (abre el diálogo "¿Está seguro?")
await page.evaluate(`(() => { const { btn } = ${SELECTOR_FN}(); if (btn) btn.click(); })()`).catch(() => {});
// 2) confirmar: buscar "CERRAR SESIÓN" en TODO el doc, con reintentos (igual que el worker)
let confirmed = false;
for (let i = 0; i < 6 && !confirmed; i += 1) {
  await page.waitForTimeout(400);
  confirmed = await page.evaluate(() => {
    const ok = Array.from(document.querySelectorAll("button, a, [role='button']")).find((el) => {
      if (!/^cerrar\s*sesi[oó]n$/i.test((el.innerText || el.textContent || "").trim())) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (ok) { ok.click(); return true; }
    return false;
  }).catch(() => false);
}
log(`  confirmar "CERRAR SESIÓN": ${confirmed ? "✓ encontrado y clickeado" : "✗ NO encontrado"}`);
await page.waitForTimeout(3000);
const url2 = page.url();
const navego = url2 !== urlBefore;
log(`  URL tras logout: ${url2.slice(0, 80)}`);
log(`  ¿navegó (sesión cerrada)?: ${navego}`);
log(confirmed && navego
  ? "\n🎉 LOGOUT 100% — power → confirmar → navegó (sesión cerrada). El worker hará exactamente esto."
  : `\n⚠ revisar: ${confirmed ? "confirmó pero la URL no cambió (¿logout sin navegación?)" : "no encontró el botón CERRAR SESIÓN"}`);
log("\n— fin. (Ctrl+C para cerrar)");
await new Promise((r) => ctx.on("close", r));
