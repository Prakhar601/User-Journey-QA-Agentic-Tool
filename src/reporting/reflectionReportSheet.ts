/**
 * reflectionReportSheet.ts — Phase 4 reporting module.
 *
 * Exports four pure worksheet-builder functions consumed by excelReporter.ts.
 * Every function appends a new sheet to an existing XLSX WorkBook object.
 *
 * Strict design invariants:
 *   - No LLM calls.
 *   - No I/O (no file reads/writes).
 *   - Consumes only data already present in ScenarioResult[].
 *   - Reflection is always optional — absent reflection never blocks any sheet.
 *   - All errors are caught locally; a bad row is skipped, never a thrown exception.
 */

import * as XLSX from "xlsx";
import type { ScenarioResult } from "../core/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared styling constants (mirrors excelReporter.ts palette for consistency)
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_BG      = "FF1F3864"; // deep navy — distinct from the existing gray headers
const HEADER_FG      = "FFFFFFFF"; // white text
const BORDER_COLOR   = "FF000000";
const PASS_COLOR     = "FF00B050"; // green
const FAIL_COLOR     = "FFFF4444"; // red
const NEUTRAL_COLOR  = "FF595959"; // dark gray

const THIN_BORDER = {
  top:    { style: "thin" as const, color: { rgb: BORDER_COLOR } },
  bottom: { style: "thin" as const, color: { rgb: BORDER_COLOR } },
  left:   { style: "thin" as const, color: { rgb: BORDER_COLOR } },
  right:  { style: "thin" as const, color: { rgb: BORDER_COLOR } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Low-level cell factories
// ─────────────────────────────────────────────────────────────────────────────

function hdrCell(value: string): XLSX.CellObject {
  return {
    v: value,
    t: "s",
    s: {
      font: { bold: true, color: { rgb: HEADER_FG } },
      fill: { patternType: "solid", fgColor: { rgb: HEADER_BG }, bgColor: { rgb: HEADER_BG } },
      alignment: { horizontal: "center", vertical: "middle", wrapText: true },
      border: THIN_BORDER,
    },
  };
}

function txtCell(
  value: string | undefined,
  opts: { bold?: boolean; color?: string; align?: "left" | "center" | "right" } = {}
): XLSX.CellObject {
  return {
    v: value ?? "",
    t: "s",
    s: {
      font: {
        bold: opts.bold ?? false,
        color: { rgb: opts.color ?? NEUTRAL_COLOR },
      },
      alignment: {
        horizontal: opts.align ?? "left",
        vertical: "middle",
        wrapText: true,
      },
      border: THIN_BORDER,
    },
  };
}

function numCell(value: number | undefined): XLSX.CellObject {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    v: safe,
    t: "n",
    s: {
      alignment: { horizontal: "center", vertical: "middle" },
      border: THIN_BORDER,
    },
  };
}

function pctCell(value: number | undefined): XLSX.CellObject {
  // Stores as a decimal (0.0–1.0) displayed as text "XX.X%"
  const safe = typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
  return txtCell(`${(safe * 100).toFixed(1)}%`, { align: "center" });
}

function boolCell(value: boolean | undefined): XLSX.CellObject {
  const text = value === true ? "Yes" : value === false ? "No" : "";
  const color = value === true ? PASS_COLOR : value === false ? FAIL_COLOR : NEUTRAL_COLOR;
  return txtCell(text, { bold: true, color, align: "center" });
}

function statusCell(pass: boolean): XLSX.CellObject {
  return txtCell(pass ? "PASS" : "FAIL", {
    bold: true,
    color: pass ? PASS_COLOR : FAIL_COLOR,
    align: "center",
  });
}

function labelCell(value: string): XLSX.CellObject {
  return {
    v: value,
    t: "s",
    s: {
      font: { bold: true, color: { rgb: NEUTRAL_COLOR } },
      alignment: { horizontal: "left", vertical: "middle", wrapText: true },
      border: THIN_BORDER,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function autoFit(ws: XLSX.WorkSheet, cap = 80): void {
  if (!ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  const widths: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let max = 10;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const longest = String(cell.v ?? "").split("\n").reduce(
        (m: number, l: string) => Math.max(m, l.length), 0
      );
      if (longest > max) max = longest;
    }
    widths[c] = Math.min(max + 4, cap);
  }
  ws["!cols"] = widths.map((w) => ({ wch: w ?? 12 }));
}

function freezeRow(ws: XLSX.WorkSheet): void {
  (ws as Record<string, unknown>)["!freeze"] = { xSplit: 0, ySplit: 1 };
}

function set(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  cell: XLSX.CellObject
): void {
  ws[XLSX.utils.encode_cell({ r, c })] = cell;
}

function sealRange(
  ws: XLSX.WorkSheet,
  totalDataRows: number,
  totalCols: number
): void {
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(totalDataRows, 0), c: totalCols - 1 },
  });
}

