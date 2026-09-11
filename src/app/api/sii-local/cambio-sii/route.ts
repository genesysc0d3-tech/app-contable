import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { recordOpsEvent } from "@/lib/ops/events";
import { ANCLA_LABELS, ANCLA_LABELS_BOLETA, ANCLAS_AUTO_KILL, describeAncla } from "@/lib/emission/sii-libreto";
import { AUTO_PAUSA_UMBRAL, AUTO_PAUSA_WINDOW_MS } from "@/lib/ops/diagnostics";
import { crearPausa, hayPausaParaCarril, pausasVivas, type CarrilEmision } from "@/lib/ops/emision-pausas";
import { enviarAlertaCritica } from "@/lib/ops/alertas";
import { sanitizeMapaPortal } from "@/lib/ops/sanitize";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";

/**
 * Aviso de POSIBLE CAMBIO DEL PORTAL DEL SII.
 *
 * El worker del RPA avisa (vía app-bridge) que un ANCLA ESTRUCTURAL del portal
 * —un selector/form del libreto que SIEMPRE debería existir— no apareció. Eso,
 * repetido en varias empresas, casi siempre significa que el SII cambió su
 * página.
 *
 * TANDA 1 (2026-09-10) — lo que cambió respecto del aviso pasivo original:
 *   · La empresa se atribuye por el JOB (`emision_jobs.job_id`, dueño = este
 *     usuario) y no por `usuarios.empresa_id`: un usuario Business con varias
 *     empresas avisaba siempre bajo la primera, y el conteo "empresas
 *     distintas" se quedaba corto.
 *   · Acepta `code`, `paso`, `mapa` (saneado, ≤2 KB) y `posible_cambio_sii`
 *     del worker nuevo: diagnóstico sin abrir la consola del cliente.
 *     `posible_cambio_sii === false` = el worker dice que NO fue el portal
 *     (sesión, permiso…): se registra igual, pero NO cuenta para el umbral.
 *   · Actualiza `empresas.ext_last_version/ext_last_seen_at` (antes solo se
 *     escribía al emitir OK — justo cuando el portal cambia, deja de escribirse).
 *   · AUTO-KILL: al insertar, cuenta EMPRESAS distintas que pegaron la MISMA
 *     ancla en la ventana. Si llega al umbral y no hay pausa viva del carril →
 *     pausa `auto` de 2 h + ops_event critical + alerta AL TIRO.
 *
 * ENDURECIDO tras 3 revisiones adversariales (2026-09-10) — un cliente (o un
 * bug de UNA cuenta) no puede pausar producción para todos:
 *   a. Solo cuentan anclas ESTRUCTURALES (ANCLAS_AUTO_KILL). Slots, toggles,
 *      pago, receptor, glosa y "otro" se registran pero jamás suman.
 *   b. Ventana y umbral PROPIOS del auto-kill: 3 empresas distintas en 2 h
 *      (AUTO_PAUSA_*). El panel sigue con 2 / 24 h (CAMBIO_SII_*).
 *   c. No se re-arma solo: solo cuentan eventos POSTERIORES a la última pausa
 *      del carril (viva o levantada) y al último `emision_pausa_off`.
 *   d. El job debe existir, ser de este usuario, estar `running`/`failed` y
 *      tener ≤ 24 h. Si no, el aviso queda pero no cuenta.
 *   e. "Veterana" = empresa con ≥1 documento REAL (sii_local o simpleapi; el
 *      mock no cuenta), contado por empresa con head+count.
 *   f. Máximo 1 evento contable por empresa+ancla por hora.
 *   g. Rate limit por usuario.
 *   h. Antes de crear la pausa se re-consulta si ya hay una viva (dos POST
 *      concurrentes); no es atómico, y está aceptado que no lo sea.
 *
 * Cada evento lleva `metadata.auto_kill_contable` (true/false) + `motivo_no_contable`:
 * el conteo solo mira los `true`, así que las reglas a/d/f se deciden UNA vez,
 * al insertar, y el panel puede auditar por qué un aviso no sumó.
 *
 * NO recibe datos del cliente: solo el ROL del ancla (lista blanca), la página,
 * la versión, códigos del worker y un mapa saneado del HTML público del SII.
 * Fail-open en todo lo accesorio: si el auto-kill falla, el aviso igual queda.
 */
interface CambioSiiPayload {
  job_id?: string | null;
  portal?: string | null;
  ancla?: string | null;
  error?: string | null;
  page_kind?: string | null;
  libreto_version?: number | null;
  extension_version?: string | null;
  code?: string | null;
  paso?: string | null;
  mapa?: unknown;
  posible_cambio_sii?: boolean | null;
}

