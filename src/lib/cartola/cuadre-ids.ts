import { createHash } from "crypto";

/**
 * Ids DETERMINISTAS de lo que "Agregarlos" inserta (uuid v5, RFC 4122): la
 * misma fila del mismo documento da siempre el mismo id. Así el upsert con
 * ignoreDuplicates es idempotente pase lo que pase — doble click, dos
 * pestañas con una foto vieja, reintento tras un corte. Solo servidor (crypto).
 */
const NS_MOVIMIENTO = "6f1c2b1e-8d4a-5c3e-9b7f-2a1d4e6c8b01";
const NS_PROPUESTA = "a3e9d7c5-1b2f-5e4a-8c6d-9f0b1a2c3d02";

export function uuidV5(nombre: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(nombre, "utf8")])).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function idsRecuperacion(documentoId: string) {
  return (clave: string) => ({
    movimiento_id: uuidV5(`${documentoId}:${clave}`, NS_MOVIMIENTO),
    propuesta_id: uuidV5(`${documentoId}:${clave}`, NS_PROPUESTA),
  });
}
