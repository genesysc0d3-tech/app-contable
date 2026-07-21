import { describe, it, expect } from "vitest";
import { ejecutarLote, type ItemLote, type DesenlaceItem, type LoteDriver, type ProgresoLote, type MotivoPausa } from "./lote-runner";

function item(propuestaId: string, tipoDte: 39 | 41 = 41, monto = 10000): ItemLote {
  return { propuestaId, tipoDte, monto, etiqueta: propuestaId };
}

function emitida(folio: number): DesenlaceItem {
  return { estado: "emitida", folio };
}
function fallida(motivo = "error SII"): DesenlaceItem {
  return { estado: "fallida", motivo };
}
function revisar(motivo = "emitiste pero no capturé el folio"): DesenlaceItem {
  return { estado: "revisar", motivo };
}

// Driver falso: consume desenlaces en orden, registra el log de operaciones, y
// permite inyectar un hook justo DENTRO de emitirUna (para simular "el usuario
// apretó Detener a mitad de una emisión").
function fakeDriver(
  outcomes: DesenlaceItem[],
  hooks?: { dentroDeEmitir?: (item: ItemLote, i: number) => void },
): { driver: LoteDriver; log: string[] } {
  const log: string[] = [];
  let i = 0;
  const driver: LoteDriver = {
    rand: () => 0.5, // determinista: espera normal, magnitud media
    async emitirUna(it, reportar) {
      const idx = i;
      log.push(`emitir:${it.propuestaId}`);
      reportar("login");
      hooks?.dentroDeEmitir?.(it, idx);
      const out = outcomes[i++] ?? fallida("sin outcome");
      return out;
    },
    async esperar(ms) {
      log.push(`esperar:${ms}`);
    },
  };
  return { driver, log };
}

describe("ejecutarLote — secuencial y contadores", () => {
  it("emite todas en orden y cuenta emitidas/folios", async () => {
    const { driver, log } = fakeDriver([emitida(1), emitida(2), emitida(3)]);
    const p = await ejecutarLote([item("a"), item("b"), item("c")], driver);
    expect(p.fase).toBe("terminada");
    expect(p.emitidas).toBe(3);
    expect(p.fallidas).toBe(0);
    expect(p.folios).toEqual([1, 2, 3]);
    // Orden estricto: emitir a → esperar → emitir b → esperar → emitir c (sin esperar final).
    expect(log).toEqual([
      "emitir:a", "esperar:4250",
      "emitir:b", "esperar:4250",
      "emitir:c",
    ]);
  });

  it("lista vacía → termina sin emitir ni esperar", async () => {
    const { driver, log } = fakeDriver([]);
    const p = await ejecutarLote([], driver);
    expect(p.fase).toBe("terminada");
    expect(p.total).toBe(0);
    expect(log).toEqual([]);
  });

  it("una sola boleta → sin jitter (no hay 'próxima')", async () => {
    const { driver, log } = fakeDriver([emitida(7)]);
    const p = await ejecutarLote([item("solo")], driver);
    expect(p.emitidas).toBe(1);
    expect(log).toEqual(["emitir:solo"]);
  });
});

describe("ejecutarLote — Detener nunca corta una emisión en vuelo", () => {
  it("abort DENTRO de la emisión: esa boleta igual se registra; la próxima no arranca", async () => {
    const ac = new AbortController();
    const { driver, log } = fakeDriver([emitida(1), emitida(2)], {
      dentroDeEmitir: (_it, i) => { if (i === 0) ac.abort(); }, // usuario aprieta Detener a mitad de la 1ª
    });
    const p = await ejecutarLote([item("a"), item("b")], driver, { señalDetener: ac.signal });
    // La 1ª completó (folio 1 registrado), la 2ª nunca empezó.
    expect(p.emitidas).toBe(1);
    expect(p.folios).toEqual([1]);
    expect(p.fase).toBe("detenida");
    expect(log).toEqual(["emitir:a"]); // nunca "emitir:b" ni "esperar"
  });

  it("abort DENTRO de una emisión que termina 'fallida' → detenida, sin pausa espuria", async () => {
    // El bug que cazó la revisión: Detener a mitad de una boleta que luego falla
    // abría el modal de pausa por error en vez de detener. Ahora va directo a detenida.
    const ac = new AbortController();
    let pregunto = false;
    const { driver, log } = fakeDriver([fallida(), emitida(2)], {
      dentroDeEmitir: (_it, i) => { if (i === 0) ac.abort(); },
    });
    const p = await ejecutarLote([item("a"), item("b")], driver, {
      señalDetener: ac.signal,
      alPausar: async () => { pregunto = true; return "continuar"; },
    });
    expect(p.fase).toBe("detenida");
    expect(pregunto).toBe(false); // NO abre pausa por error
    expect(p.fallidas).toBe(1);
    expect(log).toEqual(["emitir:a"]); // "b" nunca arranca, sin jitter
  });

  it("abort antes de empezar → no emite nada", async () => {
    const ac = new AbortController();
    ac.abort();
    const { driver, log } = fakeDriver([emitida(1)]);
    const p = await ejecutarLote([item("a")], driver, { señalDetener: ac.signal });
    expect(p.fase).toBe("detenida");
    expect(p.emitidas).toBe(0);
    expect(log).toEqual([]);
  });
});

