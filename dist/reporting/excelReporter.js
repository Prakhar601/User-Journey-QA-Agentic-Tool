"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeTestResultsExcel = writeTestResultsExcel;
exports.writeRegressionReportExcel = writeRegressionReportExcel;
const XLSX = __importStar(require("xlsx"));
const os_1 = __importDefault(require("os"));
const modelProvider_1 = require("../ai/modelProvider");
const outputManager_1 = require("./outputManager");
function toBusinessLanguage(message) {
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
        if (!l)
            return false;
        if (/^\s*at\s+.+\(.+\)/i.test(l))
            return false;
        if (/^\s*at\s+.+$/i.test(l))
            return false;
        if (/^\s*traceback \(most recent call last\)/i.test(l))
            return false;
        if (/^\s*file\s+".+",\s+line\s+\d+/i.test(l))
            return false;
        if (/[A-Za-z0-9_]+\.(py|ts|js|tsx|jsx|java|cs):\d+/.test(l))
            return false;
        if (/^\s*{\s*".+":/i.test(l))
            return false;
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
function translateToPlainEnglish(message) {
    const lower = message.toLowerCase();
    if (lower.includes("timeout")) {
        return "The system responded slowly and did not complete the action in time.";
    }
    if (lower.includes("element not found") ||
        lower.includes("no such element") ||
        lower.includes("unable to locate element")) {
        return "The expected button or field was not visible on the page.";
    }
    if (lower.includes("server error") ||
        lower.includes("internal server error") ||
        lower.includes("status code 5") ||
        lower.includes("http 5")) {
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
function toStatus(pass) {
    return pass ? "Pass" : "Fail";
}
function toExecutiveStatus(status) {
    // Executive summary uses plain Pass/Fail language only.
    return status === "Pass" ? "Pass" : "Fail";
}
function estimateStepsExecuted(businessObjective) {
    if (!businessObjective) {
        return 0;
    }
    return businessObjective
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0).length;
}
function toScenarioReport(result, context) {
    const resultStatus = toStatus(result.pass);
    const translatedReasons = [];
    const noteText = result.notes?.trim() ?? "";
    if (noteText.length > 0) {
        translatedReasons.push(translateToPlainEnglish(noteText));
    }
    const translatedNetworkComments = [];
    for (const entry of result.networkValidation) {
        const raw = String(entry ?? "").trim();
        if (raw.length === 0)
            continue;
        const translated = translateToPlainEnglish(raw);
        if (!translatedNetworkComments.includes(translated)) {
            translatedNetworkComments.push(translated);
        }
    }
    if (translatedNetworkComments.length > 0 && resultStatus === "Fail") {
        translatedReasons.push(...translatedNetworkComments);
    }
    const failureReason = resultStatus === "Fail" && translatedReasons.length > 0
        ? Array.from(new Set(translatedReasons)).join(" ")
        : undefined;
    return {
        scenarioName: result.scenarioName,
        inputDescription: `User scenario: ${result.scenarioName}`,
        actionTaken: "The system followed the described user journey for this scenario.",
        expectedOutcome: result.expected,
        actualOutcome: result.actual,
        result: resultStatus,
        failureReason,
        executionTool: context.executionTool,
        executionDate: new Date().toISOString(),
        executionEnvironment: context.executionEnvironment,
        networkComment: translatedNetworkComments.length > 0
            ? translatedNetworkComments.join(" ")
            : "No notable network behaviour.",
    };
}
function statusFillColor(status) {
    switch (status) {
        case "Pass":
            return "FF00B050"; // Green
        case "Fail":
            return "FFFF0000"; // Red
        case "Blocked":
            return "FFFFFF00"; // Yellow
        default:
            return "FFFFFFFF"; // White
    }
}
function applyEnterpriseLayoutToWorksheet(worksheet, columnWidths, hasResultColumn) {
    if (!worksheet["!ref"]) {
        return;
    }
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    // Set column widths
    worksheet["!cols"] = columnWidths.map((wch) => ({ wch }));
    // Detect the logical header row. For detailed scenario tables this is the row
    // whose first column is "Scenario Name". For metric summaries it is the row
    // whose first column is "Metric". This allows optional metadata blocks to be
    // placed above the main table without breaking styling.
    let headerRowIndex = range.s.r;
    for (let row = range.s.r; row <= range.e.r; row++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: range.s.c });
        const cell = worksheet[cellRef];
        if (!cell || typeof cell.v !== "string")
            continue;
        const value = String(cell.v);
        if (value === "Scenario Name" || value === "Metric") {
            headerRowIndex = row;
            break;
        }
    }
    // Freeze header row
    worksheet["!freeze"] = { xSplit: 0, ySplit: headerRowIndex + 1 };
    const thinBorder = {
        top: { style: "thin", color: { rgb: "FFCCCCCC" } },
        bottom: { style: "thin", color: { rgb: "FFCCCCCC" } },
        left: { style: "thin", color: { rgb: "FFCCCCCC" } },
        right: { style: "thin", color: { rgb: "FFCCCCCC" } },
    };
    // Header styling
    for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
        const cell = worksheet[cellRef];
        if (!cell)
            continue;
        cell.s = {
            font: { bold: true, color: { rgb: "FFFFFFFF" } },
            fill: {
                patternType: "solid",
                fgColor: { rgb: "FF203864" }, // Dark blue
                bgColor: { rgb: "FF203864" },
            },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            border: thinBorder,
        };
    }
    // Data cells styling
    for (let row = headerRowIndex + 1; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = worksheet[cellRef];
            if (!cell)
                continue;
            const existing = cell.s ?? {};
            cell.s = {
                ...existing,
                alignment: {
                    horizontal: "left",
                    vertical: "top",
                    wrapText: true,
                    ...(existing.alignment ?? {}),
                },
                border: existing.border ?? thinBorder,
            };
        }
    }
    // Result column color grading (if present)
    if (hasResultColumn) {
        const resultColIndex = range.s.c + (columnWidths.length > 0 ? 5 : 0); // index 5 for our schemas
        for (let row = headerRowIndex + 1; row <= range.e.r; row++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: resultColIndex });
            const cell = worksheet[cellRef];
            if (!cell || typeof cell.v !== "string")
                continue;
            const status = cell.v;
            let fillColor = statusFillColor(status);
            let fontColor = "FFFFFFFF";
            if (status === "Blocked") {
                fontColor = "FF000000";
            }
            const existing = cell.s ?? {};
            cell.s = {
                ...existing,
                font: {
                    ...(existing.font ?? {}),
                    bold: true,
                    color: { rgb: fontColor },
                },
                fill: {
                    patternType: "solid",
                    fgColor: { rgb: fillColor },
                    bgColor: { rgb: fillColor },
                },
                border: existing.border ?? thinBorder,
            };
        }
    }
}
function getSystemSpecs() {
    try {
        const cpu = os_1.default.cpus()?.[0]?.model ?? "Unknown CPU";
        const ramGB = Math.round(os_1.default.totalmem() / (1024 * 1024 * 1024));
        const osName = `${os_1.default.type()} ${os_1.default.release()}`;
        return `${osName} | ${cpu} | ${ramGB}GB RAM`;
    }
    catch {
        return "System information unavailable";
    }
}
function deriveNetworkMetricsFromScenario(result) {
    const anyResult = result;
    const directMetrics = anyResult.networkMetrics;
    if (directMetrics &&
        typeof directMetrics.totalApiCalls === "number" &&
        typeof directMetrics.averageLatency === "number" &&
        typeof directMetrics.totalApiTime === "number") {
        return {
            totalApiCalls: directMetrics.totalApiCalls,
            averageLatency: directMetrics.averageLatency,
            totalApiTime: directMetrics.totalApiTime,
            apiCallSequence: Array.isArray(directMetrics.apiCallSequence)
                ? directMetrics.apiCallSequence
                : [],
        };
    }
    const actual = result.actual ?? "";
    const lowerActual = actual.toLowerCase();
    if (lowerActual.includes("no external api interaction detected")) {
        return {
            totalApiCalls: 0,
            averageLatency: 0,
            totalApiTime: 0,
            apiCallSequence: [],
        };
    }
    const networkSummaryRegex = /Network analysis:\s*Total API calls:\s*(\d+),\s*Average latency:\s*(\d+)\s*ms,\s*Total API time:\s*(\d+)\s*ms/i;
    const match = actual.match(networkSummaryRegex);
    if (match) {
        const totalApiCalls = Number(match[1]) || 0;
        const averageLatency = Number(match[2]) || 0;
        const totalApiTime = Number(match[3]) || 0;
        return {
            totalApiCalls,
            averageLatency,
            totalApiTime,
            apiCallSequence: [],
        };
    }
    return {
        totalApiCalls: 0,
        averageLatency: 0,
        totalApiTime: 0,
        apiCallSequence: [],
    };
}
function generateAIAnalysis(metrics, uiRenderTime) {
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
async function measureInternetSpeedMbps() {
    const url = (process.env.INTERNET_SPEED_TEST_URL ?? "").trim();
    if (!url) {
        return undefined;
    }
    try {
        const start = Date.now();
        const response = await fetch(url);
        if (!response.ok) {
            return undefined;
        }
        const contentLengthHeader = response.headers.get("content-length");
        let bytes;
        if (contentLengthHeader && /^\d+$/.test(contentLengthHeader)) {
            bytes = Number(contentLengthHeader);
            // Ensure body is fully read so the measurement is realistic.
            await response.arrayBuffer();
        }
        else {
            const buffer = await response.arrayBuffer();
            bytes = buffer.byteLength;
        }
        const durationSeconds = (Date.now() - start) / 1000;
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            return undefined;
        }
        const megabits = (bytes * 8) / 1000000;
        const mbps = megabits / durationSeconds;
        if (!Number.isFinite(mbps) || mbps <= 0) {
            return undefined;
        }
        return Math.round(mbps);
    }
    catch {
        return undefined;
    }
}
async function filterRelevantApisWithLLM(workflowDescription, capturedApiUrls) {
    if (!capturedApiUrls || capturedApiUrls.length === 0) {
        return [];
    }
    const provider = (0, modelProvider_1.getModelProvider)();
    const limitedUrls = capturedApiUrls.length > 30
        ? capturedApiUrls.slice(capturedApiUrls.length - 30)
        : capturedApiUrls.slice();
    const promptParts = [];
    promptParts.push("You are helping analyze network API calls for an end-to-end workflow test.");
    promptParts.push("");
    promptParts.push("Workflow description:");
    promptParts.push(workflowDescription || "Unknown workflow");
    promptParts.push("");
    promptParts.push("Captured API URLs (in chronological order):");
    promptParts.push(JSON.stringify(limitedUrls, null, 2));
    promptParts.push("");
    promptParts.push("From the list above, select only the API URLs that are directly relevant to executing the workflow.");
    promptParts.push("Rules:");
    promptParts.push("- Only select values that appear in the Captured API URLs list.");
    promptParts.push("- Do not invent new URLs.");
    promptParts.push("- Preserve the original order of any URLs you select.");
    promptParts.push("- You may drop analytics, logging, telemetry, or unrelated endpoints.");
    promptParts.push("- Duplicates are allowed if they appear multiple times in the input.");
    promptParts.push("- Do not reorder or deduplicate the selected URLs.");
    promptParts.push("- Respond with a JSON array ONLY (no explanation).");
    const prompt = promptParts.join("\n");
    try {
        const raw = await provider.generateResponse([{ role: "user", content: prompt }], {
            model: process.env.LLM_MODEL ??
                process.env.GITHUB_MODEL ??
                "openai/gpt-4.1-mini",
        });
        if (!raw || typeof raw !== "string") {
            return undefined;
        }
        let text = raw.trim();
        const firstBracket = text.indexOf("[");
        const lastBracket = text.lastIndexOf("]");
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            text = text.slice(firstBracket, lastBracket + 1);
        }
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
            return undefined;
        }
        const result = [];
        for (const item of parsed) {
            if (typeof item === "string" && item.trim().length > 0) {
                result.push(item);
            }
        }
        return result;
    }
    catch {
        return undefined;
    }
}
async function addSystemAnalysisSheet(workbook, scenarioResults, options) {
    if (!scenarioResults || scenarioResults.length === 0) {
        return;
    }
    const systemSpecs = getSystemSpecs();
    const internetSpeedValue = typeof options.internetSpeedMbps === "number" &&
        Number.isFinite(options.internetSpeedMbps) &&
        options.internetSpeedMbps > 0
        ? `${options.internetSpeedMbps} Mbps`
        : "Unknown";
    const headerRow = [
        "Scenario",
        "API Calls",
        "Avg Latency (ms)",
        "Total API Time (ms)",
        "UI Render Time (ms)",
        "System Specs",
        "Internet Speed",
        "API Waterfall",
        "AI Analysis",
    ];
    const dataRows = [];
    for (const result of scenarioResults) {
        const metrics = deriveNetworkMetricsFromScenario(result);
        const anyResult = result;
        const sequence = (anyResult.networkMetrics?.apiCallSequence &&
            Array.isArray(anyResult.networkMetrics.apiCallSequence)
            ? anyResult.networkMetrics.apiCallSequence
            : metrics.apiCallSequence) ?? [];
        const recentSequence = sequence.length > 30
            ? sequence.slice(sequence.length - 30)
            : sequence.slice();
        const capturedApiUrls = recentSequence.map((c) => c.url);
        let relevantUrls;
        if (capturedApiUrls.length > 0) {
            const workflowDescription = result.expected && result.expected.trim().length > 0
                ? result.expected
                : result.scenarioName;
            relevantUrls = await filterRelevantApisWithLLM(workflowDescription, capturedApiUrls);
        }
        const relevantUrlSet = new Set((relevantUrls && relevantUrls.length > 0
            ? relevantUrls
            : capturedApiUrls).filter((u) => typeof u === "string" && u.length > 0));
        const relevantCalls = recentSequence.filter((call) => relevantUrlSet.has(call.url));
        const totalApiCallsRelevant = relevantCalls.length;
        let totalApiTimeRelevant = 0;
        for (const call of relevantCalls) {
            if (typeof call.durationMs === "number" &&
                Number.isFinite(call.durationMs) &&
                call.durationMs >= 0) {
                totalApiTimeRelevant += call.durationMs;
            }
        }
        const averageLatencyRelevant = totalApiCallsRelevant > 0
            ? totalApiTimeRelevant / totalApiCallsRelevant
            : 0;
        let scenarioExecutionDurationMs = 0;
        if (typeof anyResult.scenarioStartTimeMs === "number" &&
            typeof anyResult.scenarioEndTimeMs === "number" &&
            Number.isFinite(anyResult.scenarioStartTimeMs) &&
            Number.isFinite(anyResult.scenarioEndTimeMs) &&
            anyResult.scenarioEndTimeMs >= anyResult.scenarioStartTimeMs) {
            scenarioExecutionDurationMs =
                anyResult.scenarioEndTimeMs - anyResult.scenarioStartTimeMs;
        }
        const uiRenderTime = scenarioExecutionDurationMs > totalApiTimeRelevant
            ? scenarioExecutionDurationMs - totalApiTimeRelevant
            : 0;
        const avgLatencyRounded = Math.round(averageLatencyRelevant);
        const aiAnalysis = generateAIAnalysis({
            totalApiCalls: totalApiCallsRelevant,
            averageLatency: averageLatencyRelevant,
            totalApiTime: totalApiTimeRelevant,
        }, uiRenderTime);
        const apiWaterfall = relevantCalls.length > 0
            ? relevantCalls.map((call) => call.url).join("\n")
            : "";
        dataRows.push([
            result.scenarioName,
            totalApiCallsRelevant,
            avgLatencyRounded,
            Math.round(totalApiTimeRelevant),
            uiRenderTime,
            systemSpecs,
            internetSpeedValue,
            apiWaterfall,
            aiAnalysis,
        ]);
    }
    const rows = [headerRow, ...dataRows];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    applyEnterpriseLayoutToWorksheet(sheet, [
        35, // Scenario
        12, // API Calls
        18, // Avg Latency (ms)
        20, // Total API Time (ms)
        22, // UI Render Time (ms)
        50, // System Specs
        18, // Internet Speed
        60, // API Waterfall
        40, // AI Analysis
    ], false);
    XLSX.utils.book_append_sheet(workbook, sheet, "System Analysis");
}
function addSummarySheet(workbook, reports, context) {
    if (reports.length === 0) {
        return;
    }
    const total = reports.length;
    const passed = reports.filter((r) => r.result === "Pass").length;
    const failed = reports.filter((r) => r.result === "Fail").length;
    const blocked = reports.filter((r) => r.result === "Blocked").length;
    const executionDate = reports[0]?.executionDate;
    const executionTool = context.executionTool;
    const rows = [
        ["Metric", "Value"],
        ["Total Scenarios", total],
        ["Passed", passed],
        ["Failed", failed],
        ["Blocked", blocked],
        ["Execution Date", executionDate],
        ["Execution Tool", executionTool],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(rows);
    // Simple professional formatting for summary
    summarySheet["!cols"] = [{ wch: 20 }, { wch: 30 }];
    const range = XLSX.utils.decode_range(summarySheet["!ref"]);
    const thinBorder = {
        top: { style: "thin", color: { rgb: "FFCCCCCC" } },
        bottom: { style: "thin", color: { rgb: "FFCCCCCC" } },
        left: { style: "thin", color: { rgb: "FFCCCCCC" } },
        right: { style: "thin", color: { rgb: "FFCCCCCC" } },
    };
    for (let row = range.s.r; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = summarySheet[cellRef];
            if (!cell)
                continue;
            const isHeader = row === range.s.r || col === range.s.c;
            cell.s = {
                font: {
                    bold: isHeader,
                },
                alignment: {
                    horizontal: "left",
                    vertical: "center",
                    wrapText: true,
                },
                border: thinBorder,
            };
        }
    }
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
}
function addExecutiveSummarySheet(workbook, reports, context) {
    if (reports.length === 0) {
        return;
    }
    const headerRow = [
        "Scenario Name",
        "Business Objective",
        "Status (Pass/Fail)",
        "Steps Executed",
        "Pages Visited",
        "Failed Network Requests",
        "Execution Duration (seconds)",
        "Tool Used (Playwright or Selenium)",
        "Execution Date",
        "Network Health",
        "AI Summary (Plain English)",
    ];
    const dataRows = reports.map((report) => {
        const executiveStatus = toExecutiveStatus(report.result);
        const stepsExecuted = estimateStepsExecuted(report.expectedOutcome);
        const toolUsed = context.executionTool;
        const executionDate = report.executionDate;
        const actualOutcome = report.actualOutcome ?? "";
        const actualLower = actualOutcome.toLowerCase();
        let networkHealth = "Not Applicable";
        if (actualLower.includes("no external api interaction detected") ||
            !actualOutcome) {
            networkHealth = "Not Applicable";
        }
        else if (actualLower.includes("the system responded successfully within normal time")) {
            networkHealth = "Healthy";
        }
        else if (actualLower.includes("the system responded successfully but took slightly longer than expected") ||
            actualLower.includes("the system responded successfully but experienced noticeable delay")) {
            networkHealth = "Slow";
        }
        else if (actualLower.includes("the request was rejected due to client-side issue") ||
            actualLower.includes("the system encountered a server-side issue while processing the request")) {
            networkHealth = "Failed";
        }
        else if (actualLower.includes("network response details were unavailable")) {
            networkHealth = "Not Applicable";
        }
        let aiSummary;
        if (executiveStatus === "Pass") {
            aiSummary =
                report.expectedOutcome && report.expectedOutcome.trim().length > 0
                    ? `This scenario completed successfully. The application met the business objective: ${report.expectedOutcome}.`
                    : "This scenario completed successfully and the application behaved as expected.";
        }
        else {
            const reason = report.failureReason;
            if (reason && reason.trim().length > 0) {
                aiSummary = `This scenario did not complete successfully. In simple terms, ${reason}`;
            }
            else if (report.networkComment &&
                report.networkComment !== "No notable network behaviour.") {
                aiSummary = `This scenario did not complete successfully. ${report.networkComment}`;
            }
            else {
                aiSummary =
                    "This scenario did not complete successfully due to an unexpected issue during the test run.";
            }
        }
        const aiSummaryBusiness = toBusinessLanguage(aiSummary);
        // Pages visited, failed network requests, and execution duration are
        // not currently tracked per scenario in the reporting context.
        // They are left blank here to avoid misrepresenting the underlying data.
        const pagesVisited = undefined;
        const failedNetworkRequests = undefined;
        const executionDurationSeconds = undefined;
        return [
            report.scenarioName,
            report.expectedOutcome,
            executiveStatus,
            stepsExecuted,
            pagesVisited,
            failedNetworkRequests,
            executionDurationSeconds,
            toolUsed,
            executionDate,
            networkHealth,
            aiSummaryBusiness,
        ];
    });
    const metadata = context.executionMetadata;
    const metadataRows = metadata != null
        ? [
            ["Execution ID", metadata.executionId],
            ["Execution Date", metadata.executionDate],
            ["Environment", metadata.environment],
            ["Model Used", metadata.modelUsed],
            ["Target URL", metadata.targetUrl],
            ["Automation Tool", metadata.automationTool],
            ["Browser", metadata.browser],
            ["Headless Mode", metadata.headlessMode],
            ["Total Scenarios", metadata.totalScenarios],
            ["Passed", metadata.passed],
            ["Failed", metadata.failed],
        ]
        : [];
    const rows = metadataRows.length > 0
        ? [...metadataRows, [], headerRow, ...dataRows]
        : [headerRow, ...dataRows];
    const executiveSheet = XLSX.utils.aoa_to_sheet(rows);
    applyEnterpriseLayoutToWorksheet(executiveSheet, [
        35, // Scenario Name
        45, // Business Objective
        18, // Status (Pass/Fail)
        18, // Steps Executed
        18, // Pages Visited
        24, // Failed Network Requests
        28, // Execution Duration (seconds)
        24, // Tool Used
        24, // Execution Date
        18, // Network Health
        50, // AI Summary (Plain English)
    ], false);
    XLSX.utils.book_append_sheet(workbook, executiveSheet, "Executive Summary");
}
async function writeTestResultsExcel(scenarioResults, context) {
    const reports = scenarioResults.map((result) => toScenarioReport(result, context));
    const headerRow = [
        "Scenario Name",
        "Expected Outcome",
        "Actual Outcome",
        "Result",
        "Failure Reason",
    ];
    const dataRows = reports.map((report) => {
        const expectedOutcomeText = report.result === "Pass"
            ? "The workflow should complete successfully."
            : toBusinessLanguage(report.expectedOutcome ?? "");
        const actualOutcomeText = report.actualOutcome && report.actualOutcome.trim().length > 0
            ? toBusinessLanguage(report.actualOutcome)
            : "The workflow completed as expected.";
        const failureReasonText = report.failureReason && report.failureReason.trim().length > 0
            ? toBusinessLanguage(report.failureReason)
            : undefined;
        return [
            report.scenarioName,
            expectedOutcomeText,
            actualOutcomeText,
            report.result,
            failureReasonText,
        ];
    });
    const rows = [headerRow, ...dataRows];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    applyEnterpriseLayoutToWorksheet(worksheet, [
        35, // Scenario Name
        40, // Expected Outcome
        40, // Actual Outcome
        15, // Result
        40, // Failure Reason
    ], false);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Test Results");
    // Executive Summary sheet (second sheet) with high-level metrics
    addExecutiveSummarySheet(workbook, reports, context);
    const internetSpeedMbps = await measureInternetSpeedMbps();
    await addSystemAnalysisSheet(workbook, scenarioResults, {
        internetSpeedMbps,
    });
    addSummarySheet(workbook, reports, context);
    const { testResultsXlsxPath } = await (0, outputManager_1.ensureEnterpriseOutputStructure)({
        outputDirPath: context.outputDirPath,
    });
    XLSX.writeFile(workbook, testResultsXlsxPath);
}
async function writeRegressionReportExcel(scenarioResults, context) {
    const reports = scenarioResults.map((result) => toScenarioReport(result, context));
    const headerRow = [
        "Scenario Name",
        "Expected Outcome",
        "Actual Outcome",
        "Result",
        "Failure Reason",
        "Execution Date",
        "Execution Environment",
    ];
    const dataRows = reports.map((report) => {
        const expectedOutcomeText = report.result === "Pass"
            ? "The workflow should complete successfully."
            : toBusinessLanguage(report.expectedOutcome ?? "");
        const actualOutcomeText = report.actualOutcome && report.actualOutcome.trim().length > 0
            ? toBusinessLanguage(report.actualOutcome)
            : "The workflow completed as expected.";
        const failureReasonText = report.failureReason && report.failureReason.trim().length > 0
            ? toBusinessLanguage(report.failureReason)
            : undefined;
        const executionDateForRow = context.executionMetadata?.executionDate ?? report.executionDate;
        const executionEnvironmentForRow = context.executionMetadata?.environment ?? report.executionEnvironment;
        return [
            report.scenarioName,
            expectedOutcomeText,
            actualOutcomeText,
            report.result,
            failureReasonText,
            executionDateForRow,
            executionEnvironmentForRow,
        ];
    });
    const rows = [headerRow, ...dataRows];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    applyEnterpriseLayoutToWorksheet(worksheet, [
        35, // Scenario Name
        40, // Expected Outcome
        40, // Actual Outcome
        15, // Result
        40, // Failure Reason
        20, // Execution Date
        30, // Execution Environment
    ], true);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Regression Report");
    // Executive Summary sheet (second sheet) with high-level metrics
    addExecutiveSummarySheet(workbook, reports, context);
    const internetSpeedMbps = await measureInternetSpeedMbps();
    await addSystemAnalysisSheet(workbook, scenarioResults, {
        internetSpeedMbps,
    });
    addSummarySheet(workbook, reports, context);
    const { regressionReportXlsxPath } = await (0, outputManager_1.ensureEnterpriseOutputStructure)({
        outputDirPath: context.outputDirPath,
    });
    XLSX.writeFile(workbook, regressionReportXlsxPath);
}
