"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import type { AdapterConfig } from "@/lib/parsers/types";
import type { ResumenMapa } from "@/lib/parsers/resumen-mapa";

// POPUP "REVISA LAS COLUMNAS" (2026-09-30). Cuando el lector no puede PROBAR una
// cartola (sin saldo ni totales del banco, o algo no calza), se abre esto una
// vez por formato: viene PRE-LLENADO con las columnas con que la leímos, y un
// resumen en vivo del archivo COMPLETO ("quedan N entradas por $X…") que se
// recalcula en el server al cambiar una columna, la fila de inicio o el formato
// de fecha. "Listo" guarda las columnas como tuyas (solo tu empresa) y vuelve a
// leer la cartola; las siguientes de ese formato entran solas. Si el banco
// contradice las columnas elegidas, no se puede guardar.

type Role = "ignorar" | "fecha" | "descripcion" | "n_documento" | "cargo" | "abono" | "monto" | "tipo_flujo" | "saldo";
type Layout = "two_cols" | "single_col" | "transactions_log" | "monto_con_signo";
type DateFmt = "dd/mm/yyyy" | "yyyy-mm-dd" | "dd-mm-yyyy" | "mm/dd/yyyy" | "unknown";

interface Preview {
  sheetName: string; totalRows: number; cols: number;
  rows: string[][]; suggested: AdapterConfig | null; suggestedSource: "lector" | "named" | "heuristic" | null;
  /** Filas con datos más allá de las visibles del preview (el resto son relleno vacío del banco). */
  nonEmptyBeyondPreview?: number;
}

interface FieldMapperProps {
  documentoId: string;
  onClose: () => void;
  onSaved?: () => void;
  /** Una línea: por qué se abrió ("Esta vez algo no calza: …"). */
  motivo?: string | null;
}
type FieldMapperVariant = "modal" | "embedded";

const ROLES: Record<Role, { label: string; hint: string }> = {
  ignorar:      { label: "No usar",      hint: "Esta columna no se usa." },
  fecha:        { label: "Fecha",        hint: "El día del movimiento." },
  descripcion:  { label: "Glosa",        hint: "La descripción del movimiento." },
  n_documento:  { label: "N° operación", hint: "Número del movimiento." },
  cargo:        { label: "Salidas",      hint: "Plata que salió de tu cuenta (cargos)." },
  abono:        { label: "Entradas",     hint: "Plata que entró a tu cuenta (abonos)." },
  monto:        { label: "Monto",        hint: "El monto del movimiento." },
  tipo_flujo:   { label: "Entró/salió",  hint: "Columna que dice si entró o salió (C/D, Abono/Cargo)." },
  saldo:        { label: "Saldo",        hint: "Saldo después del movimiento." },
};

