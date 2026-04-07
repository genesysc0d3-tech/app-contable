"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import PropuestaCard from "@/components/propuestas/PropuestaCard";
import SkeletonCard from "@/components/SkeletonCard";
import CompletionBurst from "@/components/CompletionBurst";
import { aprobarTodas, aprobarPropuesta, ocultarPropuesta } from "./actions";
import { useToast } from "@/components/Toast";
import { useAppStore } from "@/store/appStore";
import type { Tables } from "@/lib/database.types";
import { CaretRight, FileText, CheckCircle, Check, PencilSimple, EyeSlash } from "@phosphor-icons/react";

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

function fmtCLP(n: number | null | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString("es-CL")}`;
}

function fmtFechaCorta(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${d.getDate()} ${meses[d.getMonth()]}`;
}

function ThinRow({ propuesta, onExpand, onAction }: {
  propuesta: Propuesta; onExpand: () => void; onAction: () => void;
}) {
  const [busy, setBusy] = useState<"aprobar" | "ocultar" | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  async function handleAprobar(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy("aprobar");
    const res = await aprobarPropuesta(propuesta.id, propuesta.cliente_id ?? null);
    if (res.error) toast(`Error: ${res.error}`, "error");
    else toast("Aprobada");
    router.refresh(); onAction(); setBusy(null);
  }

  async function handleOcultar(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy("ocultar");
    const res = await ocultarPropuesta(propuesta.id);
    if (res.error) toast(`Error: ${res.error}`, "error");
    else toast("Oculta");
    router.refresh(); onAction(); setBusy(null);
  }

  function handleEditar(e: React.MouseEvent) {
    e.stopPropagation();
    onExpand();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onExpand(); }}
      className="w-full rounded-lg bg-white dark:bg-white/5 hover:bg-[var(--accent-light)] dark:hover:bg-white/10 transition-colors px-3 py-2 flex items-center gap-2 text-left animate-fade-in cursor-pointer"
    >
      <CaretRight size={10} weight="bold" className="text-[var(--muted-light)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[var(--foreground)] truncate">
          {propuesta.movimientos_raw.descripcion}
        </p>
        <div className="flex items-center gap-2 text-[9px] text-[var(--muted-light)] mt-0.5">
          <span>{fmtFechaCorta(propuesta.movimientos_raw.fecha)}</span>
          <span className="tabular-nums font-medium text-[var(--foreground)]">{fmtCLP(propuesta.movimientos_raw.monto)}</span>
          {propuesta.receptor_nombre && <span className="truncate">· {propuesta.receptor_nombre}</span>}
        </div>
      </div>
      <span className="text-[9px] text-[var(--muted)] tabular-nums shrink-0">
        {Math.round((propuesta.confianza ?? 0) * 100)}%
      </span>
      <div className="flex gap-1 shrink-0 ml-1">
        <button
          type="button"
          onClick={handleAprobar}
          disabled={busy !== null}
          title="Aprobar"
          className="btn-press w-6 h-6 flex items-center justify-center rounded bg-[#22C55E]/10 text-[#22C55E] hover:bg-[#22C55E]/20 disabled:opacity-50 transition-colors"
        >
          <Check size={12} weight="bold" />
        </button>
        <button
          type="button"
          onClick={handleEditar}
          title="Editar"
          className="btn-press w-6 h-6 flex items-center justify-center rounded bg-[var(--accent-light)] text-[#E8553E] hover:bg-[#FFE4E0] transition-colors"
        >
          <PencilSimple size={12} weight="bold" />
        </button>
        <button
          type="button"
          onClick={handleOcultar}
          disabled={busy !== null}
          title="Ocultar"
          className="btn-press w-6 h-6 flex items-center justify-center rounded bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--border)] disabled:opacity-50 transition-colors"
        >
          <EyeSlash size={12} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function ConfianzaGroup({ tipo, propuestas, clientes, empresaId, onAction, omitidosMap }: {
  tipo: "alta" | "media" | "baja" | "omitidos" | "ocultas"; propuestas: Propuesta[]; clientes: ClienteResumen[]; empresaId: string; onAction: () => void; omitidosMap: OmitidosMap;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  function toggleCard(id: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const router = useRouter();
  const { toast } = useToast();

  if (propuestas.length === 0) return null;

  const config = {
    alta: { icon: "🟢", label: `Alta confianza · ${propuestas.length}`, color: "text-[#22C55E]" },
    media: { icon: "🟡", label: `Requiere revisión · ${propuestas.length}`, color: "text-[#F59E0B]" },
    baja: { icon: "🔴", label: `Falta información · ${propuestas.length}`, color: "text-[#E8553E]" },
    omitidos: { icon: "🟠", label: `Omitidos huérfanos · ${propuestas.length}`, color: "text-[#F59E0B]" },
    ocultas: { icon: "⚫", label: `Ocultas · ${propuestas.length}`, color: "text-[var(--muted)]" },
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
              {tipo === "omitidos" && (
                <p className="text-[10px] text-[#F59E0B] bg-[#FFF8ED] dark:bg-[#F59E0B]/10 rounded-lg px-2.5 py-1.5 mb-2">
                  Duplicado huérfano: la propuesta original ya fue aprobada o devuelta. Decidí qué hacer con esta copia.
                </p>
              )}
              {tipo === "ocultas" && (
                <p className="text-[10px] text-[var(--muted)] bg-[var(--surface)] rounded-lg px-2.5 py-1.5 mb-2">
                  Propuesta oculta — podés restaurarla aprobándola, editándola o devolviéndola.
                </p>
              )}
              {expandedCards.has(p.id) ? (
                <>
                  <button
                    type="button"
                    onClick={() => toggleCard(p.id)}
                    className="w-full text-left text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] mb-1.5 px-1 transition-colors"
                  >
                    ▾ Contraer
                  </button>
                  <PropuestaCard propuesta={p} clientes={clientes} empresaId={empresaId} onAction={onAction}
                    omitidosAnidados={omitidosMap.get(`${p.movimientos_raw.documento_id}|${p.movimientos_raw.descripcion}|${p.movimientos_raw.monto}`) ?? []} />
                </>
              ) : (
                <ThinRow
                  propuesta={p}
                  onExpand={() => toggleCard(p.id)}
                  onAction={onAction}
                />
              )}
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
  const [showBurst, setShowBurst] = useState(false);
  const [burstDone, setBurstDone] = useState(false);

  const handleBurstDone = useCallback(() => setBurstDone(true), []);

  const isFromOmitidos = (p: Propuesta) => p.notas?.startsWith("Agregado desde visor de omitidos");
  const parents = group.propuestas.filter((p) => p.estado === "pendiente" && !isFromOmitidos(p));
  const omitidosPendientes = group.propuestas.filter((p) => p.estado === "pendiente" && isFromOmitidos(p));

  // Build map of parent keys to detect which omitidos have a matching parent
  const parentKeys = new Set<string>();
  for (const p of parents) {
    parentKeys.add(`${p.movimientos_raw.documento_id}|${p.movimientos_raw.descripcion}|${p.movimientos_raw.monto}`);
  }

  // Omitidos with a matching parent → nested under that parent.
  // Omitidos without a matching parent (parent already aprobado) → orphaned,
  // shown standalone in pendientes so the user can decide what to do with
  // them (the parent has been approved/removed, but the duplicate is still
  // pending and shouldn't disappear silently).
  const omitidosMap: OmitidosMap = new Map();
  const orphanedOmitidos: Propuesta[] = [];
  for (const o of omitidosPendientes) {
    const key = `${o.movimientos_raw.documento_id}|${o.movimientos_raw.descripcion}|${o.movimientos_raw.monto}`;
    if (parentKeys.has(key)) {
      const arr = omitidosMap.get(key) ?? [];
      arr.push(o);
      omitidosMap.set(key, arr);
    } else {
      orphanedOmitidos.push(o);
    }
  }

  // pendientes (cards principales) = solo parents activos.
  // Los huérfanos van a su propia sección "Omitidos huérfanos" abajo.
  const pendientes = parents;

  const alta = pendientes.filter((p) => classifyConfianza(p) === "alta");
  const media = pendientes.filter((p) => classifyConfianza(p) === "media");
  const baja = pendientes.filter((p) => classifyConfianza(p) === "baja");
  const ocultas = group.propuestas.filter((p) => p.estado === "oculto");
  const totalVisible = pendientes.length + orphanedOmitidos.length;

  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const d = new Date(group.fechaSubida);
  const fecha = `${d.getDate()} ${meses[d.getMonth()]}`;

  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none overflow-hidden md:hover:-translate-y-0.5 md:hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-all duration-200">
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
        <div className="px-3 pb-3 pt-2 space-y-2 animate-fade-in relative">
          {showBurst && !burstDone && <CompletionBurst onDone={handleBurstDone} />}
          {totalVisible === 0 && ocultas.length === 0 ? (
            <div className="text-center text-[var(--muted-light)] text-xs py-4">Todo revisado</div>
          ) : (
            <div className={showBurst && !burstDone ? "opacity-15 transition-opacity duration-300" : ""}>
              <div className="space-y-2">
                <ConfianzaGroup tipo="alta" propuestas={alta} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} />
                <ConfianzaGroup tipo="media" propuestas={media} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} />
                <ConfianzaGroup tipo="baja" propuestas={baja} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} />
                <ConfianzaGroup tipo="omitidos" propuestas={orphanedOmitidos} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} />
                <ConfianzaGroup tipo="ocultas" propuestas={ocultas} clientes={clientes} empresaId={empresaId} onAction={onAction} omitidosMap={omitidosMap} />
              </div>
            </div>
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
  const setPropuestas = useAppStore((s) => s.setPropuestas);
  const setRevisarClientes = useAppStore((s) => s.setRevisarClientes);
  const invalidateResumen = useAppStore((s) => s.invalidateResumen);

  // Sync server data to store
  useEffect(() => {
    setPropuestas(propuestas);
    setRevisarClientes(clientes);
  }, [propuestas, clientes, setPropuestas, setRevisarClientes]);

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
    invalidateResumen();
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
      <div className="max-w-lg mx-auto px-4 space-y-4">
        {/* Sticky header */}
        <div className="sticky top-0 z-40 bg-[var(--background)] pt-6 pb-3 -mx-4 px-4">
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
