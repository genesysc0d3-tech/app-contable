/**
 * LA MANGUERA del conector MCP — cuánto puede LEER un asistente conectado.
 *
 * La auditoría de 3 lentes (2026-09-04) lo dijo sin vueltas: el riesgo del
 * conector no está en lo que escribe (dos verbos pre-emisión, reversibles)
 * sino en lo que DEVUELVE. `pendientes_emision` salía sin ventana de fechas:
 * hasta 1.000 filas por llamada, 60 llamadas por minuto, con las `razones` del
 * clasificador — la doctrina tributaria de massDTE con fuente incluida — y
 * cero rastro. 3,6 millones de filas por hora para quien quisiera copiarnos el
 * criterio por el precio de un plan Start.
 *
 * Esto lo cierra en tres capas, todas con infraestructura que YA existía
 * (el limitador global en Postgres); no hay tabla nueva ni contador propio:
 *
 *   1. VENTANA DE MES. Se lee el mes en curso (Chile) o uno de hasta 12 atrás.
 *      Un mes cabe entero para el uso real (revisar el check antes de emitir);
 *      barrer la historia completa no es un caso de uso, es una extracción.
 *   2. TOPE DE FILAS por llamada: 100. Si el mes tiene más, el resultado lo
 *      dice (`posiblemente_truncado`) y la vista completa sigue siendo la app.
 *   3. RITMO Y TECHO por TOKEN: 10 lecturas por minuto y 30 por día.
 *      30 × 100 = 3.000 filas/día como máximo absoluto — tres órdenes de
 *      magnitud menos que antes, y el cliente legítimo no pierde nada.
 *
 * La llave es el TOKEN, no el usuario ni la cuenta: un mismo humano con dos
 * asistentes conectados tiene dos mangueras, pero cada una es chica. (La
 * cuota de EMISIÓN sigue siendo por cuenta — eso es otro tema, tanda 3.)
 *
 * Cuando un freno salta se avisa a ops UNA vez por hora por token y por tipo
 * (también con el limitador, no con estado en memoria): así el script educado
 * que golpea el techo queda a la vista sin que el bloqueo mismo se vuelva
 * una lluvia de eventos.
 *
 * Todo es puro salvo el cliente RPC, que se inyecta para testear la DECISIÓN
 * sin Supabase real (mismo patrón que rate-limit-global.test.ts).
 */

import { chileDateString, chileDayStartUtc } from "../chile-date";
import { checkRateLimitGlobal, type RateLimitRpcClient } from "../security/rate-limit-global";

export const LIMITE_FILAS_LECTURA = 100;
export const LIMITE_LECTURAS_POR_MINUTO = 10;
export const LIMITE_LECTURAS_POR_DIA = 30;
export const MESES_HACIA_ATRAS_MAX = 12;

const MINUTO_MS = 60_000;
const DIA_MS = 24 * 60 * 60 * 1000;
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

export type Freno =
  | { ok: true }
  | { ok: false; motivo: "ritmo" | "tope_diario"; retryAfterSeconds: number; avisar: boolean };

/**
 * Cuenta UNA lectura contra el ritmo (10/min) y el techo (30/día) del token.
 * Si alguno se pasó, devuelve por qué y si corresponde avisar a ops (a lo
 * más una vez por hora por token y motivo).
 */
export async function frenarLectura(
  args: { tokenId: string; cliente?: RateLimitRpcClient | null },
): Promise<Freno> {
  const cliente = args.cliente === undefined ? undefined : args.cliente;
  const opciones = (key: string, limit: number, windowMs: number) =>
    cliente === undefined
      ? checkRateLimitGlobal({ key, limit, windowMs })
      : checkRateLimitGlobal({ key, limit, windowMs }, cliente);

  const ritmo = await opciones(`mcp-lectura-min:${args.tokenId}`, LIMITE_LECTURAS_POR_MINUTO, MINUTO_MS);
  if (!ritmo.ok) {
    const aviso = await opciones(`mcp-lectura-aviso:ritmo:${args.tokenId}`, 1, HORA_MS);
    return { ok: false, motivo: "ritmo", retryAfterSeconds: ritmo.retryAfterSeconds, avisar: aviso.ok };
  }
  const dia = await opciones(`mcp-lectura-dia:${args.tokenId}`, LIMITE_LECTURAS_POR_DIA, DIA_MS);
  if (!dia.ok) {
    const aviso = await opciones(`mcp-lectura-aviso:dia:${args.tokenId}`, 1, HORA_MS);
    return { ok: false, motivo: "tope_diario", retryAfterSeconds: dia.retryAfterSeconds, avisar: aviso.ok };
  }
  return { ok: true };
}

/** Lo que se le dice al asistente cuando un freno salta. Sin culpar, con salida. */
export function mensajeDeFreno(freno: Exclude<Freno, { ok: true }>): string {
  if (freno.motivo === "ritmo") {
    return `Demasiadas lecturas seguidas: este conector permite ${LIMITE_LECTURAS_POR_MINUTO} por minuto. Reintenta en ${freno.retryAfterSeconds} s.`;
  }
  const horas = Math.max(1, Math.ceil(freno.retryAfterSeconds / 3600));
  return `Se alcanzó el máximo de ${LIMITE_LECTURAS_POR_DIA} lecturas por día de este conector. Vuelve en ~${horas} h; mientras tanto, el detalle completo está en la app.`;
}
