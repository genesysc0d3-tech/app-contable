async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const fs = await import("node:fs");
  const path = await import("node:path");

  // Read .env.local manually
  const envPath = path.join(process.cwd(), ".env.local");
  const envContent = fs.readFileSync(envPath, "utf-8");
  const env = Object.fromEntries(
    envContent.split("\n").filter(l => l.trim() && !l.startsWith("#")).map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
  );

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "";

  // ── Guardia de producción ───────────────────────────────────────────────
  // Este script borra 13 tablas (incl. boletas_emitidas = DTEs reales) con el
  // service role, que se salta RLS. Se niega a correr contra el proyecto de
  // producción salvo override explícito del operador. Esto es lo que impide que
  // un agente (o un `npm run cb4w` despistado) destruya datos de clientes.
  const PROD_REF = "aluuuyecwifaakehvcam"; // ref del proyecto Supabase de prod
  const targetingProd = supabaseUrl.includes(PROD_REF);
  console.log("Target Supabase:", supabaseUrl || "(falta NEXT_PUBLIC_SUPABASE_URL)");
  if (targetingProd && process.env.MASSDTE_ALLOW_PROD_WIPE !== "1") {
    console.error(
      "\nME NIEGO: el target es el proyecto de PRODUCCIÓN (" + PROD_REF + ").\n" +
        "reset-db.js borra 13 tablas, incluida boletas_emitidas (DTEs reales).\n" +
        "Si de verdad quieres limpiar datos de prueba en producción, re-ejecuta con:\n" +
        "  MASSDTE_ALLOW_PROD_WIPE=1 npm run cb4w\n"
    );
    process.exit(1);
  }
  if (targetingProd && process.stdin.isTTY) {
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Escribe "WIPE PROD" para confirmar el borrado en producción: ');
    rl.close();
    if (answer.trim() !== "WIPE PROD") {
      console.error("abortado");
      process.exit(1);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const supabase = createClient(
    supabaseUrl,
    env.SUPABASE_SERVICE_ROLE_KEY
  );

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

main().catch(console.error);
