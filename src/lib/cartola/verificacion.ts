import type { CuadreCartola } from "./cuadre";

/**
 * CONFIRMACIÓN DEL CLIENTE (punto 8, 2026-09-30). Lógica pura; la UI y las
 * server actions la usan. El principio: aceptar solo con PRUEBA A FAVOR. Cuando
 * la cartola no trae saldo ni totales del banco (23 de 29 en prod), la prueba la
 * pone el cliente de la forma más simple posible:
 *   - mirando 3 movimientos "así la leímos" y diciendo "Se ve bien", o
 *   - tecleando el saldo final que ve en el portal de su banco (conciliación de
 *     toda la vida: Actual "Reconcile", Odoo balance_end_real).
 * Encadenar con la cartola anterior de la misma cuenta (saldo final anterior =
 * saldo inicial nuevo) aporta el saldo inicial y es una prueba adicional.
 */

type ConSello = Pick<CuadreCartola, "verificacion" | "mapa">;

/**
 * ¿Pedirle al cliente que mire la lectura? Solo con sello (cuadres nuevos):
 *   - algo CONTRADICE la lectura (alerta) → siempre;
 *   - sin prueba y con un mapa que nadie confirmó → sí;
 *   - sin prueba pero con un mapa que YA confirmaste antes (mismo formato) → no
 *     se insiste: el sello queda honesto (sin_comprobar), sin molestar;
 *   - con prueba pero mapa nuevo provisorio → sí (primera vez del formato).
 */
export function necesitaConfirmacion(c: Partial<ConSello>): boolean {
  const v = c.verificacion;
  if (!v) return false;
  if (v.tipo === "cliente") return false;
  if (v.alerta) return true;
  const mapaConfirmadoViejo = !!c.mapa && c.mapa.estado === "confirmado" && c.mapa.nuevo !== true;
  if (v.tipo === "sin_comprobar") return !mapaConfirmadoViejo;
  return !!c.mapa && c.mapa.nuevo === true && c.mapa.estado === "provisorio";
}

/**
 * ¿Se puede sellar "cliente" con "Se ve bien"? (adversarial-2 A2) 3 filas de
 * muestra no juzgan "faltan 12 filas" ni "el total del banco no calza": con una
 * ALERTA, filas perdidas u otra hoja sin leer, "Se ve bien" no sella. Ahí vale
 * "Corregir columnas" o el saldo final del banco. La UI lo esconde y el server
 * lo rechaza con esta misma regla.
 */
export function seVeBienPermitido(c: Pick<CuadreCartola, "verificacion" | "perdidas" | "otras_hojas_con_datos">): { ok: boolean; motivo?: string } {
  if (c.verificacion?.alerta) return { ok: false, motivo: "Algo no calza en la lectura: corrige las columnas o comprueba con el saldo final de tu banco" };
  if ((c.perdidas ?? []).some((p) => !p.agregada)) return { ok: false, motivo: "Hay filas con plata que no se leyeron: revísalas antes de confirmar" };
  if ((c.otras_hojas_con_datos ?? []).length) return { ok: false, motivo: "Otra hoja del archivo trae movimientos que no se leyeron" };
  return { ok: true };
}

/**
 * "No cuadra" SIN revelar el saldo esperado (adversarial-2 A3): si le decimos el
 * número, el cliente lo copia y el sello "cliente" queda de goma.
 */
export function mensajeSaldoNoCuadra(): string {
  return "No coincide con lo que leímos. Revisa que el saldo sea el del cierre de este período, las columnas o si falta alguna fila.";
}

export function verificarSaldoCliente(a: {
  saldoFinalCliente: number;
  saldoInicial: number;
  abonos: number;
  cargos: number;
}): { ok: boolean; esperado: number; diferencia: number } {
  const esperado = a.saldoInicial + a.abonos - a.cargos;
  const diferencia = Math.round(a.saldoFinalCliente - esperado);
  return { ok: Math.abs(diferencia) <= 1, esperado, diferencia };
}

