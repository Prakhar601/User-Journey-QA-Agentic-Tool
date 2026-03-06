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
