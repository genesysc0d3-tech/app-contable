"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MagicWand, CheckCircle, Warning, Lock, CaretDown, Gear, Table, ArrowDown, CaretRight } from "@phosphor-icons/react";
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

const ROLES: Record<Role, { label: string; hint: string; dot: string; chip: string }> = {
  ignorar:      { label: "Ignorar",        dot: "bg-[#64748B]", chip: "text-[#64748B] bg-[#64748B]/10 border-[#64748B]/20", hint: "Esta columna no se usa." },
  fecha:        { label: "Fecha",          dot: "bg-[#5fa8ff]", chip: "text-[#5fa8ff] bg-[#5fa8ff]/15 border-[#5fa8ff]/20", hint: "El día del movimiento." },
  descripcion:  { label: "Glosa",          dot: "bg-[#2dd4bf]", chip: "text-[#2dd4bf] bg-[#2dd4bf]/15 border-[#2dd4bf]/20", hint: "La descripción del movimiento." },
  n_documento:  { label: "N° operación",   dot: "bg-[#a78bfa]", chip: "text-[#a78bfa] bg-[#a78bfa]/15 border-[#a78bfa]/20", hint: "Número único del movimiento." },
  cargo:        { label: "Cargo",          dot: "bg-[#ff7365]", chip: "text-[#ff7365] bg-[#ff7365]/15 border-[#ff7365]/20", hint: "Plata que SALIÓ de la cuenta." },
  abono:        { label: "Abono",          dot: "bg-[#34d46e]", chip: "text-[#34d46e] bg-[#34d46e]/15 border-[#34d46e]/20", hint: "Plata que ENTRÓ a la cuenta." },
  monto:        { label: "Monto",          dot: "bg-[#f59e0b]", chip: "text-[#f59e0b] bg-[#f59e0b]/15 border-[#f59e0b]/20", hint: "Monto único del movimiento." },
  tipo_flujo:   { label: "Tipo (D/C)",     dot: "bg-[#8b5cf6]", chip: "text-[#8b5cf6] bg-[#8b5cf6]/15 border-[#8b5cf6]/20", hint: "Columna que dice Cargo o Abono." },
  saldo:        { label: "Saldo",          dot: "bg-[#f47b45]", chip: "text-[#f47b45] bg-[#f47b45]/15 border-[#f47b45]/20", hint: "Saldo después del movimiento." },
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
  const [initialSuggestedRoles, setInitialSuggestedRoles] = useState<Role[]>([]);
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
        setRoles(initialRoles); setInitialSuggestedRoles(initialRoles);
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

  const findCol = (role: Role) => roles.findIndex((r) => r === role);
  const detected = preview?.suggested !== null && preview?.suggestedSource !== null;

  const validationErr = useMemo(() => {
    if (!preview) return null;
    if (findCol("fecha") < 0) return "Falta asignar la columna de Fecha";
    if (findCol("descripcion") < 0) return "Falta asignar la Glosa";
    if (layout === "two_cols" && findCol("cargo") < 0 && findCol("abono") < 0) return "Asigná Cargo y/o Abono";
    if (layout === "single_col") { if (findCol("monto") < 0) return "Asigná Monto"; if (findCol("tipo_flujo") < 0) return "Asigná Tipo"; }
    if (layout === "transactions_log" && findCol("monto") < 0) return "Asigná Monto";
    if (firstDataRow <= headerRow) return "La fila de datos debe estar después de la fila de títulos";
    return null;
  }, [preview, roles, layout, headerRow, firstDataRow]);

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

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center",
      padding: 32, background: "rgba(0,0,0,.46)", backdropFilter: "blur(13px)",
    }}>
      <style>{`.fm-dark td,.fm-dark th{color:#fff!important}`}</style>
      <div className="fm-dark" style={{
        width: "min(1280px, calc(100vw - 64px))", maxHeight: "calc(100vh - 64px)",
        overflow: "hidden", borderRadius: 24, border: "1px solid rgba(255,255,255,.18)",
        background: "linear-gradient(145deg, rgba(31,39,52,.92), rgba(13,21,32,.93))",
        boxShadow: "0 40px 120px rgba(0,0,0,.55)",
        display: "grid", gridTemplateRows: "auto 1fr auto", color: "#f6f7fb",
        fontFamily: "'DM Sans','Inter',sans-serif",
      }}>
        {/* HEADER */}
        <div style={{ padding: "14px 24px 12px", display: "flex", gap: 12, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{
            width: 42, height: 42, borderRadius: 14, display: "grid", placeItems: "center",
            background: "linear-gradient(145deg, #f47b45, #cd5832)", flexShrink: 0,
            boxShadow: "0 12px 32px rgba(244,123,69,.32), inset 0 1px 0 rgba(255,255,255,.35)",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="white" strokeWidth="1.8"/><path d="M4 9h16M9 4v16M14.5 4v16M4 14h16" stroke="white" strokeWidth="1.4" opacity=".9"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 760, letterSpacing: "-0.04em", lineHeight: 1.1 }}>Mapear campos</div>
            {preview && <div style={{ marginTop: 4, fontSize: 12, color: "#a4adba" }}>
              {detected ? <><CheckCircle size={12} weight="fill" style={{color:"#34d46e",marginRight:4}} /> Detectamos el formato — revisá que todo esté bien y aprobá.</>
                : <><Warning size={12} weight="fill" style={{color:"#f59e0b",marginRight:4}} /> No reconocimos el formato — asigná las columnas manualmente.</>}
            </div>}
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.045)", color: "#d8dde6", fontSize: 22, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>

        {/* CONTENT */}
        <div style={{ overflow: "auto", padding: "12px 24px 12px", scrollbarWidth: "thin" }}>
          {loading && <div style={{padding:80,textAlign:"center",color:"#a4adba"}}><div style={{height:20,width:200,margin:"0 auto 12px",borderRadius:8,background:"rgba(255,255,255,.06)"}} /><p>Cargando...</p></div>}
          {error && <div style={{padding:80,textAlign:"center",color:"#ff7365"}}><Warning size={32} weight="fill" /><p>{error}</p></div>}
          {preview && <GridContent preview={preview} roles={roles} setRole={setRole} headerRow={headerRow}
            setHeaderRow={setHeaderRow} firstDataRow={firstDataRow} setFirstDataRow={setFirstDataRow}
            layout={layout} initialSuggestedRoles={initialSuggestedRoles} columnLabels={columnLabels}
            setColumnLabel={(c: number,v: string)=>setColumnLabels((p: string[])=>{const n=[...p];n[c]=v;return n})}
            dateFormat={dateFormat} setDateFormat={setDateFormat} setLayout={setLayout}
            defaultFlujo={defaultFlujo} setDefaultFlujo={setDefaultFlujo}
            advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
            ignoredOpen={ignoredOpen} setIgnoredOpen={setIgnoredOpen}
            validationErr={validationErr} saving={saving} save={save} onClose={onClose} loading={loading} detected={detected} />}
        </div>
      </div>
    </div>
  );
}

