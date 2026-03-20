import * as path from "path";
import type {
  AgentState,
  AssertionContract,
  AssertionState,
  ExecutionIntelligenceContext,
  Plan,
  ScenarioResult,
  WorkflowConfig,
} from "./types";
import { initializeState } from "./state";
import { BrowserController } from "../browser/browserController";
import { SeleniumBrowserController } from "../browser/seleniumBrowserController";
import { createPlan } from "../agents/plannerAgent";
import { runPythonAgent, PythonBrowserState } from "../ai/mcpClient";
import { callModel } from "../ai/githubModelsClient";
import { analyzeNetwork } from "../browser/networkAnalyzer";
import { ensureEnterpriseOutputStructure } from "../reporting/outputManager";
import { parseInteractiveElements } from "../browser/domParser";
import type { RichElement } from "../browser/domParser";
import {
  dispatchAction,
  type AdaptiveNextAction as DispatcherNextAction,
} from "../browser/actionDispatcher";
import {
  parseGoalToContract,
  evaluateAssertions,
  finaliseTextAbsentAssertions,
  initAssertionState,
  computePartialScore,
} from "../browser/assertionChecker";

type AutomationToolId = "playwright" | "selenium";

type AutomationController = {
  launchBrowser(): Promise<void>;
  login(url: string, username: string, password: string): Promise<void>;
  click(selector: string): Promise<void>;
  scroll(): Promise<void>;
  getDOMSnapshot(): Promise<string>;
  getNetworkLogs(): Promise<Array<{ url: string; method?: string; status?: number | null; durationMs?: number | null }>>;
  captureScreenshot(filePath: string): Promise<void>;
  waitForTimeout?(ms: number): Promise<void>;
  close(): Promise<void>;
  // New methods added by the adaptive loop refactor:
  fill?(selector: string, value: string): Promise<void>;
  selectOption?(selector: string, value: string): Promise<void>;
  hover?(selector: string): Promise<void>;
  navigate?(url: string): Promise<void>;
  isVisible?(selector: string): Promise<boolean>;
};

let phase4Logged: boolean = false;

