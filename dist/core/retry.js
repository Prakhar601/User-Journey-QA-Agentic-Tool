"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeWithRetry = executeWithRetry;
async function executeWithRetry(operation, maxAttempts = 2) {
    if (maxAttempts < 1) {
        throw new Error("maxAttempts must be at least 1");
    }
    let attempt = 0;
    let originalError;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        attempt += 1;
        // eslint-disable-next-line no-console
        console.log(`Attempt ${attempt}/${maxAttempts} started...`);
        try {
            const result = await operation();
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (attempt === 1 &&
                maxAttempts > 1 &&
                isTransientErrorMessage(message)) {
                if (originalError === undefined) {
                    originalError = error;
                }
                // eslint-disable-next-line no-console
                console.log("Execution attempt failed, retrying once...");
                // eslint-disable-next-line no-console
                console.log("Retrying execution...");
                if (attempt < maxAttempts) {
                    continue;
                }
            }
            if (originalError === undefined) {
                originalError = error;
            }
            if (attempt >= maxAttempts) {
                // eslint-disable-next-line no-console
                console.log("Execution failed after retry.");
            }
            throw normalizeError(originalError);
        }
        if (attempt >= maxAttempts) {
            throw normalizeError(originalError);
        }
    }
}
function isTransientErrorMessage(message) {
    const lower = message.toLowerCase();
    const nonTransientKeywords = [
        "invalid credentials",
        "authentication failed",
        "invalid workflow",
        "json parse",
        "budget exceeded",
        "403",
    ];
    if (nonTransientKeywords.some((keyword) => lower.includes(keyword))) {
        return false;
    }
    const transientKeywords = [
        "timeout",
        "network",
        "connection",
        "temporarily",
        "rate limit",
    ];
    return transientKeywords.some((keyword) => lower.includes(keyword));
}
function normalizeError(error) {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error));
}
