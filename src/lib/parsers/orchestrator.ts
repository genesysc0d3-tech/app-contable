import * as XLSX from "xlsx";
import type {
  AdapterRow,
  CensoCartola,
  DescarteFila,
  AdapterConfig,
  MapaUsado,
  MuestraMovimiento,
  OrchestratorResult,
  ParsedLine,
  PreExtractedMovimiento,
  Row,
  VerificacionCartola,
} from "./types";
import { computeFingerprint, computeFingerprintLegacy, encabezadoNormalizado } from "./fingerprint";
import { leerLibroCartola } from "./libro";
import { detectHeuristic } from "./heuristic";
import { detectByNames, detectPlantillaBoletas } from "./named";
import { esPlantillaFacturas } from "../facturas/plantilla";
import { applyAdapter, linesToPreExtracted, serializeLines } from "./apply";
import { leerCeldaMonto } from "./numeros";
import { buscarSegundaSolucion } from "./unicidad";
import { toleranciaDelSello } from "./saldo-cuadre";
import { validate } from "./validator";
import {
  detalleSubtotales,
  detectarCuenta,
  detectarResumenImpreso,
  formulasSuma,
  juzgarContraBanco,
  movimientosFueraDelBloque,
  posiblesSubtotales,
  saldosDeLaCartola,
  sellarCartola,
  titulosContradicenMapa,
  type FormulaSuma,
  type ResumenImpreso,
} from "./juez-banco";
import { decidirDosOpiniones, estructuraIaActiva, mapaPorIA, type EvaluacionMapa } from "./estructura-ia";
import { cambioDeEncabezado } from "./cambio-formato";
import {
  getAdapterByFingerprint,
  getAdaptersConfirmadosEmpresa,
  promoverMapaGlobalSiHayConsenso,
  saveAdapter,
  incrementAdapterSuccess,
  decrementAdapterConfianza,
  logParserEvent,
} from "./adapter-store";

/**
 * Top-level Excel parser with layered fallback.
 *
 * Layers tried in order:
 *   0. Adapter cache     — match by structural fingerprint, 0 AI calls
 *   2. Heuristic         — universal structural detector (no header names)
 *   3. Named             — header-name matching (Banco de Chile style)
 *   4. Legacy fallback   — generic sheet_to_csv (current behavior)
 *
 * Every layer's output is passed through the validator. If it fails the
 * blocking checks, we drop to the next layer. The legacy fallback always
 * "succeeds" structurally so we never return an error to the caller —
 * worst case the generic TSV is sent to OpenCode just like before this PR.
 *
 * LECTOR CON JUEZ (2026-09-30): pasar el validador ya NO es "OK". Cada cartola
 * sale con un SELLO (`verificacion`): saldo | total_banco | cliente |
 * sin_comprobar, calculado contra el saldo corrido o lo que el banco imprime
 * (juez-banco.ts). Los mapas derivados nacen PROVISORIOS y solo se confirman
 * con prueba (adapter-store.ts). Con LECTOR_ESTRUCTURA_IA=1, DeepSeek (OpenCode
 * Go) da una SEGUNDA OPINIÓN del mapa con la grilla enmascarada; nunca es juez
 * ni lee montos (estructura-ia.ts).
 */
/** Plantilla de facturas en el carril de cartolas: definitivo, sin reintentos. */
export class PlantillaFacturasEnCartolaError extends Error {
  constructor() {
    super("Este archivo es una plantilla de FACTURAS — súbelo desde la mesa Facturas (se cambia tocando el logo de la empresa)");
    this.name = "PlantillaFacturasEnCartolaError";
  }
}

/** Todo lo que el juez necesita de la hoja, calculado una vez. */
interface ContextoHoja {
  sheetName: string;
  rows: Row[];
  formulas: FormulaSuma[];
  filasFormula: Set<number>;
  resumen: ResumenImpreso | null;
  /** Otras hojas del libro con movimientos que esta lectura NO lee. */
  otrasHojas: string[];
  /**
   * Resumen del banco impreso en OTRA hoja del libro ("Resumen": total cargos,
   * total abonos…). Solo sirve para CONTRADECIR (puede ser de otra cuenta o
   * período): nunca sella.
   */
  resumenOtraHoja: ResumenImpreso | null;
  /** Filas (0-based en `rows`) ocultas o con una columna oculta, que traen plata. */
  ocultas: { filas: number[]; columnas: number[] };
}

