import { describe, expect, it } from "vitest";
import {
  avisoParaEmpresa,
  avisoParaMesa,
  avisoVigente,
  formatoEfectivo,
  mesaDeUbicacion,
  ordenarCola,
  partesMarkdown,
  validarAvisoInput,
  versionCumple,
  type AvisoApp,
} from "./reglas";

// Reglas puras de los avisos (2026-10-01). Son el ESPEJO de lo que hace el RLS
// (vigencia + audiencia) más lo que el RLS no puede saber (mesa que se está
// mirando, versión de la pestaña). El RLS manda en la base; esto manda en pantalla.

const NOW = new Date("2026-10-01T15:00:00Z");
function aviso(p: Partial<AvisoApp> = {}): AvisoApp {
  return {
    id: "a1",
    tipo: "novedad",
    titulo: "Hola",
    cuerpo: "",
    formato: "toast",
    desde: "2026-10-01T00:00:00Z",
    hasta: "2026-10-08T00:00:00Z",
    empresa_ids: null,
    mesa: null,
    version_min: null,
    created_at: "2026-10-01T00:00:00Z",
    ...p,
  };
}

describe("vigencia", () => {
  it("vive entre desde (incluido) y hasta (excluido)", () => {
    expect(avisoVigente(aviso(), NOW)).toBe(true);
    expect(avisoVigente(aviso({ desde: "2026-10-01T15:00:00Z" }), NOW)).toBe(true);
    expect(avisoVigente(aviso({ desde: "2026-10-01T15:00:01Z" }), NOW)).toBe(false);
    expect(avisoVigente(aviso({ hasta: "2026-10-01T15:00:00Z" }), NOW)).toBe(false);
    expect(avisoVigente(aviso({ hasta: "2026-09-30T00:00:00Z" }), NOW)).toBe(false);
  });
  it("fechas rotas = no vigente (fail-safe: no se muestra)", () => {
    expect(avisoVigente(aviso({ desde: "basura" }), NOW)).toBe(false);
    expect(avisoVigente(aviso({ hasta: "" }), NOW)).toBe(false);
  });
});

describe("audiencia", () => {
  it("empresa_ids null = todas; con lista, solo esas", () => {
    expect(avisoParaEmpresa(aviso(), "e1")).toBe(true);
    expect(avisoParaEmpresa(aviso({ empresa_ids: ["e1", "e2"] }), "e2")).toBe(true);
    expect(avisoParaEmpresa(aviso({ empresa_ids: ["e1"] }), "e9")).toBe(false);
    expect(avisoParaEmpresa(aviso({ empresa_ids: ["e1"] }), null)).toBe(false);
  });
  it("mesa null = en cualquier parte; con mesa, solo mirando esa mesa", () => {
    expect(avisoParaMesa(aviso(), null)).toBe(true);
    expect(avisoParaMesa(aviso({ mesa: "facturas" }), "facturas")).toBe(true);
    expect(avisoParaMesa(aviso({ mesa: "facturas" }), "boletas")).toBe(false);
    expect(avisoParaMesa(aviso({ mesa: "boletas" }), null)).toBe(false);
  });
  it("la mesa se lee de la URL de massDTE (boleta por defecto) y fuera de la mesa no hay", () => {
    expect(mesaDeUbicacion("/massdte", "")).toBe("boletas");
    expect(mesaDeUbicacion("/massdte", "?mesa=factura")).toBe("facturas");
    expect(mesaDeUbicacion("/escritorio/v5", "?mesa=boleta&view=mes")).toBe("boletas");
    expect(mesaDeUbicacion("/empresa", "?mesa=factura")).toBe(null);
  });
});

describe("versión mínima (novedades de esta versión)", () => {
  const pestana = { version: "abc123def456", builtAt: "2026-10-01T12:00:00.000Z" };
  it("sin versión mínima: siempre", () => {
    expect(versionCumple(null, pestana)).toBe(true);
    expect(versionCumple("  ", pestana)).toBe(true);
  });
  it("por fecha de build: la pestaña igual o más nueva cumple; la vieja espera", () => {
    expect(versionCumple("2026-10-01T12:00:00.000Z", pestana)).toBe(true);
    expect(versionCumple("2026-10-01T11:00:00Z", pestana)).toBe(true);
    expect(versionCumple("2026-10-01T13:00:00Z", pestana)).toBe(false);
    // pestaña sin fecha de build (build viejo): no se le muestran novedades que quizás no tiene
    expect(versionCumple("2026-10-01T11:00:00Z", { version: "x", builtAt: null })).toBe(false);
  });
  it("por commit: solo esa versión exacta (prefijo de al menos 7)", () => {
    expect(versionCumple("abc123d", pestana)).toBe(true);
    expect(versionCumple("abc123def456", pestana)).toBe(true);
    expect(versionCumple("abc12", pestana)).toBe(false);
    expect(versionCumple("fff0000", pestana)).toBe(false);
  });
});