/** Returns ms elapsed as "Xs" or "Xm Ys" or "—" when unavailable. */
function fmtDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Extracts timing fields from the ScenarioResult via duck-type cast. */
function scenarioTiming(result: ScenarioResult): {
  startMs?: number;
  endMs?: number;
  durationMs?: number;
} {
  const any = result as unknown as {
    scenarioStartTimeMs?: number;
    scenarioEndTimeMs?: number;
  };
  const startMs = typeof any.scenarioStartTimeMs === "number" ? any.scenarioStartTimeMs : undefined;
  const endMs   = typeof any.scenarioEndTimeMs   === "number" ? any.scenarioEndTimeMs   : undefined;
  const durationMs =
    startMs !== undefined && endMs !== undefined && endMs >= startMs
      ? endMs - startMs
      : undefined;
  return { startMs, endMs, durationMs };
}

/** Formats an ISO timestamp for display or returns "—". */
function fmtTs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 23);
  } catch {
    return "—";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 5: AI Reflection Report
// ─────────────────────────────────────────────────────────────────────────────

const REFLECTION_HEADERS = [
  "Scenario Name",       // 0
  "Status",              // 1
  "Failure Class",       // 2
  "Confidence",          // 3
  "Summary",             // 4
  "Root Cause",          // 5
  "Suggestions",         // 6
  "Should Retry",        // 7
  "Retry Strategy",      // 8
  "Stop Reason",         // 9
  "Partial Score",       // 10
  "Execution Time",      // 11
];

/**
 * Appends the "AI Reflection Report" worksheet.
 *
 * Each row represents one scenario. Reflection columns are blank when
 * reflection is undefined (never throws, never blocks).
 */
export function buildReflectionReportSheet(
  workbook: XLSX.WorkBook,
  scenarioResults: ScenarioResult[],
  provider: string,
  model: string
): void {
  const ws: XLSX.WorkSheet = {};

  // Header row
  REFLECTION_HEADERS.forEach((h, c) => set(ws, 0, c, hdrCell(h)));

  let rowIdx = 1;
  for (const result of scenarioResults) {
    try {
      const { durationMs } = scenarioTiming(result);

      // Reflection fields (all optional)
      const ref = result.reflection;
      const suggestionsText = ref?.suggestions?.length
        ? ref.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : "";

      set(ws, rowIdx, 0,  txtCell(result.scenarioName));
      set(ws, rowIdx, 1,  statusCell(result.pass));
      set(ws, rowIdx, 2,  txtCell(result.failureClassification?.primaryClass ?? (result.pass ? "—" : "UNKNOWN")));
      set(ws, rowIdx, 3,  pctCell(result.confidence?.score));
      set(ws, rowIdx, 4,  txtCell(ref?.summary));
      set(ws, rowIdx, 5,  txtCell(ref?.rootCause));
      set(ws, rowIdx, 6,  txtCell(suggestionsText));
      set(ws, rowIdx, 7,  boolCell(ref?.shouldRetry));
      set(ws, rowIdx, 8,  txtCell(ref?.retryStrategy ?? (ref?.shouldRetry === false ? "—" : "")));
      set(ws, rowIdx, 9,  txtCell(result.stopReason));
      set(ws, rowIdx, 10, pctCell(result.partialScore));
      set(ws, rowIdx, 11, txtCell(fmtDuration(durationMs)));

      rowIdx++;
    } catch {
      // A single bad row must never abort the sheet
      rowIdx++;
    }
  }

  sealRange(ws, rowIdx - 1, REFLECTION_HEADERS.length);
  autoFit(ws);
  freezeRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "AI Reflection Report");
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 6: Execution Timeline
// ─────────────────────────────────────────────────────────────────────────────

const TIMELINE_HEADERS = [
  "Timestamp",   // 0
  "Scenario",    // 1
  "Stage",       // 2
  "Status",      // 3
  "Duration",    // 4
  "Notes",       // 5
];

interface TimelineEvent {
  tsMs?: number;
  scenario: string;
  stage: string;
  status: "OK" | "FAILED" | "SKIPPED" | "INFO";
  durationMs?: number;
  notes?: string;
}

/**
 * Derives timeline events from a ScenarioResult.
 * Completely deterministic — no LLM calls, no randomness.
 */
function deriveTimeline(result: ScenarioResult): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const { startMs, endMs, durationMs } = scenarioTiming(result);

  // ── Scenario Started
  events.push({
    tsMs: startMs,
    scenario: result.scenarioName,
    stage: "Scenario Started",
    status: "INFO",
    notes: `Scenario: "${result.scenarioName.slice(0, 80)}"`,
  });

  // ── Adaptive Loop Started (inferred from presence of evaluation data)
  if (result.evaluation) {
    events.push({
      tsMs: startMs,
      scenario: result.scenarioName,
      stage: "Adaptive Loop Started",
      status: "INFO",
      notes: `${result.evaluation.totalAssertions} assertion(s) in contract`,
    });
  }

  // ── Assertions Evaluated
  if (result.evaluation) {
    const ev = result.evaluation;
    const isOk = ev.fulfilledCount === ev.totalAssertions || ev.pass;
    events.push({
      tsMs: endMs,
      scenario: result.scenarioName,
      stage: "Assertions Evaluated",
      status: isOk ? "OK" : "FAILED",
      notes: `${ev.fulfilledCount}/${ev.totalAssertions} fulfilled — Score: ${(ev.partialScore * 100).toFixed(1)}%`,
    });
  }

  // ── Failure Classified
  if (result.failureClassification) {
    const fc = result.failureClassification;
    events.push({
      tsMs: endMs,
      scenario: result.scenarioName,
      stage: "Failure Classified",
      status: "OK",
      notes: `${fc.primaryClass} (conf: ${(fc.classificationConfidence * 100).toFixed(0)}%) — ${fc.isRecoverable ? "Recoverable" : "Non-recoverable"}`,
    });
  }

  // ── Confidence Calculated
  if (result.confidence) {
    events.push({
      tsMs: endMs,
      scenario: result.scenarioName,
      stage: "Confidence Calculated",
      status: "OK",
      notes: result.confidence.explanation,
    });
  }

  // ── Reflection Generated
  if (result.reflection !== undefined) {
    const refOk = result.reflection.confidence > 0; // confidence=0 means fallback was used
    events.push({
      tsMs: endMs,
      scenario: result.scenarioName,
      stage: "Reflection Generated",
      status: refOk ? "OK" : "SKIPPED",
      notes: refOk
        ? `Confidence: ${(result.reflection.confidence * 100).toFixed(0)}% — ${result.reflection.summary.slice(0, 100)}`
        : "Fallback report used (model unavailable or invalid response)",
    });
  }

  // ── Scenario Completed
  events.push({
    tsMs: endMs,
    scenario: result.scenarioName,
    stage: "Scenario Completed",
    status: result.pass ? "OK" : "FAILED",
    durationMs,
    notes: `Stop reason: ${result.stopReason ?? "N/A"} — Result: ${result.pass ? "PASS" : "FAIL"}`,
  });

  return events;
}

