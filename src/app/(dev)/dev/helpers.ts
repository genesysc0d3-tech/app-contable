/**
 * Helpers locales del panel /dev — fechas de Chile y cálculo de cuota mensual.
 * Server-only (los importan page.tsx y actions.ts). La lógica de cuota se
 * duplica aquí a propósito: el panel no depende de lib/pagos ni de otros
 * módulos en desarrollo paralelo.
 */
import { chileDateString } from "@/lib/chile-date";

/** Período actual de Chile en formato 'YYYY-MM'. */
export function periodoActualChile(): string {
  return chileDateString().slice(0, 7);
}

/**
 * Medianoche de Chile de una fecha 'YYYY-MM-DD' como instante UTC.
 * Prueba los dos offsets posibles (-03 verano / -04 invierno) y se queda con
 * el que efectivamente corresponde a las 00:00 de esa fecha en Santiago.
 */
function chileMedianocheUtc(fecha: string): Date {
  for (const offset of ["-03:00", "-04:00"]) {
    const d = new Date(`${fecha}T00:00:00${offset}`);
    if (chileDateString(d) !== fecha) continue;
    const hora = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      hour12: false,
    }).format(d);
    // Algunos ICU devuelven "24" para la medianoche con hour12:false.
    if (hora === "00" || hora === "24") return d;
  }
  return new Date(`${fecha}T00:00:00-04:00`);
}

/** Rango [desde, hasta) del mes actual de Chile como instantes UTC ISO. */
export function rangoMesActualChileUtc(): {
  desdeIso: string;
  hastaIso: string;
  periodo: string;
} {
  const periodo = periodoActualChile();
  const [anio, mes] = periodo.split("-").map(Number);
  const siguiente =
    mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
  return {
    desdeIso: chileMedianocheUtc(`${periodo}-01`).toISOString(),
    hastaIso: chileMedianocheUtc(siguiente).toISOString(),
    periodo,
  };
}

/** Instante ISO de hace `dias` días — ventana amplia para candidatos a trial. */
export function haceDiasIso(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

/**
 * Si una empresa sigue dentro de la ventana de trial de su plan.
 * OJO, tres diferencias con el sistema real (esto es display-only, pero el
 * operador decide mirando esta pantalla):
 *  1. El INICIO no sale de `empresas.trial_inicio` a secas — el reloj parte al
 *     abrir la cuenta (fundador 2026-09-04): pasar `inicioTrial(empresa)` de
 *     lib/pagos/metering, que es la fuente única.
 *  2. Acá solo se miran los DÍAS; el sistema real además corta al agotarse las
 *     100 boletas (`trialVigente` de metering recibe usadas/max).
 *  3. Acá no se consulta `config_global.trial_habilitado` ni
 *     `cuentas.trial_cortesia`: con el trial público apagado, el panel puede
 *     mostrar cupo de prueba a una cuenta que el sistema trata como SIN_PLAN.
 */
export function trialVigente(
  trialInicio: string | null,
  trialDias: number,
  ahoraMs = Date.now(),
): boolean {
  if (!trialInicio || trialDias <= 0) return false;
  const inicio = Date.parse(trialInicio);
  if (!Number.isFinite(inicio)) return false;
  return ahoraMs < inicio + trialDias * 86_400_000;
}

export type PlanCuotaInfo = {
  codigo: string;
  cuota_masivas: number;
  trial_boletas: number;
  trial_dias: number;
  refill_boletas: number;
};

/**
 * Cuota de boletas masivas del mes para una empresa:
 * suscripción activa → cuota del plan; sin suscripción pero con trial vigente
 * → boletas de trial. En ambos casos se suman los refills del período.
 */
export function cuotaEmpresaMes(args: {
  susPlanCodigo: string | null;
  empresaPlan: string | null;
  trialInicio: string | null;
  refillsMes: number;
  planes: Map<string, PlanCuotaInfo>;
}): { cuota: number; planCodigo: string | null } {
  const codigo = args.susPlanCodigo ?? args.empresaPlan;
  const plan = codigo ? args.planes.get(codigo) : undefined;
  // Una empresa en trial PURO no tiene plan ni suscripción, así que `plan` es
  // undefined y el panel mostraba cuota 0 justo para las cuentas cuyo cupo el
  // operador quiere ver. El sistema real saca los parámetros del trial de la
  // fila 'pro' de planes_config (lib/pagos/metering), así que acá igual.
  const planTrial = plan ?? args.planes.get("pro");
  let base = 0;
  if (args.susPlanCodigo && plan) {
    base = plan.cuota_masivas;
  } else if (planTrial && trialVigente(args.trialInicio, planTrial.trial_dias)) {
    base = planTrial.trial_boletas;
  }
  return { cuota: base + args.refillsMes, planCodigo: plan?.codigo ?? codigo ?? null };
}
