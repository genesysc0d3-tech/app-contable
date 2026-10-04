/**
 * CHECK AGRUPADO — motor PURO (Fase 4 del plan del clasificador,
 * docs/plan-clasificador-cirujano-2026-10-03.md). Corre en el navegador sobre las filas
 * que la mesa YA trae (sin pedidos extra) y arma las PREGUNTAS EN GRUPO:
 *
 *   "40 transferencias de 12 personas · ¿Les vendiste algo a estas personas?"
 *        [Sí, me compraron]  [Algunas]  [No, es plata de familia o mía]
 *
 * en vez de 60 páginas fila por fila. Idioma de la clienta, nunca jerga contable.
 *
 * Reglas del motor (cada una tiene test):
 *  - Solo filas con juicio pendiente (pendiente/editado), no terminadas (emitida /
 *    a medias) y que no sean «¿?» (arriendo/comisión, conflicto regla↔marca: esas las
 *    decide la clienta una por una, nunca un grupo).
 *  - Riesgo primero: cuenta propia, lo que parece no-venta (préstamo, sueldo…), lo que
 *    la otra vez dijo que no era venta ("¿Sigue igual?"), ventas a personas, pagos por
 *    plataforma (canal), salidas, empresas (→ "Mirarlas": a una empresa se le factura).
 *  - Lo que parece no-venta (detectaNoBoletar) JAMÁS cae en una tarjeta de ventas, y su
 *    tarjeta no ofrece "Sí, son ventas" (el servidor tampoco lo aceptaría).
 *  - Una tarjeta necesita ≥3 filas; con menos, esas filas se miran una por una.
 *  - Máximo 3 tarjetas a la vista; al responder, aparece la siguiente.
 *  - Cartola marcada P2P/forex: se pregunta la EXCEPCIÓN ("¿Alguna NO fue una venta?"),
 *    nunca el IVA (por ley es exenta).
 *  - "¿Lo que vendes lleva IVA?" solo si el carril es automático, sin marca P2P/forex y
 *    hay alguna fila sin tipo que no sea exenta por naturaleza.
 *  - Se apaga si la mesa está truncada (no vemos todo) o en la mesa de facturas.
 *  - "No es venta" nunca rechaza solo en el futuro: solo PRE-AGRUPA a esa persona la
 *    próxima vez y le pregunta "¿Sigue igual?".
 */
import { claveContraparte, pareceCuentaPropia, pareceEmpresa, type TipoClave } from "@/lib/clasificacion/contraparte";
import { detectaNoBoletar } from "@/lib/sii/clasificador-tipo";
import { destino, destinoPropuesta } from "@/lib/sii/destino";
import { terminadaDe, type BoletaEmbebida } from "./cartola-filas";

export type KindTarjeta = "propia" | "no_venta_probable" | "sigue_igual" | "ventas" | "canal" | "salidas" | "empresas";

/** Orden de riesgo: lo que más daño hace si se responde mal va primero. */
export const ORDEN_RIESGO: readonly KindTarjeta[] = ["propia", "no_venta_probable", "sigue_igual", "ventas", "canal", "salidas", "empresas"];

/** Mínimo de filas para que valga la pena preguntar en grupo. */
export const MIN_FILAS_TARJETA = 3;
/** Tarjetas a la vista a la vez. */
export const MAX_TARJETAS_VISIBLES = 3;

export interface FilaPregunta {
  id: string;
  estado: string | null;
  tipo_propuesto: string | null;
  tipo_dte: number | null;
  fuente_clasificacion?: string | null;
  total: number | null;
  descripcion: string | null;
  tipo_flujo: string | null;
  receptor_rut?: string | null;
  fecha?: string | null;
  /** Emitida o a medias (cartola-filas.ts terminadaDe): nunca se pregunta. */
  terminada: boolean;
}

/** Lo mínimo de una propuesta de la mesa (revisar-shared Propuesta) que lee el motor. */
export interface PropuestaParaPreguntas {
  id: string;
  estado: string | null;
  tipo_propuesto: string | null;
  tipo_dte?: number | null;
  fuente_clasificacion?: string | null;
  total?: number | null;
  receptor_rut?: string | null;
  boletas_emitidas?: BoletaEmbebida[] | BoletaEmbebida | null;
  movimientos_raw?: { descripcion?: string | null; tipo_flujo?: string | null; fecha?: string | null; monto?: number | null } | null;
}

