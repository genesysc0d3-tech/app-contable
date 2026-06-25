// Rechaza modelos GRATIS de OpenCode en rutas que procesan datos personales/
// tributarios. Los modelos free "may be used to improve the model" (entrenan con
// los datos); los de pago (Go) son zero-retention. Fail-closed: mejor un error
// que filtrar RUT/montos/nombres a un modelo de entrenamiento.
const KNOWN_FREE = new Set(["big-pickle"]);

export function requirePaidModel(model: string, where: string): string {
  const m = (model || "").trim().toLowerCase();
  if (!m) throw new Error(`MODELO_VACIO: falta el modelo en ${where}`);
  if (m.endsWith("-free") || KNOWN_FREE.has(m)) {
    throw new Error(
      `MODELO_GRATIS_PROHIBIDO: "${model}" en ${where} es un modelo gratuito de OpenCode ` +
        `(entrena con los datos). Usa un modelo de pago (Go), p.ej. minimax-m3 / deepseek-v4-flash.`,
    );
  }
  return model;
}