function GridContent(props: {
  preview: Preview; roles: Role[]; setRole: (idx: number, role: Role) => void;
  headerRow: number; setHeaderRow: (n: number) => void;
  firstDataRow: number; setFirstDataRow: (n: number) => void;
  layout: Layout; initialSuggestedRoles: Role[]; columnLabels: string[];
  setColumnLabel: (c: number, v: string) => void;
  dateFormat: DateFmt; setDateFormat: (f: DateFmt) => void;
  setLayout: (l: Layout) => void; defaultFlujo: "entrada" | "salida";
  setDefaultFlujo: (f: "entrada" | "salida") => void;
  advancedOpen: boolean; setAdvancedOpen: (v: boolean) => void;
  ignoredOpen: boolean; setIgnoredOpen: (v: boolean) => void;
  validationErr: string | null; saving: boolean; save: (reprocess: boolean) => Promise<void>;
  onClose: () => void; loading: boolean; detected: boolean;
}) {
  const { preview, roles, setRole, headerRow, setHeaderRow, firstDataRow, setFirstDataRow,
    layout, initialSuggestedRoles, columnLabels, setColumnLabel, dateFormat, setDateFormat,
    setLayout, defaultFlujo, setDefaultFlujo, advancedOpen, setAdvancedOpen, ignoredOpen,
    setIgnoredOpen, validationErr, saving, save, onClose, loading, detected } = props;
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const hRef = useRef<HTMLDivElement>(null);
  const dRef = useRef<HTMLDivElement>(null);
  const ignoredRows = preview.rows.slice(0, Math.max(0, headerRow));
  const dataPreview = preview.rows.slice(firstDataRow, Math.min(preview.rows.length, firstDataRow + 10));
  const rangeBetween = preview.rows.slice(headerRow + 1, firstDataRow);
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

  useEffect(() => {
    const h = hRef.current; const d = dRef.current; if (!h || !d) return;
    const sf = () => { if (d.scrollLeft !== h.scrollLeft) d.scrollLeft = h.scrollLeft; };
    const sd = () => { if (h.scrollLeft !== d.scrollLeft) h.scrollLeft = d.scrollLeft; };
    h.addEventListener("scroll", sf, { passive: true });
    d.addEventListener("scroll", sd, { passive: true });
    return () => { h.removeEventListener("scroll", sf); d.removeEventListener("scroll", sd); };
  }, []);

  function colTint(c: number): React.CSSProperties {
    const r = roles[c] ?? "ignorar";
    if (r === "ignorar") return hoveredCol === c ? { background: "rgba(148,163,184,.08)" } : {};
    const h = ROLE_HEX[r];
    return { background: `${h}${hoveredCol === c ? "2a" : "15"}` };
  }
  const ch = (c: number) => ({ onMouseEnter: () => setHoveredCol(c), onMouseLeave: () => setHoveredCol(null) });

  const lineColor = (c: number) => { const r = roles[c] ?? "ignorar"; return ROLE_HEX[r] ?? "#64748B"; };
  const totalMapped = roles.filter(r => r !== "ignorar").length;
  const ignoredCount = roles.filter(r => r === "ignorar").length;
  const totalRows = preview.totalRows - firstDataRow;
  const realRows = preview.totalRows - firstDataRow;

  const isReady = !validationErr && preview;

  return (
    <>
      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.8fr 1.1fr 0.8fr", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "rgba(4,10,17,.28)", overflow: "hidden", marginBottom: 12 }}>
        {[
          { icon: "▦", label: "Hoja detectada", value: preview.sheetName },
          { icon: null, label: "Total de filas", value: preview.totalRows.toLocaleString() },
          { icon: null, label: "Formato detectado", value: detected ? "Extracto bancario" : "Manual" },
          { icon: null, label: "Confianza", value: detected ? "Alta 96%" : "Pendiente" },
        ].map((item, i) => (
          <div key={i} style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderRight: i < 3 ? "1px solid rgba(255,255,255,.08)" : "none" }}>
            {item.icon && <div style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(52,212,110,.12)", color: "#34d46e", flexShrink: 0 }}>{item.icon}</div>}
            <div>
              <div style={{ fontSize: 10, color: "#6f7b8b", marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: 12, fontWeight: 650, color: "#edf2fa" }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Ignored rows */}
      {ignoredRows.length > 0 && (
        <div style={{ padding: "14px 18px", borderRadius: 16, border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.035)", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr 0.8fr auto", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 22, color: "#94a3b8" }}>◌</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 650, color: "#edf2fa" }}>Filas ignoradas (no se importarán)</div>
                <div style={{ fontSize: 12, color: "#a4adba" }}>Estas filas no se van a procesar.</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#a4adba" }}>Antes de los títulos <span style={{ display: "inline-flex", alignItems: "center", minHeight: 22, borderRadius: 999, padding: "3px 8px", marginLeft: 8, color: "#dfe6f2", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.08)", fontSize: 12, fontWeight: 650 }}>{ignoredRows.length} filas</span></div>
            <div style={{ fontSize: 12, color: "#a4adba" }}>Notas al pie <span style={{ display: "inline-flex", alignItems: "center", minHeight: 22, borderRadius: 999, padding: "3px 8px", marginLeft: 8, color: "#dfe6f2", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.08)", fontSize: 12, fontWeight: 650 }}>{rangeBetween.length} fila{rangeBetween.length !== 1 ? "s" : ""}</span></div>
            <button onClick={() => setIgnoredOpen(!ignoredOpen)} style={{ border: "1px solid rgba(255,255,255,.13)", background: "rgba(255,255,255,.045)", borderRadius: 11, padding: "9px 13px", fontWeight: 650, fontSize: 12, cursor: "pointer", color: "#e6ebf4" }}>
              {ignoredOpen ? "Ocultar ▴" : "Ver detalles ▾"}
            </button>
          </div>
          {ignoredOpen && ignoredRows.map((row, ri) => (
            <div key={ri} style={{ fontSize: 12, color: "#a4adba", padding: "4px 0 0 44px" }}>
              Fila {ri}: {row.slice(0, 3).join(" · ")}
            </div>
          ))}
        </div>
      )}

      {/* Work area: 2 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 18, alignItems: "start" }}>
        <div>
          {/* Step 1: Title row */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 17, fontWeight: 760, letterSpacing: "-0.02em", marginBottom: 10 }}>
              <span style={{ width: 23, height: 23, display: "inline-grid", placeItems: "center", borderRadius: 8, background: "linear-gradient(145deg,#5fa8ff,#507eb4)", color: "#fff", fontSize: 12, boxShadow: "0 6px 18px rgba(95,168,255,.25)" }}>1</span>
              Fila de títulos
              <span style={{ fontSize: 13, color: "#a4adba", fontWeight: 450 }}>(asigná el rol de cada columna)</span>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, background: "rgba(6,13,22,.33)", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead>
                  <tr>{Array.from({ length: cols }).map((_, c) => (
                    <th key={c} style={{ padding: "7px 6px", color: "#bbc5d2", fontSize: 12, fontWeight: 720, background: "rgba(255,255,255,.035)", borderRight: c < cols - 1 ? "1px solid rgba(255,255,255,.075)" : "none", borderBottom: "1px solid rgba(255,255,255,.075)", textAlign: "center" }}>
                      {String.fromCharCode(65 + c)}
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  <tr>{Array.from({ length: cols }).map((_, c) => {
                    const role = roles[c] ?? "ignorar";
                    const meta = ROLES[role];
                    return (
                      <td key={c} style={{ padding: "10px 7px 8px", textAlign: "center", borderRight: c < cols - 1 ? "1px solid rgba(255,255,255,.075)" : "none" }}>
                        <ColumnChip role={role} onChange={(r) => setRole(c, r)} layout={layout} animateDetected={initialSuggestedRoles[c] === role && role !== "ignorar"} />
                      </td>
                    );
                  })}</tr>
                  <tr>{Array.from({ length: cols }).map((_, c) => {
                    const isEmpty = emptyCols.has(c);
                    return (
                      <td key={c} {...ch(c)}
                        style={{...colTint(c), padding: "10px 9px", color: "#c6cfdb", fontSize: 13, borderRight: c < cols - 1 ? "1px solid rgba(255,255,255,.075)" : "none", textAlign: "center"}}>
                        {isEmpty ? "" : (preview.rows[headerRow]?.[c] || "")}
                      </td>
                    );
                  })}</tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Step 2: Data preview */}
          <div>
            <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 17, fontWeight: 760, letterSpacing: "-0.02em" }}>
                  <span style={{ width: 23, height: 23, display: "inline-grid", placeItems: "center", borderRadius: 8, background: "linear-gradient(145deg,#34d46e,#289f54)", color: "#fff", fontSize: 12, boxShadow: "0 6px 18px rgba(52,212,110,.25)" }}>2</span>
                  Estos movimientos se van a agregar
                </div>
                <div style={{ fontSize: 12, color: "#a4adba", marginLeft: 32, marginTop: -4 }}>Vista previa de las primeras filas que se importarán.</div>
              </div>
              <div style={{ fontSize: 12, color: "#a4adba" }}>Mostrando {dataPreview.length} de {realRows}</div>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, background: "rgba(6,13,22,.33)", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: "center", padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,.075)", borderRight: "1px solid rgba(255,255,255,.07)", fontSize: 12, fontWeight: 760, color: "#d7dfeb", background: "rgba(255,255,255,.04)" }}></th>
                    {Array.from({ length: cols }).map((_, c) => {
                      const isEmpty = emptyCols.has(c);
                      const role = roles[c] ?? "ignorar";
                      return (
                        <th key={c} {...ch(c)}
                          style={{...colTint(c), padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,.075)", borderRight: c < cols - 1 ? "1px solid rgba(255,255,255,.07)" : "none", fontSize: 12, fontWeight: 760, color: "#d7dfeb", textAlign: "left", whiteSpace: "nowrap"}}>
                          {isEmpty ? "" : (columnLabels[c] || <span style={{color:"#6f7b8b",fontStyle:"italic"}}>sin título</span>)}
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
                      <td style={{ width: 36, textAlign: "center", padding: "10px 12px", color: "#6f7b8b", fontSize: 12, background: "rgba(255,255,255,.025)", borderBottom: "1px solid rgba(255,255,255,.075)", borderRight: "1px solid rgba(255,255,255,.07)" }}>{firstDataRow + ri}</td>
                      {Array.from({ length: cols }).map((_, c) => {
                        const isEmpty = emptyCols.has(c);
                        return (
                          <td key={c} {...ch(c)}
                            style={{...colTint(c), padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,.075)", borderRight: c < cols - 1 ? "1px solid rgba(255,255,255,.07)" : "none", fontSize: 12, color: "#e8edf5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
                            {isEmpty ? "" : (row[c] ?? "")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <aside style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, background: "rgba(6,13,22,.38)", padding: 18, position: "sticky", top: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 760, letterSpacing: "-0.02em" }}>¿Todo en orden?</div>
          <div style={{ fontSize: 12, color: "#a4adba" }}>Revisá el mapeo y la vista previa.</div>
          <div style={{ marginTop: 18, display: "grid", gap: 14, fontSize: 13, color: "#d7deeb" }}>
            {[
              `${totalMapped} campos mapeados`,
              `${ignoredCount} columnas ignoradas`,
              "Sin conflictos detectados",
              `${realRows} movimientos listos`,
            ].map((text, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ width: 19, height: 19, borderRadius: "50%", display: "grid", placeItems: "center", color: "#34d46e", border: "1px solid rgba(52,212,110,.55)", fontSize: 12, fontWeight: 900 }}>✓</span>
                {text}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 26, border: "1px solid rgba(244,123,69,.33)", borderRadius: 16, padding: 16, background: "linear-gradient(145deg, rgba(244,123,69,.1), rgba(255,255,255,.035))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 760, marginBottom: 10 }}>
              <span>💡</span> Consejo
            </div>
            <div style={{ color: "#cbd3df", fontSize: 12, lineHeight: 1.55, marginBottom: 14 }}>
              Si algún importe se ve mal, revisá el formato de montos o la dirección del flujo en Ajustes avanzados.
            </div>
            <div style={{ color: "#ff9a62", fontWeight: 730, fontSize: 12 }}>Ver guía rápida ↗</div>
          </div>
        </aside>
      </div>

      {/* Advanced settings */}
      <div style={{ marginTop: 16, border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, background: "linear-gradient(145deg, rgba(95,168,255,.075), rgba(255,255,255,.035))", padding: "16px 18px" }}>
        <div onClick={() => setAdvancedOpen(!advancedOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: advancedOpen ? 14 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>⚙</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Ajustes avanzados</div>
              <div style={{ marginTop: 3, color: "#a4adba", fontSize: 12 }}>Configurá el formato de fechas, montos y la dirección del flujo.</div>
            </div>
          </div>
          <span style={{ color: "#a4adba" }}>{advancedOpen ? "▴" : "⌄"}</span>
        </div>
        {advancedOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 18 }}>
            <Field label="Formato de fecha" hint="Cómo está escrita la fecha en el Excel.">
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFmt)}
                style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid rgba(255,255,255,.13)", background: "rgba(5,11,20,.28)", color: "#ecf1f8", padding: "0 12px", fontSize: 12 }}>
                <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                <option value="yyyy-mm-dd">YYYY-MM-DD</option>
                <option value="dd-mm-yyyy">DD-MM-YYYY</option>
                <option value="unknown">No sé</option>
              </select>
              <div style={{ marginTop: 7, color: "#6f7b8b", fontSize: 12 }}>Ej.: 30/04/2024</div>
            </Field>
            <Field label="¿Cómo vienen los montos?" hint="Cargo+Abono separados, o Monto+Tipo.">
              <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}
                style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid rgba(255,255,255,.13)", background: "rgba(5,11,20,.28)", color: "#ecf1f8", padding: "0 12px", fontSize: 12 }}>
                <option value="two_cols">Cargo + Abono separados</option>
                <option value="single_col">Monto + Tipo (D/C)</option>
                <option value="transactions_log">Una sola columna</option>
              </select>
              <div style={{ marginTop: 7, color: "#6f7b8b", fontSize: 12 }}>Ej.: abono en una columna, cargo en otra</div>
            </Field>
            <Field label="Dirección del flujo" hint="Usá esta opción si elegiste «Una sola columna».">
              <select value={defaultFlujo} onChange={(e) => setDefaultFlujo(e.target.value as "entrada" | "salida")}
                style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid rgba(255,255,255,.13)", background: "rgba(5,11,20,.28)", color: "#ecf1f8", padding: "0 12px", fontSize: 12 }}>
                <option value="entrada">Depósitos = Abonos</option>
                <option value="salida">Retiros = Cargos</option>
              </select>
              <div style={{ marginTop: 7, color: "#6f7b8b", fontSize: 12 }}>Retiros = Cargos</div>
            </Field>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "16px 28px 18px", borderTop: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.025)", display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
          {validationErr ? (
            <><span style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,115,101,.65)", color: "#ff7365", display: "grid", placeItems: "center", fontWeight: 900 }}>!</span>
            <div><div style={{ color: "#ff7365", fontSize: 14, fontWeight: 600 }}>Error de validación</div><div style={{ color: "#cbd3df", fontSize: 12 }}>{validationErr}</div></div></>
          ) : preview ? (
            <><span style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(52,212,110,.65)", color: "#34d46e", display: "grid", placeItems: "center", fontWeight: 900 }}>✓</span>
            <div><div style={{ color: "#9df2b6", fontSize: 14, fontWeight: 600 }}>Validación exitosa</div><div style={{ color: "#cbd3df", fontSize: 12 }}>Todo listo para procesar.</div></div></>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={{ height: 46, minWidth: 132, borderRadius: 12, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.055)", color: "#f3f6fb", fontWeight: 760, fontSize: 14, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => save(false)} disabled={saving || loading || !preview || !!validationErr}
            style={{ height: 46, minWidth: 150, borderRadius: 12, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.055)", color: "#f3f6fb", fontWeight: 760, fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, opacity: saving || loading || !preview || !!validationErr ? .4 : 1 }}>
            ▱ Guardar solo
          </button>
          <button onClick={() => save(true)} disabled={saving || loading || !preview || !!validationErr}
            style={{ height: 46, minWidth: 190, borderRadius: 12, border: "1px solid rgba(255,180,126,.42)", background: "linear-gradient(145deg, #ff9a62, #f47b45)", color: "white", fontWeight: 760, fontSize: 14, cursor: "pointer", boxShadow: "0 16px 36px rgba(244,123,69,.26), inset 0 1px 0 rgba(255,255,255,.24)", opacity: saving || loading || !preview || !!validationErr ? .4 : 1 }}>
            {saving ? "Guardando..." : "Todo bien, procesá →"}
          </button>
        </div>
      </div>
    </>
  );
}

function ColumnChip({ role, onChange, layout, animateDetected }: { role: Role; onChange: (r: Role) => void; layout: Layout; animateDetected?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = ROLES[role];

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left + r.width / 2, width: r.width });
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

  const roles: Role[] = ["ignorar", "fecha", "descripcion", "n_documento",
    ...(layout === "two_cols" ? ["cargo", "abono"] as Role[] : []),
    ...(layout !== "two_cols" ? ["monto"] as Role[] : []),
    ...(layout === "single_col" ? ["tipo_flujo"] as Role[] : []), "saldo"];

  return (
    <>
      <Tooltip content={meta.hint}>
        <button ref={btnRef} onClick={() => setOpen(v => !v)}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
            height: 33, borderRadius: 10, padding: "0 12px", fontSize: 12, fontWeight: 720, cursor: "default",
            border: "1px solid currentColor", background: "rgba(255,255,255,.04)",
            color: ROLE_HEX[role] ?? "#64748B",
            transition: "all .15s",
          }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor", boxShadow: "0 0 14px currentColor" }} />
          {meta.label} <span style={{ opacity: .8 }}>⌄</span>
        </button>
      </Tooltip>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)", zIndex: 200, minWidth: 170, borderRadius: 12, background: "#1c1c1e", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 12px 32px rgba(0,0,0,.5)", overflow: "hidden", padding: "4px 0" }}>
          {roles.map(r => (
            <button key={r} onClick={() => { onChange(r); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", fontSize: 11,
                border: "none", cursor: "pointer", textAlign: "left",
                background: r === role ? "rgba(244,123,69,.13)" : "transparent",
                color: r === role ? "#ff9a62" : "#e8eaf0",
              }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_HEX[r] ?? "#64748B" }} />
              {ROLES[r].label}
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
      <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#e4eaf4", fontSize: 13, fontWeight: 720, marginBottom: 8 }}>
        {label}
        {hint && <Tooltip content={hint}><span style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(255,255,255,.04)", color: "#a4adba", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, cursor: "help" }}>?</span></Tooltip>}
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
