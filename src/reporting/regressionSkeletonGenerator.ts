import * as path from "path";
import { promises as fs } from "fs";
import type { AgentState } from "../core/types";
import type { ExecutionTool } from "./types";
import { ensureEnterpriseOutputStructure } from "./outputManager";

export interface RegressionSkeletonOptions {
  outputDirPath?: string;
}

export async function generateRegressionSkeleton(
  tool: ExecutionTool,
  state: AgentState,
  options: RegressionSkeletonOptions = {}
): Promise<string> {
  const { outputDir } = await ensureEnterpriseOutputStructure({
    outputDirPath: options.outputDirPath,
  });

  const scenarios = state.scenarioResults;

  if (tool === "Playwright") {
    const filename = "regression-playwright.spec.ts";
    const fullPath = path.join(outputDir, filename);

    const lines: string[] = [];
    lines.push("import { test, expect } from '@playwright/test';");
    lines.push("");
    lines.push("test.describe('Regression sweep', () => {");

    for (const scenario of scenarios) {
      lines.push(
        `  test('${scenario.scenarioName.replace(/'/g, "’")}', async ({ page }) => {`
      );
      lines.push(
        `    // Expected outcome: ${scenario.expected.replace(/\r?\n/g, " ")}`
      );
      lines.push(
        "    // TODO: Implement the user journey for this scenario using Playwright."
      );
      lines.push(
        "    // Keep steps clear and human readable so non-technical reviewers can follow the flow."
      );
      lines.push("  });");
      lines.push("");
    }

    lines.push("});");

    await fs.writeFile(fullPath, lines.join("\n"), "utf8");
    return fullPath;
  }

  const filename = "regression-selenium.spec.ts";
  const fullPath = path.join(outputDir, filename);

  const lines: string[] = [];
  lines.push("import { Builder } from 'selenium-webdriver';");
  lines.push("");
  lines.push("export async function runRegressionSweep(): Promise<void> {");
  lines.push("  const driver = await new Builder().forBrowser('chrome').build();");
  lines.push("  try {");

  for (const scenario of scenarios) {
    lines.push(
      `    // Scenario: ${scenario.scenarioName.replace(/\r?\n/g, " ")}`
    );
    lines.push(
      `    // Expected outcome: ${scenario.expected.replace(/\r?\n/g, " ")}`
    );
    lines.push(
      "    // TODO: Implement the user journey for this scenario using Selenium."
    );
    lines.push(
      "    // Keep steps clear and human readable so non-technical reviewers can follow the flow."
    );
    lines.push("");
  }

  lines.push("  } finally {");
  lines.push("    await driver.quit();");
  lines.push("  }");
  lines.push("}");

  await fs.writeFile(fullPath, lines.join("\n"), "utf8");
  return fullPath;
}

