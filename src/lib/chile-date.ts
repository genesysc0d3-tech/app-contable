export function chileDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Offset de Chile (en horas, ej. -4 invierno / -3 verano) vigente ese día. */
function chileOffsetHoras(diaIso: string): number {
  // Referencia a mediodía del día para no caer justo en el salto de DST.
  const ref = new Date(`${diaIso}T12:00:00Z`);
  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Santiago",
      timeZoneName: "longOffset",
    })
      .formatToParts(ref)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  const m = offsetName.match(/GMT([+-])(\d{1,2})/);
  return m ? (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10) : -4;
}

/**
 * Instante UTC en que empieza (00:00) un día de Chile.
 * Acepta "YYYY-MM-DD" (día de Chile) o un Date (se toma su día en Chile).
 * El offset se deriva con Intl, así el cambio invierno/verano (-4/-3) se
 * maneja solo. Úsalo para filtrar columnas `timestamptz` (created_at) por
 * un día/mes de Chile: Postgres compara en UTC, y un "YYYY-MM-DD" pelado se
 * interpreta como medianoche UTC (corrido 3-4 h respecto a Chile).
 */
export function chileDayStartUtc(day: string | Date = new Date()): string {
  const dia = typeof day === "string" ? day : chileDateString(day);
  const offsetHoras = chileOffsetHoras(dia);
  const inicio = new Date(`${dia}T00:00:00Z`);
  inicio.setUTCHours(inicio.getUTCHours() - offsetHoras);
  return inicio.toISOString();
}

/** Suma días a un "YYYY-MM-DD" (aritmética de calendario, sin zona horaria). */
export function addDaysIso(diaIso: string, days: number): string {
  const [y, m, d] = diaIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Día del mes (1-31) de un instante, en hora de Chile. */
export function chileDayOfMonth(date: Date): number {
  return Number(chileDateString(date).slice(8, 10));
}
