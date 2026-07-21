import { describe, it, expect } from "vitest";
import { clasificarBucketsVenta, type PendienteVenta } from "./estado-cierre";

// Helper: una venta mínima. tipoDte por defecto 39 (afecta) salvo que se indique.
function venta(fechaVenta: string, tipoDte: 39 | 41 | null = 39, monto = 10000, id = fechaVenta + "-" + Math.floor(monto)): PendienteVenta {
  return { id, fechaVenta, tipoDte, monto };
}

describe("clasificarBucketsVenta — estados por mes de venta", () => {
  it("AL DÍA: venta del mes en curso (sin importar cuántos días pasaron)", () => {
    const r = clasificarBucketsVenta([venta("2026-07-03")], { hoy: "2026-07-28" });
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0].estado).toBe("al_dia");
    expect(r.buckets[0].urgencia).toBe("baja");
    expect(r.buckets[0].hito).toBe("F29");
  });

  it("ÚLTIMA LLAMADA (afecta): venta del mes pasado y hoy <= día 12", () => {
    const r = clasificarBucketsVenta([venta("2026-06-30", 39)], { hoy: "2026-07-08" });
    expect(r.buckets[0].estado).toBe("ultima_llamada");
    expect(r.buckets[0].urgencia).toBe("alta");
  });

  it("YA CERRÓ (afecta): venta del mes pasado y hoy > día 12", () => {
    const r = clasificarBucketsVenta([venta("2026-06-30", 39)], { hoy: "2026-07-20" });
    expect(r.buckets[0].estado).toBe("ya_cerro");
    expect(r.buckets[0].urgencia).toBe("critica");
  });

  it("borde exacto del día 12: día 12 = última llamada, día 13 = ya cerró", () => {
    const dia12 = clasificarBucketsVenta([venta("2026-06-15", 39)], { hoy: "2026-07-12" });
    const dia13 = clasificarBucketsVenta([venta("2026-06-15", 39)], { hoy: "2026-07-13" });
    expect(dia12.buckets[0].estado).toBe("ultima_llamada");
    expect(dia13.buckets[0].estado).toBe("ya_cerro");
  });

  it("YA CERRÓ: mes más antiguo del mismo año (no solo el inmediatamente anterior)", () => {
    const r = clasificarBucketsVenta([venta("2026-03-10", 39)], { hoy: "2026-07-05" });
    expect(r.buckets[0].estado).toBe("ya_cerro");
  });
});

describe("afecta vs exenta — la urgencia cambia con el tipo", () => {
  it("exenta en última llamada NO grita (baja), afecta sí (alta)", () => {
    const exenta = clasificarBucketsVenta([venta("2026-06-30", 41)], { hoy: "2026-07-08" });
    const afecta = clasificarBucketsVenta([venta("2026-06-30", 39)], { hoy: "2026-07-08" });
    expect(exenta.buckets[0].urgencia).toBe("baja");
    expect(afecta.buckets[0].urgencia).toBe("alta");
  });

  it("exenta ya cerró (mismo año) es alta (ámbar 'ordénala'), afecta es crítica", () => {
    const exenta = clasificarBucketsVenta([venta("2026-05-10", 41)], { hoy: "2026-07-20" });
    const afecta = clasificarBucketsVenta([venta("2026-05-10", 39)], { hoy: "2026-07-20" });
    expect(exenta.buckets[0].urgencia).toBe("alta");
    expect(afecta.buckets[0].urgencia).toBe("critica");
  });

  it("empresa exenta fuerza 41 aunque el tipoDte diga 39 (evita falso positivo de IVA)", () => {
    const r = clasificarBucketsVenta([venta("2026-06-30", 39)], { hoy: "2026-07-08", empresaExenta: true });
    expect(r.buckets[0].urgencia).toBe("baja"); // como exenta, no como afecta
    expect(r.buckets[0].tieneExenta).toBe(true);
    expect(r.buckets[0].tieneAfecta).toBe(false);
  });

  it("tipoDte null se trata como afecta (39) conservador", () => {
    const r = clasificarBucketsVenta([venta("2026-06-30", null)], { hoy: "2026-07-08" });
    expect(r.buckets[0].tieneAfecta).toBe(true);
    expect(r.buckets[0].urgencia).toBe("alta");
  });

  it("bucket mezclado afecta+exenta manda la urgencia de la afecta (peor caso)", () => {
    const r = clasificarBucketsVenta(
      [venta("2026-06-10", 41, 5000, "a"), venta("2026-06-20", 39, 5000, "b")],
      { hoy: "2026-07-20" },
    );
    expect(r.buckets[0].tieneAfecta).toBe(true);
    expect(r.buckets[0].tieneExenta).toBe(true);
    expect(r.buckets[0].urgencia).toBe("critica"); // la afecta manda
  });
});

