"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import TermHint from "@/components/ui/TermHint";
import { validarRut } from "@/lib/rut";
import { EXTENSION_VERSION_ACTUAL, extensionDesactualizada, mensajeExtensionDesactualizada } from "@/lib/extension";
import { RECEPTOR_OBLIGATORIO_DESDE } from "@/lib/sii/validation";
import { obtenerUmbralReceptorClp } from "./actions";
import { useEmissionLockStatus, type EmissionLockInfo } from "./useEmissionLockStatus";

type TipoDte = 33 | 34 | 39 | 41;
type FormaPago = "Efectivo" | "Pago Electrónico" | "Transferencia Electrónica" | "Cheque" | "Otro" | "Contado" | "Crédito" | "";

// Etiquetas exactas del select "Elija método de pago" del portal e-Boleta SII.
const FORMAS_PAGO: FormaPago[] = ["Efectivo", "Pago Electrónico", "Transferencia Electrónica", "Cheque", "Otro"];
const DRAFT_STORAGE_TTL_MS = 12 * 60 * 60 * 1000;

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
  proveedor?: "mock" | "sii_local" | "simpleapi";
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
  receptorComuna: string; // solo carril facturas (SimpleAPI); e-Boleta no tiene Comuna
  receptorGiro?: string;  // solo mesa facturas: la factura individualiza al receptor entero
  receptorEmail: string;
  receptorTelefono: string;
  detalleNombre: string;
  monto: string;
  formaPago: FormaPago;
  updatedAt: number;
}

interface DraftStorageState {
  drafts: BoletaDraft[];
  nextDraftSeq: number;
  savedAt?: number;
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
  ok?: boolean;
  error?: string;
  detalle?: string;
  data?: unknown;
  step?: string;
  trackId?: number;
  dte?: { folio?: number; tipoDte?: number; fecha?: string; total?: number };
  pdf?: { base64?: string; content_type?: string; filename?: string } | null;
  dteXml?: string | null;
  envioXml?: string | null;
  envio?: unknown;
  consultaDte?: unknown;
}

interface LocalWorkerState {
  jobId: string | null;
  status: string;
  message: string;
}

interface EmissionJobStartResponse {
  ok?: boolean;
  job_id?: string;
  expires_at?: string;
  locked_until?: string;
  empresa_id?: string;
  expected_emisor_rut?: string | null;
  business_mode?: boolean;
  reserved_folio?: number | null;
  reserved_tipo_dte?: number | null;
  error?: string;
  detalle?: string;
  bloqueo?: EmissionLockInfo | null;
}

interface EmissionAuthorizationResponse {
  ok?: boolean;
  authorized?: boolean;
  legal_version?: string;
  error?: string;
  detalle?: string;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function parseAmount(value: string): number {
  return Number(value.replace(/[^0-9]/g, ""));
}

function errorFromUnknownData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["detalle", "error", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const nested = record.data;
  if (nested && typeof nested === "object") return errorFromUnknownData(nested);
  return null;
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

function pingLocalSiiExtension(onResult: (message: ExtensionPageMessage | null) => void, empresaId?: string | null): () => void {
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
    ultima_version: EXTENSION_VERSION_ACTUAL,
    // La extensión reentrega folios pendientes SOLO a la empresa que declara el
    // ping (mismo valor que viaja en el job: empresa_id ?? "default").
    empresa_id: empresaId ?? "default",
  }, window.location.origin);

  return cleanup;
}

const DRAFT_COLORS = [
  { fg: "#E8553E", bg: "rgba(232,85,62,.12)", border: "rgba(232,85,62,.46)", dot: "#E8553E" },
  { fg: "var(--amber)", bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.44)", dot: "var(--amber)" },
  { fg: "var(--lime)", bg: "rgba(180,240,39,.10)", border: "rgba(180,240,39,.38)", dot: "var(--lime)" },
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
    receptorEmail: "",
    receptorTelefono: "",
    detalleNombre: "Servicio prestado",
    monto: "",
    formaPago: "Efectivo",
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
    draft.receptorEmail.trim() ||
    draft.receptorTelefono.trim() ||
    draft.monto.trim() ||
    draft.detalleNombre.trim() !== "Servicio prestado"
  );
}

type EmisionProveedorUi = "mock" | "sii_local" | "simpleapi";

// Estados internos del worker SII → etiquetas legibles para el panel.
const WORKER_STATUS_LABELS: Record<string, string> = {
  opening_sii: "Abriendo SII",
  waiting_sii_login: "Esperando inicio de sesión",
  waiting_manual_login: "Inicia sesión manualmente",
  autologin_attempting: "Iniciando sesión automática",
  autologin_sent: "Sesión SII enviada",
  sii_page_ready: "Página SII lista",
  submitting: "Emitiendo boleta",
  capturing_result: "Capturando folio",
  retrying: "Reintentando",
  emitted: "Boleta emitida",
  result_needs_review: "Requiere revisión",
  learning_observing: "Modo aprendizaje",
  cancelled: "Cancelado",
  closed: "Ventana cerrada",
  save_failed: "No se pudo guardar",
  already_exists: "Ya estaba guardada",
  error: "Error",
};

// Estados PRE-emisión donde "cancelar y volver a emitir" es seguro (aún no se
// cliqueó el EMITIR real → no hay folio en juego). Para submitting/capturing/
// result_needs_review/save_failed la salida correcta es RECUPERAR, no re-emitir:
// ofrecer un reset ahí invitaba a duplicar una boleta real (auditoría).
const RESET_SAFE_STATUSES = new Set([
  "opening_sii",
  "waiting_sii_login",
  "waiting_manual_login",
  "autologin_attempting",
  "autologin_sent",
  "sii_page_ready",
  "retrying",
]);

