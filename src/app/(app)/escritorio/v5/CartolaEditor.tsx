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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import {
  ExpandedDetail, RowActionBtn, tipoMeta, fmt, fmtShort, ALTA, MEDIA, BULK_MIN_CONFIANZA,
  type Propuesta, type ClienteResumen,
} from "./revisar-shared";
import { ponerListo, rechazarPropuesta, rechazarPropuestas, restaurarPropuesta } from "../../revisar/actions";
import { useToast } from "@/components/Toast";

type SectionKey = "pendientes" | "listas" | "rechazadas" | "emision";

const SECTION_META: Record<SectionKey, { label: string; color: string }> = {
  pendientes: { label: "Pendientes", color: "var(--amber)" },
  listas: { label: "Listas", color: "var(--green)" },
  // "Sin boleta" (no "Rechazadas"): el ✕ es un JUICIO completado — típicamente un
  // egreso que no lleva boleta — no una eliminación. La tx queda visible y tachada.
  rechazadas: { label: "Sin boleta (juzgadas)", color: "var(--text3)" },
  emision: { label: "En emisión", color: "var(--blue)" },
};
const ORDER: SectionKey[] = ["pendientes", "listas", "rechazadas", "emision"];

// Bulk gate (BULK_MIN_CONFIANZA, compartido con revisar-shared): nunca poner
// listas en lote las tx muy inseguras — fuerzan revisión 1×1.

type FlatRow =
  | { kind: "header"; section: SectionKey; count: number }
  // Subgrupo por TIPO dentro de Pendientes (pedido fundador: nada de revoltijo —
  // todos los GASTO juntos, los EXE juntos…) con casilla maestra del grupo.
  | { kind: "subheader"; section: SectionKey; sigla: string; label: string; color: string; bg: string; ids: string[]; count: number }
  | { kind: "tx"; section: SectionKey; p: Propuesta };

/* Piel premium (2026-09-01, pedido fundador: el estilo del landing con TODA
   la info): filas como cards con profundidad y aire, tipografía legible,
   acciones que aparecen al hover — cero dato eliminado. */
