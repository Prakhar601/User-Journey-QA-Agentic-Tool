import * as XLSX from "xlsx";
import os from "os";
import type { ScenarioResult } from "../core/types";
import { getModelProvider } from "../ai/modelProvider";
import type {
  ExecutionMetadata,
  ExecutionTool,
  ScenarioReport,
  TestResultStatus,
} from "./types";
import { ensureEnterpriseOutputStructure } from "./outputManager";
import { generateNetworkSummary } from "./networkSummary";

export interface ReportingContext {
  executionTool: ExecutionTool;
  executionEnvironment: string;
  outputDirPath?: string;
  executionMetadata?: ExecutionMetadata;
}

interface ScenarioNetworkMetrics {
  totalApiCalls?: number;
  averageLatency?: number;
  totalApiTime?: number;
  apiCallSequence?: {
    url: string;
    durationMs: number;
  }[];
}

interface ScenarioTimingMetadata {
  scenarioStartTimeMs?: number;
  scenarioEndTimeMs?: number;
}

function isTelemetryUrl(url: string): boolean {
  const lower = (url ?? "").toLowerCase();
  if (!lower) return false;

  const telemetryKeywords: string[] = [
    "analytics",
    "metrics",
    "telemetry",
    "events",
    "tracking",
    "sentry",
    "segment",
    "datadog",
    "backtrace",
    "monitor",
    "log",
  ];

  return telemetryKeywords.some((keyword) => lower.includes(keyword));
}

