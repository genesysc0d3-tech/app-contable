import { readFileSync } from "node:fs";
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
    // La pestaña nueva no le pide a la clienta recargar a mano.
    expect(fuente(V5 + "useEmisionLote.ts")).toMatch(/CABECERA_ACTUALIZAR/);
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

  it("los popups con formulario marcan data-actualizacion-espera", () => {
    for (const f of [V5 + "EmitirLoteModal.tsx", V5 + "EditorAmpliado.tsx", V5 + "EleccionEmpresaModal.tsx", V5 + "MesaTab.tsx", V5 + "LeftQuickActions.tsx", V5 + "EmitirTabContent.tsx", V5 + "EmitirDirectaView.tsx", "src/components/mapping/CartolaMapperDragDrop.tsx"]) {
      expect(fuente(f), f).toMatch(/data-actualizacion-espera/);
    }
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
