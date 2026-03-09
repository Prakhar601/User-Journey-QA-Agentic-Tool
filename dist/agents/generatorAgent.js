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
    const hasErrorExpected = plan.expectedBehaviors.some((behavior) => /error|fail|invalid|denied|unsuccessful/i.test(behavior));
    lines.push('import { test, expect } from "@playwright/test";', "", 'test("workflow regression", async ({ page }) => {', `  await page.goto("${escapeForDoubleQuotes(config.url)}");`, "");
    // Login
    lines.push("  // Login", "  const usernameLocators = [", "    page.locator('[data-testid*=\"user\" i], [data-testid*=\"email\" i]'),", "    page.locator('[data-test*=\"user\" i], [data-test*=\"email\" i]'),", "    page.locator('[data-qa*=\"user\" i], [data-qa*=\"email\" i]'),", "    page.locator('#username, [id*=\"user\" i], [id*=\"email\" i]'),", "    page.locator('input[name*=\"user\" i], input[name*=\"email\" i]'),", "    page.getByLabel(/email|user(name)?|login/i),", "    page.getByRole('textbox', { name: /email|user(name)?|login/i }),", "    page.getByPlaceholder(/email|user(name)?|login/i),", "  ];", "  const passwordLocators = [", "    page.locator('[data-testid*=\"pass\" i], [data-testid*=\"password\" i]'),", "    page.locator('[data-test*=\"pass\" i], [data-test*=\"password\" i]'),", "    page.locator('[data-qa*=\"pass\" i], [data-qa*=\"password\" i]'),", "    page.locator('#password, [id*=\"pass\" i]'),", "    page.locator('input[name*=\"pass\" i]'),", "    page.getByLabel(/password|passcode|secret/i),", "    page.getByRole('textbox', { name: /password|passcode|secret/i }),", "    page.getByPlaceholder(/password|passcode|secret/i),", "  ];", "  const submitLocators = [", "    page.locator('[data-testid*=\"sign-in\" i], [data-testid*=\"login\" i], [data-testid*=\"submit\" i]'),", "    page.locator('[data-test*=\"sign-in\" i], [data-test*=\"login\" i], [data-test*=\"submit\" i]'),", "    page.locator('[data-qa*=\"sign-in\" i], [data-qa*=\"login\" i], [data-qa*=\"submit\" i]'),", "    page.locator('[id*=\"sign-in\" i], [id*=\"login\" i], [id*=\"submit\" i]'),", "    page.locator('[name*=\"sign-in\" i], [name*=\"login\" i], [name*=\"submit\" i]'),", "    page.getByRole('button', { name: /sign in|log in|continue|submit/i }),", "    page.getByText(/sign in|log in|continue|submit/i),", "    page.locator('button[type=\"submit\"], input[type=\"submit\"]'),", "  ];", "  const pickFirst = async (locators: any[]) => {", "    for (const locator of locators) {", "      const candidate = locator.first ? locator.first() : locator;", "      if (await candidate.count()) {", "        return candidate;", "      }", "    }", "    return null;", "  };", `  const usernameLocator = await pickFirst(usernameLocators);`, "  if (usernameLocator) {", `    await usernameLocator.fill("${escapeForDoubleQuotes(config.username)}");`, "  }", `  const passwordLocator = await pickFirst(passwordLocators);`, "  if (passwordLocator) {", `    await passwordLocator.fill("${escapeForDoubleQuotes(config.password)}");`, "  }", "  const submitLocator = await pickFirst(submitLocators);", "  if (submitLocator) {", "    await Promise.all([", "      page.waitForLoadState(\"networkidle\").catch(() => undefined),", "      submitLocator.click(),", "    ]);", "  } else {", "    await Promise.all([", "      page.waitForLoadState(\"networkidle\").catch(() => undefined),", "      page.keyboard.press(\"Enter\"),", "    ]);", "  }", "");
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
    lines.push("", "  // Assertions based on UI state");
    lines.push('  await expect(page.locator("body")).toBeVisible();');
    lines.push('  await expect(page).not.toHaveURL(/about:blank/);');
    lines.push('  const interactiveLocator = page.locator(\'[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role="button"], button, a, input[type="submit"]\').first();');
    lines.push("  await expect(interactiveLocator).toBeVisible();");
    if (hasErrorExpected) {
        lines.push("");
        lines.push("  const errorRegionLocator = page.locator('[data-testid*=\"error\" i], [data-test*=\"error\" i], [data-qa*=\"error\" i], [aria-label*=\"error\" i], [aria-labelledby*=\"error\" i], [role=\"alert\"], [aria-live=\"assertive\"]');");
        lines.push("  const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);");
        lines.push("  const errorRegionCount = await errorRegionLocator.count();");
        lines.push("  const errorTextCount = await errorTextLocator.count();");
        lines.push("  await expect(errorRegionCount + errorTextCount).toBeGreaterThan(0);");
    }
    lines.push("});", "");
    return lines.join("\n");
}
function buildSeleniumTest(config, plan) {
    const lines = [];
    lines.push("import unittest", "from selenium import webdriver", "from selenium.webdriver.common.by import By", "", "", "class RegressionTest(unittest.TestCase):", "    def setUp(self):", "        self.driver = webdriver.Chrome()", "        self.driver.implicitly_wait(10)", "", "    def test_workflow(self):", "        driver = self.driver", `        driver.get("${escapeForDoubleQuotes(config.url)}")`, "", "        # Login", "        try:", "            username = None", "            try:", "                username = driver.find_element(By.ID, 'username')", "            except Exception:", "                username = None", "            if not username:", "                try:", "                    username = driver.find_element(By.NAME, 'username')", "                except Exception:", "                    username = None", "            if not username:", "                for selector in [", "                    \"input[data-testid*='user' i]\", \"input[data-test*='user' i]\", \"input[data-qa*='user' i]\",", "                    \"input[data-testid*='email' i]\", \"input[data-test*='email' i]\", \"input[data-qa*='email' i]\",", "                    \"input[type='email']\", \"input[name*='user']\", \"input[name*='email']\", \"input#username\",", "                ]:", "                    try:", "                        username = driver.find_element(By.CSS_SELECTOR, selector)", "                        break", "                    except Exception:", "                        continue", `            if username:`, `                username.send_keys("${escapeForDoubleQuotes(config.username)}")`, "        except Exception:", "            pass", "        try:", "            password = None", "            try:", "                password = driver.find_element(By.ID, 'password')", "            except Exception:", "                password = None", "            if not password:", "                try:", "                    password = driver.find_element(By.NAME, 'password')", "                except Exception:", "                    password = None", "            if not password:", "                for selector in [", "                    \"input[data-testid*='pass' i]\", \"input[data-testid*='password' i]\",", "                    \"input[data-test*='pass' i]\", \"input[data-test*='password' i]\",", "                    \"input[data-qa*='pass' i]\", \"input[data-qa*='password' i]\",", "                    \"input[type='password']\", \"input[name*='pass']\", \"input#password\",", "                ]:", "                    try:", "                        password = driver.find_element(By.CSS_SELECTOR, selector)", "                        break", "                    except Exception:", "                        continue", `            if password:`, `                password.send_keys("${escapeForDoubleQuotes(config.password)}")`, "        except Exception:", "            pass", "        try:", "            submit = None", "            for selector in [", "                \"button[data-testid*='sign-in' i]\", \"button[data-testid*='login' i]\", \"button[data-testid*='submit' i]\",", "                \"button[data-test*='sign-in' i]\", \"button[data-test*='login' i]\", \"button[data-test*='submit' i]\",", "                \"button[data-qa*='sign-in' i]\", \"button[data-qa*='login' i]\", \"button[data-qa*='submit' i]\",", "                \"button[type='submit']\", \"input[type='submit']\",", "            ]:", "                try:", "                    submit = driver.find_element(By.CSS_SELECTOR, selector)", "                    break", "                except Exception:", "                    continue", "            if submit:", "                submit.click()", "        except Exception:", "            pass", "", "        # Interaction steps");
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
    lines.push("", "        # Assertions based on UI state");
    lines.push("        body = driver.find_element(By.TAG_NAME, \"body\")");
    lines.push("        assert body.is_displayed()");
    lines.push("        clickable = driver.find_elements(By.CSS_SELECTOR, \"[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role='button'], button, a, input[type='submit']\")");
    lines.push("        assert clickable");
    lines.push("", "    def tearDown(self):", "        self.driver.quit()", "", "", "if __name__ == \"__main__\":", "    unittest.main()", "");
    return lines.join("\n");
}
function escapeForDoubleQuotes(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
