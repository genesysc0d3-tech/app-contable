"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

type TipoDte = 39 | 41;

interface EmitirResponse {
  ok: boolean;
  error?: string;
  detalle?: string;
  errores?: { code: string; message: string }[];
  folio?: number;
  boleta_id?: string;
  monto_total?: number;
  track_id?: string;
  estado?: string;
  proveedor?: "mock" | "libredte" | "sii_local";
  sandbox?: boolean;
}

interface BoletaDraft {
  id: string;
  slot: 1 | 2 | 3;
  colorIndex: 0 | 1 | 2;
  tipoDte: TipoDte;
  receptorRut: string;
  receptorRazonSocial: string;
  receptorDireccion: string;
  receptorComuna: string;
  detalleNombre: string;
  monto: string;
  updatedAt: number;
}

interface DraftStorageState {
  drafts: BoletaDraft[];
  nextDraftSeq: number;
}

interface DuplicateCandidate {
  id: string;
  folio: number | null;
  tipo_dte: number;
  fecha_emision: string;
  receptor_rut: string | null;
  receptor_razon_social: string | null;
  monto_total: number;
  estado: string;
  detalle: string;
  motivos: string[];
}

type ExtensionInstallStatus = "checking" | "ready" | "missing";

interface ExtensionPageMessage {
  source?: string;
  type?: string;
  protocol_version?: number;
  extension_version?: string;
  capabilities?: string[];
  nonce?: string;
  job_id?: string | null;
  status?: string;
  message?: string;
  recoverable?: boolean;
  result?: {
    folio?: number | null;
    folio_confidence?: "none" | "medium" | "high";
    folio_evidence?: { source?: string; matched_text?: string } | null;
    tipo_dte?: number | null;
    fecha_emision?: string | null;
    estado?: string;
    monto_total?: number | null;
    artifact_links?: { kind: string; href: string; text?: string }[];
    persisted?: { ok?: boolean; boleta_id?: string; already_exists?: boolean; error?: string; detalle?: string };
  };
}

interface LocalWorkerState {
  jobId: string | null;
  status: string;
  message: string;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function parseAmount(value: string): number {
  return Number(value.replace(/[^0-9]/g, ""));
}

function makeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function chileTodayString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function pingLocalSiiExtension(onResult: (message: ExtensionPageMessage | null) => void): () => void {
  const nonce = makeClientId();
  let settled = false;

  function cleanup() {
    settled = true;
    window.removeEventListener("message", onMessage);
    window.clearTimeout(timeoutId);
  }

  const timeoutId = window.setTimeout(() => {
    if (settled) return;
    cleanup();
    onResult(null);
  }, 900);

  function onMessage(event: MessageEvent<ExtensionPageMessage>) {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (data?.source !== "app-contable-extension") return;
    if (data.type !== "APP_CONTABLE_EXTENSION_PONG") return;
    if (data.nonce !== nonce) return;
    cleanup();
    onResult(data);
  }

  window.addEventListener("message", onMessage);
  window.postMessage({
    source: "app-contable",
    type: "APP_CONTABLE_EXTENSION_PING",
    protocol_version: 1,
    nonce,
  }, window.location.origin);

  return cleanup;
}

const DRAFT_COLORS = [
  { fg: "#E8553E", bg: "rgba(232,85,62,.12)", border: "rgba(232,85,62,.46)", dot: "#E8553E" },
  { fg: "#f59e0b", bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.44)", dot: "#f59e0b" },
  { fg: "#b4f027", bg: "rgba(180,240,39,.10)", border: "rgba(180,240,39,.38)", dot: "#b4f027" },
] as const;

function normalizeSeq(seq: number) {
  return seq > 9 ? 1 : seq < 1 ? 1 : seq;
}

function nextSeq(seq: number) {
  return seq >= 9 ? 1 : seq + 1;
}

function newDraft(tipoDte: TipoDte, seq = 1): BoletaDraft {
  const normalized = normalizeSeq(seq);
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    slot: (((normalized - 1) % 3) + 1) as 1 | 2 | 3,
    colorIndex: (Math.floor((normalized - 1) / 3) % 3) as 0 | 1 | 2,
    tipoDte,
    receptorRut: "",
    receptorRazonSocial: "",
    receptorDireccion: "",
    receptorComuna: "",
    detalleNombre: "Servicio prestado",
    monto: "",
    updatedAt: Date.now(),
  };
}

function newDraftForOpenSlot(tipoDte: TipoDte, current: BoletaDraft[], seq: number): BoletaDraft {
  const used = new Set(current.map((draft) => draft.slot));
  const slot = ([1, 2, 3] as const).find((candidate) => !used.has(candidate)) ?? 1;
  const normalized = normalizeSeq(seq);
  return {
    ...newDraft(tipoDte, normalized),
    slot,
  };
}

