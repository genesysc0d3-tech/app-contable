/**
 * MOTOR DE DECISIÓN DE EMISIÓN — la "quilla" del flujo Emitir.
 *
 * Una sola función PURA (sin I/O) que decide, para una propuesta, si se puede
 * emitir, si queda bloqueada, o si debe volver a Check por baja confianza.
 * Orquesta las piezas que ya existen y centraliza las reglas que hoy están
 * duplicadas en pendientes-emision.ts y en /api/intermediaria/emitir-lote.
 *
 * Debe ser la ÚNICA fuente de verdad: la cola, el backend mock y (en F4) el
 * carril real deben llamar a `evaluarEmision`, para que "lo que ves" sea
 * exactamente "lo que se emite". Al ser pura, se testea sin Supabase ni red.
 *
 * Reglas tributarias validadas con el contador (ver
 * artifacts/docs/massdte-emitir-plan-2026-06-27.md). Ref. normativa:
 *   - DL 825 (IVA): hecho gravado Art. 2; exenciones Art. 12/13; débito Art. 14.
 *   - Res. Ex. SII 44/2025: identificación del comprador sobre 135 UF.
 *   - Of. SII 963/2018: cripto = activo incorporal, exento de IVA.
 */

import { SUFIJO_SOCIETARIO } from "../ai/classifier";
import { clasificarBoleta, type DocumentoHint, type EmpresaContext, type PatronContext } from "../sii/clasificador-tipo";
import { validarBoleta } from "../sii/validation";

/** Confianza mínima del clasificador (afecta/exenta) para auto-marcar como listo. */
export const CONFIANZA_TIPO_MIN = 0.8;
/** Confianza mínima de que es un ingreso boletable (si la conocemos). */
export const CONFIANZA_INGRESO_MIN = 0.85;

/** En cuál de las 3 columnas cae la propuesta. */
export type Balde = "listas" | "por_revisar" | "bloqueadas";

export type Marca = { code: string; msg: string };

export type EmisionInput = {
  /** Estado de la propuesta (solo aprobado/editado son emitibles). */
  estado: string;
  /** ¿Ya tiene una boleta vigente asociada? */
  yaEmitida: boolean;
  /** Monto total bruto de la operación (CLP). */
  total: number;
  descripcion: string;
  /** YYYY-MM-DD del movimiento. */
  fecha: string;
  receptorRut: string | null;
  receptorNombre: string | null;
  /** Medio de pago (obligatorio sobre 135 UF — Res. 44/2025). */
  medioPago?: string | null;
  /**
   * Decisión humana del tipo, guardada en Check (Paso P). Si viene, MANDA sobre
   * la heurística y desactiva el gate de baja confianza (el humano ya decidió).
   * Hoy llega null/undefined hasta que se implemente la persistencia.
   */
  tipoDtePersistido?: 39 | 41 | null;
  /** Confianza de que es ingreso boletable (0-1), si se conoce. */
  confianzaIngreso?: number;
  docHint?: DocumentoHint;
  patron?: PatronContext;
};

export type EmisionCtx = {
  empresa: EmpresaContext;
  /** Umbral de identificación en CLP (135 UF al día). Si falta, validarBoleta usa su referencial. */
  umbralIdentificacionClp?: number;
};

export type EmisionVerdict = {
  tipoDte: 39 | 41 | null;
  sugerencia: "afecta" | "exenta" | "no_boletar";
  confianzaTipo: number;
  razones: string[];
  totales: { neto: number; exento: number; iva: number; total: number } | null;
  balde: Balde;
  /** Reglas duras que IMPIDEN emitir (hay que corregir en Check). */
  bloqueos: Marca[];
  /** Avisos que NO impiden emitir (segunda opinión, anomalías). */
  advertencias: Marca[];
  /** true solo si cae en "listas" (sin bloqueos y con confianza suficiente). */
  puedeEmitir: boolean;
};

const ESTADOS_VALIDOS = ["aprobado", "editado"];

/**
 * Evalúa una propuesta y entrega el veredicto de emisión (balde + bloqueos +
 * advertencias + totales). PURA: mismos inputs → mismo output.
 */
