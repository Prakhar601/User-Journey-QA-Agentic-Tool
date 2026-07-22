import {
  AMDModelProvider,
  GitHubModelsProvider,
  OllamaModelProvider,
  type ModelProvider,
  type ProviderKind,
} from "./modelProvider";
import { normalizeProviderKind } from "./providerConfig";

/**
 * Single factory for model provider selection.
 * All provider switching should go through this function.
 */
export function createModelProvider(provider?: string): ModelProvider {
  const kind: ProviderKind = normalizeProviderKind(provider);

  switch (kind) {
    case "github":
      return new GitHubModelsProvider();
    case "amd":
      return new AMDModelProvider();
    case "ollama":
    default:
      return new OllamaModelProvider();
  }
}

/** Resolve provider from env and instantiate. */
export function getModelProvider(): ModelProvider {
  const raw =
    process.env.MODEL_PROVIDER ?? process.env.LLM_PROVIDER ?? "local";
  return createModelProvider(raw);
}
