"use client";

import { useState, useRef, useCallback } from "react";
import { UploadSimple, CheckCircle, ArrowLeft, CaretDown, X } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Role = "ignorar" | "fecha" | "descripcion" | "monto" | "cargo" | "abono" | "n_documento" | "saldo";

interface ZoneDef {
  role: Role;
  label: string;
  icon: string;
  hint: string;
  required: boolean;
  color: string;
}

const ZONES: ZoneDef[] = [
  { role: "fecha", label: "Fecha", icon: "📅", hint: "dd/mm/aaaa", required: true, color: "#3B82F6" },
  { role: "descripcion", label: "Descripción / Glosa", icon: "📝", hint: "Texto del movimiento", required: true, color: "#14B8A6" },
  { role: "monto", label: "Monto único", icon: "💰", hint: "Cargo o abono sola columna", required: false, color: "#E8553E" },
  { role: "cargo", label: "Cargo (egresos)", icon: "⬇️", hint: "Solo débitos", required: false, color: "#F59E0B" },
  { role: "abono", label: "Abono (ingresos)", icon: "⬆️", hint: "Solo créditos", required: false, color: "#22C55E" },
  { role: "n_documento", label: "N° operación", icon: "🔢", hint: "ID transacción", required: false, color: "#6366F1" },
  { role: "saldo", label: "Saldo / Balance", icon: "⚖️", hint: "Saldo post-movimiento", required: false, color: "#8B5CF6" },
];

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface PreviewData {
  sheetName: string;
  fingerprint: string;
  totalRows: number;
  cols: number;
  rows: string[][];
  txStart: number;
  hasHeader: boolean;
}

function roleFor(colIdx: number, zoneMap: Record<string, number>): string | undefined {
  for (const [role, idx] of Object.entries(zoneMap)) {
    if (idx === colIdx) return role;
  }
}

