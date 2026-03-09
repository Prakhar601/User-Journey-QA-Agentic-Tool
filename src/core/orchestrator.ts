import * as path from "path";
import type {
  AgentState,
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
import { generateNetworkSummary } from "../reporting/networkSummary";
import { ensureEnterpriseOutputStructure } from "../reporting/outputManager";

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
    const pythonState: PythonBrowserState = await runPythonAgent({
      url: config.url,
      username: config.username,
      password: config.password,
      instruction:
        "Log in to the application and navigate to the main page for automated workflow planning.",
      pythonExecutablePath: config.pythonExecutablePath,
    });

    const initialDomSnapshot: string = pythonState.dom_snapshot;
    const initialEndpoints: string[] = Array.from(
      new Set(
        (pythonState.network_logs ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((entry: any) =>
            entry && typeof entry.url === "string" ? entry.url : ""
          )
          .filter((url: string) => url.length > 0)
      )
    );

    const executionContext: ExecutionIntelligenceContext =
      buildExecutionIntelligenceContext(pythonState);

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
            maxSteps: 20,
            screenshotsDir,
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
        const uiChanged: boolean = postDomSnapshot !== initialDomSnapshot;

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
          actualParts.push("No detectable UI change during workflow.");
        }

        if (networkValidationNotes.length === 0) {
          actualParts.push("All network validation rules satisfied.");
        } else {
          actualParts.push(networkValidationNotes.join(" "));
        }

        if (adaptiveResult.uiNotes.trim().length > 0) {
          actualParts.push(adaptiveResult.uiNotes.trim());
        }

        let networkSummary: string;

        type ScenarioNetworkLogEntry = {
          url?: string;
          method?: string;
          status?: number | null;
          durationMs?: number | null;
        };

        const apiLikeEntries: ScenarioNetworkLogEntry[] =
          scenarioNetworkLogs.filter((entry: unknown) => {
            if (!entry || typeof entry !== "object") {
              return false;
            }
            const e = entry as ScenarioNetworkLogEntry;
            const url: string = typeof e.url === "string" ? e.url : "";
            const method: string =
              typeof e.method === "string" ? e.method.toUpperCase() : "";

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
              /\.(png|jpe?g|gif|svg|ico|css|js|woff2?|ttf)(\?|$)/i.test(url)
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

            if (url.toLowerCase().includes("/api/")) {
              return true;
            }

            return false;
          });

        const primaryEntry: ScenarioNetworkLogEntry | undefined =
          apiLikeEntries.length > 0
            ? apiLikeEntries[apiLikeEntries.length - 1]
            : undefined;

        if (!primaryEntry) {
          networkSummary = "No external API interaction detected.";
        } else {
          const statusCode: number | null =
            typeof primaryEntry.status === "number"
              ? primaryEntry.status
              : null;
          const responseTimeMs: number | null =
            typeof primaryEntry.durationMs === "number"
              ? primaryEntry.durationMs
              : null;
          networkSummary = generateNetworkSummary(statusCode, responseTimeMs);
        }

        actualParts.push(`Network observation: ${networkSummary}`);

        const actual: string = actualParts.join(" ");

        const pass: boolean =
          !adaptiveResult.stepExecutionFailed &&
          uiChanged &&
          networkValidationNotes.length === 0;

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
        };

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
        actualParts.push("No detectable UI change during workflow.");
      }

      if (networkValidationNotes.length === 0) {
        actualParts.push("All network validation rules satisfied.");
      } else {
        actualParts.push(networkValidationNotes.join(" "));
      }

      if (uiNotes.trim().length > 0) {
        actualParts.push(uiNotes.trim());
      }

      let networkSummary: string;

      type ScenarioNetworkLogEntry = {
        url?: string;
        method?: string;
        status?: number | null;
        durationMs?: number | null;
      };

      const apiLikeEntries: ScenarioNetworkLogEntry[] =
        scenarioNetworkLogs.filter((entry: unknown) => {
          if (!entry || typeof entry !== "object") {
            return false;
          }
          const e = entry as ScenarioNetworkLogEntry;
          const url: string = typeof e.url === "string" ? e.url : "";
          const method: string =
            typeof e.method === "string" ? e.method.toUpperCase() : "";

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

          if (/\.(png|jpe?g|gif|svg|ico|css|js|woff2?|ttf)(\?|$)/i.test(url)) {
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

          if (url.toLowerCase().includes("/api/")) {
            return true;
          }

          return false;
        });

      const primaryEntry: ScenarioNetworkLogEntry | undefined =
        apiLikeEntries.length > 0
          ? apiLikeEntries[apiLikeEntries.length - 1]
          : undefined;

      if (!primaryEntry) {
        networkSummary = "No external API interaction detected.";
      } else {
        const statusCode: number | null =
          typeof primaryEntry.status === "number" ? primaryEntry.status : null;
        const responseTimeMs: number | null =
          typeof primaryEntry.durationMs === "number"
            ? primaryEntry.durationMs
            : null;
        networkSummary = generateNetworkSummary(statusCode, responseTimeMs);
      }

      actualParts.push(`Network observation: ${networkSummary}`);

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

type AdaptiveActionType = "CLICK" | "SCROLL" | "WAIT" | "STOP";

type AdaptiveNextAction = {
  type: AdaptiveActionType;
  selector?: string;
  milliseconds?: number;
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
};

type AdaptiveExecutionResult = {
  executedSteps: string[];
  stopReason: string;
  uiNotes: string;
  stepExecutionFailed: boolean;
  retryAttempted: boolean;
  screenshots: string[];
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

async function adaptiveExecutionLoop(
  context: AdaptiveExecutionLoopContext
): Promise<AdaptiveExecutionResult> {
  const { browser } = context;
  const tool: AutomationToolId = context.tool;

  const executeActionPlaywright = createPlaywrightExecutor(browser);
  const executeActionSelenium = createSeleniumExecutor(browser);

  let stepCount = 0;
  const maxSteps: number = Math.max(1, Math.floor(context.maxSteps));
  const executedSteps: string[] = [];

  let uiNotes = "";
  let stopReason = "Stopped: unknown reason.";
  let stepExecutionFailed = false;
  let retryAttempted = false;

  let previousDomHash: string | null = null;
  let retryCount = 0;

  const screenshots: string[] = [];

  const hashDomSnapshot = (snapshot: string): string => {
    // Fast, deterministic hash for stuck detection (not cryptographic).
    let hash = 0;
    for (let i = 0; i < snapshot.length; i += 1) {
      hash = (hash * 31 + snapshot.charCodeAt(i)) >>> 0;
    }
    return `${snapshot.length}:${hash}`;
  };

  while (stepCount < maxSteps) {
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

    // Phase 2: Capture DOM BEFORE LLM, hash it, and detect stuck state.
    currentDomHash = hashDomSnapshot(domSnapshot);
    if (previousDomHash !== null && currentDomHash === previousDomHash) {
      if (retryCount < 1) {
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
    } else {
      retryCount = 0;
      previousDomHash = currentDomHash;
    }

    const interactiveElements: InteractiveElementSummary[] =
      extractInteractiveElements(domSnapshot);

    if (!phase3Logged) {
      // eslint-disable-next-line no-console
      console.log(
        "Phase 3 complete – interactive DOM extraction integrated"
      );
      phase3Logged = true;
    }

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
        interactiveElements,
      });
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      uiNotes += `LLM action decision failed: ${message}. `;
      stopReason = "Stopped: model decision error.";
      stepExecutionFailed = true;
      break;
    }

    if (!nextAction || nextAction.type === "STOP") {
      stopReason =
        nextAction?.reason?.trim().length
          ? `Stopped: ${nextAction.reason.trim()}`
          : "Stopped: model returned STOP/no action.";
      break;
    }

    const stepString: string | null = toInteractionStep(nextAction);
    if (!stepString) {
      stopReason = "Stopped: model returned an invalid next action.";
      break;
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

    try {
      const success: boolean =
        tool === "selenium"
          ? await executeActionSelenium(stepString)
          : await executeActionPlaywright(stepString);
      if (!success) {
        if (!retryAttempted) {
          retryAttempted = true;
          const retrySuccess: boolean =
            tool === "selenium"
              ? await executeActionSelenium(stepString)
              : await executeActionPlaywright(stepString);
          if (!retrySuccess) {
            uiNotes += `Step failed after retry: "${stepString}". `;
            stepExecutionFailed = true;
            stopReason = "Stopped: action execution failed.";
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
          uiNotes += `Step failed: "${stepString}". `;
          stepExecutionFailed = true;
          stopReason = "Stopped: action execution failed.";
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
      uiNotes += `Execution error for "${stepString}": ${message}. `;
      stepExecutionFailed = true;
      stopReason = "Stopped: action execution error.";
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

    executedSteps.push(stepString);
    stepCount += 1;

    try {
      const postDomSnapshot: string = await captureDOM(browser);
      // Phase 2: Capture DOM AFTER action execution and update hash.
      currentDomHash = hashDomSnapshot(postDomSnapshot);
    } catch {
      // Ignore post-action snapshot errors; loop safety relies on deadline/maxSteps.
    }
  }

  if (stepCount >= maxSteps) {
    stopReason = `Stopped: max steps reached (${maxSteps}).`;
  }

  return {
    executedSteps,
    stopReason,
    uiNotes,
    stepExecutionFailed,
    retryAttempted,
    screenshots,
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
  interactiveElements: InteractiveElementSummary[];
}): Promise<AdaptiveNextAction | null> {
  const domPreview: string = input.domSnapshot.slice(0, 4000);
  const executedPreview: string = input.executedSteps.slice(-10).join("\n");
  const interactivePreview: InteractiveElementSummary[] =
    input.interactiveElements.slice(0, 50);

  const prompt = `
You are an adaptive browser automation agent.

Decide the NEXT SINGLE ACTION to achieve the goal. Do NOT output a full plan.
Use only what is visible in the DOM snapshot and recent network observations.
You MUST choose CLICK targets ONLY from the provided interactiveElements list.
For CLICK actions, the selector MUST be a CSS id selector of the form "#ELEMENT_ID"
where ELEMENT_ID is the "id" of one of the interactiveElements entries that has a non-empty id.
If no appropriate element id exists, you MUST return type "STOP".

Return ONLY valid JSON.
Do NOT include explanations.
Do NOT include markdown.
Do NOT include backticks.
Do NOT include text before or after JSON.

Schema:
{
  "type": "CLICK | SCROLL | WAIT | STOP",
  "selector": "string (required for CLICK)",
  "milliseconds": "number (optional for WAIT, default 1000)",
  "reason": "string (optional)"
}

If the goal is already achieved, return type STOP.
If you cannot find a safe actionable next step, return type STOP.

Goal:
${input.goal}

Step count so far: ${input.stepCount}

Previously executed steps (most recent last):
${executedPreview}

Interactive elements (subset):
${JSON.stringify(interactivePreview, null, 2)}

Recent network endpoints:
${JSON.stringify(input.network.recentEndpoints, null, 2)}

Recent network failures:
${JSON.stringify(input.network.recentFailures, null, 2)}

DOM snapshot (preview):
${domPreview}

Return ONLY the JSON object.
`;

  // Retry a few times if the model proposes invalid actions
  // (e.g., CLICK selectors not matching extracted interactive elements).
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
      validateAdaptiveNextAction(parsed, input.interactiveElements);
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
    selector?: unknown;
    milliseconds?: unknown;
    reason?: unknown;
  };

  const rawType: string =
    typeof obj.type === "string" ? obj.type.trim().toUpperCase() : "";

  const type: AdaptiveActionType | null =
    rawType === "CLICK" ||
    rawType === "SCROLL" ||
    rawType === "WAIT" ||
    rawType === "STOP"
      ? (rawType as AdaptiveActionType)
      : null;

  if (type === null) {
    return null;
  }

  return {
    type,
    selector: typeof obj.selector === "string" ? obj.selector : undefined,
    milliseconds:
      typeof obj.milliseconds === "number" ? obj.milliseconds : undefined,
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
  interactiveElements: InteractiveElementSummary[]
): AdaptiveNextAction | null {
  if (!action) {
    return null;
  }

  if (action.type === "CLICK") {
    const selector: string =
      typeof action.selector === "string" ? action.selector.trim() : "";
    if (!selector || !selector.startsWith("#")) {
      return null;
    }
    const id: string = selector.slice(1);
    if (!id) {
      return null;
    }
    const match: InteractiveElementSummary | undefined =
      interactiveElements.find((el) => el.id === id);
    if (!match) {
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
