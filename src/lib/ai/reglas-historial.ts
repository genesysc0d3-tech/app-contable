/**
 * REGLAS CON HISTORIAL — la parte que habla con la base (Fase 3 del clasificador).
 * Las transiciones viven PURAS en ./regla-evidencia.ts; acá solo se leen/escriben.
 *
 *  - registrarCorrecciones: una persona cambió el tipo de filas que una regla clasificó
 *    → UNA corrección por regla y acción (no por fila). Baja de nivel, no pisa.
 *  - recalcularEstadoReglas: estado derivado de la evidencia (evidencia_reglas) — cron
 *    nocturno y al abrir "Lo que aprendí". Deja soportes 'confirmo'.
 *  - deshacerRegla: apaga la regla (deshecha) y re-evalúa SIN IA lo que ella dejó en
 *    pendiente/listo. Nunca toca aprobado/editado/emitido/a medias/en vuelo.
 *
 * Todo con el service role (bypassa RLS): cada consulta va scopeada por empresa_id.
 * Best-effort donde la acción humana ya quedó guardada (corregir, recalcular): un fallo
 * acá jamás revierte ni rompe lo que la persona hizo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  aplicarCorreccion,
  avisoCorreccion,
  esCorreccionDeRegla,
  recalcularEstado,
  type EfectoCorreccion,
  type ReglaConHistorial,
} from "./regla-evidencia";
import { classifyWithRules, type ClasificacionRegla } from "./classifier";
import { decidirTipoDtePersistido, decidirEstadoInicial, CONFIANZA_MAX_POR_DECIDIR } from "./tipo-dte-persistido";
import { clasificarBoleta, type DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { carrilEsExento } from "@/lib/sii/tipo-por-carril";
import { normalizarTipoPorEmisor, esVentaExentaEmisor } from "./tipo-emisor";
import { derivarMontosDte } from "@/lib/sii/montos-dte";
import { FUENTE_CONFLICTO_MARCA } from "@/lib/sii/destino";
import { clasificarIntocables } from "@/lib/emission/propuestas-intocables";
import { nuevoLote, sello } from "@/lib/propuestas/sello";
import type { MovimientoExtraido } from "./types";
import { contraparteVisible } from "./contraparte-visible";

type SB = SupabaseClient<Database>;
const TROZO = 50;

/** fuente_clasificacion de una fila cuya regla se deshizo y ninguna otra la toma. */
export const FUENTE_REGLA_DESHECHA = "regla_deshecha";

export interface EvidenciaFila {
  regla_id: string;
  confirmadas: number;
  confirmadas_miradas: number;
  aciertos: number;
  soportes: number;
  documentos_confirman: string[] | null;
  glosa: string | null;
}

const COLS_REGLA = "id, empresa_id, estado, tipo_dte, tipo_propuesto, veces_confirmada, veces_corregida, corregidas_en_ventana, disputa_eleccion, disputa_racha, aprendida_bajo_marca";
type ReglaFila = ReglaConHistorial & { id: string; tipo_propuesto?: string | null };

/**
 * Evidencia viva (solo lectura). UNA ejecución: la rpc devuelve un jsonb con todas las
 * reglas pedidas (sin el tope de 1.000 filas de PostgREST ni re-ejecutar por página).
 */
export async function leerEvidencia(sb: SB, empresaId: string, reglaIds?: string[]): Promise<Map<string, EvidenciaFila> | null> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
    "evidencia_reglas_lote",
    { p_empresa_id: empresaId, p_regla_ids: reglaIds ?? null },
  );
  if (error || !Array.isArray(data)) return null;
  const out = new Map<string, EvidenciaFila>();
  for (const e of data as EvidenciaFila[]) out.set(e.regla_id, e);
  return out;
}

// ── Corrección ──────────────────────────────────────────────────────────────────

export interface FilaCorregida {
  reglaId: string | null | undefined;
  documentoId?: string | null;
  /** tipo_dte que la fila le MOSTRABA a la clienta antes del cambio (M2). */
  tipoFila?: number | null;
  /** Glosa de la fila: de ahí sale la contraparte del aviso. */
  glosa?: string | null;
}

export interface ResultadoCorrecciones {
  efectos: Map<string, EfectoCorreccion>;
  /** Avisos cortos para el toast de Check (la regla se dio vuelta / entró o salió de disputa). */
  avisos: string[];
}

