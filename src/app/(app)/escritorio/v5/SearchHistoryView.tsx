"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { SearchItem } from "@/lib/tree-structure";
import VisualizarArchivo from "./VisualizarArchivo";
import EmpresaBrand from "./EmpresaBrand";

type FilterType = "todo" | SearchItem["type"];
type DateMode = "emision" | "edicion";
type DatePreset = "all" | "today" | "7d" | "30d" | "month" | "day";

type NormalizedItem = SearchItem & {
  searchText: string;
  emissionDate: string;
  editDate: string;
  activeDate: string;
  activeDateKey: string;
  emissionDateKey: string;
  editDateKey: string;
  amount: number | null;
  amountLabel: string;
  statusLabel: string;
  typeMeta: TypeMeta;
  deferred: boolean;
};

type TypeMeta = { label: string; color: string; bg: string; glyph: string };

// Forma del JSON movimientos_raw guardado en propuestas.
type MovRaw = {
  fecha?: string;
  monto?: number;
  descripcion?: string;
  n_documento?: string;
  tipo_flujo?: string;
};

const TYPE_MAP: Record<SearchItem["type"], TypeMeta> = {
  boleta: { label: "Boleta", color: "#3B82F6", bg: "rgba(59,130,246,.1)", glyph: "B" },
  documento: { label: "Documento", color: "#f59e0b", bg: "rgba(245,158,11,.12)", glyph: "D" },
  propuesta: { label: "Propuesta", color: "#8b5cf6", bg: "rgba(139,92,246,.12)", glyph: "P" },
  actividad: { label: "Actividad", color: "#22c55e", bg: "rgba(34,197,94,.12)", glyph: "A" },
};

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "todo", label: "Todos" },
  { key: "boleta", label: "Boletas" },
  { key: "documento", label: "Documentos" },
  { key: "propuesta", label: "Propuestas" },
  { key: "actividad", label: "Actividad" },
];

const RANGE_FILTERS: { key: Exclude<DatePreset, "all" | "day">; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "month", label: "Este mes" },
];

