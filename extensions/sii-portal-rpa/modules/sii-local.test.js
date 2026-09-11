import { describe, it, expect } from "vitest";
import { validateSiiBoletaJob, validateLibretoBoleta } from "./sii-local.js";
import { BOLETA_LIBRETO } from "../../../src/lib/emission/sii-libreto.ts";

const futuro = () => new Date(Date.now() + 3_600_000).toISOString();
const base = (over = {}) => ({
  job_id: "j1",
  tipo_dte: 39,
  expires_at: futuro(),
  auto_emit: true,
  emisor_rut: "76.269.769-6", // RUT con DV válido
  ...over,
});

describe("validateSiiBoletaJob — gate de emisor (fail-closed)", () => {
  it("job real válido con emisor_rut válido → null (pasa)", () => {
    expect(validateSiiBoletaJob(base())).toBeNull();
  });
  it("emisión real SIN emisor_rut → EMISOR_RUT_INVALID (no abre ventana)", () => {
    expect(validateSiiBoletaJob(base({ emisor_rut: undefined }))).toBe("EMISOR_RUT_INVALID");
    expect(validateSiiBoletaJob(base({ emisor_rut: "" }))).toBe("EMISOR_RUT_INVALID");
  });
  it("emisión real con emisor_rut de DV inválido → EMISOR_RUT_INVALID", () => {
    expect(validateSiiBoletaJob(base({ emisor_rut: "76.269.769-7" }))).toBe("EMISOR_RUT_INVALID");
    expect(validateSiiBoletaJob(base({ emisor_rut: "no-rut" }))).toBe("EMISOR_RUT_INVALID");
  });
  it("acepta el RUT en cualquier formato mientras el DV sea válido", () => {
    expect(validateSiiBoletaJob(base({ emisor_rut: "762697696" }))).toBeNull();
    expect(validateSiiBoletaJob(base({ emisor_rut: "76269769-6" }))).toBeNull();
  });
  it("learn_only NO exige emisor_rut (no emite)", () => {
    expect(validateSiiBoletaJob(base({ auto_emit: false, learn_only: true, emisor_rut: undefined }))).toBeNull();
  });
  it("gates previos intactos", () => {
    expect(validateSiiBoletaJob(base({ job_id: undefined }))).toBe("JOB_ID_MISSING");
    expect(validateSiiBoletaJob(base({ tipo_dte: 33 }))).toBe("TIPO_DTE_INVALID");
    expect(validateSiiBoletaJob(base({ expires_at: new Date(Date.now() - 1000).toISOString() }))).toBe("JOB_EXPIRED");
    expect(validateSiiBoletaJob(base({ auto_emit: false, learn_only: false }))).toBe("AUTO_EMIT_OR_LEARN_ONLY_REQUIRED");
  });
});

describe("validateLibretoBoleta — fail-closed del libreto de e-Boleta", () => {
  const clon = () => JSON.parse(JSON.stringify(BOLETA_LIBRETO));

  it("ausente = válido (el worker usa fallback hardcodeado, byte-idéntico)", () => {
    expect(validateLibretoBoleta(undefined)).toBe(null);
    expect(validateLibretoBoleta(null)).toBe(null);
  });
  it("el libreto real de producción pasa", () => {
    expect(validateLibretoBoleta(BOLETA_LIBRETO)).toBe(null);
  });
  it("no-objeto se rechaza", () => {
    expect(validateLibretoBoleta("EMITIR")).toBe("LIBRETO_INVALID");
  });
  it("schema desconocido se rechaza", () => {
    expect(validateLibretoBoleta({ ...clon(), libreto_version: 99 })).toBe("LIBRETO_SCHEMA_UNKNOWN");
  });
  it("portal ajeno se rechaza", () => {
    expect(validateLibretoBoleta({ ...clon(), portal: "otro" })).toBe("LIBRETO_PORTAL_INVALID");
  });
  it("un selector fuera del vocabulario Vuetify se rechaza", () => {
    const l = clon(); l.selectores.slot = "[onclick]";
    expect(validateLibretoBoleta(l)).toBe("LIBRETO_SELECTOR_NO_PERMITIDO");
  });
  it("un selector Vuetify legítimo pasa la whitelist", () => {
    const l = clon(); l.selectores.slot = ".v-select__slot, .v-input__slot";
    expect(validateLibretoBoleta(l)).toBe(null);
  });
  it("falta un slot se rechaza", () => {
    const l = clon(); delete l.slots.tipo;
    expect(validateLibretoBoleta(l)).toBe("LIBRETO_SLOT_MISSING");
  });
  it("falta un toggle se rechaza", () => {
    const l = clon(); l.toggles.detalle = "";
    expect(validateLibretoBoleta(l)).toBe("LIBRETO_TOGGLE_MISSING");
  });
  it("el pad de limpieza vacío se rechaza", () => {
    const l = clon(); l.botones.limpiar_pad = [];
    expect(validateLibretoBoleta(l)).toBe("LIBRETO_BOTON_LISTA_INVALID");
  });
});

