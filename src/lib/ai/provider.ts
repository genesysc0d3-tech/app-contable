import type { AIProvider } from "./types";
import { MistralProvider } from "./providers/mistral";
import { DeepSeekProvider } from "./providers/deepseek";
import { OpenCodeGoProvider } from "./providers/opencodego";

type ProviderName = "mistral" | "deepseek" | "opencodego";

const providers: Record<ProviderName, () => AIProvider> = {
  mistral: () => new MistralProvider(),
  deepseek: () => new DeepSeekProvider(),
  opencodego: () => new OpenCodeGoProvider(),
};

export function getAIProvider(): AIProvider {
  const name = (process.env.AI_PROVIDER || "opencodego") as ProviderName;
  const factory = providers[name];
  if (!factory) {
    throw new Error(`Proveedor IA no soportado: ${name}. Disponibles: ${Object.keys(providers).join(", ")}`);
  }
  return factory();
}
