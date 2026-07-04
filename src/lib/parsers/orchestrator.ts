import * as XLSX from "xlsx";
import type {
  AdapterConfig,
  OrchestratorResult,
  PreExtractedMovimiento,
  Row,
} from "./types";
import { computeFingerprint } from "./fingerprint";
import { detectHeuristic } from "./heuristic";
import { detectByNames } from "./named";
import { applyAdapter, linesToPreExtracted, serializeLines } from "./apply";
import { validate } from "./validator";
import {
  getAdapterByFingerprint,
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
 * (Layer 1 — Mistral structural analyzer — is intentionally deferred to a
 * follow-up PR.)
 *
 * Every layer's output is passed through the validator. If it fails the
 * blocking checks, we drop to the next layer. The legacy fallback always
 * "succeeds" structurally so we never return an error to the caller —
 * worst case the generic TSV is sent to Mistral just like before this PR.
 */
export async function parseExcelWithOrchestrator(
  buffer: ArrayBuffer,
  opts?: { documento_id?: string }
): Promise<{ content: string; result: OrchestratorResult }> {
  const start = Date.now();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, dateNF: "dd-mm-yyyy" });

  // Process the first non-empty sheet with a cartola-like structure. If
  // multiple sheets exist and none match, we fall through to serializing all
  // of them via legacy.
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, defval: "" });
    if (!rows.length) continue;

    const fingerprint = computeFingerprint(rows);

    // Layer 0: adapter cache
    const cached = await getAdapterByFingerprint(fingerprint);
    if (cached) {
      const result = tryApply(rows, cached.config, sheetName);
      if (result) {
        await incrementAdapterSuccess(cached.id);
        const orchResult: OrchestratorResult = {
          content: result.content,
          capa_usada: 0,
          fingerprint,
          adapter_id: cached.id,
          rows_extracted: result.rowsExtracted,
          validator_failed_checks: [],
          warnings: result.warnings,
          error: null,
          preExtracted: result.preExtracted,
        };
        await logParserEvent({
          documento_id: opts?.documento_id,
          fingerprint,
          capa_usada: 0,
          capa_exitosa: 0,
          adapter_id: cached.id,
          rows_extracted: result.rowsExtracted,
          validator_failed_checks: [],
          warnings: result.warnings,
          duration_ms: Date.now() - start,
        });
        return { content: result.content, result: orchResult };
      } else {
        await decrementAdapterConfianza(
          cached.id,
          "Layer 0 validation failed — config may be stale"
        );
      }
    }

    // Layer 2: heuristic
    const heuristicCfg = detectHeuristic(rows);
    if (heuristicCfg) {
      const result = tryApply(rows, heuristicCfg, sheetName);
      if (result) {
        const adapterId = await saveAdapter({
          fingerprint,
          source: "heuristic",
          nombre: `Heurística (${sheetName})`,
          config: heuristicCfg,
        });
        const orchResult: OrchestratorResult = {
          content: result.content,
          capa_usada: 2,
          fingerprint,
          adapter_id: adapterId,
          rows_extracted: result.rowsExtracted,
          validator_failed_checks: [],
          warnings: result.warnings,
          error: null,
          preExtracted: result.preExtracted,
        };
        await logParserEvent({
          documento_id: opts?.documento_id,
          fingerprint,
          capa_usada: 2,
          capa_exitosa: 2,
          adapter_id: adapterId,
          rows_extracted: result.rowsExtracted,
          validator_failed_checks: [],
          warnings: result.warnings,
          duration_ms: Date.now() - start,
        });
        return { content: result.content, result: orchResult };
      }
    }

    // Layer 3: named
    const namedCfg = detectByNames(rows);
    if (namedCfg) {
      const result = tryApply(rows, namedCfg, sheetName);
      if (result) {
        const adapterId = await saveAdapter({
          fingerprint,
          source: "named",
          nombre: `Nombres (${sheetName})`,
          config: namedCfg,
        });
        const orchResult: OrchestratorResult = {
          content: result.content,
          capa_usada: 3,
          fingerprint,
          adapter_id: adapterId,
          rows_extracted: result.rowsExtracted,
          validator_failed_checks: [],
          warnings: result.warnings,
          error: null,
          preExtracted: result.preExtracted,
        };
        await logParserEvent({
          documento_id: opts?.documento_id,
          fingerprint,
          capa_usada: 3,
          capa_exitosa: 3,
          adapter_id: adapterId,
          rows_extracted: result.rowsExtracted,
          validator_failed_checks: [],
          warnings: result.warnings,
          duration_ms: Date.now() - start,
        });
        return { content: result.content, result: orchResult };
      }
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
    validator_failed_checks: [],
    warnings: ["fell_back_to_legacy_sheet_to_csv"],
    duration_ms: Date.now() - start,
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
      preExtracted: null,
    },
  };
}

function tryApply(
  rows: Row[],
  cfg: AdapterConfig,
  sheetName: string
): {
  content: string;
  rowsExtracted: number;
  warnings: string[];
  preExtracted: PreExtractedMovimiento[];
} | null {
  const lines = applyAdapter(rows, cfg);
  const validation = validate(lines, rows, cfg);
  if (!validation.ok) return null;
  return {
    content: serializeLines(lines, sheetName),
    rowsExtracted: lines.length,
    warnings: validation.warnings,
    preExtracted: linesToPreExtracted(lines),
  };
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