export function sellarPorCliente(c: CuadreCartola, detalle: string): CuadreCartola {
  return {
    ...c,
    verificacion: { tipo: "cliente", detalle },
    ...(c.mapa ? { mapa: { ...c.mapa, estado: "confirmado" as const, confirmado_por: "cliente" } } : {}),
  };
}

/**
 * Saldo inicial con que comprobar el saldo final del cliente: el de la propia
 * cartola, o el saldo final de la cartola ANTERIOR de la misma cuenta. Si están
 * los dos, `empalma` dice si coinciden (prueba de continuidad, Odoo is_valid).
 * `anteriores` = cartolas previas de la empresa, de la más nueva a la más vieja.
 */
export function saldoInicialParaConfirmar(
  actual: { saldo_inicial?: number | null; cuenta?: { huella: string; sufijo?: string } | null },
  anteriores: { cuenta?: { huella: string; sufijo?: string } | null; saldo_final?: number | null }[],
): { valor: number | null; fuente: "cartola" | "anterior" | null; empalma: boolean | null } {
  const huella = actual.cuenta?.huella;
  const previa = huella
    ? anteriores.find((a) => a.cuenta?.huella === huella && typeof a.saldo_final === "number")
    : undefined;
  const propio = typeof actual.saldo_inicial === "number" ? actual.saldo_inicial : null;
  const anterior = typeof previa?.saldo_final === "number" ? previa.saldo_final : null;
  if (propio != null) {
    return { valor: propio, fuente: "cartola", empalma: anterior != null ? Math.abs(anterior - propio) <= 1 : null };
  }
  if (anterior != null) return { valor: anterior, fuente: "anterior", empalma: null };
  return { valor: null, fuente: null, empalma: null };
}

/**
 * ¿Aprobar en Check confirma el mapa? (punto 7c, juez implícito: paperless
 * "salió del inbox", Rossum "confirmado"). SOLO aprobando FILA A FILA: "Aprobar
 * cartola" en bloque no es mirar (revisar/actions.ts ya no la llama ahí).
 * "salió del inbox", Rossum "confirmado"). Sí solo si: todo lo de la cartola ya
 * está decidido (nada pendiente/editado/listo), hay al menos 3 filas decididas
 * (con al menos una aprobada) y lo
 * guardado sigue EXACTO a como el lector lo dejó (mismo conteo y mismas sumas
 * por dirección: nadie editó un monto ni una dirección).
 */
export function checkConfirmaMapa(a: {
  guardado: { n: number; entradas: number; salidas: number } | null | undefined;
  movimientos: { monto: number | string | null; tipo_flujo: string | null }[];
  estados: string[];
  /** El cuadre de la cartola: con alerta o pérdidas, aprobar NO confirma el mapa (adversarial-2 A4). */
  cuadre?: Pick<CuadreCartola, "verificacion" | "perdidas" | "otras_hojas_con_datos"> | null;
}): boolean {
  if (!a.guardado) return false;
  if (a.cuadre && !seVeBienPermitido(a.cuadre).ok) return false;
  if (a.estados.some((e) => e === "pendiente" || e === "editado" || e === "listo")) return false;
  // Decidido = aprobado (va a boleta) o rechazado (una salida/gasto): el cliente
  // miró la fila y aceptó cómo quedó leída. Al menos 3 filas y 1 aprobada.
  if (a.estados.length < 3 || !a.estados.includes("aprobado")) return false;
  const suma = (t: string) => a.movimientos.filter((m) => m.tipo_flujo === t).reduce((s, m) => s + (Number(m.monto) || 0), 0);
  return a.movimientos.length === a.guardado.n
    && Math.abs(suma("entrada") - a.guardado.entradas) <= 1
    && Math.abs(suma("salida") - a.guardado.salidas) <= 1;
}
