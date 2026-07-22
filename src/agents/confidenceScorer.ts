/**
 * ConfidenceScorer - Phase 2 execution intelligence module.
 *
 * Produces a deterministic, observable-signal-based confidence score for
 * each completed scenario. This module MUST NOT call an LLM.
 *
 * Score = (assertionProgress * 0.50) + (executionStability * 0.30) + (stopReasonScore * 0.20)
 *
 * All component values are clamped to [0.0, 1.0].
 * The final score is rounded to 4 decimal places for clean display.
 */

import type {
  AssertionContract,
  AssertionState,
  ScenarioConfidence,
} from "../core/types";

// ---------------------------------------------------------------------------
// Public input interface
// ---------------------------------------------------------------------------

export interface ConfidenceScorerInput {
  /** Final assertion state produced by EvaluatorAgent (post-finalisation). */
  assertionState: AssertionState;
  /** The assertion contract compiled before the adaptive loop ran. */
  assertionContract: AssertionContract;
  /** The stop reason string produced by the adaptive execution loop. */
  stopReason: string;
  /** Ordered list of step description strings executed during the scenario. */
  executedSteps: string[];
  /** True when at least one step dispatch returned a failure result. */
  stepExecutionFailed: boolean;
  /** True when the loop attempted at least one automatic retry. */
  retryAttempted: boolean;
  /**
   * Partial score already computed by EvaluatorAgent
   * (computePartialScore result after textAbsent finalisation).
   */
  partialScore: number;
  /** Accumulated UI notes from the adaptive loop. */
  uiNotes: string;
}

// ---------------------------------------------------------------------------
// Stop-reason score table
//
// Maps known stop-reason patterns to a [0.0-1.0] quality signal.
// Higher score = the loop exited for a "good" reason.
// ---------------------------------------------------------------------------

interface StopReasonEntry {
  pattern: RegExp;
  score: number;
  label: string;
}

const STOP_REASON_TABLE: StopReasonEntry[] = [
  {
    pattern: /ALL_FULFILLED/,
    score: 1.00,
    label: "all assertions fulfilled",
  },
  {
    pattern: /EXPLICIT_STOP/,
    score: 0.85,
    label: "agent explicitly stopped after goal assessment",
  },
  {
    pattern: /ACTION_FAILED/,
    score: 0.30,
    label: "a step action failed to execute",
  },
  {
    pattern: /ASSERTIONS_UNREACHABLE/,
    score: 0.25,
    label: "assertions could not be satisfied",
  },
  {
    pattern: /LOOP_DETECTED/,
    score: 0.15,
    label: "repeated action cycle detected",
  },
  {
    pattern: /stuck/i,
    score: 0.10,
    label: "DOM stuck — page did not change",
  },
  {
    pattern: /timeout/i,
    score: 0.15,
    label: "execution deadline reached",
  },
  {
    pattern: /MAX_STEPS/,
    score: 0.20,
    label: "maximum step limit reached",
  },
  {
    pattern: /model decision error/i,
    score: 0.20,
    label: "language model returned an invalid action",
  },
];

// ---------------------------------------------------------------------------
// Component scorers
// ---------------------------------------------------------------------------

/**
 * assertionProgress component (weight 0.50).
 * Directly uses the partialScore from the evaluator (already 0.0-1.0).
 */
function scoreAssertionProgress(partialScore: number): number {
  return clamp(partialScore);
}

/**
 * executionStability component (weight 0.30).
 * Starts at 1.0 and applies penalties for instability signals.
 */
function scoreExecutionStability(input: ConfidenceScorerInput): number {
  let score = 1.0;

  if (input.stepExecutionFailed) {
    score -= 0.35;
  }
  if (input.retryAttempted) {
    score -= 0.10;
  }
  if (/LOOP_DETECTED/i.test(input.stopReason)) {
    score -= 0.25;
  }
  if (/stuck/i.test(input.stopReason)) {
    score -= 0.30;
  }
  if (/Cycle suppressed/i.test(input.uiNotes)) {
    score -= 0.10;
  }
  if (/STOP rejected/i.test(input.uiNotes)) {
    // The loop had to push back against premature STOP signals.
    score -= 0.05;
  }

  return clamp(score);
}

/**
 * stopReasonScore component (weight 0.20).
 * Uses the stop-reason table; falls back to 0.40 for unrecognised patterns.
 */
function scoreStopReason(stopReason: string): number {
  for (const entry of STOP_REASON_TABLE) {
    if (entry.pattern.test(stopReason)) {
      return entry.score;
    }
  }
  return 0.40; // Unknown stop reason — neutral-low score.
}

// ---------------------------------------------------------------------------
// Explanation builder
// ---------------------------------------------------------------------------

function buildExplanation(
  assertionProgress: number,
  executionStability: number,
  stopReasonScore: number,
  finalScore: number,
  stopReason: string
): string {
  const stopLabel = resolveStopLabel(stopReason);
  const progressPct = Math.round(assertionProgress * 100);
  const stabilityPct = Math.round(executionStability * 100);

  const grade =
    finalScore >= 0.85
      ? "high"
      : finalScore >= 0.60
      ? "moderate"
      : finalScore >= 0.35
      ? "low"
      : "very low";

  return (
    `Confidence ${grade} (${Math.round(finalScore * 100)}%): ` +
    `${progressPct}% assertions fulfilled, ` +
    `execution stability ${stabilityPct}%, ` +
    `stop reason "${stopLabel}" (score=${Math.round(stopReasonScore * 100)}%).`
  );
}

function resolveStopLabel(stopReason: string): string {
  for (const entry of STOP_REASON_TABLE) {
    if (entry.pattern.test(stopReason)) {
      return entry.label;
    }
  }
  return stopReason.replace(/^Stopped:\s*/i, "").trim() || "unknown";
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.min(1.0, Math.max(0.0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic scenario-level confidence score.
 *
 * Must never throw - a safe fallback of 0.0 is returned if an error occurs.
 */
export function scoreScenarioConfidence(
  input: ConfidenceScorerInput
): ScenarioConfidence {
  try {
    const assertionProgress = scoreAssertionProgress(input.partialScore);
    const executionStability = scoreExecutionStability(input);
    const stopReasonScore = scoreStopReason(input.stopReason);

    const rawScore =
      assertionProgress * 0.50 +
      executionStability * 0.30 +
      stopReasonScore * 0.20;

    const score = round4(clamp(rawScore));

    return {
      score,
      breakdown: {
        assertionProgress: round4(assertionProgress),
        executionStability: round4(executionStability),
        stopReasonScore: round4(stopReasonScore),
      },
      explanation: buildExplanation(
        assertionProgress,
        executionStability,
        stopReasonScore,
        score,
        input.stopReason
      ),
    };
  } catch {
    // Defensive fallback: scoring must never crash the caller.
    return {
      score: 0.0,
      breakdown: {
        assertionProgress: 0.0,
        executionStability: 0.0,
        stopReasonScore: 0.0,
      },
      explanation: "Confidence scoring failed unexpectedly.",
    };
  }
}