function draftHasContent(draft: BoletaDraft) {
  return Boolean(
    draft.receptorRut.trim() ||
    draft.receptorRazonSocial.trim() ||
    draft.receptorDireccion.trim() ||
    draft.receptorComuna.trim() ||
    draft.monto.trim() ||
    draft.detalleNombre.trim() !== "Servicio prestado"
  );
}

type EmisionProveedorUi = "mock" | "libredte" | "sii_local";

export default function EmitirDirectaView({ empresaTipo, empresaId, emisionProveedor = "mock", onClose }: { empresaTipo?: string; empresaId?: string; emisionProveedor?: EmisionProveedorUi; onClose?: (saved?: boolean) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const tipoInicial: TipoDte = empresaTipo === "exento" ? 41 : 39;
  const storageKey = `v5-emision-directa-drafts:${empresaId ?? "default"}`;
  const [drafts, setDrafts] = useState<BoletaDraft[]>(() => [newDraft(tipoInicial)]);
  const [nextDraftSeq, setNextDraftSeq] = useState(2);
  const [activeDraftId, setActiveDraftId] = useState<string>(() => drafts[0]?.id ?? "");
  const [emitiendo, setEmitiendo] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<EmitirResponse | null>(null);
  const [tipoDesbloqueado, setTipoDesbloqueado] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionInstallStatus>("checking");
  const [localWorker, setLocalWorker] = useState<LocalWorkerState | null>(null);
  const [localWorkerLoading, setLocalWorkerLoading] = useState(false);
  const [manualSiiFolio, setManualSiiFolio] = useState("");

  const activeDraft = drafts.find((draft) => draft.id === activeDraftId) ?? drafts[0] ?? newDraft(tipoInicial);
  const tipoDte = activeDraft.tipoDte;
  const receptorRut = activeDraft.receptorRut;
  const receptorRazonSocial = activeDraft.receptorRazonSocial;
  const receptorDireccion = activeDraft.receptorDireccion;
  const receptorComuna = activeDraft.receptorComuna;
  const detalleNombre = activeDraft.detalleNombre;
  const monto = activeDraft.monto;

  const total = useMemo(() => parseAmount(monto), [monto]);
  const isAfecto = empresaTipo === "afecto";
  const isExento = empresaTipo === "exento";
  const hasEmpresaLock = isAfecto || isExento;
  const tipoLocked = hasEmpresaLock && !tipoDesbloqueado;
  const tipoEmpresa: TipoDte | null = isExento ? 41 : isAfecto ? 39 : null;
  const tipoDiferenteEmpresa = !!tipoEmpresa && tipoDte !== tipoEmpresa;
  const usesSiiLocal = emisionProveedor === "sii_local";
  const canSubmit = total > 0 && detalleNombre.trim().length > 0 && !emitiendo;
  const canOpenLocalWorker = canSubmit && !localWorkerLoading;
  const primaryDisabled = usesSiiLocal ? !canOpenLocalWorker : !canSubmit;
  const primaryLabel = usesSiiLocal
    ? localWorkerLoading ? "Abriendo..." : "Emitir en SII"
    : emitiendo ? "Emitiendo..." : emisionProveedor === "libredte" ? "Enviar a LibreDTE" : "Emitir DTE";

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as BoletaDraft[] | DraftStorageState;
        const savedDrafts = Array.isArray(parsed) ? parsed : parsed.drafts;
        const validDrafts = (savedDrafts ?? []).filter((draft) => draft?.id).slice(0, 3).map((draft, index) => ({
          ...draft,
          slot: draft.slot ?? (((index % 3) + 1) as 1 | 2 | 3),
          colorIndex: draft.colorIndex ?? 0,
        }));
        if (validDrafts.length > 0) {
          setDrafts(validDrafts);
          setActiveDraftId(validDrafts[0].id);
          if (!Array.isArray(parsed) && typeof parsed.nextDraftSeq === "number") {
            setNextDraftSeq(normalizeSeq(parsed.nextDraftSeq));
          } else {
            const highest = validDrafts.reduce((max, draft) => Math.max(max, draft.colorIndex * 3 + draft.slot), 0);
            setNextDraftSeq(nextSeq(highest || 1));
          }
        }
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ drafts: drafts.slice(0, 3), nextDraftSeq }));
  }, [drafts, hydrated, nextDraftSeq, storageKey]);

  useEffect(() => {
    if (total <= 0) {
      setDuplicateCandidates([]);
      setDuplicateLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setDuplicateLoading(true);
      try {
        const params = new URLSearchParams({
          tipo_dte: String(tipoDte),
          monto_total: String(total),
          receptor_rut: receptorRut.trim(),
          receptor_razon_social: receptorRazonSocial.trim(),
          detalle: detalleNombre.trim(),
        });
        const res = await fetch(`/api/intermediaria/boleta-duplicados?${params.toString()}`);
        const json = (await res.json()) as { ok: boolean; candidatos?: DuplicateCandidate[] };
        setDuplicateCandidates(res.ok && json.ok ? (json.candidatos ?? []) : []);
      } catch {
        setDuplicateCandidates([]);
      } finally {
        setDuplicateLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [tipoDte, total, receptorRut, receptorRazonSocial, detalleNombre]);

  useEffect(() => {
    return pingLocalSiiExtension((message) => {
      if (!message) {
        setExtensionStatus("missing");
        return;
      }
      setExtensionStatus("ready");
    });
  }, []);

  useEffect(() => {
    function onExtensionMessage(event: MessageEvent<ExtensionPageMessage>) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== "app-contable-extension") return;

      if (data.type === "APP_CONTABLE_SII_JOB_RESULT") {
        const folio = data.result?.folio ? ` Folio #${data.result.folio}.` : "";
        const persisted = data.result?.persisted;
        const emitted = Boolean(data.result?.folio && data.result.folio_confidence === "high" && persisted?.ok === true);
        const persistenceError = persisted?.ok === false ? ` No se guardo en la app: ${persisted.detalle ?? persisted.error ?? "error desconocido"}.` : "";
        setLocalWorker({
          jobId: data.job_id ?? null,
          status: emitted ? "emitted" : "result_needs_review",
          message: emitted
            ? `${data.message ?? "Boleta emitida y guardada en la app."}${folio}`
            : `${data.message ?? "Resultado SII recibido, pero falta guardar respaldo. No se marca como emitida."}${folio}${persistenceError}`,
        });
        setLocalWorkerLoading(false);
        toast(emitted ? `Boleta emitida y guardada.${folio}` : "Boleta SII no quedo guardada en la app", emitted ? "success" : "error");
        router.refresh();
        return;
      }

      if (data.type !== "APP_CONTABLE_SII_JOB_STATUS") return;

      setLocalWorker({
        jobId: data.job_id ?? null,
        status: data.status ?? "error",
        message: data.message ?? "Estado recibido desde motor local SII",
      });
      setLocalWorkerLoading(false);
    }

    window.addEventListener("message", onExtensionMessage);
    return () => window.removeEventListener("message", onExtensionMessage);
  }, [router, toast]);

  function updateActiveDraft(patch: Partial<BoletaDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === activeDraft.id ? { ...draft, ...patch, updatedAt: Date.now() } : draft));
  }

  function setTipo(tipo: TipoDte) {
    if (tipoLocked) return;
    updateActiveDraft({ tipoDte: tipo });
  }

  function addDraft() {
    if (drafts.length >= 3) {
      toast("Máximo 3 boletas pendientes a la vez", "error");
      return;
    }
    setDrafts((current) => {
      const draft = newDraftForOpenSlot(tipoInicial, current, nextDraftSeq);
      setActiveDraftId(draft.id);
      return [...current, draft];
    });
    setNextDraftSeq((seq) => nextSeq(seq));
    setErrors([]);
    setLastResult(null);
  }

  function closeDraft(id: string) {
    setDrafts((current) => {
      if (current.length <= 1) {
        const draft = newDraftForOpenSlot(tipoInicial, [], nextDraftSeq);
        setNextDraftSeq((seq) => nextSeq(seq));
        setActiveDraftId(draft.id);
        return [draft];
      }
      const next = current.filter((draft) => draft.id !== id);
      if (activeDraftId === id) setActiveDraftId(next[0]?.id ?? "");
      return next;
    });
  }

  function handleClose() {
    const nonEmptyDrafts = drafts.filter(draftHasContent).slice(0, 3);
    if (nonEmptyDrafts.length > 0) {
      window.localStorage.setItem(storageKey, JSON.stringify({ drafts: nonEmptyDrafts, nextDraftSeq }));
    } else {
      window.localStorage.removeItem(storageKey);
    }
    onClose?.(nonEmptyDrafts.length > 0);
  }

  async function handleEmitir() {
    if (!canSubmit) return;
    setEmitiendo(true);
    setErrors([]);
    setLastResult(null);

    try {
      const body = {
        tipo_dte: tipoDte,
        receptor_rut: receptorRut.trim() || undefined,
        receptor_razon_social: receptorRazonSocial.trim() || undefined,
        receptor_direccion: receptorDireccion.trim() || undefined,
        receptor_comuna: receptorComuna.trim() || undefined,
        detalles: [{ nombre: detalleNombre.trim(), monto: total }],
        monto_total: total,
      };

      const res = await fetch("/api/intermediaria/emitir-boleta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as EmitirResponse;

      if (!res.ok || !json.ok) {
        const validationErrors = json.errores?.map((e) => e.message) ?? [json.detalle ?? json.error ?? "Error al emitir DTE"];
        setErrors(validationErrors);
        toast(validationErrors[0] ?? "Error al emitir DTE", "error");
        return;
      }

      setLastResult(json);
      const providerLabel = json.proveedor === "libredte" ? "LibreDTE" : "mock";
      toast(`DTE emitido: folio #${json.folio ?? "--"} por ${fmt(json.monto_total ?? total)} (${providerLabel})`);
      setDrafts((current) => {
        if (current.length <= 1) {
          const draft = newDraftForOpenSlot(tipoInicial, [], nextDraftSeq);
          setNextDraftSeq((seq) => nextSeq(seq));
          setActiveDraftId(draft.id);
          return [draft];
        }
        const next = current.filter((draft) => draft.id !== activeDraft.id);
        setActiveDraftId(next[0]?.id ?? "");
        return next;
      });
      router.refresh();
    } catch {
      setErrors(["Error de red al emitir el DTE"]);
      toast("Error de red al emitir el DTE", "error");
    } finally {
      setEmitiendo(false);
    }
  }

  function sendLocalSiiJob() {
    const jobId = makeClientId();
    setLocalWorkerLoading(true);
    setLocalWorker({ jobId, status: "opening_sii", message: "Abriendo ventana segura SII..." });

    window.postMessage({
      source: "app-contable",
      type: "APP_CONTABLE_SII_BOLETA_JOB",
      protocol_version: 1,
      job: {
        job_id: jobId,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        empresa_id: empresaId ?? "default",
        tipo_dte: tipoDte,
        fecha_emision: chileTodayString(),
        receptor: {
          rut: receptorRut.trim() || undefined,
          razon_social: receptorRazonSocial.trim() || undefined,
          direccion: receptorDireccion.trim() || undefined,
          comuna: receptorComuna.trim() || undefined,
        },
        detalles: [{ nombre: detalleNombre.trim(), cantidad: 1, monto_total: total }],
        totales: {
          monto_total: total,
          monto_neto: tipoDte === 39 ? Math.round(total / 1.19) : 0,
          iva: tipoDte === 39 ? total - Math.round(total / 1.19) : 0,
          monto_exento: tipoDte === 41 ? total : 0,
        },
        learn_only: false,
        auto_emit: true,
        allow_final_emit: true,
        payment_method: "Efectivo",
        confirmation_required: false,
      },
    }, window.location.origin);
  }

  async function persistVisibleSiiFolio() {
    const folio = Number(manualSiiFolio.replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(folio) || folio <= 0) {
      toast("Ingresa el folio visible en SII", "error");
      return;
    }

    setLocalWorkerLoading(true);
    try {
      const res = await fetch("/api/sii-local/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: localWorker?.jobId ?? `manual:${folio}`,
          result: {
            folio,
            folio_confidence: "high",
            folio_evidence: {
              source: "manual_visible_receipt",
              matched_text: `Folio visible confirmado por usuario: ${folio}`,
            },
            tipo_dte: tipoDte,
            fecha_emision: chileTodayString(),
            estado: "emitida_capturada_manual",
            monto_total: total,
            receptor: {
              rut: receptorRut.trim() || null,
              razon_social: receptorRazonSocial.trim() || null,
              direccion: receptorDireccion.trim() || null,
              comuna: receptorComuna.trim() || null,
            },
            detalles: [{ nombre: detalleNombre.trim(), cantidad: 1, monto_total: total }],
            totales: {
              monto_total: total,
              monto_neto: tipoDte === 39 ? Math.round(total / 1.19) : 0,
              iva: tipoDte === 39 ? total - Math.round(total / 1.19) : 0,
              monto_exento: tipoDte === 41 ? total : 0,
            },
            artifact_links: [],
            page: { title: "e-Boleta", url: "manual-visible-receipt" },
          },
        }),
      });
      const json = (await res.json()) as { ok?: boolean; boleta_id?: string; error?: string; detalle?: string; already_exists?: boolean };
      if (!res.ok || !json.ok) {
        toast(json.detalle ?? json.error ?? "No se pudo guardar el folio SII", "error");
        setLocalWorker({ jobId: localWorker?.jobId ?? null, status: "save_failed", message: json.detalle ?? json.error ?? "No se pudo guardar el folio SII" });
        return;
      }
      setLocalWorker({
        jobId: localWorker?.jobId ?? null,
        status: json.already_exists ? "already_exists" : "emitted",
        message: json.already_exists ? `Boleta #${folio} ya estaba guardada.` : `Boleta #${folio} guardada en la app.`,
      });
      setManualSiiFolio("");
      toast(json.already_exists ? `Boleta #${folio} ya estaba guardada` : `Boleta #${folio} guardada en la app`, "success");
      router.refresh();
    } catch {
      toast("Error de red al guardar folio SII", "error");
    } finally {
      setLocalWorkerLoading(false);
    }
  }

  async function persistLatestSiiPdf() {
    setLocalWorkerLoading(true);
    try {
      const res = await fetch("/api/sii-local/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recover_latest: true }),
      });
      const json = (await res.json()) as { ok?: boolean; folio?: number; boleta_id?: string; error?: string; detalle?: string; already_exists?: boolean };
      if (!res.ok || !json.ok) {
        toast(json.detalle ?? json.error ?? "No se pudo guardar el PDF SII detectado", "error");
        return;
      }
      setLocalWorker({
        jobId: localWorker?.jobId ?? null,
        status: json.already_exists ? "already_exists" : "emitted",
        message: json.already_exists ? `Boleta #${json.folio ?? "--"} ya estaba guardada.` : `Boleta #${json.folio ?? "--"} y PDF SII guardados en la app.`,
      });
      toast(json.already_exists ? `Boleta #${json.folio ?? "--"} ya estaba guardada` : `Boleta #${json.folio ?? "--"} guardada con PDF SII`, "success");
      router.refresh();
    } catch {
      toast("Error de red al guardar PDF SII", "error");
    } finally {
      setLocalWorkerLoading(false);
    }
  }

  function openLocalSiiWorker() {
    if (!canSubmit || localWorkerLoading) return;
    if (extensionStatus === "ready") {
      sendLocalSiiJob();
      return;
    }

    setLocalWorkerLoading(true);
    setExtensionStatus("checking");
    pingLocalSiiExtension((message) => {
      if (!message) {
        setExtensionStatus("missing");
        setLocalWorkerLoading(false);
        toast("No pude encontrar la extensión local SII", "error");
        return;
      }
      setExtensionStatus("ready");
      sendLocalSiiJob();
    });
  }

  function handlePrimaryEmit() {
    if (usesSiiLocal) {
      openLocalSiiWorker();
      return;
    }
    void handleEmitir();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <style>{`
        .ed-shell{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:12px;height:100%}
        .ed-card{border:1px solid var(--border);background:var(--bg-muted);border-radius:12px;padding:10px}
        .ed-card-quiet{border:1px solid var(--border);background:transparent;border-radius:12px;padding:10px}
        .ed-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .ed-grid-detail{display:grid;grid-template-columns:1.35fr .75fr;gap:8px}
        .ed-label{font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
        .ed-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;border:1px solid var(--border);padding:4px 7px;font-size:9px;font-weight:700;color:var(--text2);background:var(--bg-muted)}
        .ed-draft-tabs{position:absolute;left:-42px;top:96px;bottom:12px;width:42px;display:flex;flex-direction:column;align-items:center;gap:74px;padding-top:8px;pointer-events:none;z-index:6}
        .ed-draft-tab{width:92px;height:30px;display:flex;align-items:center;justify-content:center;gap:6px;padding:5px 8px;border-radius:10px 10px 0 0;border:1px solid var(--border);border-bottom-color:rgba(255,255,255,.03);background:rgba(22,24,29,.96);color:var(--text2);font-size:9px;font-weight:800;cursor:pointer;white-space:nowrap;transform:rotate(-90deg);transform-origin:center;box-shadow:-8px 10px 24px rgba(0,0,0,.24);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);pointer-events:auto}
        .ed-draft-tab.active{border-color:rgba(232,85,62,.45);background:rgba(232,85,62,.11);color:#E8553E}
        .ed-draft-close{width:16px;height:16px;border-radius:999px;border:none;background:rgba(255,255,255,.06);color:currentColor;display:grid;place-items:center;cursor:pointer;font-size:11px;line-height:1}
        .ed-dup-item{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border-radius:9px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.16);color:#f59e0b;font-size:9px;cursor:help}
        .ed-dup-tip{position:absolute;right:0;bottom:calc(100% + 8px);width:230px;padding:10px;border-radius:11px;background:rgba(15,16,20,.96);border:1px solid rgba(245,158,11,.24);box-shadow:0 18px 46px rgba(0,0,0,.38);color:rgba(255,255,255,.88);opacity:0;transform:translateY(4px);pointer-events:none;transition:opacity .15s ease,transform .15s ease;z-index:5}
        .ed-dup-item:hover .ed-dup-tip{opacity:1;transform:translateY(0)}
        .ed-type-button{min-height:44px;padding:8px;border-radius:10px;border:1px solid var(--border);cursor:pointer;text-align:left;transition:border-color .18s ease,background .18s ease,opacity .18s ease}
        .ed-type-button:disabled{cursor:not-allowed}
        .ed-sidebar{display:flex;flex-direction:column;gap:8px;min-height:0}
        @media (max-width: 720px){.ed-draft-tabs{position:static;width:auto;display:flex;flex-direction:row;gap:5px;padding:8px 18px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.015);overflow-x:auto}.ed-draft-tab{transform:none;width:auto}.ed-shell{grid-template-columns:1fr;height:auto}.ed-grid-2,.ed-grid-detail{grid-template-columns:1fr}.ed-sidebar{order:-1}.ed-body{overflow:auto!important}}
      `}</style>

      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button aria-label="Cerrar emisión directa" onClick={handleClose} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 16 }}>
          ×
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span className="ed-label">DTE único</span>
            <span className="ed-chip">Manual</span>
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Emisión Directa</h2>
          <p style={{ fontSize: 10, color: "var(--text2)", marginTop: 1 }}>Emite una boleta manual cuando no viene desde una carga masiva.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <span style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tipo actual</span>
          <strong style={{ fontSize: 12, color: tipoDte === 39 ? "#E8553E" : "#5b9cf6" }}>{tipoDte === 39 ? "Afecta" : "Exenta"}</strong>
        </div>
      </div>

      <div className="ed-draft-tabs" aria-label="Boletas pendientes">
        {drafts.map((draft) => {
          const active = draft.id === activeDraft.id;
          const hasContent = draftHasContent(draft);
          const draftColor = DRAFT_COLORS[draft.colorIndex] ?? DRAFT_COLORS[0];
          return (
            <button
              key={draft.id}
              type="button"
              className={`ed-draft-tab${active ? " active" : ""}`}
              onClick={() => { setActiveDraftId(draft.id); setErrors([]); setLastResult(null); }}
              style={{
                borderColor: active ? draftColor.border : "var(--border)",
                background: active ? draftColor.bg : "rgba(22,24,29,.96)",
                color: active ? draftColor.fg : "var(--text2)",
                boxShadow: active ? `-8px 10px 24px rgba(0,0,0,.24), inset 0 0 0 1px ${draftColor.border}` : undefined,
              }}
            >
              <span>Boleta {draft.slot}</span>
              {hasContent && <span style={{ width: 5, height: 5, borderRadius: 999, background: active ? draftColor.dot : "var(--text3)" }} />}
              {(drafts.length > 1 || hasContent) && (
                <span className="ed-draft-close" onClick={(e) => { e.stopPropagation(); closeDraft(draft.id); }} aria-label="Cerrar boleta pendiente">×</span>
              )}
            </button>
          );
        })}
        <button type="button" className="ed-draft-tab" onClick={addDraft} disabled={drafts.length >= 3} style={{ opacity: drafts.length >= 3 ? .45 : 1, cursor: drafts.length >= 3 ? "not-allowed" : "pointer" }}>
          + Nueva
        </button>
      </div>

      <div className="ed-body" style={{ flex: 1, minHeight: 0, padding: "12px 18px", overflow: "hidden" }}>
        <div className="ed-shell">
          <main style={{ display: "flex", flexDirection: "column", gap: 9, minHeight: 0 }}>
            <section className="ed-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <div>
                  <span className="ed-label">1. Tipo de documento</span>
                  <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Bloqueado por empresa, desbloqueable para excepciones.</p>
                </div>
                {hasEmpresaLock && (
                  <button
                    onClick={() => setTipoDesbloqueado((v) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 34, padding: "6px 10px", borderRadius: 999, border: "1px solid var(--border)", background: tipoDesbloqueado ? "rgba(245,158,11,.1)" : "var(--surface)", color: tipoDesbloqueado ? "#f59e0b" : "var(--text2)", cursor: "pointer", fontSize: 9, fontWeight: 700 }}
                    title={tipoDesbloqueado ? "Volver a bloquear tipo por empresa" : "Desbloquear selección manual de tipo DTE"}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      {tipoDesbloqueado ? <path d="M7 11V7a5 5 0 019.6-2M5 11h14v10H5z" /> : <path d="M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z" />}
                    </svg>
                    {tipoDesbloqueado ? "Desbloqueado" : "Bloqueado"}
                  </button>
                )}
              </div>

              <div className="ed-grid-2">
                <button className="ed-type-button" onClick={() => setTipo(39)} disabled={tipoLocked} style={{ borderColor: tipoDte === 39 ? "rgba(232,85,62,.45)" : "var(--border)", background: tipoDte === 39 ? "var(--accent-light)" : "var(--surface)", color: tipoDte === 39 ? "#E8553E" : "var(--text2)", opacity: tipoLocked && tipoDte !== 39 ? 0.45 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>Boleta afecta</div>
                  <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 39 · IVA incluido</div>
                </button>
                <button className="ed-type-button" onClick={() => setTipo(41)} disabled={tipoLocked} style={{ borderColor: tipoDte === 41 ? "rgba(91,156,246,.45)" : "var(--border)", background: tipoDte === 41 ? "rgba(91,156,246,.12)" : "var(--surface)", color: tipoDte === 41 ? "#5b9cf6" : "var(--text2)", opacity: tipoLocked && tipoDte !== 41 ? 0.45 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>Boleta exenta</div>
                  <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 41 · Sin IVA</div>
                </button>
              </div>

              {tipoLocked && (
                <p style={{ fontSize: 9, color: "var(--text3)", marginTop: 8 }}>Tipo fijado por configuración de empresa: {isExento ? "exenta" : "afecta"}.</p>
              )}
            </section>

            <section className="ed-card-quiet">
              <div style={{ marginBottom: 8 }}>
                <span className="ed-label">2. Receptor</span>
                <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Datos opcionales del cliente cuando correspondan.</p>
              </div>
              <div className="ed-grid-2">
                <Field label="RUT receptor" value={receptorRut} onChange={(value) => updateActiveDraft({ receptorRut: value })} placeholder="Opcional bajo $180.000" />
                <Field label="Razón social" value={receptorRazonSocial} onChange={(value) => updateActiveDraft({ receptorRazonSocial: value })} placeholder="Cliente o consumidor" />
                <Field label="Dirección" value={receptorDireccion} onChange={(value) => updateActiveDraft({ receptorDireccion: value })} placeholder="Opcional" />
                <Field label="Comuna" value={receptorComuna} onChange={(value) => updateActiveDraft({ receptorComuna: value })} placeholder="Opcional" />
              </div>
            </section>

            <section className="ed-card-quiet">
              <div style={{ marginBottom: 8 }}>
                <span className="ed-label">3. Detalle y monto</span>
                <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Un concepto por emisión directa.</p>
              </div>
              <div className="ed-grid-detail">
                <Field label="Detalle" value={detalleNombre} onChange={(value) => updateActiveDraft({ detalleNombre: value })} placeholder="Servicio prestado" />
                <Field label={tipoDte === 39 ? "Total bruto" : "Total exento"} value={monto} onChange={(value) => updateActiveDraft({ monto: value })} placeholder="$0" inputMode="numeric" />
              </div>
            </section>
          </main>

          <aside className="ed-sidebar">
            <div className="ed-card" style={{ padding: 12 }}>
              <span className="ed-label">Resumen</span>
              <div style={{ fontSize: 22, color: "var(--text)", fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", marginTop: 6 }}>{fmt(total)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9, fontSize: 10, color: "var(--text2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>Documento</span><strong style={{ color: "var(--text)" }}>DTE {tipoDte}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>Tipo</span><strong style={{ color: tipoDte === 39 ? "#E8553E" : "#5b9cf6" }}>{tipoDte === 39 ? "Afecta" : "Exenta"}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>IVA</span><strong style={{ color: "var(--text)" }}>{tipoDte === 39 ? "Incluido" : "No aplica"}</strong></div>
              </div>
            </div>

            {usesSiiLocal && (
              <div style={{ padding: 11, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <span className="ed-label">SII local</span>
                  <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 3 }}>Se abre e-Boleta en una ventana segura. No usa backend para emitir.</div>
                </div>
                {localWorker && (
                  <div style={{ padding: 8, borderRadius: 9, background: "rgba(232,85,62,.08)", border: "1px solid rgba(232,85,62,.16)", color: "var(--text2)", fontSize: 9, lineHeight: 1.4 }}>
                    <strong style={{ color: "#E8553E" }}>{localWorker.status}</strong><br />{localWorker.message}
                  </div>
                )}
                {extensionStatus === "missing" && (
                  <div style={{ fontSize: 9, color: "#ef4444", lineHeight: 1.35 }}>No encuentro la extensión local. Recárgala en Chrome y vuelve a intentar.</div>
                )}
                {total > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => { void persistLatestSiiPdf(); }}
                      disabled={localWorkerLoading}
                      style={{ height: 32, borderRadius: 9, border: "none", background: "#E8553E", color: "#fff", padding: "0 10px", fontSize: 9, fontWeight: 800, cursor: localWorkerLoading ? "not-allowed" : "pointer", opacity: localWorkerLoading ? .55 : 1 }}
                    >
                      Guardar último PDF SII
                    </button>
                    <div style={{ fontSize: 8, color: "var(--text3)", lineHeight: 1.3 }}>Usa esto si SII ya emitió y aparece el comprobante/PDF, pero la app no lo guardó.</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                      <input
                        value={manualSiiFolio}
                        onChange={(event) => setManualSiiFolio(event.target.value)}
                        inputMode="numeric"
                        placeholder="Folio visible"
                        style={{ minWidth: 0, height: 32, borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", padding: "0 9px", fontSize: 10 }}
                      />
                      <button
                        type="button"
                        onClick={() => { void persistVisibleSiiFolio(); }}
                        disabled={localWorkerLoading}
                        style={{ height: 32, borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", padding: "0 10px", fontSize: 9, fontWeight: 800, cursor: localWorkerLoading ? "not-allowed" : "pointer", opacity: localWorkerLoading ? .55 : 1 }}
                      >
                        Guardar folio
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tipoDiferenteEmpresa && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "#f59e0b", fontSize: 10, lineHeight: 1.45 }}>
                Estás emitiendo un DTE distinto al tipo configurado para la empresa. Úsalo solo si la operación corresponde tributariamente.
              </div>
            )}

            {(duplicateLoading || duplicateCandidates.length > 0) && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(245,158,11,.06)", border: "1px solid rgba(245,158,11,.16)", display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span className="ed-label" style={{ color: "#f59e0b" }}>Posible duplicado</span>
                  <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 800 }}>{duplicateLoading ? "Buscando..." : `${duplicateCandidates.length} opción${duplicateCandidates.length !== 1 ? "es" : ""}`}</span>
                </div>
                {duplicateCandidates.map((candidate) => (
                  <div key={candidate.id} className="ed-dup-item">
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{candidate.folio ?? "--"} · {fmt(candidate.monto_total)}</span>
                    <span style={{ fontWeight: 900 }}>Ver</span>
                    <div className="ed-dup-tip">
                      <div style={{ fontSize: 11, fontWeight: 900, color: "#fff", marginBottom: 6 }}>Boleta #{candidate.folio ?? "--"}</div>
                      <DupRow label="Fecha" value={candidate.fecha_emision} />
                      <DupRow label="Tipo" value={candidate.tipo_dte === 39 ? "Afecta" : "Exenta"} />
                      <DupRow label="Receptor" value={candidate.receptor_razon_social ?? candidate.receptor_rut ?? "Sin receptor"} />
                      <DupRow label="Monto" value={fmt(candidate.monto_total)} />
                      <DupRow label="Detalle" value={candidate.detalle || "Sin detalle"} />
                      <div style={{ marginTop: 6, color: "#f59e0b", fontSize: 9, lineHeight: 1.35 }}>{candidate.motivos.join(" · ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {errors.length > 0 && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.18)", color: "#ef4444", fontSize: 10, lineHeight: 1.5 }}>
                {errors.map((error) => <div key={error}>{error}</div>)}
              </div>
            )}

            {lastResult && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.18)", color: "#22c55e", fontSize: 10, lineHeight: 1.5 }}>
                Emitido folio #{lastResult.folio ?? "--"}<br />Track {lastResult.track_id ?? "--"}
              </div>
            )}

            <div style={{ padding: 11, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 10, color: "var(--text2)", lineHeight: 1.5 }}>
              La carga masiva sigue en <strong style={{ color: "var(--text)" }}>Subir documento</strong>. Este modal es solo para un DTE manual.
            </div>

            <div style={{ marginTop: "auto", paddingTop: 2 }}>
              <div style={{ marginBottom: 7, fontSize: 9, color: "var(--text2)", textAlign: "center" }}>
                {canSubmit ? "Listo para emitir." : "Ingresa detalle y monto."}
              </div>
              <button onClick={handlePrimaryEmit} disabled={primaryDisabled} style={{ width: "100%", minHeight: 38, fontSize: 11, padding: "8px 14px", borderRadius: 10, border: "none", cursor: primaryDisabled ? "not-allowed" : "pointer", fontWeight: 800, background: "#E8553E", color: "#fff", opacity: primaryDisabled ? 0.45 : 1, boxShadow: !primaryDisabled ? "0 10px 26px rgba(232,85,62,.24)" : "none" }}>
                {primaryLabel}
              </button>
            </div>
          </aside>
        </div>
      </div>

      <div style={{ padding: "8px 18px", borderTop: "1px solid var(--border)", flexShrink: 0, background: "var(--surface)", fontSize: 10, color: "var(--text2)" }}>
        La carga masiva sigue disponible en MassDTE.
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "numeric";
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        style={{ width: "100%", height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", padding: "0 9px", fontSize: 11, outline: "none" }}
      />
    </label>
  );
}

function DupRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 9, lineHeight: 1.35, marginTop: 3 }}>
      <span style={{ color: "rgba(255,255,255,.45)" }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,.88)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}
