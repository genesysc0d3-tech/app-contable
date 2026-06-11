"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import type { AdapterConfig } from "@/lib/parsers/types";

type Role = "ignorar" | "fecha" | "descripcion" | "n_documento" | "cargo" | "abono" | "monto" | "tipo_flujo" | "saldo";
type Layout = "two_cols" | "single_col" | "transactions_log";
type DateFmt = "dd/mm/yyyy" | "yyyy-mm-dd" | "dd-mm-yyyy" | "unknown";

interface Preview {
  sheetName: string; fingerprint: string; totalRows: number; cols: number;
  rows: string[][]; suggested: AdapterConfig | null; suggestedSource: "named" | "heuristic" | null;
}

interface FieldMapperProps { documentoId: string; onClose: () => void; onSaved?: () => void; }

const ROLES: Record<Role, { label: string; hint: string }> = {
  ignorar:      { label: "Ignorar",      hint: "Esta columna no se usa." },
  fecha:        { label: "Fecha",        hint: "El día del movimiento." },
  descripcion:  { label: "Glosa",        hint: "La descripción del movimiento." },
  n_documento:  { label: "N° operación", hint: "Número único del movimiento." },
  cargo:        { label: "Cargo",        hint: "Plata que SALIÓ de la cuenta." },
  abono:        { label: "Abono",        hint: "Plata que ENTRÓ a la cuenta." },
  monto:        { label: "Monto",        hint: "Monto único del movimiento." },
  tipo_flujo:   { label: "Tipo (D/C)",   hint: "Columna que dice Cargo o Abono." },
  saldo:        { label: "Saldo",        hint: "Saldo después del movimiento." },
};

const ROLE_HEX: Record<Role, string> = {
  ignorar: "#64748B", fecha: "#5fa8ff", descripcion: "#2dd4bf", n_documento: "#a78bfa",
  cargo: "#ff7365", abono: "#34d46e", monto: "#f59e0b", tipo_flujo: "#8b5cf6", saldo: "#f47b45",
};

