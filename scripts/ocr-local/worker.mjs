#!/usr/bin/env node
// Worker de OCR para el Mac mini.
//
// Corre 24/7 en el mini (launchd). Se conecta HACIA AFUERA a Supabase, escucha
// el canal `ocr_job_pendiente` y, apenas entra un trabajo, saca la imagen, la
// pasa por el binario Vision (./ocr) y escribe el texto de vuelta en la cola.
//
// No abre ningún puerto. La única credencial que necesita el mini es la
// connection string de Postgres (la misma del respaldo nocturno). La imagen se
// baja por una URL firmada de vida corta que el encolador deja en
// metadata.image_url, así el mini tampoco necesita llaves de R2/Storage.
//
// Diseño a prueba de caídas:
//  - Si el mini está apagado, el job queda 'pendiente'. Al arrancar, el worker
//    hace un barrido de recuperación (no depende solo del NOTIFY, que se pierde
//    si nadie escucha).
//  - Un job 'procesando' con lock viejo (mini murió a mitad) se re-toma.
//  - Falla la imagen o el binario → vuelve a 'pendiente' hasta max_intentos,
//    luego 'error'. El pipeline puede caer a un respaldo remoto si ve 'error'.
//
// Uso:  DATABASE_URL=... OCR_BIN=./ocr node worker.mjs

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const OCR_BIN = process.env.OCR_BIN || new URL("./ocr", import.meta.url).pathname;
const WORKER_ID = `mini-${process.env.HOSTNAME || "local"}-${process.pid}`;
// Red de seguridad por si un NOTIFY se pierde (reconexión, carrera): además de
// escuchar, barre la cola cada tanto. No es el camino normal, es el respaldo.
const BARRIDO_MS = Number(process.env.OCR_SWEEP_MS || 30_000);
// Un job 'procesando' bloqueado hace más de esto se considera colgado (el mini
// murió a mitad) y se puede re-tomar.
const LOCK_VIEJO_MS = Number(process.env.OCR_STALE_MS || 120_000);
const MAX_BYTES = 8 * 1024 * 1024;

if (!DATABASE_URL) {
  console.error("[ocr-worker] falta DATABASE_URL");
  process.exit(2);
}

const log = (...a) => console.log(new Date().toISOString(), "[ocr-worker]", ...a);

/** Corre el binario Vision sobre un archivo y devuelve su JSON (una entrada). */
function correrOcr(rutaImagen) {
  return new Promise((resolve, reject) => {
    const p = spawn(OCR_BIN, [rutaImagen], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0 && !out.trim()) {
        return reject(new Error(`ocr salió ${code}: ${err.trim() || "sin salida"}`));
      }
      try {
        const arr = JSON.parse(out);
        resolve(Array.isArray(arr) ? arr[0] : arr);
      } catch (e) {
        reject(new Error(`no pude parsear la salida del ocr: ${e.message}`));
      }
    });
  });
}

/** Baja la imagen del job a un archivo temporal. Devuelve la ruta y un cleanup. */
async function bajarImagen(job) {
  const url = job.metadata?.image_url;
  if (!url) throw new Error("el job no trae metadata.image_url (URL firmada)");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`descarga falló: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`imagen ${buf.length}B > tope ${MAX_BYTES}B`);
  const dir = await mkdtemp(join(tmpdir(), "ocrjob-"));
  const ext = (job.metadata?.mime || "").includes("png") ? "png" : "jpg";
  const ruta = join(dir, `img.${ext}`);
  await writeFile(ruta, buf);
  return { ruta, limpiar: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Toma UN job pendiente (o uno 'procesando' colgado) de forma atómica.
 * FOR UPDATE SKIP LOCKED evita que dos workers agarren el mismo.
 */
async function tomarJob(client) {
  const { rows } = await client.query(
    `update public.ocr_jobs set
        estado='procesando', locked_at=now(), locked_by=$1,
        intentos=intentos+1, updated_at=now()
     where id = (
       select id from public.ocr_jobs
       where (estado='pendiente'
              or (estado='procesando' and locked_at < now() - ($2 || ' milliseconds')::interval))
         and intentos < max_intentos
       order by created_at
       for update skip locked
       limit 1
     )
     returning id, empresa_id, documento_id, storage_path, storage_provider,
               intentos, max_intentos, metadata`,
    [WORKER_ID, LOCK_VIEJO_MS],
  );
  return rows[0] || null;
}

async function marcarListo(client, id, resultado) {
  await client.query(
    `update public.ocr_jobs
       set estado='listo', resultado=$2, last_error=null, locked_at=null, updated_at=now()
     where id=$1`,
    [id, resultado],
  );
}

async function marcarFallo(client, job, mensaje) {
  // Si aún quedan intentos, vuelve a 'pendiente' (se reintenta). Si no, 'error'
  // definitivo → el pipeline puede caer a un respaldo remoto.
  const agotado = job.intentos >= job.max_intentos;
  await client.query(
    `update public.ocr_jobs
       set estado=$2, last_error=$3, locked_at=null, updated_at=now()
     where id=$1`,
    [job.id, agotado ? "error" : "pendiente", mensaje.slice(0, 500)],
  );
  log(agotado ? "ERROR definitivo" : "reintentará", job.id, "-", mensaje);
}

async function procesarUno(client) {
  const job = await tomarJob(client);
  if (!job) return false;
  log("tomado", job.id, `(intento ${job.intentos}/${job.max_intentos})`);
  let limpiar = () => {};
  try {
    const img = await bajarImagen(job);
    limpiar = img.limpiar;
    const t0 = Date.now();
    const r = await correrOcr(img.ruta);
    await marcarListo(client, job.id, {
      text: r.text ?? "",
      lines: r.lines ?? [],
      confianza: r.confianza ?? null,
      ms: r.ms ?? Date.now() - t0,
      motor: "vision-mini",
    });
    log("listo", job.id, `${r.ms ?? "?"}ms conf=${r.confianza ?? "?"}`);
  } catch (e) {
    await marcarFallo(client, job, e.message || String(e));
  } finally {
    await limpiar();
  }
  return true;
}

/** Drena: procesa jobs hasta que no quede ninguno. */
async function drenar(client) {
  // eslint-disable-next-line no-await-in-loop
  while (await procesarUno(client)) {
    /* sigue hasta vaciar */
  }
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  log("conectado como", WORKER_ID);

  client.on("notification", () => {
    drenar(client).catch((e) => log("error drenando:", e.message));
  });
  client.on("error", (e) => {
    log("conexión caída:", e.message, "- saliendo para que launchd reinicie");
    process.exit(1);
  });

  await client.query("LISTEN ocr_job_pendiente");

  // Barrido inicial: recupera lo que quedó pendiente mientras el mini no estaba.
  await drenar(client);
  // Barrido periódico: red de seguridad por si se pierde un NOTIFY.
  setInterval(() => {
    drenar(client).catch((e) => log("error en barrido:", e.message));
  }, BARRIDO_MS);

  log("escuchando ocr_job_pendiente (barrido cada", BARRIDO_MS, "ms)");
}

main().catch((e) => {
  console.error("[ocr-worker] fatal:", e);
  process.exit(1);
});
