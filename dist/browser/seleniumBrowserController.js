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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeleniumBrowserController = void 0;
const readline_sync_1 = __importDefault(require("readline-sync"));
const fs_1 = require("fs");
const selenium_webdriver_1 = require("selenium-webdriver");
const chrome = __importStar(require("selenium-webdriver/chrome"));
class SeleniumBrowserController {
    constructor(timeoutSeconds, headless) {
        this.driver = null;
        this.timeoutMs = timeoutSeconds * 1000;
        this.headless = headless;
    }
    async launchBrowser() {
        if (this.driver !== null) {
            return;
        }
        // Default to Chrome; project config can evolve later.
        const builder = new selenium_webdriver_1.Builder().forBrowser("chrome");
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
    async login(url, username, password) {
        const driver = this.driver;
        if (driver === null) {
            throw new Error("Browser not launched. Call launchBrowser() first.");
        }
        await driver.get(url);
        const usernameSelector = 'input[type="email"], input[name*="user"], input[name*="email"], input#username';
        const passwordSelector = 'input[type="password"], input[name*="pass"], input#password';
        const usernameEl = await this.findFirstCss(driver, [
            usernameSelector,
        ]);
        if (usernameEl) {
            await usernameEl.clear().catch(() => undefined);
            await usernameEl.sendKeys(username);
        }
        const passwordEl = await this.findFirstCss(driver, [
            passwordSelector,
        ]);
        if (passwordEl) {
            await passwordEl.clear().catch(() => undefined);
            await passwordEl.sendKeys(password);
        }
        // Try common submit patterns; fall back to pressing Enter.
        const submitEl = await this.findFirstCss(driver, [
            'button[type="submit"]',
            'input[type="submit"]',
        ]);
        if (submitEl) {
            await submitEl.click();
        }
        else if (passwordEl) {
            await passwordEl.sendKeys(selenium_webdriver_1.Key.ENTER);
        }
        else {
            await driver.actions().sendKeys(selenium_webdriver_1.Key.ENTER).perform().catch(() => undefined);
        }
        await this.handleTwoFactorIfPresent(driver);
    }
    async click(selector) {
        const driver = this.driver;
        if (driver === null) {
            throw new Error("Browser not launched. Call launchBrowser() first.");
        }
        const el = await driver.wait(selenium_webdriver_1.until.elementLocated(selenium_webdriver_1.By.css(selector)), this.timeoutMs);
        await driver.wait(selenium_webdriver_1.until.elementIsVisible(el), this.timeoutMs).catch(() => undefined);
        await el.click();
    }
    async scroll() {
        const driver = this.driver;
        if (driver === null) {
            throw new Error("Browser not launched. Call launchBrowser() first.");
        }
        await driver.executeScript("window.scrollBy(0, window.innerHeight);");
    }
    async getDOMSnapshot() {
        const driver = this.driver;
        if (driver === null) {
            throw new Error("Browser not launched. Call launchBrowser() first.");
        }
        return await driver.getPageSource();
    }
    async getNetworkLogs() {
        // Selenium runtime network capture is driver-specific; keep empty for now.
        return [];
    }
    async captureScreenshot(filePath) {
        const driver = this.driver;
        if (driver === null) {
            throw new Error("Browser not launched. Call launchBrowser() first.");
        }
        const image = await driver.takeScreenshot();
        await fs_1.promises.writeFile(filePath, image, { encoding: "base64" });
    }
    async close() {
        if (this.driver !== null) {
            await this.driver.quit().catch(() => undefined);
            this.driver = null;
        }
    }
    async findFirstCss(driver, selectors) {
        for (const selector of selectors) {
            try {
                const els = await driver.findElements(selenium_webdriver_1.By.css(selector));
                if (els.length > 0) {
                    return els[0] ?? null;
                }
            }
            catch {
                // ignore
            }
        }
        return null;
    }
    async handleTwoFactorIfPresent(driver) {
        const otpSelector = 'input[placeholder*="otp"], input[name*="otp"], input[id*="otp"], input[placeholder*="code"], input[name*="code"], input[id*="code"], input[placeholder*="verification"], input[name*="verification"], input[id*="verification"]';
        const otpEl = await this.findFirstCss(driver, [otpSelector]);
        if (!otpEl) {
            return;
        }
        const otpCode = readline_sync_1.default.question("Enter OTP: ");
        await otpEl.clear().catch(() => undefined);
        await otpEl.sendKeys(otpCode);
        const submitEl = await this.findFirstCss(driver, [
            'button[type="submit"]',
            'input[type="submit"]',
        ]);
        if (submitEl) {
            await submitEl.click();
        }
        else {
            await otpEl.sendKeys(selenium_webdriver_1.Key.ENTER);
        }
    }
}
exports.SeleniumBrowserController = SeleniumBrowserController;
