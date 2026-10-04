/**
 * Aprender-al-clasificar — el corazón de "no depender de OpenCode".
 *
 * Cuando el usuario resuelve un movimiento en Check (fija Exenta·41 / Afecta·39),
 * acaba de enseñarle al sistema qué es esa contraparte. Este módulo captura esa
 * decisión como una REGLA de usuario en `clasificacion_reglas`, para que la
 * próxima cartola con la misma contraparte se auto-clasifique con el tipo
 * recordado y caiga directo a "listas" (sin rebotar a Check).
 *
 * Diseño (por qué así):
 *  - El caso real del fundador: los depósitos P2P llegan como "TRANSFERENCIA DE
 *    JUAN PEREZ" — sin ninguna palabra cripto. La glosa es muda pero la
 *    contraparte se repite. La clave de la regla es esa contraparte.
 *  - SEGURIDAD: solo aprendemos cuando podemos extraer una contraparte
 *    ESPECÍFICA (no un "TRANSFERENCIA" genérico). Si el patrón sale ruidoso,
 *    devolvemos null y NO creamos regla (mejor no aprender que aprender una
 *    regla que sobre-matchea y auto-clasifica mal).
 *  - El aprendizaje ≠ emisión: los movimientos aprendidos caen en "listas", que
 *    el usuario revisa antes de apretar Emitir. El gatillo final es humano.
 *  - Minimización (Ley 19.628): NO guardamos receptor_*_default (identidad del
 *    tercero). El patrón basta para clasificar; el receptor se minimiza igual en
 *    el insert de propuestas según monto. Y el NOMBRE de la regla tampoco lleva al
 *    tercero (Fase 3): "Contraparte aprendida · Exenta".
 *  - HISTORIAL (Fase 3, regla-evidencia.ts): una regla NUEVA nace 'a_prueba' (su fila
 *    nace pendiente, no "lista") y se gana el 'firme' con cartolas emitidas. Re-acuñar
 *    suma veces_acunada y NUNCA pisa el tipo de una regla existente: si la persona dice
 *    otro tipo, eso es una CORRECCIÓN (reglas-historial.ts), que baja de nivel.
 *    Cada acuñación deja su SOPORTE (la cartola que la enseñó): si se borra la última,
 *    la base la deja huérfana y sin el tercero.
 */

import { esHintExentoPorLey } from "./tipo-dte-persistido";
import { nombreReglaAprendida } from "./regla-evidencia";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { detectaNoBoletar } from "../sii/clasificador-tipo";
import { sello } from "../propuestas/sello";

type SB = SupabaseClient<Database>;

/**
 * Palabras que NO identifican a una contraparte: verbos bancarios, conectores,
 * canales y entidades genéricas. Se comparan sin acentos y en minúscula.
 */
const RUIDO = new Set<string>([
  // verbos / sustantivos bancarios
  "transferencia", "transferencias", "transf", "tef", "abono", "abonos", "pago",
  "pagos", "deposito", "depositos", "traspaso", "cargo", "giro", "transaccion",
  "compra", "compras", "cobro", "retiro", "webpay", "redcompra", "servipag",
  "recaudacion", "recaudacrecibida", "recibido", "recibida", "enviada", "enviado",
  // conectores
  "de", "a", "para", "por", "desde", "hacia", "con", "el", "la", "los", "las",
  "un", "una", "y", "e", "o", "u", "del", "al", "su", "sus",
  // canales / medios
  "internet", "web", "online", "movil", "app", "banco", "bco", "cuenta", "cta",
  "electronica", "digital", "linea", "sucursal", "caja", "cajero",
  // movimientos INTERNOS del banco (no son contraparte de venta): un sobregiro,
  // un interés o una comisión no identifican a un cliente. Faltaban y por eso se
  // acuñó la regla-basura "SOBREGIRO CTE → Exenta" (2026-09-01).
  "cte", "sobregiro", "credito", "avance", "desembolso", "descubierto",
  "cursado", "interes", "intereses", "comision", "comisiones", "mantencion",
  "impuesto", "impuestos", "reajuste", "dividendo", "dividendos", "cuota",
  "cuotas", "cheque", "cheques", "timbre", "timbres",
  // entidades genéricas (peligrosas como clave: matchean a cualquiera)
  "proveedor", "proveedores", "cliente", "clientes", "varios", "tercero",
  "terceros", "particular", "particulares", "sueldo", "sueldos", "remuneracion",
  "remuneraciones", "honorarios", "arriendo", "servicio", "servicios",
  // formas jurídicas (no identifican a la persona; un "JUAN PEREZ SPA" no es el
  // mismo tercero que "JUAN PEREZ" persona natural, pero tampoco la razón social
  // se distingue por el sufijo → se botan para no ensuciar/inflar el patrón)
  "spa", "ltda", "limitada", "sa", "eirl", "sac", "cia", "hermanos", "hno",
  "hnos", "sociedad",
  // meta
  "ref", "nro", "no", "num", "numero", "comprobante", "folio", "monto", "fecha",
  "saldo", "glosa", "detalle", "operacion", "op", "id",
]);

