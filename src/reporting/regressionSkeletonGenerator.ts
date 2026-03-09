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
    lines.push("const BASE_URL = process.env.TEST_URL || process.env.URL;");
    lines.push(
      "const USERNAME = process.env.TEST_USERNAME || process.env.USERNAME || '';"
    );
    lines.push(
      "const PASSWORD = process.env.TEST_PASSWORD || process.env.PASSWORD || '';"
    );
    lines.push("");
    lines.push("async function findStableLocator(page: any, locators: any[]) {");
    lines.push("  for (const locator of locators) {");
    lines.push("    const candidate = locator.first ? locator.first() : locator;");
    lines.push("    try {");
    lines.push("      if ((await candidate.count()) === 0) continue;");
    lines.push("      if (!(await candidate.isVisible())) continue;");
    lines.push("      await candidate.waitFor({ state: 'visible', timeout: 2000 });");
    lines.push("      await candidate.scrollIntoViewIfNeeded();");
    lines.push("      return candidate;");
    lines.push("    } catch {");
    lines.push("      continue;");
    lines.push("    }");
    lines.push("  }");
    lines.push("  return null;");
    lines.push("}");
    lines.push("");
    lines.push("async function loginIfCredentialsProvided(page: any) {");
    lines.push("  if (!USERNAME && !PASSWORD) {");
    lines.push("    return;");
    lines.push("  }");
    lines.push("  const usernameLocators = [");
    lines.push(
      "    page.locator('[data-testid*=\"user\" i], [data-testid*=\"email\" i]'),"
    );
    lines.push(
      "    page.locator('[data-test*=\"user\" i], [data-test*=\"email\" i]'),"
    );
    lines.push(
      "    page.locator('[data-qa*=\"user\" i], [data-qa*=\"email\" i]'),"
    );
    lines.push(
      "    page.locator('#username, [id*=\"user\" i], [id*=\"email\" i]'),"
    );
    lines.push(
      "    page.locator('input[name*=\"user\" i], input[name*=\"email\" i]'),"
    );
    lines.push("    page.getByLabel(/email|user(name)?|login/i),");
    lines.push(
      "    page.getByRole('textbox', { name: /email|user(name)?|login/i }),"
    );
    lines.push("    page.getByPlaceholder(/email|user(name)?|login/i),");
    lines.push("  ];");
    lines.push("  const passwordLocators = [");
    lines.push(
      "    page.locator('[data-testid*=\"pass\" i], [data-testid*=\"password\" i]'),"
    );
    lines.push(
      "    page.locator('[data-test*=\"pass\" i], [data-test*=\"password\" i]'),"
    );
    lines.push(
      "    page.locator('[data-qa*=\"pass\" i], [data-qa*=\"password\" i]'),"
    );
    lines.push(
      "    page.locator('#password, [id*=\"pass\" i]'),"
    );
    lines.push(
      "    page.locator('input[name*=\"pass\" i]'),"
    );
    lines.push("    page.getByLabel(/password|passcode|secret/i),");
    lines.push(
      "    page.getByRole('textbox', { name: /password|passcode|secret/i }),"
    );
    lines.push("    page.getByPlaceholder(/password|passcode|secret/i),");
    lines.push("  ];");
    lines.push("  const submitLocators = [");
    lines.push(
      "    page.locator('[data-testid*=\"sign-in\" i], [data-testid*=\"login\" i], [data-testid*=\"submit\" i]'),"
    );
    lines.push(
      "    page.locator('[data-test*=\"sign-in\" i], [data-test*=\"login\" i], [data-test*=\"submit\" i]'),"
    );
    lines.push(
      "    page.locator('[data-qa*=\"sign-in\" i], [data-qa*=\"login\" i], [data-qa*=\"submit\" i]'),"
    );
    lines.push(
      "    page.locator('[id*=\"sign-in\" i], [id*=\"login\" i], [id*=\"submit\" i]'),"
    );
    lines.push(
      "    page.locator('[name*=\"sign-in\" i], [name*=\"login\" i], [name*=\"submit\" i]'),"
    );
    lines.push(
      "    page.getByRole('button', { name: /sign in|log in|login|submit/i }),"
    );
    lines.push(
      "    page.getByText(/sign in|log in|login|submit/i),"
    );
    lines.push(
      "    page.locator('button[type=\"submit\"], input[type=\"submit\"]'),"
    );
    lines.push(
      "    page.getByRole('button', { name: /^Continue$/ }),"
    );
    lines.push("  ];");
    lines.push(
      "  const usernameLocator = USERNAME ? await findStableLocator(page, usernameLocators) : null;"
    );
    lines.push("  if (USERNAME && usernameLocator) {");
    lines.push("    await usernameLocator.fill(USERNAME);");
    lines.push("  }");
    lines.push(
      "  const passwordLocator = PASSWORD ? await findStableLocator(page, passwordLocators) : null;"
    );
    lines.push("  if (PASSWORD && passwordLocator) {");
    lines.push("    await passwordLocator.fill(PASSWORD);");
    lines.push("  }");
    lines.push(
      "  const submitLocator = await findStableLocator(page, submitLocators);"
    );
    lines.push("  if (submitLocator) {");
    lines.push("    await Promise.all([");
    lines.push(
      "      page.waitForLoadState('networkidle').catch(() => undefined),"
    );
    lines.push("      submitLocator.click(),");
    lines.push("    ]);");
    lines.push("  }");
    lines.push("}");
    lines.push("");
    // One Playwright test per scenario: each scenario is a separate test block for reporting and regression analysis.
    lines.push("test.describe('Regression sweep', () => {");

    for (const scenario of scenarios) {
      const scenarioName: string = scenario.scenarioName.replace(/'/g, "’");
      const scenarioIntentText: string = `${scenario.scenarioName} ${
        // Some scenarios may not have an explicit "expected" field
        (scenario as any).expected ?? ""
      }`;
      const expectsError: boolean =
        scenarioExpectsErrorFromText(scenarioIntentText);

      lines.push(
        `  test('${scenarioName}', async ({ page }) => {`
      );
      lines.push("    if (!BASE_URL) {");
      lines.push(
        "      throw new Error('Set TEST_URL or URL environment variable before running regression tests.');"
      );
      lines.push("    }");
      lines.push("");
      lines.push("    // Navigate to the target application");
      lines.push("    await page.goto(BASE_URL);");
      lines.push("    await loginIfCredentialsProvided(page);");
      lines.push(
        "    await page.waitForLoadState('networkidle').catch(() => undefined);"
      );
      lines.push("");
      lines.push("    // Basic smoke interaction");
      lines.push(
        "    const firstClickable = page.locator('button, [role=\"button\"], a').first();"
      );
      lines.push("    if (await firstClickable.count()) {");
      lines.push("      await firstClickable.click();");
      lines.push("    }");
      lines.push("");
      lines.push("    // High-level validation of page state");
      lines.push("    await expect(page.locator('body')).toBeVisible();");
      lines.push("    await expect(page).not.toHaveURL(/about:blank/);");
      lines.push(
        "    const interactiveLocator = page.locator('[data-testid], [data-test], [data-qa], [aria-label], [aria-labelledby], [role=\"button\"], button, a, input[type=\"submit\"]').first();"
      );
      lines.push("    await expect(interactiveLocator).toBeVisible();");

      lines.push("");
      if (!expectsError) {
        lines.push("    // Positive scenario: validate we are not on an auth or error page");
        lines.push("    await expect(page).not.toHaveURL(/login/i);");
        lines.push("    await expect(page).not.toHaveURL(/error/i);");
      } else {
        lines.push(
          "    const errorLocator = page.locator('[data-testid*=\"error\" i], [data-test*=\"error\" i], [data-qa*=\"error\" i], [aria-label*=\"error\" i], [aria-labelledby*=\"error\" i], [role=\"alert\"], [aria-live=\"assertive\"]');"
        );
        lines.push(
          "    const errorTextLocator = page.getByText(/error|invalid|failed|unable|problem|required/i);"
        );
        lines.push(
          "    const errorCount = await errorLocator.count();"
        );
        lines.push(
          "    const errorTextCount = await errorTextLocator.count();"
        );
        lines.push(
          "    expect(errorCount + errorTextCount).toBeGreaterThan(0);"
        );
      }

      lines.push("  });");
      lines.push("");
    }

    lines.push("});");

    const playwrightContent = fixAttributeSelectors(lines.join("\n"));
    await fs.writeFile(fullPath, playwrightContent, "utf8");
    return fullPath;
  }

  const filename = "regression_selenium_regression.py";
  const fullPath = path.join(outputDir, filename);

  const lines: string[] = [];
  lines.push("import os");
  lines.push("import pytest");
  lines.push("from selenium import webdriver");
  lines.push("from selenium.webdriver.common.by import By");
  lines.push("");
  lines.push("BASE_URL = os.getenv('TEST_URL') or os.getenv('URL')");
  lines.push(
    "USERNAME = os.getenv('TEST_USERNAME') or os.getenv('USERNAME') or ''"
  );
  lines.push(
    "PASSWORD = os.getenv('TEST_PASSWORD') or os.getenv('PASSWORD') or ''"
  );
  lines.push("");
  lines.push("@pytest.fixture");
  lines.push("def driver():");
  lines.push("    options = webdriver.ChromeOptions()");
  lines.push(
    "    headless = os.getenv('HEADLESS', 'false').lower() in ('1', 'true', 'yes')"
  );
  lines.push("    if headless:");
  lines.push("        options.add_argument('--headless=new')");
  lines.push("    drv = webdriver.Chrome(options=options)");
  lines.push("    drv.implicitly_wait(10)");
  lines.push("    yield drv");
  lines.push("    drv.quit()");
  lines.push("");
  lines.push("def login_if_credentials_provided(driver):");
  lines.push("    if not BASE_URL:");
  lines.push(
    "        raise RuntimeError('Set TEST_URL or URL environment variable before running selenium regression tests.')"
  );
  lines.push("    driver.get(BASE_URL)");
  lines.push("    if USERNAME:");
  lines.push("        try:");
  lines.push(
    "            username = None"
  );
  lines.push(
    "            for selector in ["
  );
  lines.push(
    "                \"input[data-testid*='user' i]\", \"input[data-test*='user' i]\", \"input[data-qa*='user' i]\","
  );
  lines.push(
    "                \"input[data-testid*='email' i]\", \"input[data-test*='email' i]\", \"input[data-qa*='email' i]\","
  );
  lines.push(
    "                \"input[type='email']\", \"input[name*='user']\", \"input[name*='email']\", \"input#username\","
  );
  lines.push(
    "            ]:"
  );
  lines.push(
    "                try:"
  );
  lines.push(
    "                    username = driver.find_element(By.CSS_SELECTOR, selector)"
  );
  lines.push(
    "                    break"
  );
  lines.push(
    "                except Exception:"
  );
  lines.push(
    "                    continue"
  );
  lines.push("            if username:");
  lines.push("                username.send_keys(USERNAME)");
  lines.push("        except Exception:");
  lines.push("            pass");
  lines.push("    if PASSWORD:");
  lines.push("        try:");
  lines.push(
    "            password = None"
  );
  lines.push(
    "            for selector in ["
  );
  lines.push(
    "                \"input[data-testid*='pass' i]\", \"input[data-testid*='password' i]\","
  );
  lines.push(
    "                \"input[data-test*='pass' i]\", \"input[data-test*='password' i]\","
  );
  lines.push(
    "                \"input[data-qa*='pass' i]\", \"input[data-qa*='password' i]\","
  );
  lines.push(
    "                \"input[type='password']\", \"input[name*='pass']\", \"input#password\","
  );
  lines.push(
    "            ]:"
  );
  lines.push(
    "                try:"
  );
  lines.push(
    "                    password = driver.find_element(By.CSS_SELECTOR, selector)"
  );
  lines.push(
    "                    break"
  );
  lines.push(
    "                except Exception:"
  );
  lines.push(
    "                    continue"
  );
  lines.push("            if password:");
  lines.push("                password.send_keys(PASSWORD)");
  lines.push("        except Exception:");
  lines.push("            pass");
  lines.push("    try:");
  lines.push(
    "        submit = None"
  );
  lines.push(
    "        for selector in ["
  );
  lines.push(
    "            \"button[data-testid*='sign-in' i]\", \"button[data-testid*='login' i]\", \"button[data-testid*='submit' i]\","
  );
  lines.push(
    "            \"button[data-test*='sign-in' i]\", \"button[data-test*='login' i]\", \"button[data-test*='submit' i]\","
  );
  lines.push(
    "            \"button[data-qa*='sign-in' i]\", \"button[data-qa*='login' i]\", \"button[data-qa*='submit' i]\","
  );
  lines.push(
    "            \"button[type='submit']\", \"input[type='submit']\","
  );
  lines.push(
    "        ]:"
  );
  lines.push(
    "            try:"
  );
  lines.push(
    "                submit = driver.find_element(By.CSS_SELECTOR, selector)"
  );
  lines.push(
    "                break"
  );
  lines.push(
    "            except Exception:"
  );
  lines.push(
    "                continue"
  );
  lines.push("        if submit:");
  lines.push("            submit.click()");
  lines.push("    except Exception:");
  lines.push("        pass");
  lines.push("");

  scenarios.forEach((scenario, index) => {
    const testName: string = toPythonTestName(index, scenario.scenarioName);
    const scenarioDoc: string = scenario.scenarioName.replace(/\r?\n/g, " ");
    const scenarioIntentText: string = `${scenario.scenarioName} ${
      (scenario as any).expected ?? ""
    }`;
    const expectsError: boolean =
      scenarioExpectsErrorFromText(scenarioIntentText);

    lines.push(`def ${testName}(driver):`);
    lines.push(
      `    \"\"\"Scenario: ${escapeForDoubleQuotes(
        scenarioDoc
      )} | Expected: ${escapeForDoubleQuotes(scenario.expected)}\"\"\"`
    );
    lines.push("    login_if_credentials_provided(driver)");
    lines.push("    # Basic smoke interaction");
    lines.push("    try:");
    lines.push(
      "        clickable = driver.find_elements(By.CSS_SELECTOR, \"button, [role='button'], a\")"
    );
    lines.push("        if clickable:");
    lines.push("            clickable[0].click()");
    lines.push("    except Exception:");
    lines.push("        pass");
    lines.push("");
    lines.push("    # High-level validation of page state");
    lines.push("    body = driver.find_element(By.TAG_NAME, 'body')");
    lines.push("    assert body.is_displayed()");
    lines.push(
      "    clickable = driver.find_elements(By.CSS_SELECTOR, \"button, [role='button'], a, input[type='submit'], [data-test], [data-testid]\")"
    );
    lines.push("    assert clickable");

    if (expectsError) {
      lines.push(
        "    error_elements = driver.find_elements(By.CSS_SELECTOR, \"[role='alert'], [aria-live='assertive'], [data-test*='error'], [data-testid*='error']\")"
      );
      lines.push(
        "    error_texts = [el.text.lower() for el in error_elements if el.text]"
      );
      lines.push(
        "    assert error_elements or any(term in t for t in error_texts for term in ['error', 'invalid', 'failed', 'unable', 'problem', 'required'])"
      );
    } else {
      lines.push("    # Positive scenario: validate we are not on an auth or error page");
      lines.push("    current_url = driver.current_url.lower()");
      lines.push("    assert 'about:blank' not in current_url");
      lines.push("    assert 'login' not in current_url");
      lines.push("    assert 'error' not in current_url");
    }

    lines.push("");
  });

  const seleniumContent = fixAttributeSelectors(lines.join("\n"));
  await fs.writeFile(fullPath, seleniumContent, "utf8");
  return fullPath;
}

function fixAttributeSelectors(content: string): string {
  return content
    .replace(/\[data-testid\*"/g, '[data-testid*="')
    .replace(/\[data-test\*"/g, '[data-test*="')
    .replace(/\[data-qa\*"/g, '[data-qa*="')
    .replace(/\[id\*"/g, '[id*="')
    .replace(/\[name\*"/g, '[name*="')
    .replace(/\[type"/g, '[type="');
}

function scenarioExpectsErrorFromText(text: string): boolean {
  const normalized = text.toLowerCase();
  const negativeKeywords = [
    "invalid",
    "fail",
    "error",
    "rejected",
    "denied",
    "unable",
    "not allowed",
    "incorrect",
  ];

  return negativeKeywords.some((keyword) => normalized.includes(keyword));
}

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toPythonTestName(index: number, scenarioName: string): string {
  const base: string = scenarioName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix: string = `${index + 1}`;
  const trimmed: string = base.length > 50 ? base.slice(0, 50) : base;
  const name: string = trimmed.length > 0 ? trimmed : `scenario_${suffix}`;
  return `test_${name}`;
}

