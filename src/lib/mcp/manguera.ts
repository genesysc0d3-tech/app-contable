/**
 * LA MANGUERA del conector MCP — cuánto puede LEER y cuánto puede MOVER un
 * asistente conectado.
 *
 * La auditoría de 3 lentes (2026-09-04) lo dijo sin vueltas: el riesgo del
 * conector no está en lo que escribe (dos verbos pre-emisión, reversibles)
 * sino en lo que DEVUELVE. `pendientes_emision` salía sin ventana de fechas:
 * hasta 1.000 filas por llamada, 60 llamadas por minuto, con las `razones` del
 * clasificador y cero rastro. 3,6 millones de filas por hora para quien
 * quisiera copiarnos el criterio por el precio de un plan Start.
 *
 * Esto lo cierra en capas, todas con infraestructura que YA existía (el
 * limitador global en Postgres); no hay tabla nueva ni contador propio:
 *
 *   1. VENTANA DE MES. Se lee el mes en curso (Chile) o uno de hasta 12 atrás.
 *   2. PÁGINAS DE 100. Si el mes tiene más, `hay_mas` y se pide la siguiente.
 *      Un Business a tope (3.000/mes) lee su mes entero en 30 páginas —
 *      justo el techo del día. El límite deja de ser arbitrario: "tu mes
 *      completo, una vez al día".
 *   3. RITMO Y TECHO por TOKEN: 10 lecturas/min y 30/día. 30 × 100 = 3.000
 *      filas/día como máximo absoluto.
 *   4. ESCRITURAS también con techo por token (2ª auditoría, 2026-09-06): sin
 *      esto un token robado hacía 60 llamadas/min × 50 ids = 3.000 cambios de
 *      estado por minuto — devolver toda la mesa a revisión en loop, o dejar
 *      "listos" documentos que el humano no revisó. 40 documentos movidos por
 *      día por token es más que cualquier uso real de un copiloto de revisión.
 *
 * FAIL-CLOSED para lectura y escritura (2ª auditoría): el limitador global
 * cae a memoria por instancia si Postgres no responde, y para un techo diario
 * eso es "infinito" en serverless. Justo la manguera —que protege el activo
 * más caro— no puede ser fail-open. Si la base no responde, el asistente
 * espera un reintento; una fuga silenciosa no se recupera. El bucket del
 * AVISO sí es laxo: perder un aviso no es perder datos.
 *
 * La llave es el TOKEN, no el usuario ni la cuenta: un mismo humano con dos
 * asistentes conectados tiene dos mangueras, pero cada una es chica (y hay
 * tope de tokens vivos por usuario en el canje OAuth).
 *
 * Todo es puro salvo el cliente RPC, que se inyecta para testear la DECISIÓN
 * sin Supabase real (mismo patrón que rate-limit-global.test.ts).
 */

import { chileDateString, chileDayStartUtc } from "../chile-date";
import { checkRateLimitGlobal, checkRateLimitGlobalEstricto, type RateLimitRpcClient } from "../security/rate-limit-global";

export const LIMITE_FILAS_LECTURA = 100;
export const LIMITE_LECTURAS_POR_MINUTO = 10;
export const LIMITE_LECTURAS_POR_DIA = 30;
export const LIMITE_ESCRITURAS_POR_DIA = 40;
export const MESES_HACIA_ATRAS_MAX = 12;
/** 30 páginas × 100 = el mes entero de un Business a tope. */
export const PAGINA_MAX = LIMITE_LECTURAS_POR_DIA;

export const MINUTO_MS = 60_000;
export const DIA_MS = 24 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000;

export type VentanaMes = { mes: string; start: string; end: string };

/**
 * Traduce un `mes` ("YYYY-MM", opcional) a la ventana UTC que cubre ese mes
 * DE CHILE, para filtrar `created_at`. Sin argumento: el mes en curso.
 * Rechaza formato malo, meses futuros y más de 12 meses atrás — con un
 * mensaje que el asistente pueda repetirle al usuario tal cual.
 */
export function ventanaDelMes(mes: unknown, hoy: Date = new Date()): VentanaMes {
  const actual = chileDateString(hoy).slice(0, 7);
  const pedido = mes === undefined || mes === null || mes === "" ? actual : String(mes).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(pedido)) {
    throw new Error(`mes: usa el formato YYYY-MM (por ejemplo ${actual})`);
  }
  const [ay, am] = actual.split("-").map(Number);
  const [py, pm] = pedido.split("-").map(Number);
  const distancia = (ay - py) * 12 + (am - pm);
  if (distancia < 0) throw new Error(`mes: ${pedido} todavía no existe; el mes en curso es ${actual}`);
  if (distancia > MESES_HACIA_ATRAS_MAX) {
    throw new Error(`mes: este conector lee hasta ${MESES_HACIA_ATRAS_MAX} meses atrás; para más antiguo, la app`);
  }
  const siguiente = pm === 12 ? `${py + 1}-01` : `${py}-${String(pm + 1).padStart(2, "0")}`;
  return {
    mes: pedido,
    start: chileDayStartUtc(`${pedido}-01`),
    end: chileDayStartUtc(`${siguiente}-01`),
  };
}

/**
 * `pagina` (1..PAGINA_MAX, default 1) → offset de filas. Se rechaza lo que no
 * sea un entero en rango, con mensaje repetible. Tope PAGINA_MAX: más allá no
 * hay mes que lo llene y solo serviría para barrer.
 */
