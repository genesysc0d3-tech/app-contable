import type { CuadreCartola } from "./cuadre";

/**
 * CONFIRMACIÓN DEL CLIENTE (2026-09-30). Lógica pura; la UI y el server la
 * usan. Principio: aceptar solo con PRUEBA A FAVOR (saldo al peso / total del
 * banco). Si no hay prueba, se le abre al cliente el popup "Revisa las
 * columnas" UNA VEZ POR FORMATO: indica las columnas, dice "Listo" y las
 * siguientes cartolas de ese formato entran solas. Meta: preguntar lo menos
 * posible, solo cuando de verdad no se puede saber.
 */

type ConSello = Pick<CuadreCartola, "verificacion" | "mapa">;

export interface RevisarColumnas {
  /** Abrir el popup (una vez, al terminar de procesar) y dejar el aviso en la tarjeta. */
  abrir: boolean;
  /** El formato ya estaba confirmado pero ESTE archivo no calza. */
  otraVez: boolean;
  /** Una línea: por qué se le pregunta. */
  motivo: string | null;
}

/**
 * ¿Hay que pedirle al cliente que revise las columnas?
 *   - comprobada (saldo / total del banco) o ya confirmada por el cliente → no;
 *   - cuadre viejo sin sello → no (los documentos antiguos no molestan);
 *   - formato sin mapa confirmado para la empresa y sin prueba → sí;
 *   - formato con mapa confirmado: no, SALVO que un chequeo de este archivo
 *     falle (montos ambiguos, plata sin leer, el banco contradice, filas
 *     ocultas, primera fila o signo sin comprobar) → sí, diciendo por qué.
 */
export function revisarColumnas(c: Partial<ConSello>): RevisarColumnas {
  const no: RevisarColumnas = { abrir: false, otraVez: false, motivo: null };
  const v = c.verificacion;
  if (!v || v.tipo === "cliente" || v.tipo === "saldo" || v.tipo === "total_banco") return no;
  const chequeoFallo = !!(v.alerta || v.revisar);
  const formatoConfirmado = !!c.mapa && c.mapa.estado === "confirmado" && c.mapa.nuevo !== true;
  if (formatoConfirmado) {
    if (!chequeoFallo) return no;
    return { abrir: true, otraVez: true, motivo: `Esta vez algo no calza: ${v.detalle || "revisa las columnas"}` };
  }
  return {
    abrir: true,
    otraVez: false,
    motivo: chequeoFallo && v.detalle
      ? v.detalle
      : "Es la primera vez que vemos este formato y no trae saldo ni totales para comprobarlo solos.",
  };
}

/**
 * ¿La lectura está limpia como para que mirar filas la confirme? (adversarial-2
 * A2) Con una ALERTA, filas perdidas u otra hoja sin leer, aprobar filas en
 * Check no confirma el mapa (checkConfirmaMapa).
 */
export function lecturaLimpia(c: Pick<CuadreCartola, "verificacion" | "perdidas" | "otras_hojas_con_datos">): boolean {
  if (c.verificacion?.alerta) return false;
  if ((c.perdidas ?? []).some((p) => !p.agregada)) return false;
  return (c.otras_hojas_con_datos ?? []).length === 0;
}

/**
 * ¿Puede el cliente confirmar "mi cartola es solo abonos/cargos (filtrada)"?
 * Solo si el lector la reconoció como filtrada (una dirección y saltos de saldo
 * explicables por lo que falta) y no hay filas perdidas ni otras hojas. Es la
 * salida "Mi cartola trae solo abonos" del popup (vuelta 2, N4: si no, alerta
 * perpetua sin salida); el server la vuelve a validar al guardar.
 */
export function filtradaPermitida(c: Pick<CuadreCartola, "verificacion" | "perdidas" | "otras_hojas_con_datos">): boolean {
  // Solo "solo abonos" (el caso massDTE). "Solo cargos" es justo lo que produce
  // un mapa invertido en una cuenta que solo recibe ventas (vuelta 3, V3-1).
  if (c.verificacion?.filtrada !== "abonos") return false;
  if ((c.perdidas ?? []).some((p) => !p.agregada)) return false;
  return (c.otras_hojas_con_datos ?? []).length === 0;
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
  /**
   * TODAS las aprobadas lo fueron FILA A FILA (auditoría "propuesta_aprobada" de
   * cada una). Vuelta 2, N3: "Aprobar cartola" en bloque + 1 fila a mano ya no
   * confirma. Ausente = no se sabe = no confirma.
   */
  aprobadasFilaAFila?: boolean;
}): boolean {
  if (!a.guardado) return false;
  if (a.aprobadasFilaAFila !== true) return false;
  if (a.cuadre && !lecturaLimpia(a.cuadre)) return false;
  if (a.estados.some((e) => e === "pendiente" || e === "editado" || e === "listo")) return false;
  // Decidido = aprobado (va a boleta) o rechazado (una salida/gasto): el cliente
  // miró la fila y aceptó cómo quedó leída. Al menos 3 filas y 1 aprobada.
  if (a.estados.length < 3 || !a.estados.includes("aprobado")) return false;
  const suma = (t: string) => a.movimientos.filter((m) => m.tipo_flujo === t).reduce((s, m) => s + (Number(m.monto) || 0), 0);
  return a.movimientos.length === a.guardado.n
    && Math.abs(suma("entrada") - a.guardado.entradas) <= 1
    && Math.abs(suma("salida") - a.guardado.salidas) <= 1;
}