export default function CartolaMapperDragDrop({ empresaId }: { empresaId: string }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [saving, setSaving] = useState(false);

  const [zoneMap, setZoneMap] = useState<Record<string, number>>({});
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      toast("Solo Excel (.xlsx o .xls)", "error");
      return;
    }
    setLoading(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const res = await fetch("/api/preview-formato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, nombre: file.name }),
      });
      const data = await res.json();
      if (!data.ok) { toast(data.error ?? "Error al leer", "error"); return; }
      setPreview(data);
      setZoneMap({});
      setStep("mapping");
    } catch { toast("Error al procesar", "error"); }
    finally { setLoading(false); }
  }

  const handleDragStart = useCallback((e: React.DragEvent, colIdx: number) => {
    e.dataTransfer.setData("text/plain", String(colIdx));
    e.dataTransfer.effectAllowed = "move";
    setDragCol(colIdx);
  }, []);

  const handleDragEnd = useCallback(() => { setDragCol(null); setDragOverZone(null); }, []);

  const handleDragOver = useCallback((e: React.DragEvent, zoneRole: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverZone(zoneRole);
  }, []);

  const handleDragLeave = useCallback(() => setDragOverZone(null), []);

  const handleDrop = useCallback((e: React.DragEvent, zoneRole: string) => {
    e.preventDefault();
    setDragOverZone(null);
    setDragCol(null);
    const colIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(colIdx)) return;

    const newMap = { ...zoneMap };
    const existingZone = Object.entries(newMap).find(([, v]) => v === colIdx);
    if (existingZone) delete newMap[existingZone[0]];
    if (newMap[zoneRole] !== undefined) delete newMap[zoneRole];
    newMap[zoneRole] = colIdx;
    setZoneMap(newMap);
  }, [zoneMap]);

  function removeMapping(zoneRole: string) {
    const newMap = { ...zoneMap };
    delete newMap[zoneRole];
    setZoneMap(newMap);
  }

  function rolesArray(p: PreviewData): string[] {
    const roles: string[] = new Array(p.cols).fill("ignorar");
    for (const [role, colIdx] of Object.entries(zoneMap)) {
      if (colIdx >= 0 && colIdx < roles.length) roles[colIdx] = role;
    }
    return roles;
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
          roles: rolesArray(preview),
          headerRow: preview.rows[0],
          txStart: preview.txStart,
        }),
      });
      const data = await res.json();
      if (data.ok) { toast("Formato guardado"); setStep("done"); }
      else { toast(data.error ?? "Error al guardar", "error"); }
    } catch { toast("Error al guardar", "error"); }
    finally { setSaving(false); }
  }

  if (step === "done") {
    return (
      <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-3">
        <div className="flex items-center gap-2.5">
          <CheckCircle size={18} weight="fill" className="text-[#22C55E] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">Formato guardado</p>
            <p className="text-[11px] text-[var(--muted-light)] mt-0.5">
              La próxima vez que subas una cartola similar, el sistema la va a leer automáticamente.
            </p>
          </div>
        </div>
        <button onClick={() => { setStep("upload"); setPreview(null); }}
          className="text-xs text-[#E8553E] hover:underline">+ Agregar otro formato</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {step === "upload" && (
        <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-3">
          <div className="flex items-start gap-2.5">
            <UploadSimple size={18} weight="light" className="text-[var(--muted)] shrink-0 mt-0.5" />
            <div className="text-[11px] text-[var(--muted-light)] leading-relaxed">
              Subí una cartola de tu banco. Arrastrá los encabezados de columna a las zonas de mapeo.
            </div>
          </div>
          <div onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#E8553E]/40 hover:border-[#E8553E] bg-transparent hover:bg-[var(--accent-light)]/50 cursor-pointer px-4 py-3 transition-all">
            <UploadSimple size={16} className="text-[#E8553E]" />
            <span className="text-xs font-medium text-[var(--foreground)]">{loading ? "Leyendo archivo..." : "Subir Excel de cartola"}</span>
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </div>
      )}

      {step === "mapping" && preview && (
        <div className="space-y-3">
          {/* Header bar */}
          <div className="flex items-center justify-between">
            <button onClick={() => setStep("upload")} className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]">
              <ArrowLeft size={12} /> Volver
            </button>
            <p className="text-[10px] text-[var(--muted-light)]">{preview.sheetName} &middot; {preview.totalRows} filas</p>
          </div>

          {/* ================================================================ */}
          {/* EXCEL-STYLE GRID */}
          {/* ================================================================ */}
          <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white dark:bg-black/20">
            {/* Grid header — ribbon */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--surface)] border-b border-[var(--border)]">
              <button onClick={() => setShowGrid(!showGrid)}
                className="flex items-center gap-1 text-[9px] text-[var(--muted)] hover:text-[var(--foreground)]">
                <CaretDown size={10} className={`transition-transform ${showGrid ? "rotate-0" : "-rotate-90"}`} />
                {showGrid ? "Ocultar" : "Mostrar"} datos
              </button>
              <div className="text-[9px] text-[var(--muted-light)]">Arrastrá los encabezados  (A, B, C...)  a las zonas de abajo</div>
            </div>

            {showGrid && (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] border-collapse" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    {/* Column letters row — DRAGGABLE */}
                    <tr>
                      <th className="sticky left-0 z-10 w-8 min-w-[24px] bg-[var(--surface)] border-r border-b border-[var(--border)] text-[9px] text-[var(--muted-light)] font-medium text-center">&nbsp;</th>
                      {preview.rows[0]?.map((header: string, colIdx: number) => {
                        const r = roleFor(colIdx, zoneMap);
                        const zone = r ? ZONES.find((z) => z.role === r) : undefined;
                        const isDragging = dragCol === colIdx;
                        return (
                          <th key={colIdx}
                            draggable
                            onDragStart={(e) => handleDragStart(e, colIdx)}
                            onDragEnd={handleDragEnd}
                            className={`
                              relative min-w-[90px] px-2 py-1 text-left font-medium border-r border-b border-[var(--border)]
                              transition-all duration-150 select-none cursor-grab active:cursor-grabbing
                              ${isDragging ? "opacity-40 scale-95" : "hover:brightness-110"}
                              ${zone ? `text-white` : "text-[var(--muted)] bg-[var(--surface)]"}
                            `}
                            style={zone ? { backgroundColor: zone.color } : {}}>
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] opacity-60 font-mono">{COL_LETTERS[colIdx] || colIdx}</span>
                              <span className="truncate text-[10px]">{header || `Columna ${colIdx + 1}`}</span>
                              {zone && (
                                <span className="ml-auto text-[8px] opacity-70 whitespace-nowrap">{zone.icon} {zone.label.split(" ")[0]}</span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(1, 9).map((row: string[], ri: number) => (
                      <tr key={ri} className="hover:bg-[var(--surface)]/50">
                        <td className="sticky left-0 z-10 bg-[var(--surface)] border-r border-b border-[var(--border)] text-[9px] text-[var(--muted-light)] text-center font-mono">
                          {preview.txStart + ri + 1}
                        </td>
                        {row.map((cell: string, ci: number) => {
                          const r = roleFor(ci, zoneMap);
                          return (
                            <td key={ci}
                              className={`
                                px-2 py-1 truncate max-w-[140px] border-r border-b border-[var(--border)]
                                ${r ? "font-medium" : "text-[var(--muted-light)]"}
                              `}
                              style={r ? { borderLeft: `2px solid ${ZONES.find((z) => z.role === r)?.color ?? "transparent"}` } : {}}>
                              {cell || <span className="opacity-20">&mdash;</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ================================================================ */}
          {/* MAPPING LEGEND — the drop zones */}
          {/* ================================================================ */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--muted)] mb-2 uppercase tracking-wider">
              &mdash; Zonas de mapeo &mdash;
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ZONES.map((zone) => {
                const mappedCol = zoneMap[zone.role] ?? -1;
                const isOver = dragOverZone === zone.role;
                const colName = mappedCol >= 0 && preview.rows[0]?.[mappedCol]
                  ? preview.rows[0][mappedCol]
                  : null;
                return (
                  <div
                    key={zone.role}
                    onDragOver={(e) => handleDragOver(e, zone.role)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, zone.role)}
                    onClick={() => mappedCol >= 0 && removeMapping(zone.role)}
                    className={`
                      relative flex items-center gap-2 px-2.5 py-2 rounded-[10px] border
                      transition-all duration-150 select-none cursor-default
                      ${mappedCol >= 0
                        ? "border-solid text-white shadow-sm"
                        : isOver
                          ? "border-[#E8553E] bg-[#E8553E]/5 scale-[1.02]"
                          : "border-dashed border-[var(--border)] bg-[var(--surface)]/30 hover:border-[var(--muted)]"
                      }
                    `}
                    style={mappedCol >= 0 ? { backgroundColor: zone.color, borderColor: zone.color } : {}}>
                    <span className="text-[11px]">{zone.icon}</span>
                    {mappedCol >= 0 ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold">{colName}</span>
                        <span className="text-[8px] opacity-70">({zone.label})</span>
                        <X size={10} weight="bold" className="opacity-50 hover:opacity-100 cursor-pointer ml-0.5" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-medium text-[var(--muted)]">{zone.label}</span>
                        {zone.required && <span className="text-[8px] text-red-400">*</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {Object.keys(zoneMap).length === 0 && (
              <p className="text-[10px] text-amber-500 text-center mt-2">
                Arrastrá las columnas desde la tabla de arriba
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving || !zoneMap.fecha || !zoneMap.descripcion}
              className="btn-press flex-1 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-xs font-semibold text-white">
              {saving ? "Guardando..." : "Guardar formato"}
            </button>
            <button onClick={() => setStep("upload")} disabled={saving}
              className="btn-press rounded-xl bg-[var(--surface)] hover:bg-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
