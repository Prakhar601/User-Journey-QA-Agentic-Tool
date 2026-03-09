import readlineSync from "readline-sync";
import type { Locator, Page } from "playwright";
import {
  closeBrowser,
  getNetworkLogs,
  getPage,
  startBrowser,
  type NetworkLogEntry,
} from "./browserSession";

export class BrowserController {
  private readonly timeoutSeconds: number;
  private readonly timeoutMs: number;
  private readonly headless: boolean;

  constructor(timeoutSeconds: number, headless: boolean = true) {
    this.timeoutSeconds = timeoutSeconds;
    this.timeoutMs = timeoutSeconds * 1000;
    this.headless = headless;
  }

  public async launchBrowser(): Promise<void> {
    await startBrowser({
      timeoutSeconds: Math.max(1, this.timeoutSeconds),
      headless: this.headless,
    });
  }

  public async waitForTimeout(ms: number): Promise<void> {
    const page: Page = getPage();
    await page.waitForTimeout(ms);
  }

  public async login(url: string, username: string, password: string): Promise<void> {
    const page: Page = getPage();

    const initialUrl: string = page.url();

    await page.goto(url, { waitUntil: "load", timeout: this.timeoutMs });

    const usernameSelector: string =
      'input[type="email"], input[name*="user"], input[name*="email"], input#username';
    const passwordSelector: string =
      'input[type="password"], input[name*="pass"], input#password';

    const usernameLocator: Locator = page.locator(usernameSelector).first();
    if ((await usernameLocator.count()) > 0) {
      await usernameLocator.fill(username);
    }

    const passwordLocator: Locator = page.locator(passwordSelector).first();
    if ((await passwordLocator.count()) > 0) {
      await passwordLocator.fill(password);
    }

    // Prioritize login-related buttons; "Continue" only as last fallback (avoids "Continue Shopping", etc.)
    const loginSubmitSelectors: string[] = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Submit")',
      'button:has-text("Continue")',
    ];
    const submitLocator: Locator | null = await this.findFirstVisibleSubmitLocator(
      page,
      loginSubmitSelectors
    );

    if (submitLocator) {
      await Promise.all([
        page
          .waitForLoadState("networkidle", { timeout: this.timeoutMs })
          .catch(() => undefined),
        submitLocator.click(),
      ]);
    } else {
      await Promise.all([
        page
          .waitForLoadState("networkidle", { timeout: this.timeoutMs })
          .catch(() => undefined),
        page.keyboard.press("Enter"),
      ]);
    }

    await this.handleTwoFactorIfPresent(page);