interface Lectura {
  cfg: AdapterConfig;
  lines: ParsedLine[];
  descartes: DescarteFila[];
  content: string;
  rowsExtracted: number;
  warnings: string[];
  preExtracted: PreExtractedMovimiento[];
  censo: CensoCartola;
  verificacion: VerificacionCartola;
}

export async function parseExcelWithOrchestrator(
  buffer: ArrayBuffer,
  opts?: { documento_id?: string; empresa_id?: string }
): Promise<{ content: string; result: OrchestratorResult }> {
  const start = Date.now();
  // Por qué falló cada capa, para el log y la alarma de capa 4. Antes tryApply
  // botaba los errores del validador y parser_logs decía [] en todas las capas.
  const fallas: string[] = [];
  // cellStyles: sin él SheetJS no lee qué filas/columnas están OCULTAS (filtro).
  const workbook = leerLibroCartola(buffer, { cellStyles: true });
  // Tope de consultas a la IA de estructura por libro (cada una hasta 20 s).
  let consultasIa = 0;

  // Process the first non-empty sheet with a cartola-like structure. If
  // multiple sheets exist and none match, we fall through to serializing all
  // of them via legacy.
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, defval: "" });
    if (!rows.length) continue;

    // Una plantilla de FACTURAS subida al carril de cartolas/boletas no debe
    // procesarse como cartola (nacerían boletas desde filas que son facturas).
    // Error definitivo con mensaje humano — mismo trato que el PDF con clave.
    if (esPlantillaFacturas(rows)) {
      throw new PlantillaFacturasEnCartolaError();
    }

    const fingerprint = computeFingerprint(rows);
    const formulas = formulasSuma(sheet, XLSX.utils.decode_range, XLSX.utils.decode_cell);
    const ctx: ContextoHoja = {
      sheetName,
      rows,
      formulas,
      filasFormula: new Set(formulas.map((f) => f.fila)),
      resumen: detectarResumenImpreso(rows),
      otrasHojas: otrasHojasConDatos(workbook, sheetName),
      ocultas: ocultasConPlata(sheet, rows),
      resumenOtraHoja: resumenDeOtrasHojas(workbook, sheetName),
    };

    const terminar = async (
      lectura: Lectura,
      capa: number,
      adapterId: string | null,
      mapa: MapaUsado,
    ): Promise<{ content: string; result: OrchestratorResult }> => {
      const censo: CensoCartola = {
        ...lectura.censo,
        otras_hojas_con_datos: ctx.otrasHojas,
        mapa: { ...mapa, adapter_id: adapterId },
      };
      const warnings = [...lectura.warnings];
      if (mapa.cambio_formato) warnings.push(`formato_cambio: ${mapa.cambio_formato}`);
      if (mapa.disputa) warnings.push(`dos_opiniones: ${mapa.disputa}`);
      const orchResult: OrchestratorResult = {
        content: lectura.content,
        capa_usada: capa,
        fingerprint,
        adapter_id: adapterId,
        rows_extracted: lectura.rowsExtracted,
        validator_failed_checks: [],
        warnings,
        error: null,
        preExtracted: lectura.preExtracted,
        censo,
        plantilla: lectura.cfg.plantilla === true,
        verificacion: censo.verificacion ?? null,
      };
      await logParserEvent({
        documento_id: opts?.documento_id,
        fingerprint,
        capa_usada: capa,
        capa_exitosa: capa,
        adapter_id: adapterId,
        rows_extracted: lectura.rowsExtracted,
        validator_failed_checks: [],
        // El sello queda en el log: "verificacion:saldo", "verificacion:sin_comprobar".
        warnings: [...warnings, `verificacion:${censo.verificacion?.tipo ?? "sin_comprobar"}`],
        duration_ms: Date.now() - start,
      });
      return { content: lectura.content, result: orchResult };
    };

    // Layer 1.5: FIRMA de la plantilla massDTE — antes del CACHE y de la
    // heurística: un adapter heurístico cacheado para este fingerprint
    // también le ganaba y perdía el flag (e2e 2026-09-02).
    // Es nuestro propio archivo (headers exactos de /api/generar-template);
    // si calza, gana sin competir: la heurística podía capturarla como
    // transactions_log genérico y perder el flag plantilla (e2e 2026-09-02).
    const plantillaCfg = detectPlantillaBoletas(rows);
    if (plantillaCfg) {
      const lectura = leer(ctx, plantillaCfg, fallas, "plantilla");
      if (lectura) {
        // Nuestra plantilla la llena el cliente: se lee tal cual, no hay nada
        // que "adivinar" (sello cliente, no un OK implícito del validador)…
        // salvo que algo la CONTRADIGA (filas ocultas, otra hoja, plata sin
        // leer) o que una fila pueda ser un subtotal y no una venta (un solo
        // rol por celda; batería de sellos falsos 2026-09-30: 7 plantillas con
        // "Total del día" salían selladas con las ventas duplicadas).
        const dudosas = posiblesSubtotales(lectura.lines);
        if (lectura.verificacion.alerta) {
          // se queda con la alerta de leer()
        } else if (dudosas.length) {
          lectura.verificacion = { tipo: "sin_comprobar", alerta: true, detalle: detalleSubtotales(dudosas) };
        } else {
          lectura.verificacion = { tipo: "cliente", detalle: "Plantilla massDTE llenada por el cliente: se lee tal cual" };
        }
        lectura.censo.verificacion = lectura.verificacion;
        const adapterId = await saveAdapter({
          fingerprint,
          source: "named",
          nombre: `Plantilla massDTE (${sheetName})`,
          config: plantillaCfg,
          empresaId: null, // nuestra propia plantilla: global
          confirmadoPor: "plantilla",
        });
        return terminar(lectura, 3, adapterId, { adapter_id: adapterId, estado: "confirmado", nuevo: false });
      }
    }

    // Layer 0: adapter cache (aislado por empresa: no aplica el manual de otro tenant)
    let cached =
      (await getAdapterByFingerprint(fingerprint, opts?.empresa_id)) ??
      (await adaptadorManualConHuellaLegacy(rows, fingerprint, opts?.empresa_id));
    // Títulos de ESTA hoja al revés del mapa (vuelta 2, N1): un global no se
    // aplica (se re-deriva); uno propio se lee pero con alerta.
    let titulosAlReves = false;
    if (cached && titulosContradicenMapa(rows, cached.config)) {
      fallas.push(`cache[${sheetName}]: los títulos de la hoja contradicen la dirección del mapa guardado`);
      if (!cached.creado_por_empresa_id) cached = null;
      else titulosAlReves = true;
    }
    if (cached) {
      const lectura = leer(ctx, cached.config, fallas, "cache");
      if (lectura && titulosAlReves) {
        lectura.verificacion = { tipo: "sin_comprobar", alerta: true, detalle: "Los títulos de la hoja dicen lo contrario del mapa de columnas guardado (cargo↔abono): revisa las columnas" };
        lectura.censo.verificacion = lectura.verificacion;
      }
      if (lectura) {
        // El reuso cuenta; la confianza sube y el mapa se confirma SOLO con prueba
        // (sello estricto). Confirma el mapa de ESTA empresa; volverlo global
        // exige consenso de 2+ empresas (promoverMapaGlobalSiHayConsenso).
        await incrementAdapterSuccess(cached.id, { prueba: lectura.verificacion.tipo });
        const conPrueba = ["saldo", "total_banco"].includes(lectura.verificacion.tipo);
        if (conPrueba && cached.creado_por_empresa_id) await promoverMapaGlobalSiHayConsenso(fingerprint, cached.config);
        const estado = cached.estado === "confirmado" || conPrueba ? "confirmado" : "provisorio";
        // Un GLOBAL aplicado sin prueba en esta lectura es nuevo PARA ESTA
        // empresa: se le pide mirar (vuelta 2, N1).
        const nuevoParaEmpresa = !cached.creado_por_empresa_id && !conPrueba;
        return terminar(lectura, 0, cached.id, { adapter_id: cached.id, estado, nuevo: nuevoParaEmpresa });
      } else {
        await decrementAdapterConfianza(
          cached.id,
          "Layer 0 validation failed — config may be stale"
        );
      }
    }

    // Formato nuevo para esta huella: ¿se parece a uno CONFIRMADO de la empresa?
    // Entonces el banco cambió algo y se dice qué ("esperaba X, llegó Y") en vez
    // de re-adivinar callado (docs/investigacion-lectores-multibanco §2.1 Fineco).
    const cambio = cached ? null : await detectarCambioDeFormato(rows, opts?.empresa_id);

    // Layers 2/3: heurística y, si no pasa, nombres. Es la opinión del LECTOR.
    const heuristicCfg = detectHeuristic(rows);
    if (!heuristicCfg) fallas.push(`heuristica[${sheetName}]: no reconoció la estructura`);
    let lector: { lectura: Lectura; capa: 2 | 3; source: "heuristic" | "named" } | null = null;
    if (heuristicCfg) {
      const l = leer(ctx, heuristicCfg, fallas, "heuristica");
      if (l) lector = { lectura: l, capa: 2, source: "heuristic" };
    }
    if (!lector) {
      const namedCfg = detectByNames(rows);
      if (!namedCfg) fallas.push(`nombres[${sheetName}]: no reconoció los títulos`);
      if (namedCfg) {
        const l = leer(ctx, namedCfg, fallas, "nombres");
        if (l) lector = { lectura: l, capa: 3, source: "named" };
      }
    }

    // SEGUNDA OPINIÓN de estructura (DeepSeek por OpenCode Go), solo con el flag
    // y SOLO si el lector no tiene prueba (adversarial-1 falla 9: con sello de
    // saldo o total del banco no aporta nada y cuesta ~4,5 s, con 9% de timeouts
    // de 20 s). A lo más 2 consultas por libro.
    let elegido: { lectura: Lectura; capa: number; source: AdapterRow["source"] } | null = lector;
    let disputa: string | null = null;
    const lectorConPrueba = !!lector && (lector.lectura.verificacion.tipo === "saldo" || lector.lectura.verificacion.tipo === "total_banco");
    if (estructuraIaActiva() && !lectorConPrueba && consultasIa < 2) {
      consultasIa++;
      const ia = await mapaPorIA(rows);
      if (ia.error) fallas.push(`estructura_ia[${sheetName}]: ${ia.error}`);
      const lecturaIa = ia.cfg ? leer(ctx, ia.cfg, fallas, "estructura_ia") : null;
      const decision = decidirDosOpiniones(evaluacion(lector?.lectura ?? null), evaluacion(lecturaIa));
      disputa = decision.disputa;
      if (decision.elegido === "ia" && lecturaIa) elegido = { lectura: lecturaIa, capa: 2, source: "ia_estructura" };
      else if (decision.elegido === "lector") elegido = lector;
      else elegido = null;
    }

    if (elegido) {
      const lectura = elegido.lectura;
      // Una disputa o un cambio de formato sin prueba no se sella como probado.
      if (disputa) {
        lectura.verificacion = { tipo: "sin_comprobar", alerta: true, detalle: disputa };
        lectura.censo.verificacion = lectura.verificacion;
      } else if (cambio && lectura.verificacion.tipo === "sin_comprobar") {
        lectura.verificacion = { tipo: "sin_comprobar", alerta: true, detalle: `${cambio}. ${lectura.verificacion.detalle}` };
        lectura.censo.verificacion = lectura.verificacion;
      }
      const titulos = encabezadoNormalizado(rows) ?? undefined;
      const adapterId = await guardarFormatoDerivado({
        fingerprint,
        source: elegido.source,
        nombre: `${elegido.source === "heuristic" ? "Heurística" : elegido.source === "named" ? "Nombres" : "Estructura IA"} (${sheetName})`,
        config: {
          ...lectura.cfg,
          ...(titulos ? { titulos } : {}),
          // Cuenta bancaria de origen (huella, no el número): el consenso global exige cuentas distintas.
          ...(lectura.censo.cuenta?.huella ? { cuenta_huella: lectura.censo.cuenta.huella } : {}),
        },
      }, lectura.verificacion, opts);
      const confirmado = lectura.verificacion.tipo === "saldo" || lectura.verificacion.tipo === "total_banco";
      return terminar(lectura, elegido.capa, adapterId, {
        adapter_id: adapterId,
        estado: confirmado ? "confirmado" : "provisorio",
        nuevo: true,
        cambio_formato: cambio,
        disputa,
      });
    }
    // Fall through to layer 4 for this workbook
  }

  // Layer 4: legacy fallback — generic sheet_to_csv across all sheets
  const content = legacyFallback(workbook);
  const fingerprint = "legacy"; // no meaningful fingerprint for legacy
  await logParserEvent({
    documento_id: opts?.documento_id,
    fingerprint,
    capa_usada: 4,
    capa_exitosa: 4,
    adapter_id: null,
    rows_extracted: 0,
    validator_failed_checks: fallas.slice(0, 20),
    warnings: ["fell_back_to_legacy_sheet_to_csv"],
    duration_ms: Date.now() - start,
  });
  // ALARMA (2026-09-26): una planilla que ningún lector determinístico entendió
  // se va entera a la IA como texto. Antes pasaba en silencio (BICE caía acá
  // "a veces" y nadie se enteraba). Sin contenido del archivo: solo hojas y
  // por qué falló cada capa.
  await alarmaCapa4({
    empresaId: opts?.empresa_id,
    documentoId: opts?.documento_id,
    hojas: workbook.SheetNames.length,
    fallas,
  });
  return {
    content,
    result: {
      content,
      capa_usada: 4,
      fingerprint,
      adapter_id: null,
      rows_extracted: 0,
      validator_failed_checks: [],
      warnings: ["fell_back_to_legacy_sheet_to_csv"],
      error: null,
      plantilla: false,
      preExtracted: null,
      verificacion: null,
    },
  };
}

