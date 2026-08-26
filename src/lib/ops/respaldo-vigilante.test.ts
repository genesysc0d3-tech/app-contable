import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// diagnostics.ts es código de servidor; "server-only" no existe fuera de Next.
vi.mock("server-only", () => ({}));

// El vigilante consulta R2; acá se simula para poder probar los umbrales sin red.
const mocks = vi.hoisted(() => ({
  configurado: vi.fn(() => true),
  masNuevo: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  isR2Configured: mocks.configurado,
  r2ObjetoMasNuevo: mocks.masNuevo,
}));

const { revisarRespaldos } = await import("./diagnostics");

const haceHoras = (h: number) => ({
  key: "respaldos-db/massdte-2026-08-23.sql.gz",
  modificado: new Date(Date.now() - h * 3_600_000),
  bytes: 320_348,
});

describe("vigilante de respaldos", () => {
  beforeEach(() => {
    mocks.configurado.mockReturnValue(true);
    mocks.masNuevo.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("calla cuando el respaldo de anoche llegó", async () => {
    mocks.masNuevo.mockResolvedValue(haceHoras(8));
    expect(await revisarRespaldos()).toEqual([]);
  });

  it("aguanta el margen: 25 h todavía es sano", async () => {
    mocks.masNuevo.mockResolvedValue(haceHoras(25));
    expect(await revisarRespaldos()).toEqual([]);
  });

  it("avisa cuando pasó de las 26 h", async () => {
    mocks.masNuevo.mockResolvedValue(haceHoras(30));
    const [f] = await revisarRespaldos();
    expect(f.severity).toBe("warn");
    expect(f.eventName).toBe("respaldo_db_atrasado");
  });

  it("escala a crítico cuando se saltó un día entero", async () => {
    mocks.masNuevo.mockResolvedValue(haceHoras(50));
    const [f] = await revisarRespaldos();
    expect(f.severity).toBe("critical");
    expect(f.metadata?.horas).toBe(50);
  });

  it("no existir ningún respaldo es lo más grave", async () => {
    mocks.masNuevo.mockResolvedValue(null);
    const [f] = await revisarRespaldos();
    expect(f.severity).toBe("critical");
    expect(f.eventName).toBe("respaldo_db_inexistente");
  });

  it("si R2 no responde avisa, pero no grita 'no hay respaldos'", async () => {
    mocks.masNuevo.mockRejectedValue(new Error("timeout"));
    const [f] = await revisarRespaldos();
    expect(f.severity).toBe("warn");
    expect(f.eventName).toBe("respaldo_db_no_verificable");
  });

  it("sin R2 configurado no molesta (entornos locales)", async () => {
    mocks.configurado.mockReturnValue(false);
    expect(await revisarRespaldos()).toEqual([]);
  });
});