const CSS = `
.ce-scroll{scrollbar-width:thin;padding:4px 0 10px;}
.ce-row{display:flex;align-items:center;gap:9px;padding:10px 13px;margin:5px 14px 0;cursor:pointer;
  border:1px solid color-mix(in srgb, var(--text) 8%, transparent);border-radius:12px;
  background:linear-gradient(165deg, color-mix(in srgb, var(--text) 4%, var(--surface)), var(--surface));
  transition:border-color .18s, box-shadow .18s, transform .18s;}
.ce-row:hover{border-color:color-mix(in srgb, var(--text) 18%, transparent);box-shadow:0 6px 18px rgba(0,0,0,.28);transform:translateY(-1px);}
.ce-reject{opacity:.22;transition:opacity .15s;}
.ce-row:hover .ce-reject,.ce-reject:hover{opacity:1;}
.ce-stat{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:var(--text2);padding:4px 9px;border-radius:99px;}
.ce-stat:hover{background:color-mix(in srgb, var(--text) 6%, transparent);border-color:color-mix(in srgb, var(--text) 10%, transparent);color:var(--text);}
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
  // Selección múltiple estilo explorador (decisión fundador: el juicio en grupo
  // lo hace el HUMANO marcando casillas — nada automático que propague un error
  // de clasificación). Solo filas con juicio pendiente (pendiente/editado).
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Subgrupos por tipo colapsados (pedido fundador: plegar familias enteras).
  const [subColapsados, setSubColapsados] = useState<Set<string>>(new Set());
  const lastSelRef = useRef<string | null>(null);
  // Guard anti-doble-click por fila: sin esto, dos clics rápidos en ✓/✕/restaurar
  // disparaban la mutación dos veces.
  const actingRef = useRef<Set<string>>(new Set());
  // Regla del fundador (2026-09-01): el ✕ deja la fila TACHADA DONDE ESTABA, no
  // la teletransporta al grupo Juzgadas (que suele estar colapsado ⇒ "desapareció").
  // Recordamos en qué sección vivía cada rechazada de ESTA sesión del popup; al
  // reabrir, vuelve a su casa natural (Juzgadas). Restaurar la saca del mapa.
  const [juzgadasEnSesion, setJuzgadasEnSesion] = useState<Map<string, SectionKey>>(new Map());

  // Agrupar por ESTADO (la fecha bancaria NO agrupa — va como columna en la fila).
  // Con juicio aún pendiente (las tachadas que se quedan en su grupo no son juzgables).
  const esJuzgable = (p: Propuesta) => p.estado === "pendiente" || p.estado === "editado";

  const groups = useMemo(() => {
    const g: Record<SectionKey, Propuesta[]> = { pendientes: [], listas: [], rechazadas: [], emision: [] };
    for (const p of propuestas) {
      // 'editado' es borrador (no emitible): va con las pendientes. Solo 'aprobado'
      // está comprometida a Emitir.
      if (p.estado === "pendiente" || p.estado === "editado") g.pendientes.push(p);
      else if (p.estado === "listo") g.listas.push(p);
      else if (p.estado === "rechazado" || p.estado === "descartado") {
        const casa = juzgadasEnSesion.get(p.id);
        g[casa && casa !== "rechazadas" ? casa : "rechazadas"].push(p);
      }
      else if (p.estado === "aprobado") g.emision.push(p);
    }
    return g;
  }, [propuestas, juzgadasEnSesion]);

  // Total = todo lo vivo (excluye rechazadas), como el agregado del visor resumen.
  const total = useMemo(
    () => [...groups.pendientes, ...groups.listas, ...groups.emision]
      // Las tachadas aparcadas en su grupo (juzgadasEnSesion) no son vivas: fuera del total.
      .filter((p) => p.estado !== "rechazado" && p.estado !== "descartado")
      .reduce((s, p) => s + (p.total ?? p.movimientos_raw?.monto ?? 0), 0),
    [groups],
  );

  // Cuántas pendientes se prepararían realmente en bulk (el resto, < BULK_MIN_CONFIANZA,
  // se revisan a mano). El label del botón bulk muestra este número, no el total.
  const pendElegibles = useMemo(
    () => groups.pendientes.filter((p) => esJuzgable(p) && (p.confianza ?? 0) >= BULK_MIN_CONFIANZA).length,
    [groups.pendientes],
  );

  // Pendientes AGRUPADAS por tipo detectado (GASTO juntos, EXE juntos…): la
  // decisión se toma por familias, no contra un revoltijo. Grupo más numeroso
  // primero. El orden VISUAL resultante es el que usa el shift-rango.
  const pendientesAgrupadas = useMemo(() => {
    const por = new Map<string, { sigla: string; label: string; color: string; bg: string; items: Propuesta[] }>();
    for (const p of groups.pendientes) {
      const m = tipoMeta(p.tipo_propuesto);
      let g = por.get(m.sigla);
      if (!g) { g = { sigla: m.sigla, label: m.label, color: m.color, bg: m.bg, items: [] }; por.set(m.sigla, g); }
      g.items.push(p);
    }
    return [...por.values()].sort((a, b) => b.items.length - a.items.length);
  }, [groups.pendientes]);
  const ordenVisualPendientes = useMemo(
    () => pendientesAgrupadas.flatMap((g) => g.items.filter(esJuzgable).map((p) => p.id)),
    [pendientesAgrupadas],
  );

  // La selección solo puede contener filas que sigan pendientes (tras un refresh,
  // lo ya juzgado sale solo de la selección).
  const pendientesIds = useMemo(() => new Set(groups.pendientes.filter(esJuzgable).map((p) => p.id)), [groups.pendientes]);
  useEffect(() => {
    setSel((prev) => {
      const next = new Set([...prev].filter((id) => pendientesIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendientesIds]);

  // Toggle con rango shift+click (como el explorador): el rango se calcula sobre
  // el ORDEN visible de las pendientes.
  function toggleSel(id: string, shift: boolean) {
    setSel((prev) => {
      const next = new Set(prev);
      const last = lastSelRef.current;
      if (shift && last && last !== id) {
        const orden = ordenVisualPendientes;
        const a = orden.indexOf(last);
        const b = orden.indexOf(id);
        if (a >= 0 && b >= 0) {
          const on = !next.has(id);
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
            if (on) next.add(orden[i]); else next.delete(orden[i]);
          }
          lastSelRef.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      lastSelRef.current = id;
      return next;
    });
  }

  // Seleccionar/deseleccionar un conjunto completo (grupo o todas): si ya están
  // todas marcadas, las desmarca; si falta alguna, marca el conjunto entero.
  // "Seleccionar todo y desmarcar una" queda natural con el Set.
  function toggleConjunto(ids: string[]) {
    setSel((prev) => {
      const todas = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) { if (todas) next.delete(id); else next.add(id); }
      return next;
    });
    lastSelRef.current = null;
  }

  async function bulkSel(accion: "listo" | "sin_boleta") {
    if (sel.size === 0 || busyBulk) return;
    setBusyBulk(true);
    try {
      const ids = [...sel];
      const r = accion === "listo" ? await ponerListo(ids) : await rechazarPropuestas(ids);
      if (r.error) toast(r.error, "error");
      else {
        // La selección múltiple solo toma pendientes/editadas: quedan tachadas en su sitio.
        if (accion === "sin_boleta") setJuzgadasEnSesion((prev) => { const m = new Map(prev); for (const id of ids) m.set(id, "pendientes"); return m; });
        toast(accion === "listo"
          ? `${r.count} marcadas listas`
          : `${r.count} marcadas sin boleta (tachadas, recuperables)`);
      }
      setSel(new Set());
      onAction();
    } finally { setBusyBulk(false); }
  }

  // Lista PLANA: header de sección + sus filas (si expandida). Una sola lista para
  // un solo virtualizer → sin scrollMargin por sección.
  const flat = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const key of ORDER) {
      const arr = groups[key];
      if (arr.length === 0) continue;
      rows.push({ kind: "header", section: key, count: arr.length });
      if (!expanded[key]) continue;
      if (key === "pendientes" && pendientesAgrupadas.length > 1) {
        for (const g of pendientesAgrupadas) {
          rows.push({ kind: "subheader", section: key, sigla: g.sigla, label: g.label, color: g.color, bg: g.bg, ids: g.items.filter(esJuzgable).map((p) => p.id), count: g.items.length });
          if (!subColapsados.has(g.sigla)) for (const p of g.items) rows.push({ kind: "tx", section: key, p });
        }
      } else if (key === "pendientes") {
        for (const g of pendientesAgrupadas) for (const p of g.items) rows.push({ kind: "tx", section: key, p });
      } else {
        for (const p of arr) rows.push({ kind: "tx", section: key, p });
      }
    }
    return rows;
  }, [groups, expanded, pendientesAgrupadas, subColapsados]);

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
    estimateSize: (i) => (flat[i]?.kind === "tx" ? 44 : flat[i]?.kind === "subheader" ? 32 : 38),
    overscan: 8,
    rangeExtractor: keepExpandedMounted,
    getItemKey: (i) => {
      const r = flat[i];
      if (r.kind === "header") return `h:${r.section}`;
      if (r.kind === "subheader") return `s:${r.section}:${r.sigla}`;
      return `t:${r.p.id}`;
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
    if (actingRef.current.has(p.id)) return;
    actingRef.current.add(p.id);
    try {
      const r = await ponerListo([p.id]);
      if (r.error) toast(r.error, "error"); else toast("Lista");
      onAction();
    } finally { actingRef.current.delete(p.id); }
  }
  // La sección donde vive una propuesta viva — para dejarla tachada AHÍ al rechazar.
  function seccionDe(p: Propuesta): SectionKey {
    if (p.estado === "listo") return "listas";
    if (p.estado === "aprobado") return "emision";
    return "pendientes";
  }
  async function rejectOne(p: Propuesta) {
    if (actingRef.current.has(p.id)) return;
    actingRef.current.add(p.id);
    try {
      const casa = seccionDe(p);
      const r = await rechazarPropuesta(p.id);
      if (r.error) toast(r.error, "error");
      else {
        setJuzgadasEnSesion((prev) => new Map(prev).set(p.id, casa));
        toast(p.movimientos_raw?.tipo_flujo === "salida" ? "Listo: egreso sin boleta (queda tachado, recuperable)" : "Marcada sin boleta (queda tachada, recuperable)");
      }
      onAction();
    } finally { actingRef.current.delete(p.id); }
  }
  // Restaurar una rechazada/descartada: vuelve a 'pendiente' y la lista se refresca.
  async function restoreOne(p: Propuesta) {
    if (actingRef.current.has(p.id)) return;
    actingRef.current.add(p.id);
    try {
      const r = await restaurarPropuesta(p.id);
      if (r.error) toast(r.error, "error");
      else {
        setJuzgadasEnSesion((prev) => { const m = new Map(prev); m.delete(p.id); return m; });
        toast("Restaurada — quedó pendiente");
      }
      onAction();
    } finally { actingRef.current.delete(p.id); }
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap", background: "color-mix(in srgb, var(--text) 2%, transparent)" }}>
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
        {groups.pendientes.length > 0 && (
          <button
            onClick={() => toggleConjunto(ordenVisualPendientes)}
            disabled={busyBulk}
            title="Marca o desmarca todas las pendientes; después puedes des-clickear las que no van"
            style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 99, border: "1px solid var(--border)", background: sel.size === groups.pendientes.length ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent", color: "var(--text2)", cursor: "pointer" }}
          >
            {sel.size === groups.pendientes.length ? "Ninguna" : `Seleccionar todas (${groups.pendientes.length})`}
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text2)", display: "inline-flex", alignItems: "baseline", gap: 7 }}>
          Total <b style={{ color: "var(--text)", fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" }}>{fmt(total)}</b>
        </span>
      </div>

      {/* ── Barra de selección (aparece con casillas marcadas): el juicio en grupo
            es del humano — marca lo que ÉL decide y le aplica lista o sin boleta. ── */}
      {sel.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--accent) 6%, transparent)", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{sel.size} seleccionada{sel.size === 1 ? "" : "s"}</span>
          <span style={{ fontSize: 10, color: "var(--text3)" }}>shift+click = rango</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => bulkSel("listo")} disabled={busyBulk}
              style={{ fontSize: 11.5, fontWeight: 800, padding: "6px 14px", borderRadius: 99, border: "1px solid rgba(34,197,94,.35)", background: "rgba(34,197,94,.1)", color: "var(--green)", cursor: "pointer" }}>
              ✓ Poner en lista
            </button>
            <button onClick={() => bulkSel("sin_boleta")} disabled={busyBulk}
              style={{ fontSize: 11.5, fontWeight: 800, padding: "6px 14px", borderRadius: 99, border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.1)", color: "var(--red)", cursor: "pointer" }}>
              ✕ Sin boleta (egreso)
            </button>
            <button onClick={() => setSel(new Set())} disabled={busyBulk}
              style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 14px", borderRadius: 99, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer" }}>
              Limpiar
            </button>
          </span>
        </div>
      )}

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
                ) : row.kind === "subheader" ? (
                  <SubGroupHeader
                    sigla={row.sigla} label={row.label} color={row.color} bg={row.bg}
                    count={row.count}
                    marcadas={row.ids.filter((id) => sel.has(id)).length}
                    onToggleGrupo={() => toggleConjunto(row.ids)}
                    open={!subColapsados.has(row.sigla)}
                    onToggle={() => setSubColapsados((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.sigla)) next.delete(row.sigla); else next.add(row.sigla);
                      return next;
                    })}
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
                      selected={sel.has(row.p.id)}
                      onSelect={row.section === "pendientes" && esJuzgable(row.p) ? (shift: boolean) => toggleSel(row.p.id, shift) : undefined}
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
      style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 18px 7px", cursor: "pointer" }}
    >
      <span style={{ fontSize: 9, color: "var(--text3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s", flexShrink: 0 }}>▶</span>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color, boxShadow: `0 0 8px ${meta.color}`, flexShrink: 0 }} />
      <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: meta.color }}>{meta.label}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text2)", background: "color-mix(in srgb, var(--text) 7%, transparent)", borderRadius: 99, padding: "1px 8px" }}>{count}</span>
      {onStageAll && (
        <button
          onClick={(e) => { e.stopPropagation(); onStageAll(); }}
          disabled={bulkDisabled}
          style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 750, padding: "5px 13px", borderRadius: 99, border: "1px solid rgba(34,197,94,.35)", background: "rgba(34,197,94,.08)", color: "var(--green)", cursor: bulkDisabled ? "default" : "pointer", opacity: bulkDisabled ? 0.5 : 1 }}
        >
          {busy ? "..." : bulkLabel}
        </button>
      )}
    </div>
  );
}

/* ─── Fila de tx (colapsada) ─── */
function TxRow({ p, isOpen, onToggle, onStage, onReject, onRestore, selected = false, onSelect }: {
  p: Propuesta; isOpen: boolean; onToggle: () => void; onStage: () => void; onReject: () => void; onRestore: () => void;
  selected?: boolean;
  /** Presente solo en filas con juicio pendiente: casilla de selección múltiple. */
  onSelect?: (shift: boolean) => void;
}) {
  const tm = tipoMeta(p.tipo_propuesto);
  const conf = Math.round((p.confianza ?? 0) * 100);
  // 'aprobado' = comprometida a Emitir → sin ✎ (auditoría #21).
  const enEmision = p.estado === "aprobado";
  const rechazada = p.estado === "rechazado" || p.estado === "descartado";
  return (
    <div className="ce-row" onClick={onToggle} style={selected ? { background: "color-mix(in srgb, var(--accent) 7%, transparent)" } : undefined}>
      {/* Casilla estilo explorador: seleccionar para juzgar en grupo (shift = rango).
          Solo en filas pendientes — el juicio en lote lo decide el humano. */}
      {onSelect ? (
        <input type="checkbox" checked={selected} onChange={() => {}}
          onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey); }}
          aria-label="Seleccionar para acción en grupo"
          style={{ width: 16, height: 16, flexShrink: 0, accentColor: "var(--accent)", cursor: "pointer" }} />
      ) : (
        <span style={{ width: 16, flexShrink: 0 }} />
      )}
      <span style={{ transform: isOpen ? "rotate(90deg)" : "none", color: isOpen ? "var(--accent)" : "var(--text3)", fontSize: 10, transition: "transform .2s", flexShrink: 0 }}>▶</span>
      {/* Tile de tipo estilo landing: cuadrado con tinte, no un mini-tag */}
      <span title={tm.label} style={{ flexShrink: 0, display: "grid", placeItems: "center", minWidth: 44, height: 30, fontSize: 9, fontWeight: 800, letterSpacing: ".05em", borderRadius: 9, background: tm.bg, color: tm.color, border: `1px solid color-mix(in srgb, ${tm.color} 30%, transparent)` }}>{tm.sigla}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Tachada = juicio completado (sin boleta), no eliminada: sigue a la vista. */}
        <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-.01em", color: rechazada ? "var(--text3)" : "var(--text)", textDecoration: rechazada ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.movimientos_raw?.descripcion}</div>
        {p.receptor_nombre && <div style={{ fontSize: 10.5, color: "var(--text2)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.receptor_nombre}</div>}
      </div>
      {/* Fecha bancaria = columna (dato), no agrupador */}
      <span style={{ flexShrink: 0, fontSize: 10.5, color: "var(--text3)", minWidth: 56, textAlign: "right" }}>{fmtShort(p.movimientos_raw?.fecha)}</span>
      <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 750, fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em", color: rechazada ? "var(--text3)" : "var(--text)", minWidth: 76, textAlign: "right" }}>{fmt(p.total ?? p.movimientos_raw?.monto)}</span>
      <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: confColor(p.confianza), minWidth: 34, textAlign: "right" }}>{conf}%</span>
      {p.estado === "listo" && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: "var(--green)", letterSpacing: ".06em", padding: "3px 8px", borderRadius: 99, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)" }}>LISTO</span>}
      {enEmision && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: "var(--blue)", letterSpacing: ".06em", padding: "3px 8px", borderRadius: 99, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.3)" }}>EN EMISIÓN</span>}
      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {/* ✓ solo en borradores (pendiente/editado): nunca demotar una 'listo' (ya staged) ni una 'aprobado' (ya en Emitir) */}
        {(p.estado === "pendiente" || p.estado === "editado") && <RowActionBtn type="aprove" icon="✓" onClick={onStage} />}
        {rechazada ? (
          /* Restaurar reemplaza al ✎ en rechazadas: el detalle acá solo llevaba a un error engañoso */
          <button onClick={onRestore}
            style={{ fontSize: 10.5, fontWeight: 750, padding: "5px 12px", borderRadius: 99, border: "1px solid rgba(34,197,94,.35)", background: "rgba(34,197,94,.08)", color: "var(--green)", cursor: "pointer" }}>
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

/* ─── Encabezado de subgrupo por tipo (dentro de Pendientes) ─── */
function SubGroupHeader({ sigla, label, color, bg, count, marcadas, onToggleGrupo, open, onToggle }: {
  sigla: string; label: string; color: string; bg: string; count: number;
  marcadas: number; onToggleGrupo: () => void;
  open: boolean; onToggle: () => void;
}) {
  const todas = marcadas === count && count > 0;
  const algunas = marcadas > 0 && !todas;
  return (
    <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 18px 3px", cursor: "pointer" }}>
      <span style={{ fontSize: 8, color: "var(--text3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s", flexShrink: 0 }}>▶</span>
      {/* Casilla maestra del grupo: marca/desmarca la familia entera; con parte
          marcada muestra estado intermedio. "Todas menos una" = marcar todas y
          des-clickear la que sobra. */}
      <input
        type="checkbox"
        checked={todas}
        ref={(el) => { if (el) el.indeterminate = algunas; }}
        onChange={() => {}}
        onClick={(e) => { e.stopPropagation(); onToggleGrupo(); }}
        aria-label={`Seleccionar todo el grupo ${sigla}`}
        style={{ width: 15, height: 15, flexShrink: 0, accentColor: "var(--accent)", cursor: "pointer" }}
      />
      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".05em", padding: "3px 9px", borderRadius: 8, background: bg, color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)` }}>{sigla}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)" }}>{label}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text3)", background: "color-mix(in srgb, var(--text) 6%, transparent)", borderRadius: 99, padding: "0px 7px" }}>{count}</span>
      {marcadas > 0 && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 750, color: "var(--accent)" }}>{marcadas} seleccionada{marcadas === 1 ? "" : "s"}</span>}
    </div>
  );
}
