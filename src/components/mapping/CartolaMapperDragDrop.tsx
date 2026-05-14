"use client";

import { useState, useRef, useCallback } from "react";
import { UploadSimple, CheckCircle, CaretDown, ArrowLeft } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Role = "ignorar" | "fecha" | "descripcion" | "monto" | "cargo" | "abono" | "n_documento" | "saldo";

interface ZoneDef {
  role: Role;
  label: string;
  hint: string;
  required: boolean;
  color: string;
  bgClass: string;
}

const ZONES: ZoneDef[] = [
  { role: "fecha", label: "Fecha", hint: "dd/mm/aaaa o similar", required: true, color: "#3B82F6", bgClass: "bg-blue-500/10 border-blue-500/30 text-blue-500" },
  { role: "descripcion", label: "Descripción / Glosa", hint: "Texto del movimiento", required: true, color: "#14B8A6", bgClass: "bg-teal-500/10 border-teal-500/30 text-teal-500" },
  { role: "monto", label: "Monto único", hint: "Cargo o abono, una columna", required: false, color: "#E8553E", bgClass: "bg-[#E8553E]/10 border-[#E8553E]/30 text-[#E8553E]" },
  { role: "cargo", label: "Cargo (solo egresos)", hint: "Columna de débitos", required: false, color: "#F59E0B", bgClass: "bg-amber-500/10 border-amber-500/30 text-amber-500" },
  { role: "abono", label: "Abono (solo ingresos)", hint: "Columna de créditos", required: false, color: "#22C55E", bgClass: "bg-green-500/10 border-green-500/30 text-green-500" },
  { role: "n_documento", label: "N° operación", hint: "ID de la transacción", required: false, color: "#6366F1", bgClass: "bg-indigo-500/10 border-indigo-500/30 text-indigo-500" },
  { role: "saldo", label: "Saldo / Balance", hint: "Saldo después del movimiento", required: false, color: "#8B5CF6", bgClass: "bg-violet-500/10 border-violet-500/30 text-violet-500" },
];

