import * as fs from "fs";
import * as path from "path";

export interface WorkflowConfig {
  automationTool: string;
  browser: string;
  headless: boolean;
  timeoutSeconds: number;
  concurrency: number;
  regressionSweep: boolean;
  outputFolder: string;
  environment: string;
}

const DEFAULT_CONFIG: WorkflowConfig = {
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

function readRawConfigFile(): unknown {
  const configPath: string = path.join(process.cwd(), "config", "config.json");

  try {
    const raw: string = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      // eslint-disable-next-line no-console
      console.warn(
        `Failed to read or parse config/config.json. Falling back to defaults. Reason: ${err.message}`
      );
    }
    return undefined;
  }
}

export function loadConfig(): WorkflowConfig {
  const base: WorkflowConfig = { ...DEFAULT_CONFIG };
  const raw: unknown = readRawConfigFile();

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        "Configuration file config/config.json is not a JSON object. Using default configuration."
      );
    }
    return base;
  }

  const data = raw as Record<string, unknown>;

  // automationTool
  if (typeof data.automationTool === "string") {
    const value = data.automationTool.trim().toLowerCase();
    if (value.length > 0) {
      base.automationTool = value;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        "Invalid automationTool in config (empty string). Using default."
      );
    }
  } else if ("automationTool" in data) {
    // eslint-disable-next-line no-console
    console.warn(
      "Invalid automationTool in config (expected string). Using default."
    );
  }

  // browser
  if (typeof data.browser === "string") {
    const value = data.browser.trim();
    if (value.length > 0) {
      base.browser = value;
    } else {
      // eslint-disable-next-line no-console
      console.warn("Invalid browser in config (empty string). Using default.");
    }
  } else if ("browser" in data) {
    // eslint-disable-next-line no-console
    console.warn("Invalid browser in config (expected string). Using default.");
  }

  // headless
  if (typeof data.headless === "boolean") {
    base.headless = data.headless;
  } else if ("headless" in data) {
    // eslint-disable-next-line no-console
    console.warn("Invalid headless in config (expected boolean). Using default.");
  }

  // timeoutSeconds
  if (typeof data.timeoutSeconds === "number") {
    if (Number.isFinite(data.timeoutSeconds) && data.timeoutSeconds > 0) {
      base.timeoutSeconds = data.timeoutSeconds;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        "Invalid timeoutSeconds in config (must be > 0). Using default."
      );
    }
  } else if ("timeoutSeconds" in data) {
    // eslint-disable-next-line no-console
    console.warn(
      "Invalid timeoutSeconds in config (expected number). Using default."
    );
  }

  // concurrency
  if (typeof data.concurrency === "number") {
    let value = Math.floor(data.concurrency);
    if (!Number.isFinite(value) || value <= 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "Invalid concurrency in config (must be positive integer). Using default."
      );
    } else {
      if (value > MAX_CONCURRENCY) {
        // eslint-disable-next-line no-console
        console.warn(
          `Concurrency ${value} exceeds safe maximum of ${MAX_CONCURRENCY}. Capping to ${MAX_CONCURRENCY}.`
        );
        value = MAX_CONCURRENCY;
      }
      base.concurrency = value;
    }
  } else if ("concurrency" in data) {
    // eslint-disable-next-line no-console
    console.warn(
      "Invalid concurrency in config (expected number). Using default."
    );
  }

  // regressionSweep
  if (typeof data.regressionSweep === "boolean") {
    base.regressionSweep = data.regressionSweep;
  } else if ("regressionSweep" in data) {
    // eslint-disable-next-line no-console
    console.warn(
      "Invalid regressionSweep in config (expected boolean). Using default."
    );
  }

  // outputFolder
  if (typeof data.outputFolder === "string") {
    const value = data.outputFolder.trim();
    if (value.length > 0) {
      base.outputFolder = value;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        "Invalid outputFolder in config (empty string). Using default."
      );
    }
  } else if ("outputFolder" in data) {
    // eslint-disable-next-line no-console
    console.warn(
      "Invalid outputFolder in config (expected string). Using default."
    );
  }

  // environment
  if (typeof data.environment === "string") {
    const value = data.environment.trim();
    if (value.length > 0) {
      base.environment = value;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        "Invalid environment in config (empty string). Using default."
      );
    }
  } else if ("environment" in data) {
    // eslint-disable-next-line no-console
    console.warn(
      "Invalid environment in config (expected string). Using default."
    );
  }

  return base;
}

