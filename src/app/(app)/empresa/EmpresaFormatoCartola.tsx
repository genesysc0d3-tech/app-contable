"use client";

import { useState, useRef } from "react";
import { UploadSimple, CheckCircle, WarningCircle, CaretDown } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

type Role = "ignorar" | "fecha" | "descripcion" | "monto" | "cargo" | "abono" | "n_documento" | "saldo";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "ignorar", label: "Ignorar" },
  { value: "fecha", label: "Fecha" },
  { value: "descripcion", label: "Descripción / Glosa" },
  { value: "monto", label: "Monto (cargo o abono)" },
  { value: "cargo", label: "Cargo (solo egresos)" },
  { value: "abono", label: "Abono (solo ingresos)" },
  { value: "n_documento", label: "N° operación / documento" },
  { value: "saldo", label: "Saldo / balance" },
];

const ROLE_COLORS: Record<Role, string> = {
  ignorar: "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)]",
  fecha: "bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30",
  descripcion: "bg-[#14B8A6]/10 text-[#14B8A6] border-[#14B8A6]/30",
  monto: "bg-[#E8553E]/10 text-[#E8553E] border-[#E8553E]/30",
  cargo: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30",
  abono: "bg-[#22C55E]/10 text-[#22C55E] border-[#22C55E]/30",
  n_documento: "bg-[#6366F1]/10 text-[#6366F1] border-[#6366F1]/30",
  saldo: "bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30",
};

interface PreviewData {
  sheetName: string;
  fingerprint: string;
  totalRows: number;
  cols: number;
  rows: string[][];
  txStart: number;
  hasHeader: boolean;
}

export default function EmpresaFormatoCartola({ empresaId }: { empresaId: string }) {
  const { toast } = useToast();
  const [step, setStep] = useState<"upload" | "mapping" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      toast("Solo Excel (.xlsx o .xls)", "error");
      return;
    }

    setLoading(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));

      const res = await fetch("/api/preview-formato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, nombre: file.name }),
      });

      const data = await res.json();
      if (!data.ok) {
        toast(data.error ?? "Error al leer el archivo", "error");
        setLoading(false);
        return;
      }

      setPreview(data);
      // Default roles: ignore all columns
      setRoles(new Array(data.cols).fill("ignorar"));
      setStep("mapping");
    } catch {
      toast("Error al procesar el archivo", "error");
    }
    setLoading(false);
  }

  function handleSave() {
    if (!preview) return;
    setSaving(true);
    fetch("/api/guardar-formato", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint: preview.fingerprint,
        nombre: preview.sheetName,
        roles,
        headerRow: preview.rows[0],
        txStart: preview.txStart,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          toast("Formato guardado correctamente");
          setStep("done");
        } else {
          toast(data.error ?? "Error al guardar", "error");
        }
      })
      .catch(() => toast("Error al guardar", "error"))
      .finally(() => setSaving(false));
  }

  if (step === "done") {
    return (
      <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-3">
        <div className="flex items-center gap-2.5">
          <CheckCircle size={18} weight="fill" className="text-[#22C55E] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">Formato guardado</p>
            <p className="text-[11px] text-[var(--muted-light)] mt-0.5">
              La próxima vez que subas una cartola del mismo banco, el sistema la va a leer automáticamente.
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
    <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-3">
      {step === "upload" && (
        <>
          <div className="flex items-start gap-2.5">
            <UploadSimple size={18} weight="light" className="text-[var(--muted)] shrink-0 mt-0.5" />
            <div className="text-[11px] text-[var(--muted-light)] leading-relaxed">
              Subí una cartola de tu banco. El sistema te va a mostrar las columnas para que le digas qué es cada una.
              La próxima vez que subas una igual, la va a leer sola.
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
        </>
      )}

      {step === "mapping" && preview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--foreground)]">
              {preview.sheetName} — {preview.totalRows} filas
            </p>
          </div>

          {preview.txStart > 0 && (
            <p className="text-[10px] text-[#22C55E] bg-[#ECFDF5] dark:bg-[#22C55E]/10 rounded-lg px-2.5 py-1.5">
              El sistema detectó automáticamente que los datos empiezan en la fila {preview.txStart + 1}.
              Las filas de encabezado se saltan solas, no las marqués.
            </p>
          )}

          <p className="text-[10px] text-[var(--muted-light)] leading-relaxed">
            Decile al sistema qué significa cada columna de tu cartola.
            Solo necesitás <strong>fecha</strong>, <strong>descripción</strong> y <strong>monto</strong> (o cargo/abono).
          </p>

          {/* Column roles */}
          <div className="space-y-1.5">
            {preview.rows[0]?.map((header: string, colIdx: number) => (
              <div key={colIdx} className="flex items-center gap-2">
                <div className="w-8 text-[9px] text-[var(--muted-light)] tabular-nums text-right shrink-0">{colIdx + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[var(--foreground)] truncate font-medium">{header || `Columna ${colIdx + 1}`}</p>
                  <p className="text-[9px] text-[var(--muted-light)] truncate">
                    {preview.rows[1]?.[colIdx] ? `Ej: ${preview.rows[1][colIdx]}` : "(vacía)"}
                  </p>
                </div>
                <select value={roles[colIdx]} onChange={(e) => {
                  const newRoles = [...roles];
                  newRoles[colIdx] = e.target.value as Role;
                  setRoles(newRoles);
                }}
                  className={`text-[10px] rounded-lg border px-2 py-1.5 focus:outline-none focus:border-[#E8553E] ${ROLE_COLORS[roles[colIdx]]}`}>
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Preview rows */}
          <details className="group">
            <summary className="flex items-center gap-1 text-[10px] text-[var(--muted-light)] cursor-pointer hover:text-[var(--muted)]">
              <CaretDown size={10} className="transition-transform group-open:rotate-180" />
              Vista previa ({preview.rows.length} filas)
            </summary>
            <div className="mt-1 overflow-x-auto text-[9px] border border-[var(--border)] rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--surface)]">
                    {preview.rows[0]?.map((_: string, i: number) => (
                      <th key={i} className={`px-2 py-1 text-left whitespace-nowrap font-medium ${ROLE_COLORS[roles[i]]?.split(" ")[0] ?? ""}`}>
                        {roles[i] !== "ignorar" ? roles[i] : i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((row: string[], ri: number) => (
                    <tr key={ri} className="border-t border-[var(--border)]">
                      {row.map((cell: string, ci: number) => (
                        <td key={ci} className="px-2 py-1 text-[var(--foreground)] truncate max-w-[120px]">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="btn-press flex-1 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-all duration-150">
              {saving ? "Guardando..." : "Guardar formato"}
            </button>
            <button onClick={() => setStep("upload")} disabled={saving}
              className="btn-press rounded-xl bg-[var(--surface)] hover:bg-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)] transition-all duration-150">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
