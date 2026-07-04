import { describe, expect, it } from "vitest";
import {
  MAX_PROCESAR_UPLOAD_BYTES,
  sanitizeUploadFilename,
  validateProcesarUploadPayload,
} from "./process-upload-validation";

function b64(bytes: number) {
  return Buffer.alloc(bytes, 1).toString("base64");
}

describe("validateProcesarUploadPayload", () => {
  it("accepts a valid pdf upload without trusting the original path", () => {
    const result = validateProcesarUploadPayload({
      nombre: "../cartola.pdf",
      base64: b64(128),
      tipo: "pdf",
      mime: "application/pdf",
    });

    expect(result).toMatchObject({
      ok: true,
      nombre: "cartola.pdf",
      tipo: "pdf",
      contentType: "application/pdf",
      bytes: 128,
    });
  });

  it("rejects invalid base64 before Buffer decoding", () => {
    const result = validateProcesarUploadPayload({
      nombre: "cartola.xlsx",
      base64: "%%%not-base64%%%",
      tipo: "excel",
    });

    expect(result).toEqual({ ok: false, error: "BASE64_INVALIDO", status: 422 });
  });

  it("rejects files above the decoded size limit", () => {
    const result = validateProcesarUploadPayload({
      nombre: "cartola.xlsx",
      base64: b64(MAX_PROCESAR_UPLOAD_BYTES + 1),
      tipo: "excel",
    });

    expect(result).toEqual({ ok: false, error: "ARCHIVO_DEMASIADO_GRANDE", status: 413 });
  });

  it("rejects mismatched extension and declared type", () => {
    const result = validateProcesarUploadPayload({
      nombre: "cartola.exe",
      base64: b64(16),
      tipo: "pdf",
      mime: "application/pdf",
    });

    expect(result).toEqual({ ok: false, error: "EXTENSION_NO_PERMITIDA", status: 415 });
  });

  it("rejects mismatched mime and declared type", () => {
    const result = validateProcesarUploadPayload({
      nombre: "cartola.xlsx",
      base64: b64(16),
      tipo: "excel",
      mime: "text/html",
    });

    expect(result).toEqual({ ok: false, error: "MIME_NO_PERMITIDO", status: 415 });
  });

  it("keeps legacy uploads working when mime and extension are absent", () => {
    const result = validateProcesarUploadPayload({
      nombre: "cartola junio",
      base64: b64(16),
      tipo: "excel",
    });

    expect(result).toMatchObject({
      ok: true,
      nombre: "cartola junio",
      tipo: "excel",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });
});

describe("sanitizeUploadFilename", () => {
  it("strips path separators and unsafe filename characters", () => {
    expect(sanitizeUploadFilename('..\\bad:path<script>.csv')).toBe("bad_path_script_.csv");
  });
});