/**
 * Una persona cambió el tipo_dte de estas filas a `tipoNuevo`. Registra UNA corrección
 * por regla (las filas sin regla, de reglas globales, o cuyo tipo mostrado no era el de
 * la regla no cuentan — esCorreccionDeRegla). `mirada`: el gesto fue check_fila /
 * check_detalle o un lote ≤ 25. Solo mesa boleta (39/41). Nunca lanza.
 */
export async function registrarCorrecciones(
  sb: SB,
  args: { empresaId: string; tipoNuevo: number; mirada: boolean; filas: FilaCorregida[] },
): Promise<ResultadoCorrecciones> {
  const efectos = new Map<string, EfectoCorreccion>();
  const avisos: string[] = [];
  if (args.tipoNuevo !== 39 && args.tipoNuevo !== 41) return { efectos, avisos };
  const porRegla = new Map<string, FilaCorregida[]>();
  for (const f of args.filas) {
    if (!f.reglaId) continue;
    porRegla.set(f.reglaId, [...(porRegla.get(f.reglaId) ?? []), f]);
  }
  for (const [reglaId, filas] of porRegla) {
    try {
      const r = await registrarCorreccion(sb, { empresaId: args.empresaId, reglaId, tipoNuevo: args.tipoNuevo, mirada: args.mirada, filas });
      efectos.set(reglaId, r.efecto);
      const aviso = avisoCorreccion(r.efecto, contraparteVisible(r.glosa), r.tipoDte);
      if (aviso) avisos.push(aviso);
    } catch {
      efectos.set(reglaId, "ninguno");
    }
  }
  return { efectos, avisos };
}

async function registrarCorreccion(
  sb: SB,
  a: { empresaId: string; reglaId: string; tipoNuevo: number; mirada: boolean; filas: FilaCorregida[] },
): Promise<{ efecto: EfectoCorreccion; tipoDte: number | null; glosa: string | null }> {
  const nada = { efecto: "ninguno" as EfectoCorreccion, tipoDte: null, glosa: null };
  // Dos intentos: la escritura es condicional al contador leído (otra corrección en
  // paralelo no se pierde: si cambió, se relee y se recalcula).
  for (let intento = 0; intento < 2; intento++) {
    const { data: r } = await sb
      .from("clasificacion_reglas")
      .select(COLS_REGLA)
      .eq("id", a.reglaId)
      .eq("empresa_id", a.empresaId)
      .maybeSingle();
    const regla = r as ReglaFila | null;
    if (!regla || regla.empresa_id == null) return nada;
    // M2: solo filas que mostraban el tipo de la regla (o, en disputa, sin tipo).
    const fila = a.filas.find((f) => esCorreccionDeRegla(regla, { tipoFila: f.tipoFila ?? null, tipoNuevo: a.tipoNuevo }));
    if (!fila) return nada;
    const ev = await leerEvidencia(sb, a.empresaId, [a.reglaId]);
    const confirmadas = ev?.get(a.reglaId)?.confirmadas ?? regla.veces_confirmada ?? 0;
    const res = aplicarCorreccion(regla, { tipoNuevo: a.tipoNuevo, confirmadas, mirada: a.mirada });
    if (res.efecto === "ninguno") return nada;
    const cambios: Record<string, unknown> = {
      estado: res.estado,
      veces_corregida: res.veces_corregida,
      corregidas_en_ventana: res.corregidas_en_ventana,
      disputa_eleccion: res.disputa_eleccion,
      disputa_racha: res.disputa_racha,
      aprendida_bajo_marca: res.aprendida_bajo_marca,
    };
    if (res.reiniciaVentana) {
      // Lo confirmado ANTES de este cambio era del tipo corregido / en disputa: no puede
      // re-promoverla (B1). La ventana de evidencia vuelve a empezar.
      cambios.evidencia_desde = new Date().toISOString();
      cambios.veces_confirmada = 0;
    }
    if (res.tipo_dte !== regla.tipo_dte) {
      cambios.tipo_dte = res.tipo_dte;
      cambios.tipo_propuesto = res.tipo_dte === 41 ? "exenta" : "boleta";
    }
    const { count, error } = await sb
      .from("clasificacion_reglas")
      .update(cambios, { count: "exact" })
      .eq("id", a.reglaId)
      .eq("empresa_id", a.empresaId)
      .eq("veces_corregida", regla.veces_corregida ?? 0);
    if (error) return nada;
    if ((count ?? 0) === 0) continue;
    if (fila.documentoId) {
      try {
        await sb.from("clasificacion_regla_soportes").upsert(
          { regla_id: a.reglaId, documento_id: fila.documentoId, empresa_id: a.empresaId, rol: "corrigio" },
          { onConflict: "regla_id,documento_id,rol", ignoreDuplicates: true },
        );
      } catch { /* best-effort */ }
    }
    return { efecto: res.efecto, tipoDte: res.tipo_dte, glosa: fila.glosa ?? null };
  }
  return nada;
}

