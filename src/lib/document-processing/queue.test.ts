import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PIPELINE_VERSION,
  STALE_RUNNING_MS,
  documentJobIdempotencyKey,
  isStaleRunningJob,
  nextRetryAt,
  safeJobError,
} from "./state";

describe("document processing queue helpers", () => {
  it("builds stable idempotency keys per document and pipeline", () => {
    expect(documentJobIdempotencyKey("doc-1")).toBe(`doc-1:${DOCUMENT_PIPELINE_VERSION}`);
    expect(documentJobIdempotencyKey("doc-1", "v2")).toBe("doc-1:v2");
  });

  it("uses exponential retry backoff capped at 30 minutes", () => {
    const now = new Date("2026-06-21T12:00:00.000Z");
    expect(nextRetryAt(1, now)).toBe("2026-06-21T12:01:00.000Z");
    expect(nextRetryAt(2, now)).toBe("2026-06-21T12:02:00.000Z");
    expect(nextRetryAt(6, now)).toBe("2026-06-21T12:30:00.000Z");
  });

  it("truncates unsafe long job errors", () => {
    const value = safeJobError(new Error(`fallo ${"x".repeat(260)}`));
    expect(value.length).toBeLessThan(260);
    expect(value).toContain("[truncated:");
  });

  it("detects stale running jobs only after the threshold", () => {
    const now = new Date("2026-06-21T12:30:00.000Z");
    expect(isStaleRunningJob({ status: "queued", locked_at: new Date(now.getTime() - STALE_RUNNING_MS * 2).toISOString() }, now)).toBe(false);
    expect(isStaleRunningJob({ status: "running", locked_at: new Date(now.getTime() - STALE_RUNNING_MS + 1000).toISOString() }, now)).toBe(false);
    expect(isStaleRunningJob({ status: "running", locked_at: new Date(now.getTime() - STALE_RUNNING_MS - 1000).toISOString() }, now)).toBe(true);
  });
});
