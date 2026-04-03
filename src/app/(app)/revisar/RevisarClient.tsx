"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PropuestaCard from "@/components/propuestas/PropuestaCard";
import { aprobarTodas } from "./actions";
import type { Tables } from "@/lib/database.types";

type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw">;
};

interface RevisarClientProps {
  propuestas: Propuesta[];
}

export default function RevisarClient({ propuestas }: RevisarClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const pendientes = propuestas.filter((p) => p.estado === "pendiente");
  const highConfidence = pendientes.filter(
    (p) => p.confianza !== null && p.confianza >= 0.8
  );

  async function handleAprobarTodas() {
    if (highConfidence.length === 0) return;
    setLoading(true);
    await aprobarTodas(highConfidence.map((p) => p.id));
    router.refresh();
    setLoading(false);
  }

  return (
    <div className="flex-1 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Revisar</h1>
            <p className="text-sm text-white/50 mt-0.5">
              {pendientes.length} propuesta{pendientes.length !== 1 ? "s" : ""}{" "}
              pendiente{pendientes.length !== 1 ? "s" : ""}
            </p>
          </div>
          {highConfidence.length > 1 && (
            <button
              onClick={handleAprobarTodas}
              disabled={loading}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors"
            >
              {loading
                ? "Aprobando..."
                : `Aprobar todo (${highConfidence.length})`}
            </button>
          )}
        </div>

        {/* Info about "Aprobar todo" */}
        {highConfidence.length > 1 && (
          <p className="text-xs text-white/30">
            &quot;Aprobar todo&quot; solo aprueba propuestas con confianza mayor
            o igual a 80%
          </p>
        )}

        {/* Lista de propuestas */}
        {pendientes.length === 0 ? (
          <div className="text-center py-16 text-white/40">
            <p className="text-3xl mb-2">✓</p>
            <p className="text-sm">Todo revisado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendientes.map((p) => (
              <PropuestaCard
                key={p.id}
                propuesta={p}
                onAction={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