// ── Recalcular el estado derivado ───────────────────────────────────────────────

export interface ResultadoRecalculo {
  revisadas: number;
  cambiadas: number;
  error?: string;
}

/**
 * Estado derivado de la evidencia para TODAS las reglas de usuario de la empresa.
 * Idempotente. Escribe solo lo que cambió (condicional al estado leído). Deja un
 * soporte 'confirmo' por cada cartola que confirma (así la regla queda ligada a ella).
 */
export async function recalcularEstadoReglas(
  sb: SB,
  empresaId: string,
  /**
   * soloEstado: escribe solo las reglas que CAMBIAN de estado (al abrir la pantalla:
   * pocas o ninguna). Sin él (cron nocturno) también refresca veces_confirmada.
   */
  opts: { soloEstado?: boolean; evidencia?: Map<string, EvidenciaFila> | null } = {},
): Promise<ResultadoRecalculo> {
  // Quien ya leyó la evidencia (la pantalla) la pasa: una sola ejecución por apertura.
  const ev = opts.evidencia ?? (await leerEvidencia(sb, empresaId));
  if (!ev) return { revisadas: 0, cambiadas: 0, error: "evidencia_no_disponible" };
  const reglas: ReglaFila[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from("clasificacion_reglas")
      .select(COLS_REGLA)
      .eq("empresa_id", empresaId)
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (error) return { revisadas: reglas.length, cambiadas: 0, error: "lectura_reglas" };
    reglas.push(...((data ?? []) as ReglaFila[]));
    if (!data || data.length < 1000) break;
  }
  let cambiadas = 0;
  const soportes: Array<{ regla_id: string; documento_id: string; empresa_id: string; rol: "confirmo" }> = [];
  const escrituras: Array<() => Promise<number>> = [];
  for (const r of reglas) {
    const e = ev.get(r.id);
    const rec = recalcularEstado(r, { confirmadas: e?.confirmadas ?? 0, confirmadasMiradas: e?.confirmadas_miradas ?? 0 });
    const cambiaEstado = rec.estado !== (r.estado ?? "firme");
    if (rec.cambio && (cambiaEstado || !opts.soloEstado)) {
      escrituras.push(async () => {
        const { count } = await sb
          .from("clasificacion_reglas")
          .update({ estado: rec.estado, veces_confirmada: rec.veces_confirmada }, { count: "exact" })
          .eq("id", r.id)
          .eq("empresa_id", empresaId)
          // condicional al estado leído: una corrección en paralelo gana.
          .eq("estado", String(r.estado ?? "firme"));
        return cambiaEstado ? count ?? 0 : 0;
      });
    }
    if (r.estado !== "huerfana") {
      for (const d of e?.documentos_confirman ?? []) soportes.push({ regla_id: r.id, documento_id: d, empresa_id: empresaId, rol: "confirmo" });
    }
  }
  // De a 8 en paralelo: la primera pasada sobre una empresa con cientos de reglas
  // (contadores en 0) no debe ser una fila de cientos de viajes.
  for (let i = 0; i < escrituras.length; i += 8) {
    const n = await Promise.all(escrituras.slice(i, i + 8).map((f) => f().catch(() => 0)));
    cambiadas += n.reduce((a, b) => a + b, 0);
  }
  for (let i = 0; i < soportes.length; i += 200) {
    try {
      await sb.from("clasificacion_regla_soportes").upsert(soportes.slice(i, i + 200), {
        onConflict: "regla_id,documento_id,rol",
        ignoreDuplicates: true,
      });
    } catch { /* best-effort */ }
  }
  return { revisadas: reglas.length, cambiadas };
}

// ── Deshacer ────────────────────────────────────────────────────────────────────

type EmpresaReeval = {
  giro?: string | null;
  razon_social?: string | null;
  tipo_contribuyente?: string | null;
  boletas_tipo_default?: string | null;
  facturas_tipo_default?: string | null;
  operacion_hint_default?: string | null;
};