export async function runWorkflow(config: WorkflowConfig): Promise<AgentState> {
  const startTime: Date = new Date();
  const deadlineMs: number =
    startTime.getTime() + config.timeoutSeconds * 1000;
  const adaptiveMode: boolean = config.adaptiveMode ?? true;

  const { screenshotsDir } = await ensureEnterpriseOutputStructure({
    outputDirPath: config.outputDirPath,
  });

  const toolRaw: string =
    typeof config.automationTool === "string" ? config.automationTool : "playwright";
  const tool: AutomationToolId =
    toolRaw.trim().toLowerCase() === "selenium" ? "selenium" : "playwright";

  const headless: boolean = config.headless ?? true;

  const browser: AutomationController =
    tool === "selenium"
      ? new SeleniumBrowserController(config.timeoutSeconds, headless)
      : new BrowserController(config.timeoutSeconds, headless);

  if (!phase4Logged) {
    // eslint-disable-next-line no-console
    console.log("Phase 4 complete – true dual tool execution enabled");
    phase4Logged = true;
  }

  const scenarioResults: ScenarioResult[] = [];
  let latestPlan: Plan = {
    interactionSteps: [],
    expectedBehaviors: [],
    networkValidationRules: [],
  };

  try {
    await initializeState();

    // Workflow 1: delegate initial state capture to the Python browser-use agent.
    // Wrapped in try/catch — if the Python agent fails, continue with empty state.
    let initialDomSnapshot: string = "";
    let initialEndpoints: string[] = [];
    let executionContext: ExecutionIntelligenceContext = buildExecutionIntelligenceContext({
      url: "", title: "", dom_snapshot: "", buttons: [], inputs: [], links: [], network_logs: [],
    });
    try {
      const pythonState: PythonBrowserState = await runPythonAgent({
        url: config.url,
        username: config.username,
        password: config.password,
        instruction:
          "Log in to the application and navigate to the main page for automated workflow planning.",
        pythonExecutablePath: config.pythonExecutablePath,
      });
      initialDomSnapshot = pythonState.dom_snapshot;
      initialEndpoints = Array.from(
        new Set(
          (pythonState.network_logs ?? [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((entry: any) =>
              entry && typeof entry.url === "string" ? entry.url : ""
            )
            .filter((url: string) => url.length > 0)
        )
      );
      executionContext = buildExecutionIntelligenceContext(pythonState);
    } catch (pythonError) {
      const pythonMsg = pythonError instanceof Error ? pythonError.message : String(pythonError);
      console.error();
      console.log("Continuing without Python agent state — Playwright session will proceed independently.");
    }

    // Launch the automation browser for executing the planned steps.
    await browser.launchBrowser();
    await browser.login(config.url, config.username, config.password);

    for (const workflowDescription of config.workflowDescriptions) {
      if (Date.now() > deadlineMs) {
        break;
      }

      if (adaptiveMode === true) {
        const networkValidationNotes: string[] = [];
        const baselineNetworkLogsLength: number = (
          await browser.getNetworkLogs()
        ).length;

        const scenarioStartTimeMs: number = Date.now();

        // Compile assertion contract from scenario description before the loop.
        const assertionContract: AssertionContract = await parseGoalToContract(
          workflowDescription,
          config.model,
          config.githubToken,
          config.llmEndpoint,
          config.llmProvider
        );

        // Capture Playwright-session DOM baseline immediately after login.
        // This avoids the cross-session baseline problem with pythonState.dom_snapshot.
        const playwrightInitialDom: string = await browser.getDOMSnapshot().catch(() => "");
        const playwrightInitialDomHash: string = hashDomSnapshotStatic(playwrightInitialDom);

        const adaptiveResult: AdaptiveExecutionResult =
          await adaptiveExecutionLoop({
            browser,
            tool,
            workflowDescription,
            model: config.model,
            token: config.githubToken,
            llmEndpoint: config.llmEndpoint,
            llmProvider: config.llmProvider,
            deadlineMs,
            maxSteps: 25,
            screenshotsDir,
            assertionContract,
            initialDomHash: playwrightInitialDomHash,
          });

        latestPlan = {
          interactionSteps: adaptiveResult.executedSteps,
          expectedBehaviors: [
            `Adaptive execution for scenario: ${workflowDescription}`,
            adaptiveResult.stopReason,
          ],
          networkValidationRules: [],
        };

        const postDomSnapshot: string = await browser.getDOMSnapshot();
        const scenarioEndTimeMs: number = Date.now();
        const postDomHash: string = hashDomSnapshotStatic(postDomSnapshot);
        const uiChanged: boolean = postDomHash !== playwrightInitialDomHash;

        const allNetworkLogs = await browser.getNetworkLogs();
        const allEndpoints: string[] = allNetworkLogs.map((entry) => entry.url);

        const scenarioNetworkLogs = allNetworkLogs.slice(
          baselineNetworkLogsLength
        );

        for (const rule of latestPlan.networkValidationRules) {
          const matched: boolean = allEndpoints.some((endpoint) =>
            endpoint.includes(rule)
          );
          if (!matched) {
            networkValidationNotes.push(
              `No network call matched validation rule: "${rule}".`
            );
          }
        }

        const expected: string = latestPlan.expectedBehaviors.join("\n");
        const actualParts: string[] = [];

        if (uiChanged) {
          actualParts.push("UI changed during workflow.");
        } else {
          actualParts.push("UI change not detected via DOM diff (may still be functional change).");
        }

        if (networkValidationNotes.length === 0) {
          actualParts.push("All network validation rules satisfied.");
        } else {
          actualParts.push(networkValidationNotes.join(" "));
        }

        if (adaptiveResult.uiNotes.trim().length > 0) {
          actualParts.push(adaptiveResult.uiNotes.trim());
        }

        type ScenarioNetworkLogEntry = {
          url?: string;
          method?: string;
          status?: number | null;
          durationMs?: number | null;
          contentType?: string;
        };

        const apiLikeEntries: ScenarioNetworkLogEntry[] =
          scenarioNetworkLogs.filter((entry: unknown) => {
            if (!entry || typeof entry !== "object") {
              return false;
            }

            const e = entry as ScenarioNetworkLogEntry & {
              responseHeaders?: Record<string, string>;
            };

            const url: string = typeof e.url === "string" ? e.url : "";
            const method: string =
              typeof e.method === "string" ? e.method.toUpperCase() : "";
            const headerContentType: string | undefined =
              e.responseHeaders?.["content-type"];
            const contentType: string = (
              typeof e.contentType === "string"
                ? e.contentType
                : headerContentType ?? ""
            ).toLowerCase();

            if (!url) {
              return false;
            }

            if (
              url.startsWith("data:") ||
              url.startsWith("about:") ||
              url.startsWith("chrome:")
            ) {
              return false;
            }

            if (
              url.match(
                /\.(png|jpe?g|gif|svg|css|js|woff2?|ttf|ico|map)(\?|$)/i
              )
            ) {
              return false;
            }

            if (
              method === "POST" ||
              method === "PUT" ||
              method === "PATCH" ||
              method === "DELETE"
            ) {
              return true;
            }

            if (contentType.includes("application/json")) {
              return true;
            }

            const lowerUrl = url.toLowerCase();
            if (
              lowerUrl.includes("/api/") ||
              lowerUrl.includes("/graphql") ||
              lowerUrl.includes("/auth") ||
              lowerUrl.includes("/login")
            ) {
              return true;
            }

            return false;
          });

        let metricsForScenario: ReturnType<typeof analyzeNetwork> | null = null;

        if (apiLikeEntries.length === 0) {
          actualParts.push("No external API interaction detected.");
        } else {
          const networkData = apiLikeEntries.map((entry) => {
            const url: string =
              typeof entry.url === "string" ? entry.url : "";
            const method: string =
              typeof entry.method === "string"
                ? entry.method.toUpperCase()
                : "GET";
            const status: number =
              typeof entry.status === "number" ? entry.status : 0;
            const durationMs: number =
              typeof entry.durationMs === "number" &&
              Number.isFinite(entry.durationMs) &&
              entry.durationMs >= 0
                ? entry.durationMs
                : 0;

            const duration: number = durationMs;
            const startTime: number = 0;
            const endTime: number = duration;

            return {
              url,
              method,
              status,
              startTime,
              endTime,
              duration,
              resourceType: "xhr",
            };
          });

          const metrics = analyzeNetwork(networkData);
          metricsForScenario = metrics;

          if (metrics.totalApiCalls === 0) {
            actualParts.push("No external API interaction detected.");
          } else {
            const networkSummary =
              `Network analysis: Total API calls: ${metrics.totalApiCalls}, ` +
              `Average latency: ${Math.round(metrics.averageLatency)} ms, ` +
              `Total API time: ${metrics.totalApiTime} ms, ` +
              `Unique API endpoints: ${metrics.apiCalls.length}.`;

            actualParts.push(networkSummary);
          }
        }

        const actual: string = actualParts.join(" ");

        // Assertion-driven pass/fail: strict — all assertions must be fulfilled.
        const totalAssertions =
          adaptiveResult.assertionState.fulfilled.length +
          adaptiveResult.assertionState.failed.length +
          adaptiveResult.assertionState.pending.length;
        let pass =
          totalAssertions > 0 &&
          adaptiveResult.assertionState.pending.length === 0 &&
          adaptiveResult.assertionState.failed.length === 0 &&
          !adaptiveResult.stepExecutionFailed;

        if (adaptiveResult.stopReason.includes("LOOP_DETECTED")) {
          if (adaptiveResult.assertionState.pending.length > 0) {
            pass = false;
          }
        }

        const scenarioResult: ScenarioResult = {
          scenarioName: workflowDescription,
          expected,
          actual,
          pass,
          networkValidation: networkValidationNotes,
          retryAttempted: adaptiveResult.retryAttempted,
          notes: adaptiveResult.uiNotes.trim(),
          screenshots:
            adaptiveResult.screenshots && adaptiveResult.screenshots.length > 0
              ? adaptiveResult.screenshots.slice()
              : undefined,
          assertionSummary: {
            fulfilled: adaptiveResult.assertionState.fulfilled.slice(),
            failed: adaptiveResult.assertionState.failed.slice(),
            pending: adaptiveResult.assertionState.pending.slice(),
          },
          stopReason: adaptiveResult.stopReason,
          partialScore: adaptiveResult.partialScore,
        };

        if (metricsForScenario) {
          const augmented = scenarioResult as unknown as {
            networkMetrics?: {
              totalApiCalls: number;
              averageLatency: number;
              totalApiTime: number;
            };
            scenarioStartTimeMs?: number;
            scenarioEndTimeMs?: number;
          };
          augmented.networkMetrics = metricsForScenario;
          augmented.scenarioStartTimeMs = scenarioStartTimeMs;
          augmented.scenarioEndTimeMs = scenarioEndTimeMs;
        }

        scenarioResults.push(scenarioResult);

        if (Date.now() > deadlineMs) {
          break;
        }

        continue;
      }

      let plan: Plan;
      try {
        plan = await createPlan(
          [workflowDescription],
          initialDomSnapshot,
          initialEndpoints,
          config.model,
          config.githubToken,
          executionContext,
          config.llmEndpoint,
          config.llmProvider
        );
      } catch (error) {
        const message: string =
          error instanceof Error ? error.message : String(error);

        const scenarioResult: ScenarioResult = {
          scenarioName: workflowDescription,
          expected: "Planned workflow execution",
          actual: "Test planning failed before execution.",
          pass: false,
          networkValidation: [],
          retryAttempted: false,
          notes: message,
        };

        scenarioResults.push(scenarioResult);
        // Do not rethrow – continue with remaining workflows.
        // This is especially important for regression sweeps.
        // eslint-disable-next-line no-console
        console.error(
          `Planner failed for workflow "${workflowDescription}": ${message}`
        );
        continue;
      }
      latestPlan = plan;

      const scenarioStartTimeMs: number = Date.now();

      let retryAttempted: boolean = false;
      let uiNotes: string = "";
      const networkValidationNotes: string[] = [];
      let stepExecutionFailed: boolean = false;

      const baselineNetworkLogsLength: number = (
        await browser.getNetworkLogs()
      ).length;

      const executeActionPlaywright = createPlaywrightExecutor(browser);
      const executeActionSelenium = createSeleniumExecutor(browser);

      for (const step of plan.interactionSteps) {
        if (Date.now() > deadlineMs) {
          uiNotes += "Timed out during interaction steps. ";
          stepExecutionFailed = true;
          break;
        }

        const success: boolean =
          tool === "selenium"
            ? await executeActionSelenium(step)
            : await executeActionPlaywright(step);
        if (!success) {
          if (!retryAttempted) {
            retryAttempted = true;
            const retrySuccess: boolean =
              tool === "selenium"
                ? await executeActionSelenium(step)
                : await executeActionPlaywright(step);
            if (!retrySuccess) {
              uiNotes += `Step failed after retry: "${step}". `;
              stepExecutionFailed = true;
              break;
            }
          } else {
            uiNotes += `Step failed: "${step}". `;
            stepExecutionFailed = true;
            break;
          }
        }
      }

      const postDomSnapshot: string = await browser.getDOMSnapshot();
      const scenarioEndTimeMs: number = Date.now();
      const uiChanged: boolean = postDomSnapshot !== initialDomSnapshot;

      const allNetworkLogs = await browser.getNetworkLogs();
      const allEndpoints: string[] = allNetworkLogs.map((entry) => entry.url);

      const scenarioNetworkLogs = allNetworkLogs.slice(
        baselineNetworkLogsLength
      );

      for (const rule of plan.networkValidationRules) {
        const matched: boolean = allEndpoints.some((endpoint) =>
          endpoint.includes(rule)
        );
        if (!matched) {
          networkValidationNotes.push(
            `No network call matched validation rule: "${rule}".`
          );
        }
      }

      const expected: string = plan.expectedBehaviors.join("\n");
      const actualParts: string[] = [];

      if (uiChanged) {
        actualParts.push("UI changed during workflow.");
      } else {
        actualParts.push("UI change not detected via DOM diff (may still be functional change).");
      }

      if (networkValidationNotes.length === 0) {
        actualParts.push("All network validation rules satisfied.");
      } else {
        actualParts.push(networkValidationNotes.join(" "));
      }

      if (uiNotes.trim().length > 0) {
        actualParts.push(uiNotes.trim());
      }

      type ScenarioNetworkLogEntry = {
        url?: string;
        method?: string;
        status?: number | null;
        durationMs?: number | null;
        contentType?: string;
      };

      const apiLikeEntries: ScenarioNetworkLogEntry[] =
        scenarioNetworkLogs.filter((entry: unknown) => {
          if (!entry || typeof entry !== "object") {
            return false;
          }

          const e = entry as ScenarioNetworkLogEntry & {
            responseHeaders?: Record<string, string>;
          };

          const url: string = typeof e.url === "string" ? e.url : "";
          const method: string =
            typeof e.method === "string" ? e.method.toUpperCase() : "";
          const headerContentType: string | undefined =
            e.responseHeaders?.["content-type"];
          const contentType: string = (
            typeof e.contentType === "string"
              ? e.contentType
              : headerContentType ?? ""
          ).toLowerCase();

          if (!url) {
            return false;
          }

          if (
            url.startsWith("data:") ||
            url.startsWith("about:") ||
            url.startsWith("chrome:")
          ) {
            return false;
          }

          if (
            url.match(
              /\.(png|jpe?g|gif|svg|css|js|woff2?|ttf|ico|map)(\?|$)/i
            )
          ) {
            return false;
          }

          if (
            method === "POST" ||
            method === "PUT" ||
            method === "PATCH" ||
            method === "DELETE"
          ) {
            return true;
          }

          if (contentType.includes("application/json")) {
            return true;
          }

          const lowerUrl = url.toLowerCase();
          if (
            lowerUrl.includes("/api/") ||
            lowerUrl.includes("/graphql") ||
            lowerUrl.includes("/auth") ||
            lowerUrl.includes("/login")
          ) {
            return true;
          }

          return false;
        });

      let metricsForScenario: ReturnType<typeof analyzeNetwork> | null = null;

      if (apiLikeEntries.length === 0) {
        actualParts.push("No external API interaction detected.");
      } else {
        const networkData = apiLikeEntries.map((entry) => {
          const url: string = typeof entry.url === "string" ? entry.url : "";
          const method: string =
            typeof entry.method === "string"
              ? entry.method.toUpperCase()
              : "GET";
          const status: number =
            typeof entry.status === "number" ? entry.status : 0;
          const durationMs: number =
            typeof entry.durationMs === "number" &&
            Number.isFinite(entry.durationMs) &&
            entry.durationMs >= 0
              ? entry.durationMs
              : 0;

          const duration: number = durationMs;
          const startTime: number = 0;
          const endTime: number = duration;

          return {
            url,
            method,
            status,
            startTime,
            endTime,
            duration,
            resourceType: "xhr",
          };
        });

        const metrics = analyzeNetwork(networkData);
        metricsForScenario = metrics;

        if (metrics.totalApiCalls === 0) {
          actualParts.push("No external API interaction detected.");
        } else {
          const networkSummary =
            `Network analysis: Total API calls: ${metrics.totalApiCalls}, ` +
            `Average latency: ${Math.round(metrics.averageLatency)} ms, ` +
            `Total API time: ${metrics.totalApiTime} ms, ` +
            `Unique API endpoints: ${metrics.apiCalls.length}.`;

          actualParts.push(networkSummary);
        }
      }

      const actual: string = actualParts.join(" ");

      const pass: boolean =
        !stepExecutionFailed && uiChanged && networkValidationNotes.length === 0;

      const scenarioResult: ScenarioResult = {
        scenarioName: workflowDescription,
        expected,
        actual,
        pass,
        networkValidation: networkValidationNotes,
        retryAttempted,
        notes: uiNotes.trim(),
      };

      if (metricsForScenario) {
        const augmented = scenarioResult as unknown as {
          networkMetrics?: {
            totalApiCalls: number;
            averageLatency: number;
            totalApiTime: number;
          };
          scenarioStartTimeMs?: number;
          scenarioEndTimeMs?: number;
        };
        augmented.networkMetrics = metricsForScenario;
        augmented.scenarioStartTimeMs = scenarioStartTimeMs;
        augmented.scenarioEndTimeMs = scenarioEndTimeMs;
      }

      scenarioResults.push(scenarioResult);

      if (Date.now() > deadlineMs) {
        break;
      }
    }

    const finalNetworkLogs = await browser.getNetworkLogs();

    const state: AgentState = {
      plan: latestPlan,
      // Raw network logs are intentionally typed as any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      networkLogs: finalNetworkLogs as any[],
      scenarioResults,
      startTime,
      timeoutSeconds: config.timeoutSeconds,
    };

    return state;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function buildExecutionIntelligenceContext(
  pythonState: PythonBrowserState
): ExecutionIntelligenceContext {
  const domSnapshot: string =
    typeof pythonState.dom_snapshot === "string" ? pythonState.dom_snapshot : "";

  const root: Record<string, unknown> = pythonState as unknown as Record<
    string,
    unknown
  >;

  const crawl: unknown = root.crawl;
  let pagesVisited: number = 0;
  let depthReached: number = 0;

  if (crawl && typeof crawl === "object" && !Array.isArray(crawl)) {
    const crawlRecord = crawl as {
      visitedPages?: unknown;
      depthReached?: unknown;
    };

    if (Array.isArray(crawlRecord.visitedPages)) {
      pagesVisited = crawlRecord.visitedPages.length;
    }

    if (typeof crawlRecord.depthReached === "number") {
      depthReached = crawlRecord.depthReached;
    }
  }

  const networkLogsUnknown: unknown = root.network_logs;
  const networkLogs: unknown[] = Array.isArray(networkLogsUnknown)
    ? networkLogsUnknown
    : [];

  const totalRequests: number = networkLogs.length;
  let failedRequests: number = 0;
  const failedEndpointSet: Set<string> = new Set<string>();

  for (const entry of networkLogs) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as {
      status?: unknown;
      success?: unknown;
      url?: unknown;
    };

    const status: number =
      typeof record.status === "number" ? record.status : 0;

    const successField: boolean | undefined =
      typeof record.success === "boolean" ? record.success : undefined;

    const isFailure: boolean =
      successField === false || status >= 400 || status === 0;

    if (isFailure) {
      failedRequests += 1;
      const url: string = typeof record.url === "string" ? record.url : "";
      if (url.length > 0) {
        failedEndpointSet.add(url);
      }
    }
  }

  return {
    domLength: domSnapshot.length,
    crawlStats: {
      pagesVisited,
      depthReached,
    },
    networkStats: {
      totalRequests,
      failedRequests,
      failedEndpoints: Array.from(failedEndpointSet),
    },
  };
}

type AdaptiveActionType =
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "CLEAR"
  | "HOVER"
  | "FOCUS"
  | "NAVIGATE"
  | "SCROLL"
  | "WAIT"
  | "ASSERT"
  | "STOP";

type AdaptiveNextAction = {
  type: AdaptiveActionType;
  /** Element index from RichElement.elementIndex — used for element-targeting actions. */
  elementIndex?: number;
  /** Legacy CSS selector (backward compat for CLICK from old plan path). */
  selector?: string;
  /** Text value for TYPE and SELECT actions. */
  value?: string;
  /** Target URL for NAVIGATE. */
  url?: string;
  milliseconds?: number;
  assertionType?: string;
  reason?: string;
};

type AdaptiveExecutionLoopContext = {
  browser: AutomationController;
  tool: AutomationToolId;
  workflowDescription: string;
  model: string;
  token: string;
  llmEndpoint?: string;
  llmProvider?: string;
  deadlineMs: number;
  maxSteps: number;
  screenshotsDir: string;
  /** Compiled assertion contract produced by parseGoalToContract() before the loop. */
  assertionContract: AssertionContract;
  /** DOM hash captured from the Playwright session immediately after login. */
  initialDomHash: string;
};

type AdaptiveExecutionResult = {
  executedSteps: string[];
  stopReason: string;
  uiNotes: string;
  stepExecutionFailed: boolean;
  retryAttempted: boolean;
  screenshots: string[];
  assertionState: AssertionState;
  partialScore: number;
};

type AdaptiveNetworkSnapshot = {
  totalLogEntries: number;
  recentEndpoints: string[];
  recentFailures: string[];
};

type InteractiveElementSummary = {
  tag: string;
  id?: string;
  text?: string;
  name?: string;
  type?: string;
  dataTestId?: string;
  dataTest?: string;
  dataQa?: string;
  ariaLabel?: string;
  role?: string;
  placeholder?: string;
};

let phase3Logged: boolean = false;

/**
 * Fast, deterministic DOM hash used for stuck-state detection.
 * Extracted to module scope so runWorkflow can use it for the
 * Playwright-session baseline (replacing the cross-session Python baseline).
 */
function hashDomSnapshotStatic(snapshot: string): string {
  let hash = 0;
  for (let i = 0; i < snapshot.length; i += 1) {
    hash = (hash * 31 + snapshot.charCodeAt(i)) >>> 0;
  }
  return `${snapshot.length}:${hash}`;
}

async function adaptiveExecutionLoop(
  context: AdaptiveExecutionLoopContext
): Promise<AdaptiveExecutionResult> {
  const { browser } = context;

  let stepCount = 0;
  const maxSteps: number = Math.max(1, Math.floor(context.maxSteps));
  const executedSteps: string[] = [];

  let uiNotes = "";
  let stopReason = "Stopped: unknown reason.";
  let stepExecutionFailed = false;
  let retryAttempted = false;

  let previousDomHash: string | null = context.initialDomHash || null;
  let retryCount = 0;
  let stopRejectionCount = 0;
  const MAX_STOP_REJECTIONS = 3;

  const screenshots: string[] = [];

  // Initialise assertion tracking from the compiled contract.
  let assertionState: AssertionState = initAssertionState(context.assertionContract);

  if (!phase3Logged) {
    // eslint-disable-next-line no-console
    console.log("Phase 3 complete – interactive DOM extraction integrated");
    phase3Logged = true;
  }

  while (stepCount < maxSteps) {
    const recentActions = executedSteps.slice(-5);
    const lastAction = recentActions[recentActions.length - 1];
    const isRepeating =
      lastAction &&
      recentActions.filter(a => a === lastAction).length >= 3;
    if (isRepeating) {
      stopReason = "Stopped: LOOP_DETECTED.";
      break;
    }

    if (Date.now() > context.deadlineMs) {
      uiNotes += "Timed out during adaptive execution loop. ";
      stopReason = "Stopped: timeout reached.";
      stepExecutionFailed = true;
      try {
        const screenshotPath: string | null = await captureFailureScreenshot(
          browser,
          context.screenshotsDir,
          stepCount,
          "timeout"
        );
        if (screenshotPath) {
          screenshots.push(screenshotPath);
        }
      } catch {
        // Ignore screenshot errors to keep execution resilient.
      }
      break;
    }

    let domSnapshot: string;
    let networkSnapshot: AdaptiveNetworkSnapshot;
    let currentDomHash: string;

    try {
      domSnapshot = await captureDOM(browser);
      networkSnapshot = await captureNetworkState(browser);
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      uiNotes += `Failed to capture state: ${message}. `;
      stopReason = "Stopped: failed to capture DOM/network state.";
      stepExecutionFailed = true;
      break;
    }

    // Hash DOM for stuck detection.
    // WAIT, SCROLL, and ASSERT are non-DOM-modifying by design — skip them from the stuck counter.
    const lastActionType: string = executedSteps.length > 0
      ? (executedSteps[executedSteps.length - 1] ?? "").split(":")[0].toUpperCase()
      : "";
    const isNonMutatingAction: boolean =
      lastActionType === "WAIT" || lastActionType === "SCROLL" || lastActionType === "ASSERT";

    currentDomHash = hashDomSnapshotStatic(domSnapshot);
    if (previousDomHash !== null && currentDomHash === previousDomHash && !isNonMutatingAction) {
      if (retryCount < 3) {
        retryCount += 1;
      } else {
        uiNotes += "DOM did not change after retry attempt. ";
        stopReason = "Stopped: stuck detected (DOM unchanged).";
        try {
          const screenshotPath: string | null = await captureFailureScreenshot(
            browser,
            context.screenshotsDir,
            stepCount,
            "stuck-state"
          );
          if (screenshotPath) {
            screenshots.push(screenshotPath);
          }
        } catch {
          // Ignore screenshot errors to keep execution resilient.
        }
        break;
      }
    } else if (currentDomHash !== previousDomHash) {
      retryCount = 0;
      previousDomHash = currentDomHash;
    }

    // Evaluate assertions against current state after every DOM capture.
    const scenarioNetworkLogsForAssertion = await browser.getNetworkLogs().catch(() => []);
    const currentUrl: string = await browser.getDOMSnapshot()
      .then(() => "")
      .catch(() => "");
    const newState = evaluateAssertions(
      context.assertionContract,
      assertionState,
      domSnapshot,
      scenarioNetworkLogsForAssertion,
      currentUrl
    );
    // Preserve failed assertions — failed is cumulative, never reset.
    assertionState = {
      fulfilled: newState.fulfilled,
      pending: newState.pending,
      failed: Array.from(new Set([
        ...assertionState.failed,
        ...newState.failed,
      ])),
    };
    console.log("ASSERTION STATE:", assertionState);

    // Early exit: all assertions fulfilled — goal reached.
    const hasContract: boolean =
      assertionState.fulfilled.length + assertionState.failed.length + assertionState.pending.length > 0;
    if (hasContract && assertionState.pending.length === 0) {
      stopReason = "Stopped: ALL_FULFILLED.";
      break;
    }

    // Parse interactive elements using the new htmlparser2-based extractor.
    const richElements: RichElement[] = parseInteractiveElements(domSnapshot);

    let nextAction: AdaptiveNextAction | null = null;
    try {
      nextAction = await decideNextAction({
        model: context.model,
        token: context.token,
        llmEndpoint: context.llmEndpoint,
        llmProvider: context.llmProvider,
        domSnapshot,
        network: networkSnapshot,
        goal: context.workflowDescription,
        stepCount,
        executedSteps,
        richElements,
        assertionState,
        assertionContract: context.assertionContract,
      });
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      uiNotes += `LLM action decision failed: ${message}. `;
      stopReason = "Stopped: model decision error.";
      stepExecutionFailed = true;
      break;
    }

    // If assertions are pending, bias execution toward resolving them.
    const pendingAssertions = assertionState.pending;
    if (pendingAssertions.length > 0) {
      // Prevent useless navigation away from the current goal context.
      if (nextAction && nextAction.type === "NAVIGATE") {
        nextAction = { type: "WAIT", milliseconds: 1000 };
      }
      // Prevent repeated login loops: if the last 3 steps already included
      // typing credentials and clicking submit, don't blindly retry login.
      const lastSteps = executedSteps.slice(-3).join(" ");
      if (lastSteps.includes("TYPE") && lastSteps.includes("CLICK")) {
        nextAction = { type: "WAIT", milliseconds: 1000 };
      }
    }

    // STOP-gating: reject STOP when there are still pending assertions.
    if (!nextAction || nextAction.type === "STOP") {
      const pendingCount: number = assertionState.pending.length;
      if (pendingCount > 0 && stopRejectionCount < MAX_STOP_REJECTIONS) {
        // Reject STOP — pending assertions remain. Continue the loop.
        stopRejectionCount += 1;
        uiNotes += `STOP rejected (${stopRejectionCount}/${MAX_STOP_REJECTIONS}): ${pendingCount} assertion(s) still pending. `;
        stepCount += 1; // Count the wasted step to prevent infinite loops.
        continue;
      }
      // Accept STOP: no pending assertions, or rejection limit reached.
      if (pendingCount > 0) {
        stopReason = "Stopped: ASSERTIONS_UNREACHABLE.";
      } else {
        stopReason =
          nextAction?.reason?.trim().length
            ? `Stopped: ${nextAction.reason.trim()}`
            : "Stopped: EXPLICIT_STOP.";
      }
      break;
    }

    // Guard against re-login after form was already submitted.
    // If "formSubmitted" appears in fulfilled assertions, skip credential actions.
    if (assertionState.fulfilled.includes("formSubmitted")) {
      if (nextAction && (nextAction.type === "TYPE" || nextAction.type === "CLICK")) {
        nextAction = { type: "WAIT", milliseconds: 1000 };
      }
    }

    if (Date.now() > context.deadlineMs) {
      uiNotes += "Timed out before executing next action. ";
      stopReason = "Stopped: timeout reached.";
      stepExecutionFailed = true;
      try {
        const screenshotPath: string | null = await captureFailureScreenshot(
          browser,
          context.screenshotsDir,
          stepCount,
          "timeout"
        );
        if (screenshotPath) {
          screenshots.push(screenshotPath);
        }
      } catch {
        // Ignore screenshot errors to keep execution resilient.
      }
      break;
    }

    // Limit ASSERT spam: after step 5, convert ASSERT to a short WAIT.
    if (nextAction && nextAction.type === "ASSERT" && stepCount > 5) {
      nextAction = { type: "WAIT", milliseconds: 1000 };
    }

    // Dispatch the action using the new dispatcher (supports all 10 action types).
    const dispatcherAction: DispatcherNextAction = {
      type: nextAction.type as DispatcherNextAction["type"],
      elementIndex: nextAction.elementIndex,
      selector: nextAction.selector,
      value: nextAction.value,
      url: nextAction.url,
      milliseconds: nextAction.milliseconds,
      assertionType: nextAction.assertionType,
      reason: nextAction.reason,
    };

    try {
      const dispatchResult = await dispatchAction(browser, dispatcherAction, richElements);
      console.log("STEP RESULT:", {
        success: dispatchResult.success,
        selector: dispatchResult.selectorUsed,
        error: dispatchResult.errorMessage
      });

      // If an ASSERT action failed, move its corresponding assertion from
      // pending → failed so assertionState accurately reflects reality.
      if (dispatcherAction.type === "ASSERT" && !dispatchResult.success) {
        const assertionHint =
          dispatcherAction.assertionType ||
          dispatchResult.selectorUsed ||
          dispatchResult.errorMessage ||
          "";

        const matchIndex = assertionState.pending.findIndex((a) =>
          assertionHint.toLowerCase().includes(a.toLowerCase()) ||
          a.toLowerCase().includes(assertionHint.toLowerCase())
        );

        if (matchIndex !== -1) {
          const failedAssertion = assertionState.pending[matchIndex];
          assertionState = {
            ...assertionState,
            pending: assertionState.pending.filter((_, i) => i !== matchIndex),
            failed: [...assertionState.failed, failedAssertion],
          };
        } else if (assertionState.pending.length > 0) {
          // Fallback: use last pending, not first.
          const fallback = assertionState.pending[assertionState.pending.length - 1];
          assertionState = {
            ...assertionState,
            pending: assertionState.pending.slice(0, -1),
            failed: [...assertionState.failed, fallback],
          };
        } else {
          // No pending assertions — record the hint label directly.
          const failedLabel = assertionHint || "unknown assertion";
          assertionState = {
            ...assertionState,
            failed: [...assertionState.failed, failedLabel],
          };
        }
        console.log("ASSERT FAILED — moved to assertionState.failed:", assertionState.failed);
      }

      if (!dispatchResult.success) {
        if (!retryAttempted) {
          retryAttempted = true;
          // Retry once — dispatchAction already tried selector fallbacks internally.
          const retryResult = await dispatchAction(browser, dispatcherAction, richElements);
          if (!retryResult.success) {
            uiNotes += `Step failed after retry: "${retryResult.errorMessage ?? "unknown error"}". `;
            stepExecutionFailed = true;
            stopReason = "Stopped: ACTION_FAILED.";
            try {
              const screenshotPath: string | null =
                await captureFailureScreenshot(
                  browser,
                  context.screenshotsDir,
                  stepCount,
                  "action-error"
                );
              if (screenshotPath) {
                screenshots.push(screenshotPath);
              }
            } catch {
              // Ignore screenshot errors to keep execution resilient.
            }
            break;
          }
        } else {
          uiNotes += `Step failed: "${dispatchResult.errorMessage ?? "unknown error"}". `;
          stepExecutionFailed = true;
          stopReason = "Stopped: ACTION_FAILED.";
          try {
            const screenshotPath: string | null =
              await captureFailureScreenshot(
                browser,
                context.screenshotsDir,
                stepCount,
                "action-error"
              );
            if (screenshotPath) {
              screenshots.push(screenshotPath);
            }
          } catch {
            // Ignore screenshot errors to keep execution resilient.
          }
          break;
        }
      }
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      uiNotes += `Execution error: ${message}. `;
      stepExecutionFailed = true;
      stopReason = "Stopped: ACTION_FAILED.";
      try {
        const screenshotPath: string | null = await captureFailureScreenshot(
          browser,
          context.screenshotsDir,
          stepCount,
          "action-error"
        );
        if (screenshotPath) {
          screenshots.push(screenshotPath);
        }
      } catch {
        // Ignore screenshot errors to keep execution resilient.
      }
      break;
    }

    // Build a step description string for the executed steps log.
    const stepDescription: string = nextAction.elementIndex !== undefined
      ? `${nextAction.type}:element[${nextAction.elementIndex}]`
      : nextAction.selector
        ? `${nextAction.type}:${nextAction.selector}`
        : nextAction.url
          ? `${nextAction.type}:${nextAction.url}`
          : nextAction.type;
    executedSteps.push(stepDescription);
    stepCount += 1;

    try {
      const postDomSnapshot: string = await captureDOM(browser);
      // Update hash after action execution for next-iteration stuck detection.
      currentDomHash = hashDomSnapshotStatic(postDomSnapshot);
    } catch {
      // Ignore post-action snapshot errors; loop safety relies on deadline/maxSteps.
    }
  }

  if (stepCount >= maxSteps) {
    stopReason = `Stopped: MAX_STEPS (${maxSteps}).`;
  }

  // Finalise textAbsent assertions: absence at loop exit counts as fulfilled.
  assertionState = finaliseTextAbsentAssertions(context.assertionContract, assertionState);
  const partialScore: number = computePartialScore(assertionState, context.assertionContract);

  return {
    executedSteps,
    stopReason,
    uiNotes,
    stepExecutionFailed,
    retryAttempted,
    screenshots,
    assertionState,
    partialScore,
  };
}

async function captureFailureScreenshot(
  browser: AutomationController,
  screenshotsDir: string,
  stepCount: number,
  reason: string
): Promise<string | null> {
  try {
    const safeReason: string = reason.replace(/[^a-zA-Z0-9-_]/g, "-");
    const timestamp: string = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");
    const fileName: string = `step-${stepCount}-${safeReason}-${timestamp}.png`;
    const filePath: string = path.join(screenshotsDir, fileName);

    if (typeof browser.captureScreenshot === "function") {
      await browser.captureScreenshot(filePath);
      return filePath;
    }

    return null;
  } catch {
    return null;
  }
}

async function captureDOM(browser: AutomationController): Promise<string> {
  return await browser.getDOMSnapshot();
}

async function captureNetworkState(
  browser: AutomationController
): Promise<AdaptiveNetworkSnapshot> {
  const logs = await browser.getNetworkLogs();

  const recent = logs.slice(Math.max(0, logs.length - 30));
  const recentEndpoints: string[] = recent
    .map((e) => (e && typeof e.url === "string" ? e.url : ""))
    .filter((u) => u.length > 0);

  const failures = recent
    .filter((e) => typeof e.status === "number" && e.status >= 400)
    .map((e) => `${e.method ?? "GET"} ${e.url} (${e.status})`);

  return {
    totalLogEntries: logs.length,
    recentEndpoints: Array.from(new Set(recentEndpoints)).slice(-20),
    recentFailures: Array.from(new Set(failures)).slice(-10),
  };
}

async function decideNextAction(input: {
  model: string;
  token: string;
  llmEndpoint?: string;
  llmProvider?: string;
  domSnapshot: string;
  network: AdaptiveNetworkSnapshot;
  goal: string;
  stepCount: number;
  executedSteps: string[];
  richElements: RichElement[];
  assertionState: AssertionState;
  assertionContract: AssertionContract;
}): Promise<AdaptiveNextAction | null> {
  const domPreview: string = input.domSnapshot.slice(0, 8000);
  const executedPreview: string = input.executedSteps.slice(-10).join("\n");
  // Present up to 60 elements to the LLM, using elementIndex as the targeting handle.
  const elementPreview = input.richElements.slice(0, 60).map((el) => ({
    index: el.elementIndex,
    tag: el.tag,
    role: el.role,
    ariaLabel: el.ariaLabel,
    text: el.textContent,
    placeholder: el.placeholder,
    id: el.id,
    disabled: el.disabled,
    topSelector: el.selectorRank[0]?.strategy ?? "css",
  }));

  const pendingAssertions: string[] = input.assertionState.pending;
  const stopAllowed: boolean = pendingAssertions.length === 0;

  const prompt = `
You are an adaptive browser automation agent.

Decide the NEXT SINGLE ACTION to achieve the goal. Do NOT output a full plan.
Use only what is visible in the DOM snapshot and recent network observations.
For element-targeting actions (CLICK, TYPE, SELECT, CLEAR, HOVER, FOCUS), use the
"elementIndex" field to reference an element from the interactiveElements list.

Return ONLY valid JSON. No explanation. No markdown. No backticks.

Schema:
{
  "type": "CLICK | TYPE | SELECT | CLEAR | HOVER | FOCUS | NAVIGATE | SCROLL | WAIT | ASSERT | STOP",
  "elementIndex": number (required for CLICK/TYPE/SELECT/CLEAR/HOVER/FOCUS/ASSERT),
  "value": "string (required for TYPE and SELECT)",
  "url": "string (required for NAVIGATE)",
  "milliseconds": number (optional for WAIT, default 1000),
  "reason": "string (optional)"
}

${stopAllowed
  ? "If the goal is fully achieved, you may return type STOP."
  : `⚠ STOP is NOT allowed yet. The following assertions are still pending:\n${pendingAssertions.map((a) => "  - " + a).join("\n")}\nYou MUST continue until all assertions are satisfied.`
}

Goal:
${input.goal}

Step count so far: ${input.stepCount}

Previously executed steps (most recent last):
${executedPreview}

Interactive elements (up to 60, referenced by index):
${JSON.stringify(elementPreview, null, 2)}

Recent network endpoints:
${JSON.stringify(input.network.recentEndpoints, null, 2)}

Recent network failures:
${JSON.stringify(input.network.recentFailures, null, 2)}

DOM snapshot (preview):
${domPreview}

Return ONLY the JSON object.
`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rawResponse: string = await callModel(
      input.model,
      prompt,
      input.token,
      {
        endpoint: input.llmEndpoint,
        provider: input.llmProvider,
        model: input.model,
      }
    );
    const parsed: AdaptiveNextAction | null =
      safeParseAdaptiveNextAction(rawResponse);
    const validated: AdaptiveNextAction | null =
      validateAdaptiveNextAction(parsed, input.richElements);
    if (validated) {
      return validated;
    }
  }

  return { type: "STOP", reason: "Model failed to propose a valid action." };
}

function toInteractionStep(action: AdaptiveNextAction): string | null {
  if (action.type === "SCROLL") {
    return "scroll";
  }

  if (action.type === "WAIT") {
    const ms: number =
      typeof action.milliseconds === "number" && Number.isFinite(action.milliseconds)
        ? Math.max(0, Math.floor(action.milliseconds))
        : 1000;
    return `wait: ${ms}`;
  }

  if (action.type === "CLICK") {
    const selector: string =
      typeof action.selector === "string" ? action.selector.trim() : "";
    if (!selector) {
      return null;
    }
    return `click: ${selector}`;
  }

  return null;
}

function safeParseAdaptiveNextAction(
  rawResponse: string
): AdaptiveNextAction | null {
  if (typeof rawResponse !== "string") {
    return null;
  }

  let candidate: string = rawResponse.trim();
  if (candidate.length === 0) {
    return null;
  }

  if (candidate.toUpperCase() === "STOP") {
    return { type: "STOP" };
  }

  const fencedMatch: RegExpMatchArray | null = candidate.match(
    /```(?:json)?([\s\S]*?)```/i
  );
  if (fencedMatch && fencedMatch[1]) {
    candidate = fencedMatch[1].trim();
  }

  const objectMatch: RegExpMatchArray | null = candidate.match(/\{[\s\S]*\}/);
  if (!objectMatch || !objectMatch[0]) {
    return null;
  }

  candidate = objectMatch[0];

  const parsed: unknown = tryParseJson(candidate);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const obj = parsed as {
    type?: unknown;
    elementIndex?: unknown;
    selector?: unknown;
    value?: unknown;
    url?: unknown;
    milliseconds?: unknown;
    assertionType?: unknown;
    reason?: unknown;
  };

  const rawType: string =
    typeof obj.type === "string" ? obj.type.trim().toUpperCase() : "";

  const validTypes: string[] = [
    "CLICK", "TYPE", "SELECT", "CLEAR", "HOVER", "FOCUS",
    "NAVIGATE", "SCROLL", "WAIT", "ASSERT", "STOP",
  ];
  const type: AdaptiveActionType | null = validTypes.includes(rawType)
    ? (rawType as AdaptiveActionType)
    : null;

  if (type === null) {
    return null;
  }

  return {
    type,
    elementIndex: typeof obj.elementIndex === "number" ? Math.floor(obj.elementIndex) : undefined,
    selector: typeof obj.selector === "string" ? obj.selector : undefined,
    value: typeof obj.value === "string" ? obj.value : undefined,
    url: typeof obj.url === "string" ? obj.url : undefined,
    milliseconds:
      typeof obj.milliseconds === "number" ? obj.milliseconds : undefined,
    assertionType: typeof obj.assertionType === "string" ? obj.assertionType : undefined,
    reason: typeof obj.reason === "string" ? obj.reason : undefined,
  };
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateAdaptiveNextAction(
  action: AdaptiveNextAction | null,
  richElements: RichElement[]
): AdaptiveNextAction | null {
  if (!action) {
    return null;
  }

  // Element-targeting actions must provide a valid elementIndex.
  const elementTargetingTypes: AdaptiveActionType[] = [
    "CLICK", "TYPE", "SELECT", "CLEAR", "HOVER", "FOCUS", "ASSERT",
  ];
  if (elementTargetingTypes.includes(action.type)) {
    if (action.elementIndex !== undefined) {
      const match = richElements.find((el) => el.elementIndex === action.elementIndex);
      if (!match) {
        return null;
      }
    } else if (action.type === "CLICK" && action.selector) {
      // Legacy path: raw CSS selector accepted for backward compatibility.
      // No further validation — the dispatcher will attempt it directly.
    } else {
      return null;
    }
  }

  // NAVIGATE requires a non-empty url.
  if (action.type === "NAVIGATE") {
    if (!action.url || action.url.trim().length === 0) {
      return null;
    }
  }

  return action;
}

function extractInteractiveElements(
  domSnapshot: string
): InteractiveElementSummary[] {
  const results: InteractiveElementSummary[] = [];
  const seenKeys: Set<string> = new Set<string>();

  if (typeof domSnapshot !== "string" || domSnapshot.length === 0) {
    return results;
  }

  const addElement = (
    tag: string,
    attrs: Record<string, string>,
    textContent?: string
  ): void => {
    const lowerTag: string = tag.toLowerCase();
    const id: string | undefined = attrs.id;
    const name: string | undefined = attrs.name;
    const type: string | undefined = attrs.type || attrs.role;
    const dataTestId: string | undefined = attrs["data-testid"];
    const dataTest: string | undefined = attrs["data-test"];
    const dataQa: string | undefined = attrs["data-qa"];
    const ariaLabel: string | undefined = attrs["aria-label"];
    const role: string | undefined = attrs.role;
    const placeholder: string | undefined = attrs.placeholder;
    const text: string | undefined =
      textContent && textContent.trim().length > 0
        ? textContent.trim().slice(0, 200)
        : undefined;

    const key: string = [
      lowerTag,
      id ?? "",
      name ?? "",
      type ?? "",
      dataTestId ?? "",
      dataTest ?? "",
      dataQa ?? "",
      ariaLabel ?? "",
      role ?? "",
      placeholder ?? "",
      text ?? "",
    ].join("|");
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    results.push({
      tag: lowerTag,
      id,
      text,
      name,
      type,
      dataTestId,
      dataTest,
      dataQa,
      ariaLabel,
      role,
      placeholder,
    });
  };

  const attributeRegex =
    /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  const parseAttributes = (raw: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    let match: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((match = attributeRegex.exec(raw)) !== null) {
      const name: string = match[1].toLowerCase();
      const value: string = (match[2] ?? match[3] ?? "").trim();
      attrs[name] = value;
    }
    return attrs;
  };

  const pairedTagRegex =
    /<([a-zA-Z0-9]+)([^>]*)>(.*?)<\/\1>/gs;
  let pairedMatch: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((pairedMatch = pairedTagRegex.exec(domSnapshot)) !== null) {
    const tag: string = pairedMatch[1];
    const rawAttrs: string = pairedMatch[2] ?? "";
    const inner: string = pairedMatch[3] ?? "";
    const attrs: Record<string, string> = parseAttributes(rawAttrs);
    const hasOnClick: boolean = Object.prototype.hasOwnProperty.call(
      attrs,
      "onclick"
    );
    const role: string | undefined = attrs.role;
    const isRoleButton: boolean =
      typeof role === "string" && role.toLowerCase() === "button";

    const lowerTag: string = tag.toLowerCase();
    const isInteractiveTag: boolean =
      lowerTag === "button" ||
      lowerTag === "a" ||
      lowerTag === "select";

    if (isInteractiveTag || hasOnClick || isRoleButton) {
      addElement(tag, attrs, inner);
    }
  }

  const selfClosingRegex =
    /<([a-zA-Z0-9]+)([^>]*?)\/?>/g;
  let selfClosingMatch: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((selfClosingMatch = selfClosingRegex.exec(domSnapshot)) !== null) {
    const tag: string = selfClosingMatch[1];
    const rawAttrs: string = selfClosingMatch[2] ?? "";
    const attrs: Record<string, string> = parseAttributes(rawAttrs);

    const lowerTag: string = tag.toLowerCase();
    const hasOnClick: boolean = Object.prototype.hasOwnProperty.call(
      attrs,
      "onclick"
    );
    const role: string | undefined = attrs.role;
    const isRoleButton: boolean =
      typeof role === "string" && role.toLowerCase() === "button";

    const isInteractiveTag: boolean =
      lowerTag === "input" ||
      lowerTag === "button" ||
      lowerTag === "select" ||
      lowerTag === "a";

    if (isInteractiveTag || hasOnClick || isRoleButton) {
      addElement(tag, attrs);
    }
  }

  return results;
}

function createPlaywrightExecutor(
  browser: AutomationController
): (action: string) => Promise<boolean> {
  const executeActionPlaywright = async (action: string): Promise<boolean> => {
    return await executeActionCommon(browser, action);
  };
  return executeActionPlaywright;
}

function createSeleniumExecutor(
  browser: AutomationController
): (action: string) => Promise<boolean> {
  const executeActionSelenium = async (action: string): Promise<boolean> => {
    return await executeActionCommon(browser, action);
  };
  return executeActionSelenium;
}

async function executeActionCommon(
  browser: AutomationController,
  step: string
): Promise<boolean> {
  const trimmed: string = step.trim();
  const lower: string = trimmed.toLowerCase();

  if (lower.startsWith("click:")) {
    const selector: string = trimmed.slice("click:".length).trim();
    if (selector.length === 0) {
      return false;
    }
    try {
      await browser.click(selector);
      return true;
    } catch {
      return false;
    }
  }

  if (lower.startsWith("click ")) {
    const selector: string = trimmed.slice("click ".length).trim();
    if (selector.length === 0) {
      return false;
    }
    try {
      await browser.click(selector);
      return true;
    } catch {
      return false;
    }
  }

  if (lower === "scroll" || lower.startsWith("scroll ")) {
    try {
      await browser.scroll();
      return true;
    } catch {
      return false;
    }
  }

  if (lower.startsWith("wait:") || lower.startsWith("wait ")) {
    const raw: string = lower.startsWith("wait:")
      ? trimmed.slice("wait:".length).trim()
      : trimmed.slice("wait ".length).trim();
    const parsed: number = Number(raw);
    const ms: number = Number.isFinite(parsed)
      ? Math.max(0, Math.min(30_000, Math.floor(parsed)))
      : 1000;
    try {
      if (typeof browser.waitForTimeout === "function") {
        await browser.waitForTimeout(ms);
      } else {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
      return true;
    } catch {
      return false;
    }
  }

  // For non-actionable or descriptive steps, consider them as no-op success.
  return true;
}
