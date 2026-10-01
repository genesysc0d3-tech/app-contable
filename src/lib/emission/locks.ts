import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { finalizeFolioReservaForJob } from "@/lib/emission/folio-reservas";

type Sb = SupabaseClient<Database>;
type Provider = "mock" | "sii_local" | "simpleapi";

export type CuentaEmissionLock =
  | { ok: true; jobId: string; lockedUntil: string }
  | { ok: false; error: "EMISION_BLOQUEADA" | "LOCK_ERROR"; detalle?: string };

export async function acquireCuentaEmissionLock(args: {
  sb: Sb;
  cuentaId: string;
  empresaId: string;
  userId: string;
  provider: Provider;
  origin?: string;
  expectedEmisorRut?: string | null;
  ttlSeconds?: number;
  // Motor masivo: cada job del lote apunta a la propuesta que emite, para que el
  // folio real quede enlazado a ella (la boleta única no lo trae → null).
  propuestaId?: string | null;
}): Promise<CuentaEmissionLock> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + (args.ttlSeconds ?? 300) * 1000).toISOString();
  const jobId = `server:${args.provider}:${randomUUID()}`;

  await args.sb
    .from("emision_locks")
    .delete()
    .eq("cuenta_id", args.cuentaId)
    .lt("locked_until", now.toISOString());

  const { error: jobError } = await args.sb.from("emision_jobs").insert({
    job_id: jobId,
    cuenta_id: args.cuentaId,
    empresa_id: args.empresaId,
    usuario_id: args.userId,
    provider: args.provider,
    origin: args.origin ?? "server_lock",
    expected_emisor_rut: args.expectedEmisorRut ?? null,
    propuesta_id: args.propuestaId ?? null,
    estado: "running",
    estado_visible: "running",
    expires_at: lockedUntil,
    locked_until: lockedUntil,
    heartbeat_at: now.toISOString(),
  });
  if (jobError) return { ok: false, error: "LOCK_ERROR", detalle: jobError.message };

  const { error: lockError } = await args.sb.from("emision_locks").insert({
    cuenta_id: args.cuentaId,
    job_id: jobId,
    usuario_id: args.userId,
    provider: args.provider,
    estado_visible: "running",
    locked_until: lockedUntil,
    heartbeat_at: now.toISOString(),
  });

  if (lockError) {
    await args.sb.from("emision_jobs").update({ estado: "cancelled", updated_at: new Date().toISOString() }).eq("job_id", jobId);
    if (lockError.code === "23505") return { ok: false, error: "EMISION_BLOQUEADA" };
    return { ok: false, error: "LOCK_ERROR", detalle: lockError.message };
  }

  return { ok: true, jobId, lockedUntil };
}

/**
 * Latido con LEASE (seguridad de emisión 2026-09-30, adversarial H5). Antes el PATCH
 * renovaba el job aunque el candado de la cuenta ya fuera de OTRO job (o hubiera
 * vencido y otro lo tomara): el UPDATE del lock calzaba 0 filas, no daba error y
 * respondía ok → el zombi seguía emitiendo con el candado ajeno.
 *
 * Ahora UN solo UPDATE condicional sobre el candado (atómico en la fila): solo renueva
 * si el candado de la cuenta es de ESTE job y sigue vivo. 0 filas = lease perdido.
 * Lo que guarda un folio REAL (/result) no pasa por acá: un resultado tardío se
 * registra siempre.
 */
export async function renovarLeaseCuenta(args: {
  sb: Sb;
  cuentaId: string;
  jobId: string;
  nuevaExpiracion: string;
  estadoVisible: string;
}): Promise<{ ok: true } | { ok: false; error: "LEASE_PERDIDO" } | { ok: false; error: "LOCK_UPDATE_FAILED"; detalle: string }> {
  const ahora = new Date().toISOString();
  const { data, error } = await args.sb
    .from("emision_locks")
    .update({ estado_visible: args.estadoVisible, heartbeat_at: ahora, locked_until: args.nuevaExpiracion })
    .eq("cuenta_id", args.cuentaId)
    .eq("job_id", args.jobId)
    .gt("locked_until", ahora)
    .select("job_id");
  if (error) return { ok: false, error: "LOCK_UPDATE_FAILED", detalle: error.message };
  if (!data || data.length === 0) return { ok: false, error: "LEASE_PERDIDO" };
  return { ok: true };
}

