/**
 * Generador de XML DTE (Documento Tributario Electrónico) para boletas.
 * Sigue el esquema oficial del SII (EnvioBOLETA_v10.xsd) en su estructura.
 *
 * NOTA: este XML es MOCK. La firma (FRMT del TED) y la firma del documento
 * (XMLDSig) son strings determinísticos, NO criptografía real. El sistema NO
 * envía nada al SII real — solo genera la estructura para que la app pueda
 * mostrar/almacenar/exportar lo mismo que vería un emisor productivo.
 */

import type { DetalleLinea, TipoDTE } from "./validation";
import { cleanRut } from "./validation";

export interface BoletaDTEArgs {
  tipo_dte: TipoDTE;
  folio: number;
  fecha_emision: string; // yyyy-mm-dd
  emisor: {
    rut: string;
    razon_social: string;
    giro?: string | null;
    direccion?: string | null;
    comuna?: string | null;
  };
  receptor?: {
    rut?: string;
    razon_social?: string;
    direccion?: string;
    comuna?: string;
  };
  totales: {
    neto: number;
    exento: number;
    iva: number;
    total: number;
  };
  detalles: DetalleLinea[];
  /** Para NCs: referencia a documento original */
  referencia?: {
    tipo_doc: TipoDTE;
    folio: number;
    fecha: string;
    razon: string; // texto libre
    cod_ref: 1 | 2 | 3; // 1=anula, 2=corrige texto, 3=corrige montos
  };
}

function escape(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Hash determinístico simple para usar como mock signature. NO es seguro. */
function mockHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  // Convert to hex string of consistent length, padded
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  // Repeat a few times so it looks like a real signature (~64 chars)
  return (hex.repeat(8)).slice(0, 64);
}

/**
 * Genera el TED (Timbre Electrónico Documento) según estructura oficial.
 * Mock: la FRMT (firma con CAF) es un hash determinístico, no real.
 */
export function generarTED(args: BoletaDTEArgs): string {
  const { tipo_dte, folio, fecha_emision, emisor, receptor, totales, detalles } = args;
  const primerItem = detalles[0]?.nombre ?? "";
  const ddXml = `<DD>
  <RE>${escape(emisor.rut)}</RE>
  <TD>${tipo_dte}</TD>
  <F>${folio}</F>
  <FE>${escape(fecha_emision)}</FE>
  <RR>${escape(receptor?.rut ?? "66666666-6")}</RR>
  <RSR>${escape(receptor?.razon_social ?? "Sin Receptor")}</RSR>
  <MNT>${totales.total}</MNT>
  <IT1>${escape(primerItem.slice(0, 40))}</IT1>
  <CAF version="1.0">
    <DA>
      <RE>${escape(emisor.rut)}</RE>
      <RS>${escape(emisor.razon_social)}</RS>
      <TD>${tipo_dte}</TD>
      <RNG><D>${folio}</D><H>${folio}</H></RNG>
      <FA>${escape(fecha_emision)}</FA>
      <RSAPK><M>MOCK_MODULUS_BASE64</M><E>Aw==</E></RSAPK>
      <IDK>100</IDK>
    </DA>
    <FRMA algoritmo="SHA1withRSA">${mockHash(`caf-${emisor.rut}-${tipo_dte}-${folio}`)}</FRMA>
  </CAF>
  <TSTED>${new Date().toISOString().replace(/\.\d+Z$/, "")}</TSTED>
</DD>
<FRMT algoritmo="SHA1withRSA">${mockHash(`ted-${emisor.rut}-${tipo_dte}-${folio}-${totales.total}`)}</FRMT>`;
  return `<TED version="1.0">${ddXml}</TED>`;
}

/**
 * Genera el XML DTE completo (boleta o NC) según esquema oficial del SII.
 * Mock: la firma XMLDSig es un hash determinístico.
 */
