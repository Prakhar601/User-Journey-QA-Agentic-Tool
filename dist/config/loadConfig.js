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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_CONFIG = {
    automationTool: "playwright",
    browser: "chromium",
    headless: true,
    timeoutSeconds: 60,
    concurrency: 1,
    regressionSweep: true,
    outputFolder: "output",
    environment: "local",
};
const MAX_CONCURRENCY = 5;
function readRawConfigFile() {
    const configPath = path.join(process.cwd(), "config", "config.json");
    try {
        const raw = fs.readFileSync(configPath, "utf8");
        return JSON.parse(raw);
    }
    catch (error) {
        const err = error;
        if (err.code !== "ENOENT") {
            // eslint-disable-next-line no-console
            console.warn(`Failed to read or parse config/config.json. Falling back to defaults. Reason: ${err.message}`);
        }
        return undefined;
    }
}
function loadConfig() {
    const base = { ...DEFAULT_CONFIG };
    const raw = readRawConfigFile();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        if (raw !== undefined) {
            // eslint-disable-next-line no-console
            console.warn("Configuration file config/config.json is not a JSON object. Using default configuration.");
        }
        return base;
    }
    const data = raw;
    // automationTool
    if (typeof data.automationTool === "string") {
        const value = data.automationTool.trim().toLowerCase();
        if (value.length > 0) {
            base.automationTool = value;
        }
        else {
            // eslint-disable-next-line no-console
            console.warn("Invalid automationTool in config (empty string). Using default.");
        }
    }
    else if ("automationTool" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid automationTool in config (expected string). Using default.");
    }
    // browser
    if (typeof data.browser === "string") {
        const value = data.browser.trim();
        if (value.length > 0) {
            base.browser = value;
        }
        else {
            // eslint-disable-next-line no-console
            console.warn("Invalid browser in config (empty string). Using default.");
        }
    }
    else if ("browser" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid browser in config (expected string). Using default.");
    }
    // headless
    if (typeof data.headless === "boolean") {
        base.headless = data.headless;
    }
    else if ("headless" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid headless in config (expected boolean). Using default.");
    }
    // timeoutSeconds
    if (typeof data.timeoutSeconds === "number") {
        if (Number.isFinite(data.timeoutSeconds) && data.timeoutSeconds > 0) {
            base.timeoutSeconds = data.timeoutSeconds;
        }
        else {
            // eslint-disable-next-line no-console
            console.warn("Invalid timeoutSeconds in config (must be > 0). Using default.");
        }
    }
    else if ("timeoutSeconds" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid timeoutSeconds in config (expected number). Using default.");
    }
    // concurrency
    if (typeof data.concurrency === "number") {
        let value = Math.floor(data.concurrency);
        if (!Number.isFinite(value) || value <= 0) {
            // eslint-disable-next-line no-console
            console.warn("Invalid concurrency in config (must be positive integer). Using default.");
        }
        else {
            if (value > MAX_CONCURRENCY) {
                // eslint-disable-next-line no-console
                console.warn(`Concurrency ${value} exceeds safe maximum of ${MAX_CONCURRENCY}. Capping to ${MAX_CONCURRENCY}.`);
                value = MAX_CONCURRENCY;
            }
            base.concurrency = value;
        }
    }
    else if ("concurrency" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid concurrency in config (expected number). Using default.");
    }
    // regressionSweep
    if (typeof data.regressionSweep === "boolean") {
        base.regressionSweep = data.regressionSweep;
    }
    else if ("regressionSweep" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid regressionSweep in config (expected boolean). Using default.");
    }
    // outputFolder
    if (typeof data.outputFolder === "string") {
        const value = data.outputFolder.trim();
        if (value.length > 0) {
            base.outputFolder = value;
        }
        else {
            // eslint-disable-next-line no-console
            console.warn("Invalid outputFolder in config (empty string). Using default.");
        }
    }
    else if ("outputFolder" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid outputFolder in config (expected string). Using default.");
    }
    // environment
    if (typeof data.environment === "string") {
        const value = data.environment.trim();
        if (value.length > 0) {
            base.environment = value;
        }
        else {
            // eslint-disable-next-line no-console
            console.warn("Invalid environment in config (empty string). Using default.");
        }
    }
    else if ("environment" in data) {
        // eslint-disable-next-line no-console
        console.warn("Invalid environment in config (expected string). Using default.");
    }
    return base;
}