/**
 * Regex anclada por límites de "no-letra" alrededor del nombre: hace que "MARIA"
 * NO matchee "MARIANA" ni "JUAN" matchee "JUANA" (el substring plano de
 * ilike/contains sobre-matcheaba). Se guarda como patron_tipo="regex" en la
 * regla aprendida (ruleMatches ya tiene camino regex) y se reusa en la
 * propagación. Sin flag `u` (ruleMatches usa `new RegExp(patron,"i")`): el rango
 * à-ÿ cubre los acentos latinos y, con el flag `i`, también sus mayúsculas.
 * El nombre viene de extraerPatronContraparte: solo letras+espacios, sin
 * metacaracteres regex → seguro de interpolar.
 */
export function regexContraparte(nombre: string): string {
  return `(^|[^a-zà-ÿ])${nombre.toLowerCase()}([^a-zà-ÿ]|$)`;
}

function deAccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export interface PatronContraparte {
  /** Nombre de contraparte limpio (solo letras+espacios, ej. "JUAN PEREZ"). */
  patron: string;
}

/**
 * Extrae una clave de contraparte SEGURA desde la glosa de un movimiento.
 * Devuelve null cuando no logra un patrón específico (no aprendemos entonces).
 *
 * Estrategia: limpiar a solo-letras, tokenizar, botar el ruido bancario, y
 * quedarnos con los tokens que identifican a la persona/entidad. Se exige un
 * mínimo de especificidad (≥2 tokens, o 1 token de ≥5 letras) para no crear
 * reglas que matcheen medio mundo.
 */
export function extraerPatronContraparte(
  descripcion: string | null | undefined,
  receptorNombre?: string | null,
): PatronContraparte | null {
  const desde = (raw: string | null | undefined): string[] => {
    // El patrón CONSERVA acentos: matchea contra la glosa cruda vía `ruleMatches`
    // (includes case-insensitive, accent-sensitive). El chequeo de ruido, en
    // cambio, de-acentúa el token para compararlo contra el set ASCII.
    const base = String(raw ?? "")
      .toUpperCase()
      .replace(/[^A-ZÁÉÍÓÚÜÑ\s]/g, " ") // deja letras (con acento); fuera dígitos, horas, refs, puntuación
      .replace(/\s+/g, " ")
      .trim();
    if (!base) return [];
    return base
      .split(" ")
      .filter((t) => t.length >= 2 && !RUIDO.has(deAccent(t).toLowerCase()));
  };

  // Candidato 1: el nombre de receptor que el humano confirmó (si vino y es útil).
  // Candidato 2: la propia glosa. Preferimos el que dé una clave válida; si ambos,
  // la glosa (es la superficie contra la que matchea la regla).
  const tokensGlosa = desde(descripcion);
  const tokensRecep = desde(receptorNombre);

  const armar = (tokens: string[]): PatronContraparte | null => {
    if (tokens.length === 0) return null;
    const usar = tokens.slice(0, 4); // cap: no guardar glosas kilométricas
    const especifico =
      usar.length >= 2 || (usar.length === 1 && usar[0].length >= 5);
    if (!especifico) return null;
    const patron = usar.join(" ");
    if (deAccent(patron).replace(/[^A-Z]/g, "").length < 5) return null;
    return { patron };
  };

  return armar(tokensGlosa) ?? armar(tokensRecep);
}

