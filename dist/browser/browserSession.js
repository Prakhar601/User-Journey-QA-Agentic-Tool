"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBrowser = startBrowser;
exports.getPage = getPage;
exports.getTimeoutMs = getTimeoutMs;
exports.getNetworkLogs = getNetworkLogs;
exports.closeBrowser = closeBrowser;
const playwright_1 = require("playwright");
let browser = null;
let context = null;
let page = null;
let startInFlight = null;
let configuredTimeoutMs = null;
const networkLogs = [];
const requestStartTimes = new WeakMap();
let listenersAttached = false;
async function startBrowser(options) {
    if (page !== null) {
        return;
    }
    if (startInFlight !== null) {
        await startInFlight;
        return;
    }
    const timeoutMs = Math.max(1, Math.floor(options.timeoutSeconds * 1000));
    startInFlight = (async () => {
        if (browser === null) {
            browser = await playwright_1.chromium.launch({ headless: options.headless });
        }
        if (context === null) {
            context = await browser.newContext();
        }
        if (page === null) {
            page = await context.newPage();
        }
        configuredTimeoutMs = timeoutMs;
        page.setDefaultTimeout(timeoutMs);
        if (!listenersAttached) {
            attachNetworkListeners();
            listenersAttached = true;
        }
    })().finally(() => {
        startInFlight = null;
    });
    await startInFlight;
}
function getPage() {
    if (page === null) {
        throw new Error("Browser not started. Call startBrowser() first.");
    }
    return page;
}
function getTimeoutMs() {
    return configuredTimeoutMs;
}
function getNetworkLogs() {
    return networkLogs.slice();
}
async function closeBrowser() {
    if (page !== null) {
        await page.close().catch(() => undefined);
        page = null;
    }
    if (context !== null) {
        await context.close().catch(() => undefined);
        context = null;
    }
    if (browser !== null) {
        await browser.close().catch(() => undefined);
        browser = null;
    }
    configuredTimeoutMs = null;
    networkLogs.length = 0;
    listenersAttached = false;
}
function attachNetworkListeners() {
    if (context === null) {
        return;
    }
    context.on("request", (request) => {
        const startedAt = Date.now();
        requestStartTimes.set(request, startedAt);
        const logEntry = {
            url: request.url(),
            method: request.method(),
            status: null,
            durationMs: null,
        };
        networkLogs.push(logEntry);
    });
    context.on("response", async (response) => {
        const request = response.request();
        const url = request.url();
        const method = request.method();
        const status = response.status();
        const startedAt = requestStartTimes.get(request);
        const durationMs = typeof startedAt === "number" ? Date.now() - startedAt : null;
        const logEntry = {
            url,
            method,
            status,
            durationMs,
        };
        const contentType = response.headers()["content-type"] ?? null;
        if (contentType !== null && contentType.includes("application/json")) {
            try {
                const json = await response.json();
                logEntry.responseJson = json;
            }
            catch {
                // Ignore JSON parse errors and continue.
            }
        }
        networkLogs.push(logEntry);
    });
}
