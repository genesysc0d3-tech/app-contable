import type {
  AIProvider,
  AIResponse,
  AIExtractionResult,
  ClassifyOnlyResponse,
  MovimientoExtraido,
  PropuestaExtraida,
} from "../types";
import {
  buildUserPrompt,
  buildClassifyUserPrompt,
  getClassifyOnlySystemPrompt,
} from "../prompt";
import { requirePaidModel } from "../model-guard";

const BASE_URL = "https://opencode.ai/zen/go/v1";

const COST_PER_MILLION_INPUT = 0;
const COST_PER_MILLION_OUTPUT = 0;

interface OpenCodeGoMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenCodeGoResponse {
  choices: {
    message: { content: string };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model: string;
}

export class OpenCodeGoProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    const apiKey = process.env.OPENCODE_GO_API_KEY;
    if (!apiKey) throw new Error("OPENCODE_GO_API_KEY no configurada");
    this.apiKey = apiKey;
    this.model = requirePaidModel(process.env.OPENCODE_GO_MODEL || "deepseek-v4-flash", "opencodego");
  }

  private async fetchChat(
    messages: OpenCodeGoMessage[]
  ): Promise<OpenCodeGoResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `OpenCode Go API error ${res.status}: ${body.slice(0, 500)}`
        );
      }

      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async extractMovimientos(
    contenido: string,
    systemPrompt: string
  ): Promise<AIResponse> {
    const data = await this.fetchChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserPrompt(contenido) },
    ]);

    const choice = data.choices?.[0];
    const text = typeof choice?.message?.content === "string"
      ? choice.message.content
      : "";

    const result: AIExtractionResult = JSON.parse(text);

    return {
      result,
      tokens_input: data.usage?.prompt_tokens ?? 0,
      tokens_output: data.usage?.completion_tokens ?? 0,
      modelo: data.model ?? this.model,
      finish_reason: choice?.finish_reason ?? null,
      raw_response_length: text.length,
    };
  }

  async classifyMovimientos(
    movimientos: MovimientoExtraido[],
    systemPrompt?: string
  ): Promise<ClassifyOnlyResponse> {
    const classifyPrompt = systemPrompt || getClassifyOnlySystemPrompt();
    const data = await this.fetchChat([
      { role: "system", content: classifyPrompt },
      { role: "user", content: buildClassifyUserPrompt(movimientos) },
    ]);

    const choice = data.choices?.[0];
    const text = typeof choice?.message?.content === "string"
      ? choice.message.content
      : "";
    const parsed = JSON.parse(text) as { propuestas?: PropuestaExtraida[] };
    const propuestas = Array.isArray(parsed.propuestas) ? parsed.propuestas : [];

    return {
      propuestas,
      tokens_input: data.usage?.prompt_tokens ?? 0,
      tokens_output: data.usage?.completion_tokens ?? 0,
      modelo: data.model ?? this.model,
      finish_reason: choice?.finish_reason ?? null,
      raw_response_length: text.length,
    };
  }

  getCost(tokensInput: number, tokensOutput: number): number {
    return (
      (tokensInput / 1_000_000) * COST_PER_MILLION_INPUT +
      (tokensOutput / 1_000_000) * COST_PER_MILLION_OUTPUT
    );
  }
}
