/**
 * Clasificador de operaciones para boleta — replica el criterio del SII
 * chileno (DL 825 IVA, Of. 963/2018 cripto, Art. 12/13 exenciones).
 *
 * Estrategia de redundancia: 3 ángulos independientes votan, ensemble decide.
 *   1. Glosa textual (keywords + patterns regex)
 *   2. Giro de la empresa
 *   3. Patrón de la transacción (frecuencia, monto, recurrencia)
 *
 * Si los 3 coinciden → confianza alta. Si discrepan → defaultiar a AFECTA
 * (caso más común en P2P) con confianza baja, marcar para revisión humana.
 *
 * NOTA: este clasificador se usa solo para SUGERIR el tipo a la UI. El
 * usuario puede override por item antes de emitir. La fuente de verdad
 * sigue siendo la decisión del usuario (o su contador).
 */

export type TipoBoletaSugerido = "afecta" | "exenta" | "no_boletar";
export type TipoDTE = 39 | 41 | null; // null cuando no_boletar

interface AngleResult {
  veredicto: TipoBoletaSugerido | "neutral";
  peso: number; // 0-1
  razon: string;
}

export interface PropuestaContext {
  descripcion: string;
  monto: number;
  fecha: string;
  receptor_nombre?: string | null;
}

export interface EmpresaContext {
  giro?: string | null;
  razon_social?: string;
}

export interface PatronContext {
  cantidad_mismo_dia_mismo_receptor: number;
  cantidad_mes_mismo_receptor: number;
}

/**
 * Hint del usuario sobre la naturaleza de toda la cartola.
 * Si está set, el clasificador lo usa como señal decisiva.
 */
export type DocumentoHint = "p2p_cripto" | "forex_divisas" | "servicios" | "ventas" | "mixto" | null;

export interface ClasificacionResult {
  tipo_dte: TipoDTE;
  sugerencia: TipoBoletaSugerido;
  confianza: number;
  razones: string[];
  angulos: { glosa: AngleResult; giro: AngleResult; patron: AngleResult };
}

// ============================================================
// Ángulo 1 — Glosa textual
// ============================================================

