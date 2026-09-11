/**
 * Invariantes del libreto (reglas del header de sii-libreto.ts). Cada dato que
 * viaja como regex/selector/lista tiene acá su test que muerde: la extensión
 * compila los regex con "i" sobre MAYÚSCULAS sin tildes, y un regex que no
 * compila, o uno catastrófico, cae al hardcode o cuelga una boleta real.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANCLA_LABELS,
  ANCLA_LABELS_BOLETA,
  ANCLAS_AUTO_KILL,
  BOLETA_LIBRETO,
  BOLETA_LIBRETO_SCHEMA_VERSION,
  CODIGOS_LIBRETO,
  COPY_LIBRETO_DESACTUALIZADO,
  FACTURA_LIBRETO,
  LIBRETO_SCHEMA_VERSION,
  copyHumanoCodigoEmision,
} from "./sii-libreto";

const REGEX_BOLETA: Record<string, string> = {
  ...Object.fromEntries(Object.entries(BOLETA_LIBRETO.receptor_campos).map(([k, v]) => [`receptor_campos.${k}`, v])),
  "glosa.ancla_contador": BOLETA_LIBRETO.glosa.ancla_contador,
  "glosa.ancla_label": BOLETA_LIBRETO.glosa.ancla_label,
  "glosa.excluir_texto": BOLETA_LIBRETO.glosa.excluir_texto,
  "modal.titulo": BOLETA_LIBRETO.modal.titulo,
  "emisor.cargando": BOLETA_LIBRETO.emisor.cargando,
  "monto_alto.texto": BOLETA_LIBRETO.monto_alto.texto,
};
const REGEX_FACTURA: Record<string, string> = Object.fromEntries(
  Object.entries(FACTURA_LIBRETO.detectores).map(([k, v]) => [`detectores.${k}`, v]),
);

// Cuantificador anidado = (…+)+ / (…*)* / (…+)* etc.: la forma clásica de ReDoS.
const CUANTIFICADOR_ANIDADO = /\([^()]*[+*][^()]*\)[+*{]/;

describe("libreto — versiones congeladas", () => {
  it("las versiones de schema NO suben (la flota 0.2.1–0.2.3 rechaza otra)", () => {
    expect(LIBRETO_SCHEMA_VERSION).toBe(1);
    expect(BOLETA_LIBRETO_SCHEMA_VERSION).toBe(1);
    expect(FACTURA_LIBRETO.libreto_version).toBe(1);
    expect(BOLETA_LIBRETO.libreto_version).toBe(1);
  });
});

describe("libreto — regex", () => {
  for (const [nombre, src] of Object.entries({ ...REGEX_BOLETA, ...REGEX_FACTURA })) {
    it(`${nombre} compila con "i", mide ≤200 y no anida cuantificadores`, () => {
      expect(() => new RegExp(src, "i")).not.toThrow();
      expect(src.length).toBeLessThanOrEqual(200);
      expect(CUANTIFICADOR_ANIDADO.test(src)).toBe(false);
    });
  }

  it("los regex nuevos calzan con lo que el worker ve (MAYÚSCULAS sin tildes)", () => {
    expect(new RegExp(BOLETA_LIBRETO.glosa.ancla_contador, "i").test("0 / 80")).toBe(true);
    expect(new RegExp(BOLETA_LIBRETO.glosa.ancla_contador, "i").test("12/80")).toBe(true);
    expect(new RegExp(BOLETA_LIBRETO.glosa.ancla_label, "i").test("DETALLE")).toBe(true);
    expect(new RegExp(BOLETA_LIBRETO.glosa.excluir_texto, "i").test("RUT RECEPTOR")).toBe(true);
    expect(new RegExp(BOLETA_LIBRETO.glosa.excluir_texto, "i").test("BRUTO")).toBe(false); // \\bRUT\\b
    expect(new RegExp(BOLETA_LIBRETO.modal.titulo, "i").test("EMITIR E-BOLETA")).toBe(true);
    expect(new RegExp(BOLETA_LIBRETO.emisor.cargando, "i").test("CARGANDO EMISORES...")).toBe(true);
    expect(new RegExp(BOLETA_LIBRETO.monto_alto.texto, "i").test("¿DESEA CONTINUAR?")).toBe(true);
  });

  it("los regex nuevos son ESPEJO del hardcode del worker (mismo match con i)", () => {
    // Pares (libreto, literal del worker) — si el worker cambia su literal, este
    // test obliga a mover el libreto con él.
    const pares: Array<[string, RegExp, string[]]> = [
      [BOLETA_LIBRETO.glosa.ancla_contador, /\/\s*80/i, ["0 / 80", "N/80", "/ 79"]],
      [BOLETA_LIBRETO.glosa.ancla_label, /detalle/i, ["DETALLE", "DETALLES", "DETAL"]],
      [BOLETA_LIBRETO.glosa.excluir_texto, /vendedor|receptor|sucursal|monto|\brut\b|pago|boleta/i, ["VENDEDOR", "RUT", "BRUTO", "MONTO TOTAL", "GLOSA"]],
      [BOLETA_LIBRETO.modal.titulo, /Emitir\s+e-Boleta/i, ["EMITIR  E-BOLETA", "EMITIR E BOLETA"]],
      // F6: hay DOS hardcodes — sii-worker.js /Cargando Emisores/i y
      // background.js regexCargando /Cargando Emisores|Cargando/i. El libreto
      // debe cubrir el SUPERCONJUNTO (el del background); se compara contra ese.
      [BOLETA_LIBRETO.emisor.cargando, /Cargando Emisores|Cargando/i, ["CARGANDO EMISORES", "CARGANDO", "LISTO"]],
      [BOLETA_LIBRETO.monto_alto.texto, /DESEA CONTINUAR|ESTA A PUNTO DE EMITIR/i, ["ESTA A PUNTO DE EMITIR", "CONTINUAR"]],
    ];
    for (const [src, hard, muestras] of pares) {
      const re = new RegExp(src, "i");
      for (const m of muestras) expect(re.test(m)).toBe(hard.test(m));
    }
  });
});

describe("libreto de boletas — invariantes de datos", () => {
  it("tipo_afecta !== tipo_exenta (si fueran iguales el worker elegiría el tipo equivocado)", () => {
    expect(BOLETA_LIBRETO.slots.tipo_afecta).not.toBe(BOLETA_LIBRETO.slots.tipo_exenta);
  });
  it("limpiar_pad no lleva dígitos (un '0' en la lista borraría/escribiría un monto)", () => {
    for (const b of BOLETA_LIBRETO.botones.limpiar_pad) expect(/\d/.test(b)).toBe(false);
    expect(BOLETA_LIBRETO.botones.limpiar_pad.length).toBeGreaterThan(0);
  });
  it("glosa.candidatos solo apunta a input/textarea y excluye los v-select", () => {
    expect(BOLETA_LIBRETO.glosa.candidatos).toBe("input[type='text'], textarea");
    expect(BOLETA_LIBRETO.glosa.excluir_dentro_de).toBe(".v-select, .v-autocomplete");
  });
  it("todo selector Vuetify sigue en la whitelist de clases (.v-…, [role='option'], label)", () => {
    for (const sel of Object.values(BOLETA_LIBRETO.selectores)) {
      for (const parte of sel.split(",").map((s) => s.trim())) {
        expect(parte).toMatch(/^(\.v-[a-z0-9_-]+(\.v-[a-z0-9_-]+)*|\[role='option'\]|label)$/);
      }
    }
  });
  it("las anclas nuevas tienen explicación en cristiano", () => {
    for (const k of ["glosa", "modal.titulo", "slots.sucursal", "receptor_campos.rut", "page_kind:unknown"]) {
      expect(ANCLA_LABELS_BOLETA[k]).toBeTruthy();
    }
  });
});

// ── F5: toda ancla que EMITE el worker tiene label (nada cae a "otro") ──────
// cambio-sii/route.ts normaliza a "otro" cualquier rol fuera de ANCLA_LABELS /
// ANCLA_LABELS_BOLETA; "otro" nunca cuenta para el auto-kill ni para el
// finding crítico del panel. Este test lee los workers REALES y muerde si un
// ancla nueva (o un `campos.<rol>` del libreto) quedó sin explicación.
const EXT_DIR = resolve(__dirname, "../../../extensions/sii-portal-rpa");
function anclasEmitidas(archivo: string): string[] {
  const src = readFileSync(resolve(EXT_DIR, archivo), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/\bancla:\s*"([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bcambioSii\(\s*"([^"]+)"/g)) out.add(m[1]);
  return [...out];
}
const LABELS_TODOS = { ...ANCLA_LABELS, ...ANCLA_LABELS_BOLETA };

describe("anclas del worker ↔ labels del server (F5)", () => {
  const boletas = anclasEmitidas("sii-worker.js");
  const facturas = anclasEmitidas("facturas-worker.js");

  it("el barrido encuentra anclas en ambos workers (si da 0, el regex quedó ciego)", () => {
    expect(boletas.length).toBeGreaterThan(5);
    expect(facturas.length).toBeGreaterThan(3);
  });
  for (const a of boletas) {
    it(`boletas: "${a}" tiene label`, () => {
      expect(ANCLA_LABELS_BOLETA[a], `falta ANCLA_LABELS_BOLETA["${a}"]`).toBeTruthy();
    });
  }
  for (const a of facturas) {
    it(`facturas: "${a}" tiene label`, () => {
      expect(ANCLA_LABELS[a], `falta ANCLA_LABELS["${a}"]`).toBeTruthy();
    });
  }
  it("facturas: TODOS los roles de FacturaLibreto.campos tienen label campos.<rol> (FORMULARIO_SIN_CAMPO avisa por rol)", () => {
    for (const rol of Object.keys(FACTURA_LIBRETO.campos)) {
      expect(ANCLA_LABELS[`campos.${rol}`], `falta ANCLA_LABELS["campos.${rol}"]`).toBeTruthy();
    }
    for (const sel of Object.keys(FACTURA_LIBRETO.selectores)) {
      expect(ANCLA_LABELS[`selectores.${sel}`], `falta ANCLA_LABELS["selectores.${sel}"]`).toBeTruthy();
    }
  });
  it("boletas: selectores, slots y toggles del libreto tienen label", () => {
    for (const k of ["selectores.menu", "selectores.opcion", "selectores.slot", "slots.metodo_pago", "toggles.receptor", "slots.tipo", "slots.sucursal"]) {
      expect(ANCLA_LABELS_BOLETA[k], `falta ANCLA_LABELS_BOLETA["${k}"]`).toBeTruthy();
    }
  });
  it("'otro' NO es un label: es la normalización del server para lo desconocido", () => {
    expect(LABELS_TODOS["otro"]).toBeUndefined();
  });
});

describe("allowlist del auto-kill (F1a)", () => {
  it("cada ancla estructural existe en los labels (si no, el server la volvería 'otro' y jamás contaría)", () => {
    for (const a of ANCLAS_AUTO_KILL) expect(LABELS_TODOS[a], `ANCLAS_AUTO_KILL tiene "${a}" sin label`).toBeTruthy();
  });
  it("slots, toggles, pago, receptor, glosa y 'otro' NUNCA cuentan", () => {
    for (const a of ["slots.tipo", "slots.sucursal", "slots.metodo_pago", "toggles.receptor", "toggles.detalle", "receptor_campos.rut", "glosa", "campos.rut_recep", "campos.glosa_textarea", "otro"]) {
      expect(ANCLAS_AUTO_KILL.has(a), `"${a}" no debería contar para el auto-kill`).toBe(false);
    }
  });
  it("las estructurales pedidas están", () => {
    for (const a of ["botones.emitir", "selectores.dialogo_activo", "modal.titulo", "selectores.emisor_select", "forms.preview", "forms.formulario", "forms.selector_empresa", "campos.emisor_select", "campos.boton_validar", "campos.boton_firmar", "selectores.submit_empresa", "page_kind:unknown"]) {
      expect(ANCLAS_AUTO_KILL.has(a)).toBe(true);
    }
  });
});

describe("copy humano de códigos", () => {
  it("todo LIBRETO_* → 'actualiza tu extensión'", () => {
    for (const c of CODIGOS_LIBRETO) expect(copyHumanoCodigoEmision(c)).toBe(COPY_LIBRETO_DESACTUALIZADO);
    expect(copyHumanoCodigoEmision("LIBRETO_LO_QUE_SEA")).toBe(COPY_LIBRETO_DESACTUALIZADO);
  });
  it("EMISION_PAUSADA usa el detalle del server si viene; si no, un copy propio", () => {
    expect(copyHumanoCodigoEmision("EMISION_PAUSADA", "Pausamos boletas.")).toBe("Pausamos boletas.");
    expect(copyHumanoCodigoEmision("EMISION_PAUSADA")).toContain("Pausamos la emisión");
  });
  it("código desconocido → null (el caller usa su genérico)", () => {
    expect(copyHumanoCodigoEmision("OTRA_COSA")).toBeNull();
    expect(copyHumanoCodigoEmision(null)).toBeNull();
  });
});
