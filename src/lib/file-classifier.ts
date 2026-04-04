/**
 * Classifies files into processing categories:
 * - grande: >500KB Excel/CSV, processes independently
 * - chico: small Excel/CSV/PDF, can be grouped
 * - imagen: images, always grouped, OCR first
 */

export type FileCategory = "grande" | "chico" | "imagen";

const SIZE_THRESHOLD = 500 * 1024; // 500KB

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const SPREADSHEET_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

export function classifyFile(file: File): FileCategory {
  if (IMAGE_TYPES.has(file.type)) return "imagen";
  if (SPREADSHEET_TYPES.has(file.type) && file.size > SIZE_THRESHOLD) return "grande";
  return "chico";
}

export function getCategoryLabel(cat: FileCategory): string {
  switch (cat) {
    case "grande": return "Documento grande";
    case "chico": return "Documento";
    case "imagen": return "Imagen";
  }
}

export function getCategoryColor(cat: FileCategory): string {
  switch (cat) {
    case "grande": return "text-[#E8553E]";
    case "chico": return "text-[#F59E0B]";
    case "imagen": return "text-[#22C55E]";
  }
}

export const BADGE_COLORS: Record<number, string> = {
  1: "bg-[#E8553E]",
  2: "bg-[#3B82F6]",
  3: "bg-[#22C55E]",
  4: "bg-[#7C3AED]",
  5: "bg-[#F59E0B]",
};
