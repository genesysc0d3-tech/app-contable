"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { UploadSimple, CheckCircle, X, ArrowLeft } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Role = "ignorar" | "fecha" | "descripcion" | "monto" | "cargo" | "abono" | "n_documento" | "saldo";

interface ZoneDef {
  role: Role; label: string; desc: string; required: boolean; color: string;
}

const ZONES: ZoneDef[] = [
  { role: "fecha", label: "Fecha", desc: "Columna con la fecha del movimiento", required: true, color: "#3B82F6" },
  { role: "descripcion", label: "Descripción / Glosa", desc: "El texto que describe cada transacción", required: true, color: "#14B8A6" },
  { role: "monto", label: "Monto único", desc: "Una sola columna con cargo o abono", required: false, color: "#E8553E" },
  { role: "cargo", label: "Cargo / Débito", desc: "Columna separada solo para egresos", required: false, color: "#F59E0B" },
  { role: "abono", label: "Abono / Crédito", desc: "Columna separada solo para ingresos", required: false, color: "#22C55E" },
  { role: "n_documento", label: "N° Documento", desc: "Número de operación o folio", required: false, color: "#6366F1" },
  { role: "saldo", label: "Saldo / Balance", desc: "Saldo acumulado después del movimiento", required: false, color: "#8B5CF6" },
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
}