/** Status label → display color */
function timelineStatusColor(status: TimelineEvent["status"]): string {
  switch (status) {
    case "OK":      return PASS_COLOR;
    case "FAILED":  return FAIL_COLOR;
    case "SKIPPED": return "FFFF8C00"; // amber
    case "INFO":    return "FF1F78B4"; // blue
    default:        return NEUTRAL_COLOR;
  }
}

/**
 * Appends the "Execution Timeline" worksheet.
 * One row per timeline event, all derived deterministically.
 */
export function buildExecutionTimelineSheet(
  workbook: XLSX.WorkBook,
  scenarioResults: ScenarioResult[]
): void {
  const ws: XLSX.WorkSheet = {};

  // Header row
  TIMELINE_HEADERS.forEach((h, c) => set(ws, 0, c, hdrCell(h)));

  let rowIdx = 1;
  for (const result of scenarioResults) {
    try {
      const events = deriveTimeline(result);
      for (const ev of events) {
        set(ws, rowIdx, 0, txtCell(fmtTs(ev.tsMs)));
        set(ws, rowIdx, 1, txtCell(result.scenarioName));
        set(ws, rowIdx, 2, txtCell(ev.stage));
        set(ws, rowIdx, 3, txtCell(ev.status, {
          bold: true,
          color: timelineStatusColor(ev.status),
          align: "center",
        }));
        set(ws, rowIdx, 4, txtCell(fmtDuration(ev.durationMs)));
        set(ws, rowIdx, 5, txtCell(ev.notes));
        rowIdx++;
      }
    } catch {
      rowIdx++;
    }
  }

  sealRange(ws, rowIdx - 1, TIMELINE_HEADERS.length);
  autoFit(ws);
  freezeRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "Execution Timeline");
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 7: Run Summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appends the "Run Summary" worksheet.
 * Key–value layout summarising the entire run.
 * Reads project version from package.json if available.
 */
