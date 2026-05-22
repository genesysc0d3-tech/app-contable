const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Read .env.local manually
const envPath = path.join(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = Object.fromEntries(
  envContent.split("\n").filter(l => l.trim() && !l.startsWith("#")).map(l => {
    const idx = l.indexOf("=");
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
  })
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function reset() {
  const tables = [
    "items_documento",
    "boletas_emitidas",
    "gastos",
    "documentos_tributarios",
    "propuestas_ia",
    "movimientos_raw",
    "ia_uso",
    "audit_chunks",
    "parser_logs",
    "documentos_subidos",
    "boletas_caf_mock",
    "creditos_uso",
    "periodos_contables",
  ];
  for (const t of tables) {
    const { error } = await supabase.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    console.log(t, error ? "ERROR: " + error.message : "OK");
  }
  console.log("Done");
}
reset().catch(console.error);
