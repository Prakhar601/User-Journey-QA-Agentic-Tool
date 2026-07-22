/**
 * FailureClassifier - Phase 2 execution intelligence module.
 *
 * Converts raw execution signals into a deterministic, human-readable
 * failure taxonomy. This module MUST NOT call an LLM. All logic is
 * pure keyword/pattern matching on observable execution data.
 *
 * Output feeds directly into the Phase 3 Reflection Agent.
 */

import type {
  AssertionState,
  FailureClass,
  FailureClassification,
} from "../core/types";

// ---------------------------------------------------------------------------
// Public input interface
// ---------------------------------------------------------------------------

export interface FailureClassifierInput {
  /** The stop reason string produced by the adaptive execution loop. */
  stopReason: string;
  /** Final (post-finalisation) assertion state from EvaluatorAgent. */
  assertionState: AssertionState;
  /** Ordered list of step description strings executed during the scenario. */
  executedSteps: string[];
  /** True when at least one step dispatch returned a failure result. */
  stepExecutionFailed: boolean;
  /** True when the loop attempted at least one automatic retry. */
  retryAttempted: boolean;
  /** Accumulated UI notes from the adaptive loop (debug context). */
  uiNotes: string;
  /** Whether the scenario ultimately passed. */
  pass: boolean;
}

// ---------------------------------------------------------------------------
// Recoverable-class lookup
// ---------------------------------------------------------------------------

/**
 * Classes where a strategy change or retry has a reasonable chance of success.
 * Used to populate FailureClassification.isRecoverable.
 */
const RECOVERABLE_CLASSES = new Set<FailureClass>([
  "TIMEOUT",
  "STUCK_STATE",
  "LOOP_DETECTED",
  "SELECTOR_NOT_FOUND",
  "NAVIGATION_FAILED",
  "LLM_FAILURE",
]);

// ---------------------------------------------------------------------------
// Classification rules
//
// Rules are evaluated in priority order - the FIRST match wins the primary
// class. The full list is still scanned for a secondary class if one exists
// with a different category.
// ---------------------------------------------------------------------------

