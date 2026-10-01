// ¿Es un momento SEGURO para recargar? Nunca con:
//  - una emisión en curso (lote, boleta/factura única) hasta que su resultado quede
//    registrado → bloqueo explícito (useBloqueoActualizacion) en useEmisionLote,
//    EmitirDirectaView y EmitirTabContent;
//  - una subida o cola de archivos sin subir → bloqueo explícito en DropzoneUpload;
//  - cualquier pedido que ESCRIBE en vuelo (POST/PUT/PATCH/DELETE, server actions)
//    → lo cuenta el envoltorio de fetch;
//  - un popup / formulario abierto → los overlays llevan data-actualizacion-espera
//    (o aria-modal="true");
//  - alguien escribiendo (campo con foco y con texto).

export const SELECTOR_ESPERA = "[data-actualizacion-espera], [aria-modal='true']";

// Una sola instancia por pestaña aunque el módulo se cargue dos veces (chunks del
// layout y de la página): si no, un bloqueo de emisión tomado en la página sería
// invisible para el actualizador del layout.
const G = globalThis as typeof globalThis & {
  __massdteBloqueos?: { bloqueos: Map<string, number>; oyentes: Set<() => void> };
  __massdteEscrituras?: { enVuelo: number; ultimaFin: number; ultimaLiberacion: number };
};
G.__massdteBloqueos ??= { bloqueos: new Map(), oyentes: new Set() };
const { bloqueos, oyentes } = G.__massdteBloqueos;
// Escrituras en vuelo (las cuenta el envoltorio de fetch del actualizador) y la
// última vez que se soltó un bloqueo: las lee también el popup de avisos urgentes
// para no tapar el resultado de una emisión (lib/avisos/espera.ts).
G.__massdteEscrituras ??= { enVuelo: 0, ultimaFin: 0, ultimaLiberacion: 0 };
const escrituras = G.__massdteEscrituras;

export function anotarEscritura(fase: "inicio" | "fin"): void {
  if (fase === "inicio") { escrituras.enVuelo++; return; }
  escrituras.enVuelo = Math.max(0, escrituras.enVuelo - 1);
  escrituras.ultimaFin = Date.now();
}
export function estadoEscrituras(): { enVuelo: number; ultimaFin: number } {
  return { enVuelo: escrituras.enVuelo, ultimaFin: escrituras.ultimaFin };
}
export function msDesdeUltimaLiberacion(): number {
  return escrituras.ultimaLiberacion ? Date.now() - escrituras.ultimaLiberacion : Infinity;
}

export function tomarBloqueo(motivo: string): () => void {
  bloqueos.set(motivo, (bloqueos.get(motivo) ?? 0) + 1);
  let suelto = false;
  return () => {
    if (suelto) return;
    suelto = true;
    const n = (bloqueos.get(motivo) ?? 1) - 1;
    if (n <= 0) bloqueos.delete(motivo); else bloqueos.set(motivo, n);
    escrituras.ultimaLiberacion = Date.now();
    for (const o of oyentes) { try { o(); } catch { /* */ } }
  };
}

export function bloqueosActivos(): string[] { return [...bloqueos.keys()]; }

export function alLiberarBloqueo(cb: () => void): () => void {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
}

type ActivoLike = { tagName?: string; type?: string; value?: unknown; isContentEditable?: boolean; textContent?: string | null } | null | undefined;
type DocLike = { querySelector(sel: string): unknown; activeElement: unknown };

const INPUT_SIN_TEXTO = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image", "hidden"]);

function escribiendo(a: ActivoLike): boolean {
  if (!a) return false;
  const tag = (a.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return String(a.value ?? "").length > 0;
  if (tag === "INPUT") return !INPUT_SIN_TEXTO.has((a.type ?? "text").toLowerCase()) && String(a.value ?? "").length > 0;
  if (a.isContentEditable) return (a.textContent ?? "").length > 0;
  return false;
}

/** Tras una escritura, margen para que su código lea la respuesta (y muestre un error). */
export const MARGEN_TRAS_ESCRITURA_MS = 1_000;

export function motivoOcupado({ bloqueos: activos, mutacionesEnVuelo, msDesdeUltimaEscritura = Infinity, doc }: { bloqueos: string[]; mutacionesEnVuelo: number; msDesdeUltimaEscritura?: number; doc: DocLike | null }): string | null {
  if (activos.length > 0) return activos[0];
  if (mutacionesEnVuelo > 0) return "pedido_en_vuelo";
  if (msDesdeUltimaEscritura < MARGEN_TRAS_ESCRITURA_MS) return "escritura_reciente";
  if (doc) {
    try { if (doc.querySelector(SELECTOR_ESPERA)) return "popup_abierto"; } catch { return "popup_abierto"; }
    if (escribiendo(doc.activeElement as ActivoLike)) return "escribiendo";
  }
  return null;
}

/** Solo tests. */
export function _reiniciarBloqueos(): void { bloqueos.clear(); oyentes.clear(); escrituras.enVuelo = 0; escrituras.ultimaFin = 0; escrituras.ultimaLiberacion = 0; }
