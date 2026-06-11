// Test de conexión a Cloudflare R2: sube un archivito, lo verifica y lo borra.
// No imprime claves. Correr con las vars de .env.local:
//   node --env-file=.env.local scripts/r2-test.mjs
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.log("✗ Faltan variables R2 en el entorno.");
  process.exit(1);
}
console.log(`endpoint: ${new URL(R2_ENDPOINT).host} | bucket: ${R2_BUCKET}`);

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const key = `_test/conexion-${Date.now()}.pdf`;
// Buffer binario tipo PDF (header %PDF) para validar igual que un PDF real.
const body = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("massdte r2 test\n"), Buffer.from([0x25, 0x25, 0x45, 0x4f, 0x46])]);
try {
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: "application/pdf" }));
  console.log("✓ subida OK:", key, `(${body.length} bytes)`);
  const h = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  console.log("✓ verificada (Head) —", h.ContentLength, "bytes, type:", h.ContentType);
  const g = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const back = Buffer.from(await g.Body.transformToByteArray());
  console.log(back.equals(body) ? "✓ descarga OK — bytes idénticos (round-trip exacto)" : "✗ descarga: bytes NO coinciden");
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  console.log("✓ borrada (test limpio). 🎉 R2 sube y baja de punta a punta.");
} catch (e) {
  console.log("✗ ERROR:", e.name, "-", e.message);
  process.exit(1);
}
