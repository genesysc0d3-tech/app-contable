"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { UploadSimple, CheckCircle } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Role = "ignorar" | "fecha" | "descripcion" | "monto" | "cargo" | "abono" | "n_documento" | "saldo";

interface ZoneDef {
  role: Role; label: string; labelShort: string; desc: string; required: boolean; color: string;
}

const ZONES: ZoneDef[] = [
  { role: "fecha", label: "Fecha", labelShort: "Fecha", desc: "Columna con la fecha del movimiento.", required: true, color: "#5fa8ff" },
  { role: "descripcion", label: "Descripción / Glosa", labelShort: "Glosa", desc: "Texto que describe cada transacción.", required: true, color: "#2dd4bf" },
  { role: "cargo", label: "Cargo / Débito", labelShort: "Cargo", desc: "Columna separada para egresos.", required: false, color: "#ff7365" },
  { role: "abono", label: "Abono / Crédito", labelShort: "Abono", desc: "Columna separada para ingresos.", required: false, color: "#34d46e" },
  { role: "monto", label: "Monto único", labelShort: "Monto", desc: "Una sola columna con cargo o abono.", required: false, color: "#f59e0b" },
  { role: "n_documento", label: "N° Documento", labelShort: "Nro", desc: "Número de operación, folio o referencia.", required: false, color: "#a78bfa" },
  { role: "saldo", label: "Saldo / Balance", labelShort: "Saldo", desc: "Saldo acumulado después del movimiento.", required: false, color: "#f47b45" },
];

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface PreviewData {
  sheetName: string; fingerprint: string; totalRows: number; cols: number;
  rows: string[][]; txStart: number; hasHeader: boolean;
}

interface Props {
  empresaId: string;
  onClose: () => void;
  onSaved?: () => void;
  previewData?: PreviewData;
}

