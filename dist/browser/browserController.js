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
        // Prioritize login-related buttons; "Continue" only as last fallback (avoids "Continue Shopping", etc.)
        const loginSubmitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Sign in")',
            'button:has-text("Log in")',
            'button:has-text("Login")',
            'button:has-text("Submit")',
            'button:has-text("Continue")',
        ];
        const submitLocator = await this.findFirstVisibleSubmitLocator(page, loginSubmitSelectors);
        if (submitLocator) {
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
        const locator = await this.buildSmartLocator(selector, page);
        console.log("SELECTOR:", selector);
        await locator.waitFor({ state: "visible", timeout: this.timeoutMs });
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ timeout: 5000 });
        await page.waitForTimeout(1000);
        console.log("SUCCESS:", true);
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
    /**
     * Fills an input field identified by selector with the given value.
     * Resolves the target through buildSmartLocator before filling,
     * so all ranked selector strategies (testid, aria-label, etc.) apply.
     */
    async fill(selector, value) {
        const page = (0, browserSession_1.getPage)();
        const locator = await this.buildSmartLocator(selector, page);
        await locator.waitFor({ state: "visible", timeout: this.timeoutMs });
        await locator.fill(value);
    }
    /**
     * Selects an option in a <select> element by visible label or value.
     * Uses page.locator().selectOption() which accepts label, value, or index.
     */
    async selectOption(selector, value) {
        const page = (0, browserSession_1.getPage)();
        const locator = await this.buildSmartLocator(selector, page);
        await locator.waitFor({ state: "visible", timeout: this.timeoutMs });
        await locator.selectOption(value);
    }
    /**
     * Moves the pointer over the element identified by selector.
     * Useful for triggering hover-activated menus and tooltips.
     */
    async hover(selector) {
        const page = (0, browserSession_1.getPage)();
        const locator = await this.buildSmartLocator(selector, page);
        await locator.waitFor({ state: "visible", timeout: this.timeoutMs });
        await locator.scrollIntoViewIfNeeded();
        await locator.hover();
    }
    /**
     * Navigates the current page to the given URL and waits for the load event.
     */
    async navigate(url) {
        const page = (0, browserSession_1.getPage)();
        await page.goto(url, { waitUntil: "load", timeout: this.timeoutMs });
    }
    /**
     * Returns true when the element identified by selector is visible in the
     * viewport. Returns false on timeout or when the element does not exist.
     * Never throws — safe to use as a probe in resolveLocator().
     */
    async isVisible(selector) {
        const page = (0, browserSession_1.getPage)();
        try {
            const locator = page.locator(selector).first();
            return await locator.isVisible({ timeout: 300 });
        }
        catch {
            return false;
        }
    }
    async handleTwoFactorIfPresent(page) {
        const otpSelector = 'input[placeholder*="otp"], input[name*="otp"], input[id*="otp"], input[placeholder*="code"], input[name*="code"], input[id*="code"], input[placeholder*="verification"], input[name*="verification"], input[id*="verification"]';
        const otpLocator = page.locator(otpSelector).first();
        if ((await otpLocator.count()) === 0) {
            return;
        }
        const otpCode = readline_sync_1.default.question("Enter OTP: ");
        await otpLocator.fill(otpCode);
        const twoFactorSubmitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Verify")',
            'button:has-text("Submit")',
            'button:has-text("Continue")',
        ];
        const submitLocator = await this.findFirstVisibleSubmitLocator(page, twoFactorSubmitSelectors);
        if (submitLocator) {
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
    /**
     * Tries each selector in order and returns the first matching locator that is visible and
     * interactable. Skips hidden modal buttons (e.g. "Continue Shopping"). "Continue" is only
     * used as fallback and must pass visibility checks; buttons like "Continue Shopping" are
     * rejected by requiring exact text "Continue" when the selector matches that label.
     */
    async findFirstVisibleSubmitLocator(page, selectors) {
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            try {
                if ((await locator.count()) === 0)
                    continue;
                if (!(await locator.isVisible()))
                    continue;
                if (selector.includes("Continue") && !selector.includes("Verify")) {
                    const text = await locator.evaluate((el) => el.innerText?.trim() ?? "");
                    if (text !== "Continue")
                        continue;
                }
                await locator.waitFor({ state: "visible", timeout: 2000 });
                await locator.scrollIntoViewIfNeeded();
                return locator;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    async buildSmartLocator(selector, page) {
        return page.locator(selector);
    }
    static escapeForAttribute(value) {
        return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
}
exports.BrowserController = BrowserController;