// Tanda 2: bloques opcionales + cinturones sobre datos que pueden emitir MAL.
describe("validateLibretoBoleta — tanda 2 (bloques opcionales y cinturones)", () => {
  const clon = () => JSON.parse(JSON.stringify(BOLETA_LIBRETO));
  const BLOQUES_NUEVOS = {
    glosa: {
      candidatos: "input[type='text'], textarea",
      excluir_dentro_de: ".v-select, .v-autocomplete",
      ancla_contador: "\\/\\s*80",
      ancla_label: "DETALLE",
      excluir_texto: "VENDEDOR|RECEPTOR|SUCURSAL|MONTO|\\bRUT\\b|PAGO|BOLETA",
    },
    modal: { titulo: "EMITIR\\s+E-BOLETA" },
    emisor: { cargando: "CARGANDO EMISORES" },
    monto_alto: { texto: "DESEA CONTINUAR|ESTA A PUNTO DE EMITIR" },
  };

  it("el libreto real + los bloques nuevos pasa", () => {
    expect(validateLibretoBoleta({ ...clon(), ...BLOQUES_NUEVOS })).toBe(null);
  });
  it("sin los bloques nuevos sigue pasando (opcionales)", () => {
    const l = clon(); delete l.glosa; delete l.modal; delete l.emisor; delete l.monto_alto; delete l.esperas;
    expect(validateLibretoBoleta(l)).toBe(null);
  });
  it("regex inválido → LIBRETO_REGEX_INVALIDO", () => {
    expect(validateLibretoBoleta({ ...clon(), modal: { titulo: "Emitir(" } })).toBe("LIBRETO_REGEX_INVALIDO");
    const l = clon(); l.receptor_campos.rut = "RUT(";
    expect(validateLibretoBoleta(l)).toBe("LIBRETO_REGEX_INVALIDO");
  });
  it("cuantificadores anidados (ReDoS) y backreferences → LIBRETO_REGEX_INVALIDO", () => {
    expect(validateLibretoBoleta({ ...clon(), glosa: { ancla_label: "(a+)+$" } })).toBe("LIBRETO_REGEX_INVALIDO");
    expect(validateLibretoBoleta({ ...clon(), glosa: { ancla_label: "(a*)*" } })).toBe("LIBRETO_REGEX_INVALIDO");
    expect(validateLibretoBoleta({ ...clon(), glosa: { ancla_label: "(a+)*" } })).toBe("LIBRETO_REGEX_INVALIDO");
    expect(validateLibretoBoleta({ ...clon(), emisor: { cargando: "(a)\\1" } })).toBe("LIBRETO_REGEX_INVALIDO");
    expect(validateLibretoBoleta({ ...clon(), monto_alto: { texto: "x".repeat(201) } })).toBe("LIBRETO_REGEX_INVALIDO");
  });
  it("selector de glosa fuera de la whitelist → LIBRETO_SELECTOR_NO_PERMITIDO", () => {
    expect(validateLibretoBoleta({ ...clon(), glosa: { candidatos: "input[type='text'], iframe" } })).toBe("LIBRETO_SELECTOR_NO_PERMITIDO");
    expect(validateLibretoBoleta({ ...clon(), glosa: { excluir_dentro_de: "[onclick]" } })).toBe("LIBRETO_SELECTOR_NO_PERMITIDO");
  });
  it("afecta/exenta cruzados o iguales → LIBRETO_TIPO_AMBIGUO", () => {
    const l = clon(); l.slots.tipo_afecta = "Boleta exenta"; l.slots.tipo_exenta = "Boleta afecta";
    expect(validateLibretoBoleta(l)).toBe("LIBRETO_TIPO_AMBIGUO");
    const m = clon(); m.slots.tipo_exenta = m.slots.tipo_afecta;
    expect(validateLibretoBoleta(m)).toBe("LIBRETO_TIPO_AMBIGUO");
  });
  it("limpiar_pad con dígito o con EMITIR → LIBRETO_PAD_NO_PERMITIDO", () => {
    const l = clon(); l.botones.limpiar_pad = ["1"];
    expect(validateLibretoBoleta(l)).toBe("LIBRETO_PAD_NO_PERMITIDO");
    const m = clon(); m.botones.limpiar_pad = ["EMITIR"];
    expect(validateLibretoBoleta(m)).toBe("LIBRETO_PAD_NO_PERMITIDO");
  });
  it("botones.emitir vetado (SI/NO/ACEPTAR/CANCELAR/dígitos) → LIBRETO_BOTON_NO_PERMITIDO", () => {
    for (const bad of ["SI", "SÍ", "NO", "ACEPTAR", "CANCELAR", "7"]) {
      const l = clon(); l.botones.emitir = bad;
      expect(validateLibretoBoleta(l)).toBe("LIBRETO_BOTON_NO_PERMITIDO");
    }
  });
  it("esperas fuera de [50, 60000] o no enteras → LIBRETO_ESPERA_INVALIDA", () => {
    expect(validateLibretoBoleta({ ...clon(), esperas: { modal_emision: "abc" } })).toBe("LIBRETO_ESPERA_INVALIDA");
    expect(validateLibretoBoleta({ ...clon(), esperas: { pad_post: 0 } })).toBe("LIBRETO_ESPERA_INVALIDA");
    expect(validateLibretoBoleta({ ...clon(), esperas: { pad_post: 60001 } })).toBe("LIBRETO_ESPERA_INVALIDA");
    expect(validateLibretoBoleta({ ...clon(), esperas: { pad_post: 250 } })).toBe(null);
  });
});