// Color por rol: tonos medios que se leen en claro y en oscuro.
const ROLE_HEX: Record<Role, string> = {
  ignorar: "#94a3b8", fecha: "#5fa8ff", descripcion: "#2dd4bf", n_documento: "#a78bfa",
  cargo: "#ff7365", abono: "#34d46e", monto: "#f59e0b", tipo_flujo: "#8b5cf6", saldo: "#f47b45",
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
// Con el AÑO: si las fechas no traen año, el cliente tiene que poder ver cuál le pusimos (vuelta 3).
const ddmm = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/**
 * Cómo se MUESTRA una celda en la tabla del popup (solo presentación: lo que se
 * lee y se guarda no cambia). La vista previa trae el valor crudo de Excel: una
 * fecha llega como serial ("46296.375") y un monto sin formato ("94000").
 */
export function celdaLegible(valor: string, rol: Role): string {
  const v = String(valor ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return valor;
  const n = Number(v);
  if (rol === "fecha" && n >= 20_000 && n < 80_000) {
    // Serial de Excel (días desde 1899-12-30), en UTC para no correr el día.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  }
  if (rol === "cargo" || rol === "abono" || rol === "monto" || rol === "saldo") {
    return `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("es-CL")}`;
  }
  return valor;
}

// ── Caché de previews (vive por sesión SPA, se limpia con F5) ────────────────
// El preview de un Excel es DETERMINÍSTICO por documento: se cachea por
// documentoId y se deduplica el fetch en vuelo (doble montaje de StrictMode y
// prefetch por hover).
type Mapping = { roles: Role[]; headerRow: number; firstDataRow: number; dateFormat: DateFmt; layout: Layout; defaultFlujo: "entrada" | "salida" };
type CacheEntry = { preview: Preview; mapping: Mapping };
const previewCache = new Map<string, CacheEntry>();
const inflightPreview = new Map<string, Promise<Preview>>();

// Deriva el mapeo inicial (roles + ajustes) de las columnas con que se leyó la cartola.
function deriveMapping(data: Preview): Mapping {
  const roles = new Array<Role>(data.cols).fill("ignorar");
  let headerRow = 0, firstDataRow = 1;
  let dateFormat: DateFmt = "dd/mm/yyyy";
  let layout: Layout = "two_cols";
  let defaultFlujo: "entrada" | "salida" = "entrada";
  if (data.suggested) {
    const s = data.suggested;
    headerRow = s.header_row; firstDataRow = s.skip_rows_before_data;
    dateFormat = s.date_format; layout = (s.layout ?? "two_cols") as Layout;
    if (s.default_tipo_flujo) defaultFlujo = s.default_tipo_flujo;
    const assign = (idx: number | undefined, role: Role) => { if (typeof idx === "number" && idx >= 0 && idx < data.cols) roles[idx] = role; };
    assign(s.columns.fecha, "fecha"); assign(s.columns.descripcion, "descripcion");
    assign(s.columns.n_documento, "n_documento");
    if (layout === "two_cols") { assign(s.columns.cargo, "cargo"); assign(s.columns.abono, "abono"); }
    assign(s.columns.saldo, "saldo");
    assign(s.columns.monto, "monto"); assign(s.columns.tipo_flujo_col, "tipo_flujo");
  }
  return { roles, headerRow, firstDataRow, dateFormat, layout, defaultFlujo };
}

async function fetchPreviewRaw(documentoId: string): Promise<Preview> {
  const res = await fetch("/api/parser/preview", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documento_id: documentoId }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "No se pudo abrir tu cartola"); }
  return res.json() as Promise<Preview>;
}

// Desde caché, desde el fetch en vuelo o iniciando uno nuevo. Los errores NO se cachean.
function loadPreview(documentoId: string): Promise<Preview> {
  const cached = previewCache.get(documentoId);
  if (cached) return Promise.resolve(cached.preview);
  const existing = inflightPreview.get(documentoId);
  if (existing) return existing;
  const p = fetchPreviewRaw(documentoId)
    .then((data) => { previewCache.set(documentoId, { preview: data, mapping: deriveMapping(data) }); return data; })
    .finally(() => { inflightPreview.delete(documentoId); });
  inflightPreview.set(documentoId, p);
  return p;
}

// Calienta la caché sin bloquear la UI (hover/focus del botón). Silencioso.
export function prefetchPreview(documentoId: string | null | undefined) {
  if (!documentoId) return;
  void loadPreview(documentoId).catch(() => {});
}

/** El mapa que armó el cliente, en la forma que entienden el lector y el server. */
function configDe(m: Mapping, findCol: (r: Role) => number): AdapterConfig {
  return {
    header_row: m.headerRow, skip_rows_before_data: m.firstDataRow, date_format: m.dateFormat,
    number_format: "chilean", layout: m.layout,
    default_tipo_flujo: m.layout === "transactions_log" ? m.defaultFlujo : undefined,
    columns: {
      fecha: findCol("fecha"), descripcion: findCol("descripcion"),
      n_documento: findCol("n_documento"), cargo: m.layout === "two_cols" ? findCol("cargo") : -1,
      abono: m.layout === "two_cols" ? findCol("abono") : -1, saldo: findCol("saldo"),
      monto: m.layout !== "two_cols" ? findCol("monto") : undefined,
      tipo_flujo_col: m.layout === "single_col" ? findCol("tipo_flujo") : undefined,
    },
  };
}

/**
 * La frase del resumen en vivo + si cuadra con el banco. Una sola idea por
 * línea, en chileno simple (se testea aparte: revisar-columnas-ui.test.tsx).
 */
export function LineaResumen({ resumen, cargando }: { resumen: ResumenMapa | null; cargando: boolean }) {
  if (!resumen) {
    return <div style={{ fontSize: 12, color: "var(--text3)" }}>{cargando ? "Leyendo tu cartola completa…" : "Elige las columnas para ver cómo queda."}</div>;
  }
  if (!resumen.valido) {
    return (
      <div role="alert" style={{ fontSize: 12, color: "var(--red)", fontWeight: 650, opacity: cargando ? 0.55 : 1 }}>
        Con estas columnas no se puede leer tu cartola{resumen.error ? `: ${resumen.error}` : "."}
      </div>
    );
  }
  const desde = ddmm(resumen.desde), hasta = ddmm(resumen.hasta);
  // PDF sin marca de banco (vuelta 6): nunca verde; se pregunta abajo si es de su banco.
  const estado = resumen.sinMarcaBanco && !resumen.contradice
    ? { color: "var(--amber)", txt: "Este PDF no dice de qué banco es (ni banco, ni N° de cuenta corriente): podría ser el estado de cuenta de un proveedor." }
    : resumen.contradice
    ? { color: "var(--red)", txt: resumen.soloAbonos
        ? "El saldo no calza porque faltan movimientos. Si tu cartola trae solo abonos, díselo abajo."
        : "Esto no calza con tu banco (saldo o totales): revisa las columnas." }
    : resumen.estado === "comprobada"
      ? { color: "var(--green)", txt: "Cuadra al peso con tu banco." }
      : resumen.estado === "alerta"
        ? { color: "var(--amber)", txt: resumen.motivo ?? "Algo no calza: revisa las columnas." }
        : { color: "var(--text3)", txt: "Tu cartola no trae saldo ni totales para comprobarla: si se ve bien, dale Listo." };
  return (
    <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--text2)", opacity: cargando ? 0.55 : 1, transition: "opacity .15s" }}>
      <div>
        Con estas columnas quedan <b style={{ color: "var(--green)" }}>{resumen.entradas.n.toLocaleString("es-CL")} entradas</b> por <b style={{ color: "var(--text)" }}>{pesos(resumen.entradas.monto)}</b>
        {" "}y <b style={{ color: "var(--text)" }}>{resumen.salidas.n.toLocaleString("es-CL")} salidas</b> por <b style={{ color: "var(--text)" }}>{pesos(resumen.salidas.monto)}</b>
        {desde && hasta ? `, del ${desde} al ${hasta}` : ""}.
      </div>
      <div style={{ marginTop: 2, color: estado.color, fontWeight: 650 }}>{estado.txt}</div>
      {resumen.noLeidas > 0 && (
        <div style={{ marginTop: 2, color: "var(--amber)" }}>
          {resumen.noLeidas === 1 ? "1 fila con plata queda sin leer." : `${resumen.noLeidas} filas con plata quedan sin leer.`}
        </div>
      )}
    </div>
  );
}

