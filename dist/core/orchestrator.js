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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkflow = runWorkflow;
const path = __importStar(require("path"));
const state_1 = require("./state");
const browserController_1 = require("../browser/browserController");
const seleniumBrowserController_1 = require("../browser/seleniumBrowserController");
const plannerAgent_1 = require("../agents/plannerAgent");
const mcpClient_1 = require("../ai/mcpClient");
const githubModelsClient_1 = require("../ai/githubModelsClient");
const networkAnalyzer_1 = require("../browser/networkAnalyzer");
const outputManager_1 = require("../reporting/outputManager");
let phase4Logged = false;
async function runWorkflow(config) {
    const startTime = new Date();
    const deadlineMs = startTime.getTime() + config.timeoutSeconds * 1000;
    const adaptiveMode = config.adaptiveMode ?? true;
    const { screenshotsDir } = await (0, outputManager_1.ensureEnterpriseOutputStructure)({
        outputDirPath: config.outputDirPath,
    });
    const toolRaw = typeof config.automationTool === "string" ? config.automationTool : "playwright";
    const tool = toolRaw.trim().toLowerCase() === "selenium" ? "selenium" : "playwright";
    const headless = config.headless ?? true;
    const browser = tool === "selenium"
        ? new seleniumBrowserController_1.SeleniumBrowserController(config.timeoutSeconds, headless)
        : new browserController_1.BrowserController(config.timeoutSeconds, headless);
    if (!phase4Logged) {
        // eslint-disable-next-line no-console
        console.log("Phase 4 complete – true dual tool execution enabled");
        phase4Logged = true;
    }
    const scenarioResults = [];
    let latestPlan = {
        interactionSteps: [],
        expectedBehaviors: [],
        networkValidationRules: [],
    };
    try {
        await (0, state_1.initializeState)();
        // Workflow 1: delegate initial state capture to the Python browser-use agent.
        const pythonState = await (0, mcpClient_1.runPythonAgent)({
            url: config.url,
            username: config.username,
            password: config.password,
            instruction: "Log in to the application and navigate to the main page for automated workflow planning.",
            pythonExecutablePath: config.pythonExecutablePath,
        });
        const initialDomSnapshot = pythonState.dom_snapshot;
        const initialEndpoints = Array.from(new Set((pythonState.network_logs ?? [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((entry) => entry && typeof entry.url === "string" ? entry.url : "")
            .filter((url) => url.length > 0)));
        const executionContext = buildExecutionIntelligenceContext(pythonState);
        // Launch the automation browser for executing the planned steps.
        await browser.launchBrowser();
        await browser.login(config.url, config.username, config.password);
        for (const workflowDescription of config.workflowDescriptions) {
            if (Date.now() > deadlineMs) {
                break;
            }
            if (adaptiveMode === true) {
                const networkValidationNotes = [];
                const baselineNetworkLogsLength = (await browser.getNetworkLogs()).length;
                const scenarioStartTimeMs = Date.now();
                const adaptiveResult = await adaptiveExecutionLoop({
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
                const postDomSnapshot = await browser.getDOMSnapshot();
                const scenarioEndTimeMs = Date.now();
                const uiChanged = postDomSnapshot !== initialDomSnapshot;
                const allNetworkLogs = await browser.getNetworkLogs();
                const allEndpoints = allNetworkLogs.map((entry) => entry.url);
                const scenarioNetworkLogs = allNetworkLogs.slice(baselineNetworkLogsLength);
                for (const rule of latestPlan.networkValidationRules) {
                    const matched = allEndpoints.some((endpoint) => endpoint.includes(rule));
                    if (!matched) {
                        networkValidationNotes.push(`No network call matched validation rule: "${rule}".`);
                    }
                }
                const expected = latestPlan.expectedBehaviors.join("\n");
                const actualParts = [];
                if (uiChanged) {
                    actualParts.push("UI changed during workflow.");
                }
                else {
                    actualParts.push("No detectable UI change during workflow.");
                }
                if (networkValidationNotes.length === 0) {
                    actualParts.push("All network validation rules satisfied.");
                }
                else {
                    actualParts.push(networkValidationNotes.join(" "));
                }
                if (adaptiveResult.uiNotes.trim().length > 0) {
                    actualParts.push(adaptiveResult.uiNotes.trim());
                }
                const apiLikeEntries = scenarioNetworkLogs.filter((entry) => {
                    if (!entry || typeof entry !== "object") {
                        return false;
                    }
                    const e = entry;
                    const url = typeof e.url === "string" ? e.url : "";
                    const method = typeof e.method === "string" ? e.method.toUpperCase() : "";
                    const headerContentType = e.responseHeaders?.["content-type"];
                    const contentType = (typeof e.contentType === "string"
                        ? e.contentType
                        : headerContentType ?? "").toLowerCase();
                    if (!url) {
                        return false;
                    }
                    if (url.startsWith("data:") ||
                        url.startsWith("about:") ||
                        url.startsWith("chrome:")) {
                        return false;
                    }
                    if (url.match(/\.(png|jpe?g|gif|svg|css|js|woff2?|ttf|ico|map)(\?|$)/i)) {
                        return false;
                    }
                    if (method === "POST" ||
                        method === "PUT" ||
                        method === "PATCH" ||
                        method === "DELETE") {
                        return true;
                    }
                    if (contentType.includes("application/json")) {
                        return true;
                    }
                    const lowerUrl = url.toLowerCase();
                    if (lowerUrl.includes("/api/") ||
                        lowerUrl.includes("/graphql") ||
                        lowerUrl.includes("/auth") ||
                        lowerUrl.includes("/login")) {
                        return true;
                    }
                    return false;
                });
                let metricsForScenario = null;
                if (apiLikeEntries.length === 0) {
                    actualParts.push("No external API interaction detected.");
                }
                else {
                    const networkData = apiLikeEntries.map((entry) => {
                        const url = typeof entry.url === "string" ? entry.url : "";
                        const method = typeof entry.method === "string"
                            ? entry.method.toUpperCase()
                            : "GET";
                        const status = typeof entry.status === "number" ? entry.status : 0;
                        const durationMs = typeof entry.durationMs === "number" &&
                            Number.isFinite(entry.durationMs) &&
                            entry.durationMs >= 0
                            ? entry.durationMs
                            : 0;
                        const duration = durationMs;
                        const startTime = 0;
                        const endTime = duration;
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
                    const metrics = (0, networkAnalyzer_1.analyzeNetwork)(networkData);
                    metricsForScenario = metrics;
                    if (metrics.totalApiCalls === 0) {
                        actualParts.push("No external API interaction detected.");
                    }
                    else {
                        const networkSummary = `Network analysis: Total API calls: ${metrics.totalApiCalls}, ` +
                            `Average latency: ${Math.round(metrics.averageLatency)} ms, ` +
                            `Total API time: ${metrics.totalApiTime} ms, ` +
                            `Unique API endpoints: ${metrics.apiCalls.length}.`;
                        actualParts.push(networkSummary);
                    }
                }
                const actual = actualParts.join(" ");
                const pass = !adaptiveResult.stepExecutionFailed &&
                    uiChanged &&
                    networkValidationNotes.length === 0;
                const scenarioResult = {
                    scenarioName: workflowDescription,
                    expected,
                    actual,
                    pass,
                    networkValidation: networkValidationNotes,
                    retryAttempted: adaptiveResult.retryAttempted,
                    notes: adaptiveResult.uiNotes.trim(),
                    screenshots: adaptiveResult.screenshots && adaptiveResult.screenshots.length > 0
                        ? adaptiveResult.screenshots.slice()
                        : undefined,
                };
                if (metricsForScenario) {
                    const augmented = scenarioResult;
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
            let plan;
            try {
                plan = await (0, plannerAgent_1.createPlan)([workflowDescription], initialDomSnapshot, initialEndpoints, config.model, config.githubToken, executionContext, config.llmEndpoint, config.llmProvider);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const scenarioResult = {
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
                console.error(`Planner failed for workflow "${workflowDescription}": ${message}`);
                continue;
            }
            latestPlan = plan;
            const scenarioStartTimeMs = Date.now();
            let retryAttempted = false;
            let uiNotes = "";
            const networkValidationNotes = [];
            let stepExecutionFailed = false;
            const baselineNetworkLogsLength = (await browser.getNetworkLogs()).length;
            const executeActionPlaywright = createPlaywrightExecutor(browser);
            const executeActionSelenium = createSeleniumExecutor(browser);
            for (const step of plan.interactionSteps) {
                if (Date.now() > deadlineMs) {
                    uiNotes += "Timed out during interaction steps. ";
                    stepExecutionFailed = true;
                    break;
                }
                const success = tool === "selenium"
                    ? await executeActionSelenium(step)
                    : await executeActionPlaywright(step);
                if (!success) {
                    if (!retryAttempted) {
                        retryAttempted = true;
                        const retrySuccess = tool === "selenium"
                            ? await executeActionSelenium(step)
                            : await executeActionPlaywright(step);
                        if (!retrySuccess) {
                            uiNotes += `Step failed after retry: "${step}". `;
                            stepExecutionFailed = true;
                            break;
                        }
                    }
                    else {
                        uiNotes += `Step failed: "${step}". `;
                        stepExecutionFailed = true;
                        break;
                    }
                }
            }
            const postDomSnapshot = await browser.getDOMSnapshot();
            const scenarioEndTimeMs = Date.now();
            const uiChanged = postDomSnapshot !== initialDomSnapshot;
            const allNetworkLogs = await browser.getNetworkLogs();
            const allEndpoints = allNetworkLogs.map((entry) => entry.url);
            const scenarioNetworkLogs = allNetworkLogs.slice(baselineNetworkLogsLength);
            for (const rule of plan.networkValidationRules) {
                const matched = allEndpoints.some((endpoint) => endpoint.includes(rule));
                if (!matched) {
                    networkValidationNotes.push(`No network call matched validation rule: "${rule}".`);
                }
            }
            const expected = plan.expectedBehaviors.join("\n");
            const actualParts = [];
            if (uiChanged) {
                actualParts.push("UI changed during workflow.");
            }
            else {
                actualParts.push("No detectable UI change during workflow.");
            }
            if (networkValidationNotes.length === 0) {
                actualParts.push("All network validation rules satisfied.");
            }
            else {
                actualParts.push(networkValidationNotes.join(" "));
            }
            if (uiNotes.trim().length > 0) {
                actualParts.push(uiNotes.trim());
            }
            const apiLikeEntries = scenarioNetworkLogs.filter((entry) => {
                if (!entry || typeof entry !== "object") {
                    return false;
                }
                const e = entry;
                const url = typeof e.url === "string" ? e.url : "";
                const method = typeof e.method === "string" ? e.method.toUpperCase() : "";
                const headerContentType = e.responseHeaders?.["content-type"];
                const contentType = (typeof e.contentType === "string"
                    ? e.contentType
                    : headerContentType ?? "").toLowerCase();
                if (!url) {
                    return false;
                }
                if (url.startsWith("data:") ||
                    url.startsWith("about:") ||
                    url.startsWith("chrome:")) {
                    return false;
                }
                if (url.match(/\.(png|jpe?g|gif|svg|css|js|woff2?|ttf|ico|map)(\?|$)/i)) {
                    return false;
                }
                if (method === "POST" ||
                    method === "PUT" ||
                    method === "PATCH" ||
                    method === "DELETE") {
                    return true;
                }
                if (contentType.includes("application/json")) {
                    return true;
                }
                const lowerUrl = url.toLowerCase();
                if (lowerUrl.includes("/api/") ||
                    lowerUrl.includes("/graphql") ||
                    lowerUrl.includes("/auth") ||
                    lowerUrl.includes("/login")) {
                    return true;
                }
                return false;
            });
            let metricsForScenario = null;
            if (apiLikeEntries.length === 0) {
                actualParts.push("No external API interaction detected.");
            }
            else {
                const networkData = apiLikeEntries.map((entry) => {
                    const url = typeof entry.url === "string" ? entry.url : "";
                    const method = typeof entry.method === "string"
                        ? entry.method.toUpperCase()
                        : "GET";
                    const status = typeof entry.status === "number" ? entry.status : 0;
                    const durationMs = typeof entry.durationMs === "number" &&
                        Number.isFinite(entry.durationMs) &&
                        entry.durationMs >= 0
                        ? entry.durationMs
                        : 0;
                    const duration = durationMs;
                    const startTime = 0;
                    const endTime = duration;
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
                const metrics = (0, networkAnalyzer_1.analyzeNetwork)(networkData);
                metricsForScenario = metrics;
                if (metrics.totalApiCalls === 0) {
                    actualParts.push("No external API interaction detected.");
                }
                else {
                    const networkSummary = `Network analysis: Total API calls: ${metrics.totalApiCalls}, ` +
                        `Average latency: ${Math.round(metrics.averageLatency)} ms, ` +
                        `Total API time: ${metrics.totalApiTime} ms, ` +
                        `Unique API endpoints: ${metrics.apiCalls.length}.`;
                    actualParts.push(networkSummary);
                }
            }
            const actual = actualParts.join(" ");
            const pass = !stepExecutionFailed && uiChanged && networkValidationNotes.length === 0;
            const scenarioResult = {
                scenarioName: workflowDescription,
                expected,
                actual,
                pass,
                networkValidation: networkValidationNotes,
                retryAttempted,
                notes: uiNotes.trim(),
            };
            if (metricsForScenario) {
                const augmented = scenarioResult;
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
        const state = {
            plan: latestPlan,
            // Raw network logs are intentionally typed as any.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            networkLogs: finalNetworkLogs,
            scenarioResults,
            startTime,
            timeoutSeconds: config.timeoutSeconds,
        };
        return state;
    }
    finally {
        await browser.close().catch(() => undefined);
    }
}
function buildExecutionIntelligenceContext(pythonState) {
    const domSnapshot = typeof pythonState.dom_snapshot === "string" ? pythonState.dom_snapshot : "";
    const root = pythonState;
    const crawl = root.crawl;
    let pagesVisited = 0;
    let depthReached = 0;
    if (crawl && typeof crawl === "object" && !Array.isArray(crawl)) {
        const crawlRecord = crawl;
        if (Array.isArray(crawlRecord.visitedPages)) {
            pagesVisited = crawlRecord.visitedPages.length;
        }
        if (typeof crawlRecord.depthReached === "number") {
            depthReached = crawlRecord.depthReached;
        }
    }
    const networkLogsUnknown = root.network_logs;
    const networkLogs = Array.isArray(networkLogsUnknown)
        ? networkLogsUnknown
        : [];
    const totalRequests = networkLogs.length;
    let failedRequests = 0;
    const failedEndpointSet = new Set();
    for (const entry of networkLogs) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry;
        const status = typeof record.status === "number" ? record.status : 0;
        const successField = typeof record.success === "boolean" ? record.success : undefined;
        const isFailure = successField === false || status >= 400 || status === 0;
        if (isFailure) {
            failedRequests += 1;
            const url = typeof record.url === "string" ? record.url : "";
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
let phase3Logged = false;
async function adaptiveExecutionLoop(context) {
    const { browser } = context;
    const tool = context.tool;
    const executeActionPlaywright = createPlaywrightExecutor(browser);
    const executeActionSelenium = createSeleniumExecutor(browser);
    let stepCount = 0;
    const maxSteps = Math.max(1, Math.floor(context.maxSteps));
    const executedSteps = [];
    let uiNotes = "";
    let stopReason = "Stopped: unknown reason.";
    let stepExecutionFailed = false;
    let retryAttempted = false;
    let previousDomHash = null;
    let retryCount = 0;
    const screenshots = [];
    const hashDomSnapshot = (snapshot) => {
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
                const screenshotPath = await captureFailureScreenshot(browser, context.screenshotsDir, stepCount, "timeout");
                if (screenshotPath) {
                    screenshots.push(screenshotPath);
                }
            }
            catch {
                // Ignore screenshot errors to keep execution resilient.
            }
            break;
        }
        let domSnapshot;
        let networkSnapshot;
        let currentDomHash;
        try {
            domSnapshot = await captureDOM(browser);
            networkSnapshot = await captureNetworkState(browser);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
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
            }
            else {
                uiNotes += "DOM did not change after retry attempt. ";
                stopReason = "Stopped: stuck detected (DOM unchanged).";
                try {
                    const screenshotPath = await captureFailureScreenshot(browser, context.screenshotsDir, stepCount, "stuck-state");
                    if (screenshotPath) {
                        screenshots.push(screenshotPath);
                    }
                }
                catch {
                    // Ignore screenshot errors to keep execution resilient.
                }
                break;
            }
        }
        else {
            retryCount = 0;
            previousDomHash = currentDomHash;
        }
        const interactiveElements = extractInteractiveElements(domSnapshot);
        if (!phase3Logged) {
            // eslint-disable-next-line no-console
            console.log("Phase 3 complete – interactive DOM extraction integrated");
            phase3Logged = true;
        }
        let nextAction = null;
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
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
        const stepString = toInteractionStep(nextAction);
        if (!stepString) {
            stopReason = "Stopped: model returned an invalid next action.";
            break;
        }
        if (Date.now() > context.deadlineMs) {
            uiNotes += "Timed out before executing next action. ";
            stopReason = "Stopped: timeout reached.";
            stepExecutionFailed = true;
            try {
                const screenshotPath = await captureFailureScreenshot(browser, context.screenshotsDir, stepCount, "timeout");
                if (screenshotPath) {
                    screenshots.push(screenshotPath);
                }
            }
            catch {
                // Ignore screenshot errors to keep execution resilient.
            }
            break;
        }
        try {
            const success = tool === "selenium"
                ? await executeActionSelenium(stepString)
                : await executeActionPlaywright(stepString);
            if (!success) {
                if (!retryAttempted) {
                    retryAttempted = true;
                    const retrySuccess = tool === "selenium"
                        ? await executeActionSelenium(stepString)
                        : await executeActionPlaywright(stepString);
                    if (!retrySuccess) {
                        uiNotes += `Step failed after retry: "${stepString}". `;
                        stepExecutionFailed = true;
                        stopReason = "Stopped: action execution failed.";
                        try {
                            const screenshotPath = await captureFailureScreenshot(browser, context.screenshotsDir, stepCount, "action-error");
                            if (screenshotPath) {
                                screenshots.push(screenshotPath);
                            }
                        }
                        catch {
                            // Ignore screenshot errors to keep execution resilient.
                        }
                        break;
                    }
                }
                else {
                    uiNotes += `Step failed: "${stepString}". `;
                    stepExecutionFailed = true;
                    stopReason = "Stopped: action execution failed.";
                    try {
                        const screenshotPath = await captureFailureScreenshot(browser, context.screenshotsDir, stepCount, "action-error");
                        if (screenshotPath) {
                            screenshots.push(screenshotPath);
                        }
                    }
                    catch {
                        // Ignore screenshot errors to keep execution resilient.
                    }
                    break;
                }
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            uiNotes += `Execution error for "${stepString}": ${message}. `;
            stepExecutionFailed = true;
            stopReason = "Stopped: action execution error.";
            try {
                const screenshotPath = await captureFailureScreenshot(browser, context.screenshotsDir, stepCount, "action-error");
                if (screenshotPath) {
                    screenshots.push(screenshotPath);
                }
            }
            catch {
                // Ignore screenshot errors to keep execution resilient.
            }
            break;
        }
        executedSteps.push(stepString);
        stepCount += 1;
        try {
            const postDomSnapshot = await captureDOM(browser);
            // Phase 2: Capture DOM AFTER action execution and update hash.
            currentDomHash = hashDomSnapshot(postDomSnapshot);
        }
        catch {
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
async function captureFailureScreenshot(browser, screenshotsDir, stepCount, reason) {
    try {
        const safeReason = reason.replace(/[^a-zA-Z0-9-_]/g, "-");
        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-");
        const fileName = `step-${stepCount}-${safeReason}-${timestamp}.png`;
        const filePath = path.join(screenshotsDir, fileName);
        if (typeof browser.captureScreenshot === "function") {
            await browser.captureScreenshot(filePath);
            return filePath;
        }
        return null;
    }
    catch {
        return null;
    }
}
async function captureDOM(browser) {
    return await browser.getDOMSnapshot();
}
async function captureNetworkState(browser) {
    const logs = await browser.getNetworkLogs();
    const recent = logs.slice(Math.max(0, logs.length - 30));
    const recentEndpoints = recent
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
async function decideNextAction(input) {
    const domPreview = input.domSnapshot.slice(0, 4000);
    const executedPreview = input.executedSteps.slice(-10).join("\n");
    const interactivePreview = input.interactiveElements.slice(0, 50);
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
        const rawResponse = await (0, githubModelsClient_1.callModel)(input.model, prompt, input.token, {
            endpoint: input.llmEndpoint,
            provider: input.llmProvider,
            model: input.model,
        });
        const parsed = safeParseAdaptiveNextAction(rawResponse);
        const validated = validateAdaptiveNextAction(parsed, input.interactiveElements);
        if (validated) {
            return validated;
        }
    }
    return { type: "STOP", reason: "Model failed to propose a valid action." };
}
function toInteractionStep(action) {
    if (action.type === "SCROLL") {
        return "scroll";
    }
    if (action.type === "WAIT") {
        const ms = typeof action.milliseconds === "number" && Number.isFinite(action.milliseconds)
            ? Math.max(0, Math.floor(action.milliseconds))
            : 1000;
        return `wait: ${ms}`;
    }
    if (action.type === "CLICK") {
        const selector = typeof action.selector === "string" ? action.selector.trim() : "";
        if (!selector) {
            return null;
        }
        return `click: ${selector}`;
    }
    return null;
}
function safeParseAdaptiveNextAction(rawResponse) {
    if (typeof rawResponse !== "string") {
        return null;
    }
    let candidate = rawResponse.trim();
    if (candidate.length === 0) {
        return null;
    }
    if (candidate.toUpperCase() === "STOP") {
        return { type: "STOP" };
    }
    const fencedMatch = candidate.match(/```(?:json)?([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
        candidate = fencedMatch[1].trim();
    }
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch || !objectMatch[0]) {
        return null;
    }
    candidate = objectMatch[0];
    const parsed = tryParseJson(candidate);
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    const obj = parsed;
    const rawType = typeof obj.type === "string" ? obj.type.trim().toUpperCase() : "";
    const type = rawType === "CLICK" ||
        rawType === "SCROLL" ||
        rawType === "WAIT" ||
        rawType === "STOP"
        ? rawType
        : null;
    if (type === null) {
        return null;
    }
    return {
        type,
        selector: typeof obj.selector === "string" ? obj.selector : undefined,
        milliseconds: typeof obj.milliseconds === "number" ? obj.milliseconds : undefined,
        reason: typeof obj.reason === "string" ? obj.reason : undefined,
    };
}
function tryParseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function validateAdaptiveNextAction(action, interactiveElements) {
    if (!action) {
        return null;
    }
    if (action.type === "CLICK") {
        const selector = typeof action.selector === "string" ? action.selector.trim() : "";
        if (!selector || !selector.startsWith("#")) {
            return null;
        }
        const id = selector.slice(1);
        if (!id) {
            return null;
        }
        const match = interactiveElements.find((el) => el.id === id);
        if (!match) {
            return null;
        }
    }
    return action;
}
function extractInteractiveElements(domSnapshot) {
    const results = [];
    const seenKeys = new Set();
    if (typeof domSnapshot !== "string" || domSnapshot.length === 0) {
        return results;
    }
    const addElement = (tag, attrs, textContent) => {
        const lowerTag = tag.toLowerCase();
        const id = attrs.id;
        const name = attrs.name;
        const type = attrs.type || attrs.role;
        const dataTestId = attrs["data-testid"];
        const dataTest = attrs["data-test"];
        const dataQa = attrs["data-qa"];
        const ariaLabel = attrs["aria-label"];
        const role = attrs.role;
        const placeholder = attrs.placeholder;
        const text = textContent && textContent.trim().length > 0
            ? textContent.trim().slice(0, 200)
            : undefined;
        const key = [
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
    const attributeRegex = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    const parseAttributes = (raw) => {
        const attrs = {};
        let match;
        // eslint-disable-next-line no-cond-assign
        while ((match = attributeRegex.exec(raw)) !== null) {
            const name = match[1].toLowerCase();
            const value = (match[2] ?? match[3] ?? "").trim();
            attrs[name] = value;
        }
        return attrs;
    };
    const pairedTagRegex = /<([a-zA-Z0-9]+)([^>]*)>(.*?)<\/\1>/gs;
    let pairedMatch;
    // eslint-disable-next-line no-cond-assign
    while ((pairedMatch = pairedTagRegex.exec(domSnapshot)) !== null) {
        const tag = pairedMatch[1];
        const rawAttrs = pairedMatch[2] ?? "";
        const inner = pairedMatch[3] ?? "";
        const attrs = parseAttributes(rawAttrs);
        const hasOnClick = Object.prototype.hasOwnProperty.call(attrs, "onclick");
        const role = attrs.role;
        const isRoleButton = typeof role === "string" && role.toLowerCase() === "button";
        const lowerTag = tag.toLowerCase();
        const isInteractiveTag = lowerTag === "button" ||
            lowerTag === "a" ||
            lowerTag === "select";
        if (isInteractiveTag || hasOnClick || isRoleButton) {
            addElement(tag, attrs, inner);
        }
    }
    const selfClosingRegex = /<([a-zA-Z0-9]+)([^>]*?)\/?>/g;
    let selfClosingMatch;
    // eslint-disable-next-line no-cond-assign
    while ((selfClosingMatch = selfClosingRegex.exec(domSnapshot)) !== null) {
        const tag = selfClosingMatch[1];
        const rawAttrs = selfClosingMatch[2] ?? "";
        const attrs = parseAttributes(rawAttrs);
        const lowerTag = tag.toLowerCase();
        const hasOnClick = Object.prototype.hasOwnProperty.call(attrs, "onclick");
        const role = attrs.role;
        const isRoleButton = typeof role === "string" && role.toLowerCase() === "button";
        const isInteractiveTag = lowerTag === "input" ||
            lowerTag === "button" ||
            lowerTag === "select" ||
            lowerTag === "a";
        if (isInteractiveTag || hasOnClick || isRoleButton) {
            addElement(tag, attrs);
        }
    }
    return results;
}
function createPlaywrightExecutor(browser) {
    const executeActionPlaywright = async (action) => {
        return await executeActionCommon(browser, action);
    };
    return executeActionPlaywright;
}
function createSeleniumExecutor(browser) {
    const executeActionSelenium = async (action) => {
        return await executeActionCommon(browser, action);
    };
    return executeActionSelenium;
}
async function executeActionCommon(browser, step) {
    const trimmed = step.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("click:")) {
        const selector = trimmed.slice("click:".length).trim();
        if (selector.length === 0) {
            return false;
        }
        try {
            await browser.click(selector);
            return true;
        }
        catch {
            return false;
        }
    }
    if (lower.startsWith("click ")) {
        const selector = trimmed.slice("click ".length).trim();
        if (selector.length === 0) {
            return false;
        }
        try {
            await browser.click(selector);
            return true;
        }
        catch {
            return false;
        }
    }
    if (lower === "scroll" || lower.startsWith("scroll ")) {
        try {
            await browser.scroll();
            return true;
        }
        catch {
            return false;
        }
    }
    if (lower.startsWith("wait:") || lower.startsWith("wait ")) {
        const raw = lower.startsWith("wait:")
            ? trimmed.slice("wait:".length).trim()
            : trimmed.slice("wait ".length).trim();
        const parsed = Number(raw);
        const ms = Number.isFinite(parsed)
            ? Math.max(0, Math.min(30000, Math.floor(parsed)))
            : 1000;
        try {
            if (typeof browser.waitForTimeout === "function") {
                await browser.waitForTimeout(ms);
            }
            else {
                await new Promise((resolve) => setTimeout(resolve, ms));
            }
            return true;
        }
        catch {
            return false;
        }
    }
    // For non-actionable or descriptive steps, consider them as no-op success.
    return true;
}