/** Lo que la política de dos opiniones necesita saber de una lectura. */
function evaluacion(l: Lectura | null): EvaluacionMapa | null {
  if (!l) return null;
  return {
    valido: true,
    firma: l.lines.map((x) => `${x.fecha}|${x.monto}|${x.tipo}`).sort().join(","),
    sello: l.verificacion.tipo,
    perdidas: l.descartes.filter((d) => !d.legitimo).length,
  };
}

/**
 * Los adaptadores MANUALES (el cliente mapeó columnas a mano) se guardaron con
 * la huella vieja por tipo de celda. Si la huella por encabezado no encuentra
 * nada, se busca con la vieja — pero solo se acepta un manual: los heurísticos
 * viejos son justamente los que se re-derivan con el código nuevo.
 */
async function adaptadorManualConHuellaLegacy(
  rows: Row[],
  fingerprint: string,
  empresaId: string | undefined,
) {
  const legacy = computeFingerprintLegacy(rows);
  if (legacy === fingerprint) return null;
  const row = await getAdapterByFingerprint(legacy, empresaId);
  return row?.source === "manual" ? row : null;
}

/** "esperaba encabezado X, llegó Y" si la huella nueva se parece a un mapa confirmado. */
async function detectarCambioDeFormato(rows: Row[], empresaId: string | undefined): Promise<string | null> {
  const llegado = encabezadoNormalizado(rows);
  if (!llegado || !empresaId) return null;
  const confirmados = await getAdaptersConfirmadosEmpresa(empresaId);
  return cambioDeEncabezado(
    confirmados.map((a) => a.config?.titulos).filter((t): t is string[] => Array.isArray(t)),
    llegado,
  );
}

