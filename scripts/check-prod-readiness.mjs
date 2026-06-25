#!/usr/bin/env node
// check:prod-readiness — runs the local gates in sequence and prints a summary.
// Runs ALL steps (doesn't stop at first failure) so you see everything that's red.
// Exit 1 if any step fails. No dependencies.
import { spawnSync } from "node:child_process";

const steps = [
  ["lint", ["run", "lint"]],
  ["test", ["run", "test"]],
  ["audit:secrets", ["run", "audit:secrets"]],
  ["audit:safety", ["run", "audit:safety"]],
  ["deps audit", ["audit", "--omit=dev", "--audit-level=high"]],
  ["build", ["run", "build"]],
];

const results = [];
for (const [name, args] of steps) {
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync("npm", args, { stdio: "inherit", shell: process.platform === "win32" });
  results.push([name, r.status === 0]);
}

console.log("\n──────── prod-readiness ────────");
let failed = 0;
for (const [name, ok] of results) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
console.log("────────────────────────────────");
if (failed) {
  console.error(`${failed} step(s) failed.`);
  process.exit(1);
}
console.log("All gates passed.");
