"use client";

import { useState, useRef, useCallback } from "react";
import { UploadSimple, CheckCircle, ArrowLeft, X } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Role = "ignorar" | "fecha" | "descripcion" | "monto" | "cargo" | "abono" | "n_documento" | "saldo";

interface ZoneDef {
  role: Role;
  label: string;
  hint: string;
  required: boolean;
  color: string;
}

const ZONES: ZoneDef[] = [
  { role: "fecha", label: "Fecha", hint: "ej: 15/01/2024", required: true, color: "#3B82F6" },
  { role: "descripcion", label: "Descripción", hint: "ej: Transferencia", required: true, color: "#14B8A6" },
  { role: "monto", label: "Monto", hint: "ej: 150.000", required: false, color: "#E8553E" },
  { role: "cargo", label: "Cargo", hint: "solo egresos", required: false, color: "#F59E0B" },
  { role: "abono", label: "Abono", hint: "solo ingresos", required: false, color: "#22C55E" },
  { role: "n_documento", label: "N°", hint: "ej: 001234", required: false, color: "#6366F1" },
  { role: "saldo", label: "Saldo", hint: "ej: 1.500.000", required: false, color: "#8B5CF6" },
];

interface PreviewData {
  sheetName: string;
  fingerprint: string;
  totalRows: number;
  cols: number;
  rows: string[][];
  txStart: number;
  hasHeader: boolean;
}

