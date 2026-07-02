import { describe, expect, it } from "vitest";
import { generarDTE, generarTED, generarTrackId, type BoletaDTEArgs } from "./dte-xml";

function baseArgs(overrides: Partial<BoletaDTEArgs> = {}): BoletaDTEArgs {
  return {
    tipo_dte: 39,
    folio: 12,
    fecha_emision: "2026-06-29",
    emisor: {
      rut: "76.123.456-7",
      razon_social: "AlphaCode SpA",
      giro: "Servicios informaticos",
      direccion: "Calle Falsa 123",
      comuna: "Santiago",
    },
    totales: { neto: 1000, exento: 0, iva: 190, total: 1190 },
    detalles: [{ nombre: "Servicio de asesoria", monto: 1190 }],
    ...overrides,
  };
}

const exentaArgs = (overrides: Partial<BoletaDTEArgs> = {}) =>
  baseArgs({
    tipo_dte: 41,
    totales: { neto: 0, exento: 50_000, iva: 0, total: 50_000 },
    detalles: [{ nombre: "Venta USDT P2P", monto: 50_000 }],
    ...overrides,
  });

describe("generarDTE — estructura y prolog", () => {
  it("emite prolog ISO-8859-1 y comentario MOCK de Boleta para 39/41", () => {
    expect(generarDTE(baseArgs())).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(generarDTE(baseArgs())).toContain("<!-- DTE MOCK Boleta");
    expect(generarDTE(exentaArgs())).toContain("<!-- DTE MOCK Boleta");
  });

  it("Document ID usa el RUT limpio (sin puntos ni guion): BE-<rut>-<tipo>-<folio>", () => {
    const xml = generarDTE(baseArgs());
    expect(xml).toContain('<Documento ID="BE-761234567-39-12">');
    expect(xml).toContain('URI="#BE-761234567-39-12"');
  });

  it("IdDoc lleva tipo, folio, fecha e IndServicio=3", () => {
    const xml = generarDTE(baseArgs());
    expect(xml).toContain("<TipoDTE>39</TipoDTE>");
    expect(xml).toContain("<Folio>12</Folio>");
    expect(xml).toContain("<FchEmis>2026-06-29</FchEmis>");
    expect(xml).toContain("<IndServicio>3</IndServicio>");
  });

  it("incluye el TED embebido y una firma XMLDSig con valor de 64 hex", () => {
    const xml = generarDTE(baseArgs());
    expect(xml).toContain('<TED version="1.0">');
    expect(xml).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    expect(xml).toMatch(/<SignatureValue>[0-9a-f]{64}<\/SignatureValue>/);
    expect(xml).toMatch(/<DigestValue>[0-9a-f]{64}<\/DigestValue>/);
  });
});

describe("generarDTE — afecto (39) vs exento (41)", () => {
  it("boleta afecta descompone en MntNeto + TasaIVA 19 + IVA, sin MntExe", () => {
    const xml = generarDTE(baseArgs());
    expect(xml).toContain("<MntNeto>1000</MntNeto>");
    expect(xml).toContain("<TasaIVA>19</TasaIVA>");
    expect(xml).toContain("<IVA>190</IVA>");
    expect(xml).toContain("<MntTotal>1190</MntTotal>");
    expect(xml).not.toContain("<MntExe>");
  });

  it("boleta exenta lleva MntExe y MntTotal, sin neto/IVA", () => {
    const xml = generarDTE(exentaArgs());
    expect(xml).toContain("<MntExe>50000</MntExe>");
    expect(xml).toContain("<MntTotal>50000</MntTotal>");
    expect(xml).not.toContain("<MntNeto>");
    expect(xml).not.toContain("<TasaIVA>");
    expect(xml).not.toContain("<IVA>");
  });
});

