"use client";

/**
 * Modo apuntar (fundador 2026-09-06): lo apuntable se marca en la UI con
 * `data-apuntable="documento|tx|boleta"` + `data-apuntable-id` +
 * `data-apuntable-label` (+ `data-apuntable-doc` en las tx, `data-apuntable-mes`
 * si el objeto vive en otro mes). Este módulo es la plomería compartida: leer
 * un objeto desde el elemento tocado, y resaltar un elemento cuando el otro
 * salta a él.
 */
export type ApuntableTipo = "documento" | "tx" | "boleta";
export type ObjetoApuntado = { tipo: ApuntableTipo; id: string; label: string; docId: string | null; mes: string | null };

export function objetoDesdeElemento(el: Element | null): ObjetoApuntado | null {
  const target = el?.closest?.("[data-apuntable]") as HTMLElement | null;
  if (!target) return null;
  const tipo = target.dataset.apuntable as ApuntableTipo | undefined;
  const id = target.dataset.apuntableId;
  if (!tipo || !id || !["documento", "tx", "boleta"].includes(tipo)) return null;
  return {
    tipo,
    id,
    label: (target.dataset.apuntableLabel ?? "").trim().slice(0, 120) || (tipo === "tx" ? "Movimiento" : tipo === "boleta" ? "Boleta" : "Documento"),
    docId: target.dataset.apuntableDoc || null,
    mes: target.dataset.apuntableMes || null,
  };
}

/** Lo que el receptor debe resaltar cuando aparezca (sobrevive al cambio de pestaña/mes). */
export const pendingResaltar: { ref: { tipo: ApuntableTipo; id: string; docId: string | null } | null } = { ref: null };

/** Halo de 2,5 s sobre el elemento apuntado, si está en pantalla. Devuelve si lo encontró. */
export function resaltarElemento(id: string): boolean {
  const el = document.querySelector(`[data-apuntable-id="${CSS.escape(id)}"]`) as HTMLElement | null;
  if (!el) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("ap-halo");
  window.setTimeout(() => el.classList.remove("ap-halo"), 2600);
  return true;
}

/** Mes de calendario (0-indexed, como usa la mesa) desde una fecha ISO. */
export function mesDeFecha(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[1]}-${Number(m[2]) - 1}` : null;
}
