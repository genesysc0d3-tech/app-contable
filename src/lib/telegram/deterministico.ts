import { parseFecha } from "../ai/fecha";
import { parseComprobanteTexto } from "../comprobante/extract";

export type TipoFlujoTelegram = "entrada" | "salida";

type MontoParser = "etiqueta" | "candidatos" | "plantilla";
type FuerzaVoto = "fuerte" | "media";

type MontoVote = {
  parser: MontoParser;
  monto: number;
  linea: string;
  lineaIndex: number;
  fuerza: FuerzaVoto;
  motivo: string;
};

type PublicMontoVote = Pick<MontoVote, "parser" | "monto" | "fuerza" | "motivo" | "linea">;

type MontoDescartado = {
  valor: number;
  linea: number;
  motivo: string;
};

export type MontoTelegramDecision = {
  monto: number;
  linea_monto: string;
  decision: string;
  votos: PublicMontoVote[];
};

export type MontoTelegramResolution = {
  decision: MontoTelegramDecision | null;
  diagnostics: {
    decision: string;
    votos: PublicMontoVote[];
    candidatos_descartados: MontoDescartado[];
  };
  ambiguous: boolean;
};

export type FechaTelegramDecision = {
  fecha: string;
  visible: boolean;
  linea?: string;
  decision: string;
};

export type DireccionTelegramDecision = {
  tipo_flujo: TipoFlujoTelegram;
  decision: string;
  votos: Array<{ parser: "identidad" | "rol" | "verbal"; tipo_flujo: TipoFlujoTelegram; motivo: string }>;
  destino_es_empresa: boolean;
  origen_es_empresa: boolean;
};

type RawAmount = {
  valor: number;
  raw: string;
  conMoneda: boolean;
};

type AmountCandidate = RawAmount & {
  linea: string;
  lineaIndex: number;
  conEtiqueta: boolean;
  lineaSoloMonto: boolean;
};

const MONTO_LABEL_RE = /\b(monto(?:\s+transferid[oa])?|total|importe|valor|pag(?:o|ado|aste)|abon(?:o|ado)|recibiste|transferid[oa])\b/i;
const LINEA_NO_MONTO_RE = /\b(saldo|disponible|cupo|comisi[oó]n|costo|cuenta|cta|rut|run|operaci[oó]n|transacci[oó]n|c[oó]digo|folio|autorizaci[oó]n|correo|email|banco\s+(?:origen|destino|receptor|emisor))\b|\bn\s*[°ºo.]\b/i;
const FECHA_O_HORA_RE = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/i;
const NUMERO_CLP_RE = /(?:\$|\bCLP\b)?\s*(\d{1,3}(?:\.\d{3})+|\d{4,8})(?:,\d{1,2})?\s*(?:\bCLP\b|pesos)?/gi;
const CODIGO_LARGO_RE = /\b\d{9,}\b/;
const CODIGO_LARGO_GLOBAL_RE = /\b\d{9,}\b/g;
const MESES_RE = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic";

