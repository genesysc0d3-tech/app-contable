/**
 * Lee el PDF OFICIAL del SII y devuelve los datos TAL COMO ESTÁN IMPRESOS.
 *
 * REGLA DEL FUNDADOR (2026-08-27): la representación personalizada de una
 * factura debe generarse con la información del documento ORIGINAL — nada
 * inventado, nada aproximado. Esta es la fuente: el mismo PDF que ya
 * descargamos para extraer el timbre trae impreso todo lo que la norma exige,
 * incluida la Dirección Regional del SII (Manual de Muestras Impresas v3.0
 * §1.1.4, Circular 32/2005), que la app no guarda en ninguna parte.
 *
 * El texto lo produce el portal del SII, así que su estructura es estable. Aun
 * así, TODO es best-effort campo por campo: lo que no se pueda leer vuelve
 * null y el que llama decide — jamás se rellena con una suposición.
 *
 * SOLO SERVER (pdfjs-dist vive en serverExternalPackages).
 */

export interface DatosOficialesDte {
  /** Texto plano de la página 1 (para diagnóstico y cotejos). */
  texto: string | null;
  emisor: {
    razonSocial: string | null;
    rut: string | null;
    giro: string | null;
    direccion: string | null;
    email: string | null;
    /** Giro + dirección tal como vienen impresos, sin separar (ver nota abajo). */
    giroYDireccionCrudo?: string | null;
  };
  receptor: {
    razonSocial: string | null;
    rut: string | null;
    giro: string | null;
    direccion: string | null;
    comuna: string | null;
    ciudad: string | null;
  };
  /** "FACTURA NO AFECTA O EXENTA ELECTRONICA" — el nombre impreso en el recuadro. */
  tipoDocumento: string | null;
  folio: number | null;
  /** "S.I.I. - SAN BERNARDO". */
  unidadSii: string | null;
  /** "27 de Agosto del 2026" tal cual lo imprime el portal. */
  fechaEmisionTexto: string | null;
  /** "Contado" | "Crédito" según el documento. */
  formaPago: string | null;
  /** Totales impresos (los rótulos varían entre afecta y exenta). */
  totales: { etiqueta: string; monto: number }[];
  /** El TOTAL impreso, para cotejar contra lo que la app tiene registrado. */
  montoTotal: number | null;
}

const vacio = (): DatosOficialesDte => ({
  texto: null,
  emisor: { razonSocial: null, rut: null, giro: null, direccion: null, email: null },
  receptor: { razonSocial: null, rut: null, giro: null, direccion: null, comuna: null, ciudad: null },
  tipoDocumento: null,
  folio: null,
  unidadSii: null,
  fechaEmisionTexto: null,
  formaPago: null,
  totales: [],
  montoTotal: null,
});

/**
 * Lee la página 1 como LÍNEAS REALES, agrupando por la coordenada Y de cada
 * fragmento. Aplanar todo a una sola cadena perdía los saltos y hacía imposible
 * separar campos que van sin rótulo — p.ej. el giro del emisor y su dirección,
 * que quedaban pegados ("...INVERSIONES MENDOZA 0932..."). Con las líneas del
 * documento cada campo cae donde corresponde.
 */
