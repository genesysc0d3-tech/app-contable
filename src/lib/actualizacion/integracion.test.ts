import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { CABECERA_VERSION } from "./version";

// Las piezas de la actualización invisible cableadas donde corresponde. Las de
// fuente (readFileSync) cuidan que nadie saque un bloqueo o una marca de popup
// sin darse cuenta: sin ellas la pestaña podría recargarse en medio de una emisión.

vi.mock("@/lib/supabase/proxy", () => ({ updateSession: async () => NextResponse.next() }));

const fuente = (p: string) => readFileSync(p, "utf8");
const V5 = "src/app/(app)/escritorio/v5/";

describe("el server publica su versión en las respuestas que ya existen", () => {
  it("el proxy estampa la cabecera (también en redirects)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://localhost/api/mesa"));
    expect(res.headers.get(CABECERA_VERSION)).toBe("dev");
    const redir = await proxy(new NextRequest("http://localhost/escritorio"));
    expect(redir.headers.get(CABECERA_VERSION)).toBe("dev");
  });

  it("/api/sw-config (ruta liviana del regreso tras >30 min) la trae y acepta HEAD", async () => {
    const mod = await import("@/app/api/sw-config/route");
    expect(mod.GET().headers.get(CABECERA_VERSION)).toBe("dev");
    expect(typeof mod.HEAD).toBe("function");
    expect(mod.HEAD().headers.get(CABECERA_VERSION)).toBe("dev");
  });

  it("EMISION_PAUSADA de pestaña vieja sigue igual y además pide ponerse al día", () => {
    const src = fuente("src/app/api/emision/jobs/route.ts");
    expect(src).toMatch(/code: "EMISION_PAUSADA", campos: cmp\.campos, detalle: DETALLE_DATOS_FALTAN/);
    expect(src).toMatch(/CABECERA_ACTUALIZAR\]: "1"/);
    // La pestaña nueva no le pide a la clienta recargar a mano… y solo dice "poniéndose
    // al día" si de verdad cambió la versión (A3).
    expect(fuente(V5 + "useEmisionLote.ts")).toMatch(/pestanaQuedoVieja\(res\.headers, versionDelCliente\(\)\)/);
  });
});

describe("momentos NO seguros declarados", () => {
  it("emisión (lote, única, barra de Emitir) y subida toman bloqueo", () => {
    expect(fuente(V5 + "useEmisionLote.ts")).toMatch(/useBloqueoActualizacion\(corriendo, "emision_lote"\)/);
    expect(fuente(V5 + "EmitirDirectaView.tsx")).toMatch(/useBloqueoActualizacion\([^)]*emitiendo[^)]*"emision_directa"\)/);
    expect(fuente(V5 + "EmitirTabContent.tsx")).toMatch(/useBloqueoActualizacion\(\s*emitiendo[\s\S]{0,300}?"emision_emitir",?\s*\)/);
    expect(fuente(V5 + "DropzoneUpload.tsx")).toMatch(/useBloqueoActualizacion\(uploading \|\| queue\.length > 0, "subida"\)/);
    // Edición inline de una propuesta (sin popup) con cambios sin guardar.
    expect(fuente(V5 + "revisar-shared.tsx")).toMatch(/useBloqueoActualizacion\(sinGuardar, "edicion_propuesta"\)/);
    expect(fuente(V5 + "revisar-shared.tsx")).toMatch(/"edicion_glosa"\)/);
  });

  it("INVENTARIO automático: todo overlay/portal/dialog/popover de la app lleva marca (o se declara libre)", () => {
    // Revisión adversarial A1 (2026-10-01): un popup sin marca perdía lo escrito al
    // recargar. Este test recorre TODOS los .tsx de la app y falla si aparece uno nuevo
    // sin `data-actualizacion-espera` / aria-modal="true" (o un comentario
    // `actualizacion-libre: <motivo>` para lo que de verdad no guarda nada).
    const faltan = inventarioOverlaysSinMarca();
    expect(faltan).toEqual([]);
  });

  it("el inventario no se burla: fixed multilínea, con top/left, Tailwind, libre lejano o marca en otra etiqueta", () => {
    const dir = mkdtempSync(join(tmpdir(), "inv-"));
    writeFileSync(join(dir, "a.tsx"), `export const A = () => (\n  <div\n    onClick={() => {}}\n    style={{\n      zIndex: 9,\n      position: "fixed",\n      top: 0, left: 0, right: 0, bottom: 0,\n    }}>\n    <input />\n  </div>\n);\n`);
    writeFileSync(join(dir, "b.tsx"), `export const B = () => <div className="fixed inset-0 bg-black/50"><textarea /></div>;\n`);
    writeFileSync(join(dir, "c.tsx"), `// actualizacion-libre: lejos\n\n\n\nexport const C = () => <div style={{ position: "fixed", inset: 0 }} />;\n`);
    writeFileSync(join(dir, "d.tsx"), `export const D = () => <div data-actualizacion-espera="">\n  <div style={{ position: "fixed", inset: 0 }} />\n</div>;\n`);
    writeFileSync(join(dir, "ok.tsx"), `export const Ok = () => (\n  <div\n    data-actualizacion-espera=""\n    style={{ position: "fixed", inset: 0 }} />\n);\n`);
    const faltan = inventarioOverlaysSinMarca([dir]).map((x) => x.replace(dir + "/", ""));
    expect(faltan).toEqual(["a.tsx:2", "b.tsx:1", "c.tsx:5", "d.tsx:2"]);
  });

  it("A2: tras una escritura se reintenta con setTimeout (nunca microtask) y con margen", () => {
    const src = fuente("src/components/ActualizadorInvisible.tsx");
    expect(src).not.toMatch(/queueMicrotask/);
    expect(src).toMatch(/msDesdeUltimaEscritura: Date\.now\(\) - ultimaEscrituraFin/);
  });

  it("M2: consulta la versión al ocultarse; sin setInterval (cero sondeo)", () => {
    const src = fuente("src/components/ActualizadorInvisible.tsx");
    expect(src).toMatch(/tocaConsultarVersion\(ultimaConsulta, Date\.now\(\)\)/);
    expect(src).not.toMatch(/setInterval/);
  });

  it("MFA: enrolando (QR en pantalla) no se recarga", () => {
    expect(fuente("src/app/(app)/seguridad/page.tsx")).toMatch(/useBloqueoActualizacion\([^)]*enrolling[^)]*"mfa"\)/);
  });
});

