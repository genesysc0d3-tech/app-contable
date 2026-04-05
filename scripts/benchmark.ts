/**
 * Benchmark: mide tiempo de carga — full page load vs client-side nav con cache.
 * npx tsx scripts/benchmark.ts
 */

import { chromium } from "@playwright/test";

const BASE_URL = process.env.BENCHMARK_URL || "http://localhost:3000";
const TABS = [
  { path: "/subir", selector: 'h1:has-text("Subir")' },
  { path: "/revisar", selector: 'h1:has-text("Revisar")' },
  { path: "/clientes", selector: 'h1:has-text("Clientes")' },
  { path: "/resumen", selector: 'h1:has-text("Resumen")' },
];
const ROUNDS = 3;

interface Result { tab: string; times: number[]; avg: number }

function fmtMs(t: number) { return t > 0 ? `${t}ms` : "timeout"; }

function printTable(title: string, results: Result[]) {
  console.log("\n" + "=".repeat(65));
  console.log(`  ${title}`);
  console.log("=".repeat(65));
  const h = ["Pestaña".padEnd(12)];
  for (let r = 0; r < ROUNDS; r++) h.push(`Ronda ${r + 1}`.padStart(10));
  h.push("Promedio".padStart(10));
  console.log("  " + h.join(" | "));
  console.log("  " + "-".repeat(h.join(" | ").length));
  for (const r of results) {
    const c = [r.tab.padEnd(12), ...r.times.map((t) => fmtMs(t).padStart(10)), fmtMs(r.avg).padStart(10)];
    console.log("  " + c.join(" | "));
  }
}

async function measureNav(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>,
  baseUrl: string,
  mode: "goto" | "click"
): Promise<Result[]> {
  const results: Result[] = [];

  for (const tab of TABS) {
    const times: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      // Go to different tab first
      const other = TABS.find((t) => t.path !== tab.path)!;
      if (mode === "goto") {
        await page.goto(`${baseUrl}${other.path}`, { waitUntil: "domcontentloaded" });
      } else {
        await page.click(`a[href="${other.path}"]`);
      }
      await page.waitForSelector(other.selector, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(150);

      const start = Date.now();
      if (mode === "goto") {
        await page.goto(`${baseUrl}${tab.path}`, { waitUntil: "domcontentloaded" });
      } else {
        await page.click(`a[href="${tab.path}"]`);
      }
      try {
        await page.waitForSelector(tab.selector, { timeout: 10000 });
      } catch {
        times.push(-1);
        continue;
      }
      times.push(Date.now() - start);
    }
    const valid = times.filter((t) => t > 0);
    results.push({ tab: tab.path, times, avg: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : -1 });
  }
  return results;
}

async function run() {
  console.log(`\nBenchmark: ${BASE_URL} | Rondas: ${ROUNDS}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Auth
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  if (page.url().includes("/auth/login")) {
    const email = process.env.BENCHMARK_EMAIL;
    const password = process.env.BENCHMARK_PASSWORD;
    if (!email || !password) {
      console.log("⚠️  Login required. Set BENCHMARK_EMAIL and BENCHMARK_PASSWORD.\n");
      await browser.close();
      return;
    }
    console.log("Autenticando...");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.toString().includes("/auth/login"), { timeout: 15000 });
    await page.waitForTimeout(1000);
    console.log(`OK: ${page.url()}\n`);
  }

  // 1. Full page load
  console.log("--- Full page load (goto) ---");
  const fullResults = await measureNav(page, BASE_URL, "goto");
  printTable("FULL PAGE LOAD (goto)", fullResults);

  // 2. Warm cache: visit all tabs
  console.log("\n--- Calentando cache (visitando todas las pestañas) ---");
  for (const tab of TABS) {
    await page.click(`a[href="${tab.path}"]`).catch(() =>
      page.goto(`${BASE_URL}${tab.path}`, { waitUntil: "domcontentloaded" })
    );
    await page.waitForSelector(tab.selector, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // 3. Client-side nav (cached)
  console.log("--- Client-side nav (con cache Zustand) ---");
  const clientResults = await measureNav(page, BASE_URL, "click");
  printTable("CLIENT-SIDE NAV (con cache)", clientResults);

  // Comparison
  console.log("\n" + "=".repeat(65));
  console.log("  COMPARACIÓN");
  console.log("=".repeat(65));
  console.log("  " + "Pestaña".padEnd(12) + " | " + "Full Load".padStart(10) + " | " + "Client Nav".padStart(10) + " | " + "Mejora".padStart(10));
  console.log("  " + "-".repeat(50));
  for (let i = 0; i < TABS.length; i++) {
    const f = fullResults[i].avg;
    const c = clientResults[i].avg;
    const pct = f > 0 && c > 0 ? `${Math.round((1 - c / f) * 100)}%` : "N/A";
    console.log("  " + fullResults[i].tab.padEnd(12) + " | " + fmtMs(f).padStart(10) + " | " + fmtMs(c).padStart(10) + " | " + pct.padStart(10));
  }

  const avgFull = Math.round(fullResults.filter((r) => r.avg > 0).reduce((s, r) => s + r.avg, 0) / fullResults.length);
  const avgClient = Math.round(clientResults.filter((r) => r.avg > 0).reduce((s, r) => s + r.avg, 0) / clientResults.length);
  console.log("\n  " + "TOTAL".padEnd(12) + " | " + fmtMs(avgFull).padStart(10) + " | " + fmtMs(avgClient).padStart(10) + " | " + `${Math.round((1 - avgClient / avgFull) * 100)}%`.padStart(10));
  console.log("");

  await browser.close();
}

run().catch(console.error);
