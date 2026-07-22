/**
 * Centralized LLM provider configuration resolved from environment variables.
 *
 * Primary selectors:
 *   MODEL_PROVIDER = github | ollama | amd | local
 *   MODEL_NAME     = model identifier (overrides provider-specific defaults)
 *
 * Backwards-compatible fallbacks:
 *   LLM_PROVIDER, LLM_MODEL, GITHUB_MODEL, AMD_MODEL
 */

export type ProviderKind = "github" | "ollama" | "amd";

export interface ProviderRuntimeConfig {
  provider: ProviderKind;
  model: string;
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
}

const DEFAULT_GITHUB_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 120_000;

/** Normalize provider aliases (local → ollama). */
export function normalizeProviderKind(raw: string | undefined): ProviderKind {
  const value = (raw ?? "local").trim().toLowerCase();
  if (value === "github") return "github";
  if (value === "amd") return "amd";
  return "ollama";
}

/** Resolve active provider from env (MODEL_PROVIDER takes precedence over LLM_PROVIDER). */
export function resolveProviderKind(override?: string): ProviderKind {
  const raw =
    override ??
    process.env.MODEL_PROVIDER ??
    process.env.LLM_PROVIDER ??
    "local";
  return normalizeProviderKind(raw);
}

/** Resolve model name with MODEL_NAME taking precedence over legacy vars. */
export function resolveModelName(
  provider: ProviderKind,
  override?: string
): string {
  if (override?.trim()) {
    return override.trim();
  }

  const modelName = (process.env.MODEL_NAME ?? "").trim();
  if (modelName.length > 0) {
    return modelName;
  }

  switch (provider) {
    case "github":
      return (process.env.GITHUB_MODEL ?? DEFAULT_GITHUB_MODEL).trim();
    case "amd":
      return (process.env.AMD_MODEL ?? "").trim();
    case "ollama":
    default:
      return (process.env.LLM_MODEL ?? "").trim();
  }
}

export function resolveEndpoint(
  provider: ProviderKind,
  override?: string
): string {
  if (override?.trim()) {
    return override.trim();
  }

  switch (provider) {
    case "github":
      return "https://models.github.ai";
    case "amd":
      return (process.env.AMD_BASE_URL ?? "").trim();
    case "ollama":
    default:
      return (process.env.LLM_ENDPOINT ?? "").trim();
  }
}

export function resolveApiKey(
  provider: ProviderKind,
  override?: string
): string {
  if (override?.trim()) {
    return override.trim();
  }

  switch (provider) {
    case "github":
      return (process.env.GITHUB_PAT ?? process.env.GITHUB_TOKEN ?? "").trim();
    case "amd":
      return (process.env.AMD_API_KEY ?? "").trim();
    case "ollama":
    default:
      return "";
  }
}

export function resolveTimeoutMs(override?: number): number {
  if (typeof override === "number" && override > 0) {
    return override;
  }

  const provider = resolveProviderKind();
  if (provider === "amd") {
    const amdTimeout = Number(process.env.AMD_TIMEOUT ?? "");
    if (Number.isFinite(amdTimeout) && amdTimeout > 0) {
      return amdTimeout;
    }
  }

  const generic = Number(process.env.LLM_TIMEOUT ?? process.env.MODEL_TIMEOUT ?? "");
  if (Number.isFinite(generic) && generic > 0) {
    return generic;
  }

  return DEFAULT_TIMEOUT_MS;
}

/** Build a full runtime config for the active (or overridden) provider. */
export function buildProviderConfig(options?: {
  provider?: string;
  model?: string;
  endpoint?: string;
  token?: string;
  timeoutMs?: number;
}): ProviderRuntimeConfig {
  const provider = resolveProviderKind(options?.provider);
  return {
    provider,
    model: resolveModelName(provider, options?.model),
    endpoint: resolveEndpoint(provider, options?.endpoint),
    apiKey: resolveApiKey(provider, options?.token),
    timeoutMs: resolveTimeoutMs(options?.timeoutMs),
  };
}

/** Returns providers that appear configured enough to benchmark. */
export function detectEnabledProviders(): ProviderKind[] {
  const enabled: ProviderKind[] = [];
  const explicit = (process.env.BENCHMARK_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const candidates: ProviderKind[] =
    explicit.length > 0
      ? explicit.map((p) => normalizeProviderKind(p))
      : ["github", "ollama", "amd"];

  for (const provider of candidates) {
    if (isProviderConfigured(provider)) {
      enabled.push(provider);
    }
  }

  return enabled;
}

export function isProviderConfigured(provider: ProviderKind): boolean {
  switch (provider) {
    case "github":
      return (
        (process.env.GITHUB_PAT ?? process.env.GITHUB_TOKEN ?? "").trim().length >
        0
      );
    case "amd":
      return (
        (process.env.AMD_BASE_URL ?? "").trim().length > 0 &&
        (process.env.AMD_API_KEY ?? "").trim().length > 0
      );
    case "ollama":
    default:
      return (process.env.LLM_ENDPOINT ?? "").trim().length > 0;
  }
}