async function leerPagina(pdfBytes: Uint8Array): Promise<{ lineas: string[]; lineasIzq: string[]; texto: string } | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: pdfBytes, disableFontFace: true, verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const contenido = await page.getTextContent();

    type Item = { str?: unknown; transform?: unknown };
    const anchoPagina = page.getViewport({ scale: 1 }).width || 600;
    // Texto en el ORDEN DEL DOCUMENTO (no por posición): así llegan contiguos
    // los campos rotulados y los de la caja roja, que reordenar por coordenada
    // separaba ("FACTURA NO AFECTA O" / "EXENTA ELECTRONICA" en dos líneas).
    const textoPlano = (contenido.items as Item[])
      .map((i) => (typeof i?.str === "string" ? i.str : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const filas = new Map<number, { x: number; s: string }[]>();
    for (const it of contenido.items as Item[]) {
      const s = typeof it?.str === "string" ? it.str : "";
      if (!s.trim()) continue;
      const t = Array.isArray(it?.transform) ? (it.transform as number[]) : null;
      const x = t?.[4] ?? 0;
      // Y redondeada a 2 puntos: tolera el jitter de línea base del portal.
      const y = Math.round((t?.[5] ?? 0) / 2) * 2;
      const fila = filas.get(y) ?? [];
      fila.push({ x, s });
      filas.set(y, fila);
    }
    // En PDF el origen está abajo: Y mayor = más arriba.
    const ordenadas = [...filas.entries()].sort((a, b) => b[0] - a[0]);
    const unir = (fila: { x: number; s: string }[]) =>
      fila.sort((a, b) => a.x - b.x).map((f) => f.s).join(" ").replace(/\s+/g, " ").trim();
    const lineas = ordenadas.map(([, fila]) => unir(fila)).filter(Boolean);
    // COLUMNA IZQUIERDA sola: la cabecera del documento tiene DOS columnas a la
    // misma altura (emisor a la izquierda, recuadro del SII a la derecha), así
    // que agrupar solo por Y las mezclaba en una sola línea.
    const lineasIzq = ordenadas
      .map(([, fila]) => unir(fila.filter((f) => f.x < anchoPagina * 0.55)))
      .filter(Boolean);

    // El cierre NO puede tumbar un texto ya extraído: si destroy() falla se
    // ignora (era un bug real — el finally propagaba y devolvía null con el
    // dato ya en la mano).
    // (esta versión de pdfjs no expone destroy(); el documento se libera solo)
    return { lineas, lineasIzq, texto: textoPlano };
  } catch {
    return null;
  }
}

const limpio = (v: string | undefined | null): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim().replace(/[:;,\-–]+$/, "").trim();
  return t.length > 0 ? t : null;
};

/** El portal imprime los RUT con un espacio antes del DV: "78.448.088- 7". */
const normalizarRut = (v: string | null): string | null => {
  if (!v) return null;
  const t = v.replace(/\s+/g, "").toUpperCase();
  const m = t.match(/^([\d.]+)-?([\dK])$/);
  return m ? `${m[1]}-${m[2]}` : t || null;
};