export function buildRunSummarySheet(
  workbook: XLSX.WorkBook,
  scenarioResults: ScenarioResult[],
  provider: string,
  model: string,
  runTimestamp: string,
  projectVersion?: string
): void {
  const ws: XLSX.WorkSheet = {};

  // Compute aggregates
  const total   = scenarioResults.length;
  const passed  = scenarioResults.filter((r) => r.pass).length;
  const failed  = total - passed;

  const confidenceValues = scenarioResults
    .map((r) => r.confidence?.score)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const avgConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
    : undefined;

  // Reflection success = reflection is present AND confidence > 0 (not fallback)
  const reflectionAttempted = scenarioResults.filter((r) => r.reflection !== undefined).length;
  const reflectionSucceeded = scenarioResults.filter(
    (r) => r.reflection !== undefined && r.reflection.confidence > 0
  ).length;
  const reflectionSuccessRate = reflectionAttempted > 0
    ? `${reflectionSucceeded}/${reflectionAttempted} (${Math.round((reflectionSucceeded / reflectionAttempted) * 100)}%)`
    : "N/A (no reflections)";

  // Execution time: sum duration of all scenarios that have timing
  const durations = scenarioResults.map((r) => scenarioTiming(r).durationMs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const avgExecTime = durations.length > 0
    ? fmtDuration(durations.reduce((a, b) => a + b, 0) / durations.length)
    : "—";

  const version = projectVersion ?? "0.1.0";

  // Structured KV rows
  const rows: Array<[string, string | number]> = [
    ["Run Timestamp",           runTimestamp],
    ["Provider",                provider],
    ["Model",                   model],
    ["Project Version",         version],
    ["Number of Scenarios",     total],
    ["Passed",                  passed],
    ["Failed",                  failed],
    ["Pass Rate",               total > 0 ? `${Math.round((passed / total) * 100)}%` : "N/A"],
    ["Average Confidence",      avgConfidence !== undefined ? `${(avgConfidence * 100).toFixed(1)}%` : "N/A"],
    ["Reflection Success Rate", reflectionSuccessRate],
    ["Average Execution Time",  avgExecTime],
  ];

  // Header row
  set(ws, 0, 0, hdrCell("Metric"));
  set(ws, 0, 1, hdrCell("Value"));

  rows.forEach(([label, value], i) => {
    const r = i + 1;
    set(ws, r, 0, labelCell(String(label)));
    set(ws, r, 1, typeof value === "number"
      ? numCell(value)
      : txtCell(String(value), { align: "center" }));
  });

  sealRange(ws, rows.length, 2);
  autoFit(ws);
  freezeRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "Run Summary");
}

// ─────────────────────────────────────────────────────────────────────────────
// Additive columns injected into the existing Test Results sheet
// ─────────────────────────────────────────────────────────────────────────────

const ADDITIVE_HEADERS = [
  "Confidence",        // appended col N
  "Failure Class",     // appended col N+1
  "Reflection Summary",// appended col N+2
  "Provider",          // appended col N+3
  "Model",             // appended col N+4
];

/**
 * Injects Phase 4 intelligence columns into an existing Test Results worksheet
 * starting at `startCol` (the next free column index after existing headers).
 *
 * Called by excelReporter.ts after it finishes building its existing columns.
 * MUST NOT change any existing cell — only appends new columns to the right.
 */