export default function FieldMapper({ documentoId, onClose, onSaved }: FieldMapperProps) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);

  const [roles, setRoles] = useState<Role[]>([]);
  const [columnLabels, setColumnLabels] = useState<string[]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [firstDataRow, setFirstDataRow] = useState(1);
  const [dateFormat, setDateFormat] = useState<DateFmt>("dd/mm/yyyy");
  const [layout, setLayout] = useState<Layout>("two_cols");
  const [defaultFlujo, setDefaultFlujo] = useState<"entrada" | "salida">("entrada");

  useEffect(() => {
    fetch("/api/parser/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documento_id: documentoId }),
    })
      .then(async (res) => {
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "No se pudo cargar preview"); }
        return res.json() as Promise<Preview>;
      })
      .then((data) => {
        setPreview(data);
        const initialRoles = new Array<Role>(data.cols).fill("ignorar");
        if (data.suggested) {
          const s = data.suggested;
          setHeaderRow(s.header_row); setFirstDataRow(s.skip_rows_before_data);
          setDateFormat(s.date_format); setLayout((s.layout ?? "two_cols") as Layout);
          if (s.default_tipo_flujo) setDefaultFlujo(s.default_tipo_flujo);
          const assign = (idx: number | undefined, role: Role) => { if (typeof idx === "number" && idx >= 0 && idx < data.cols) initialRoles[idx] = role; };
          assign(s.columns.fecha, "fecha"); assign(s.columns.descripcion, "descripcion");
          assign(s.columns.n_documento, "n_documento"); assign(s.columns.cargo, "cargo");
          assign(s.columns.abono, "abono"); assign(s.columns.saldo, "saldo");
          assign(s.columns.monto, "monto"); assign(s.columns.tipo_flujo_col, "tipo_flujo");
        }
        setRoles(initialRoles);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [documentoId]);

  useEffect(() => {
    if (!preview) return;
    const vals = preview.rows[headerRow] ?? [];
    setColumnLabels(Array.from({ length: preview.cols }, (_, c) => String(vals[c] ?? "")));
  }, [preview, headerRow]);

  function setRole(idx: number, role: Role) {
    setRoles((prev) => {
      const next = [...prev];
      if (["fecha","descripcion","n_documento","cargo","abono","monto","tipo_flujo","saldo"].includes(role))
        for (let i = 0; i < next.length; i++) if (i !== idx && next[i] === role) next[i] = "ignorar";
      next[idx] = role; return next;
    });
  }

  const findCol = useMemo(() => (role: Role) => roles.findIndex((r) => r === role), [roles]);
  const detected = preview?.suggested !== null && preview?.suggestedSource !== null;
  const totalMapped = roles.filter(r => r !== "ignorar").length;
  const realRows = preview ? Math.max(0, preview.totalRows - firstDataRow) : 0;

  const validationErr = useMemo(() => {
    if (!preview) return null;
    if (findCol("fecha") < 0) return "Falta asignar la columna de Fecha";
    if (findCol("descripcion") < 0) return "Falta asignar la Glosa";
    if (layout === "two_cols" && findCol("cargo") < 0 && findCol("abono") < 0) return "Asigna Cargo y/o Abono";
    if (layout === "single_col") { if (findCol("monto") < 0) return "Asigna Monto"; if (findCol("tipo_flujo") < 0) return "Asigna Tipo"; }
    if (layout === "transactions_log" && findCol("monto") < 0) return "Asigna Monto";
    if (firstDataRow <= headerRow) return "La fila de datos debe estar después de la fila de títulos";
    return null;
  }, [preview, findCol, layout, headerRow, firstDataRow]);

  async function save(reprocess: boolean) {
    if (validationErr) { toast(validationErr, "error"); return; }
    setSaving(true);
    try {
      const config: AdapterConfig = {
        header_row: headerRow, skip_rows_before_data: firstDataRow, date_format: dateFormat,
        number_format: "chilean", layout,
        default_tipo_flujo: layout === "transactions_log" ? defaultFlujo : undefined,
        columns: {
          fecha: findCol("fecha"), descripcion: findCol("descripcion"),
          n_documento: findCol("n_documento"), cargo: layout === "two_cols" ? findCol("cargo") : -1,
          abono: layout === "two_cols" ? findCol("abono") : -1, saldo: findCol("saldo"),
          monto: layout !== "two_cols" ? findCol("monto") : undefined,
          tipo_flujo_col: layout === "single_col" ? findCol("tipo_flujo") : undefined,
        },
      };
      const res = await fetch("/api/parser/save-mapping", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, config, reprocess }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error guardando");
      toast(reprocess ? "Guardado y reprocesando" : "Mapeo guardado");
      onSaved?.(); onClose();
    } catch (err) { toast(err instanceof Error ? err.message : "Error", "error"); }
    setSaving(false);
  }

  const disabled = saving || loading || !preview || !!validationErr;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center",
      padding: 20, background: "rgba(0,0,0,.58)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
    }}>
      <div style={{
        width: "min(1180px, 96vw)", maxHeight: "90vh",
        overflow: "hidden", borderRadius: 20, border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "0 30px 90px rgba(0,0,0,.45), inset 0 1px 0 var(--border)",
        display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", color: "#f6f7fb",
        fontFamily: "'DM Sans','Inter',sans-serif",
      }}>
        {/* HEADER */}
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center",
            background: "rgba(232,85,62,.12)", color: "#E8553E", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M4 9h16M9 4v16M14.5 4v16M4 14h16" stroke="currentColor" strokeWidth="1.4" opacity=".9"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, color: "var(--text)" }}>Mapear campos</div>
            {preview && <div style={{ marginTop: 4, fontSize: 11, color: "var(--text2)", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              {detected
                ? <><CheckCircle size={12} weight="fill" style={{ color: "#34d46e" }} /> Detectamos el formato — revisa que cada columna tenga su rol.</>
                : <><Warning size={12} weight="fill" style={{ color: "#f59e0b" }} /> No reconocimos el formato — asigna el rol de cada columna.</>}
              <span style={{ color: "var(--text3)" }}>· Hoja {preview.sheetName} · {preview.totalRows.toLocaleString("es-CL")} filas</span>
            </div>}
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 18, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        {/* CONTENT */}
        <div style={{ overflow: "auto", padding: "14px 20px", scrollbarWidth: "thin" }}>
          {loading && <div style={{ padding: 80, textAlign: "center", color: "#a4adba" }}><div style={{ height: 20, width: 200, margin: "0 auto 12px", borderRadius: 8, background: "rgba(255,255,255,.06)" }} /><p>Cargando...</p></div>}
          {error && <div style={{ padding: 80, textAlign: "center", color: "#ff7365" }}><Warning size={32} weight="fill" /><p>{error}</p></div>}
          {preview && <GridContent preview={preview} roles={roles} setRole={setRole} headerRow={headerRow}
            firstDataRow={firstDataRow} layout={layout} columnLabels={columnLabels}
            dateFormat={dateFormat} setDateFormat={setDateFormat} setLayout={setLayout}
            defaultFlujo={defaultFlujo} setDefaultFlujo={setDefaultFlujo}
            advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
            ignoredOpen={ignoredOpen} setIgnoredOpen={setIgnoredOpen} />}
        </div>

        {/* FOOTER — siempre visible */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "rgba(255,255,255,.025)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, display: "flex", alignItems: "center", gap: 10 }}>
            {validationErr ? (
              <><span style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid rgba(255,115,101,.65)", color: "#ff7365", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, flexShrink: 0 }}>!</span>
              <div style={{ color: "#ff7365", fontSize: 12, fontWeight: 650 }}>{validationErr}</div></>
            ) : preview ? (
              <><span style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid rgba(52,212,110,.65)", color: "#34d46e", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, flexShrink: 0 }}>✓</span>
              <div>
                <div style={{ color: "#9df2b6", fontSize: 12, fontWeight: 650 }}>Listo para procesar</div>
                <div style={{ color: "var(--text2)", fontSize: 10 }}>{totalMapped} campos asignados · {realRows.toLocaleString("es-CL")} movimientos se van a importar</div>
              </div></>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <button onClick={onClose} style={{ height: 38, padding: "0 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.055)", color: "#f3f6fb", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
            <button onClick={() => save(false)} disabled={disabled}
              style={{ height: 38, padding: "0 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.055)", color: "#f3f6fb", fontWeight: 700, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .4 : 1 }}>
              Guardar sin procesar
            </button>
            <button onClick={() => save(true)} disabled={disabled}
              style={{ height: 38, padding: "0 18px", borderRadius: 10, border: "none", background: "#E8553E", color: "#fff", fontWeight: 800, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer", boxShadow: disabled ? "none" : "0 10px 26px rgba(232,85,62,.28)", opacity: disabled ? .4 : 1 }}>
              {saving ? "Procesando..." : "Procesar movimientos →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GridContent(props: {
  preview: Preview; roles: Role[]; setRole: (idx: number, role: Role) => void;
  headerRow: number; firstDataRow: number; layout: Layout; columnLabels: string[];
  dateFormat: DateFmt; setDateFormat: (f: DateFmt) => void;
  setLayout: (l: Layout) => void; defaultFlujo: "entrada" | "salida";
  setDefaultFlujo: (f: "entrada" | "salida") => void;
  advancedOpen: boolean; setAdvancedOpen: (v: boolean) => void;
  ignoredOpen: boolean; setIgnoredOpen: (v: boolean) => void;
}) {
  const { preview, roles, setRole, headerRow, firstDataRow, layout, columnLabels,
    dateFormat, setDateFormat, setLayout, defaultFlujo, setDefaultFlujo,
    advancedOpen, setAdvancedOpen, ignoredOpen, setIgnoredOpen } = props;
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const ignoredRows = preview.rows.slice(0, Math.max(0, headerRow));
  const rangeBetween = preview.rows.slice(headerRow + 1, firstDataRow);
  const dataPreview = preview.rows.slice(firstDataRow, Math.min(preview.rows.length, firstDataRow + 12));
  const realRows = Math.max(0, preview.totalRows - firstDataRow);
  const cols = preview.cols;

  const emptyCols = useMemo(() => {
    const s = new Set<number>();
    for (let c = 0; c < cols; c++) {
      const h = String(preview.rows[headerRow]?.[c] ?? "").trim();
      const hasData = dataPreview.some(r => String(r[c] ?? "").trim() !== "");
      if (!h && !hasData) s.add(c);
    }
    return s;
  }, [preview, headerRow, dataPreview, cols]);

  function colTint(c: number): React.CSSProperties {
    const r = roles[c] ?? "ignorar";
    if (r === "ignorar") return hoveredCol === c ? { background: "rgba(148,163,184,.08)" } : {};
    const h = ROLE_HEX[r];
    return { background: `${h}${hoveredCol === c ? "2a" : "15"}` };
  }
  const ch = (c: number) => ({ onMouseEnter: () => setHoveredCol(c), onMouseLeave: () => setHoveredCol(null) });
  const totalIgnoradas = ignoredRows.length + rangeBetween.length;

  return (
    <>
      {/* Filas que no se importan — una línea, expandible */}
      {totalIgnoradas > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => setIgnoredOpen(!ignoredOpen)}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,.09)", background: "rgba(255,255,255,.035)", borderRadius: 999, padding: "6px 12px", fontSize: 11, color: "#a4adba", cursor: "pointer" }}>
            <span style={{ color: "#94a3b8" }}>◌</span>
            {totalIgnoradas} fila{totalIgnoradas !== 1 ? "s" : ""} de encabezado no se importar{totalIgnoradas !== 1 ? "án" : "á"} (títulos del banco, totales)
            <span style={{ color: "#6f7b8b" }}>{ignoredOpen ? "▴" : "▾"}</span>
          </button>
          {ignoredOpen && (
            <div style={{ marginTop: 8, padding: "8px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.025)" }}>
              {[...ignoredRows, ...rangeBetween].map((row, ri) => (
                <div key={ri} style={{ fontSize: 11, color: "#8b95a5", padding: "2px 0" }}>
                  Fila {ri}: {row.filter(v => String(v ?? "").trim()).slice(0, 4).join(" · ") || "(vacía)"}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabla unificada: rol + título por columna, datos debajo — siempre alineados */}
      <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, background: "rgba(6,13,22,.33)", overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "52vh", scrollbarWidth: "thin" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", top: 0, zIndex: 3, width: 40, padding: "10px 8px", background: "#10161f", borderBottom: "1px solid rgba(255,255,255,.1)", borderRight: "1px solid rgba(255,255,255,.07)" }}>
                  <span style={{ fontSize: 9, color: "#6f7b8b", fontWeight: 700 }}>#</span>
                </th>
                {Array.from({ length: cols }).map((_, c) => {
                  const isEmpty = emptyCols.has(c);
                  return (
                    <th key={c} {...ch(c)} style={{ position: "sticky", top: 0, zIndex: 3, padding: isEmpty ? "10px 4px" : "10px 8px 8px", background: "#10161f", borderBottom: "1px solid rgba(255,255,255,.1)", borderRight: c < cols - 1 ? "1px solid rgba(255,255,255,.07)" : "none", textAlign: "center", verticalAlign: "top", minWidth: isEmpty ? 28 : 96 }}>
                      {isEmpty ? (
                        <span style={{ color: "#3d4654", fontSize: 11 }}>—</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                          <ColumnChip role={roles[c] ?? "ignorar"} onChange={(r) => setRole(c, r)} layout={layout} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: "#8b95a5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>
                            {columnLabels[c] || <span style={{ fontStyle: "italic", color: "#5a6475" }}>sin título</span>}
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
                <tr><td colSpan={cols + 1} style={{ padding: 24, textAlign: "center", color: "#6f7b8b", fontSize: 12 }}>No hay datos visibles</td></tr>
              )}
              {dataPreview.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ width: 40, textAlign: "center", padding: "9px 8px", color: "#6f7b8b", fontSize: 11, background: "rgba(255,255,255,.025)", borderBottom: "1px solid rgba(255,255,255,.06)", borderRight: "1px solid rgba(255,255,255,.07)" }}>{firstDataRow + ri}</td>
                  {Array.from({ length: cols }).map((_, c) => {
                    const isEmpty = emptyCols.has(c);
                    return (
                      <td key={c} {...ch(c)}
                        style={{ ...colTint(c), padding: isEmpty ? "9px 4px" : "9px 10px", borderBottom: "1px solid rgba(255,255,255,.06)", borderRight: c < cols - 1 ? "1px solid rgba(255,255,255,.07)" : "none", fontSize: 12, color: "#e8edf5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
                        {isEmpty ? "" : (row[c] ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "7px 12px", borderTop: "1px solid rgba(255,255,255,.06)", fontSize: 10, color: "#6f7b8b", display: "flex", justifyContent: "space-between" }}>
          <span>Vista previa de lo que se va a importar — pasa el mouse por una columna para ver su rol.</span>
          <span>Mostrando {dataPreview.length} de {realRows.toLocaleString("es-CL")} movimientos</span>
        </div>
      </div>

      {/* Ajustes avanzados */}
      <div style={{ marginTop: 12, border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "rgba(255,255,255,.03)", padding: "12px 16px" }}>
        <div onClick={() => setAdvancedOpen(!advancedOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: advancedOpen ? 14 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, color: "#a4adba" }}>⚙</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 650 }}>Ajustes avanzados</div>
              <div style={{ marginTop: 2, color: "#a4adba", fontSize: 11 }}>Formato de fecha y cómo vienen los montos. Normalmente no necesitas tocarlos.</div>
            </div>
          </div>
          <span style={{ color: "#a4adba" }}>{advancedOpen ? "▴" : "⌄"}</span>
        </div>
        {advancedOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Field label="Formato de fecha" hint="Cómo está escrita la fecha en el Excel. Ej.: 30/04/2026">
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFmt)}
                style={{ width: "100%", height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,.13)", background: "rgba(5,11,20,.28)", color: "#ecf1f8", padding: "0 12px", fontSize: 12 }}>
                <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                <option value="yyyy-mm-dd">YYYY-MM-DD</option>
                <option value="dd-mm-yyyy">DD-MM-YYYY</option>
                <option value="unknown">No sé</option>
              </select>
            </Field>
            <Field label="¿Cómo vienen los montos?" hint="Cargo y Abono en columnas separadas (lo típico de los bancos chilenos), o un solo monto.">
              <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}
                style={{ width: "100%", height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,.13)", background: "rgba(5,11,20,.28)", color: "#ecf1f8", padding: "0 12px", fontSize: 12 }}>
                <option value="two_cols">Cargo + Abono separados</option>
                <option value="single_col">Monto + columna Tipo (D/C)</option>
                <option value="transactions_log">Una sola columna de monto</option>
              </select>
            </Field>
            {layout === "transactions_log" && (
              <Field label="Esos montos, ¿entran o salen?" hint="Solo aplica cuando hay una única columna de monto sin indicador.">
                <select value={defaultFlujo} onChange={(e) => setDefaultFlujo(e.target.value as "entrada" | "salida")}
                  style={{ width: "100%", height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,.13)", background: "rgba(5,11,20,.28)", color: "#ecf1f8", padding: "0 12px", fontSize: 12 }}>
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
    ...(layout === "two_cols" ? ["cargo", "abono"] as Role[] : []),
    ...(layout !== "two_cols" ? ["monto"] as Role[] : []),
    ...(layout === "single_col" ? ["tipo_flujo"] as Role[] : []), "saldo"];

  return (
    <>
      <Tooltip content={meta.hint}>
        <button ref={btnRef} onClick={() => setOpen(v => !v)}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            height: 28, borderRadius: 9, padding: "0 10px", fontSize: 11, fontWeight: 720, cursor: "pointer",
            border: "1px solid currentColor", background: "rgba(255,255,255,.04)",
            color: ROLE_HEX[role] ?? "#64748B",
            transition: "all .15s",
          }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", boxShadow: "0 0 12px currentColor" }} />
          {meta.label} <span style={{ opacity: .8, fontSize: 9 }}>⌄</span>
        </button>
      </Tooltip>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)", zIndex: 200, minWidth: 190, borderRadius: 12, background: "#1c1c1e", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 12px 32px rgba(0,0,0,.5)", overflow: "hidden", padding: "4px 0" }}>
          {opciones.map(r => (
            <button key={r} onClick={() => { onChange(r); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", fontSize: 11,
                border: "none", cursor: "pointer", textAlign: "left",
                background: r === role ? "rgba(232,85,62,.13)" : "transparent",
                color: r === role ? "#E8553E" : "#e8eaf0",
              }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_HEX[r] ?? "#64748B", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{ROLES[r].label}</span>
              <span style={{ fontSize: 9, color: "#8b95a5" }}>{ROLES[r].hint}</span>
            </button>
          ))}
        </div>, document.body
      )}
    </>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#e4eaf4", fontSize: 12, fontWeight: 700, marginBottom: 7 }}>
        {label}
        {hint && <Tooltip content={hint}><span style={{ width: 15, height: 15, borderRadius: "50%", border: "1px solid rgba(255,255,255,.14)", color: "#a4adba", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, cursor: "help" }}>?</span></Tooltip>}
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
        <div style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)", zIndex: 300, pointerEvents: "none", maxWidth: 260, padding: "8px 12px", borderRadius: 8, background: "#1c1c1e", color: "#fff", fontSize: 10, lineHeight: 1.4, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }}>{content}</div>, document.body
      )}
    </span>
  );
}
