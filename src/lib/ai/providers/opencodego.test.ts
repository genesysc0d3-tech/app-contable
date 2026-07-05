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

  it("sin JSON → lanza (lo captura el retry del pipeline)", () => {
    expect(() => parseJsonFromContent("no hay ningún objeto acá")).toThrow();
  });
});
