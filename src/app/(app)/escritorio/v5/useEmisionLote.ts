"use client";

// Hook del motor masivo: conecta el núcleo puro (ejecutarLote) con la extensión
// REAL. Reusa TODO el pipeline per-job probado (lock server-side, candado
// anti-doble, stash, dedup) — acá solo se orquesta la secuencia y se traducen los
// mensajes de la extensión a desenlaces (emitida | fallida | revisar).
//
// La autorización legal (una vez, versionada) la maneja el MODAL antes de llamar
// a `iniciar`; el server igual la re-exige en /api/emision/jobs (defensa en capas).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ejecutarLote,
  type ItemLote,
  type ProgresoLote,
  type DesenlaceItem,
  type MotivoPausa,
} from "@/lib/emission/lote-runner";
import { buildBoletaJob } from "@/lib/emission/boleta-job-payload";

/** Ítem del lote con los datos para armar el payload (superset de ItemLote). */
export interface ItemLoteEmision extends ItemLote {
  receptorRut?: string | null;
  receptorNombre?: string | null;
  receptorDireccion?: string | null;
  receptorComuna?: string | null;
  receptorEmail?: string | null;
  receptorTelefono?: string | null;
  medioPago?: string | null;
  /** Glosa segura (nunca datos de terceros — el caller lo garantiza). */
  detalle: string;
  fechaEmision: string; // "YYYY-MM-DD" en zona Chile
}

type ExtMsg = {
  source?: string;
  type?: string;
  job_id?: string | null;
  status?: string;
  message?: string;
  result?: {
    folio?: number | string;
    folio_confidence?: string;
    persisted?: { ok?: boolean; boleta_id?: string; error?: string; detalle?: string };
  };
};

interface Waiter {
  jobId: string;
  reportar: (s: string) => void;
  resolve: (d: DesenlaceItem) => void;
  done: boolean;
}

const origin = () => window.location.origin;

