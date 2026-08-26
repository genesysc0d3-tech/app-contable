import type { AIProvider } from "./types";
import { OpenCodeGoProvider } from "./providers/opencodego";

// IA = SOLO OpenCode Go. Mistral y DeepSeek directos se eliminaron del todo.
// OJO con el vocabulario: "aprobado" acá significa que está en NUESTRA allowlist,
// no que exista un contrato de tratamiento firmado. A la fecha no lo hay con
// ningún proveedor de IA (ver .compliance/docs/21719-evaluacion-proveedor-ia.md).
// Los modelos aprobados (deepseek-v4-flash, minimax-m3) se sirven VÍA opencodego.
// Si AI_PROVIDER apunta a otra cosa, falla fail-closed.
export function getAIProvider(): AIProvider {
  const name = process.env.AI_PROVIDER || "opencodego";
  if (name !== "opencodego") {
    throw new Error(
      `Proveedor IA no soportado: "${name}". El único proveedor aprobado es "opencodego" (Ley 21.719).`,
    );
  }
  return new OpenCodeGoProvider();
}
