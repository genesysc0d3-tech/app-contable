import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

type Sb = SupabaseClient<Database>;
type FolioReserva = Tables<"folio_reservas">;
type ReservaEstado = "reservado" | "generado" | "usado" | "liberado" | "fallido" | "vencido";
type JobCloseEstado = "completed" | "failed" | "cancelled" | "expired";

const SIMPLEAPI_TIPOS = new Set([33, 34, 39, 41]);

export type ReserveSimpleApiFolioResult =
  | { ok: true; folio: number; tipoDte: number; reserva: FolioReserva }
  | { ok: false; error: "TIPO_DTE_INVALID" | "FOLIO_RESERVA_FAILED"; detalle?: string };

export type FolioReservaGate =
  | { ok: true; reserva: FolioReserva }
  | { ok: false; status: number; error: string; detalle?: string };

export async function reserveSimpleApiFolio(args: {
  sb: Sb;
  empresaId: string;
  tipoDte: number;
  jobId: string;
  expiresAt: string;
}): Promise<ReserveSimpleApiFolioResult> {
  if (!SIMPLEAPI_TIPOS.has(args.tipoDte)) return { ok: false, error: "TIPO_DTE_INVALID" };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextFolio = (await currentMaxFolio(args.sb, args.empresaId, args.tipoDte)) + 1;
    const { data, error } = await args.sb
      .from("folio_reservas")
      .insert({
        empresa_id: args.empresaId,
        tipo_dte: args.tipoDte,
        folio: nextFolio,
        job_id: args.jobId,
        estado: "reservado",
        expires_at: args.expiresAt,
      })
      .select("*")
      .single();

    if (!error && data) return { ok: true, folio: data.folio, tipoDte: data.tipo_dte, reserva: data };
    if (error?.code === "23505") continue;
    return { ok: false, error: "FOLIO_RESERVA_FAILED", detalle: error?.message };
  }

  return { ok: false, error: "FOLIO_RESERVA_FAILED", detalle: "No se pudo reservar un folio despues de varios intentos." };
}

export async function requireSimpleApiFolioReserva(args: {
  sb: Sb;
  empresaId: string;
  jobId: string;
  tipoDte: number | null | undefined;
  folio: number | null | undefined;
  allowedEstados: ReservaEstado[];
}): Promise<FolioReservaGate> {
  if (!args.tipoDte || !args.folio) return { ok: false, status: 409, error: "FOLIO_RESERVA_REQUIRED" };

  const { data, error } = await args.sb
    .from("folio_reservas")
    .select("*")
    .eq("job_id", args.jobId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: "FOLIO_RESERVA_QUERY_FAILED", detalle: error.message };
  if (!data) return { ok: false, status: 409, error: "FOLIO_RESERVA_NOT_FOUND" };
  if (data.empresa_id !== args.empresaId) return { ok: false, status: 409, error: "FOLIO_RESERVA_EMPRESA_MISMATCH" };
  if (data.tipo_dte !== args.tipoDte) return { ok: false, status: 409, error: "FOLIO_RESERVA_TIPO_MISMATCH" };
  if (data.folio !== args.folio) return { ok: false, status: 409, error: "FOLIO_RESERVA_FOLIO_MISMATCH" };
  if (!args.allowedEstados.includes(data.estado as ReservaEstado)) {
    return { ok: false, status: 409, error: "FOLIO_RESERVA_ESTADO_INVALIDO" };
  }
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 409, error: "FOLIO_RESERVA_EXPIRED" };
  }

  return { ok: true, reserva: data };
}

export async function requireSimpleApiFolioReservaForJob(args: {
  sb: Sb;
  empresaId: string;
  jobId: string;
  allowedEstados: ReservaEstado[];
}): Promise<FolioReservaGate> {
  const { data, error } = await args.sb
    .from("folio_reservas")
    .select("*")
    .eq("job_id", args.jobId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: "FOLIO_RESERVA_QUERY_FAILED", detalle: error.message };
  if (!data) return { ok: false, status: 409, error: "FOLIO_RESERVA_NOT_FOUND" };
  if (data.empresa_id !== args.empresaId) return { ok: false, status: 409, error: "FOLIO_RESERVA_EMPRESA_MISMATCH" };
  if (!args.allowedEstados.includes(data.estado as ReservaEstado)) {
    return { ok: false, status: 409, error: "FOLIO_RESERVA_ESTADO_INVALIDO" };
  }
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 409, error: "FOLIO_RESERVA_EXPIRED" };
  }

  return { ok: true, reserva: data };
}

export async function markSimpleApiFolioGenerated(args: {
  sb: Sb;
  jobId: string;
  tipoDte: number;
  folio: number;
}): Promise<FolioReservaGate> {
  const { data, error } = await args.sb
    .from("folio_reservas")
    .update({ estado: "generado", updated_at: new Date().toISOString() })
    .eq("job_id", args.jobId)
    .eq("tipo_dte", args.tipoDte)
    .eq("folio", args.folio)
    .eq("estado", "reservado")
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: "FOLIO_RESERVA_UPDATE_FAILED", detalle: error.message };
  if (!data) return { ok: false, status: 409, error: "FOLIO_RESERVA_ESTADO_INVALIDO" };
  return { ok: true, reserva: data };
}

export async function finalizeFolioReservaForJob(args: {
  sb: Sb;
  jobId: string;
  estado: JobCloseEstado;
}) {
  const { data } = await args.sb
    .from("folio_reservas")
    .select("id, estado")
    .eq("job_id", args.jobId)
    .maybeSingle();
  if (!data) return;

  const current = data.estado as ReservaEstado;
  let next: ReservaEstado | null = null;
  if (args.estado === "completed") next = "usado";
  if ((args.estado === "failed" || args.estado === "cancelled" || args.estado === "expired") && current === "reservado") next = "liberado";
  if ((args.estado === "failed" || args.estado === "cancelled" || args.estado === "expired") && current === "generado") next = "fallido";
  if (!next || current === next) return;

  await args.sb
    .from("folio_reservas")
    .update({ estado: next, updated_at: new Date().toISOString() })
    .eq("id", data.id);
}

async function currentMaxFolio(sb: Sb, empresaId: string, tipoDte: number) {
  const [{ data: emitted }, { data: reserved }] = await Promise.all([
    sb
      .from("boletas_emitidas")
      .select("folio")
      .eq("empresa_id", empresaId)
      .eq("tipo_dte", tipoDte)
      .order("folio", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("folio_reservas")
      .select("folio")
      .eq("empresa_id", empresaId)
      .eq("tipo_dte", tipoDte)
      .neq("estado", "liberado")
      .order("folio", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return Math.max(Number(emitted?.folio ?? 0), Number(reserved?.folio ?? 0));
}
