/**
 * Procesamiento de una plantilla de facturas — el "processor" de la mesa
 * Facturas. Determinístico de punta a punta: cero IA, cero tokens, cero
 * clasificador. Cada fila de la plantilla ES una factura que el usuario
 * decidió emitir (criterio 1 de Matías: el sistema ejecuta, no interpreta).
 *
 * Mantiene la cadena de siempre (documento → movimiento → propuesta): cada
 * fila crea su movimientos_raw, así Deshacer/Eliminar/editores funcionan
 * igual que en boletas sin tocar una línea de ellos.
 *
 * Toda propuesta nace 'pendiente': el juicio es SIEMPRE humano — la revisión
 * del lote (con su forma de pago obligatoria) es donde el usuario decide.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import * as XLSX from "xlsx";
import { chileDateString } from "../chile-date";
import { derivarMontosFactura, parsePlantillaFacturas, type FilaCruda } from "./plantilla";

type Sb = SupabaseClient<Database>;

export async function procesarPlantillaFacturas(
  sb: Sb,
  args: { documentoId: string; empresaId: string; buffer: Buffer },
): Promise<{ movimientos_total: number }> {
  const workbook = XLSX.read(args.buffer, { type: "buffer", cellDates: true });
  const hoja = workbook.Sheets[workbook.SheetNames[0]];
  const rows = hoja ? XLSX.utils.sheet_to_json<FilaCruda>(hoja, { header: 1, defval: "" }) : [];

  const { facturas, errores } = parsePlantillaFacturas(rows);

  const { data: empresa } = await sb
    .from("empresas")
    .select("tipo_contribuyente")
    .eq("id", args.empresaId)
    .maybeSingle();
  const emisorExento = empresa?.tipo_contribuyente === "exento";

  const hoy = chileDateString();
  const advertencias: { fila: number; advertencia: string }[] = [];

  for (const f of facturas) {
    const montos = derivarMontosFactura(f.totalClp, emisorExento);
    if (montos.advertencia) advertencias.push({ fila: f.fila, advertencia: montos.advertencia });
    for (const aviso of f.advertencias) advertencias.push({ fila: f.fila, advertencia: aviso });

    const { data: mov, error: movErr } = await sb
      .from("movimientos_raw")
      .insert({
        documento_id: args.documentoId,
        empresa_id: args.empresaId,
        fecha: hoy,
        descripcion: f.detalle,
        monto: f.totalClp,
        tipo_flujo: "entrada",
        origen: "plantilla_facturas",
      })
      .select("id")
      .single();
    if (movErr) throw new Error(`No se pudo registrar la fila ${f.fila}: ${movErr.message}`);

    const { error: propErr } = await sb.from("propuestas_ia").insert({
      empresa_id: args.empresaId,
      movimiento_id: mov.id,
      mesa: "factura",
      estado: "pendiente",
      tipo_propuesto: emisorExento ? "factura_exenta" : "factura_afecta",
      tipo_dte: montos.tipoDte,
      monto_neto: montos.neto,
      iva: montos.iva,
      total: f.totalClp,
      detalle: f.detalle,
      receptor_rut: f.receptorRut,
      receptor_nombre: f.receptorRazonSocial,
      receptor_giro: f.receptorGiro || null,
      receptor_direccion: f.receptorDireccion,
      receptor_comuna: f.receptorComuna,
      receptor_email: f.receptorEmail,
      fuente_clasificacion: "plantilla_facturas",
      confianza: 1,
    });
    if (propErr) throw new Error(`No se pudo crear la factura de la fila ${f.fila}: ${propErr.message}`);
  }

  // Si NINGUNA fila sirvió, el documento es un error honesto, no un "procesado
  // con 0" silencioso.
  if (facturas.length === 0) {
    const motivo = errores[0]?.error ?? "La plantilla no tiene filas válidas";
    throw new Error(motivo);
  }

  await sb
    .from("documentos_subidos")
    .update({
      estado: "procesado",
      movimientos_detectados: facturas.length,
      progreso_ia: JSON.parse(JSON.stringify({
        estado: "completado",
        pipeline: "plantilla_facturas",
        filas_ok: facturas.length,
        // Filas malas y totales no-representables quedan A LA VISTA en el
        // documento (advertir sí, bloquear jamás — criterio 3).
        errores_filas: errores,
        advertencias,
      })),
    })
    .eq("id", args.documentoId);

  return { movimientos_total: facturas.length };
}
