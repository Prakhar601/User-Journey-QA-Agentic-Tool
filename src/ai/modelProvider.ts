/**
 * Model Provider Abstraction Layer
 *
 * Switch providers via MODEL_PROVIDER in .env:
 *   github  → GitHub Models inference API
 *   ollama  → Local Ollama-compatible endpoint (alias: local)
 *   amd     → AMD Radeon Cloud OpenAI-compatible API
 */

import {
  buildProviderConfig,
  resolveApiKey,
  resolveEndpoint,
  resolveModelName,
  resolveProviderKind,
  resolveTimeoutMs,
  type ProviderKind,
  type ProviderRuntimeConfig,
} from "./providerConfig";

export type { ProviderKind, ProviderRuntimeConfig };

export interface ModelMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GenerateResponseOptions {
  model?: string;
  /** GitHub PAT or generic auth token override */
  token?: string;
  /** Provider endpoint base URL override */
  endpoint?: string;
  /** Provider hint for resolution */
  provider?: string;
  timeoutMs?: number;
}

export interface GenerateResponseResult {
  content: string;
  inferenceTimeMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelProvider {
  readonly kind: ProviderKind;
  generateResponse(
    messages: ModelMessage[],
    options: GenerateResponseOptions
  ): Promise<GenerateResponseResult>;
  streamResponse?(
    messages: ModelMessage[],
    options: GenerateResponseOptions
  ): AsyncGenerator<string, GenerateResponseResult, undefined>;
  healthCheck(options?: GenerateResponseOptions): Promise<boolean>;
  listModels?(options?: GenerateResponseOptions): Promise<string[]>;
}

/** @deprecated Use ModelProvider */
export type IModelProvider = ModelProvider;

function extractUsage(data: {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}): Pick<
  GenerateResponseResult,
  "promptTokens" | "completionTokens" | "totalTokens"
> {
  const usage = data.usage;
  if (!usage) {
    return {};
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function resolveRuntimeConfig(
  kind: ProviderKind,
  options: GenerateResponseOptions
): ProviderRuntimeConfig {
  return buildProviderConfig({
    provider: kind,
    model: options.model,
    endpoint: options.endpoint,
    token: options.token,
    timeoutMs: options.timeoutMs,
  });
}

function buildChatUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/${path.replace(/^\/+/, "")}`;
  }
  return `${trimmed}/v1/${path.replace(/^\/+/, "")}`;
}

function lastUserPrompt(messages: ModelMessage[]): string {
  const lastUserMessage = messages.filter((m) => m.role === "user").pop();
  return (
    lastUserMessage?.content ?? messages.map((m) => m.content).join("\n")
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ollama-compatible local provider (MODEL_PROVIDER=ollama or local).
 */
export class OllamaModelProvider implements ModelProvider {
  readonly kind: ProviderKind = "ollama";

  async generateResponse(
    messages: ModelMessage[],
    options: GenerateResponseOptions
  ): Promise<GenerateResponseResult> {
    const config = resolveRuntimeConfig(this.kind, options);
    const started = Date.now();

    if (!config.endpoint) {
      throw new Error(
        "LLM endpoint is not configured. Set LLM_ENDPOINT when using MODEL_PROVIDER=ollama."
      );
    }
    if (!config.model) {
      throw new Error(
        "LLM model is not configured. Set MODEL_NAME or LLM_MODEL when using MODEL_PROVIDER=ollama."
      );
    }

    const baseUrl = config.endpoint.replace(/\/+$/, "");
    const url = `${baseUrl}/api/generate`;

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          prompt: lastUserPrompt(messages),
          stream: false,
        }),
      },
      config.timeoutMs
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama inference failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    const data = (await response.json()) as {
      response?: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };

    if (typeof data.response !== "string") {
      throw new Error("Ollama did not return valid text.");
    }

    return {
      content: data.response,
      inferenceTimeMs: Date.now() - started,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
      totalTokens:
        typeof data.prompt_eval_count === "number" &&
        typeof data.eval_count === "number"
          ? data.prompt_eval_count + data.eval_count
          : undefined,
    };
  }

  async healthCheck(options: GenerateResponseOptions = {}): Promise<boolean> {
    const config = resolveRuntimeConfig(this.kind, options);
    if (!config.endpoint) {
      return false;
    }
    const baseUrl = config.endpoint.replace(/\/+$/, "");
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/tags`,
        { method: "GET" },
        config.timeoutMs
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(options: GenerateResponseOptions = {}): Promise<string[]> {
    const config = resolveRuntimeConfig(this.kind, options);
    if (!config.endpoint) {
      return [];
    }
    const baseUrl = config.endpoint.replace(/\/+$/, "");
    const response = await fetchWithTimeout(
      `${baseUrl}/api/tags`,
      { method: "GET" },
      config.timeoutMs
    );
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };
    return (data.models ?? [])
      .map((m) => m.name ?? "")
      .filter((name) => name.length > 0);
  }
}

/** @deprecated Use OllamaModelProvider */
export const LocalLLMProvider = OllamaModelProvider;

/**
 * GitHub Models inference API provider.
 */
export class GitHubModelsProvider implements ModelProvider {
  readonly kind: ProviderKind = "github";
  private readonly baseUrl = "https://models.github.ai";

