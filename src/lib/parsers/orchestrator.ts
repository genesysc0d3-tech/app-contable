import * as XLSX from "xlsx";
import type {
  AdapterRow,
  CensoCartola,
  DescarteFila,
  AdapterConfig,
  MapaUsado,
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
import { applyAdapter, inferirRangoFechas, linesToPreExtracted, serializeLines } from "./apply";
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
import { normalizarTitulo } from "./encabezados";
import { claveDeMapa } from "./mapa-clave";
import { detectarFormatoConocido } from "./formatos-conocidos";
import {
  getAdapterByFingerprint,
  getAdaptersConfirmadosEmpresa,
  promoverMapaGlobalSiHayConsenso,
  saveAdapter,
  reusarAdapterPropio,
  adapterPropioMismoMapa,
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
  /**
   * La grilla viene de un PDF SIN marca propia de banco (ni formato conocido, ni
   * N° de cuenta corriente/vista/RUT, ni título de cartola, ni nombre del banco
   * en el encabezado): un estado de cuenta de proveedor también cuadra por
   * saldo. Se lee, pero NUNCA se sella (queda provisoria → popup/revisión).
   */
  pdfSinMarcaBanco?: boolean;
  /** Las otras hojas del libro (primeras filas), para formatos con resumen en otra hoja. */
  hojas: { nombre: string; rows: Row[] }[];
  /** Encabezado del período tomado de otra hoja del MISMO export (solo formatos conocidos que lo declaran). */
  filasPeriodo: Row[];
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
  /**
   * origen "pdf": la grilla viene de un PDF (pdf-grilla.ts). Un PDF NUNCA
   * persiste un formato aprendido ni mueve la confianza de uno guardado, salvo
   * que la lectura quede SELLADA por el banco (saldo/total).
   */
  opts?: {
    documento_id?: string; empresa_id?: string; origen?: "pdf";
    /** PDF sin marca PROPIA de banco (pdf-router.ts `marca_banco` null): se lee, NUNCA se sella. */
    pdf_sin_marca_banco?: boolean;
  }
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
    const ctx: ContextoHoja = { ...contextoDeHoja(workbook, sheetName, rows), pdfSinMarcaBanco: opts?.origen === "pdf" && !!opts.pdf_sin_marca_banco };

    const terminar = async (
      lectura: Lectura,
      capa: number,
      adapterId: string | null,
      mapa: MapaUsado,
    ): Promise<{ content: string; result: OrchestratorResult }> => {
      // Defensa en profundidad: ninguna rama sella un PDF sin marca de banco.
      if (ctx.pdfSinMarcaBanco && esSelloDelBanco(lectura.verificacion)) {
        lectura.verificacion = { ...SIN_MARCA_DE_BANCO, ...(lectura.verificacion.contradice ? { contradice: lectura.verificacion.contradice } : {}) };
        lectura.censo.verificacion = lectura.verificacion;
      }
      const { titulos: _t, revision_cliente: _r, cuenta_huella: _c, ...mapaUsado } = lectura.cfg;
      const censo: CensoCartola = {
        ...lectura.censo,
        otras_hojas_con_datos: ctx.otrasHojas,
        mapa: { ...mapa, adapter_id: adapterId, clave: claveDeMapa(lectura.cfg), config: mapaUsado as AdapterConfig },
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
        return terminar(lectura, 3, adapterId, { adapter_id: adapterId, estado: "confirmado", nuevo: false, confirmado_por: "plantilla" });
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
    // Layer 1: FORMATO CONOCIDO (formatos-conocidos.ts): huella completa →
    // mapa registrado, sin adivinar. El juez sigue mandando: sin prueba de
    // saldo/total no hay sello. Si la EMPRESA ya guardó su propio mapa para esta
    // huella (corrigió columnas en el popup), manda el suyo.
    // Un mapa PROPIO ya confirmado (por el cliente, a mano, por Check, por saldo o
    // total del banco, por consenso) le gana al conocido: la empresa ya lo
    // validó y sigue por la caché (adapter_id para Check). Un propio provisorio
    // (una adivinanza vieja) no.
    const mapaDeLaEmpresa = !!cached?.creado_por_empresa_id
      && (cached.estado === "confirmado" || cached.source === "manual" || cached.confirmado_por === "cliente" || cached.confirmado_por === "manual");
    // Formato con su resumen en OTRA hoja del mismo export (BancoEstado
    // "Resumen"): de ahí el año y el resumen del banco que juzga la lectura —
    // también cuando la lee el mapa propio de la caché.
    const { ctx: ctxConocido, detectado } = contextoConPeriodo(ctx, rows);
    const conocido = mapaDeLaEmpresa ? null : detectado;
    if (conocido) {
      const lectura = leer(ctxConocido, conocido.cfg, fallas, `conocido:${conocido.formato.id}`);
      if (lectura) {
        lectura.warnings.push(`formato_conocido: ${conocido.formato.id}`);
        // Las COLUMNAS se saben; que ESTA cartola esté bien leída, no. Sin prueba
        // del banco (saldo/total) se pide mirar igual que un formato nuevo: si
        // no, una lectura mala sin alerta (p. ej. subtotales del día leídos como
        // movimientos en un export sin saldo) pasaría callada (corpus 2026-10-02).
        const probada = lectura.verificacion.tipo === "saldo" || lectura.verificacion.tipo === "total_banco";
        // Se guarda como el mapa de la empresa (provisorio sin prueba, confirmado
        // con ella), igual que un formato derivado: así Check y el popup tienen
        // un adapter_id que confirmar y la próxima vez manda la caché confirmada.
        const titulos = encabezadoNormalizado(rows) ?? undefined;
        const adapterId = await guardarFormatoDerivado({
          fingerprint,
          source: "named",
          nombre: `Formato conocido: ${conocido.formato.nombre} (${sheetName})`,
          config: { ...conocido.cfg, ...(titulos ? { titulos } : {}), ...(lectura.censo.cuenta?.huella ? { cuenta_huella: lectura.censo.cuenta.huella } : {}) },
        }, lectura.verificacion, opts);
        return terminar(lectura, 1, adapterId, {
          adapter_id: adapterId,
          estado: probada ? "confirmado" : "provisorio",
          nuevo: !probada,
          confirmado_por: probada ? lectura.verificacion.tipo : null,
          formato_conocido: conocido.formato.id,
        });
      }
    }
    if (cached) {
      const delCliente = !!cached.creado_por_empresa_id && cached.estado === "confirmado" && cached.confirmado_por === "cliente";
      const lectura = leer(ctxConocido, cached.config, fallas, "cache", { saldoLoJuzgaElJuez: delCliente });
      if (lectura && titulosAlReves) {
        lectura.verificacion = { tipo: "sin_comprobar", alerta: true, detalle: "Los títulos de la hoja dicen lo contrario del mapa de columnas guardado (cargo↔abono): revisa las columnas", ...(lectura.verificacion.contradice ? { contradice: lectura.verificacion.contradice } : {}) };
        lectura.censo.verificacion = lectura.verificacion;
      }
      // "Listo" del popup "Revisa las columnas" sobre ESTE documento: si el
      // reproceso lee exactamente lo que el cliente vio (misma firma) y el banco
      // no lo contradice, la cartola queda confirmada por el cliente. Solo su
      // propio mapa; una prueba objetiva (saldo/total) no se rebaja.
      const revision = cached.config.revision_cliente;
      // "Solo abonos": el saldo no cierra justo porque faltan los cargos.
      const soloAbonosComoDijo = !!revision?.solo_abonos && lectura?.verificacion.filtrada === "abonos";
      const revisadaPorCliente = !!lectura && !!revision && !!cached.creado_por_empresa_id
        && !!opts?.documento_id && revision.documento_id === opts.documento_id
        && revision.firma === firmaDeLineas(lectura.lines)
        && (!lectura.verificacion.contradice || soloAbonosComoDijo)
        && lectura.verificacion.tipo !== "saldo" && lectura.verificacion.tipo !== "total_banco";
      if (lectura && revisadaPorCliente) {
        lectura.verificacion = {
          tipo: "cliente",
          detalle: revision.solo_abonos
            ? "Revisaste las columnas y confirmaste que tu cartola trae solo abonos"
            : "Revisaste las columnas de esta cartola y dijiste que están bien",
        };
        lectura.censo.verificacion = lectura.verificacion;
      } else if (lectura && soloAbonosComoDijo && cached.creado_por_empresa_id) {
        // Otra cartola del formato que el cliente dijo que trae solo abonos: sin
        // sello (nada la prueba), pero tampoco se le vuelve a preguntar.
        lectura.verificacion = { tipo: "sin_comprobar", filtrada: "abonos", detalle: "Trae solo abonos, como dijiste para este formato: el saldo no puede cuadrar" };
        lectura.censo.verificacion = lectura.verificacion;
      }
      if (lectura) {
        // El reuso cuenta; la confianza sube y el mapa se confirma SOLO con prueba
        // (sello estricto). Confirma el mapa de ESTA empresa; volverlo global
        // exige consenso de 2+ empresas (promoverMapaGlobalSiHayConsenso).
        const conPrueba = ["saldo", "total_banco"].includes(lectura.verificacion.tipo);
        if (opts?.origen !== "pdf" || conPrueba) await incrementAdapterSuccess(cached.id, { prueba: lectura.verificacion.tipo });
        if (conPrueba && cached.creado_por_empresa_id) await promoverMapaGlobalSiHayConsenso(fingerprint, cached.config);
        const estado = cached.estado === "confirmado" || conPrueba ? "confirmado" : "provisorio";
        // Un GLOBAL aplicado sin prueba en esta lectura es nuevo PARA ESTA
        // empresa: se le pide mirar (vuelta 2, N1).
        const nuevoParaEmpresa = !cached.creado_por_empresa_id && !conPrueba;
        const confirmadoPor = cached.estado === "confirmado" ? (cached.confirmado_por ?? null) : conPrueba ? lectura.verificacion.tipo : null;
        return terminar(lectura, 0, cached.id, { adapter_id: cached.id, estado, nuevo: nuevoParaEmpresa, confirmado_por: confirmadoPor });
      } else if (opts?.origen !== "pdf") {
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
    } else if (!conPrueba(lector.lectura)) {
      // La heurística leyó SIN prueba. Con pocas filas confunde columnas (corpus
      // PDF 2026-10-02: con 3 movimientos tomó "Saldo" como abono y perdió 2
      // filas "con cargo y abono a la vez"). Si los TÍTULOS leen la misma hoja
      // con prueba del banco (el mismo juez, la misma unicidad), o sin perder
      // filas donde la heurística pierde, ganan los títulos. Nunca al revés: una
      // lectura con prueba no se cambia.
      const namedCfg = detectByNames(rows);
      const l = namedCfg ? leer(ctx, namedCfg, [], "nombres") : null;
      const perdidas = (x: Lectura) => x.descartes.filter((d) => !d.legitimo).length;
      if (l && (conPrueba(l) || (perdidas(lector.lectura) > 0 && perdidas(l) === 0 && !l.verificacion.contradice))) {
        lector = { lectura: l, capa: 3, source: "named" };
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
        lectura.verificacion = { tipo: "sin_comprobar", alerta: true, detalle: disputa, ...(lectura.verificacion.contradice ? { contradice: lectura.verificacion.contradice } : {}) };
        lectura.censo.verificacion = lectura.verificacion;
      } else if (cambio && lectura.verificacion.tipo === "sin_comprobar") {
        lectura.verificacion = { ...lectura.verificacion, alerta: true, detalle: `${cambio}. ${lectura.verificacion.detalle}` };
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
        confirmado_por: confirmado ? lectura.verificacion.tipo : null,
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
  // PDF: la grilla es nuestra; si el lector no la lee, el PDF sigue su flujo de
  // texto (comprobante/IA) y lo cuenta el evento propio "pdf_ruta" (motivo
  // lector_no_la_leyo). Ni parser_logs capa 4 ni la alarma de planilla.
  if (opts?.origen === "pdf") {
    return { content, result: { content, capa_usada: 4, fingerprint, adapter_id: null, rows_extracted: 0, validator_failed_checks: [], warnings: ["pdf_lector_no_la_leyo"], error: null, plantilla: false, preExtracted: null, verificacion: null } };
  }
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

/** Todo lo que el juez necesita de una hoja del libro (una vez por hoja). */
function contextoDeHoja(workbook: XLSX.WorkBook, sheetName: string, rows: Row[]): ContextoHoja {
  const sheet = workbook.Sheets[sheetName];
  const formulas = formulasSuma(sheet, XLSX.utils.decode_range, XLSX.utils.decode_cell);
  return {
    sheetName,
    rows,
    formulas,
    filasFormula: new Set(formulas.map((f) => f.fila)),
    resumen: detectarResumenImpreso(rows),
    otrasHojas: otrasHojasConDatos(workbook, sheetName),
    ocultas: ocultasConPlata(sheet, rows),
    resumenOtraHoja: resumenDeOtrasHojas(workbook, sheetName),
    hojas: workbook.SheetNames.filter((n) => n !== sheetName)
      .map((n) => ({ nombre: n, rows: XLSX.utils.sheet_to_json<Row>(workbook.Sheets[n], { header: 1, defval: "", range: 0 }).slice(0, 60) })),
    filasPeriodo: [],
  };
}

/**
 * Firma de una lectura: cuántos movimientos y cuánto por dirección. El "Listo"
 * del cliente vale para el reproceso solo si se lee exactamente lo mismo.
 */
export function firmaDeLineas(lines: ParsedLine[]): string {
  const suma = (t: ParsedLine["tipo"]) => lines.filter((l) => l.tipo === t).reduce((s, l) => s + l.monto, 0);
  return `${lines.length}|${Math.round(suma("ENTRADA"))}|${Math.round(suma("SALIDA"))}`;
}

/**
 * EL JUEZ con un mapa ELEGIDO (popup "Revisa las columnas"): aplica el mapa a
 * la hoja del libro donde produce movimientos (la misma regla que al guardar)
 * y la sella igual que el orquestador. Solo lectura: no toca la base.
 */
export function juzgarMapaEnLibro(
  workbook: XLSX.WorkBook,
  cfg: AdapterConfig,
): { ok: true; hoja: string; rows: Row[]; lines: ParsedLine[]; descartes: DescarteFila[]; verificacion: VerificacionCartola; otrasHojas: string[] } | { ok: false; error: string } {
  const hojas = workbook.SheetNames
    .map((n) => ({ n, rows: XLSX.utils.sheet_to_json<Row>(workbook.Sheets[n], { header: 1, defval: "" }) }))
    .filter((h) => h.rows.length > 0);
  if (!hojas.length) return { ok: false, error: "El archivo está vacío" };
  const produce = (h: { rows: Row[] }) => {
    try { return applyAdapter(h.rows, cfg).length > 0; } catch { return false; }
  };
  const hoja = hojas.find(produce) ?? hojas[0];
  const fallas: string[] = [];
  // El popup juzga con el MISMO contexto que la cola (período/resumen de la hoja
  // "Resumen" de BancoEstado): si no, pedía confirmar el año actual (vuelta 3).
  const { ctx } = contextoConPeriodo(contextoDeHoja(workbook, hoja.n, hoja.rows), hoja.rows);
  let lectura: Lectura | null = null;
  try {
    lectura = leer(ctx, cfg, fallas, "cliente", { saldoLoJuzgaElJuez: true });
  } catch (e) {
    fallas.push(e instanceof Error ? e.message : String(e));
  }
  if (!lectura) return { ok: false, error: fallas[0]?.replace(/^cliente\[[^\]]*\]:\s*/, "") || "Con estas columnas no se pudo leer la cartola" };
  return {
    ok: true,
    hoja: hoja.n,
    rows: hoja.rows,
    lines: lectura.lines,
    descartes: lectura.descartes,
    verificacion: lectura.verificacion,
    otrasHojas: ctx.otrasHojas,
  };
}

const esSelloDelBanco = (v: VerificacionCartola) => v.tipo === "saldo" || v.tipo === "total_banco";
/** El sello de un PDF sin marca propia de banco (vuelta 6): ninguno. */
const SIN_MARCA_DE_BANCO: VerificacionCartola = {
  tipo: "sin_comprobar",
  alerta: true,
  detalle: "El PDF no dice de qué banco es (ni banco, ni N° de cuenta corriente/vista, ni título de cartola): podría ser el estado de cuenta de un proveedor. Revisa cómo la leímos",
};

/** Aplica un mapa, valida y SELLA. null = no pasó el validador (con el porqué en `fallas`). */
function leer(
  ctx: ContextoHoja,
  cfg: AdapterConfig,
  fallas: string[],
  capa: string,
  /**
   * Columnas que eligió el CLIENTE (popup o su mapa confirmado): el saldo que no
   * cierra no descarta la lectura (check 6 del validador, pensado para elegir
   * entre detectores); lo juzga el juez y queda como contradicción a la vista.
   */
  opts: { saldoLoJuzgaElJuez?: boolean } = {},
): Lectura | null {
  const { rows, sheetName } = ctx;
  const descartes: DescarteFila[] = [];
  const lines = applyAdapter(rows, cfg, descartes, undefined, { filasFormula: ctx.filasFormula, filasPeriodo: ctx.filasPeriodo });
  const validation = validate(lines, rows, cfg, descartes);
  const errores = opts.saldoLoJuzgaElJuez ? validation.errors.filter((e) => !e.startsWith("check_6_saldo")) : validation.errors;
  if (errores.length) {
    fallas.push(`${capa}[${sheetName}]: ${errores.join("; ")}`);
    return null;
  }
  let verificacion = sellarCartola({ rows, cfg, lines, descartes, resumen: ctx.resumen, formulas: ctx.formulas, filasPeriodo: ctx.filasPeriodo });
  // Lo que el BANCO contradice se conserva aunque otra alerta cambie el detalle.
  const contradice = verificacion.contradice;
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
  // Período tomado de OTRA hoja del export (BancoEstado "Resumen", vuelta 3):
  // TODAS las fechas tienen que caer entre Fecha Inicio y Fecha Final, y nada
  // después de la Fecha de Emisión. Si no, el Resumen es de otro período (el
  // año puesto a "dd/mm" sería adivinado y los totales pueden calzar igual).
  if (ctx.filasPeriodo.length) {
    const rango = inferirRangoFechas(rows, cfg, ctx.filasPeriodo);
    const emision = fechaRotulada(ctx.filasPeriodo, /^fecha (de )?emision$/);
    const fueraDelPeriodo = !rango?.explicito
      || lines.some((l) => l.fecha < rango.min || l.fecha > rango.max)
      || (emision != null && (rango.max > emision || lines.some((l) => l.fecha > emision)));
    if (fueraDelPeriodo) {
      verificacion = {
        tipo: "sin_comprobar",
        alerta: true,
        contradice: "banco",
        detalle: "Las fechas de los movimientos no calzan con el período de la hoja Resumen del archivo (Fecha Inicio/Final): revisa el año y las columnas",
      };
    }
  }
  if (ctx.pdfSinMarcaBanco && esSelloDelBanco(verificacion)) verificacion = SIN_MARCA_DE_BANCO;
  if (contradice && !verificacion.contradice) verificacion = { ...verificacion, contradice };
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
  opts: { documento_id?: string; empresa_id?: string; origen?: "pdf" } | undefined,
): Promise<string | null> {
  const prueba = verificacion.tipo === "saldo" || verificacion.tipo === "total_banco" ? verificacion.tipo : null;
  if (!opts?.empresa_id) return null; // sin dueño no se guarda nada
  // Upsert lógico (vueltas 2-3): si la empresa ya tiene una fila para esta huella
  // con EL MISMO mapa, se reusa (repone confianza, cuenta el uso, con prueba la
  // confirma). Con OTRO mapa se inserta aparte: nunca se reescribe el mapa con
  // que se leyeron documentos anteriores.
  let propio: string | null = null;
  try { propio = await adapterPropioMismoMapa(args.fingerprint, opts.empresa_id, args.config); } catch { propio = null; }
  // Un PDF sin sello no enseña formatos ni mueve la confianza: la grilla por
  // posiciones es nuestra reconstrucción, no el archivo del banco.
  if (opts.origen === "pdf" && !prueba) return propio;
  if (propio) {
    await reusarAdapterPropio(propio, { prueba, config: args.config });
    if (prueba) await promoverMapaGlobalSiHayConsenso(args.fingerprint, args.config);
    return propio;
  }
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

/** ¿La lectura trae prueba del banco (saldo corrido o totales impresos)? */
function conPrueba(l: Lectura): boolean {
  return l.verificacion.tipo === "saldo" || l.verificacion.tipo === "total_banco";
}

/** Fecha (ISO) a la derecha de un rótulo ("Fecha Emisión"), o null. */
function fechaRotulada(rows: Row[], rotulo: RegExp): string | null {
  for (const r of rows) {
    const celdas = r ?? [];
    for (let j = 0; j < celdas.length; j++) {
      if (!rotulo.test(normalizarTitulo(celdas[j]))) continue;
      for (const v of celdas.slice(j + 1, j + 6)) {
        if ((v as unknown) instanceof Date) { const d = v as unknown as Date; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
        const m = String(v ?? "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      }
    }
  }
  return null;
}

/**
 * Contexto con el período/resumen de OTRA hoja del mismo export cuando la hoja
 * calza un formato conocido que lo declara (BancoEstado "Resumen"). Lo usan la
 * cola (conocido y caché) y el popup (juzgarMapaEnLibro), para que juzguen igual.
 * El resumen de la otra hoja pasa a ser EL resumen solo si la hoja leída no trae
 * uno propio; si lo trae, la otra hoja sigue como contradictor.
 */
function contextoConPeriodo(ctx: ContextoHoja, rows: Row[]): { ctx: ContextoHoja; detectado: ReturnType<typeof detectarFormatoConocido> } {
  const detectado = detectarFormatoConocido(rows, ctx.hojas);
  if (!detectado?.filasPeriodo.length) return { ctx, detectado };
  const propio = ctx.resumen;
  return {
    detectado,
    ctx: {
      ...ctx,
      filasPeriodo: detectado.filasPeriodo,
      resumen: propio ?? detectarResumenImpreso(detectado.filasPeriodo),
      resumenOtraHoja: propio ? ctx.resumenOtraHoja : null,
    },
  };
}