function toBusinessLanguage(message: string): string {
  const trimmed = (message ?? "").trim();
  if (!trimmed) {
    return "";
  }

  let text = trimmed.replace(/\s+/g, " ");
  const lower = text.toLowerCase();

  if (lower.includes("test planning failed before execution")) {
    return "The system was unable to prepare the test steps, so no actions were executed.";
  }

  if (lower.includes("ollama") && lower.includes("inference")) {
    return "The AI engine was unable to generate the test plan due to a processing issue.";
  }

  if (lower.includes("inference failed") || lower.includes("model inference")) {
    return "The AI engine was unable to generate the test plan due to a processing issue.";
  }

  if (lower.includes("browser state validation failed")) {
    return "The application did not reach the expected state during execution.";
  }

  if (lower.includes("empty dom snapshot")) {
    return "The application page did not load correctly.";
  }

  if (lower.includes("python agent exited with code")) {
    return "The automation process stopped unexpectedly.";
  }

  const lines = text.split(/[\r\n]+/);
  const filteredLines = lines.filter((line) => {
    const l = line.trim();
    if (!l) return false;
    if (/^\s*at\s+.+\(.+\)/i.test(l)) return false;
    if (/^\s*at\s+.+$/i.test(l)) return false;
    if (/^\s*traceback \(most recent call last\)/i.test(l)) return false;
    if (/^\s*file\s+".+",\s+line\s+\d+/i.test(l)) return false;
    if (/[A-Za-z0-9_]+\.(py|ts|js|tsx|jsx|java|cs):\d+/.test(l)) return false;
    if (/^\s*{\s*".+":/i.test(l)) return false;
    return true;
  });

  text = filteredLines.join(" ");

  text = text.replace(/\{[^{}]*\}/g, " ");

  const technicalTerms = [
    "planner",
    "ollama",
    "inference",
    "selector",
    "internal server error",
    "cuda",
    "browser_use",
  ];

  for (const term of technicalTerms) {
    const re = new RegExp(term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
    text = text.replace(re, " ");
  }

  text = text.replace(/`+/g, " ");
  text = text.replace(/["']{2,}/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  if (!text) {
    return "The system encountered an unexpected issue during execution.";
  }

  return text;
}

function translateToPlainEnglish(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("timeout")) {
    return "The system responded slowly and did not complete the action in time.";
  }

  if (
    lower.includes("element not found") ||
    lower.includes("no such element") ||
    lower.includes("unable to locate element")
  ) {
    return "The expected button or field was not visible on the page.";
  }

  if (
    lower.includes("server error") ||
    lower.includes("internal server error") ||
    lower.includes("status code 5") ||
    lower.includes("http 5")
  ) {
    return "The system could not complete the request because the server did not respond.";
  }

  if (lower.includes("unexpected exception") || lower.includes("exception")) {
    return "The system encountered an unexpected issue during execution.";
  }

  if (lower.includes("stack trace") || lower.includes(" at ")) {
    return "The system encountered an unexpected issue during execution.";
  }

  // Default to a generic, user-friendly explanation if we cannot classify.
  return "The system encountered an unexpected issue during execution.";
}

function toStatus(pass: boolean): TestResultStatus {
  return pass ? "Pass" : "Fail";
}

function toExecutiveStatus(status: TestResultStatus): TestResultStatus {
  // Executive summary uses plain Pass/Fail language only.
  return status === "Pass" ? "Pass" : "Fail";
}

function estimateStepsExecuted(businessObjective: string | undefined): number {
  if (!businessObjective) {
    return 0;
  }
  return businessObjective
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

/**
 * Derives a human-readable assertion coverage string from a ScenarioResult.
 * Returns undefined when no assertion summary data is available (e.g. legacy results).
 */
function deriveAssertionCoverageText(
  result: ScenarioResult
): string | undefined {
  const summary = result.assertionSummary;
  if (!summary) return undefined;

  const fulfilledCount: number = summary.fulfilled.length;
  const totalAssertions: number =
    summary.fulfilled.length + summary.failed.length + summary.pending.length;

  if (totalAssertions === 0) return undefined;

  return `${fulfilledCount} of ${totalAssertions} assertions satisfied`;
}

function toScenarioReport(
  result: ScenarioResult,
  context: ReportingContext
): ScenarioReport {
  const resultStatus: TestResultStatus = toStatus(result.pass);

  const translatedReasons: string[] = [];

  const noteText: string = result.notes?.trim() ?? "";
  if (noteText.length > 0) {
    translatedReasons.push(translateToPlainEnglish(noteText));
  }

  const translatedNetworkComments: string[] = [];
  for (const entry of result.networkValidation) {
    const raw = String(entry ?? "").trim();
    if (raw.length === 0) continue;
    const translated = translateToPlainEnglish(raw);
    if (!translatedNetworkComments.includes(translated)) {
      translatedNetworkComments.push(translated);
    }
  }

  if (translatedNetworkComments.length > 0 && resultStatus === "Fail") {
    translatedReasons.push(...translatedNetworkComments);
  }

  // Append assertion coverage text when the scenario failed and has assertion data.
  const assertionCoverage: string | undefined = deriveAssertionCoverageText(result);
  if (resultStatus === "Fail" && assertionCoverage) {
    translatedReasons.push(assertionCoverage);
  }

  const failureReason: string | undefined =
    resultStatus === "Fail" && translatedReasons.length > 0
      ? Array.from(new Set(translatedReasons)).join(" ")
      : undefined;

  return {
    scenarioName: result.scenarioName,
    inputDescription: `User scenario: ${result.scenarioName}`,
    actionTaken:
      "The system followed the described user journey for this scenario.",
    expectedOutcome: result.expected,
    actualOutcome: result.actual,
    result: resultStatus,
    failureReason,
    executionTool: context.executionTool,
    executionDate: new Date().toISOString(),
    executionEnvironment: context.executionEnvironment,
    networkComment:
      translatedNetworkComments.length > 0
        ? translatedNetworkComments.join(" ")
        : "No notable network behaviour.",
  };
}

function statusFillColor(status: TestResultStatus): string {
  switch (status) {
    case "Pass":
      return "FF00B050";
    case "Fail":
      return "FFFF0000";
    case "Blocked":
      return "FFFFFF00";
    default:
      return "FFFFFFFF";
  }
}

function getSystemSpecs(): string {
  try {
    const cpus = os.cpus();
    const cpu: string = cpus?.[0]?.model ?? "Unknown CPU";
    const cores: number = cpus?.length ?? 0;
    const ramGB: number = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    return `${cpu} | ${cores} cores | ${ramGB}GB RAM`;
  } catch {
    return "Unknown System Specs";
  }
}

function deriveNetworkMetricsFromScenario(result: ScenarioResult): {
  totalApiCalls: number;
  averageLatency: number;
  totalApiTime: number;
  apiCallSequence: { url: string; durationMs: number }[];
} {
  const empty = {
    totalApiCalls: 0,
    averageLatency: 0,
    totalApiTime: 0,
    apiCallSequence: [] as { url: string; durationMs: number }[],
  };

  try {
    const anyResult = result as unknown as {
      networkMetrics?: ScenarioNetworkMetrics;
    };

    const metrics = anyResult.networkMetrics;
    if (!metrics) {
      return empty;
    }

    const rawSequence = Array.isArray(metrics.apiCallSequence)
      ? metrics.apiCallSequence
      : [];

    const filtered = rawSequence.filter(
      (entry) =>
        typeof entry.url === "string" &&
        entry.url.trim().length > 0 &&
        !isTelemetryUrl(entry.url)
    );

    if (filtered.length === 0) {
      return empty;
    }

    let totalApiTime = 0;
    for (const entry of filtered) {
      const d =
        typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
          ? entry.durationMs
          : 0;
      totalApiTime += d;
    }

    const totalApiCalls = filtered.length;
    const averageLatency = totalApiCalls > 0 ? totalApiTime / totalApiCalls : 0;

    return {
      totalApiCalls,
      averageLatency,
      totalApiTime,
      apiCallSequence: filtered,
    };
  } catch {
    return empty;
  }
}

async function measureInternetSpeedMbps(): Promise<number | undefined> {
  try {
    const url = "https://speed.cloudflare.com/__down?bytes=1000000";
    const start = Date.now();
    const response = await fetch(url);
    if (!response.ok) return 50;
    await response.arrayBuffer();
    const durationSeconds = (Date.now() - start) / 1000;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 50;
    const mbps = (1_000_000 * 8) / 1_000_000 / durationSeconds;
    return Number.isFinite(mbps) && mbps > 0 ? Math.round(mbps) : 50;
  } catch {
    return 50;
  }
}

function generateAIAnalysis(
  metrics: { totalApiCalls: number; averageLatency: number; totalApiTime: number },
  _uiRenderTime: number
): string {
  if (metrics.totalApiCalls === 0) {
    return "No backend API activity detected";
  }
  if (metrics.averageLatency > 2000) {
    return "Backend latency detected";
  }
  if (metrics.averageLatency >= 800) {
    return "System slightly slow";
  }
  return "System performance healthy";
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_BG = "FFD9D9D9";   // #D9D9D9 light gray
const BORDER_COLOR = "FF000000"; // thin black border

const THIN_BORDER = {
  top:    { style: "thin", color: { rgb: BORDER_COLOR } },
  bottom: { style: "thin", color: { rgb: BORDER_COLOR } },
  left:   { style: "thin", color: { rgb: BORDER_COLOR } },
  right:  { style: "thin", color: { rgb: BORDER_COLOR } },
};

function makeHeaderCell(value: string): XLSX.CellObject {
  return {
    v: value,
    t: "s",
    s: {
      font: { bold: true, color: { rgb: "FF000000" } },
      fill: { patternType: "solid", fgColor: { rgb: HEADER_BG }, bgColor: { rgb: HEADER_BG } },
      alignment: { horizontal: "center", vertical: "middle", wrapText: true },
      border: THIN_BORDER,
    },
  };
}

function makeTextCell(value: string | undefined, horizontal: "left" | "center" = "left"): XLSX.CellObject {
  return {
    v: value ?? "",
    t: "s",
    s: {
      alignment: { horizontal, vertical: "middle", wrapText: true },
      border: THIN_BORDER,
    },
  };
}

function makeNumberCell(value: number | undefined): XLSX.CellObject {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    v: n,
    t: "n",
    s: {
      alignment: { horizontal: "center", vertical: "middle", wrapText: true },
      border: THIN_BORDER,
    },
  };
}

function makeLabelCell(value: string): XLSX.CellObject {
  return {
    v: value,
    t: "s",
    s: {
      font: { bold: true },
      alignment: { horizontal: "left", vertical: "middle", wrapText: true },
      border: THIN_BORDER,
    },
  };
}

function makeValueCell(value: string | number | undefined, horizontal: "left" | "center" = "center"): XLSX.CellObject {
  if (typeof value === "number") {
    return makeNumberCell(value);
  }
  return {
    v: value ?? "",
    t: "s",
    s: {
      alignment: { horizontal, vertical: "middle", wrapText: true },
      border: THIN_BORDER,
    },
  };
}

/**
 * Auto-fit column widths based on cell content.
 * Iterates all cells and picks the max character count per column.
 */
function autoFitColumns(worksheet: XLSX.WorkSheet): void {
  if (!worksheet["!ref"]) return;
  const range = XLSX.utils.decode_range(worksheet["!ref"] as string);
  const colWidths: number[] = [];

  for (let col = range.s.c; col <= range.e.c; col++) {
    let maxLen = 8; // minimum width
    for (let row = range.s.r; row <= range.e.r; row++) {
      const ref = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[ref] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const text = String(cell.v ?? "");
      // For multi-line content, use the longest line
      const longest = text.split("\n").reduce((max: number, line: string) => Math.max(max, line.length), 0);
      if (longest > maxLen) maxLen = longest;
    }
    colWidths[col] = Math.min(maxLen + 4, 80); // cap at 80 chars
  }

  worksheet["!cols"] = colWidths.map((wch) => ({ wch: wch ?? 12 }));
}

function freezeFirstRow(worksheet: XLSX.WorkSheet): void {
  (worksheet as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 1: Test Results
// ─────────────────────────────────────────────────────────────────────────────

function buildTestResultsSheet(
  workbook: XLSX.WorkBook,
  scenarioResults: ScenarioResult[],
  reports: ScenarioReport[]
): void {
  const ws: XLSX.WorkSheet = {};

  const headers = [
    "Scenario Name",
    "Expected Outcome",
    "Actual Outcome",
    "Result",
  ];

  // Write header row (row 0)
  headers.forEach((h: string, c: number) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = makeHeaderCell(h);
  });

  // Write data rows
  (scenarioResults.length > 0 ? scenarioResults : []).forEach((result, rowIdx) => {
    const report = reports[rowIdx];
    const r = rowIdx + 1;

    const expectedText = report
      ? (report.result === "Pass"
          ? "The workflow should complete successfully."
          : toBusinessLanguage(report.expectedOutcome ?? ""))
      : "";

    const actualText = report?.actualOutcome?.trim()
      ? toBusinessLanguage(report.actualOutcome)
      : "The workflow completed as expected.";

    const resultText = result.pass ? "Pass" : "Fail";
    const resultColor = result.pass ? "FF008000" : "FFFF0000";

    ws[XLSX.utils.encode_cell({ r, c: 0 })] = makeTextCell(result.scenarioName);
    ws[XLSX.utils.encode_cell({ r, c: 1 })] = makeTextCell(expectedText);
    ws[XLSX.utils.encode_cell({ r, c: 2 })] = makeTextCell(actualText);
    ws[XLSX.utils.encode_cell({ r, c: 3 })] = {
      v: resultText,
      t: "s",
      s: {
        font: { bold: true, color: { rgb: resultColor } },
        alignment: { horizontal: "center", vertical: "middle", wrapText: true },
        border: THIN_BORDER,
      },
    };
  });

  const totalRows = scenarioResults.length + 1;
  const totalCols = headers.length;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(totalRows - 1, 0), c: totalCols - 1 } });

  autoFitColumns(ws);
  freezeFirstRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "Test Results");
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 2: Executive Summary
// ─────────────────────────────────────────────────────────────────────────────

function buildExecutiveSummarySheet(
  workbook: XLSX.WorkBook,
  scenarioResults: ScenarioResult[]
): void {
  const ws: XLSX.WorkSheet = {};

  const total = scenarioResults.length;
  const passed = scenarioResults.filter((s) => s.pass === true).length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  // Header row
  ws[XLSX.utils.encode_cell({ r: 0, c: 0 })] = makeHeaderCell("Label");
  ws[XLSX.utils.encode_cell({ r: 0, c: 1 })] = makeHeaderCell("Value");

  const kvRows: Array<[string, string | number]> = [
    ["Total Scenarios", total],
    ["Passed", passed],
    ["Failed", failed],
    ["Pass Rate (%)", passRate],
  ];

  kvRows.forEach(([label, value]: [string, string | number], idx: number) => {
    const r = idx + 1;
    ws[XLSX.utils.encode_cell({ r, c: 0 })] = makeLabelCell(label);
    ws[XLSX.utils.encode_cell({ r, c: 1 })] = makeValueCell(value, "center");
  });

  const totalRows = kvRows.length + 1;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: 1 } });

  autoFitColumns(ws);
  freezeFirstRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "Executive Summary");
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 3: System Analysis
// ─────────────────────────────────────────────────────────────────────────────

async function buildSystemAnalysisSheet(
  workbook: XLSX.WorkBook,
  scenarioResults: ScenarioResult[],
  internetSpeedMbps: number | undefined
): Promise<void> {
  const ws: XLSX.WorkSheet = {};

  const systemSpecs: string = getSystemSpecs();
  const internetSpeedValue: string =
    typeof internetSpeedMbps === "number" &&
    Number.isFinite(internetSpeedMbps) &&
    internetSpeedMbps > 0
      ? `${internetSpeedMbps} Mbps`
      : "N/A";

  const headers = [
    "Scenario",
    "API Calls",
    "Avg Latency (ms)",
    "Total API Time (ms)",
    "UI Render Time (ms)",
    "System Specs",
  ];

  headers.forEach((h: string, c: number) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = makeHeaderCell(h);
  });

  const safeNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const safeStr = (v: unknown): string => {
    if (typeof v === "string") return v;
    return "N/A";
  };

  const rows = scenarioResults.length > 0 ? scenarioResults : [];

  for (let i = 0; i < rows.length; i++) {
    const result = rows[i]!;
    const r = i + 1;

    const anyResult = result as unknown as {
      networkMetrics?: ScenarioNetworkMetrics;
      scenarioStartTimeMs?: number;
      scenarioEndTimeMs?: number;
      apiCalls?: number;
      avgLatency?: number;
      totalApiTime?: number;
      uiRenderTime?: number;
      systemSpecs?: string;
    };

    let apiCalls = safeNum(anyResult.apiCalls);
    let avgLatency = safeNum(anyResult.avgLatency);
    let totalApiTime = safeNum(anyResult.totalApiTime);
    let uiRenderTime = safeNum(anyResult.uiRenderTime);

    // Derive from networkMetrics if direct fields not available
    if (apiCalls === 0) {
      const metrics = deriveNetworkMetricsFromScenario(result);
      apiCalls = metrics.totalApiCalls;
      avgLatency = Math.round(metrics.averageLatency);
      totalApiTime = Math.round(metrics.totalApiTime);

      const startMs = anyResult.scenarioStartTimeMs;
      const endMs = anyResult.scenarioEndTimeMs;
      if (typeof startMs === "number" && typeof endMs === "number" && endMs >= startMs) {
        const executionMs = endMs - startMs;
        uiRenderTime = executionMs > totalApiTime ? executionMs - totalApiTime : 0;
      }
    }

    const specs = safeStr(anyResult.systemSpecs) !== "N/A"
      ? safeStr(anyResult.systemSpecs)
      : systemSpecs;

    ws[XLSX.utils.encode_cell({ r, c: 0 })] = makeTextCell(result.scenarioName ?? "N/A");
    ws[XLSX.utils.encode_cell({ r, c: 1 })] = makeNumberCell(apiCalls);
    ws[XLSX.utils.encode_cell({ r, c: 2 })] = makeNumberCell(avgLatency);
    ws[XLSX.utils.encode_cell({ r, c: 3 })] = makeNumberCell(totalApiTime);
    ws[XLSX.utils.encode_cell({ r, c: 4 })] = makeNumberCell(uiRenderTime);
    ws[XLSX.utils.encode_cell({ r, c: 5 })] = makeTextCell(specs);
  }

  const totalRows = rows.length + 1;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(totalRows - 1, 0), c: headers.length - 1 } });

  autoFitColumns(ws);
  freezeFirstRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "System Analysis");
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 4: Summary
// ─────────────────────────────────────────────────────────────────────────────

async function buildSummarySheet(
  workbook: XLSX.WorkBook,
  scenarioResults: ScenarioResult[],
  internetSpeedMbps: number | undefined
): Promise<void> {
  const ws: XLSX.WorkSheet = {};

  const systemSpecs: string = getSystemSpecs();
  const internetSpeedValue: string =
    typeof internetSpeedMbps === "number" &&
    Number.isFinite(internetSpeedMbps) &&
    internetSpeedMbps > 0
      ? `${internetSpeedMbps} Mbps`
      : "N/A";

  const headers = [
    "System Specs",
    "Internet Speed",
    "Memory Utilization",
    "API Waterfall",
    "AI Analysis",
  ];

  headers.forEach((h: string, c: number) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = makeHeaderCell(h);
  });

  const safeStr = (v: unknown, fallback = "N/A"): string => {
    if (typeof v === "string" && v.trim().length > 0) return v;
    return fallback;
  };

  const rows = scenarioResults.length > 0 ? scenarioResults : [];

  for (let i = 0; i < rows.length; i++) {
    const result = rows[i]!;
    const r = i + 1;

    const anyResult = result as unknown as {
      systemSpecs?: string;
      internetSpeed?: string;
      memoryUsage?: string;
      apiWaterfall?: string[];
      aiAnalysis?: string;
      networkMetrics?: ScenarioNetworkMetrics;
      scenarioStartTimeMs?: number;
      scenarioEndTimeMs?: number;
    };

    const specs = safeStr(anyResult.systemSpecs) !== "N/A"
      ? safeStr(anyResult.systemSpecs)
      : systemSpecs;

    const internet = safeStr(anyResult.internetSpeed) !== "N/A"
      ? safeStr(anyResult.internetSpeed)
      : internetSpeedValue;

    const memory = safeStr(anyResult.memoryUsage);

    // Build API waterfall from apiWaterfall field or from networkMetrics
    let waterfallText = "N/A";
    if (Array.isArray(anyResult.apiWaterfall) && anyResult.apiWaterfall.length > 0) {
      waterfallText = anyResult.apiWaterfall.join("\n");
    } else {
      const metrics = deriveNetworkMetricsFromScenario(result);
      if (metrics.apiCallSequence.length > 0) {
        waterfallText = metrics.apiCallSequence.map((c: { url: string; durationMs: number }) => c.url).slice(0, 30).join("\n");
      }
    }

    // AI analysis
    let aiAnalysis = safeStr(anyResult.aiAnalysis);
    if (aiAnalysis === "N/A") {
      const metrics = deriveNetworkMetricsFromScenario(result);
      let execDurationMs = 0;
      const startMs = anyResult.scenarioStartTimeMs;
      const endMs = anyResult.scenarioEndTimeMs;
      if (typeof startMs === "number" && typeof endMs === "number" && endMs >= startMs) {
        execDurationMs = endMs - startMs;
      }
      const uiRenderTime = execDurationMs > metrics.totalApiTime
        ? execDurationMs - metrics.totalApiTime
        : 0;
      aiAnalysis = generateAIAnalysis(
        {
          totalApiCalls: metrics.totalApiCalls,
          averageLatency: metrics.averageLatency,
          totalApiTime: metrics.totalApiTime,
        },
        uiRenderTime
      );
    }

    ws[XLSX.utils.encode_cell({ r, c: 0 })] = makeTextCell(specs);
    ws[XLSX.utils.encode_cell({ r, c: 1 })] = makeTextCell(internet);
    ws[XLSX.utils.encode_cell({ r, c: 2 })] = makeTextCell(memory);
    ws[XLSX.utils.encode_cell({ r, c: 3 })] = makeTextCell(waterfallText);
    ws[XLSX.utils.encode_cell({ r, c: 4 })] = makeTextCell(aiAnalysis);
  }

  const totalRows = rows.length + 1;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(totalRows - 1, 0), c: headers.length - 1 } });

  autoFitColumns(ws);
  freezeFirstRow(ws);

  XLSX.utils.book_append_sheet(workbook, ws, "Summary");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public write functions
// ─────────────────────────────────────────────────────────────────────────────

export async function writeTestResultsExcel(
  scenarioResults: ScenarioResult[],
  context: ReportingContext
): Promise<void> {
  const reports: ScenarioReport[] = scenarioResults.map((result) =>
    toScenarioReport(result, context)
  );

  const workbook: XLSX.WorkBook = XLSX.utils.book_new();

  // Sheet 1: Test Results
  buildTestResultsSheet(workbook, scenarioResults, reports);

  // Sheet 2: Executive Summary
  buildExecutiveSummarySheet(workbook, scenarioResults);

  // Sheet 3: System Analysis
  const internetSpeedMbps: number | undefined = await measureInternetSpeedMbps();
  await buildSystemAnalysisSheet(workbook, scenarioResults, internetSpeedMbps);

  // Sheet 4: Summary
  await buildSummarySheet(workbook, scenarioResults, internetSpeedMbps);

  const { testResultsXlsxPath } = await ensureEnterpriseOutputStructure({
    outputDirPath: context.outputDirPath,
  });

  XLSX.writeFile(workbook, testResultsXlsxPath);
}

export async function writeRegressionReportExcel(
  scenarioResults: ScenarioResult[],
  context: ReportingContext
): Promise<void> {
  const reports: ScenarioReport[] = scenarioResults.map((result) =>
    toScenarioReport(result, context)
  );

  const workbook: XLSX.WorkBook = XLSX.utils.book_new();

  // Sheet 1: Test Results
  buildTestResultsSheet(workbook, scenarioResults, reports);

  // Sheet 2: Executive Summary
  buildExecutiveSummarySheet(workbook, scenarioResults);

  // Sheet 3: System Analysis
  const internetSpeedMbps: number | undefined = await measureInternetSpeedMbps();
  await buildSystemAnalysisSheet(workbook, scenarioResults, internetSpeedMbps);

  // Sheet 4: Summary
  await buildSummarySheet(workbook, scenarioResults, internetSpeedMbps);

  const { regressionReportXlsxPath } = await ensureEnterpriseOutputStructure({
    outputDirPath: context.outputDirPath,
  });

  XLSX.writeFile(workbook, regressionReportXlsxPath);
}
