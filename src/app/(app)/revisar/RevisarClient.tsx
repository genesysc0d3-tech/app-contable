"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import PropuestaCard from "@/components/propuestas/PropuestaCard";
import { aprobarTodas } from "./actions";
import type { Tables } from "@/lib/database.types";

type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw"> & {
    documentos_subidos: {
      id: string;
      nombre_archivo: string;
      created_at: string;
    };
  };
};

type ClienteResumen = { id: string; nombre: string; rut: string | null };

interface DocumentGroup {
  documentoId: string;
  nombreArchivo: string;
  fechaSubida: string;
  propuestas: Propuesta[];
  pendientes: number;
  aprobados: number;
  descartados: number;
}

interface RevisarClientProps {
  propuestas: Propuesta[];
  clientes: ClienteResumen[];
  empresaId: string;
}

function DocumentSection({
  group,
  clientes,
  empresaId,
  defaultExpanded,
  onAction,
}: {
  group: DocumentGroup;
  clientes: ClienteResumen[];
  empresaId: string;
  defaultExpanded: boolean;
  onAction: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pendientes = group.propuestas.filter((p) => p.estado === "pendiente");

  const fecha = new Date(group.fechaSubida).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
      {/* Document header — collapsible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
      >
        <span className="text-white/40 text-sm transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-white/90 truncate">
            {group.nombreArchivo}
          </p>
          <p className="text-[10px] text-white/40 mt-0.5">{fecha}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {group.pendientes > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 font-medium">
              {group.pendientes} pendiente{group.pendientes !== 1 ? "s" : ""}
            </span>
          )}
          {group.aprobados > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium">
              {group.aprobados}
            </span>
          )}
          {group.descartados > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/40 font-medium">
              {group.descartados}
            </span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && pendientes.length > 0 && (
        <div className="px-4 pb-4 space-y-3">
          {pendientes.map((p) => (
            <PropuestaCard
              key={p.id}
              propuesta={p}
              clientes={clientes}
              empresaId={empresaId}
              onAction={onAction}
            />
          ))}
        </div>
      )}

      {expanded && pendientes.length === 0 && (
        <div className="px-4 pb-4 text-center text-white/30 text-xs py-4">
          Todo revisado en este documento
        </div>
      )}
    </div>
  );
}

export default function RevisarClient({
  propuestas,
  clientes,
  empresaId,
}: RevisarClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, DocumentGroup>();

    for (const p of propuestas) {
      const doc = p.movimientos_raw?.documentos_subidos;
      if (!doc) continue;

      let group = map.get(doc.id);
      if (!group) {
        group = {
          documentoId: doc.id,
          nombreArchivo: doc.nombre_archivo,
          fechaSubida: doc.created_at,
          propuestas: [],
          pendientes: 0,
          aprobados: 0,
          descartados: 0,
        };
        map.set(doc.id, group);
      }

      group.propuestas.push(p);
      if (p.estado === "pendiente") group.pendientes++;
      else if (p.estado === "aprobado" || p.estado === "editado") group.aprobados++;
      else if (p.estado === "descartado") group.descartados++;
    }

    // Sort by fecha_subida descending (most recent first)
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.fechaSubida).getTime() - new Date(a.fechaSubida).getTime()
    );
  }, [propuestas]);

  const totalPendientes = groups.reduce((s, g) => s + g.pendientes, 0);
  const allHighConfidence = propuestas.filter(
    (p) =>
      p.estado === "pendiente" &&
      p.confianza !== null &&
      p.confianza >= 0.8
  );

  async function handleAprobarTodas() {
    if (allHighConfidence.length === 0) return;
    setLoading(true);
    await aprobarTodas(allHighConfidence.map((p) => p.id));
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
              {totalPendientes} propuesta{totalPendientes !== 1 ? "s" : ""}{" "}
              pendiente{totalPendientes !== 1 ? "s" : ""} en{" "}
              {groups.length} documento{groups.length !== 1 ? "s" : ""}
            </p>
          </div>
          {allHighConfidence.length > 1 && (
            <button
              onClick={handleAprobarTodas}
              disabled={loading}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-colors"
            >
              {loading
                ? "Aprobando..."
                : `Aprobar todo (${allHighConfidence.length})`}
            </button>
          )}
        </div>

        {allHighConfidence.length > 1 && (
          <p className="text-xs text-white/30">
            &quot;Aprobar todo&quot; solo aprueba propuestas con confianza mayor
            o igual a 80%
          </p>
        )}

        {/* Document groups */}
        {groups.length === 0 ? (
          <div className="text-center py-16 text-white/40">
            <p className="text-3xl mb-2">✓</p>
            <p className="text-sm">Todo revisado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group, i) => (
              <DocumentSection
                key={group.documentoId}
                group={group}
                clientes={clientes}
                empresaId={empresaId}
                defaultExpanded={i === 0}
                onAction={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
