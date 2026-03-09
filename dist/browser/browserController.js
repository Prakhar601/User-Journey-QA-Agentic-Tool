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
        await locator.waitFor({ state: "visible", timeout: this.timeoutMs });
        await locator.scrollIntoViewIfNeeded();
        await locator.click();
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
        const trimmedSelector = selector.trim();
        if (!trimmedSelector) {
            return page.locator(selector);
        }
        const baseLocator = page.locator(trimmedSelector).first();
        try {
            const info = await baseLocator.evaluate((el) => {
                const element = el;
                const getAttr = (name) => element.getAttribute(name);
                const tagName = element.tagName.toLowerCase();
                const id = element.id || null;
                const dataTestId = getAttr("data-testid");
                const dataTest = getAttr("data-test");
                const dataQa = getAttr("data-qa");
                const ariaLabel = getAttr("aria-label");
                const role = getAttr("role");
                const placeholder = element.placeholder ??
                    null;
                const text = (element.innerText || element.textContent || "").trim();
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
                return page.locator(`[data-test="${BrowserController.escapeForAttribute(info.dataTest)}"]`);
            }
            if (info.dataQa) {
                return page.locator(`[data-qa="${BrowserController.escapeForAttribute(info.dataQa)}"]`);
            }
            if (info.ariaLabel) {
                return page.getByLabel(info.ariaLabel);
            }
            if (info.role && info.text) {
                return page.getByRole(info.role, { name: info.text });
            }
            if (info.placeholder) {
                return page.getByPlaceholder(info.placeholder);
            }
            if (info.text) {
                return page.getByText(info.text);
            }
            if (info.id) {
                return page.locator(`#${BrowserController.escapeForAttribute(info.id)}`);
            }
            return baseLocator;
        }
        catch {
            return baseLocator;
        }
    }
    static escapeForAttribute(value) {
        return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
}
exports.BrowserController = BrowserController;