export function injectIntelligenceColumns(
  ws: XLSX.WorkSheet,
  scenarioResults: ScenarioResult[],
  startCol: number,
  provider: string,
  model: string
): void {
  // Write additive headers
  ADDITIVE_HEADERS.forEach((h, i) => set(ws, 0, startCol + i, hdrCell(h)));

  scenarioResults.forEach((result, dataRowIdx) => {
    try {
      const r = dataRowIdx + 1; // row 0 = header
      const ref = result.reflection;

      set(ws, r, startCol + 0, pctCell(result.confidence?.score));
      set(ws, r, startCol + 1, txtCell(
        result.failureClassification?.primaryClass ?? (result.pass ? "—" : "UNKNOWN"),
        { align: "center" }
      ));
      set(ws, r, startCol + 2, txtCell(ref?.summary ?? ""));
      set(ws, r, startCol + 3, txtCell(provider, { align: "center" }));
      set(ws, r, startCol + 4, txtCell(model, { align: "center" }));
    } catch {
      // Never abort for a bad row
    }
  });

  // Extend the sheet's declared range to include the new columns
  if (ws["!ref"]) {
    try {
      const range = XLSX.utils.decode_range(ws["!ref"] as string);
      const newEndCol = startCol + ADDITIVE_HEADERS.length - 1;
      if (newEndCol > range.e.c) {
        range.e.c = newEndCol;
        ws["!ref"] = XLSX.utils.encode_range(range);
      }
    } catch {
      // Non-fatal — sheet ref update is best-effort
    }
  }
}

// Export the count so excelReporter can know exactly how many columns were added
export const ADDITIVE_COLUMN_COUNT = ADDITIVE_HEADERS.length;

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 8 (Phase 5): Provider Benchmark
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape we need from BenchmarkRunResult.
 * Declared inline to avoid a circular dependency with src/benchmark/runBenchmark.ts.
 */
export interface BenchmarkResultRow {
  provider: string;
  model: string;
  endpoint: string;
  timestamp: string;
  success: boolean;
  totalResponseTimeMs: number;
  inferenceTimeMs?: number;
  timeToFirstTokenMs?: number;
  outputLength: number;
  jsonValid: boolean;
  failureReason?: string;
  retries: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  outputPreview: string;
}

const BENCHMARK_HEADERS = [
  "Provider",             // 0
  "Model",               // 1
  "Timestamp",           // 2
  "Success",             // 3
  "Latency (ms)",        // 4
  "Inference Time (ms)", // 5
  "TTFT (ms)",           // 6
  "Prompt Tokens",       // 7
  "Completion Tokens",   // 8
  "Total Tokens",        // 9
  "JSON Valid",          // 10
  "Retries",             // 11
  "Failure Reason",      // 12
  "Output Preview",      // 13
  "Endpoint",            // 14
];

/**
 * Appends the "Provider Benchmark" worksheet.
 *
 * One row per benchmark result. Optional fields produce blank cells.
 * Never throws — a bad row is skipped silently.
 */
export function buildProviderBenchmarkSheet(
  workbook: XLSX.WorkBook,
  benchmarkResults: BenchmarkResultRow[]
): void {
  if (benchmarkResults.length === 0) {
    return; // Nothing to write — do not add an empty sheet
  }

  const ws: XLSX.WorkSheet = {};

  // Header row
  BENCHMARK_HEADERS.forEach((h, c) => set(ws, 0, c, hdrCell(h)));

  let rowIdx = 1;
  for (const r of benchmarkResults) {
    try {
      set(ws, rowIdx, 0,  txtCell(r.provider.toUpperCase(), { bold: true }));
      set(ws, rowIdx, 1,  txtCell(r.model));
      set(ws, rowIdx, 2,  txtCell(r.timestamp));
      set(ws, rowIdx, 3,  boolCell(r.success));
      set(ws, rowIdx, 4,  numCell(r.totalResponseTimeMs));
      set(ws, rowIdx, 5,  numCell(r.inferenceTimeMs));
      set(ws, rowIdx, 6,  numCell(r.timeToFirstTokenMs));
      set(ws, rowIdx, 7,  numCell(r.promptTokens));
      set(ws, rowIdx, 8,  numCell(r.completionTokens));
      set(ws, rowIdx, 9,  numCell(r.totalTokens));
      set(ws, rowIdx, 10, boolCell(r.jsonValid));
      set(ws, rowIdx, 11, numCell(r.retries));
      set(ws, rowIdx, 12, txtCell(r.failureReason));
      set(ws, rowIdx, 13, txtCell(r.outputPreview));
      set(ws, rowIdx, 14, txtCell(r.endpoint));
      rowIdx++;
    } catch {
      rowIdx++;
    }
  }

  sealRange(ws, rowIdx - 1, BENCHMARK_HEADERS.length);
  autoFit(ws);
  freezeRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "Provider Benchmark");
}
