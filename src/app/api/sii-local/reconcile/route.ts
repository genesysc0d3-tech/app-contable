import { NextResponse } from "next/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { validarAccesoCuenta } from "@/lib/entitlements";


/**
 * Reconciliación sii-local contra el Resumen de Ventas del SII (la fuente de
 * verdad). Recibe las filas leídas del Resumen y:
 *  - Folio en el SII que NO está en la app → lo respalda (backfill) como boleta
 *    emitida (origen "reconciliacion_rcv"). Esto cubre TODOS los casos en que el
 *    bot emitió pero no pudo leer/persistir el folio (glitch, navegación, caída,
 *    PDF 403, ventana cerrada). Una boleta emitida nunca queda invisible.
 *  - Folio en la app que NO está en el SII → se reporta como "fantasma" para
 *    revisión (caso raro: creímos emitir y no quedó).
 *
 * Es idempotente: re-ejecutar no duplica (dedup por empresa+tipo+folio).
 *
 * Body: { rows: Array<{ folio:number; tipo_dte:39|41; monto_total:number;
 *   monto_neto?:number; iva?:number; monto_exento?:number; fecha_emision:string;
 *   estado_sii?:string }>, desde?:string, hasta?:string }
 */
type ReconRow = {
  folio: number;
  tipo_dte: number;
  monto_total: number;
  monto_neto?: number;
  iva?: number;
  monto_exento?: number;
  fecha_emision: string;
  estado_sii?: string;
};

