const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHILE_TZ = "America/Santiago";

export function parseDisplayDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = DATE_ONLY_RE.test(trimmed)
    ? new Date(`${trimmed}T12:00:00`)
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatShortDateEsCl(value: string | null | undefined, includeYear = false): string {
  const date = parseDisplayDate(value);
  if (!date) return "";
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHILE_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const monthIndex = Math.max(0, Number(part("month")) - 1);
  const base = `${Number(part("day"))} ${meses[monthIndex] ?? ""}`;
  return includeYear ? `${base} ${part("year")}` : base;
}

export function formatDisplayDateEsCl(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = "Sin fecha",
): string {
  const date = parseDisplayDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("es-CL", { timeZone: CHILE_TZ, ...options }).format(date);
}

export function chileDisplayDateKey(value: string | null | undefined): string {
  const date = parseDisplayDate(value);
  if (!date) return "sin-fecha";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHILE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function chileDisplayMonthKey(value: string | null | undefined): string {
  const key = chileDisplayDateKey(value);
  return key === "sin-fecha" ? key : key.slice(0, 7);
}
