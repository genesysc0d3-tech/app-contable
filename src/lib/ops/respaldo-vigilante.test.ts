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

/**
 * Lo que el vigilante NUNCA puede escupir al panel.
 *
 * El panel /dev se ve en capturas de pantalla, y el respaldo es lo último que
 * queda si todo lo demás se cae: saber que anda no exige saber dónde está.
 * Hasta el 2026-08-30 el resumen imprimía la ruta completa del archivo y la
 * metadata llevaba el prefijo del bucket — se sacó, y esta lista existe para
 * que no vuelvan.
 */
const PROHIBIDO = ["respaldos-db", ".sql.gz", "massdte-2026", "prefijo", "bucket", "r2", "cloudflare"];

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

  describe("nunca dice DÓNDE vive el respaldo", () => {
    /**
     * Dos redes, porque una sola no alcanza:
     *
     * 1) La lista negra de palabras. Útil, pero es adivinar de antemano: no
     *    cubre el nombre real del bucket, ni un host propio, ni "Mac mini".
     * 2) La FORMA del hallazgo. Esta es la que de verdad protege: la metadata
     *    solo puede tener estas tres llaves, y el resumen solo puede empezar
     *    con una de estas tres frases. Cualquier dato nuevo —venga como venga,
     *    se llame como se llame— rompe el test.
     */
    const LLAVES_PERMITIDAS = ["horas", "bytes", "modificado"];
    const INICIOS_PERMITIDOS = [/^El último respaldo/, /^No hay NINGÚN respaldo/, /^No se pudo verificar/];

    const noDelata = (hallazgos: Awaited<ReturnType<typeof revisarRespaldos>>) => {
      const texto = JSON.stringify(hallazgos).toLowerCase();
      for (const palabra of PROHIBIDO) {
        expect({ palabra, texto }).toStrictEqual({ palabra, texto: texto.replace(palabra, "") });
      }
      for (const f of hallazgos) {
        expect(Object.keys(f.metadata ?? {}).sort()).toStrictEqual(
          LLAVES_PERMITIDAS.filter((k) => k in (f.metadata ?? {})).sort(),
        );
        for (const llave of Object.keys(f.metadata ?? {})) {
          expect({ llave, permitida: LLAVES_PERMITIDAS.includes(llave) }).toStrictEqual({ llave, permitida: true });
        }
        expect({ resumen: f.summary, empiezaBien: INICIOS_PERMITIDOS.some((re) => re.test(f.summary)) })
          .toStrictEqual({ resumen: f.summary, empiezaBien: true });
      }
    };

    it("ni cuando está atrasado", async () => {
      mocks.masNuevo.mockResolvedValue(haceHoras(30));
      noDelata(await revisarRespaldos());
    });

    it("ni cuando se saltó un día entero", async () => {
      mocks.masNuevo.mockResolvedValue(haceHoras(50));
      noDelata(await revisarRespaldos());
    });

    it("ni cuando no hay ningún respaldo", async () => {
      mocks.masNuevo.mockResolvedValue(null);
      noDelata(await revisarRespaldos());
    });

    // El caso real que cazó este guardia cuando se escribió: el mensaje decía
    // "No se pudo consultar R2…". Y un error de red trae peor: el host entero.
    it("ni cuando el almacenamiento no responde", async () => {
      mocks.masNuevo.mockRejectedValue(new Error("timeout"));
      noDelata(await revisarRespaldos());
    });

    it("ni aunque el error venga con la URL firmada adentro", async () => {
      mocks.masNuevo.mockRejectedValue(
        new Error("connect ETIMEDOUT https://abc123.r2.cloudflarestorage.com/massdte/respaldos-db/x.sql.gz?X-Amz-Signature=deadbeef"),
      );
      const hallazgos = await revisarRespaldos();
      noDelata(hallazgos);
      // Y sigue diciendo algo útil, no una cáscara vacía.
      expect(hallazgos[0].summary).toContain("No se pudo verificar");
    });
  });
});
