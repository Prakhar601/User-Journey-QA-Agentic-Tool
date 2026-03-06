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
exports.ensureEnterpriseOutputStructure = ensureEnterpriseOutputStructure;
const path = __importStar(require("path"));
const fs_1 = require("fs");
function resolveRootDir(rootDir) {
    return rootDir && rootDir.trim().length > 0 ? rootDir : process.cwd();
}
function sanitizeRelativeOutputFolder(outputDirPath) {
    const raw = (outputDirPath ?? "").trim();
    if (!raw) {
        return "output";
    }
    if (path.isAbsolute(raw) ||
        /^[a-zA-Z]:[\\/]/.test(raw) ||
        raw.startsWith("\\\\")) {
        // eslint-disable-next-line no-console
        console.warn(`Ignoring unsafe absolute output path "${raw}". Using project-root output folder instead.`);
        return "output";
    }
    const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    const parts = normalized.split("/").filter((p) => p.length > 0);
    if (parts.some((p) => p === "..")) {
        // eslint-disable-next-line no-console
        console.warn(`Ignoring unsafe output path "${raw}" (path traversal). Using project-root output folder instead.`);
        return "output";
    }
    const safe = parts.join(path.sep);
    return safe.length > 0 ? safe : "output";
}
async function touchFile(filePath) {
    const handle = await fs_1.promises.open(filePath, "a");
    await handle.close();
}
/**
 * Ensures the enterprise output folder structure exists.
 * Safe to call multiple times.
 */
async function ensureEnterpriseOutputStructure(options = {}) {
    const rootDir = resolveRootDir(options.rootDir);
    const safeOutputFolder = sanitizeRelativeOutputFolder(options.outputDirPath);
    const baseOutputPath = path.join(rootDir, safeOutputFolder);
    const outputDir = baseOutputPath;
    const logsDir = path.join(baseOutputPath, "logs");
    const screenshotsDir = path.join(baseOutputPath, "screenshots");
    const reportsDir = path.join(baseOutputPath, "reports");
    const testResultsXlsxPath = path.join(baseOutputPath, "TestResults.xlsx");
    const regressionReportXlsxPath = path.join(baseOutputPath, "RegressionReport.xlsx");
    const auditRunJsonPath = path.join(logsDir, "audit-run.json");
    await fs_1.promises.mkdir(baseOutputPath, { recursive: true });
    await fs_1.promises.mkdir(logsDir, { recursive: true });
    await fs_1.promises.mkdir(screenshotsDir, { recursive: true });
    await fs_1.promises.mkdir(reportsDir, { recursive: true });
    // Create empty files if they don't exist yet so writers can safely open/overwrite.
    await touchFile(testResultsXlsxPath);
    await touchFile(regressionReportXlsxPath);
    await touchFile(auditRunJsonPath);
    return {
        rootDir,
        outputDir,
        testResultsXlsxPath,
        regressionReportXlsxPath,
        logsDir,
        screenshotsDir,
        auditRunJsonPath,
    };
}
