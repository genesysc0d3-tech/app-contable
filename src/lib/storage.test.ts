import { describe, it, expect } from "vitest";
import { safeFileName, buildStorageKey, defaultStorageProvider } from "./storage";

describe("safeFileName", () => {
  it("reemplaza caracteres peligrosos y conserva alfanuméricos/._-", () => {
    expect(safeFileName("cartola enero/2026 (1).xlsx")).toBe("cartola_enero_2026__1_.xlsx");
  });
  it("vacío → 'archivo'", () => {
    expect(safeFileName("")).toBe("archivo");
  });
});

describe("buildStorageKey", () => {
  it("formato empresa/kind/año/uuid__nombre", () => {
    const k = buildStorageKey("emp1", "comprobante", "foto.jpg");
    expect(k).toMatch(/^emp1\/comprobante\/\d{4}\/[0-9a-f-]{36}__foto\.jpg$/);
  });
  it("dos llamadas → keys distintas (uuid único)", () => {
    expect(buildStorageKey("e", "k", "a.png")).not.toBe(buildStorageKey("e", "k", "a.png"));
  });
});

describe("defaultStorageProvider", () => {
  it("r2 cuando R2 está configurado, supabase si no", () => {
    const prev = {
      e: process.env.R2_ENDPOINT, a: process.env.R2_ACCESS_KEY_ID,
      s: process.env.R2_SECRET_ACCESS_KEY, b: process.env.R2_BUCKET,
    };
    process.env.R2_ENDPOINT = "https://x.r2.cloudflarestorage.com";
    process.env.R2_ACCESS_KEY_ID = "k";
    process.env.R2_SECRET_ACCESS_KEY = "s";
    process.env.R2_BUCKET = "b";
    try {
      expect(defaultStorageProvider()).toBe("r2");
      delete process.env.R2_BUCKET;
      expect(defaultStorageProvider()).toBe("supabase");
    } finally {
      process.env.R2_ENDPOINT = prev.e;
      process.env.R2_ACCESS_KEY_ID = prev.a;
      process.env.R2_SECRET_ACCESS_KEY = prev.s;
      process.env.R2_BUCKET = prev.b;
    }
  });
});