export default function CartolaMapperDragDrop({ onClose, onSaved, previewData }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "done">(previewData ? "mapping" : "upload");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(previewData ?? null);
  const [saving, setSaving] = useState(false);
  const [zoneMap, setZoneMap] = useState<Record<string, number>>({});
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [draggingCol, setDraggingCol] = useState<number | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);

  // Contrato C3: el mapper maneja su propio Escape (preventDefault + stopPropagation
  // en fase de captura) para que el wizard de EmpresaPopup NO se cierre junto con él.
  // Si hay columnas asignadas sin guardar, pide confirmación inline antes de cerrar.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (step === "mapping" && Object.keys(zoneMap).length > 0 && !confirmExit) {
        setConfirmExit(true);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [step, zoneMap, confirmExit, onClose]);

  async function handleFile(file: File) {
    const nombreArchivo = file.name.toLowerCase();
    if (!nombreArchivo.endsWith(".xlsx") && !nombreArchivo.endsWith(".xls")) { toast("Solo Excel", "error"); return; }
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf); let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const res = await fetch("/api/preview-formato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: btoa(bin), nombre: file.name }),
      });
      const d = await res.json();
      if (!d.ok) { toast(d.error ?? "Error", "error"); return; }
      setPreview(d); setZoneMap({}); setStep("mapping");
    } catch { toast("Error al leer", "error"); } finally { setLoading(false); }
  }

  function zoneOf(colIdx: number): string | undefined {
    for (const [role, idx] of Object.entries(zoneMap)) if (idx === colIdx) return role;
  }

  function assign(zoneRole: string, colIdx: number) {
    const m = { ...zoneMap };
    const existing = Object.entries(m).find(([, v]) => v === colIdx);
    if (existing) delete m[existing[0]];
    if (m[zoneRole] !== undefined) delete m[zoneRole];
    m[zoneRole] = colIdx; setZoneMap(m); setSelectedCol(null);
  }

  function unassign(zoneRole: string) { const m = { ...zoneMap }; delete m[zoneRole]; setZoneMap(m); }

  function tapColumn(colIdx: number) {
    const r = zoneOf(colIdx);
    if (r) { unassign(r); return; }
    setSelectedCol(selectedCol === colIdx ? null : colIdx);
  }

  function tapZone(zoneRole: string) {
    if (zoneMap[zoneRole] !== undefined) { unassign(zoneRole); return; }
    if (selectedCol !== null) { assign(zoneRole, selectedCol); return; }
  }

  const onDragStart = useCallback((e: React.DragEvent, i: number) => {
    e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; setDraggingCol(i);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent, z: string) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverZone(z); }, []);
  const onDrop = useCallback((e: React.DragEvent, z: string) => {
    e.preventDefault(); setDragOverZone(null); setDraggingCol(null);
    const colIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!isNaN(colIdx)) assign(z, colIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assign es función estable del componente
  }, []);

  function rolesArr(p: PreviewData): string[] {
    const r = new Array(p.cols).fill("ignorar");
    for (const [role, idx] of Object.entries(zoneMap)) if (idx >= 0 && idx < r.length) r[idx] = role;
    return r;
  }

  async function handleSave() {
    if (!preview) return;
    setSaving(true);
    try {
      const res = await fetch("/api/guardar-formato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: preview.fingerprint,
          nombre: preview.sheetName,
          roles: rolesArr(preview),
          headerRow: preview.rows[0],
          txStart: preview.txStart,
        }),
      });
      const d = await res.json();
      if (d.ok) { toast("Formato guardado"); onSaved?.(); setStep("done"); } else { toast(d.error ?? "Error", "error"); }
    } catch { toast("Error al guardar", "error"); } finally { setSaving(false); }
  }

  const assigned = Object.keys(zoneMap).filter(k => zoneMap[k] !== undefined).length;
  const validationMsg = !zoneMap.fecha ? "Fecha es obligatoria" : !zoneMap.descripcion ? "Descripción / Glosa es obligatoria" : null;
  const dataRows = preview ? preview.rows.slice(1, 6) : [];

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "grid", placeItems: "center", padding: 32,
      background: "rgba(0,0,0,.46)", backdropFilter: "blur(13px)",
    }}>
      <div style={{
        width: "min(1280px, calc(100vw - 64px))", maxHeight: "calc(100vh - 64px)",
        overflow: "hidden", borderRadius: 24, border: "1px solid rgba(255,255,255,.18)",
        background: "linear-gradient(145deg, rgba(22,24,29,.96), rgba(15,16,20,.98))",
        boxShadow: "0 40px 120px rgba(0,0,0,.55)",
        display: "grid", gridTemplateRows: "auto 1fr auto", color: "#f6f7fb",
        fontFamily: "var(--font-geist-sans), sans-serif",
      }}>
        {/* ── HEADER ── */}
        <div style={{ padding: "14px 24px 12px", display: "flex", gap: 12, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ width: 42, height: 42, borderRadius: 14, display: "grid", placeItems: "center", flexShrink: 0,
            background: "linear-gradient(145deg, #E8553E, #c43a2e)",
            boxShadow: "0 12px 32px rgba(232,85,62,.32), inset 0 1px 0 rgba(255,255,255,.35)",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 7h16v12H4V7Z" stroke="white" strokeWidth="1.8"/><path d="M4 7l3-3h10l3 3" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 760, letterSpacing: "-0.04em", lineHeight: 1.1 }}>
              {step === "upload" ? "Subir cartola" : step === "done" ? "Formato guardado" : "Asignar columnas"}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: "#a4adba" }}>
              {step === "upload" ? "Selecciona un archivo Excel para analizar." : step === "done" ? "Ya puedes cerrar." : "Arrastra los encabezados a los campos de abajo."}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.045)", color: "#d8dde6", fontSize: 22, lineHeight: 1, cursor: "pointer", display: "grid", placeItems: "center" }}>×</button>
        </div>

        {/* ── CONTENT ── */}
        <div style={{ overflow: "auto", padding: "12px 24px 12px", scrollbarWidth: "thin" }}>

          {/* UPLOAD STEP */}
          {step === "upload" && (
            <div style={{ padding: 80, textAlign: "center", color: "#a4adba" }}>
              <UploadSimple size={40} weight="bold" style={{ margin: "0 auto 16px", display: "block", color: "#E8553E" }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f6f7fb", marginBottom: 8 }}>Sube un Excel de cartola</div>
              <div style={{ fontSize: 13, marginBottom: 24 }}>Excel (.xlsx, .xls) — arrastra los encabezados a las cajas.</div>
              <div onClick={() => inputRef.current?.click()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer",
                  borderRadius: 12, border: "2px dashed rgba(232,85,62,.35)",
                  background: "rgba(255,255,255,.035)", padding: "18px 32px",
                  transition: "all .15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(232,85,62,.65)"; e.currentTarget.style.background = "rgba(232,85,62,.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(232,85,62,.35)"; e.currentTarget.style.background = "rgba(255,255,255,.035)"; }}
              >
                <UploadSimple size={22} color="#E8553E" />
                <span style={{ fontSize: 14, fontWeight: 650, color: "#d7deeb" }}>{loading ? "Leyendo..." : "Seleccionar archivo"}</span>
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </div>
          )}

          {/* DONE STEP */}
          {step === "done" && (
            <div style={{ padding: 80, textAlign: "center" }}>
              <CheckCircle size={40} weight="fill" style={{ color: "#34d46e", margin: "0 auto 16px", display: "block" }} />
              <div style={{ fontSize: 20, fontWeight: 760, letterSpacing: "-0.02em", marginBottom: 8 }}>Formato guardado</div>
              <div style={{ fontSize: 14, color: "#a4adba" }}>Próximas cartolas del mismo banco se leerán solas.</div>
            </div>
          )}

          {/* MAPPING STEP */}
          {step === "mapping" && preview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Summary strip */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.8fr 1fr", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "rgba(4,10,17,.28)", overflow: "hidden" }}>
                {[
                  { label: "Hoja detectada", value: preview.sheetName },
                  { label: "Total filas", value: preview.totalRows.toLocaleString() },
                  { label: "Columnas", value: preview.cols.toString() },
                  { label: "Asignadas", value: `${assigned} / 7` },
                ].map((s, i) => (
                  <div key={i} style={{ padding: "10px 12px", borderRight: i < 3 ? "1px solid rgba(255,255,255,.08)" : "none" }}>
                    <div style={{ fontSize: 10, color: "#6f7b8b", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 650, color: "#edf2fa" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Step 1: Title row */}
              <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "rgba(6,13,22,.33)", overflow: "hidden", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 8 }}>
                  <span style={{ width: 18, height: 18, display: "inline-grid", placeItems: "center", borderRadius: 6, background: "linear-gradient(145deg,#5fa8ff,#507eb4)", color: "#fff", fontSize: 10, boxShadow: "0 4px 12px rgba(95,168,255,.2)" }}>1</span>
                  Fila de títulos
                  <span style={{ fontSize: 11, color: "#a4adba", fontWeight: 450 }}>(asigna el rol de cada columna)</span>
                </div>
                <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.035)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                    <thead>
                      {/* Column letters */}
                      <tr>{Array.from({ length: preview.cols }).map((_, i) => (
                        <th key={i} style={{ padding: "6px 8px", color: "#bbc5d2", fontSize: 11, fontWeight: 720, background: "rgba(255,255,255,.035)", borderRight: i < preview.cols - 1 ? "1px solid rgba(255,255,255,.075)" : "none", borderBottom: "1px solid rgba(255,255,255,.075)", textAlign: "center" }}>
                          {COL_LETTERS[i] || i + 1}
                        </th>
                      ))}</tr>
                      {/* Header cells */}
                      <tr>{Array.from({ length: preview.cols }).map((_, i) => {
                        const role = zoneOf(i);
                        const z = role ? ZONES.find(x => x.role === role) : undefined;
                        const isSel = selectedCol === i;
                        const isDrag = draggingCol === i;
                        const colTint = z ? `${z.color}15` : "transparent";
                        return (
                          <th key={i}
                            draggable onDragStart={(e) => onDragStart(e, i)}
                            onDragEnd={() => { setDraggingCol(null); setDragOverZone(null); }}
                            onClick={() => tapColumn(i)}
                            style={{
                              padding: "10px 8px", textAlign: "center", fontWeight: 680,
                              borderRight: i < preview.cols - 1 ? "1px solid rgba(255,255,255,.075)" : "none",
                              borderBottom: "1px solid rgba(255,255,255,.075)",
                              cursor: "grab", userSelect: "none",
                              background: colTint,
                              color: role ? "#edf2fa" : "#bbc5d2",
                              opacity: isDrag ? 0.4 : 1,
                              outline: isSel ? "2px solid #E8553E" : "none",
                              outlineOffset: -2,
                              transition: "background .15s",
                            }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                              {z && role && (
                                <span onClick={(e) => { e.stopPropagation(); unassign(role); }}
                                  style={{ cursor: "pointer", color: "#ff7365", fontSize: 10, opacity: 0.7 }}>✕</span>
                              )}
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontSize: 13 }}>
                                {(preview.rows[0]?.[i]) || `Col ${i + 1}`}
                              </span>
                            </div>
                          </th>
                        );
                      })}</tr>
                    </thead>
                  </table>
                </div>
              </div>

              {/* Step 2: Suelta aquí (drop zones) */}
              <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "linear-gradient(145deg, rgba(95,168,255,.075), rgba(255,255,255,.035))", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 10 }}>
                  <span style={{ width: 18, height: 18, display: "inline-grid", placeItems: "center", borderRadius: 6, background: "linear-gradient(145deg,#f59e0b,#d97706)", color: "#fff", fontSize: 10, boxShadow: "0 4px 12px rgba(245,158,11,.2)" }}>2</span>
                  Suelta aquí
                  <span style={{ fontSize: 11, color: "#a4adba", fontWeight: 450, marginLeft: 2 }}>arrastra una columna o selecciona y toca</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ZONES.map((zone) => {
                    const colIdx = zoneMap[zone.role] ?? -1;
                    const isOver = dragOverZone === zone.role;
                    const colName = colIdx >= 0 ? (preview!.rows[0]?.[colIdx] || `#${colIdx + 1}`) : null;
                    const isAssigned = colIdx >= 0;
                    return (
                      <div key={zone.role}
                        onDragOver={(e) => onDragOver(e, zone.role)}
                        onDragLeave={() => setDragOverZone(null)}
                        onDrop={(e) => onDrop(e, zone.role)}
                        onClick={() => tapZone(zone.role)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                          height: 30, borderRadius: 8, padding: "0 10px", fontSize: 11, fontWeight: 600,
                          border: isAssigned
                            ? `1px solid ${zone.color}`
                            : isOver
                              ? "1px solid #E8553E"
                              : "1px dashed rgba(255,255,255,.12)",
                          background: isAssigned
                            ? `${zone.color}15`
                            : isOver
                              ? "rgba(232,85,62,.1)"
                              : "rgba(255,255,255,.035)",
                          color: isAssigned ? zone.color : isOver ? "#fff" : "rgba(255,255,255,.6)",
                          transition: "all .15s",
                        }}
                        onMouseEnter={e => { if (!isAssigned) { e.currentTarget.style.background = "rgba(232,85,62,.08)"; e.currentTarget.style.color = "#fff"; }}}
                        onMouseLeave={e => { if (!isAssigned) { e.currentTarget.style.background = "rgba(255,255,255,.035)"; e.currentTarget.style.color = "rgba(255,255,255,.6)"; }}}
                        title={zone.desc}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: isAssigned ? zone.color : "#64748B", boxShadow: isAssigned ? "0 0 10px " + zone.color : "none" }} />
                        <span style={{ whiteSpace: "nowrap" }}>{colName || zone.labelShort}</span>
                        {zone.required && !isAssigned && (
                          <span style={{ fontSize: 8, color: "#ff7365", background: "rgba(255,115,101,.1)", borderRadius: 3, padding: "1px 4px", marginLeft: 1 }}>Req.</span>
                        )}
                        {isAssigned && (
                          <span onClick={(e) => { e.stopPropagation(); unassign(zone.role); }}
                            style={{ marginLeft: 2, opacity: 0.6, cursor: "pointer", fontSize: 11, color: "#ff7365" }}>✕</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 3: Data preview */}
              <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, background: "rgba(6,13,22,.33)", overflow: "hidden", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
                      <span style={{ width: 18, height: 18, display: "inline-grid", placeItems: "center", borderRadius: 6, background: "linear-gradient(145deg,#34d46e,#289f54)", color: "#fff", fontSize: 10, boxShadow: "0 4px 12px rgba(52,212,110,.2)" }}>3</span>
                      Estos movimientos se van a agregar
                    </div>
                    <div style={{ fontSize: 12, color: "#a4adba", marginLeft: 32, marginTop: 2 }}>Vista previa de las primeras filas.</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#a4adba" }}>{dataRows.length} de {Math.max(preview.totalRows - preview.txStart, 0)}</div>
                </div>
                <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,.08)", background: "rgba(6,13,22,.33)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 36, textAlign: "center", padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,.075)", borderRight: "1px solid rgba(255,255,255,.07)", fontSize: 11, fontWeight: 680, color: "#bbc5d2", background: "rgba(255,255,255,.035)" }}></th>
                        {Array.from({ length: preview.cols }).map((_, i) => {
                          const role = zoneOf(i);
                          const z = role ? ZONES.find(x => x.role === role) : undefined;
                          return (
                            <th key={i}
                              style={{
                                padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,.075)",
                                borderRight: i < preview.cols - 1 ? "1px solid rgba(255,255,255,.07)" : "none",
                                fontSize: 12, fontWeight: 680, color: "#d7dfeb", textAlign: "left", whiteSpace: "nowrap",
                                background: z ? `${z.color}15` : "transparent",
                              }}>
                              {(preview.rows[0]?.[i]) || <span style={{ color: "#6f7b8b", fontStyle: "italic" }}>sin título</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {dataRows.map((row, ri) => (
                        <tr key={ri} style={{ borderTop: "1px solid rgba(255,255,255,.065)" }}>
                          <td style={{ textAlign: "center", padding: "8px 10px", color: "#6f7b8b", fontSize: 11, background: "rgba(255,255,255,.025)", borderRight: "1px solid rgba(255,255,255,.07)" }}>{preview.txStart + ri}</td>
                          {Array.from({ length: preview.cols }).map((_, i) => {
                            const role = zoneOf(i);
                            const z = role ? ZONES.find(x => x.role === role) : undefined;
                            return (
                              <td key={i}
                                style={{
                                  padding: "8px 10px", color: "#e8edf5", fontSize: 12,
                                  borderRight: i < preview.cols - 1 ? "1px solid rgba(255,255,255,.07)" : "none",
                                  background: z ? `${z.color}15` : "transparent",
                                  boxShadow: z ? `inset 3px 0 0 ${z.color}` : undefined,
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>
                                {row[i] ?? <span style={{ color: "#6f7b8b" }}>—</span>}
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
          )}
        </div>

        {/* ── FOOTER ── */}
        {step === "mapping" && (
          <div style={{ padding: "10px 24px 12px", borderTop: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.025)", display: "flex", alignItems: "center", gap: 14 }}>
            {confirmExit ? (
              <>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid rgba(245,158,11,.65)", color: "#f59e0b", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 12, flexShrink: 0 }}>!</span>
                  <div><div style={{ color: "#f59e0b", fontSize: 12, fontWeight: 600 }}>¿Cerrar sin guardar?</div><div style={{ color: "#cbd3df", fontSize: 11 }}>Tienes columnas asignadas sin guardar. Presiona Escape de nuevo para cerrar.</div></div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setConfirmExit(false)} style={{ height: 36, minWidth: 120, borderRadius: 10, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.055)", color: "#f3f6fb", fontWeight: 650, fontSize: 12, cursor: "pointer" }}>Seguir editando</button>
                  <button onClick={onClose} style={{ height: 36, minWidth: 140, borderRadius: 10, border: "1px solid rgba(245,158,11,.45)", background: "rgba(245,158,11,.12)", color: "#f59e0b", fontWeight: 650, fontSize: 12, cursor: "pointer" }}>Cerrar sin guardar</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                  {validationMsg ? (
                    <><span style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid rgba(255,115,101,.65)", color: "#ff7365", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 12, flexShrink: 0 }}>!</span>
                    <div><div style={{ color: "#ff7365", fontSize: 12, fontWeight: 600 }}>Falta completar</div><div style={{ color: "#cbd3df", fontSize: 11 }}>{validationMsg}</div></div></>
                  ) : (
                    <><span style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid rgba(52,212,110,.65)", color: "#34d46e", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 12, flexShrink: 0 }}>✓</span>
                    <div><div style={{ color: "#9df2b6", fontSize: 12, fontWeight: 600 }}>Validación exitosa</div><div style={{ color: "#cbd3df", fontSize: 11 }}>Todo listo para guardar.</div></div></>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={onClose} style={{ height: 36, minWidth: 100, borderRadius: 10, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.055)", color: "#f3f6fb", fontWeight: 650, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
                  <button onClick={handleSave} disabled={saving || !!validationMsg || !preview}
                    style={{ height: 36, minWidth: 160, borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "linear-gradient(145deg, #E8553E, #c43a2e)", color: "#fff", fontWeight: 650, fontSize: 13, cursor: "pointer", boxShadow: "0 10px 24px rgba(232,85,62,.22), inset 0 1px 0 rgba(255,255,255,.24)", opacity: saving || validationMsg ? .4 : 1 }}>
                    {saving ? "Guardando..." : "Guardar formato"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
