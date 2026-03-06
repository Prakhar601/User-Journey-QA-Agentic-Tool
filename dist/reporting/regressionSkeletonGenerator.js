"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRegressionSkeleton = generateRegressionSkeleton;
const path = __importStar(require("path"));
const fs_1 = require("fs");
const outputManager_1 = require("./outputManager");
async function generateRegressionSkeleton(tool, state, options = {}) {
    const { outputDir } = await (0, outputManager_1.ensureEnterpriseOutputStructure)({
        outputDirPath: options.outputDirPath,
    });
    const scenarios = state.scenarioResults;
    if (tool === "Playwright") {
        const filename = "regression-playwright.spec.ts";
        const fullPath = path.join(outputDir, filename);
        const lines = [];
        lines.push("import { test, expect } from '@playwright/test';");
        lines.push("");
        lines.push("test.describe('Regression sweep', () => {");
        for (const scenario of scenarios) {
            lines.push(`  test('${scenario.scenarioName.replace(/'/g, "’")}', async ({ page }) => {`);
            lines.push(`    // Expected outcome: ${scenario.expected.replace(/\r?\n/g, " ")}`);
            lines.push("    // TODO: Implement the user journey for this scenario using Playwright.");
            lines.push("    // Keep steps clear and human readable so non-technical reviewers can follow the flow.");
            lines.push("  });");
            lines.push("");
        }
        lines.push("});");
        await fs_1.promises.writeFile(fullPath, lines.join("\n"), "utf8");
        return fullPath;
    }
    const filename = "regression-selenium.spec.ts";
    const fullPath = path.join(outputDir, filename);
    const lines = [];
    lines.push("import { Builder } from 'selenium-webdriver';");
    lines.push("");
    lines.push("export async function runRegressionSweep(): Promise<void> {");
    lines.push("  const driver = await new Builder().forBrowser('chrome').build();");
    lines.push("  try {");
    for (const scenario of scenarios) {
        lines.push(`    // Scenario: ${scenario.scenarioName.replace(/\r?\n/g, " ")}`);
        lines.push(`    // Expected outcome: ${scenario.expected.replace(/\r?\n/g, " ")}`);
        lines.push("    // TODO: Implement the user journey for this scenario using Selenium.");
        lines.push("    // Keep steps clear and human readable so non-technical reviewers can follow the flow.");
        lines.push("");
    }
    lines.push("  } finally {");
    lines.push("    await driver.quit();");
    lines.push("  }");
    lines.push("}");
    await fs_1.promises.writeFile(fullPath, lines.join("\n"), "utf8");
    return fullPath;
}
