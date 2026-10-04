import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { reserveSimpleApiFolio } from "@/lib/emission/folio-reservas";
import { acquireCuentaEmissionLock, releaseCuentaEmissionLock, renovarLeaseCuenta } from "@/lib/emission/locks";
import { buscarLapidaBoletaUnica, leerIntento, ORIGIN_BOLETA_UNICA, estadoVisibleEnLatidoPrincipal, marcarEstadoVisibleLatido } from "@/lib/emission/boleta-unica-lapida";
import {
  DETALLE_DATOS_FALTAN,
  SELECT_PROPUESTA_DATOS,
  compararDatosJob,
  leerDatosEnviados,
  textoDatosCambiaron,
  type PropuestaDatos,
} from "@/lib/emission/datos-job";
import type { DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { motivoNoEmitible } from "@/lib/sii/destino";
import { revisarPostCandado, revisarPropuestaEmitible, revisarYaEmitida } from "@/lib/emission/propuesta-emitible";
import { deleteRespetaSinRespuesta, estadoCierreSeguro } from "@/lib/emission/cierre-seguro";
import { decidirAdopcion, origenAdopcion, type DecisionAdopcion } from "@/lib/emission/adopcion";
import { buildVisibleEmissionLock, type ActiveEmissionLock } from "@/lib/emission/lock-visibility";
import { obtenerConfigEmision, providerForTipoDte } from "@/lib/intermediario/client";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";
import { CURRENT_EMISSION_AUTHORIZATION_VERSION, getEmissionAuthorizationStatus } from "@/lib/emission/authorizations";
import { validarRut } from "@/lib/sii/validation";
import { guardTipoDteEmisor } from "@/lib/sii/tipo-dte-emisor-guard";
import { tipoDelCarril } from "@/lib/sii/tipo-por-carril";
import { verificarEmisionMasiva } from "@/lib/pagos/metering";
import {
  EVENTO_MARCA_ALERTA_PAUSA_QUERY,
  PAUSA_QUERY_FAILED_ALERTA_MS,
  carrilDeTipoDte,
  copyEmisionPausada,
  debeAlertarPausaQueryFailed,
  gateDePausaAplica,
  pausaActivaParaEmpresa,
} from "@/lib/ops/emision-pausas";
import { enviarAlertaCritica } from "@/lib/ops/alertas";
import { CABECERA_ACTUALIZAR } from "@/lib/actualizacion/version";

type Provider = "sii_local" | "simpleapi";
type CloseEstado = "failed" | "cancelled" | "revision_pendiente";
type ServiceDb = SupabaseClient<Database>;

// sii_local emite boletas (39/41, e-Boleta) y facturas (33/34, Sistema de
// Facturación Gratuito). Para facturas además rige providerForTipoDte: solo
// pasan si la empresa tiene facturas_emision_proveedor = 'sii_local'.
const TIPOS_SII_LOCAL = new Set([33, 34, 39, 41]);
const TIPOS_SIMPLEAPI = new Set([33, 34, 39, 41]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DETALLE_LEASE_PERDIDO =
  "Detuvimos esta emisión porque se empezó a emitir desde otra pantalla (o pasó mucho rato sin respuesta). Si alcanzó a salir en el SII, usa Recuperar emisión SII antes de volver a emitir.";

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanProvider(value: unknown): Provider | null {
  return value === "sii_local" || value === "simpleapi" ? value : null;
}

function cleanTipoDte(value: unknown) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : null;
}

function cleanCloseEstado(value: unknown): CloseEstado {
  // 'revision_pendiente' = boleta "a medias" (posible folio real): sella el job para
  // bloquear la re-emisión. 'failed' = pre-emit seguro. Default 'cancelled'.
  if (value === "failed") return "failed";
  if (value === "revision_pendiente") return "revision_pendiente";
  return "cancelled";
}

function cleanStatus(value: unknown) {
  const status = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9_:-]{1,48}$/i.test(status)) return "running";
  return status;
}

async function businessModeForPlan(sb: ServiceDb, plan: string | null) {
  if (!plan) return false;
  const { data, error } = await sb
    .from("planes_config")
    .select("equipo")
    .eq("codigo", plan)
    .maybeSingle();
  if (error) throw new Error(`PLAN_QUERY_FAILED:${error.message}`);
  return data?.equipo === true;
}

async function bloqueoActual(sb: ServiceDb, cuentaId: string, businessMode: boolean, currentUserId: string) {
  const now = new Date().toISOString();
  const { data: lock } = await sb
    .from("emision_locks")
    .select("job_id, usuario_id, provider, locked_until, heartbeat_at, estado_visible")
    .eq("cuenta_id", cuentaId)
    .gt("locked_until", now)
    .maybeSingle();
  if (!lock) return null;

  // Con equipo, el gris dice QUIÉN y CUÁNTO lleva: boletas de esa persona
  // completadas en la última hora en esta cuenta (el lote toma un candado por
  // boleta, así que el "avance" se lee de los jobs, no del candado).
  const [usuario, avance] = businessMode
    ? await Promise.all([
        sb.from("usuarios").select("nombre, email").eq("id", lock.usuario_id).maybeSingle().then((r) => r.data),
        sb.from("emision_jobs")
          .select("id", { count: "exact", head: true })
          .eq("cuenta_id", cuentaId)
          .eq("usuario_id", lock.usuario_id)
          .eq("estado", "completed")
          .not("propuesta_id", "is", null)
          .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .then((r) => r.count ?? 0),
      ])
    : [null, 0];

  return buildVisibleEmissionLock({
    lock: lock as ActiveEmissionLock,
    businessMode,
    currentUserId,
    usuario,
    avance,
  });
}

async function serviceClientOrResponse() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false as const, response: NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 }) };
  return { ok: true as const, service: createServiceClient<Database>(url, key) };
}

/**
 * Alerta crítica AL TIRO cuando la consulta del kill switch falla (F3). Dedupe
 * simple: la marca es un ops_event `emision_pausa_query_failed_alertada`; si
 * hay una de hace < 10 min, no se repite. Best-effort: jamás bloquea el 409.
 */
