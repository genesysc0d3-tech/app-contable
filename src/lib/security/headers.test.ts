import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("security headers", () => {
  it("keeps the baseline hardening headers configured", async () => {
    const entries = await nextConfig.headers?.();
    const headers = new Map(entries?.flatMap((entry) => entry.headers.map((header) => [header.key, header.value])) ?? []);

    expect(headers.get("Strict-Transport-Security")).toContain("includeSubDomains");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
  });
});