export interface AprenderArgs {
  empresaId: string;
  userId: string | null;
  documentoId: string | null;
  descripcion: string;
  tipoFlujo: "entrada" | "salida";
  /** 39 afecta / 41 exenta — la decisión humana recién persistida. */
  tipoDte: 39 | 41;
  /**
   * Cuántas filas cambió la persona en ESE gesto (cambio de tipo en lote). Sin valor =
   * decisión individual. Un "Afecta" masivo (> LOTE_MAX_SENAL_MARCA) sobre una cartola
   * P2P no cuenta como confirmación consciente contra la marca.
   */
  tamanoLote?: number;
  /** Canal de la decisión (check_fila/check_detalle/check_lote) → nacio_carril. */
  canal?: string;
  /** Movimiento puntual que la enseñó (soporte: glosa viva para "Lo que aprendí"). */
  movimientoId?: string | null;
}

/** Lote máximo cuyo "Afecta" sobre cartola P2P/forex todavía confirma la regla en la marca. */
export const LOTE_MAX_SENAL_MARCA = 25;

export interface AprenderResultado {
  creada: boolean;
  actualizada: boolean;
  /** cuántos hermanos de la misma contraparte se voltearon a "listas" en la cartola. */
  propagadas: number;
  patron: string | null;
  /** Regla creada / re-acuñada (null si no se aprendió nada). */
  reglaId?: string | null;
}

const VACIO: AprenderResultado = {
  creada: false,
  actualizada: false,
  propagadas: 0,
  patron: null,
  reglaId: null,
};

/**
 * Aprende (crea o refuerza) una regla de usuario desde una resolución humana, y
 * propaga el tipo a los hermanos de la misma contraparte en la misma cartola.
 * Best-effort: cualquier fallo devuelve el resultado vacío sin lanzar (nunca
 * debe romper la edición que la disparó).
 */
