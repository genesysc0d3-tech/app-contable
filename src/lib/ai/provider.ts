import type { AIProvider } from "./types";
import { OpenCodeGoProvider } from "./providers/opencodego";
import { FireworksProvider } from "./providers/fireworks";

// Proveedores de IA de texto. "aprobado" = está en NUESTRA allowlist de egress
// (egress.ts). opencodego: sin DPA (vale hasta el 2026-12-01, ver
// .compliance/docs/21719-evaluacion-proveedor-ia.md). fireworks: con DPA público
// (fireworks.ai/dpa) — el reemplazo. Cualquier otro valor falla fail-closed.
export function getAIProvider(): AIProvider {
  const name = process.env.AI_PROVIDER || "opencodego";
  if (name === "fireworks") return new FireworksProvider();
  if (name !== "opencodego") {
    throw new Error(
      `Proveedor IA no soportado: "${name}". Aprobados: "opencodego", "fireworks" (Ley 21.719).`,
    );
  }
  return new OpenCodeGoProvider();
}
