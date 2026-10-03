// Globito "tu archivo está acá" (pedido fundador 2026-10-02): tras subir un archivo,
// si la clienta navega a otra fecha, un globito flotante bajo el calendario apunta al
// día donde quedó el archivo (o a la flecha del mes, si ese día no está en la tira).
// Todo se calcula en el cliente con lo que ya llega (mesa + Realtime): cero pedidos.

export type EstadoSubida = "procesando" | "lista" | "error";
export type Subida = { date: string; docIds: string[]; estado: EstadoSubida };

type DocMin = { id: string; estado?: string | null };

const EN_PROCESO = new Set(["subido", "procesando"]);

/** Docs recién subidos de ese día: los que siguen en cola o procesando. */
export function docsDeLaSubida(docs: DocMin[]): string[] {
  return docs.filter((d) => EN_PROCESO.has(d.estado ?? "")).map((d) => d.id);
}

/** Estado conjunto: alguno procesando → procesando; si no, alguno con error → error; si no, lista. */
export function estadoConjunto(estados: Array<string | null | undefined>): EstadoSubida {
  if (estados.length === 0) return "procesando";
  if (estados.some((e) => EN_PROCESO.has(e ?? ""))) return "procesando";
  if (estados.some((e) => e === "error")) return "error";
  return "lista";
}

/** Recalcula el estado con los docs que traiga una mesa (solo si la mesa los contiene). */
export function actualizarConMesa(s: Subida, docs: DocMin[]): Subida {
  if (s.docIds.length === 0) return s;
  const vistos = docs.filter((d) => s.docIds.includes(d.id));
  if (vistos.length === 0) return s;
  const estado = estadoConjunto(vistos.map((d) => d.estado));
  return estado === s.estado ? s : { ...s, estado };
}

/** ¿La mesa que se mira ya muestra el día de la subida? Entonces el globito sobra. */
export function rangoIncluye(cal: { workMode: string; selDate: string; weekRange: { start: string; end: string }; y: number; m: number }, date: string): boolean {
  if (cal.workMode === "day") return cal.selDate === date;
  if (cal.workMode === "week") return date >= cal.weekRange.start && date < cal.weekRange.end;
  const [yy, mm] = date.split("-").map(Number);
  return yy === cal.y && mm - 1 === cal.m;
}

/** Dónde apunta: al día (si la tira muestra ese mes) o a la flecha ‹ / ›. */
export function objetivoGlobito(cal: { y: number; m: number }, date: string): { tipo: "dia"; dia: number } | { tipo: "anterior" } | { tipo: "siguiente" } {
  const [yy, mm, dd] = date.split("-").map(Number);
  const idxSubida = yy * 12 + (mm - 1);
  const idxTira = cal.y * 12 + cal.m;
  if (idxSubida === idxTira) return { tipo: "dia", dia: dd };
  return idxSubida < idxTira ? { tipo: "anterior" } : { tipo: "siguiente" };
}
