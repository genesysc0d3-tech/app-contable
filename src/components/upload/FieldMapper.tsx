"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X, MagicWand, CheckCircle, Warning, Lock, CaretDown, Gear, Table, ArrowDown,
} from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import type { AdapterConfig } from "@/lib/parsers/types";

type Role =
  | "ignorar"
  | "fecha"
  | "descripcion"
  | "n_documento"
  | "cargo"
  | "abono"
  | "monto"
  | "tipo_flujo"
  | "saldo";

type Layout = "two_cols" | "single_col" | "transactions_log";
type DateFmt = "dd/mm/yyyy" | "yyyy-mm-dd" | "dd-mm-yyyy" | "unknown";

interface Preview {
  sheetName: string;
  fingerprint: string;
  totalRows: number;
  cols: number;
  rows: string[][];
  suggested: AdapterConfig | null;
  suggestedSource: "named" | "heuristic" | null;
}

interface FieldMapperProps {
  documentoId: string;
  onClose: () => void;
  onSaved?: () => void;
}

// Role → {label, colorClass}. Orange accent for monetarios, teal for info, grey for ignore.
const ROLES: Record<Role, { label: string; dot: string; chip: string }> = {
  ignorar:      { label: "Ignorar",        dot: "bg-[var(--muted-light)]",     chip: "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)]" },
  fecha:        { label: "Fecha",          dot: "bg-[#3B82F6]",                chip: "bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30" },
  descripcion:  { label: "Descripción",    dot: "bg-[#14B8A6]",                chip: "bg-[#14B8A6]/10 text-[#14B8A6] border-[#14B8A6]/30" },
  n_documento:  { label: "N° documento",   dot: "bg-[#6366F1]",                chip: "bg-[#6366F1]/10 text-[#6366F1] border-[#6366F1]/30" },
  cargo:        { label: "Salida",         dot: "bg-[#E8553E]",                chip: "bg-[#E8553E]/10 text-[#E8553E] border-[#E8553E]/30" },
  abono:        { label: "Entrada",        dot: "bg-[#22C55E]",                chip: "bg-[#22C55E]/10 text-[#22C55E] border-[#22C55E]/30" },
  monto:        { label: "Monto",          dot: "bg-[#F59E0B]",                chip: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30" },
  tipo_flujo:   { label: "Tipo flujo",     dot: "bg-[#8B5CF6]",                chip: "bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30" },
  saldo:        { label: "Saldo",          dot: "bg-[#64748B]",                chip: "bg-[#64748B]/10 text-[#64748B] border-[#64748B]/30" },
};

const UNIQUE_ROLES: Role[] = ["fecha", "descripcion", "n_documento", "cargo", "abono", "monto", "tipo_flujo", "saldo"];

export default function FieldMapper({ documentoId, onClose, onSaved }: FieldMapperProps) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [roles, setRoles] = useState<Role[]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [firstDataRow, setFirstDataRow] = useState(1);
  const [dateFormat, setDateFormat] = useState<DateFmt>("dd/mm/yyyy");
  const [layout, setLayout] = useState<Layout>("two_cols");
  const [defaultFlujo, setDefaultFlujo] = useState<"entrada" | "salida">("entrada");

  useEffect(() => {
    fetch("/api/parser/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documento_id: documentoId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "No se pudo cargar preview");
        }
        return res.json() as Promise<Preview>;
      })
      .then((data) => {
        setPreview(data);
        // Auto-prefill from suggested config
        const initialRoles = new Array<Role>(data.cols).fill("ignorar");
        if (data.suggested) {
          const s = data.suggested;
          setHeaderRow(s.header_row);
          setFirstDataRow(s.skip_rows_before_data);
          setDateFormat(s.date_format);
          setLayout((s.layout ?? "two_cols") as Layout);
          if (s.default_tipo_flujo) setDefaultFlujo(s.default_tipo_flujo);
          const assign = (idx: number | undefined, role: Role) => {
            if (typeof idx === "number" && idx >= 0 && idx < data.cols) initialRoles[idx] = role;
          };
          assign(s.columns.fecha, "fecha");
          assign(s.columns.descripcion, "descripcion");
          assign(s.columns.n_documento, "n_documento");
          assign(s.columns.cargo, "cargo");
          assign(s.columns.abono, "abono");
          assign(s.columns.saldo, "saldo");
          assign(s.columns.monto, "monto");
          assign(s.columns.tipo_flujo_col, "tipo_flujo");
        }
        setRoles(initialRoles);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [documentoId]);

  function setRole(idx: number, role: Role) {
    setRoles((prev) => {
      const next = [...prev];
      if (UNIQUE_ROLES.includes(role)) {
        for (let i = 0; i < next.length; i++) if (i !== idx && next[i] === role) next[i] = "ignorar";
      }
      next[idx] = role;
      return next;
    });
  }

  const findCol = (role: Role) => roles.findIndex((r) => r === role);

  const detected = preview?.suggestedSource !== null && preview?.suggested !== null;

  const validationErr = useMemo(() => {
    if (!preview) return null;
    if (findCol("fecha") < 0) return "Falta asignar la columna de Fecha";
    if (findCol("descripcion") < 0) return "Falta asignar la columna de Descripción";
    if (layout === "two_cols" && findCol("cargo") < 0 && findCol("abono") < 0) {
      return "Asigná Entrada o Salida (ambas para cartolas)";
    }
    if (layout === "single_col") {
      if (findCol("monto") < 0) return "Asigná Monto";
      if (findCol("tipo_flujo") < 0) return "Asigná Tipo flujo";
    }
    if (layout === "transactions_log" && findCol("monto") < 0) return "Asigná Monto";
    if (firstDataRow <= headerRow) return "La fila de datos debe estar después de la fila de títulos";
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, roles, layout, headerRow, firstDataRow]);

  async function save(reprocess: boolean) {
    if (validationErr) { toast(validationErr, "error"); return; }
    setSaving(true);
    try {
      const config: AdapterConfig = {
        header_row: headerRow,
        skip_rows_before_data: firstDataRow,
        date_format: dateFormat,
        number_format: "chilean",
        layout,
        default_tipo_flujo: layout === "transactions_log" ? defaultFlujo : undefined,
        columns: {
          fecha: findCol("fecha"),
          descripcion: findCol("descripcion"),
          n_documento: findCol("n_documento"),
          cargo: layout === "two_cols" ? findCol("cargo") : -1,
          abono: layout === "two_cols" ? findCol("abono") : -1,
          saldo: findCol("saldo"),
          monto: layout !== "two_cols" ? findCol("monto") : undefined,
          tipo_flujo_col: layout === "single_col" ? findCol("tipo_flujo") : undefined,
        },
      };
      const res = await fetch("/api/parser/save-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, config, reprocess }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error guardando");
      toast(reprocess ? "Guardado y reprocesando" : "Mapeo guardado");
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-[20px] bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] text-[#E8553E] flex items-center justify-center">
            <MagicWand size={22} weight="bold" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold">Mapear campos</h2>
            {preview && (
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {detected ? (
                  <>
                    <CheckCircle size={12} weight="fill" className="inline text-[#22C55E] mr-1 -mt-0.5" />
                    Detectamos el formato — revisá que todo esté bien y aprobá.
                  </>
                ) : (
                  <>
                    <Warning size={12} weight="fill" className="inline text-[#F59E0B] mr-1 -mt-0.5" />
                    No reconocimos el formato — asigná las columnas manualmente.
                  </>
                )}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-16 text-center text-[var(--muted)]">
              <div className="animate-shimmer h-5 w-40 mx-auto rounded mb-3" />
              <p className="text-xs">Analizando el archivo...</p>
            </div>
          )}
          {error && (
            <div className="p-16 text-center">
              <Warning size={32} weight="fill" className="mx-auto text-[#E8553E] mb-2" />
              <p className="text-sm text-[#E8553E]">{error}</p>
            </div>
          )}
          {preview && (
            <GridView
              preview={preview}
              roles={roles}
              setRole={setRole}
              headerRow={headerRow}
              setHeaderRow={setHeaderRow}
              firstDataRow={firstDataRow}
              setFirstDataRow={setFirstDataRow}
              layout={layout}
            />
          )}
        </div>

        {/* Advanced settings (collapsible) */}
        {preview && (
          <div className="border-t border-[var(--border)]">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-5 py-2.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <Gear size={14} weight="bold" />
              <span className="font-medium">Ajustes avanzados</span>
              <CaretDown size={12} weight="bold" className={`ml-auto transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
            {advancedOpen && (
              <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs animate-fade-in">
                <Field label="Formato de fecha">
                  <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFmt)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                    <option value="dd/mm/yyyy">dd/mm/yyyy (30/01/2026)</option>
                    <option value="yyyy-mm-dd">yyyy-mm-dd (2026-01-30)</option>
                    <option value="dd-mm-yyyy">dd-mm-yyyy (30-01-2026)</option>
                    <option value="unknown">No sé / mixto</option>
                  </select>
                </Field>
                <Field label="¿Cómo se expresan los montos?">
                  <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                    <option value="two_cols">Dos columnas (Entrada + Salida)</option>
                    <option value="single_col">Una columna de monto + tipo</option>
                    <option value="transactions_log">Una columna (todos del mismo tipo)</option>
                  </select>
                </Field>
                {layout === "transactions_log" && (
                  <Field label="Todos son">
                    <select value={defaultFlujo} onChange={(e) => setDefaultFlujo(e.target.value as "entrada" | "salida")}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                      <option value="entrada">Entradas</option>
                      <option value="salida">Salidas</option>
                    </select>
                  </Field>
                )}
                <Field label="">
                  <p className="text-[10px] text-[var(--muted-light)] mt-4">
                    Hoja: <b>{preview.sheetName}</b> · {preview.totalRows} filas · {preview.cols} columnas
                  </p>
                </Field>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-[var(--border)] bg-[var(--surface)]/40">
          <div className="flex-1 min-w-0">
            {validationErr ? (
              <p className="text-xs text-[#E8553E] flex items-center gap-1.5">
                <Warning size={14} weight="fill" />
                {validationErr}
              </p>
            ) : preview ? (
              <p className="text-xs text-[#22C55E] flex items-center gap-1.5">
                <CheckCircle size={14} weight="fill" />
                Todo listo para guardar
              </p>
            ) : null}
          </div>
          <button onClick={onClose}
            className="btn-press text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-3 py-2 transition-colors">
            Cancelar
          </button>
          <button onClick={() => save(false)} disabled={saving || loading || !preview || !!validationErr}
            className="btn-press text-xs text-[#E8553E] border border-[#E8553E] rounded-lg px-3 py-2 hover:bg-[var(--accent-light)] disabled:opacity-40 transition-colors">
            Guardar solo
          </button>
          <button onClick={() => save(true)} disabled={saving || loading || !preview || !!validationErr}
            className="btn-press flex items-center gap-1.5 text-xs bg-[#E8553E] text-white rounded-lg px-4 py-2 hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors font-semibold">
            <CheckCircle size={14} weight="fill" />
            {saving ? "Guardando..." : "Todo bien, procesá"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- GridView ---

function GridView({
  preview, roles, setRole, headerRow, setHeaderRow, firstDataRow, setFirstDataRow, layout,
}: {
  preview: Preview;
  roles: Role[];
  setRole: (idx: number, role: Role) => void;
  headerRow: number;
  setHeaderRow: (n: number) => void;
  firstDataRow: number;
  setFirstDataRow: (n: number) => void;
  layout: Layout;
}) {
  const ignoredRows = preview.rows.slice(0, Math.max(0, headerRow));
  const dataRowsPreview = preview.rows.slice(firstDataRow, Math.min(preview.rows.length, firstDataRow + 8));
  const rangeBetween = preview.rows.slice(headerRow + 1, firstDataRow); // skipped rows between header & data

  return (
    <div className="p-5 space-y-4">
      {/* Ignored / header metadata block */}
      {ignoredRows.length > 0 && (
        <BlockIgnored
          label={`Información de cabecera — ${ignoredRows.length} fila${ignoredRows.length !== 1 ? "s" : ""} NO se agregan`}
          rows={ignoredRows}
          cols={preview.cols}
          onSelectAsHeader={(idx) => { setHeaderRow(idx); if (firstDataRow <= idx) setFirstDataRow(idx + 1); }}
        />
      )}

      {/* Header row block */}
      <BlockHeader
        row={preview.rows[headerRow] ?? []}
        cols={preview.cols}
        roles={roles}
        setRole={setRole}
        layout={layout}
      />

      {/* Between header and data (usually empty or labels) */}
      {rangeBetween.length > 0 && (
        <BlockIgnored
          label={`${rangeBetween.length} fila${rangeBetween.length !== 1 ? "s" : ""} saltada${rangeBetween.length !== 1 ? "s" : ""} antes de los datos`}
          rows={rangeBetween}
          cols={preview.cols}
          onSelectAsHeader={(idx) => { setHeaderRow(headerRow + 1 + idx); }}
          compact
        />
      )}

      {/* Data rows block */}
      <BlockData
        rows={dataRowsPreview}
        cols={preview.cols}
        startRow={firstDataRow}
        totalRows={preview.totalRows}
        roles={roles}
        onMoveFirstDataRow={(delta) => setFirstDataRow(Math.max(headerRow + 1, firstDataRow + delta))}
      />
    </div>
  );
}

// --- Block components ---

function BlockIgnored({
  label, rows, cols, onSelectAsHeader, compact,
}: {
  label: string; rows: string[][]; cols: number;
  onSelectAsHeader: (idx: number) => void; compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-dashed border-[var(--border)] text-[11px] text-[var(--muted)]">
        <Lock size={12} weight="bold" />
        <span>{label}</span>
        <span className="ml-auto text-[10px] text-[var(--muted-light)]">click en una fila para marcarla como títulos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onClick={() => onSelectAsHeader(i)}
                className="border-t border-[var(--border)] first:border-t-0 hover:bg-[var(--background)] cursor-pointer transition-colors opacity-60 hover:opacity-100"
              >
                <td className="px-2 py-1 text-[9px] text-[var(--muted-light)] tabular-nums w-8 text-center">{i}</td>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} className={`px-2 ${compact ? "py-0.5" : "py-1"} text-[11px] text-[var(--muted)] truncate max-w-[180px]`}>
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BlockHeader({
  row, cols, roles, setRole, layout,
}: {
  row: string[]; cols: number; roles: Role[];
  setRole: (idx: number, role: Role) => void; layout: Layout;
}) {
  return (
    <div className="rounded-xl border-2 border-[#F59E0B]/40 bg-[#FEF3C7]/40 dark:bg-[#F59E0B]/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#F59E0B]/30 text-[11px] text-[#92400E] dark:text-[#F59E0B] font-semibold">
        <Table size={12} weight="bold" />
        <span>Fila de títulos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              <th className="w-8" />
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className="px-2 pt-3 pb-1 text-center min-w-[140px]">
                  <ColumnChip role={roles[c] ?? "ignorar"} onChange={(r) => setRole(c, r)} layout={layout} />
                  <div className="flex justify-center mt-1 text-[var(--muted-light)]">
                    <ArrowDown size={12} weight="bold" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-1.5 text-[10px] text-[var(--muted-light)] tabular-nums w-8 text-center">
                T
              </td>
              {Array.from({ length: cols }).map((_, c) => (
                <td
                  key={c}
                  className="px-2 py-2 text-[12px] font-bold text-[var(--foreground)] text-center truncate max-w-[200px]"
                >
                  {row[c] || <span className="text-[var(--muted-light)] italic">(vacío)</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BlockData({
  rows, cols, startRow, totalRows, roles, onMoveFirstDataRow,
}: {
  rows: string[][]; cols: number; startRow: number; totalRows: number;
  roles: Role[]; onMoveFirstDataRow: (delta: number) => void;
}) {
  const realRows = totalRows - startRow;
  return (
    <div className="rounded-xl border-2 border-[#22C55E]/40 bg-[#ECFDF5]/60 dark:bg-[#22C55E]/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#22C55E]/30 text-[11px] font-semibold text-[#166534] dark:text-[#22C55E]">
        <CheckCircle size={12} weight="fill" />
        <span>Estos movimientos se van a agregar</span>
        <span className="text-[10px] text-[var(--muted)] font-normal ml-1">
          {realRows > 0 ? `${realRows} filas desde la fila ${startRow}` : "sin datos"}
        </span>
        <div className="ml-auto flex gap-1">
          <button onClick={() => onMoveFirstDataRow(-1)}
            className="text-[10px] px-2 py-0.5 rounded bg-white dark:bg-white/10 border border-[var(--border)] hover:bg-[var(--surface)] transition-colors">
            ↑ Incluir una fila más arriba
          </button>
          <button onClick={() => onMoveFirstDataRow(1)}
            className="text-[10px] px-2 py-0.5 rounded bg-white dark:bg-white/10 border border-[var(--border)] hover:bg-[var(--surface)] transition-colors">
            ↓ Empezar una más abajo
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols + 1} className="p-6 text-center text-[var(--muted-light)] text-[11px]">
                  No hay datos visibles — subí la primera fila de datos
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-[#22C55E]/15 first:border-t-0">
                <td className="px-2 py-1.5 text-[9px] text-[var(--muted-light)] tabular-nums w-8 text-center">
                  {startRow + i}
                </td>
                {Array.from({ length: cols }).map((_, c) => {
                  const role = roles[c] ?? "ignorar";
                  const meta = ROLES[role];
                  const isIgnored = role === "ignorar";
                  return (
                    <td
                      key={c}
                      className={`px-2 py-1.5 text-[11px] truncate max-w-[200px] tabular-nums ${
                        isIgnored ? "text-[var(--muted-light)]" : "text-[var(--foreground)] font-medium"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 justify-start">
                        {!isIgnored && <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} shrink-0`} />}
                        <span className="truncate">{row[c] ?? ""}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Chip ---

function ColumnChip({
  role, onChange, layout,
}: { role: Role; onChange: (r: Role) => void; layout: Layout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const meta = ROLES[role];

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const availableRoles: Role[] = [
    "ignorar", "fecha", "descripcion", "n_documento",
    ...(layout === "two_cols" ? (["cargo", "abono"] as Role[]) : []),
    ...(layout !== "two_cols" ? (["monto"] as Role[]) : []),
    ...(layout === "single_col" ? (["tipo_flujo"] as Role[]) : []),
    "saldo",
  ];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all hover:scale-105 active:scale-95 ${meta.chip}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        {meta.label}
        <CaretDown size={10} weight="bold" />
      </button>
      {open && (
        <div className="absolute z-30 top-full mt-1 left-1/2 -translate-x-1/2 min-w-[160px] rounded-xl bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden animate-fade-in py-1">
          {availableRoles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { onChange(r); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors ${
                r === role ? "bg-[var(--accent-light)] text-[#E8553E]" : "hover:bg-[var(--surface)] text-[var(--foreground)]"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${ROLES[r].dot}`} />
              {ROLES[r].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      {label && <span className="block text-[10px] text-[var(--muted-light)] font-medium mb-1">{label}</span>}
      {children}
    </label>
  );
}
