export interface WorkflowConfig {
  url: string;
  username: string;
  password: string;
  workflowDescriptions: string[];
  model: string;
  timeoutSeconds: number;
  githubToken: string;
  /**
   * Optional output directory path used for artifacts such as screenshots.
   * This is a relative folder name under the project root and is resolved
   * via the enterprise output manager.
   */
  outputDirPath?: string;
  /**
   * Automation tool identifier (runtime executor routing).
   * Expected: "playwright" | "selenium" (case-insensitive). Defaults to "playwright".
   */
  automationTool?: string;
  /**
   * When true (default), run workflows via the adaptive DOM-aware loop.
   * When false, preserve the legacy plan-based execution flow.
   */
  adaptiveMode?: boolean;

  /**
   * Optional LLM provider identifier. Defaults to "ollama" when not provided.
   */
  llmProvider?: string;

  /**
   * Optional LLM HTTP endpoint base URL (for example, Ollama).
   * When not provided, callers should resolve from environment variables
   * (for example, process.env.LLM_ENDPOINT) or an explicit workflow
   * configuration value.
   */
  llmEndpoint?: string;

  /**
   * Optional logical LLM model identifier. When not provided, defaults to
   * an environment variable (for example, process.env.LLM_MODEL) or an
   * explicit workflow configuration value.
   */
  llmModel?: string;

  /**
   * Optional fully-qualified path to the Python executable used for the
   * browser-use agent. When omitted, the system falls back to
   * process.env.PYTHON_PATH and then to "python".
   */
  pythonExecutablePath?: string;

  /**
   * Optional headless flag for browser-based automation. When undefined,
   * Playwright launches in headless mode by default.
   */
  headless?: boolean;
}

export interface Plan {
  interactionSteps: string[];
  expectedBehaviors: string[];
  networkValidationRules: string[];
}

export interface ExecutionIntelligenceContext {
  domLength: number;
  crawlStats: {
    pagesVisited: number;
    depthReached: number;
  };
  networkStats: {
    totalRequests: number;
    failedRequests: number;
    failedEndpoints: string[];
  };
}

/**
 * Compiled set of assertions derived from a natural-language scenario description.
 * Produced once by the goal parser before the adaptive execution loop begins.
 */
export interface AssertionContract {
  /** Substring or regex source the final page URL must match. */
  urlPattern?: string;
  /** Strings that must appear somewhere in the DOM at loop exit. */
  textPresent: string[];
  /** Strings that must NOT appear in the DOM at loop exit. */
  textAbsent: string[];
  /** ARIA labels or descriptive identifiers of elements that must be visible. */
  elementVisible: string[];
  /** URL substrings that must have been observed in network logs during the scenario. */
  apiCalled: string[];
  /** Whether a form submission (POST / PUT / PATCH) must have been observed. */
  formSubmitted: boolean;
}

/**
 * Runtime tracking state for an AssertionContract being evaluated step-by-step.
 * Each string value is the assertion key (e.g. the textPresent string, URL pattern, etc.).
 */
export interface AssertionState {
  /** Assertion keys that have been satisfied and are permanently locked in. */
  fulfilled: string[];
  /** Assertion keys that are actively contradicted by the current browser state. */
  failed: string[];
  /** Assertion keys not yet evaluated or not yet matching. */
  pending: string[];
}

export interface ScenarioResult {
  scenarioName: string;
  expected: string;
  actual: string;
  pass: boolean;
  networkValidation: string[];
  retryAttempted: boolean;
  notes: string;
  /**
   * Optional list of screenshot file paths captured during this scenario,
   * typically populated when failures or timeouts occur.
   */
  screenshots?: string[];
  /**
   * Structured summary of which assertions were fulfilled, failed, or still
   * pending at the time the adaptive execution loop exited.
   */
  assertionSummary?: {
    fulfilled: string[];
    failed: string[];
    pending: string[];
  };
  /**
   * Classified reason the execution loop stopped.
   * Examples: ALL_FULFILLED, TIMEOUT, MAX_STEPS, STUCK, ACTION_FAILED,
   * LLM_ERROR, ASSERTIONS_UNREACHABLE, EXPLICIT_STOP.
   */
  stopReason?: string;
  /**
   * Fraction of assertions fulfilled at loop exit (0.0–1.0).
   * 1.0 when the contract was empty (no assertions to check).
   */
  partialScore?: number;

  // ── Phase 2 additions ────────────────────────────────────────────────────
  /**
   * Deterministic failure taxonomy produced by FailureClassifier.
   * Absent when the scenario passed.
   */
  failureClassification?: FailureClassification;
  /**
   * Deterministic confidence score produced by ConfidenceScorer.
   * Always present on adaptive-mode scenarios.
   */
  confidence?: ScenarioConfidence;
  /**
   * Final assertion evaluation produced by EvaluatorAgent.
   * Always present on adaptive-mode scenarios.
   */
  evaluation?: EvaluationResult;

  // ── Phase 3 addition ──────────────────────────────────────────────────────
  /**
   * Structured LLM-generated analysis of what happened in this scenario.
   * Absent when reflection generation failed or was not requested.
   * Never blocks ScenarioResult assembly — its absence is always safe.
   */
  reflection?: ReflectionReport;
}

export interface AgentState {
  plan: Plan;
  // Raw network logs are intentionally typed as any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  networkLogs: any[];
  scenarioResults: ScenarioResult[];
  startTime: Date;
  timeoutSeconds: number;
}