export async function releaseCuentaEmissionLock(args: {
  sb: Sb;
  cuentaId: string;
  jobId: string;
  // 'revision_pendiente' = lápida de boleta "a medias": suelta el candado de
  // cuenta igual, pero sella el job con un estado que BLOQUEA re-emitir esa
  // propuesta hasta recuperar/registrar el folio (ver migración revision_pendiente).
  estado?: "completed" | "failed" | "cancelled" | "expired" | "revision_pendiente";
}) {
  const estado = args.estado ?? "completed";

  // El candado de cuenta se libera casi siempre (un release tardío no debe dejar la
  // cuenta trabada). EXCEPCIÓN: la lápida 'revision_pendiente' de una boleta ÚNICA
  // (sin propuesta_id). En la boleta única los guards server-side por propuesta_id
  // (POST /api/emision/jobs) NO aplican → el candado de cuenta es la ÚNICA reja que
  // le queda contra la re-emisión (doble folio). Se MANTIENE hasta el TTL: un
  // re-POST choca con EMISION_BLOQUEADA y el usuario ve el panel de emisión sin
  // resolver (→ Recuperar) en vez de re-emitir. El LOTE (con propuesta_id) SÍ lo
  // libera: su reja es el guard por propuesta_id.
  let mantenerCandado = false;
  if (estado === "revision_pendiente") {
    const { data: jobRow } = await args.sb
      .from("emision_jobs")
      .select("propuesta_id")
      .eq("job_id", args.jobId)
      .maybeSingle();
    mantenerCandado = !jobRow?.propuesta_id;
  }
  if (!mantenerCandado) {
    await args.sb.from("emision_locks").delete().eq("cuenta_id", args.cuentaId).eq("job_id", args.jobId);
  }

  // Transición de estado GUARDADA: el estado del job solo avanza hacia MÁS
  // protección, nunca hacia menos. Orden de protección:
  //   completed / revision_pendiente  → PROTEGEN (bloquean re-emitir la propuesta)
  //   failed / cancelled / expired     → PERMISIVOS (permiten re-emitir)
  // Esto arregla dos cosas de raíz:
  //  (a) la lápida 'revision_pendiente' PUEDE sobrescribir un sello 'failed'
  //      espurio (carrera CAPTURE_DEBUG: el job quedó 'failed' pero el folio pudo
  //      emitirse) → sin esto la propuesta re-aparecía 'lista' y se re-emitía,
  //      quemando el folio.
  //  (b) un release TARDÍO no puede degradar un 'completed' ni una lápida ya
  //      puesta (antes el update era incondicional).
  const ALLOWED_FROM: Record<NonNullable<typeof args.estado>, string[]> = {
    completed: ["created", "running", "failed", "cancelled", "expired", "revision_pendiente"],
    revision_pendiente: ["created", "running", "failed", "cancelled", "expired"],
    failed: ["created", "running"],
    cancelled: ["created", "running"],
    expired: ["created", "running"],
  };
  const { data: updated } = await args.sb
    .from("emision_jobs")
    .update({
      estado,
      estado_visible: estado,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", args.jobId)
    .in("estado", ALLOWED_FROM[estado])
    .select("estado")
    .maybeSingle();

  // La reserva de folio (SimpleAPI) se finaliza SOLO si la transición se aplicó:
  // un release tardío ignorado no debe soltar/consumir una reserva ya finalizada.
  if (updated) {
    await finalizeFolioReservaForJob({ sb: args.sb, jobId: args.jobId, estado });
  }
}
