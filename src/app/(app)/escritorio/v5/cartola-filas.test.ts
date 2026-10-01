import { describe, expect, it } from "vitest";
import { agruparFilas, boletaVigente, contarTerminadas, terminadaDe } from "./cartola-filas";

type P = { id: string; estado: string; boletas_emitidas?: Array<{ folio: number | null; estado: string | null; ref?: string | null }> | null };
const p = (id: string, estado: string, boletas?: P["boletas_emitidas"]): P => ({ id, estado, boletas_emitidas: boletas });
const NADA = new Set<string>();

describe("terminadaDe — qué fila ya terminó su viaje", () => {
  it("aprobada CON boleta vigente = emitida, con folio y ref", () => {
    expect(terminadaDe(p("a", "aprobado", [{ folio: 123, estado: "emitida", ref: "R-BCD-FGH" }]), NADA))
      .toEqual({ tipo: "emitida", folio: 123, ref: "R-BCD-FGH" });
  });

  it("aprobada SIN boleta = sigue en emisión (no terminada)", () => {
    expect(terminadaDe(p("a", "aprobado", []), NADA)).toBeNull();
    expect(terminadaDe(p("a", "aprobado", null), NADA)).toBeNull();
    expect(terminadaDe(p("a", "aprobado"), NADA)).toBeNull();
  });

  it("boleta ANULADA no cuenta: la fila vuelve a ser trabajo pendiente", () => {
    expect(terminadaDe(p("a", "aprobado", [{ folio: 9, estado: "anulada" }]), NADA)).toBeNull();
  });

  it("anulada + reemitida: gana la vigente", () => {
    const r = terminadaDe(p("a", "aprobado", [{ folio: 9, estado: "anulada" }, { folio: 12, estado: "emitida" }]), NADA);
    expect(r).toEqual({ tipo: "emitida", folio: 12, ref: null });
  });

  it("PostgREST puede traer la boleta como objeto suelto", () => {
    const x = { id: "a", estado: "aprobado", boletas_emitidas: { folio: 7, estado: "emitida" } };
    expect(boletaVigente(x)?.folio).toBe(7);
  });

  it("lápida (a medias) sin boleta = a medias; con boleta, emitida gana", () => {
    const lap = new Set(["a"]);
    expect(terminadaDe(p("a", "aprobado"), lap)).toEqual({ tipo: "a_medias" });
    expect(terminadaDe(p("a", "aprobado", [{ folio: 5, estado: "emitida" }]), lap)?.tipo).toBe("emitida");
  });
});

describe("agruparFilas — Check de agregados", () => {
  it("las emitidas van a su grupo al final, NUNCA a 'En emisión'", () => {
    const { groups, terminadas } = agruparFilas([
      p("emit", "aprobado", [{ folio: 1, estado: "emitida" }]),
      p("falta", "aprobado"),
    ], NADA);
    expect(groups.emision.map((x) => x.id)).toEqual(["falta"]);
    expect(groups.emitidas.map((x) => x.id)).toEqual(["emit"]);
    expect(terminadas.has("emit")).toBe(true);
    expect(terminadas.has("falta")).toBe(false);
  });

  it("una emitida que quedó en 'listo' (retroceso viejo, MH) no se ve como lista", () => {
    const { groups } = agruparFilas([p("x", "listo", [{ folio: 3, estado: "emitida" }]), p("y", "listo")], NADA);
    expect(groups.listas.map((x) => x.id)).toEqual(["y"]);
    expect(groups.emitidas.map((x) => x.id)).toEqual(["x"]);
  });

  it("anulada en 'aprobado' se queda en emisión (accionable), no tachada", () => {
    const { groups, terminadas } = agruparFilas([p("x", "aprobado", [{ folio: 3, estado: "anulada" }])], NADA);
    expect(groups.emision.map((x) => x.id)).toEqual(["x"]);
    expect(groups.emitidas).toEqual([]);
    expect(terminadas.size).toBe(0);
  });

  it("a medias en su propio grupo, sin contar como pendiente ni en emisión", () => {
    const { groups } = agruparFilas([p("m", "aprobado"), p("q", "pendiente")], new Set(["m"]));
    expect(groups.a_medias.map((x) => x.id)).toEqual(["m"]);
    expect(groups.emision).toEqual([]);
    expect(groups.pendientes.map((x) => x.id)).toEqual(["q"]);
  });

  it("pendientes/editadas/listas/juzgadas siguen igual", () => {
    const { groups } = agruparFilas([p("1", "pendiente"), p("2", "editado"), p("3", "listo"), p("4", "rechazado"), p("5", "descartado")], NADA);
    expect(groups.pendientes.map((x) => x.id)).toEqual(["1", "2"]);
    expect(groups.listas.map((x) => x.id)).toEqual(["3"]);
    expect(groups.rechazadas.map((x) => x.id)).toEqual(["4", "5"]);
  });

  it("la ✕ de la sesión deja la juzgada tachada donde estaba", () => {
    const { groups } = agruparFilas([p("4", "rechazado")], NADA, new Map([["4", "listas" as const]]));
    expect(groups.listas.map((x) => x.id)).toEqual(["4"]);
  });

  it("contarTerminadas: emitidas y a medias por separado", () => {
    expect(contarTerminadas([
      p("a", "aprobado", [{ folio: 1, estado: "emitida" }]),
      p("b", "aprobado", [{ folio: 2, estado: "anulada" }]),
      p("c", "aprobado"),
    ], new Set(["c"]))).toEqual({ emitidas: 1, aMedias: 1 });
  });
});
