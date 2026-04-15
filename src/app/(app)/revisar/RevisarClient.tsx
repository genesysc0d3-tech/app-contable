"use client";

import { useState, useMemo, useCallback, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import PropuestaCard from "@/components/propuestas/PropuestaCard";
import SkeletonCard from "@/components/SkeletonCard";
import CompletionBurst from "@/components/CompletionBurst";
import { aprobarTodas, aprobarPropuesta, ocultarPropuesta, restaurarPropuesta } from "./actions";
import { useToast } from "@/components/Toast";
import { useAppStore } from "@/store/appStore";
import type { Tables } from "@/lib/database.types";
import { CaretRight, FileText, CheckCircle, Check, PencilSimple, EyeSlash, Eye, Warning, WarningOctagon, WarningCircle } from "@phosphor-icons/react";

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
  layout?: "mobile" | "desktop";
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

function ThinRow({ propuesta, onExpand, onEdit, onAction, isOculta }: {
  propuesta: Propuesta; onExpand: () => void; onEdit: () => void; onAction: () => void; isOculta: boolean;
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

  async function handleOcultarOrRestaurar(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy("ocultar");
    const res = isOculta
      ? await restaurarPropuesta(propuesta.id)
      : await ocultarPropuesta(propuesta.id);
    if (res.error) toast(`Error: ${res.error}`, "error");
    else toast(isOculta ? "Restaurada" : "Oculta");
    router.refresh(); onAction(); setBusy(null);
  }

  function handleEditar(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit();
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
          onClick={handleOcultarOrRestaurar}
          disabled={busy !== null}
          title={isOculta ? "Restaurar" : "Ocultar"}
          className="btn-press w-6 h-6 flex items-center justify-center rounded bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--border)] disabled:opacity-50 transition-colors"
        >
          {isOculta ? <Eye size={12} weight="bold" /> : <EyeSlash size={12} weight="bold" />}
        </button>
      </div>
    </div>
  );
}

function ConfianzaGroup({ tipo, propuestas, clientes, empresaId, onAction, omitidosMap, layout }: {
  tipo: "alta" | "media" | "baja" | "omitidos" | "ocultas"; propuestas: Propuesta[]; clientes: ClienteResumen[]; empresaId: string; onAction: () => void; omitidosMap: OmitidosMap; layout: "mobile" | "desktop";
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [editCards, setEditCards] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [activeBlock, setActiveBlock] = useState(0);

  function toggleCard(id: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setEditCards((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function editCard(id: string) {
    setExpandedCards((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setEditCards((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }
  const router = useRouter();
  const { toast } = useToast();

  if (propuestas.length === 0) return null;

  const config = {
    alta: { Icon: CheckCircle, label: `Alta confianza · ${propuestas.length}`, color: "text-[#22C55E]" },
    media: { Icon: Warning, label: `Requiere revisión · ${propuestas.length}`, color: "text-[#F59E0B]" },
    baja: { Icon: WarningOctagon, label: `Falta información · ${propuestas.length}`, color: "text-[#E8553E]" },
    omitidos: { Icon: WarningCircle, label: `Omitidos huérfanos · ${propuestas.length}`, color: "text-[#F59E0B]" },
    ocultas: { Icon: EyeSlash, label: `Ocultas · ${propuestas.length}`, color: "text-[var(--muted)]" },
  }[tipo];

  const sorted = [...propuestas].sort((a, b) => {
    const diff = (b.confianza ?? 0) - (a.confianza ?? 0);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id); // stable secondary sort
  });
  const useBlocks = layout === "desktop" && sorted.length > 10 && tipo !== "ocultas";
  const blocks: Propuesta[][] = [];
  if (useBlocks) {
    for (let i = 0; i < sorted.length; i += 10) blocks.push(sorted.slice(i, i + 10));
  }
  const safeBlock = useBlocks ? Math.min(activeBlock, Math.max(0, blocks.length - 1)) : 0;
  const visible = useBlocks ? (blocks[safeBlock] ?? []) : sorted;

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

  async function handleAprobarBloque(e: React.MouseEvent) {
    e.stopPropagation(); setLoading(true);
    const ids = (blocks[safeBlock] ?? []).map((p) => p.id);
    if (ids.length === 0) { setLoading(false); return; }
    const result = await aprobarTodas(ids);
    if (result.error) toast(`Error: ${result.error}`, "error");
    else toast(`${result.count} aprobadas en bloque ${safeBlock + 1}`);
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
        <config.Icon size={14} weight="fill" className={`${config.color} shrink-0`} />
        <span className={`text-xs font-medium ${config.color} flex-1 text-left`}>{config.label}</span>
        {tipo === "alta" && (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            {useBlocks && (blocks[safeBlock]?.length ?? 0) > 0 && (
              <button onClick={handleAprobarBloque} disabled={loading}
                className="btn-press rounded-lg border border-[#E8553E] text-[#E8553E] hover:bg-[var(--accent-light)] disabled:opacity-50 px-2.5 py-1 text-[10px] font-semibold transition-all duration-150">
                {loading ? "..." : `Aprobar bloque (${blocks[safeBlock]?.length ?? 0})`}
              </button>
            )}
            <button onClick={handleAprobarGrupo} disabled={loading}
              className="btn-press rounded-lg bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-3 py-1 text-[10px] font-semibold text-white transition-all duration-150">
              {loading ? "..." : "Aprobar todas"}
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 animate-fade-in">
          {useBlocks && (
            <div className="flex items-center gap-1 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar">
              {blocks.map((items, idx) => {
                const isActive = idx === safeBlock;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveBlock(idx)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E8553E]/40 ${
                      isActive
                        ? "bg-[#E8553E] text-white shadow-[0_1px_3px_rgba(232,85,62,0.3)]"
                        : "bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)]"
                    }`}
                  >
                    Bloque {idx + 1}
                    <span className={`ml-1.5 tabular-nums ${isActive ? "text-white/80" : "text-[var(--muted-light)]"}`}>
                      {items.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="space-y-3">
          {visible.map((p) => (
            <Fragment key={p.id}>
              <div>
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
                    initialEditing={editCards.has(p.id)}
                    omitidosAnidados={omitidosMap.get(`${p.movimientos_raw.documento_id}|${p.movimientos_raw.descripcion}|${p.movimientos_raw.monto}`) ?? []} />
                </>
              ) : (
                <ThinRow
                  propuesta={p}
                  onExpand={() => toggleCard(p.id)}
                  onEdit={() => editCard(p.id)}
                  onAction={onAction}
                  isOculta={tipo === "ocultas"}
                />
              )}
              </div>
            </Fragment>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentTab({ group, selected, onClick }: {
  group: DocumentGroup; selected: boolean; onClick: () => void;
}) {
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const d = new Date(group.fechaSubida);
  const fecha = `${d.getDate()} ${meses[d.getMonth()]}`;

  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full border text-left transition-all duration-200 ${
        selected
          ? "border-[#E8553E] bg-[var(--accent-light)] text-[var(--foreground)] shadow-[0_0_16px_-6px_rgba(232,85,62,0.4)]"
          : "border-[var(--border)] bg-transparent text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--muted-light)]"
      }`}
    >
      <FileText size={12} weight="light" className="shrink-0" />
      <span className="text-[11px] font-medium truncate max-w-[160px]">{group.nombreArchivo}</span>
      <span className="text-[9px] text-[var(--muted-light)] shrink-0">{fecha}</span>
      {group.pendientes > 0 && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold tabular-nums shrink-0 ${
          selected ? "bg-[#E8553E] text-white" : "bg-[var(--accent-light)] text-[#E8553E]"
        }`}>
          {group.pendientes}
        </span>
      )}
    </button>
  );
}

function DocumentBody({ group, clientes, empresaId, onAction, layout }: {
  group: DocumentGroup; clientes: ClienteResumen[]; empresaId: string; onAction: () => void; layout: "mobile" | "desktop";
}) {
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

  return (
    <div className="pt-2 space-y-2 animate-fade-in relative">
      {showBurst && !burstDone && <CompletionBurst onDone={handleBurstDone} />}
      {totalVisible === 0 && ocultas.length === 0 ? (
        <div className="text-center text-[var(--muted-light)] text-xs py-8">Todo revisado en este documento</div>
      ) : (
        <div className={showBurst && !burstDone ? "opacity-15 transition-opacity duration-300" : ""}>
          <div className="space-y-2">
            <ConfianzaGroup tipo="alta" propuestas={alta} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} layout={layout} />
            <ConfianzaGroup tipo="media" propuestas={media} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} layout={layout} />
            <ConfianzaGroup tipo="baja" propuestas={baja} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} layout={layout} />
            <ConfianzaGroup tipo="omitidos" propuestas={orphanedOmitidos} clientes={clientes} empresaId={empresaId} onAction={() => { if (totalVisible <= 1) setShowBurst(true); onAction(); }} omitidosMap={omitidosMap} layout={layout} />
            <ConfianzaGroup tipo="ocultas" propuestas={ocultas} clientes={clientes} empresaId={empresaId} onAction={onAction} omitidosMap={omitidosMap} layout={layout} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function RevisarClient({ propuestas, clientes, empresaId, layout = "mobile" }: RevisarClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
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
          <>
            <DocumentTabs
              groups={groups}
              selectedDocId={selectedDocId}
              onSelect={setSelectedDocId}
            />
            {(() => {
              const selected = groups.find((g) => g.documentoId === selectedDocId) ?? groups[0];
              return selected ? (
                <DocumentBody
                  key={selected.documentoId}
                  group={selected}
                  clientes={clientes}
                  empresaId={empresaId}
                  layout={layout}
                  onAction={() => router.refresh()}
                />
              ) : null;
            })()}
          </>
        )}
      </div>
    </div>
  );
}

function DocumentTabs({ groups, selectedDocId, onSelect }: {
  groups: DocumentGroup[]; selectedDocId: string | null; onSelect: (id: string) => void;
}) {
  const activeId = selectedDocId ?? groups[0]?.documentoId ?? null;
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
      {groups.map((g) => (
        <DocumentTab
          key={g.documentoId}
          group={g}
          selected={activeId === g.documentoId}
          onClick={() => onSelect(g.documentoId)}
        />
      ))}
    </div>
  );
}
