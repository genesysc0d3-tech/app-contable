/**
 * SOLO OPENCODE (DeepSeek) en scripts de prueba/benchmark — 2026-09-30.
 *
 * El .env.local del repo trae AI_PROVIDER=fireworks y FIREWORKS_API_KEY. En una
 * rama de prueba NADA puede llamar a Fireworks. Este helper, llamado al inicio
 * de cualquier script de comparación:
 *   1. fuerza process.env.AI_PROVIDER = "opencodego" (solo en la MEMORIA del
 *      proceso: jamás edita .env.local ni ningún archivo de configuración);
 *   2. borra FIREWORKS_API_KEY y FIREWORKS_API_KEY_TELEGRAM del proceso;
 *   3. envuelve globalThis.fetch: una llamada a fireworks.ai NO aborta la
 *      corrida — se REPARA redirigiéndola a OpenCode Go (misma API OpenAI:
 *      https://opencode.ai/zen/go/v1/chat/completions, OPENCODE_GO_API_KEY,
 *      modelo deepseek-v4-flash en vez de accounts/fireworks/models/*,
 *      x-opencode-session + User-Agent) y se CUENTA para el reporte final;
 *   4. bloquea cualquier otro host que no sea opencode.ai (Supabase, Vercel…):
 *      una prueba no toca producción;
 *   5. imprime "proveedor: opencodego (fireworks bloqueado)".
 *
 * Uso:
 *   import { soloOpenCode, reporteSoloOpenCode } from "./lib/solo-opencode";
 *   soloOpenCode();                 // primera línea del script
 *   ...
 *   console.log(reporteSoloOpenCode()); // "N llamadas a Fireworks redirigidas a OpenCode"
 */
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";

export const OPENCODE_GO_CHAT_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export const MODELO_OPENCODE = "deepseek-v4-flash";

let redirigidas = 0;
let bloqueadas = 0;
let instalado = false;

/** Lee SOLO las claves OPENCODE_GO_* de un .env (sin modificarlo) si no están ya en el proceso. */
function cargarOpenCodeDesdeArchivo(): void {
  const candidatos = [process.env.ENV_FILE, ".env.local", "../../../.env.local"].filter((x): x is string => !!x);
  for (const ruta of candidatos) {
    if (!existsSync(ruta)) continue;
    for (const linea of readFileSync(ruta, "utf8").split("\n")) {
      const m = linea.match(/^\s*(OPENCODE_GO_[A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
    if (process.env.OPENCODE_GO_API_KEY) return;
  }
}

function urlDe(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && "url" in input) return String((input as { url: string }).url);
  return String(input);
}

export function soloOpenCode(opts: { permitirHosts?: string[]; silencioso?: boolean } = {}): void {
  process.env.AI_PROVIDER = "opencodego";
  delete process.env.FIREWORKS_API_KEY;
  delete process.env.FIREWORKS_API_KEY_TELEGRAM;
  // Nada de producción desde una prueba: sin credenciales de Supabase en el proceso.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cargarOpenCodeDesdeArchivo();
  if (!instalado) {
    instalado = true;
    const permitidos = ["opencode.ai", ...(opts.permitirHosts ?? [])];
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlDe(input);
      if (/fireworks\.ai/i.test(url)) {
        redirigidas++;
        let body = init?.body;
        if (typeof body === "string") {
          try {
            const j = JSON.parse(body) as Record<string, unknown>;
            if (typeof j.model !== "string" || /fireworks|accounts\//i.test(j.model)) j.model = MODELO_OPENCODE;
            body = JSON.stringify(j);
          } catch { /* cuerpo no JSON: va tal cual */ }
        }
        const headers = new Headers(init?.headers ?? {});
        headers.set("Authorization", `Bearer ${process.env.OPENCODE_GO_API_KEY ?? ""}`);
        if (!headers.has("x-opencode-session")) headers.set("x-opencode-session", randomUUID());
        headers.set("User-Agent", "massdte-prueba/1.0");
        headers.set("Content-Type", "application/json");
        console.error(`[solo-opencode] llamada a Fireworks REDIRIGIDA a OpenCode (#${redirigidas}): ${url}`);
        return original(OPENCODE_GO_CHAT_URL, { ...init, headers, body });
      }
      const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
      if (!permitidos.some((h) => host === h || host.endsWith(`.${h}`))) {
        bloqueadas++;
        throw new Error(`PROHIBIDO en prueba: red fuera de OpenCode (${host || url})`);
      }
      return original(input as RequestInfo, init);
    }) as typeof fetch;
  }
  if (!opts.silencioso) console.log("proveedor: opencodego (fireworks bloqueado)");
}

export function reporteSoloOpenCode(): string {
  return `${redirigidas} llamadas a Fireworks redirigidas a OpenCode · ${bloqueadas} llamadas a otros hosts bloqueadas`;
}
