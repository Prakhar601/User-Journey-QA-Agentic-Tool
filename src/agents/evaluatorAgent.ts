/**
 * EvaluatorAgent - Phase 2 activation.
 *
 * Finalises assertion state at loop exit and computes the authoritative
 * pass/fail verdict with structured output.
 *
 * This module deliberately has no LLM dependency. It reuses the
 * deterministic helpers already implemented in assertionChecker.ts:
 *   - finaliseTextAbsentAssertions(): promotes pending textAbsent keys to
 *     fulfilled when the forbidden text was never found.
 *   - computePartialScore(): returns fulfilled / total assertions as a
 *     fraction in [0.0, 1.0].
 *
 * The Phase 3 Reflection Agent will receive EvaluationResult as one of its
 * inputs. Leave the public interface stable.
 */

import {
  finaliseTextAbsentAssertions,
  computePartialScore,
  contractToKeys,
} from "../browser/assertionChecker";
import type {
  AssertionContract,
  AssertionState,
  EvaluationResult,
} from "../core/types";

// ---------------------------------------------------------------------------
// Public input interface
// ---------------------------------------------------------------------------

export interface EvaluatorInput {
  /** The raw assertion state returned by the adaptive execution loop. */
  assertionState: AssertionState;
  /**
   * The assertion contract compiled before the loop ran.
   * Required to finalise textAbsent keys and to compute the total count.
   */
  assertionContract: AssertionContract;
  /** True when at least one step dispatch returned a failure result. */
  stepExecutionFailed: boolean;
  /** The stop reason string produced by the loop. */
  stopReason: string;
  /** Ordered list of step descriptions executed during the scenario. */
  executedSteps: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Finalise and evaluate a completed adaptive execution scenario.
 *
 * 1. Promotes pending textAbsent assertions to fulfilled (text was absent
 *    throughout the entire run, so the assertion is satisfied at exit).
 * 2. Computes the authoritative partialScore on the finalised state.
 * 3. Returns a structured EvaluationResult for downstream consumers
 *    (ConfidenceScorer, FailureClassifier, Reporting, Phase 3 Reflection).
 *
 * This function is synchronous internally but declared async to keep the
 * public interface consistent with other agent entry points.
 */
export async function runEvaluatorAgent(
  input: EvaluatorInput
): Promise<EvaluationResult> {
  // Step 1: Finalise textAbsent assertions.
  // Any textAbsent key that is still pending at loop exit means the forbidden
  // text was never found - that is a passing condition, so promote to fulfilled.
  const finalAssertionState: AssertionState = finaliseTextAbsentAssertions(
    input.assertionContract,
    input.assertionState
  );

  // Step 2: Compute the authoritative partial score on the finalised state.
  const partialScore: number = computePartialScore(
    finalAssertionState,
    input.assertionContract
  );

  // Step 3: Count assertion buckets.
  const totalAssertions: number = contractToKeys(input.assertionContract).length;
  const fulfilledCount: number = finalAssertionState.fulfilled.length;
  const failedCount: number = finalAssertionState.failed.length;
  const pendingCount: number = finalAssertionState.pending.length;

  // Step 4: Compute authoritative pass verdict.
  // Mirrors the orchestrator logic but operates on the finalised state.
  const allFulfilled =
    totalAssertions > 0 &&
    pendingCount === 0 &&
    failedCount === 0;

  const pass = allFulfilled && !input.stepExecutionFailed;

  // Step 5: Build evaluation notes for reporting and reflection.
  const notes = buildEvaluationNotes(
    finalAssertionState,
    totalAssertions,
    pass,
    input.stopReason,
    input.executedSteps.length
  );

  return {
    finalAssertionState,
    partialScore,
    totalAssertions,
    fulfilledCount,
    failedCount,
    pendingCount,
    pass,
    evaluationNotes: notes,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildEvaluationNotes(
  state: AssertionState,
  total: number,
  pass: boolean,
  stopReason: string,
  stepCount: number
): string {
  if (total === 0) {
    return `No assertion contract (vacuously ${pass ? "satisfied" : "failed"}). ` +
           `${stepCount} step(s) executed. Stop: ${stopReason}.`;
  }

  const parts: string[] = [];

  parts.push(
    `${state.fulfilled.length}/${total} assertions fulfilled.`
  );

  if (state.failed.length > 0) {
    parts.push(`Failed: [${state.failed.join(", ")}].`);
  }

  if (state.pending.length > 0) {
    parts.push(`Still pending: [${state.pending.join(", ")}].`);
  }

  parts.push(`${stepCount} step(s) executed.`);
  parts.push(`Stop reason: ${stopReason}.`);

  return parts.join(" ");
}
