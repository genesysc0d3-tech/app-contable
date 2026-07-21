/**
 * GUARDARRAÍL DE EMISIÓN — clasifica las boletas PENDIENTES por el MES DE LA VENTA
 * (no por la fecha de subida) y determina, para cada mes, en qué punto del
 * calendario tributario está y con cuánta urgencia hay que emitir.
 *
 * Es el "cerebro" del guardarraíl. Deliberadamente PURA: sin I/O, sin Supabase,
 * sin `new Date()` interno. `hoy` se INYECTA como "YYYY-MM-DD" (de chileDateString(),
 * zona Chile). Así es 100% testeable y determinista — Vercel corre en UTC, y leer
 * la fecha adentro la rompería en el borde de medianoche.
 *
 * Base tributaria (verificada con contador ex-SII, DL 825):
 *  - Boleta AFECTA (39): el IVA vive en un F29 MENSUAL. El plazo "limpio" se cierra
 *    el día 12 del mes siguiente (Art. 64). Pasado eso → F29 fuera de plazo /
 *    rectificatoria (reajuste + interés). Por eso afecta aprieta mes a mes.
 *  - Boleta EXENTA (41, cripto): no genera IVA mensual (solo se informa la venta
 *    exenta). Su hito duro es la RENTA anual (F22, 30-abr del año siguiente). Aprieta
 *    el AÑO, no el mes.
 *
 * La granularidad del estado es POR MES DE VENTA; la urgencia cruza estado × tipo.
 */

export type TipoDte = 39 | 41;
export type EstadoCierre = "al_dia" | "ultima_llamada" | "ya_cerro" | "cruza_el_ano";
export type Urgencia = "baja" | "alta" | "critica" | "maxima";
export type Hito = "F29" | "F22";

/** Vencimiento del F29 (Art. 64 DL 825). Conservador: el día 20 exige declarar Y
 *  pagar por internet — no se asume por defecto para no relajar el guardarraíl. */
export const DIA_VENCIMIENTO_F29 = 12;

export interface PendienteVenta {
  id: string;
  /** Fecha REAL de la venta (movimientos_raw.fecha), "YYYY-MM-DD" (date pelado, sin zona). */
  fechaVenta: string;
  /** 39 afecta / 41 exenta / null si no se decidió el tipo. */
  tipoDte: TipoDte | null;
  /** Monto total en CLP (opcional — para el "$X" de la tarjeta). */
  monto?: number | null;
}

export interface BucketCierre {
  /** "YYYY-MM" del mes de la venta. */
  mesVenta: string;
  estado: EstadoCierre;
  urgencia: Urgencia;
  hito: Hito;
  /** Días hasta el hito relevante (día 12 del F29, o 30-abr del F22). Negativo = ya venció. */
  diasAlCierre: number;
  cantidad: number;
  monto: number;
  tieneAfecta: boolean;
  tieneExenta: boolean;
  ids: string[];
}

export interface ResumenCierre {
  /** Buckets ordenados: primero el más urgente, luego el mes más antiguo. */
  buckets: BucketCierre[];
  peorUrgencia: Urgencia;
  totalPendientes: number;
  /** Ítems descartados por no tener una fechaVenta "YYYY-MM-DD" válida (honestidad: no se cuentan mal). */
  omitidos: number;
}

export interface OpcionesCierre {
  /** "YYYY-MM-DD" en zona Chile (chileDateString()). SIEMPRE inyectado, nunca leído adentro. */
  hoy: string;
  /** Contribuyente exento: toda venta se trata como 41, ignorando tipoDte (evita falsos positivos de IVA). */
  empresaExenta?: boolean;
  /** Override del día de vencimiento del F29 (default 12). */
  diaVencimientoF29?: number;
}

