import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Canal de entrada de la llamada a la IA ("app" o "telegram"). Viaja implícito
 * por toda la cadena async (webhook → OCR → procesarDocumento → proveedor) sin
 * tener que pasarlo por cada firma. Sirve para que Fireworks use una API key
 * DISTINTA por canal y el gasto se vea separado en su consola (2026-09-26).
 * Fuera de un `conCanalIA` el canal es "app".
 */
export type CanalIA = "app" | "telegram";

const almacen = new AsyncLocalStorage<CanalIA>();

export function conCanalIA<T>(canal: CanalIA, fn: () => Promise<T>): Promise<T> {
  return almacen.run(canal, fn);
}

export function canalIAActual(): CanalIA {
  return almacen.getStore() ?? "app";
}
