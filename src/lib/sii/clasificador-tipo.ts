/**
 * Clasificador de operaciones para boleta — replica el criterio del SII
 * chileno (DL 825 IVA, Of. 963/2018 cripto, Art. 12/13 exenciones).
 *
 * Estrategia de redundancia: 3 ángulos independientes votan, ensemble decide.
 *   1. Glosa textual (keywords + patterns regex)
 *   2. Giro de la empresa
 *   3. Patrón de la transacción (frecuencia, monto, recurrencia)
 *   4. tipo_contribuyente de la empresa (biés: afecto → +0.3, exento → +0.3)
 *
 * Si los 3 coinciden → confianza alta. Si discrepan → defaultiar a AFECTA
 * con confianza baja, marcar para revisión humana.
 *
 * Además, si el usuario marca la cartola con un hint explícito
 * ("p2p_cripto", "forex_divisas", "servicios", "ventas"), el hint es
 * autoritativo y prevalece sobre los ángulos heurísticos — salvo que la
 * glosa detecte "no_boletar" (transf entre cuentas propias, sueldo,
 * préstamo, etc.), caso en que la fila específica no se boletea aunque
 * la cartola entera sí sea cripto.
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
  tipo_contribuyente?: string | null;
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
  // Alternativas-prefijo llevan \w* antes del \b: sin él, "consulta médica",
  // "kinesiología" o "psicólogo" jamás calzaban (no hay borde tras el prefijo).
  if (/\b(consulta m[eé]d\w*|kinesi\w*|odont\w*|psic[oó]log\w*|cl[ií]nica|hospital|m[eé]dic\w*|fonoaudi\w*|nutri\w*|farmacia)\b/.test(desc))
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

function anglePatron(_prop: PropuestaContext, _patron: PatronContext): AngleResult {
  // El patrón (repetición del mismo receptor, monto redondo) NO determina
  // afecta vs exenta por sí solo — es la misma huella tanto para P2P cripto
  // (exenta, activo incorporal) como para un servicio recurrente (afecta) o
  // retail con cliente fiel. Sin contenido en la glosa o un hint del usuario,
  // es información insuficiente para votar. Se deja neutral para no
  // contaminar al ensemble.
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
  const hintAngle = angleHint(hint);

  // Una transf entre cuentas propias (o sueldo, préstamo, devolución) NO se
  // boletea aunque la cartola entera esté marcada como cripto/servicios. La
  // detección por glosa con peso ≥ 0.7 prevalece siempre — incluso sobre el
  // hint del usuario.
  if (glosa.veredicto === "no_boletar" && glosa.peso >= 0.7) {
    return {
      tipo_dte: null,
      sugerencia: "no_boletar",
      confianza: glosa.peso,
      razones: [glosa.razon],
      angulos: { glosa, giro, patron: pat },
    };
  }

  // Exención por ley (cripto Of. 963/2018, salud/educación/transporte; glosa ≥0.80):
  // es un hecho tributario, no una preferencia de config. Se computa ANTES del hint
  // porque un hint "servicios/ventas" (afecta) no puede taparla.
  const exencionPorLey = glosa.veredicto === "exenta" && glosa.peso >= 0.8;

  // Si el usuario marcó la naturaleza de la cartola explícitamente
  // (p2p_cripto, forex_divisas, servicios, ventas), eso es autoritativo... salvo
  // que un hint "afecta" contradiga una exención por ley o a un contribuyente
  // declarado EXENTO (que no puede emitir DTE 39 con IVA). En esos dos casos el
  // hint cede al ensemble de abajo, que lo corrige a exenta.
  if (hintAngle.veredicto === "afecta" || hintAngle.veredicto === "exenta") {
    const hintForzariaAfectaIndebida =
      hintAngle.veredicto === "afecta" &&
      (exencionPorLey || empresa.tipo_contribuyente === "exento");
    if (!hintForzariaAfectaIndebida) {
      const otras = [glosa, giro, pat].filter((r) => r.veredicto !== "neutral").map((r) => r.razon);
      return {
        tipo_dte: hintAngle.veredicto === "afecta" ? 39 : 41,
        sugerencia: hintAngle.veredicto,
        confianza: hintAngle.peso,
        razones: [hintAngle.razon, ...otras],
        angulos: { glosa, giro, patron: pat },
      };
    }
  }

  const votos: Record<TipoBoletaSugerido, number> = { afecta: 0, exenta: 0, no_boletar: 0 };
  for (const r of [glosa, giro, pat, hintAngle]) {
    if (r.veredicto !== "neutral") votos[r.veredicto] += r.peso;
  }

  // Empresa default: peso de desempate; la config declarada domina los casos comunes.
  // EXCEPCIÓN (asimétrica): un default "afecto" NO puede tapar una EXENCIÓN POR LEY
  // (cripto Of. 963/2018, educación/salud/transporte ≥0.80) — son hechos tributarios,
  // no una preferencia de config (evita boletear cripto como afecta por misconfig).
  // Al revés sí aplica: un "exento" legítimamente domina una señal "afecta" por
  // naturaleza (servicio/venta), que es el caso base, no una exención especial.
  // (exencionPorLey se computó arriba, antes del hint.)
  if (empresa.tipo_contribuyente === "afecto" && !exencionPorLey) {
    votos.afecta += 0.9;
  } else if (empresa.tipo_contribuyente === "exento") {
    votos.exenta += 0.9;
  }
  // Si es "auto", no hay biés. El clasificador decide libremente.

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
