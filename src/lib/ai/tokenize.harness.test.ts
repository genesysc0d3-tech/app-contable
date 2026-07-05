/**
 * HARNESS de validación de la tokenización contra CARTOLAS REALES (PR 2, "la compuerta").
 *
 * Mide dos cosas sobre santander.xlsx + Cartola N°02 (en la raíz del repo):
 *  A) INVARIANZA DE CLASIFICACIÓN — el clasificador determinista debe dar EXACTAMENTE
 *     lo mismo con y sin tokenización (la tokenización no puede cambiar el resultado).
 *  B) COBERTURA DE PRIVACIDAD — cuánta identidad de tercero (nombre/RUT/cuenta) queda
 *     realmente tapada tras tokenizar las glosas reales.
 *
 * Corre OFFLINE (parse + clasificador determinista + tokenización son puros). La
 * validación con el MODELO vivo (A/B empírico sobre el residuo que va al LLM) es la
 * corrida del fundador con su OPENCODE_GO_API_KEY. Si las cartolas no están en la raíz,
 * el harness se salta (no rompe CI). Escribe un reporte legible a artifacts/.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { parseExcel } from "../parsers";
import { classifyWithRules, type ClasificacionRegla } from "./classifier";
import { createVault, tokenizeForAI } from "./tokenize";
import { getAIProvider } from "./provider";
import { getClassifyOnlySystemPrompt } from "./prompt";
import type { MovimientoExtraido } from "./types";

const CARTOLAS = [
  { nombre: "santander", file: "santander.xlsx" },
  { nombre: "cartola2", file: "Cartola N°02 - 11 2025.xlsx" },
];

const RUT_RE = /\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/;
// "sobra un nombre": tras un keyword de transferencia queda una palabra alfabética
// Capitalizada/MAYÚS de 3+ letras que NO es token, marcador ni palabra genérica.
const TRANSFER_KW = /\b(?:TRANSFER|TRANSF|TRF)\b/i;
const STOPWORDS = new Set([
  "de", "a", "para", "por", "desde", "en", "el", "la", "los", "del", "y",
  "transf", "transfer", "trf", "otro", "banco", "linea", "abono", "cargo", "pago",
  "trans", "cta", "cte", "spa", "sp", "ltda", "eirl", "sa",
]);

function toAB(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// Reglas representativas (sin DB): patrones que la app usa de verdad — cripto,
// forex, y P2P por transferencia. La invarianza debe cumplirse para CUALQUIER
// regla que matchee por forma de la operación (nunca por identidad).
const REGLAS: ClasificacionRegla[] = [
  { id: "r-crypto", empresa_id: null, nombre: "cripto", patron: "\\b(usdt|btc|eth|binance|buda|cripto)\\b", patron_tipo: "regex", tipo_flujo_match: null, tipo_propuesto: "compraventa_crypto", receptor_nombre_default: null, receptor_rut_default: null, confianza: 0.95, prioridad: 60 },
  { id: "r-transf", empresa_id: null, nombre: "transferencia entrada", patron: "transf", patron_tipo: "starts_with", tipo_flujo_match: "entrada", tipo_propuesto: "boleta", receptor_nombre_default: null, receptor_rut_default: null, confianza: 0.8, prioridad: 40 },
  { id: "r-abono", empresa_id: null, nombre: "abono", patron: "abono", patron_tipo: "starts_with", tipo_flujo_match: "entrada", tipo_propuesto: "boleta", receptor_nombre_default: null, receptor_rut_default: null, confianza: 0.7, prioridad: 30 },
];

function nombreSobrante(glosa: string): string | null {
  if (!TRANSFER_KW.test(glosa)) return null;
  const palabras = glosa.split(/\s+/);
  for (const p of palabras) {
    const limpio = p.replace(/[.,]/g, "");
    if (limpio.startsWith("PER_") || limpio === "[NUM]" || limpio.includes("[NUM]")) continue;
    if (limpio.length < 3) continue;
    if (!/^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}$/.test(limpio)) continue; // palabra alfabética Cap/MAYÚS
    if (STOPWORDS.has(limpio.toLowerCase())) continue;
    return limpio; // quedó un nombre-like sin tokenizar
  }
  return null;
}

describe("HARNESS tokenización — cartolas reales", () => {
  const hayAlguna = CARTOLAS.some((c) => existsSync(c.file));
  const maybe = hayAlguna ? it : it.skip;

  maybe("A) invarianza de clasificación + B) cobertura de privacidad", async () => {
    const reporte: Record<string, unknown> = {};
    let invarianzaGlobalOk = true;

    for (const { nombre, file } of CARTOLAS) {
      if (!existsSync(file)) { reporte[nombre] = { ausente: true }; continue; }

      const { preExtracted } = await parseExcel(toAB(file));
      const movs: MovimientoExtraido[] = (preExtracted ?? []).map((m) => ({
        fecha: m.fecha, descripcion: m.descripcion, monto: m.monto, tipo_flujo: m.tipo_flujo, origen: "cartola",
      }));

      const vault = createVault();
      const movsTok: MovimientoExtraido[] = movs.map((m) => ({ ...m, descripcion: tokenizeForAI(m.descripcion, vault) }));

      // A) invarianza: misma clasificación determinista con y sin tokenizar
      const claR = classifyWithRules(movs, REGLAS);
      const claT = classifyWithRules(movsTok, REGLAS);
      const mapR = new Map(claR.clasificados.map((c) => [c.movimiento_index, c.propuesta.tipo_propuesto]));
      const mapT = new Map(claT.clasificados.map((c) => [c.movimiento_index, c.propuesta.tipo_propuesto]));
      const flips: string[] = [];
      for (let i = 0; i < movs.length; i++) {
        const r = mapR.get(i), t = mapT.get(i);
        if (r !== t) flips.push(`[${r ?? "—"} → ${t ?? "—"}]  ${movs[i].descripcion}  →  ${movsTok[i].descripcion}`);
      }
      const invariante = flips.length === 0;
      if (!invariante) invarianzaGlobalOk = false;

      // B) cobertura: RUTs y nombres que sobreviven
      let conRutRaw = 0, rutLeak = 0, conTransfer = 0, nombreLeak = 0;
      const leaks: string[] = [];
      for (let i = 0; i < movs.length; i++) {
        if (RUT_RE.test(movs[i].descripcion)) conRutRaw++;
        if (RUT_RE.test(movsTok[i].descripcion)) rutLeak++;
        if (TRANSFER_KW.test(movs[i].descripcion)) conTransfer++;
        const sobra = nombreSobrante(movsTok[i].descripcion);
        if (sobra) { nombreLeak++; if (leaks.length < 12) leaks.push(`${movs[i].descripcion}  →  ${movsTok[i].descripcion}`); }
      }

      reporte[nombre] = {
        total: movs.length,
        clasificadosDet: claR.clasificados.length,
        alLLM: claR.noClasificados.length,
        invarianzaClasificacion: invariante,
        flips: flips.slice(0, 20),
        privacidad: {
          conRutRaw, rutLeak,
          conTransferKw: conTransfer,
          nombresQueSobran: nombreLeak,
          coberturaNombres: conTransfer ? `${Math.round(100 * (1 - nombreLeak / conTransfer))}%` : "n/a",
        },
        leaksSample: leaks,
        tokenizacionSample: movs.slice(0, 10).map((m, i) => `${m.descripcion}  →  ${movsTok[i].descripcion}`),
      };
    }

    try { mkdirSync("artifacts/runs", { recursive: true }); } catch { /* noop */ }
    writeFileSync("artifacts/runs/tokenize-harness-report.json", JSON.stringify(reporte, null, 2));

    // Gate innegociable de la compuerta: la clasificación NO cambia por tokenizar.
    expect(invarianzaGlobalOk, "la tokenización cambió la clasificación determinista").toBe(true);
  }, 60000);
});