function intOrNull(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios").select("empresa_id, rol").eq("id", user.id).single();
  if (!usuario?.empresa_id) return NextResponse.json({ ok: false, error: "SIN_EMPRESA" }, { status: 403 });
  if (!ROLES_EMISION.has(String(usuario.rol))) return NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO" }, { status: 403 });
  const empresaId = usuario.empresa_id;

  let body: { rows?: ReconRow[]; desde?: string; hasta?: string } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "BODY_INVALIDO" }, { status: 400 }); }

  // Tope de filas por request: cada fila válida hace un INSERT secuencial en
  // boletas_emitidas; sin cap, un body enorme puede colgar la función. El Resumen de
  // Ventas de un mes cabe de sobra en 500 (emitir-lote usa el mismo orden de tope).
  const MAX_RECONCILE_ROWS = 500;

  // Normalizar filas válidas (folio + tipo + monto + fecha).
  const rows: ReconRow[] = (Array.isArray(body.rows) ? body.rows : [])
    .slice(0, MAX_RECONCILE_ROWS)
    .map((r) => ({
      folio: intOrNull(r.folio) ?? 0,
      tipo_dte: r.tipo_dte === 41 ? 41 : 39,
      monto_total: intOrNull(r.monto_total) ?? 0,
      monto_neto: intOrNull(r.monto_neto) ?? undefined,
      iva: intOrNull(r.iva) ?? undefined,
      monto_exento: intOrNull(r.monto_exento) ?? undefined,
      fecha_emision: String(r.fecha_emision || "").slice(0, 10),
      estado_sii: r.estado_sii ? String(r.estado_sii).slice(0, 40) : undefined,
    }))
    .filter((r) => r.folio > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha_emision));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "BACKEND_MAL_CONFIGURADO" }, { status: 500 });
  const sb = createServiceClient<Database>(url, key);
  const acceso = await validarAccesoCuenta(sb, user.id, empresaId);
  if (!acceso.ok) return NextResponse.json({ ok: false, error: acceso.codigo }, { status: 403 });
  if (!acceso.planActivo) return NextResponse.json({ ok: false, error: "PLAN_INACTIVO" }, { status: 402 });

  // Datos del emisor (columnas NOT NULL de la boleta).
  const { data: empresa } = await sb
    .from("empresas").select("rut, razon_social, giro, direccion, comuna").eq("id", empresaId).single();
  if (!empresa) return NextResponse.json({ ok: false, error: "EMPRESA_NO_ENCONTRADA" }, { status: 404 });

  // Lo que la app ya tiene (vigente) para esta empresa, por (tipo, folio).
  const { data: existentes } = await sb
    .from("boletas_emitidas")
    .select("tipo_dte, folio, fecha_emision")
    .eq("empresa_id", empresaId)
    .neq("estado", "anulada");
  const enApp = new Set((existentes ?? []).map((b) => `${b.tipo_dte}:${b.folio}`));
  const enSii = new Set(rows.map((r) => `${r.tipo_dte}:${r.folio}`));

  // Backfill de los que están en el SII pero no en la app.
  const respaldados: number[] = [];
  const errores: { folio: number; error: string }[] = [];
  for (const r of rows) {
    if (enApp.has(`${r.tipo_dte}:${r.folio}`)) continue;
    const neto = r.tipo_dte === 39 ? (r.monto_neto ?? Math.round(r.monto_total / 1.19)) : 0;
    const iva = r.tipo_dte === 39 ? (r.iva ?? (r.monto_total - neto)) : 0;
    const exento = r.tipo_dte === 41 ? (r.monto_exento ?? r.monto_total) : 0;
    // DELIBERADO (auditoría 2026-07-24): el backfill NO enlaza propuesta_id ni
    // levanta la lápida 'revision_pendiente' de ningún job — y así DEBE ser. El
    // Resumen de Ventas del SII da (tipo, folio) pero NO a qué propuesta pertenece
    // un folio, y la lápida no persiste un folio candidato → no existe match
    // confiable. Levantar una lápida a ciegas re-habilitaría esa propuesta para
    // re-emitir (doble folio), que es EXACTAMENTE lo que la lápida previene. La
    // resolución de una propuesta "a medias" cuyo folio reaparece en el RCV queda
    // como paso MANUAL (el modal de emisión ya tiene 'recover' dirigido por jobId),
    // que es lo seguro. propuesta_id null aquí es correcto, no un olvido.
    const { error } = await sb.from("boletas_emitidas").insert({
      empresa_id: empresaId,
      tipo_dte: r.tipo_dte,
      folio: r.folio,
      monto_total: r.monto_total,
      monto_neto: neto,
      iva,
      monto_exento: exento,
      fecha_emision: r.fecha_emision,
      emisor_rut: empresa.rut,
      emisor_razon_social: empresa.razon_social,
      emisor_giro: empresa.giro,
      emisor_direccion: empresa.direccion,
      emisor_comuna: empresa.comuna,
      xml_dte: `sii-local://boleta/${r.tipo_dte}/${r.folio}`,
      ted: `sii-local://ted/${r.tipo_dte}/${r.folio}`,
      track_id: `sii-local-rcv:${empresaId}:${r.tipo_dte}:${r.folio}`,
      estado: "aceptado",
      emision_proveedor: "sii_local",
      emision_sandbox: false,
      proveedor_respuesta: {
        origen: "reconciliacion_rcv",
        estado_sii: r.estado_sii ?? null,
        reconciliado_en: new Date().toISOString(),
        pdf_pendiente: true,
      },
    });
    if (error) errores.push({ folio: r.folio, error: error.message });
    else respaldados.push(r.folio);
  }

  // Fantasmas: boletas de la app que NO aparecen en el Resumen del SII. Solo
  // tiene sentido DENTRO del rango que trae el Resumen — comparar todo el
  // historial contra un rango daría falsos por cada boleta fuera de rango.
  const desde = typeof body.desde === "string" ? body.desde.slice(0, 10) : null;
  const hasta = typeof body.hasta === "string" ? body.hasta.slice(0, 10) : null;
  let fantasmas = 0;
  if (desde && hasta) {
    for (const b of existentes ?? []) {
      const f = String(b.fecha_emision || "").slice(0, 10);
      if (f >= desde && f <= hasta && !enSii.has(`${b.tipo_dte}:${b.folio}`)) fantasmas += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    revisados: rows.length,
    respaldados,
    ya_estaban: rows.length - respaldados.length - errores.length,
    fantasmas_posibles: fantasmas,
    rango_evaluado: desde && hasta ? { desde, hasta } : null,
    errores,
  });
}
