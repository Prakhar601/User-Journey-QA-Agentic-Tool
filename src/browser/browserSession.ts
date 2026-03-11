import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from "playwright";

export interface BrowserSessionStartOptions {
  timeoutSeconds: number;
  headless: boolean;
}

export interface NetworkLogEntry {
  url: string;
  method: string;
  status: number | null;
  durationMs: number | null;
  responseJson?: unknown;
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let startInFlight: Promise<void> | null = null;

let configuredTimeoutMs: number | null = null;
const networkLogs: NetworkLogEntry[] = [];
const requestStartTimes: WeakMap<Request, number> = new WeakMap();
let listenersAttached: boolean = false;

export async function startBrowser(options: BrowserSessionStartOptions): Promise<void> {
  if (page !== null) {
    return;
  }

  if (startInFlight !== null) {
    await startInFlight;
    return;
  }

  const timeoutMs: number = Math.max(1, Math.floor(options.timeoutSeconds * 1000));

  startInFlight = (async () => {
    if (browser === null) {
      browser = await chromium.launch({ headless: options.headless });
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

export function getPage(): Page {
  if (page === null) {
    throw new Error("Browser not started. Call startBrowser() first.");
  }
  return page;
}

export function getTimeoutMs(): number | null {
  return configuredTimeoutMs;
}

export function getNetworkLogs(): NetworkLogEntry[] {
  return networkLogs.slice();
}

export async function closeBrowser(): Promise<void> {
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

function attachNetworkListeners(): void {
  if (context === null) {
    return;
  }

  context.on("request", (request: Request) => {
    const startedAt: number = Date.now();
    requestStartTimes.set(request, startedAt);
  });

  context.on("response", async (response: Response) => {
    const request: Request = response.request();
    const url: string = request.url();
    const method: string = request.method();
    const status: number = response.status();

    const startedAt: number | undefined = requestStartTimes.get(request);
    const durationMs: number | null =
      typeof startedAt === "number" ? Date.now() - startedAt : null;

    if (typeof startedAt === "number") {
      requestStartTimes.delete(request);
    }

    const logEntry: NetworkLogEntry = {
      url,
      method,
      status,
      durationMs,
    };

    const contentType: string | null = response.headers()["content-type"] ?? null;

    if (contentType !== null && contentType.includes("application/json")) {
      try {
        const json = await response.json();
        logEntry.responseJson = json;
      } catch {
        // Ignore JSON parse errors and continue.
      }
    }

    networkLogs.push(logEntry);
  });
}