const aMonto = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number(v.replace(/[.$\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
};

export function extraerUnidadSii(texto: string): string | null {
  // La unidad va SIEMPRE en mayúsculas ("SAN BERNARDO", "SANTIAGO CENTRO") y la
  // sigue un rótulo capitalizado ("Fecha Emision"). Capturamos solo PALABRAS de
  // 2+ mayúsculas: así no se cuela la "F" de "Fecha" (que sí se colaba con una
  // clase de caracteres suelta — verificado contra el PDF real del folio 967).
  const m = texto.match(/S\.?\s*I\.?\s*I\.?\s*[-–—]\s*((?:[A-ZÁÉÍÓÚÑ]{2,}\s*)+)/);
  if (!m) return null;
  const unidad = m[1].replace(/\s+/g, " ").trim();
  if (unidad.length < 3 || unidad.length > 40) return null;
  return `S.I.I. - ${unidad}`;
}

export function parsearDteOficial(texto: string, lineas: string[] = []): DatosOficialesDte {
  const d = vacio();
  d.texto = texto;

  // ── recuadro del SII ──
  d.tipoDocumento = limpio(texto.match(/(FACTURA(?:\s+NO\s+AFECTA\s+O\s+EXENTA)?\s+ELECTR[OÓ]NICA)/i)?.[1]);
  const folio = texto.match(/N[ºo°]\s*(\d{1,10})/i)?.[1];
  d.folio = folio ? Number(folio) : null;
  d.unidadSii = extraerUnidadSii(texto);
  d.fechaEmisionTexto = limpio(texto.match(/Fecha\s+Emision\s*:?\s*(.{0,40}?)(?=\s+C[oó]digo|$)/i)?.[1]);

  // ── emisor: la razón social abre el documento; el resto va rotulado ──
  const iGiro = lineas.findIndex((l) => /^Giro\s*:/i.test(l));
  d.emisor.razonSocial = limpio(iGiro > 0 ? lineas.slice(0, iGiro).join(" ") : texto.match(/^(.{3,120}?)\s+Giro\s*:/i)?.[1]);
  // GIRO Y DIRECCIÓN DEL EMISOR: el portal los imprime SIN rótulo y AMBOS se
  // envuelven en varias líneas ("...| INVERSIONES" / "MENDOZA 0932 TEJAS DE
  // CHENA- SAN" / "BERNARDO"), así que separarlos leyendo el PDF es adivinar
  // dónde termina uno y empieza el otro. Adivinar es exactamente lo que este
  // módulo NO hace: se dejan en null y el llamador usa los de `empresas`, que
  // son el MISMO dato del registro del SII, limpio y ya estructurado.
  // Todo lo demás (identidad del documento, receptor, fecha, pago, totales) SÍ
  // sale del original.
  d.emisor.giro = null;
  d.emisor.direccion = null;
  // Bloque crudo por si alguna vez se quiere mostrar tal cual o diagnosticar.
  const iFin = lineas.findIndex((l, k) => k > iGiro && /^(eMail|Telefono|Tel[ée]fono|TIPO DE)/i.test(l));
  if (iGiro >= 0) {
    const hasta = iFin > iGiro ? iFin : Math.min(iGiro + 4, lineas.length);
    d.emisor.giroYDireccionCrudo = limpio(lineas.slice(iGiro, hasta).join(" ").replace(/^Giro\s*:/i, ""));
  }
  d.emisor.email = limpio(texto.match(/eMail\s*:?\s*(\S+@\S+)/i)?.[1]);
  // El RUT del emisor es el que va pegado al recuadro (antes del tipo de doc).
  d.emisor.rut = normalizarRut(limpio(texto.match(/R\.?U\.?T\.?\s*:?\s*([\d.]+-?\s?[\dK])\s+FACTURA/i)?.[1]));

  // ── receptor ──
  d.receptor.razonSocial = limpio(texto.match(/SE[ÑN]OR\(?ES\)?\s*:?\s*(.{2,120}?)(?=\s+R\.?U\.?T)/i)?.[1]);
  d.receptor.rut = normalizarRut(limpio(texto.match(/SE[ÑN]OR\(?ES\)?.{0,140}?R\.?U\.?T\.?\s*:?\s*([\d.]+-?\s?[\dK])/i)?.[1]));
  d.receptor.giro = limpio(texto.match(/GIRO\s*:\s*(.{3,160}?)(?=\s+DIRECCI[OÓ]N)/i)?.[1]);
  d.receptor.direccion = limpio(texto.match(/DIRECCI[OÓ]N\s*:?\s*(.{3,120}?)(?=\s+COMUNA)/i)?.[1]);
  d.receptor.comuna = limpio(texto.match(/COMUNA\s*:?\s*(.{2,60}?)(?=\s+CIUDAD|\s+CONTACTO|\s+TIPO)/i)?.[1]);
  d.receptor.ciudad = limpio(texto.match(/CIUDAD\s*:?\s*(.{2,60}?)(?=\s+CONTACTO|\s+TIPO|\s+R\.?U\.?T)/i)?.[1]);

  // ── forma de pago ──
  d.formaPago = limpio(texto.match(/Forma\s+de\s+Pago\s*:?\s*(Contado|Cr[ée]dito|Sin\s+Costo)/i)?.[1]);

  // ── totales impresos (los rótulos cambian entre afecta y exenta) ──
  const rotulos = ["MONTO NETO", "NETO", "I.V.A.", "IVA", "IMPUESTO ADICIONAL", "MONTO EXENTO", "EXENTO", "TOTAL"];
  for (const r of rotulos) {
    const re = new RegExp(`${r.replace(/\./g, "\\.")}\\s*(?:\\(\\s*19\\s*%\\s*\\))?\\s*\\$?\\s*([\\d.,]+)`, "i");
    const monto = aMonto(texto.match(re)?.[1]);
    if (monto == null) continue;
    if (d.totales.some((t) => t.etiqueta === r)) continue;
    d.totales.push({ etiqueta: r, monto });
  }
  // El TOTAL cierra el documento: se prefiere el de la cola.
  const totalFinal = texto.match(/TOTAL\s*\$?\s*([\d.,]+)\s*$/i)?.[1] ?? texto.match(/TOTAL\s*\$?\s*([\d.,]+)/i)?.[1];
  d.montoTotal = aMonto(totalFinal);

  return d;
}

export async function leerDatosOficialesDte(pdfBytes: Uint8Array): Promise<DatosOficialesDte> {
  const pagina = await leerPagina(pdfBytes);
  if (!pagina) return vacio();
  return parsearDteOficial(pagina.texto, pagina.lineasIzq);
}
