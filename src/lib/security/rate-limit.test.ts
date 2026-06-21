import { describe, expect, it, beforeEach } from "vitest";
import { checkRateLimit, rateLimitKey, resetRateLimitForTests } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimitForTests());

  it("allows requests until the limit is reached", () => {
    const first = checkRateLimit({ key: "upload:user-1", limit: 2, windowMs: 60_000, now: 1000 });
    const second = checkRateLimit({ key: "upload:user-1", limit: 2, windowMs: 60_000, now: 1001 });
    const third = checkRateLimit({ key: "upload:user-1", limit: 2, windowMs: 60_000, now: 1002 });

    expect(first.ok).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.ok).toBe(true);
    expect(second.remaining).toBe(0);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBe(60);
  });

  it("opens a new bucket after the window expires", () => {
    expect(checkRateLimit({ key: "ocr:user-1", limit: 1, windowMs: 1000, now: 1000 }).ok).toBe(true);
    expect(checkRateLimit({ key: "ocr:user-1", limit: 1, windowMs: 1000, now: 1500 }).ok).toBe(false);
    expect(checkRateLimit({ key: "ocr:user-1", limit: 1, windowMs: 1000, now: 2001 }).ok).toBe(true);
  });

  it("normalizes unsafe key parts", () => {
    expect(rateLimitKey("upload", "user with spaces", "../empresa")).toBe("upload:user_with_spaces:.._empresa");
  });
});
