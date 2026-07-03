"use client";

// Editor de cartola BULK-FIRST (reemplaza el cuerpo paginado del popup Editar).
// Premisa (validada con el fundador + 10 agentes): la máquina hace el trabajo
// (pre-stageo en processor.ts: tx de alta confianza nacen 'listo'), y el cliente
// SIEMPRE puede mirar pero no está obligado a pasar 60 páginas para llegar a Aprobar.
//   · Agrupación por ESTADO, no por confianza: Pendientes (las excepciones) arriba
//     y abiertas; Listas (el bulk pre-stageado) colapsadas; Rechazadas colapsadas.
//   · La FECHA bancaria es una columna (dato), no un agrupador — la boleta se emite
//     con la fecha del día, no la del movimiento (Art. 55 DL 825).
//   · Scroll virtualizado (@tanstack/react-virtual): una sola lista plana con
//     headers + filas intercalados; solo se montan las ~15 filas visibles.
//   · El Aprobar atómico del visor resumen sigue siendo el único gatillo a Emitir.

import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import {
  ExpandedDetail, RowActionBtn, tipoMeta, fmt, fmtShort, ALTA, MEDIA, BULK_MIN_CONFIANZA,
  type Propuesta, type ClienteResumen,
} from "./revisar-shared";
import { ponerListo, rechazarPropuesta, restaurarPropuesta } from "../../revisar/actions";
import { useToast } from "@/components/Toast";

type SectionKey = "pendientes" | "listas" | "rechazadas" | "emision";

const SECTION_META: Record<SectionKey, { label: string; color: string }> = {
  pendientes: { label: "Pendientes", color: "var(--amber)" },
  listas: { label: "Listas", color: "var(--green)" },
  rechazadas: { label: "Rechazadas", color: "var(--accent)" },
  emision: { label: "En emisión", color: "var(--blue)" },
};
const ORDER: SectionKey[] = ["pendientes", "listas", "rechazadas", "emision"];

// Bulk gate (BULK_MIN_CONFIANZA, compartido con revisar-shared): nunca poner
// listas en lote las tx muy inseguras — fuerzan revisión 1×1.

type FlatRow =
  | { kind: "header"; section: SectionKey; count: number }
  | { kind: "tx"; section: SectionKey; p: Propuesta };

const CSS = `
.ce-scroll{scrollbar-width:thin;}
.ce-row{display:flex;align-items:center;gap:6px;padding:6px 16px;border-bottom:1px solid var(--border);cursor:pointer;}
.ce-row:hover{background:color-mix(in srgb, var(--text) 2%, transparent);}
.ce-reject{opacity:.28;transition:opacity .15s;}
.ce-row:hover .ce-reject,.ce-reject:hover{opacity:1;}
.ce-stat{display:inline-flex;align-items:center;gap:5px;border:none;background:transparent;cursor:pointer;font-size:11px;font-weight:600;color:var(--text2);padding:2px 4px;border-radius:6px;}
.ce-stat:hover{background:color-mix(in srgb, var(--text) 5%, transparent);color:var(--text);}
`;

function confColor(c: number | null | undefined) {
  const v = c ?? 0;
  return v >= ALTA ? "var(--green)" : v >= MEDIA ? "var(--amber)" : "var(--text2)";
}

