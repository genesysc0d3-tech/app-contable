"use client";

import { useState, useEffect } from "react";
import { Eye, EyeSlash, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

export default function AiKeyConfig() {
  const { toast } = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config/ai-key")
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured ?? false))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!key.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/config/ai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        toast("API key guardada correctamente");
        setConfigured(true);
        setKey("");
      } else {
        toast(data.error ?? "Error al guardar", "error");
      }
    } catch {
      toast("Error al guardar la API key", "error");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <section className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
        <h2 className="text-sm font-semibold mb-2">API DeepSeek</h2>
        <p className="text-xs text-[var(--muted-light)]">Cargando...</p>
      </section>
    );
  }

  return (
    <section className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold">API DeepSeek</h2>
        {configured !== null && (
          configured ? (
            <span className="flex items-center gap-1 text-[10px] text-[#22C55E] font-medium">
              <CheckCircle size={12} weight="fill" /> Configurada
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-[#E8553E] font-medium">
              <WarningCircle size={12} weight="fill" /> Sin configurar
            </span>
          )
        )}
      </div>
      <p className="text-[11px] text-[var(--muted-light)] mb-3">
        La API key se guarda en la base de datos, no en variables de entorno.
      </p>
      {!configured && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={visible ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:border-[#E8553E] transition-colors pr-8"
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                {visible ? <EyeSlash size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !key.trim()}
              className="btn-press rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition-all duration-150 shrink-0"
            >
              {saving ? "..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