export function normalizeForTelegramMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function lineasOcrTelegram(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function contieneIdentidadTelegram(text: string, identidades: string[]): boolean {
  const normalized = normalizeForTelegramMatch(text);
  const digits = text.replace(/\D/g, "");
  return identidades.some((id) => {
    const idNorm = normalizeForTelegramMatch(id);
    const idDigits = id.replace(/\D/g, "");
    return (idNorm.length >= 4 && normalized.includes(idNorm)) ||
      (idDigits.length >= 4 && digits.includes(idDigits));
  });
}

function parseMontoToken(raw: string): number | null {
  const entero = raw.replace(/\s/g, "").split(",")[0] ?? "";
  const digits = entero.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 8) return null;
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function motivoLineaNoMonto(line: string): string | null {
  if (LINEA_NO_MONTO_RE.test(line)) return "linea_cuenta_rut_codigo_saldo";
  if (FECHA_O_HORA_RE.test(line) && !MONTO_LABEL_RE.test(line) && !/[\$]|\bCLP\b|pesos/i.test(line)) {
    return "linea_fecha_hora";
  }
  return null;
}

function rawAmounts(line: string): RawAmount[] {
  const out: RawAmount[] = [];
  for (const match of line.matchAll(NUMERO_CLP_RE)) {
    const token = match[1] ?? "";
    const tokenStart = (match.index ?? 0) + match[0].indexOf(token);
    const tokenEnd = tokenStart + token.length;
    if (/\d/.test(line[tokenStart - 1] ?? "") || /\d/.test(line[tokenEnd] ?? "")) continue;
    const valor = parseMontoToken(match[1] ?? "");
    if (valor === null) continue;
    const raw = match[0].trim();
    out.push({
      valor,
      raw,
      conMoneda: /[\$]|\bCLP\b|pesos/i.test(raw),
    });
  }
  return out;
}

function looseClpDigits(value: string, hasCurrencySignal: boolean): string {
  const groups = value.match(/\d+/g) ?? [];
  if (hasCurrencySignal && groups.length === 2 && groups[0].length <= 3 && groups[1].length > 0 && groups[1].length < 3) {
    return `${groups[0]}${groups[1].padEnd(3, "0")}`;
  }
  return groups.join("");
}

function looseAmounts(line: string): RawAmount[] {
  if (CODIGO_LARGO_RE.test(line)) return [];
  if (FECHA_O_HORA_RE.test(line) && !/[\$]|\bCLP\b|pesos|(^|\s)S(?=\s*\d)/i.test(line)) return [];

  const currencySignal = /[\$]|\bCLP\b|pesos|(^|\s)S(?=\s*\d)/i.test(line);
  const withoutCurrency = line
    .replace(/\bCLP\b|pesos?/gi, "")
    .replace(/[\$]/g, "")
    .replace(/(^|\s)S(?=\s*\d)/gi, " ")
    .trim();
  const amountOnly = /^[\d\s.,:-]+$/.test(withoutCurrency);
  if (!currencySignal && !amountOnly) return [];

  const digits = looseClpDigits(withoutCurrency, currencySignal || amountOnly);
  if (digits.length < 3 || digits.length > 8) return [];
  const valor = Number(digits);
  if (!Number.isFinite(valor) || valor <= 0) return [];
  return [{ valor, raw: line.trim(), conMoneda: currencySignal }];
}

function lineaSoloMonto(line: string): boolean {
  if (CODIGO_LARGO_RE.test(line)) return false;
  const withoutCurrency = line
    .replace(/\bCLP\b|pesos?/gi, "")
    .replace(/[\$]/g, "")
    .replace(/(^|\s)S(?=\s*\d)/gi, " ")
    .trim();
  const amountOnly = /^[\d\s.,:-]+$/.test(withoutCurrency);
  const digits = looseClpDigits(withoutCurrency, amountOnly || /[\$]|\bCLP\b|pesos|(^|\s)S(?=\s*\d)/i.test(line));
  if (digits.length < 3 || digits.length > 8) return false;
  if (amountOnly) return true;
  const stripped = line
    .replace(NUMERO_CLP_RE, "")
    .replace(/[\s:$.-]/g, "")
    .trim();
  return stripped.length === 0;
}

function candidatesFromLine(line: string, lineIndex: number, descartados: MontoDescartado[]): AmountCandidate[] {
  const codigosLargos = [...line.matchAll(CODIGO_LARGO_GLOBAL_RE)];
  for (const code of codigosLargos) {
    const valor = Number(code[0]);
    if (Number.isSafeInteger(valor)) descartados.push({ valor, linea: lineIndex + 1, motivo: "codigo_largo_no_monto" });
  }
  const amounts = rawAmounts(line);
  const candidates = amounts.length > 0 ? amounts : looseAmounts(line);
  if (candidates.length === 0) return [];

  const motivo = motivoLineaNoMonto(line);
  if (motivo) {
    for (const amount of candidates) descartados.push({ valor: amount.valor, linea: lineIndex + 1, motivo });
    return [];
  }

  const conEtiqueta = MONTO_LABEL_RE.test(line);
  const solo = lineaSoloMonto(line);
  return candidates.map((amount) => ({ ...amount, linea: line, lineaIndex: lineIndex, conEtiqueta, lineaSoloMonto: solo }));
}

function compactDiscards(descartados: MontoDescartado[]): MontoDescartado[] {
  const seen = new Set<string>();
  const out: MontoDescartado[] = [];
  for (const item of descartados) {
    const key = `${item.valor}:${item.linea}:${item.motivo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 8) break;
  }
  return out;
}

function montoPorEtiqueta(lines: string[], descartados: MontoDescartado[]): MontoVote | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!MONTO_LABEL_RE.test(line)) continue;

    const inline = candidatesFromLine(line, i, descartados).find((candidate) => candidate.conMoneda || candidate.conEtiqueta);
    if (inline) {
      return {
        parser: "etiqueta",
        monto: inline.valor,
        linea: inline.linea,
        lineaIndex: inline.lineaIndex,
        fuerza: "fuerte",
        motivo: "etiqueta_y_monto_misma_linea",
      };
    }

    for (let offset = 1; offset <= 3; offset++) {
      const next = lines[i + offset];
      if (!next) continue;
      const candidate = candidatesFromLine(next, i + offset, descartados).find((c) => c.conMoneda || c.lineaSoloMonto);
      if (!candidate) continue;
      return {
        parser: "etiqueta",
        monto: candidate.valor,
        linea: candidate.linea,
        lineaIndex: candidate.lineaIndex,
        fuerza: "fuerte",
        motivo: "etiqueta_linea_anterior",
      };
    }
  }
  return null;
}

function montoPorCandidatos(lines: string[], descartados: MontoDescartado[]): MontoVote | null {
  let best: { candidate: AmountCandidate; score: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const prevTieneEtiqueta = i > 0 && MONTO_LABEL_RE.test(lines[i - 1]);
    for (const candidate of candidatesFromLine(lines[i], i, descartados)) {
      let score = 0;
      if (candidate.conMoneda) score += 4;
      if (candidate.conEtiqueta) score += 3;
      if (prevTieneEtiqueta) score += 3;
      if (candidate.lineaSoloMonto) score += 2;
      if (/\b(enviaste|transferiste|recibiste|pagaste)\b/i.test(candidate.linea)) score += 2;
      score -= i / 100;

      if (!best || score > best.score) best = { candidate, score };
    }
  }

  if (!best || best.score < 3) return null;
  return {
    parser: "candidatos",
    monto: best.candidate.valor,
    linea: best.candidate.linea,
    lineaIndex: best.candidate.lineaIndex,
    fuerza: best.score >= 5.5 ? "fuerte" : "media",
    motivo: `score_${best.score.toFixed(2)}`,
  };
}

function lineForAmount(lines: string[], amount: number): { line: string; index: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (motivoLineaNoMonto(lines[i])) continue;
    if (rawAmounts(lines[i]).some((candidate) => candidate.valor === amount)) return { line: lines[i], index: i };
  }
  return null;
}

function montoPorPlantilla(lines: string[]): MontoVote | null {
  const parsed = parseComprobanteTexto(lines.join("\n"));
  if (!parsed.monto || parsed.confianza.monto < 0.7) return null;
  const line = lineForAmount(lines, parsed.monto);
  if (!line) return null;
  return {
    parser: "plantilla",
    monto: parsed.monto,
    linea: line.line,
    lineaIndex: line.index,
    fuerza: parsed.confianza.monto >= 0.85 ? "fuerte" : "media",
    motivo: `parser_comprobante_${parsed.confianza.monto.toFixed(2)}`,
  };
}

export function resolverMontoTelegram(lines: string[]): MontoTelegramResolution {
  const descartados: MontoDescartado[] = [];
  const votes = [
    montoPorEtiqueta(lines, descartados),
    montoPorCandidatos(lines, descartados),
    montoPorPlantilla(lines),
  ].filter((vote): vote is MontoVote => Boolean(vote));

  const publicVotes = votes.map(({ parser, monto, fuerza, motivo, linea }) => ({ parser, monto, fuerza, motivo, linea }));
  const diagnostics = {
    decision: "sin_candidato",
    votos: publicVotes,
    candidatos_descartados: compactDiscards(descartados),
  };

  if (votes.length === 0) return { decision: null, diagnostics, ambiguous: false };

  const groups = new Map<number, MontoVote[]>();
  for (const vote of votes) groups.set(vote.monto, [...(groups.get(vote.monto) ?? []), vote]);
  const grouped = [...groups.values()].sort((a, b) => b.length - a.length || a[0].lineaIndex - b[0].lineaIndex);
  const winner = grouped[0];

  if (winner.length >= 2 || (votes.length === 1 && winner[0].fuerza === "fuerte")) {
    const preferred = winner.find((vote) => vote.parser === "etiqueta") ?? winner[0];
    const decisionText = winner.length >= 2 ? "consenso_2_de_3" : "unico_voto_fuerte";
    return {
      decision: {
        monto: preferred.monto,
        linea_monto: preferred.linea,
        decision: decisionText,
        votos: publicVotes,
      },
      diagnostics: {
        ...diagnostics,
        decision: decisionText,
      },
      ambiguous: false,
    };
  }

  const etiquetaFuerte = votes.find((vote) => vote.parser === "etiqueta" && vote.fuerza === "fuerte");
  if (etiquetaFuerte) {
    const conflictos = votes.filter((vote) => vote.monto !== etiquetaFuerte.monto);
    const conflictoFuerte = conflictos.some((vote) => vote.fuerza === "fuerte");
    if (conflictos.length === 1 && !conflictoFuerte && conflictos[0].parser !== "etiqueta") {
      const decisionText = "etiqueta_fuerte_sobre_conflicto_medio";
      return {
        decision: {
          monto: etiquetaFuerte.monto,
          linea_monto: etiquetaFuerte.linea,
          decision: decisionText,
          votos: publicVotes,
        },
        diagnostics: {
          ...diagnostics,
          decision: decisionText,
        },
        ambiguous: false,
      };
    }
  }

  return {
    decision: null,
    diagnostics: {
      ...diagnostics,
      decision: groups.size > 1 ? "conflicto_entre_parsers" : "voto_debil_sin_consenso",
    },
    ambiguous: true,
  };
}

function fechaEnRango(fecha: string, fallback: string): boolean {
  const year = Number(fecha.slice(0, 4));
  const fallbackYear = Number(fallback.slice(0, 4));
  if (!Number.isFinite(year) || !Number.isFinite(fallbackYear)) return true;
  return year >= fallbackYear - 2 && year <= fallbackYear + 1;
}

function lineaFechaBloqueada(line: string): boolean {
  return /\b(cuenta|cta|rut|run|operaci[oó]n|transacci[oó]n|c[oó]digo|folio|autorizaci[oó]n)\b|\bn\s*[°ºo.]\b/i.test(line);
}

export function fechaDesdeTextoTelegram(lines: string[], fallback: string): FechaTelegramDecision {
  const fallbackYear = Number(fallback.slice(0, 4)) || new Date().getFullYear();
  const monthPattern = new RegExp(`\\b(\\d{1,2}\\s+(?:de\\s+)?(?:${MESES_RE})\\.?\\s*(?:(?:de|del)\\s+)?(?:\\d{4})?)\\b`, "i");

  for (const line of lines) {
    if (lineaFechaBloqueada(line)) continue;

    const numeric = line.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);
    if (numeric?.[1]) {
      const fecha = parseFecha(numeric[1]);
      if (fechaEnRango(fecha, fallback)) return { fecha, visible: true, linea: line, decision: "fecha_numerica_visible" };
    }

    const textual = line.match(monthPattern);
    if (textual?.[1]) {
      const raw = /\d{4}/.test(textual[1]) ? textual[1] : `${textual[1]} ${fallbackYear}`;
      const fecha = parseFecha(raw);
      if (fechaEnRango(fecha, fallback)) return { fecha, visible: true, linea: line, decision: "fecha_textual_visible" };
    }
  }

  return { fecha: fallback, visible: false, decision: "fallback_fecha_recepcion_chile" };
}

function esCorteBloque(line: string): boolean {
  return /^(de|desde|origen|remitente|titular|para|destinatario|beneficiario|a la cuenta|cuenta|cuenta destino|cta|rut|run|monto|total|importe|fecha|n[uú]mero|n[°º]|c[oó]digo|operaci[oó]n|transacci[oó]n)\b/i.test(line) || /[\$]|\bCLP\b|pesos/i.test(line);
}

function bloqueDespuesDe(lines: string[], label: RegExp): string {
  const idx = lines.findIndex((line) => label.test(line));
  if (idx < 0) return "";
  const out: string[] = [];
  for (const line of lines.slice(idx + 1, idx + 6)) {
    if (esCorteBloque(line)) break;
    out.push(line);
  }
  return out.join(" ").trim();
}

export function destinoDesdeTextoTelegram(lines: string[]): string {
  for (const line of lines) {
    const inline = line.match(/^(?:para|destinatario|beneficiario|a la cuenta|cuenta destino)\s*:?[\s-]*(.+)$/i);
    if (inline?.[1] && !MONTO_LABEL_RE.test(inline[1])) return inline[1].trim();
  }
  return bloqueDespuesDe(lines, /^(?:para|destinatario|beneficiario|a la cuenta|cuenta destino)$/i);
}

export function origenDesdeTextoTelegram(lines: string[]): string {
  for (const line of lines) {
    const inline = line.match(/^(?:de|desde|origen|remitente|titular)\s*:?[\s-]*(.+)$/i);
    if (inline?.[1] && !/transferenc/i.test(inline[1])) return inline[1].trim();
  }
  return bloqueDespuesDe(lines, /^(?:de|desde|origen|remitente|titular)$/i);
}

export function nombreContraparteTelegram(text: string): string {
  const parts = text.split(/\s+de\s+/i);
  const last = parts[parts.length - 1]?.trim();
  if (last && last.length > 2 && !/banco|cuenta|rut|n[°º]/i.test(last)) return last;
  return text.split(/\s+/).slice(0, 6).join(" ");
}

export function resolverDireccionTelegram(args: {
  text: string;
  destino: string;
  origen: string;
  identidades: string[];
}): DireccionTelegramDecision | null {
  const destinoEsEmpresa = args.destino ? contieneIdentidadTelegram(args.destino, args.identidades) : false;
  const origenEsEmpresa = args.origen ? contieneIdentidadTelegram(args.origen, args.identidades) : false;
  const votos: DireccionTelegramDecision["votos"] = [];

  if (destinoEsEmpresa && !origenEsEmpresa) {
    votos.push({ parser: "identidad", tipo_flujo: "entrada", motivo: "identidad_empresa_en_destino" });
    votos.push({ parser: "rol", tipo_flujo: "entrada", motivo: "bloque_destino_contiene_empresa" });
  } else if (origenEsEmpresa && !destinoEsEmpresa) {
    votos.push({ parser: "identidad", tipo_flujo: "salida", motivo: "identidad_empresa_en_origen" });
    votos.push({ parser: "rol", tipo_flujo: "salida", motivo: "bloque_origen_contiene_empresa" });
  }

  const norm = normalizeForTelegramMatch(args.text);
  if (/\b(recibiste|te transfirio|pago recibido|abono|abonado|transferencia recibida|te pagaron|acreditado)\b/.test(norm)) {
    votos.push({ parser: "verbal", tipo_flujo: "entrada", motivo: "texto_indica_pago_recibido" });
  } else if (/\b(enviaste|transferiste|realizaste|monto transferido|a la cuenta|cuenta destino|destinatario|transferencia se ha realizado)\b/.test(norm)) {
    votos.push({ parser: "verbal", tipo_flujo: "salida", motivo: "texto_indica_transferencia_enviada" });
  }

  const entradas = votos.filter((vote) => vote.tipo_flujo === "entrada");
  const salidas = votos.filter((vote) => vote.tipo_flujo === "salida");
  let tipo: TipoFlujoTelegram | null = null;
  let decision = "sin_consenso";

  if (entradas.length >= 2 && entradas.length >= salidas.length) {
    tipo = "entrada";
    decision = "consenso_entrada";
  } else if (salidas.length >= 2 && salidas.length >= entradas.length) {
    tipo = "salida";
    decision = "consenso_salida";
  } else {
    const identidad = votos.find((vote) => vote.parser === "identidad");
    const unico = votos.length === 1 ? votos[0] : null;
    if (identidad) {
      tipo = identidad.tipo_flujo;
      decision = "identidad_empresa_prioritaria";
    } else if (unico) {
      tipo = unico.tipo_flujo;
      decision = "unico_voto_verbal";
    }
  }

  if (!tipo) return null;
  return { tipo_flujo: tipo, decision, votos, destino_es_empresa: destinoEsEmpresa, origen_es_empresa: origenEsEmpresa };
}