describe("generarDTE — emisor opcionales y receptor", () => {
  it("incluye giro/direccion/comuna del emisor cuando estan presentes", () => {
    const xml = generarDTE(baseArgs());
    expect(xml).toContain("<RUTEmisor>76.123.456-7</RUTEmisor>");
    expect(xml).toContain("<RznSocEmisor>AlphaCode SpA</RznSocEmisor>");
    expect(xml).toContain("<GiroEmisor>Servicios informaticos</GiroEmisor>");
    expect(xml).toContain("<DirOrigen>Calle Falsa 123</DirOrigen>");
    expect(xml).toContain("<CmnaOrigen>Santiago</CmnaOrigen>");
  });

  it("omite los tags opcionales del emisor cuando son null", () => {
    const xml = generarDTE(baseArgs({ emisor: { rut: "76.123.456-7", razon_social: "AlphaCode SpA", giro: null, direccion: null, comuna: null } }));
    expect(xml).not.toContain("<GiroEmisor>");
    expect(xml).not.toContain("<DirOrigen>");
    expect(xml).not.toContain("<CmnaOrigen>");
    // el RznSocEmisor sigue presente (obligatorio)
    expect(xml).toContain("<RznSocEmisor>AlphaCode SpA</RznSocEmisor>");
  });

  it("renderiza el bloque Receptor cuando hay RUT receptor", () => {
    const xml = generarDTE(baseArgs({ receptor: { rut: "12.345.678-5", razon_social: "Cliente SpA", direccion: "Av 1", comuna: "Provi" } }));
    expect(xml).toContain("<Receptor>");
    expect(xml).toContain("<RUTRecep>12.345.678-5</RUTRecep>");
    expect(xml).toContain("<RznSocRecep>Cliente SpA</RznSocRecep>");
    expect(xml).toContain("<DirRecep>Av 1</DirRecep>");
    expect(xml).toContain("<CmnaRecep>Provi</CmnaRecep>");
  });

  it("omite el bloque Receptor cuando no hay RUT receptor", () => {
    const xml = generarDTE(baseArgs());
    expect(xml).not.toContain("<Receptor>");
    expect(xml).not.toContain("<RUTRecep>");
  });
});

describe("generarDTE — detalle", () => {
  it("numera las lineas y agrega Qty/Prc solo cuando vienen", () => {
    const xml = generarDTE(
      baseArgs({
        totales: { neto: 1681, exento: 0, iva: 319, total: 2000 },
        detalles: [
          { nombre: "Item con cantidad", monto: 1000, cantidad: 2, precio_unitario: 500 },
          { nombre: "Item simple", monto: 1000 },
        ],
      }),
    );
    expect(xml).toContain("<NroLinDet>1</NroLinDet>");
    expect(xml).toContain("<NmbItem>Item con cantidad</NmbItem>");
    expect(xml).toContain("<QtyItem>2</QtyItem>");
    expect(xml).toContain("<PrcItem>500</PrcItem>");
    expect(xml).toContain("<MontoItem>1000</MontoItem>");
    expect(xml).toContain("<NroLinDet>2</NroLinDet>");
    expect(xml).toContain("<NmbItem>Item simple</NmbItem>");
    // la segunda linea no trae Qty/Prc
    const segunda = xml.slice(xml.indexOf("<NroLinDet>2</NroLinDet>"));
    expect(segunda).not.toContain("<QtyItem>");
    expect(segunda).not.toContain("<PrcItem>");
  });
});

describe("generarDTE — escape de caracteres XML", () => {
  it("escapa & < > \" ' en la razon social del emisor", () => {
    const xml = generarDTE(baseArgs({ emisor: { rut: "76.123.456-7", razon_social: `Tom & Jerry's <Café> "Bar"`, giro: null, direccion: null, comuna: null } }));
    expect(xml).toContain(`<RznSocEmisor>Tom &amp; Jerry&apos;s &lt;Café&gt; &quot;Bar&quot;</RznSocEmisor>`);
    // los caracteres crudos peligrosos no deben quedar sin escapar
    expect(xml).not.toContain("Jerry's");
    expect(xml).not.toContain("<Café>");
  });

  it("escapa caracteres especiales en el nombre del item", () => {
    const xml = generarDTE(baseArgs({ detalles: [{ nombre: `Plan <Pro> & "Co"`, monto: 1190 }] }));
    expect(xml).toContain(`<NmbItem>Plan &lt;Pro&gt; &amp; &quot;Co&quot;</NmbItem>`);
  });
});

describe("generarDTE — nota de credito (61)", () => {
  const ncArgs = baseArgs({
    tipo_dte: 61,
    totales: { neto: 0, exento: 1190, iva: 0, total: 1190 },
    referencia: { tipo_doc: 39, folio: 5, fecha: "2026-06-01", razon: "Anula boleta <duplicada>", cod_ref: 1 },
  });

  it("marca el comentario como NotaCredito y usa la rama exenta (MntExe)", () => {
    const xml = generarDTE(ncArgs);
    expect(xml).toContain("<!-- DTE MOCK NotaCredito");
    expect(xml).toContain("<TipoDTE>61</TipoDTE>");
    expect(xml).toContain("<MntExe>1190</MntExe>");
    expect(xml).not.toContain("<MntNeto>");
  });

  it("incluye el bloque Referencia con tipo/folio/cod y razon escapada", () => {
    const xml = generarDTE(ncArgs);
    expect(xml).toContain("<Referencia>");
    expect(xml).toContain("<TpoDocRef>39</TpoDocRef>");
    expect(xml).toContain("<FolioRef>5</FolioRef>");
    expect(xml).toContain("<FchRef>2026-06-01</FchRef>");
    expect(xml).toContain("<CodRef>1</CodRef>");
    expect(xml).toContain("<RazonRef>Anula boleta &lt;duplicada&gt;</RazonRef>");
  });

  it("omite Referencia cuando la boleta no la trae", () => {
    expect(generarDTE(baseArgs())).not.toContain("<Referencia>");
  });
});

