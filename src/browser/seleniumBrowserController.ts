import readlineSync from "readline-sync";
import { promises as fs } from "fs";
import {
  Builder,
  By,
  Key,
  until,
  type WebDriver,
  type WebElement,
} from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";

type NetworkLogEntry = {
  url: string;
  method: string;
  status: number | null;
  durationMs: number | null;
  responseJson?: unknown;
};

export class SeleniumBrowserController {
  private driver: WebDriver | null = null;
  private readonly timeoutMs: number;
  private readonly headless: boolean;

  constructor(timeoutSeconds: number, headless: boolean) {
    this.timeoutMs = timeoutSeconds * 1000;
    this.headless = headless;
  }

  public async launchBrowser(): Promise<void> {
    if (this.driver !== null) {
      return;
    }

    // Default to Chrome; project config can evolve later.
    const builder = new Builder().forBrowser("chrome");

    if (this.headless === true) {
      const options = new chrome.Options();
      options.addArguments("--headless=new");
      options.addArguments("--disable-gpu");
      builder.setChromeOptions(options);
    }

    this.driver = await builder.build();
    await this.driver.manage().setTimeouts({
      implicit: 0,
      pageLoad: this.timeoutMs,
      script: this.timeoutMs,
    });
  }

  public async login(url: string, username: string, password: string): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    await driver.get(url);

    const usernameSelector =
      'input[type="email"], input[name*="user"], input[name*="email"], input#username';
    const passwordSelector =
      'input[type="password"], input[name*="pass"], input#password';

    const usernameEl: WebElement | null = await this.findFirstCss(driver, [
      usernameSelector,
    ]);
    if (usernameEl) {
      await usernameEl.clear().catch(() => undefined);
      await usernameEl.sendKeys(username);
    }

    const passwordEl: WebElement | null = await this.findFirstCss(driver, [
      passwordSelector,
    ]);
    if (passwordEl) {
      await passwordEl.clear().catch(() => undefined);
      await passwordEl.sendKeys(password);
    }

    // Try common submit patterns; fall back to pressing Enter.
    const submitEl: WebElement | null = await this.findFirstCss(driver, [
      'button[type="submit"]',
      'input[type="submit"]',
    ]);

    if (submitEl) {
      await submitEl.click();
    } else if (passwordEl) {
      await passwordEl.sendKeys(Key.ENTER);
    } else {
      await driver.actions().sendKeys(Key.ENTER).perform().catch(() => undefined);
    }

    await this.handleTwoFactorIfPresent(driver);
  }

  public async click(selector: string): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    const el = await driver.wait(until.elementLocated(By.css(selector)), this.timeoutMs);
    await driver.wait(until.elementIsVisible(el), this.timeoutMs).catch(() => undefined);
    await el.click();
  }

  public async scroll(): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    await driver.executeScript("window.scrollBy(0, window.innerHeight);");
  }

  public async getDOMSnapshot(): Promise<string> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    return await driver.getPageSource();
  }

  public async getNetworkLogs(): Promise<NetworkLogEntry[]> {
    // Selenium runtime network capture is driver-specific; keep empty for now.
    return [];
  }

  public async captureScreenshot(filePath: string): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    const image: string = await driver.takeScreenshot();
    await fs.writeFile(filePath, image, { encoding: "base64" });
  }

  public async close(): Promise<void> {
    if (this.driver !== null) {
      await this.driver.quit().catch(() => undefined);
      this.driver = null;
    }
  }

  private async findFirstCss(
    driver: WebDriver,
    selectors: string[]
  ): Promise<WebElement | null> {
    for (const selector of selectors) {
      try {
        const els = await driver.findElements(By.css(selector));
        if (els.length > 0) {
          return els[0] ?? null;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  private async handleTwoFactorIfPresent(driver: WebDriver): Promise<void> {
    const otpSelector =
      'input[placeholder*="otp"], input[name*="otp"], input[id*="otp"], input[placeholder*="code"], input[name*="code"], input[id*="code"], input[placeholder*="verification"], input[name*="verification"], input[id*="verification"]';

    const otpEl = await this.findFirstCss(driver, [otpSelector]);
    if (!otpEl) {
      return;
    }

    const otpCode: string = readlineSync.question("Enter OTP: ");
    await otpEl.clear().catch(() => undefined);
    await otpEl.sendKeys(otpCode);

    const submitEl: WebElement | null = await this.findFirstCss(driver, [
      'button[type="submit"]',
      'input[type="submit"]',
    ]);
    if (submitEl) {
      await submitEl.click();
    } else {
      await otpEl.sendKeys(Key.ENTER);
    }
  }
}

