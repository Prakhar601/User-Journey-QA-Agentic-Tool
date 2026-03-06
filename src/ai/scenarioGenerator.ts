export interface ModelClient {
  /**
   * Calls the underlying language model with the given prompt and
   * returns the raw text response.
   */
  generate(prompt: string): Promise<string>;
}

export class ScenarioGenerationError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly details?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(message: string, details?: any) {
    super(message);
    this.name = "ScenarioGenerationError";
    this.details = details;
  }
}

/**
 * Generate 8–10 independent test scenarios from a PRD-style description.
 *
 * - Sends a structured prompt to the AI model.
 * - Enforces JSON-array-of-strings output.
 * - Validates and caps the number of scenarios.
 */
export async function generateScenariosFromPRD(
  prdDescription: string,
  modelClient: ModelClient
): Promise<string[]> {
  const prompt: string = buildScenarioPrompt(prdDescription);

  const firstRaw: string = await modelClient.generate(prompt);
  let scenarios: string[] = parseScenarioArray(firstRaw);

  if (scenarios.length < 8) {
    const secondRaw: string = await modelClient.generate(prompt);
    scenarios = parseScenarioArray(secondRaw);
  }

  if (scenarios.length < 8) {
    throw new ScenarioGenerationError(
      `AI returned only ${scenarios.length} scenario(s); expected at least 8.`,
      { count: scenarios.length, scenarios }
    );
  }

  if (scenarios.length > 10) {
    scenarios = scenarios.slice(0, 10);
  }

  return scenarios;
}

function buildScenarioPrompt(prdDescription: string): string {
  return [
    "You are a senior QA automation architect.",
    "",
    "From the following product description, generate 8 to 10 independent test scenarios.",
    "",
    "Rules:",
    "- Each scenario must be one complete test case.",
    "- Each scenario must be executable.",
    "- Include both positive and negative cases.",
    "- Include edge cases and validation cases.",
    "- Avoid duplication.",
    "- Be concise but clear.",
    "- Each scenario must be clear, actionable, independent, and describe a single test case.",
    "- Output strictly JSON array of strings.",
    "- Do not include any explanation, commentary, or markdown fences.",
    "",
    "Product Description:",
    prdDescription,
    "",
    "Return format:",
    "[",
    '  \"Scenario 1 ...\",',
    '  \"Scenario 2 ...\"',
    "]",
  ].join("\n");
}

function parseScenarioArray(raw: string): string[] {
  const jsonText: string = extractJsonArrayText(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch (error) {
    throw new ScenarioGenerationError(
      "AI did not return valid JSON array of strings.",
      {
        raw,
        jsonText,
        parseError: error instanceof Error ? error.message : String(error),
      }
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ScenarioGenerationError(
      "Parsed AI output is not a JSON array.",
      { raw, parsed }
    );
  }

  const scenarios: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new ScenarioGenerationError(
        "AI JSON array must contain only strings.",
        { raw, parsed }
      );
    }
    const trimmed: string = item.trim();
    if (trimmed.length > 0) {
      scenarios.push(trimmed);
    }
  }

  return scenarios;
}

function extractJsonArrayText(raw: string): string {
  const firstBracket: number = raw.indexOf("[");
  const lastBracket: number = raw.lastIndexOf("]");

  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new ScenarioGenerationError(
      "Could not locate JSON array brackets in AI output.",
      { raw }
    );
  }

  return raw.slice(firstBracket, lastBracket + 1).trim();
}