export default function CartolaMapperDragDrop({ empresaId }: { empresaId: string }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoneMap, setZoneMap] = useState<Record<string, number>>({});
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) { toast("Solo Excel (.xlsx o .xls)", "error"); return; }
    setLoading(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const res = await fetch("/api/preview-formato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64: btoa(bin), nombre: file.name }) });
      const data = await res.json();
      if (!data.ok) { toast(data.error ?? "Error al leer", "error"); return; }
      setPreview(data); setZoneMap({}); setStep("mapping");
    } catch { toast("Error al procesar", "error"); } finally { setLoading(false); }
  }

  function assign(zoneRole: string, colIdx: number) {
    const newMap = { ...zoneMap };
    const existing = Object.entries(newMap).find(([, v]) => v === colIdx);
    if (existing) delete newMap[existing[0]];
    if (newMap[zoneRole] !== undefined) delete newMap[zoneRole];
    newMap[zoneRole] = colIdx;
    setZoneMap(newMap);
    setSelectedCol(null);
  }

  function unassign(zoneRole: string) {
    const newMap = { ...zoneMap };
    delete newMap[zoneRole];
    setZoneMap(newMap);
  }

  function tapColumn(colIdx: number) {
    const already = Object.entries(zoneMap).find(([, v]) => v === colIdx);
    if (already) { unassign(already[0]); return; }
    setSelectedCol(selectedCol === colIdx ? null : colIdx);
  }

  function tapZone(zoneRole: string) {
    if (zoneMap[zoneRole] !== undefined) { unassign(zoneRole); return; }
    if (selectedCol !== null) { assign(zoneRole, selectedCol); return; }
  }

  const handleDragStart = useCallback((e: React.DragEvent, colIdx: number) => {
    e.dataTransfer.setData("text/plain", String(colIdx));
    e.dataTransfer.effectAllowed = "move";
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent, z: string) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverZone(z); }, []);
  const handleDrop = useCallback((e: React.DragEvent, z: string) => {
    e.preventDefault(); setDragOverZone(null);
    const colIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!isNaN(colIdx)) assign(z, colIdx);
  }, [zoneMap]);

  function rolesArr(p: PreviewData): string[] {
    const roles = new Array(p.cols).fill("ignorar");
    for (const [role, idx] of Object.entries(zoneMap)) if (idx >= 0 && idx < roles.length) roles[idx] = role;
    return roles;
  }

  async function handleSave() {
    if (!preview) return;
    setSaving(true);
    try {
      const res = await fetch("/api/guardar-formato", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: preview.fingerprint, nombre: preview.sheetName, roles: rolesArr(preview), headerRow: preview.rows[0], txStart: preview.txStart }),
      });
      const d = await res.json();
      if (d.ok) { toast("Formato guardado"); setStep("done"); } else { toast(d.error ?? "Error", "error"); }
    } catch { toast("Error al guardar", "error"); } finally { setSaving(false); }
  }

  if (step === "done") return (
    <div className="p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-2">
      <div className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="text-[#22C55E] shrink-0" /><p className="text-xs font-medium text-[var(--foreground)]">Formato guardado</p></div>
      <p className="text-[10px] text-[var(--muted-light)]">Próximas cartolas iguales se leerán solas.</p>
      <button onClick={() => { setStep("upload"); setPreview(null); }} className="text-[10px] text-[#E8553E] hover:underline">+ Otro formato</button>
    </div>
  );

  return (
    <div className="space-y-2">
      {step === "upload" && (
        <div className="p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-2">
          <p className="text-[10px] text-[var(--muted-light)]">Subí una cartola y arrastrá sus columnas a los campos de abajo.</p>
          <div onClick={() => inputRef.current?.click()} className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#E8553E]/40 hover:border-[#E8553E] cursor-pointer px-3 py-2.5">
            <UploadSimple size={14} className="text-[#E8553E]" />
            <span className="text-[11px] font-medium text-[var(--foreground)]">{loading ? "Leyendo..." : "Subir Excel"}</span>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </div>
      )}

      {step === "mapping" && preview && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <button onClick={() => setStep("upload")} className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={11} /> Volver</button>
            <span className="text-[9px] text-[var(--muted-light)]">{preview.sheetName}</span>
          </div>

          {/* Mini Excel preview */}
          <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white dark:bg-black/20">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr>
                    {preview.rows[0]?.map((h: string, i: number) => {
                      const r = Object.entries(zoneMap).find(([, v]) => v === i)?.[0];
                      const z = r ? ZONES.find((x) => x.role === r) : undefined;
                      const isSelected = selectedCol === i;
                      return (
                        <th key={i}
                          draggable
                          onDragStart={(e) => handleDragStart(e, i)}
                          onDragEnd={() => setDragOverZone(null)}
                          onClick={() => tapColumn(i)}
                          className={`px-1.5 py-1 text-left font-medium border-r border-b border-[var(--border)] cursor-grab active:cursor-grabbing select-none transition-all text-[10px] ${isSelected ? "ring-2 ring-[#E8553E] ring-inset" : ""} ${z ? "text-white" : "text-[var(--muted)] bg-[var(--surface)]"}`}
                          style={z ? { backgroundColor: z.color } : {}}>
                          <div className="flex items-center gap-1">
                            {z && <span className="text-[8px] opacity-70">{z.label[0]}</span>}
                            <span className="truncate max-w-[70px]">{h || `#${i + 1}`}</span>
                            {z && <X size={8} weight="bold" className="ml-auto opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); unassign(r!); }} />}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(1, 4).map((row, ri) => (
                    <tr key={ri} className="border-t border-[var(--border)]">
                      {row.map((cell, ci) => {
                        const r = Object.entries(zoneMap).find(([, v]) => v === ci)?.[0];
                        return <td key={ci} className="px-1.5 py-1 truncate max-w-[100px] border-r border-[var(--border)] text-[9px] text-[var(--muted)]" style={r ? { borderLeft: `2px solid ${ZONES.find((x) => x.role === r)?.color}` } : {}}>{cell || <span className="opacity-20">&mdash;</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drop zones */}
          <div className="flex flex-wrap gap-1">
            {ZONES.map((zone) => {
              const colIdx = zoneMap[zone.role] ?? -1;
              const isOver = dragOverZone === zone.role;
              const colName = colIdx >= 0 ? (preview.rows[0]?.[colIdx] || `#${colIdx + 1}`) : null;
              return (
                <div key={zone.role}
                  onDragOver={(e) => handleDragOver(e, zone.role)}
                  onDragLeave={() => setDragOverZone(null)}
                  onDrop={(e) => handleDrop(e, zone.role)}
                  onClick={() => tapZone(zone.role)}
                  className={`
                    flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[10px]
                    transition-all duration-150 select-none cursor-pointer
                    ${colIdx >= 0
                      ? "border-solid text-white shadow-sm font-medium"
                      : isOver
                        ? "border-[#E8553E] bg-[#E8553E]/5 scale-[1.03]"
                        : "border-dashed border-[var(--border)] bg-[var(--surface)]/20 hover:border-[var(--muted)] text-[var(--muted)]"
                    }
                  `}
                  style={colIdx >= 0 ? { backgroundColor: zone.color, borderColor: zone.color } : {}}>
                  <span className="text-[9px] opacity-70">{zone.required ? "★" : "○"}</span>
                  <span className="whitespace-nowrap">{colName || zone.label}</span>
                  {colIdx >= 0 && <X size={9} weight="bold" className="opacity-60 hover:opacity-100" />}
                </div>
              );
            })}
          </div>

          {/* Hint + button */}
          <div className="flex items-center gap-2">
            <button onClick={handleSave} disabled={saving || !zoneMap.fecha || !zoneMap.descripcion}
              className="btn-press flex-1 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-[11px] font-semibold text-white">
              {saving ? "Guardando..." : "Guardar formato"}
            </button>
            {(!zoneMap.fecha || !zoneMap.descripcion) && (
              <span className="text-[9px] text-amber-500 whitespace-nowrap">Fecha y Descripción obligatorias</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