export function paginaAOffset(pagina: unknown): { pagina: number; offset: number } {
  const n = pagina === undefined || pagina === null || pagina === "" ? 1 : Number(pagina);
  if (!Number.isInteger(n) || n < 1) throw new Error("pagina: un entero desde 1");
  if (n > PAGINA_MAX) throw new Error(`pagina: máximo ${PAGINA_MAX} (${PAGINA_MAX * LIMITE_FILAS_LECTURA} documentos, el mes entero del plan más grande)`);
  return { pagina: n, offset: (n - 1) * LIMITE_FILAS_LECTURA };
}

export type Freno =
  | { ok: true }
  | { ok: false; motivo: "ritmo" | "tope_diario" | "tope_escrituras"; retryAfterSeconds: number; avisar: boolean };

type Bucket = (key: string, limit: number, windowMs: number) => ReturnType<typeof checkRateLimitGlobal>;

function buckets(cliente: RateLimitRpcClient | null | undefined): { estricto: Bucket; laxo: Bucket } {
  // `undefined` = usar el cliente real de producción; `null` = sin cliente
  // (solo tests). Se pasa tal cual para no inventar un tercer caso.
  const conCliente = cliente !== undefined;
  return {
    estricto: (key, limit, windowMs) =>
      conCliente ? checkRateLimitGlobalEstricto({ key, limit, windowMs }, cliente) : checkRateLimitGlobalEstricto({ key, limit, windowMs }),
    laxo: (key, limit, windowMs) =>
      conCliente ? checkRateLimitGlobal({ key, limit, windowMs }, cliente) : checkRateLimitGlobal({ key, limit, windowMs }),
  };
}

/**
 * Cuenta UNA lectura contra el ritmo (10/min) y el techo (30/día) del token.
 * Fail-closed. Si alguno se pasó, devuelve por qué y si corresponde avisar a
 * ops (a lo más una vez por hora por token y motivo).
 */
export async function frenarLectura(
  args: { tokenId: string; cliente?: RateLimitRpcClient | null },
): Promise<Freno> {
  const b = buckets(args.cliente);
  const ritmo = await b.estricto(`mcp-lectura-min:${args.tokenId}`, LIMITE_LECTURAS_POR_MINUTO, MINUTO_MS);
  if (!ritmo.ok) {
    const aviso = await b.laxo(`mcp-lectura-aviso:ritmo:${args.tokenId}`, 1, HORA_MS);
    return { ok: false, motivo: "ritmo", retryAfterSeconds: ritmo.retryAfterSeconds, avisar: aviso.ok };
  }
  const dia = await b.estricto(`mcp-lectura-dia:${args.tokenId}`, LIMITE_LECTURAS_POR_DIA, DIA_MS);
  if (!dia.ok) {
    const aviso = await b.laxo(`mcp-lectura-aviso:dia:${args.tokenId}`, 1, HORA_MS);
    return { ok: false, motivo: "tope_diario", retryAfterSeconds: dia.retryAfterSeconds, avisar: aviso.ok };
  }
  return { ok: true };
}

/**
 * Cuenta `cuantos` documentos movidos contra el techo de escrituras del token
 * (40/día). Fail-closed. Se cobra por DOCUMENTO, no por llamada: 50 ids en una
 * llamada son 50, no 1 — si no, el tope se burla juntando ids.
 */
export async function frenarEscritura(
  args: { tokenId: string; cuantos: number; cliente?: RateLimitRpcClient | null },
): Promise<Freno> {
  const b = buckets(args.cliente);
  const n = Math.max(1, Math.floor(args.cuantos));
  // El bucket cuenta hits de a uno; se pide n veces contra el mismo techo. Es
  // más simple que un contador con peso y a este volumen (≤50) no se nota.
  let ultimo = await b.estricto(`mcp-escritura-dia:${args.tokenId}`, LIMITE_ESCRITURAS_POR_DIA, DIA_MS);
  for (let i = 1; i < n && ultimo.ok; i++) {
    ultimo = await b.estricto(`mcp-escritura-dia:${args.tokenId}`, LIMITE_ESCRITURAS_POR_DIA, DIA_MS);
  }
  if (!ultimo.ok) {
    const aviso = await b.laxo(`mcp-lectura-aviso:escritura:${args.tokenId}`, 1, HORA_MS);
    return { ok: false, motivo: "tope_escrituras", retryAfterSeconds: ultimo.retryAfterSeconds, avisar: aviso.ok };
  }
  return { ok: true };
}

/** Lo que se le dice al asistente cuando un freno salta. Sin culpar, con salida. */
export function mensajeDeFreno(freno: Exclude<Freno, { ok: true }>): string {
  const horas = Math.max(1, Math.ceil(freno.retryAfterSeconds / 3600));
  switch (freno.motivo) {
    case "ritmo":
      return `Demasiadas lecturas seguidas: este conector permite ${LIMITE_LECTURAS_POR_MINUTO} por minuto. Reintenta en ${freno.retryAfterSeconds} s.`;
    case "tope_diario":
      return `Se alcanzó el máximo de ${LIMITE_LECTURAS_POR_DIA} lecturas por día de este conector. Vuelve en ~${horas} h; mientras tanto, el detalle completo está en la app.`;
    case "tope_escrituras":
      return `Se alcanzó el máximo de ${LIMITE_ESCRITURAS_POR_DIA} documentos movidos por día desde este conector. Lo que falte, el usuario lo ordena en la app; vuelve en ~${horas} h.`;
  }
}