export function useEmisionLote(args: { empresaId: string; empresaRut?: string | null }) {
  const { empresaId, empresaRut } = args;
  const [progreso, setProgreso] = useState<ProgresoLote | null>(null);
  const [pausa, setPausa] = useState<{ motivo: MotivoPausa; progreso: ProgresoLote } | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  // job_id de la boleta que quedó "a medias": el modal lo usa para recover_latest dirigido.
  const [jobIdRevision, setJobIdRevision] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pausaResolverRef = useRef<((d: "continuar" | "detener") => void) | null>(null);
  const waiterRef = useRef<Waiter | null>(null);
  const corriendoRef = useRef(false);

  // Un único listener: enruta los mensajes de la extensión SOLO al job en curso.
  useEffect(() => {
    function onMsg(event: MessageEvent) {
      if (event.origin !== origin()) return;
      const data = event.data as ExtMsg;
      if (data?.source !== "app-contable-extension") return;
      const w = waiterRef.current;
      if (!w || w.done) return;
      if ((data.job_id ?? null) !== w.jobId) return; // ignora jobs ajenos / viejos

      if (data.type === "APP_CONTABLE_SII_JOB_RESULT") {
        const persisted = data.result?.persisted;
        const folioNum = Number(data.result?.folio);
        const folio = Number.isFinite(folioNum) ? folioNum : null;
        // Emitida = folio con evidencia fuerte Y guardado confirmado en la app.
        const emitida = data.result?.folio_confidence === "high" && persisted?.ok === true && folio != null;
        if (emitida) {
          w.resolve({ estado: "emitida", folio: folio as number, boletaId: persisted?.boleta_id ?? null });
        } else {
          // Folio real sin guardar (o sin evidencia): "a medias" → frena el lote.
          w.resolve({ estado: "revisar", motivo: persisted?.detalle ?? persisted?.error ?? "Emitiste, pero no se confirmó el guardado en la app.", folio });
        }
        return;
      }

      if (data.type === "APP_CONTABLE_SII_JOB_STATUS") {
        const st = data.status ?? "";
        // La extensión NUNCA manda error/cancelado/closed post-emit → son PRE-emit
        // seguros (sin folio): fallida, se puede saltar y seguir.
        if (st === "error" || st === "cancelled" || st === "closed") {
          w.resolve({ estado: "fallida", motivo: data.message ?? "No se pudo emitir esta boleta." });
          return;
        }
        // Post-emit incierto: hay un folio posible con la ventana abierta → frena.
        if (st === "result_needs_review") {
          w.resolve({ estado: "revisar", motivo: data.message ?? "Emitiste, pero no pude confirmar el folio." });
          return;
        }
        // Subestado no terminal (login, calculando, capturando…): reportar y seguir esperando.
        w.reportar(data.message ?? st);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Aviso al cerrar la pestaña MIENTRAS emite: el motor corre en el navegador, así
  // que un cierre duro corta el lote a medias. El navegador muestra su diálogo
  // nativo ("¿seguro que quieres salir?"). Si igual cierra, el progreso quedó
  // persistido (ver EmitirLoteModal) y se ofrece reanudar al reabrir.
  useEffect(() => {
    if (!corriendo) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // requerido por algunos navegadores para gatillar el diálogo
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [corriendo]);

  const startJob = useCallback(async (propuestaId: string, tipoDte: number): Promise<{ jobId: string; expiresAt: string; emisorRut: string | null } | null> => {
    try {
      const res = await fetch("/api/emision/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "sii_local",
          tipo_dte: tipoDte,
          origin: "emision_lote",
          expected_emisor_rut: empresaRut ?? null,
          propuesta_id: propuestaId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok || !json.job_id || !json.expires_at) return null;
      // El server resuelve el emisor_rut autoritativo (empresa.rut de la DB) y lo
      // devuelve en expected_emisor_rut. Lo usamos como fuente de verdad para el
      // payload de la extensión, igual que la boleta única (EmitirDirectaView):
      // sin esto el job viaja sin emisor_rut y la extensión lo rechaza fail-closed
      // (EMISOR_RUT_INVALID) en TODAS las boletas del lote.
      return {
        jobId: json.job_id as string,
        expiresAt: json.expires_at as string,
        emisorRut: (json.expected_emisor_rut ?? null) as string | null,
      };
    } catch {
      return null;
    }
  }, [empresaRut]);

  const closeJob = useCallback(async (jobId: string, estado: "failed" | "cancelled" | "revision_pendiente", motivo?: string) => {
    try {
      await fetch("/api/emision/jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        // CAJA NEGRA: el motivo del desenlace (último status del RPA / razón del fallo)
        // viaja al server → status_message + ops_event, para diagnosticar sin consola.
        body: JSON.stringify({ job_id: jobId, estado, status_message: motivo ? motivo.slice(0, 500) : null }),
      });
    } catch {
      // Best-effort: el lock igual expira por TTL server-side.
    }
  }, []);

  const iniciar = useCallback(async (items: ItemLoteEmision[]) => {
    if (corriendoRef.current || items.length === 0) return;
    corriendoRef.current = true;
    setCorriendo(true);
    setPausa(null);
    setJobIdRevision(null);
    const ac = new AbortController();
    abortRef.current = ac;

    const driver = {
      rand: Math.random,
      esperar(ms: number) {
        return new Promise<void>((resolve) => {
          if (ac.signal.aborted) return resolve();
          const t = setTimeout(resolve, ms);
          ac.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      },
      async emitirUna(item: ItemLote, reportar: (s: string) => void): Promise<DesenlaceItem> {
        const full = item as ItemLoteEmision;
        reportar("Preparando…");
        // 1. lock + autorización (server) + enlace propuesta_id
        const job = await startJob(full.propuestaId, full.tipoDte);
        if (!job) return { estado: "fallida", motivo: "No se pudo iniciar (autorización, otra emisión en curso, o permiso)." };

        // 2. MISMO payload que boleta única (fuente única) — desde la propuesta.
        const boleta = buildBoletaJob({
          empresaId,
          emisorRut: job.emisorRut ?? empresaRut ?? undefined,
          tipoDte: full.tipoDte,
          monto: full.monto,
          fechaEmision: full.fechaEmision,
          receptor: {
            rut: full.receptorRut,
            razonSocial: full.receptorNombre,
            direccion: full.receptorDireccion,
            comuna: full.receptorComuna,
            email: full.receptorEmail,
            telefono: full.receptorTelefono,
          },
          detalle: full.detalle,
          medioPago: full.medioPago,
          logoutAfter: false, // lote: deja la sesión SII abierta para encadenar
          jobId: job.jobId,
          expiresAt: job.expiresAt,
        });

        // 3. enviar a la extensión y esperar el desenlace TERMINAL de este job
        const desenlace = await new Promise<DesenlaceItem>((resolve) => {
          let settled = false;
          const finish = (d: DesenlaceItem) => {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            const w = waiterRef.current;
            if (w && w.jobId === job.jobId) w.done = true;
            resolve(d);
          };
          waiterRef.current = { jobId: job.jobId, reportar, done: false, resolve: finish };
          // Timeout de seguridad: si nada terminal llega antes de expirar el job,
          // marcar "revisar" (conservador: pudo emitirse) para que el humano verifique.
          const to = setTimeout(
            () => finish({ estado: "revisar", motivo: "La emisión no confirmó a tiempo. Revísala en la ventana SII antes de seguir." }),
            Math.max(30_000, Date.parse(job.expiresAt) - Date.now() + 5_000),
          );
          window.postMessage(
            { source: "app-contable", type: "APP_CONTABLE_SII_BOLETA_JOB", protocol_version: 1, job: boleta },
            origin(),
          );
        });
        waiterRef.current = null;

        // 4. cerrar la ventana del job (post-persist la extensión ya la libera; pre-emit, cierre normal)
        window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_CLOSE", protocol_version: 1, job_id: job.jobId }, origin());

        // 5. sellar el job según el desenlace:
        //  - emitida  → el server ya soltó el lock en /result (no tocar).
        //  - revisar  → LÁPIDA 'revision_pendiente': posible folio real → bloquea re-emitir
        //               hasta recuperarlo. Guardar el jobId para el recover_latest del modal.
        //  - fallida  → 'failed' (pre-emit seguro, sin folio; se puede saltar).
        if (desenlace.estado === "revisar") setJobIdRevision(job.jobId);
        if (desenlace.estado !== "emitida") {
          const motivo = "motivo" in desenlace ? desenlace.motivo : undefined;
          await closeJob(job.jobId, desenlace.estado === "revisar" ? "revision_pendiente" : "failed", motivo);
        }
        return desenlace;
      },
    };

    const alPausar = (motivo: MotivoPausa, prog: ProgresoLote) =>
      new Promise<"continuar" | "detener">((resolve) => {
        pausaResolverRef.current = resolve;
        setPausa({ motivo, progreso: prog });
      });

    try {
      await ejecutarLote(items, driver, { onProgreso: setProgreso, alPausar, señalDetener: ac.signal });
    } finally {
      corriendoRef.current = false;
      setCorriendo(false);
      abortRef.current = null;
      waiterRef.current = null;
    }
  }, [empresaId, empresaRut, startJob, closeJob]);

  const detener = useCallback(() => {
    abortRef.current?.abort();
    // Si estaba pausado esperando decisión, resolver como detener (el abort solo
    // corta la espera del jitter, no la promesa de la pausa).
    const r = pausaResolverRef.current;
    pausaResolverRef.current = null;
    setPausa(null);
    r?.("detener");
  }, []);

  const responderPausa = useCallback((d: "continuar" | "detener") => {
    setPausa(null);
    const r = pausaResolverRef.current;
    pausaResolverRef.current = null;
    r?.(d);
  }, []);

  return { progreso, pausa, corriendo, jobIdRevision, iniciar, detener, responderPausa };
}