/** ¿La celda trae plata? (número ≠ 0 que no es fecha, o texto que es un monto ≠ 0). */
function celdaConPlata(v: unknown): boolean {
  if (v == null || v === "" || v instanceof Date) return false;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  const l = leerCeldaMonto(v);
  return !!l && (l.chilean ?? l.generic ?? 0) !== 0;
}

function filasConPlataEn(rows: Row[], columnas: number[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => { if (columnas.some((c) => celdaConPlata(r?.[c]))) out.push(i); });
  return out;
}

/**
 * Filas y columnas OCULTAS de la hoja (`!rows`/`!cols` hidden; SheetJS solo las
 * lee con cellStyles) que traen plata. Índices 0-based de `rows`.
 */
export function ocultasConPlata(sheet: XLSX.WorkSheet | undefined, rows: Row[]): { filas: number[]; columnas: number[] } {
  if (!sheet || !sheet["!ref"]) return { filas: [], columnas: [] };
  const origen = XLSX.utils.decode_range(sheet["!ref"]).s;
  const filas: number[] = [];
  (sheet["!rows"] ?? []).forEach((p, abs) => {
    const i = abs - origen.r;
    if (p?.hidden && i >= 0 && (rows[i] ?? []).some(celdaConPlata)) filas.push(i);
  });
  const columnas: number[] = [];
  (sheet["!cols"] ?? []).forEach((p, abs) => {
    const c = abs - origen.c;
    if (p?.hidden && c >= 0 && rows.some((r) => celdaConPlata(r?.[c]))) columnas.push(c);
  });
  return { filas, columnas };
}