export function filaDePropuesta(p: PropuestaParaPreguntas, aMediasIds: ReadonlySet<string>): FilaPregunta {
  return {
    id: p.id,
    estado: p.estado,
    tipo_propuesto: p.tipo_propuesto,
    tipo_dte: p.tipo_dte ?? null,
    fuente_clasificacion: p.fuente_clasificacion ?? null,
    total: p.total ?? p.movimientos_raw?.monto ?? null,
    descripcion: p.movimientos_raw?.descripcion ?? null,
    tipo_flujo: p.movimientos_raw?.tipo_flujo ?? null,
    receptor_rut: p.receptor_rut ?? null,
    fecha: p.movimientos_raw?.fecha ?? null,
    terminada: terminadaDe(p, aMediasIds) !== null,
  };
}

export type AccionRespuesta = "venta" | "algunas" | "no_venta" | "mirar";

export interface Persona {
  clave: string;
  etiqueta: string;
  tipo: TipoClave | "fila";
  ids: string[];
  /** Cada movimiento de la persona ("Ver sus N"): fecha y monto, sin la glosa cruda. */
  filas: Array<{ id: string; fecha: string; total: number }>;
  total: number;
  /** La otra vez dijo que no era venta (hay filas suyas juzgadas en la mesa). */
  antesNoVenta: boolean;
}

export interface Tarjeta {
  id: KindTarjeta;
  kind: KindTarjeta;
  ids: string[];
  personas: Persona[];
  total: number;
  titulo: string;
  /** Unos nombres de muestra: "Juan Perez, Maria Soto y 10 más". */
  muestra: string;
  pregunta: string;
  respuestas: Array<{ accion: AccionRespuesta; texto: string }>;
  /** En "Algunas", cómo parte cada persona: venta (true) o no (false). */
  ventaPorDefecto: boolean;
  /** Una respuesta de venta pregunta después "¿Lo que vendes lleva IVA?". */
  preguntaIva: boolean;
}

export interface ContextoPreguntas {
  mesa: string;
  /** La mesa no trajo todas las filas del período (mesa-data propuestasTruncadas). */
  truncada: boolean;
  /** Tipo del carril de boletas (tipoDelCarril): "afecto" | "exento" | "auto". */
  carril: string | null | undefined;
  /** documentos_subidos.tipo_operacion_hint (p2p_cripto / forex_divisas = exenta por ley). */
  marca: string | null | undefined;
  razonSocial: string | null | undefined;
  /** Otras filas de la mesa (cualquier cartola): de ahí sale "la otra vez no era venta". */
  historial?: FilaPregunta[];
}

export interface ResultadoPreguntas {
  tarjetas: Tarjeta[];
  /** Filas con juicio pendiente que no entraron a ninguna tarjeta (se miran una por una). */
  sueltas: number;
  apagado: null | "truncada" | "facturas";
}

const MARCAS_EXENTAS_POR_LEY: ReadonlySet<string> = new Set(["p2p_cripto", "forex_divisas"]);
export function esMarcaExentaPorLey(marca: string | null | undefined): boolean {
  return marca != null && MARCAS_EXENTAS_POR_LEY.has(marca);
}

/** ¿Fila con juicio pendiente que se puede preguntar en grupo? */
export function esPreguntable(f: FilaPregunta): boolean {
  if (f.terminada) return false;
  if (f.estado !== "pendiente" && f.estado !== "editado") return false;
  // «¿?» (arriendo/comisión, conflicto regla↔marca): una por una, siempre.
  return destinoPropuesta(f) !== "preguntar";
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? `1 ${uno}` : `${n} ${varios}`;
}

function muestraDe(personas: Persona[]): string {
  const conNombre = personas.filter((p) => p.tipo !== "fila");
  const base = (conNombre.length > 0 ? conNombre : personas).slice().sort((a, b) => b.ids.length - a.ids.length);
  const nombres = [...new Set(base.map((p) => p.etiqueta))];
  if (nombres.length === 0) return "";
  if (nombres.length <= 2) return nombres.join(" y ");
  return `${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más`;
}

