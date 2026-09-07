import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mesDeFecha } from "./apuntar";

/**
 * Modo apuntar (fundador 2026-09-06): "congelar la pantalla y arrastrar lo que
 * quieres que la persona mire — una tx, un monto, no solo el documento".
 * Este censo sostiene: (1) lo apuntable está marcado en la UI con sus datos;
 * (2) el servidor comprueba que el objeto EXISTA en la empresa por tipo, y
 * sigue exigiendo el tick del receptor; (3) el globito entra y sale del modo
 * (Esc), captura el click en fase de captura y no se come el chat; (4) el
 * salto lleva a la pestaña correcta, al mes correcto, y resalta la fila.
 */
const ORBE = "src/app/(app)/escritorio/v5/GuardarailOrbe.tsx";
const ACTIONS = "src/app/(app)/escritorio/v5/actions.ts";
const MIG = "supabase/migrations/20260907100000_team_mensajes_objetos.sql";

describe("1. lo apuntable lleva sus datos", () => {
  it("cards de documentos, filas de tx en Emitir y boletas de la mesa", () => {
    // las DOS formas de la lista (cards y el árbol del tablero del Check)
    const cards = readFileSync("src/app/(app)/escritorio/v5/DocCardList.tsx", "utf8");
    expect((cards.match(/data-apuntable="documento" data-apuntable-id=\{doc\.id\} data-apuntable-label=\{doc\.nombre_archivo\}/g) ?? []).length).toBe(2);
    const emitir = readFileSync("src/app/(app)/escritorio/v5/EmitirTabContent.tsx", "utf8");
    expect(emitir).toMatch(/data-apuntable="tx" data-apuntable-id=\{item\.id\} data-apuntable-doc=\{item\.documento_id \?\? undefined\} data-apuntable-mes=\{mesDeFecha\(item\.fecha\) \?\? undefined\}/);
    const mesa = readFileSync("src/app/(app)/escritorio/v5/Mesa.tsx", "utf8");
    expect(mesa).toMatch(/data-apuntable="boleta" data-apuntable-id=\{b\.id\} data-apuntable-mes=\{mesDeFecha\(b\.fecha_emision\) \?\? undefined\}/);
  });

  it("el mes va 0-indexed como lo usa el calendario", () => {
    expect(mesDeFecha("2026-09-02")).toBe("2026-8");
    expect(mesDeFecha("2026-01-15T10:00:00Z")).toBe("2026-0");
    expect(mesDeFecha(null)).toBeNull();
    expect(mesDeFecha("hoy")).toBeNull();
  });
});

describe("2. el servidor comprueba el objeto por tipo y sigue exigiendo el tick del receptor", () => {
  const src = readFileSync(ACTIONS, "utf8");
  const fn = src.slice(src.indexOf("export async function enviarMensajeTeam"), src.indexOf("export async function marcarLeidosTeam"));

  it("documento → documentos_subidos; tx → propuestas_ia (+ su doc si viene); boleta → boletas_emitidas, todos en ESA empresa", () => {
    expect(fn).toMatch(/if \(tipo === "documento"\) \{[\s\S]*?from\("documentos_subidos"\)[\s\S]*?\.eq\("empresa_id", empresaId\)/);
    expect(fn).toMatch(/else if \(tipo === "tx"\) \{[\s\S]*?from\("propuestas_ia"\)[\s\S]*?\.eq\("empresa_id", empresaId\)/);
    expect(fn).toMatch(/from\("boletas_emitidas"\)\.select\("id"\)\.eq\("id", objetoId\)\.eq\("empresa_id", empresaId\)/);
    expect(fn).toMatch(/if \(!doc\) docId = null;/);
  });

  it("el tick del receptor sigue ANTES del insert, para cualquier tipo", () => {
    const check = fn.indexOf("No puedes compartir esto con esa persona");
    const insert = fn.indexOf('.from("team_mensajes")');
    expect(check).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(check);
    expect(fn).toMatch(/objeto_doc_id: objeto\?\.docId \?\? null/);
  });

  it("la migración amplía el tipo y agrega objeto_doc_id (NO aplicada en prod aún)", () => {
    const sql = readFileSync(MIG, "utf8");
    expect(sql).toMatch(/objeto_tipo in \('documento', 'tx', 'boleta'\)/);
    expect(sql).toMatch(/add column if not exists objeto_doc_id uuid/);
  });
});

describe("3. el globito entra y sale del modo", () => {
  const orbe = readFileSync(ORBE, "utf8");

  it("captura el click en fase de captura, respeta chat y globito, y Esc sale; y el click afuera NO cierra el chat mientras apuntas (cazado en la prueba real)", () => {
    expect(orbe).toMatch(/if \(apuntandoRef\.current\) return;/);
    expect(orbe).toMatch(/apuntandoRef\.current = Boolean\(apuntando\);/);
    expect(orbe).toMatch(/document\.addEventListener\("click", onClick, true\)/);
    expect(orbe).toMatch(/if \(bubbleRef\.current\?\.contains\(t\) \|\| orbRef\.current\?\.contains\(t\)\) return;/);
    expect(orbe).toMatch(/if \(e\.key === "Escape"\) setApuntando\(null\)/);
    expect(orbe).toMatch(/document\.body\.classList\.add\("ap-modo"\)/);
    expect(orbe).toMatch(/document\.body\.classList\.remove\("ap-modo"\)/);
  });

  it("velo + pista con el nombre de la persona, y lo apuntable se ilumina al pasar", () => {
    expect(orbe).toMatch(/Toca lo que quieres que vea <b>\{apuntando\.para\}<\/b> · Esc para salir/);
    expect(orbe).toMatch(/body\.ap-modo \[data-apuntable\]:hover\{ outline:2px solid var\(--accent\)/);
  });

  it("el chip del compose entra al modo o quita la referencia", () => {
    expect(orbe).toMatch(/onClick=\{\(\) => \(ref \? setRef\(null\) : onApuntar\(setRef\)\)\}/);
    expect(orbe).toMatch(/`Apuntando: \$\{ref\.label\}` : "Apuntar algo"/);
  });
});

describe("4. el salto por tipo", () => {
  it("documento → open-doc; tx/boleta → ir-a (pestaña + mes + resaltar); cruzando empresa viaja por sessionStorage", () => {
    const orbe = readFileSync(ORBE, "utf8");
    expect(orbe).toMatch(/new CustomEvent\(obj\.tipo === "documento" \? "massdte:open-doc" : "massdte:ir-a", \{ detail: salto \}\)/);
    const c = readFileSync("src/app/(app)/escritorio/v5/MesaController.tsx", "utf8");
    expect(c).toMatch(/detail: d\.tipo === "boleta" \? "boletas" : "emitir"/);
    expect(c).toMatch(/navigate\(\{ view: "month", month: d\.month \?\? cur \}\)/);
    expect(c).toMatch(/if \(salto\.tipo && salto\.tipo !== "documento" && salto\.id\)[\s\S]*?"massdte:ir-a"/);
    const emitir = readFileSync("src/app/(app)/escritorio/v5/EmitirTabContent.tsx", "utf8");
    expect(emitir).toMatch(/n\.add\(ref\.docId \?\? "__sueltas__"\)/);
    expect(emitir).toMatch(/if \(resaltarElemento\(ref\.id\)\) pendingResaltar\.ref = null;/);
  });
});
