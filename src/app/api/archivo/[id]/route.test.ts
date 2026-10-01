import { beforeEach, describe, expect, it, vi } from "vitest";

// Auditoría 2026-10-01: RLS autoriza la FILA de documentos_subidos, pero el usuario
// puede reescribir su storage_path / album_imagenes por PostgREST y esta ruta baja
// ese path con service role. Un path de otra empresa NUNCA se sirve.

let filaDoc: Record<string, unknown> | null = null;
const getFileR2 = vi.fn(async (_k: string) => Buffer.from("bytes"));
const download = vi.fn(async (_p: string) => ({ data: new Blob(["bytes"]), error: null }));

vi.mock("@/lib/api/sesion-segura", () => ({
  requireSesionSegura: async () => ({
    ok: true,
    supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: filaDoc, error: filaDoc ? null : { message: "no" } }) }) }) }) },
  }),
}));
vi.mock("@/lib/r2", () => ({ isR2Configured: () => true, uploadToR2: vi.fn(), downloadFromR2: (k: string) => getFileR2(k), r2SignedGetUrl: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { from: () => ({ download }) } }) }));

const pedir = async (qs = "") => {
  const { GET } = await import("./route");
  return GET(new Request(`http://x/api/archivo/doc1${qs}`), { params: Promise.resolve({ id: "doc1" }) });
};

describe("/api/archivo/[id] solo sirve paths de la empresa del documento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://sb";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  });

  it("storage_path legítimo (R2) → 200", async () => {
    filaDoc = { empresa_id: "e1", storage_provider: "r2", storage_path: "e1/documento/2026/u__cartola.pdf", nombre_archivo: "cartola.pdf" };
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(getFileR2).toHaveBeenCalledWith("e1/documento/2026/u__cartola.pdf");
  });

  it("storage_path reescrito al de OTRA empresa (R2) → 404 sin tocar R2", async () => {
    filaDoc = { empresa_id: "e1", storage_provider: "r2", storage_path: "e2/documento/2026/u__ajeno.pdf", nombre_archivo: "x.pdf" };
    expect((await pedir()).status).toBe(404);
    expect(getFileR2).not.toHaveBeenCalled();
  });

  it("storage_path ajeno en Supabase Storage → 404 sin bajar con service role", async () => {
    filaDoc = { empresa_id: "e1", storage_provider: "supabase", storage_path: "e2/doc/ajeno.xlsx", nombre_archivo: "x.xlsx" };
    expect((await pedir()).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("escape con '..' → 404", async () => {
    filaDoc = { empresa_id: "e1", storage_provider: "supabase", storage_path: "e1/../e2/doc/ajeno.xlsx", nombre_archivo: "x.xlsx" };
    expect((await pedir()).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("imagen del álbum con path ajeno → 404; la propia → 200", async () => {
    filaDoc = {
      empresa_id: "e1", storage_provider: "r2", storage_path: "e1/documento/2026/a__1.jpg", nombre_archivo: "album",
      album_imagenes: [{ path: "e1/documento/2026/a__1.jpg", mime: "image/jpeg" }, { path: "e2/documento/2026/b__2.jpg", mime: "image/jpeg" }],
    };
    expect((await pedir("?i=1")).status).toBe(404);
    expect((await pedir("?i=0")).status).toBe(200);
  });

  it("mime del álbum fuera de la lista (text/html) no se respeta", async () => {
    filaDoc = {
      empresa_id: "e1", storage_provider: "r2", storage_path: "e1/documento/2026/a__1.jpg", nombre_archivo: "album",
      album_imagenes: [{ path: "e1/documento/2026/a__1.jpg", mime: "text/html", name: "1.jpg" }],
    };
    const r = await pedir("?i=0");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/jpeg");
  });
});
