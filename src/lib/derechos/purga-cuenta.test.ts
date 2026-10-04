import { describe, it, expect, vi, beforeEach } from "vitest";

// La purga borra archivos en dos nubes: hay que poder probar el ORDEN sin tocar
// ninguna. El mock registra la secuencia real de operaciones.
const borradosR2: string[] = [];
const secuencia: string[] = [];
vi.mock("@/lib/r2", () => ({
  deleteFromR2: vi.fn(async (path: string) => {
    if (path.includes("cae")) throw new Error("R2 caído");
    borradosR2.push(path);
    secuencia.push(`r2:${path}`);
  }),
}));

const { purgarCuentaCompleta } = await import("./purga-cuenta");

/** Supabase de mentira: solo lo que la purga usa, registrando el orden. */
function fakeSb(docs: Array<Record<string, unknown>>, jobsAbiertos = 0) {
  const filasBorradas: string[] = [];
  const sb = {
    from(tabla: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        delete: () => { secuencia.push(`delete:${tabla}`); filasBorradas.push(tabla); return api; },
        eq: () => api,
        in: () => api,
        not: () => api,
        then: undefined,
      };
      // Cada consulta devuelve lo que esa tabla necesita.
      const resultado =
        tabla === "cuenta_empresas" ? { data: [{ empresa_id: "e1" }], error: null }
        : tabla === "boletas_emitidas" ? { count: 0, error: null }
        : tabla === "emision_jobs" ? { count: jobsAbiertos, error: null }
        : tabla === "documentos_subidos" ? { data: docs, error: null }
        : { data: [], error: null, count: 0 };
      Object.assign(api, resultado, { then: (r: (v: unknown) => void) => r(resultado) });
      return api;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => { secuencia.push(`supabase:${paths.join(",")}`); return { error: null }; },
      }),
    },
  };
  return { sb: sb as never, filasBorradas };
}

beforeEach(() => { borradosR2.length = 0; secuencia.length = 0; });

describe("purga de cuenta — el derecho de supresión también borra los binarios", () => {
  it("★ los ARCHIVOS se borran ANTES que las filas (la fila es el único puntero)", async () => {
    const { sb } = fakeSb([{ id: "d1", storage_path: "cartolas/a.xlsx", storage_provider: "r2", album_imagenes: null }]);
    await purgarCuentaCompleta(sb, "c1");
    const iArchivo = secuencia.findIndex((s) => s.startsWith("r2:"));
    const iEmpresas = secuencia.findIndex((s) => s === "delete:empresas");
    expect(iArchivo).toBeGreaterThanOrEqual(0);
    // Si se borrara la fila primero y fallara el archivo, quedaría PII infindable.
    expect(iArchivo).toBeLessThan(iEmpresas);
  });

  it("borra el álbum completo de Telegram, no solo la imagen principal", async () => {
    const { sb } = fakeSb([{
      id: "d1", storage_path: "tg/1.jpg", storage_provider: "r2",
      album_imagenes: [{ path: "tg/2.jpg" }, { path: "tg/3.jpg" }],
    }]);
    const r = await purgarCuentaCompleta(sb, "c1");
    expect(borradosR2).toEqual(["tg/1.jpg", "tg/2.jpg", "tg/3.jpg"]);
    expect(r.archivos).toBe(3);
  });

  it("un archivo que el proveedor no pudo borrar NO se traga: sale en el resumen", async () => {
    const { sb } = fakeSb([{ id: "d1", storage_path: "cartolas/cae.xlsx", storage_provider: "r2", album_imagenes: null }]);
    const r = await purgarCuentaCompleta(sb, "c1");
    // La purga NO aborta (dejar la cuenta a medias es peor), pero el operador
    // se entera y lo cierra a mano.
    expect(r.archivosFallidos).toEqual(["cartolas/cae.xlsx"]);
    expect(r.archivos).toBe(0);
  });

  it("los uploads efímeros ('memoria') no intentan borrarse", async () => {
    const { sb } = fakeSb([{ id: "d1", storage_path: "memoria", storage_provider: "memoria", album_imagenes: null }]);
    const r = await purgarCuentaCompleta(sb, "c1");
    expect(borradosR2).toEqual([]);
    expect(r.archivos).toBe(0);
  });

  it("★ doble candado: emisión abierta/lápida frena la purga ANTES de borrar archivos", async () => {
    const { sb, filasBorradas } = fakeSb([{ id: "d1", storage_path: "cartolas/a.xlsx", storage_provider: "r2", album_imagenes: null }], 1);
    await expect(purgarCuentaCompleta(sb, "c1")).rejects.toThrow(/PURGA_BLOQUEADA/);
    expect(borradosR2).toEqual([]);
    expect(filasBorradas).toEqual([]);
  });
});

describe("purga de cuenta — log de decisiones del clasificador (sin FK a empresas)", () => {
  it("★ borra propuesta_decisiones de la empresa DESPUÉS de las empresas (segunda llave ARCO)", async () => {
    const { sb } = fakeSb([]);
    await purgarCuentaCompleta(sb, "c1");
    const iEmpresas = secuencia.indexOf("delete:empresas");
    const iLog = secuencia.indexOf("delete:propuesta_decisiones");
    expect(iLog).toBeGreaterThan(iEmpresas);
  });
});
