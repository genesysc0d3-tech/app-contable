import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { recordCuentaAudit } from "@/lib/audit/account";
import { computeFingerprint, encabezadoNormalizado } from "@/lib/parsers/fingerprint";
import { upsertManualAdapter } from "@/lib/parsers/adapter-store";
import { bajarCartola, esPlanillaMapeable, clienteServicio, configDelCliente, configValida } from "@/lib/parsers/documento-cartola";
import { juzgarArchivo } from "@/lib/parsers/resumen-mapa";

/**
 * "Listo" del popup "Revisa las columnas" (2026-09-30). El cliente eligió las
 * columnas (o dijo "Mi cartola trae solo abonos"). El server vuelve a juzgar el
 * archivo COMPLETO con ese mapa (la UI puede fallar):
 *   - si el saldo o los totales del banco lo contradicen → 422, no se guarda;
 *   - "solo abonos" solo si la cartola de verdad viene filtrada;
 * y guarda el mapa como del CLIENTE, SOLO para su empresa (nunca global), con
 * la revisión de ESTE documento: el reproceso que sigue, si lee lo mismo, queda
 * sellado "cliente". Las siguientes cartolas del formato entran solas.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).single();
  if (!usuario?.empresa_id) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });
  const empresaId = usuario.empresa_id;

  // Modo soporte = solo lectura: guardar columnas MUTA los datos del cliente.
  const writeBlock = await getDevSupportWriteBlock("parser_save_mapping");
  if (writeBlock) return NextResponse.json({ error: writeBlock.error }, { status: 403 });

  // Del body solo se toman el documento, el mapa y las dos decisiones; el dueño
  // es SIEMPRE la empresa del usuario (nada de empresa_id/global desde afuera).
  const body = (await request.json().catch(() => ({}))) as { documento_id?: string; config?: unknown; reprocess?: boolean; solo_abonos?: boolean; es_banco?: boolean };
  const documentoId = body.documento_id;
  if (!documentoId) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  if (!configValida(body.config)) return NextResponse.json({ error: "config inválido" }, { status: 400 });
  const config = configDelCliente(body.config);
  const soloAbonos = body.solo_abonos === true;

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, tipo, storage_provider, storage_path, empresa_id")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .single();
  if (!documento) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (!esPlanillaMapeable(documento.tipo)) return NextResponse.json({ error: "Solo planillas" }, { status: 400 });

  let archivo: Awaited<ReturnType<typeof bajarCartola>>;
  try { archivo = await bajarCartola(supabase, documento, { cache: true }); }
  catch { return NextResponse.json({ error: "Archivo no disponible" }, { status: 500 }); }

  // PDF sin marca propia de banco (vuelta 6, A2): el "Listo" exige que el
  // cliente diga "Sí, es mi cartola" (si no lo es, va por /api/parser/no-es-cartola).
  if (archivo.pdfSinMarcaBanco && body.es_banco !== true) {
    // Una UI vieja (sin la pregunta) llega acá sin es_banco: que recargue.
    return NextResponse.json({ error: "Recarga la página para continuar: falta confirmar si este PDF es de tu banco", pregunta_banco: true }, { status: 422 });
  }
  // Ya confirmado antes para el formato: la confirmación viaja al mapa nuevo
  // (aunque cambien las columnas, la fila nueva gana en la caché).
  const esBanco = archivo.bancoConfirmado || (archivo.pdfSinMarcaBanco && body.es_banco === true);
  const { resumen, rows } = juzgarArchivo(archivo.buf, config, { pdfSinMarcaBanco: archivo.pdfSinMarcaBanco });
  if (!resumen.valido || !rows) {
    return NextResponse.json({ error: resumen.error ?? "Con estas columnas no se puede leer la cartola" }, { status: 422 });
  }
  if (soloAbonos && !resumen.soloAbonos) {
    return NextResponse.json({ error: "Tu cartola no parece traer solo abonos: revisa las columnas" }, { status: 422 });
  }
  if (!soloAbonos && !resumen.guardable) {
    return NextResponse.json({ error: "Tu banco no calza con estas columnas (saldo o totales): revísalas" }, { status: 422 });
  }

  const titulos = encabezadoNormalizado(rows);
  const adapterId = await upsertManualAdapter({
    fingerprint: computeFingerprint(rows),
    empresaId,
    nombre: `Columnas del cliente (${resumen.hoja ?? "hoja"})`,
    config: {
      ...config,
      ...(titulos ? { titulos } : {}),
      revision_cliente: { documento_id: documentoId, firma: resumen.firma, ...(soloAbonos ? { solo_abonos: true } : {}), ...(esBanco ? { es_banco: true } : {}) },
    },
    confirmadoPor: "cliente",
  });
  if (!adapterId) return NextResponse.json({ error: "No se pudieron guardar las columnas" }, { status: 500 });

  const sb = clienteServicio();
  if (sb) {
    await recordCuentaAudit({
      sb,
      empresaId,
      usuarioId: user.id,
      accion: "cartola_lectura_confirmada",
      recursoTipo: "documento_subido",
      recursoId: documentoId,
      // Sin glosas ni montos de terceros: solo cómo se confirmó.
      resumen: soloAbonos ? "Columnas de la cartola confirmadas: trae solo abonos" : "Columnas de la cartola confirmadas por el cliente",
      metadata: { accion: soloAbonos ? "solo_abonos" : "columnas", estado: resumen.estado, ...(esBanco ? { es_banco: true } : {}) },
    });
  }

  let reprocessStarted = false;
  if (body.reprocess) {
    try {
      const origin = new URL(request.url).origin;
      const cookie = request.headers.get("cookie") ?? "";
      const res = await fetch(`${origin}/api/procesar-documento`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ documento_id: documentoId }),
      });
      reprocessStarted = res.ok;
    } catch (err) {
      console.error("[save-mapping] reprocess error:", err);
    }
  }

  return NextResponse.json({ ok: true, adapter_id: adapterId, reprocessStarted });
}
