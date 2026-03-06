import * as path from "path";
import { promises as fs } from "fs";

export interface EnterpriseOutputPaths {
  rootDir: string;
  outputDir: string;
  testResultsXlsxPath: string;
  regressionReportXlsxPath: string;
  logsDir: string;
  screenshotsDir: string;
  auditRunJsonPath: string;
}

export interface EnsureEnterpriseOutputOptions {
  rootDir?: string;
  /**
   * Output folder within the project root. For safety, absolute paths and
   * path traversal are rejected and default to "output".
   */
  outputDirPath?: string;
}

function resolveRootDir(rootDir?: string): string {
  return rootDir && rootDir.trim().length > 0 ? rootDir : process.cwd();
}

function sanitizeRelativeOutputFolder(outputDirPath?: string): string {
  const raw: string = (outputDirPath ?? "").trim();
  if (!raw) {
    return "output";
  }

  if (
    path.isAbsolute(raw) ||
    /^[a-zA-Z]:[\\/]/.test(raw) ||
    raw.startsWith("\\\\")
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `Ignoring unsafe absolute output path "${raw}". Using project-root output folder instead.`
    );
    return "output";
  }

  const normalized: string = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts: string[] = normalized.split("/").filter((p) => p.length > 0);

  if (parts.some((p) => p === "..")) {
    // eslint-disable-next-line no-console
    console.warn(
      `Ignoring unsafe output path "${raw}" (path traversal). Using project-root output folder instead.`
    );
    return "output";
  }

  const safe: string = parts.join(path.sep);
  return safe.length > 0 ? safe : "output";
}

async function touchFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "a");
  await handle.close();
}

/**
 * Ensures the enterprise output folder structure exists.
 * Safe to call multiple times.
 */
export async function ensureEnterpriseOutputStructure(
  options: EnsureEnterpriseOutputOptions = {}
): Promise<EnterpriseOutputPaths> {
  const rootDir: string = resolveRootDir(options.rootDir);
  const safeOutputFolder: string = sanitizeRelativeOutputFolder(
    options.outputDirPath
  );
  const baseOutputPath: string = path.join(rootDir, safeOutputFolder);

  const outputDir = baseOutputPath;
  const logsDir = path.join(baseOutputPath, "logs");
  const screenshotsDir = path.join(baseOutputPath, "screenshots");
  const reportsDir = path.join(baseOutputPath, "reports");
  const testResultsXlsxPath = path.join(baseOutputPath, "TestResults.xlsx");
  const regressionReportXlsxPath = path.join(
    baseOutputPath,
    "RegressionReport.xlsx"
  );
  const auditRunJsonPath = path.join(logsDir, "audit-run.json");

  await fs.mkdir(baseOutputPath, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

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