export default function CartolaMapperDragDrop({ empresaId, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoneMap, setZoneMap] = useState<Record<string, number>>({});
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [draggingCol, setDraggingCol] = useState<number | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) { toast("Solo Excel", "error"); return; }
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf); let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const res = await fetch("/api/preview-formato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64: btoa(bin), nombre: file.name }) });
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
  }, [zoneMap]);

  function rolesArr(p: PreviewData): string[] {
    const r = new Array(p.cols).fill("ignorar");
    for (const [role, idx] of Object.entries(zoneMap)) if (idx >= 0 && idx < r.length) r[idx] = role;
    return r;
  }

  async function handleSave() {
    if (!preview) return;
    setSaving(true);
    try {
      const res = await fetch("/api/guardar-formato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fingerprint: preview.fingerprint, nombre: preview.sheetName, roles: rolesArr(preview), headerRow: preview.rows[0], txStart: preview.txStart }) });
      const d = await res.json();
      if (d.ok) { toast("Formato guardado"); onSaved?.(); setStep("done"); } else { toast(d.error ?? "Error", "error"); }
    } catch { toast("Error al guardar", "error"); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#0a0a0a] border border-[var(--border)] shadow-2xl p-4 sm:p-5 space-y-3">

        {/* ── Upload step ── */}
        {step === "upload" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--foreground)]">Mapear cartola</h2>
              <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] p-1"><X size={16} /></button>
            </div>
            <p className="text-[11px] text-[var(--muted-light)]">Subí un Excel de tu banco. Arrastrá los encabezados de columna a las cajas de abajo para indicarle al sistema qué significa cada columna.</p>
            <div onClick={() => inputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#E8553E]/40 hover:border-[#E8553E] hover:bg-[var(--accent-light)]/10 cursor-pointer px-4 py-5 transition-all">
              <UploadSimple size={18} className="text-[#E8553E]" />
              <span className="text-sm font-medium text-[var(--foreground)]">{loading ? "Leyendo..." : "Subir Excel de cartola"}</span>
            </div>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </div>
        )}

        {/* ── Done step ── */}
        {step === "done" && (
          <div className="text-center py-6 space-y-2">
            <CheckCircle size={32} weight="fill" className="text-[#22C55E] mx-auto" />
            <p className="text-sm font-semibold">Formato guardado</p>
            <p className="text-[11px] text-[var(--muted-light)]">Próximas cartolas del mismo banco se leerán solas.</p>
            <button onClick={onClose} className="mt-2 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] px-5 py-2 text-xs font-semibold text-white">Cerrar</button>
          </div>
        )}

        {/* ── Mapping step ── */}
        {step === "mapping" && preview && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => setStep("upload")} className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={11} /> Volver</button>
                <span className="text-[9px] text-[var(--muted-light)]">{preview.sheetName} &middot; {preview.totalRows} filas</span>
              </div>
              <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] p-1"><X size={16} /></button>
            </div>

            {/* Excel grid */}
            <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white dark:bg-black/20">
              <div className="overflow-hidden">
                <table className="w-full text-[10px] border-collapse table-fixed">
                  <thead>
                    <tr>
                      {preview.rows[0]?.map((h: string, i: number) => {
                        const role = zoneOf(i);
                        const z = role ? ZONES.find((x) => x.role === role) : undefined;
                        const isSel = selectedCol === i;
                        const isDrag = draggingCol === i;
                        return (
                          <th key={i} draggable onDragStart={(e) => onDragStart(e, i)}
                            onDragEnd={() => { setDraggingCol(null); setDragOverZone(null); }}
                            onClick={() => tapColumn(i)}
                            className={`px-2 py-1.5 text-left font-medium border-r border-b border-[var(--border)] cursor-grab active:cursor-grabbing select-none transition-all whitespace-nowrap ${isDrag ? "opacity-40" : ""} ${isSel ? "ring-2 ring-[#E8553E] ring-inset z-10" : ""} ${z ? "text-white" : "text-[var(--muted)] bg-[var(--surface)]"}`}
                            style={z ? { backgroundColor: z.color } : {}}>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[8px] opacity-50 font-mono w-3">{COL_LETTERS[i] || i}</span>
                              <span className="truncate">{h || `Columna ${i + 1}`}</span>
                              {z && role && <X size={8} weight="bold" className="ml-1 opacity-60 hover:opacity-100 shrink-0" onClick={(e) => { e.stopPropagation(); unassign(role); }} />}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(1, 5).map((row, ri) => (
                      <tr key={ri} className="border-t border-[var(--border)]">
                        {row.map((cell, ci) => {
                          const role = zoneOf(ci);
                          return (
                            <td key={ci} className="px-2 py-1 truncate border-r border-[var(--border)] text-[9px]"
                              style={role ? { borderLeft: `2.5px solid ${ZONES.find((x) => x.role === role)?.color}` } : {}}>
                              {cell || <span className="opacity-20">&mdash;</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-2 py-1.5 border-t border-[var(--border)] text-[8px] text-[var(--muted-light)] bg-[var(--surface)]/50 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--muted-light)]" />
                Arrastrá un encabezado (A, B, C...) a una caja — o tocá un encabezado y luego tocá la caja
              </div>
            </div>

            {/* Drop zones — compact row */}
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wider">Soltá aquí</p>
              <div className="flex flex-wrap gap-1.5">
                {ZONES.map((zone) => {
                  const colIdx = zoneMap[zone.role] ?? -1;
                  const isOver = dragOverZone === zone.role;
                  const colName = colIdx >= 0 ? preview.rows[0]?.[colIdx] || `#${colIdx + 1}` : null;
                  return (
                    <div key={zone.role}
                      onDragOver={(e) => onDragOver(e, zone.role)}
                      onDragLeave={() => setDragOverZone(null)}
                      onDrop={(e) => onDrop(e, zone.role)}
                      onClick={() => tapZone(zone.role)}
                      className={`
                        relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-2 text-[10px]
                        transition-all duration-150 select-none cursor-pointer
                        ${colIdx >= 0
                          ? "border-solid text-white shadow-sm font-medium"
                          : isOver
                            ? "border-[#E8553E] bg-[#E8553E]/5 scale-[1.02] shadow-sm"
                            : "border-dashed border-[var(--border)] bg-[var(--surface)]/20 hover:border-[var(--muted)]"
                        }
                      `}
                      style={colIdx >= 0 ? { backgroundColor: zone.color, borderColor: zone.color } : {}}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colIdx >= 0 ? "bg-white/80" : "bg-[var(--border)]"}`} />
                      <span className="whitespace-nowrap">{colName || zone.label}</span>
                      {colIdx >= 0 && <X size={9} weight="bold" className="opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); unassign(zone.role); }} />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Save */}
            <button onClick={handleSave} disabled={saving || !zoneMap.fecha || !zoneMap.descripcion}
              className="w-full rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-xs font-semibold text-white transition-all btn-press">
              {saving ? "Guardando..." : !zoneMap.fecha || !zoneMap.descripcion ? "Fecha y Descripción son obligatorias" : "Guardar formato"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