export default function EmitirDirectaView({ empresaTipo, empresaId, emisionProveedor = "mock", facturasProveedor = "mock", devMode = false, empresaRut, empresaRazonSocial, empresaGiro, empresaDireccion, empresaComuna, mesaFactura = false, onClose }: { empresaTipo?: string; empresaId?: string; emisionProveedor?: EmisionProveedorUi; facturasProveedor?: "mock" | "sii_local" | "simpleapi"; devMode?: boolean; empresaRut?: string | null; empresaRazonSocial?: string | null; empresaGiro?: string | null; empresaDireccion?: string | null; empresaComuna?: string | null; mesaFactura?: boolean; onClose?: (saved?: boolean) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  // Modo FACTURA ÚNICA (mesa Facturas): misma vista y mismo lenguaje —
  // pestañas de borradores, secciones, todo — con tipos 33/34, receptor
  // completo obligatorio y forma de pago Contado/Crédito sin default.
  const tipoInicial: TipoDte = mesaFactura
    ? (empresaTipo === "exento" ? 34 : 33)
    : (empresaTipo === "exento" ? 41 : 39);
  // Los borradores de cada mesa viven aparte: una boleta a medias no puede
  // reaparecer como factura ni al revés.
  const storageKey = `v5-emision-directa-session-drafts:${empresaId ?? "default"}${mesaFactura ? ":factura" : ""}`;
  const [drafts, setDrafts] = useState<BoletaDraft[]>(() => [
    mesaFactura ? { ...newDraft(tipoInicial), formaPago: "" as FormaPago } : newDraft(tipoInicial),
  ]);
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
  // Espejo del estado para leerlo dentro del listener de mensajes sin re-suscribir.
  const localWorkerRef = useRef<LocalWorkerState | null>(null);
  useEffect(() => { localWorkerRef.current = localWorker; }, [localWorker]);
  // Jobs ya cerrados desde esta sesión: JOB_CLOSE se manda UNA vez por job.
  const closedJobIdsRef = useRef<Set<string>>(new Set());
  // Último mensaje de estado de la extensión (para la CAJA NEGRA: se adjunta como
  // motivo al cerrar un job fallido → queda en status_message + ops_event).
  const lastStatusMsgRef = useRef<string | null>(null);
  const [simpleApiJobId, setSimpleApiJobId] = useState<string | null>(null);
  const [manualSiiFolio, setManualSiiFolio] = useState("");
  const [leyendoComprobante, setLeyendoComprobante] = useState(false);
  const comprobanteInputRef = useRef<HTMLInputElement>(null);
  // Pre-vuelo (confirmación SIEMPRE) + autorización legal en modal propio.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [legalPrompt, setLegalPrompt] = useState<{ providerLabel: string } | null>(null);
  const legalResolverRef = useRef<((accepted: boolean) => void) | null>(null);
  // Umbral 135 UF con la UF VIVA (mismo patrón que revisar-shared): arranca en la
  // constante referencial y se re-ancla al valor del server. Si el fetch falla,
  // queda el fallback referencial — nunca bloquear por error de red.
  const [umbralReceptor, setUmbralReceptor] = useState<number>(RECEPTOR_OBLIGATORIO_DESDE);

  const activeDraft = drafts.find((draft) => draft.id === activeDraftId) ?? drafts[0] ?? newDraft(tipoInicial);
  const tipoDte = activeDraft.tipoDte;
  const receptorRut = activeDraft.receptorRut;
  const receptorRazonSocial = activeDraft.receptorRazonSocial;
  const receptorDireccion = activeDraft.receptorDireccion ?? "";
  const receptorComuna = activeDraft.receptorComuna ?? "";
  const receptorEmail = activeDraft.receptorEmail ?? "";
  const receptorTelefono = activeDraft.receptorTelefono ?? "";
  const detalleNombre = activeDraft.detalleNombre;
  const monto = activeDraft.monto;
  const formaPago = activeDraft.formaPago ?? "Efectivo";

  const total = useMemo(() => parseAmount(monto), [monto]);
  const isAfecto = empresaTipo === "afecto";
  const isExento = empresaTipo === "exento";
  const hasEmpresaLock = isAfecto || isExento;
  const tipoLocked = hasEmpresaLock && !tipoDesbloqueado;
  const tipoEmpresa: TipoDte | null = isExento ? 41 : isAfecto ? 39 : null;
  const tipoDiferenteEmpresa = !!tipoEmpresa && tipoDte !== tipoEmpresa;
  // Carriles del producto: boletas 39/41 → bot SII local (e-Boleta);
  // facturas 33/34 → SimpleAPI. El gate por tipo evita que una factura
  // termine en el bot de e-Boleta o una boleta en el generador de facturas.
  const isBoletaTipo = tipoDte === 39 || tipoDte === 41;
  const usesSiiLocal = !mesaFactura && emisionProveedor === "sii_local" && isBoletaTipo;
  // En la mesa Facturas la emisión va SIEMPRE por el carril del lote (dos
  // pasos: crear propuesta + emitir) — el server decide si el proveedor real
  // existe. SimpleAPI queda para el modo dev de la mesa boletas.
  const usesSimpleApi = !mesaFactura && facturasProveedor === "simpleapi" && (tipoDte === 33 || tipoDte === 34);
  const currentEmissionJobId = localWorker?.jobId ?? simpleApiJobId;
  const {
    status: emissionLock,
    activeLock: activeEmissionLock,
    // Solo OTRO usuario emitiendo bloquea el botón. Tu propio candado pegado NO te
    // encierra (myStaleLock): se cancela en un click, no espera el TTL de 15 min.
    lockedByOtherUser: lockBlocksEmission,
    myStaleLock,
    setStatus: setEmissionLock,
  } = useEmissionLockStatus({ enabled: usesSiiLocal || usesSimpleApi, currentJobId: currentEmissionJobId });
  // Receptor es opcional, pero si se escribió un RUT tiene que ser válido:
  // un dígito verificador malo termina en rechazo SII.
  const rutReceptorInvalido = receptorRut.trim().length > 0 && !validarRut(receptorRut);
  // El SII EXIGE el nombre si se pone un RUT que no está registrado (muestra "No hay
  // información registrada para este receptor, indique su nombre" y no habilita EMITIR).
  // Como no sabemos si el RUT está registrado, con RUT presente pedimos el nombre siempre.
  const receptorNombrePendiente = receptorRut.trim().length > 0 && !receptorRazonSocial.trim();
  // Res. Ex. SII 44/2025: sobre ~135 UF la boleta debe identificar al comprador.
  const receptorObligatorioPendiente = total > umbralReceptor && (!receptorRut.trim() || !receptorRazonSocial.trim());
  // Modo factura: receptor COMPLETO (decisión del fundador) + forma de pago
  // elegida expresamente (sin default). Los faltantes se listan para el hint.
  const receptorGiro = activeDraft.receptorGiro ?? "";
  const facturaFaltantes = mesaFactura
    ? [
        !receptorRut.trim() && "RUT",
        !receptorRazonSocial.trim() && "razón social",
        !receptorGiro.trim() && "giro",
        !receptorDireccion.trim() && "dirección",
        !receptorComuna.trim() && "comuna",
      ].filter((x): x is string => Boolean(x))
    : [];
  const facturaFormaPagoElegida = !mesaFactura || formaPago === "Contado" || formaPago === "Crédito";
  const canSubmit = total > 0 && detalleNombre.trim().length > 0 && !rutReceptorInvalido && !receptorNombrePendiente && !receptorObligatorioPendiente && facturaFaltantes.length === 0 && facturaFormaPagoElegida && !emitiendo;
  // Anti-doble-emisión CROSS-JOB: mientras una emisión SII siga sin resolverse
  // (folio pendiente de capturar/ingresar), NO re-habilitar el botón aunque el
  // servidor haya soltado el lock por una captura de evidencia débil. De lo
  // contrario el usuario podría lanzar un job NUEVO y emitir la boleta dos veces
  // (sin Nota de Crédito para revertir). Terminal = seguro para empezar otra.
  // NOTA: "save_failed" queda FUERA del set terminal A PROPÓSITO — un fallo de
  // guardado LOCAL no descarta que la boleta se emitiera en el SII; se resuelve por
  // el panel "Recuperar emisión", no re-emitiendo. No lo agregues como terminal.
  const siiWorkerPendiente = usesSiiLocal && localWorker != null
    && !["emitted", "already_exists", "error", "cancelled", "closed"].includes(localWorker.status);
  const canOpenLocalWorker = canSubmit && !localWorkerLoading && !lockBlocksEmission && !siiWorkerPendiente;
  const primaryDisabled = usesSiiLocal ? !canOpenLocalWorker : usesSimpleApi ? !canSubmit || lockBlocksEmission : !canSubmit;
  const primaryLabel = lockBlocksEmission && (usesSiiLocal || usesSimpleApi)
    ? "Emisión en curso"
    : usesSiiLocal
    ? localWorkerLoading ? "Abriendo..." : "Emitir en SII"
    : usesSimpleApi ? emitiendo ? "Generando..." : "Generar con SimpleAPI"
      : emitiendo ? "Emitiendo..." : "Emitir DTE";
  const isFactura = tipoDte === 33 || tipoDte === 34;
  const documentKindLabel = isFactura ? "Factura" : "Boleta";
  const typeLabel = tipoDte === 33 || tipoDte === 39 ? "Afecta" : "Exenta";
  const typeColor = tipoDte === 33 || tipoDte === 39 ? "#E8553E" : "var(--blue)";
  const emitBusy = emitiendo || localWorkerLoading;
  // Carril real vs simulado — gobierna el badge del pre-vuelo.
  const emisionEsReal = isFactura ? facturasProveedor !== "mock" : emisionProveedor !== "mock";
  const tipoHumano = `${documentKindLabel} ${typeLabel.toLowerCase()} · ${tipoDte === 33 || tipoDte === 39 ? "con IVA 19%" : "sin IVA"}`;
  const receptorResumen = receptorRazonSocial.trim() || receptorRut.trim()
    ? [receptorRazonSocial.trim(), receptorRut.trim()].filter(Boolean).join(" · ")
    : "Consumidor final";

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as BoletaDraft[] | DraftStorageState;
        const expired = !Array.isArray(parsed) && typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > DRAFT_STORAGE_TTL_MS;
        if (expired) {
          window.sessionStorage.removeItem(storageKey);
          return;
        }
        const savedDrafts = Array.isArray(parsed) ? parsed : parsed.drafts;
        const validDrafts = (savedDrafts ?? []).filter((draft) => draft?.id).slice(0, 3).map((draft, index) => ({
          // Fusiona SOBRE una base con TODOS los campos: un borrador viejo (guardado
          // antes de agregar receptorEmail/Telefono u otros) toma el default "" en los
          // que falten, evitando el warning de input controlado→no-controlado (undefined).
          ...newDraft(draft.tipoDte ?? tipoInicial),
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
      window.sessionStorage.removeItem(storageKey);
    } finally {
      setHydrated(true);
    }
    // tipoInicial (de empresaTipo) es estable por montaje; la hidratación corre UNA vez
    // por storageKey y NO debe re-ejecutarse si cambiara el tipo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify({ drafts: drafts.slice(0, 3), nextDraftSeq, savedAt: Date.now() }));
  }, [drafts, hydrated, nextDraftSeq, storageKey]);

  useEffect(() => {
    if (total <= 0 || (tipoDte !== 39 && tipoDte !== 41)) {
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
    }, empresaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let vivo = true;
    obtenerUmbralReceptorClp()
      .then((u) => { if (vivo && u > 0) setUmbralReceptor(u); })
      .catch(() => { /* fallback referencial: nunca bloquear por error de red */ });
    return () => { vivo = false; };
  }, []);

  // Escape cierra el pre-vuelo (nunca a mitad de una emisión).
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !emitBusy) setConfirmOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, emitBusy]);

  // Escape cancela la autorización legal pendiente (resuelve la promesa en false).
  useEffect(() => {
    if (!legalPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setLegalPrompt(null);
      const resolve = legalResolverRef.current;
      legalResolverRef.current = null;
      resolve?.(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [legalPrompt]);

  // Autorización legal en modal propio (reemplaza el window.confirm): promesa
  // pendiente que se resuelve con el click del usuario. Solo cambia la
  // presentación — el registro (versión legal, persistencia) queda igual.
  function requestLegalAcceptance(providerLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      legalResolverRef.current?.(false);
      legalResolverRef.current = resolve;
      setLegalPrompt({ providerLabel });
    });
  }

  function resolveLegalPrompt(accepted: boolean) {
    setLegalPrompt(null);
    const resolve = legalResolverRef.current;
    legalResolverRef.current = null;
    resolve?.(accepted);
  }

  async function ensureEmissionAuthorization(provider: "sii_local" | "simpleapi"): Promise<boolean> {
    const providerLabel = provider === "sii_local" ? "SII local asistido" : "SimpleAPI";
    try {
      const params = new URLSearchParams({ provider });
      const statusRes = await fetch(`/api/emision/authorizations?${params.toString()}`);
      const statusJson = (await statusRes.json().catch(() => ({}))) as EmissionAuthorizationResponse;
      if (statusRes.ok && statusJson.ok && statusJson.authorized) return true;
      if (!statusRes.ok && statusJson.error !== "EMISSION_AUTHORIZATION_REQUIRED") {
        toast(statusJson.detalle ?? statusJson.error ?? "No se pudo revisar la autorización de emisión.", "error");
        return false;
      }

      const accepted = await requestLegalAcceptance(providerLabel);
      if (!accepted) return false;

      const res = await fetch("/api/emision/authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          tipo_dte: tipoDte,
          ui_context: "emision_directa",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as EmissionAuthorizationResponse;
      if (!res.ok || !json.ok || !json.authorized) {
        toast(json.detalle ?? json.error ?? "No se pudo registrar la autorización de emisión.", "error");
        return false;
      }
      return true;
    } catch {
      toast("Error de red al validar la autorización de emisión", "error");
      return false;
    }
  }

  async function startEmissionJob(provider: "sii_local" | "simpleapi"): Promise<EmissionJobStartResponse | null> {
    try {
      const authorized = await ensureEmissionAuthorization(provider);
      if (!authorized) return null;

      const res = await fetch("/api/emision/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          tipo_dte: tipoDte,
          origin: "emision_directa",
          expected_emisor_rut: empresaRut ?? null,
        }),
      });
      const json = (await res.json()) as EmissionJobStartResponse;
      if (!res.ok || !json.ok || !json.job_id || !json.expires_at) {
        const message = json.error === "EMISSION_AUTHORIZATION_REQUIRED"
          ? "Debes autorizar la emisión antes de continuar."
          : json.bloqueo?.mensaje ?? json.detalle ?? json.error ?? "No se pudo iniciar la emisión.";
        if (json.error === "EMISION_BLOQUEADA") {
          setEmissionLock({
            ok: true,
            locked: Boolean(json.bloqueo),
            business_mode: Boolean(json.business_mode),
            bloqueo: json.bloqueo ?? null,
          });
        }
        toast(message, "error");
        return null;
      }
      setEmissionLock({
        ok: true,
        locked: true,
        business_mode: Boolean(json.business_mode),
        bloqueo: {
          job_id: json.job_id,
          provider,
          locked_until: json.locked_until ?? json.expires_at,
          is_mine: true,
          mensaje: "Emisión iniciada desde este computador.",
        },
      });
      return json;
    } catch {
      toast("Error de red al iniciar la emisión", "error");
      return null;
    }
  }

  async function closeEmissionJob(jobId: string | null | undefined, estado: "failed" | "cancelled" | "revision_pendiente" = "cancelled") {
    if (!jobId) return;
    try {
      await fetch("/api/emision/jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        // CAJA NEGRA: adjunta el último mensaje de estado de la extensión como motivo
        // → el server lo guarda en status_message + ops_event. Así un fallo deja rastro
        // diagnosticable sin mirar la consola del navegador del usuario.
        body: JSON.stringify({ job_id: jobId, estado, status_message: lastStatusMsgRef.current ?? null }),
      });
      setEmissionLock(null);
    } catch {
      // Best-effort: si falla, el lock expira por TTL server-side.
    }
  }

  async function heartbeatEmissionJob(jobId: string | null | undefined, status: string) {
    if (!jobId) return;
    try {
      await fetch("/api/emision/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, status }),
      });
    } catch {
      // Best-effort: el lock expira por TTL si el navegador se cae.
    }
  }

  const closeEmissionJobEvent = useEffectEvent(closeEmissionJob);
  const heartbeatEmissionJobEvent = useEffectEvent(heartbeatEmissionJob);

  const persistSimpleApiResult = useEffectEvent(async (data: ExtensionPageMessage) => {
    const jobId = data.job_id ?? simpleApiJobId;
    setEmitiendo(true);
    try {
      const res = await fetch("/api/simpleapi/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          result: {
            trackId: data.trackId,
            dte: data.dte,
            dteXml: data.dteXml,
            envioXml: data.envioXml,
            envio: data.envio,
            consultaDte: data.consultaDte,
            pdf: data.pdf,
          },
          draft: {
            receptor_rut: receptorRut.trim() || null,
            receptor_razon_social: receptorRazonSocial.trim() || null,
            receptor_direccion: receptorDireccion.trim() || null,
            receptor_comuna: receptorComuna.trim() || null,
            detalle_nombre: detalleNombre.trim() || null,
            monto_total: total,
          },
        }),
      });
      const json = (await res.json()) as EmitirResponse & { already_exists?: boolean };
      if (!res.ok || !json.ok) {
        const message = json.detalle ?? json.error ?? "DTE aceptado, pero no se pudo guardar en App Contable.";
        setErrors([message]);
        setLastResult({ ok: false, error: message, proveedor: "simpleapi", estado: "aceptado_sin_persistir", track_id: String(data.trackId ?? "--"), folio: data.dte?.folio, monto_total: data.dte?.total ?? total });
        toast(message, "error");
        return;
      }
      setLastResult({ ok: true, proveedor: "simpleapi", estado: json.estado ?? "aceptado", track_id: json.track_id, folio: json.folio, monto_total: json.monto_total ?? data.dte?.total ?? total });
      toast(json.already_exists ? `DTE #${json.folio ?? "--"} ya estaba guardado.` : `DTE #${json.folio ?? "--"} emitido y guardado.`, "success");
      setSimpleApiJobId(null);
      setEmissionLock(null);
      router.refresh();
    } catch {
      const message = "DTE aceptado, pero falló la persistencia en App Contable.";
      setErrors([message]);
      setLastResult({ ok: false, error: message, proveedor: "simpleapi", estado: "aceptado_sin_persistir", track_id: String(data.trackId ?? "--"), folio: data.dte?.folio, monto_total: data.dte?.total ?? total });
      void closeEmissionJob(jobId, "failed");
      toast(message, "error");
    } finally {
      setEmitiendo(false);
    }
  });

  useEffect(() => {
    function onExtensionMessage(event: MessageEvent<ExtensionPageMessage>) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== "app-contable-extension") return;

      if (data.type === "APP_CONTABLE_SII_JOB_RESULT") {
        const folio = data.result?.folio ? ` Folio #${data.result.folio}.` : "";
        const persisted = data.result?.persisted;
        const emitted = Boolean(data.result?.folio && data.result.folio_confidence === "high" && persisted?.ok === true);
        const persistenceError = persisted?.ok === false ? ` No se guardó en la app: ${persisted.detalle ?? persisted.error ?? "error desconocido"}.` : "";
        const current = localWorkerRef.current;
        const sameJob = current?.jobId != null && current.jobId === (data.job_id ?? null);
        if (!emitted) {
          // Resultado REENTREGADO de un job que no es el de esta sesión y cuyo POST
          // falló: no pisar el estado ni bloquear Emitir por un aviso ajeno (el
          // stash de la extensión lo reintentará solo). Y un éxito terminal ya
          // mostrado no se pisa con una falla tardía del mismo job (carrera de
          // doble POST: el perdedor decía "no guardada" sobre una boleta guardada).
          if (!sameJob) return;
          if (current && (current.status === "emitted" || current.status === "already_exists")) return;
        }
        setLocalWorker({
          jobId: data.job_id ?? null,
          status: emitted ? "emitted" : "result_needs_review",
          message: emitted
            ? `${data.message ?? "Boleta emitida y guardada en la app."}${folio}`
            : `${data.message ?? "Resultado SII recibido, pero falta guardar respaldo. No se marca como emitida."}${folio}${persistenceError}`,
        });
        setLocalWorkerLoading(false);
        // LÁPIDA para la boleta ÚNICA (igual que el lote): si llegó un FOLIO pero no
        // se confirmó emitida (evidencia débil o guardado fallido), el SII PUDO
        // emitir → sellamos el job 'revision_pendiente' para BLOQUEAR la re-emisión
        // (que quemaría el folio) hasta recuperarlo. Antes el job quedaba 'running' (o
        // el server lo sellaba 'failed' vía CAPTURE_DEBUG) y la propuesta volvía a ser
        // emitible tras el TTL. Solo con folio presente: sin folio no hubo emisión.
        if (!emitted && data.result?.folio && data.job_id && !closedJobIdsRef.current.has(data.job_id)) {
          closedJobIdsRef.current.add(data.job_id);
          void closeEmissionJobEvent(data.job_id, "revision_pendiente");
        }
        toast(emitted ? `Boleta emitida y guardada.${folio}` : "Boleta SII no quedó guardada en la app", emitted ? "success" : "error");
        router.refresh();
        return;
      }

      if (data.type === "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR_RESULT") {
        setEmitiendo(false);
        if (data.ok === false) {
          const jobId = data.job_id ?? simpleApiJobId;
          void closeEmissionJobEvent(jobId, "failed");
          setSimpleApiJobId(null);
          const message = data.error === "SIMPLEAPI_VAULT_LOCKED"
            ? "Desbloquea la bóveda SimpleAPI en la extensión antes de generar."
            : data.detalle ?? data.error ?? errorFromUnknownData(data.data) ?? `SimpleAPI se detuvo en ${data.step ?? "el flujo"}.`;
          setErrors([message]);
          toast(message, "error");
          return;
        }
        void persistSimpleApiResult(data);
        return;
      }

      if (data.type !== "APP_CONTABLE_SII_JOB_STATUS") return;

      // CAJA NEGRA: recordamos el último mensaje del RPA para adjuntarlo si el job
      // termina fallido (el motivo real del fallo suele venir en el último status).
      if (data.message) lastStatusMsgRef.current = String(data.message).slice(0, 500);

      void heartbeatEmissionJobEvent(data.job_id, data.status ?? "running");
      setLocalWorker((current) => {
        // Un éxito terminal NO se pisa: tras "Boleta emitida y guardada", un
        // "closed"/"result_needs_review" tardío (cierre de la ventana SII) volvía
        // a alarmar y a bloquear el botón por una boleta que ya está guardada.
        // jobId null = éxito de un rescate manual (Recuperar): también protegido —
        // una emisión NUEVA resetea el estado directo en sendLocalSiiJob, nunca
        // por esta vía, así que acá no se bloquea nada legítimo.
        if (current && (current.status === "emitted" || current.status === "already_exists")
          && (current.jobId == null || current.jobId === (data.job_id ?? null))) {
          return current;
        }
        return {
          jobId: data.job_id ?? null,
          status: data.status ?? "error",
          message: data.message ?? "Estado recibido desde motor local SII",
        };
      });
      setLocalWorkerLoading(false);
      if ((data.status === "error" || data.status === "cancelled") && data.job_id && !closedJobIdsRef.current.has(data.job_id)) {
        // Una sola vez por job (el Set corta el bucle error→JOB_CLOSE→error que se
        // formaba cuando la extensión quedaba huérfana y el bridge respondía con
        // otro status "error" para el mismo job).
        closedJobIdsRef.current.add(data.job_id);
        void closeEmissionJobEvent(data.job_id, data.status === "cancelled" ? "cancelled" : "failed");
        // Cerrar también la ventana worker de ese job: si quedaba viva con su botón
        // "Reintentar" mientras acá se re-habilitaba Emitir, había dos cerebros
        // capaces de emitir dos boletas reales. (Post-emit la extensión la protege.)
        window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_CLOSE", protocol_version: 1, job_id: data.job_id }, window.location.origin);
        if (data.job_id === simpleApiJobId) {
          setEmitiendo(false);
          setSimpleApiJobId(null);
          toast(data.message ?? "No se pudo contactar la extensión local", "error");
        }
      }
    }

    window.addEventListener("message", onExtensionMessage);
    return () => window.removeEventListener("message", onExtensionMessage);
  }, [router, simpleApiJobId, toast, total]);

  function updateActiveDraft(patch: Partial<BoletaDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === activeDraft.id ? { ...draft, ...patch, updatedAt: Date.now() } : draft));
  }

  // OCR del comprobante de pago: solo PRE-LLENA el borrador — el usuario
  // siempre revisa y aprueba antes de emitir.
  async function leerComprobante(file: File) {
    if (!file.type.startsWith("image/")) {
      toast("El comprobante debe ser una imagen (foto o captura)", "error");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast("La imagen supera los 6 MB — usa una captura más liviana", "error");
      return;
    }
    setLeyendoComprobante(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          const coma = result.indexOf(",");
          resolve(coma >= 0 ? result.slice(coma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/ocr-comprobante", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mime: file.type }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        detalle?: string;
        campos?: { monto: number | null; fecha: string | null; glosa: string | null; pagador: string | null };
        confianza?: { monto: number; fecha: number; pagador: number };
      };
      if (!res.ok || !json.ok || !json.campos) {
        toast(json.detalle ?? json.error ?? "No pude leer el comprobante", "error");
        return;
      }

      const campos = json.campos;
      const patch: Partial<BoletaDraft> = {};
      if (campos.monto !== null && campos.monto > 0) patch.monto = String(campos.monto);
      const detalleSinTocar = !detalleNombre.trim() || detalleNombre.trim() === "Servicio prestado";
      if (campos.glosa && detalleSinTocar) patch.detalleNombre = campos.glosa.slice(0, 80);
      if (campos.pagador && !receptorRazonSocial.trim()) patch.receptorRazonSocial = campos.pagador;
      if (Object.keys(patch).length > 0) updateActiveDraft(patch);

      const resumen: string[] = [];
      if (campos.monto !== null) resumen.push(fmt(campos.monto));
      if (campos.fecha) resumen.push(`${campos.fecha.slice(8, 10)}-${campos.fecha.slice(5, 7)}`);
      if (campos.pagador) {
        const palabras = campos.pagador.split(/\s+/);
        resumen.push(palabras.length > 1 ? `${palabras[0]} ${palabras[1]?.charAt(0) ?? ""}.` : palabras[0]);
      }
      if (resumen.length === 0) {
        toast("No encontré datos en el comprobante — revisa la imagen", "error");
      } else if (campos.monto === null) {
        toast(`Leí ${resumen.join(" · ")} — no encontré el monto, ingrésalo a mano`, "error");
      } else if ((json.confianza?.monto ?? 0) < 0.6) {
        toast(`Leí ${resumen.join(" · ")} — verifica el monto antes de emitir`, "error");
      } else {
        toast(`Leí ${resumen.join(" · ")}`, "success");
      }
    } catch {
      toast("Error de red al leer el comprobante", "error");
    } finally {
      setLeyendoComprobante(false);
    }
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
      window.sessionStorage.setItem(storageKey, JSON.stringify({ drafts: nonEmptyDrafts, nextDraftSeq, savedAt: Date.now() }));
    } else {
      window.sessionStorage.removeItem(storageKey);
    }
    onClose?.(nonEmptyDrafts.length > 0);
  }

  async function handleEmitir() {
    if (!canSubmit) return;
    setEmitiendo(true);
    setErrors([]);
    setLastResult(null);

    // ── MESA FACTURA: dos pasos por el carril del lote, cero lógica propia ──
    // /factura-unica crea documento→movimiento→propuesta (nace aprobada:
    // tipearla ES el gesto) y /emitir-lote emite con los mismos gates de
    // cuota, locks y anti-doble-emisión del masivo.
    if (mesaFactura) {
      try {
        const crear = await fetch("/api/intermediaria/factura-unica", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receptor_rut: receptorRut.trim(),
            razon_social: receptorRazonSocial.trim(),
            giro: receptorGiro.trim(),
            direccion: receptorDireccion.trim(),
            comuna: receptorComuna.trim(),
            email: receptorEmail.trim() || undefined,
            detalle: detalleNombre.trim(),
            total,
          }),
        });
        const creada = await crear.json().catch(() => null);
        if (!creada?.ok) {
          const msg = creada?.detalle ?? "No se pudo preparar la factura";
          setErrors([msg]);
          toast(msg, "error");
          return;
        }
        const emitirRes = await fetch("/api/intermediaria/emitir-lote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propuesta_ids: [creada.propuesta_id],
            forma_pago_lote: formaPago === "Contado" ? "contado" : "credito",
          }),
        });
        const r = await emitirRes.json().catch(() => null);
        const item = r?.resultados?.[0];
        if (!r?.ok || !item?.ok) {
          const msg = item?.error_message ?? r?.detalle ?? "No se pudo emitir la factura";
          setErrors([msg]);
          toast(msg, "error");
          return;
        }
        setLastResult({ ok: true, folio: item.folio ?? null, monto_total: item.monto_total ?? total, proveedor: "mock", sandbox: true });
        toast(`Factura simulada: folio #${item.folio ?? "--"} por ${fmt(item.monto_total ?? total)}. No se informó al SII.`);
        setDrafts((current) => {
          if (current.length <= 1) {
            const draft = { ...newDraftForOpenSlot(tipoInicial, [], nextDraftSeq), formaPago: "" as FormaPago };
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
        setErrors(["Error de red al emitir la factura"]);
        toast("Error de red al emitir la factura", "error");
      } finally {
        setEmitiendo(false);
      }
      return;
    }

    try {
      const body = {
        tipo_dte: tipoDte,
        receptor_rut: receptorRut.trim() || undefined,
        receptor_razon_social: receptorRazonSocial.trim() || undefined,
        receptor_direccion: receptorDireccion.trim() || undefined,
        receptor_comuna: receptorComuna.trim() || undefined,
        // El formulario ya captura forma de pago — se registra como medio de
        // pago (obligatorio sobre 135 UF, Res. Ex. SII 44/2025).
        medio_pago: formaPago,
        detalles: [{ nombre: detalleNombre.trim().slice(0, 80), monto: total }],
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
      if (json.proveedor === "mock") {
        toast(`DTE simulado: folio #${json.folio ?? "--"} por ${fmt(json.monto_total ?? total)}. No se informó al SII.`);
      } else {
        toast(`DTE emitido: folio #${json.folio ?? "--"} por ${fmt(json.monto_total ?? total)} (SII local)`);
      }
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

  function buildSimpleApiInput(reservedFolio?: number | null) {
    const neto = tipoDte === 33 ? Math.round(total / 1.19) : total;
    const iva = tipoDte === 33 ? total - neto : 0;
    const folio = Number.isSafeInteger(reservedFolio) && Number(reservedFolio) > 0 ? Number(reservedFolio) : undefined;
    return JSON.stringify({
      Documento: {
        Encabezado: {
          IdentificacionDTE: {
            TipoDTE: tipoDte,
            ...(folio ? { Folio: folio } : {}),
            FechaEmision: chileTodayString(),
            FormaPago: 1,
          },
          Emisor: {
            Rut: empresaRut || "",
            RazonSocial: empresaRazonSocial || "RAZON SOCIAL",
            Giro: empresaGiro || "GIRO",
            DireccionOrigen: empresaDireccion || "DIRECCION",
            ComunaOrigen: empresaComuna || "COMUNA",
            Telefono: [],
          },
          Receptor: {
            Rut: receptorRut.trim() || "66666666-6",
            RazonSocial: receptorRazonSocial.trim() || "Cliente sin identificar",
            Direccion: receptorDireccion.trim() || "Direccion receptor",
            Comuna: receptorComuna.trim() || "Comuna receptor",
            Giro: "Giro receptor",
          },
          Totales: tipoDte === 33
            ? { MontoNeto: neto, TasaIVA: 19, IVA: iva, MontoTotal: total }
            : { MontoExento: total, MontoTotal: total },
        },
        Detalles: [{
          IndicadorExento: tipoDte === 34 ? 1 : 0,
          Nombre: detalleNombre.trim().slice(0, 80),
          Cantidad: 1,
          UnidadMedida: "un",
          Precio: tipoDte === 33 ? neto : total,
          MontoItem: tipoDte === 33 ? neto : total,
        }],
        Referencias: [],
      },
    });
  }

  async function sendSimpleApiGenerar() {
    setEmitiendo(true);
    setErrors([]);
    setLastResult(null);
    const job = await startEmissionJob("simpleapi");
    if (!job?.job_id) {
      setEmitiendo(false);
      return;
    }
    setSimpleApiJobId(job.job_id);
    void heartbeatEmissionJob(job.job_id, "submitting");
    window.postMessage({
      source: "app-contable",
      type: "APP_CONTABLE_SIMPLEAPI_DTE_EMITIR",
      protocol_version: 1,
      job_id: job.job_id,
      reserved_folio: job.reserved_folio ?? null,
      reserved_tipo_dte: job.reserved_tipo_dte ?? null,
      expires_at: job.expires_at,
      input: buildSimpleApiInput(job.reserved_folio),
    }, window.location.origin);
  }

  async function sendLocalSiiJob() {
    setLocalWorkerLoading(true);
    setLocalWorker({ jobId: null, status: "opening_sii", message: "Preparando bloqueo de emisión..." });
    const job = await startEmissionJob("sii_local");
    if (!job?.job_id || !job.expires_at) {
      setLocalWorkerLoading(false);
      setLocalWorker(null);
      return;
    }

    setLocalWorker({ jobId: job.job_id, status: "opening_sii", message: "Abriendo ventana segura SII..." });
    void heartbeatEmissionJob(job.job_id, "opening_sii");

    window.postMessage({
      source: "app-contable",
      type: "APP_CONTABLE_SII_BOLETA_JOB",
      protocol_version: 1,
      job: {
        job_id: job.job_id,
        expires_at: job.expires_at,
        empresa_id: job.empresa_id ?? empresaId ?? "default",
        // El worker verifica que el portal tenga seleccionado este emisor
        // antes de emitir (cuentas SII multi-empresa).
        emisor_rut: job.expected_emisor_rut ?? empresaRut ?? undefined,
        tipo_dte: tipoDte,
        fecha_emision: chileTodayString(),
        receptor: {
          rut: receptorRut.trim() || undefined,
          razon_social: receptorRazonSocial.trim() || undefined,
          direccion: receptorDireccion.trim() || undefined,
          comuna: receptorComuna.trim() || undefined,
          email: receptorEmail.trim() || undefined,
          telefono: receptorTelefono.trim() || undefined,
        },
        detalles: [{ nombre: detalleNombre.trim().slice(0, 80), cantidad: 1, monto_total: total }],
        totales: {
          monto_total: total,
          monto_neto: tipoDte === 39 ? Math.round(total / 1.19) : 0,
          iva: tipoDte === 39 ? total - Math.round(total / 1.19) : 0,
          monto_exento: tipoDte === 41 ? total : 0,
        },
        // Glosa que se imprime en la boleta del SII (campo Detalle, máx 80).
        // En boleta única usamos el detalle que escribió el usuario.
        glosa: detalleNombre.trim().slice(0, 80),
        learn_only: false,
        auto_emit: true,
        allow_final_emit: true,
        payment_method: formaPago,
        confirmation_required: false,
        // Boleta única: al terminar, cerrar sesión SII + cerrar la ventana
        // (no dejar la sesión abierta). En massdte por lote esto va en false.
        logout_after: true,
      },
    }, window.location.origin);
  }

  async function persistVisibleSiiFolio() {
    const folio = Number(manualSiiFolio.replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(folio) || folio <= 0) {
      toast("Ingresa el folio visible en SII", "error");
      return;
    }
    // El panel ahora es alcanzable con el borrador vacío: sin monto, el POST se iba
    // con total=0, el server lo rechazaba con 422 y de paso cerraba el job vivo y
    // soltaba el lock (review). Pedir el monto ANTES de tocar nada.
    if (total <= 0) {
      toast("Escribe también el monto de la boleta emitida (el mismo que emitiste) antes de guardar el folio.", "error");
      return;
    }
    if (!localWorker?.jobId) {
      // JAMÁS sugerir "iniciar una emisión" para rescatar un folio: eso emite una
      // SEGUNDA boleta real (auditoría: crítico). La salida sin job es el botón de
      // arriba, que no necesita emisión activa.
      toast("No hay una emisión activa para asociar este folio. Usa «Guardar último PDF SII» (funciona sin emisión activa). No vuelvas a emitir la boleta.", "error");
      return;
    }

    setLocalWorkerLoading(true);
    try {
      const res = await fetch("/api/sii-local/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: localWorker.jobId,
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
            detalles: [{ nombre: detalleNombre.trim().slice(0, 80), cantidad: 1, monto_total: total }],
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
    // SIN exigir job vivo: el server soporta recover_latest con job_id null
    // (resuelve el último resultado SII del usuario y hace backfill idempotente).
    // El gate anterior exigía un jobId que muere al recargar la página — justo el
    // escenario donde se necesita rescate — y su error inducía a re-emitir.
    setLocalWorkerLoading(true);
    try {
      const res = await fetch("/api/sii-local/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: localWorker?.jobId ?? null, recover_latest: true }),
      });
      const json = (await res.json()) as { ok?: boolean; folio?: number; boleta_id?: string; error?: string; detalle?: string; already_exists?: boolean };
      if (!res.ok || !json.ok) {
        toast(json.error === "SIN_RESULTADO_SII_RECUPERABLE"
          ? "No encontré ninguna boleta SII pendiente de rescatar (últimas 24 horas). Si la ventana del SII no mostró un folio, no se emitió nada."
          : json.detalle ?? json.error ?? "No se pudo guardar el PDF SII detectado", "error");
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

  // Cancela una emisión SII pegada en estado PRE-emisión: cierra el job en el
  // server (libera el lock YA — antes solo se limpiaba el estado local y el botón
  // pasaba a "Emisión en curso" hasta 15 minutos) y pide a la extensión cerrar la
  // ventana worker (sin esto quedaban dos cerebros: "Reintentar" allá + "Emitir"
  // acá = dos boletas reales). Solo se ofrece para RESET_SAFE_STATUSES.
  function resetStuckSiiEmission() {
    const jobId = localWorker?.jobId ?? null;
    void closeEmissionJob(jobId, "cancelled");
    if (jobId) {
      window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_CLOSE", protocol_version: 1, job_id: jobId }, window.location.origin);
    }
    setLocalWorker(null);
    setLocalWorkerLoading(false);
  }

  // Cancela TU PROPIO candado pegado de un job anterior (myStaleLock): el job cuyo
  // lock quedó tomado ya no es el actual en vuelo (el modal se remonteó, localWorker
  // es null), así que se cierra por el job_id del propio lock. Libera el lock al toque
  // y cierra la ventana worker que haya quedado — sin esperar el TTL de 15 min.
  async function cancelStaleLock() {
    const jobId = activeEmissionLock?.job_id ?? null;
    if (jobId) {
      await closeEmissionJob(jobId, "cancelled");
      window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_CLOSE", protocol_version: 1, job_id: jobId }, window.location.origin);
    }
    setLocalWorker(null);
    setLocalWorkerLoading(false);
  }

  function openLocalSiiWorker() {
    if (!canSubmit || localWorkerLoading) return;

    setLocalWorkerLoading(true);
    if (extensionStatus !== "ready") setExtensionStatus("checking");
    // SIEMPRE re-ping antes de despachar: además de detectar presencia, el PONG
    // trae la versión — bajo el piso NO se emite (banner con cómo actualizar).
    pingLocalSiiExtension((message) => {
      if (!message) {
        setExtensionStatus("missing");
        setLocalWorkerLoading(false);
        toast("No encuentro la extensión del SII. Instálala desde Empresa → Configuración de emisión.", "error");
        return;
      }
      setExtensionStatus("ready");
      if (extensionDesactualizada(message.extension_version)) {
        setLocalWorkerLoading(false);
        toast(mensajeExtensionDesactualizada(message.extension_version), "error");
        return;
      }
      void sendLocalSiiJob();
    }, empresaId);
  }

  // Confirmación SIEMPRE antes de emitir: primera vez modal legal → pre-vuelo;
  // después, solo pre-vuelo. La mecánica posterior (jobs RPA, locks, folios)
  // no cambia: al confirmar se despacha por el mismo carril de siempre.
  async function handlePrimaryEmit() {
    if (primaryDisabled || confirmOpen) return;
    if (usesSimpleApi && extensionStatus !== "ready") {
      toast("Instala o activa la extensión del SII desde Empresa → Configuración de emisión.", "error");
      return;
    }
    if (usesSiiLocal || usesSimpleApi) {
      const authorized = await ensureEmissionAuthorization(usesSiiLocal ? "sii_local" : "simpleapi");
      if (!authorized) return;
    }
    setConfirmOpen(true);
  }

  function confirmPrimaryEmit() {
    if (emitBusy) return;
    setConfirmOpen(false);
    if (usesSiiLocal) {
      openLocalSiiWorker();
      return;
    }
    if (usesSimpleApi) {
      void sendSimpleApiGenerar();
      return;
    }
    void handleEmitir();
  }

  return (
    // maxHeight + minHeight:0 auto-limitan el modal a 92vh: el .ed-panel padre usa max-height
    // sin height definido (para que asomen las pestañas laterales necesita overflow:visible), así
    // que height:100% no resolvía y el contenido se DERRAMABA por abajo (Emitir se salía del cuadro).
    // Con el root acotado, el .ed-body (flex:1 + overflowY:auto) scrollea adentro y nada se sale.
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxHeight: "92vh", minHeight: 0, position: "relative" }}>
      <style>{`
        .ed-shell{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:12px;align-items:start}
        .ed-card{border:1px solid var(--border);background:var(--bg-muted);border-radius:12px;padding:10px}
        .ed-card-quiet{border:1px solid var(--border);background:transparent;border-radius:12px;padding:10px}
        .ed-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .ed-grid-detail{display:grid;grid-template-columns:1.35fr .75fr;gap:8px}
        .ed-label{font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
        .ed-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;border:1px solid var(--border);padding:4px 7px;font-size:9px;font-weight:700;color:var(--text2);background:var(--bg-muted)}
        .ed-draft-tabs{position:absolute;left:-42px;top:96px;bottom:12px;width:42px;display:flex;flex-direction:column;align-items:center;gap:74px;padding-top:8px;pointer-events:none;z-index:6}
        .ed-draft-tab{width:92px;height:30px;display:flex;align-items:center;justify-content:center;gap:6px;padding:5px 8px;border-radius:10px 10px 0 0;border:1px solid var(--border);border-bottom-color:transparent;background:var(--surface);color:var(--text2);font-size:9px;font-weight:800;cursor:pointer;white-space:nowrap;transform:rotate(-90deg);transform-origin:center;box-shadow:-8px 10px 24px rgba(0,0,0,.24);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);pointer-events:auto}
        .ed-draft-tab.active{border-color:rgba(232,85,62,.45);background:rgba(232,85,62,.11);color:#E8553E}
        .ed-draft-close{width:16px;height:16px;border-radius:999px;border:none;background:var(--border);color:currentColor;display:grid;place-items:center;cursor:pointer;font-size:11px;line-height:1}
        .ed-dup-item{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border-radius:9px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.16);color:var(--amber);font-size:9px;cursor:help}
        .ed-dup-tip{position:absolute;right:0;bottom:calc(100% + 8px);width:230px;padding:10px;border-radius:11px;background:var(--surface);border:1px solid rgba(245,158,11,.24);box-shadow:0 18px 46px rgba(0,0,0,.38);color:var(--text);opacity:0;transform:translateY(4px);pointer-events:none;transition:opacity .15s ease,transform .15s ease;z-index:5}
        .ed-dup-item:hover .ed-dup-tip{opacity:1;transform:translateY(0)}
        .ed-type-button{min-height:44px;padding:8px;border-radius:10px;border:1px solid var(--border);cursor:pointer;text-align:left;transition:border-color .18s ease,background .18s ease,opacity .18s ease}
        .ed-type-button:disabled{cursor:not-allowed}
        .ed-sidebar{display:flex;flex-direction:column;gap:8px;min-height:0}
        @media (max-width: 720px){.ed-draft-tabs{position:static;width:auto;display:flex;flex-direction:row;gap:5px;padding:8px 18px;border-bottom:1px solid var(--border);background:var(--surface);overflow-x:auto}.ed-draft-tab{transform:none;width:auto}.ed-shell{grid-template-columns:1fr;height:auto}.ed-grid-2,.ed-grid-detail{grid-template-columns:1fr}.ed-sidebar{order:-1}.ed-body{overflow:auto!important}}
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
          <h2 style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>{mesaFactura ? "Factura única" : "Emisión Directa"}</h2>
          <p style={{ fontSize: 10, color: "var(--text2)", marginTop: 1 }}>Emite o genera un DTE manual cuando no viene desde una carga masiva.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <span style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tipo actual</span>
          <strong style={{ fontSize: 12, color: typeColor }}>{documentKindLabel} {typeLabel}</strong>
        </div>
      </div>

      <div className="ed-draft-tabs" aria-label={mesaFactura ? "Facturas pendientes" : "Boletas pendientes"}>
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
                background: active ? draftColor.bg : "var(--surface)",
                color: active ? draftColor.fg : "var(--text2)",
                boxShadow: active ? `-8px 10px 24px rgba(0,0,0,.24), inset 0 0 0 1px ${draftColor.border}` : undefined,
              }}
            >
              <span>DTE {draft.slot}</span>
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

      <div className="ed-body" style={{ flex: 1, minHeight: 0, padding: "12px 18px", overflowY: "auto", overflowX: "hidden" }}>
        <div className="ed-shell">
          <main style={{ display: "flex", flexDirection: "column", gap: 9, minHeight: 0 }}>
            <section className="ed-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <div>
                  <span className="ed-label" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    1. Tipo de documento
                    <TermHint width={258}>
                      <strong>Afecta</strong> = la venta incluye IVA (19%), lo normal en el comercio.
                      <br /><strong>Exenta</strong> = sin IVA: compraventa de cripto y divisas (P2P), y ciertos servicios.
                      <br />Las boletas se emiten en el portal SII; las facturas, vía SimpleAPI.
                    </TermHint>
                  </span>
                <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Cripto y divisas van como exenta; el comercio con IVA, como afecta.</p>
                </div>
                {hasEmpresaLock && (
                  <button
                    onClick={() => setTipoDesbloqueado((v) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 34, padding: "6px 10px", borderRadius: 999, border: "1px solid var(--border)", background: tipoDesbloqueado ? "rgba(245,158,11,.1)" : "var(--surface)", color: tipoDesbloqueado ? "var(--amber)" : "var(--text2)", cursor: "pointer", fontSize: 9, fontWeight: 700 }}
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
                {mesaFactura ? (
                  <>
                    <button className="ed-type-button" onClick={() => setTipo(33)} disabled={tipoLocked} style={{ borderColor: tipoDte === 33 ? "rgba(232,85,62,.45)" : "var(--border)", background: tipoDte === 33 ? "var(--accent-light)" : "var(--surface)", color: tipoDte === 33 ? "#E8553E" : "var(--text2)", opacity: tipoLocked && tipoDte !== 33 ? 0.45 : 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>Factura afecta</div>
                      <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 33 · IVA incluido</div>
                    </button>
                    <button className="ed-type-button" onClick={() => setTipo(34)} disabled={tipoLocked} style={{ borderColor: tipoDte === 34 ? "rgba(91,156,246,.45)" : "var(--border)", background: tipoDte === 34 ? "rgba(91,156,246,.12)" : "var(--surface)", color: tipoDte === 34 ? "var(--blue)" : "var(--text2)", opacity: tipoLocked && tipoDte !== 34 ? 0.45 : 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>Factura exenta</div>
                      <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 34 · Sin IVA</div>
                    </button>
                  </>
                ) : (<>
                <button className="ed-type-button" onClick={() => setTipo(39)} disabled={tipoLocked} style={{ borderColor: tipoDte === 39 ? "rgba(232,85,62,.45)" : "var(--border)", background: tipoDte === 39 ? "var(--accent-light)" : "var(--surface)", color: tipoDte === 39 ? "#E8553E" : "var(--text2)", opacity: tipoLocked && tipoDte !== 39 ? 0.45 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>Boleta afecta</div>
                  <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 39 · IVA incluido</div>
                </button>
                <button className="ed-type-button" onClick={() => setTipo(41)} disabled={tipoLocked} style={{ borderColor: tipoDte === 41 ? "rgba(91,156,246,.45)" : "var(--border)", background: tipoDte === 41 ? "rgba(91,156,246,.12)" : "var(--surface)", color: tipoDte === 41 ? "var(--blue)" : "var(--text2)", opacity: tipoLocked && tipoDte !== 41 ? 0.45 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>Boleta exenta</div>
                  <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 41 · Sin IVA</div>
                </button>
                </>)}
                {/* Facturas solo en dev (founder 2026-07-04): carril sin pulir, no se ofrece. */}
                {!mesaFactura && facturasProveedor === "simpleapi" && devMode && (
                  <>
                    <button className="ed-type-button" onClick={() => setTipo(33)} disabled={tipoLocked} style={{ borderColor: tipoDte === 33 ? "rgba(232,85,62,.45)" : "var(--border)", background: tipoDte === 33 ? "var(--accent-light)" : "var(--surface)", color: tipoDte === 33 ? "#E8553E" : "var(--text2)", opacity: tipoLocked && tipoDte !== 33 ? 0.45 : 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>Factura afecta</div>
                      <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 33 · Generar con SimpleAPI</div>
                    </button>
                    <button className="ed-type-button" onClick={() => setTipo(34)} disabled={tipoLocked} style={{ borderColor: tipoDte === 34 ? "rgba(91,156,246,.45)" : "var(--border)", background: tipoDte === 34 ? "rgba(91,156,246,.12)" : "var(--surface)", color: tipoDte === 34 ? "var(--blue)" : "var(--text2)", opacity: tipoLocked && tipoDte !== 34 ? 0.45 : 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>Factura exenta</div>
                      <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>DTE 34 · Generar con SimpleAPI</div>
                    </button>
                  </>
                )}
              </div>

              {tipoLocked && (
                <p style={{ fontSize: 9, color: "var(--text3)", marginTop: 8 }}>Tipo fijado por configuración de empresa: {isExento ? "exenta" : "afecta"}.</p>
              )}
            </section>

            <section className="ed-card-quiet">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <div>
                  <span className="ed-label">2. Receptor</span>
                  <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Datos opcionales del cliente cuando correspondan.</p>
                </div>
                <button
                  type="button"
                  onClick={() => comprobanteInputRef.current?.click()}
                  disabled={leyendoComprobante}
                  title="Sube la foto o captura del comprobante de pago para pre-llenar monto y receptor"
                  style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 34, padding: "6px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", cursor: leyendoComprobante ? "wait" : "pointer", fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, opacity: leyendoComprobante ? 0.55 : 1 }}
                >
                  {leyendoComprobante ? "Leyendo..." : "Leer comprobante 📷"}
                </button>
                <input
                  ref={comprobanteInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void leerComprobante(file);
                  }}
                />
              </div>
              {/* Espejo EXACTO del formulario e-Boleta del SII: los mismos campos que
                  el SII deja llenar del receptor (RUT, Nombre, Dirección, E-mail,
                  Teléfono), todos opcionales. Lo que llenes lo escribe el robot en el
                  SII; lo que dejes vacío, queda vacío. Sobre 135 UF, RUT+Nombre pasan a
                  obligatorios (Res. 44/2025). (No hay "Comuna": el e-Boleta no la tiene.) */}
              <div className="ed-grid-2">
                <Field label="RUT receptor" value={receptorRut} onChange={(value) => updateActiveDraft({ receptorRut: value })} placeholder={mesaFactura ? "Obligatorio" : "Opcional (obligatorio sobre 135 UF)"} />
                <Field label={mesaFactura ? "Razón social" : "Nombre"} value={receptorRazonSocial} onChange={(value) => updateActiveDraft({ receptorRazonSocial: value })} placeholder={mesaFactura ? "Obligatoria" : "Cliente o consumidor"} />
                {mesaFactura && <Field label="Giro" value={receptorGiro} onChange={(value) => updateActiveDraft({ receptorGiro: value })} placeholder="Obligatorio" />}
                <Field label="Dirección" value={receptorDireccion} onChange={(value) => updateActiveDraft({ receptorDireccion: value })} placeholder={mesaFactura ? "Obligatoria" : "Opcional"} />
                {mesaFactura && <Field label="Comuna" value={receptorComuna} onChange={(value) => updateActiveDraft({ receptorComuna: value })} placeholder="Obligatoria" />}
                <Field label="E-mail" value={receptorEmail} onChange={(value) => updateActiveDraft({ receptorEmail: value })} placeholder={mesaFactura ? "Opcional (para enviarle la factura)" : "Opcional (para enviarle la boleta)"} />
                <Field label="Teléfono" value={receptorTelefono} onChange={(value) => updateActiveDraft({ receptorTelefono: value })} placeholder="Opcional" />
                {mesaFactura && facturaFaltantes.length > 0 && (
                  <p style={{ gridColumn: "1 / -1", fontSize: 9.5, color: "var(--amber)", margin: 0 }}>La factura individualiza a su receptor: falta {facturaFaltantes.join(", ")}.</p>
                )}
              </div>
              {rutReceptorInvalido && (
                <p style={{ fontSize: 9, color: "var(--red)", marginTop: 7 }}>
                  El RUT del receptor no es válido — revisa el dígito verificador o déjalo vacío.
                </p>
              )}
              {!rutReceptorInvalido && receptorNombrePendiente && (
                <p style={{ fontSize: 9, color: "var(--amber)", marginTop: 7, lineHeight: 1.45 }}>
                  Pusiste un RUT: indica también el <strong>nombre</strong>. El SII lo exige si el RUT no está registrado (o deja el RUT vacío para consumidor final).
                </p>
              )}
              {receptorObligatorioPendiente ? (
                <div style={{ marginTop: 7, padding: "8px 10px", borderRadius: 9, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "var(--amber)", fontSize: 9.5, lineHeight: 1.45 }}>
                  Sobre ~{fmt(umbralReceptor)} necesitas identificar al receptor (RUT y nombre) — Res. 44/2025.
                </div>
              ) : total > 0 ? (
                <p style={{ marginTop: 7, fontSize: 9, color: "var(--text3)", lineHeight: 1.45 }}>
                  Para este monto el receptor es <strong style={{ color: "var(--text2)" }}>consumidor final</strong>: identificarlo es opcional (bajo ~{fmt(umbralReceptor)}, Res. 44/2025).
                </p>
              ) : null}
            </section>

            <section className="ed-card-quiet">
              <div style={{ marginBottom: 8 }}>
                <span className="ed-label">3. Detalle y monto</span>
                <p style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>Un concepto por emisión directa.</p>
              </div>
              <div className="ed-grid-detail">
                <Field label="Detalle" value={detalleNombre} onChange={(value) => updateActiveDraft({ detalleNombre: value })} placeholder="Servicio prestado" maxLength={80} />
                <Field label={tipoDte === 39 || tipoDte === 33 ? "Total bruto" : "Total exento"} value={monto} onChange={(value) => updateActiveDraft({ monto: value })} placeholder="$0" inputMode="numeric" />
              </div>
              {mesaFactura ? (
                <div style={{ marginTop: 8 }}>
                  <span style={{ display: "block", fontSize: 9, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Forma de pago</span>
                  <div className="ed-grid-2">
                    {(["Contado", "Crédito"] as const).map((fp) => (
                      <button key={fp} type="button" className="ed-type-button" onClick={() => updateActiveDraft({ formaPago: fp })}
                        style={{ borderColor: formaPago === fp ? "rgba(201,242,75,.5)" : "var(--border)", background: formaPago === fp ? "rgba(201,242,75,.08)" : "var(--surface)", color: formaPago === fp ? "var(--lime)" : "var(--text2)" }}>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{fp}</div>
                        <div style={{ fontSize: 9, marginTop: 3, color: "var(--text2)" }}>{fp === "Contado" ? "La prestación ya está pagada" : "Por pagar"}</div>
                      </button>
                    ))}
                  </div>
                  {!facturaFormaPagoElegida && <p style={{ fontSize: 9.5, color: "var(--text3)", marginTop: 5 }}>Sin selección previa a propósito: tú decides cómo fue la operación.</p>}
                </div>
              ) : (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Método de pago</span>
                <select value={formaPago} onChange={(e) => updateActiveDraft({ formaPago: e.target.value as FormaPago })}
                  style={{ width: "100%", height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", padding: "0 9px", fontSize: 11, outline: "none" }}>
                  {FORMAS_PAGO.map((fp) => <option key={fp} value={fp}>{fp}</option>)}
                </select>
              </label>
              )}
            </section>
          </main>

          <aside className="ed-sidebar">
            <div className="ed-card" style={{ padding: 12 }}>
              <span className="ed-label">Resumen</span>
              <div style={{ fontSize: 22, color: "var(--text)", fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", marginTop: 6 }}>{fmt(total)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9, fontSize: 10, color: "var(--text2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>Documento</span><strong style={{ color: "var(--text)" }}>DTE {tipoDte}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>Tipo</span><strong style={{ color: typeColor }}>{documentKindLabel} {typeLabel}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>IVA</span><strong style={{ color: "var(--text)" }}>{tipoDte === 39 || tipoDte === 33 ? "Incluido" : "No aplica"}</strong></div>
              </div>
            </div>

            <div style={{ padding: 11, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: 9.5, lineHeight: 1.5 }}>
              <span className="ed-label">Importante</span>
              <div style={{ marginTop: 4 }}>
                La boleta documenta tu <strong style={{ color: "var(--text)" }}>ingreso</strong> ante el SII. <strong style={{ color: "var(--text)" }}>No</strong> es tu declaración de renta: ese impuesto se declara aparte (F22) y se paga sobre la <strong style={{ color: "var(--text)" }}>ganancia</strong> (precio de venta − costo), no sobre el total.
              </div>
            </div>

            {lockBlocksEmission && activeEmissionLock && (usesSiiLocal || usesSimpleApi) && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "var(--amber)", fontSize: 10, lineHeight: 1.45 }}>
                <span className="ed-label" style={{ color: "var(--amber)" }}>{emissionLock?.business_mode ? "Equipo" : "Emisión en curso"}</span><br />
                {activeEmissionLock.mensaje ?? "Otra persona de tu cuenta está emitiendo. Intenta nuevamente cuando termine."}
              </div>
            )}

            {/* Tu propio candado pegado de un intento anterior (no bloquea a nadie más):
                un click lo cancela y podés emitir de nuevo — sin esperar el TTL. */}
            {myStaleLock && !lockBlocksEmission && (usesSiiLocal || usesSimpleApi) && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "var(--amber)", fontSize: 10, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <span className="ed-label" style={{ color: "var(--amber)" }}>Emisión anterior pegada</span><br />
                  Quedó un intento tuyo sin cerrar. Si viste un folio en el SII, usá <strong>Recuperar emisión SII</strong> (abajo) en vez de re-emitir. Si no salió nada, cancélalo y emite de nuevo.
                </div>
                <button type="button" onClick={() => { void cancelStaleLock(); }}
                  style={{ alignSelf: "flex-start", height: 30, borderRadius: 8, border: "1px solid rgba(245,158,11,.4)", background: "rgba(245,158,11,.12)", color: "var(--amber)", padding: "0 12px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>
                  Cancelar y emitir de nuevo
                </button>
              </div>
            )}

            {usesSiiLocal && (
              <div style={{ padding: 11, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <span className="ed-label">SII local</span>
                  <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 3 }}>Se abre e-Boleta en una ventana segura. No usa backend para emitir.</div>
                </div>
                {localWorker && (
                  <div style={{ padding: 8, borderRadius: 9, background: "rgba(232,85,62,.08)", border: "1px solid rgba(232,85,62,.16)", color: "var(--text2)", fontSize: 9, lineHeight: 1.4 }}>
                    <strong style={{ color: "#E8553E" }}>{WORKER_STATUS_LABELS[localWorker.status] ?? "Procesando…"}</strong><br />{localWorker.message}
                  </div>
                )}
                {extensionStatus === "missing" && (
                  <div style={{ fontSize: 9, color: "var(--red)", lineHeight: 1.4 }}>
                    No encuentro la extensión del SII en este navegador. Instálala o actívala desde <strong>Empresa → Configuración de emisión</strong> (ahí están los pasos), y vuelve a intentar.
                  </div>
                )}
                {/* Siempre visible (antes exigía total>0: tras recargar la página el
                    borrador muere, total=0, y el rescate desaparecía justo cuando
                    más se necesitaba — auditoría: crítico). */}
                <details style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <summary style={{ cursor: "pointer", fontSize: 9, fontWeight: 800, color: "var(--text)" }}>
                      Recuperar emisión SII
                    </summary>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 7 }}>
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
                </details>
              </div>
            )}

            {usesSimpleApi && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(91,156,246,.08)", border: "1px solid rgba(91,156,246,.18)", color: "var(--text2)", fontSize: 9, lineHeight: 1.4 }}>
                <span className="ed-label" style={{ color: "var(--blue)" }}>SimpleAPI</span><br />Emite con bóveda local desbloqueada. Se marca como emitido sólo si hay aceptación SII, PDF y guardado en App Contable.
              </div>
            )}

            {tipoDiferenteEmpresa && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.18)", color: "var(--amber)", fontSize: 10, lineHeight: 1.45 }}>
                Estás emitiendo un DTE distinto al tipo configurado para la empresa. Úsalo solo si la operación corresponde tributariamente.
              </div>
            )}

            {(duplicateLoading || duplicateCandidates.length > 0) && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(245,158,11,.06)", border: "1px solid rgba(245,158,11,.16)", display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span className="ed-label" style={{ color: "var(--amber)" }}>Posible duplicado</span>
                  <span style={{ fontSize: 9, color: "var(--amber)", fontWeight: 800 }}>{duplicateLoading ? "Buscando..." : `${duplicateCandidates.length} opción${duplicateCandidates.length !== 1 ? "es" : ""}`}</span>
                </div>
                {duplicateCandidates.map((candidate) => (
                  <div key={candidate.id} className="ed-dup-item">
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{candidate.folio ?? "--"} · {fmt(candidate.monto_total)}</span>
                    <span style={{ fontWeight: 900 }}>Ver</span>
                    <div className="ed-dup-tip">
                      <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text)", marginBottom: 6 }}>Boleta #{candidate.folio ?? "--"}</div>
                      <DupRow label="Fecha" value={candidate.fecha_emision} />
                      <DupRow label="Tipo" value={candidate.tipo_dte === 39 ? "Afecta" : "Exenta"} />
                      <DupRow label="Receptor" value={candidate.receptor_razon_social ?? candidate.receptor_rut ?? "Sin receptor"} />
                      <DupRow label="Monto" value={fmt(candidate.monto_total)} />
                      <DupRow label="Detalle" value={candidate.detalle || "Sin detalle"} />
                      <div style={{ marginTop: 6, color: "var(--amber)", fontSize: 9, lineHeight: 1.35 }}>{candidate.motivos.join(" · ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {errors.length > 0 && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.18)", color: "var(--red)", fontSize: 10, lineHeight: 1.5 }}>
                {errors.map((error) => <div key={error}>{error}</div>)}
              </div>
            )}

            {lastResult && (
              <div style={{ padding: 11, borderRadius: 12, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.18)", color: "var(--green)", fontSize: 10, lineHeight: 1.5 }}>
                {lastResult.proveedor === "simpleapi" ? lastResult.ok ? "Emitido y guardado" : "Aceptado sin guardar" : lastResult.proveedor === "mock" ? "Simulado" : "Emitido"} folio #{lastResult.folio ?? "--"}<br />Track {lastResult.track_id ?? "--"}
                {lastResult.proveedor === "mock" && <><br />Documento de prueba, sin validez tributaria real.</>}
                {lastResult.proveedor === "simpleapi" && lastResult.ok && <><br />Aceptación SII, PDF oficial y respaldo guardados.</>}
                {lastResult.proveedor === "simpleapi" && !lastResult.ok && <><br />No se marca como emitido en App Contable.</>}
              </div>
            )}

            <div style={{ padding: 11, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 10, color: "var(--text2)", lineHeight: 1.5 }}>
              La carga masiva sigue en <strong style={{ color: "var(--text)" }}>Subir documento</strong>. Este modal es solo para un DTE manual.
            </div>

            <div style={{ marginTop: "auto", paddingTop: 2 }}>
              {siiWorkerPendiente ? (
                RESET_SAFE_STATUSES.has(localWorker?.status ?? "") ? (
                  <div style={{ marginBottom: 7, fontSize: 9, color: "var(--amber)", textAlign: "center", lineHeight: 1.55 }}>
                    Emisión SII en curso: {WORKER_STATUS_LABELS[localWorker?.status ?? ""] ?? "procesando"}. ¿Quedó pegada?{" "}
                    <button type="button" onClick={resetStuckSiiEmission} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 9, fontWeight: 800, textDecoration: "underline", padding: 0 }}>cancélala</button>{" "}y vuelve a emitir.
                  </div>
                ) : (
                  <div style={{ marginBottom: 7, fontSize: 9, color: "var(--amber)", textAlign: "center", lineHeight: 1.55 }}>
                    Hay una emisión SII sin resolver ({WORKER_STATUS_LABELS[localWorker?.status ?? ""] ?? "en proceso"}). No vuelvas a emitir: usa <strong>Recuperar emisión SII</strong> (a la izquierda) para rescatar el folio.
                    {/* Salida para el estado fantasma: si el servidor YA liberó la
                        emisión (lock inexistente), quedarse aquí era un callejón sin
                        salida en la sesión. Con lock liberado + rescate a mano, cancelar
                        es razonable — con advertencia explícita de revisar el folio. */}
                    {emissionLock?.ok === true && emissionLock.locked !== true && (
                      <>
                        {" "}Si la ventana del SII no mostró ningún folio, puedes{" "}
                        <button type="button" onClick={resetStuckSiiEmission} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 9, fontWeight: 800, textDecoration: "underline", padding: 0 }}>cancelarla</button>
                        {" "}y volver a emitir.
                      </>
                    )}
                  </div>
                )
              ) : (
                <div style={{ marginBottom: 7, fontSize: 9, color: "var(--text2)", textAlign: "center" }}>
                  {canSubmit ? "Listo para emitir." : rutReceptorInvalido ? "Corrige el RUT del receptor." : receptorNombrePendiente ? "Con RUT, indica también el nombre." : receptorObligatorioPendiente ? "Identifica al receptor (RUT y nombre)." : "Ingresa detalle y monto."}
                </div>
              )}
              <button onClick={() => { void handlePrimaryEmit(); }} disabled={primaryDisabled} style={{ width: "100%", minHeight: 38, fontSize: 11, padding: "8px 14px", borderRadius: 10, border: "none", cursor: primaryDisabled ? "not-allowed" : "pointer", fontWeight: 800, background: "#E8553E", color: "#fff", opacity: primaryDisabled ? 0.45 : 1, boxShadow: !primaryDisabled ? "0 10px 26px rgba(232,85,62,.24)" : "none" }}>
                {primaryLabel}
              </button>
            </div>
          </aside>
        </div>
      </div>

      {/* Pre-vuelo: confirmación SIEMPRE antes de emitir (patrón modal de EmitirTabContent).
          Se PORTALEA a document.body: el .ed-overlay usa backdrop-filter, que lo vuelve el
          bloque contenedor de los position:fixed → sin portal el modal se ancla al panel y se
          rompe (y hay backdrop-filters anidados). Portal = fixed real al viewport. */}
      {confirmOpen && createPortal((
        <div onClick={() => { if (!emitBusy) setConfirmOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 200, display: "grid", placeItems: "center", padding: 24, background: "rgba(0,0,0,.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 94vw)", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 30px 90px rgba(0,0,0,.5)", padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text2)" }}>Vas a emitir</span>
              {emisionEsReal ? (
                <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "var(--red)", background: "rgba(239,68,68,.14)", padding: "3px 8px", borderRadius: 7 }}>● EMISIÓN REAL</span>
              ) : (
                <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "var(--amber)", background: "rgba(245,158,11,.14)", padding: "3px 8px", borderRadius: 7 }}>● MODO PRUEBA</span>
              )}
            </div>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: tipoDte === 33 || tipoDte === 39 ? "var(--accent)" : "var(--blue)", background: tipoDte === 33 || tipoDte === 39 ? "rgba(232,85,62,.13)" : "rgba(91,156,246,.13)", padding: "4px 10px", borderRadius: 8 }}>{tipoHumano}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              Receptor <b style={{ color: "var(--text)" }}>{receptorResumen}</b>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 34, fontWeight: 800, color: "var(--text)", letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</span>
              <span style={{ fontSize: 12, color: "var(--text2)" }}>total</span>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 10, fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>
              {emisionEsReal
                ? "Emisión real: no se puede deshacer. Si algo sale mal, escríbenos a soporte."
                : "Modo de prueba: se simula, no llega al SII."}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => setConfirmOpen(false)} disabled={emitBusy}
                style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", background: "transparent", color: "var(--text2)", fontSize: 12, fontWeight: 600, cursor: emitBusy ? "not-allowed" : "pointer", opacity: emitBusy ? .55 : 1 }}>Cancelar</button>
              <button onClick={confirmPrimaryEmit} disabled={emitBusy}
                style={{ flex: 1, border: 0, borderRadius: 10, padding: "11px 14px", background: "#E8553E", color: "#fff", fontSize: 13, fontWeight: 800, cursor: emitBusy ? "not-allowed" : "pointer", opacity: emitBusy ? .55 : 1 }}>Emitir →</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Autorización legal (primera emisión real por proveedor) — mismo lenguaje visual.
          Portaleado a document.body por la misma razón que el pre-vuelo (backdrop-filter del overlay). */}
      {legalPrompt && createPortal((
        <div onClick={() => resolveLegalPrompt(false)}
          style={{ position: "fixed", inset: 0, zIndex: 210, display: "grid", placeItems: "center", padding: 24, background: "rgba(0,0,0,.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 94vw)", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 30px 90px rgba(0,0,0,.5)", padding: "20px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: "-.02em", marginBottom: 12 }}>Autorización de emisión</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 3 }}>Qué autorizas</div>
                <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>Autorizo a MassDTE a preparar esta emisión con {legalPrompt.providerLabel}.</div>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 3 }}>Tu responsabilidad</div>
                <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>Entiendo que debo revisar los datos antes de enviar y que la responsabilidad tributaria final es del usuario emisor.</div>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 3 }}>Registro</div>
                <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>Esta aceptación queda registrada con versión legal, usuario, empresa, fecha y proveedor.</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => resolveLegalPrompt(false)}
                style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "11px 14px", background: "transparent", color: "var(--text2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => resolveLegalPrompt(true)}
                style={{ flex: 1, border: 0, borderRadius: 10, padding: "11px 14px", background: "#E8553E", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Acepto y autorizo</button>
            </div>
          </div>
        </div>
      ), document.body)}

    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "numeric";
  maxLength?: number;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        style={{ width: "100%", height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", padding: "0 9px", fontSize: 11, outline: "none" }}
      />
    </label>
  );
}

function DupRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 9, lineHeight: 1.35, marginTop: 3 }}>
      <span style={{ color: "var(--text3)" }}>{label}</span>
      <span style={{ color: "var(--text)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}
