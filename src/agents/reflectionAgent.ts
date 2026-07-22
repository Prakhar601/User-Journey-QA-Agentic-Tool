/**
 * ReflectionAgent - Phase 3 post-execution intelligence module.
 *
 * Produces a structured ReflectionReport by calling the active LLM provider
 * (GitHub Models, AMD, Ollama - whichever is configured) AFTER the adaptive
 * execution loop has fully completed.
 *
 * Strict isolation rules:
 *   - NEVER called inside the adaptive execution loop.
 *   - NEVER imports browser modules.
 *   - NEVER imports reporting modules.
 *   - NEVER contains provider-specific logic.
 *   - ALL failures are caught and return a safe fallback - execution must
 *     succeed even when reflection fails entirely.
 *
 * Provider routing uses callModel() from githubModelsClient.ts which is
 * itself fully provider-agnostic (routes via MODEL_PROVIDER / LLM_PROVIDER
 * environment variables through createModelProvider in providerFactory.ts).
 */

import { callModel } from "../ai/githubModelsClient";
import type {
  EvaluationResult,
  FailureClassification,
  ScenarioConfidence,
  ReflectionReport,
} from "../core/types";

// ---------------------------------------------------------------------------
// Public input interface
// ---------------------------------------------------------------------------

export interface ReflectionAgentInput {
  // ── Scenario context ──────────────────────────────────────────────────────
  /** Natural language description of what the scenario was trying to achieve. */
  scenarioGoal: string;
  /** Ordered list of step descriptions executed by the adaptive loop. */
  executedSteps: string[];
  /** The stop reason string produced by the adaptive loop at exit. */
  stopReason: string;
  /** Accumulated UI notes from the adaptive loop. */
  uiNotes: string;
  /** Whether the scenario ultimately passed all assertions. */
  pass: boolean;

  // ── Phase 2 intelligence results (required) ───────────────────────────────
  /** Structured evaluation from EvaluatorAgent. */
  evaluationResult: EvaluationResult;
  /** Structured failure classification from FailureClassifier. Absent on pass. */
  failureClassification?: FailureClassification;
  /** Confidence score from ConfidenceScorer. */
  scenarioConfidence: ScenarioConfidence;

  // ── Provider routing (pass-through from WorkflowConfig) ───────────────────
  /** LLM model identifier (e.g. "gpt-4o", "amd-llama-3", "llama3"). */
  model: string;
  /** API token / key for the active provider. */
  token: string;
  /** Optional LLM HTTP endpoint base URL (Ollama / AMD). */
  llmEndpoint?: string;
  /** Optional provider identifier ("github" | "amd" | "ollama"). */
  llmProvider?: string;
}

// ---------------------------------------------------------------------------
// Fallback report
// Returned whenever the LLM call fails or produces an unparseable response.
// MUST be kept in sync with the ReflectionReport interface.
// ---------------------------------------------------------------------------

const FALLBACK_REPORT: ReflectionReport = {
  summary: "Reflection unavailable.",
  rootCause: "The reflection model returned an invalid or empty response.",
  evidence: [],
  suggestions: [],
  shouldRetry: false,
  confidence: 0,
};

// ---------------------------------------------------------------------------
// Prompt builder
//
// Constraints communicated to the model:
//   - Return ONLY a JSON object — no markdown, no prose, no fences.
//   - summary: 2-3 sentences.
//   - rootCause: 1 paragraph.
//   - evidence: at most 5 items.
//   - suggestions: at most 5 items.
//   - shouldRetry: boolean.
//   - retryStrategy: string when shouldRetry is true, omit otherwise.
//   - confidence: number in [0.0, 1.0].
// ---------------------------------------------------------------------------

function buildReflectionPrompt(input: ReflectionAgentInput): string {
  const outcome = input.pass ? "PASSED" : "FAILED";
  const executedPreview = input.executedSteps.slice(-15).join("\n");
  const fulfilledList = input.evaluationResult.finalAssertionState.fulfilled.join(", ") || "none";
  const failedList = input.evaluationResult.finalAssertionState.failed.join(", ") || "none";
  const pendingList = input.evaluationResult.finalAssertionState.pending.join(", ") || "none";
  const failureClass = input.failureClassification
    ? `${input.failureClassification.primaryClass} (confidence: ${input.failureClassification.classificationConfidence.toFixed(2)})`
    : "N/A (scenario passed)";
  const isRecoverable = input.failureClassification?.isRecoverable ?? false;
  const classifierEvidence = input.failureClassification?.evidence.join("; ") ?? "";

  return `You are a QA analysis assistant for an autonomous browser testing agent.

Analyze the following test scenario execution and produce a structured reflection report.

Return ONLY a valid JSON object. No markdown. No code fences. No explanation outside the JSON.

JSON schema (all fields required except retryStrategy):
{
  "summary": "string — 2 to 3 sentences describing what happened and the outcome",
  "rootCause": "string — 1 paragraph identifying the most likely root cause",
  "evidence": ["string — up to 5 specific observable items supporting the root cause"],
  "suggestions": ["string — up to 5 concrete actionable improvements specific to this scenario"],
  "shouldRetry": true or false,
  "retryStrategy": "string — short retry strategy description (include ONLY when shouldRetry is true)",
  "confidence": number between 0.0 and 1.0
}

Rules:
- evidence must reference specific step names, assertion keys, or the stop reason.
- suggestions must be specific to this scenario, not generic advice.
- shouldRetry must be false for permanent failures such as wrong credentials or unresolvable assertions.
- shouldRetry must be ${isRecoverable ? "true if a different strategy could succeed" : "false (deterministic classifier marked this as non-recoverable)"}.
- confidence should reflect how certain you are in your analysis given the available evidence.
- Return ONLY the JSON object. No surrounding text.

=== EXECUTION SUMMARY ===
Scenario Goal: ${input.scenarioGoal}
Outcome: ${outcome}
Stop Reason: ${input.stopReason}
UI Notes: ${input.uiNotes.trim() || "(none)"}
Steps Executed (last 15): 
${executedPreview || "(none)"}

=== ASSERTION RESULTS ===
Total Assertions: ${input.evaluationResult.totalAssertions}
Fulfilled: ${fulfilledList}
Failed: ${failedList}
Pending at exit: ${pendingList}
Partial Score: ${(input.evaluationResult.partialScore * 100).toFixed(1)}%

=== FAILURE CLASSIFICATION ===
Class: ${failureClass}
Classifier Evidence: ${classifierEvidence || "(none)"}

=== CONFIDENCE SCORE ===
Score: ${(input.scenarioConfidence.score * 100).toFixed(1)}%
Explanation: ${input.scenarioConfidence.explanation}

Return ONLY the JSON object now.`;
}

