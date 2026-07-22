import type { GenerateResponseResult, ProviderKind } from "./modelProvider";

export interface InferenceLogContext {
  provider: ProviderKind | string;
  model: string;
  endpoint: string;
}

export function logInference(context: InferenceLogContext, result: GenerateResponseResult): void {
  const lines = [
    `[LLM] Provider: ${context.provider}`,
    `[LLM] Model: ${context.model}`,
    `[LLM] Endpoint: ${context.endpoint}`,
    `[LLM] Inference Time: ${result.inferenceTimeMs}ms`,
  ];

  if (result.promptTokens !== undefined) {
    lines.push(`[LLM] Prompt Tokens: ${result.promptTokens}`);
  }
  if (result.completionTokens !== undefined) {
    lines.push(`[LLM] Completion Tokens: ${result.completionTokens}`);
  }
  if (result.totalTokens !== undefined) {
    lines.push(`[LLM] Total Tokens: ${result.totalTokens}`);
  }

  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}
