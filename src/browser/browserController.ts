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

    const submitSelector: string =
      'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")';
    const submitLocator: Locator = page.locator(submitSelector).first();

    if ((await submitLocator.count()) > 0) {
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
    await page.click(selector);
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

    const submitSelector: string =
      'button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit")';
    const submitLocator: Locator = page.locator(submitSelector).first();

    if ((await submitLocator.count()) > 0) {
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
}
