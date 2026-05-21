import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { clasificarBoleta, type DocumentoHint } from "@/lib/sii/clasificador-tipo";

/**
 * Tipos de propuesta IA que representan INGRESOS boletificables.
 * Incluye el legacy "boleta" + los tipos específicos del procesador actual
 * (transferencia_p2p, compraventa_crypto, operacion_forex). Facturas,
 * gastos, no comerciales y honorarios quedan fuera.
 */
const TIPOS_EMITIBLES = [
  "boleta",
  "transferencia_p2p",
  "compraventa_crypto",
  "operacion_forex",
];

/**
 * Lista propuestas tipo "boleta" aprobadas/editadas que aún NO están emitidas.
 * Cada item incluye los datos necesarios para emitir + un flag listo_emitir
 * que indica si pasa las validaciones del SII (RUT receptor si > $180k).
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, empresas(giro, razon_social, tipo_contribuyente)")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  const empresaCtx = (usuario.empresas as unknown as { giro: string | null; razon_social: string; tipo_contribuyente: string | null } | null) ?? { giro: null, razon_social: "", tipo_contribuyente: null };

  // 1) Propuestas aprobadas tipo boleta (con cliente + movimiento)
  const { data: propuestas, error: pErr } = await supabase
    .from("propuestas_ia")
    .select(`
      id,
      tipo_propuesto,
      receptor_nombre,
      receptor_rut,
      monto_neto,
      iva,
      total,
      estado,
      created_at,
      cliente_id,
      clientes(id, nombre, rut),
      movimientos_raw(fecha, descripcion, monto, documentos_subidos(id, nombre_archivo, tipo_operacion_hint, created_at))
    `)
    .eq("empresa_id", usuario.empresa_id)
    .in("estado", ["aprobado", "editado"])
    .in("tipo_propuesto", TIPOS_EMITIBLES)
    .order("created_at", { ascending: false });

  if (pErr) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: pErr.message }, { status: 500 });
  }

  // 2) IDs ya emitidas (vigentes, no anuladas) — service client porque la tabla
  //    aún no está en database.types
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);
  let yaEmitidas = new Set<string>();
  try {
    const { data: emitidas } = await sb
      .from("boletas_emitidas")
      .select("propuesta_id")
      .eq("empresa_id", usuario.empresa_id)
      .neq("estado", "anulada")
      .not("propuesta_id", "is", null);
    yaEmitidas = new Set((emitidas ?? []).map((e: { propuesta_id: string }) => e.propuesta_id));
  } catch {
    /* tabla aún no existe — todas son pendientes */
  }

  // 3) Pre-procesar para clasificador: necesito patrones por (receptor, día) y mes
  type PropuestaRaw = (typeof propuestas)[number];
  const visibles = (propuestas ?? []).filter((p: PropuestaRaw) => !yaEmitidas.has(p.id));

  // Index de patrones (key: receptor_id+fecha) → cantidad mismo día
  const patronDia = new Map<string, number>();
  // Index mensual por receptor (key: receptor_id+yyyy-mm) → cantidad mes
  const patronMes = new Map<string, number>();
  for (const p of visibles) {
    const cli = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as { id: string } | null;
    const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as { fecha: string } | null;
    const recId = cli?.id ?? p.receptor_nombre ?? "sin-receptor";
    const fechaStr = (mov?.fecha ?? p.created_at).slice(0, 10);
    const yyyymm = fechaStr.slice(0, 7);
    const kDia = `${recId}|${fechaStr}`;
    const kMes = `${recId}|${yyyymm}`;
    patronDia.set(kDia, (patronDia.get(kDia) ?? 0) + 1);
    patronMes.set(kMes, (patronMes.get(kMes) ?? 0) + 1);
  }

  // 4) Mapear y enriquecer con clasificación + listo_emitir
  const items = visibles.map((p: PropuestaRaw) => {
      const cliente = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as {
        id: string; nombre: string; rut: string | null;
      } | null;
      const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as {
        fecha: string; descripcion: string; monto: number;
        documentos_subidos?: { id: string; nombre_archivo: string; tipo_operacion_hint: string | null; created_at: string | null } | { id: string; nombre_archivo: string; tipo_operacion_hint: string | null; created_at: string | null }[] | null;
      } | null;
      const docNested = mov?.documentos_subidos;
      const docArr = Array.isArray(docNested) ? docNested[0] : docNested;
      const docHintRaw = docArr?.tipo_operacion_hint ?? null;
      const docHint = docHintRaw as DocumentoHint;
      const total = Number(p.total ?? mov?.monto ?? 0);
      const fecha = (mov?.fecha ?? p.created_at).slice(0, 10);
      const receptor_rut = p.receptor_rut ?? cliente?.rut ?? null;
      const receptor_nombre = p.receptor_nombre ?? cliente?.nombre ?? null;
      const recId = cliente?.id ?? p.receptor_nombre ?? "sin-receptor";

      // Clasificación SII (3 ángulos + hint explícito del usuario)
      const clasif = clasificarBoleta(
        {
          descripcion: mov?.descripcion ?? "",
          monto: total,
          fecha,
          receptor_nombre,
        },
        empresaCtx,
        {
          cantidad_mismo_dia_mismo_receptor: (patronDia.get(`${recId}|${fecha}`) ?? 1) - 1,
          cantidad_mes_mismo_receptor: (patronMes.get(`${recId}|${fecha.slice(0, 7)}`) ?? 1),
        },
        docHint,
      );

      const listo_emitir = true;
      const motivo_no_listo = null;

      return {
        id: p.id,
        descripcion: mov?.descripcion ?? "Sin descripción",
        fecha,
        receptor_rut,
        receptor_nombre,
        monto_total: total,
        listo_emitir,
        motivo_no_listo,
        tipo_sugerido: clasif.tipo_dte,
        sugerencia: clasif.sugerencia,
        confianza_clasif: Math.round(clasif.confianza * 100) / 100,
        razones: clasif.razones,
        documento_id: docArr?.id ?? null,
        documento_nombre: docArr?.nombre_archivo ?? null,
        documento_created_at: docArr?.created_at ?? null,
      };
    });

  const totales = {
    total_pendientes: items.length,
    listas_emitir: items.filter((i) => i.listo_emitir).length,
    bloqueadas: items.filter((i) => !i.listo_emitir).length,
    monto_total: items.reduce((s, i) => s + i.monto_total, 0),
    monto_listo: items.filter((i) => i.listo_emitir).reduce((s, i) => s + i.monto_total, 0),
  };

  // Helper para el UX: si no hay boletas emitibles, ¿hay aprobadas de OTROS
  // tipos? Útil para mostrar "tenés N propuestas tipo factura/gasto, cambialas
  // a boleta en Revisar si querés emitirlas".
  let aprobadas_otros_tipos: Record<string, number> = {};
  if (items.length === 0) {
    const { data: otras } = await supabase
      .from("propuestas_ia")
      .select("tipo_propuesto")
      .eq("empresa_id", usuario.empresa_id)
      .in("estado", ["aprobado", "editado"])
      .not("tipo_propuesto", "in", `(${TIPOS_EMITIBLES.map((t) => `"${t}"`).join(",")})`);
    if (otras) {
      aprobadas_otros_tipos = otras.reduce((acc: Record<string, number>, r) => {
        const t = r.tipo_propuesto || "desconocido";
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

  return NextResponse.json({ ok: true, items, totales, aprobadas_otros_tipos });
}
