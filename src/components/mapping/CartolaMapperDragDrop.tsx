"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { UploadSimple, CheckCircle, X, ArrowLeft } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Role = "ignorar" | "fecha" | "descripcion" | "monto" | "cargo" | "abono" | "n_documento" | "saldo";

interface ZoneDef {
  role: Role;
  label: string;
  desc: string;
  required: boolean;
  color: string;
}

const ZONES: ZoneDef[] = [
  { role: "fecha", label: "Fecha", desc: "La columna con la fecha del movimiento", required: true, color: "#3B82F6" },
  { role: "descripcion", label: "Descripción / Glosa", desc: "El texto que describe la transacción", required: true, color: "#14B8A6" },
  { role: "monto", label: "Monto único", desc: "Una sola columna con el valor (cargo o abono)", required: false, color: "#E8553E" },
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

export default function CartolaMapperDragDrop({ empresaId, onClose }: { empresaId: string; onClose?: () => void }) {
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
    m[zoneRole] = colIdx;
    setZoneMap(m);
    setSelectedCol(null);
  }

  function unassign(zoneRole: string) {
    const m = { ...zoneMap }; delete m[zoneRole]; setZoneMap(m);
  }

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
    e.dataTransfer.setData("text/plain", String(i));
    e.dataTransfer.effectAllowed = "move";
    setDraggingCol(i);
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
      if (d.ok) { toast("Formato guardado"); setStep("done"); } else { toast(d.error ?? "Error", "error"); }
    } catch { toast("Error al guardar", "error"); } finally { setSaving(false); }
  }

  /* ── Upload step ── */
  if (step === "upload") return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--muted-light)]">Arrastrá o seleccioná un Excel de tu banco para indicarle al sistema cómo leerlo.</p>
      <div onClick={() => inputRef.current?.click()} className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#E8553E]/40 hover:border-[#E8553E] hover:bg-[var(--accent-light)]/10 cursor-pointer px-4 py-4 transition-all">
        <UploadSimple size={16} className="text-[#E8553E]" />
        <span className="text-xs font-medium text-[var(--foreground)]">{loading ? "Leyendo..." : "Subir Excel de cartola"}</span>
      </div>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );

  if (step === "done") return (
    <div className="p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-2">
      <div className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="text-[#22C55E] shrink-0" /><p className="text-xs font-medium">Formato guardado</p></div>
      <p className="text-[10px] text-[var(--muted-light)]">La próxima cartola del mismo banco se leerá automáticamente.</p>
      <button onClick={() => { setStep("upload"); setPreview(null); }} className="text-[10px] text-[#E8553E] hover:underline">+ Agregar otro formato</button>
    </div>
  );

  /* ── Mapping step ── */
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => setStep("upload")} className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={11} /> Volver</button>
        <span className="text-[9px] text-[var(--muted-light)]">{preview!.sheetName} &middot; {preview!.totalRows} filas</span>
        <button onClick={onClose} className="ml-auto text-[var(--muted)] hover:text-[var(--foreground)]"><X size={14} /></button>
      </div>

      {/* Excel grid — full headers, scrollable */}
      <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white dark:bg-black/20">
        <div className="overflow-x-auto pb-1">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr>
                {preview!.rows[0]?.map((h: string, i: number) => {
                  const role = zoneOf(i);
                  const z = role ? ZONES.find((x) => x.role === role) : undefined;
                  const isSelected = selectedCol === i;
                  const isDragging = draggingCol === i;
                  return (
                    <th key={i}
                      draggable
                      onDragStart={(e) => onDragStart(e, i)}
                      onDragEnd={() => { setDraggingCol(null); setDragOverZone(null); }}
                      onClick={() => tapColumn(i)}
                      className={`
                        px-2 py-1.5 text-left font-medium border-r border-b border-[var(--border)]
                        cursor-grab active:cursor-grabbing select-none transition-all whitespace-nowrap
                        ${isDragging ? "opacity-40" : ""}
                        ${isSelected ? "ring-2 ring-[#E8553E] ring-inset z-10" : ""}
                        ${z ? "text-white" : "text-[var(--muted)] bg-[var(--surface)]"}
                      `}
                      style={z ? { backgroundColor: z.color } : {}}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[8px] opacity-50 font-mono w-3">{COL_LETTERS[i] || i}</span>
                        <span className="truncate max-w-[120px]">{h || `Columna ${i + 1}`}</span>
                          {z && role && <X size={8} weight="bold" className="ml-1 opacity-60 hover:opacity-100 shrink-0" onClick={(e) => { e.stopPropagation(); unassign(role); }} />}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {preview!.rows.slice(1, 5).map((row, ri) => (
                <tr key={ri} className="border-t border-[var(--border)]">
                  {row.map((cell, ci) => {
                    const role = zoneOf(ci);
                    return (
                      <td key={ci}
                        className="px-2 py-1 truncate max-w-[140px] border-r border-[var(--border)] text-[9px]"
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
        <div className="px-2 py-1 border-t border-[var(--border)] text-[8px] text-[var(--muted-light)] bg-[var(--surface)]/50">
          Arrastrá los encabezados (A, B, C...) a las cajas de abajo &middot; o tocalos y luego toca la caja destino
        </div>
      </div>

      {/* Drop zones — horizontal pills with icons and descriptions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {ZONES.map((zone) => {
          const colIdx = zoneMap[zone.role] ?? -1;
          const isOver = dragOverZone === zone.role;
          const colName = colIdx >= 0 ? preview!.rows[0]?.[colIdx] || `Columna ${colIdx + 1}` : null;
          const hasFechaDesc = !!zoneMap.fecha && !!zoneMap.descripcion;

          return (
            <div key={zone.role}
              onDragOver={(e) => onDragOver(e, zone.role)}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={(e) => onDrop(e, zone.role)}
              onClick={() => tapZone(zone.role)}
              className={`
                relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2
                transition-all duration-150 select-none cursor-pointer min-h-[48px]
                ${colIdx >= 0
                  ? "border-solid text-white shadow-sm"
                  : isOver
                    ? "border-[#E8553E] bg-[#E8553E]/5 scale-[1.02] shadow-sm"
                    : "border-dashed border-[var(--border)] bg-[var(--surface)]/20 hover:border-[var(--muted)] hover:bg-[var(--surface)]/40"
                }
              `}
              style={colIdx >= 0 ? { backgroundColor: zone.color, borderColor: zone.color } : {}}>
              {/* Indicator dot */}
              <div className={`w-2 h-2 rounded-full shrink-0 ${colIdx >= 0 ? "bg-white/70" : "bg-[var(--border)]"}`} />

              {/* Content */}
              <div className="flex-1 min-w-0">
                {colIdx >= 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold truncate">{colName}</span>
                    <X size={10} weight="bold" className="opacity-60 hover:opacity-100 shrink-0" onClick={(e) => { e.stopPropagation(); unassign(zone.role); }} />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-medium text-[var(--foreground)]">{zone.label}</span>
                      {zone.required && !hasFechaDesc && <span className="text-[8px] text-red-400">obligatorio</span>}
                    </div>
                    <p className="text-[8px] text-[var(--muted-light)] mt-0.5">{zone.desc}</p>
                  </>
                )}
              </div>

              {/* Drop indicator */}
              {colIdx < 0 && isOver && (
                <div className="absolute inset-0 rounded-xl border-2 border-[#E8553E] bg-[#E8553E]/5 animate-pulse pointer-events-none" />
              )}
            </div>
          );
        })}
      </div>

      {/* Save */}
      <button onClick={handleSave} disabled={saving || !zoneMap.fecha || !zoneMap.descripcion}
        className="w-full rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-xs font-semibold text-white transition-all btn-press">
        {saving ? "Guardando..." : Object.keys(zoneMap).length === 0 ? "Arrastrá las columnas a las cajas de arriba" : "Guardar formato"}
      </button>
    </div>
  );
}
