/**
 * Benchmark: mide tiempo de carga de cada pestaña de la app.
 *
 * Uso:
 *   npx playwright test scripts/benchmark.ts --reporter=list
 *   o directamente:
 *   npx ts-node scripts/benchmark.ts
 */

import { chromium } from "@playwright/test";

const BASE_URL =
  process.env.BENCHMARK_URL ||
  "https://app-contable-git-dev-holaavisoapp-2644s-projects.vercel.app";

const TABS = [
  { path: "/subir", selector: 'h1:has-text("Subir")' },
  { path: "/revisar", selector: 'h1:has-text("Revisar")' },
  { path: "/clientes", selector: 'h1:has-text("Clientes")' },
  { path: "/resumen", selector: 'h1:has-text("Resumen")' },
];

const ROUNDS = 3;

interface Result {
  tab: string;
  times: number[];
  avg: number;
}

async function run() {
  console.log(`\nBenchmark: ${BASE_URL}`);
  console.log(`Rondas: ${ROUNDS}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to base — handle auth if needed
  console.log("Cargando página inicial...");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  if (page.url().includes("/auth/login")) {
    const email = process.env.BENCHMARK_EMAIL;
    const password = process.env.BENCHMARK_PASSWORD;
    if (!email || !password) {
      console.log("\n⚠️  Redirigido a login. Configura BENCHMARK_EMAIL y BENCHMARK_PASSWORD.\n");
      await browser.close();
      return;
    }
    console.log("Autenticando...");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.toString().includes("/auth/login"), { timeout: 15000 });
    await page.waitForTimeout(1000);
    console.log(`Autenticado. URL: ${page.url()}`);
  }

  const results: Result[] = [];

  for (const tab of TABS) {
    const times: number[] = [];

    for (let r = 0; r < ROUNDS; r++) {
      // Navigate to a different tab first to reset
      const otherTab = TABS.find((t) => t.path !== tab.path)!;
      await page.goto(`${BASE_URL}${otherTab.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(otherTab.selector, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(200); // settle

      // Measure navigation to target tab
      const start = Date.now();
      await page.goto(`${BASE_URL}${tab.path}`, { waitUntil: "domcontentloaded" });
      try {
        await page.waitForSelector(tab.selector, { timeout: 10000 });
      } catch {
        console.log(`  ⚠️  ${tab.path} ronda ${r + 1}: timeout esperando ${tab.selector}`);
        times.push(-1);
        continue;
      }
      const elapsed = Date.now() - start;
      times.push(elapsed);
    }

    const validTimes = times.filter((t) => t > 0);
    const avg = validTimes.length > 0 ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length) : -1;
    results.push({ tab: tab.path, times, avg });
  }

  await browser.close();

  // Print results table
  console.log("\n" + "=".repeat(65));
  console.log("  RESULTADOS");
  console.log("=".repeat(65));

  const header = ["Pestaña".padEnd(12)];
  for (let r = 0; r < ROUNDS; r++) header.push(`Ronda ${r + 1}`.padStart(10));
  header.push("Promedio".padStart(10));
  console.log("  " + header.join(" | "));
  console.log("  " + "-".repeat(header.join(" | ").length));

  for (const r of results) {
    const cols = [r.tab.padEnd(12)];
    for (const t of r.times) {
      cols.push((t > 0 ? `${t}ms` : "timeout").padStart(10));
    }
    cols.push((r.avg > 0 ? `${r.avg}ms` : "N/A").padStart(10));
    console.log("  " + cols.join(" | "));
  }

  console.log("\n" + "=".repeat(65));

  // Summary
  const avgAll = results.filter((r) => r.avg > 0).map((r) => r.avg);
  if (avgAll.length > 0) {
    const globalAvg = Math.round(avgAll.reduce((a, b) => a + b, 0) / avgAll.length);
    console.log(`  Promedio global: ${globalAvg}ms`);
    const fastest = results.reduce((a, b) => (a.avg < b.avg && a.avg > 0 ? a : b));
    const slowest = results.reduce((a, b) => (a.avg > b.avg ? a : b));
    console.log(`  Más rápida: ${fastest.tab} (${fastest.avg}ms)`);
    console.log(`  Más lenta: ${slowest.tab} (${slowest.avg}ms)`);
  }
  console.log("");
}

run().catch(console.error);