function angleGlosa(descripcion: string | null | undefined): AngleResult {
  const desc = String(descripcion ?? "").toLowerCase();

  // NO_BOLETAR — caso binario, prevalece si dispara
  if (/\b(transf(erencia)? (a )?(misma|mi propia )?cuenta|tef misma|entre cuentas propias|cuenta propia|cta propia)\b/.test(desc))
    return { veredicto: "no_boletar", peso: 0.95, razon: "Transferencia entre cuentas propias" };
  if (/\b(devoluci[oó]n|reverso|reintegro|reembolso|dev\.?\s|rev\.?\s)\b/.test(desc))
    return { veredicto: "no_boletar", peso: 0.85, razon: "Devolución / reverso" };
  if (/\b(pr[eé]stamo|mutuo|cr[eé]dito recibido|cr[eé]dito hipotecario|cuota cr[eé]dito)\b/.test(desc))
    return { veredicto: "no_boletar", peso: 0.80, razon: "Préstamo / crédito recibido" };
  if (/\b(aporte (de )?capital|aporte socio|inversi[oó]n inicial|capital social)\b/.test(desc))
    return { veredicto: "no_boletar", peso: 0.85, razon: "Aporte de capital" };
  if (/\b(sueldo|liquidaci[oó]n de remu|salario|remuneraci[oó]n|finiquito)\b/.test(desc))
    return { veredicto: "no_boletar", peso: 0.75, razon: "Remuneración / sueldo" };
  if (/\b(dep[oó]sito a plazo|dap|fondo mutuo|ahorro)\b/.test(desc))
    return { veredicto: "no_boletar", peso: 0.70, razon: "Movimiento de ahorro/inversión" };

  // EXENTA — Art. 12/13 DL 825
  if (/\b(matr[ií]cula|colegiatura|pensi[oó]n escolar|arancel|jard[ií]n infantil|colegio|universidad|instituto|capacitaci[oó]n|sence|sostas)\b/.test(desc))
    return { veredicto: "exenta", peso: 0.85, razon: "Educación (Art. 13 N°4 DL 825)" };
  if (/\b(consulta m[eé]d|kinesi|odont|psic[oó]log|cl[ií]nica|hospital|m[eé]dico|fonoaudi|nutri|farmacia)\b/.test(desc))
    return { veredicto: "exenta", peso: 0.80, razon: "Salud (Art. 12 letra E N°7)" };
  if (/\b(uber|didi|cabify|taxi|micro|metro|bus|pasaje|colectivo)\b/.test(desc))
    return { veredicto: "exenta", peso: 0.80, razon: "Transporte de pasajeros (Art. 13 N°3)" };
  if (/\b(arriendo|arrendamiento|alquiler)\b/.test(desc) && !/\bamoblado\b/.test(desc))
    return { veredicto: "exenta", peso: 0.65, razon: "Arriendo no amoblado (Art. 12 letra E N°11)" };
  if (/\b(export|wire|swift|abroad|exterior|trf desde el extranjero)\b/.test(desc))
    return { veredicto: "exenta", peso: 0.70, razon: "Probable exportación (Art. 12 letra D)" };

  // EXENTA — cripto/P2P. Las cripto son ACTIVOS INCORPORALES (Of. SII
  // 963/2018), no bienes corporales muebles → la venta NO es hecho
  // gravado con IVA (Art. 2 N°3 DL 825). La renta sí tributa en
  // Primera Categoría, pero eso va por F22/F29, no por el tipo de boleta.
  // Default: EXENTA como documento tributario.
  if (/\b(usdt|btc|bitcoin|ethereum|eth|crypto|cripto|p2p|binance|buda|orionx|okx|kucoin|bybit|coinbase|tether)\b/.test(desc))
    return {
      veredicto: "exenta",
      peso: 0.85,
      razon: "Cripto/P2P — activo incorporal, no IVA (Of. SII 963/2018, Art. 2 N°3 DL 825)",
    };

  // EXENTA — forex (divisas no son bien corporal mueble tampoco)
  if (/\b(forex|fx|usd|d[oó]lar|euro|cambio de divisa)\b/.test(desc))
    return {
      veredicto: "exenta",
      peso: 0.70,
      razon: "Forex — compraventa de divisas, no IVA",
    };

  // AFECTA — servicios gravados
  if (/\b(servicio|asesor[ií]a|consultor[ií]a|reparaci[oó]n|instalaci[oó]n|mantenci[oó]n|software|marketing|dise[ñn]o|programaci[oó]n|desarrollo|hosting|publicidad)\b/.test(desc))
    return { veredicto: "afecta", peso: 0.80, razon: "Servicio gravado (Art. 8 DL 825)" };

  // AFECTA — venta de bienes
  if (/\b(venta|producto|mercader[ií]a|insumo|stock|art[ií]culo)\b/.test(desc))
    return { veredicto: "afecta", peso: 0.80, razon: "Venta de bienes" };

  // AFECTA — comisiones
  if (/\b(comisi[oó]n|broker|intermediaci[oó]n|gesti[oó]n|cobro)\b/.test(desc))
    return { veredicto: "afecta", peso: 0.75, razon: "Comisión / intermediación" };

  // Default suave: si parece transferencia recibida sin contexto → afecta (default P2P)
  if (/\b(transf|tef|trans de|abono|transferencia recibida|trans recibid)\b/.test(desc))
    return { veredicto: "afecta", peso: 0.35, razon: "Transferencia recibida (default afecta)" };

  return { veredicto: "neutral", peso: 0, razon: "" };
}

// ============================================================
// Ángulo 2 — Giro de la empresa
// ============================================================

function angleGiro(giro: string | null | undefined): AngleResult {
  if (!giro) return { veredicto: "neutral", peso: 0, razon: "" };
  const g = giro.toLowerCase();

  if (/educaci|colegio|universidad|instituto|jard[ií]n infantil|capacitaci/.test(g))
    return { veredicto: "exenta", peso: 0.55, razon: `Giro educación: "${giro}"` };
  if (/salud|m[eé]dic|cl[ií]nica|hospital|odont|kinesi|psic[oó]log|farmacia/.test(g))
    return { veredicto: "exenta", peso: 0.55, razon: `Giro salud: "${giro}"` };
  if (/transporte de pasajero|taxi|colectivo|locomoci[oó]n/.test(g))
    return { veredicto: "exenta", peso: 0.55, razon: `Giro transporte pasajeros: "${giro}"` };
  if ((/arrendamiento|inmobiliari/.test(g)) && /no amoblado|departamento|inmueble/.test(g))
    return { veredicto: "exenta", peso: 0.50, razon: `Giro arriendo BR no amoblado: "${giro}"` };
  if (/export|comercio exterior/.test(g))
    return { veredicto: "exenta", peso: 0.50, razon: `Giro exportación: "${giro}"` };

  // Giro cripto/exchange/forex → EXENTA: la venta de activos incorporales
  // (cripto, divisas) no está gravada con IVA (Art. 2 N°3 DL 825).
  if (/cripto|exchange|p2p|forex|divisa|criptomoneda|criptoactivo/.test(g))
    return { veredicto: "exenta", peso: 0.50, razon: `Giro cripto/forex: "${giro}" — activo incorporal sin IVA` };

  if (/comerci|venta|servicio|consultor|asesor|software|tecnolog|inform[aá]tica|ingenier[ií]a/.test(g))
    return { veredicto: "afecta", peso: 0.45, razon: `Giro comercio/servicios afectos: "${giro}"` };

  return { veredicto: "neutral", peso: 0, razon: "" };
}

