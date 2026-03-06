import type { ExecutionTool } from "../reporting/types";

export interface ExecutionConfig {
  tool: ExecutionTool;
  browser: string;
  headless: boolean;
  /**
   * Output folder path for reports and regression artifacts.
   * Can be relative to the project root or absolute.
   */
  outputDirPath: string;
}

