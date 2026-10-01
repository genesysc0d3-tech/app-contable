// Anti-bucle de la actualización invisible: si el server alterna versiones durante
// el rollout (instancias viejas y nuevas a la vez) o un cache sirve el HTML viejo,
// la pestaña NO puede quedar recargando en loop.
//  - UNA recarga automática por versión; una 2.ª solo tras el enfriamiento (la 1.ª
//    cayó en HTML viejo, o rollback y re-promoción). Nunca una 3.ª (por pestaña).
//  - Tras una recarga, 10 min sin reintentar aunque la versión siga distinta.

export type RegistroRecargas = { intentos: Array<{ version: string; at: number }> };
export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export const CLAVE_RECARGAS = "massdte:actualizacion:recargas";
export const ESPERA_TRAS_RECARGA_MS = 10 * 60_000;
const MAX_INTENTOS = 8;
const MAX_POR_VERSION = 2;

export function decidirRecarga(reg: RegistroRecargas, version: string, ahora: number): { ok: true } | { ok: false; motivo: "ya_intentada" | "enfriando" } {
  if (reg.intentos.filter((i) => i.version === version).length >= MAX_POR_VERSION) return { ok: false, motivo: "ya_intentada" };
  const ultimo = reg.intentos.reduce((m, i) => Math.max(m, i.at), -Infinity);
  if (ahora - ultimo < ESPERA_TRAS_RECARGA_MS) return { ok: false, motivo: "enfriando" };
  return { ok: true };
}

export function anotarRecarga(reg: RegistroRecargas, version: string, ahora: number): RegistroRecargas {
  return { intentos: [...reg.intentos, { version, at: ahora }].slice(-MAX_INTENTOS) };
}

export function leerRegistro(s: StorageLike): RegistroRecargas {
  try {
    const raw = s.getItem(CLAVE_RECARGAS);
    if (!raw) return { intentos: [] };
    const p = JSON.parse(raw) as RegistroRecargas;
    if (!p || !Array.isArray(p.intentos)) return { intentos: [] };
    return { intentos: p.intentos.filter((i) => i && typeof i.version === "string" && typeof i.at === "number") };
  } catch {
    return { intentos: [] };
  }
}

export function guardarRegistro(s: StorageLike, reg: RegistroRecargas): void {
  try { s.setItem(CLAVE_RECARGAS, JSON.stringify(reg)); } catch { /* sin storage: el actualizador no recarga */ }
}
