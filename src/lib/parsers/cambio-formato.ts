/**
 * CAMBIO DE FORMATO de un banco ya conocido (2026-09-30). Cuando la huella de
 * una cartola no calza con ningún mapa, pero sus títulos se PARECEN a los de un
 * mapa CONFIRMADO de la empresa, el banco cambió algo. En vez de re-adivinar en
 * silencio, se dice qué: "esperaba encabezado X, llegó Y" (como Fineco en
 * ofxstatement: expected / current, docs/investigacion-lectores-multibanco §2.1).
 */

function limpio(t: string[]): string[] {
  return t.map((x) => String(x ?? "").trim()).filter((x) => x && x !== "#");
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

/**
 * Mensaje de cambio si `llegado` se parece (≥50% de títulos en común) a alguno
 * de los encabezados `conocidos` sin ser igual. null si es idéntico a uno o no
 * se parece a ninguno (formato de verdad nuevo).
 */
export function cambioDeEncabezado(conocidos: string[][], llegado: string[]): string | null {
  const l = limpio(llegado);
  if (!l.length) return null;
  let mejor: { t: string[]; sim: number } | null = null;
  for (const c of conocidos) {
    const t = limpio(c);
    if (!t.length) continue;
    if (t.join("|") === l.join("|")) return null;
    const sim = jaccard(t, l);
    if (sim >= 0.5 && (!mejor || sim > mejor.sim)) mejor = { t, sim };
  }
  if (!mejor) return null;
  const esperado = mejor.t;
  const faltan = esperado.filter((x) => !l.includes(x));
  const nuevos = l.filter((x) => !esperado.includes(x));
  const partes: string[] = [];
  if (faltan.length) partes.push(`ya no viene ${faltan.map((x) => `«${x}»`).join(", ")}`);
  if (nuevos.length) partes.push(`viene nuevo ${nuevos.map((x) => `«${x}»`).join(", ")}`);
  if (!partes.length) partes.push("las columnas cambiaron de orden");
  return `Tu banco cambió el formato: esperaba encabezado «${esperado.join(" | ")}» y llegó «${l.join(" | ")}» (${partes.join("; ")})`;
}