export async function aprenderReglaDesdeResolucion(
  sb: SB,
  args: AprenderArgs,
): Promise<AprenderResultado> {
  try {
    const extra = extraerPatronContraparte(args.descripcion);
    if (!extra) return VACIO;
    // Doble llave de calidad: NUNCA acuñar desde un movimiento que no es venta
    // (préstamo, sueldo, aporte, cuenta propia, DAP, evento bancario). Hoy
    // detectaNoBoletar solo corría en la propagación (:276); acá corta ANTES del
    // insert para que ni siquiera se cree la regla. Junto al RUIDO ampliado, es
    // la defensa en profundidad contra el bug del "SOBREGIRO CTE".
    if (detectaNoBoletar(args.descripcion)) return { ...VACIO, patron: extra.patron };
    const { patron } = extra;
    // Se guarda como regex con límites de palabra (no substring plano): así
    // "MARIA" no se lleva "MARIANA". ruleMatches ya ejecuta el camino regex.
    const patronRegex = regexContraparte(patron);
    const tipoProp = args.tipoDte === 41 ? "exenta" : "boleta";

    // Marca de la cartola: de dónde nació la regla (nacio_hint) y la señal "Afecta
    // confirmada sobre una cartola P2P/forex" (fila «¿?» por conflicto regla↔marca): la
    // regla queda CONFIRMADA en esa marca → la próxima cartola P2P no vuelve a preguntar
    // (corta el loop). Campo propio aprendida_bajo_marca (Fase 3; antes, confianza 0.99).
    // Un "Afecta" en lote grande no cuenta. Best-effort: sin hint, sin señal.
    let hint: string | null = null;
    if (args.documentoId) {
      try {
        const { data: doc } = await sb
          .from("documentos_subidos")
          .select("tipo_operacion_hint")
          .eq("id", args.documentoId)
          .eq("empresa_id", args.empresaId)
          .maybeSingle();
        hint = (doc as { tipo_operacion_hint?: string | null } | null)?.tipo_operacion_hint ?? null;
      } catch { /* sin hint */ }
    }
    const senalMarca = args.tipoDte === 39 && (args.tamanoLote ?? 1) <= LOTE_MAX_SENAL_MARCA && esHintExentoPorLey(hint);

    // Dedup por (empresa, patron, flujo). Sin unique constraint, tomamos la 1ª.
    const { data: prev } = await sb
      .from("clasificacion_reglas")
      .select("id, tipo_dte, estado, activa, veces_acunada, aprendida_bajo_marca")
      .eq("empresa_id", args.empresaId)
      .eq("patron", patronRegex)
      .eq("tipo_flujo_match", args.tipoFlujo)
      .limit(1);
    const existente = prev?.[0] as
      | { id: string; tipo_dte: number | null; estado: string | null; activa: boolean | null; veces_acunada: number | null; aprendida_bajo_marca: boolean | null }
      | undefined;

    let creada = false;
    let actualizada = false;
    let reglaId: string | null = null;
    if (existente?.id) {
      let cambios: Record<string, unknown> | null = null;
      const apagada = existente.activa === false || existente.estado === "deshecha" || existente.estado === "huerfana";
      if (apagada) {
        // Apagada (la deshizo la persona, quedó huérfana o se desactivó): volver a
        // enseñarla la REACTIVA, como siempre, pero A PRUEBA y con lo que dice HOY (sus
        // correcciones y confirmaciones viejas eran de antes).
        cambios = {
          tipo_dte: args.tipoDte, tipo_propuesto: tipoProp, estado: "a_prueba", activa: true,
          nombre: nombreReglaAprendida(args.tipoDte), veces_acunada: (existente.veces_acunada ?? 0) + 1,
          veces_corregida: 0, veces_confirmada: 0, evidencia_desde: new Date().toISOString(),
          aprendida_bajo_marca: senalMarca, confianza: 0.95, deshecha_por: null,
        };
      } else if (existente.tipo_dte == null || existente.tipo_dte === args.tipoDte) {
        // Misma enseñanza: suma acuñación (no uso). La señal de marca no se pisa.
        cambios = {
          veces_acunada: (existente.veces_acunada ?? 0) + 1,
          aprendida_bajo_marca: existente.aprendida_bajo_marca === true || senalMarca,
          ...(existente.tipo_dte == null ? { tipo_dte: args.tipoDte, tipo_propuesto: tipoProp } : {}),
        };
      }
      // Tipo DISTINTO de una regla viva: NO se pisa (corrección → reglas-historial.ts).
      if (cambios) {
        const { error } = await sb
          .from("clasificacion_reglas")
          .update(cambios)
          // service role bypassa RLS → el scope por empresa es explícito (defensa
          // en profundidad, aunque el id ya salió de una query scopeada arriba).
          .eq("id", existente.id)
          .eq("empresa_id", args.empresaId);
        if (error) return { ...VACIO, patron };
        actualizada = true;
        reglaId = existente.id;
      }
    } else {
      const { data: nueva, error } = await sb.from("clasificacion_reglas").insert({
        empresa_id: args.empresaId,
        nombre: nombreReglaAprendida(args.tipoDte),
        patron: patronRegex,
        patron_tipo: "regex",
        tipo_flujo_match: args.tipoFlujo,
        tipo_propuesto: tipoProp,
        tipo_dte: args.tipoDte,
        confianza: 0.95,
        prioridad: 50, // convención: reglas de usuario ganan a las globales (80-110)
        created_by: args.userId,
        estado: "a_prueba",
        veces_acunada: 1,
        nacio_hint: hint,
        nacio_carril: args.canal ?? null,
        documento_origen_id: args.documentoId,
        aprendida_bajo_marca: senalMarca,
        ligada_a_cartolas: true,
      }).select("id").maybeSingle();
      if (error) return { ...VACIO, patron };
      creada = true;
      reglaId = (nueva as { id?: string } | null)?.id ?? null;
    }

    // Soporte: la cartola que la enseñó — SOLO al nacer. Re-acuñar una regla existente
    // NO la liga a esta cartola (borrar la cartola jamás debe apagar una regla vieja).
    if (creada && reglaId && args.documentoId) {
      try {
        await sb.from("clasificacion_regla_soportes").upsert(
          {
            regla_id: reglaId,
            documento_id: args.documentoId,
            empresa_id: args.empresaId,
            movimiento_id: args.movimientoId ?? null,
            rol: "acuno",
          },
          { onConflict: "regla_id,documento_id,rol", ignoreDuplicates: true },
        );
      } catch { /* sin soporte: la regla no queda ligada a esta cartola */ }
    }

    const propagadas = args.documentoId
      ? await propagarEnCartola(sb, {
          empresaId: args.empresaId,
          documentoId: args.documentoId,
          patron,
          patronRegex,
          tipoFlujo: args.tipoFlujo,
          tipoDte: args.tipoDte,
          tipoPropuesto: tipoProp,
          usuarioId: args.userId,
          // Solo si la regla dice LO MISMO que se propaga (nació, se re-acuñó igual o
          // renació): una regla viva con otro tipo no se pisa ni se le cuelgan filas.
          reglaId,
        })
      : 0;

    return { creada, actualizada, propagadas, patron, reglaId };
  } catch {
    return VACIO;
  }
}