/** El primer resumen impreso (totales / saldos con etiqueta) de las OTRAS hojas del libro. */
export function resumenDeOtrasHojas(workbook: XLSX.WorkBook, leida: string): ResumenImpreso | null {
  for (const name of workbook.SheetNames) {
    if (name === leida) continue;
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], { header: 1, defval: "" });
    const r = detectarResumenImpreso(rows);
    if (r && (r.totalCargos != null || r.totalAbonos != null || r.saldoFinal != null)) return r;
  }
  return null;
}

const FECHA_TXT_RE = /^\s*\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?\s*$|^\s*\d{4}-\d{2}-\d{2}/;

/**
 * Hojas del libro (aparte de la leída) que parecen traer movimientos: ≥3 filas
 * con una fecha y un monto. El orquestador solo lee la primera hoja que calza;
 * un libro con una hoja por mes perdía las demás sin aviso.
 */
export function otrasHojasConDatos(workbook: XLSX.WorkBook, leida: string): string[] {
  const out: string[] = [];
  for (const name of workbook.SheetNames) {
    if (name === leida) continue;
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], { header: 1, defval: "" });
    let n = 0;
    for (const r of rows) {
      const cells = r as unknown[];
      const fecha = cells.some((v) => v instanceof Date || (typeof v === "string" && FECHA_TXT_RE.test(v)));
      // El libro se lee con cellDates: las fechas llegan como Date, no como
      // número, así que cualquier número ≠ 0 cuenta como monto (excluir el rango
      // de seriales de Excel dejaba fuera montos comunes como $40.000).
      const monto = cells.some((v) => typeof v === "number" && v !== 0);
      if (fecha && monto && ++n >= 3) { out.push(name); break; }
    }
  }
  return out;
}

