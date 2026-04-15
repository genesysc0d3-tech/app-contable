"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, MagicWand, CheckCircle, Warning, Lock, CaretDown, Gear, Table, ArrowDown, CaretRight,
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

// Role → metadata. Chilean bank cartola terms (Cargo/Abono) + en cristiano tooltip.
const ROLES: Record<Role, { label: string; hint: string; dot: string; chip: string }> = {
  ignorar:      { label: "Ignorar",        dot: "bg-[var(--muted-light)]", chip: "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)]",
                  hint: "Esta columna no se usa. Típico: sucursal, oficina, moneda, o datos sin valor contable." },
  fecha:        { label: "Fecha",          dot: "bg-[#3B82F6]",            chip: "bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30",
                  hint: "El día del movimiento. Si hay dos columnas (Fecha operación y Fecha valor), usá la que dice cuándo se registró." },
  descripcion:  { label: "Glosa",          dot: "bg-[#14B8A6]",            chip: "bg-[#14B8A6]/10 text-[#14B8A6] border-[#14B8A6]/30",
                  hint: "El texto del movimiento: a quién se pagó, quién pagó, concepto. También se llama Descripción o Detalle." },
  n_documento:  { label: "N° operación",   dot: "bg-[#6366F1]",            chip: "bg-[#6366F1]/10 text-[#6366F1] border-[#6366F1]/30",
                  hint: "Número único que identifica el movimiento. Los bancos le dicen N° documento, N° operación, Referencia o Folio." },
  cargo:        { label: "Cargo",          dot: "bg-[#E8553E]",            chip: "bg-[#E8553E]/10 text-[#E8553E] border-[#E8553E]/30",
                  hint: "Plata que SALIÓ de la cuenta: pagos, transferencias enviadas, giros. En la cartola aparece como débito o cargo." },
  abono:        { label: "Abono",          dot: "bg-[#22C55E]",            chip: "bg-[#22C55E]/10 text-[#22C55E] border-[#22C55E]/30",
                  hint: "Plata que ENTRÓ a la cuenta: depósitos, transferencias recibidas, cobros. En la cartola aparece como crédito o abono." },
  monto:        { label: "Monto",          dot: "bg-[#F59E0B]",            chip: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30",
                  hint: "La cantidad de plata del movimiento. Usá esta opción si hay UNA sola columna de monto (sin separar cargo y abono)." },
  tipo_flujo:   { label: "Tipo (D/C)",     dot: "bg-[#8B5CF6]",            chip: "bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30",
                  hint: "Columna que dice si cada fila es un Cargo o un Abono. Valores típicos: D/C, Débito/Crédito, Abono/Cargo." },
  saldo:        { label: "Saldo",          dot: "bg-[#64748B]",            chip: "bg-[#64748B]/10 text-[#64748B] border-[#64748B]/30",
                  hint: "Cuánta plata quedó en la cuenta después del movimiento. Sirve para detectar si faltan filas." },
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
    if (findCol("descripcion") < 0) return "Falta asignar la Glosa (descripción del movimiento)";
    if (layout === "two_cols" && findCol("cargo") < 0 && findCol("abono") < 0) {
      return "Asigná Cargo y/o Abono";
    }
    if (layout === "single_col") {
      if (findCol("monto") < 0) return "Asigná Monto";
      if (findCol("tipo_flujo") < 0) return "Asigná la columna de Tipo (D/C)";
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
                <Field label="Formato de fecha" hint="Cómo está escrita la fecha en el Excel. Mirá una fila: si dice 30/01/2026 es dd/mm/yyyy. Si dice 2026-01-30 es yyyy-mm-dd.">
                  <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFmt)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                    <option value="dd/mm/yyyy">dd/mm/yyyy (30/01/2026)</option>
                    <option value="yyyy-mm-dd">yyyy-mm-dd (2026-01-30)</option>
                    <option value="dd-mm-yyyy">dd-mm-yyyy (30-01-2026)</option>
                    <option value="unknown">No sé / mixto</option>
                  </select>
                </Field>
                <Field label="¿Cómo vienen los montos?" hint="Cargo + Abono: típico cartola bancaria chilena, una columna para salidas y otra para entradas. Monto + Tipo: una columna con el monto y otra que dice D/C o Débito/Crédito. Una sola: planilla de ventas o de gastos donde todo es del mismo signo.">
                  <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                    <option value="two_cols">Cargo + Abono separados (cartola típica)</option>
                    <option value="single_col">Monto + Tipo (D/C)</option>
                    <option value="transactions_log">Una sola columna (todos cargos o todos abonos)</option>
                  </select>
                </Field>
                {layout === "transactions_log" && (
                  <Field label="Todos son" hint="Si es planilla de ventas → Abonos. Si es planilla de gastos/pagos → Cargos.">
                    <select value={defaultFlujo} onChange={(e) => setDefaultFlujo(e.target.value as "entrada" | "salida")}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                      <option value="entrada">Abonos (ingresos)</option>
                      <option value="salida">Cargos (egresos)</option>
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
  label, rows, cols, onSelectAsHeader, compact, defaultOpen,
}: {
  label: string; rows: string[][]; cols: number;
  onSelectAsHeader: (idx: number) => void; compact?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--muted)] hover:bg-[var(--surface)] transition-colors"
      >
        <CaretRight size={12} weight="bold" className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        <Lock size={12} weight="bold" />
        <Tooltip content="Datos del titular, cuenta, sucursal, moneda — todo lo que está ANTES de los movimientos. No se importa, es solo contexto.">
          <span className="font-medium cursor-help underline decoration-dotted decoration-[var(--muted-light)] underline-offset-2">{label}</span>
        </Tooltip>
        {open && (
          <span className="ml-auto text-[10px] text-[var(--muted-light)]">
            click en una fila para marcarla como títulos
          </span>
        )}
        {!open && (
          <span className="ml-auto text-[10px] text-[var(--muted-light)]">Mostrar</span>
        )}
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-dashed border-[var(--border)] animate-fade-in">
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
      )}
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
        <Tooltip content="La fila del Excel que contiene los nombres de cada columna (FECHA, MONTO, GLOSA, etc). Sirve para saber qué hay abajo.">
          <span className="cursor-help underline decoration-dotted decoration-[#F59E0B]/50 underline-offset-2">Fila de títulos</span>
        </Tooltip>
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
        <Tooltip content="Cada fila se va a leer como un movimiento bancario. Los colores de los puntitos indican qué rol le asignaste a cada columna.">
          <span className="cursor-help underline decoration-dotted decoration-[#22C55E]/50 underline-offset-2">Estos movimientos se van a agregar</span>
        </Tooltip>
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
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = ROLES[role];

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2, width: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const availableRoles: Role[] = [
    "ignorar", "fecha", "descripcion", "n_documento",
    ...(layout === "two_cols" ? (["cargo", "abono"] as Role[]) : []),
    ...(layout !== "two_cols" ? (["monto"] as Role[]) : []),
    ...(layout === "single_col" ? (["tipo_flujo"] as Role[]) : []),
    "saldo",
  ];

  return (
    <>
      <Tooltip content={meta.hint}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all hover:scale-105 active:scale-95 ${meta.chip}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
          <CaretDown size={10} weight="bold" />
        </button>
      </Tooltip>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
          className="z-[200] min-w-[170px] rounded-xl bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] overflow-hidden animate-fade-in py-1"
        >
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
        </div>,
        document.body,
      )}
    </>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="flex items-center gap-1 text-[10px] text-[var(--muted-light)] font-medium mb-1">
          {label}
          {hint && <Tooltip content={hint}>
            <span className="inline-flex w-3 h-3 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--muted)] text-[8px] font-bold cursor-help">?</span>
          </Tooltip>}
        </span>
      )}
      {children}
    </label>
  );
}

// --- Tooltip with portal (not clipped by overflow containers) ---

function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  function onEnter() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    setShow(true);
  }
  function onLeave() { setShow(false); }

  return (
    <span
      ref={triggerRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      className="inline-block"
    >
      {children}
      {show && pos && typeof document !== "undefined" && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
          className="z-[300] pointer-events-none max-w-[260px] px-2.5 py-1.5 rounded-lg bg-[#1c1c1e] text-white text-[10px] leading-snug shadow-[0_8px_24px_rgba(0,0,0,0.3)] animate-fade-in"
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
}