describe("estado que se restaura", () => {
  it("pestaña activa, doc del visor, filtros de Emitir y vista de la columna derecha", () => {
    expect(fuente(V5 + "TabsV5.tsx")).toMatch(/usePiezaEstado(<[^(]*>)?\("mesa\.tab"/);
    expect(fuente(V5 + "MesaTab.tsx")).toMatch(/usePiezaEstado(<[^(]*>)?\("check\.doc"/);
    expect(fuente(V5 + "EmitirTabContent.tsx")).toMatch(/usePiezaEstado(<[^(]*>)?\("emitir\.vista"/);
    expect(fuente(V5 + "RightColumnView.tsx")).toMatch(/usePiezaEstado(<[^(]*>)?\("derecha\.vista"/);
  });

  it("el layout de la app monta el actualizador y oculta antes de pintar", () => {
    const src = fuente("src/app/(app)/layout.tsx");
    expect(src).toMatch(/<ActualizadorInvisible \/>/);
    expect(src).toMatch(/SCRIPT_ANTES_DE_PINTAR/);
  });
});

// ── Inventario de overlays ──────────────────────────────────────────────────────
function tsxDe(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...tsxDe(p));
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/** Texto de la etiqueta JSX de apertura que contiene `pos` (de `<Tag` hasta su `>`). */
function etiquetaEn(src: string, pos: number): { inicio: number; texto: string } | null {
  // Retrocede hasta el `<Letra` de apertura más cercano que no esté cerrado antes de pos.
  for (let k = pos; k >= 0; k--) {
    if (src[k] === "<" && /[A-Za-z]/.test(src[k + 1] ?? "")) {
      const fin = finDeEtiqueta(src, k);
      if (fin >= pos) return { inicio: k, texto: src.slice(k, fin + 1) };
    }
  }
  return null;
}
function finDeEtiqueta(src: string, k: number): number {
  let llaves = 0;
  let comilla: string | null = null;
  for (let j = k + 1; j < src.length; j++) {
    const c = src[j];
    if (comilla) { if (c === comilla && src[j - 1] !== "\\") comilla = null; continue; }
    if (c === '"' || c === "'" || c === "`") { comilla = c; continue; }
    if (c === "{") llaves++;
    else if (c === "}") llaves--;
    else if (c === ">" && llaves === 0 && src[j - 1] !== "=") return j;
  }
  return src.length - 1;
}
function lineaDe(src: string, pos: number): number { return src.slice(0, pos).split("\n").length; }

export function inventarioOverlaysSinMarca(raices = ["src/app/(app)", "src/components"]): string[] {
  const archivos = raices.flatMap(tsxDe);
  // Clases CSS definidas como fixed (en cualquier forma) en cualquier archivo.
  const clasesFixed = new Set<string>();
  for (const f of archivos) {
    for (const m of fuente(f).matchAll(/\.([\w-]+)\s*\{[^}]*position:\s*fixed/g)) clasesFixed.add(m[1]);
  }
  const MARCA = /data-actualizacion-espera|aria-modal="true"/;
  const faltan = new Set<string>();
  for (const f of archivos) {
    const src = fuente(f);
    const sitios: number[] = [];
    // 1) position fixed inline en cualquier forma (una o varias líneas, con top/left/inset…)
    for (const m of src.matchAll(/position:\s*["']fixed["']/g)) sitios.push(m.index!);
    // 2) role="dialog"
    for (const m of src.matchAll(/role="dialog"/g)) sitios.push(m.index!);
    // 3) clases: Tailwind `fixed`, clases CSS fixed, o nombres de overlay/pop/modal/velo
    for (const m of src.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
      const cls = m[1].split(/\s+/);
      if (cls.some((c) => c === "fixed" || clasesFixed.has(c) || /(overlay|-pop|popup|modal|velo|veil)$/.test(c))) sitios.push(m.index!);
    }
    // 4) portales: la PRIMERA etiqueta del portal (si es un componente, se inventaría en su archivo)
    for (const m of src.matchAll(/createPortal\(\s*(\(\s*)?<([A-Za-z])/g)) {
      if (/[A-Z]/.test(m[2])) continue;
      sitios.push(src.indexOf("<", m.index!) + 1);
    }
    for (const pos of sitios) {
      const tag = etiquetaEn(src, pos);
      if (!tag) { faltan.add(`${f}:${lineaDe(src, pos)}`); continue; }
      if (MARCA.test(tag.texto)) continue;
      // Libre: SOLO un comentario en la línea inmediatamente anterior a la etiqueta.
      const lineas = src.split("\n");
      const n = lineaDe(src, tag.inicio);
      if (/actualizacion-libre:\s*\S/.test(lineas[n - 2] ?? "")) continue;
      faltan.add(`${f}:${n}`);
    }
  }
  return [...faltan].sort();
}
