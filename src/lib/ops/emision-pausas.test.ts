import { describe, expect, it } from "vitest";
import {
  carrilDeTipoDte,
  copyEmisionPausada,
  debeAlertarPausaQueryFailed,
  gateDePausaAplica,
  hayPausaParaCarril,
  pausaActivaParaEmpresa,
  type PausaEmision,
} from "./emision-pausas";

// Cliente falso mínimo: reproduce SOLO la cadena que usa pausaActivaParaEmpresa
// (select → eq → gt → in → order → limit → await) y aplica los filtros en
// memoria, para que el test muerda si la consulta cambia de forma.
type Row = PausaEmision;
function fakeSb(rows: Row[], opts: { throwOn?: boolean; errorOn?: boolean } = {}) {
  const filters: Array<(r: Row) => boolean> = [];
  const builder = {
    select() { return builder; },
    eq(col: keyof Row, v: unknown) { filters.push((r) => r[col] === v); return builder; },
    gt(col: keyof Row, v: string) { filters.push((r) => String(r[col]) > v); return builder; },
    in(col: keyof Row, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return builder; },
    order() { return builder; },
    limit() {
      if (opts.throwOn) throw new Error("boom");
      if (opts.errorOn) return Promise.resolve({ data: null, error: { message: "relation does not exist" } });
      return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null });
    },
  };
  return { from: () => builder } as unknown as Parameters<typeof pausaActivaParaEmpresa>[0];
}

const now = new Date("2026-09-10T15:00:00Z");
const base: Row = {
  id: "p1", carril: "boletas", activo: true, motivo_interno: "ancla caída", hasta: "2026-09-10T19:00:00Z",
  excepto_empresas: [], origen: "manual", creado_por: "op", created_at: "2026-09-10T14:00:00Z",
};

describe("kill switch — carril y copy", () => {
  it("39/41 → boletas, 33/34 → facturas", () => {
    expect(carrilDeTipoDte(39)).toBe("boletas");
    expect(carrilDeTipoDte(41)).toBe("boletas");
    expect(carrilDeTipoDte(33)).toBe("facturas");
    expect(carrilDeTipoDte(34)).toBe("facturas");
  });
  it("el copy nombra el carril y promete que no se pierde nada", () => {
    expect(copyEmisionPausada("boletas")).toBe("Pausamos la emisión de boletas por un rato mientras revisamos un cambio en el sitio del SII. Tus boletas quedan listas y no se pierde nada; inténtalo de nuevo más tarde.");
    expect(copyEmisionPausada("facturas")).toContain("emisión de facturas");
  });
});

describe("kill switch — pausaActivaParaEmpresa", () => {
  it("pausa activa del carril → pausada", async () => {
    const r = await pausaActivaParaEmpresa(fakeSb([base]), { carril: "boletas", empresaId: "e1", now });
    expect(r.pausada).toBe(true);
    if (r.pausada) expect(r.pausa?.id).toBe("p1");
  });
  it("pausa 'todo' alcanza a facturas también", async () => {
    const r = await pausaActivaParaEmpresa(fakeSb([{ ...base, carril: "todo" }]), { carril: "facturas", empresaId: "e1", now });
    expect(r.pausada).toBe(true);
  });
  it("pausa de OTRO carril no frena", async () => {
    const r = await pausaActivaParaEmpresa(fakeSb([base]), { carril: "facturas", empresaId: "e1", now });
    expect(r.pausada).toBe(false);
  });
  it("pausa VENCIDA no frena", async () => {
    const r = await pausaActivaParaEmpresa(fakeSb([{ ...base, hasta: "2026-09-10T14:59:00Z" }]), { carril: "boletas", empresaId: "e1", now });
    expect(r.pausada).toBe(false);
  });
  it("pausa levantada (activo=false) no frena", async () => {
    const r = await pausaActivaParaEmpresa(fakeSb([{ ...base, activo: false }]), { carril: "boletas", empresaId: "e1", now });
    expect(r.pausada).toBe(false);
  });
  it("empresa en excepto_empresas pasa; las demás no", async () => {
    const sb = fakeSb([{ ...base, excepto_empresas: ["e-socio"] }]);
    expect((await pausaActivaParaEmpresa(sb, { carril: "boletas", empresaId: "e-socio", now })).pausada).toBe(false);
    expect((await pausaActivaParaEmpresa(sb, { carril: "boletas", empresaId: "e-otra", now })).pausada).toBe(true);
  });
  it("FAIL-CLOSED: error de consulta → pausada con el fallo anotado", async () => {
    const r = await pausaActivaParaEmpresa(fakeSb([], { errorOn: true }), { carril: "boletas", empresaId: "e1", now });
    expect(r.pausada).toBe(true);
    if (r.pausada) { expect(r.pausa).toBeNull(); expect(r.fallo).toContain("does not exist"); }
  });
  it("FAIL-CLOSED: excepción → pausada", async () => {
    const r = await pausaActivaParaEmpresa(fakeSb([], { throwOn: true }), { carril: "boletas", empresaId: "e1", now });
    expect(r.pausada).toBe(true);
    if (r.pausada) expect(r.fallo).toBe("boom");
  });
});

describe("gate solo para el portal (F4)", () => {
  it("sii_local sí; simpleapi, mock y nulos no", () => {
    expect(gateDePausaAplica("sii_local")).toBe(true);
    expect(gateDePausaAplica("simpleapi")).toBe(false);
    expect(gateDePausaAplica("mock")).toBe(false);
    expect(gateDePausaAplica(null)).toBe(false);
    expect(gateDePausaAplica(undefined)).toBe(false);
  });
});

describe("dedupe de la alerta por fallo del kill switch (F3)", () => {
  it("sin marca previa → alerta", () => {
    expect(debeAlertarPausaQueryFailed(null, now)).toBe(true);
    expect(debeAlertarPausaQueryFailed(undefined, now)).toBe(true);
    expect(debeAlertarPausaQueryFailed("no-es-fecha", now)).toBe(true);
  });
  it("marca de hace < 10 min → NO alerta; ≥ 10 min → alerta", () => {
    expect(debeAlertarPausaQueryFailed("2026-09-10T14:51:00Z", now)).toBe(false);
    expect(debeAlertarPausaQueryFailed("2026-09-10T14:59:59Z", now)).toBe(false);
    expect(debeAlertarPausaQueryFailed("2026-09-10T14:50:00Z", now)).toBe(true);
    expect(debeAlertarPausaQueryFailed("2026-09-10T10:00:00Z", now)).toBe(true);
  });
});

describe("hayPausaParaCarril", () => {
  it("propio o 'todo'", () => {
    expect(hayPausaParaCarril([base], "boletas")).toBe(true);
    expect(hayPausaParaCarril([base], "facturas")).toBe(false);
    expect(hayPausaParaCarril([{ ...base, carril: "todo" }], "facturas")).toBe(true);
  });
});
