import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { checkRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";
import { recordOpsEvent } from "@/lib/ops/events";
import { validarRut, formatRut } from "@/lib/rut";
import { derivarMontosFactura } from "@/lib/facturas/plantilla";
import { carrilEsExento } from "@/lib/sii/tipo-por-carril";
import { chileDateString } from "@/lib/chile-date";

/**
 * FACTURA ÚNICA (criterio 5 de Matías): el modal de la mesa Facturas crea acá
 * la cadena documento → movimiento → propuesta con TODO lo que el usuario
 * tipeó, y devuelve la propuesta lista. La EMISIÓN la hace el mismo
 * /emitir-lote de siempre con esa propuesta + la forma de pago: un solo
 * carril de emisión, cero lógica duplicada (gates de cuota, locks,
 * anti-doble-emisión y validaciones viajan gratis).
 *
 * La propuesta nace 'aprobado' — a diferencia de la plantilla masiva, acá el
 * usuario acaba de tipear cada campo a mano: ese ES el gesto de aprobación.
 */
export async function POST(request: Request) {
  try {
    const supportBlock = await getDevSupportWriteBlock();
    if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("empresa_id, rol, empresas!usuarios_empresa_id_fkey(tipo_contribuyente, facturas_tipo_default)")
      .eq("id", user.id)
      .single();
    if (!usuario?.empresa_id) return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
    if (!ROLES_EMISION.has(String(usuario.rol))) {
      return NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO", detalle: "Tu rol no permite emitir documentos" }, { status: 403 });
    }

    // ILIMITADO A RITMO HUMANO: misma llave que la boleta única a propósito —
    // un script no puede alternar entre las dos rutas para duplicar el ritmo.
    // Ver el comentario largo en emitir-boleta/route.ts.
    const limited = await enforceRateLimitGlobal({
      key: rateLimitKey("emitir-unica", user.id),
      limit: 5,
      windowMs: 60_000,
    });
    if (limited) {
      const aviso = checkRateLimit({ key: rateLimitKey("ops-unica-throttle", user.id), limit: 1, windowMs: 30 * 60_000 });
      if (aviso.ok) {
        await recordOpsEvent({
          severity: "warn",
          source: "emision",
          eventName: "unica_ritmo_bloqueado",
          summary: "Emisión única chocó el freno de cadencia (posible automatización)",
          usuarioId: user.id,
          metadata: { ruta: "factura-unica", limite_min: 5 },
        });
      }
      return limited;
    }
    const empresa = usuario.empresas as unknown as { tipo_contribuyente: string | null; facturas_tipo_default: string | null } | null;

    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {
      return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
    }
    const campo = (k: string, max = 200) => String(body[k] ?? "").trim().slice(0, max);
    const receptorRut = campo("receptor_rut", 15);
    const razon = campo("razon_social");
    const giro = campo("giro");
    const direccion = campo("direccion");
    const comuna = campo("comuna", 60);
    const email = campo("email") || null;
    const detalle = campo("detalle", 300);
    const total = Math.round(Number(body.total ?? 0));

    // Receptor COMPLETO obligatorio — misma regla que la plantilla y el lote.
    if (!receptorRut || !validarRut(receptorRut)) {
      return NextResponse.json({ ok: false, error: "RUT_INVALIDO", detalle: "El RUT del receptor no es válido" }, { status: 400 });
    }
    const faltan = [!razon && "Razón Social", !giro && "Giro", !direccion && "Dirección", !comuna && "Comuna", !detalle && "Detalle"].filter(Boolean);
    if (faltan.length > 0) {
      return NextResponse.json({ ok: false, error: "CAMPOS_FALTANTES", detalle: `Falta: ${faltan.join(", ")}` }, { status: 400 });
    }
    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ ok: false, error: "MONTO_INVALIDO", detalle: "El valor total debe ser mayor a cero" }, { status: 400 });
    }

    // El tipo lo manda el carril FACTURA, no el general de la empresa
    // (2026-09-04): quien tiene boletas exentas y facturas afectas ya no queda
    // atrapado en una sola verdad. NULL en el carril hereda el general.
    const emisorExento = carrilEsExento(empresa, "factura");
    const montos = derivarMontosFactura(total, emisorExento);
    const hoy = chileDateString();

    const { data: doc, error: docErr } = await supabase
      .from("documentos_subidos")
      .insert({
        empresa_id: usuario.empresa_id,
        nombre_archivo: `Factura única - ${razon}`,
        tipo: "boleta_unica",
        mesa: "factura",
        storage_path: "memoria",
        estado: "procesado",
        movimientos_detectados: 1,
        progreso_ia: { origen: "factura_unica" },
      })
      .select("id")
      .single();
    if (docErr) return NextResponse.json({ ok: false, error: "DB_ERROR", detalle: docErr.message }, { status: 500 });

    const { data: mov, error: movErr } = await supabase
      .from("movimientos_raw")
      .insert({
        documento_id: doc.id,
        empresa_id: usuario.empresa_id,
        fecha: hoy,
        descripcion: detalle,
        monto: total,
        tipo_flujo: "entrada",
        origen: "factura_unica",
      })
      .select("id")
      .single();
    if (movErr) return NextResponse.json({ ok: false, error: "DB_ERROR", detalle: movErr.message }, { status: 500 });

    const { data: prop, error: propErr } = await supabase
      .from("propuestas_ia")
      .insert({
        empresa_id: usuario.empresa_id,
        movimiento_id: mov.id,
        mesa: "factura",
        estado: "aprobado",
        tipo_propuesto: emisorExento ? "factura_exenta" : "factura_afecta",
        tipo_dte: montos.tipoDte,
        monto_neto: montos.neto,
        iva: montos.iva,
        total,
        detalle,
        receptor_rut: formatRut(receptorRut),
        receptor_nombre: razon,
        receptor_giro: giro,
        receptor_direccion: direccion,
        receptor_comuna: comuna,
        receptor_email: email,
        fuente_clasificacion: "factura_unica",
        confianza: 1,
      })
      .select("id")
      .single();
    if (propErr) return NextResponse.json({ ok: false, error: "DB_ERROR", detalle: propErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      propuesta_id: prop.id,
      tipo_dte: montos.tipoDte,
      advertencia: montos.advertencia,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO", detalle: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