describe("generarDTE — folios borde", () => {
  it("respeta folio 0 verbatim en Folio y en el TED (F)", () => {
    const xml = generarDTE(baseArgs({ folio: 0 }));
    expect(xml).toContain("<Folio>0</Folio>");
    expect(xml).toContain("<F>0</F>");
    expect(xml).toContain('ID="BE-761234567-39-0"');
  });

  it("respeta folios grandes (8 digitos)", () => {
    const xml = generarDTE(baseArgs({ folio: 99_999_999 }));
    expect(xml).toContain("<Folio>99999999</Folio>");
    expect(xml).toContain("<F>99999999</F>");
  });
});

describe("generarTED — timbre electronico", () => {
  it("contiene los campos obligatorios del DD (RE, TD, F, FE, MNT, IT1)", () => {
    const ted = generarTED(baseArgs());
    expect(ted).toContain('<TED version="1.0">');
    expect(ted).toContain("<RE>76.123.456-7</RE>");
    expect(ted).toContain("<TD>39</TD>");
    expect(ted).toContain("<F>12</F>");
    expect(ted).toContain("<FE>2026-06-29</FE>");
    expect(ted).toContain("<MNT>1190</MNT>");
    expect(ted).toContain("<IT1>Servicio de asesoria</IT1>");
  });

  it("usa receptor generico (66666666-6 / Sin Receptor) cuando no hay receptor", () => {
    const ted = generarTED(baseArgs());
    expect(ted).toContain("<RR>66666666-6</RR>");
    expect(ted).toContain("<RSR>Sin Receptor</RSR>");
  });

  it("usa el receptor real cuando viene", () => {
    const ted = generarTED(baseArgs({ receptor: { rut: "12.345.678-5", razon_social: "Cliente SpA" } }));
    expect(ted).toContain("<RR>12.345.678-5</RR>");
    expect(ted).toContain("<RSR>Cliente SpA</RSR>");
  });

  it("trunca el IT1 a 40 caracteres", () => {
    const nombre = "A".repeat(50);
    const ted = generarTED(baseArgs({ detalles: [{ nombre, monto: 1190 }] }));
    expect(ted).toContain(`<IT1>${"A".repeat(40)}</IT1>`);
    expect(ted).not.toContain(`<IT1>${"A".repeat(41)}`);
  });

  it("escapa caracteres especiales en el RSR del receptor", () => {
    const ted = generarTED(baseArgs({ receptor: { rut: "12.345.678-5", razon_social: `R&D <S.A.>` } }));
    expect(ted).toContain("<RSR>R&amp;D &lt;S.A.&gt;</RSR>");
  });

  it("las firmas mock FRMA y FRMT son 64 hex y deterministas para los mismos datos", () => {
    const a = generarTED(baseArgs());
    const b = generarTED(baseArgs());
    const frmt = (s: string) => s.match(/<FRMT algoritmo="SHA1withRSA">([0-9a-f]{64})<\/FRMT>/)?.[1];
    const frma = (s: string) => s.match(/<FRMA algoritmo="SHA1withRSA">([0-9a-f]{64})<\/FRMA>/)?.[1];
    expect(frmt(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(frma(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(frmt(a)).toBe(frmt(b));
    expect(frma(a)).toBe(frma(b));
  });

  it("la FRMT cambia cuando cambia el monto total (entra en el hash)", () => {
    const frmt = (s: string) => s.match(/<FRMT algoritmo="SHA1withRSA">([0-9a-f]{64})<\/FRMT>/)?.[1];
    const a = generarTED(baseArgs());
    const b = generarTED(baseArgs({ totales: { neto: 2000, exento: 0, iva: 380, total: 2380 } }));
    expect(frmt(a)).not.toBe(frmt(b));
  });
});

describe("generarTrackId", () => {
  it("siempre devuelve un track id numerico de 10 digitos", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generarTrackId()).toMatch(/^\d{10}$/);
    }
  });
});