export default function CartolaEditor({
  propuestas, clientes, empresaId, empresaTipo, onAction,
}: {
  propuestas: Propuesta[];
  clientes: ClienteResumen[];
  empresaId: string;
  empresaTipo?: string | null;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    pendientes: true, listas: false, rechazadas: false, emision: false,
  });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [busyBulk, setBusyBulk] = useState(false);

  // Agrupar por ESTADO (la fecha bancaria NO agrupa — va como columna en la fila).
  const groups = useMemo(() => {
    const g: Record<SectionKey, Propuesta[]> = { pendientes: [], listas: [], rechazadas: [], emision: [] };
    for (const p of propuestas) {
      // 'editado' es borrador (no emitible): va con las pendientes. Solo 'aprobado'
      // está comprometida a Emitir.
      if (p.estado === "pendiente" || p.estado === "editado") g.pendientes.push(p);
      else if (p.estado === "listo") g.listas.push(p);
      else if (p.estado === "rechazado" || p.estado === "descartado") g.rechazadas.push(p);
      else if (p.estado === "aprobado") g.emision.push(p);
    }
    return g;
  }, [propuestas]);

  // Total = todo lo vivo (excluye rechazadas), como el agregado del visor resumen.
  const total = useMemo(
    () => [...groups.pendientes, ...groups.listas, ...groups.emision]
      .reduce((s, p) => s + (p.total ?? p.movimientos_raw?.monto ?? 0), 0),
    [groups],
  );

  // Cuántas pendientes se prepararían realmente en bulk (el resto, < BULK_MIN_CONFIANZA,
  // se revisan a mano). El label del botón bulk muestra este número, no el total.
  const pendElegibles = useMemo(
    () => groups.pendientes.filter((p) => (p.confianza ?? 0) >= BULK_MIN_CONFIANZA).length,
    [groups.pendientes],
  );

  // Lista PLANA: header de sección + sus filas (si expandida). Una sola lista para
  // un solo virtualizer → sin scrollMargin por sección.
  const flat = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const key of ORDER) {
      const arr = groups[key];
      if (arr.length === 0) continue;
      rows.push({ kind: "header", section: key, count: arr.length });
      if (expanded[key]) for (const p of arr) rows.push({ kind: "tx", section: key, p });
    }
    return rows;
  }, [groups, expanded]);

  // Mantener montadas las filas expandidas aunque salgan de la ventana virtual, para
  // no perder lo que el usuario esté tipeando en su detalle (ExpandedDetail = estado local).
  const keepExpandedMounted = useCallback(
    (range: { startIndex: number; endIndex: number; overscan: number; count: number }) => {
      const set = new Set(defaultRangeExtractor(range));
      for (let i = 0; i < flat.length; i++) {
        const r = flat[i];
        if (r.kind === "tx" && expandedRows.has(r.p.id)) set.add(i);
      }
      return Array.from(set).sort((a, b) => a - b);
    },
    [flat, expandedRows],
  );

  // React Compiler no puede memoizar useVirtualizer (devuelve funciones no memoizables);
  // ya salta este componente automáticamente — el warning es informativo, no un bug.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flat[i]?.kind === "header" ? 38 : 44),
    overscan: 8,
    rangeExtractor: keepExpandedMounted,
    getItemKey: (i) => {
      const r = flat[i];
      return r.kind === "header" ? `h:${r.section}` : `t:${r.p.id}`;
    },
  });

  function toggleSection(key: SectionKey) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  // Stat de la barra: abre esa sección y salta a su header.
  function jumpTo(key: SectionKey) {
    if (groups[key].length === 0) return;
    const idx = flat.findIndex((r) => r.kind === "header" && r.section === key);
    setExpanded((prev) => ({ ...prev, [key]: true }));
    if (idx >= 0) requestAnimationFrame(() => virtualizer.scrollToIndex(idx, { align: "start" }));
  }

  async function stagePendientes() {
    // Bulk salta las < BULK_MIN_CONFIANZA: esas se revisan 1×1 (safety).
    const elegibles = groups.pendientes.filter((p) => (p.confianza ?? 0) >= BULK_MIN_CONFIANZA);
    const saltadas = groups.pendientes.length - elegibles.length;
    if (elegibles.length === 0) {
      toast(saltadas > 0 ? `Revisa las ${saltadas} de baja confianza a mano` : "Nada por preparar", "error");
      return;
    }
    setBusyBulk(true);
    const r = await ponerListo(elegibles.map((p) => p.id));
    if (r.error) toast(r.error, "error");
    else toast(saltadas > 0 ? `${r.count} listas · ${saltadas} quedan para revisar` : `${r.count} listas`);
    onAction();
    setBusyBulk(false);
  }

  async function stageOne(p: Propuesta) {
    const r = await ponerListo([p.id]);
    if (r.error) toast(r.error, "error"); else toast("Lista");
    onAction();
  }
  async function rejectOne(p: Propuesta) {
    const r = await rechazarPropuesta(p.id);
    if (r.error) toast(r.error, "error"); else toast("Rechazada");
    onAction();
  }
  // Restaurar una rechazada/descartada: vuelve a 'pendiente' y la lista se refresca.
  async function restoreOne(p: Propuesta) {
    const r = await restaurarPropuesta(p.id);
    if (r.error) toast(r.error, "error"); else toast("Restaurada — quedó pendiente");
    onAction();
  }

  if (propuestas.length === 0) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", color: "var(--text2)", fontSize: 12 }}>
        Sin propuestas en este documento.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <style>{CSS}</style>

      {/* ── Barra de estado (siempre visible, NO scrollea) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap" }}>
        {(["listas", "pendientes", "rechazadas"] as SectionKey[]).map((k) => {
          const n = groups[k].length;
          if (n === 0) return null;
          return (
            <button key={k} className="ce-stat" onClick={() => jumpTo(k)} title={`Ir a ${SECTION_META[k].label}`}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: SECTION_META[k].color }} />
              <b style={{ color: "var(--text)" }}>{n}</b> {SECTION_META[k].label.toLowerCase()}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text2)" }}>
          Total <b style={{ color: "var(--text)" }}>{fmt(total)}</b>
        </span>
      </div>

      {/* ── Scroll container: UNA lista plana virtualizada ── */}
      <div ref={scrollRef} className="ce-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = flat[vi.index];
            if (!row) return null;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
              >
                {row.kind === "header" ? (
                  <SectionHeader
                    section={row.section}
                    count={row.count}
                    open={expanded[row.section]}
                    onToggle={() => toggleSection(row.section)}
                    onStageAll={row.section === "pendientes" ? stagePendientes : undefined}
                    stageableCount={row.section === "pendientes" ? pendElegibles : undefined}
                    busy={busyBulk}
                  />
                ) : (
                  <div>
                    <TxRow
                      p={row.p}
                      isOpen={expandedRows.has(row.p.id)}
                      onToggle={() => toggleRow(row.p.id)}
                      onStage={() => stageOne(row.p)}
                      onReject={() => rejectOne(row.p)}
                      onRestore={() => restoreOne(row.p)}
                    />
                    {expandedRows.has(row.p.id) && (
                      <ExpandedDetail
                        propuesta={row.p}
                        clientes={clientes}
                        empresaId={empresaId}
                        onAction={onAction}
                        onClose={() => toggleRow(row.p.id)}
                        empresaTipoContribuyente={empresaTipo}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Header de sección ─── */
function SectionHeader({ section, count, open, onToggle, onStageAll, stageableCount, busy }: {
  section: SectionKey; count: number; open: boolean; onToggle: () => void;
  onStageAll?: () => void; stageableCount?: number; busy?: boolean;
}) {
  const meta = SECTION_META[section];
  const bulkDisabled = busy || stageableCount === 0;
  // El label refleja lo que de verdad se prepara (salta < 0.80); no sobre-promete.
  const bulkLabel = stageableCount != null && stageableCount < count
    ? `Poner listas (${stageableCount} de ${count})`
    : `Poner listas (${count})`;
  return (
    <div
      onClick={onToggle}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", cursor: "pointer", background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
    >
      <span style={{ fontSize: 8, color: "var(--text2)", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s", flexShrink: 0 }}>▶</span>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
      <span style={{ fontSize: 10, color: "var(--text2)" }}>{count}</span>
      {onStageAll && (
        <button
          onClick={(e) => { e.stopPropagation(); onStageAll(); }}
          disabled={bulkDisabled}
          style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(34,197,94,.35)", background: "transparent", color: "var(--green)", cursor: bulkDisabled ? "default" : "pointer", opacity: bulkDisabled ? 0.5 : 1 }}
        >
          {busy ? "..." : bulkLabel}
        </button>
      )}
    </div>
  );
}

/* ─── Fila de tx (colapsada) ─── */
function TxRow({ p, isOpen, onToggle, onStage, onReject, onRestore }: {
  p: Propuesta; isOpen: boolean; onToggle: () => void; onStage: () => void; onReject: () => void; onRestore: () => void;
}) {
  const tm = tipoMeta(p.tipo_propuesto);
  const conf = Math.round((p.confianza ?? 0) * 100);
  // 'aprobado' = comprometida a Emitir → sin ✎ (auditoría #21).
  const enEmision = p.estado === "aprobado";
  const rechazada = p.estado === "rechazado" || p.estado === "descartado";
  return (
    <div className="ce-row" onClick={onToggle}>
      {/* 16px reservado para checkbox (selección múltiple — fase posterior) */}
      <span style={{ width: 16, flexShrink: 0 }} />
      <span style={{ transform: isOpen ? "rotate(90deg)" : "none", color: isOpen ? "var(--accent)" : "var(--text2)", fontSize: 10, transition: "transform .2s", flexShrink: 0 }}>▶</span>
      <span title={tm.label} style={{ flexShrink: 0, minWidth: 38, textAlign: "center", fontSize: 7, fontWeight: 800, letterSpacing: ".04em", padding: "2px 5px", borderRadius: 8, background: tm.bg, color: tm.color }}>{tm.sigla}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.movimientos_raw?.descripcion}</div>
        {p.receptor_nombre && <div style={{ fontSize: 8, color: "var(--text2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.receptor_nombre}</div>}
      </div>
      {/* Fecha bancaria = columna (dato), no agrupador */}
      <span style={{ flexShrink: 0, fontSize: 9, color: "var(--text3)", minWidth: 48, textAlign: "right" }}>{fmtShort(p.movimientos_raw?.fecha)}</span>
      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: "var(--text)", minWidth: 64, textAlign: "right" }}>{fmt(p.total ?? p.movimientos_raw?.monto)}</span>
      <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 600, color: confColor(p.confianza), minWidth: 30, textAlign: "right" }}>{conf}%</span>
      {p.estado === "listo" && <span style={{ flexShrink: 0, fontSize: 8, fontWeight: 800, color: "var(--green)", letterSpacing: ".05em" }}>LISTO</span>}
      {enEmision && <span style={{ flexShrink: 0, fontSize: 8, fontWeight: 800, color: "var(--blue)", letterSpacing: ".05em" }}>EN EMISIÓN</span>}
      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {/* ✓ solo en borradores (pendiente/editado): nunca demotar una 'listo' (ya staged) ni una 'aprobado' (ya en Emitir) */}
        {(p.estado === "pendiente" || p.estado === "editado") && <RowActionBtn type="aprove" icon="✓" onClick={onStage} />}
        {rechazada ? (
          /* Restaurar reemplaza al ✎ en rechazadas: el detalle acá solo llevaba a un error engañoso */
          <button onClick={onRestore}
            style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(34,197,94,.35)", background: "transparent", color: "var(--green)", cursor: "pointer" }}>
            Restaurar
          </button>
        ) : (
          !enEmision && <RowActionBtn type="edit" icon="✎" onClick={onToggle} />
        )}
        {/* ✗ separado y atenuado (ghost hasta hover) para prevenir misclick; sin ✗ en rechazadas (ya lo están) */}
        {!rechazada && (
          <span className="ce-reject" style={{ marginLeft: 10 }}>
            <RowActionBtn type="reject" icon="✕" onClick={onReject} />
          </span>
        )}
      </div>
    </div>
  );
}