    await page
      .waitForFunction(
        (startUrl: string) => window.location.href !== startUrl,
        initialUrl,
        { timeout: this.timeoutMs }
      )
      .catch(() => undefined);
  }

  public async click(selector: string): Promise<void> {
    const page: Page = getPage();
    const locator: Locator = await this.buildSmartLocator(selector, page);

    await locator.waitFor({ state: "visible", timeout: this.timeoutMs });
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
  }

  public async scroll(): Promise<void> {
    const page: Page = getPage();
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
  }

  public async getDOMSnapshot(): Promise<string> {
    const page: Page = getPage();
    return await page.content();
  }

  public async getNetworkLogs(): Promise<NetworkLogEntry[]> {
    return getNetworkLogs();
  }

  public async captureScreenshot(filePath: string): Promise<void> {
    const page: Page = getPage();
    await page.screenshot({ path: filePath }).catch(() => undefined);
  }

  public async close(): Promise<void> {
    await closeBrowser();
  }

  private async handleTwoFactorIfPresent(page: Page): Promise<void> {
    const otpSelector: string =
      'input[placeholder*="otp"], input[name*="otp"], input[id*="otp"], input[placeholder*="code"], input[name*="code"], input[id*="code"], input[placeholder*="verification"], input[name*="verification"], input[id*="verification"]';

    const otpLocator: Locator = page.locator(otpSelector).first();

    if ((await otpLocator.count()) === 0) {
      return;
    }

    const otpCode: string = readlineSync.question("Enter OTP: ");

    await otpLocator.fill(otpCode);

    const twoFactorSubmitSelectors: string[] = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Verify")',
      'button:has-text("Submit")',
      'button:has-text("Continue")',
    ];
    const submitLocator: Locator | null = await this.findFirstVisibleSubmitLocator(
      page,
      twoFactorSubmitSelectors
    );

    if (submitLocator) {
      await Promise.all([
        page
          .waitForLoadState("networkidle", { timeout: this.timeoutMs })
          .catch(() => undefined),
        submitLocator.click(),
      ]);
    } else {
      await Promise.all([
        page
          .waitForLoadState("networkidle", { timeout: this.timeoutMs })
          .catch(() => undefined),
        page.keyboard.press("Enter"),
      ]);
    }
  }

  /**
   * Tries each selector in order and returns the first matching locator that is visible and
   * interactable. Skips hidden modal buttons (e.g. "Continue Shopping"). "Continue" is only
   * used as fallback and must pass visibility checks; buttons like "Continue Shopping" are
   * rejected by requiring exact text "Continue" when the selector matches that label.
   */
  private async findFirstVisibleSubmitLocator(
    page: Page,
    selectors: string[]
  ): Promise<Locator | null> {
    for (const selector of selectors) {
      const locator: Locator = page.locator(selector).first();
      try {
        if ((await locator.count()) === 0) continue;
        if (!(await locator.isVisible())) continue;
        if (selector.includes("Continue") && !selector.includes("Verify")) {
          const text = await locator.evaluate((el) => (el as HTMLElement).innerText?.trim() ?? "");
          if (text !== "Continue") continue;
        }
        await locator.waitFor({ state: "visible", timeout: 2000 });
        await locator.scrollIntoViewIfNeeded();
        return locator;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async buildSmartLocator(
    selector: string,
    page: Page
  ): Promise<Locator> {
    const trimmedSelector: string = selector.trim();
    if (!trimmedSelector) {
      return page.locator(selector);
    }

    const baseLocator: Locator = page.locator(trimmedSelector).first();

    try {
      const info = await baseLocator.evaluate((el) => {
        const element = el as HTMLElement;
        const getAttr = (name: string): string | null =>
          element.getAttribute(name);

        const tagName: string = element.tagName.toLowerCase();
        const id: string | null = element.id || null;
        const dataTestId: string | null = getAttr("data-testid");
        const dataTest: string | null = getAttr("data-test");
        const dataQa: string | null = getAttr("data-qa");
        const ariaLabel: string | null = getAttr("aria-label");
        const role: string | null = getAttr("role");
        const placeholder: string | null =
          (element as HTMLInputElement | HTMLTextAreaElement).placeholder ??
          null;
        const text: string = (
          (element.innerText || element.textContent || "") as string
        ).trim();

        return {
          tagName,
          id,
          dataTestId,
          dataTest,
          dataQa,
          ariaLabel,
          role,
          placeholder,
          text,
        };
      });

      // Selector ranking priority:
      // 1) data-testid
      // 2) data-test
      // 3) data-qa
      // 4) aria-label
      // 5) role with visible text
      // 6) placeholder
      // 7) element text
      // 8) id
      // 9) fallback CSS selector

      if (info.dataTestId) {
        return page.getByTestId(info.dataTestId);
      }

      if (info.dataTest) {
        return page.locator(
          `[data-test="${BrowserController.escapeForAttribute(info.dataTest)}"]`
        );
      }

      if (info.dataQa) {
        return page.locator(
          `[data-qa="${BrowserController.escapeForAttribute(info.dataQa)}"]`
        );
      }

      if (info.ariaLabel) {
        return page.getByLabel(info.ariaLabel);
      }

      if (info.role && info.text) {
        return page.getByRole(info.role as any, { name: info.text });
      }

      if (info.placeholder) {
        return page.getByPlaceholder(info.placeholder);
      }

      if (info.text) {
        return page.getByText(info.text);
      }

      if (info.id) {
        return page.locator(
          `#${BrowserController.escapeForAttribute(info.id)}`
        );
      }

      return baseLocator;
    } catch {
      return baseLocator;
    }
  }

  private static escapeForAttribute(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}
