import { NextResponse } from "next/server";

type Bucket = {
  count: number;
  resetAt: number;
};

type Store = Map<string, Bucket>;

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  __massdteRateLimitStore?: Store;
};

const store = globalForRateLimit.__massdteRateLimitStore ?? new Map<string, Bucket>();
globalForRateLimit.__massdteRateLimitStore = store;

function cleanupExpired(now: number) {
  if (store.size < 5000) return;
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

function sanitizeKeyPart(part: unknown) {
  return String(part ?? "anon")
    .trim()
    .replace(/[^a-z0-9_.:@-]+/gi, "_")
    .slice(0, 96) || "anon";
}

export function rateLimitKey(...parts: unknown[]) {
  return parts.map(sanitizeKeyPart).join(":").slice(0, 240);
}

export function clientIpFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded
    || request.headers.get("x-real-ip")
    || request.headers.get("cf-connecting-ip")
    || "unknown-ip";
}

export function checkRateLimit({ key, limit, windowMs, now = Date.now() }: RateLimitOptions): RateLimitResult {
  cleanupExpired(now);
  const normalizedKey = rateLimitKey(key);
  const current = store.get(normalizedKey);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(normalizedKey, { count: 1, resetAt });
    return { ok: true, limit, remaining: Math.max(0, limit - 1), resetAt, retryAfterSeconds: 0 };
  }

  if (current.count >= limit) {
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return {
    ok: true,
    limit,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
    retryAfterSeconds: 0,
  };
}

export function rateLimitResponse(result: RateLimitResult) {
  return NextResponse.json(
    { ok: false, error: "RATE_LIMITED", retry_after_seconds: result.retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}

export function enforceRateLimit(options: RateLimitOptions) {
  const result = checkRateLimit(options);
  return result.ok ? null : rateLimitResponse(result);
}

export function resetRateLimitForTests() {
  store.clear();
}
