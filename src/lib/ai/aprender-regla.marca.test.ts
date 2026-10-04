import { describe, expect, it } from "vitest";
import { aprenderReglaDesdeResolucion } from "./aprender-regla";
import { decidirTipoDtePersistido } from "./tipo-dte-persistido";
import type { ClasificacionResult } from "@/lib/sii/clasificador-tipo";

// Loop regla 39 ↔ cartola P2P (revisión adversarial M1): si la persona elige
// "Afecta" en una fila «¿?» de una cartola marcada P2P/forex, la regla queda
// confirmada en esa marca y la próxima cartola NO vuelve a preguntar.
function fakeSb(hint: string | null, previa: Record<string, unknown> | null = null) {
  const escrituras: Array<Record<string, unknown>> = [];
  const sb = {
    from(tabla: string) {
      let res: { data: unknown; error: null } = { data: tabla === "clasificacion_reglas" && previa ? [previa] : [], error: null };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit", "in", "is", "ilike", "order"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve(tabla === "documentos_subidos" ? { data: { tipo_operacion_hint: hint }, error: null } : { data: null, error: null });
      b.insert = (row: Record<string, unknown>) => { escrituras.push(row); res = { data: null, error: null }; return b; };
      b.update = (row: Record<string, unknown>) => { escrituras.push(row); res = { data: null, error: null }; return b; };
      b.upsert = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return b;
    },
  };
  return { sb: sb as never, escrituras };
}
const args = { empresaId: "emp", userId: "u", documentoId: "doc", descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipoFlujo: "entrada" as const };

describe("aprender-regla: Afecta confirmada sobre cartola P2P/forex", () => {
  it("Afecta (39) en cartola P2P → regla con la señal aprendida_bajo_marca", async () => {
    const { sb, escrituras } = fakeSb("p2p_cripto");
    await aprenderReglaDesdeResolucion(sb, { ...args, tipoDte: 39 });
    expect(escrituras[0]).toMatchObject({ tipo_dte: 39, aprendida_bajo_marca: true, confianza: 0.95 });
  });
  it("Afecta en cartola sin marca, o Exenta en P2P → sin señal", async () => {
    const a = fakeSb(null);
    await aprenderReglaDesdeResolucion(a.sb, { ...args, tipoDte: 39 });
    expect(a.escrituras[0]).toMatchObject({ aprendida_bajo_marca: false });
    const b = fakeSb("p2p_cripto");
    await aprenderReglaDesdeResolucion(b.sb, { ...args, tipoDte: 41 });
    expect(b.escrituras[0]).toMatchObject({ aprendida_bajo_marca: false });
  });
  it("Afecta en LOTE grande (> 25 filas) sobre cartola P2P → NO crea la señal", async () => {
    const { sb, escrituras } = fakeSb("p2p_cripto");
    await aprenderReglaDesdeResolucion(sb, { ...args, tipoDte: 39, tamanoLote: 40 });
    expect(escrituras[0]).toMatchObject({ aprendida_bajo_marca: false });
    const chico = fakeSb("p2p_cripto");
    await aprenderReglaDesdeResolucion(chico.sb, { ...args, tipoDte: 39, tamanoLote: 5 });
    expect(chico.escrituras[0]).toMatchObject({ aprendida_bajo_marca: true });
  });
  it("la señal no se pisa al re-acuñar Afecta fuera de P2P; y re-acuñar no cambia el tipo", async () => {
    const previa = { id: "r1", veces_acunada: 1, tipo_dte: 39, estado: "a_prueba", activa: true, aprendida_bajo_marca: true };
    const a = fakeSb(null, previa);
    await aprenderReglaDesdeResolucion(a.sb, { ...args, tipoDte: 39 });
    expect(a.escrituras[0]).toMatchObject({ aprendida_bajo_marca: true, veces_acunada: 2 });
    const b = fakeSb(null, previa);
    await aprenderReglaDesdeResolucion(b.sb, { ...args, tipoDte: 41 });
    for (const e of b.escrituras) expect(e).not.toHaveProperty("tipo_dte");
  });
  it("con la regla confirmada, la próxima cartola P2P no entra en conflicto (39, sin «¿?»)", () => {
    const neutral = { veredicto: "neutral" as const, peso: 0, razon: "" };
    const clasif: ClasificacionResult = { tipo_dte: 41, sugerencia: "exenta", confianza: 0.9, razones: [], angulos: { glosa: neutral, giro: neutral, patron: neutral } };
    const base = { tipoFlujo: "entrada", tipoBase: "boleta", clasif, docHint: "p2p_cripto" as const, reglaTipoDte: 39, emisorExento: false };
    expect(decidirTipoDtePersistido(base).conflictoMarcaCartola).toBe(true);
    expect(decidirTipoDtePersistido({ ...base, reglaConfirmadaEnMarca: true })).toMatchObject({ tipoDte: 39, conflictoMarcaCartola: false });
  });
});
