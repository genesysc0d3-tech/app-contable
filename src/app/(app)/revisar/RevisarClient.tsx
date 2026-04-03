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

const ALTA = 0.85;
const MEDIA = 0.5;

function classifyConfianza(p: Propuesta): "alta" | "media" | "baja" {
  const c = p.confianza ?? 0;
  if (c >= ALTA) return "alta";
  if (c >= MEDIA) return "media";
  return "baja";
}

// --- Confidence group within a document ---

function ConfianzaGroup({
  tipo,
  propuestas,
  clientes,
  empresaId,
  onAction,
}: {
  tipo: "alta" | "media" | "baja";
  propuestas: Propuesta[];
  clientes: ClienteResumen[];
  empresaId: string;
  onAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (propuestas.length === 0) return null;

  const config = {
    alta: {
      icon: "🟢",
      label: `Alta confianza · ${propuestas.length} propuesta${propuestas.length !== 1 ? "s" : ""}`,
      color: "text-emerald-300",
    },
    media: {
      icon: "🟡",
      label: `Requiere revisión · ${propuestas.length} propuesta${propuestas.length !== 1 ? "s" : ""}`,
      color: "text-yellow-300",
    },
    baja: {
      icon: "🔴",
      label: `Falta información · ${propuestas.length} propuesta${propuestas.length !== 1 ? "s" : ""}`,
      color: "text-red-300",
    },
  }[tipo];

  const sorted = [...propuestas].sort(
    (a, b) => (b.confianza ?? 0) - (a.confianza ?? 0)
  );

  async function handleAprobarGrupo(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true);
    await aprobarTodas(propuestas.map((p) => p.id));
    router.refresh();
    onAction();
    setLoading(false);
  }

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/5 overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/5 transition-colors"
      >
        <span
          className="text-white/40 text-[10px] transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <span className="text-xs">{config.icon}</span>
        <span className={`text-xs font-medium ${config.color} flex-1 text-left`}>
          {config.label}
        </span>
        {tipo === "alta" && (
          <button
            onClick={handleAprobarGrupo}
            disabled={loading}
            className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 px-3 py-1 text-[10px] font-semibold text-emerald-300 transition-colors"
          >
            {loading ? "..." : `Aprobar todas`}
          </button>
        )}
      </button>

      {/* Expanded cards */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {sorted.map((p) => (
            <div key={p.id}>
              {tipo === "baja" && (
                <p className="text-[10px] text-red-400/70 bg-red-500/5 rounded-lg px-2.5 py-1.5 mb-2">
                  Esta propuesta necesita más datos antes de aprobar
                </p>
              )}
              <PropuestaCard
                propuesta={p}
                clientes={clientes}
                empresaId={empresaId}
                onAction={onAction}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Document section ---

function DocumentSection({
  group,
  clientes,
  empresaId,
  onAction,
}: {
  group: DocumentGroup;
  clientes: ClienteResumen[];
  empresaId: string;
  onAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const pendientes = group.propuestas.filter((p) => p.estado === "pendiente");
  const alta = pendientes.filter((p) => classifyConfianza(p) === "alta");
  const media = pendientes.filter((p) => classifyConfianza(p) === "media");
  const baja = pendientes.filter((p) => classifyConfianza(p) === "baja");

  const fecha = new Date(group.fechaSubida).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
      {/* Document header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
      >
        <span
          className="text-white/40 text-sm transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-white/90 truncate">
            {group.nombreArchivo}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-white/40">{fecha}</span>
            {pendientes.length > 0 && (
              <span className="text-[10px] text-white/30">
                {alta.length > 0 && `${alta.length} listas`}
                {alta.length > 0 && media.length > 0 && " · "}
                {media.length > 0 && `${media.length} por revisar`}
                {(alta.length > 0 || media.length > 0) && baja.length > 0 && " · "}
                {baja.length > 0 && `${baja.length} con problemas`}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {group.pendientes > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 font-medium">
              {group.pendientes}
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

      {/* Expanded: confidence groups */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {pendientes.length === 0 ? (
            <div className="text-center text-white/30 text-xs py-4">
              Todo revisado en este documento
            </div>
          ) : (
            <>
              <ConfianzaGroup
                tipo="alta"
                propuestas={alta}
                clientes={clientes}
                empresaId={empresaId}
                onAction={onAction}
              />
              <ConfianzaGroup
                tipo="media"
                propuestas={media}
                clientes={clientes}
                empresaId={empresaId}
                onAction={onAction}
              />
              <ConfianzaGroup
                tipo="baja"
                propuestas={baja}
                clientes={clientes}
                empresaId={empresaId}
                onAction={onAction}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main ---

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

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.fechaSubida).getTime() - new Date(a.fechaSubida).getTime()
    );
  }, [propuestas]);

  const totalPendientes = groups.reduce((s, g) => s + g.pendientes, 0);
  const allHighConfidence = propuestas.filter(
    (p) =>
      p.estado === "pendiente" &&
      p.confianza !== null &&
      p.confianza >= ALTA
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
            &quot;Aprobar todo&quot; solo aprueba propuestas con confianza &ge; 85%
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
            {groups.map((group) => (
              <DocumentSection
                key={group.documentoId}
                group={group}
                clientes={clientes}
                empresaId={empresaId}
                onAction={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