async function alertarPausaQueryFailed(sb: ServiceDb, carril: string, detalle: string) {
  try {
    const desde = new Date(Date.now() - PAUSA_QUERY_FAILED_ALERTA_MS).toISOString();
    const { data: marca } = await sb
      .from("ops_events")
      .select("created_at")
      .eq("event_name", EVENTO_MARCA_ALERTA_PAUSA_QUERY)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!debeAlertarPausaQueryFailed(marca?.created_at ?? null)) return;
    const summary = `El kill switch de emisión (${carril}) no se pudo consultar y está frenando clientes fail-closed: ${detalle.slice(0, 120)}`;
    const alerta = await enviarAlertaCritica({
      status: "critical",
      checkedAt: new Date().toISOString(),
      findings: [{ severity: "critical", eventName: "emision_pausa_query_failed", summary }],
    });
    // La marca se escribe aunque ningún canal esté configurado: si no, cada
    // POST reintentaría el envío (y con canales caídos, cada 10 min igual).
    await recordOpsEvent({
      sb,
      severity: "info",
      source: "emision",
      eventName: EVENTO_MARCA_ALERTA_PAUSA_QUERY,
      summary: alerta.enviada ? "Alerta enviada por fallo del kill switch" : "Alerta del kill switch NO entregada (sin canal o canal caído)",
      metadata: { carril, enviada: alerta.enviada, errores: alerta.errores },
    });
  } catch {
    /* best-effort: el 409 fail-closed ya salió igual */
  }
}