const ROLE_BG: Record<string, string> = {};
for (const z of ZONES) ROLE_BG[z.role] = z.bgClass;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [saving, setSaving] = useState(false);

  // zoneRole[zoneIdx] = column index or -1
  const [zoneMap, setZoneMap] = useState<Record<string, number>>({});
  // columnColors[colIdx] = role color for preview highlight
  const [colStyles, setColStyles] = useState<Record<number, string>>({});

  const [dragOverZone, setDragOverZone] = useState<string | null>(null);

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
      if (!data.ok) {
        toast(data.error ?? "Error al leer el archivo", "error");
        return;
      }
      setPreview(data);
      setZoneMap({});
      setColStyles({});
      setStep("mapping");
    } catch {
      toast("Error al procesar el archivo", "error");
    } finally {
      setLoading(false);
    }
  }

  const handleDragStart = useCallback((e: React.DragEvent, colIdx: number) => {
    e.dataTransfer.setData("text/plain", String(colIdx));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, zoneRole: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverZone(zoneRole);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverZone(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, zoneRole: string) => {
    e.preventDefault();
    setDragOverZone(null);
    const colIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(colIdx)) return;

    // Check if column already assigned to a different zone
    const existingZone = Object.entries(zoneMap).find(([, v]) => v === colIdx);
    const newMap = { ...zoneMap };
    if (existingZone) delete newMap[existingZone[0]];

    // If this zone already has a column, free it
    if (newMap[zoneRole] !== undefined) delete newMap[zoneRole];

    newMap[zoneRole] = colIdx;
    setZoneMap(newMap);

    // Update column style
    const zone = ZONES.find((z) => z.role === zoneRole);
    if (zone) {
      setColStyles((prev) => ({ ...prev, [colIdx]: zone.bgClass }));
    }
  }, [zoneMap]);

  const handleRemoveMapping = (zoneRole: string) => {
    const colIdx = zoneMap[zoneRole];
    const newMap = { ...zoneMap };
    delete newMap[zoneRole];
    setZoneMap(newMap);
    if (colIdx !== undefined) {
      setColStyles((prev) => {
        const copy = { ...prev };
        delete copy[colIdx];
        return copy;
      });
    }
  };

  function rolesArray(preview: PreviewData): string[] {
    const roles: string[] = new Array(preview.cols).fill("ignorar");
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
      if (data.ok) {
        toast("Formato guardado correctamente");
        setStep("done");
      } else {
        toast(data.error ?? "Error al guardar", "error");
      }
    } catch {
      toast("Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleDropZoneClick(zoneRole: string) {
    const colIdx = zoneMap[zoneRole];
    if (colIdx !== undefined) handleRemoveMapping(zoneRole);
  }

  if (step === "done") {
    return (
      <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-3">
        <div className="flex items-center gap-2.5">
          <CheckCircle size={18} weight="fill" className="text-[#22C55E] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">Formato guardado</p>
            <p className="text-[11px] text-[var(--muted-light)] mt-0.5">
              La próxima vez que subas una cartola del mismo banco, se va a leer automáticamente.
            </p>
          </div>
        </div>
        <button onClick={() => { setStep("upload"); setPreview(null); }}
          className="text-xs text-[#E8553E] hover:underline">
          + Agregar otro formato
        </button>
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
              Subí una cartola de tu banco. Arrastrá cada columna a la zona que le corresponde.
            </div>
          </div>

          <div onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#E8553E]/40 hover:border-[#E8553E] bg-transparent hover:bg-[var(--accent-light)]/50 cursor-pointer px-4 py-3 transition-all">
            <UploadSimple size={16} className="text-[#E8553E]" />
            <span className="text-xs font-medium text-[var(--foreground)]">
              {loading ? "Leyendo archivo..." : "Subir Excel de cartola"}
            </span>
          </div>

          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </div>
      )}

      {step === "mapping" && preview && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <button onClick={() => setStep("upload")} className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
              <ArrowLeft size={12} /> Volver
            </button>
            <p className="text-[10px] text-[var(--muted-light)]">
              {preview.sheetName} &middot; {preview.totalRows} filas
            </p>
          </div>

          {/* ================================================================ */}
          {/* DROP ZONES */}
          {/* ================================================================ */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--muted)] mb-2 uppercase tracking-wider">
              Zonas de mapeo
            </p>
            <div className="flex flex-wrap gap-2">
              {ZONES.map((zone) => {
                const mappedCol = zoneMap[zone.role] ?? -1;
                const isOver = dragOverZone === zone.role;
                const colName = mappedCol >= 0 && mappedCol < preview.rows[0]?.length
                  ? (preview.rows[0]?.[mappedCol] || `Col ${mappedCol + 1}`)
                  : null;
                return (
                  <div
                    key={zone.role}
                    onDragOver={(e) => handleDragOver(e, zone.role)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, zone.role)}
                    onClick={() => handleDropZoneClick(zone.role)}
                    className={`
                      relative flex flex-col items-center justify-center
                      min-w-[100px] min-h-[64px] px-3 py-2.5 rounded-xl border-2
                      transition-all duration-150 cursor-pointer select-none
                      ${mappedCol >= 0
                        ? zone.bgClass + " border-solid"
                        : isOver
                          ? "border-[#E8553E] bg-[#E8553E]/10"
                          : "border-dashed border-[var(--border)] hover:border-[var(--muted)] bg-[var(--surface)]/50"
                      }
                    `}>
                    {mappedCol >= 0 ? (
                      <>
                        <span className="text-[10px] font-semibold leading-tight mb-0.5">{colName}</span>
                        <span className="text-[8px] opacity-60">{zone.label}</span>
                        <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center text-[8px] font-bold opacity-0 hover:opacity-100 transition-opacity"
                          title="Quitar" onClick={(e) => { e.stopPropagation(); handleRemoveMapping(zone.role); }}>&times;</div>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] font-semibold leading-tight">{zone.label}</span>
                        <span className="text-[8px] text-[var(--muted-light)] mt-0.5">{zone.hint}</span>
                        {zone.required && <span className="text-[8px] text-red-400 mt-0.5">* obligatorio</span>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ================================================================ */}
          {/* COLUMN CHIPS */}
          {/* ================================================================ */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--muted)] mb-2 uppercase tracking-wider">
              Columnas del archivo
            </p>
            <div className="flex flex-wrap gap-1.5">
              {preview.rows[0]?.map((header: string, colIdx: number) => {
                const assignedRole = Object.entries(zoneMap).find(([, v]) => v === colIdx)?.[0];
                const style = assignedRole ? ROLE_BG[assignedRole] ?? "" : "bg-[var(--surface)] border-[var(--border)] text-[var(--muted)]";
                return (
                  <div
                    key={colIdx}
                    draggable
                    onDragStart={(e) => handleDragStart(e, colIdx)}
                    className={`
                      group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border
                      text-[10px] font-medium cursor-grab active:cursor-grabbing
                      transition-all duration-150 select-none
                      hover:shadow-sm hover:scale-[1.02]
                      ${style}
                      ${assignedRole ? "ring-1 ring-inset ring-white/20" : ""}
                    `}>
                    <span className="text-[8px] opacity-40 tabular-nums">{colIdx + 1}</span>
                    <span className="truncate max-w-[80px]">{header || `Col ${colIdx + 1}`}</span>
                    {preview.rows[1]?.[colIdx] && (
                      <span className="hidden group-hover:inline text-[8px] opacity-50 truncate max-w-[60px] ml-1">
                        ej: {preview.rows[1][colIdx]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ================================================================ */}
          {/* PREVIEW TABLE */}
          {/* ================================================================ */}
          <details className="group">
            <summary className="flex items-center gap-1 text-[10px] text-[var(--muted-light)] cursor-pointer hover:text-[var(--muted)]">
              <CaretDown size={10} className="transition-transform group-open:rotate-180" />
              Vista previa ({preview.rows.length} filas)
            </summary>
            <div className="mt-2 overflow-x-auto border border-[var(--border)] rounded-xl">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-[var(--surface)]">
                    {preview.rows[0]?.map((_: string, i: number) => {
                      const assigned = Object.entries(zoneMap).find(([, v]) => v === i)?.[0];
                      return (
                        <th key={i} className={`px-2 py-1.5 text-left whitespace-nowrap font-medium border-b border-[var(--border)] ${assigned ? ROLE_BG[assigned] ?? "" : "text-[var(--muted)]"}`}>
                          {assigned || i + 1}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(1, 7).map((row: string[], ri: number) => (
                    <tr key={ri} className="border-t border-[var(--border)] hover:bg-[var(--surface)]/50">
                      {row.map((cell: string, ci: number) => {
                        const assigned = Object.entries(zoneMap).find(([, v]) => v === ci)?.[0];
                        return (
                          <td key={ci} className={`px-2 py-1 truncate max-w-[140px] ${assigned ? "font-medium" : "text-[var(--muted-light)]"}`}>
                            {cell || <span className="opacity-30">&mdash;</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {/* Save */}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || Object.keys(zoneMap).length === 0}
              className="btn-press flex-1 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-xs font-semibold text-white transition-all duration-150">
              {saving ? "Guardando..." : "Guardar formato"}
            </button>
            <button onClick={() => setStep("upload")} disabled={saving}
              className="btn-press rounded-xl bg-[var(--surface)] hover:bg-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)] transition-all duration-150">
              Cancelar
            </button>
          </div>

          {Object.keys(zoneMap).length === 0 && (
            <p className="text-[10px] text-amber-500 text-center">
              Arrastrá las columnas de arriba a las zonas de mapeo
            </p>
          )}
        </div>
      )}
    </div>
  );
}
