import { describe, expect, it } from "vitest";
import { enforceRateLimitGlobal, type RateLimitRpcClient } from "./rate-limit-global";

// Protege el limiter GLOBAL (#6b): decide con el bucket compartido de
// Postgres, y si la base no responde cae al limiter local en vez de abrirse
// del todo. Si alguien invierte el fallback (deja pasar sin contar), muerde.

function rpcCon(allowed: boolean, retry = 30): RateLimitRpcClient {
  return { rpc: async () => ({ data: [{ allowed, retry_after_seconds: retry }], error: null }) };
}

function rpcQueFalla(): RateLimitRpcClient {
  return { rpc: async () => ({ data: null, error: { message: "boom" } }) };
}

describe("enforceRateLimitGlobal", () => {
  it("permitido por el bucket global → pasa (null)", async () => {
    const res = await enforceRateLimitGlobal({ key: "t:ok", limit: 5, windowMs: 60_000 }, rpcCon(true));
    expect(res).toBeNull();
  });

  it("bloqueado por el bucket global → 429 con Retry-After", async () => {
    const res = await enforceRateLimitGlobal({ key: "t:no", limit: 5, windowMs: 60_000 }, rpcCon(false, 42));
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("42");
  });

  it("si la RPC falla, cae al limiter LOCAL — y el local sigue mordiendo", async () => {
    const key = `t:fallback:${Date.now()}`;
    // 2 permitidas por el local, la 3ª bloqueada: el fallback cuenta de verdad.
    expect(await enforceRateLimitGlobal({ key, limit: 2, windowMs: 60_000 }, rpcQueFalla())).toBeNull();
    expect(await enforceRateLimitGlobal({ key, limit: 2, windowMs: 60_000 }, rpcQueFalla())).toBeNull();
    const tercera = await enforceRateLimitGlobal({ key, limit: 2, windowMs: 60_000 }, rpcQueFalla());
    expect(tercera?.status).toBe(429);
  });

  it("sin cliente (env ausente) también cae al local", async () => {
    const key = `t:sincliente:${Date.now()}`;
    expect(await enforceRateLimitGlobal({ key, limit: 1, windowMs: 60_000 }, null)).toBeNull();
    const segunda = await enforceRateLimitGlobal({ key, limit: 1, windowMs: 60_000 }, null);
    expect(segunda?.status).toBe(429);
  });
});
