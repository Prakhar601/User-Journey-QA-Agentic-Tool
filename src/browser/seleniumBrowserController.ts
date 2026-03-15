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

  /**
   * Clears an input field and types the given value into it.
   * Equivalent to browserController.fill() — clear then sendKeys.
   */
  public async fill(selector: string, value: string): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    const el = await driver.wait(until.elementLocated(By.css(selector)), this.timeoutMs);
    await driver.wait(until.elementIsVisible(el), this.timeoutMs).catch(() => undefined);
    await el.clear().catch(() => undefined);
    await el.sendKeys(value);
  }

  /**
   * Selects an option in a <select> element by its visible text label.
   * Falls back to matching by value attribute when no label match is found.
   */
  public async selectOption(selector: string, value: string): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    const el = await driver.wait(until.elementLocated(By.css(selector)), this.timeoutMs);
    await driver.wait(until.elementIsVisible(el), this.timeoutMs).catch(() => undefined);

    // Try to find an <option> whose visible text matches, then click it.
    // Fall back to finding by value attribute.
    const options = await el.findElements(By.css("option"));
    let matched = false;

    for (const option of options) {
      try {
        const text = await option.getText();
        if (text.trim() === value.trim()) {
          await option.click();
          matched = true;
          break;
        }
      } catch {
        // skip unreadable options
      }
    }

    if (!matched) {
      // Fall back: select by value attribute via JavaScript.
      await driver.executeScript(
        `
        const sel = arguments[0];
        const val = arguments[1];
        for (const opt of sel.options) {
          if (opt.value === val || opt.text === val) {
            opt.selected = true;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
        `,
        el,
        value
      );
    }
  }

  /**
   * Moves the pointer over the element identified by the CSS selector.
   * Uses the WebDriver Actions API to perform the hover.
   */
  public async hover(selector: string): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    const el = await driver.wait(until.elementLocated(By.css(selector)), this.timeoutMs);
    await driver.wait(until.elementIsVisible(el), this.timeoutMs).catch(() => undefined);
    await driver.actions({ async: true }).move({ origin: el }).perform();
  }

  /**
   * Navigates the current page to the given URL and waits for the page load.
   */
  public async navigate(url: string): Promise<void> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      throw new Error("Browser not launched. Call launchBrowser() first.");
    }

    await driver.get(url);
  }

  /**
   * Returns true when the element identified by the CSS selector is visible.
   * Never throws — returns false when the element is absent or not displayed.
   * Safe to use as a probe in resolveLocator().
   */
  public async isVisible(selector: string): Promise<boolean> {
    const driver: WebDriver | null = this.driver;
    if (driver === null) {
      return false;
    }

    try {
      const els = await driver.findElements(By.css(selector));
      if (els.length === 0) {
        return false;
      }
      const el = els[0];
      if (!el) {
        return false;
      }
      return await el.isDisplayed();
    } catch {
      return false;
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