export async function POST(request: Request) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

  // Plan O TRIAL (2026-09-04): con `requirePlan` a secas, quien estaba en trial
  // recibía 402 ACÁ y nunca llegaba al gate de cuota de más abajo — el trial que
  // promete la landing no existía en el carril que emite documentos REALES. El
  // cupo de 100 masivas lo sigue cobrando ese gate; las boletas únicas siguen
  // ilimitadas, en trial también (política vigente).
  const guard = await requireAccountApiAccess({ requirePlanOTrial: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit({
    key: rateLimitKey("emision-jobs-post", guard.userId),
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let businessMode = false;
  try {
    businessMode = await businessModeForPlan(guard.service, guard.plan);
  } catch (error) {
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_plan_query_failed",
      summary: "No se pudo resolver modalidad de plan para emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error,
    });
    return NextResponse.json({ ok: false, error: "PLAN_QUERY_FAILED", detalle: error instanceof Error ? error.message : undefined }, { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const provider = cleanProvider(payload.provider);
  const tipoDte = cleanTipoDte(payload.tipo_dte);
  if (!provider) return NextResponse.json({ ok: false, error: "PROVIDER_INVALID" }, { status: 400 });
  if (!tipoDte) return NextResponse.json({ ok: false, error: "TIPO_DTE_REQUIRED" }, { status: 400 });
  if (provider === "sii_local" && !TIPOS_SII_LOCAL.has(tipoDte)) {
    return NextResponse.json({ ok: false, error: "TIPO_DTE_SII_LOCAL_INVALID" }, { status: 422 });
  }
  if (provider === "simpleapi" && !TIPOS_SIMPLEAPI.has(tipoDte)) {
    return NextResponse.json({ ok: false, error: "TIPO_DTE_SIMPLEAPI_INVALID" }, { status: 422 });
  }

  const config = await obtenerConfigEmision(guard.empresaId).catch((error) => ({ error }));
  if ("error" in config) {
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_config_error",
      summary: "No se pudo leer configuracion de emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error: config.error,
      metadata: { provider, tipo_dte: tipoDte },
    });
    return NextResponse.json({ ok: false, error: "EMISION_CONFIG_ERROR" }, { status: 500 });
  }
  if (providerForTipoDte(config, tipoDte) !== provider) {
    return NextResponse.json({ ok: false, error: "PROVIDER_NOT_ENABLED" }, { status: 409 });
  }

  // KILL SWITCH (tanda 1 RPA, 2026-09-10). Este POST es el ÚNICO embudo por el
  // que pasa toda emisión (única y lote, boletas y facturas, ver
  // useEmisionLote.startJob y EmitirDirectaView.startEmissionJob), así que una
  // pausa acá frena a la flota entera —incluidas las extensiones viejas— sin
  // republicar nada. Se evalúa ANTES del candado de cuenta para no dejar un
  // lock huérfano. FAIL-CLOSED: si la consulta falla, también 409 (mejor que
  // un cliente espere a que un lote entero se estrelle contra un portal que
  // cambió). Lo que guarda folios reales (/result, reconcile, PATCH, DELETE)
  // no pasa por acá y NUNCA se bloquea.
  // SOLO al portal (F4, 2026-09-10): SimpleAPI emite por web service y no toca
  // la página del SII; una pausa por "el portal cambió" no lo alcanza.
  const carrilPausa = carrilDeTipoDte(tipoDte);
  const pausa = gateDePausaAplica(provider)
    ? await pausaActivaParaEmpresa(guard.service, { carril: carrilPausa, empresaId: guard.empresaId })
    : ({ pausada: false } as const);
  if (pausa.pausada) {
    if (pausa.fallo) {
      // La consulta del kill switch FALLÓ: estamos frenando a un cliente sin
      // saber si hay pausa (fail-closed). Eso es crítico y se avisa AL TIRO,
      // con dedupe: una alerta cada 10 min como máximo, marcada en ops_events.
      await recordOpsEvent({
        sb: guard.service,
        severity: "critical",
        source: "emision",
        eventName: "emision_pausa_query_failed",
        summary: "No se pudo consultar el kill switch de emisión: se frena fail-closed",
        cuentaId: guard.cuentaId,
        empresaId: guard.empresaId,
        usuarioId: guard.userId,
        metadata: { provider, tipo_dte: tipoDte, carril: carrilPausa, detalle: pausa.fallo },
      });
      await alertarPausaQueryFailed(guard.service, carrilPausa, pausa.fallo);
    }
    return NextResponse.json(
      { ok: false, error: "EMISION_PAUSADA", code: "EMISION_PAUSADA", carril: carrilPausa, detalle: copyEmisionPausada(carrilPausa) },
      { status: 409 },
    );
  }

  const { data: empresa, error: empresaError } = await guard.service
    .from("empresas")
    .select("rut, giro, razon_social, tipo_contribuyente, boletas_tipo_default, facturas_tipo_default, operacion_hint_default")
    .eq("id", guard.empresaId)
    .maybeSingle();
  if (empresaError) {
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_empresa_query_failed",
      summary: "No se pudo leer empresa para preparar emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error: empresaError,
      metadata: { provider, tipo_dte: tipoDte },
    });
    return NextResponse.json({ ok: false, error: "EMPRESA_QUERY_FAILED", detalle: empresaError.message }, { status: 500 });
  }

  const expectedEmisorRut = cleanText(empresa?.rut) ?? cleanText(payload.expected_emisor_rut);
  if (provider === "sii_local") {
    // Fuente de verdad del emisor: sin RUT no se puede garantizar por cuál empresa se
    // emite. Fail-closed en 2 niveles: ausente, o presente con DV (módulo 11) inválido.
    if (!expectedEmisorRut) {
      return NextResponse.json({ ok: false, error: "EMPRESA_SIN_RUT" }, { status: 422 });
    }
    if (!validarRut(expectedEmisorRut)) {
      return NextResponse.json({ ok: false, error: "EMISOR_RUT_INVALID", detalle: expectedEmisorRut }, { status: 422 });
    }
  }

  try {
    const authorization = await getEmissionAuthorizationStatus({
      sb: guard.service,
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      userId: guard.userId,
      provider,
    });
    if (!authorization.authorized) {
      return NextResponse.json(
        {
          ok: false,
          error: "EMISSION_AUTHORIZATION_REQUIRED",
          provider,
          legal_version: CURRENT_EMISSION_AUTHORIZATION_VERSION,
        },
        { status: 428 },
      );
    }
  } catch (error) {
    await recordOpsError({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_authorization_query_failed",
      summary: "No se pudo validar autorizacion de emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      error,
      metadata: { provider, tipo_dte: tipoDte },
    });
    return NextResponse.json({ ok: false, error: "EMISSION_AUTHORIZATION_QUERY_FAILED" }, { status: 500 });
  }

  // Motor masivo: el job del lote apunta a la propuesta que va a emitir, para que
  // el folio real quede enlazado a ella. Fail-closed: un id ajeno (o inexistente)
  // enlazaría el folio a la propuesta de OTRO contribuyente → integridad rota. La
  // boleta única no manda propuesta_id (queda null, como hoy).
  const propuestaId = cleanText(payload.propuesta_id);
  let propDatos: PropuestaDatos | null = null;
  if (propuestaId) {
    if (!UUID_RE.test(propuestaId)) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_ID_INVALID" }, { status: 422 });
    }
    const { data: prop, error: propErr } = await guard.service
      .from("propuestas_ia")
      .select(SELECT_PROPUESTA_DATOS)
      .eq("id", propuestaId)
      .maybeSingle();
    if (propErr) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_QUERY_FAILED", detalle: propErr.message }, { status: 500 });
    }
    if (!prop || prop.empresa_id !== guard.empresaId) {
      return NextResponse.json({ ok: false, error: "PROPUESTA_NO_PERTENECE" }, { status: 422 });
    }
    propDatos = prop as unknown as PropuestaDatos;
    // Solo se emite lo APROBADO (incidente MH 2026-09-29, revisión adversarial): si
    // alguien devolvió la cartola a Check con un lote corriendo, las que aún no
    // empezaban ya no están en 'aprobado' y el runner las emitía igual → quedaban en
    // Check con folio real. La verificación (adopción) no emite: queda fuera.
    if (!cleanText(payload.adopta_job_id) && (prop as { estado?: string | null }).estado !== "aprobado") {
      return NextResponse.json(
        { ok: false, error: "PROPUESTA_NO_APROBADA", detalle: "Esta boleta volvió a Check: apruébala de nuevo para emitirla." },
        { status: 409 },
      );
    }
  } else if (!cleanText(payload.adopta_job_id)) {
    // BOLETA ÚNICA A MEDIAS (seguridad 2026-09-30, punto 1; boleta-unica-lapida.ts): la
    // boleta única no tiene propuesta a la que amarrar la lápida y su candado vence a
    // los 15 min. Mientras la empresa tenga una boleta única `revision_pendiente` (pudo
    // salir en el SII), no se abre otra: primero se recupera su folio o se declara
    // que no salió. Fail-closed si la consulta falla.
    const lapida = await buscarLapidaBoletaUnica(guard.service, guard.empresaId);
    if (!lapida.ok) {
      if (lapida.error !== "BOLETA_A_MEDIAS") {
        return NextResponse.json({ ok: false, error: lapida.error, detalle: lapida.detalle }, { status: lapida.status });
      }
      // Qué buscar en el SII y quién la lanzó (rev. adversarial M1/M2): cualquier
      // persona de la cuenta con permiso puede resolverla, no solo quien la lanzó.
      let lanzadaPor: string | null = null;
      if (lapida.usuarioId && lapida.usuarioId !== guard.userId) {
        const { data: u } = await guard.service.from("usuarios").select("nombre, email").eq("id", lapida.usuarioId).maybeSingle();
        lanzadaPor = (u as { nombre?: string | null; email?: string | null } | null)?.nombre ?? (u as { email?: string | null } | null)?.email ?? "Otra persona de tu cuenta";
      }
      return NextResponse.json(
        {
          ok: false, error: lapida.error, job_id: lapida.jobId, detalle: lapida.detalle,
          intento: lapida.intento, creada_at: lapida.creadaAt,
          es_mia: !lapida.usuarioId || lapida.usuarioId === guard.userId, lanzada_por: lanzadaPor,
        },
        { status: lapida.status },
      );
    }
  }

  // ADOPCIÓN ("Verificar y seguir", plan-emision-confiable §1.2 + B1, 2026-09-28): una
  // verificación que adopta el job colgado de ESTA propuesta. Solo lee el Resumen de
  // ventas del SII (verify_only); la regla de cuándo se puede vive en adopcion.ts
  // (vencido ≥ 2 min, o la extensión de quien lo lanzó confirmó su fin).
  const adoptaJobId = cleanText(payload.adopta_job_id);
  let adopcion: Extract<DecisionAdopcion, { ok: true }> | null = null;
  if (adoptaJobId) {
    if (cleanText(payload.origin) !== "verificacion_lote" || provider !== "sii_local" || (tipoDte !== 39 && tipoDte !== 41) || !propuestaId) {
      return NextResponse.json({ ok: false, error: "ADOPCION_INVALIDA", detalle: "Solo se puede verificar una boleta del lote." }, { status: 422 });
    }
    const { data: jobViejo, error: errViejo } = await guard.service
      .from("emision_jobs")
      .select("job_id, estado, propuesta_id, usuario_id, cuenta_id, empresa_id, created_at, expires_at")
      .eq("job_id", adoptaJobId)
      .maybeSingle();
    if (errViejo) return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED" }, { status: 500 });
    // "Ya emitida" va PRIMERO: si el resultado del intento llegó tarde y se registró,
    // su job ya está `completed` (no adoptable) pero la respuesta útil es el folio.
    const yaAntes = await revisarYaEmitida(guard.service, propuestaId);
    if (!yaAntes.ok) {
      return NextResponse.json(
        { ok: false, error: yaAntes.error, detalle: yaAntes.detalle, folio: yaAntes.folio ?? null, boleta_id: yaAntes.boletaId ?? null, boleta_created_at: yaAntes.boletaCreatedAt ?? null },
        { status: yaAntes.status },
      );
    }
    const decision = decidirAdopcion({
      job: jobViejo ?? null,
      userId: guard.userId,
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      propuestaId,
      finConfirmado: payload.fin_confirmado === true,
      ahora: new Date(),
    });
    if (!decision.ok) {
      return NextResponse.json({ ok: false, error: decision.code, detalle: decision.detalle, libre_desde: decision.libreDesde ?? null }, { status: decision.status });
    }
    adopcion = decision;
  }

  if (propuestaId) {
    // CANDADO ANTI-DOBLE-FOLIO — fail-closed ANTES de tocar el portal (defensa
    // temprana; el lock por cuenta y el UNIQUE de boletas_emitidas son las redes
    // duras posteriores). El carril mock ya hace este chequeo; el real faltaba.
    // Un error de consulta RECHAZA (antes se saltaba el control: falla abierta).
    // Con adopción se salta la lápida y el "en vuelo" de ESTA propuesta (el job colgado
    // es justamente el que se verifica); "ya emitida" se mantiene: si ya está
    // registrada, se devuelve su folio y no se abre nada.
    const emitible = adopcion
      ? await revisarYaEmitida(guard.service, propuestaId)
      : await revisarPropuestaEmitible(guard.service, propuestaId);
    if (!emitible.ok) {
      return NextResponse.json(
        { ok: false, error: emitible.error, detalle: emitible.detalle, folio: emitible.folio ?? null, boleta_id: emitible.boletaId ?? null, boleta_created_at: emitible.boletaCreatedAt ?? null },
        { status: emitible.status },
      );
    }
    // Destino único (carril extensión, mismo criterio que emitir-lote): un «¿?» no se
    // emite sin decidir. Una no-venta APROBADA sí (el humano manda, 2026-09-01). La
    // verificación (adopción) no emite: queda fuera. Va DESPUÉS de "ya emitida / a
    // medias" (esas se saltan sin frenar el lote) y ANTES de tomar el candado.
    if (!cleanText(payload.adopta_job_id)) {
      const p = (propDatos ?? {}) as { tipo_propuesto?: string | null; tipo_dte?: number | null; fuente_clasificacion?: string | null };
      const noEmitible = motivoNoEmitible({ tipo_propuesto: p.tipo_propuesto ?? null, tipo_dte: p.tipo_dte ?? null, fuente_clasificacion: p.fuente_clasificacion ?? null });
      if (noEmitible) {
        return NextResponse.json({ ok: false, error: noEmitible.code, detalle: noEmitible.msg }, { status: 409 });
      }
    }

    // EL SERVIDOR MANDA EN LOS DATOS (seguridad 2026-09-30, punto 2; datos-job.ts): lo
    // que la extensión va a teclear en el SII sale del navegador. Si no calza con la
    // propuesta guardada (pestaña vieja, evento perdido, otra persona la editó) → 409
    // ANTES de tomar el candado: no se emite un documento distinto al aprobado. Va
    // DESPUÉS de "ya emitida / a medias" (esas se SALTAN sin frenar el lote). La
    // verificación (adopción) no emite nada: queda fuera.
    if (!adopcion) {
      const enviados = leerDatosEnviados(payload.datos);
      const emp = empresa as { giro?: string | null; razon_social?: string | null; tipo_contribuyente?: string | null; boletas_tipo_default?: string | null; facturas_tipo_default?: string | null; operacion_hint_default?: string | null } | null;
      const hintEmp = emp?.operacion_hint_default ?? null;
      const empresaCtx = emp
        ? {
            giro: emp.giro ?? null, razon_social: emp.razon_social ?? "", tipo_contribuyente: emp.tipo_contribuyente ?? null,
            boletas_tipo_default: emp.boletas_tipo_default ?? null, facturas_tipo_default: emp.facturas_tipo_default ?? null,
            operacion_default: (hintEmp && ["p2p_cripto", "forex_divisas", "servicios", "ventas", "mixto"].includes(hintEmp) ? hintEmp : null) as DocumentoHint,
          }
        : null;
      const cmp = enviados ? compararDatosJob(propDatos as PropuestaDatos, tipoDte, enviados, empresaCtx) : ({ ok: false, campos: ["datos"] } as const);
      if (!cmp.ok) {
        await recordOpsEvent({
          sb: guard.service,
          severity: "warn",
          source: "emision",
          eventName: "emission_datos_cambiaron",
          summary: `El navegador pidió emitir con datos que no calzan con la propuesta (${cmp.campos.join(", ")})`,
          cuentaId: guard.cuentaId,
          empresaId: guard.empresaId,
          usuarioId: guard.userId,
          resourceType: "propuesta_ia",
          resourceId: propuestaId,
          metadata: { campos: cmp.campos, tipo_dte: tipoDte },
        });
        // Pestaña con JS viejo (no manda datos): además `code: EMISION_PAUSADA`, que el
        // clasificador VIEJO ya entiende como pausa limpia (conserva lo pendiente y
        // muestra el detalle) en vez de "¿Saltar y seguir?" boleta por boleta.
        return NextResponse.json(
          enviados
            ? { ok: false, error: "DATOS_CAMBIARON", campos: cmp.campos, detalle: textoDatosCambiaron((propDatos as PropuestaDatos | null)?.mesa) }
            : { ok: false, error: "DATOS_CAMBIARON", code: "EMISION_PAUSADA", campos: cmp.campos, detalle: DETALLE_DATOS_FALTAN },
          // Actualización invisible (2026-09-30): la pestaña vieja ignora esta cabecera
          // (sigue con la pausa limpia de arriba); una con el actualizador se pone al
          // día sola cuando la emisión termina, sin pedirle a la clienta que recargue.
          { status: 409, headers: enviados ? undefined : { [CABECERA_ACTUALIZAR]: "1" } },
        );
      }
    }

    // GATE DE CUOTA DEL PLAN (crítica #1 de la auditoría). Las masivas (con
    // propuesta_id) consumen el cupo del plan; las boletas ÚNICAS (sin propuesta_id)
    // son ilimitadas y por eso quedan FUERA de este bloque. Antes el carril real solo
    // miraba plan_activo (booleano) → un plan chico emitía masivas ILIMITADAS. Ahora
    // el número lo manda el plan. El plan se activa a mano (cuentas.plan_activo +
    // plan_codigo) aunque todavía no haya pago por MercadoPago: estadoCuota ya honra
    // ese plan manual (planActivoManual). Una boleta por job → cantidad=1; el consumo
    // se DERIVA de boletas_emitidas (no hay contador que mantener). dev_mode bypassa
    // para las pruebas internas del operador.
    // La verificación de un intento anterior NO emite nada nuevo: no consume cupo (si
    // el plan se agotó entre medio, la clienta igual tiene que poder saber si salió).
    const { data: devRow } = adopcion ? { data: null } : await guard.service
      .from("usuarios")
      .select("dev_mode")
      .eq("id", guard.userId)
      .maybeSingle();
    const cuota = adopcion ? ({ ok: true } as const) : await verificarEmisionMasiva(guard.service, guard.empresaId, 1, {
      devBypass: devRow?.dev_mode === true,
    });
    if (!cuota.ok) {
      return NextResponse.json(
        { ok: false, error: cuota.codigo, detalle: cuota.detalle, disponible: cuota.disponible },
        { status: 402 },
      );
    }
  }

  // GUARD TRIBUTARIO — un emisor exento no puede emitir afecta (boleta 39 ni
  // factura 33). Fail-closed: rechaza y enruta a Check (NO normaliza en
  // silencio: en el carril real la UI mostraría "Afecta" mientras emite exenta
  // → descuadre). El mock sí normaliza (arma todo el payload, es seguro allá).
  // El guard juzga con el tipo DEL CARRIL del documento (2026-09-04): un 33/34
  // se mide contra `facturas_tipo_default` y un 39/41 contra
  // `boletas_tipo_default`, heredando el general de la empresa cuando el carril
  // no tiene valor propio. Antes los cuatro tipos se medían contra el mismo
  // `tipo_contribuyente`, así que una empresa con boletas exentas y facturas
  // afectas no podía emitir sus facturas.
  const carrilDelDte = tipoDte === 33 || tipoDte === 34 ? "factura" : "boleta";
  const guardTipo = guardTipoDteEmisor(
    tipoDte as 33 | 34 | 39 | 41,
    tipoDelCarril(empresa ?? null, carrilDelDte),
  );
  if (!guardTipo.ok) {
    return NextResponse.json(
      { ok: false, error: guardTipo.code, detalle: "Tu empresa es exenta: esta venta no puede emitirse como afecta (con IVA). Cámbiala a exenta en Revisar." },
      { status: 422 },
    );
  }

  // Adopción: suelta el candado del job viejo SIN cambiarle el estado — sigue siendo
  // lápida (lapida.ts) y bloquea re-emitir hasta el veredicto. Acotado a ESE job_id y
  // SOLO si el candado vivo de la cuenta es justamente el suyo: con otro candado vivo
  // (el lote corriendo, otra persona) el acquire de abajo va a fallar y no se toca nada.
  // (Un candado vencido lo limpia el propio acquire.)
  if (adopcion) {
    const { data: vivo } = await guard.service
      .from("emision_locks")
      .select("job_id")
      .eq("cuenta_id", guard.cuentaId)
      .gt("locked_until", new Date().toISOString())
      .maybeSingle();
    if (vivo?.job_id === adopcion.jobViejoId) {
      await guard.service.from("emision_locks").delete().eq("cuenta_id", guard.cuentaId).eq("job_id", adopcion.jobViejoId);
    }
  }

  const lock = await acquireCuentaEmissionLock({
    sb: guard.service,
    cuentaId: guard.cuentaId,
    empresaId: guard.empresaId,
    userId: guard.userId,
    provider,
    // El enlace verificación → job adoptado nace con el job (lo valida el veredicto).
    origin: adopcion ? origenAdopcion(adopcion.jobViejoId, adopcion.via) : cleanText(payload.origin) ?? ORIGIN_BOLETA_UNICA,
    expectedEmisorRut,
    propuestaId,
    ttlSeconds: provider === "sii_local" ? 15 * 60 : 5 * 60,
  });

  if (!lock.ok) {
    if (lock.error === "EMISION_BLOQUEADA") {
      await recordOpsEvent({
        sb: guard.service,
        severity: "warn",
        source: "emision",
        eventName: "emission_lock_blocked",
        summary: "Emision bloqueada por otro job activo en la cuenta",
        cuentaId: guard.cuentaId,
        empresaId: guard.empresaId,
        usuarioId: guard.userId,
        metadata: { provider, tipo_dte: tipoDte },
      });
      return NextResponse.json(
        {
          ok: false,
          error: lock.error,
          business_mode: businessMode,
          bloqueo: await bloqueoActual(guard.service, guard.cuentaId, businessMode, guard.userId),
        },
        { status: 409 },
      );
    }
    await recordOpsEvent({
      sb: guard.service,
      severity: "error",
      source: "emision",
      eventName: "emission_lock_acquire_failed",
      summary: "No se pudo crear lock de emision",
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      metadata: { provider, tipo_dte: tipoDte, error: lock.error, detalle: lock.detalle },
    });
    return NextResponse.json({ ok: false, error: lock.error, detalle: lock.detalle }, { status: 500 });
  }

  // RE-CHEQUEO CON EL CANDADO TOMADO (2026-09-28): ya emitida + a medias. El
  // chequeo de arriba corre sin candado: dos personas emitiendo la misma empresa
  // ("Marge y yo") pueden pasar ambas el chequeo y la segunda tomar el candado justo
  // cuando la primera ya guardó su boleta (o la dejó a medias: el lote suelta el
  // candado al sellar la lápida). Con el candado en mano la foto es firme.
  if (propuestaId) {
    const post = adopcion ? await revisarYaEmitida(guard.service, propuestaId) : await revisarPostCandado(guard.service, propuestaId);
    if (!post.ok) {
      await releaseCuentaEmissionLock({ sb: guard.service, cuentaId: guard.cuentaId, jobId: lock.jobId, estado: "cancelled" });
      return NextResponse.json(
        { ok: false, error: post.error, detalle: post.detalle, folio: post.folio ?? null, boleta_id: post.boletaId ?? null, boleta_created_at: post.boletaCreatedAt ?? null },
        { status: post.status },
      );
    }
  }

  // INTENTO de la boleta única (rev. adversarial M1): lo que se va a teclear en el SII
  // (monto/tipo/receptor) queda en el job. Si queda a medias, la lápida dice QUÉ
  // boleta buscar y su folio se registra con ESTOS datos, no con el borrador que la
  // persona tenga abierto después. Best-effort: sin la migración (columna `intento`)
  // el UPDATE falla y la emisión sigue igual (el folio a mano pide el monto).
  if (!propuestaId && !adopcion) {
    const intento = leerIntento(payload.intento);
    if (intento) {
      try {
        await guard.service.from("emision_jobs").update({ intento } as never).eq("job_id", lock.jobId);
      } catch { /* best-effort */ }
    }
  }

  // ID interno R-XXX-XXX (2026-09-28): uno por propuesta; el reintento reusa el mismo.
  // Para soporte y para que la clienta no se pierda; NO va a la boleta del SII.
  // Best-effort TOTAL: sin la migración aplicada o si falla, la emisión sigue igual.
  let refEmision: string | null = null;
  if (propuestaId && !adopcion) {
    try {
      const { data: refData, error: refErr } = await guard.service.rpc("emision_ref_nueva", {
        p_empresa_id: guard.empresaId,
        p_propuesta_id: propuestaId,
        p_tipo_dte: tipoDte,
      });
      if (!refErr && typeof refData === "string") {
        refEmision = refData;
        await guard.service.from("emision_jobs").update({ ref: refEmision }).eq("job_id", lock.jobId);
      }
    } catch { /* best-effort */ }
  }

  let reservedFolio: number | null = null;
  if (provider === "simpleapi") {
    const reserva = await reserveSimpleApiFolio({
      sb: guard.service,
      empresaId: guard.empresaId,
      tipoDte,
      jobId: lock.jobId,
      expiresAt: lock.lockedUntil,
    });
    if (!reserva.ok) {
      await releaseCuentaEmissionLock({ sb: guard.service, cuentaId: guard.cuentaId, jobId: lock.jobId, estado: "cancelled" });
      await recordOpsEvent({
        sb: guard.service,
        severity: "error",
        source: "emision",
        eventName: "simpleapi_folio_reservation_failed",
        summary: "No se pudo reservar folio para emision SimpleAPI",
        cuentaId: guard.cuentaId,
        empresaId: guard.empresaId,
        usuarioId: guard.userId,
        resourceType: "emision_job",
        resourceId: lock.jobId,
        metadata: { tipo_dte: tipoDte, error: reserva.error, detalle: reserva.detalle },
      });
      return NextResponse.json(
        { ok: false, error: reserva.error, detalle: reserva.detalle ?? "No se pudo reservar folio SimpleAPI." },
        { status: 409 },
      );
    }
    reservedFolio = reserva.folio;
  }

  // Folios que ESTA empresa ya tiene registrados hoy para este tipo (0.2.8, cierre
  // del ciclo): la extensión los excluye al calzar el folio en /reportes, así una
  // boleta anterior del mismo monto nunca se "encuentra" como si fuera la nueva. La
  // fuente es el server (boletas_emitidas), no la sesión de la extensión, que se
  // vacía entre boletas. Best-effort: sin la lista el worker simplemente no cierra
  // solo (queda "a medias"), nunca cruza un folio.
  let foliosHoy: number[] = [];
  if (provider === "sii_local") {
    try {
      const diaChile = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
      // Adopción: los folios del día del INTENTO (hoy es la fecha de la verificación,
      // no necesariamente la del intento — plan §1.2).
      const ahora = adopcion ? new Date(adopcion.ventana.desde_ms) : new Date();
      const hoyChile = diaChile(ahora);
      const ayerChile = diaChile(new Date(ahora.getTime() - 24 * 3600 * 1000));
      const { data: hoy } = await guard.service
        .from("boletas_emitidas")
        .select("folio")
        .eq("empresa_id", guard.empresaId)
        // AMBOS tipos del carril (2026-09-28): el calce de /reportes no filtra por Tipo;
        // excluir también los folios del otro tipo evita que una 39 ya registrada del
        // mismo monto se tome como la 41 en vuelo (folio cruzado). Solo excluye: seguro.
        .in("tipo_dte", tipoDte === 33 || tipoDte === 34 ? [33, 34] : [39, 41])
        // Hoy y AYER: una boleta que cruzó la medianoche quedó registrada con la otra fecha.
        .in("fecha_emision", [hoyChile, ayerChile])
        // Anuladas INCLUIDAS: siguen en /reportes con su monto y también deben excluirse.
        .order("folio", { ascending: false })
        .limit(1000);
      foliosHoy = (hoy ?? []).map((b) => Number(b.folio)).filter((n) => Number.isInteger(n) && n > 0);
    } catch { /* best-effort */ }
  }

  if (adopcion) {
    await recordOpsEvent({
      sb: guard.service,
      severity: "info",
      source: "emision",
      eventName: "emision_adopcion_verificacion",
      summary: `Verificación de un intento sin respuesta (${adopcion.via === "vencido" ? "vencido" : "fin confirmado por la extensión"})`,
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      resourceType: "emision_job",
      resourceId: lock.jobId,
      metadata: { adopta_job_id: adopcion.jobViejoId, via: adopcion.via, fecha_intento: adopcion.fechaIntento },
    });
  }

  return NextResponse.json({
    ok: true,
    job_id: lock.jobId,
    ref: refEmision,
    expires_at: lock.lockedUntil,
    locked_until: lock.lockedUntil,
    cuenta_id: guard.cuentaId,
    empresa_id: guard.empresaId,
    provider,
    expected_emisor_rut: expectedEmisorRut,
    folios_hoy: foliosHoy,
    business_mode: businessMode,
    reserved_folio: reservedFolio,
    reserved_tipo_dte: provider === "simpleapi" ? tipoDte : null,
    adopcion: adopcion
      ? { job_viejo: adopcion.jobViejoId, ventana: adopcion.ventana, fecha_intento: adopcion.fechaIntento, via: adopcion.via }
      : null,
  });
}

