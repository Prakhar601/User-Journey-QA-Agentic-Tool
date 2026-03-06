"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = __importStar(require("crypto"));
const readline_sync_1 = __importDefault(require("readline-sync"));
const orchestrator_1 = require("./core/orchestrator");
const retry_1 = require("./core/retry");
const excelReporter_1 = require("./reporting/excelReporter");
const regressionSkeletonGenerator_1 = require("./reporting/regressionSkeletonGenerator");
const outputManager_1 = require("./reporting/outputManager");
const loadConfig_1 = require("./config/loadConfig");
// import { listModels } from "./ai/githubModelsClient"; // ❌ Disabled for remote mode
const githubModelsClient_1 = require("./ai/githubModelsClient");
const scenarioGenerator_1 = require("./ai/scenarioGenerator");
async function main() {
    try {
        const engineConfig = (0, loadConfig_1.loadConfig)();
        const url = readline_sync_1.default.question("URL: ");
        const username = readline_sync_1.default.question("Username: ");
        const password = readline_sync_1.default.question("Password: ", {
            hideEchoBack: true,
        });
        const workflowDescriptionInput = readline_sync_1.default.question("Workflow description or PRD (comma separated for multiple): ");
        const workflowDescriptions = workflowDescriptionInput
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
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
        const modelProvider = (process.env.MODEL_PROVIDER ?? process.env.LLM_PROVIDER ?? "local")
            .trim()
            .toLowerCase();
        const isGitHubProvider = modelProvider === "github";
        let defaultLlmProvider;
        let defaultLlmEndpoint;
        let defaultLlmModel;
        let githubToken;
        let model;
        if (isGitHubProvider) {
            defaultLlmProvider = "github";
            defaultLlmEndpoint = ""; // Not used for GitHub Models
            defaultLlmModel = ""; // Resolved via GITHUB_MODEL
            const pat = (process.env.GITHUB_PAT ?? "").trim();
            if (!pat) {
                throw new Error("GitHub PAT is not configured. Set GITHUB_PAT when using MODEL_PROVIDER=github.");
            }
            githubToken = pat;
            model =
                (process.env.GITHUB_MODEL ?? "openai/gpt-4.1-mini").trim() ||
                    "openai/gpt-4.1-mini";
        }
        else {
            defaultLlmProvider = (process.env.LLM_PROVIDER ?? "ollama").trim() || "ollama";
            defaultLlmEndpoint = (process.env.LLM_ENDPOINT ?? "").trim();
            if (!defaultLlmEndpoint) {
                throw new Error("LLM endpoint is not configured. Set LLM_ENDPOINT when using MODEL_PROVIDER=local.");
            }
            defaultLlmModel = (process.env.LLM_MODEL ?? "").trim();
            if (!defaultLlmModel) {
                throw new Error("LLM model is not configured. Set LLM_MODEL when using MODEL_PROVIDER=local.");
            }
            githubToken = "";
            model = defaultLlmModel;
        }
        const timeoutInput = readline_sync_1.default.question(`Timeout seconds (default ${engineConfig.timeoutSeconds}): `);
        const timeoutSecondsOverride = timeoutInput.trim().length
            ? Number(timeoutInput)
            : undefined;
        const cliOverrides = {
            timeoutSeconds: timeoutSecondsOverride,
        };
        let finalWorkflowDescriptions = workflowDescriptions;
        const shouldGenerateScenariosFromPRD = workflowDescriptionInput.length > 200 || workflowDescriptions.length > 1;
        if (shouldGenerateScenariosFromPRD) {
            try {
                const modelClient = {
                    async generate(prompt) {
                        return (0, githubModelsClient_1.callModel)(model, prompt, githubToken, {
                            provider: defaultLlmProvider,
                            endpoint: defaultLlmEndpoint,
                            model,
                        });
                    },
                };
                const aiScenarios = await (0, scenarioGenerator_1.generateScenariosFromPRD)(workflowDescriptionInput, modelClient);
                if (aiScenarios.length > 0) {
                    finalWorkflowDescriptions = aiScenarios;
                    console.log("AI-generated test scenarios from PRD. Executing each scenario individually.");
                }
            }
            catch (error) {
                console.warn("AI-driven scenario decomposition failed. Falling back to original workflow descriptions.");
                console.warn(error instanceof Error ? error.message : JSON.stringify(error));
            }
        }
        const finalConfig = {
            ...engineConfig,
            ...cliOverrides,
        };
        const tool = finalConfig.automationTool.toLowerCase() === "selenium"
            ? "Selenium"
            : "Playwright";
        const browser = finalConfig.browser;
        const headless = finalConfig.headless;
        const timeoutSeconds = finalConfig.timeoutSeconds;
        const concurrency = finalConfig.concurrency;
        const executionConfig = {
            tool,
            browser,
            headless,
            outputDirPath: finalConfig.outputFolder,
        };
        const config = {
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
        const executionId = crypto.randomUUID();
        const executionDate = new Date().toISOString();
        const environment = finalConfig.environment && finalConfig.environment.trim().length > 0
            ? finalConfig.environment
            : process.env.CI
                ? "CI Pipeline"
                : "Local";
        const state = await runWithConcurrency(config, concurrency);
        const totalScenarios = state.scenarioResults.length;
        const passedScenarios = state.scenarioResults.filter((result) => result.pass).length;
        const failedScenarios = totalScenarios - passedScenarios;
        const executionMetadata = {
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
        console.log(`Total scenarios: ${totalScenarios}, Passed: ${passedScenarios}, Failed: ${failedScenarios}`);
        console.log("Detailed scenario results:");
        console.log(JSON.stringify(state.scenarioResults, null, 2));
        const { auditRunJsonPath } = await (0, outputManager_1.ensureEnterpriseOutputStructure)({
            outputDirPath: executionConfig.outputDirPath,
        });
        await Promise.resolve().then(() => __importStar(require("fs"))).then(({ promises }) => promises.writeFile(auditRunJsonPath, JSON.stringify(executionMetadata, null, 2), "utf8"));
        const executionEnvironment = executionConfig.headless
            ? `${executionConfig.tool} in headless ${executionConfig.browser} browser`
            : `${executionConfig.tool} in visible ${executionConfig.browser} browser`;
        await (0, excelReporter_1.writeTestResultsExcel)(state.scenarioResults, {
            executionTool: executionConfig.tool,
            executionEnvironment,
            outputDirPath: executionConfig.outputDirPath,
            executionMetadata,
        });
        console.log("Excel test results saved to the configured output folder.");
        const shouldAutoRunRegression = finalConfig.regressionSweep;
        let performRegression = shouldAutoRunRegression;
        if (!shouldAutoRunRegression) {
            const regressionAnswer = readline_sync_1.default
                .question("Do you want to run a regression sweep? (Yes/No): ")
                .trim()
                .toLowerCase();
            performRegression = regressionAnswer.startsWith("y");
        }
        else {
            console.log("Configuration enables automatic regression sweep.");
        }
        if (performRegression) {
            console.log("Running regression sweep. This will execute all scenarios again.");
            const regressionState = await runWithConcurrency(config, concurrency);
            await (0, excelReporter_1.writeRegressionReportExcel)(regressionState.scenarioResults, {
                executionTool: executionConfig.tool,
                executionEnvironment,
                outputDirPath: executionConfig.outputDirPath,
                executionMetadata,
            });
            console.log("Regression report saved to the configured output folder.");
            const skeletonPath = await (0, regressionSkeletonGenerator_1.generateRegressionSkeleton)(executionConfig.tool, regressionState, { outputDirPath: executionConfig.outputDirPath });
            console.log(`Regression skeleton saved to "${skeletonPath}". You can use this file as a starting point for automated regression runs.`);
            console.log("Regression sweep completed with failures handled gracefully.");
        }
        else {
            console.log("Regression sweep skipped.");
        }
    }
    catch (error) {
        console.error("Execution failed:");
        console.error(error instanceof Error ? error.message : JSON.stringify(error));
        process.exit(1);
    }
}
async function runWithConcurrency(baseConfig, concurrency) {
    const scenarios = baseConfig.workflowDescriptions;
    const toolRaw = typeof baseConfig.automationTool === "string" ? baseConfig.automationTool : "playwright";
    const tool = toolRaw.trim().toLowerCase() === "selenium" ? "selenium" : "playwright";
    if (concurrency <= 1 || scenarios.length <= 1) {
        return (0, retry_1.executeWithRetry)(() => (0, orchestrator_1.runWorkflow)(baseConfig));
    }
    if (tool === "playwright") {
        // Playwright runs inside a single persistent browser session + page for stability.
        // Parallel scenario execution would cause cross-talk on the shared page/context.
        console.warn(`Concurrency ${concurrency} requested, but Playwright execution requires a single shared browser session. Running scenarios sequentially.`);
        return (0, retry_1.executeWithRetry)(() => (0, orchestrator_1.runWorkflow)(baseConfig));
    }
    const safeConcurrency = Math.max(1, Math.min(concurrency, 5, scenarios.length));
    const results = [];
    let index = 0;
    async function worker() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const currentIndex = index;
            if (currentIndex >= scenarios.length) {
                break;
            }
            index += 1;
            const scenarioName = scenarios[currentIndex] ?? "";
            if (!scenarioName) {
                continue;
            }
            const configForScenario = {
                ...baseConfig,
                workflowDescriptions: [scenarioName],
            };
            const state = await (0, retry_1.executeWithRetry)(() => (0, orchestrator_1.runWorkflow)(configForScenario));
            results.push(state);
        }
    }
    const workers = [];
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
    const allScenarioResults = results.flatMap((state) => state.scenarioResults ?? []);
    const allNetworkLogs = results.flatMap((state) => state.networkLogs ?? []);
    const firstState = results[0];
    const lastState = results[results.length - 1];
    let earliestStart = firstState.startTime;
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
    console.error("Fatal error:", err instanceof Error ? err.message : JSON.stringify(err));
    process.exit(1);
});
