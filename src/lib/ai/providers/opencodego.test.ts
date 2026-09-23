import { describe, it, expect } from "vitest";
import { parseJsonFromContent } from "./opencodego";

describe("parseJsonFromContent — extracción robusta del JSON del modelo", () => {
  it("JSON limpio se parsea directo", () => {
    expect(parseJsonFromContent('{"a":1}')).toEqual({ a: 1 });
  });

  it("quita bloques <think>…</think> (modelos razonadores tipo minimax)", () => {
    expect(parseJsonFromContent('<think>\nrazono un montón\n</think>\n{"a":1}')).toEqual({ a: 1 });
  });

  it("quita cercas markdown ```json … ```", () => {
    expect(parseJsonFromContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("extrae el objeto aunque haya prosa alrededor", () => {
    expect(parseJsonFromContent('Aquí tienes: {"a":1} — listo')).toEqual({ a: 1 });
  });

  it("combina <think> + cercas + prosa", () => {
    expect(parseJsonFromContent('<think>x</think> resultado:\n```json\n{"propuestas":[]}\n```')).toEqual({ propuestas: [] });
  });

  // Incidente 2026-09-23: 3 cartolas reales fallaron 3 veces cada una con
  // "Unexpected non-whitespace character after JSON".
  it("dos objetos pegados → se queda con el primero", () => {
    expect(parseJsonFromContent('{"propuestas":[{"a":1}]}{"propuestas":[]}')).toEqual({ propuestas: [{ a: 1 }] });
  });
  it("prosa con llaves después del JSON → se queda con el objeto", () => {
    expect(parseJsonFromContent('{"a":1}\nNota: el formato es {clave: valor}')).toEqual({ a: 1 });
  });
  it("una llave dentro de un string no confunde el balance", () => {
    expect(parseJsonFromContent('{"glosa":"pago } raro","b":2} basura {')).toEqual({ glosa: "pago } raro", b: 2 });
  });
  it("JSON de verdad roto (sin cierre) → sigue lanzando", () => {
    expect(() => parseJsonFromContent('{"a":1,"b":')).toThrow();
  });

  it("sin JSON → lanza (lo captura el retry del pipeline)", () => {
    expect(() => parseJsonFromContent("no hay ningún objeto acá")).toThrow();
  });
});
