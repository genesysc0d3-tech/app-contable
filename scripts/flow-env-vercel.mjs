#!/usr/bin/env node
/**
 * Sube las llaves de PRODUCCIÓN de Flow a Vercel (solo target production).
 *
 * Lee .flow/production.json (lo deja el formulario local; gitignoreado) y el
 * token de .vercel/token. Antes de subir NADA, verifica las llaves en vivo
 * contra la API de producción de Flow: llaves que no responden 200 no viajan.
 *
 * NO redeploya a propósito: subir las envs no cambia nada hasta el próximo
 * deploy, y encender Flow para clientes reales es decisión del fundador, no
 * efecto colateral de un script.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");

const { apiKey, secretKey } = JSON.parse(leer(".flow/production.json"));
const token = leer(".vercel/token").trim();
const { projectId, orgId } = JSON.parse(leer(".vercel/project.json"));
if (!apiKey || !secretKey) { console.error("Faltan llaves en .flow/production.json"); process.exit(1); }

// ── 1. Verificar contra Flow PRODUCCIÓN (solo lectura: plans/list) ──
const params = { apiKey };
const cadena = Object.keys(params).sort().map((k) => k + params[k]).join("");
params.s = createHmac("sha256", secretKey).update(cadena, "utf8").digest("hex");
const q = new URLSearchParams(params).toString();
const res = await fetch(`https://www.flow.cl/api/plans/list?${q}`);
if (res.status !== 200) {
  console.error(`✗ Flow producción respondió HTTP ${res.status} — llaves malas o de sandbox. NO se subió nada.`);
  console.error("  ", (await res.text()).slice(0, 120));
  process.exit(1);
}
console.log("✓ Llaves verificadas contra Flow producción (HTTP 200)");

// ── 2. Subir a Vercel (upsert, solo production) ──
const envs = [
  { key: "FLOW_API_KEY", value: apiKey, type: "encrypted" },
  { key: "FLOW_SECRET_KEY", value: secretKey, type: "sensitive" },
  { key: "FLOW_ENV", value: "production", type: "encrypted" },
];
const url = `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${orgId}&upsert=true`;
for (const e of envs) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...e, target: ["production"] }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`✗ ${e.key}: HTTP ${r.status}`, JSON.stringify(body.error ?? body).slice(0, 150)); process.exit(1); }
  console.log(`✓ ${e.key} → Vercel (production)`);
}
console.log("\nListo. Las envs rigen desde el PRÓXIMO deploy de main — ese deploy enciende Flow para clientes reales.");
