#!/usr/bin/env node
// audit:secrets — flags likely secrets in TRACKED files. Reports file:line:type,
// NEVER the value. Exit 1 on any critical finding. No dependencies.
//
// Scope: prevents NEW secrets from entering the repo. It does not scan git
// history (that was a one-time manual pass; rotate anything found there).
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  { type: "jwt-token", sev: "critical", re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { type: "aws-access-key", sev: "critical", re: /AKIA[0-9A-Z]{16}/ },
  { type: "github-token", sev: "critical", re: /gh[posr]_[A-Za-z0-9]{30,}/ },
  { type: "private-key", sev: "critical", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { type: "service-role-assignment", sev: "critical", re: /SERVICE_ROLE_KEY['"]?\s*[:=]\s*['"]?eyJ/ },
  { type: "generic-secret-assignment", sev: "warn", re: /(?:secret|password|passwd|api[_-]?key|access[_-]?token)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i },
];

const ALLOW_FILE = /\.(example|sample)$/i;
const ALLOW_LINE = /example|placeholder|your[-_]|change[-_]?me|xxxx|<[^>]+>|dummy|fake|redacted|REPLACE|REEMPLAZA/i;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|map|lock)$/i;

let files = [];
try {
  files = execSync("git ls-files", { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
    .split("\n").filter(Boolean);
} catch {
  console.error("audit:secrets: not a git repo or git unavailable");
  process.exit(2);
}

const findings = [];
for (const f of files) {
  if (ALLOW_FILE.test(f) || SKIP_EXT.test(f)) continue;
  let content;
  try {
    if (statSync(f).size > 2 * 1024 * 1024) continue;
    content = readFileSync(f, "utf8");
  } catch { continue; }
  if (content.indexOf("\x00") !== -1) continue; // skip binary (null byte)
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW_LINE.test(line)) continue;
    for (const p of PATTERNS) {
      if (p.re.test(line)) findings.push({ file: f, line: i + 1, type: p.type, sev: p.sev });
    }
  }
}

const crit = findings.filter((x) => x.sev === "critical");
const warn = findings.filter((x) => x.sev === "warn");

if (crit.length) {
  console.error(`audit:secrets — ${crit.length} CRITICAL (values not shown):`);
  for (const x of crit) console.error(`  [crit] ${x.file}:${x.line}  ${x.type}`);
}
if (warn.length) {
  console.log(`audit:secrets — ${warn.length} warning(s):`);
  for (const x of warn) console.log(`  [warn] ${x.file}:${x.line}  ${x.type}`);
}
if (!crit.length && !warn.length) {
  console.log("audit:secrets OK — no likely secrets in tracked files.");
}
if (crit.length) {
  console.error("\nIf real: remove it, ROTATE the credential, move it to an ignored env file.");
}
process.exit(crit.length ? 1 : 0);
