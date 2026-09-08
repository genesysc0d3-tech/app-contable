import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Censo de los tres arreglos del 2026-09-07 (Matías + fundador):
 * (1) en la mesa de facturas todo se llama factura y la info no se cruza;
 * (2) aviso exenta-con-actividad-afecta: triangulito con globito por tx y
 *     por cartola + disclaimer en el popup del botón Emitir, sin bloquear;
 * (3) en cuenta ajena el botón de configuración de empresa queda gris.
 */
const V5 = "src/app/(app)/escritorio/v5/";
const leer = (p: string) => readFileSync(p, "utf8");

describe("1. el nombre sale del tipo, en un solo lugar", () => {
  const conPdf = [
    "src/components/boletas/DescargarBoletaButton.tsx",
    "src/components/boletas/PreviewBoletaButton.tsx",
    "src/lib/pdf/boleta-pdf.ts",
    "src/app/api/intermediaria/boleta/[id]/pdf/route.ts",
    "src/app/api/intermediaria/boleta/[id]/pdf-personalizada/route.ts",
  ];

  it("ningún PDF se llama 'boleta-<tipo>-<folio>' a mano: todos pasan por archivoPdf", () => {
    for (const p of conPdf) {
      const src = leer(p);
      expect(src, p).not.toMatch(/boleta-(sii-|proveedor-legado-)?\$\{/);
      expect(src, p).not.toMatch(/factura-\$\{/);
      expect(src, p).toMatch(/archivoPdf\(/);
    }
  });

  it("el PDF de prueba (mock) titula FACTURA cuando el tipo es 33/34", () => {
    const src = leer("src/lib/pdf/boleta-pdf.ts");
    expect(src).toMatch(/isFactura \? \(isExenta \? "FACTURA NO AFECTA O EXENTA ELECTRÓNICA" : "FACTURA ELECTRÓNICA"\)/);
    expect(src).toMatch(/const isExenta = esTipoExento\(b\.tipo_dte\)/);
  });

  it("la lista de la mesa y el visor sellan por tipo (una 33 ya no dice 'DTE 33' ni 'Boleta #')", () => {
    const mesa = leer(V5 + "Mesa.tsx");
    expect(mesa).toMatch(/>\{etiquetaTipo\(b\.tipo_dte\)\}<\/span>/);
    expect(mesa).toMatch(/data-apuntable-label=\{`\$\{tituloDocumento\(b\.tipo_dte, b\.folio\)\}/);
    expect(mesa).not.toMatch(/`DTE \$\{b\.tipo_dte\}`/);
    expect(mesa).toMatch(/`Aún no hay \$\{plural\}`/);
    const visor = leer(V5 + "BoletaVisor.tsx");
    expect(visor).toMatch(/\{tituloDocumento\(boleta\.tipo_dte, boleta\.folio\)\}/);
    expect(visor).toMatch(/33: \{ label: "Afecta · con IVA · 33"/);
    const page = leer(V5 + "page.tsx");
    expect(page).toMatch(/label: tituloDocumento\(bol\.tipo_dte, bol\.folio\)/);
    expect(page).toMatch(/subtitle: etiquetaTipo\(bol\.tipo_dte\)/);
  });
});

describe("2. aviso exenta con actividad afecta (avisar, no bloquear)", () => {
  const emitir = leer(V5 + "EmitirTabContent.tsx");

  it("se enciende SOLO con el tipo del carril en 'afecto' y el documento exento", () => {
    expect(emitir).toMatch(/const emisorAfecto = empresaTipo === "afecto";/);
    expect(emitir).toMatch(/const avisaExenta = \(i: Item\): boolean => emisorAfecto && esTipoExento\(tipoDe\(i\)\);/);
  });

  it("la mesa le pasa el tipo YA resuelto por carril", () => {
    expect(leer(V5 + "Mesa.tsx")).toMatch(/<EmitirTabContent [^>]*empresaTipo=\{empresaTipo\}/);
    expect(leer(V5 + "page.tsx")).toMatch(/empresaTipo=\{mesaParam === "factura" \? tipoFacturas : tipoBoletas\}/);
  });

  it("triangulito con globito en cada tx y en cada cartola", () => {
    expect(emitir).toMatch(/\{avisaExenta\(item\) && <AvisoExentaAfecto texto=\{AVISO_EXENTA_TX\} \/>\}/);
    expect(emitir).toMatch(/const nEx = emitibles\.filter\(avisaExenta\)\.length; return nEx > 0 \? <AvisoExentaAfecto texto=\{avisoExentaDoc\(nEx\)\}/);
    const aviso = leer(V5 + "AvisoExentaAfecto.tsx");
    expect(aviso).toMatch(/\.ax-wrap:hover \.ax-tip/);
    expect(aviso).toMatch(/role="tooltip"/);
  });

  it("disclaimer en el popup del botón Emitir; el botón sigue habilitado (no se bloquea)", () => {
    expect(emitir).toMatch(/\{emisorAfecto && selExenta > 0 && \(\s*<div data-aviso="exenta-afecto"/);
    expect(emitir).toMatch(/disabled=\{esFacturas && selSinFormaPago\.length > 0\}/);
    expect(emitir).not.toMatch(/disabled=\{[^}]*emisorAfecto/);
  });

  it("el carril REAL (EmitirLoteModal) también muestra el disclaimer — cazado en vivo 2026-09-08: el modal de confirmación solo era del carril de prueba", () => {
    expect(emitir).toMatch(/avisoExentas=\{emisorAfecto \? \(loteResume \?\? selectedItems\)\.filter\(\(i\) => esTipoExento\(i\.tipo_sugerido \?\? \(esFacturas \? 33 : 39\)\)\)\.length : 0\}/);
    const lote = leer(V5 + "EmitirLoteModal.tsx");
    expect(lote).toMatch(/\{avisoExentas > 0 && \(\s*<div data-aviso="exenta-afecto"/);
    expect(lote).toMatch(/<Idle [^>]*avisoExentas=\{avisoExentas\}/);
  });
});

describe("3. cuenta ajena: configuración de empresa gris", () => {
  it("el botón no abre el wizard y se ve deshabilitado", () => {
    const src = leer(V5 + "LeftQuickActions.tsx");
    expect(src).toMatch(/export function HeaderActionsRow\(\{ enCuentaAjena = false, cuentaActualNombre = "" \}/);
    expect(src).toMatch(/if \(!enCuentaAjena\) window\.dispatchEvent\(new CustomEvent\("toggle-empresa"\)\)/);
    expect(src).toMatch(/disabled=\{enCuentaAjena\}/);
    expect(src).toMatch(/la configuración la maneja el titular/);
  });

  it("page.tsx le pasa el estado real de la cuenta", () => {
    expect(leer(V5 + "page.tsx")).toMatch(/<HeaderActionsRow enCuentaAjena=\{enCuentaAjena\} cuentaActualNombre=\{cuentaActualNombre\} \/>/);
  });
});