interface ClassificationRule {
  /** Candidate class this rule proposes. */
  cls: FailureClass;
  /** Human-readable explanation appended to evidence[] when this rule fires. */
  reason: string;
  /**
   * Confidence in the classification when this rule fires exclusively.
   * Higher when based on a direct stopReason match; lower for heuristics.
   */
  confidence: number;
  /** Returns true when the rule applies to the given input. */
  test: (input: FailureClassifierInput) => boolean;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // Direct stop-reason matches (high confidence)
  {
    cls: "TIMEOUT",
    reason: "Stop reason indicates a deadline or timeout was reached.",
    confidence: 0.95,
    test: ({ stopReason }) =>
      /timeout/i.test(stopReason) || stopReason.includes("MAX_STEPS"),
  },
  {
    cls: "STUCK_STATE",
    reason: "Stop reason indicates the DOM did not change after retries.",
    confidence: 0.95,
    test: ({ stopReason }) => /stuck/i.test(stopReason),
  },
  {
    cls: "LOOP_DETECTED",
    reason: "Stop reason indicates a repeated action cycle was detected.",
    confidence: 0.95,
    test: ({ stopReason }) => /LOOP_DETECTED/i.test(stopReason),
  },
  {
    cls: "LLM_FAILURE",
    reason: "Stop reason indicates the language model failed to produce a valid action.",
    confidence: 0.95,
    test: ({ stopReason }) =>
      /model decision error/i.test(stopReason) ||
      /LLM/i.test(stopReason) ||
      /Model failed/i.test(stopReason),
  },
  {
    cls: "NAVIGATION_FAILED",
    reason: "Stop reason indicates a navigation or page load failure.",
    confidence: 0.90,
    test: ({ stopReason }) =>
      /navigation/i.test(stopReason) ||
      /NAVIGATION_BLOCKED/i.test(stopReason) ||
      /page.*load/i.test(stopReason),
  },
  {
    cls: "SYSTEM_ERROR",
    reason: "Stop reason indicates an unexpected system-level error.",
    confidence: 0.90,
    test: ({ stopReason }) =>
      /SYSTEM_ERROR/i.test(stopReason) ||
      /capture.*state/i.test(stopReason) ||
      /DOM\/network/i.test(stopReason),
  },
  // Assertion-state heuristics (medium confidence)
  {
    cls: "ASSERTION_FAILED",
    reason: "One or more assertions were permanently failed at loop exit.",
    confidence: 0.85,
    test: ({ assertionState }) => assertionState.failed.length > 0,
  },
  {
    cls: "ASSERTION_FAILED",
    reason: "Stop reason indicates assertions could not be satisfied.",
    confidence: 0.85,
    test: ({ stopReason }) => /ASSERTIONS_UNREACHABLE/i.test(stopReason),
  },
  // Step-execution heuristics (medium confidence)
  {
    cls: "SELECTOR_NOT_FOUND",
    reason: "Step execution failed, likely because a selector could not be resolved.",
    confidence: 0.75,
    test: ({ stepExecutionFailed, stopReason }) =>
      stepExecutionFailed && /ACTION_FAILED/i.test(stopReason),
  },
  // Login-flow heuristic (lower confidence - inferred from step sequence)
  {
    cls: "LOGIN_FAILED",
    reason: "Execution included credential entry steps but never progressed past login.",
    confidence: 0.65,
    test: ({ executedSteps, assertionState }) => {
      const stepsText = executedSteps.join(" ").toUpperCase();
      const hasCredentialEntry =
        stepsText.includes("TYPE") && stepsText.includes("CLICK");
      const urlNotFulfilled = assertionState.fulfilled.every(
        (k) => !k.startsWith("urlPattern")
      );
      const hasUrlAssertion =
        assertionState.fulfilled.some((k) => k.startsWith("urlPattern")) ||
        assertionState.failed.some((k) => k.startsWith("urlPattern")) ||
        assertionState.pending.some((k) => k.startsWith("urlPattern"));
      return hasCredentialEntry && hasUrlAssertion && urlNotFulfilled;
    },
  },
  // Network-failure heuristic
  {
    cls: "NETWORK_FAILURE",
    reason: "UI notes mention network errors or failed HTTP requests.",
    confidence: 0.70,
    test: ({ uiNotes }) =>
      /network/i.test(uiNotes) ||
      /4[0-9]{2}|5[0-9]{2}/i.test(uiNotes) ||
      /failed.*request/i.test(uiNotes),
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify the failure mode of a completed (failing) scenario.
 *
 * Always returns a FailureClassification. When no rule fires,
 * the primary class is UNKNOWN with low confidence.
 *
 * Must never throw - classification failure is itself a non-fatal event.
 */
export function classifyFailure(
  input: FailureClassifierInput
): FailureClassification {
  // Passing scenarios should not be classified.
  if (input.pass) {
    return {
      primaryClass: "UNKNOWN",
      classificationConfidence: 1.0,
      evidence: ["Scenario passed - no failure to classify."],
      isRecoverable: false,
    };
  }

  const evidence: string[] = [];
  let primaryClass: FailureClass | null = null;
  let primaryConfidence = 0;
  let secondaryClass: FailureClass | undefined;

  for (const rule of CLASSIFICATION_RULES) {
    let matched = false;
    try {
      matched = rule.test(input);
    } catch {
      // A rule that throws is treated as non-matching.
      continue;
    }

    if (!matched) {
      continue;
    }

    evidence.push(`[${rule.cls}] ${rule.reason}`);

    if (primaryClass === null) {
      primaryClass = rule.cls;
      primaryConfidence = rule.confidence;
    } else if (rule.cls !== primaryClass && secondaryClass === undefined) {
      secondaryClass = rule.cls;
    }

    if (primaryClass !== null && secondaryClass !== undefined) {
      break;
    }
  }

  // Fallback when no rule matched.
  if (primaryClass === null) {
    primaryClass = "UNKNOWN";
    primaryConfidence = 0.40;
    evidence.push(
      `[UNKNOWN] No specific failure pattern matched. stopReason="${input.stopReason}".`
    );
  }

  return {
    primaryClass,
    secondaryClass,
    classificationConfidence: primaryConfidence,
    evidence,
    isRecoverable: RECOVERABLE_CLASSES.has(primaryClass),
  };
}
