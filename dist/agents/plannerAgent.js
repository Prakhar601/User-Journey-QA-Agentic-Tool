"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlan = createPlan;
const githubModelsClient_1 = require("../ai/githubModelsClient");
async function createPlan(workflowDescriptions, domSnapshot, networkEndpoints, model, token, executionContext, llmEndpoint, llmProvider) {
    const trimmedWorkflows = workflowDescriptions.map((w) => w.trim());
    const trimmedEndpoints = networkEndpoints.map((e) => e.trim());
    const basePayload = {
        workflows: trimmedWorkflows,
        domSnapshotPreview: domSnapshot.slice(0, 4000),
        networkEndpoints: trimmedEndpoints,
        executionIntelligence: executionContext ??
            {
                domLength: domSnapshot.length,
                crawlStats: {
                    pagesVisited: 0,
                    depthReached: 0,
                },
                networkStats: {
                    totalRequests: trimmedEndpoints.length,
                    failedRequests: 0,
                    failedEndpoints: [],
                },
            },
    };
    const workflowDescription = JSON.stringify(basePayload, null, 2);
    const prompt = `
You are a browser automation planning engine.

Convert the workflow description into structured JSON steps.

Return ONLY valid JSON.
Do NOT include explanations.
Do NOT include markdown.
Do NOT include backticks.
Do NOT include text before or after JSON.

The JSON must EXACTLY follow this schema:

{
  "steps": [
    {
      "action": "click | type | wait | verify",
      "target": "string",
      "expected": "string"
    }
  ]
}

Workflow description:
${workflowDescription}

Return ONLY the JSON object.
`;
    const rawResponse = await (0, githubModelsClient_1.callModel)(model, prompt, token, {
        endpoint: llmEndpoint,
        provider: llmProvider,
        model,
    });
    console.log("=== RAW MODEL RESPONSE START ===");
    console.log(rawResponse);
    console.log("=== RAW MODEL RESPONSE END ===");
    const parsedOrFallback = safeParsePlannerResponse(rawResponse);
    if (isPlannerFallback(parsedOrFallback)) {
        const fallbackNotes = parsedOrFallback.notes || "Planner failed to generate valid structure";
        return {
            interactionSteps: [],
            expectedBehaviors: [fallbackNotes],
            networkValidationRules: [],
        };
    }
    const parsed = parsedOrFallback;
    if (typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray(parsed.steps)) {
        parsed.steps = parsed.steps.map((step) => ({
            action: typeof step.action === "string" ? step.action : "click",
            target: typeof step.target === "string" ? step.target : "",
            expected: typeof step.expected === "string" ? step.expected : "",
        }));
    }
    const validated = validatePlanShape(parsed);
    if (validated === null) {
        return {
            interactionSteps: [],
            expectedBehaviors: ["Planner failed to generate valid structure"],
            networkValidationRules: [],
        };
    }
    return validated;
}
function safeParsePlannerResponse(rawResponse) {
    const fallback = {
        scenarios: [],
        notes: "Planner failed to generate valid structure",
        error: true,
    };
    if (typeof rawResponse !== "string") {
        return fallback;
    }
    let candidate = rawResponse.trim();
    if (candidate.length === 0) {
        return fallback;
    }
    const fencedMatch = candidate.match(/```(?:json)?([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
        candidate = fencedMatch[1].trim();
    }
    let objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch || !objectMatch[0]) {
        return fallback;
    }
    candidate = objectMatch[0];
    const directParsed = tryParseJson(candidate);
    if (directParsed !== null) {
        return directParsed;
    }
    let repaired = candidate.replace(/```/g, "");
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    const firstBrace = repaired.indexOf("{");
    const lastBrace = repaired.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        repaired = repaired.slice(firstBrace, lastBrace + 1);
    }
    objectMatch = repaired.match(/\{[\s\S]*\}/);
    if (objectMatch && objectMatch[0]) {
        repaired = objectMatch[0];
    }
    const reparsed = tryParseJson(repaired);
    if (reparsed !== null) {
        return reparsed;
    }
    return fallback;
}
function tryParseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function isPlannerFallback(value) {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const obj = value;
    return (Array.isArray(obj.scenarios) &&
        typeof obj.notes === "string" &&
        obj.error === true);
}
function validatePlanShape(value) {
    if (value === null || typeof value !== "object") {
        return null;
    }
    const obj = value;
    if (!Array.isArray(obj.steps)) {
        return null;
    }
    const interactionSteps = [];
    const expectedBehaviors = [];
    for (const step of obj.steps) {
        const action = typeof step.action === "string" ? step.action : String(step.action ?? "");
        const target = typeof step.target === "string" ? step.target : String(step.target ?? "");
        const expected = typeof step.expected === "string"
            ? step.expected
            : String(step.expected ?? "");
        if (action.toLowerCase() === "click" && target.length > 0) {
            interactionSteps.push(`click: ${target}`);
        }
        else if (action.toLowerCase() === "scroll") {
            interactionSteps.push("scroll");
        }
        else if (action.length > 0) {
            interactionSteps.push(target.length > 0 ? `${action}: ${target}` : action);
        }
        if (expected.length > 0) {
            expectedBehaviors.push(expected);
        }
    }
    return {
        interactionSteps,
        expectedBehaviors,
        networkValidationRules: [],
    };
}
