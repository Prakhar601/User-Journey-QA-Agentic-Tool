export type TestResultStatus = "Pass" | "Fail" | "Blocked";

export type ExecutionTool = "Selenium" | "Playwright";

export interface ScenarioReport {
  scenarioName: string;
  inputDescription: string;
  actionTaken: string;
  expectedOutcome: string;
  actualOutcome: string;
  result: TestResultStatus;
  failureReason?: string;
  executionTool: ExecutionTool;
  executionDate: string;
  executionEnvironment: string;
  responseTimeMs?: number;
  statusCode?: number;
  networkComment: string;
}

export interface ExecutionMetadata {
  executionId: string;
  executionDate: string;
  environment: string;
  modelUsed: string;
  targetUrl: string;
  automationTool: string;
  browser: string;
  headlessMode: string;
  totalScenarios: number;
  passed: number;
  failed: number;
}

