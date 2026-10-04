/**
 * «Lo que aprendí» usa el MISMO guard que Check y respeta el bloqueo de escritura del
 * modo soporte: listar con el bloqueo activo NO recalcula ni crea soportes. Y la
 * evidencia se lee UNA vez por apertura (la comparten el recálculo y la lista).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { guard, leer, recalcular, deshacer } = vi.hoisted(() => ({
  guard: vi.fn(),
  leer: vi.fn(async () => new Map([["r1", { regla_id: "r1", aciertos: 3, glosa: "TRANSFERENCIA DE JUAN PEREZ" }]])),
  recalcular: vi.fn(async () => ({ revisadas: 1, cambiadas: 0 })),
  deshacer: vi.fn(async () => ({ ok: true, reevaluadas: 0, sinRegla: 0, enEmitir: 0, intocables: 0, tipoDte: 41 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/contexto-empresa", () => ({ getEmpresaAndService: guard }));
vi.mock("@/lib/ai/reglas-historial", () => ({ leerEvidencia: leer, recalcularEstadoReglas: recalcular, deshacerRegla: deshacer }));

function sbFalso() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  for (const m of ["select", "eq", "in", "order", "range"]) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "r1", estado: "firme", tipo_dte: 41, created_at: "x" }], error: null }).then(ok);
  return { from: () => q };
}

import { deshacerReglaAprendida, listarLoQueAprendi } from "./lo-que-aprendi-actions";

beforeEach(() => { guard.mockReset(); leer.mockClear(); recalcular.mockClear(); deshacer.mockClear(); });

describe("Lo que aprendí — guard y escrituras", () => {
  it("listar pide el guard en modo lectura; con el modo soporte bloqueando NO recalcula", async () => {
    guard.mockResolvedValue({ empresaId: "E1", userId: "U1", sb: sbFalso(), soporte: true, puedeEscribir: false });
    const r = await listarLoQueAprendi();
    expect(guard).toHaveBeenCalledWith({ soloLectura: true });
    expect(recalcular).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reglas: [{ id: "r1", contraparte: "Juan Perez", aciertos: 3, estado: "firme" }] });
  });
  it("sin bloqueo: recalcula con la MISMA evidencia (una sola lectura por apertura)", async () => {
    guard.mockResolvedValue({ empresaId: "E1", userId: "U1", sb: sbFalso(), soporte: false, puedeEscribir: true });
    await listarLoQueAprendi();
    expect(leer).toHaveBeenCalledTimes(1);
    expect(recalcular).toHaveBeenCalledWith(expect.anything(), "E1", expect.objectContaining({ soloEstado: true, evidencia: expect.any(Map) }));
  });
  it("deshacer usa el guard de ESCRITURA (sin soloLectura) y no hace nada si el guard lo corta", async () => {
    guard.mockResolvedValue({ error: "Modo soporte: solo lectura" });
    const r = await deshacerReglaAprendida("00000000-0000-4000-8000-000000000001");
    expect(guard).toHaveBeenCalledWith();
    expect(r).toEqual({ error: "Modo soporte: solo lectura" });
    expect(deshacer).not.toHaveBeenCalled();
  });
});
