"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash, PaperPlaneTilt, Warning, CheckCircle } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { formatRut, RECEPTOR_OBLIGATORIO_DESDE } from "@/lib/sii/validation";

type TipoDTE = 39 | 41;
interface Item { nombre: string; monto: string }

export default function EmitirBoletaForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [tipo, setTipo] = useState<TipoDTE>(39);
  const [rut, setRut] = useState("");
  const [razon, setRazon] = useState("");
  const [items, setItems] = useState<Item[]>([{ nombre: "", monto: "" }]);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ folio: number; total: number } | null>(null);

  const total = useMemo(() => {
    return items.reduce((s, it) => s + (parseInt(it.monto.replace(/\D/g, "")) || 0), 0);
  }, [items]);
  const requireReceptor = total > RECEPTOR_OBLIGATORIO_DESDE;
  const canSubmit =
    !busy &&
    total > 0 &&
    items.every((i) => i.nombre.trim() && parseInt(i.monto.replace(/\D/g, "")) > 0) &&
    (!requireReceptor || (rut.trim() && razon.trim()));

  function addItem() { setItems((prev) => [...prev, { nombre: "", monto: "" }]); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }
  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setSuccess(null);
    try {
      const res = await fetch("/api/intermediaria/emitir-boleta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_dte: tipo,
          receptor_rut: rut.trim() || undefined,
          receptor_razon_social: razon.trim() || undefined,
          detalles: items.map((it) => ({
            nombre: it.nombre.trim(),
            monto: parseInt(it.monto.replace(/\D/g, "")),
          })),
          monto_total: total,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        const msg = j.errores?.[0]?.message || j.detalle || j.error || "Error al emitir";
        toast(msg, "error");
        setBusy(false);
        return;
      }
      setSuccess({ folio: j.folio, total: j.monto_total });
      toast(`Boleta folio ${j.folio} emitida`);
      // Reset form
      setRut(""); setRazon(""); setItems([{ nombre: "", monto: "" }]);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error de red", "error");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 escritorio-col">
      {/* Tipo DTE */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--muted)] tracking-wide uppercase">Tipo</span>
        <div className="flex gap-1">
          {([
            { v: 39 as TipoDTE, label: "Afecta", hint: "Con IVA 19%" },
            { v: 41 as TipoDTE, label: "Exenta", hint: "Sin IVA" },
          ]).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setTipo(t.v)}
              title={t.hint}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                tipo === t.v
                  ? "bg-[#E8553E] text-white shadow-[0_1px_3px_rgba(232,85,62,0.3)]"
                  : "bg-transparent text-[var(--muted)] border border-[var(--border)] hover:text-[var(--foreground)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Receptor */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--muted)] tracking-wide uppercase">Receptor</span>
          {requireReceptor ? (
            <span className="flex items-center gap-1 text-[10px] text-[#E8553E] bg-[var(--accent-light)] rounded-full px-2 py-0.5 font-medium">
              <Warning size={10} weight="bold" />
              Obligatorio · total &gt; ${RECEPTOR_OBLIGATORIO_DESDE.toLocaleString("es-CL")}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--muted-light)]">Opcional bajo $180.000</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            onBlur={() => setRut((v) => (v ? formatRut(v) : v))}
            placeholder="RUT (12.345.678-9)"
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#E8553E]/40"
          />
          <input
            type="text"
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            placeholder="Razón social"
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#E8553E]/40"
          />
        </div>
      </div>

      {/* Detalle */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--muted)] tracking-wide uppercase">Detalle</span>
          <span className="text-[10px] text-[var(--muted-light)] ml-auto">{items.length} línea{items.length !== 1 ? "s" : ""}</span>
        </div>
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={it.nombre}
              onChange={(e) => updateItem(i, { nombre: e.target.value })}
              placeholder="Concepto"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#E8553E]/40"
            />
            <input
              type="text"
              inputMode="numeric"
              value={it.monto}
              onChange={(e) => updateItem(i, { monto: e.target.value.replace(/\D/g, "") })}
              placeholder="Monto"
              className="w-32 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[12px] tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-[#E8553E]/40"
            />
            {items.length > 1 && (
              <button type="button" onClick={() => removeItem(i)}
                className="p-2 rounded-lg text-[var(--muted)] hover:bg-[var(--accent-light)] hover:text-[#E8553E] transition-colors"
                aria-label="Eliminar línea">
                <Trash size={14} weight="bold" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={addItem}
          className="flex items-center gap-1.5 text-[11px] text-[#E8553E] hover:text-[var(--accent-hover)] font-semibold transition-colors">
          <Plus size={12} weight="bold" /> Otra línea
        </button>
      </div>

      {/* Resumen total */}
      <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
        <span className="text-[11px] text-[var(--muted)] tracking-wide uppercase">Total a emitir</span>
        <span className="text-[20px] font-light tabular-nums text-[var(--foreground)]">
          ${total.toLocaleString("es-CL")}
        </span>
      </div>

      {success && (
        <div className="flex items-center gap-2 text-[11px] text-[#22C55E] bg-[#22C55E]/10 rounded-lg px-3 py-2 animate-fade-in">
          <CheckCircle size={14} weight="fill" />
          Boleta folio <b>{success.folio}</b> emitida por ${success.total.toLocaleString("es-CL")}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="btn-press w-full flex items-center justify-center gap-2 rounded-xl bg-[#E8553E] text-white font-semibold text-[13px] py-3 disabled:opacity-40 hover:bg-[var(--accent-hover)] transition-colors"
      >
        <PaperPlaneTilt size={16} weight="bold" />
        {busy ? "Emitiendo..." : `Emitir boleta ${tipo === 39 ? "afecta" : "exenta"}`}
      </button>
    </form>
  );
}