describe("ejecutarLote — pausa por error", () => {
  it("error a mitad: pregunta y 'detener' cierra el lote", async () => {
    const pausas: MotivoPausa[] = [];
    const { driver } = fakeDriver([emitida(1), fallida("SII caído"), emitida(3)]);
    const p = await ejecutarLote([item("a"), item("b"), item("c")], driver, {
      alPausar: async (motivo) => { pausas.push(motivo); return "detener"; },
    });
    expect(pausas).toEqual(["error"]);
    expect(p.fase).toBe("detenida");
    expect(p.emitidas).toBe(1);
    expect(p.fallidas).toBe(1);
    expect(p.procesadas).toBe(2); // la 3ª nunca se intentó
  });

  it("error a mitad: 'continuar' salta y sigue con la próxima", async () => {
    const { driver } = fakeDriver([emitida(1), fallida(), emitida(3)]);
    const p = await ejecutarLote([item("a"), item("b"), item("c")], driver, {
      alPausar: async () => "continuar",
    });
    expect(p.fase).toBe("terminada");
    expect(p.emitidas).toBe(2);
    expect(p.fallidas).toBe(1);
    expect(p.folios).toEqual([1, 3]);
  });

  it("error en la ÚLTIMA no pausa (no hay próxima que decidir)", async () => {
    let pregunto = false;
    const { driver } = fakeDriver([emitida(1), fallida()]);
    const p = await ejecutarLote([item("a"), item("b")], driver, {
      alPausar: async () => { pregunto = true; return "detener"; },
    });
    expect(pregunto).toBe(false);
    expect(p.fase).toBe("terminada");
    expect(p.fallidas).toBe(1);
  });

  it("sin alPausar, un error a mitad continúa por defecto", async () => {
    const { driver } = fakeDriver([fallida(), emitida(2)]);
    const p = await ejecutarLote([item("a"), item("b")], driver);
    expect(p.fase).toBe("terminada");
    expect(p.emitidas).toBe(1);
  });
});

describe("ejecutarLote — boleta 'a medias' frena en seco", () => {
  it("una 'revisar' detiene el lote sin preguntar y sin tocar las próximas", async () => {
    let pregunto = false;
    const { driver, log } = fakeDriver([emitida(1), revisar(), emitida(3)]);
    const p = await ejecutarLote([item("a"), item("b"), item("c")], driver, {
      alPausar: async () => { pregunto = true; return "continuar"; },
    });
    expect(p.fase).toBe("requiere_revision");
    expect(pregunto).toBe(false); // NO se ofrece continuar: es un freno duro
    expect(p.emitidas).toBe(1);
    expect(p.revision).toBe(1);
    expect(p.procesadas).toBe(2);
    expect(log).toEqual(["emitir:a", "esperar:4250", "emitir:b"]); // "c" nunca arranca
  });

  it("'revisar' en la última también frena (no 'termina')", async () => {
    const { driver } = fakeDriver([emitida(1), revisar()]);
    const p = await ejecutarLote([item("a"), item("b")], driver);
    expect(p.fase).toBe("requiere_revision");
    expect(p.revision).toBe(1);
  });

  it("'revisar' expone revisionPendiente con el item trabado y el folio leído", async () => {
    const { driver } = fakeDriver([emitida(1), { estado: "revisar", motivo: "no confirmé", folio: 99 }]);
    const p = await ejecutarLote([item("a"), item("b", 41)], driver);
    expect(p.fase).toBe("requiere_revision");
    expect(p.revisionPendiente?.item.propuestaId).toBe("b");
    expect(p.revisionPendiente?.folio).toBe(99);
  });
});

describe("ejecutarLote — tope de sesión", () => {
  const CFG = { baseMs: 1000, jitterMs: 0, longPauseChance: 0, longPauseMinMs: 1, longPauseMaxMs: 1, sessionCap: 2 };

  it("frena tras sessionCap emisiones y 'detener' cierra", async () => {
    const pausas: MotivoPausa[] = [];
    const { driver } = fakeDriver([emitida(1), emitida(2), emitida(3), emitida(4)]);
    const p = await ejecutarLote([item("a"), item("b"), item("c"), item("d")], driver, {
      config: CFG,
      alPausar: async (motivo) => { pausas.push(motivo); return "detener"; },
    });
    expect(pausas).toEqual(["tope"]);
    expect(p.emitidas).toBe(2);
    expect(p.fase).toBe("detenida");
  });

  it("'continuar' tras el tope reinicia el conteo y termina las 4", async () => {
    const pausas: MotivoPausa[] = [];
    const { driver } = fakeDriver([emitida(1), emitida(2), emitida(3), emitida(4)]);
    const p = await ejecutarLote([item("a"), item("b"), item("c"), item("d")], driver, {
      config: CFG,
      alPausar: async (motivo) => { pausas.push(motivo); return "continuar"; },
    });
    // Con cap=2 y 4 boletas: solo se alcanza el tope una vez (tras la 2ª). Tras la
    // 4ª es la última → no pregunta.
    expect(pausas).toEqual(["tope"]);
    expect(p.emitidas).toBe(4);
    expect(p.fase).toBe("terminada");
  });
});

describe("ejecutarLote — progreso reportado", () => {
  it("onProgreso ve la fase emitiendo→esperando→terminada y el item actual", async () => {
    const fases = new Set<string>();
    const { driver } = fakeDriver([emitida(1), emitida(2)]);
    await ejecutarLote([item("a"), item("b")], driver, {
      onProgreso: (p: ProgresoLote) => fases.add(p.fase),
    });
    expect(fases.has("emitiendo")).toBe(true);
    expect(fases.has("esperando")).toBe(true);
    expect(fases.has("terminada")).toBe(true);
  });
});
