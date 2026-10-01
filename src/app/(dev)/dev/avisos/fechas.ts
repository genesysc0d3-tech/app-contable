// Fechas del formulario de avisos en hora de Chile (America/Santiago), sin
// depender de la zona del navegador ni del server: SSR y cliente pintan lo mismo.
const TZ = "America/Santiago";
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function partes(ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of FMT.formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** Minutos que Chile va respecto de UTC en ese instante (−180 / −240). */
function offsetMin(ms: number): number {
  const p = partes(ms);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

const dos = (n: number) => String(n).padStart(2, "0");

/** ISO → "YYYY-MM-DDTHH:mm" en hora de Chile (para <input type="datetime-local">). */
export function isoAHoraChile(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const p = partes(ms);
  return `${p.year}-${dos(p.month)}-${dos(p.day)}T${dos(p.hour)}:${dos(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" (hora de Chile) → ISO UTC. */
export function horaChileAIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return "";
  const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ms = comoUtc - offsetMin(comoUtc) * 60_000;
  ms = comoUtc - offsetMin(ms) * 60_000; // afina en el borde del cambio de hora
  return new Date(ms).toISOString();
}