const btn = (primario: boolean, disabled: boolean): React.CSSProperties => ({
  height: 38, padding: "0 16px", borderRadius: 10, fontWeight: 750, fontSize: 12,
  border: primario ? "none" : "1px solid var(--border)",
  background: primario ? "var(--accent)" : "var(--bg-muted)",
  color: primario ? "#fff" : "var(--text)",
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
  boxShadow: primario && !disabled ? "0 10px 26px color-mix(in srgb, var(--accent) 28%, transparent)" : "none",
});

/**
 * Aviso tras "Listo": solo promete releer si el reproceso de verdad partió (con
 * emitidas o a medias, reprocesar está bajo el doble candado y no parte).
 */
export function avisoTrasGuardar(j: { reprocessStarted?: boolean }): string {
  return j.reprocessStarted
    ? "Listo: guardamos tus columnas y estamos leyendo tu cartola de nuevo"
    : "Guardamos tus columnas para tus próximas cartolas. Esta no se volvió a leer: revísala en Editar.";
}

export function FieldMapperBody({ documentoId, onClose, onSaved, motivo, variant = "modal" }: FieldMapperProps & { variant?: FieldMapperVariant }) {
  const { toast } = useToast();
  // Semilla desde caché: si ya se prefetcheó, arranca sin spinner.
  const [preview, setPreview] = useState<Preview | null>(() => previewCache.get(documentoId)?.preview ?? null);
  const [loading, setLoading] = useState(() => !previewCache.has(documentoId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);

  const [roles, setRoles] = useState<Role[]>(() => previewCache.get(documentoId)?.mapping.roles ?? []);
  const [headerRow, setHeaderRow] = useState(() => previewCache.get(documentoId)?.mapping.headerRow ?? 0);
  const [firstDataRow, setFirstDataRow] = useState(() => previewCache.get(documentoId)?.mapping.firstDataRow ?? 1);
  const [dateFormat, setDateFormat] = useState<DateFmt>(() => previewCache.get(documentoId)?.mapping.dateFormat ?? "dd/mm/yyyy");
  const [layout, setLayout] = useState<Layout>(() => previewCache.get(documentoId)?.mapping.layout ?? "two_cols");
  const [defaultFlujo, setDefaultFlujo] = useState<"entrada" | "salida">(() => previewCache.get(documentoId)?.mapping.defaultFlujo ?? "entrada");

  const applyMapping = useCallback((m: Mapping) => {
    setRoles(m.roles); setHeaderRow(m.headerRow); setFirstDataRow(m.firstDataRow);
    setDateFormat(m.dateFormat); setLayout(m.layout); setDefaultFlujo(m.defaultFlujo);
  }, []);

  useEffect(() => {
    let ignore = false;
    const cached = previewCache.get(documentoId);
    if (cached) {
      setPreview(cached.preview); applyMapping(cached.mapping); setError(null); setLoading(false);
      return;
    }
    setLoading(true); setError(null);
    loadPreview(documentoId)
      .then((data) => {
        if (ignore) return;
        setPreview(data);
        applyMapping(previewCache.get(documentoId)?.mapping ?? deriveMapping(data));
      })
      .catch((err: unknown) => { if (!ignore) setError(err instanceof Error ? err.message : "No se pudo abrir tu cartola"); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [documentoId, applyMapping]);

  const columnLabels = useMemo(() => {
    if (!preview) return [];
    const vals = preview.rows[headerRow] ?? [];
    return Array.from({ length: preview.cols }, (_, c) => String(vals[c] ?? ""));
  }, [preview, headerRow]);

  function setRole(idx: number, role: Role) {
    setRoles((prev) => {
      const next = [...prev];
      if (role !== "ignorar") for (let i = 0; i < next.length; i++) if (i !== idx && next[i] === role) next[i] = "ignorar";
      next[idx] = role; return next;
    });
  }
  // La fila de inicio mueve la de títulos si la alcanza (los títulos van arriba).
  function moverInicio(n: number) {
    const fila = Math.max(1, Math.min(n, Math.max(1, (preview?.rows.length ?? 2) - 1)));
    setFirstDataRow(fila);
    if (headerRow >= fila) setHeaderRow(fila - 1);
  }

  const findCol = useCallback((role: Role) => roles.findIndex((r) => r === role), [roles]);
  const realRows = useMemo(() => {
    if (!preview) return 0;
    const enPreview = preview.rows.slice(firstDataRow).filter((r) => r.some((cell) => String(cell ?? "").trim() !== "")).length;
    return enPreview + (preview.nonEmptyBeyondPreview ?? 0);
  }, [preview, firstDataRow]);

  const validationErr = useMemo(() => {
    if (!preview) return null;
    if (findCol("fecha") < 0) return "Falta la columna de la fecha";
    if (findCol("descripcion") < 0) return "Falta la columna de la glosa";
    if (layout === "two_cols" && findCol("cargo") < 0 && findCol("abono") < 0) return "Falta la columna de entradas o la de salidas";
    if (layout === "single_col") { if (findCol("monto") < 0) return "Falta la columna del monto"; if (findCol("tipo_flujo") < 0) return "Falta la columna que dice si entró o salió"; }
    if ((layout === "transactions_log" || layout === "monto_con_signo") && findCol("monto") < 0) return "Falta la columna del monto";
    if (firstDataRow <= headerRow) return "Los movimientos tienen que partir después de los títulos";
    return null;
  }, [preview, findCol, layout, headerRow, firstDataRow]);

  const config = useMemo(
    () => configDe({ roles, headerRow, firstDataRow, dateFormat, layout, defaultFlujo }, findCol),
    [roles, headerRow, firstDataRow, dateFormat, layout, defaultFlujo, findCol],
  );
  const claveConfig = JSON.stringify(config);

  // RESUMEN EN VIVO: el server lee la cartola COMPLETA con estas columnas. Con
  // debounce; una respuesta vieja nunca pisa a una nueva (abort + clave).
  const [resumen, setResumen] = useState<{ clave: string; r: ResumenMapa } | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  useEffect(() => {
    if (!preview || validationErr) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setCargandoResumen(true);
      fetch("/api/parser/resumen", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ documento_id: documentoId, config: JSON.parse(claveConfig) }),
      })
        .then(async (res) => {
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error || "No pudimos leer tu cartola");
          setResumen({ clave: claveConfig, r: j as ResumenMapa });
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setResumen({ clave: claveConfig, r: { valido: false, error: e instanceof Error ? e.message : "No pudimos leer tu cartola", entradas: { n: 0, monto: 0 }, salidas: { n: 0, monto: 0 }, desde: null, hasta: null, estado: "alerta", motivo: null, contradice: false, soloAbonos: false, noLeidas: 0, guardable: false, firma: "" } });
        })
        .finally(() => { if (!ctrl.signal.aborted) setCargandoResumen(false); });
    }, 450);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [preview, validationErr, claveConfig, documentoId]);

  const vigente = resumen && resumen.clave === claveConfig ? resumen.r : null;
  const puedeListo = !saving && !loading && !!preview && !validationErr && !!vigente?.valido && vigente.guardable;
  const puedeSoloAbonos = !saving && !validationErr && !!vigente?.valido && vigente.soloAbonos;

  async function guardar(soloAbonos: boolean, esBanco = false) {
    if (validationErr) { toast(validationErr, "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/parser/save-mapping", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, config, reprocess: true, solo_abonos: soloAbonos, ...(esBanco ? { es_banco: true } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "No se pudieron guardar tus columnas");
      toast(avisoTrasGuardar(j));
      onSaved?.(); onClose();
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudieron guardar tus columnas", "error"); }
    setSaving(false);
  }

  // "No es una cartola" (vuelta 6): el PDF sale del lector y vuelve al flujo de antes.
  async function noEsCartola() {
    setSaving(true);
    try {
      const res = await fetch("/api/parser/no-es-cartola", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, config }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "No pudimos guardar tu respuesta");
      toast(j.reprocessStarted ? "Listo: no lo leeremos como cartola de banco" : "Guardado: este formato no se leerá como cartola de banco");
      onSaved?.(); onClose();
    } catch (err) { toast(err instanceof Error ? err.message : "No pudimos guardar tu respuesta", "error"); }
    setSaving(false);
  }
  const preguntaBanco = !!vigente?.valido && !!vigente.sinMarcaBanco;

  const fuente = preview?.suggestedSource ?? null;
  const statusNode = preview ? (
    <div style={{ fontSize: 11, color: "var(--text2)", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {fuente
        ? <><CheckCircle size={12} weight="fill" style={{ color: "var(--green)" }} /> {fuente === "lector" ? "Así la leímos." : "Así creemos que vienen tus columnas."} Si está bien, dale Listo.</>
        : <><Warning size={12} weight="fill" style={{ color: "var(--amber)" }} /> No reconocimos el formato: dinos qué es cada columna.</>}
    </div>
  ) : null;
  const motivoNode = motivo ? (
    <div style={{ fontSize: 11.5, color: "var(--amber)", fontWeight: 650, lineHeight: 1.35, whiteSpace: "normal", overflowWrap: "anywhere" }}>{motivo}</div>
  ) : null;

  // Fragmento de 3 secciones (header / content / footer). El grid lo pone el
  // wrapper: el modal `FieldMapper` o el popup Editar cuando se embebe.
  return (
    <>
      {/* HEADER */}
      {variant === "modal" ? (
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M4 9h16M9 4v16M14.5 4v16M4 14h16" stroke="currentColor" strokeWidth="1.4" opacity=".9"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, color: "var(--text)" }}>Revisa las columnas</div>
            {motivoNode}
            {statusNode}
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 18, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      ) : (
        <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 3 }}>{motivoNode}{statusNode}</div>
      )}

      {/* CONTENT */}
      <div style={{ overflow: "auto", padding: "14px 20px", scrollbarWidth: "thin" }}>
        {loading && <div style={{ padding: 80, textAlign: "center", color: "var(--text3)" }}>Abriendo tu cartola…</div>}
        {error && <div style={{ padding: 80, textAlign: "center", color: "var(--red)" }}><Warning size={32} weight="fill" /><p>{error}</p></div>}
        {preview && <GridContent preview={preview} roles={roles} setRole={setRole} headerRow={headerRow}
          firstDataRow={firstDataRow} moverInicio={moverInicio} layout={layout} columnLabels={columnLabels} realRows={realRows}
          dateFormat={dateFormat} setDateFormat={setDateFormat} setLayout={setLayout}
          defaultFlujo={defaultFlujo} setDefaultFlujo={setDefaultFlujo}
          advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
          ignoredOpen={ignoredOpen} setIgnoredOpen={setIgnoredOpen} />}
      </div>

      {/* FOOTER — siempre visible: el resumen en vivo y las salidas */}
      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "var(--surface2, transparent)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          {validationErr && preview
            ? <div role="alert" style={{ color: "var(--red)", fontSize: 12, fontWeight: 650 }}>{validationErr}</div>
            : <LineaResumen resumen={vigente ?? resumen?.r ?? null} cargando={cargandoResumen || (!!resumen && !vigente)} />}
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <button onClick={onClose} style={btn(false, false)}>{variant === "embedded" ? "Volver" : "Ahora no"}</button>
          {/* Con un PDF sin marca de banco primero se responde si es de su banco. */}
          {vigente?.soloAbonos && !preguntaBanco && (
            <button onClick={() => guardar(true)} disabled={!puedeSoloAbonos} style={btn(false, !puedeSoloAbonos)}>
              Mi cartola trae solo abonos
            </button>
          )}
          {preguntaBanco ? (
            <div role="group" aria-label="¿Este PDF es de tu banco?" style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 750, color: "var(--text)" }}>¿Este PDF es de tu banco?</span>
              <button onClick={noEsCartola} disabled={saving} style={btn(false, saving)}>No es una cartola</button>
              <button onClick={() => guardar(false, true)} disabled={!puedeListo} style={btn(true, !puedeListo)}
                title={vigente && !vigente.guardable ? "Tu banco no calza con estas columnas" : undefined}>
                {saving ? "Guardando…" : "Sí, es mi cartola"}
              </button>
            </div>
          ) : (
            <button onClick={() => guardar(false)} disabled={!puedeListo} style={btn(true, !puedeListo)}
              title={vigente && !vigente.guardable ? "Tu banco no calza con estas columnas" : undefined}>
              {saving ? "Guardando…" : "Listo"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// Modal standalone (visor de la mesa y DocCardList).
export default function FieldMapper(props: FieldMapperProps) {
  return (
    <div data-actualizacion-espera="" style={{
      position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center",
      padding: 20, background: "rgba(0,0,0,.5)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
    }}>
      <div role="dialog" aria-modal="true" aria-label="Revisa las columnas" style={{
        width: "min(1180px, 96vw)", maxHeight: "90vh",
        overflow: "hidden", borderRadius: 20, border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "0 30px 90px rgba(0,0,0,.35)",
        display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", color: "var(--text)",
        fontFamily: "var(--font-geist-sans), sans-serif",
      }}>
        <FieldMapperBody {...props} variant="modal" />
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%", height: 36, borderRadius: 10, border: "1px solid var(--border)",
  background: "var(--bg-muted)", color: "var(--text)", padding: "0 12px", fontSize: 12,
};

function GridContent(props: {
  preview: Preview; roles: Role[]; setRole: (idx: number, role: Role) => void;
  headerRow: number; firstDataRow: number; moverInicio: (n: number) => void; layout: Layout; columnLabels: string[];
  realRows: number;
  dateFormat: DateFmt; setDateFormat: (f: DateFmt) => void;
  setLayout: (l: Layout) => void; defaultFlujo: "entrada" | "salida";
  setDefaultFlujo: (f: "entrada" | "salida") => void;
  advancedOpen: boolean; setAdvancedOpen: (v: boolean) => void;
  ignoredOpen: boolean; setIgnoredOpen: (v: boolean) => void;
}) {
  const { preview, roles, setRole, headerRow, firstDataRow, moverInicio, layout, columnLabels, realRows,
    dateFormat, setDateFormat, setLayout, defaultFlujo, setDefaultFlujo,
    advancedOpen, setAdvancedOpen, ignoredOpen, setIgnoredOpen } = props;
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const filasArriba = preview.rows.slice(0, firstDataRow).map((row, i) => ({ row, idx: i })).filter(({ idx }) => idx !== headerRow);
  // Solo filas con datos: el relleno vacío al final de la hoja no aporta.
  const dataPreview = preview.rows
    .slice(firstDataRow, Math.min(preview.rows.length, firstDataRow + 12))
    .map((row, i) => ({ row, idx: firstDataRow + i }))
    .filter(({ row }) => row.some((cell) => String(cell ?? "").trim() !== ""));
  const cols = preview.cols;

  const emptyCols = useMemo(() => {
    const s = new Set<number>();
    for (let c = 0; c < cols; c++) {
      const h = String(preview.rows[headerRow]?.[c] ?? "").trim();
      const hasData = dataPreview.some(({ row }) => String(row[c] ?? "").trim() !== "");
      if (!h && !hasData) s.add(c);
    }
    return s;
  }, [preview, headerRow, dataPreview, cols]);

  function colTint(c: number): React.CSSProperties {
    const r = roles[c] ?? "ignorar";
    if (r === "ignorar") return hoveredCol === c ? { background: "var(--bg-muted)" } : {};
    return { background: `color-mix(in srgb, ${ROLE_HEX[r]} ${hoveredCol === c ? 18 : 9}%, transparent)` };
  }
  const ch = (c: number) => ({ onMouseEnter: () => setHoveredCol(c), onMouseLeave: () => setHoveredCol(null) });
  const celda: React.CSSProperties = { borderBottom: "1px solid var(--border)" };

  return (
    <>
      {/* Filas de arriba que no se leen (títulos del banco, totales) — una línea, expandible */}
      {filasArriba.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => setIgnoredOpen(!ignoredOpen)}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", background: "var(--bg-muted)", borderRadius: 999, padding: "6px 12px", fontSize: 11, color: "var(--text2)", cursor: "pointer" }}>
            {filasArriba.length} fila{filasArriba.length !== 1 ? "s" : ""} de arriba no se lee{filasArriba.length !== 1 ? "n" : ""} (datos del banco, totales)
            <span style={{ color: "var(--text3)" }}>{ignoredOpen ? "▴" : "▾"}</span>
          </button>
          {ignoredOpen && (
            <div style={{ marginTop: 8, padding: "8px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-muted)" }}>
              {filasArriba.map(({ row, idx }) => (
                <div key={idx} style={{ fontSize: 11, color: "var(--text2)", padding: "2px 0" }}>
                  Fila {idx + 1}: {row.filter((v) => String(v ?? "").trim()).slice(0, 4).join(" · ") || "(vacía)"}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabla: la columna (qué es + su título) arriba, los datos debajo */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--bg)", overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "52vh", scrollbarWidth: "thin" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", top: 0, zIndex: 3, width: 40, padding: "10px 8px", background: "var(--surface2)", ...celda }}>
                  <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700 }}>Fila</span>
                </th>
                {Array.from({ length: cols }).map((_, c) => {
                  const isEmpty = emptyCols.has(c);
                  return (
                    <th key={c} {...ch(c)} style={{ position: "sticky", top: 0, zIndex: 3, padding: isEmpty ? "10px 4px" : "10px 8px 8px", background: "var(--surface2)", ...celda, textAlign: "center", verticalAlign: "top", minWidth: isEmpty ? 28 : 96 }}>
                      {isEmpty ? (
                        <span style={{ color: "var(--text3)", fontSize: 11 }}>—</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                          <ColumnChip role={roles[c] ?? "ignorar"} onChange={(r) => setRole(c, r)} layout={layout} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>
                            {columnLabels[c] || <span style={{ fontStyle: "italic", color: "var(--text3)" }}>sin título</span>}
                          </span>
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {dataPreview.length === 0 && (
                <tr><td colSpan={cols + 1} style={{ padding: 24, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>No hay movimientos desde esa fila</td></tr>
              )}
              {dataPreview.map(({ row, idx }) => (
                <tr key={idx}>
                  <td style={{ width: 40, textAlign: "center", padding: "9px 8px", color: "var(--text3)", fontSize: 11, background: "var(--bg-muted)", ...celda }}>{idx + 1}</td>
                  {Array.from({ length: cols }).map((_, c) => {
                    const isEmpty = emptyCols.has(c);
                    return (
                      <td key={c} {...ch(c)}
                        style={{ ...colTint(c), padding: isEmpty ? "9px 4px" : "9px 10px", ...celda, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
                        {isEmpty ? "" : celdaLegible(row[c] ?? "", roles[c] ?? "ignorar")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "7px 12px", borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text3)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>Toca el nombre de una columna para cambiar qué es.</span>
          <span>Mostrando {dataPreview.length} de {realRows.toLocaleString("es-CL")} filas · el resumen de abajo usa la cartola completa</span>
        </div>
      </div>

      {/* Ajustes: fila de inicio, fecha y cómo vienen los montos */}
      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg-muted)", padding: "12px 16px" }}>
        <div onClick={() => setAdvancedOpen(!advancedOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: advancedOpen ? 14 : 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: "var(--text)" }}>Más ajustes</div>
            <div style={{ marginTop: 2, color: "var(--text3)", fontSize: 11 }}>En qué fila parten los movimientos, cómo viene la fecha y los montos. Casi nunca hace falta.</div>
          </div>
          <span style={{ color: "var(--text3)" }}>{advancedOpen ? "▴" : "▾"}</span>
        </div>
        {advancedOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Field label="Los movimientos parten en la fila" hint="La primera fila con un movimiento de verdad (bajo los títulos).">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => moverInicio(firstDataRow - 1)} aria-label="Una fila antes" style={{ ...selectStyle, width: 36, padding: 0, cursor: "pointer" }}>−</button>
                <span style={{ minWidth: 30, textAlign: "center", fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{firstDataRow + 1}</span>
                <button onClick={() => moverInicio(firstDataRow + 1)} aria-label="Una fila después" style={{ ...selectStyle, width: 36, padding: 0, cursor: "pointer" }}>+</button>
              </div>
            </Field>
            <Field label="Cómo viene la fecha" hint="Ej.: 30/04/2026">
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFmt)} style={selectStyle}>
                <option value="dd/mm/yyyy">DD/MM/AAAA</option>
                <option value="yyyy-mm-dd">AAAA-MM-DD</option>
                <option value="dd-mm-yyyy">DD-MM-AAAA</option>
                <option value="mm/dd/yyyy">MM/DD/AAAA (mes primero)</option>
                <option value="unknown">No sé</option>
              </select>
            </Field>
            <Field label="¿Cómo vienen los montos?" hint="Entradas y salidas en columnas separadas (lo típico de los bancos chilenos), o un solo monto.">
              <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)} style={selectStyle}>
                <option value="two_cols">Entradas y salidas separadas</option>
                <option value="single_col">Un monto + columna que dice si entró o salió</option>
                <option value="transactions_log">Una sola columna de monto</option>
                <option value="monto_con_signo">Un monto con signo (negativo = salida)</option>
              </select>
            </Field>
            {layout === "transactions_log" && (
              <Field label="Esos montos, ¿entran o salen?" hint="Solo cuando hay una única columna de monto sin indicador.">
                <select value={defaultFlujo} onChange={(e) => setDefaultFlujo(e.target.value as "entrada" | "salida")} style={selectStyle}>
                  <option value="entrada">Plata que entra (ventas, abonos)</option>
                  <option value="salida">Plata que sale (gastos, cargos)</option>
                </select>
              </Field>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ColumnChip({ role, onChange, layout }: { role: Role; onChange: (r: Role) => void; layout: Layout }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = ROLES[role];

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) { if (!btnRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false); }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true); window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onEsc); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);

  const opciones: Role[] = ["ignorar", "fecha", "descripcion", "n_documento",
    ...(layout === "two_cols" ? ["abono", "cargo"] as Role[] : []),
    ...(layout !== "two_cols" ? ["monto"] as Role[] : []),
    ...(layout === "single_col" ? ["tipo_flujo"] as Role[] : []), "saldo"];

  return (
    <>
      <Tooltip content={meta.hint}>
        <button ref={btnRef} onClick={() => setOpen((v) => !v)}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            height: 28, borderRadius: 9, padding: "0 10px", fontSize: 11, fontWeight: 720, cursor: "pointer",
            border: "1px solid currentColor", background: "var(--bg-muted)",
            color: ROLE_HEX[role], transition: "all .15s",
          }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
          {meta.label} <span style={{ opacity: .8, fontSize: 9 }}>⌄</span>
        </button>
      </Tooltip>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={menuRef} data-actualizacion-espera=""
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)", zIndex: 200, minWidth: 220, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,.25)", overflow: "hidden", padding: "4px 0" }}>
          {opciones.map((r) => (
            <button key={r} onClick={() => { onChange(r); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", fontSize: 11,
                border: "none", cursor: "pointer", textAlign: "left",
                background: r === role ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                color: r === role ? "var(--accent)" : "var(--text)",
              }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_HEX[r], flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{ROLES[r].label}</span>
              <span style={{ fontSize: 9, color: "var(--text3)" }}>{ROLES[r].hint}</span>
            </button>
          ))}
        </div>, document.body,
      )}
    </>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", fontSize: 12, fontWeight: 700, marginBottom: 7 }}>
        {label}
        {hint && <Tooltip content={hint}><span style={{ width: 15, height: 15, borderRadius: "50%", border: "1px solid var(--border)", color: "var(--text3)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, cursor: "help" }}>?</span></Tooltip>}
      </div>
      {children}
    </div>
  );
}

function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} onMouseEnter={() => { if (ref.current) { const r = ref.current.getBoundingClientRect(); setPos({ top: r.bottom + 6, left: r.left + r.width / 2 }); setShow(true); } }}
      onMouseLeave={() => setShow(false)} style={{ display: "inline-block" }}>
      {children}
      {show && pos && typeof document !== "undefined" && createPortal(
        // actualizacion-libre: tooltip de hover, no guarda nada
        <div style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)", zIndex: 300, pointerEvents: "none", maxWidth: 260, padding: "8px 12px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 10, lineHeight: 1.4, boxShadow: "0 8px 24px rgba(0,0,0,.2)" }}>{content}</div>, document.body,
      )}
    </span>
  );
}
