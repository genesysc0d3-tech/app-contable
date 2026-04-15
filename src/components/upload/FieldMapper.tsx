"use client";

import { useEffect, useState } from "react";
import { X, MagicWand, FloppyDisk, Warning } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

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
}

interface FieldMapperProps {
  documentoId: string;
  onClose: () => void;
  onSaved?: () => void;
}

const ROLE_LABELS: Record<Role, string> = {
  ignorar: "Ignorar",
  fecha: "Fecha",
  descripcion: "Descripción",
  n_documento: "N° documento",
  cargo: "Cargo (salida)",
  abono: "Abono (entrada)",
  monto: "Monto",
  tipo_flujo: "Tipo flujo (Abono/Cargo)",
  saldo: "Saldo",
};

export default function FieldMapper({ documentoId, onClose, onSaved }: FieldMapperProps) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        setRoles(new Array(data.cols).fill("ignorar"));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [documentoId]);

  function setRole(idx: number, role: Role) {
    setRoles((prev) => {
      const next = [...prev];
      // Enforce single-assignment for roles that must be unique
      const unique: Role[] = ["fecha", "descripcion", "n_documento", "cargo", "abono", "monto", "tipo_flujo", "saldo"];
      if (unique.includes(role)) {
        for (let i = 0; i < next.length; i++) if (i !== idx && next[i] === role) next[i] = "ignorar";
      }
      next[idx] = role;
      return next;
    });
  }

  function findCol(role: Role): number {
    const idx = roles.findIndex((r) => r === role);
    return idx;
  }

  function validate(): string | null {
    if (findCol("fecha") < 0) return "Asigná una columna a Fecha";
    if (findCol("descripcion") < 0) return "Asigná una columna a Descripción";
    if (layout === "two_cols") {
      if (findCol("cargo") < 0 && findCol("abono") < 0) {
        return "Asigná al menos Cargo o Abono para layout two_cols";
      }
    } else if (layout === "single_col") {
      if (findCol("monto") < 0) return "Asigná columna Monto para layout single_col";
      if (findCol("tipo_flujo") < 0) return "Asigná columna Tipo flujo para single_col";
    } else if (layout === "transactions_log") {
      if (findCol("monto") < 0) return "Asigná columna Monto para transactions_log";
    }
    if (firstDataRow <= headerRow) return "Primera fila de datos debe ser mayor que fila de headers";
    return null;
  }

  async function save(reprocess: boolean) {
    const err = validate();
    if (err) {
      toast(err, "error");
      return;
    }
    setSaving(true);
    try {
      const config = {
        header_row: headerRow,
        skip_rows_before_data: firstDataRow,
        date_format: dateFormat,
        number_format: "chilean" as const,
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
      toast(reprocess ? "Mapeo guardado, reprocesando..." : "Mapeo guardado");
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-[20px] bg-white dark:bg-[#1c1c1e] border border-[var(--border)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] text-[#E8553E] flex items-center justify-center">
            <MagicWand size={20} weight="bold" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold">Mapear campos</h2>
            <p className="text-xs text-[var(--muted-light)]">
              Arrastrá los roles a cada columna. Se guarda para próximos archivos similares.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition-colors" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && <div className="p-10 text-center text-[var(--muted)]">Cargando preview...</div>}
          {error && (
            <div className="p-10 text-center">
              <Warning size={32} weight="fill" className="mx-auto text-[#E8553E] mb-2" />
              <p className="text-sm text-[#E8553E]">{error}</p>
            </div>
          )}
          {preview && (
            <>
              {/* Form controls */}
              <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface)]/40 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <Field label="Fila de headers (0-based)">
                  <input type="number" min={0} value={headerRow}
                    onChange={(e) => setHeaderRow(parseInt(e.target.value) || 0)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5" />
                </Field>
                <Field label="Primera fila de datos">
                  <input type="number" min={1} value={firstDataRow}
                    onChange={(e) => setFirstDataRow(parseInt(e.target.value) || 1)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5" />
                </Field>
                <Field label="Formato fecha">
                  <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFmt)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                    <option value="dd/mm/yyyy">dd/mm/yyyy</option>
                    <option value="yyyy-mm-dd">yyyy-mm-dd</option>
                    <option value="dd-mm-yyyy">dd-mm-yyyy</option>
                    <option value="unknown">desconocido</option>
                  </select>
                </Field>
                <Field label="Layout">
                  <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                    <option value="two_cols">Cargo + Abono</option>
                    <option value="single_col">Monto + Tipo flujo</option>
                    <option value="transactions_log">Solo montos (un lado)</option>
                  </select>
                </Field>
                {layout === "transactions_log" && (
                  <Field label="Todos los montos son">
                    <select value={defaultFlujo} onChange={(e) => setDefaultFlujo(e.target.value as "entrada" | "salida")}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                      <option value="entrada">Entrada</option>
                      <option value="salida">Salida</option>
                    </select>
                  </Field>
                )}
              </div>

              {/* Grid */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--background)] z-10">
                    <tr>
                      <th className="px-2 py-2 text-[10px] text-[var(--muted-light)] font-medium w-10 text-center">#</th>
                      {Array.from({ length: preview.cols }).map((_, colIdx) => (
                        <th key={colIdx} className="px-2 py-2 min-w-[140px]">
                          <select
                            value={roles[colIdx] ?? "ignorar"}
                            onChange={(e) => setRole(colIdx, e.target.value as Role)}
                            className={`w-full rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                              roles[colIdx] && roles[colIdx] !== "ignorar"
                                ? "border-[#E8553E] bg-[var(--accent-light)] text-[#E8553E]"
                                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
                            }`}
                          >
                            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                          <p className="text-[9px] text-[var(--muted-light)] text-center mt-1">col {colIdx}</p>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, rowIdx) => {
                      const isHeader = rowIdx === headerRow;
                      const isFirstData = rowIdx === firstDataRow;
                      return (
                        <tr
                          key={rowIdx}
                          className={`border-t border-[var(--border)] ${
                            isHeader ? "bg-[#FEF3C7] dark:bg-[#F59E0B]/20"
                              : isFirstData ? "bg-[var(--accent-light)]/50"
                              : ""
                          }`}
                        >
                          <td className="px-2 py-1.5 text-[10px] text-[var(--muted-light)] tabular-nums text-center">
                            {rowIdx}
                          </td>
                          {Array.from({ length: preview.cols }).map((_, colIdx) => (
                            <td key={colIdx} className="px-2 py-1.5 text-[11px] text-[var(--foreground)] truncate max-w-[200px]">
                              {row[colIdx] ?? ""}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-3 text-[10px] text-[var(--muted-light)] flex items-center gap-3 flex-wrap">
                <span>Hoja: <b>{preview.sheetName}</b></span>
                <span>· {preview.totalRows} filas totales</span>
                <span>· {preview.cols} columnas</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded bg-[#FEF3C7] dark:bg-[#F59E0B]/20 border border-[#F59E0B]/40" />
                  Fila de headers
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded bg-[var(--accent-light)]" />
                  Primera fila de datos
                </span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--surface)]/40">
          <button onClick={onClose}
            className="btn-press text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-3 py-2 transition-colors">
            Cancelar
          </button>
          <button onClick={() => save(false)} disabled={saving || loading || !preview}
            className="btn-press flex items-center gap-1.5 text-xs text-[#E8553E] border border-[#E8553E] rounded-lg px-3 py-2 hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors">
            <FloppyDisk size={14} weight="bold" /> Guardar solo
          </button>
          <button onClick={() => save(true)} disabled={saving || loading || !preview}
            className="btn-press flex items-center gap-1.5 text-xs bg-[#E8553E] text-white rounded-lg px-3 py-2 hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors">
            <MagicWand size={14} weight="bold" />
            {saving ? "Guardando..." : "Guardar y reprocesar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-[var(--muted-light)] font-medium mb-1">{label}</span>
      {children}
    </label>
  );
}