const TIPO_BADGE: Record<number, { label: string; color: string; bg: string }> = {
  39: { label: "AFE", color: "#E8553E", bg: "rgba(232,85,62,.12)" },
  41: { label: "EXE", color: "#3B82F6", bg: "rgba(59,130,246,.12)" },
  61: { label: "NC", color: "#7C3AED", bg: "rgba(124,58,237,.12)" },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  activo: { label: "Activo", color: "#22c55e", bg: "rgba(34,197,94,.12)" },
  emitido: { label: "Emitido", color: "#22c55e", bg: "rgba(34,197,94,.12)" },
  anulada: { label: "Anulada", color: "#ef4444", bg: "rgba(239,68,68,.12)" },
  subido: { label: "Pendiente", color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  procesando: { label: "Procesando", color: "#5b9cf6", bg: "rgba(91,156,246,.12)" },
  procesado: { label: "Procesado", color: "#22c55e", bg: "rgba(34,197,94,.12)" },
  error: { label: "Error", color: "#ef4444", bg: "rgba(239,68,68,.12)" },
};

function fmtMoney(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "";
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

// Fechas date-only ("2026-06-09", típicas de fecha_emision) se interpretan
// como UTC midnight por JS: formatearlas en hora local de Chile las corría
// un día hacia atrás (grupo "9 de junio" mostraba 08-06-26). Date-only se
// formatea en UTC (día literal); timestamps completos, en hora local.
function isDateOnly(fecha: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

function fmtDate(fecha: string, style: "short" | "long" = "short") {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const opts: Intl.DateTimeFormatOptions = style === "long"
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "2-digit", month: "2-digit", year: "2-digit" };
  if (isDateOnly(fecha)) opts.timeZone = "UTC";
  return d.toLocaleDateString("es-CL", opts);
}

function fmtMonth(fecha: string) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const label = d.toLocaleDateString("es-CL", isDateOnly(fecha) ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getDateKey(fecha: string) {
  if (isDateOnly(fecha)) return fecha;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "sin-fecha";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonthKey(fecha: string) {
  if (isDateOnly(fecha)) return fecha.slice(0, 7);
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "sin-fecha";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getWorkspaceSubtitle(datePreset: DatePreset, selectedDate: string | null) {
  if (selectedDate || datePreset === "day" || datePreset === "today") return "del día";
  if (datePreset === "7d" || datePreset === "30d") return "del período";
  return "del mes";
}

function getEditDate(item: SearchItem) {
  const d = item.data ?? {};
  return String(d.updated_at ?? d.created_at ?? item.fecha ?? "");
}

function getEmissionDate(item: SearchItem) {
  const d = item.data ?? {};
  if (item.type === "boleta") return String(d.fecha_emision ?? item.fecha ?? "");
  if (item.type === "propuesta") return String((d.movimientos_raw as MovRaw | undefined)?.fecha ?? d.created_at ?? item.fecha ?? "");
  return String(item.fecha ?? d.created_at ?? "");
}

function getAmount(item: SearchItem) {
  if (typeof item.monto === "number") return item.monto;
  if (typeof item.data?.monto_total === "number") return item.data.monto_total;
  const mov = item.data?.movimientos_raw as MovRaw | undefined;
  return typeof mov?.monto === "number" ? mov.monto : null;
}

function getStatus(item: SearchItem) {
  const estado = String(item.data?.estado ?? "");
  if (estado && STATUS_META[estado]) return STATUS_META[estado].label;
  if (item.type === "boleta") return "Emitida";
  if (item.type === "propuesta") return "Por revisar";
  return estado || "Registrado";
}

function getDocumentId(item: SearchItem) {
  if (item.type !== "documento") return null;
  const rawId = String(item.data?.id ?? item.id.replace(/^doc-/, ""));
  return rawId || null;
}

function createSearchText(item: SearchItem) {
  const d = item.data ?? {};
  const mov = (d.movimientos_raw as MovRaw | undefined) ?? {};
  const parts = [
    item.label,
    item.subtitle,
    item.type,
    String(d.folio ?? ""),
    String(d.receptor_razon_social ?? ""),
    String(d.receptor_rut ?? ""),
    String(d.nombre_archivo ?? ""),
    String(d.estado ?? ""),
    String(d.tipo ?? ""),
    String(d.monto_total ?? ""),
    String(mov.descripcion ?? ""),
    String(mov.n_documento ?? ""),
    String(mov.monto ?? ""),
  ];
  return parts.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizeItem(item: SearchItem, dateMode: DateMode): NormalizedItem {
  const emissionDate = getEmissionDate(item);
  const editDate = getEditDate(item);
  const activeDate = dateMode === "emision" ? emissionDate : editDate;
  const amount = getAmount(item);
  const deferred = item.type === "boleta" && getDateKey(emissionDate) !== getDateKey(editDate);
  return {
    ...item,
    emissionDate,
    editDate,
    activeDate,
    activeDateKey: getDateKey(activeDate),
    emissionDateKey: getDateKey(emissionDate),
    editDateKey: getDateKey(editDate),
    amount,
    amountLabel: fmtMoney(amount) || "-",
    statusLabel: getStatus(item),
    searchText: createSearchText(item),
    typeMeta: TYPE_MAP[item.type],
    deferred,
  };
}

function inDatePreset(date: string, preset: DatePreset, selectedDate: string | null) {
  if (preset === "all") return true;
  if (preset === "day") return selectedDate ? getDateKey(date) === selectedDate : true;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (preset === "today") return t === startToday;
  if (preset === "7d") return t >= startToday - 6 * 86400000 && t <= startToday;
  if (preset === "30d") return t >= startToday - 29 * 86400000 && t <= startToday;
  if (preset === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  return true;
}

function useDebouncedValue(value: string, delay = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [delay, value]);
  return debounced;
}

export default function SearchHistoryView({ items: allItems, empresaNombre, empresaLogoUrl }: { items: SearchItem[]; empresaNombre?: string; empresaLogoUrl?: string | null }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [filter, setFilter] = useState<FilterType>("todo");
  const [dateMode, setDateMode] = useState<DateMode>("emision");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [datesCollapsed, setDatesCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(allItems[0]?.id ?? null);
  const [viewingDocumentId, setViewingDocumentId] = useState<string | null>(null);

  const normalized = useMemo(() => allItems.map((item) => normalizeItem(item, dateMode)), [allItems, dateMode]);
  const normalizedQuery = debouncedQuery.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filtered = useMemo(() => {
    return normalized.filter((item) => {
      const matchesType = filter === "todo" || item.type === filter;
      const matchesQuery = !normalizedQuery || item.searchText.includes(normalizedQuery);
      const matchesDate = inDatePreset(item.activeDate, datePreset, selectedDate);
      return matchesType && matchesQuery && matchesDate;
    });
  }, [datePreset, filter, normalized, normalizedQuery, selectedDate]);

  const grouped = useMemo(() => {
    const groups = new Map<string, NormalizedItem[]>();
    const sorted = [...filtered].sort((a, b) => new Date(b.activeDate).getTime() - new Date(a.activeDate).getTime());
    for (const item of sorted) {
      const key = fmtDate(item.activeDate, "long");
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  const selectedItem = useMemo(() => filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null, [filtered, selectedId]);

  const explorerMonths = useMemo(() => {
    const months = new Map<string, { label: string; sort: number; count: number; dates: Map<string, { label: string; count: number; types: Record<SearchItem["type"], number>; sort: number }> }>();
    for (const item of normalized) {
      if (normalizedQuery && !item.searchText.includes(normalizedQuery)) continue;
      const monthKey = getMonthKey(item.activeDate);
      const dateKey = item.activeDateKey;
      const monthSort = new Date(item.activeDate).getTime();
      const month = months.get(monthKey) ?? { label: fmtMonth(item.activeDate), sort: Number.isNaN(monthSort) ? 0 : monthSort, count: 0, dates: new Map() };
      const date = month.dates.get(dateKey) ?? { label: fmtDate(item.activeDate, "long"), count: 0, types: { boleta: 0, documento: 0, propuesta: 0, actividad: 0 }, sort: Number.isNaN(monthSort) ? 0 : monthSort };
      date.count += 1;
      date.types[item.type] += 1;
      month.count += 1;
      month.dates.set(dateKey, date);
      months.set(monthKey, month);
    }
    return Array.from(months.entries()).sort((a, b) => b[1].sort - a[1].sort).map(([key, month]) => ({
      key,
      label: month.label,
      count: month.count,
      dates: Array.from(month.dates.entries()).sort((a, b) => b[1].sort - a[1].sort),
    }));
  }, [normalized, normalizedQuery]);

  // Al cambiar modo de fecha o búsqueda se colapsan todos los meses menos el
  // primero. Ajuste de estado durante render (patrón "adjusting state when
  // props change") en vez de effect, para evitar el render en cascada.
  const collapseResetKey = `${dateMode}|${normalizedQuery}`;
  const [prevCollapseResetKey, setPrevCollapseResetKey] = useState<string | null>(null);
  if (prevCollapseResetKey !== collapseResetKey) {
    setPrevCollapseResetKey(collapseResetKey);
    setCollapsedMonths(new Set(explorerMonths.slice(1).map((month) => month.key)));
  }

  useEffect(() => {
    function onQueryChange(event: CustomEvent<{ query?: string }>) {
      setQuery(event.detail?.query ?? "");
    }

    window.addEventListener("search-history-query-change", onQueryChange as EventListener);
    return () => window.removeEventListener("search-history-query-change", onQueryChange as EventListener);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (modK) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("focus-search-history"));
        return;
      }
      if (event.key === "Escape" && viewingDocumentId) {
        setViewingDocumentId(null);
        return;
      }
      if (event.key === "Escape" && query) {
        setQuery("");
        window.dispatchEvent(new CustomEvent("search-history-query-sync", { detail: { query: "" } }));
        return;
      }
      if (!filtered.length) return;
      const current = Math.max(0, filtered.findIndex((item) => item.id === selectedItem?.id));
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedId(filtered[Math.min(filtered.length - 1, current + 1)].id);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId(filtered[Math.max(0, current - 1)].id);
      }
      if (event.key === "Enter" && selectedItem?.type === "documento" && selectedItem.data?.storage_path) {
        const docId = getDocumentId(selectedItem);
        if (docId) setViewingDocumentId(docId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, query, selectedItem, viewingDocumentId]);

  function clearDateFilters() {
    setDatePreset("all");
    setSelectedDate(null);
  }

  const workspaceSubtitle = getWorkspaceSubtitle(datePreset, selectedDate);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", color: "var(--text)", fontFeatureSettings: '"kern" 1, "liga" 1' }}>
      <header style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10, background: "linear-gradient(180deg, var(--surface), color-mix(in srgb, var(--surface) 82%, var(--bg-muted)))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <EmpresaBrand nombre={empresaNombre ?? "Mesa de trabajo"} logoUrl={empresaLogoUrl ?? ""} size={38} textSize={17} />
              <span style={{ fontSize: 11, fontWeight: 760, letterSpacing: "-.015em", color: "var(--text2)", whiteSpace: "nowrap" }}>{workspaceSubtitle}</span>
            </div>
            <SegmentedControl value={dateMode} onChange={(mode) => { setDateMode(mode); clearDateFilters(); }} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <DatePill active={datePreset === "all"} onClick={clearDateFilters}>Todas</DatePill>
            {RANGE_FILTERS.map((r) => <DatePill key={r.key} active={datePreset === r.key} onClick={() => { setDatePreset(r.key); setSelectedDate(null); }}>{r.label}</DatePill>)}
            <DatePill active={false} onClick={clearDateFilters}>Limpiar</DatePill>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `${sidebarCollapsed ? 32 : 236}px minmax(520px, 1fr) 324px`, transition: "grid-template-columns .24s cubic-bezier(.22,1,.36,1)" }}>
        <ExplorerSidebar collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((v) => !v)} months={explorerMonths} filter={filter} selectedDate={selectedDate} collapsedMonths={collapsedMonths} libraryCollapsed={libraryCollapsed} datesCollapsed={datesCollapsed} onToggleLibrary={() => setLibraryCollapsed((v) => !v)} onToggleDates={() => setDatesCollapsed((v) => !v)} onToggleMonth={(key) => setCollapsedMonths((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })} onAll={() => { setFilter("todo"); clearDateFilters(); }} onType={(type) => { setFilter(type); clearDateFilters(); }} onDate={(key) => { setDatePreset("day"); setSelectedDate(key); setFilter("todo"); }} onDateType={(key, type) => { setDatePreset("day"); setSelectedDate(key); setFilter(type); }} />

        <main style={{ minHeight: 0, overflow: "auto", borderRight: "1px solid var(--border)", background: "var(--surface)" }}>
          {filtered.length === 0 ? <EmptyState query={debouncedQuery} filtered={allItems.length > 0} /> : <FinderTable grouped={grouped} selectedId={selectedItem?.id ?? null} dateMode={dateMode} query={normalizedQuery} onSelect={setSelectedId} />}
        </main>

        <aside style={{ minHeight: 0, overflow: "auto", padding: "16px", background: "linear-gradient(180deg, var(--surface), var(--bg-muted))" }}>
          {selectedItem ? <ItemDetail item={selectedItem} onViewDocument={setViewingDocumentId} /> : <DetailPlaceholder />}
        </aside>
      </div>

      {viewingDocumentId && <VisualizarArchivo documentoId={viewingDocumentId} onClose={() => setViewingDocumentId(null)} />}
    </div>
  );
}

function SegmentedControl({ value, onChange }: { value: DateMode; onChange: (mode: DateMode) => void }) {
  return (
    <div style={{ display: "flex", padding: 3, borderRadius: 13, border: "1px solid rgba(232,85,62,.22)", background: "rgba(232,85,62,.06)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
      {([{ key: "emision", label: "Emisión SII" }, { key: "edicion", label: "Edición/Subida" }] as const).map((mode) => {
        const active = value === mode.key;
        return <button key={mode.key} onClick={() => onChange(mode.key)} style={{ minWidth: 104, padding: "7px 11px", borderRadius: 10, border: "none", cursor: "pointer", background: active ? "#E8553E" : "transparent", color: active ? "white" : "var(--text2)", fontSize: 10, fontWeight: 900, boxShadow: active ? "0 9px 24px -14px rgba(232,85,62,.8)" : "none" }}>{mode.label}</button>;
      })}
    </div>
  );
}

function DatePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: "5px 9px", borderRadius: 999, border: active ? "1px solid rgba(232,85,62,.45)" : "1px solid var(--border)", background: active ? "rgba(232,85,62,.11)" : "var(--surface)", color: active ? "#E8553E" : "var(--text2)", fontSize: 9, fontWeight: 850, cursor: "pointer" }}>{children}</button>;
}

function ExplorerSidebar({ collapsed, onToggleCollapsed, months, filter, selectedDate, collapsedMonths, libraryCollapsed, datesCollapsed, onToggleLibrary, onToggleDates, onToggleMonth, onAll, onType, onDate, onDateType }: { collapsed: boolean; onToggleCollapsed: () => void; months: { key: string; label: string; count: number; dates: [string, { label: string; count: number; types: Record<SearchItem["type"], number> }][] }[]; filter: FilterType; selectedDate: string | null; collapsedMonths: Set<string>; libraryCollapsed: boolean; datesCollapsed: boolean; onToggleLibrary: () => void; onToggleDates: () => void; onToggleMonth: (key: string) => void; onAll: () => void; onType: (type: SearchItem["type"]) => void; onDate: (key: string) => void; onDateType: (key: string, type: SearchItem["type"]) => void }) {
  const total = months.reduce((sum, month) => sum + month.count, 0);
  const types = FILTERS.filter((f): f is { key: SearchItem["type"]; label: string } => f.key !== "todo");
  return (
    <aside style={{ position: "relative", minHeight: 0, overflow: collapsed ? "hidden" : "auto", borderRight: "1px solid var(--border)", background: "color-mix(in srgb, var(--bg-muted) 88%, var(--surface))", padding: collapsed ? "10px 4px" : "6px 9px 12px", transition: "padding .24s cubic-bezier(.22,1,.36,1)" }}>
      <button onClick={onToggleCollapsed} title={collapsed ? "Mostrar panel" : "Ocultar panel"} aria-label={collapsed ? "Mostrar panel lateral" : "Ocultar panel lateral"} style={{ position: "relative", zIndex: 2, width: collapsed ? 22 : 22, height: collapsed ? 22 : 20, margin: collapsed ? "0 auto" : "0 0 2px auto", borderRadius: collapsed ? 7 : 7, border: "1px solid rgba(232,85,62,.22)", background: "rgba(232,85,62,.08)", color: "#E8553E", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "0 0 12px rgba(232,85,62,.08), inset 0 1px 0 var(--border)", transition: "all .18s ease" }}>
        <span style={{ fontSize: collapsed ? 12 : 12, fontWeight: 900, lineHeight: 1 }}>{collapsed ? "›" : "‹"}</span>
      </button>
      {collapsed ? (
        <div style={{ marginTop: 10, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", color: "var(--text2)", fontSize: 9, fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Filtros</div>
        </div>
      ) : <>
      <SectionToggle label="Biblioteca" collapsed={libraryCollapsed} onClick={onToggleLibrary} />
      {!libraryCollapsed && <>
        <ExplorerButton active={filter === "todo" && selectedDate === null} label="Todos los elementos" count={total} onClick={onAll} />
        {types.map((type) => <ExplorerButton key={type.key} active={filter === type.key && selectedDate === null} label={type.label} count={months.reduce((sum, month) => sum + month.dates.reduce((s, [, d]) => s + d.types[type.key], 0), 0)} color={TYPE_MAP[type.key].color} onClick={() => onType(type.key)} />)}
      </>}

      <SectionToggle label="Fechas" collapsed={datesCollapsed} onClick={onToggleDates} style={{ marginTop: 14 }} />
      {!datesCollapsed && months.map((month, index) => {
        const collapsed = index > 0 && collapsedMonths.has(month.key);
        const isNoDate = month.key === "sin-fecha";
        return (
          <div key={month.key} style={{ marginBottom: 5 }}>
            <button onClick={() => onToggleMonth(month.key)} style={{ width: "100%", display: "grid", gridTemplateColumns: "14px 1fr auto", gap: 6, alignItems: "center", border: "none", background: "transparent", color: isNoDate ? "#f59e0b" : "var(--text2)", cursor: "pointer", padding: "5px 7px", fontSize: 10, fontWeight: 900, textAlign: "left" }}>
              <span>{collapsed ? "▸" : "▾"}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{month.label}</span><span style={{ fontSize: 8 }}>{month.count}</span>
            </button>
            {!collapsed && <div style={{ marginLeft: 10, borderLeft: "1px solid var(--border)", paddingLeft: 6 }}>
              {month.dates.map(([key, date]) => <div key={key}>
                <ExplorerButton small active={selectedDate === key && filter === "todo"} label={date.label.replace(/ de /g, " ")} count={date.count} color={isNoDate ? "#f59e0b" : "#E8553E"} onClick={() => onDate(key)} />
                <div style={{ marginLeft: 12 }}>
                  {types.filter((t) => date.types[t.key] > 0).map((t) => <ExplorerButton key={t.key} tiny active={selectedDate === key && filter === t.key} label={t.label} count={date.types[t.key]} color={TYPE_MAP[t.key].color} onClick={() => onDateType(key, t.key)} />)}
                </div>
              </div>)}
            </div>}
          </div>
        );
      })}
      </>}
    </aside>
  );
}

function SectionToggle({ label, collapsed, onClick, style }: { label: string; collapsed: boolean; onClick: () => void; style?: React.CSSProperties }) {
  return <button onClick={onClick} style={{ width: "100%", display: "grid", gridTemplateColumns: "14px 1fr", gap: 6, alignItems: "center", margin: "0 0 6px", padding: "0 8px", border: "none", background: "transparent", color: "var(--text3)", cursor: "pointer", textAlign: "left", fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".1em", ...style }}><span style={{ fontSize: 10, lineHeight: 1 }}>{collapsed ? "▸" : "▾"}</span><span>{label}</span></button>;
}

function ExplorerButton({ active, label, count, color = "#E8553E", small, tiny, onClick }: { active: boolean; label: string; count: number; color?: string; small?: boolean; tiny?: boolean; onClick: () => void }) {
  return <button onClick={onClick} style={{ width: "100%", display: "grid", gridTemplateColumns: "12px 1fr auto", gap: 6, alignItems: "center", border: active ? `1px solid ${color}42` : "1px solid transparent", background: active ? `${color}14` : "transparent", color: active ? "var(--text)" : "var(--text2)", borderRadius: 8, padding: tiny ? "3px 6px" : small ? "4px 6px" : "5px 7px", cursor: "pointer", textAlign: "left", fontSize: tiny ? 8 : small ? 9 : 10, fontWeight: active ? 850 : 650 }}><span style={{ width: tiny ? 5 : 7, height: tiny ? 5 : 7, borderRadius: 2, background: color, opacity: active ? 1 : .55 }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span><span style={{ fontSize: 8, color: active ? color : "var(--text3)" }}>{count}</span></button>;
}

function FinderTable({ grouped, selectedId, dateMode, query, onSelect }: { grouped: [string, NormalizedItem[]][]; selectedId: string | null; dateMode: DateMode; query: string; onSelect: (id: string) => void }) {
  const columns = "76px minmax(240px,1fr) 92px 96px 100px 104px";
  return <div style={{ minWidth: 820 }}>
    <div style={{ position: "sticky", top: 0, zIndex: 5, display: "grid", gridTemplateColumns: columns, gap: 10, alignItems: "center", padding: "9px 14px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--surface) 82%, transparent)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", color: "var(--text2)", fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".09em" }}>
      <span>Tipo</span><span>Nombre</span><span style={{ textAlign: "right" }}>Monto</span><span>Estado</span><span style={{ color: dateMode === "emision" ? "#E8553E" : "var(--text2)" }}>Emisión SII</span><span style={{ color: dateMode === "edicion" ? "#E8553E" : "var(--text2)" }}>Edición/Subida</span>
    </div>
    {grouped.map(([label, items]) => <section key={label}>
      <div style={{ position: "sticky", top: 33, zIndex: 4, padding: "7px 14px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--surface) 90%, transparent)", backdropFilter: "blur(12px)", color: "var(--text2)", fontSize: 10, fontWeight: 850 }}>{label}</div>
      {items.map((item) => <FinderRow key={item.id} item={item} selected={selectedId === item.id} columns={columns} dateMode={dateMode} query={query} onSelect={() => onSelect(item.id)} />)}
    </section>)}
  </div>;
}

function FinderRow({ item, selected, columns, dateMode, query, onSelect }: { item: NormalizedItem; selected: boolean; columns: string; dateMode: DateMode; query: string; onSelect: () => void }) {
  const statusMeta = Object.values(STATUS_META).find((s) => s.label === item.statusLabel) ?? { label: item.statusLabel, color: "var(--text2)", bg: "var(--bg-muted)" };
  return <button onClick={onSelect} style={{ position: "relative", width: "100%", minHeight: 46, display: "grid", gridTemplateColumns: columns, gap: 10, alignItems: "center", padding: "6px 14px", border: "none", borderBottom: "1px solid color-mix(in srgb, var(--border) 62%, transparent)", cursor: "pointer", textAlign: "left", background: selected ? `linear-gradient(90deg, ${item.typeMeta.bg}, transparent 78%)` : "transparent", color: "inherit", boxShadow: selected ? `inset 2px 0 0 ${item.typeMeta.color}, inset 0 0 0 1px ${item.typeMeta.color}24` : "none" }}>
    <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 20, height: 20, borderRadius: 6, display: "grid", placeItems: "center", background: item.typeMeta.bg, color: item.typeMeta.color, fontSize: 9, fontWeight: 900 }}>{item.typeMeta.glyph}</span><span style={{ fontSize: 9, color: item.typeMeta.color, fontWeight: 850 }}>{item.typeMeta.label}</span></span>
    <span style={{ minWidth: 0 }}><span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}><span style={{ fontSize: 11, fontWeight: 820, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{highlightText(item.label, query)}</span>{item.deferred && <DeferredBadge item={item} compact />}</span><span style={{ marginTop: 2, display: "block", fontSize: 9, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{highlightText(item.subtitle, query)}</span></span>
    <span style={{ textAlign: "right", fontSize: 11, color: item.amount ? "var(--text)" : "var(--text3)", fontWeight: 850, fontVariantNumeric: "tabular-nums lining-nums" }}>{item.amountLabel}</span>
    <StatusBadge meta={statusMeta} />
    <span style={{ position: "relative", fontSize: 10, color: dateMode === "emision" ? "var(--text)" : "var(--text2)", fontWeight: dateMode === "emision" ? 850 : 650, fontVariantNumeric: "tabular-nums lining-nums" }}>{dateMode === "emision" && <ActiveDateRail />}{fmtDate(item.emissionDate)}</span>
    <span style={{ position: "relative", fontSize: 10, color: dateMode === "edicion" ? "var(--text)" : "var(--text2)", fontWeight: dateMode === "edicion" ? 850 : 650, fontVariantNumeric: "tabular-nums lining-nums" }}>{dateMode === "edicion" && <ActiveDateRail />}{fmtDate(item.editDate)}</span>
  </button>;
}

function ActiveDateRail() {
  return <span style={{ position: "absolute", left: -7, top: -13, bottom: -13, width: 2, borderRadius: 2, background: "rgba(232,85,62,.38)" }} />;
}

function DeferredBadge({ item, compact }: { item: NormalizedItem; compact?: boolean }) {
  return <span title={`Emisión ${fmtDate(item.emissionDate)} · Subida ${fmtDate(item.editDate)}`} style={{ display: "inline-flex", flexDirection: compact ? "row" : "column", gap: compact ? 4 : 1, alignItems: compact ? "center" : "flex-start", fontSize: compact ? 8 : 9, color: "#E8553E", fontWeight: 900, background: "rgba(232,85,62,.11)", border: "1px solid rgba(232,85,62,.18)", padding: compact ? "1px 5px" : "5px 7px", borderRadius: compact ? 999 : 9 }}><span>Diferida</span>{!compact && <span style={{ fontWeight: 700, color: "var(--text2)" }}>Emisión {fmtDate(item.emissionDate)} · Subida {fmtDate(item.editDate)}</span>}</span>;
}

function StatusBadge({ meta }: { meta: { label: string; color: string; bg: string } }) {
  return <span style={{ width: "fit-content", padding: "3px 7px", borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 9, fontWeight: 850 }}>{meta.label}</span>;
}

function ItemDetail({ item, onViewDocument }: { item: NormalizedItem; onViewDocument: (documentId: string) => void }) {
  const d = item.data ?? {};
  const statusMeta = Object.values(STATUS_META).find((s) => s.label === item.statusLabel) ?? { label: item.statusLabel, color: "var(--text2)", bg: "var(--bg-muted)" };
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}><div style={{ width: 40, height: 40, borderRadius: 14, display: "grid", placeItems: "center", background: item.typeMeta.bg, color: item.typeMeta.color, fontSize: 13, fontWeight: 900 }}>{item.typeMeta.glyph}</div><div style={{ minWidth: 0, flex: 1 }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Badge label={item.typeMeta.label.toUpperCase()} color={item.typeMeta.color} bg={item.typeMeta.bg} />{item.type === "boleta" && <DteBadge tipo={d.tipo_dte} />}<StatusBadge meta={statusMeta} /></div><h2 style={{ margin: "8px 0 0", fontSize: 16, lineHeight: 1.15, fontWeight: 860, letterSpacing: "-.035em", color: "var(--text)" }}>{item.label}</h2></div></div>
    <HeroBlock item={item} />
    {item.deferred && <DeferredBadge item={item} />}
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)" }}><TypeFields item={item} /></div>
    <div style={{ padding: 12, borderRadius: 14, background: item.typeMeta.bg, border: `1px solid ${item.typeMeta.color}24` }}><div style={{ fontSize: 9, fontWeight: 900, color: item.typeMeta.color, textTransform: "uppercase", letterSpacing: ".09em" }}>Acciones</div><div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 7 }}><ActionButtons item={item} onViewDocument={onViewDocument} /></div></div>
  </div>;
}

function HeroBlock({ item }: { item: NormalizedItem }) {
  if (item.type === "boleta") return <Hero value={item.amountLabel} label="Total documento" color={item.typeMeta.color} />;
  if (item.type === "documento") return <Hero value={`${Number((item.data?.movimientos_detectados as number) ?? 0).toLocaleString("es-CL")} movimientos`} label={item.statusLabel} color={item.typeMeta.color} />;
  if (item.type === "propuesta") return <Hero value={item.amountLabel} label={`Confianza ${Math.round(Number(item.data?.confianza ?? 0) * 100)}%`} color={item.typeMeta.color} />;
  return <Hero value={item.statusLabel} label="Actividad registrada" color={item.typeMeta.color} />;
}

function Hero({ value, label, color }: { value: string; label: string; color: string }) {
  return <div style={{ padding: "16px 14px", borderRadius: 16, background: `linear-gradient(135deg, ${color}18, var(--surface))`, border: `1px solid ${color}24` }}><div style={{ fontSize: 24, lineHeight: 1, fontWeight: 900, color: "var(--text)", letterSpacing: "-.04em", fontVariantNumeric: "tabular-nums lining-nums" }}>{value}</div><div style={{ marginTop: 5, color: "var(--text2)", fontSize: 10, fontWeight: 760 }}>{label}</div></div>;
}

function TypeFields({ item }: { item: NormalizedItem }) {
  const d = item.data ?? {};
  if (item.type === "boleta") return <><Row label="Estado">{item.statusLabel}</Row><Row label="Receptor">{String(d.receptor_razon_social ?? "-")}</Row><Row label="RUT">{String(d.receptor_rut ?? "-")}</Row><Row label="Folio">#{String(d.folio ?? "-")}</Row><Row label="Emisión SII">{fmtDate(item.emissionDate, "long")}</Row><Row label="Subida/Edición">{fmtDate(item.editDate, "long")}</Row><Row label="Neto">{fmtMoney((d.monto_neto as number | undefined) ?? item.amount) || "-"}</Row><Row label="IVA">{fmtMoney(d.iva as number | undefined) || "-"}</Row></>;
  if (item.type === "documento") { const progreso = (d.progreso_ia as { movimientos_encontrados?: number; duplicados_saltados?: number } | undefined) ?? {}; return <><Row label="Archivo">{String(d.nombre_archivo ?? item.label)}</Row><Row label="Tipo">{String(d.tipo ?? "Excel")}</Row><Row label="Subido">{fmtDate(item.editDate, "long")}</Row><Row label="Estado">{item.statusLabel}</Row><Row label="Encontrados">{String(progreso.movimientos_encontrados ?? d.movimientos_detectados ?? 0)}</Row>{(progreso.duplicados_saltados ?? 0) > 0 && <Row label="Duplicados">{progreso.duplicados_saltados}</Row>}</>; }
  if (item.type === "propuesta") { const mov = (d.movimientos_raw as MovRaw | undefined) ?? {}; return <><Row label="Descripción">{String(mov.descripcion ?? item.label)}</Row><Row label="Monto">{item.amountLabel}</Row><Row label="Flujo">{mov.tipo_flujo === "entrada" ? "Ingreso" : mov.tipo_flujo === "salida" ? "Gasto" : "-"}</Row><Row label="Fecha mov.">{mov.fecha ? fmtDate(String(mov.fecha), "long") : "-"}</Row><Row label="Documento">{String(mov.n_documento ?? "-")}</Row></>; }
  return <><Row label="Detalle">{item.subtitle || "Registro de actividad"}</Row><Row label="Fecha">{fmtDate(item.activeDate, "long")}</Row></>;
}

function ActionButtons({ item, onViewDocument }: { item: NormalizedItem; onViewDocument: (documentId: string) => void }) {
  if (item.type === "documento") { const docId = getDocumentId(item); const hasFile = Boolean(item.data?.storage_path); return docId && hasFile ? <PrimaryAction onClick={() => onViewDocument(docId)}>Visualizar Excel</PrimaryAction> : <span style={{ fontSize: 10, color: "var(--text2)" }}>Archivo no disponible para visualizar.</span>; }
  if (item.type === "boleta") return <><PrimaryAction onClick={() => navigator.clipboard?.writeText(String(item.data?.folio ?? ""))}>Copiar folio</PrimaryAction>{item.data?.receptor_rut && <SecondaryAction onClick={() => navigator.clipboard?.writeText(String(item.data?.receptor_rut))}>Copiar RUT</SecondaryAction>}</>;
  if (item.type === "propuesta") return <PrimaryAction onClick={() => window.dispatchEvent(new CustomEvent("switch-view", { detail: "dashboard" }))}>Revisar propuesta</PrimaryAction>;
  return <span style={{ fontSize: 10, color: "var(--text2)" }}>Sin acciones disponibles.</span>;
}

function PrimaryAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ border: "none", borderRadius: 10, background: "#E8553E", color: "white", padding: "8px 11px", fontSize: 10, fontWeight: 900, cursor: "pointer", boxShadow: "0 12px 28px -18px rgba(232,85,62,.8)" }}>{children}</button>;
}

function SecondaryAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", padding: "8px 11px", fontSize: 10, fontWeight: 850, cursor: "pointer" }}>{children}</button>;
}

function DteBadge({ tipo }: { tipo: unknown }) {
  const meta = TIPO_BADGE[Number(tipo)];
  if (!meta) return null;
  return <Badge label={meta.label} color={meta.color} bg={meta.bg} />;
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span style={{ fontSize: 8, padding: "3px 7px", borderRadius: 999, fontWeight: 900, background: bg, color }}>{label}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "104px 1fr", gap: 8, alignItems: "baseline", fontSize: 10 }}><span style={{ color: "var(--text2)", fontWeight: 650 }}>{label}</span><span style={{ color: "var(--text)", fontWeight: 720, minWidth: 0, overflowWrap: "anywhere" }}>{children}</span></div>;
}

