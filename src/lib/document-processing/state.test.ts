import { describe, expect, it } from "vitest";
import {
  documentJobIdempotencyKey,
  safeJobError,
  nextRetryAt,
  isStaleRunningJob,
  STALE_RUNNING_MS,
} from "./state";

describe("documentJobIdempotencyKey", () => {
  it("combina documento + versión de pipeline", () => {
    expect(documentJobIdempotencyKey("doc1")).toBe("doc1:document-processing:v1");
    expect(documentJobIdempotencyKey("doc1", "v2")).toBe("doc1:v2");
  });
});

describe("safeJobError", () => {
  it("extrae el message de un Error y normaliza espacios", () => {
    expect(safeJobError(new Error("boom"))).toBe("boom");
    expect(safeJobError(new Error("multi   linea\n\ttab"))).toBe("multi linea tab");
  });
  it("convierte no-Error a string", () => {
    expect(safeJobError("texto")).toBe("texto");
    expect(safeJobError(42)).toBe("42");
  });
  it("trunca mensajes largos (>220) con sufijo de largo original", () => {
    const r = safeJobError(new Error("a".repeat(300)));
    expect(r.startsWith("a".repeat(220))).toBe(true);
    expect(r).toContain("[truncated:300]");
    expect(r.length).toBeLessThan(300);
  });
});

describe("nextRetryAt (backoff exponencial, tope 30 min)", () => {
  const now = new Date("2026-06-08T12:00:00.000Z");
  const minAfter = (iso: string) => (new Date(iso).getTime() - now.getTime()) / 60000;

  it("crece 1, 2, 4 min por intento", () => {
    expect(minAfter(nextRetryAt(1, now))).toBe(1);
    expect(minAfter(nextRetryAt(2, now))).toBe(2);
    expect(minAfter(nextRetryAt(3, now))).toBe(4);
  });
  it("trata attempts < 1 como 1", () => {
    expect(minAfter(nextRetryAt(0, now))).toBe(1);
  });
  it("topa en 30 min para intentos altos", () => {
    expect(minAfter(nextRetryAt(20, now))).toBe(30);
  });
});

describe("isStaleRunningJob (reaper — no re-encolar jobs vivos)", () => {
  const now = new Date("2026-06-08T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("running + locked_at más viejo que STALE_RUNNING_MS → stale", () => {
    expect(isStaleRunningJob({ status: "running", locked_at: ago(STALE_RUNNING_MS + 1000) }, now)).toBe(true);
  });
  it("running pero reciente → NO stale (no re-encolar un job que aún corre)", () => {
    expect(isStaleRunningJob({ status: "running", locked_at: ago(STALE_RUNNING_MS - 60000) }, now)).toBe(false);
  });
  it("estado distinto de running nunca es stale", () => {
    expect(isStaleRunningJob({ status: "queued", locked_at: ago(STALE_RUNNING_MS + 1000) }, now)).toBe(false);
  });
  it("sin locked_at no es stale", () => {
    expect(isStaleRunningJob({ status: "running", locked_at: null }, now)).toBe(false);
  });
  it("INVARIANTE: STALE_RUNNING_MS > maxDuration (300s) — si no, el reaper duplica movimientos", () => {
    expect(STALE_RUNNING_MS).toBeGreaterThan(300 * 1000);
  });
});