const RANK: Record<Urgencia, number> = { baja: 0, alta: 1, critica: 2, maxima: 3 };
const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Días entre dos fechas "YYYY-MM-DD" (interpretadas como medianoche UTC — ambas date pelado). */
function diasEntre(desdeIso: string, hastaIso: string): number {
  const a = Date.parse(`${desdeIso}T00:00:00Z`);
  const b = Date.parse(`${hastaIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** ISO del día `dia` del mes SIGUIENTE al (anio, mes 1-12) dado. Ej: (2026,6,12) → "2026-07-12". */
function diaXDelMesSiguiente(anio: number, mes: number, dia: number): string {
  const mesSig = mes === 12 ? 1 : mes + 1;
  const anioSig = mes === 12 ? anio + 1 : anio;
  return `${anioSig}-${pad2(mesSig)}-${pad2(dia)}`;
}

function urgenciaDe(estado: EstadoCierre, esExenta: boolean, f22EnPlazo: boolean): Urgencia {
  switch (estado) {
    case "al_dia":
      return "baja";
    case "ultima_llamada":
      // Afecta: el F29 se cierra pronto → apura (ámbar). Exenta: sin IVA, sin apuro (verde).
      return esExenta ? "baja" : "alta";
    case "ya_cerro":
      // Afecta: el F29 ya venció → rectificatoria (rojo). Exenta: ordénala, pero sin sanción de IVA (ámbar).
      return esExenta ? "alta" : "critica";
    case "cruza_el_ano":
      // Afecta: además del F22, arrastra un F29 de un período cerrado → máxima.
      // Exenta: máxima solo si el F22 (30-abr) ya venció; entre ene-abr aún está en plazo (alta).
      return esExenta ? (f22EnPlazo ? "alta" : "maxima") : "maxima";
  }
}

interface Clasificacion {
  estado: EstadoCierre;
  hito: Hito;
  diasAlCierre: number;
  f22EnPlazo: boolean;
}

/** Clasifica un mes de venta ("YYYY-MM") contra hoy. Núcleo determinista del guardarraíl. */
function clasificarMes(mesVenta: string, hoy: string, diaVencF29: number): Clasificacion {
  const anioV = Number(mesVenta.slice(0, 4));
  const mesV = Number(mesVenta.slice(5, 7));
  const anioH = Number(hoy.slice(0, 4));
  const mesH = Number(hoy.slice(5, 7));
  const diaH = Number(hoy.slice(8, 10));

  // CRUZA_EL_ANO tiene precedencia: la venta es de un año calendario anterior → hito F22
  // (renta de abril). NO se marca "vencido" antes del 30-abr del año siguiente a la venta.
  if (anioV < anioH) {
    const objetivoF22 = `${anioV + 1}-04-30`;
    const dias = diasEntre(hoy, objetivoF22);
    return { estado: "cruza_el_ano", hito: "F22", diasAlCierre: dias, f22EnPlazo: dias >= 0 };
  }

  // Mismo año o futuro. El F29 de la venta cierra el día 12 del mes siguiente.
  const objetivoF29 = diaXDelMesSiguiente(anioV, mesV, diaVencF29);
  const diasF29 = diasEntre(hoy, objetivoF29);

  // Venta del mes en curso (o de un mes futuro, defensivo): dentro del período vigente.
  if (anioV > anioH || mesV >= mesH) {
    return { estado: "al_dia", hito: "F29", diasAlCierre: diasF29, f22EnPlazo: true };
  }

  // Mes inmediatamente anterior del MISMO año: ventana de "última llamada" hasta el día 12.
  // (El caso dic→ene ya cayó en CRUZA_EL_ANO por el año, así que aquí no hay wrap de año.)
  if (mesV === mesH - 1) {
    const estado: EstadoCierre = diaH <= diaVencF29 ? "ultima_llamada" : "ya_cerro";
    return { estado, hito: "F29", diasAlCierre: diasF29, f22EnPlazo: true };
  }

  // Mes más antiguo del mismo año: el F29 ya venció.
  return { estado: "ya_cerro", hito: "F29", diasAlCierre: diasF29, f22EnPlazo: true };
}

/**
 * Agrupa los pendientes por mes de venta y clasifica cada mes. Devuelve los buckets
 * ordenados del más urgente al menos, y el peor estado global (para el "héroe" de la tarjeta).
 */
export function clasificarBucketsVenta(
  pendientes: PendienteVenta[],
  opciones: OpcionesCierre,
): ResumenCierre {
  const hoy = opciones.hoy;
  const diaVenc = opciones.diaVencimientoF29 ?? DIA_VENCIMIENTO_F29;
  const empresaExenta = opciones.empresaExenta ?? false;

  const porMes = new Map<string, PendienteVenta[]>();
  let omitidos = 0;

  for (const p of pendientes) {
    if (!p.fechaVenta || !ISO_FECHA.test(p.fechaVenta)) {
      omitidos += 1; // sin fecha válida no se puede ubicar en un mes → no se cuenta mal
      continue;
    }
    const mes = p.fechaVenta.slice(0, 7);
    const arr = porMes.get(mes);
    if (arr) arr.push(p);
    else porMes.set(mes, [p]);
  }

  const buckets: BucketCierre[] = [];
  for (const [mesVenta, items] of porMes) {
    let tieneAfecta = false;
    let tieneExenta = false;
    let monto = 0;
    const ids: string[] = [];
    for (const it of items) {
      // Exento a nivel de empresa manda: toda venta es 41. Si no, tipoDte; null → 39 (conservador).
      const esItemExenta = empresaExenta || it.tipoDte === 41;
      if (esItemExenta) tieneExenta = true;
      else tieneAfecta = true;
      monto += it.monto ?? 0;
      ids.push(it.id);
    }
    // Si el bucket mezcla afecta y exenta, manda la urgencia de la AFECTA (peor caso).
    const bucketEsExenta = !tieneAfecta;
    const { estado, hito, diasAlCierre, f22EnPlazo } = clasificarMes(mesVenta, hoy, diaVenc);
    const urgencia = urgenciaDe(estado, bucketEsExenta, f22EnPlazo);
    buckets.push({
      mesVenta, estado, urgencia, hito, diasAlCierre,
      cantidad: items.length, monto, tieneAfecta, tieneExenta, ids,
    });
  }

  buckets.sort((a, b) => {
    const dr = RANK[b.urgencia] - RANK[a.urgencia];
    if (dr !== 0) return dr;
    return a.mesVenta < b.mesVenta ? -1 : a.mesVenta > b.mesVenta ? 1 : 0;
  });

  const peorUrgencia = buckets.reduce<Urgencia>(
    (peor, b) => (RANK[b.urgencia] > RANK[peor] ? b.urgencia : peor),
    "baja",
  );
  const totalPendientes = buckets.reduce((s, b) => s + b.cantidad, 0);

  return { buckets, peorUrgencia, totalPendientes, omitidos };
}
