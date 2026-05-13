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

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

const COST_PER_MILLION_INPUT = 0.27;
const COST_PER_MILLION_OUTPUT = 1.10;

interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekResponse {
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

export class DeepSeekProvider implements AIProvider {
  private apiKey: string | null = null;
  private resolved = false;
  private model: string;

  constructor() {
    const envKey = process.env.DEEPSEEK_API_KEY;
    if (envKey) {
      this.apiKey = envKey;
      this.resolved = true;
    }
    this.model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }

  private async ensureApiKey(): Promise<string> {
    if (this.resolved && this.apiKey) return this.apiKey;

    // Try reading from app_config table
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceKey) {
      try {
        const res = await fetch(
          `${url}/rest/v1/app_config?name=eq.ai_api_key&select=value`,
          {
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
            cache: "no-store",
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0 && data[0].value) {
            this.apiKey = data[0].value;
            this.resolved = true;
            return this.apiKey!;
          }
        }
      } catch {
        // fall through to error
      }
    }

    throw new Error(
      "DEEPSEEK_API_KEY no configurada. Configúrala desde /empresa o define la variable de entorno."
    );
  }

  private async fetchChat(
    messages: DeepSeekMessage[]
  ): Promise<DeepSeekResponse> {
    const key = await this.ensureApiKey();

    const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `DeepSeek API error ${res.status}: ${body.slice(0, 500)}`
      );
    }

    return res.json();
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
