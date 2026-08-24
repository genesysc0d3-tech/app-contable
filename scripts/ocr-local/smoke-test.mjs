#!/usr/bin/env node
// Prueba de humo end-to-end del worker de OCR, SIN tocar el pipeline de prod.
//
// Inserta un ocr_job apuntando a una imagen (URL pública o firmada), espera a
// que el worker lo procese, e imprime el texto extraído. Corre el worker en otra
// terminal antes de esto.
//
// Uso:
//   DATABASE_URL=... EMPRESA_ID=<uuid> IMAGE_URL=https://... node smoke-test.mjs
//
// EMPRESA_ID debe ser una empresa real (hay FK). En dev, usa una desechable.

import pg from "pg";

const { DATABASE_URL, EMPRESA_ID, IMAGE_URL } = process.env;
if (!DATABASE_URL || !EMPRESA_ID || !IMAGE_URL) {
  console.error("faltan envs: DATABASE_URL, EMPRESA_ID, IMAGE_URL");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `insert into public.ocr_jobs (empresa_id, storage_path, storage_provider, metadata)
     values ($1, $2, 'r2', jsonb_build_object('image_url', $3::text))
     returning id`,
    [EMPRESA_ID, "smoke-test", IMAGE_URL],
  );
  const id = rows[0].id;
  console.log("job insertado:", id, "- esperando al worker...");

  const t0 = Date.now();
  for (;;) {
    const { rows: r } = await c.query(
      "select estado, resultado, last_error from public.ocr_jobs where id=$1",
      [id],
    );
    const job = r[0];
    if (job.estado === "listo") {
      console.log(`\n✅ LISTO en ${Date.now() - t0}ms\n`);
      console.log(job.resultado.text);
      break;
    }
    if (job.estado === "error") {
      console.error("\n❌ ERROR:", job.last_error);
      process.exitCode = 1;
      break;
    }
    if (Date.now() - t0 > 60_000) {
      console.error("\n⌛ timeout: el worker no lo procesó en 60s (¿está corriendo?)");
      process.exitCode = 1;
      break;
    }
    await sleep(500);
  }

  // Limpieza: borrar el job de prueba.
  await c.query("delete from public.ocr_jobs where id=$1", [id]);
  await c.end();
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
