import { OpenCodeGoProvider } from "./opencodego";
import { requirePaidModel } from "../model-guard";
import { canalIAActual } from "../canal";

/**
 * Fireworks AI (2026-09-26) — reemplazo de OpenCode Go antes del 1-dic (21.719).
 *
 * Por qué Fireworks: DPA público que se incorpora a los términos (fireworks.ai/dpa:
 * 4.3(f) no entrena con nuestros datos, 4.5 sin retención), retención cero por
 * defecto para modelos abiertos y cláusulas contractuales estándar (art. 27 b
 * de la 19.628 reformada). Misma vara que Vercel/Supabase.
 *
 * Modelo: DeepSeek V4.1 Flash (serverless, US$0,22/M entrada · US$0,66/M salida).
 * En el banco de la mini (flujo atomizado, sin razonamiento): J1 18/18, J4 17/19,
 * cartola larga 60/60, ~8 s por trozo — igual que Gemma y el techo del banco.
 *
 * reasoning_effort "low" por defecto. Medido con los prompts REALES de
 * producción (un solo prompt de extracción) sobre 37 docs sintéticos del banco:
 *   none → montos/dirección 44/44, categoría 38/44, US$0,028 · cae en inyección
 *          en fila, JSON roto y "borra esta fila".
 *   low  → montos/dirección 44/44, categoría 41/44, US$0,037 · los resiste.
 * Los 3 que falla aun en low: el PAGADOR afirma "es devolución/préstamo/traspaso
 * propio" y el modelo le cree (no_comercial). El flujo atomizado de la mini los
 * manda a revisión humana; este flujo todavía no (mismo comportamiento que hoy).
 */
export const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

/** Key según el canal (prod-app / prod-telegram) y modelo pagado de Fireworks. */
export function credencialesFireworks(): { apiKey: string; model: string } {
  // Una key por canal → el gasto de cada uno se ve separado en Fireworks. Si
  // falta la de Telegram, usa la de la app.
  const apiKey =
    (canalIAActual() === "telegram" ? process.env.FIREWORKS_API_KEY_TELEGRAM : undefined) ||
    process.env.FIREWORKS_API_KEY;
  if (!apiKey) throw new Error("FIREWORKS_API_KEY no configurada");
  const model = requirePaidModel(
    process.env.FIREWORKS_MODEL || "accounts/fireworks/models/deepseek-v4p1-flash",
    "fireworks",
  );
  return { apiKey, model };
}

export class FireworksProvider extends OpenCodeGoProvider {
  constructor() {
    const { apiKey, model } = credencialesFireworks();
    super({
      proveedor: "fireworks",
      baseUrl: FIREWORKS_BASE_URL,
      apiKey,
      model,
      costoInputPorMillon: 0.22,
      costoOutputPorMillon: 0.66,
      extraBody: { reasoning_effort: process.env.FIREWORKS_REASONING || "low" },
    });
  }
}