export function evaluarEmision(input: EmisionInput, ctx: EmisionCtx): EmisionVerdict {
  const clasif = clasificarBoleta(
    { descripcion: input.descripcion, monto: input.total, fecha: input.fecha, receptor_nombre: input.receptorNombre },
    ctx.empresa,
    input.patron,
    input.docHint ?? null,
  );

  // La decisión humana guardada (Paso P) manda sobre la heurística.
  let tipoDte: 39 | 41 | null = input.tipoDtePersistido ?? clasif.tipo_dte;

  const bloqueos: Marca[] = [];
  const advertencias: Marca[] = [];

  const glosa = input.descripcion?.trim() ?? "";
  if (!glosa) {
    bloqueos.push({ code: "DETALLE_VACIO", msg: "Falta la glosa: ¿qué se vendió o prestó?" });
  }

  if (!ESTADOS_VALIDOS.includes(input.estado)) {
    bloqueos.push({ code: "ESTADO_NO_APROBADO", msg: "La propuesta no está aprobada todavía." });
  }
  if (input.yaEmitida) {
    bloqueos.push({ code: "YA_EMITIDA", msg: "Esta operación ya tiene una boleta emitida." });
  }
  // La APROBACIÓN humana manda sobre la heurística (criterio 3 de Matías:
  // advertir, nunca bloquear — y pedido del fundador 2026-09-01: "si las
  // acepté, no tiene sentido que me las bloquee"). Con la propuesta aprobada,
  // "no parece una venta" es un triángulo de advertencia, no un veto. Sin
  // aprobar, sigue siendo bloqueo: la duda de la IA vuelve al Check.
  const aprobadaPorHumano = input.estado === "aprobado";
  if (clasif.sugerencia === "no_boletar") {
    const marca = { code: "NO_BOLETAR", msg: `Ojo: no parece una venta (${clasif.razones[0] ?? "movimiento no comercial"}). La apruebas tú — se emitirá igual.` };
    if (aprobadaPorHumano) advertencias.push(marca);
    else bloqueos.push({ code: "NO_BOLETAR", msg: `No parece una venta: ${clasif.razones[0] ?? "movimiento no comercial"}.` });
  }

  // DISCLAIMER societario (fundador 2026-09-02: "siempre disclaimer, jamás
  // cambiar el estado"): la contraparte parece una empresa (SpA/Ltda/EIRL/S.A.)
  // — a empresas normalmente se factura, pero boletear a una empresa es legal y
  // decisión del emisor. Triángulo ignorable, nunca veto ni cambio de tipo.
  if (SUFIJO_SOCIETARIO.test(glosa)) {
    advertencias.push({
      code: "RECEPTOR_EMPRESA",
      msg: "El pagador parece una empresa (SpA/Ltda): a empresas normalmente se les factura. Si igual va boleta, apruébala nomás — se emite igual.",
    });
  }

  // Aprobada sin tipo decidido (la heurística no propuso 39/41): asumir por el
  // régimen de la empresa — exenta emite 41, afecta 39 (IVA de más nunca multa;
  // de menos sí). Se avisa con triángulo para que el Check pueda corregirlo.
  if (tipoDte == null && aprobadaPorHumano) {
    tipoDte = ctx.empresa?.tipo_contribuyente === "exento" ? 41 : 39;
    advertencias.push({
      code: "TIPO_ASUMIDO",
      msg: `Tipo asumido: ${tipoDte === 41 ? "exenta" : "afecta"} (por el régimen de tu empresa). Si no corresponde, cámbialo en Check.`,
    });
  }

  let totales: EmisionVerdict["totales"] = null;

  if (tipoDte === 39 || tipoDte === 41) {
    const val = validarBoleta(
      {
        tipo_dte: tipoDte,
        receptor_rut: input.receptorRut ?? undefined,
        receptor_razon_social: input.receptorNombre ?? undefined,
        medio_pago: input.medioPago ?? undefined,
        detalles: [{ nombre: glosa || "—", monto: Math.round(input.total) }],
        monto_total: Math.round(input.total),
      },
      { umbralIdentificacionClp: ctx.umbralIdentificacionClp },
    );
    totales = val.totales ?? null;
    for (const e of val.errors) bloqueos.push({ code: e.code, msg: e.message });
    // R4: una boleta afecta (39) con IVA $0 la rechaza el SII (Art. 14 DL 825).
    if (tipoDte === 39 && val.totales && val.totales.iva === 0) {
      bloqueos.push({ code: "AFECTA_IVA_CERO", msg: "Una boleta afecta no puede tener IVA $0. Revisa el monto o emítela exenta." });
    }
  } else if (clasif.sugerencia !== "no_boletar") {
    // tipoDte null sin ser "no_boletar" → falta decidir el tipo.
    bloqueos.push({ code: "TIPO_NO_DECIDIDO", msg: "Falta decidir si es afecta o exenta (revísala en Check)." });
  }

  // R10: baja confianza sin decisión humana → vuelve a Check (no bloquea, pero no se emite).
  // OJO: el bias de tipo_contribuyente del clasificador infla la confianza del
  // ensemble aunque la glosa sea vaga. Por eso miramos también el peso de la
  // glosa: si es débil (zona default/neutral, ≤ 0.4), la duda es real y va a
  // revisar igual — "Listas" no debe mentir. La decisión humana lo desactiva.
  // La aprobación TAMBIÉN es decisión humana (fundador 2026-09-01): una
  // propuesta aprobada no rebota a Check por la inseguridad de la IA — las
  // dudas van como advertencia (NO_BOLETAR/TIPO_ASUMIDO) y se emite igual.
  const sinDecisionHumana = input.tipoDtePersistido == null && !aprobadaPorHumano;
  const glosaDebil = clasif.angulos.glosa.peso <= 0.4;
  const bajaConfianza = sinDecisionHumana && (
    glosaDebil ||
    clasif.confianza < CONFIANZA_TIPO_MIN ||
    (input.confianzaIngreso !== undefined && input.confianzaIngreso < CONFIANZA_INGRESO_MIN)
  );

  let balde: Balde;
  if (bloqueos.length > 0) {
    balde = "bloqueadas";
  } else if (bajaConfianza) {
    balde = "por_revisar";
    advertencias.push({ code: "BAJA_CONFIANZA", msg: "La IA no está segura del tipo. Revísala en Check antes de emitir." });
  } else {
    balde = "listas";
  }

  return {
    tipoDte,
    sugerencia: clasif.sugerencia,
    confianzaTipo: clasif.confianza,
    razones: clasif.razones,
    totales,
    balde,
    bloqueos,
    advertencias,
    puedeEmitir: balde === "listas",
  };
}
