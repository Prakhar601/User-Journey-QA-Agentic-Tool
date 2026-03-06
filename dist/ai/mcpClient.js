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
exports.runPythonAgent = runPythonAgent;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const validateBrowserState_1 = require("../core/validateBrowserState");
async function runPythonAgent(options) {
    const scriptPath = path.resolve(process.cwd(), "python-agent", "browser_agent.py");
    const args = [
        scriptPath,
        "--url",
        options.url,
        "--username",
        options.username,
        "--password",
        options.password,
        "--instruction",
        options.instruction,
    ];
    const resolvePythonPath = () => {
        const envPath = typeof process.env.PYTHON_PATH === "string"
            ? process.env.PYTHON_PATH.trim()
            : undefined;
        if (envPath && envPath.length > 0) {
            return envPath;
        }
        const configPath = typeof options.pythonExecutablePath === "string"
            ? options.pythonExecutablePath.trim()
            : undefined;
        if (configPath && configPath.length > 0) {
            return configPath;
        }
        return "python";
    };
    const spawnPython = (pythonPath) => (0, child_process_1.spawn)(pythonPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
        },
    });
    return new Promise((resolve, reject) => {
        let pythonPath = resolvePythonPath();
        let child = spawnPython(pythonPath);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        child.on("error", (error) => {
            if (error && error.code === "ENOENT" && pythonPath !== "python") {
                // eslint-disable-next-line no-console
                console.warn(`Python executable not found at "${pythonPath}". Falling back to "python".`);
                pythonPath = "python";
                child = spawnPython(pythonPath);
                stdout = "";
                stderr = "";
                child.stdout.on("data", (data) => {
                    stdout += data.toString();
                });
                child.stderr.on("data", (data) => {
                    stderr += data.toString();
                });
                child.on("error", (fallbackError) => {
                    reject(fallbackError);
                });
                child.on("close", (code) => {
                    if (code !== 0) {
                        // eslint-disable-next-line no-console
                        console.error("===== PYTHON STDERR BEGIN =====");
                        // eslint-disable-next-line no-console
                        console.error(stderr);
                        // eslint-disable-next-line no-console
                        console.error("===== PYTHON STDERR END =====");
                        reject(new Error(stderr || `Python agent exited with code ${code}`));
                        return;
                    }
                    const trimmed = stdout.trim();
                    if (trimmed.length === 0) {
                        reject(new Error("Python agent returned empty stdout."));
                        return;
                    }
                    let parsed;
                    try {
                        parsed = JSON.parse(trimmed);
                    }
                    catch (error) {
                        reject(new Error(`Failed to parse Python agent JSON output: ${error.message}\nRaw output:\n${trimmed}`));
                        return;
                    }
                    const validation = (0, validateBrowserState_1.validateBrowserState)(parsed);
                    if (!validation.valid) {
                        reject({
                            error: true,
                            message: "Browser state validation failed",
                            details: validation.errors,
                        });
                        return;
                    }
                    const state = parsed;
                    resolve(state);
                });
                return;
            }
            reject(error);
        });
        child.on("close", (code) => {
            if (code !== 0) {
                // eslint-disable-next-line no-console
                console.error("===== PYTHON STDERR BEGIN =====");
                // eslint-disable-next-line no-console
                console.error(stderr);
                // eslint-disable-next-line no-console
                console.error("===== PYTHON STDERR END =====");
                reject(new Error(stderr || `Python agent exited with code ${code}`));
                return;
            }
            const trimmed = stdout.trim();
            if (trimmed.length === 0) {
                reject(new Error("Python agent returned empty stdout."));
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            }
            catch (error) {
                reject(new Error(`Failed to parse Python agent JSON output: ${error.message}\nRaw output:\n${trimmed}`));
                return;
            }
            const validation = (0, validateBrowserState_1.validateBrowserState)(parsed);
            if (!validation.valid) {
                reject({
                    error: true,
                    message: "Browser state validation failed",
                    details: validation.errors,
                });
                return;
            }
            const state = parsed;
            resolve(state);
        });
    });
}
