export interface BrowserStateValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBrowserState(
  state: unknown
): BrowserStateValidationResult {
  const errors: string[] = [];

  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    errors.push("State must be a non-null object.");
    return { valid: false, errors };
  }

  const root = state as Record<string, unknown>;

  if (root.error === true) {
    errors.push("State has error flag set to true.");
  }

  const domSnapshot = root.dom_snapshot;
  if (typeof domSnapshot !== "string" || domSnapshot.trim().length === 0) {
    errors.push("Field 'dom_snapshot' must be a non-empty string.");
  }

  const networkLogs = root.network_logs;
  if (!Array.isArray(networkLogs)) {
    errors.push("Field 'network_logs' must be an array.");
  }

  if ("meta" in root && root.meta !== undefined && root.meta !== null) {
    const meta = root.meta;
    if (typeof meta === "object" && !Array.isArray(meta)) {
      const metaRecord = meta as Record<string, unknown>;
      if (typeof metaRecord.executionTimeMs !== "number") {
        errors.push(
          "Field 'meta.executionTimeMs' must be a number when 'meta' is present."
        );
      }
    } else {
      errors.push("Field 'meta' must be an object when present.");
    }
  }

  if ("crawl" in root && root.crawl !== undefined && root.crawl !== null) {
    const crawl = root.crawl;
    if (typeof crawl === "object" && !Array.isArray(crawl)) {
      const crawlRecord = crawl as Record<string, unknown>;
      if (!Array.isArray(crawlRecord.visitedPages)) {
        errors.push(
          "Field 'crawl.visitedPages' must be an array when 'crawl' is present."
        );
      }
    } else {
      errors.push("Field 'crawl' must be an object when present.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