// ============================================================
// Ángulo 3 — Patrón de la transacción
// ============================================================

function anglePatron(prop: PropuestaContext, patron: PatronContext): AngleResult {
  // Múltiples del mismo receptor en el mismo día = típico exchange P2P
  if (patron.cantidad_mismo_dia_mismo_receptor >= 2) {
    return {
      veredicto: "afecta",
      peso: 0.65,
      razon: `${patron.cantidad_mismo_dia_mismo_receptor} operaciones del mismo cliente el mismo día — patrón exchange habitual`,
    };
  }
  // Recurrencia mensual fuerte = servicio recurrente
  if (patron.cantidad_mes_mismo_receptor >= 4) {
    return {
      veredicto: "afecta",
      peso: 0.40,
      razon: `Cliente recurrente: ${patron.cantidad_mes_mismo_receptor} ops en el mes`,
    };
  }
  // Monto redondo grande sin glosa = típico cripto P2P
  if (prop.monto > 100_000 && prop.monto % 1000 === 0) {
    return {
      veredicto: "afecta",
      peso: 0.25,
      razon: "Monto redondo significativo — patrón cripto/intermediación",
    };
  }
  return { veredicto: "neutral", peso: 0, razon: "" };
}

// ============================================================
// Ángulo extra — Hint explícito del usuario sobre la cartola
// ============================================================

function angleHint(hint: DocumentoHint): AngleResult {
  switch (hint) {
    case "p2p_cripto":
      return {
        veredicto: "exenta",
        peso: 0.90,
        razon: "Usuario marcó cartola como P2P cripto — activo incorporal, no IVA",
      };
    case "forex_divisas":
      return {
        veredicto: "exenta",
        peso: 0.90,
        razon: "Usuario marcó cartola como forex/divisas — no IVA",
      };
    case "servicios":
      return {
        veredicto: "afecta",
        peso: 0.80,
        razon: "Usuario marcó cartola como servicios profesionales — afecta IVA",
      };
    case "ventas":
      return {
        veredicto: "afecta",
        peso: 0.80,
        razon: "Usuario marcó cartola como ventas de bienes — afecta IVA",
      };
    case "mixto":
    case null:
    default:
      return { veredicto: "neutral", peso: 0, razon: "" };
  }
}

// ============================================================
// Ensemble — vota y decide
// ============================================================

export function clasificarBoleta(
  prop: PropuestaContext,
  empresa: EmpresaContext,
  patron: PatronContext = { cantidad_mismo_dia_mismo_receptor: 0, cantidad_mes_mismo_receptor: 0 },
  hint: DocumentoHint = null,
): ClasificacionResult {
  const glosa = angleGlosa(prop.descripcion);
  const giro = angleGiro(empresa.giro);
  const pat = anglePatron(prop, patron);
  // El hint del usuario pisa los otros ángulos con peso alto (0.9) cuando
  // está set. El usuario marcó la cartola entera como P2P cripto / servicios
  // / etc. Más confiable que inferir de la glosa cuando la descripción es
  // genérica ("Transf de Juan" sin mencionar USDT).
  const hintAngle = angleHint(hint);

  const votos: Record<TipoBoletaSugerido, number> = { afecta: 0, exenta: 0, no_boletar: 0 };
  for (const r of [glosa, giro, pat, hintAngle]) {
    if (r.veredicto !== "neutral") votos[r.veredicto] += r.peso;
  }

  // Priorizo el hint del usuario en las razones (lo ven primero)
  const allAngles = [hintAngle, glosa, giro, pat];

  // NO_BOLETAR: decisión binaria. Si tiene peso fuerte, prevalece.
  if (votos.no_boletar > 0.5) {
    const total = votos.afecta + votos.exenta + votos.no_boletar;
    return {
      tipo_dte: null,
      sugerencia: "no_boletar",
      confianza: total > 0 ? votos.no_boletar / total : 0.5,
      razones: allAngles.filter((r) => r.veredicto !== "neutral").map((r) => r.razon),
      angulos: { glosa, giro, patron: pat },
    };
  }

  // Entre afecta y exenta, gana el de mayor peso.
  const sugerencia: TipoBoletaSugerido = votos.exenta > votos.afecta ? "exenta" : "afecta";
  const tipo_dte: TipoDTE = sugerencia === "afecta" ? 39 : 41;
  const total = votos.afecta + votos.exenta + votos.no_boletar;
  const confianza = total === 0 ? 0.35 : votos[sugerencia] / total;

  return {
    tipo_dte,
    sugerencia,
    confianza,
    razones: allAngles.filter((r) => r.veredicto !== "neutral").map((r) => r.razon),
    angulos: { glosa, giro, patron: pat },
  };
}