function highlightText(text: string, query: string) {
  if (!query || query.length < 2) return text;
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const index = normalized.indexOf(query);
  if (index === -1) return text;
  return <>{text.slice(0, index)}<mark style={{ color: "inherit", background: "rgba(232,85,62,.22)", borderRadius: 3, padding: "0 1px" }}>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}

function EmptyState({ query, filtered }: { query: string; filtered: boolean }) {
  const title = !filtered ? "Sin historial reciente" : query ? `Sin resultados para "${query}"` : "Sin resultados con estos filtros";
  const message = query ? "Prueba buscar por folio, RUT, monto, receptor o nombre de archivo." : "Ajusta el tipo, rango de fechas o modo de fecha para ampliar los resultados.";
  return <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 36, textAlign: "center" }}><div><div style={{ width: 54, height: 54, borderRadius: 18, margin: "0 auto 12px", display: "grid", placeItems: "center", background: "rgba(232,85,62,.1)", color: "#E8553E" }}><Search size={21} /></div><div style={{ fontSize: 13, fontWeight: 850, color: "var(--text)" }}>{title}</div><div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", maxWidth: 300, lineHeight: 1.45 }}>{message}</div></div></div>;
}

function DetailPlaceholder() {
  return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--text2)", fontSize: 12, textAlign: "center" }}>Selecciona un elemento para ver su ficha contable.</div>;
}
