import { logInference } from "./inferenceLogger";
import type { GenerateResponseOptions } from "./modelProvider";
import {
  buildProviderConfig,
  resolveEndpoint,
  resolveProviderKind,
} from "./providerConfig";
import { createModelProvider } from "./providerFactory";

interface LlmClientConfig {
  provider?: string;
  endpoint?: string;
  model?: string;
}

/**
 * Unified model call entry point.
 * Provider selection is env-driven via MODEL_PROVIDER / MODEL_NAME.
 * Backwards compatible with LLM_PROVIDER, LLM_MODEL, GITHUB_MODEL.
 */
export async function callModel(
  model: string,
  prompt: string,
  token: string,
  llmConfig?: LlmClientConfig
): Promise<string> {
  const providerKind = resolveProviderKind(llmConfig?.provider);
  const config = buildProviderConfig({
    provider: providerKind,
    model: llmConfig?.model ?? model,
    endpoint: llmConfig?.endpoint,
    token: token || undefined,
  });

  const provider = createModelProvider(providerKind);
  const messages = [{ role: "user" as const, content: prompt }];
  const options: GenerateResponseOptions = {
    model: config.model,
    token: config.apiKey || token,
    endpoint: config.endpoint,
    provider: providerKind,
    timeoutMs: config.timeoutMs,
  };

  const result = await provider.generateResponse(messages, options);

  logInference(
    {
      provider: providerKind,
      model: config.model,
      endpoint: resolveEndpoint(providerKind, config.endpoint),
    },
    result
  );

  return result.content;
}

export async function listModels(token: string): Promise<string[]> {
  const provider = createModelProvider("github");
  if (provider.listModels) {
    return provider.listModels({ token });
  }
  return [];
}