  async generateResponse(
    messages: ModelMessage[],
    options: GenerateResponseOptions
  ): Promise<GenerateResponseResult> {
    const config = resolveRuntimeConfig(this.kind, options);
    const started = Date.now();

    if (!config.apiKey) {
      throw new Error(
        "GitHub PAT is not configured. Set GITHUB_PAT when using MODEL_PROVIDER=github."
      );
    }

    const url = `${this.baseUrl}/inference/chat/completions`;
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      },
      config.timeoutMs
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 403) {
        // eslint-disable-next-line no-console
        console.warn(
          "GitHub Models API returned 403. This may indicate budget exceeded or insufficient permissions."
        );
      }
      throw new Error(
        `GitHub Models inference failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        "GitHub Models did not return valid content in choices[0].message.content"
      );
    }

    return {
      content,
      inferenceTimeMs: Date.now() - started,
      ...extractUsage(data),
    };
  }

  async *streamResponse(
    messages: ModelMessage[],
    options: GenerateResponseOptions
  ): AsyncGenerator<string, GenerateResponseResult, undefined> {
    const config = resolveRuntimeConfig(this.kind, options);
    const started = Date.now();

    if (!config.apiKey) {
      throw new Error(
        "GitHub PAT is not configured. Set GITHUB_PAT when using MODEL_PROVIDER=github."
      );
    }

    const url = `${this.baseUrl}/inference/chat/completions`;
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      },
      config.timeoutMs
    );

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(
        `GitHub Models streaming failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    let content = "";
    let firstTokenMs: number | undefined;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            if (firstTokenMs === undefined) {
              firstTokenMs = Date.now() - started;
            }
            content += delta;
            yield delta;
          }
        } catch {
          // Ignore malformed SSE chunks
        }
      }
    }

    return {
      content,
      inferenceTimeMs: Date.now() - started,
      ...(firstTokenMs !== undefined
        ? { timeToFirstTokenMs: firstTokenMs }
        : {}),
    } as GenerateResponseResult & { timeToFirstTokenMs?: number };
  }

  async healthCheck(options: GenerateResponseOptions = {}): Promise<boolean> {
    const config = resolveRuntimeConfig(this.kind, options);
    if (!config.apiKey) {
      return false;
    }
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/catalog/models`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
        config.timeoutMs
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(options: GenerateResponseOptions = {}): Promise<string[]> {
    const config = resolveRuntimeConfig(this.kind, options);
    if (!config.apiKey) {
      return [];
    }
    const response = await fetchWithTimeout(
      `${this.baseUrl}/catalog/models`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      config.timeoutMs
    );
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as unknown;
    const models: unknown = Array.isArray(data)
      ? data
      : (data as { models?: unknown })?.models ?? [];
    if (!Array.isArray(models)) {
      return [];
    }
    const ids: string[] = [];
    for (const m of models) {
      const id =
        typeof m === "object" && m !== null && "id" in m
          ? (m as { id?: unknown }).id
          : undefined;
      if (typeof id === "string" && id.length > 0) {
        ids.push(id);
      }
    }
    return ids;
  }
}

/**
 * AMD Radeon Cloud OpenAI-compatible provider.
 * Reads AMD_BASE_URL, AMD_API_KEY, AMD_MODEL, AMD_TIMEOUT from environment.
 */
export class AMDModelProvider implements ModelProvider {
  readonly kind: ProviderKind = "amd";

  async generateResponse(
    messages: ModelMessage[],
    options: GenerateResponseOptions
  ): Promise<GenerateResponseResult> {
    const config = resolveRuntimeConfig(this.kind, options);
    const started = Date.now();

    if (!config.endpoint) {
      throw new Error(
        "AMD endpoint is not configured. Set AMD_BASE_URL when using MODEL_PROVIDER=amd."
      );
    }
    if (!config.apiKey) {
      throw new Error(
        "AMD API key is not configured. Set AMD_API_KEY when using MODEL_PROVIDER=amd."
      );
    }
    if (!config.model) {
      throw new Error(
        "AMD model is not configured. Set MODEL_NAME or AMD_MODEL when using MODEL_PROVIDER=amd."
      );
    }

    const url = buildChatUrl(config.endpoint, "chat/completions");
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      },
      config.timeoutMs
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AMD inference failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        "AMD provider did not return valid content in choices[0].message.content"
      );
    }

    return {
      content,
      inferenceTimeMs: Date.now() - started,
      ...extractUsage(data),
    };
  }

  async *streamResponse(
    messages: ModelMessage[],
    options: GenerateResponseOptions
  ): AsyncGenerator<string, GenerateResponseResult, undefined> {
    const config = resolveRuntimeConfig(this.kind, options);
    const started = Date.now();

    if (!config.endpoint || !config.apiKey || !config.model) {
      throw new Error(
        "AMD provider requires AMD_BASE_URL, AMD_API_KEY, and MODEL_NAME/AMD_MODEL."
      );
    }

    const url = buildChatUrl(config.endpoint, "chat/completions");
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      },
      config.timeoutMs
    );

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(
        `AMD streaming failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    let content = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            content += delta;
            yield delta;
          }
        } catch {
          // Ignore malformed SSE chunks
        }
      }
    }

    return {
      content,
      inferenceTimeMs: Date.now() - started,
    };
  }

  async healthCheck(options: GenerateResponseOptions = {}): Promise<boolean> {
    const config = resolveRuntimeConfig(this.kind, options);
    if (!config.endpoint || !config.apiKey) {
      return false;
    }
    try {
      const url = buildChatUrl(config.endpoint, "models");
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
        config.timeoutMs
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(options: GenerateResponseOptions = {}): Promise<string[]> {
    const config = resolveRuntimeConfig(this.kind, options);
    if (!config.endpoint || !config.apiKey) {
      return [];
    }
    const url = buildChatUrl(config.endpoint, "models");
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
      config.timeoutMs
    );
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? [])
      .map((m) => m.id ?? "")
      .filter((id) => id.length > 0);
  }
}

export { resolveProviderKind, resolveModelName, resolveEndpoint, resolveApiKey, resolveTimeoutMs };
export { createModelProvider, getModelProvider } from "./providerFactory";
