"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callModel = callModel;
exports.listModels = listModels;
const modelProvider_1 = require("./modelProvider");
/**
 * Unified model call entry point.
 * Uses MODEL_PROVIDER to select backend:
 *   - MODEL_PROVIDER=github → GitHub Models API (GITHUB_PAT, GITHUB_MODEL)
 *   - MODEL_PROVIDER=local (or LLM_PROVIDER=ollama) → Local LLM (LLM_ENDPOINT, LLM_MODEL)
 */
async function callModel(model, prompt, token, llmConfig) {
    const provider = (0, modelProvider_1.getModelProvider)();
    const messages = [{ role: "user", content: prompt }];
    const options = {
        model: llmConfig?.model ?? process.env.LLM_MODEL ?? model,
        token,
        endpoint: llmConfig?.endpoint ?? process.env.LLM_ENDPOINT,
        provider: llmConfig?.provider ?? process.env.LLM_PROVIDER,
    };
    return provider.generateResponse(messages, options);
}
async function listModels(token) {
    const url = "https://models.github.ai/catalog/models";
    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub Models catalog failed: ${response.status} ${response.statusText}\n${errorText}`);
    }
    let data;
    try {
        data = (await response.json());
    }
    catch {
        throw new Error("GitHub Models catalog response is not valid JSON.");
    }
    const models = Array.isArray(data)
        ? data
        : data?.models ?? [];
    if (!Array.isArray(models)) {
        return [];
    }
    const ids = [];
    for (const m of models) {
        const id = typeof m === "object" && m !== null && "id" in m
            ? m.id
            : undefined;
        if (typeof id === "string" && id.length > 0) {
            ids.push(id);
        }
    }
    return ids;
}
