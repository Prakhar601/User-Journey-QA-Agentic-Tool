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
    const url: string = typeof entry.url === "string" ? entry.url : "";

    if (url.trim().length > 0) {
      apiUrlSet.add(url);
    }

    const hasValidDuration: boolean =
      typeof entry.duration === "number" && Number.isFinite(entry.duration);

    let duration: number;
    if (hasValidDuration) {
      duration = entry.duration;
    } else {
      const fallbackDuration: number = entry.endTime - entry.startTime;
      duration = Number.isFinite(fallbackDuration) && fallbackDuration >= 0
        ? fallbackDuration
        : 0;
    }

    if (Number.isFinite(duration) && duration >= 0) {
      totalApiTime += duration;
    }

    apiCallSequence.push({
      url,
      durationMs: Number.isFinite(duration) && duration >= 0 ? duration : 0,
    });
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