export function generarDTE(args: BoletaDTEArgs): string {
  const { tipo_dte, folio, fecha_emision, emisor, receptor, totales, detalles, referencia } = args;
  const id = `BE-${cleanRut(emisor.rut)}-${tipo_dte}-${folio}`;

  const indServicio = tipo_dte === 39 ? 3 : tipo_dte === 41 ? 3 : 3; // 3 = boletas con monto neto
  const isAfecta = tipo_dte === 39;
  const isNotaCredito = tipo_dte === 61;

  const receptorXml = receptor?.rut
    ? `<Receptor>
      <RUTRecep>${escape(receptor.rut)}</RUTRecep>
      <RznSocRecep>${escape(receptor.razon_social ?? "")}</RznSocRecep>
      ${receptor.direccion ? `<DirRecep>${escape(receptor.direccion)}</DirRecep>` : ""}
      ${receptor.comuna ? `<CmnaRecep>${escape(receptor.comuna)}</CmnaRecep>` : ""}
    </Receptor>`
    : "";

  const totalesXml = isAfecta
    ? `<Totales>
      <MntNeto>${totales.neto}</MntNeto>
      <TasaIVA>19</TasaIVA>
      <IVA>${totales.iva}</IVA>
      <MntTotal>${totales.total}</MntTotal>
    </Totales>`
    : `<Totales>
      <MntExe>${totales.exento}</MntExe>
      <MntTotal>${totales.total}</MntTotal>
    </Totales>`;

  const detallesXml = detalles
    .map((d, i) => `<Detalle>
    <NroLinDet>${i + 1}</NroLinDet>
    <NmbItem>${escape(d.nombre)}</NmbItem>
    ${d.cantidad !== undefined ? `<QtyItem>${d.cantidad}</QtyItem>` : ""}
    ${d.precio_unitario !== undefined ? `<PrcItem>${d.precio_unitario}</PrcItem>` : ""}
    <MontoItem>${d.monto}</MontoItem>
  </Detalle>`)
    .join("\n  ");

  const referenciaXml = referencia
    ? `<Referencia>
    <NroLinRef>1</NroLinRef>
    <TpoDocRef>${referencia.tipo_doc}</TpoDocRef>
    <FolioRef>${referencia.folio}</FolioRef>
    <FchRef>${escape(referencia.fecha)}</FchRef>
    <CodRef>${referencia.cod_ref}</CodRef>
    <RazonRef>${escape(referencia.razon)}</RazonRef>
  </Referencia>`
    : "";

  const ted = generarTED(args);
  const docName = isNotaCredito ? "NotaCredito" : "Boleta";

  const dte = `<DTE version="1.0">
  <Documento ID="${id}">
    <Encabezado>
      <IdDoc>
        <TipoDTE>${tipo_dte}</TipoDTE>
        <Folio>${folio}</Folio>
        <FchEmis>${escape(fecha_emision)}</FchEmis>
        <IndServicio>${indServicio}</IndServicio>
      </IdDoc>
      <Emisor>
        <RUTEmisor>${escape(emisor.rut)}</RUTEmisor>
        <RznSocEmisor>${escape(emisor.razon_social)}</RznSocEmisor>
        ${emisor.giro ? `<GiroEmisor>${escape(emisor.giro)}</GiroEmisor>` : ""}
        ${emisor.direccion ? `<DirOrigen>${escape(emisor.direccion)}</DirOrigen>` : ""}
        ${emisor.comuna ? `<CmnaOrigen>${escape(emisor.comuna)}</CmnaOrigen>` : ""}
      </Emisor>
      ${receptorXml}
      ${totalesXml}
    </Encabezado>
    ${detallesXml}
    ${referenciaXml}
    ${ted}
  </Documento>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
      <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
      <Reference URI="#${id}">
        <DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
        <DigestValue>${mockHash(`digest-${id}`)}</DigestValue>
      </Reference>
    </SignedInfo>
    <SignatureValue>${mockHash(`sig-${id}-${totales.total}`)}</SignatureValue>
  </Signature>
</DTE>`;

  // Tag de comentario al inicio para identificar como mock
  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n<!-- DTE MOCK ${docName} — generado por sii-mock, no enviado al SII real -->\n${dte}`;
}

/** Genera un track_id mock parecido al que devuelve el SII real (numérico, ~10 dígitos). */
export function generarTrackId(): string {
  return String(Math.floor(1_000_000_000 + Math.random() * 9_000_000_000));
}
