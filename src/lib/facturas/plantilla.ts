/**
 * Plantilla de facturas — el formato de entrada de la mesa Facturas.
 *
 * Diseñada sobre los criterios de Matías (docs/facturas-criterios-matias-
 * 2026-08-24.md) y el flujo real del portal (docs/facturas-portal-sii-flujo.md):
 *
 * - UN solo campo de monto: VALOR TOTAL del documento. Nada de neto/IVA por
 *   fila — si el emisor es afecto, el sistema deriva neto e IVA por dentro.
 * - Receptor COMPLETO y obligatorio (decisión del fundador 2026-08-25): una
 *   factura sin razón social, giro, dirección y comuna del receptor no es una
 *   factura. El portal del SII autocompleta desde el RUT, pero el documento
 *   nace completo desde acá sin depender de ese autocompletado. Solo el Email
 *   queda opcional (es contacto, no dato fiscal).
 * - CERO interpretación: cada fila ES una factura que el usuario decidió
 *   emitir. No pasa por IA ni clasificador — determinístico y con 0 tokens.
 * - Advertir sí, bloquear jamás (criterio 3): los problemas por fila salen
 *   como errores/advertencias legibles con número de fila; las filas buenas
 *   siguen su camino.
 */
import { validarRut, formatRut } from "../rut";

export const PLANTILLA_FACTURAS_HEADERS = [
  "RUT Receptor",
  "Detalle",
  "Valor Total",
  "Razón Social",
  "Giro",
  "Dirección",
  "Comuna",
  "Email",
] as const;

type Celda = string | number | boolean | Date | null | undefined;
export type FilaCruda = Celda[];

export interface FacturaFila {
  /** 1-based, como lo ve el usuario en Excel. */
  fila: number;
  receptorRut: string;          // normalizado con formatRut
  detalle: string;
  totalClp: number;
  receptorRazonSocial: string;
  receptorGiro: string;
  receptorDireccion: string;
  receptorComuna: string;
  receptorEmail: string | null;
  advertencias: string[];
}

export interface ErrorFila {
  fila: number;
  error: string;
}

/**
 * Detecta si la hoja es una plantilla de facturas: encabezado con
 * "rut receptor" (o "rut" a secas) + "detalle" + "valor total"/"total".
 * Busca en las primeras filas, igual que los detectores de cartolas.
 */
export function esPlantillaFacturas(rows: FilaCruda[]): { headerRow: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i];
    if (!r) continue;
    const norm = r.map((c) => String(c ?? "").toLowerCase().trim());
    const rutIdx = norm.findIndex((c) => c === "rut receptor" || c === "rut");
    const detalleIdx = norm.findIndex((c) => c === "detalle" || c === "descripción" || c === "descripcion");
    const totalIdx = norm.findIndex((c) => c === "valor total" || c === "total" || c === "monto total");
    if (rutIdx < 0 || detalleIdx < 0 || totalIdx < 0) continue;
    return {
      headerRow: i,
      cols: {
        rut: rutIdx,
        detalle: detalleIdx,
        total: totalIdx,
        razon: norm.findIndex((c) => c.includes("razón social") || c.includes("razon social")),
        giro: norm.findIndex((c) => c === "giro"),
        direccion: norm.findIndex((c) => c.includes("dirección") || c.includes("direccion")),
        comuna: norm.findIndex((c) => c === "comuna"),
        email: norm.findIndex((c) => c === "email" || c === "correo" || c === "e-mail"),
      },
    };
  }
  return null;
}

/** Monto chileno a entero: acepta 1.971.031, "1971031", 1971031, "$1.971.031". */
function parseMonto(celda: Celda): number | null {
  if (typeof celda === "number") return Number.isFinite(celda) ? Math.round(celda) : null;
  const limpio = String(celda ?? "").replace(/[$\s.]/g, "").replace(",", ".");
  if (!limpio || !/^\d+(\.\d+)?$/.test(limpio)) return null;
  return Math.round(Number(limpio));
}

const texto = (celda: Celda): string | null => {
  const t = String(celda ?? "").trim();
  return t ? t : null;
};

/**
 * Parsea la plantilla completa. Las filas malas no matan el lote: salen con
 * su número y su motivo, y las buenas siguen (el usuario decide en revisión).
 */