/** Hasta 3 movimientos para el "así la leímos": una entrada, una salida y el mayor. */
export function muestraDeLectura(lines: ParsedLine[]): MuestraMovimiento[] {
  const a = (l: ParsedLine): MuestraMovimiento => ({
    excel_row: l.excel_row ?? null,
    fecha: l.fecha,
    descripcion: l.descripcion,
    monto: l.monto,
    tipo_flujo: l.tipo === "ENTRADA" ? "entrada" : "salida",
  });
  const mayor = (xs: ParsedLine[]) => xs.reduce<ParsedLine | null>((m, l) => (!m || l.monto > m.monto ? l : m), null);
  const elegidas: ParsedLine[] = [];
  for (const l of [mayor(lines.filter((x) => x.tipo === "ENTRADA")), mayor(lines.filter((x) => x.tipo === "SALIDA")), mayor(lines), ...lines]) {
    if (l && !elegidas.includes(l)) elegidas.push(l);
    if (elegidas.length === 3) break;
  }
  return elegidas.map(a);
}

/** Aplica un mapa, valida y SELLA. null = no pasó el validador (con el porqué en `fallas`). */
function leer(ctx: ContextoHoja, cfg: AdapterConfig, fallas: string[], capa: string): Lectura | null {
  const { rows, sheetName } = ctx;
  const descartes: DescarteFila[] = [];
  const lines = applyAdapter(rows, cfg, descartes, undefined, { filasFormula: ctx.filasFormula });
  const validation = validate(lines, rows, cfg, descartes);
  if (!validation.ok) {
    fallas.push(`${capa}[${sheetName}]: ${validation.errors.join("; ")}`);
    return null;
  }
  let verificacion = sellarCartola({ rows, cfg, lines, descartes, resumen: ctx.resumen, formulas: ctx.formulas });
  // UNICIDAD (numberOfSolutions === 1): un sello solo vale si ninguna OTRA
  // lectura del mismo archivo también pasa todas las pruebas (unicidad.ts).
  if (verificacion.tipo === "saldo" || verificacion.tipo === "total_banco") {
    const otra = buscarSegundaSolucion({ rows, cfg, lines, resumen: ctx.resumen, formulas: ctx.formulas });
    if (otra) {
      verificacion = {
        tipo: "sin_comprobar",
        alerta: true,
        detalle: `Hay otra forma de leer la cartola que también cuadra (${otra.diferencia}): elige las columnas`,
      };
    }
  }
  // Filas OCULTAS con plata (un AutoFiltro, filas escondidas, una columna
  // oculta): se leen igual (están en el archivo), pero ni el cliente las vio ni
  // se puede saber si son movimientos. Nunca dentro ni fuera en silencio: sin
  // sello y a la vista (batería de sellos falsos 2026-09-30: un filtro que
  // escondía 2 movimientos salía sellado "saldo" en el 100% de los casos).
  const ocultas = [...new Set([...ctx.ocultas.filas, ...(ctx.ocultas.columnas.length ? filasConPlataEn(rows, ctx.ocultas.columnas) : [])])].sort((a, b) => a - b);
  if (ocultas.length) {
    const lista = ocultas.slice(0, 8).map((i) => i + 1).join(", ") + (ocultas.length > 8 ? "…" : "");
    verificacion = {
      tipo: "sin_comprobar",
      alerta: true,
      detalle: `${ocultas.length} fila(s) oculta(s) con plata (filas ${lista}${ctx.ocultas.columnas.length ? `; columna(s) oculta(s) ${ctx.ocultas.columnas.map((c) => XLSX.utils.encode_col(c)).join(", ")}` : ""}): un filtro o filas escondidas. Revisa si son movimientos. ${verificacion.alerta ? verificacion.detalle : ""}`.trim(),
    };
  }
  // Resumen del banco en OTRA hoja que no calza con lo leído → alerta (batería
  // de sellos falsos 2026-09-30: una plantilla con hoja "Resumen" seguía
  // sellada "cliente" aunque le faltara o sobrara una venta).
  if (ctx.resumenOtraHoja && !verificacion.alerta) {
    const j = juzgarContraBanco({ rows, cfg, lines, resumen: ctx.resumenOtraHoja, formulas: [], filasTotales: [], tolerancia: toleranciaDelSello(rows, cfg, lines) });
    if (j.contradice) verificacion = { tipo: "sin_comprobar", alerta: true, detalle: `El resumen de otra hoja del archivo no calza: ${j.contradice}` };
  }
  // Movimientos DEBAJO de la fila de totales del banco (fuera del bloque que el
  // banco declaró): no se sabe si son movimientos de esta cartola. Sin sello.
  const fuera = movimientosFueraDelBloque(lines, descartes, ctx.formulas);
  if (fuera.length && !verificacion.alerta) {
    verificacion = {
      tipo: "sin_comprobar",
      alerta: true,
      detalle: `${fuera.length} movimiento(s) debajo de una fila de totales (filas ${fuera.slice(0, 6).join(", ")}${fuera.length > 6 ? "…" : ""}): ¿son de esta cartola? Revisa cómo la leímos`,
    };
  }
  // Plata que no se leyó gana a cualquier prueba: otra hoja con movimientos que
  // esta lectura no toca impide sellar el LIBRO (adversarial-1 varias_hojas).
  if (ctx.otrasHojas.length && !verificacion.alerta) {
    verificacion = {
      tipo: "sin_comprobar",
      alerta: true,
      detalle: `Otra(s) hoja(s) del archivo traen movimientos que no se leyeron (${ctx.otrasHojas.join(", ")}). ${verificacion.detalle}`.trim(),
    };
  }
  const saldos = saldosDeLaCartola(lines, ctx.resumen);
  return {
    cfg,
    lines,
    descartes,
    content: serializeLines(lines, sheetName),
    rowsExtracted: lines.length,
    warnings: validation.warnings,
    preExtracted: linesToPreExtracted(lines),
    verificacion,
    censo: {
      hoja: sheetName,
      filas_con_monto: lines.length + descartes.length,
      leidas: lines.length,
      descartes,
      otras_hojas_con_datos: [],
      ...(ocultas.length ? { filas_ocultas: ocultas.map((i) => i + 1) } : {}),
      verificacion,
      saldo_inicial: saldos.inicial,
      saldo_final: saldos.final,
      cuenta: detectarCuenta(rows, cfg.skip_rows_before_data),
      muestra: muestraDeLectura(lines),
    },
  };
}

