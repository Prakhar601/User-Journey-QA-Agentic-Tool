export interface NetworkLogEntry {
  url: string;
  method: string;
  status: number;
  startTime: number;
  endTime: number;
  duration: number;
  resourceType: string;
}

export interface ApiCallMetric {
  url: string;
  durationMs: number;
}

export interface NetworkAnalysisResult {
  apiCalls: string[];
  /**
   * Chronological sequence of API calls (including duplicates),
   * preserving the order they were observed in the network logs.
   */
  apiCallSequence: ApiCallMetric[];
  averageLatency: number;
  totalApiTime: number;
  totalApiCalls: number;
}

/**
 * Analyze raw network log entries and compute API-level metrics.
 *
 * This utility is completely independent from browser execution.
 * It only processes the provided data and returns an aggregate summary.
 */
export function analyzeNetwork(
  networkData: NetworkLogEntry[]
): NetworkAnalysisResult {
  if (!Array.isArray(networkData) || networkData.length === 0) {
    return {
      apiCalls: [],
      apiCallSequence: [],
      averageLatency: 0,
      totalApiTime: 0,
      totalApiCalls: 0,
    };
  }

  const nonApiResourceTypes: Set<string> = new Set([
    "image",
    "stylesheet",
    "font",
    "media",
  ]);

  // 1 & 2. Filter only API-like requests by excluding static asset types.
  const apiEntries: NetworkLogEntry[] = networkData.filter((entry) => {
    if (!entry || typeof entry.resourceType !== "string") {
      // If resourceType is missing or malformed, treat it as potentially API-like.
      return true;
    }

    const type: string = entry.resourceType.toLowerCase();
    return !nonApiResourceTypes.has(type);
  });

  const totalApiCalls: number = apiEntries.length;

  if (totalApiCalls === 0) {
    return {
      apiCalls: [],
      apiCallSequence: [],
      averageLatency: 0,
      totalApiTime: 0,
      totalApiCalls: 0,
    };
  }

  // 3 & 4. Extract unique URLs and compute timing metrics.
  let totalApiTime: number = 0;
  const apiUrlSet: Set<string> = new Set<string>();
  const apiCallSequence: ApiCallMetric[] = [];

  for (const entry of apiEntries) {
    if (!entry) continue;

    if (typeof entry.url === "string" && entry.url.trim().length > 0) {
      apiUrlSet.add(entry.url);
    }

    const hasValidDuration: boolean =
      typeof entry.duration === "number" && Number.isFinite(entry.duration);

    const duration: number = hasValidDuration
      ? entry.duration
      : entry.endTime - entry.startTime;

    if (Number.isFinite(duration) && duration >= 0) {
      totalApiTime += duration;
      apiCallSequence.push({
        url: entry.url,
        durationMs: duration,
      });
    }
  }

  const averageLatency: number =
    totalApiCalls > 0 ? totalApiTime / totalApiCalls : 0;

  return {
    apiCalls: Array.from(apiUrlSet),
    apiCallSequence,
    averageLatency,
    totalApiTime,
    totalApiCalls,
  };
}

