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
import { fechaParaEmitir } from "@/lib/emission/fecha-intento";
import { verificarJobColgado } from "./verificar-colgado";
import { clasificarStartJob } from "@/lib/emission/clasificar-start-job";
import { buildFacturaJob } from "@/lib/emission/factura-job-payload";

/** Ítem del lote con los datos para armar el payload (superset de ItemLote). */
export interface ItemLoteEmision extends ItemLote {
  receptorRut?: string | null;
  receptorNombre?: string | null;
  receptorDireccion?: string | null;
  receptorComuna?: string | null;
  receptorEmail?: string | null;
  receptorTelefono?: string | null;
  medioPago?: string | null;
  // ——— Solo facturas (33/34) ———
  receptorGiro?: string | null;
  receptorCiudad?: string | null;
  /** Obligatoria en facturas (espec Matías: sin default, el usuario la elige). */
  formaPago?: "contado" | "credito" | null;
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
  /** Falla pre-emit con el canal muerto tras mandar la emisión (pudo emitir). */
  emision_incierta?: boolean;
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
        // Con sesión insegura el server solo lo guardó en su respaldo (sin boleta en los
        // libros): no es "emitida" — queda a medias hasta completar la verificación.
        const soloRespaldo = Boolean((persisted as { pendiente_verificacion_sesion?: unknown } | undefined)?.pendiente_verificacion_sesion);
        const emitida = data.result?.folio_confidence === "high" && persisted?.ok === true && folio != null && !soloRespaldo;
        if (emitida) {
          w.resolve({ estado: "emitida", folio: folio as number, boletaId: persisted?.boleta_id ?? null });
        } else {
          // Folio real sin guardar (o sin evidencia): "a medias" → frena el lote.
          w.resolve({ estado: "revisar", motivo: soloRespaldo ? "El folio quedó respaldado, pero falta verificar tu sesión: entra de nuevo a la app y usa Recuperar folio." : persisted?.detalle ?? persisted?.error ?? "Emitiste, pero no se confirmó el guardado en la app.", folio });
        }
        return;
      }

      if (data.type === "APP_CONTABLE_SII_JOB_STATUS") {
        const st = data.status ?? "";
        // La extensión NUNCA manda error/cancelado/closed post-emit → son PRE-emit
        // seguros (sin folio): fallida, se puede saltar y seguir.
        // La extensión se actualizó bajo los pies (auto-update de la store o
        // recarga en dev): el puente murió pero el TRABAJO PUEDE SEGUIR — pasó
        // en vivo 2026-08-27 y salió el folio 966 mientras la app lo daba por
        // fallido. Es incierto, no fallo: frena el lote y manda a verificar.
        if (st === "extension_recargada") {
          w.resolve({ estado: "revisar", motivo: data.message ?? "La extensión se actualizó durante la emisión. Recarga la pestaña y verifica el folio antes de reintentar." });
          return;
        }
        if (st === "error" || st === "cancelled" || st === "closed") {
          // (Los jobs de VERIFICACIÓN los escucha verificar-colgado.ts, no este waiter.)
          w.resolve({ estado: "fallida", motivo: data.message ?? "No se pudo emitir esta boleta.", emisionIncierta: data.emision_incierta === true });
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

  // Avisa a la mesa que hay un lote PROPIO corriendo: espacia sus recargas y al
  // terminar hace una recarga final (cubre todos los cierres: terminada, detenida,
  // a medias, pausa remota, cerrar el modal). plan-costo-vercel §5 d.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("massdte:lote", { detail: { origen: "propio", activo: corriendo } }));
  }, [corriendo]);
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent("massdte:lote", { detail: { origen: "propio", activo: false } }));
  }, []);

  // KILL SWITCH (tanda 1, 2026-09-10): el server puede contestar 409
  // EMISION_PAUSADA con un `detalle` humano. Se distingue del resto de fallos
  // porque NO es "esta boleta falló": es "no abras ninguna". El lote se detiene
  // en seco conservando lo pendiente (ver pausada_remota en lote-runner).
  type StartJob =
    | { jobId: string; expiresAt: string; emisorRut: string | null; foliosHoy: number[] }
    | { pausada: true; detalle: string }
    | { yaEmitida: true; folio: number | null; boletaId: string | null; boletaCreatedAt: string | null }
    | { frenada: true; motivo: string }
    | { yaAMedias: true }
    | null;
  const startJob = useCallback(async (propuestaId: string, tipoDte: number): Promise<StartJob> => {
    try {
      let res: Response | null = null;
      let json: Record<string, unknown> = {};
      // Hasta 3 intentos si el server dice 429 (racha de saltadas sin cadencia).
      for (let intento = 0; intento < 3; intento++) {
        res = await fetch("/api/emision/jobs", {
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
        json = await res.json().catch(() => ({}));
        const pre = clasificarStartJob(res.status, json);
        if (pre.tipo !== "reintentar") break;
        await new Promise((r) => setTimeout(r, pre.esperaMs));
      }
      if (!res) return null;
      // Clasificación pura (clasificar-start-job.ts): pausa del server, ya emitida,
      // candado / en curso (frena UNA vez), ya a medias (se salta), ok, o error.
      // El server resuelve el emisor_rut autoritativo (empresa.rut de la DB) y lo
      // devuelve en expected_emisor_rut: es la fuente de verdad del payload (sin él
      // la extensión rechaza fail-closed EMISOR_RUT_INVALID en TODO el lote).
      const c = clasificarStartJob(res.status, json);
      switch (c.tipo) {
        case "ok": return { jobId: c.jobId, expiresAt: c.expiresAt, emisorRut: c.emisorRut, foliosHoy: c.foliosHoy };
        case "pausada": return { pausada: true, detalle: c.detalle };
        case "ya_emitida": return { yaEmitida: true, folio: c.folio, boletaId: c.boletaId, boletaCreatedAt: c.boletaCreatedAt };
        case "frenada": return { frenada: true, motivo: c.motivo };
        case "a_medias": return { yaAMedias: true };
        case "reintentar": return { frenada: true, motivo: "Vamos más rápido de lo que el servidor permite. Lo que falta queda guardado: reanuda en un minuto." };
        default: return null;
      }
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
        // Fecha de ESTA boleta = la del momento de emitirla (no la del modal): un lote
        // que cruza las 00:00 no debe verificar con la fecha de ayer (doble folio).
        const fechaIntento = fechaParaEmitir(new Date());
        const job = await startJob(full.propuestaId, full.tipoDte);
        if (!job) return { estado: "fallida", motivo: "No se pudo iniciar (autorización, otra emisión en curso, o permiso)." };
        // Server en pausa: sin job, sin ventana, sin folio. El runner conserva este
        // ítem como pendiente y detiene el lote; el modal muestra el detalle.
        if ("pausada" in job) return { estado: "pausada_remota", motivo: job.detalle };
        if ("yaEmitida" in job) return { estado: "ya_emitida", motivo: "Ya estaba emitida (otra persona o pestaña la emitió)." };
        if ("frenada" in job) return { estado: "frenada", motivo: job.motivo };
        if ("yaAMedias" in job) return { estado: "ya_a_medias", motivo: "Ya estaba en A medias: revísala ahí antes de volver a emitirla." };

        // 2. MISMO payload que la emisión única (fuente única) — desde la propuesta.
        //    Boleta (39/41) → e-Boleta; factura (33/34) → portal gratuito, con su
        //    propio contrato (receptor completo, forma de pago, clave del cert).
        const esFactura = full.tipoDte === 33 || full.tipoDte === 34;
        // MODO ENSAYO (fase de validación del RPA de facturas): con la perilla
        // puesta, el job viaja learn_only — el worker LLENA el formulario del
        // portal, verifica el total y SE DETIENE antes de "Validar" (ni folio,
        // ni firma, ni clave del certificado). Perilla escondida, sin UI:
        //   localStorage.setItem("massdte:fact-ensayo", "1")
        let ensayo = false;
        try { ensayo = window.localStorage.getItem("massdte:fact-ensayo") === "1"; } catch { /* sin storage: modo normal */ }
        let payloadJob: object;
        let msgType: string;
        if (esFactura) {
          try {
            payloadJob = buildFacturaJob({
              empresaId,
              emisorRut: job.emisorRut ?? empresaRut ?? "",
              tipoDte: full.tipoDte as 33 | 34,
              totalClp: full.monto,
              fechaEmision: fechaIntento,
              formaPago: full.formaPago as "contado" | "credito",
              receptor: {
                rut: full.receptorRut ?? "",
                razonSocial: full.receptorNombre ?? "",
                giro: full.receptorGiro,
                direccion: full.receptorDireccion ?? "",
                comuna: full.receptorComuna ?? "",
                ciudad: full.receptorCiudad,
                email: full.receptorEmail,
              },
              detalle: full.detalle,
              logoutAfter: false, // lote: deja la sesión SII abierta para encadenar
              learnOnly: ensayo,
              jobId: job.jobId,
              expiresAt: job.expiresAt,
              foliosHoy: job.foliosHoy,
            });
          } catch (e) {
            // Fail-closed del builder (receptor incompleto, sin forma de pago…):
            // esta factura no sale; cerrar el job y saltar a la siguiente.
            await closeJob(job.jobId, "failed", e instanceof Error ? e.message : "FACTURA_PAYLOAD_INVALIDO");
            return { estado: "fallida", motivo: "Esta factura tiene datos incompletos (receptor o forma de pago). Revísala en Check." };
          }
          msgType = "APP_CONTABLE_SII_FACT_JOB";
        } else {
          payloadJob = buildBoletaJob({
            empresaId,
            emisorRut: job.emisorRut ?? empresaRut ?? undefined,
            foliosHoy: job.foliosHoy,
            tipoDte: full.tipoDte as 39 | 41,
            monto: full.monto,
            fechaEmision: fechaIntento,
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
          msgType = "APP_CONTABLE_SII_BOLETA_JOB";
          // DEBUG ensayo de boleta (perilla escondida, sin UI):
          //   localStorage.setItem("massdte:boleta-ensayo", "1")
          // El worker LLENA el formulario (incluida la glosa "Detalle") y se DETIENE
          // antes de Emitir — no quema folio. Para inspeccionar el carril de boletas.
          let boletaEnsayo = false;
          try { boletaEnsayo = window.localStorage.getItem("massdte:boleta-ensayo") === "1"; } catch { /* sin storage */ }
          if (boletaEnsayo) (payloadJob as { allow_final_emit?: boolean }).allow_final_emit = false;
        }

        // 3. enviar a la extensión y esperar el desenlace TERMINAL de este job
        const intentoDesdeMs = Date.now();
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
            { source: "app-contable", type: msgType, protocol_version: 1, job: payloadJob },
            origin(),
          );
        });
        waiterRef.current = null;

        // 4. cerrar la ventana del job (post-persist la extensión ya la libera; pre-emit, cierre normal)
        window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_CLOSE", protocol_version: 1, job_id: job.jobId }, origin());

        // 4b. CUADRE POR EVENTO (2026-09-26): la boleta falló DESPUÉS de llegar al modal.
        // Pudo apretar EMITIR y morir antes de avisar (navegación del SII, puerto
        // cerrado): habría un folio real que nadie ve. Antes de darla por no emitida se
        // verifica en el Resumen de ventas del SII (verify_only, solo lectura).
        // ADOPCIÓN (2026-09-28, revisión final I3/M3): el intento original YA NO se cierra
        // `failed` antes de tener veredicto — si la pestaña moría en ese instante, la
        // propuesta quedaba re-emitible. Ahora la verificación ADOPTA el job (sigue siendo
        // lápida mientras tanto) con "fin confirmado": la extensión nos dio su estado
        // terminal y arriba le mandamos cerrar la ventana worker. Salió → registrada; no
        // salió (validado por el server, mismo día) → `failed`; lo demás → a medias.
        if (desenlace.estado === "fallida" && desenlace.emisionIncierta && !esFactura) {
          const v = await verificarJobColgado({
            jobViejoId: job.jobId,
            propuestaId: item.propuestaId,
            tipoDte: full.tipoDte as 39 | 41,
            monto: full.monto,
            empresaId,
            empresaRut: job.emisorRut ?? empresaRut ?? null,
            finConfirmado: true,
            reportar,
          });
          if (v.estado === "emitida" && v.folio != null) return { estado: "emitida", folio: v.folio, boletaId: v.boletaId };
          // Ya registrada al pedir la verificación: el resultado de NUESTRO intento llegó
          // tarde y se guardó. Solo si esa boleta es de la ventana de este intento (60 s
          // de margen); si es anterior, es de otra persona/pestaña → lápida (I3).
          if (v.estado === "ya_emitida" && v.folio != null && v.boletaCreatedAt && Date.parse(v.boletaCreatedAt) >= intentoDesdeMs - 60_000) {
            return { estado: "emitida", folio: v.folio, boletaId: v.boletaId };
          }
          if (v.estado === "no_salio") {
            // El server ya cerró el intento y la verificación (`failed`): re-emitible.
            return { estado: "fallida", motivo: `${desenlace.motivo} Verifiqué en el SII: no salió, se puede reintentar.` };
          }
          // A medias / no se pudo verificar: el intento original queda como lápida
          // (revision_pendiente), nunca re-emitible a ciegas.
          // "Muy pronto" (el server no devuelve a Listas antes de 10 min desde el último
          // signo de vida del intento): acá el intento queda sellado a medias, así que la
          // línea no promete re-verificar; la salida es folio a mano / "No está en el SII".
          const linea = v.estado === "a_medias" && v.reintentableDesde
            ? "Todavía no aparece en el SII y es muy pronto para darla por no emitida. Quedó a medias: búscala en el SII y escribe su folio, o márcala como que no está."
            : v.linea;
          await closeJob(job.jobId, "revision_pendiente", `${desenlace.motivo} ${linea}`);
          setJobIdRevision(v.estado === "a_medias" && v.jobIdRevision ? v.jobIdRevision : job.jobId);
          return { estado: "revisar", motivo: linea, folio: null };
        }
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