function fechaCorta(f: string | null | undefined): string {
  const m = String(f ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(m[3])} ${meses[Number(m[2]) - 1] ?? ""}`.trim();
}

/** Clave de contraparte de una fila (memo por id: el motor la pide varias veces). */
function claveDe(f: FilaPregunta) {
  return claveContraparte(f.descripcion, f.receptor_rut);
}

/** ¿En qué tarjeta cae esta fila? null = suelta (no se reconoce a nadie). */
export function kindDeFila(f: FilaPregunta, razonSocial: string | null | undefined, noVentaAntes: ReadonlySet<string>): KindTarjeta | null {
  if (f.tipo_flujo === "salida") return "salidas";
  if (f.tipo_flujo !== "entrada") return null;
  if (pareceCuentaPropia(f.descripcion, razonSocial)) return "propia";
  // Lo que el sistema clasificó como NO venta (sueldo, honorarios, donación, interés,
  // gasto…) o cuya glosa lo dice: nunca entra a una tarjeta que vende.
  if (detectaNoBoletar(f.descripcion) || destino(f.tipo_propuesto) === "no_es_venta") return "no_venta_probable";
  if (destino(f.tipo_propuesto) === "factura" || pareceEmpresa(f.descripcion)) return "empresas";
  // Solo una venta de boleta puede venderse en grupo.
  if (destinoPropuesta(f) !== "boleta") return null;
  const c = claveDe(f);
  if (!c) return null;
  if (c.tipo === "canal") return "canal";
  if (noVentaAntes.has(c.clave)) return "sigue_igual";
  return "ventas";
}

function textos(kind: KindTarjeta, n: number, personas: Persona[], p2p: boolean): Pick<Tarjeta, "titulo" | "pregunta" | "respuestas" | "ventaPorDefecto"> {
  const np = personas.length;
  switch (kind) {
    case "propia":
      return {
        titulo: `${plural(n, "transferencia", "transferencias")} desde tus propias cuentas`,
        pregunta: "Parece plata tuya que moviste entre cuentas. Márcalas persona por persona.",
        // Sin respuesta de un toque: un apellido parecido no puede esconder ventas.
        respuestas: [{ accion: "algunas", texto: "Revisar persona por persona" }, { accion: "mirar", texto: "Prefiero mirarlas" }],
        ventaPorDefecto: false,
      };
    case "no_venta_probable":
      return {
        titulo: `${plural(n, "movimiento", "movimientos")} que no parecen ventas`,
        pregunta: "Esto normalmente no lleva boleta. ¿Es así?",
        respuestas: [{ accion: "no_venta", texto: "Sí, no son ventas" }, { accion: "mirar", texto: "Prefiero mirarlas" }],
        ventaPorDefecto: false,
      };
    case "sigue_igual":
      return {
        titulo: `${plural(n, "transferencia", "transferencias")} de ${plural(np, "persona", "personas")} que la otra vez no eran venta`,
        pregunta: "La otra vez me dijiste que no eran ventas. ¿Sigue igual?",
        respuestas: [
          { accion: "no_venta", texto: "Sí, sigue igual" },
          { accion: "algunas", texto: "Algunas cambiaron" },
          { accion: "venta", texto: "No, ahora me compraron" },
        ],
        ventaPorDefecto: false,
      };
    case "ventas":
      return p2p
        ? {
            titulo: `${plural(n, "transferencia", "transferencias")} de ${plural(np, "persona", "personas")}`,
            pregunta: "¿Alguna NO fue una venta?",
            // Sin "Ninguna fue venta" (doble negación): lo que no fue venta se marca en la lista.
            respuestas: [
              { accion: "venta", texto: "No, todas fueron ventas" },
              { accion: "algunas", texto: "Sí, algunas" },
            ],
            ventaPorDefecto: true,
          }
        : {
            titulo: `${plural(n, "transferencia", "transferencias")} de ${plural(np, "persona", "personas")}`,
            pregunta: "¿Les vendiste algo a estas personas?",
            respuestas: [
              { accion: "venta", texto: "Sí, me compraron" },
              { accion: "algunas", texto: "Algunas" },
              { accion: "no_venta", texto: "No, es plata de familia o mía" },
            ],
            ventaPorDefecto: true,
          };
    case "canal": {
      const canales = [...new Set(personas.map((p) => p.etiqueta.split(" · ")[0]))];
      const por = canales.length <= 2 ? canales.join(" y ") : `${canales.slice(0, 2).join(", ")} y otras`;
      return {
        titulo: `${plural(n, "pago", "pagos")} que te llegaron por ${por}`,
        pregunta: p2p ? "¿Alguno NO fue una venta?" : "¿Son ventas tuyas?",
        respuestas: p2p
          ? [{ accion: "venta", texto: "No, todos fueron ventas" }, { accion: "algunas", texto: "Sí, algunos" }]
          : [{ accion: "venta", texto: "Sí, son ventas" }, { accion: "algunas", texto: "Algunos" }, { accion: "no_venta", texto: "No son ventas" }],
        ventaPorDefecto: true,
      };
    }
    case "salidas":
      return {
        titulo: `${plural(n, "pago", "pagos")} que hiciste`,
        pregunta: "Lo que tú pagas no lleva boleta tuya. ¿Los dejo sin boleta?",
        respuestas: [{ accion: "no_venta", texto: "Sí, sin boleta" }, { accion: "mirar", texto: "Prefiero mirarlos" }],
        ventaPorDefecto: false,
      };
    case "empresas":
      return {
        titulo: `${plural(n, "pago", "pagos")} de empresas`,
        pregunta: "A una empresa normalmente le haces factura, no boleta. Míralos uno por uno.",
        respuestas: [{ accion: "mirar", texto: "Mirarlos" }],
        ventaPorDefecto: false,
      };
  }
}

/**
 * "No" de un toque en una tarjeta de ventas grande (más de 3 personas) no rechaza todo:
 * abre la lista con todas desmarcadas para que confirme persona por persona.
 */
export const MAX_PERSONAS_NO_DE_UN_TOQUE = 3;
export function noAbreLista(t: Pick<Tarjeta, "kind" | "personas">): boolean {
  return (t.kind === "ventas" || t.kind === "canal") && t.personas.length > MAX_PERSONAS_NO_DE_UN_TOQUE;
}

/** Respuestas que terminan en VENTA (para saber si hace falta la pregunta del IVA). */
export function tarjetaPuedeVender(kind: KindTarjeta): boolean {
  return kind === "ventas" || kind === "canal" || kind === "sigue_igual";
}

export function armarPreguntas(filas: FilaPregunta[], ctx: ContextoPreguntas): ResultadoPreguntas {
  if (ctx.mesa === "factura") return { tarjetas: [], sueltas: 0, apagado: "facturas" };
  if (ctx.truncada) return { tarjetas: [], sueltas: 0, apagado: "truncada" };
  const p2p = esMarcaExentaPorLey(ctx.marca);

  // "La otra vez no era venta": contrapartes con abonos juzgados (rechazado/descartado).
  const noVentaAntes = new Set<string>();
  for (const h of ctx.historial ?? []) {
    if (h.tipo_flujo !== "entrada" || (h.estado !== "rechazado" && h.estado !== "descartado")) continue;
    const c = claveDe(h);
    if (c && c.tipo !== "canal") noVentaAntes.add(c.clave);
  }

  const preguntables = filas.filter(esPreguntable);
  const porKind = new Map<KindTarjeta, FilaPregunta[]>();
  let sueltas = 0;
  for (const f of preguntables) {
    const k = kindDeFila(f, ctx.razonSocial, noVentaAntes);
    if (!k) { sueltas++; continue; }
    porKind.set(k, [...(porKind.get(k) ?? []), f]);
  }

  const tarjetas: Tarjeta[] = [];
  for (const kind of ORDEN_RIESGO) {
    const rows = porKind.get(kind) ?? [];
    if (rows.length === 0) continue;
    if (rows.length < MIN_FILAS_TARJETA) { sueltas += rows.length; continue; }
    const porPersona = new Map<string, Persona>();
    for (const f of rows) {
      const c = claveDe(f);
      // Canal: cada pago es su propio renglón (el comprador no se ve; la plataforma sí).
      const porFila = kind === "canal" || !c;
      const clave = porFila ? `fila:${f.id}` : c!.clave;
      const etiqueta = kind === "canal" && c
        ? [c.etiqueta, fechaCorta(f.fecha)].filter(Boolean).join(" · ")
        : c?.etiqueta ?? (fechaCorta(f.fecha) || "Movimiento");
      const p = porPersona.get(clave) ?? { clave, etiqueta, tipo: porFila ? (kind === "canal" ? "canal" : "fila") : c!.tipo, ids: [], filas: [], total: 0, antesNoVenta: !!c && noVentaAntes.has(c.clave) };
      p.ids.push(f.id);
      p.filas.push({ id: f.id, fecha: fechaCorta(f.fecha), total: Number(f.total ?? 0) });
      p.total += Number(f.total ?? 0);
      porPersona.set(clave, p);
    }
    const personas = [...porPersona.values()].sort((a, b) => b.ids.length - a.ids.length || b.total - a.total || a.etiqueta.localeCompare(b.etiqueta));
    const t = textos(kind, rows.length, personas, p2p);
    // Sin marca P2P/forex, ni el tipo "p2p" que puso el clasificador es ley: se pregunta.
    const ventaSinTipo = rows.some((f) => f.tipo_dte == null);
    tarjetas.push({
      id: kind,
      kind,
      ids: rows.map((f) => f.id),
      personas,
      total: rows.reduce((s, f) => s + Number(f.total ?? 0), 0),
      muestra: kind === "canal" ? "" : muestraDe(personas),
      ...t,
      preguntaIva: tarjetaPuedeVender(kind) && ctx.carril === "auto" && !p2p && ventaSinTipo,
    });
  }
  return { tarjetas, sueltas, apagado: null };
}
