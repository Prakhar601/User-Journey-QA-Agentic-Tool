import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { createModelProvider } from "../ai/providerFactory";
import {
  buildProviderConfig,
  detectEnabledProviders,
  resolveEndpoint,
  resolveModelName,
  type ProviderKind,
} from "../ai/providerConfig";
import type { GenerateResponseResult } from "../ai/modelProvider";

const BENCHMARK_PROMPT = `Return ONLY valid JSON with this exact shape:
{
  "steps": [
    { "action": "navigate", "target": "https://example.com", "expected": "page loads" },
    { "action": "click", "target": "Login button", "expected": "login form appears" }
  ]
}
Do not include markdown fences or commentary.`;

// ─────────────────────────────────────────────────────────────────────────────
// Public result type
// ─────────────────────────────────────────────────────────────────────────────

export interface BenchmarkRunResult {
  provider: ProviderKind;
  model: string;
  endpoint: string;
  /** ISO-8601 timestamp of when this benchmark measurement started. */
  timestamp: string;
  success: boolean;
  /** Wall-clock time including retries (milliseconds). */
  totalResponseTimeMs: number;
  /** Provider-reported inference time, excluding network overhead (ms). */
  inferenceTimeMs?: number;
  timeToFirstTokenMs?: number;
  outputLength: number;
  jsonValid: boolean;
  /** Human-readable failure reason; undefined on success. */
  failureReason?: string;
  /**
   * @deprecated Use failureReason. Retained for backward compatibility with
   *             existing callers that reference the `error` field directly.
   */
  error?: string;
  retries: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  outputPreview: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValidJson(text: string): boolean {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    JSON.parse(withoutFence);
    return true;
  } catch {
    return false;
  }
}

async function measureStreamingFirstToken(
  providerKind: ProviderKind,
  model: string,
  endpoint: string,
  apiKey: string,
  timeoutMs: number
): Promise<number | undefined> {
  const provider = createModelProvider(providerKind);
  if (!provider.streamResponse) {
    return undefined;
  }

  const started = Date.now();
  const stream = provider.streamResponse(
    [{ role: "user", content: BENCHMARK_PROMPT }],
    { model, endpoint, token: apiKey, provider: providerKind, timeoutMs }
  );

  for await (const _chunk of stream) {
    return Date.now() - started;
  }
  return undefined;
}

async function runProviderBenchmark(
  providerKind: ProviderKind,
  maxRetries: number
): Promise<BenchmarkRunResult> {
  const config = buildProviderConfig({ provider: providerKind });
  const model = resolveModelName(providerKind, config.model);
  const endpoint = resolveEndpoint(providerKind, config.endpoint);
  const provider = createModelProvider(providerKind);
  const timestamp = new Date().toISOString();

  let retries = 0;
  let lastError = "";
  let result: GenerateResponseResult | undefined;
  const started = Date.now();

  while (retries <= maxRetries) {
    try {
      result = await provider.generateResponse(
        [{ role: "user", content: BENCHMARK_PROMPT }],
        {
          model,
          endpoint: config.endpoint,
          token: config.apiKey,
          provider: providerKind,
          timeoutMs: config.timeoutMs,
        }
      );
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      retries += 1;
    }
  }

  const totalResponseTimeMs = Date.now() - started;
  const content = result?.content ?? "";

  let timeToFirstTokenMs: number | undefined;
  if (result) {
    try {
      timeToFirstTokenMs = await measureStreamingFirstToken(
        providerKind,
        model,
        config.endpoint,
        config.apiKey,
        config.timeoutMs
      );
    } catch {
      timeToFirstTokenMs = undefined;
    }
  }

  const failureReason = result ? undefined : (lastError || undefined);

  return {
    provider: providerKind,
    model,
    endpoint,
    timestamp,
    success: Boolean(result),
    totalResponseTimeMs: result?.inferenceTimeMs ?? totalResponseTimeMs,
    inferenceTimeMs: result?.inferenceTimeMs,
    timeToFirstTokenMs,
    outputLength: content.length,
    jsonValid: result ? isValidJson(content) : false,
    failureReason,
    error: failureReason, // backward-compat alias
    retries: result ? retries : Math.max(retries - 1, 0),
    promptTokens: result?.promptTokens,
    completionTokens: result?.completionTokens,
    totalTokens: result?.totalTokens,
    outputPreview: content.slice(0, 200),
  };
}

