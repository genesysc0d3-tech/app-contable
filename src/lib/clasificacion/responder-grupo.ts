/**
 * CHECK AGRUPADO — lo que pasa en la base cuando la clienta responde una pregunta en
 * grupo (Fase 4 del plan del clasificador). Lo llama la server action responderGrupo
 * (src/app/(app)/revisar/actions.ts) con el cliente service role YA scopeado.
 *
 * El navegador manda SOLO qué filas son venta y cuáles no (y si las tocó a mano). Todo
 * lo demás se decide acá, con los mismos candados que el resto de Check:
 *  - lo emitido / a medias / en vuelo no se toca (clasificarIntocables);
 *  - solo filas pendiente/editado — ni listo (ya decidida) ni aprobado (en Emitir);
 *  - solo filas de ESTA cartola y de esta empresa, mesa boleta (otra cartola → error);
 *  - un «¿?» (arriendo/comisión, conflicto regla↔marca) no se decide en grupo;
 *  - venta solo en abonos de destino "boleta" (nunca una fila que el sistema clasificó
 *    como no-venta: sueldo, honorarios, donación…) y nunca sobre lo que parece no-venta
 *    (detectaNoBoletar);
 *  - emisor exento en boletas o marca P2P/forex de la cartola (leída ACÁ, no del
 *    navegador) → 41, sin excepción;
 *  - venta = tipo + montos + 'listo' en UNA llamada (RPC responder_grupo_ventas, que
 *    repite los candados en SQL); no venta = 'rechazado'.
 *
 * Sello: canal 'check_grupo', lote = UN uuid por respuesta (el "grupoId" con que se
 * deshace), lote_n = tamaño de la respuesta, abierta=true solo en lo tocado a mano.
 *
 * Reglas: una respuesta de GRUPO no crea reglas (la lista de glosas genéricas de bancos
 * nunca cierra). Única excepción: la persona que la clienta TOCÓ A MANO en "Algunas", con
 * RUT válido y nombre, y ≥2 ventas (a_prueba, sin propagar). El "Sí" a toda la tarjeta
 * se sella a ciegas y tampoco cuenta como confirmación de una regla (evidencia_reglas).
 * "No es venta" no crea regla ni rechaza nada en el futuro: la próxima vez esa persona
 * sale en "¿Sigue igual?" (lo arma el motor del navegador con la historia de la mesa).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clasificarIntocables as clasificarIntocablesReal } from "@/lib/emission/propuestas-intocables";
import { aprenderReglaDesdeResolucion } from "@/lib/ai/aprender-regla";
import { deshacerRegla as deshacerReglaReal } from "@/lib/ai/reglas-historial";
import { carrilEsExento, tipoDelCarril } from "@/lib/sii/tipo-por-carril";
import { destinoPropuesta, esAfectoPorTipo, esExentoPorNaturaleza } from "@/lib/sii/destino";
import { detectaNoBoletar } from "@/lib/sii/clasificador-tipo";
import { derivarMontosDte } from "@/lib/sii/montos-dte";
import { claveContraparte, patronAcunableEnGrupo } from "./contraparte";
import { nuevoLote, sello } from "@/lib/propuestas/sello";

const TROZO = 50;
/** Una respuesta no puede traer más filas que esto (una cartola grande cabe holgada). */
export const MAX_FILAS_RESPUESTA = 2000;
/** Una respuesta en grupo solo decide filas con juicio pendiente (no re-decide una lista). */
const ESTADOS_TOCABLES = ["pendiente", "editado"] as const;
const MARCAS_EXENTAS = new Set(["p2p_cripto", "forex_divisas"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IvaRespuesta = "afecta" | "exenta" | "depende";

export interface ItemRespuesta {
  ids: string[];
  venta: boolean;
  /** La clienta tocó a esta persona a mano en "Algunas" → decisión mirada. */
  tocada?: boolean;
}

export interface RespuestaGrupo {
  documentoId: string;
  /** Lo genera el navegador ANTES de enviar: si se corta la conexión, igual se deshace. */
  grupoId?: string;
  items: ItemRespuesta[];
  /** Respuesta a "¿Lo que vendes lleva IVA?" (si se preguntó). */
  iva?: IvaRespuesta | null;
}

export interface ResultadoGrupo {
  ok?: true;
  error?: string;
  /** Lote de la respuesta: con esto se deshace. */
  grupoId?: string;
  ventas: number;
  noVentas: number;
  /** Filas de la respuesta que no se tocaron (cambiaron, emitidas, sin tipo, no-venta probable…). */
  quedan: number;
  reglas: number;
}

export interface CtxGrupo {
  empresaId: string;
  userId: string;
  soporte: boolean | null;
}

type SbMin = SupabaseClient;

export interface DepsGrupo {
  clasificarIntocables: typeof clasificarIntocablesReal;
  aprender: typeof aprenderReglaDesdeResolucion;
  deshacerRegla: typeof deshacerReglaReal;
}

// Perezoso: se arma al llamar (no al importar el módulo).
const depsReales = (): DepsGrupo => ({
  clasificarIntocables: clasificarIntocablesReal,
  aprender: aprenderReglaDesdeResolucion,
  deshacerRegla: deshacerReglaReal,
});

const vacio = (error?: string): ResultadoGrupo => ({ ...(error ? { error } : {}), ventas: 0, noVentas: 0, quedan: 0, reglas: 0 });

type Fila = {
  id: string; estado: string | null; mesa: string | null; tipo_propuesto: string | null; tipo_dte: number | null;
  fuente_clasificacion: string | null; total: number | null; movimiento_id: string | null; decision_lote: string | null;
};
type Mov = { id: string; documento_id: string | null; descripcion: string | null; tipo_flujo: string | null };

/** Valida el payload (server action = endpoint público): ids únicos, uuid, tope. */
export function validarRespuesta(r: unknown): { ok: RespuestaGrupo } | { error: string } {
  const x = r as Partial<RespuestaGrupo> | null;
  if (!x || typeof x.documentoId !== "string" || !UUID.test(x.documentoId)) return { error: "Falta la cartola." };
  if (!Array.isArray(x.items) || x.items.length === 0) return { error: "No llegó ninguna respuesta." };
  const vistos = new Set<string>();
  const items: ItemRespuesta[] = [];
  for (const it of x.items) {
    if (!it || !Array.isArray(it.ids) || typeof it.venta !== "boolean") return { error: "Respuesta inválida." };
    const ids: string[] = [];
    for (const id of it.ids) {
      if (typeof id !== "string" || !UUID.test(id)) return { error: "Respuesta inválida." };
      if (vistos.has(id)) return { error: "Una fila venía dos veces en la respuesta." };
      vistos.add(id);
      ids.push(id);
    }
    if (ids.length > 0) items.push({ ids, venta: it.venta, tocada: it.tocada === true });
  }
  if (vistos.size === 0) return { error: "No llegó ninguna respuesta." };
  if (vistos.size > MAX_FILAS_RESPUESTA) return { error: "Son demasiadas filas para una sola respuesta." };
  const iva = x.iva === "afecta" || x.iva === "exenta" || x.iva === "depende" ? x.iva : null;
  if (x.grupoId !== undefined && (typeof x.grupoId !== "string" || !UUID.test(x.grupoId))) return { error: "Respuesta inválida." };
  return { ok: { documentoId: x.documentoId, items, iva, ...(x.grupoId ? { grupoId: x.grupoId } : {}) } };
}

/**
 * Tipo con que se emite una VENTA de esta fila, o null si no se puede decidir en grupo
 * (queda para mirarla una por una). Puro: lo usan la acción y los tests.
 */
export function tipoDeVenta(
  f: { tipo_propuesto: string | null; tipo_dte: number | null },
  c: { carril: string; p2p: boolean; iva: IvaRespuesta | null | undefined },
): 39 | 41 | null {
  // La exención "por naturaleza" (p2p/cripto/forex) manda SOLO con la marca de la
  // cartola: sin ella, ese tipo es lo que adivinó el clasificador, no la ley.
  if (c.carril === "exento" || c.p2p) return 41;
  if (f.tipo_dte === 39 || f.tipo_dte === 41) return f.tipo_dte;
  if (c.iva === "afecta") return 39;
  if (c.iva === "exenta") return 41;
  if (c.carril === "afecto") return 39;
  return null;
}

async function leerFilas(sb: SbMin, empresaId: string, ids: string[]): Promise<{ filas: Fila[]; movs: Map<string, Mov> } | { error: string }> {
  const filas: Fila[] = [];
  for (let i = 0; i < ids.length; i += TROZO) {
    const { data, error } = await sb
      .from("propuestas_ia")
      .select("id, estado, mesa, tipo_propuesto, tipo_dte, fuente_clasificacion, total, movimiento_id, decision_lote")
      .eq("empresa_id", empresaId)
      .in("id", ids.slice(i, i + TROZO));
    if (error) return { error: "No pudimos leer esas filas. Intenta de nuevo." };
    filas.push(...((data ?? []) as Fila[]));
  }
  const movIds = [...new Set(filas.map((f) => f.movimiento_id).filter((m): m is string => !!m))];
  const movs = new Map<string, Mov>();
  for (let i = 0; i < movIds.length; i += TROZO) {
    const { data, error } = await sb
      .from("movimientos_raw")
      .select("id, documento_id, descripcion, tipo_flujo")
      .eq("empresa_id", empresaId)
      .in("id", movIds.slice(i, i + TROZO));
    if (error) return { error: "No pudimos leer esas filas. Intenta de nuevo." };
    for (const m of (data ?? []) as Mov[]) movs.set(m.id, m);
  }
  return { filas, movs };
}

export async function ejecutarRespuestaGrupo(
  sb: SbMin,
  ctx: CtxGrupo,
  entrada: unknown,
  deps: DepsGrupo = depsReales(),
): Promise<ResultadoGrupo> {
  const v = validarRespuesta(entrada);
  if ("error" in v) return vacio(v.error);
  const r = v.ok;
  const decision = new Map<string, { venta: boolean; tocada: boolean }>();
  for (const it of r.items) for (const id of it.ids) decision.set(id, { venta: it.venta, tocada: it.tocada === true });
  const ids = [...decision.keys()];

  const { data: doc } = await sb
    .from("documentos_subidos")
    .select("id, tipo_operacion_hint")
    .eq("id", r.documentoId)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (!doc) return vacio("No encontramos esa cartola en tu empresa.");
  const p2p = MARCAS_EXENTAS.has(String((doc as { tipo_operacion_hint?: string | null }).tipo_operacion_hint ?? ""));

  const leidas = await leerFilas(sb, ctx.empresaId, ids);
  if ("error" in leidas) return vacio(leidas.error);
  const { filas, movs } = leidas;
  // Todo o nada: una fila de otra cartola (o de la mesa de facturas) es una respuesta
  // armada a mano. No se cambia NADA.
  for (const f of filas) {
    const m = f.movimiento_id ? movs.get(f.movimiento_id) : undefined;
    if (!m || m.documento_id !== r.documentoId) return vacio("Una de esas filas no es de esta cartola. No se cambió nada.");
    if (f.mesa === "factura") return vacio("Las preguntas en grupo son para boletas. No se cambió nada.");
  }

  const { data: empresa } = await sb
    .from("empresas")
    .select("tipo_contribuyente, boletas_tipo_default, facturas_tipo_default")
    .eq("id", ctx.empresaId)
    .maybeSingle();
  const carril = carrilEsExento(empresa, "boleta") ? "exento" : tipoDelCarril(empresa, "boleta");

  const sep = await deps.clasificarIntocables(sb, ctx.empresaId, filas.map((f) => f.id));
  if ("error" in sep) return vacio(sep.error);
  const intocables = new Set(sep.intocables.keys());

  const grupoId = r.grupoId ?? nuevoLote();
  // Un grupoId que ya se usó en OTRA cartola no se reusa (Deshacer mezclaría dos respuestas).
  if (r.grupoId) {
    // (documento_id null también es "otra": un evento sin cartola no es de esta respuesta)
    const { data: usados } = await sb
      .from("propuesta_decisiones")
      .select("documento_id")
      .eq("empresa_id", ctx.empresaId)
      .eq("lote_id", r.grupoId)
      .range(0, 199);
    if (((usados ?? []) as Array<{ documento_id: string | null }>).some((e) => e.documento_id !== r.documentoId)) {
      return vacio("Esa respuesta ya se usó en otra cartola. Recarga e intenta de nuevo.");
    }
  }
  const loteN = ids.length;
  const selloDe = (abierta: boolean) => sello("check_grupo", { usuarioId: ctx.userId, loteN, lote: grupoId, abierta, soporte: ctx.soporte });

  let ventas = 0;
  let noVentas = 0;
  const vendidas: Array<{ fila: Fila; mov: Mov; tipo: 39 | 41; tocada: boolean }> = [];
  const noVenta: { mirada: string[]; ciega: string[] } = { mirada: [], ciega: [] };
  // Ventas: UNA llamada a la base (RPC) con fila → valores; la base repite los candados.
  const aVender: Array<{ fila: Fila; mov: Mov; tipo: 39 | 41; tocada: boolean; tipoPropuesto: string; neto: number; iva: number; total: number }> = [];

  for (const f of filas) {
    const d = decision.get(f.id)!;
    const mov = movs.get(f.movimiento_id!)!;
    // Reintento con el mismo grupo: lo que ya quedó hecho cuenta como hecho, no "queda".
    if (f.decision_lote === grupoId) {
      if (f.estado === "listo") ventas++;
      else if (f.estado === "rechazado") noVentas++;
      continue;
    }
    if (intocables.has(f.id)) continue;
    if (!(ESTADOS_TOCABLES as readonly string[]).includes(f.estado ?? "")) continue; // nunca aprobado
    if (destinoPropuesta(f) === "preguntar") continue; // «¿?»: una por una
    if (!d.venta) { (d.tocada ? noVenta.mirada : noVenta.ciega).push(f.id); continue; }
    if (mov.tipo_flujo !== "entrada") continue;
    if (detectaNoBoletar(mov.descripcion)) continue;
    if (destinoPropuesta(f) !== "boleta") continue; // no-venta clasificada o factura: una por una
    const tipo = tipoDeVenta(f, { carril, p2p, iva: r.iva });
    if (tipo == null) continue;
    const total = Number(f.total ?? 0);
    const tipoPropuesto = tipo === 41 && esExentoPorNaturaleza(f.tipo_propuesto) ? f.tipo_propuesto! : tipo === 39 ? "boleta" : "exenta";
    const { neto, iva } = derivarMontosDte(total, tipo === 39);
    aVender.push({ fila: f, mov, tipo, tocada: d.tocada, tipoPropuesto, neto, iva, total });
  }

  if (aVender.length > 0) {
    const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
      "responder_grupo_ventas",
      {
        p_empresa_id: ctx.empresaId,
        p_documento_id: r.documentoId,
        p_lote: grupoId,
        p_lote_n: loteN,
        p_usuario: ctx.userId,
        p_soporte: ctx.soporte,
        p_filas: aVender.map((x) => ({ id: x.fila.id, tipo_propuesto: x.tipoPropuesto, tipo_dte: x.tipo, monto_neto: x.neto, iva: x.iva, total: x.total, tocada: x.tocada })),
      },
    );
    if (error) return { error: "No se pudo guardar tu respuesta. Intenta de nuevo.", grupoId, ventas, noVentas, quedan: Math.max(0, ids.length - ventas - noVentas), reglas: 0 };
    const hechos = new Set(((data ?? []) as Array<{ id: string } | string>).map((x) => (typeof x === "string" ? x : x.id)));
    for (const x of aVender) {
      if (!hechos.has(x.fila.id)) continue;
      ventas++;
      vendidas.push({ fila: x.fila, mov: x.mov, tipo: x.tipo, tocada: x.tocada });
    }
  }

  for (const [abierta, lista] of [[true, noVenta.mirada], [false, noVenta.ciega]] as const) {
    for (let i = 0; i < lista.length; i += TROZO) {
      const { error, count } = await sb
        .from("propuestas_ia")
        .update({ estado: "rechazado", ...selloDe(abierta) }, { count: "exact" })
        .eq("empresa_id", ctx.empresaId)
        .in("id", lista.slice(i, i + TROZO))
        .in("estado", [...ESTADOS_TOCABLES]);
      if (error) return { error: "Se guardó una parte. Intenta de nuevo con lo que falta.", grupoId, ventas, noVentas, quedan: Math.max(0, ids.length - ventas - noVentas), reglas: 0 };
      noVentas += count ?? 0;
    }
  }

  // Reglas: solo la persona TOCADA A MANO con RUT válido y nombre (ver cabecera), ≥2
  // ventas y un solo tipo. Best-effort: lo decidido ya quedó guardado.
  let reglas = 0;
  try {
    const porPatron = new Map<string, Array<{ fila: Fila; mov: Mov; tipo: 39 | 41; tocada: boolean }>>();
    for (const x of vendidas) {
      if (!x.tocada) continue;
      const c = claveContraparte(x.mov.descripcion);
      if (!c || c.tipo !== "rut" || !c.patron) continue;
      // El patrón de la regla debe ser el nombre limpio (sin "TRF REC BCOS…").
      if (!patronAcunableEnGrupo(x.mov.descripcion)) continue;
      porPatron.set(c.clave, [...(porPatron.get(c.clave) ?? []), x]);
    }
    for (const lista of porPatron.values()) {
      if (lista.length < 2) continue;
      const tipos = new Set(lista.map((x) => x.tipo));
      if (tipos.size !== 1) continue;
      const res = await deps.aprender(sb as never, {
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        documentoId: r.documentoId,
        descripcion: lista[0].mov.descripcion ?? "",
        tipoFlujo: "entrada",
        tipoDte: lista[0].tipo,
        tamanoLote: loteN,
        canal: "check_grupo",
        movimientoId: lista[0].mov.id,
        propagar: false,
        nacioLote: grupoId,
      });
      if (res?.creada) reglas++;
    }
  } catch { /* aprender es best-effort */ }

  return { ok: true, grupoId, ventas, noVentas, quedan: Math.max(0, ids.length - ventas - noVentas), reglas };
}

// ── Deshacer una respuesta ──────────────────────────────────────────────────────

export interface ResultadoDeshacerGrupo {
  ok?: true;
  error?: string;
  devueltas: number;
  /** Filas de la respuesta que ya cambiaron después (o se emitieron): no se tocan. */
  sinTocar: number;
  reglas: number;
}

type EventoLog = { propuesta_id: string; antes_estado: string | null; antes_tipo_propuesto: string | null; antes_tipo_dte: number | null };

/**
 * Devuelve cada fila de la respuesta a como estaba (según el log propuesta_decisiones),
 * SOLO si nadie la tocó después (su sello sigue siendo el de la respuesta), sigue en
 * pendiente/editado/listo/rechazado y no está emitida / a medias / en vuelo. Nunca
 * aprobado. Apaga las reglas que nacieron en la respuesta (deshacerRegla, Fase 3).
 */
export async function deshacerRespuestaGrupo(
  sb: SbMin,
  ctx: CtxGrupo,
  grupoId: unknown,
  deps: DepsGrupo = depsReales(),
): Promise<ResultadoDeshacerGrupo> {
  const nada = (error: string): ResultadoDeshacerGrupo => ({ error, devueltas: 0, sinTocar: 0, reglas: 0 });
  if (typeof grupoId !== "string" || !UUID.test(grupoId)) return nada("No encontramos esa respuesta.");
  const eventos: EventoLog[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from("propuesta_decisiones")
      .select("propuesta_id, antes_estado, antes_tipo_propuesto, antes_tipo_dte")
      .eq("empresa_id", ctx.empresaId)
      .eq("lote_id", grupoId)
      .eq("canal", "check_grupo")
      .eq("accion", "cambio")
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (error) return nada("No pudimos deshacer. Intenta de nuevo.");
    eventos.push(...((data ?? []) as EventoLog[]));
    if (!data || data.length < 1000) break;
  }
  const antes = new Map<string, EventoLog>();
  for (const e of eventos) if (!antes.has(e.propuesta_id)) antes.set(e.propuesta_id, e); // el primero = el estado previo
  if (antes.size === 0) return nada("No encontramos esa respuesta.");
  const ids = [...antes.keys()];

  const filas: Array<{ id: string; estado: string | null; decision_lote: string | null; total: number | null; tipo_propuesto: string | null; tipo_dte: number | null }> = [];
  for (let i = 0; i < ids.length; i += TROZO) {
    const { data, error } = await sb
      .from("propuestas_ia")
      .select("id, estado, decision_lote, total, tipo_propuesto, tipo_dte")
      .eq("empresa_id", ctx.empresaId)
      .in("id", ids.slice(i, i + TROZO));
    if (error) return nada("No pudimos deshacer. Intenta de nuevo.");
    filas.push(...((data ?? []) as typeof filas));
  }
  const sep = await deps.clasificarIntocables(sb, ctx.empresaId, filas.map((f) => f.id));
  if ("error" in sep) return nada(sep.error);

  const lote = nuevoLote();
  // abierta=null marca el gesto como DESHACER (no una respuesta): ultimoGrupo lo salta y
  // la evidencia no lo cuenta como mirado.
  const selloDeshacer = sello("check_grupo", { usuarioId: ctx.userId, loteN: ids.length, lote, abierta: null, soporte: ctx.soporte });
  let devueltas = 0;
  for (const f of filas) {
    const e = antes.get(f.id)!;
    if (sep.intocables.has(f.id)) continue;
    if (f.decision_lote !== grupoId) continue; // alguien la cambió después: manda lo último
    if (!["pendiente", "editado", "listo", "rechazado"].includes(f.estado ?? "")) continue;
    if (!["pendiente", "editado", "listo"].includes(e.antes_estado ?? "")) continue;
    const patch: Record<string, unknown> = { estado: e.antes_estado };
    if (e.antes_tipo_propuesto && (e.antes_tipo_propuesto !== f.tipo_propuesto || e.antes_tipo_dte !== f.tipo_dte)) {
      const afecta = e.antes_tipo_dte === 39 || (e.antes_tipo_dte == null && esAfectoPorTipo(e.antes_tipo_propuesto));
      const { neto, iva } = derivarMontosDte(Number(f.total ?? 0), afecta);
      Object.assign(patch, { tipo_propuesto: e.antes_tipo_propuesto, tipo_dte: e.antes_tipo_dte, monto_neto: neto, iva });
    }
    const { error, count } = await sb
      .from("propuestas_ia")
      .update({ ...patch, ...selloDeshacer }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .eq("id", f.id)
      .eq("decision_lote", grupoId)
      .in("estado", ["pendiente", "editado", "listo", "rechazado"]);
    if (error) continue;
    devueltas += count ?? 0;
  }

  let reglas = 0;
  const { data: rs } = await sb
    .from("clasificacion_reglas")
    .select("id, estado")
    .eq("empresa_id", ctx.empresaId)
    .eq("nacio_lote", grupoId);
  for (const regla of (rs ?? []) as Array<{ id: string; estado: string | null }>) {
    if (regla.estado === "deshecha" || regla.estado === "huerfana") continue;
    try {
      const res = await deps.deshacerRegla(sb as never, { empresaId: ctx.empresaId, usuarioId: ctx.userId, reglaId: regla.id, soporte: ctx.soporte });
      if (res.ok) reglas++;
    } catch { /* best-effort */ }
  }
  return { ok: true, devueltas, sinTocar: ids.length - devueltas, reglas };
}

// ── Deshacer después de recargar ────────────────────────────────────────────────

/**
 * La última respuesta en grupo de esta cartola que TODAVÍA se puede deshacer (alguna de
 * sus filas sigue con su sello). Lee el log: los deshacer (abierta null) no cuentan.
 */
export async function ultimoGrupoDeshacible(
  sb: SbMin,
  ctx: CtxGrupo,
  documentoId: unknown,
): Promise<{ grupoId: string | null; filas: number }> {
  const nada = { grupoId: null, filas: 0 };
  if (typeof documentoId !== "string" || !UUID.test(documentoId)) return nada;
  const { data } = await sb
    .from("propuesta_decisiones")
    .select("lote_id, abierta")
    .eq("empresa_id", ctx.empresaId)
    .eq("documento_id", documentoId)
    .eq("canal", "check_grupo")
    .eq("accion", "cambio")
    .order("id", { ascending: false })
    .range(0, 199);
  const lotes: string[] = [];
  for (const e of (data ?? []) as Array<{ lote_id: string | null; abierta: boolean | null }>) {
    if (e.lote_id && e.abierta !== null && !lotes.includes(e.lote_id)) lotes.push(e.lote_id);
  }
  // La más reciente que todavía tenga filas con su sello (las ya deshechas no cuentan).
  for (const lote of lotes.slice(0, 5)) {
    const { count } = await sb
      .from("propuestas_ia")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", ctx.empresaId)
      .eq("decision_lote", lote)
      .in("estado", ["pendiente", "editado", "listo", "rechazado"]);
    if ((count ?? 0) > 0) return { grupoId: lote, filas: count ?? 0 };
  }
  return nada;
}
