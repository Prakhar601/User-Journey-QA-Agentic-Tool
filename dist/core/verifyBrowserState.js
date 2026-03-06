"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcpClient_1 = require("../ai/mcpClient");
const TEST_URL = "https://example.com";
const TEST_USERNAME = "verify-user";
const TEST_PASSWORD = "verify-pass";
const TEST_INSTRUCTION = "Stay on the page when finished.";
function verifyBrowserState(state) {
    const reasons = [];
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
async function main() {
    const result = await (0, mcpClient_1.runPythonAgent)({
        url: TEST_URL,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        instruction: TEST_INSTRUCTION,
    });
    const { pass, reasons } = verifyBrowserState(result);
    if (pass) {
        process.stdout.write("PASS\n");
        process.exit(0);
    }
    process.stdout.write(`FAIL\nReasons:\n${reasons.map((r) => `  - ${r}`).join("\n")}\n`);
    process.exit(1);
}
main().catch((err) => {
    process.stdout.write(`FAIL\nReasons:\n  - ${err.message}\n`);
    process.exit(1);
});
