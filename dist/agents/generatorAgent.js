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
exports.generateRegressionTests = generateRegressionTests;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function generateRegressionTests(config, plan) {
    const playwrightSpecPath = path.resolve(process.cwd(), "playwright-regression.spec.ts");
    const seleniumTestPath = path.resolve(process.cwd(), "selenium_regression_test.py");
    const playwrightContent = buildPlaywrightSpec(config, plan);
    const seleniumContent = buildSeleniumTest(config, plan);
    await fs.promises.writeFile(playwrightSpecPath, playwrightContent, {
        encoding: "utf8",
    });
    await fs.promises.writeFile(seleniumTestPath, seleniumContent, {
        encoding: "utf8",
    });
    return {
        playwrightSpecPath,
        seleniumTestPath,
    };
}
function buildPlaywrightSpec(config, plan) {
    const lines = [];
    lines.push('import { test, expect } from "@playwright/test";', "", 'test("workflow regression", async ({ page }) => {', `  await page.goto("${escapeForDoubleQuotes(config.url)}");`, "");
    // Login
    lines.push("  // Login", `  const usernameSelector = 'input[type=\"email\"], input[name*=\"user\"], input[name*=\"email\"], input#username';`, `  const passwordSelector = 'input[type=\"password\"], input[name*=\"pass\"], input#password';`, "  const usernameLocator = page.locator(usernameSelector).first();", "  if (await usernameLocator.count()) {", `    await usernameLocator.fill("${escapeForDoubleQuotes(config.username)}");`, "  }", "  const passwordLocator = page.locator(passwordSelector).first();", "  if (await passwordLocator.count()) {", `    await passwordLocator.fill("${escapeForDoubleQuotes(config.password)}");`, "  }", `  const submitSelector = 'button[type=\"submit\"], input[type=\"submit\"], button:has-text(\"Sign in\"), button:has-text(\"Log in\"), button:has-text(\"Continue\")';`, "  const submitLocator = page.locator(submitSelector).first();", "  if (await submitLocator.count()) {", "    await Promise.all([", "      page.waitForLoadState(\"networkidle\").catch(() => undefined),", "      submitLocator.click(),", "    ]);", "  } else {", "    await Promise.all([", "      page.waitForLoadState(\"networkidle\").catch(() => undefined),", "      page.keyboard.press(\"Enter\"),", "    ]);", "  }", "");
    // Interaction steps
    lines.push("  // Interaction steps");
    for (const step of plan.interactionSteps) {
        const trimmed = step.trim();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith("click:")) {
            const selector = trimmed.slice("click:".length).trim();
            if (selector.length > 0) {
                lines.push(`  await page.click("${escapeForDoubleQuotes(selector)}");`);
            }
            continue;
        }
        if (lower.startsWith("click ")) {
            const selector = trimmed.slice("click ".length).trim();
            if (selector.length > 0) {
                lines.push(`  await page.click("${escapeForDoubleQuotes(selector)}");`);
            }
            continue;
        }
        if (lower === "scroll" || lower.startsWith("scroll ")) {
            lines.push("  await page.evaluate(() => { window.scrollBy(0, window.innerHeight); });");
            continue;
        }
        lines.push(`  // Step: ${escapeForDoubleQuotes(trimmed)}`);
    }
    lines.push("", "  // Assertions based on expected behaviors");
    for (const behavior of plan.expectedBehaviors) {
        const behaviorText = behavior.trim();
        if (behaviorText.length === 0) {
            continue;
        }
        lines.push(`  await expect(page.locator("body")).toContainText("${escapeForDoubleQuotes(behaviorText)}");`);
    }
    lines.push("});", "");
    return lines.join("\n");
}
function buildSeleniumTest(config, plan) {
    const lines = [];
    lines.push("import unittest", "from selenium import webdriver", "from selenium.webdriver.common.by import By", "", "", "class RegressionTest(unittest.TestCase):", "    def setUp(self):", "        self.driver = webdriver.Chrome()", "        self.driver.implicitly_wait(10)", "", "    def test_workflow(self):", "        driver = self.driver", `        driver.get("${escapeForDoubleQuotes(config.url)}")`, "", "        # Login", `        try:`, `            username = driver.find_element(By.CSS_SELECTOR, "input[type='email'], input[name*='user'], input[name*='email'], input#username")`, `            username.send_keys("${escapeForDoubleQuotes(config.username)}")`, "        except Exception:", "            pass", `        try:`, `            password = driver.find_element(By.CSS_SELECTOR, "input[type='password'], input[name*='pass'], input#password")`, `            password.send_keys("${escapeForDoubleQuotes(config.password)}")`, "        except Exception:", "            pass", `        try:`, `            submit = driver.find_element(By.CSS_SELECTOR, "button[type='submit'], input[type='submit']")`, "            submit.click()", "        except Exception:", "            pass", "", "        # Interaction steps");
    for (const step of plan.interactionSteps) {
        const trimmed = step.trim();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith("click:")) {
            const selector = trimmed.slice("click:".length).trim();
            if (selector.length > 0) {
                lines.push(`        try:`, `            element = driver.find_element(By.CSS_SELECTOR, "${escapeForDoubleQuotes(selector)}")`, "            element.click()", "        except Exception:", "            pass");
            }
            continue;
        }
        if (lower.startsWith("click ")) {
            const selector = trimmed.slice("click ".length).trim();
            if (selector.length > 0) {
                lines.push(`        try:`, `            element = driver.find_element(By.CSS_SELECTOR, "${escapeForDoubleQuotes(selector)}")`, "            element.click()", "        except Exception:", "            pass");
            }
            continue;
        }
        if (lower === "scroll" || lower.startsWith("scroll ")) {
            lines.push("        driver.execute_script(\"window.scrollBy(0, window.innerHeight);\")");
            continue;
        }
        lines.push(`        # Step: ${escapeForDoubleQuotes(trimmed)}`);
    }
    lines.push("", "        # Assertions based on expected behaviors");
    for (const behavior of plan.expectedBehaviors) {
        const behaviorText = behavior.trim();
        if (behaviorText.length === 0) {
            continue;
        }
        lines.push(`        self.assertIn("${escapeForDoubleQuotes(behaviorText)}", driver.page_source)`);
    }
    lines.push("", "    def tearDown(self):", "        self.driver.quit()", "", "", "if __name__ == \"__main__\":", "    unittest.main()", "");
    return lines.join("\n");
}
function escapeForDoubleQuotes(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