export async function GET() {
  // SIN gate de plan/trial a propósito (auditoría adversarial 2026-09-04): este
  // GET solo informa el estado del candado de emisión y lo sondea un hook cada
  // 5 s por pestaña — meterle `puedeEmitir` costaba ~10 queries por sondeo, en
  // una ruta que no emite nada. Ver los jobs PROPIOS no es facturable; el guard
  // igual exige sesión, rol de emisión y pertenencia a la cuenta.
  const guard = await requireAccountApiAccess({ requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  let businessMode = false;
  try {
    businessMode = await businessModeForPlan(guard.service, guard.plan);
  } catch (error) {
    return NextResponse.json({ ok: false, error: "PLAN_QUERY_FAILED", detalle: error instanceof Error ? error.message : undefined }, { status: 500 });
  }

  const bloqueo = await bloqueoActual(guard.service, guard.cuentaId, businessMode, guard.userId);
  return NextResponse.json({
    ok: true,
    locked: Boolean(bloqueo),
    business_mode: businessMode,
    bloqueo,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const limited = enforceRateLimit({
    key: rateLimitKey("emision-jobs-delete", user.id),
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const service = await serviceClientOrResponse();
  if (!service.ok) return service.response;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const jobId = cleanText(payload.job_id);
  if (!jobId) return NextResponse.json({ ok: false, error: "JOB_ID_REQUIRED" }, { status: 400 });

  // CAJA NEGRA: el cliente manda el último mensaje de estado de la extensión como
  // motivo del cierre. Es texto TÉCNICO del RPA (p.ej. "no pude abrir el SII",
  // "login fallido") — NO PII de terceros. Se guarda para poder diagnosticar por
  // qué falló una emisión sin depender de mirar la consola en la máquina del user.
  const motivo = cleanText(payload.status_message)?.slice(0, 500) ?? null;

  const { data: job, error } = await service.service
    .from("emision_jobs")
    // estado_visible: último status de la extensión (latido) → ¿alcanzó a apretar
    // EMITIR? Decide si un `cancelled` de boleta única se sella lápida (cierre-seguro.ts).
    .select("job_id, cuenta_id, empresa_id, usuario_id, estado, estado_visible, provider, propuesta_id, created_at, expires_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_job_delete_query_failed",
      summary: "No se pudo consultar job para cancelar emision",
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: jobId,
      error,
    });
    return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED", detalle: error.message }, { status: 500 });
  }
  if (!job) return NextResponse.json({ ok: false, error: "JOB_NOT_FOUND" }, { status: 404 });
  if (job.usuario_id !== user.id) return NextResponse.json({ ok: false, error: "JOB_FORBIDDEN" }, { status: 403 });
  // Con propuesta (job del lote), un `cancelled` se sella como lápida: pudo haber
  // apretado EMITIR (riesgo C, ver cierre-seguro.ts).
  const pedido = cleanCloseEstado(payload.estado);
  // Solo sobre jobs ABIERTOS: un `cancelled` tardío sobre un job ya cerrado `failed`
  // (pre-emit seguro / verificado "no salió") no debe volverse una lápida espuria.
  const abierto = job.estado === "created" || job.estado === "running";
  const estado = abierto ? estadoCierreSeguro(pedido, job) : pedido;
  // Idempotencia + no re-procesar, CON una excepción crítica: la carrera
  // CAPTURE_DEBUG puede sellar 'failed' un job que en verdad emitió (evidencia
  // débil post-EMITIR). Un terminal PERMISIVO ('failed'/'cancelled'/'expired')
  // DEBE poder recibir la lápida 'revision_pendiente' para bloquear la re-emisión
  // (que quemaría el folio). Los estados PROTECTORES (registrada/lápida) no se
  // tocan. El guard de releaseCuentaEmissionLock refuerza esto a nivel DB.
  const yaProtegido = job.estado === "completed" || job.estado === "revision_pendiente";
  // Una lápida SIN RESPUESTA (job del lote vencido y abierto) solo baja a `failed` con
  // el veredicto "no salió" persistido por la verificación (/api/sii-local/result) o
  // con la declaración humana; un DELETE no la baja (sí puede sellarla a medias).
  if (deleteRespetaSinRespuesta(job, estado)) {
    return NextResponse.json({ ok: true, estado: job.estado, lapida: "sin_respuesta" });
  }
  const permisivoTerminal = job.estado === "failed" || job.estado === "cancelled" || job.estado === "expired";
  if (yaProtegido || (permisivoTerminal && estado !== "revision_pendiente")) {
    // Lápida de boleta única: devolver su intento para que la vista diga qué boleta
    // buscar en el SII (vuelta 2, V2-B1). `*` no rompe sin la migración.
    if (job.estado === "revision_pendiente" && !job.propuesta_id) {
      const { data: full } = await service.service.from("emision_jobs").select("*").eq("job_id", job.job_id).maybeSingle();
      return NextResponse.json({
        ok: true, estado: job.estado,
        intento: leerIntento((full as { intento?: unknown } | null)?.intento), creada_at: job.created_at,
      });
    }
    return NextResponse.json({ ok: true, estado: job.estado });
  }
  await releaseCuentaEmissionLock({ sb: service.service, cuentaId: job.cuenta_id, jobId: job.job_id, estado });

  // CAJA NEGRA (observabilidad de fallos de emisión): guarda el motivo en el job y
  // registra un ops_event en los cierres NO exitosos. Antes un fallo no dejaba
  // rastro server-side (status_message null, sin evento) → imposible diagnosticar
  // sin mirar la consola del navegador del usuario. Best-effort: nunca rompe el cierre.
  if (estado === "failed" || estado === "revision_pendiente" || estado === "cancelled") {
    try {
      if (motivo) {
        await service.service.from("emision_jobs").update({ status_message: motivo }).eq("job_id", job.job_id);
      }
      await recordOpsEvent({
        sb: service.service,
        severity: estado === "cancelled" ? "info" : "warn",
        source: "emision",
        eventName: `emission_job_${estado}`,
        summary: `Emisión cerrada como ${estado}${motivo ? `: ${motivo}` : " (el cliente no reportó motivo)"}`,
        cuentaId: job.cuenta_id,
        empresaId: job.empresa_id,
        usuarioId: user.id,
        resourceType: "emision_job",
        resourceId: job.job_id,
        metadata: { estado, provider: job.provider, es_lote: Boolean(job.propuesta_id), motivo },
      });
    } catch {
      // best-effort: la caja negra no debe romper el cierre del job
    }
  }
  // Boleta única sellada a medias por este cierre (un `cancelled` con posible clic):
  // la vista muestra su lápida con QUÉ boleta buscar en el SII. `*` no rompe sin la migración.
  if (estado === "revision_pendiente" && !job.propuesta_id) {
    const { data: full } = await service.service.from("emision_jobs").select("*").eq("job_id", job.job_id).maybeSingle();
    return NextResponse.json({
      ok: true, estado,
      intento: leerIntento((full as { intento?: unknown } | null)?.intento), creada_at: job.created_at,
    });
  }
  return NextResponse.json({ ok: true, estado });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const limited = enforceRateLimit({
    key: rateLimitKey("emision-jobs-patch", user.id),
    limit: 240,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const service = await serviceClientOrResponse();
  if (!service.ok) return service.response;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const jobId = cleanText(payload.job_id);
  if (!jobId) return NextResponse.json({ ok: false, error: "JOB_ID_REQUIRED" }, { status: 400 });

  const { data: job, error } = await service.service
    .from("emision_jobs")
    .select("job_id, cuenta_id, usuario_id, estado, provider")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_job_patch_query_failed",
      summary: "No se pudo consultar job para heartbeat de emision",
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: jobId,
      error,
    });
    return NextResponse.json({ ok: false, error: "JOB_QUERY_FAILED", detalle: error.message }, { status: 500 });
  }
  if (!job) return NextResponse.json({ ok: false, error: "JOB_NOT_FOUND" }, { status: 404 });
  if (job.usuario_id !== user.id) return NextResponse.json({ ok: false, error: "JOB_FORBIDDEN" }, { status: 403 });
  // 'revision_pendiente' (lápida) es un estado terminal PROTECTOR: un heartbeat
  // NUNCA debe resucitarlo. Antes faltaba en esta lista → un latido tardío lo
  // degradaba a 'running' (abajo), reabría su ventana, la lápida expiraba y la
  // propuesta volvía a ser emitible → doble folio. Ahora se trata como cerrado.
  if (job.estado === "completed" || job.estado === "revision_pendiente") return NextResponse.json({ ok: true, estado: job.estado, closed: true });
  // LEASE PERDIDO por cierre (seguridad 2026-09-30, punto 5): un job `cancelled` /
  // `failed` / `expired` ya no tiene candado — p. ej. alguien apretó "liberar candado"
  // desde OTRO computador mientras esta extensión seguía trabajando. Antes respondía
  // ok y la página de este computador no se enteraba; ahora 409 y la página manda
  // cerrar su ventana del SII (pre-emit se detiene; post-emit la extensión sigue
  // capturando el folio, que /result registra siempre).
  if (job.estado === "cancelled" || job.estado === "failed" || job.estado === "expired") {
    return NextResponse.json(
      { ok: false, error: "LEASE_PERDIDO", motivo: "job_cerrado", estado: job.estado, detalle: DETALLE_LEASE_PERDIDO },
      { status: 409 },
    );
  }

  const estado = cleanStatus(payload.estado ?? payload.status);
  // El heartbeat renueva la ventana del job: un RPA lento (SII lento, 2FA,
  // reintentos de PDF, cadencia humana del motor masivo) mantiene vivo el job
  // mientras siga latiendo. Sin esto, un job de sii_local muere a los 15 min y
  // el resultado —una boleta REAL ya emitida— se rechaza y se pierde.
  const ttlSeconds = job.provider === "sii_local" ? 15 * 60 : 5 * 60;
  const nuevaExpiracion = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // PRIMERO el candado (seguridad 2026-09-30, punto 3): solo se renueva si el candado
  // de la cuenta sigue siendo de ESTE job y está vivo. Si otro job lo tomó o venció →
  // 409 LEASE_PERDIDO y el job NO se renueva (antes el job se renovaba igual y el
  // UPDATE del candado calzaba 0 filas en silencio).
  const lease = await renovarLeaseCuenta({ sb: service.service, cuentaId: job.cuenta_id, jobId: job.job_id, nuevaExpiracion, estadoVisible: estado });
  if (!lease.ok && lease.error === "LEASE_PERDIDO") {
    // Carrera con /result (rev. adversarial 2 M3): releaseCuentaEmissionLock borra el
    // candado y RECIÉN DESPUÉS marca el job. Si el job ya quedó completed o a medias,
    // este latido es tardío normal, no un candado perdido.
    const { data: relectura } = await service.service.from("emision_jobs").select("estado").eq("job_id", job.job_id).maybeSingle();
    const estadoAhora = (relectura as { estado?: string } | null)?.estado;
    if (estadoAhora === "completed" || estadoAhora === "revision_pendiente") {
      return NextResponse.json({ ok: true, estado: estadoAhora, closed: true });
    }
    await recordOpsEvent({
      sb: service.service,
      severity: "warn",
      source: "emision",
      eventName: "emission_lease_perdido",
      summary: "Latido de un job que ya no tiene el candado de la cuenta (otro job lo tomó o venció)",
      cuentaId: job.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: job.job_id,
      metadata: { estado_visible: estado },
    });
    return NextResponse.json(
      { ok: false, error: "LEASE_PERDIDO", motivo: "candado_ajeno_o_vencido", estado: job.estado, detalle: DETALLE_LEASE_PERDIDO },
      { status: 409 },
    );
  }
  if (!lease.ok) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_lock_heartbeat_failed",
      summary: "No se pudo actualizar heartbeat del lock de emision",
      cuentaId: job.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: job.job_id,
      error: lease.detalle,
      metadata: { estado_visible: estado },
    });
    return NextResponse.json({ ok: false, error: "LOCK_UPDATE_FAILED", detalle: lease.detalle }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: updateJobError } = await service.service
    .from("emision_jobs")
    // estado_visible: un status post-clic va en ESTE update (atómico, vuelta 2 B1); uno
    // pre-clic va aparte (marcarEstadoVisibleLatido, abajo) para no borrar la marca de
    // posible clic que decide la lápida de la boleta única (rev. adversarial #3).
    .update({ estado: "running", heartbeat_at: now, updated_at: now, expires_at: nuevaExpiracion, locked_until: nuevaExpiracion, ...estadoVisibleEnLatidoPrincipal(estado) })
    .eq("job_id", job.job_id)
    // Cinturón y tiradores: aunque el corte de arriba ya cubre los estados
    // terminales, gateamos el UPDATE a solo activos para que ningún estado
    // protector pueda ser degradado a 'running' por un latido que gane una carrera
    // contra el sellado (SELECT :506 y UPDATE no son atómicos).
    .in("estado", ["created", "running"]);
  if (updateJobError) {
    await recordOpsError({
      sb: service.service,
      severity: "error",
      source: "emision",
      eventName: "emission_job_heartbeat_failed",
      summary: "No se pudo actualizar heartbeat del job de emision",
      cuentaId: job.cuenta_id,
      usuarioId: user.id,
      resourceType: "emision_job",
      resourceId: job.job_id,
      error: updateJobError,
      metadata: { estado_visible: estado },
    });
    return NextResponse.json({ ok: false, error: "JOB_UPDATE_FAILED", detalle: updateJobError.message }, { status: 500 });
  }
  // Monótona: un status pre-clic no pisa uno post-clic. Best-effort como la caja negra:
  // si falla, el latido ya renovó el job y el candado.
  const marca = estadoVisibleEnLatidoPrincipal(estado).estado_visible
    ? { error: null }
    : await marcarEstadoVisibleLatido(service.service, job.job_id, estado);
  if (marca.error) {
    await recordOpsError({
      sb: service.service, severity: "error", source: "emision", eventName: "emission_job_estado_visible_failed",
      summary: "No se pudo anotar el estado visible del latido", cuentaId: job.cuenta_id, usuarioId: user.id,
      resourceType: "emision_job", resourceId: job.job_id, error: marca.error.message, metadata: { estado_visible: estado },
    });
  }

  return NextResponse.json({ ok: true, estado, heartbeat_at: now });
}

export const dynamic = "force-dynamic";
