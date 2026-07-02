import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { validarBoleta } from "@/lib/sii/validation";
import { getUmbralIdentificacionClp } from "@/lib/sii/uf";
import { obtenerConfigEmision, providerForTipoDte, verificarCertificado } from "@/lib/intermediario/client";
import { chileDateString } from "@/lib/chile-date";
import { clasificarBoleta, type DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { armarBoletaPayload } from "@/lib/intermediario/armar-boleta";
import { issueMockBoleta } from "@/lib/emission/mock";
import { batchBlockedResult } from "@/lib/emission/provider-guards";
import { verificarEmisionMasiva } from "@/lib/pagos/metering";
import { validarAccesoCuenta } from "@/lib/entitlements";
import { acquireCuentaEmissionLock, releaseCuentaEmissionLock } from "@/lib/emission/locks";
import { recordCuentaAudit } from "@/lib/audit/account";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";

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

// Roles que pueden emitir documentos tributarios (viewer solo consulta).
const ROLES_EMISION = new Set(["owner", "admin", "contador"]);

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
  try {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol, dev_mode, empresas!usuarios_empresa_id_fkey(rut, razon_social, giro, direccion, comuna, tipo_contribuyente)")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }
  // Emitir DTEs es un acto tributario: viewer queda fuera.
  if (!ROLES_EMISION.has(String(usuario.rol))) {
    return NextResponse.json({ ok: false, error: "ROL_SIN_PERMISO", detalle: "Tu rol no permite emitir documentos" }, { status: 403 });
  }
  const empresa = usuario.empresas as unknown as {
    rut: string; razon_social: string; giro: string | null; direccion: string | null; comuna: string | null; tipo_contribuyente: string | null;
  } | null;
  if (!empresa?.rut) {
    return NextResponse.json({ ok: false, error: "EMPRESA_SIN_DATOS_FISCALES" }, { status: 422 });
  }

  // El certificado SII delegado se verifica más abajo, solo si el proveedor
  // efectivo NO es mock (la simulación no lo necesita).

  // Body acepta:
  //   { propuesta_ids: string[] }  → todas como AFECTA (default histórico)
  //   { items: [{ id, tipo_dte: 39|41 }, ...] }  → tipo per propuesta
  let body: { propuesta_ids?: string[]; items?: { id: string; tipo_dte?: 39 | 41 }[] } = {};
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }
  // Normalizar a Map<id, tipo_dte>
  const tipoPorId = new Map<string, 39 | 41>();
  if (Array.isArray(body.items)) {
    for (const it of body.items) {
      if (typeof it.id === "string") {
        const t = it.tipo_dte === 41 ? 41 : 39;
        tipoPorId.set(it.id, t);
      }
    }
  }
  const ids = Array.isArray(body.items)
    ? body.items.map((i) => i.id).filter((x): x is string => typeof x === "string")
    : Array.isArray(body.propuesta_ids)
      ? body.propuesta_ids.filter((x) => typeof x === "string")
      : [];
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
      id, tipo_propuesto, tipo_dte, receptor_nombre, receptor_rut, receptor_direccion, receptor_comuna,
      medio_pago, notas, monto_neto, iva, total, estado,
      cliente_id,
      clientes(id, nombre, rut),
      movimientos_raw(fecha, descripcion, monto, documentos_subidos(tipo_operacion_hint, glosa_comun, glosa_activa))
    `)
    .eq("empresa_id", usuario.empresa_id)
    .in("id", ids);

  if (pErr) {
    return NextResponse.json({ ok: false, error: "QUERY_FAILED", detalle: pErr.message }, { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createServiceClient<Database>(url, key);
  const acceso = await validarAccesoCuenta(sb, user.id, usuario.empresa_id);
  if (!acceso.ok) {
    return NextResponse.json({ ok: false, error: acceso.codigo }, { status: 403 });
  }
  if (!acceso.planActivo) {
    return NextResponse.json({ ok: false, error: "PLAN_INACTIVO", detalle: "Tu plan no está activo." }, { status: 402 });
  }
  const emisionConfig = await obtenerConfigEmision(usuario.empresa_id);
  if (process.env.NODE_ENV !== "production") {
    console.info("[emitir-lote] configuracion emision", {
      empresaId: usuario.empresa_id,
      boletasProveedor: emisionConfig.boletasProveedor,
      facturasProveedor: emisionConfig.facturasProveedor,
    });
  }

  // Emisión real (no mock) exige certificado digital delegado al intermediario.
  // El lote solo emite boletas (39/41), así que el proveedor relevante es el de boletas.
  if (emisionConfig.boletasProveedor !== "mock") {
    const cert = await verificarCertificado(usuario.empresa_id);
    if (!cert.ok) {
      return NextResponse.json(
        { ok: false, error: "CERTIFICADO_REQUERIDO", detalle: cert.mensaje ?? "La empresa no tiene certificado digital SII delegado" },
        { status: 412 },
      );
    }
  }

  const lock = await acquireCuentaEmissionLock({
    sb,
    cuentaId: acceso.cuentaId,
    empresaId: usuario.empresa_id,
    userId: user.id,
    provider: "mock",
    ttlSeconds: 300,
  });
  if (!lock.ok) {
    return NextResponse.json(
      { ok: false, error: lock.error, detalle: lock.detalle ?? "Ya hay una emisión activa en esta cuenta." },
      { status: lock.error === "EMISION_BLOQUEADA" ? 409 : 500 },
    );
  }

  let lockEstado: "completed" | "failed" | "cancelled" = "failed";
  try {

  // Gate de cuota: las boletas masivas (con propuesta_id) consumen el cupo
  // del plan/trial. dev_mode bypassa para pruebas internas.
  const gate = await verificarEmisionMasiva(sb, usuario.empresa_id, ids.length, { devBypass: usuario.dev_mode === true });
  if (!gate.ok) {
    lockEstado = "cancelled";
    return NextResponse.json(
      { ok: false, error: gate.codigo, detalle: gate.detalle, disponible: gate.disponible },
      { status: 402 },
    );
  }

  // Verifico cuáles ya están emitidas para no duplicar
  let yaEmitidas = new Set<string>();
  try {
    const { data: existentes } = await sb
      .from("boletas_emitidas")
      .select("propuesta_id")
      .eq("empresa_id", usuario.empresa_id)
      .neq("estado", "anulada")
      .in("propuesta_id", ids);
    yaEmitidas = new Set((existentes ?? []).map((e) => e.propuesta_id).filter((v): v is string => typeof v === "string"));
  } catch { /* tabla missing → todas pendientes */ }

  const fecha_emision = chileDateString();
  // Umbral 135 UF con UF del día — una consulta para todo el lote.
  const umbralIdentificacionClp = await getUmbralIdentificacionClp();
  // En el carril masivo el medio de pago es siempre el de la cartola.
  const MEDIO_PAGO_LOTE = "Transferencia Electrónica";
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
    // "exenta" incluida (ya estaba en pendientes-emision): un contribuyente exento
    // emite DTE 41; el tipo_dte real lo decide clasificarBoleta abajo, no este tipo.
    const TIPOS_EMITIBLES = ["boleta", "exenta", "transferencia_p2p", "compraventa_crypto", "operacion_forex"];
    if (!TIPOS_EMITIBLES.includes(p.tipo_propuesto)) {
      results.push({ propuesta_id: pid, ok: false, error_code: "TIPO_INVALIDO", error_message: `Tipo ${p.tipo_propuesto} no se emite como boleta` });
      continue;
    }

    const cliente = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as
      { id: string; nombre: string; rut: string | null } | null;
    type DocNode = { tipo_operacion_hint: string | null; glosa_comun: string | null; glosa_activa: boolean | null };
    const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as
      { fecha: string; descripcion: string; monto: number; documentos_subidos?: DocNode | DocNode[] | null } | null;
    const receptor_rut = p.receptor_rut ?? cliente?.rut ?? undefined;
    const receptor_razon_social = p.receptor_nombre ?? cliente?.nombre ?? undefined;
    const total = Math.round(Number(p.total ?? mov?.monto ?? 0));
    const fechaMovimiento = (mov?.fecha ?? new Date().toISOString()).slice(0, 10);
    const docNested = mov?.documentos_subidos;
    const docNode = (Array.isArray(docNested) ? docNested[0] : docNested) ?? null;
    const docHintRaw = docNode?.tipo_operacion_hint ?? null;
    const clasif = clasificarBoleta(
      {
        descripcion: mov?.descripcion ?? "",
        monto: total,
        fecha: fechaMovimiento,
        receptor_nombre: receptor_razon_social ?? null,
      },
      {
        giro: empresa.giro,
        razon_social: empresa.razon_social,
        tipo_contribuyente: empresa.tipo_contribuyente,
      },
      undefined,
      docHintRaw as DocumentoHint,
    );

    if (clasif.sugerencia === "no_boletar") {
      results.push({
        propuesta_id: pid,
        ok: false,
        error_code: "NO_BOLETAR",
        error_message: `No se emite como boleta: ${clasif.razones[0] ?? "movimiento no comercial"}`,
      });
      continue;
    }

    // Tipo DTE por precedencia: override explícito de la UI (tipoPorId) → decisión
    // humana persistida (p.tipo_dte, Paso P) → clasificación → 39. Antes ignoraba
    // p.tipo_dte y coercía a 39 AFECTA una propuesta con 41 ya persistido (auditoría #7).
    const tipoPersistido = p.tipo_dte === 39 || p.tipo_dte === 41 ? (p.tipo_dte as 39 | 41) : undefined;
    const tipoDte = (tipoPorId.get(pid) ?? tipoPersistido ?? clasif.tipo_dte ?? 39) as 39 | 41;
    const proveedorEfectivo = providerForTipoDte(emisionConfig, tipoDte);

    // Payload canónico (glosa/receptor/medio) vía el armador único — MISMA regla
    // que boleta única. Glosa: detalle editado (notas) › glosa común de la cartola
    // (si activa) › glosa del banco. Medio: el de la propuesta o el default del carril.
    const payload = armarBoletaPayload({
      tipoDte,
      total,
      notas: p.notas,
      glosaBanco: mov?.descripcion,
      glosaComun: docNode?.glosa_comun,
      glosaComunActiva: docNode?.glosa_activa,
      receptorRut: receptor_rut,
      receptorNombre: receptor_razon_social,
      receptorDireccion: p.receptor_direccion,
      receptorComuna: p.receptor_comuna,
      medioPago: p.medio_pago,
    }, { medioPagoDefault: MEDIO_PAGO_LOTE });
    const detalles = payload.detalles;

    const validation = validarBoleta(payload, { umbralIdentificacionClp });

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
    // R4 (Art. 14 DL 825): una boleta afecta (39) con IVA $0 la rechaza el SII.
    // validarBoleta no lo cubre; lo aplicamos acá igual que evaluarEmision (que este
    // carril no invoca todavía — ver auditoría #8).
    if (tipoDte === 39 && validation.totales.iva === 0) {
      results.push({
        propuesta_id: pid,
        ok: false,
        error_code: "AFECTA_IVA_CERO",
        error_message: "Una boleta afecta no puede tener IVA $0. Revisá el monto o emitila exenta.",
      });
      continue;
    }

    const fechaEmisionReal = fecha_emision;
    const proveedorRespuesta: Record<string, unknown> | null = null;

    const providerBlock = batchBlockedResult(proveedorEfectivo, pid);
    if (providerBlock) {
      results.push(providerBlock);
      continue;
    }

    if (proveedorEfectivo !== "mock") {
      results.push({
        propuesta_id: pid,
        ok: false,
        error_code: "PROVEEDOR_NO_IMPLEMENTADO",
        error_message: "Este proveedor no tiene carril backend habilitado para emisión por lote.",
      });
      continue;
    }

    // El carril mock auto-solicita CAFs mock cuando se agotan los folios.
    const mockIssue = await issueMockBoleta({
      sb,
      empresaId: usuario.empresa_id,
      empresa,
      body: {
        tipo_dte: tipoDte,
        receptor_rut: payload.receptor_rut,
        receptor_razon_social: payload.receptor_razon_social,
        detalles,
      },
      totales: validation.totales,
      fechaEmision: fechaEmisionReal,
    });
    if (!mockIssue.ok) {
      results.push({
        propuesta_id: pid,
        ok: false,
        error_code: mockIssue.codigo_rechazo ?? mockIssue.error,
        error_message: mockIssue.detalle ?? "El modo de prueba no pudo emitir la boleta simulada",
      });
      continue;
    }

    const { data: boleta, error: insertErr } = await sb
      .from("boletas_emitidas")
      .insert({
        empresa_id: usuario.empresa_id,
        propuesta_id: pid,
        tipo_dte: tipoDte,
        folio: mockIssue.folio,
        caf_id: mockIssue.cafId,
        fecha_emision: fechaEmisionReal,
        emisor_rut: empresa.rut,
        emisor_razon_social: empresa.razon_social,
        emisor_giro: empresa.giro,
        emisor_direccion: empresa.direccion,
        emisor_comuna: empresa.comuna,
        receptor_rut: payload.receptor_rut ?? null,
        receptor_razon_social: payload.receptor_razon_social ?? null,
        receptor_direccion: payload.receptor_direccion ?? null,
        receptor_comuna: payload.receptor_comuna ?? null,
        medio_pago: payload.medio_pago ?? MEDIO_PAGO_LOTE,
        monto_neto: validation.totales.neto,
        monto_exento: validation.totales.exento,
        iva: validation.totales.iva,
        monto_total: validation.totales.total,
        detalles: detalles as unknown as Json,
        xml_dte: mockIssue.xmlDte,
        ted: mockIssue.ted,
        track_id: mockIssue.trackId,
        estado: mockIssue.estadoPersistencia,
        emision_proveedor: proveedorEfectivo,
        // Carril solo-mock: emisión simulada, sin validez tributaria.
        emision_sandbox: true,
        proveedor_respuesta: proveedorRespuesta,
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

    const receptorLabel = receptor_razon_social?.trim() || "consumidor final";
    // created_at anclado al día tributario chileno: hora fija 12 UTC (nunca
    // cruza de fecha — ver fix_chile_evening_emission_dates), pero con
    // min/seg/ms reales para que el orden dentro del lote sea estable.
    const tsNow = new Date();
    const anchorTs = `${fechaEmisionReal}T12:${String(tsNow.getUTCMinutes()).padStart(2, "0")}:${String(tsNow.getUTCSeconds()).padStart(2, "0")}.${String(tsNow.getUTCMilliseconds()).padStart(3, "0")}Z`;
    await sb.from("documentos_subidos").insert({
      empresa_id: usuario.empresa_id,
      nombre_archivo: `Boleta #${boleta.folio} - ${receptorLabel}`,
      tipo: "boleta_unica",
      storage_path: `boleta-lote://${boleta.id}`,
      estado: "procesado",
      movimientos_detectados: 1,
      created_at: anchorTs,
      progreso_ia: {
        origen: "emision_lote",
        proveedor: proveedorEfectivo,
        // Coherente con emision_sandbox de la boleta: este carril es mock.
        sandbox: true,
        propuesta_id: pid,
        boleta_id: boleta.id,
        folio: boleta.folio,
        tipo_dte: tipoDte,
        monto_total: boleta.monto_total,
        receptor: receptorLabel,
        etiqueta: "Boleta emitida",
      },
    });

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

  if (exitos > 0) {
    await recordCuentaAudit({
      sb,
      cuentaId: acceso.cuentaId,
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      accion: "boleta_emitida",
      recursoTipo: "emision_lote",
      recursoId: lock.jobId,
      resumen: `${exitos} boletas emitidas desde cartolas`,
      metadata: {
        cantidad: exitos,
        fallos,
        proveedor: emisionConfig.boletasProveedor,
        sandbox: true,
        origen: "cartolas",
      },
    });
  } else if (fallos > 0) {
    await recordCuentaAudit({
      sb,
      cuentaId: acceso.cuentaId,
      empresaId: usuario.empresa_id,
      usuarioId: user.id,
      accion: "emision_fallida",
      recursoTipo: "emision_lote",
      recursoId: lock.jobId,
      resumen: "Emision desde cartolas fallida",
      metadata: {
        cantidad: results.length,
        proveedor: emisionConfig.boletasProveedor,
        sandbox: true,
        origen: "cartolas",
      },
    });
  }

  lockEstado = "completed";
  return NextResponse.json({
    ok: true,
    procesadas: results.length,
    exitos,
    fallos,
    monto_emitido,
    proveedor: emisionConfig.boletasProveedor,
    sandbox: true,
    resultados: results,
  });
  } finally {
    await releaseCuentaEmissionLock({ sb, cuentaId: acceso.cuentaId, jobId: lock.jobId, estado: lockEstado });
  }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[emitir-lote]", msg);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO", detalle: msg }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
// Use CONCURRENCY in case we want to parallelize later
void CONCURRENCY;
