// Migra archivos de documentos_subidos de Supabase Storage → Cloudflare R2.
//
// SEGURO Y REVERSIBLE:
//  - Sube a R2 reusando la MISMA key (= storage_path actual) → no cambia storage_path.
//  - Solo flipea storage_provider a 'r2'. Rollback = volver storage_provider a 'supabase'.
//  - NO borra el original de Supabase (queda como respaldo).
//
// Uso (desde la raíz del repo):
//   node scripts/migrar-storage-r2.mjs            # dry-run (solo lista)
//   node scripts/migrar-storage-r2.mjs --apply    # aplica
//
// Lee credenciales de .env.local (NUNCA las imprime).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET;

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv" };
const mimeOf = (name) => MIME[(name.split(".").pop() ?? "").toLowerCase()] ?? "application/octet-stream";

const { data: docs, error } = await sb
  .from("documentos_subidos")
  .select("id, nombre_archivo, storage_path, storage_provider")
  .neq("storage_path", "memoria")
  .not("storage_path", "is", null);
if (error) { console.error("Error consultando docs:", error.message); process.exit(1); }

const pend = (docs ?? []).filter((d) => (d.storage_provider ?? "supabase") === "supabase");
console.log(`${pend.length} archivos en Supabase a migrar (apply=${APPLY})\n`);

let ok = 0, fail = 0;
for (const d of pend) {
  const { data: file, error: dlErr } = await sb.storage.from("documentos").download(d.storage_path);
  if (dlErr || !file) { console.log(`  SKIP ${d.id}: no se pudo bajar (${dlErr?.message ?? "sin archivo"})`); fail++; continue; }
  const buf = Buffer.from(await file.arrayBuffer());
  console.log(`  ${d.id}  ${buf.length}b  ${d.storage_path}`);
  if (!APPLY) continue;
  try {
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: d.storage_path, Body: buf, ContentType: mimeOf(d.nombre_archivo ?? d.storage_path) }));
    const { error: upErr } = await sb.from("documentos_subidos").update({ storage_provider: "r2" }).eq("id", d.id);
    if (upErr) { console.log(`    UPDATE FAIL: ${upErr.message}`); fail++; }
    else { console.log("    OK → r2"); ok++; }
  } catch (e) {
    console.log(`    R2 UPLOAD FAIL: ${e.message}`); fail++;
  }
}
console.log(`\nListo. ok=${ok} fail=${fail}${APPLY ? "" : " (dry-run, nada cambió)"}`);