function ensureBenchmarkDir(): string {
  const dir = path.resolve(process.cwd(), "benchmark");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMarkdown(results: BenchmarkRunResult[], outputPath: string): void {
  const lines = [
    "# LLM Provider Benchmark",
    "",
    "Generated: " + new Date().toISOString(),
    "",
    "## Prompt",
    "",
    "```",
    BENCHMARK_PROMPT,
    "```",
    "",
    "## Results",
    "",
  ];

  for (const r of results) {
    lines.push("### " + r.provider + " (" + r.model + ")");
    lines.push("");
    lines.push("- **Timestamp:** " + r.timestamp);
    lines.push("- **Endpoint:** " + r.endpoint);
    lines.push("- **Success:** " + (r.success ? "Yes" : "No"));
    lines.push("- **Total Response Time:** " + r.totalResponseTimeMs + "ms");
    if (r.inferenceTimeMs !== undefined) {
      lines.push("- **Inference Time:** " + r.inferenceTimeMs + "ms");
    }
    if (r.timeToFirstTokenMs !== undefined) {
      lines.push("- **Time to First Token:** " + r.timeToFirstTokenMs + "ms");
    }
    lines.push("- **Output Length:** " + r.outputLength);
    lines.push("- **JSON Valid:** " + (r.jsonValid ? "Yes" : "No"));
    lines.push("- **Retries:** " + r.retries);
    if (r.totalTokens !== undefined) {
      lines.push("- **Total Tokens:** " + r.totalTokens);
    }
    if (r.failureReason) {
      lines.push("- **Failure Reason:** " + r.failureReason);
    }
    lines.push("");
  }

  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
}

function writeExcel(results: BenchmarkRunResult[], outputPath: string): void {
  const rows = results.map((r) => ({
    Provider: r.provider,
    Model: r.model,
    Endpoint: r.endpoint,
    Timestamp: r.timestamp,
    Success: r.success ? "Yes" : "No",
    "Total Response Time (ms)": r.totalResponseTimeMs,
    "Inference Time (ms)": r.inferenceTimeMs ?? "",
    "Time to First Token (ms)": r.timeToFirstTokenMs ?? "",
    "Output Length": r.outputLength,
    "JSON Valid": r.jsonValid ? "Yes" : "No",
    Retries: r.retries,
    "Prompt Tokens": r.promptTokens ?? "",
    "Completion Tokens": r.completionTokens ?? "",
    "Total Tokens": r.totalTokens ?? "",
    "Failure Reason": r.failureReason ?? "",
    "Output Preview": r.outputPreview,
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Benchmark");
  XLSX.writeFile(workbook, outputPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: formatted console output
// Exported so reporters and callers can reuse the same rendering.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats benchmark results as a human-readable console table.
 *
 * Pure function with no side effects.
 * Safe to call from any reporting context.
 */
export function formatBenchmarkConsole(results: BenchmarkRunResult[]): string {
  if (results.length === 0) {
    return "[Benchmark] No results available.";
  }

  const div = "\u2500".repeat(90);
  const lines: string[] = [
    "",
    div,
    " PROVIDER BENCHMARK RESULTS",
    div,
  ];

  for (const r of results) {
    const status = r.success ? "\u2705 SUCCESS" : "\u274c FAILED";
    const jsonMark = r.jsonValid ? "\u2713" : "\u2717";

    lines.push("");
    lines.push("  Provider  : " + r.provider.toUpperCase());
    lines.push("  Model     : " + (r.model || "\u2014"));
    lines.push("  Endpoint  : " + (r.endpoint || "\u2014"));
    lines.push("  Timestamp : " + r.timestamp);
    lines.push("  Status    : " + status);
    lines.push("  Latency   : " + r.totalResponseTimeMs + "ms (wall clock)");

    if (r.inferenceTimeMs !== undefined) {
      lines.push("  Inference : " + r.inferenceTimeMs + "ms (provider-reported)");
    }
    if (r.timeToFirstTokenMs !== undefined) {
      lines.push("  TTFT      : " + r.timeToFirstTokenMs + "ms");
    }
    if (r.totalTokens !== undefined) {
      const prompt = r.promptTokens ?? 0;
      const completion = r.completionTokens ?? 0;
      lines.push(
        "  Tokens    : " +
          prompt + " prompt + " + completion + " completion = " + r.totalTokens + " total"
      );
    }

    lines.push("  JSON      : " + jsonMark + " " + (r.jsonValid ? "valid" : "INVALID"));

    if (r.failureReason) {
      lines.push("  Failure   : " + r.failureReason.slice(0, 120));
    }
    if (r.retries > 0) {
      lines.push("  Retries   : " + r.retries);
    }
    lines.push("");
  }

  const successCount = results.filter((r) => r.success).length;
  const successResults = results.filter((r) => r.success);
  const avgLatency =
    successResults.length > 0
      ? Math.round(
          successResults.reduce((sum, r) => sum + r.totalResponseTimeMs, 0) /
            successResults.length
        )
      : 0;

  lines.push(div);
  lines.push(
    "  SUMMARY: " +
      successCount + "/" + results.length + " providers succeeded" +
      (successCount > 0 ? " \u2014 Avg latency: " + avgLatency + "ms" : "")
  );
  lines.push(div);
  lines.push("");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runBenchmark(): Promise<BenchmarkRunResult[]> {
  const enabled = detectEnabledProviders();
  if (enabled.length === 0) {
    throw new Error(
      "No providers are configured for benchmarking. Set credentials for at least one of: github (GITHUB_PAT), ollama (LLM_ENDPOINT), amd (AMD_BASE_URL + AMD_API_KEY)."
    );
  }

  const maxRetries = Number(process.env.BENCHMARK_RETRIES ?? "1");
  const retryLimit = Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 1;

  // eslint-disable-next-line no-console
  console.log("Running benchmark against providers: " + enabled.join(", "));

  const results: BenchmarkRunResult[] = [];
  for (const provider of enabled) {
    // eslint-disable-next-line no-console
    console.log("\nBenchmarking " + provider + "...");
    const result = await runProviderBenchmark(provider, retryLimit);
    results.push(result);
    // eslint-disable-next-line no-console
    console.log(
      provider + ": " + (result.success ? "SUCCESS" : "FAILED") +
        " (" + result.totalResponseTimeMs + "ms)"
    );
  }

  const dir = ensureBenchmarkDir();
  const jsonPath = path.join(dir, "benchmark.json");
  const xlsxPath = path.join(dir, "benchmark.xlsx");
  const mdPath = path.join(dir, "benchmark.md");

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");
  writeExcel(results, xlsxPath);
  writeMarkdown(results, mdPath);

  // Print the formatted summary to console
  // eslint-disable-next-line no-console
  console.log(formatBenchmarkConsole(results));
  // eslint-disable-next-line no-console
  console.log("\nBenchmark artifacts written to " + dir);

  return results;
}
