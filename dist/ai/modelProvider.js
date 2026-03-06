"use strict";
/**
 * Model Provider Abstraction Layer
 *
 * Supports switching between Local LLM (Ollama-style) and GitHub Models API
 * via MODEL_PROVIDER environment variable:
 *   - MODEL_PROVIDER=local  → Uses Local LLM (Ollama-style at LLM_ENDPOINT)
 *   - MODEL_PROVIDER=github → Uses GitHub Models inference API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubModelsProvider = exports.LocalLLMProvider = void 0;
exports.getModelProvider = getModelProvider;
/**
 * Resolves the model provider from environment.
 * MODEL_PROVIDER=github | local (default: local for backward compatibility)
 */
function getModelProvider() {
    const raw = (process.env.MODEL_PROVIDER ?? process.env.LLM_PROVIDER ?? "local")
        .trim()
        .toLowerCase();
    if (raw === "github") {
        return new GitHubModelsProvider();
    }
    return new LocalLLMProvider();
}
/**
 * Local LLM (Ollama-style) provider.
 * Uses LLM_ENDPOINT and LLM_MODEL when not overridden in options.
 */
class LocalLLMProvider {
    async generateResponse(messages, options) {
        const endpoint = (options.endpoint ?? process.env.LLM_ENDPOINT ?? "").trim();
        const model = (options.model ?? process.env.LLM_MODEL ?? "").trim();
        if (!endpoint || endpoint.length === 0) {
            throw new Error("LLM endpoint is not configured. Set LLM_ENDPOINT or provide endpoint in options when using MODEL_PROVIDER=local.");
        }
        if (!model || model.length === 0) {
            throw new Error("LLM model is not configured. Set LLM_MODEL or provide model in options when using MODEL_PROVIDER=local.");
        }
        const lastUserMessage = messages
            .filter((m) => m.role === "user")
            .pop();
        const prompt = typeof lastUserMessage?.content === "string"
            ? lastUserMessage.content
            : messages.map((m) => m.content).join("\n");
        const baseUrl = endpoint.replace(/\/+$/, "");
        const url = `${baseUrl}/api/generate`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Local LLM inference failed: ${response.status} ${response.statusText}\n${errorText}`);
        }
        const data = (await response.json());
        if (typeof data.response !== "string") {
            throw new Error("Local LLM did not return valid text.");
        }
        return data.response;
    }
}
exports.LocalLLMProvider = LocalLLMProvider;
/**
 * GitHub Models inference API provider.
 * Uses GITHUB_PAT and GITHUB_MODEL from environment.
 */
class GitHubModelsProvider {
    constructor() {
        this.baseUrl = "https://models.github.ai";
    }
    async generateResponse(messages, options) {
        const token = (options.token ?? process.env.GITHUB_PAT ?? "").trim();
        const model = (options.model ?? process.env.GITHUB_MODEL ?? "openai/gpt-4.1-mini").trim();
        if (!token || token.length === 0) {
            throw new Error("GitHub PAT is not configured. Set GITHUB_PAT when using MODEL_PROVIDER=github.");
        }
        const url = `${this.baseUrl}/inference/chat/completions`;
        const body = {
            model,
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        };
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            const status = response.status;
            if (status === 403) {
                // eslint-disable-next-line no-console
                console.warn("GitHub Models API returned 403. This may indicate budget exceeded or insufficient permissions.");
            }
            throw new Error(`GitHub Models inference failed: ${status} ${response.statusText}\n${errorText}`);
        }
        const data = (await response.json());
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
            throw new Error("GitHub Models did not return valid content in choices[0].message.content");
        }
        return content;
    }
}
exports.GitHubModelsProvider = GitHubModelsProvider;
