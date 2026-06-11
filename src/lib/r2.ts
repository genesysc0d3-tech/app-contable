import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cliente Cloudflare R2 (S3-compatible). Los archivos pesados (PDFs de boletas,
// cartolas) van DIRECTO a R2 — nunca pasan por Supabase, así no consumen ni su
// storage ni su egress. R2 además no cobra egress. Las claves vienen de
// .env.local (gitignored): R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
// / R2_BUCKET / R2_PUBLIC_URL (opcional).

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET,
  );
}

let cliente: S3Client | null = null;
function r2Client(): S3Client {
  if (!cliente) {
    cliente = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return cliente;
}

/** Sube un objeto a R2. Devuelve la key y, si hay R2_PUBLIC_URL, la URL pública. */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string | null }> {
  await r2Client().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  const pub = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  return { key, url: pub ? `${pub}/${key}` : null };
}

/** URL firmada de lectura (para servir un objeto privado por tiempo limitado). */
export async function r2SignedGetUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(
    r2Client(),
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Baja un objeto de R2 como Buffer (para servirlo desde una ruta del server). */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const res = await r2Client().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  if (!res.Body) throw new Error("R2_EMPTY_BODY");
  const bytes = await (res.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}