describe("formato y cola", () => {
  it("popup solo para urgentes: un popup no urgente baja a tarjeta", () => {
    expect(formatoEfectivo(aviso({ tipo: "urgente", formato: "popup" }))).toBe("popup");
    expect(formatoEfectivo(aviso({ tipo: "novedad", formato: "popup" }))).toBe("tarjeta");
    expect(formatoEfectivo(aviso({ tipo: "mantencion", formato: "toast" }))).toBe("toast");
  });
  it("cola: urgentes primero, después por fecha de inicio", () => {
    const cola = ordenarCola([
      aviso({ id: "n2", desde: "2026-10-01T02:00:00Z" }),
      aviso({ id: "u", tipo: "urgente", formato: "popup", desde: "2026-10-01T03:00:00Z" }),
      aviso({ id: "n1", desde: "2026-10-01T01:00:00Z" }),
    ]);
    expect(cola.map((a) => a.id)).toEqual(["u", "n1", "n2"]);
  });
});

describe("markdown mínimo (negritas y links), sin HTML", () => {
  it("negritas y links seguros", () => {
    expect(partesMarkdown("Hola **mundo** y [la guía](https://massdte.cl/ayuda).")).toEqual([
      { t: "texto", v: "Hola " },
      { t: "negrita", v: "mundo" },
      { t: "texto", v: " y " },
      { t: "link", v: "la guía", href: "https://massdte.cl/ayuda" },
      { t: "texto", v: "." },
    ]);
    expect(partesMarkdown("[Empresa](/empresa)")).toEqual([{ t: "link", v: "Empresa", href: "/empresa" }]);
  });
  it("links peligrosos quedan como texto; el HTML no se interpreta", () => {
    expect(partesMarkdown("[x](javascript:alert(1))")).toEqual([{ t: "texto", v: "[x](javascript:alert(1))" }]);
    expect(partesMarkdown("[x](//evil.com)")).toEqual([{ t: "texto", v: "[x](//evil.com)" }]);
    expect(partesMarkdown("<b>hola</b>")).toEqual([{ t: "texto", v: "<b>hola</b>" }]);
  });
});

describe("validación de lo que escribe el operador", () => {
  const base = {
    tipo: "novedad",
    formato: "toast",
    titulo: "Nueva vista de facturas",
    cuerpo: "Ahora puedes **filtrar**.",
    desde: "2026-10-01T12:00:00.000Z",
    hasta: "2026-10-08T12:00:00.000Z",
    empresaIds: [] as string[],
    mesa: null,
    versionMin: "",
  };
  it("acepta lo normal y normaliza (sin empresas = todas, versión vacía = null)", () => {
    const r = validarAvisoInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fila.empresa_ids).toBeNull();
      expect(r.fila.version_min).toBeNull();
      expect(r.fila.titulo).toBe("Nueva vista de facturas");
    }
  });
  it("rechaza: popup no urgente, hasta antes de desde, título vacío, tipo raro, UUID malo, mesa rara", () => {
    expect(validarAvisoInput({ ...base, formato: "popup" }).ok).toBe(false);
    expect(validarAvisoInput({ ...base, hasta: base.desde }).ok).toBe(false);
    expect(validarAvisoInput({ ...base, titulo: "   " }).ok).toBe(false);
    expect(validarAvisoInput({ ...base, tipo: "promo" }).ok).toBe(false);
    expect(validarAvisoInput({ ...base, empresaIds: ["no-es-uuid"] }).ok).toBe(false);
    expect(validarAvisoInput({ ...base, mesa: "todas" }).ok).toBe(false);
    expect(validarAvisoInput({ ...base, cuerpo: "x".repeat(601) }).ok).toBe(false);
  });
  it("urgente + popup sí", () => {
    expect(validarAvisoInput({ ...base, tipo: "urgente", formato: "popup" }).ok).toBe(true);
  });
});
