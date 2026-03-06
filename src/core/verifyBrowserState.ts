import { runPythonAgent } from "../ai/mcpClient";

const TEST_URL = "https://example.com";
const TEST_USERNAME = "verify-user";
const TEST_PASSWORD = "verify-pass";
const TEST_INSTRUCTION = "Stay on the page when finished.";

interface ExtendedBrowserState {
  dom_snapshot?: string;
  network_logs?: unknown;
  meta?: { executionTimeMs?: number };
  crawl?: { visitedPages?: unknown };
}

function verifyBrowserState(state: ExtendedBrowserState): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (typeof state.dom_snapshot !== "string" || state.dom_snapshot.length === 0) {
    reasons.push("dom_snapshot must exist and be a non-empty string");
  }
  if (!Array.isArray(state.network_logs)) {
    reasons.push("network_logs must be an array");
  }
  const execMs = state.meta?.executionTimeMs;
  if (typeof execMs !== "number" || execMs <= 0) {
    reasons.push("meta.executionTimeMs must be a number greater than 0");
  }
  if (!Array.isArray(state.crawl?.visitedPages)) {
    reasons.push("crawl.visitedPages must be an array");
  }

  return {
    pass: reasons.length === 0,
    reasons,
  };
}

async function main(): Promise<void> {
  const result = await runPythonAgent({
    url: TEST_URL,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    instruction: TEST_INSTRUCTION,
  });

  const { pass, reasons } = verifyBrowserState(result as ExtendedBrowserState);

  if (pass) {
    process.stdout.write("PASS\n");
    process.exit(0);
  }

  process.stdout.write(`FAIL\nReasons:\n${reasons.map((r) => `  - ${r}`).join("\n")}\n`);
  process.exit(1);
}

main().catch((err: Error) => {
  process.stdout.write(`FAIL\nReasons:\n  - ${err.message}\n`);
  process.exit(1);
});