export function parsePlantillaFacturas(rows: FilaCruda[]): { facturas: FacturaFila[]; errores: ErrorFila[] } {
  const det = esPlantillaFacturas(rows);
  if (!det) return { facturas: [], errores: [{ fila: 0, error: "No se encontró el encabezado de la plantilla (RUT Receptor / Detalle / Valor Total)" }] };

  const facturas: FacturaFila[] = [];
  const errores: ErrorFila[] = [];
  const c = det.cols;
  const col = (r: FilaCruda, idx: number): Celda => (idx >= 0 ? r[idx] : null);

  for (let i = det.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((celda) => String(celda ?? "").trim() === "")) continue;
    const fila = i + 1; // como lo ve el usuario en Excel

    const rutCrudo = String(col(r, c.rut) ?? "").trim();
    // La fila de ejemplo de la plantilla descargada no es un error del usuario.
    if (/^ej[.:]?\s|ejemplo/i.test(rutCrudo)) continue;
    if (!rutCrudo) { errores.push({ fila, error: "Falta el RUT del receptor" }); continue; }
    if (!validarRut(rutCrudo)) { errores.push({ fila, error: `RUT inválido: ${rutCrudo}` }); continue; }

    const detalle = texto(col(r, c.detalle));
    if (!detalle) { errores.push({ fila, error: "Falta el detalle (qué se está facturando)" }); continue; }

    const total = parseMonto(col(r, c.total));
    if (total === null || total <= 0) { errores.push({ fila, error: `Valor total inválido: ${String(col(r, c.total) ?? "(vacío)")}` }); continue; }

    // El receptor de una factura se identifica ENTERO — sin razón social,
    // giro, dirección o comuna el documento no existe (decisión del fundador;
    // el DL 825 exige la individualización del receptor en la factura).
    const razon = texto(col(r, c.razon));
    const giro = texto(col(r, c.giro));
    const direccion = texto(col(r, c.direccion));
    const comuna = texto(col(r, c.comuna));
    const faltantes = [
      !razon && "Razón Social",
      !giro && "Giro",
      !direccion && "Dirección",
      !comuna && "Comuna",
    ].filter(Boolean);
    if (faltantes.length > 0) {
      errores.push({ fila, error: `Faltan datos del receptor: ${faltantes.join(", ")}` });
      continue;
    }

    facturas.push({
      fila,
      receptorRut: formatRut(rutCrudo),
      detalle,
      totalClp: total,
      receptorRazonSocial: razon!,
      receptorGiro: giro!,
      receptorDireccion: direccion!,
      receptorComuna: comuna!,
      receptorEmail: texto(col(r, c.email)),
      advertencias: [],
    });
  }
  return { facturas, errores };
}

/**
 * Deriva los montos del documento desde el VALOR TOTAL (criterio 4).
 *
 * Regla del portal (audio de Matías): en factura AFECTA el campo Precio
 * recibe el NETO y el SII calcula IVA y total solo; en EXENTA recibe el
 * BRUTO. Por eso el neto derivado es lo que viajará al portal.
 *
 * `advertencia`: hay totales que ningún neto entero produce exacto (p. ej.
 * $100.001) — el SII va a emitir por un peso menos/más. Se ADVIERTE en la
 * revisión, jamás se bloquea (criterio 3).
 */
export function derivarMontosFactura(
  totalClp: number,
  emisorExento: boolean,
): { tipoDte: 33 | 34; neto: number; iva: number; exento: number; advertencia: string | null } {
  if (emisorExento) {
    return { tipoDte: 34, neto: 0, iva: 0, exento: totalClp, advertencia: null };
  }
  const neto = Math.round(totalClp / 1.19);
  const iva = Math.round(neto * 0.19);
  const recalculado = neto + iva;
  return {
    tipoDte: 33,
    neto,
    iva,
    exento: 0,
    advertencia:
      recalculado === totalClp
        ? null
        : `El SII emitirá por $${recalculado.toLocaleString("es-CL")} (neto $${neto.toLocaleString("es-CL")} + IVA): un total de $${totalClp.toLocaleString("es-CL")} no es representable exacto con IVA del 19%`,
  };
}