const HINTS_VALIDOS = new Set(["p2p_cripto", "forex_divisas", "servicios", "ventas", "mixto"]);
const hintValido = (h: string | null | undefined): DocumentoHint => (h && HINTS_VALIDOS.has(h) ? (h as DocumentoHint) : null);

export interface ReevaluacionInput {
  mov: Pick<MovimientoExtraido, "descripcion" | "monto" | "fecha" | "tipo_flujo">;
  tipoActual: string;
  confianzaActual: number | null;
  total: number | null;
  tipoDteActual: number | null;
  /** Reglas RESTANTES (sin la deshecha). */
  reglas: ClasificacionRegla[];
  emp: EmpresaReeval | null;
  docHint: string | null;
}

export interface ReevaluacionResultado {
  tipo_propuesto: string;
  tipo_dte: number | null;
  regla_id: string | null;
  fuente_clasificacion: string;
  confianza: number | null;
  estado: "pendiente" | "listo";
  monto_neto: number | null;
  iva: number | null;
}

/**
 * Re-evalúa UNA fila sin la regla deshecha, SIN IA: la próxima regla que calce (con su
 * estado: una a prueba no deja "listo"), y el tipo_dte por decidirTipoDtePersistido
 * (misma decisión que al nacer). Si ninguna regla calza → pendiente con fuente
 * regla_deshecha (la persona decide en Check). PURA.
 */
export function reevaluarSinRegla(i: ReevaluacionInput): ReevaluacionResultado {
  const mov: MovimientoExtraido = { ...i.mov, origen: "otro" } as MovimientoExtraido;
  const match = classifyWithRules([mov], i.reglas).clasificados[0] ?? null;
  // Sin otra regla, el tipo que traía la fila ('exenta'/'boleta') era DE la regla
  // deshecha: no se hereda. Se decide desde una venta genérica (glosa, marca, emisor).
  const tipoBase = match ? String(match.propuesta.tipo_propuesto) : "boleta";
  const docHint = hintValido(i.docHint);
  const clasif = clasificarBoleta(
    { descripcion: i.mov.descripcion ?? "", monto: Number(i.total ?? i.mov.monto ?? 0), fecha: i.mov.fecha ?? "", receptor_nombre: null },
    {
      giro: i.emp?.giro, razon_social: i.emp?.razon_social, tipo_contribuyente: i.emp?.tipo_contribuyente,
      boletas_tipo_default: i.emp?.boletas_tipo_default, facturas_tipo_default: i.emp?.facturas_tipo_default,
      operacion_default: hintValido(i.emp?.operacion_hint_default),
    } as Parameters<typeof clasificarBoleta>[1],
    undefined,
    docHint,
  );
  const empTipos = i.emp as Parameters<typeof normalizarTipoPorEmisor>[1];
  const exento = carrilEsExento(empTipos, "boleta") || esVentaExentaEmisor(tipoBase, empTipos);
  const tipoNormRegla = normalizarTipoPorEmisor(tipoBase, empTipos);
  const decision = decidirTipoDtePersistido({
    tipoFlujo: i.mov.tipo_flujo,
    tipoBase,
    clasif,
    docHint,
    tipoContribuyente: i.emp?.tipo_contribuyente,
    reglaTipoDte: match?.tipo_dte ?? null,
    emisorExento: exento,
    reglaConfirmadaEnMarca: match?.regla_bajo_marca === true,
  });
  const tipoDte = decision.tipoDte;
  let confianza: number | null;
  let fuente: string;
  let estado: "pendiente" | "listo";
  if (match) {
    confianza = match.propuesta.confianza ?? null;
    fuente = match.fuente;
    if (decision.conflictoMarcaCartola) {
      confianza = Math.min(confianza ?? 0, CONFIANZA_MAX_POR_DECIDIR);
      fuente = FUENTE_CONFLICTO_MARCA;
    }
    estado = decidirEstadoInicial({
      confianza,
      reglaId: match.regla_id,
      tipoPropuesto: tipoNormRegla,
      conflictoMarcaCartola: decision.conflictoMarcaCartola,
      reglaAPrueba: match.regla_estado === "a_prueba" || match.regla_estado === "en_disputa",
    });
  } else {
    // Ninguna regla la toma: vuelve a Check y la decide la persona. Bajo el umbral de
    // "Poner listas" (0.8) aunque el auto haya sugerido un tipo: una regla deshecha no
    // puede convertirse en un lote a ciegas.
    confianza = Math.min(i.confianzaActual ?? 0, CONFIANZA_MAX_POR_DECIDIR);
    fuente = FUENTE_REGLA_DESHECHA;
    estado = "pendiente";
  }
  // tipo_propuesto coherente con el tipo_dte decidido (sin regla: 41 → exenta, si no la
  // venta genérica), normalizado al emisor.
  const tipoPropuesto = match
    ? tipoNormRegla
    : normalizarTipoPorEmisor(tipoDte === 41 ? "exenta" : "boleta", empTipos);
  const total = Number(i.total ?? 0);
  // Montos coherentes: con tipo, el reparto del DTE; sin tipo, todo neto y sin IVA
  // (lo que trae una fila por decidir; se recalcula al elegir el tipo en Check).
  const montos = tipoDte === 39 ? derivarMontosDte(total, true) : derivarMontosDte(total, false);
  return {
    tipo_propuesto: tipoPropuesto,
    tipo_dte: tipoDte,
    regla_id: match?.regla_id ?? null,
    fuente_clasificacion: fuente,
    confianza,
    estado,
    monto_neto: montos.neto,
    iva: montos.iva,
  };
}

