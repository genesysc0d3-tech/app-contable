"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import PropuestaCard from "@/components/propuestas/PropuestaCard";
import SkeletonCard from "@/components/SkeletonCard";
import { aprobarTodas } from "./actions";
import { useToast } from "@/components/Toast";
import type { Tables } from "@/lib/database.types";
import { CaretRight, FileText, CheckCircle } from "@phosphor-icons/react";

type Propuesta = Tables<"propuestas_ia"> & {
  movimientos_raw: Tables<"movimientos_raw"> & {
    documentos_subidos: { id: string; nombre_archivo: string; created_at: string };
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
  return c >= ALTA ? "alta" : c >= MEDIA ? "media" : "baja";
}

type OmitidosMap = Map<string, Propuesta[]>;

function ConfianzaGroup({ tipo, propuestas, clientes, empresaId, onAction, omitidosMap }: {
  tipo: "alta" | "media" | "baja"; propuestas: Propuesta[]; clientes: ClienteResumen[]; empresaId: string; onAction: () => void; omitidosMap: OmitidosMap;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  if (propuestas.length === 0) return null;

  const config = {
    alta: { icon: "🟢", label: `Alta confianza · ${propuestas.length}`, color: "text-[#22C55E]" },
    media: { icon: "🟡", label: `Requiere revisión · ${propuestas.length}`, color: "text-[#F59E0B]" },
    baja: { icon: "🔴", label: `Falta información · ${propuestas.length}`, color: "text-[#E8553E]" },
  }[tipo];

  const sorted = [...propuestas].sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0));

  async function handleAprobarGrupo(e: React.MouseEvent) {
    e.stopPropagation(); setLoading(true);
    const result = await aprobarTodas(propuestas.map((p) => p.id));
    if (result.error) {
      toast(`Error: ${result.error}`, "error");
    } else {
      toast(`${result.count} aprobadas`);
    }
    router.refresh(); onAction(); setLoading(false);
  }

  return (
    <div className="rounded-xl bg-[var(--surface)] overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded(!expanded); }}
        className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-[var(--border)] transition-colors duration-200 cursor-pointer"
      >
        <CaretRight size={12} weight="bold" className={`text-[var(--muted-light)] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
        <span className="text-xs">{config.icon}</span>
        <span className={`text-xs font-medium ${config.color} flex-1 text-left`}>{config.label}</span>
        {tipo === "alta" && (
          <button onClick={handleAprobarGrupo} disabled={loading}
            className="btn-press rounded-lg bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-3 py-1 text-[10px] font-semibold text-white transition-all duration-150">
            {loading ? "..." : "Aprobar todas"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-3 animate-fade-in">
          {sorted.map((p) => (
            <div key={p.id}>
              {tipo === "baja" && (
                <p className="text-[10px] text-[#E8553E] bg-[var(--accent-light)] rounded-lg px-2.5 py-1.5 mb-2">
                  Esta propuesta necesita más datos antes de aprobar
                </p>
              )}
              <PropuestaCard propuesta={p} clientes={clientes} empresaId={empresaId} onAction={onAction}
                omitidosAnidados={omitidosMap.get(`${p.movimientos_raw.documento_id}|${p.movimientos_raw.descripcion}|${p.movimientos_raw.monto}`) ?? []} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentSection({ group, clientes, empresaId, onAction }: {
  group: DocumentGroup; clientes: ClienteResumen[]; empresaId: string; onAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isFromOmitidos = (p: Propuesta) => p.notas?.startsWith("Agregado desde visor de omitidos");
  const pendientes = group.propuestas.filter((p) => p.estado === "pendiente" && !isFromOmitidos(p));
  const omitidosPendientes = group.propuestas.filter((p) => p.estado === "pendiente" && isFromOmitidos(p));

  // Build map: "docId|descripcion|monto" -> omitidos for that combination
  const omitidosMap: OmitidosMap = new Map();
  for (const o of omitidosPendientes) {
    const key = `${o.movimientos_raw.documento_id}|${o.movimientos_raw.descripcion}|${o.movimientos_raw.monto}`;
    const arr = omitidosMap.get(key) ?? [];
    arr.push(o);
    omitidosMap.set(key, arr);
  }

  const alta = pendientes.filter((p) => classifyConfianza(p) === "alta");
  const media = pendientes.filter((p) => classifyConfianza(p) === "media");
  const baja = pendientes.filter((p) => classifyConfianza(p) === "baja");

  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const d = new Date(group.fechaSubida);
  const fecha = `${d.getDate()} ${meses[d.getMonth()]}`;

  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-[#FAFAFA] dark:hover:bg-white/5 transition-colors duration-200 border-b border-[var(--border)]">
        <CaretRight size={16} weight="bold" className={`text-[var(--muted-light)] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
        <FileText size={20} weight="light" className="text-[var(--muted)] shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-[var(--foreground)] truncate">{group.nombreArchivo}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-[var(--muted-light)]">{fecha}</span>
            {pendientes.length > 0 && (
              <span className="text-[10px] text-[var(--muted-light)]">
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
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-light)] text-[#E8553E] font-medium tabular-nums">
              {group.pendientes}{omitidosPendientes.length > 0 && <span className="text-[#F59E0B]"> +{omitidosPendientes.length}</span>}
            </span>
          )}
          {group.aprobados > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#ECFDF5] dark:bg-[#22C55E]/15 text-[#22C55E] font-medium tabular-nums">{group.aprobados}</span>}
          {group.descartados > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface)] text-[var(--muted-light)] font-medium tabular-nums">{group.descartados}</span>}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-2 space-y-2 animate-fade-in">
          {pendientes.length === 0 ? (
            <div className="text-center text-[var(--muted-light)] text-xs py-4">Todo revisado</div>
          ) : (
            <>
              <ConfianzaGroup tipo="alta" propuestas={alta} clientes={clientes} empresaId={empresaId} onAction={onAction} omitidosMap={omitidosMap} />
              <ConfianzaGroup tipo="media" propuestas={media} clientes={clientes} empresaId={empresaId} onAction={onAction} omitidosMap={omitidosMap} />
              <ConfianzaGroup tipo="baja" propuestas={baja} clientes={clientes} empresaId={empresaId} onAction={onAction} omitidosMap={omitidosMap} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function RevisarClient({ propuestas, clientes, empresaId }: RevisarClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const groups = useMemo(() => {
    const map = new Map<string, DocumentGroup>();
    for (const p of propuestas) {
      const doc = p.movimientos_raw?.documentos_subidos;
      if (!doc) continue;
      let g = map.get(doc.id);
      if (!g) { g = { documentoId: doc.id, nombreArchivo: doc.nombre_archivo, fechaSubida: doc.created_at, propuestas: [], pendientes: 0, aprobados: 0, descartados: 0 }; map.set(doc.id, g); }
      g.propuestas.push(p);
      const fromOmitidos = p.notas?.startsWith("Agregado desde visor de omitidos");
      if (p.estado === "pendiente" && !fromOmitidos) g.pendientes++;
      else if (p.estado === "aprobado" || p.estado === "editado") g.aprobados++;
      else if (p.estado === "descartado") g.descartados++;
      // pendientes from omitidos are not counted — they show inside parent's dropdown
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.fechaSubida).getTime() - new Date(a.fechaSubida).getTime());
  }, [propuestas]);

  const totalPendientes = groups.reduce((s, g) => s + g.pendientes, 0);
  const isNotFromOmitidos = (p: Propuesta) => !p.notas?.startsWith("Agregado desde visor de omitidos");
  const allHigh = propuestas.filter((p) => p.estado === "pendiente" && isNotFromOmitidos(p) && p.confianza !== null && p.confianza >= ALTA);

  async function handleAprobarTodas() {
    if (allHigh.length === 0) return;
    setLoading(true);
    const result = await aprobarTodas(allHigh.map((p) => p.id));
    if (result.error) {
      toast(`Error: ${result.error}`, "error");
    } else {
      toast(`${result.count} aprobadas`);
    }
    router.refresh();
    setLoading(false);
  }

  // Show skeletons while no data
  if (propuestas === undefined) {
    return (
      <div className="flex-1 pb-24">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold text-[var(--foreground)]">Revisar</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">
              {totalPendientes} pendiente{totalPendientes !== 1 ? "s" : ""} en {groups.length} documento{groups.length !== 1 ? "s" : ""}
            </p>
          </div>
          {allHigh.length > 1 && (
            <button onClick={handleAprobarTodas} disabled={loading}
              className="btn-press flex items-center gap-1.5 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-white transition-all duration-150">
              <CheckCircle size={16} weight="bold" />
              {loading ? "Aprobando..." : `Aprobar todo (${allHigh.length})`}
            </button>
          )}
        </div>

        {allHigh.length > 1 && (
          <p className="text-xs text-[var(--muted-light)]">&quot;Aprobar todo&quot; solo aprueba propuestas con confianza &ge; 85%</p>
        )}

        {groups.length === 0 ? (
          <div className="text-center py-16 text-[var(--muted-light)]">
            <CheckCircle size={48} weight="light" className="mx-auto mb-3 text-[var(--border)]" />
            <p className="text-sm">Todo revisado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <DocumentSection key={g.documentoId} group={g} clientes={clientes} empresaId={empresaId} onAction={() => router.refresh()} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
