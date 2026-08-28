/**
 * Genera una MUESTRA de la factura personalizada usando un documento REAL ya
 * emitido: baja el PDF oficial de R2, le saca el timbre auténtico, lee los
 * datos impresos y arma la cara con marca. Sirve para mirar el diseño antes de
 * mergearlo, sin tener que emitir nada ni levantar la app.
 *
 *   npx tsx --env-file=.env.local scripts/muestra-factura-personalizada.ts [folio] [destino]
 *
 * Sin folio toma la factura emitida más reciente. Correr desde la RAÍZ del repo.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { downloadFromR2 } from "../src/lib/r2";
import { extraerTimbrePng } from "../src/lib/pdf/timbre-extract";
import { leerDatosOficialesDte } from "../src/lib/pdf/datos-oficiales-dte";
import { generarFacturaPersonalizada } from "../src/lib/pdf/factura-personalizada";

const folioPedido = process.argv[2] ? Number(process.argv[2]) : null;
const destino = process.argv[3] ?? `/tmp/muestra-factura-${folioPedido ?? "ultima"}.pdf`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usa --env-file=.env.local)");

const db = createClient(url, key, { auth: { persistSession: false } });

let q = db
  .from("boletas_emitidas")
  .select(
    "id, empresa_id, tipo_dte, folio, fecha_emision, medio_pago, detalles, monto_neto, monto_exento, iva, monto_total, receptor_razon_social, receptor_rut, receptor_giro, receptor_direccion, receptor_comuna, emisor_razon_social, emisor_rut, emisor_giro, emisor_direccion, emisor_comuna, proveedor_respuesta",
  )
  .in("tipo_dte", [33, 34])
  .order("created_at", { ascending: false })
  .limit(1);
if (folioPedido) q = q.eq("folio", folioPedido);

const { data, error } = await q.maybeSingle();
if (error) throw new Error(error.message);
if (!data) throw new Error(folioPedido ? `No hay factura con folio ${folioPedido}` : "No hay facturas emitidas");

// Logo de la empresa, igual que hace la ruta de producción: mismo bucket, mismo
// nombre de archivo. Sin esto la muestra mentía — salía siempre sin logo.
let logo: { data: Buffer; formato: "PNG" | "JPEG" } | null = null;
if (data.empresa_id) {
  const dir = `${data.empresa_id}/logos`;
  const { data: files } = await db.storage.from("documentos").list(dir);
  const archivo = files?.find((x) => x.name.startsWith("logo.") && !x.name.endsWith(".svg"));
  if (archivo) {
    const ext = archivo.name.split(".").pop()?.toLowerCase();
    const formato = ext === "png" ? "PNG" : ext === "jpg" || ext === "jpeg" ? "JPEG" : null;
    if (formato) {
      const { data: blob } = await db.storage.from("documentos").download(`${dir}/${archivo.name}`);
      if (blob) logo = { data: Buffer.from(await blob.arrayBuffer()), formato };
    }
  }
}
console.log(`logo de la empresa: ${logo ? "SÍ" : "no tiene"}`);

const pdfMeta = (data.proveedor_respuesta as { pdf?: { storage_path?: string; provider?: string } } | null)?.pdf;
if (!pdfMeta?.storage_path) throw new Error(`El folio ${data.folio} no tiene PDF oficial guardado`);
if (pdfMeta.provider !== "r2") throw new Error(`El PDF del folio ${data.folio} no está en R2 (provider=${pdfMeta.provider})`);

const oficial = new Uint8Array(await downloadFromR2(pdfMeta.storage_path));
const timbre = await extraerTimbrePng(oficial);
if (!timbre?.png) throw new Error("No se pudo extraer el timbre del PDF oficial");

const leido = await leerDatosOficialesDte(oficial);
const folioOk = leido.folio == null || leido.folio === data.folio;
const totalOk = leido.montoTotal == null || Math.abs(leido.montoTotal - data.monto_total) <= 1;
const usarOficial = folioOk && totalOk;

console.log(`folio ${data.folio} · tipo ${data.tipo_dte} · total ${data.monto_total}`);
console.log(`lectura del original: ${usarOficial ? "OK" : "DESCARTADA (no cotejó)"}`);
if (usarOficial) {
  console.log(`  unidad SII : ${leido.unidadSii ?? "—"}`);
  console.log(`  fecha      : ${leido.fechaEmisionTexto ?? "—"}`);
  console.log(`  forma pago : ${leido.formaPago ?? "—"}`);
  console.log(`  receptor   : ${leido.receptor.razonSocial ?? "—"} / ${leido.receptor.giro ?? "—"}`);
}

type Detalle = { nombre?: unknown; monto?: unknown; cantidad?: unknown; qty?: unknown };
const detalles = (Array.isArray(data.detalles) ? (data.detalles as Detalle[]) : [])
  .map((d) => ({
    nombre: typeof d?.nombre === "string" && d.nombre.trim() ? d.nombre.trim() : "Venta",
    monto: typeof d?.monto === "number" ? d.monto : data.monto_total,
    cantidad: typeof d?.cantidad === "number" ? d.cantidad : typeof d?.qty === "number" ? d.qty : null,
  }))
  .slice(0, 12);
if (detalles.length === 0) {
  detalles.push({ nombre: data.tipo_dte === 34 ? "Venta exenta" : "Venta", monto: data.monto_total, cantidad: 1 });
}

const pdf = generarFacturaPersonalizada({
  folio: data.folio,
  tipoDte: data.tipo_dte,
  fechaEmision: data.fecha_emision,
  fechaEmisionTexto: usarOficial ? leido.fechaEmisionTexto : null,
  unidadSii: usarOficial ? leido.unidadSii : null,
  formaPago: (usarOficial ? leido.formaPago : null) ?? data.medio_pago ?? null,
  emisor: {
    razonSocial: data.emisor_razon_social,
    rut: data.emisor_rut,
    giro: data.emisor_giro,
    direccion: data.emisor_direccion,
    comuna: data.emisor_comuna,
  },
  receptor: {
    razonSocial: (usarOficial ? leido.receptor.razonSocial : null) ?? data.receptor_razon_social,
    rut: (usarOficial ? leido.receptor.rut : null) ?? data.receptor_rut,
    giro: (usarOficial ? leido.receptor.giro : null) ?? data.receptor_giro,
    direccion: (usarOficial ? leido.receptor.direccion : null) ?? data.receptor_direccion,
    comuna: (usarOficial ? leido.receptor.comuna : null) ?? data.receptor_comuna,
    ciudad: usarOficial ? leido.receptor.ciudad : null,
  },
  detalles,
  montoNeto: data.monto_neto,
  montoExento: data.monto_exento,
  iva: data.iva,
  montoTotal: data.monto_total,
  timbrePng: timbre.png,
  logo,
});

writeFileSync(destino, pdf);
console.log(`\nmuestra escrita en ${destino}`);