export interface ResultadoDeshacer {
  ok?: true;
  error?: string;
  /** Filas que la regla había dejado en pendiente/listo y se re-evaluaron. */
  reevaluadas: number;
  /** De ésas, cuántas quedaron sin regla (pendiente, la decide la persona). */
  sinRegla: number;
  /** Filas de esta regla que ya están en Emitir (aprobadas, sin emitir): no se tocan. */
  enEmitir: number;
  /** Filas que no se tocaron por estar emitidas / a medias / en vuelo. */
  intocables: number;
  tipoDte: number | null;
}

/**
 * Deshace una regla de usuario: activa=false, estado 'deshecha', deshecha_por. No borra
 * la fila (tabla SAGRADA). Re-evalúa sin IA lo que la regla dejó en pendiente/listo;
 * NUNCA toca editado/aprobado (decisión humana o ya en Emitir) ni lo emitido / a
 * medias / en vuelo. Las escrituras van selladas (check_detalle, a ciegas: abierta=false).
 */
export async function deshacerRegla(
  sb: SB,
  a: { empresaId: string; usuarioId: string; reglaId: string; soporte?: boolean | null },
): Promise<ResultadoDeshacer> {
  const vacio: ResultadoDeshacer = { reevaluadas: 0, sinRegla: 0, enEmitir: 0, intocables: 0, tipoDte: null };
  const { data: r } = await sb
    .from("clasificacion_reglas")
    .select("id, empresa_id, estado, tipo_dte")
    .eq("id", a.reglaId)
    .eq("empresa_id", a.empresaId)
    .maybeSingle();
  const regla = r as { id: string; empresa_id: string | null; estado: string | null; tipo_dte: number | null } | null;
  if (!regla || !regla.empresa_id) return { ...vacio, error: "No encontramos esa regla en tu empresa." };
  if (regla.estado === "huerfana") return { ...vacio, error: "Esa regla ya no está activa." };

  if (regla.estado !== "deshecha") {
    const { error } = await sb
      .from("clasificacion_reglas")
      .update({ activa: false, estado: "deshecha", deshecha_por: a.usuarioId })
      .eq("id", a.reglaId)
      .eq("empresa_id", a.empresaId);
    if (error) return { ...vacio, error: "No se pudo deshacer. Intenta de nuevo." };
  }

  // Filas vivas que la regla dejó (pendiente/listo). Editado/aprobado = decisión humana.
  const filas: Array<{ id: string; movimiento_id: string; tipo_propuesto: string; tipo_dte: number | null; confianza: number | null; total: number | null; mesa: string | null }> = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from("propuestas_ia")
      .select("id, movimiento_id, tipo_propuesto, tipo_dte, confianza, total, mesa")
      .eq("empresa_id", a.empresaId)
      .eq("regla_id", a.reglaId)
      .in("estado", ["pendiente", "listo"])
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (error) return { ...vacio, tipoDte: regla.tipo_dte, error: "Se deshizo la regla, pero no pudimos revisar sus movimientos." };
    filas.push(...((data ?? []) as typeof filas));
    if (!data || data.length < 1000) break;
  }
  const { count: enEmitir } = await sb
    .from("propuestas_ia")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", a.empresaId)
    .eq("regla_id", a.reglaId)
    .eq("estado", "aprobado");

  const deBoleta = filas.filter((f) => f.mesa !== "factura");
  const sep = await clasificarIntocables(sb as never, a.empresaId, deBoleta.map((f) => f.id));
  if ("error" in sep) return { ...vacio, tipoDte: regla.tipo_dte, enEmitir: enEmitir ?? 0, error: sep.error };
  const tocables = new Set(sep.tocables);
  const aRevisar = deBoleta.filter((f) => tocables.has(f.id));

  // Contexto para re-evaluar (una lectura de cada cosa, no por fila).
  const { data: emp } = await sb
    .from("empresas")
    .select("giro, razon_social, tipo_contribuyente, boletas_tipo_default, facturas_tipo_default, operacion_hint_default")
    .eq("id", a.empresaId)
    .maybeSingle();
  const { data: rs } = await sb
    .from("clasificacion_reglas")
    .select("*")
    .or(`empresa_id.eq.${a.empresaId},empresa_id.is.null`)
    .eq("activa", true)
    .neq("id", a.reglaId);
  const restantes = (rs ?? []) as unknown as ClasificacionRegla[];
  const movs = new Map<string, { descripcion: string | null; monto: number | null; fecha: string | null; tipo_flujo: string | null; documento_id: string | null }>();
  for (let i = 0; i < aRevisar.length; i += TROZO) {
    const { data } = await sb
      .from("movimientos_raw")
      .select("id, descripcion, monto, fecha, tipo_flujo, documento_id")
      .eq("empresa_id", a.empresaId)
      .in("id", aRevisar.slice(i, i + TROZO).map((f) => f.movimiento_id));
    for (const m of (data ?? []) as Array<{ id: string; descripcion: string | null; monto: number | null; fecha: string | null; tipo_flujo: string | null; documento_id: string | null }>) movs.set(m.id, m);
  }
  const docIds = [...new Set([...movs.values()].map((m) => m.documento_id).filter((d): d is string => !!d))];
  const hints = new Map<string, string | null>();
  for (let i = 0; i < docIds.length; i += TROZO) {
    const { data } = await sb
      .from("documentos_subidos")
      .select("id, tipo_operacion_hint")
      .eq("empresa_id", a.empresaId)
      .in("id", docIds.slice(i, i + TROZO));
    for (const d of (data ?? []) as Array<{ id: string; tipo_operacion_hint: string | null }>) hints.set(d.id, d.tipo_operacion_hint);
  }

  // Un gesto = un lote (todas las filas comparten el uuid). A ciegas: la persona
  // apretó Deshacer en "Lo que aprendí", no miró cada fila.
  const lote = nuevoLote();
  const selloDeshacer = sello("check_detalle", { usuarioId: a.usuarioId, loteN: Math.max(1, aRevisar.length), lote, abierta: false, soporte: a.soporte ?? null });
  let reevaluadas = 0;
  let sinRegla = 0;
  for (const f of aRevisar) {
    const m = movs.get(f.movimiento_id);
    if (!m) continue;
    const res = reevaluarSinRegla({
      mov: { descripcion: m.descripcion ?? "", monto: Number(m.monto ?? 0), fecha: m.fecha ?? "", tipo_flujo: m.tipo_flujo === "salida" ? "salida" : "entrada" },
      tipoActual: f.tipo_propuesto,
      confianzaActual: f.confianza,
      total: f.total,
      tipoDteActual: f.tipo_dte,
      reglas: restantes,
      emp: (emp ?? null) as EmpresaReeval | null,
      docHint: m.documento_id ? hints.get(m.documento_id) ?? null : null,
    });
    const cambios: Record<string, unknown> = {
      tipo_propuesto: res.tipo_propuesto,
      tipo_dte: res.tipo_dte,
      regla_id: res.regla_id,
      fuente_clasificacion: res.fuente_clasificacion,
      confianza: res.confianza,
      estado: res.estado,
      monto_neto: res.monto_neto,
      iva: res.iva,
    };
    const { count, error } = await sb
      .from("propuestas_ia")
      .update({ ...cambios, ...selloDeshacer } as never, { count: "exact" })
      .eq("empresa_id", a.empresaId)
      .eq("id", f.id)
      .eq("regla_id", a.reglaId)
      .in("estado", ["pendiente", "listo"]);
    if (error) continue;
    if ((count ?? 0) > 0) {
      reevaluadas += 1;
      if (!res.regla_id) sinRegla += 1;
    }
  }
  return {
    ok: true,
    reevaluadas,
    sinRegla,
    enEmitir: enEmitir ?? 0,
    intocables: sep.intocables.size,
    tipoDte: regla.tipo_dte,
  };
}
