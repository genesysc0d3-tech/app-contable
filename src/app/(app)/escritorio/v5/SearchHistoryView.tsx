"use client";

import { useMemo, useState } from "react";
import { TreeProvider, TreeView, TreeNode, TreeNodeContent, TreeNodeTrigger, TreeExpander, TreeIcon, TreeLabel } from "@/components/ui/tree";
import { type SearchItem, buildHistoryTree, filterItems } from "@/lib/tree-structure";
import { X, Search } from "lucide-react";

function fmt(n?: number) {
  if (n === undefined || n === null) return "";
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

const TYPE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  boleta:     { label: "Boleta",     color: "#3B82F6", bg: "rgba(59,130,246,.1)" },
  documento:  { label: "Documento",  color: "#f59e0b", bg: "rgba(245,158,11,.1)" },
  propuesta:  { label: "Propuesta",  color: "#8b5cf6", bg: "rgba(139,92,246,.1)" },
  actividad:  { label: "Actividad",  color: "#22c55e", bg: "rgba(34,197,94,.1)" },
};

export default function SearchHistoryView({ items: allItems }: { items: SearchItem[] }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => filterItems(allItems, search), [allItems, search]);
  const tree = useMemo(() => buildHistoryTree(filtered), [filtered]);
  const fileMap = useMemo(() => Object.fromEntries(filtered.map((f) => [f.id, f])), [filtered]);
  const selectedItem = selectedId ? fileMap[selectedId] : null;

  const defaultExpanded = useMemo(() => tree.map((n) => n.name), [tree]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* SEARCH BAR */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)", pointerEvents: "none" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar boletas, documentos o actividad..."
            style={{
              width: "100%", padding: "8px 10px 8px 32px", borderRadius: 8,
              border: "1px solid var(--border)", background: "var(--bg-muted)",
              color: "var(--text)", fontSize: 12, outline: "none",
            }}
          />
          {search && (
            <button onClick={() => setSearch("")}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 16, lineHeight: 1 }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* SPLIT PANEL */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* LEFT — TREE */}
        <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "auto", background: "var(--surface)" }}>
          {tree.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", fontSize: 11, color: "var(--text2)" }}>
              {search ? "Sin resultados" : "No hay actividad reciente"}
            </div>
          ) : (
            <TreeProvider
              selectable
              multiSelect={false}
              defaultExpandedIds={defaultExpanded}
              onSelectionChange={(ids) => {
                if (ids[0]) setSelectedId(ids[0]);
              }}
            >
              <TreeView>
                <RenderTree nodes={tree} />
              </TreeView>
            </TreeProvider>
          )}
        </div>

        {/* RIGHT — DETAIL */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "20px 24px", background: "var(--surface)" }}>
          {selectedItem ? (
            <ItemDetail item={selectedItem} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text2)", fontSize: 12 }}>
              <div style={{ textAlign: "center" }}>
                <Search size={28} style={{ margin: "0 auto 8px", opacity: .3 }} />
                Seleccioná un elemento del historial para ver su detalle
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FILTER CHIPS */}
      <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 6, background: "var(--surface)" }}>
        {(["todo", "boleta", "documento", "propuesta", "actividad"] as const).map((type) => {
          const active = type === "todo" ? !search : search === type;
          const info = TYPE_MAP[type];
          return (
            <button
              key={type}
              onClick={() => setSearch(type === "todo" ? "" : type)}
              style={{
                padding: "5px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer",
                border: active ? "1px solid var(--border)" : "1px solid transparent",
                background: active ? "var(--bg-muted)" : "transparent",
                color: active ? "var(--text)" : "var(--text2)",
                transition: "all .15s",
              }}
            >
              {type === "todo" ? "Todo" : info?.label ?? type}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RenderTree({ nodes, level = 0 }: { nodes: import("@/lib/tree-structure").TreeNodeData[]; level?: number }) {
  return (
    <>
      {nodes.map((node, i) => {
        const isLast = i === nodes.length - 1;

        if (node.type === "folder") {
          const badge = node.children.length;
          return (
            <TreeNode key={node.name} nodeId={node.name} level={level} isLast={isLast} isFolder>
              <TreeNodeTrigger>
                <TreeExpander hasChildren />
                <TreeIcon ext="folder" />
                <TreeLabel>{node.name}</TreeLabel>
                <span style={{ fontSize: 10, color: "var(--text3)", marginLeft: 4, fontWeight: 500 }}>{badge}</span>
              </TreeNodeTrigger>
              <TreeNodeContent hasChildren>
                <RenderTree nodes={node.children} level={level + 1} />
              </TreeNodeContent>
            </TreeNode>
          );
        }

        const item = node;
        return (
          <TreeNode key={item.id} nodeId={item.id} level={level} isLast={isLast}>
            <TreeNodeTrigger>
              <TreeExpander />
              <TreeIcon ext={item.ext} />
              <TreeLabel>{item.name}</TreeLabel>
            </TreeNodeTrigger>
          </TreeNode>
        );
      })}
    </>
  );
}

function fmtFull(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

const TIPO_BADGE: Record<number, { label: string; color: string; bg: string }> = {
  39: { label: "AFE", color: "#E8553E", bg: "rgba(232,85,62,.1)" },
  41: { label: "EXE", color: "#3B82F6", bg: "rgba(59,130,246,.1)" },
  61: { label: "NC", color: "#7C3AED", bg: "rgba(124,58,237,.1)" },
};

const ESTADO_META: Record<string, { label: string; color: string }> = {
  activo: { label: "Activo", color: "#22c55e" },
  emitido: { label: "Emitido", color: "#22c55e" },
  anulada: { label: "Anulada", color: "#ef4444" },
  subido: { label: "Pendiente", color: "#f59e0b" },
  procesando: { label: "Procesando", color: "#5b9cf6" },
  procesado: { label: "Procesado", color: "#22c55e" },
  error: { label: "Error", color: "#ef4444" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11 }}>
      <span style={{ color: "var(--text2)", minWidth: 100, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 500 }}>{children}</span>
    </div>
  );
}

function ItemDetail({ item }: { item: SearchItem }) {
  const info = TYPE_MAP[item.type] ?? { label: item.type, color: "var(--text)", bg: "var(--bg-muted)" };
  const d = item.data ?? {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: info.bg, color: info.color }}>
          {info.label}
        </span>
        {item.type === "boleta" && (
          <span style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 4, fontWeight: 700,
            background: (TIPO_BADGE[(d as any).tipo_dte]?.bg ?? info.bg),
            color: (TIPO_BADGE[(d as any).tipo_dte]?.color ?? info.color),
          }}>
            {TIPO_BADGE[(d as any).tipo_dte]?.label ?? `DTE ${(d as any).tipo_dte}`}
          </span>
        )}
        {(d as any).estado && ESTADO_META[(d as any).estado] && (
          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, fontWeight: 600, background: ESTADO_META[(d as any).estado].color + "15", color: ESTADO_META[(d as any).estado].color }}>
            {(d as any).estado}
          </span>
        )}
        <span style={{ fontSize: 10, color: "var(--text2)", marginLeft: "auto" }}>{item.fecha?.slice(0, 10)}</span>
      </div>

      {/* TITLE */}
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-.02em" }}>{item.label}</h2>

      {/* DETAIL FIELDS */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px", borderRadius: 10, background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
        {item.type === "boleta" && (() => {
          const b = d as any;
          return (<>
            <Row label="Folio"><span style={{ fontWeight: 700 }}>#{b.folio}</span></Row>
            <Row label="Receptor">{b.receptor_razon_social ?? "—"}</Row>
            <Row label="RUT receptor">{b.receptor_rut ?? "—"}</Row>
            <Row label="Total">{fmtFull(b.monto_total)}</Row>
            <Row label="Neto">{fmtFull(b.monto_neto ?? b.monto_total)}</Row>
            <Row label="IVA">{fmtFull(b.iva)}</Row>
            <Row label="Exento">{fmtFull(b.monto_exento)}</Row>
          </>);
        })()}
        {item.type === "documento" && (() => {
          const doc = d as any;
          const progreso = doc.progreso_ia as any ?? {};
          return (<>
            <Row label="Archivo">{doc.nombre_archivo}</Row>
            <Row label="Tipo">{doc.tipo ?? "—"}</Row>
            <Row label="Movimientos">{doc.movimientos_detectados ?? 0}</Row>
            {progreso.movimientos_encontrados != null && <Row label="Encontrados">{progreso.movimientos_encontrados}</Row>}
            {progreso.duplicados_saltados > 0 && <Row label="Duplicados omitidos">{progreso.duplicados_saltados}</Row>}
          </>);
        })()}
        {item.type === "propuesta" && (() => {
          const p = d as any;
          const mov = p.movimientos_raw ?? {};
          return (<>
            <Row label="Descripción">{mov.descripcion ?? "—"}</Row>
            <Row label="Monto">{fmtFull(mov.monto)}</Row>
            <Row label="Tipo flujo">{mov.tipo_flujo === "entrada" ? "Ingreso" : mov.tipo_flujo === "salida" ? "Gasto" : "—"}</Row>
            <Row label="Fecha movimiento">{mov.fecha ? (mov.fecha as string).slice(0, 10) : "—"}</Row>
            <Row label="Confianza">{Math.round((p.confianza ?? 0) * 100)}%</Row>
            <Row label="N° documento">{mov.n_documento ?? "—"}</Row>
          </>);
        })()}
      </div>
    </div>
  );
}
