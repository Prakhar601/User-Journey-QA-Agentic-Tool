// Dry-run reporting script for audit simulation.
// Uses existing compiled reporting logic and does not touch production flow.

const { writeTestResultsExcel } = require("./dist/reporting/excelReporter");
const { generateNetworkSummary } = require("./dist/reporting/networkSummary");

async function main() {
  // Mock scenario data (single scenario)
  const scenarioResult = {
    scenarioName: "User adds a product to cart successfully",
    expected: "User should log in and add a product to the cart.",
    actual: "User logged in successfully and added one product to the cart.",
    pass: true,
    networkValidation: [generateNetworkSummary(200, 850)],
    retryAttempted: false,
    notes: "",
  };

  // Execution metadata based on provided simulation details
  const targetUrlEnv =
    (process.env.DRY_RUN_TARGET_URL ||
      process.env.TARGET_URL ||
      process.env.BASE_URL ||
      "").trim();

  if (!targetUrlEnv) {
    throw new Error(
      "Dry-run target URL is not configured. Set DRY_RUN_TARGET_URL, TARGET_URL, or BASE_URL."
    );
  }

  const modelUsedEnv = (process.env.DRY_RUN_MODEL || "").trim();

  const executionMetadata = {
    executionId: "TEST-AUDIT-001",
    executionDate: new Date().toISOString(),
    environment: "Local",
    modelUsed: modelUsedEnv || "test-model",
    targetUrl: targetUrlEnv,
    automationTool: "Playwright",
    browser: "Chromium",
    headlessMode: "UI",
    totalScenarios: 1,
    passed: 1,
    failed: 0,
  };

  const context = {
    executionTool: "Playwright",
    executionEnvironment: "Playwright in visible Chromium browser",
    // Let output manager resolve the standard enterprise output folder.
    outputDirPath: undefined,
    executionMetadata,
  };

  await writeTestResultsExcel([scenarioResult], context);

  console.log(
    "Dry-run Excel report generated to enterprise output folder (TestResults.xlsx)."
  );
}

main().catch((err) => {
  console.error("Dry-run report generation failed:", err);
  process.exit(1);
});

