import type { AIProvider } from "./types";
import { MistralProvider } from "./providers/mistral";

type ProviderName = "mistral";

const providers: Record<ProviderName, () => AIProvider> = {
  mistral: () => new MistralProvider(),
};

export function getAIProvider(): AIProvider {
  const name = (process.env.AI_PROVIDER || "mistral") as ProviderName;
  const factory = providers[name];
  if (!factory) {
    throw new Error(`Proveedor IA no soportado: ${name}. Disponibles: ${Object.keys(providers).join(", ")}`);
  }
  return factory();
}
