import { runWorkflow } from "./core/orchestrator";
import { executeWithRetry } from "./core/retry";
import type { WorkflowConfig } from "./core/types";

function getEnv(name: string, required = false): string | undefined {
  const v = process.env[name];
  if (required && (!v || v.trim().length === 0)) {
    // eslint-disable-next-line no-console
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  const url = getEnv("URL", true) as string;
  const username = getEnv("USERNAME", true) as string;
  const password = getEnv("PASSWORD", true) as string;
  const workflowsRaw = getEnv("WORKFLOW_DESCRIPTIONS", true) as string;
  const model = getEnv("MODEL", true) as string;
  const timeoutSeconds = Number(getEnv("TIMEOUT_SECONDS") ?? "60");
  const githubToken = getEnv("GITHUB_TOKEN") ?? "";
  const automationTool: string = (getEnv("AUTOMATION_TOOL") ?? "playwright").trim();

  const workflowDescriptions = workflowsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const config: WorkflowConfig = {
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
    const state = await executeWithRetry(() => runWorkflow(config));
    // eslint-disable-next-line no-console
    console.log("Workflow finished. Summary:");
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Auto-launch failed:", err);
    process.exit(1);
  }
}

void main();