/**
 * FORMATO NUEVO (revisión adversarial 2026-09-26, endurecido el 2026-09-30 dos
 * veces). Un mapa derivado (heurística, nombres o IA de estructura) se guarda
 * SIEMPRE como de la empresa que subió la cartola:
 *   - con prueba ESTRICTA (saldo al peso / total del banco) nace confirmado,
 *     pero solo para ESA empresa;
 *   - sin prueba, provisorio (confianza < manual) con un aviso para revisarlo.
 * Compartirlo con TODAS las empresas (global) exige consenso: 2+ empresas
 * distintas que confirmaron el mismo mapa (adversarial-1 falla 6: un mapa mal
 * sellado nacía global y se contagiaba a otros tenants con la misma huella).
 */
async function guardarFormatoDerivado(
  args: { fingerprint: string; source: AdapterRow["source"]; nombre: string; config: AdapterConfig },
  verificacion: VerificacionCartola,
  opts: { documento_id?: string; empresa_id?: string } | undefined,
): Promise<string | null> {
  const prueba = verificacion.tipo === "saldo" || verificacion.tipo === "total_banco" ? verificacion.tipo : null;
  if (!opts?.empresa_id) return null; // sin dueño no se guarda nada
  const id = await saveAdapter({
    ...args,
    empresaId: opts.empresa_id,
    confirmadoPor: prueba,
  });
  if (prueba) {
    await promoverMapaGlobalSiHayConsenso(args.fingerprint, args.config);
    return id;
  }
  try {
    const { recordOpsEvent } = await import("../ops/events");
    await recordOpsEvent({
      severity: "info",
      source: "upload",
      eventName: "parser_formato_nuevo",
      summary: "Formato de planilla nuevo sin prueba (saldo ni totales del banco): queda PROVISORIO y privado de la empresa",
      empresaId: opts.empresa_id,
      resourceType: "documento_subido",
      resourceId: opts.documento_id ?? null,
      metadata: { fuente: args.source, layout: args.config.layout ?? "two_cols", adapter_id: id, verificacion: verificacion.tipo },
    });
  } catch {
    /* el aviso nunca rompe la subida */
  }
  return id;
}

async function alarmaCapa4(args: {
  empresaId?: string;
  documentoId?: string;
  hojas: number;
  fallas: string[];
}): Promise<void> {
  try {
    const { recordOpsEvent } = await import("../ops/events");
    await recordOpsEvent({
      severity: "warn",
      source: "upload",
      eventName: "parser_cayo_a_ia",
      summary: "Planilla sin lector determinístico: se leyó con IA (revisar el formato)",
      empresaId: args.empresaId ?? null,
      resourceType: "documento_subido",
      resourceId: args.documentoId ?? null,
      metadata: { hojas: args.hojas, fallas: args.fallas.slice(0, 10) },
    });
  } catch {
    /* la alarma nunca rompe la subida */
  }
}

function legacyFallback(workbook: XLSX.WorkBook): string {
  const out: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false });
    if (csv.trim()) {
      out.push(`--- Hoja: ${sheetName} ---`);
      out.push(csv);
    }
  }
  return out.join("\n");
}
