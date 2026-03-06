"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("./core/orchestrator");
const retry_1 = require("./core/retry");
function getEnv(name, required = false) {
    const v = process.env[name];
    if (required && (!v || v.trim().length === 0)) {
        // eslint-disable-next-line no-console
        console.error(`Missing required env var: ${name}`);
        process.exit(2);
    }
    return v;
}
async function main() {
    const url = getEnv("URL", true);
    const username = getEnv("USERNAME", true);
    const password = getEnv("PASSWORD", true);
    const workflowsRaw = getEnv("WORKFLOW_DESCRIPTIONS", true);
    const model = getEnv("MODEL", true);
    const timeoutSeconds = Number(getEnv("TIMEOUT_SECONDS") ?? "60");
    const githubToken = getEnv("GITHUB_TOKEN") ?? "";
    const automationTool = (getEnv("AUTOMATION_TOOL") ?? "playwright").trim();
    const workflowDescriptions = workflowsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const config = {
        url,
        username,
        password,
        workflowDescriptions,
        model,
        timeoutSeconds,
        githubToken,
        automationTool,
    };
    try {
        const state = await (0, retry_1.executeWithRetry)(() => (0, orchestrator_1.runWorkflow)(config));
        // eslint-disable-next-line no-console
        console.log("Workflow finished. Summary:");
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(state, null, 2));
        process.exit(0);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error("Auto-launch failed:", err);
        process.exit(1);
    }
}
void main();