const CODE_RE = /^[A-Z0-9_]{3,40}$/;
const VERSION_RE = /^\d+(\.\d+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Duración de la pausa automática. */
const AUTO_PAUSA_MS = 2 * 60 * 60 * 1000;
/** Un job más viejo que esto no puede atribuir un aviso contable (F1d). */
const JOB_MAX_EDAD_MS = 24 * 60 * 60 * 1000;
/** Estados de emision_jobs en los que un aviso de ancla tiene sentido (F1d). */
const JOB_ESTADOS_CONTABLES = new Set(["running", "failed"]);
/** Dedupe al contar/insertar: 1 evento contable por empresa+ancla por hora (F1f). */
const DEDUPE_EMPRESA_ANCLA_MS = 60 * 60 * 1000;
/** Proveedores que dejan un documento REAL (el mock no hace veterana a nadie) (F1e). */
const PROVEEDORES_REALES = ["sii_local", "simpleapi"];
/** Tope de empresas candidatas a verificar como veteranas (una consulta por empresa). */
const MAX_CANDIDATAS = 12;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

type Sb = NonNullable<ReturnType<typeof serviceClient>>;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  // F1g: un worker en bucle (o un cliente malicioso) no inunda ops_events ni
  // el conteo. Un lote real avisa a lo más una vez por documento fallido.
  const limited = enforceRateLimit({
    key: rateLimitKey("sii-cambio-sii-post", user.id),
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let payload: CambioSiiPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  // Lista blanca: solo roles de ancla conocidos. Cualquier otra cosa se
  // normaliza a "otro" — el cliente no escribe texto libre en ops_events.
  const anclaRaw = typeof payload.ancla === "string" ? payload.ancla.trim() : "";
  const anclaConocida = anclaRaw in ANCLA_LABELS || anclaRaw in ANCLA_LABELS_BOLETA;
  const ancla = anclaConocida ? anclaRaw : "otro";
  const portal = payload.portal === "boletas" ? "boletas" : "facturas";
  const carril: CarrilEmision = portal;
  const tipoDoc = portal === "boletas" ? "boleta" : "factura";
  const jobId = typeof payload.job_id === "string" && payload.job_id.trim() ? payload.job_id.trim().slice(0, 80) : null;
  const code = typeof payload.code === "string" && CODE_RE.test(payload.code) ? payload.code : null;
  const paso = typeof payload.paso === "string" && payload.paso.trim() ? payload.paso.trim().slice(0, 40) : null;
  const mapa = payload.mapa !== undefined && payload.mapa !== null ? sanitizeMapaPortal(payload.mapa) : null;
  const posibleCambio = payload.posible_cambio_sii === false ? false : true;
  const extVersion = typeof payload.extension_version === "string" && VERSION_RE.test(payload.extension_version)
    ? payload.extension_version
    : null;

  // Empresa: primero por el JOB (dueño = este usuario, fail-closed a null si no
  // calza), después el fallback histórico por usuarios.empresa_id.
  // F1d: además el job debe estar en un estado con sentido y ser reciente para
  // que el aviso CUENTE (un job_id viejo reciclado o inventado no suma).
  const sb = serviceClient();
  let empresaId: string | null = null;
  let jobContable = false;
  let motivoJob: string | null = jobId ? "job_no_encontrado" : "sin_job";
  if (sb && jobId) {
    const { data: job } = await sb
      .from("emision_jobs")
      .select("empresa_id, usuario_id, estado, created_at")
      .eq("job_id", jobId)
      .maybeSingle();
    if (job && job.usuario_id === user.id && UUID_RE.test(job.empresa_id)) {
      empresaId = job.empresa_id;
      const edadMs = Date.now() - Date.parse(job.created_at);
      if (!JOB_ESTADOS_CONTABLES.has(job.estado)) motivoJob = `job_estado:${job.estado}`;
      else if (!(edadMs >= 0 && edadMs <= JOB_MAX_EDAD_MS)) motivoJob = "job_viejo";
      else { jobContable = true; motivoJob = null; }
    } else if (job) {
      motivoJob = "job_ajeno";
    }
  }
  if (!empresaId) {
    const { data: u } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).maybeSingle();
    empresaId = u?.empresa_id ?? null;
  }

  // Telemetría de flota: hasta hoy ext_last_version solo se escribía al emitir
  // OK (result/route.ts), o sea NUNCA mientras el portal está roto — que es
  // exactamente cuando /dev necesita saber qué versión corre cada empresa.
  if (sb && empresaId && extVersion) {
    try {
      await sb
        .from("empresas")
        .update({ ext_last_version: extVersion, ext_last_seen_at: new Date().toISOString() })
        .eq("id", empresaId);
    } catch { /* columnas sin migrar o fallo puntual: la telemetría espera */ }
  }

  // ¿Este aviso CUENTA para el auto-kill? Se decide acá, una vez, y queda en
  // la metadata para que el conteo y el panel lean lo mismo.
  let contable = false;
  let motivoNoContable: string | null = null;
  if (!posibleCambio) motivoNoContable = "worker_descarto_portal";
  else if (!ANCLAS_AUTO_KILL.has(ancla)) motivoNoContable = "ancla_no_estructural";
  else if (!sb) motivoNoContable = "sin_service_client";
  else if (!empresaId) motivoNoContable = "sin_empresa";
  else if (!jobContable) motivoNoContable = motivoJob ?? "job_no_contable";
  else {
    // F1f: si la misma empresa ya tiene un evento contable de esta ancla en la
    // última hora, este no suma (un lote de 40 boletas fallando = 1 voto).
    try {
      const reciente = await hayEventoContableReciente(sb, empresaId, ancla);
      if (reciente) motivoNoContable = "dedupe_empresa_ancla_1h";
      else contable = true;
    } catch {
      motivoNoContable = "dedupe_no_verificable";
    }
  }

  await recordOpsEvent({
    severity: "warn", // 1 empresa = a vigilar; la escalada a crítico es abajo (umbral) y en /dev
    source: "sii-local",
    eventName: "sii_local_posible_cambio_ancla",
    summary: `Portal SII (${tipoDoc}): no apareció ${describeAncla(ancla)}`,
    empresaId,
    usuarioId: user.id,
    resourceType: "emision_job",
    resourceId: jobId,
    metadata: {
      ancla, // rol estable → clave de agrupación en /dev
      portal,
      error: typeof payload.error === "string" ? payload.error.slice(0, 60) : null,
      page_kind: typeof payload.page_kind === "string" ? payload.page_kind.slice(0, 40) : null,
      libreto_version: typeof payload.libreto_version === "number" ? payload.libreto_version : null,
      extension_version: extVersion,
      code,
      paso,
      posible_cambio_sii: posibleCambio,
      auto_kill_contable: contable,
      motivo_no_contable: motivoNoContable,
      mapa,
    },
  });

  // ── AUTO-KILL ──────────────────────────────────────────────────────────────
  // Solo se evalúa si ESTE aviso cuenta: si no suma, tampoco puede haber
  // cambiado el resultado del umbral.
  let autoPausa: { creada: boolean; empresas: number } = { creada: false, empresas: 0 };
  if (sb && contable) {
    try {
      autoPausa = await evaluarAutoPausa(sb, { ancla, carril, portal, tipoDoc, code, extVersion });
    } catch (error) {
      await recordOpsEvent({
        sb,
        severity: "error",
        source: "sii-local",
        eventName: "emision_auto_pausa_failed",
        summary: "No se pudo evaluar el auto-kill por cambio del portal SII",
        empresaId,
        usuarioId: user.id,
        metadata: { ancla, carril, error: error instanceof Error ? error.message : String(error) },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, auto_pausa: autoPausa.creada, empresas_afectadas: autoPausa.empresas });
}

/** F1f: ¿la empresa ya tiene un evento CONTABLE de esta ancla en la última hora? */
async function hayEventoContableReciente(sb: Sb, empresaId: string, ancla: string): Promise<boolean> {
  const desde = new Date(Date.now() - DEDUPE_EMPRESA_ANCLA_MS).toISOString();
  const { count, error } = await sb
    .from("ops_events")
    .select("id", { count: "exact", head: true })
    .eq("event_name", "sii_local_posible_cambio_ancla")
    .eq("empresa_id", empresaId)
    .eq("metadata->>ancla", ancla)
    .eq("metadata->>auto_kill_contable", "true")
    .gte("created_at", desde);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * F1c: desde cuándo cuentan los eventos. Solo los posteriores a la ÚLTIMA pausa
 * del carril (viva o ya levantada — `emision_pausas.created_at`) y al último
 * `emision_pausa_off` del carril (o 'todo'). Sin eso, al levantar la pausa los
 * mismos eventos la volvían a armar al primer aviso nuevo.
 */
async function desdeCuandoCuentan(sb: Sb, carril: CarrilEmision): Promise<string> {
  const ventana = new Date(Date.now() - AUTO_PAUSA_WINDOW_MS).toISOString();
  const [ultimaPausa, ultimoOff] = await Promise.all([
    sb
      .from("emision_pausas")
      .select("created_at")
      .in("carril", [carril, "todo"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("ops_events")
      .select("created_at")
      .eq("event_name", "emision_pausa_off")
      .in("metadata->>carril", [carril, "todo"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (ultimaPausa.error) throw new Error(ultimaPausa.error.message);
  if (ultimoOff.error) throw new Error(ultimoOff.error.message);
  const marcas = [ventana, ultimaPausa.data?.created_at, ultimoOff.data?.created_at].filter((v): v is string => Boolean(v));
  // Los ISO en UTC se comparan como texto; el mayor es el más reciente.
  return marcas.sort().at(-1) ?? ventana;
}

/** F1e: ¿la empresa tiene al menos un documento REAL (sii_local o simpleapi)? */
async function esVeterana(sb: Sb, empresaId: string): Promise<boolean> {
  const { count, error } = await sb
    .from("boletas_emitidas")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .in("emision_proveedor", PROVEEDORES_REALES);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * ¿Ya son ≥ AUTO_PAUSA_UMBRAL empresas DISTINTAS y VETERANAS tropezando con la
 * MISMA ancla estructural desde la última pausa, dentro de la ventana de 2 h?
 * Entonces es el SII, no una cuenta: pausa `auto` del carril por 2 h + alerta
 * al tiro. Si ya hay una pausa viva del carril (manual o auto), no se apila.
 */
async function evaluarAutoPausa(
  sb: Sb,
  args: { ancla: string; carril: CarrilEmision; portal: string; tipoDoc: string; code: string | null; extVersion: string | null },
): Promise<{ creada: boolean; empresas: number }> {
  const desde = await desdeCuandoCuentan(sb, args.carril);
  const { data: eventos, error } = await sb
    .from("ops_events")
    .select("empresa_id")
    .eq("event_name", "sii_local_posible_cambio_ancla")
    .eq("metadata->>ancla", args.ancla)
    .eq("metadata->>auto_kill_contable", "true")
    .gt("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  // count(distinct empresa_id): el dedupe por hora ya se aplicó al insertar,
  // pero por si dos POST de la misma empresa entraron en paralelo, se cuenta
  // por empresa igual.
  const candidatas = new Set<string>();
  for (const row of eventos ?? []) if (row.empresa_id) candidatas.add(row.empresa_id);
  if (candidatas.size < AUTO_PAUSA_UMBRAL) return { creada: false, empresas: candidatas.size };

  // Solo empresas que YA emitieron algo real: descarta cuentas nuevas peleando
  // con su primera configuración (permisos, sesión), que no son el portal.
  let n = 0;
  for (const id of [...candidatas].slice(0, MAX_CANDIDATAS)) {
    if (await esVeterana(sb, id)) n += 1;
  }
  if (n < AUTO_PAUSA_UMBRAL) return { creada: false, empresas: n };

  // F1h: re-consultar justo antes de crear (dos POST concurrentes). No es
  // atómico —aceptado—: en el peor caso quedan dos pausas `auto` del mismo
  // carril, que se levantan juntas desde /dev.
  const vivas = await pausasVivas(sb);
  if (vivas.error) throw new Error(vivas.error);
  if (hayPausaParaCarril(vivas.pausas, args.carril)) return { creada: false, empresas: n };

  const hasta = new Date(Date.now() + AUTO_PAUSA_MS);
  const horas = Math.round(AUTO_PAUSA_WINDOW_MS / 3600000);
  const motivo = `auto: ancla "${args.ancla}" (${args.tipoDoc}) falló en ${n} empresas veteranas en ${horas} h${args.code ? ` · ${args.code}` : ""}`;
  const creada = await crearPausa(sb, { carril: args.carril, hasta, motivo, origen: "auto", creadoPor: "cambio-sii" });
  if (!creada.ok) throw new Error(creada.error);

  const summary = `Emisión de ${args.carril} PAUSADA automáticamente 2 h: el ancla "${args.ancla}" del portal SII falló en ${n} empresas distintas`;
  await recordOpsEvent({
    sb,
    severity: "critical",
    source: "sii-local",
    eventName: "emision_pausa_on",
    summary,
    resourceType: "emision_pausa",
    resourceId: creada.id,
    metadata: {
      carril: args.carril,
      origen: "auto",
      hasta: hasta.toISOString(),
      ancla: args.ancla,
      empresas_distintas: n,
      code: args.code,
      extension_version: args.extVersion,
    },
  });

  // Alerta AL TIRO (mismos canales que el cron): un cambio del SII no espera al
  // día siguiente. Si ningún canal está configurado, queda en el panel /dev.
  const alerta = await enviarAlertaCritica({
    status: "critical",
    checkedAt: new Date().toISOString(),
    findings: [{ severity: "critical", eventName: "emision_pausa_on", summary }],
  });
  if (!alerta.enviada && alerta.errores.length > 0) {
    await recordOpsEvent({
      sb,
      severity: "error",
      source: "sii-local",
      eventName: "ops_alert_failed",
      summary: "No se pudo enviar la alerta del auto-kill",
      metadata: { errores: alerta.errores },
    }).catch(() => {});
  }
  return { creada: true, empresas: n };
}

export const dynamic = "force-dynamic";
