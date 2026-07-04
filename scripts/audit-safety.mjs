#!/usr/bin/env node
// audit:safety — MassDTE-specific risky-pattern scanner. Reports file:line:type,
// never values. Exit 1 only on CRITICAL. No dependencies.
//
// v1 ratchet (per plan): only unambiguous issues block; fuzzy ones warn. Once the
// baseline is clean, repeated warnings get promoted to blocking.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src", "scripts"];
const SKIP_DIR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "backup"]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); }
    else if (CODE_EXT.has(extname(e.name))) out.push(p);
  }
}

const files = [];
for (const r of ROOTS) walk(r, files);

const findings = [];
const add = (sev, file, line, type) => findings.push({ sev, file, line, type });

// possible-sensitive-log: only flag when a sensitive token is actually used as a
// VALUE — interpolated (`${...token...}`) or passed as an argument (`(token)` /
// `, token)`). This avoids false positives on prose like "la cookie no se relee".
const SENS_LOG = "xml|base64|pdfBase64|prompt|payload|serviceRole|service_role|passphrase|cookie|secret";
const LOG_INTERP = new RegExp("console\\.(?:log|error|warn|info|debug)\\s*\\([^)]*\\$\\{[^}]*\\b(?:" + SENS_LOG + ")\\b", "i");
const LOG_BARE = new RegExp("console\\.(?:log|error|warn|info|debug)\\s*\\([^)]*\\b(?:" + SENS_LOG + ")\\s*[),]", "i");

for (const f of files) {
  let content;
  try {
    if (statSync(f).size > 2 * 1024 * 1024) continue;
    content = readFileSync(f, "utf8");
  } catch { continue; }

  const isClient = /^\s*['"]use client['"]/m.test(content);
  const isScript = f.startsWith("scripts/") || f.startsWith("scripts\\");
  const hasDestructive = /\.delete\s*\(|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i.test(content);
  const usesAdmin = /SERVICE_ROLE|service_role|createClient/.test(content);
  const hasGuard = /MASSDTE_ALLOW_PROD_WIPE|ROLLBACK|i-understand|DRY-?RUN/i.test(content);

  // Fuzzy: a destructive admin script with no visible prod guard. (warn in v1)
  if (isScript && hasDestructive && usesAdmin && !hasGuard) {
    add("warn", f, 1, "destructive-script-without-prod-guard");
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const n = i + 1;
    // Unambiguous: service role key referenced from a client component. (block)
    if (isClient && /SERVICE_ROLE_KEY|service_role/.test(ln)) {
      add("critical", f, n, "service-role-in-client");
    }
    if (/(local|session)Storage\.setItem\(\s*['"`][^'"`]*(token|cert|caf|xml|pdf|base64|rut|passphrase|secret|service_role)/i.test(ln)) {
      add("warn", f, n, "sensitive-data-in-web-storage");
    }
    if (LOG_INTERP.test(ln) || LOG_BARE.test(ln)) {
      add("warn", f, n, "possible-sensitive-log");
    }
  }
}

const crit = findings.filter((x) => x.sev === "critical");
const warn = findings.filter((x) => x.sev === "warn");

if (crit.length) {
  console.error(`audit:safety — ${crit.length} CRITICAL finding(s):`);
  for (const x of crit) console.error(`  [crit] ${x.file}:${x.line}  ${x.type}`);
}
if (warn.length) {
  console.log(`audit:safety — ${warn.length} warning(s):`);
  for (const x of warn) console.log(`  [warn] ${x.file}:${x.line}  ${x.type}`);
}
if (!crit.length && !warn.length) {
  console.log("audit:safety OK — no risky patterns found.");
}
process.exit(crit.length ? 1 : 0);
