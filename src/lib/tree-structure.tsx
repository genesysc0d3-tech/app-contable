import { FileText, type LucideIcon } from "lucide-react";

export type TreeNodeData =
  | { type: "folder"; name: string; children: TreeNodeData[] }
  | { type: "file"; id: string; name: string; ext?: string };

export type SearchItem = {
  id: string;
  label: string;
  subtitle: string;
  type: "boleta" | "documento" | "propuesta" | "actividad";
  fecha: string;
  monto?: number;
  badge?: { label: string; color: string };
  data?: Record<string, unknown>;
};

export function buildHistoryTree(items: SearchItem[]): TreeNodeData[] {
  const groups: Record<string, SearchItem[]> = {};

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const item of items) {
    const d = new Date(item.fecha);
    const key =
      d.toDateString() === today.toDateString()
        ? "Hoy"
        : d.toDateString() === yesterday.toDateString()
          ? "Ayer"
          : d > new Date(today.getTime() - 7 * 86400000)
            ? "Esta semana"
            : d.getMonth() === today.getMonth()
              ? "Este mes"
              : "Anterior";

    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  const order = ["Hoy", "Ayer", "Esta semana", "Este mes", "Anterior"];

  return order
    .filter((k) => groups[k])
    .map((key) => ({
      type: "folder" as const,
      name: key,
      children: groups[key].map((item) => ({
        type: "file" as const,
        id: item.id,
        name: item.label,
        ext: item.type,
      })),
    }));
}

export function filterItems(items: SearchItem[], query: string): SearchItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return items;
  return items.filter(
    (i) =>
      i.label.toLowerCase().includes(q) ||
      i.subtitle.toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q)
  );
}

export const TYPE_ICONS: Record<string, LucideIcon> = {
  boleta: FileText,
  documento: FileText,
  propuesta: FileText,
  actividad: FileText,
};
