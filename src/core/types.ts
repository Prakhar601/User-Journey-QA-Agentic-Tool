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
