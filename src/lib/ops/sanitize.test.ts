import { describe, expect, it } from "vitest";
import { errorMetadata, sanitizeOpsMetadata } from "./sanitize";

describe("sanitizeOpsMetadata", () => {
  it("redacts sensitive keys and long payloads", () => {
    const metadata = sanitizeOpsMetadata({
      token: "secret-token",
      pdfBase64: "A".repeat(200),
      nested: {
        prompt: "clasifica todo este documento",
        ok: "visible",
      },
    });

    expect(metadata.token).toBe("[redacted:string]");
    expect(metadata.pdfBase64).toBe("[redacted:string]");
    expect(metadata.nested).toEqual({
      prompt: "[redacted:string]",
      ok: "visible",
    });
  });

  it("masks emails, RUTs and truncates long text", () => {
    const metadata = sanitizeOpsMetadata({
      email: "cliente.real@example.com",
      rut: "76.123.456-7",
      detalle: "texto largo ".repeat(26),
    });

    expect(metadata.email).toBe("cl***@example.com");
    expect(metadata.rut).toBe("76***-7");
    expect(String(metadata.detalle)).toContain("[truncated:311]");
  });

  it("turns errors into safe metadata", () => {
    expect(errorMetadata(new Error("fallo con cliente.real@example.com"))).toEqual({
      error_name: "Error",
      error_message: "fallo con cl***@example.com",
    });
  });
});
