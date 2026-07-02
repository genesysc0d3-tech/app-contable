import { beforeEach, describe, expect, it, vi } from "vitest";

// Mockeamos SOLO el borde de red/proveedor (intermediario). La generacion del
// XML/TED (dte-xml) corre de verdad, asi xmlDte/ted son los reales del flujo.
vi.mock("@/lib/intermediario/client", () => ({
  asegurarFoliosDisponibles: vi.fn(async () => undefined),
  enviarDTE: vi.fn(async () => ({ ok: true, track_id: "9999999999", estado_persistencia: "aceptado" })),
}));

// vitest no resuelve el alias `@/` para imports de valor en runtime; redirigimos
// el especificador al modulo REAL (ruta relativa) para no mockear el generador.
vi.mock("@/lib/sii/dte-xml", async () => await vi.importActual("../sii/dte-xml"));

import { issueMockBoleta, type MockIssueInput } from "./mock";
import { asegurarFoliosDisponibles, enviarDTE } from "@/lib/intermediario/client";

const mockedEnviar = vi.mocked(enviarDTE);
const mockedAsegurar = vi.mocked(asegurarFoliosDisponibles);

type RpcResult = { data: unknown; error: unknown };

function makeInput(rpcResult: RpcResult, overrides: Partial<MockIssueInput> = {}): MockIssueInput {
  return {
    sb: { rpc: vi.fn(async () => rpcResult) } as never,
    empresaId: "empresa-1",
    empresa: { rut: "76.123.456-7", razon_social: "AlphaCode SpA", giro: "Servicios", direccion: "Calle 1", comuna: "Santiago" },
    body: { tipo_dte: 39, detalles: [{ nombre: "Servicio", monto: 1190 }] },
    totales: { neto: 1000, exento: 0, iva: 190, total: 1190 },
    fechaEmision: "2026-06-29",
    ...overrides,
  };
}

const folioOk: RpcResult = { data: [{ folio: 41, caf_id: "caf-1" }], error: null };

beforeEach(() => {
  mockedEnviar.mockReset();
  mockedEnviar.mockResolvedValue({ ok: true, track_id: "9999999999", estado_persistencia: "aceptado" });
  mockedAsegurar.mockReset();
  mockedAsegurar.mockResolvedValue({ ok: true });
});

describe("issueMockBoleta — folios", () => {
  it("falla con SIN_FOLIOS_DISPONIBLES (502) si el RPC devuelve error", async () => {
    const r = await issueMockBoleta(makeInput({ data: null, error: { message: "rpc boom" } }));
    expect(r).toMatchObject({ ok: false, error: "SIN_FOLIOS_DISPONIBLES", status: 502 });
  });

  it("falla con SIN_FOLIOS_DISPONIBLES si el RPC no devuelve filas", async () => {
    const r = await issueMockBoleta(makeInput({ data: [], error: null }));
    expect(r).toMatchObject({ ok: false, error: "SIN_FOLIOS_DISPONIBLES", status: 502 });
  });
});

describe("issueMockBoleta — rechazo del proveedor", () => {
  it("propaga SII_MOCK_RECHAZO (422) cuando enviarDTE no esta ok", async () => {
    mockedEnviar.mockResolvedValueOnce({ ok: false, codigo_rechazo: "REJ-1", detalle: "motivo" });
    const r = await issueMockBoleta(makeInput(folioOk));
    expect(r).toMatchObject({ ok: false, error: "SII_MOCK_RECHAZO", status: 422, codigo_rechazo: "REJ-1", detalle: "motivo" });
  });

  it("trata la respuesta sin track_id como rechazo", async () => {
    mockedEnviar.mockResolvedValueOnce({ ok: true, estado_persistencia: "aceptado" });
    const r = await issueMockBoleta(makeInput(folioOk));
    expect(r).toMatchObject({ ok: false, error: "SII_MOCK_RECHAZO" });
  });
});

describe("issueMockBoleta — exito", () => {
  it("devuelve folio, caf, XML/TED reales, trackId y estado de persistencia", async () => {
    const input = makeInput(folioOk);
    const r = await issueMockBoleta(input);

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba exito");
    expect(r.folio).toBe(41);
    expect(r.cafId).toBe("caf-1");
    expect(r.trackId).toBe("9999999999");
    expect(r.estadoPersistencia).toBe("aceptado");
    // XML/TED reales generados por dte-xml para el folio asignado
    expect(r.xmlDte).toContain('<Documento ID="BE-761234567-39-41">');
    expect(r.ted).toContain('<TED version="1.0">');
  });

  it("asegura folios para el tipo y envia el XML generado al proveedor", async () => {
    const input = makeInput(folioOk);
    await issueMockBoleta(input);

    expect(mockedAsegurar).toHaveBeenCalledWith("empresa-1", 39);
    expect(mockedEnviar).toHaveBeenCalledTimes(1);
    const enviado = mockedEnviar.mock.calls[0]![0];
    expect(enviado).toContain("<TED version=");
    expect(enviado).toContain("<Folio>41</Folio>");
  });
});