describe("cruce de año — hito F22 (renta de abril)", () => {
  it("venta del año pasado, hoy antes de abril: cruza_el_ano pero ALTA (aún en plazo, no vencido)", () => {
    const r = clasificarBucketsVenta([venta("2025-11-15", 41)], { hoy: "2026-02-10" });
    expect(r.buckets[0].estado).toBe("cruza_el_ano");
    expect(r.buckets[0].hito).toBe("F22");
    expect(r.buckets[0].urgencia).toBe("alta");
    expect(r.buckets[0].diasAlCierre).toBeGreaterThan(0); // 30-abr aún no llega
  });

  it("venta del año pasado, hoy después de abril: MÁXIMA (F22 vencido)", () => {
    const r = clasificarBucketsVenta([venta("2025-11-15", 41)], { hoy: "2026-06-01" });
    expect(r.buckets[0].estado).toBe("cruza_el_ano");
    expect(r.buckets[0].urgencia).toBe("maxima");
    expect(r.buckets[0].diasAlCierre).toBeLessThan(0);
  });

  it("afecta que cruzó el año es máxima aunque abril no haya llegado (arrastra F29 cerrado)", () => {
    const r = clasificarBucketsVenta([venta("2025-11-15", 39)], { hoy: "2026-02-10" });
    expect(r.buckets[0].urgencia).toBe("maxima");
  });

  it("dic→ene: venta de diciembre vista en enero es cruza_el_ano (no última llamada)", () => {
    const r = clasificarBucketsVenta([venta("2025-12-28", 41)], { hoy: "2026-01-05" });
    expect(r.buckets[0].estado).toBe("cruza_el_ano");
    expect(r.buckets[0].urgencia).toBe("alta"); // exenta, abril lejos
  });
});

describe("el caso central: subir la cartola de un mes anterior", () => {
  it("subir cartola de JUNIO en JULIO (antes del 12) → última llamada", () => {
    const junio = [venta("2026-06-05", 39), venta("2026-06-18", 39), venta("2026-06-29", 39)];
    const r = clasificarBucketsVenta(junio, { hoy: "2026-07-10" });
    expect(r.buckets[0].mesVenta).toBe("2026-06");
    expect(r.buckets[0].estado).toBe("ultima_llamada");
    expect(r.buckets[0].cantidad).toBe(3);
  });

  it("una cartola con ventas de DOS meses cae en dos buckets separados", () => {
    const r = clasificarBucketsVenta(
      [venta("2026-05-30", 39, 1000, "may"), venta("2026-06-02", 39, 2000, "jun")],
      { hoy: "2026-07-05" },
    );
    expect(r.buckets).toHaveLength(2);
    const meses = r.buckets.map((b) => b.mesVenta).sort();
    expect(meses).toEqual(["2026-05", "2026-06"]);
  });
});

describe("agregados, orden y robustez", () => {
  it("suma el monto y agrupa ids por mes", () => {
    const r = clasificarBucketsVenta(
      [venta("2026-06-01", 39, 30000, "x"), venta("2026-06-15", 39, 12000, "y")],
      { hoy: "2026-07-05" },
    );
    expect(r.buckets[0].monto).toBe(42000);
    expect(r.buckets[0].ids.sort()).toEqual(["x", "y"]);
    expect(r.totalPendientes).toBe(2);
  });

  it("ordena del más urgente al menos, y peorUrgencia refleja el peor bucket", () => {
    const r = clasificarBucketsVenta(
      [
        venta("2026-07-05", 39, 1000, "aldia"),      // al_dia → baja
        venta("2025-11-05", 39, 1000, "anio"),       // cruza_el_ano → maxima
        venta("2026-06-20", 39, 1000, "ultima"),     // ultima_llamada → alta
      ],
      { hoy: "2026-07-10" },
    );
    expect(r.buckets[0].urgencia).toBe("maxima");
    expect(r.buckets[r.buckets.length - 1].urgencia).toBe("baja");
    expect(r.peorUrgencia).toBe("maxima");
  });

  it("descarta (omitidos) los ítems sin fechaVenta válida, sin contarlos mal", () => {
    const r = clasificarBucketsVenta(
      [venta("2026-07-01", 39), { id: "malo", fechaVenta: "", tipoDte: 39 }, { id: "raro", fechaVenta: "no-es-fecha", tipoDte: 39 }],
      { hoy: "2026-07-10" },
    );
    expect(r.omitidos).toBe(2);
    expect(r.totalPendientes).toBe(1);
  });

  it("input vacío → sin buckets, urgencia baja, cero pendientes", () => {
    const r = clasificarBucketsVenta([], { hoy: "2026-07-10" });
    expect(r.buckets).toHaveLength(0);
    expect(r.peorUrgencia).toBe("baja");
    expect(r.totalPendientes).toBe(0);
  });

  it("es determinista: no depende de la fecha real, solo del 'hoy' inyectado", () => {
    const a = clasificarBucketsVenta([venta("2026-06-30", 39)], { hoy: "2026-07-08" });
    const b = clasificarBucketsVenta([venta("2026-06-30", 39)], { hoy: "2026-07-08" });
    expect(a).toEqual(b);
  });
});
