import { Mistral } from "@mistralai/mistralai";
import type { AIProvider, AIResponse, AIExtractionResult } from "../types";
import { buildUserPrompt } from "../prompt";

const COST_PER_MILLION_INPUT = 0.2;
const COST_PER_MILLION_OUTPUT = 0.6;

export class MistralProvider implements AIProvider {
  private client: Mistral;
  private model: string;

  constructor() {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY no configurada");
    this.client = new Mistral({ apiKey });
    this.model = process.env.MISTRAL_MODEL || "mistral-small-latest";
  }

  async extractMovimientos(
    contenido: string,
    systemPrompt: string
  ): Promise<AIResponse> {
    const response = await this.client.chat.complete({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildUserPrompt(contenido) },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.1,
    });

    const choice = response.choices?.[0];
    const text = typeof choice?.message?.content === "string"
      ? choice.message.content
      : "";

    const result: AIExtractionResult = JSON.parse(text);

    const tokensInput = response.usage?.promptTokens ?? 0;
    const tokensOutput = response.usage?.completionTokens ?? 0;

    return {
      result,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      modelo: this.model,
      finish_reason: (choice?.finishReason as string | undefined) ?? null,
      raw_response_length: text.length,
    };
  }
}

export function calcularCosto(tokensInput: number, tokensOutput: number): number {
  return (
    (tokensInput / 1_000_000) * COST_PER_MILLION_INPUT +
    (tokensOutput / 1_000_000) * COST_PER_MILLION_OUTPUT
  );
}
