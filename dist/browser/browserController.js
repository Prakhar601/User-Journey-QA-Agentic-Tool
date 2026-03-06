"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserController = void 0;
const readline_sync_1 = __importDefault(require("readline-sync"));
const browserSession_1 = require("./browserSession");
class BrowserController {
    constructor(timeoutSeconds, headless = true) {
        this.timeoutSeconds = timeoutSeconds;
        this.timeoutMs = timeoutSeconds * 1000;
        this.headless = headless;
    }
    async launchBrowser() {
        await (0, browserSession_1.startBrowser)({
            timeoutSeconds: Math.max(1, this.timeoutSeconds),
            headless: this.headless,
        });
    }
    async waitForTimeout(ms) {
        const page = (0, browserSession_1.getPage)();
        await page.waitForTimeout(ms);
    }
    async login(url, username, password) {
        const page = (0, browserSession_1.getPage)();
        const initialUrl = page.url();
        await page.goto(url, { waitUntil: "load", timeout: this.timeoutMs });
        const usernameSelector = 'input[type="email"], input[name*="user"], input[name*="email"], input#username';
        const passwordSelector = 'input[type="password"], input[name*="pass"], input#password';
        const usernameLocator = page.locator(usernameSelector).first();
        if ((await usernameLocator.count()) > 0) {
            await usernameLocator.fill(username);
        }
        const passwordLocator = page.locator(passwordSelector).first();
        if ((await passwordLocator.count()) > 0) {
            await passwordLocator.fill(password);
        }
        const submitSelector = 'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")';
        const submitLocator = page.locator(submitSelector).first();
        if ((await submitLocator.count()) > 0) {
            await Promise.all([
                page
                    .waitForLoadState("networkidle", { timeout: this.timeoutMs })
                    .catch(() => undefined),
                submitLocator.click(),
            ]);
        }
        else {
            await Promise.all([
                page
                    .waitForLoadState("networkidle", { timeout: this.timeoutMs })
                    .catch(() => undefined),
                page.keyboard.press("Enter"),
            ]);
        }
        await this.handleTwoFactorIfPresent(page);
        await page
            .waitForFunction((startUrl) => window.location.href !== startUrl, initialUrl, { timeout: this.timeoutMs })
            .catch(() => undefined);
    }
    async click(selector) {
        const page = (0, browserSession_1.getPage)();
        await page.click(selector);
    }
    async scroll() {
        const page = (0, browserSession_1.getPage)();
        await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight);
        });
    }
    async getDOMSnapshot() {
        const page = (0, browserSession_1.getPage)();
        return await page.content();
    }
    async getNetworkLogs() {
        return (0, browserSession_1.getNetworkLogs)();
    }
    async captureScreenshot(filePath) {
        const page = (0, browserSession_1.getPage)();
        await page.screenshot({ path: filePath }).catch(() => undefined);
    }
    async close() {
        await (0, browserSession_1.closeBrowser)();
    }
    async handleTwoFactorIfPresent(page) {
        const otpSelector = 'input[placeholder*="otp"], input[name*="otp"], input[id*="otp"], input[placeholder*="code"], input[name*="code"], input[id*="code"], input[placeholder*="verification"], input[name*="verification"], input[id*="verification"]';
        const otpLocator = page.locator(otpSelector).first();
        if ((await otpLocator.count()) === 0) {
            return;
        }
        const otpCode = readline_sync_1.default.question("Enter OTP: ");
        await otpLocator.fill(otpCode);
        const submitSelector = 'button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit")';
        const submitLocator = page.locator(submitSelector).first();
        if ((await submitLocator.count()) > 0) {
            await Promise.all([
                page
                    .waitForLoadState("networkidle", { timeout: this.timeoutMs })
                    .catch(() => undefined),
                submitLocator.click(),
            ]);
        }
        else {
            await Promise.all([
                page
                    .waitForLoadState("networkidle", { timeout: this.timeoutMs })
                    .catch(() => undefined),
                page.keyboard.press("Enter"),
            ]);
        }
    }
}
exports.BrowserController = BrowserController;
