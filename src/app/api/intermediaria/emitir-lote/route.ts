import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { validarBoleta, RECEPTOR_OBLIGATORIO_DESDE } from "@/lib/sii/validation";
import { generarDTE, generarTED, generarTrackId } from "@/lib/sii/dte-xml";

/**
 * Emisión en lote: dado un array de propuesta_ids, emite una boleta por cada
 * propuesta válida. Retorna { emitidas, fallidas } para que la UI muestre
 * resumen.
 *
 * Procesa de forma SECUENCIAL para preservar el orden de folios. La función
 * SQL consume_next_folio es atómica con FOR UPDATE, así que si fueran
 * paralelas no habría folios duplicados — pero el orden de asignación
 * sería no determinístico, lo cual es confuso para el contador.
 */

const CONCURRENCY = 1; // secuencial — folios en orden

interface BatchItem {
  propuesta_id: string;
  ok: boolean;
  folio?: number;
  boleta_id?: string;
  monto_total?: number;
  error_code?: string;
  error_message?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, empresas(rut, razon_social, giro, direccion, comuna)")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  const empresa = usuario.empresas as unknown as {
    rut: string; razon_social: string; giro: string | null; direccion: string | null; comuna: string | null;
  } | null;
  if (!empresa?.rut) {
    return NextResponse.json({ ok: false, error: "EMPRESA_SIN_DATOS_FISCALES" }, { status: 422 });
  }

  let body: { propuesta_ids?: string[] } = {};
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.propuesta_ids) ? body.propuesta_ids.filter((x) => typeof x === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "SIN_PROPUESTAS" }, { status: 400 });
  }
  if (ids.length > 200) {
    return NextResponse.json({ ok: false, error: "DEMASIADAS_PROPUESTAS", detalle: "Máximo 200 por lote" }, { status: 400 });
  }

  // Fetch propuestas + cliente vinculado (filtradas por empresa por seguridad)
  const { data: propuestas, error: pErr } = await supabase
    .from("propuestas_ia")
    .select(`
      id, tipo_propuesto, receptor_nombre, receptor_rut, monto_neto, iva, total, estado,
      cliente_id,
      clientes(id, nombre, rut),
      movimientos_raw(fecha, descripcion, monto)
    `)
    .eq("empresa_id", usuario.empresa_id)
    .in("id", ids);

  if (pErr) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: pErr.message }, { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  // Verifico cuáles ya están emitidas para no duplicar
  let yaEmitidas = new Set<string>();
  try {
    const { data: existentes } = await sb
      .from("boletas_emitidas")
      .select("propuesta_id")
      .eq("empresa_id", usuario.empresa_id)
      .neq("estado", "anulada")
      .in("propuesta_id", ids);
    yaEmitidas = new Set((existentes ?? []).map((e: { propuesta_id: string }) => e.propuesta_id));
  } catch { /* tabla missing → todas pendientes */ }

  const fecha_emision = new Date().toISOString().slice(0, 10);
  const results: BatchItem[] = [];

  // Index propuestas by id for lookup in original order
  const byId = new Map<string, typeof propuestas[number]>();
  for (const p of propuestas ?? []) byId.set(p.id, p);

  for (const pid of ids) {
    const p = byId.get(pid);
    if (!p) {
      results.push({ propuesta_id: pid, ok: false, error_code: "NO_ENCONTRADA", error_message: "Propuesta no existe o no es de esta empresa" });
      continue;
    }
    if (yaEmitidas.has(pid)) {
      results.push({ propuesta_id: pid, ok: false, error_code: "YA_EMITIDA", error_message: "Esta propuesta ya tiene una boleta vigente" });
      continue;
    }
    if (p.estado !== "aprobado" && p.estado !== "editado") {
      results.push({ propuesta_id: pid, ok: false, error_code: "ESTADO_INVALIDO", error_message: `La propuesta está ${p.estado}, no aprobada` });
      continue;
    }
    if (p.tipo_propuesto !== "boleta") {
      results.push({ propuesta_id: pid, ok: false, error_code: "TIPO_INVALIDO", error_message: `Tipo ${p.tipo_propuesto} no es boleta` });
      continue;
    }

    const cliente = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as
      { id: string; nombre: string; rut: string | null } | null;
    const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as
      { fecha: string; descripcion: string; monto: number } | null;
    const receptor_rut = p.receptor_rut ?? cliente?.rut ?? undefined;
    const receptor_razon_social = p.receptor_nombre ?? cliente?.nombre ?? undefined;
    const total = Math.round(Number(p.total ?? mov?.monto ?? 0));

    const detalles = [{
      nombre: (mov?.descripcion ?? "Servicio").slice(0, 80),
      monto: total,
    }];

    const validation = validarBoleta({
      tipo_dte: 39,
      receptor_rut,
      receptor_razon_social,
      detalles,
      monto_total: total,
    });

    if (!validation.ok || !validation.totales) {
      const firstErr = validation.errors[0];
      results.push({
        propuesta_id: pid,
        ok: false,
        error_code: firstErr?.code ?? "VALIDACION_FALLIDA",
        error_message: firstErr?.message ?? "No pasó las validaciones del SII",
      });
      continue;
    }

    // Consume folio
    const { data: folioRes, error: folioErr } = await sb.rpc("consume_next_folio", {
      p_empresa_id: usuario.empresa_id,
      p_tipo_dte: 39,
    });
    if (folioErr || !folioRes || folioRes.length === 0) {
      results.push({
        propuesta_id: pid,
        ok: false,
        error_code: "SIN_FOLIOS",
        error_message: "No hay folios CAF disponibles. Solicitá un nuevo CAF.",
      });
      // Si no hay folios, no tiene sentido seguir intentando con el resto
      // — los marcamos todos como bloqueados
      for (const remainingId of ids.slice(ids.indexOf(pid) + 1)) {
        if (!results.find((r) => r.propuesta_id === remainingId)) {
          results.push({
            propuesta_id: remainingId,
            ok: false,
            error_code: "SIN_FOLIOS",
            error_message: "Lote interrumpido — sin folios CAF",
          });
        }
      }
      break;
    }
    const { folio, caf_id } = folioRes[0] as { folio: number; caf_id: string };

    const dteArgs = {
      tipo_dte: 39 as const,
      folio,
      fecha_emision,
      emisor: {
        rut: empresa.rut,
        razon_social: empresa.razon_social,
        giro: empresa.giro,
        direccion: empresa.direccion,
        comuna: empresa.comuna,
      },
      receptor: receptor_rut ? { rut: receptor_rut, razon_social: receptor_razon_social } : undefined,
      totales: validation.totales,
      detalles,
    };
    const xml_dte = generarDTE(dteArgs);
    const ted = generarTED(dteArgs);
    const trackId = generarTrackId();

    const { data: boleta, error: insertErr } = await sb
      .from("boletas_emitidas")
      .insert({
        empresa_id: usuario.empresa_id,
        propuesta_id: pid,
        tipo_dte: 39,
        folio,
        caf_id,
        fecha_emision,
        emisor_rut: empresa.rut,
        emisor_razon_social: empresa.razon_social,
        emisor_giro: empresa.giro,
        emisor_direccion: empresa.direccion,
        emisor_comuna: empresa.comuna,
        receptor_rut: receptor_rut ?? null,
        receptor_razon_social: receptor_razon_social ?? null,
        monto_neto: validation.totales.neto,
        monto_exento: validation.totales.exento,
        iva: validation.totales.iva,
        monto_total: validation.totales.total,
        detalles: detalles,
        xml_dte,
        ted,
        track_id: trackId,
        estado: "aceptado",
      })
      .select("id, folio, monto_total")
      .single();

    if (insertErr || !boleta) {
      results.push({
        propuesta_id: pid,
        ok: false,
        error_code: "DB_INSERT_FAILED",
        error_message: insertErr?.message ?? "Error al guardar boleta",
      });
      continue;
    }

    results.push({
      propuesta_id: pid,
      ok: true,
      folio: boleta.folio,
      boleta_id: boleta.id,
      monto_total: boleta.monto_total,
    });
  }

  const exitos = results.filter((r) => r.ok).length;
  const fallos = results.length - exitos;
  const monto_emitido = results.filter((r) => r.ok).reduce((s, r) => s + (r.monto_total ?? 0), 0);

  return NextResponse.json({
    ok: true,
    procesadas: results.length,
    exitos,
    fallos,
    monto_emitido,
    resultados: results,
  });
}

export const dynamic = "force-dynamic";
// Use CONCURRENCY in case we want to parallelize later
void CONCURRENCY;
