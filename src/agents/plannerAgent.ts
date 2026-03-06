import type { ExecutionIntelligenceContext, Plan } from "../core/types";
import { callModel } from "../ai/githubModelsClient";

interface PlannerFallback {
  scenarios: unknown[];
  notes: string;
  error: true;
}

export async function createPlan(
  workflowDescriptions: string[],
  domSnapshot: string,
  networkEndpoints: string[],
  model: string,
  token: string,
  executionContext?: ExecutionIntelligenceContext,
  llmEndpoint?: string,
  llmProvider?: string
): Promise<Plan> {
  const trimmedWorkflows: string[] = workflowDescriptions.map((w) => w.trim());
  const trimmedEndpoints: string[] = networkEndpoints.map((e) => e.trim());

  const basePayload: {
    workflows: string[];
    domSnapshotPreview: string;
    networkEndpoints: string[];
    executionIntelligence: ExecutionIntelligenceContext;
  } = {
    workflows: trimmedWorkflows,
    domSnapshotPreview: domSnapshot.slice(0, 4000),
    networkEndpoints: trimmedEndpoints,
    executionIntelligence:
      executionContext ??
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

  const workflowDescription: string = JSON.stringify(basePayload, null, 2);

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

  const rawResponse: string = await callModel(model, prompt, token, {
    endpoint: llmEndpoint,
    provider: llmProvider,
    model,
  });

  console.log("=== RAW MODEL RESPONSE START ===");
  console.log(rawResponse);
  console.log("=== RAW MODEL RESPONSE END ===");

  const parsedOrFallback: unknown = safeParsePlannerResponse(rawResponse);

  if (isPlannerFallback(parsedOrFallback)) {
    const fallbackNotes: string =
      parsedOrFallback.notes || "Planner failed to generate valid structure";

    return {
      interactionSteps: [],
      expectedBehaviors: [fallbackNotes],
      networkValidationRules: [],
    };
  }

  const parsed: unknown = parsedOrFallback;

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as any).steps)
  ) {
    (parsed as any).steps = (parsed as any).steps.map((step: any) => ({
      action: typeof step.action === "string" ? step.action : "click",
      target: typeof step.target === "string" ? step.target : "",
      expected: typeof step.expected === "string" ? step.expected : "",
    }));
  }

  const validated: Plan | null = validatePlanShape(parsed);

  if (validated === null) {
    return {
      interactionSteps: [],
      expectedBehaviors: ["Planner failed to generate valid structure"],
      networkValidationRules: [],
    };
  }

  return validated;
}

interface PlannerStep {
  action?: unknown;
  target?: unknown;
  expected?: unknown;
}

function safeParsePlannerResponse(rawResponse: string): unknown {
  const fallback: PlannerFallback = {
    scenarios: [],
    notes: "Planner failed to generate valid structure",
    error: true,
  };

  if (typeof rawResponse !== "string") {
    return fallback;
  }

  let candidate: string = rawResponse.trim();

  if (candidate.length === 0) {
    return fallback;
  }

  const fencedMatch: RegExpMatchArray | null = candidate.match(
    /```(?:json)?([\s\S]*?)```/i
  );

  if (fencedMatch && fencedMatch[1]) {
    candidate = fencedMatch[1].trim();
  }

  let objectMatch: RegExpMatchArray | null = candidate.match(/\{[\s\S]*\}/);

  if (!objectMatch || !objectMatch[0]) {
    return fallback;
  }

  candidate = objectMatch[0];

  const directParsed: unknown = tryParseJson(candidate);
  if (directParsed !== null) {
    return directParsed;
  }

  let repaired: string = candidate.replace(/```/g, "");

  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  const firstBrace: number = repaired.indexOf("{");
  const lastBrace: number = repaired.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    repaired = repaired.slice(firstBrace, lastBrace + 1);
  }

  objectMatch = repaired.match(/\{[\s\S]*\}/);
  if (objectMatch && objectMatch[0]) {
    repaired = objectMatch[0];
  }

  const reparsed: unknown = tryParseJson(repaired);
  if (reparsed !== null) {
    return reparsed;
  }

  return fallback;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isPlannerFallback(value: unknown): value is PlannerFallback {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const obj = value as PlannerFallback & { [key: string]: unknown };

  return (
    Array.isArray(obj.scenarios) &&
    typeof obj.notes === "string" &&
    obj.error === true
  );
}

function validatePlanShape(value: unknown): Plan | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const obj = value as { steps?: unknown };
  if (!Array.isArray(obj.steps)) {
    return null;
  }

  const interactionSteps: string[] = [];
  const expectedBehaviors: string[] = [];

  for (const step of obj.steps as PlannerStep[]) {
    const action: string =
      typeof step.action === "string" ? step.action : String(step.action ?? "");
    const target: string =
      typeof step.target === "string" ? step.target : String(step.target ?? "");
    const expected: string =
      typeof step.expected === "string"
        ? step.expected
        : String(step.expected ?? "");

    if (action.toLowerCase() === "click" && target.length > 0) {
      interactionSteps.push(`click: ${target}`);
    } else if (action.toLowerCase() === "scroll") {
      interactionSteps.push("scroll");
    } else if (action.length > 0) {
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
