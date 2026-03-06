import { getModelProvider } from "./modelProvider";

interface LlmClientConfig {
  provider?: string;
  endpoint?: string;
  model?: string;
}

/**
 * Unified model call entry point.
 * Uses MODEL_PROVIDER to select backend:
 *   - MODEL_PROVIDER=github → GitHub Models API (GITHUB_PAT, GITHUB_MODEL)
 *   - MODEL_PROVIDER=local (or LLM_PROVIDER=ollama) → Local LLM (LLM_ENDPOINT, LLM_MODEL)
 */
export async function callModel(
  model: string,
  prompt: string,
  token: string,
  llmConfig?: LlmClientConfig
): Promise<string> {
  const provider = getModelProvider();
  const messages = [{ role: "user" as const, content: prompt }];
  const options = {
    model: llmConfig?.model ?? process.env.LLM_MODEL ?? model,
    token,
    endpoint: llmConfig?.endpoint ?? process.env.LLM_ENDPOINT,
    provider: llmConfig?.provider ?? process.env.LLM_PROVIDER,
  };
  return provider.generateResponse(messages, options);
}

export async function listModels(token: string): Promise<string[]> {
  const url: string = "https://models.github.ai/catalog/models";

  const response: Response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const errorText: string = await response.text();
    throw new Error(
      `GitHub Models catalog failed: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    throw new Error("GitHub Models catalog response is not valid JSON.");
  }

  const models: unknown = Array.isArray(data)
    ? data
    : (data as { models?: unknown })?.models ?? [];

  if (!Array.isArray(models)) {
    return [];
  }

  const ids: string[] = [];
  for (const m of models) {
    const id: unknown =
      typeof m === "object" && m !== null && "id" in m
        ? (m as { id?: unknown }).id
        : undefined;
    if (typeof id === "string" && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
}