// ── Phase 2: Failure Classification ─────────────────────────────────────────

/**
 * Deterministic failure taxonomy.
 * Produced by FailureClassifier — never requires an LLM call.
 */
export type FailureClass =
  | "SELECTOR_NOT_FOUND"
  | "ASSERTION_FAILED"
  | "TIMEOUT"
  | "STUCK_STATE"
  | "LOOP_DETECTED"
  | "LOGIN_FAILED"
  | "NAVIGATION_FAILED"
  | "NETWORK_FAILURE"
  | "LLM_FAILURE"
  | "SYSTEM_ERROR"
  | "UNKNOWN";

export interface FailureClassification {
  /** The dominant failure class. */
  primaryClass: FailureClass;
  /**
   * A secondary class when a secondary failure pattern is also evident.
   * Example: TIMEOUT that was preceded by STUCK_STATE.
   */
  secondaryClass?: FailureClass;
  /**
   * Confidence in the classification itself (0.0–1.0).
   * High values (> 0.8) mean the stop reason matched a specific pattern directly.
   * Lower values indicate heuristic inference.
   */
  classificationConfidence: number;
  /** Human-readable strings explaining why this class was chosen. */
  evidence: string[];
  /**
   * Whether the failure is considered recoverable by a retry or strategy change.
   * TIMEOUT, STUCK_STATE, LOOP_DETECTED, and SELECTOR_NOT_FOUND are recoverable.
   * ASSERTION_FAILED, LOGIN_FAILED, and SYSTEM_ERROR typically are not.
   */
  isRecoverable: boolean;
  // Phase 3 extension point: reflectionHints?: string[];
}

// ── Phase 2: Confidence Scoring ──────────────────────────────────────────────

/**
 * Scenario-level confidence score.
 * Produced by ConfidenceScorer — never requires an LLM call.
 */
export interface ScenarioConfidence {
  /**
   * Aggregate confidence score for the scenario (0.0–1.0).
   * Composite of assertionProgress, executionStability, and stopReasonScore.
   */
  score: number;
  /** Component scores that were averaged into the final score. */
  breakdown: {
    /** Fraction of assertions fulfilled (from partialScore). */
    assertionProgress: number;
    /** Penalty-adjusted stability of the execution path. */
    executionStability: number;
    /** Confidence signal derived from the loop exit reason. */
    stopReasonScore: number;
  };
  /** One-sentence human-readable explanation of the score. */
  explanation: string;
}

// ── Phase 2: Evaluation Result ───────────────────────────────────────────────

/**
 * Structured output of EvaluatorAgent.
 * Produced after the adaptive loop exits, using finalised assertion state.
 */
export interface EvaluationResult {
  /** AssertionState after finalising textAbsent assertions at loop exit. */
  finalAssertionState: AssertionState;
  /**
   * Fraction of assertions fulfilled after finalisation (0.0–1.0).
   * Matches computePartialScore(finalAssertionState, contract).
   */
  partialScore: number;
  /** Total number of assertions in the contract. */
  totalAssertions: number;
  /** Number of assertions in the fulfilled bucket after finalisation. */
  fulfilledCount: number;
  /** Number of assertions in the failed bucket after finalisation. */
  failedCount: number;
  /**
   * Number of assertions still pending after finalisation.
   * Non-zero only when textAbsent promotion left some keys unfulfilled
   * or when the loop exited before all assertions could be checked.
   */
  pendingCount: number;
  /**
   * True when all assertions are fulfilled and no step execution failure occurred.
   * Identical to the pass flag computed in the orchestrator, reproduced here
   * for self-contained reporting.
   */
  pass: boolean;
  /** Free-text notes about the evaluation, e.g. which assertions remained pending. */
  evaluationNotes: string;
}

// ── Phase 3: Reflection Report ─────────────────────────────────────────────

/**
 * Structured LLM-generated analysis of a completed scenario.
 * Produced by ReflectionAgent after ConfidenceScorer.
 *
 * The model is expected to return strict JSON matching this schema.
 * All string fields are bounded (see reflectionAgent.ts for prompt constraints).
 */
export interface ReflectionReport {
  /**
   * 2–3 sentence plain-language summary of what happened in the scenario.
   * Covers outcome, key events, and overall assessment.
   */
  summary: string;
  /**
   * 1 paragraph explanation of the most likely root cause of failure
   * (or confirmation of success). References specific steps or assertions.
   */
  rootCause: string;
  /**
   * Up to 5 specific, observable pieces of evidence that support the
   * root cause conclusion (step names, assertion keys, stop reason).
   */
  evidence: string[];
  /**
   * Up to 5 concrete, actionable improvement suggestions.
   * Must be specific to this scenario — not generic advice.
   */
  suggestions: string[];
  /**
   * Whether the ReflectionAgent believes a retry with a different strategy
   * could succeed. False for permanent failures (wrong credentials, etc.).
   */
  shouldRetry: boolean;
  /**
   * When shouldRetry is true, a short description of the recommended
   * retry strategy. Absent when shouldRetry is false.
   */
  retryStrategy?: string;
  /**
   * ReflectionAgent confidence in its own analysis (0.0–1.0).
   * 0 indicates the fallback was returned. 1 indicates high certainty.
   */
  confidence: number;
}