/**
 * Voltea a "listas" los hermanos de la misma contraparte en la MISMA cartola:
 * movimientos del documento, mismo flujo, cuya glosa contiene el patrón y cuya
 * propuesta aún no tiene tipo_dte (y no está emitida) → se les fija el tipo.
 * El "momento mágico": resolver un JUAN PEREZ acomoda los otros de la tanda.
 */
async function propagarEnCartola(
  sb: SB,
  args: {
    empresaId: string;
    documentoId: string;
    patron: string;
    patronRegex: string;
    tipoFlujo: "entrada" | "salida";
    tipoDte: 39 | 41;
    tipoPropuesto: string;
    /** Quién gatilló la propagación (va al sello: decision_por). */
    usuarioId: string | null;
    /**
     * Regla que dice este tipo: las hermanas quedan LIGADAS a ella (regla_id), así una
     * corrección posterior sobre una hermana corrige la regla y Deshacer las re-evalúa.
     * La evidencia no las cuenta como confirmación (canal propagacion).
     */
    reglaId?: string | null;
  },
): Promise<number> {
  // `patron` es solo-letras+espacios (lo limpió extraerPatronContraparte), así
  // que es seguro para el ilike (sin comodines % ni _ inyectables). El ilike es
  // un PREFILTRO barato; el match fino con límites de palabra lo hace el regex
  // abajo (para no llevarse "MARIANA" con "MARIA").
  const { data: movs, error } = await sb
    .from("movimientos_raw")
    .select("id, descripcion")
    .eq("documento_id", args.documentoId)
    .eq("tipo_flujo", args.tipoFlujo)
    .ilike("descripcion", `%${args.patron}%`);
  if (error || !movs || movs.length === 0) return 0;

  const re = new RegExp(args.patronRegex, "i");
  // Filtro fino: límite de palabra + NUNCA propagar sobre un no_boletar (un
  // "TRANSFERENCIA DE JUAN PEREZ PRESTAMO" del mismo tercero NO es una venta).
  // El gate igual lo bloquearía, pero así no dejamos el estado contradictorio.
  const movIds = movs
    .filter((m) => re.test(m.descripcion ?? "") && !detectaNoBoletar(m.descripcion))
    .map((m) => m.id);
  if (movIds.length === 0) return 0;

  let total = 0;
  // Un gesto = un lote (todos los trozos comparten el uuid). A ciegas: abierta=false.
  const selloPropagacion = sello("propagacion", { usuarioId: args.usuarioId, loteN: movIds.length, abierta: false });
  for (let i = 0; i < movIds.length; i += 50) {
    const batch = movIds.slice(i, i + 50);
    const { count, error: updErr } = await sb
      .from("propuestas_ia")
      .update(
        { tipo_dte: args.tipoDte, tipo_propuesto: args.tipoPropuesto, ...(args.reglaId ? { regla_id: args.reglaId } : {}), ...selloPropagacion },
        { count: "exact" },
      )
      .eq("empresa_id", args.empresaId)
      .in("movimiento_id", batch)
      .is("tipo_dte", null) // solo los que faltan; excluye el ya resuelto
      // Coherente con el guard de editarPropuesta (auditoría #21): NO tocar una
      // 'aprobado' (ya comprometida a Emitir) ni resucitar emitidas/rechazadas.
      .in("estado", ["pendiente", "editado", "listo"]);
    if (updErr) break; // best-effort: devolvemos lo propagado hasta acá
    total += count ?? 0;
  }
  return total;
}
