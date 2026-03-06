import * as crypto from "crypto";
import readlineSync from "readline-sync";
import type { AgentState, WorkflowConfig } from "./core/types";
import { runWorkflow } from "./core/orchestrator";
import { executeWithRetry } from "./core/retry";
import {
  writeRegressionReportExcel,
  writeTestResultsExcel,
} from "./reporting/excelReporter";
import type { ExecutionConfig } from "./config/executionConfig";
import type { ExecutionTool, ExecutionMetadata } from "./reporting/types";
import { generateRegressionSkeleton } from "./reporting/regressionSkeletonGenerator";
import { ensureEnterpriseOutputStructure } from "./reporting/outputManager";
import { loadConfig } from "./config/loadConfig";
// import { listModels } from "./ai/githubModelsClient"; // ❌ Disabled for remote mode
import { callModel } from "./ai/githubModelsClient";
import {
  generateScenariosFromPRD,
  type ModelClient,
} from "./ai/scenarioGenerator";

async function main(): Promise<void> {
  try {
    const engineConfig = loadConfig();

    const url: string = readlineSync.question("URL: ");
    const username: string = readlineSync.question("Username: ");
    const password: string = readlineSync.question("Password: ", {
      hideEchoBack: true,
    });

    const workflowDescriptionInput: string = readlineSync.question(
      "Workflow description or PRD (comma separated for multiple): "
    );

    const workflowDescriptions: string[] = workflowDescriptionInput
      .split(",")
      .map((item: string) => item.trim())
      .filter((item: string) => item.length > 0);

    /*
    // ===============================
    // ❌ GITHUB MODE (DISABLED)
    // ===============================

    const githubToken: string = readlineSync.question("GitHub token: ", {
      hideEchoBack: true,
    });

    const modelIds: string[] = await listModels(githubToken);
    if (modelIds.length === 0) {
      console.error("No models found. Check your token and try again.");
      process.exit(1);
    }

    console.log("Available models:");
    for (let i = 0; i < modelIds.length; i++) {
      console.log(`  ${i + 1}. ${modelIds[i]}`);
    }

    const selectionInput: string = readlineSync.question(
      `Select model (1-${modelIds.length}): `
    );
    const selectionIndex: number = parseInt(selectionInput.trim(), 10) - 1;

    if (
      Number.isNaN(selectionIndex) ||
      selectionIndex < 0 ||
      selectionIndex >= modelIds.length
    ) {
      console.error("Invalid selection. Please enter a number from the list.");
      process.exit(1);
    }

    const model: string = modelIds[selectionIndex] ?? modelIds[0];
    */

    // ===============================
    // CONFIG-DRIVEN LLM MODE
    // MODEL_PROVIDER=github | local (default: local)
    // ===============================

    const modelProvider: string =
      (process.env.MODEL_PROVIDER ?? process.env.LLM_PROVIDER ?? "local")
        .trim()
        .toLowerCase();
    const isGitHubProvider: boolean = modelProvider === "github";

    let defaultLlmProvider: string;
    let defaultLlmEndpoint: string;
    let defaultLlmModel: string;
    let githubToken: string;
    let model: string;

    if (isGitHubProvider) {
      defaultLlmProvider = "github";
      defaultLlmEndpoint = ""; // Not used for GitHub Models
      defaultLlmModel = ""; // Resolved via GITHUB_MODEL
      const pat = (process.env.GITHUB_PAT ?? "").trim();
      if (!pat) {
        throw new Error(
          "GitHub PAT is not configured. Set GITHUB_PAT when using MODEL_PROVIDER=github."
        );
      }
      githubToken = pat;
      model =
        (process.env.GITHUB_MODEL ?? "openai/gpt-4.1-mini").trim() ||
        "openai/gpt-4.1-mini";
    } else {
      defaultLlmProvider = (process.env.LLM_PROVIDER ?? "ollama").trim() || "ollama";
      defaultLlmEndpoint = (process.env.LLM_ENDPOINT ?? "").trim();
      if (!defaultLlmEndpoint) {
        throw new Error(
          "LLM endpoint is not configured. Set LLM_ENDPOINT when using MODEL_PROVIDER=local."
        );
      }
      defaultLlmModel = (process.env.LLM_MODEL ?? "").trim();
      if (!defaultLlmModel) {
        throw new Error(
          "LLM model is not configured. Set LLM_MODEL when using MODEL_PROVIDER=local."
        );
      }
      githubToken = "";
      model = defaultLlmModel;
    }

    const timeoutInput: string = readlineSync.question(
      `Timeout seconds (default ${engineConfig.timeoutSeconds}): `
    );
    const timeoutSecondsOverride: number | undefined = timeoutInput.trim().length
      ? Number(timeoutInput)
      : undefined;

    const cliOverrides: Partial<ReturnType<typeof loadConfig>> = {
      timeoutSeconds: timeoutSecondsOverride,
    };

    let finalWorkflowDescriptions: string[] = workflowDescriptions;

    const shouldGenerateScenariosFromPRD: boolean =
      workflowDescriptionInput.length > 200 || workflowDescriptions.length > 1;

    if (shouldGenerateScenariosFromPRD) {
      try {
        const modelClient: ModelClient = {
          async generate(prompt: string): Promise<string> {
            return callModel(model, prompt, githubToken, {
              provider: defaultLlmProvider,
              endpoint: defaultLlmEndpoint,
              model,
            });
          },
        };

        const aiScenarios: string[] = await generateScenariosFromPRD(
          workflowDescriptionInput,
          modelClient
        );

        if (aiScenarios.length > 0) {
          finalWorkflowDescriptions = aiScenarios;
          console.log(
            "AI-generated test scenarios from PRD. Executing each scenario individually."
          );
        }
      } catch (error) {
        console.warn(
          "AI-driven scenario decomposition failed. Falling back to original workflow descriptions."
        );
        console.warn(
          error instanceof Error ? error.message : JSON.stringify(error)
        );
      }
    }

    const finalConfig = {
      ...engineConfig,
      ...cliOverrides,
    };

    const tool: ExecutionTool =
      finalConfig.automationTool.toLowerCase() === "selenium"
        ? "Selenium"
        : "Playwright";

    const browser: string = finalConfig.browser;
    const headless: boolean = finalConfig.headless;
    const timeoutSeconds: number = finalConfig.timeoutSeconds;
    const concurrency: number = finalConfig.concurrency;

    const executionConfig: ExecutionConfig = {
      tool,
      browser,
      headless,
      outputDirPath: finalConfig.outputFolder,
    };

    const config: WorkflowConfig = {
      url,
      username,
      password,
      workflowDescriptions: finalWorkflowDescriptions,
      model,
      timeoutSeconds,
      githubToken,
      outputDirPath: executionConfig.outputDirPath,
      automationTool: finalConfig.automationTool,
      llmProvider: defaultLlmProvider,
      llmEndpoint: defaultLlmEndpoint,
      llmModel: model,
      headless,
    };
    const executionId: string = crypto.randomUUID();
    const executionDate: string = new Date().toISOString();
    const environment: string =
      finalConfig.environment && finalConfig.environment.trim().length > 0
        ? finalConfig.environment
        : process.env.CI
        ? "CI Pipeline"
        : "Local";

    const state: AgentState = await runWithConcurrency(config, concurrency);

    const totalScenarios: number = state.scenarioResults.length;
    const passedScenarios: number = state.scenarioResults.filter(
      (result) => result.pass
    ).length;
    const failedScenarios: number = totalScenarios - passedScenarios;

    const executionMetadata: ExecutionMetadata = {
      executionId,
      executionDate,
      environment,
      modelUsed: config.model,
      targetUrl: config.url,
      automationTool: executionConfig.tool,
      browser: executionConfig.browser,
      headlessMode: executionConfig.headless ? "Headless" : "UI",
      totalScenarios,
      passed: passedScenarios,
      failed: failedScenarios,
    };

    console.log("Workflow run summary:");
    console.log(
      `Total scenarios: ${totalScenarios}, Passed: ${passedScenarios}, Failed: ${
        failedScenarios
      }`
    );

    console.log("Detailed scenario results:");
    console.log(JSON.stringify(state.scenarioResults, null, 2));

    const { auditRunJsonPath } = await ensureEnterpriseOutputStructure({
      outputDirPath: executionConfig.outputDirPath,
    });

    await import("fs").then(({ promises }) =>
      promises.writeFile(
        auditRunJsonPath,
        JSON.stringify(executionMetadata, null, 2),
        "utf8"
      )
    );

    const executionEnvironment: string = executionConfig.headless
      ? `${executionConfig.tool} in headless ${executionConfig.browser} browser`
      : `${executionConfig.tool} in visible ${executionConfig.browser} browser`;

    await writeTestResultsExcel(state.scenarioResults, {
      executionTool: executionConfig.tool,
      executionEnvironment,
      outputDirPath: executionConfig.outputDirPath,
      executionMetadata,
    });
    console.log("Excel test results saved to the configured output folder.");

    const shouldAutoRunRegression: boolean = finalConfig.regressionSweep;

    let performRegression: boolean = shouldAutoRunRegression;

    if (!shouldAutoRunRegression) {
      const regressionAnswer: string = readlineSync
        .question("Do you want to run a regression sweep? (Yes/No): ")
        .trim()
        .toLowerCase();

      performRegression = regressionAnswer.startsWith("y");
    } else {
      console.log("Configuration enables automatic regression sweep.");
    }

    if (performRegression) {
      console.log(
        "Running regression sweep. This will execute all scenarios again."
      );
      const regressionState: AgentState = await runWithConcurrency(
        config,
        concurrency
      );
      await writeRegressionReportExcel(regressionState.scenarioResults, {
        executionTool: executionConfig.tool,
        executionEnvironment,
        outputDirPath: executionConfig.outputDirPath,
        executionMetadata,
      });
      console.log("Regression report saved to the configured output folder.");

      const skeletonPath: string = await generateRegressionSkeleton(
        executionConfig.tool,
        regressionState,
        { outputDirPath: executionConfig.outputDirPath }
      );
      console.log(
        `Regression skeleton saved to "${skeletonPath}". You can use this file as a starting point for automated regression runs.`
      );
      console.log(
        "Regression sweep completed with failures handled gracefully."
      );
    } else {
      console.log("Regression sweep skipped.");
    }
  } catch (error) {
    console.error("Execution failed:");
    console.error(
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    process.exit(1);
  }
}

async function runWithConcurrency(
  baseConfig: WorkflowConfig,
  concurrency: number
): Promise<AgentState> {
  const scenarios: string[] = baseConfig.workflowDescriptions;

  const toolRaw: string =
    typeof baseConfig.automationTool === "string" ? baseConfig.automationTool : "playwright";
  const tool: "playwright" | "selenium" =
    toolRaw.trim().toLowerCase() === "selenium" ? "selenium" : "playwright";

  if (concurrency <= 1 || scenarios.length <= 1) {
    return executeWithRetry<AgentState>(() => runWorkflow(baseConfig));
  }

  if (tool === "playwright") {
    // Playwright runs inside a single persistent browser session + page for stability.
    // Parallel scenario execution would cause cross-talk on the shared page/context.
    console.warn(
      `Concurrency ${concurrency} requested, but Playwright execution requires a single shared browser session. Running scenarios sequentially.`
    );
    return executeWithRetry<AgentState>(() => runWorkflow(baseConfig));
  }

  const safeConcurrency: number = Math.max(
    1,
    Math.min(concurrency, 5, scenarios.length)
  );

  const results: AgentState[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentIndex: number = index;
      if (currentIndex >= scenarios.length) {
        break;
      }
      index += 1;
      const scenarioName: string = scenarios[currentIndex] ?? "";
      if (!scenarioName) {
        continue;
      }

      const configForScenario: WorkflowConfig = {
        ...baseConfig,
        workflowDescriptions: [scenarioName],
      };

      const state: AgentState = await executeWithRetry<AgentState>(() =>
        runWorkflow(configForScenario)
      );
      results.push(state);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < safeConcurrency; i += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  if (results.length === 0) {
    return {
      plan: {
        interactionSteps: [],
        expectedBehaviors: [],
        networkValidationRules: [],
      },
      networkLogs: [],
      scenarioResults: [],
      startTime: new Date(),
      timeoutSeconds: baseConfig.timeoutSeconds,
    };
  }

  const allScenarioResults = results.flatMap(
    (state) => state.scenarioResults ?? []
  );
  const allNetworkLogs = results.flatMap((state) => state.networkLogs ?? []);

  const firstState: AgentState = results[0];
  const lastState: AgentState = results[results.length - 1];

  let earliestStart: Date = firstState.startTime;
  for (const state of results) {
    if (state.startTime < earliestStart) {
      earliestStart = state.startTime;
    }
  }

  return {
    plan: lastState.plan,
    networkLogs: allNetworkLogs,
    scenarioResults: allScenarioResults,
    startTime: earliestStart,
    timeoutSeconds: baseConfig.timeoutSeconds,
  };
}

main().catch((err) => {
  console.error(
    "Fatal error:",
    err instanceof Error ? err.message : JSON.stringify(err)
  );
  process.exit(1);
});