// A/B con el MODELO VIVO: la prueba empírica final. Manda una muestra de glosas con
// contraparte al LLM real, crudo vs tokenizado, y verifica que el tipo_propuesto no
// cambie más allá del ruido propio del modelo (temp 0.1). Gateado por la API key: se
// salta en CI y en cualquier corrida sin OPENCODE_GO_API_KEY.
describe("HARNESS A/B en vivo (modelo real)", () => {
  const hayCartola = CARTOLAS.some((c) => existsSync(c.file));
  const live = Boolean(process.env.OPENCODE_GO_API_KEY) && hayCartola;
  const maybe = live ? it : it.skip;

  const SAMPLE_N = Number(process.env.AB_SAMPLE || 10);
  maybe("el modelo clasifica IGUAL crudo vs tokenizado (dentro del ruido del modelo)", async () => {
    const sample: MovimientoExtraido[] = [];
    for (const { file } of CARTOLAS) {
      if (!existsSync(file) || sample.length >= SAMPLE_N) continue;
      const { preExtracted } = await parseExcel(toAB(file));
      for (const m of preExtracted ?? []) {
        if (sample.length >= SAMPLE_N) break;
        if (TRANSFER_KW.test(m.descripcion)) {
          sample.push({ fecha: m.fecha, descripcion: m.descripcion, monto: m.monto, tipo_flujo: m.tipo_flujo, origen: "cartola" });
        }
      }
    }
    const vault = createVault();
    const sampleTok = sample.map((m) => ({ ...m, descripcion: tokenizeForAI(m.descripcion, vault) }));

    const provider = getAIProvider();
    const sys = getClassifyOnlySystemPrompt();
    const rRaw = await provider.classifyMovimientos!(sample, sys);
    const rTok = await provider.classifyMovimientos!(sampleTok, sys);

    const tipoDe = (ps: { movimiento_index: number; tipo_propuesto: string }[]) =>
      new Map(ps.map((p) => [p.movimiento_index, p.tipo_propuesto]));
    const tR = tipoDe(rRaw.propuestas), tT = tipoDe(rTok.propuestas);

    let difTok = 0;
    const ejemplos: string[] = [];
    for (let i = 0; i < sample.length; i++) {
      if (tR.get(i) !== tT.get(i)) { difTok++; if (ejemplos.length < 15) ejemplos.push(`idx${i}: ${tR.get(i)} → ${tT.get(i)}  «${sample[i].descripcion}»`); }
    }
    // El modelo, en el run tokenizado, JAMÁS debe devolver un nombre real (solo tokens/null).
    const receptorLeaks = rTok.propuestas
      .map((p) => p.receptor_nombre?.trim())
      .filter((n): n is string => Boolean(n) && !/^PER_\d+$/.test(n!));

    const reporte = {
      muestra: sample.length,
      difTipo_crudoVsTokenizado: difTok,
      receptorLeaksEnTokenizado: receptorLeaks.slice(0, 15),
      ejemplosDif: ejemplos,
    };
    try { mkdirSync("artifacts/runs", { recursive: true }); } catch { /* noop */ }
    writeFileSync("artifacts/runs/tokenize-ab-live-report.json", JSON.stringify(reporte, null, 2));

    // PASS: tokenizar no cambia la clasificación del modelo (tolera 1 por el ruido de temp 0.1).
    expect(difTok, `tokenizar cambió ${difTok} clasificaciones del modelo`).toBeLessThanOrEqual(1);
  }, 300000);
});