// ---------------------------------------------------------------------------
// JSON parsing with defensive recovery
//
// Strategy:
//   1. Try JSON.parse on the trimmed raw response.
//   2. If that fails, extract the first {...} block and retry once.
//   3. If that also fails, return FALLBACK_REPORT.
// ---------------------------------------------------------------------------

function extractJsonBlock(raw: string): string | null {
  // Strip common markdown fences first.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }

  // Extract outermost {...} block.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1).trim();
  }

  return null;
}

function coerceToReflectionReport(parsed: unknown): ReflectionReport | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  const summary = typeof obj["summary"] === "string" ? obj["summary"].trim() : "";
  const rootCause = typeof obj["rootCause"] === "string" ? obj["rootCause"].trim() : "";

  if (!summary || !rootCause) {
    return null;
  }

  const evidence: string[] = [];
  if (Array.isArray(obj["evidence"])) {
    for (const item of obj["evidence"]) {
      if (typeof item === "string" && item.trim().length > 0) {
        evidence.push(item.trim());
        if (evidence.length >= 5) break;
      }
    }
  }

  const suggestions: string[] = [];
  if (Array.isArray(obj["suggestions"])) {
    for (const item of obj["suggestions"]) {
      if (typeof item === "string" && item.trim().length > 0) {
        suggestions.push(item.trim());
        if (suggestions.length >= 5) break;
      }
    }
  }

  const shouldRetry =
    typeof obj["shouldRetry"] === "boolean" ? obj["shouldRetry"] : false;

  const retryStrategy =
    shouldRetry && typeof obj["retryStrategy"] === "string" && obj["retryStrategy"].trim().length > 0
      ? obj["retryStrategy"].trim()
      : undefined;

  const rawConfidence = obj["confidence"];
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? Math.min(1.0, Math.max(0.0, rawConfidence))
      : 0.5;

  return {
    summary,
    rootCause,
    evidence,
    suggestions,
    shouldRetry,
    retryStrategy,
    confidence,
  };
}

function parseReflectionResponse(raw: string): ReflectionReport {
  // Attempt 1: direct parse on trimmed string.
  try {
    const direct = JSON.parse(raw.trim()) as unknown;
    const report = coerceToReflectionReport(direct);
    if (report) return report;
  } catch {
    // Fall through to recovery.
  }

  // Attempt 2: extract JSON block and retry.
  const extracted = extractJsonBlock(raw);
  if (extracted) {
    try {
      const recovered = JSON.parse(extracted) as unknown;
      const report = coerceToReflectionReport(recovered);
      if (report) return report;
    } catch {
      // Fall through to fallback.
    }
  }

  // All parsing failed - return the safe fallback.
  return { ...FALLBACK_REPORT };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a structured ReflectionReport for a completed scenario.
 *
 * This function MUST NEVER throw. All errors are caught internally and result
 * in a safe FALLBACK_REPORT being returned so that ScenarioResult assembly
 * and downstream reporting are never blocked by a reflection failure.
 *
 * Provider routing is fully handled by callModel() - the active provider is
 * determined by environment variables (MODEL_PROVIDER / LLM_PROVIDER), with
 * no provider-specific logic in this file.
 */
export async function runReflectionAgent(
  input: ReflectionAgentInput
): Promise<ReflectionReport> {
  try {
    const prompt = buildReflectionPrompt(input);

    const rawResponse = await callModel(input.model, prompt, input.token, {
      provider: input.llmProvider,
      endpoint: input.llmEndpoint,
      model: input.model,
    });

    return parseReflectionResponse(rawResponse);
  } catch (error) {
    // The LLM call failed (network error, timeout, provider error, etc.).
    // Log and return the safe fallback - execution must not be blocked.
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.warn(`[ReflectionAgent] Reflection failed: ${message}. Returning fallback report.`);
    return { ...FALLBACK_REPORT };
  }
}
