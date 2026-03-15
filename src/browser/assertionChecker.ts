import type { AssertionContract, AssertionState } from "../core/types";
import { callModel } from "../ai/githubModelsClient";

// ---------------------------------------------------------------------------
// Assertion key constants
// These string prefixes namespace each assertion kind so that keys stored in
// AssertionState.fulfilled / failed / pending are self-describing and unique
// even when multiple assertions of the same kind exist.
// ---------------------------------------------------------------------------

const KEY_URL_PATTERN = "urlPattern";
const KEY_TEXT_PRESENT_PREFIX = "textPresent:";
const KEY_TEXT_ABSENT_PREFIX = "textAbsent:";
const KEY_ELEMENT_VISIBLE_PREFIX = "elementVisible:";
const KEY_API_CALLED_PREFIX = "apiCalled:";
const KEY_FORM_SUBMITTED = "formSubmitted";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives the full list of assertion keys implied by a contract.
 * Used to seed AssertionState.pending at the start of a scenario.
 */
export function contractToKeys(contract: AssertionContract): string[] {
  const keys: string[] = [];

  if (contract.urlPattern) {
    keys.push(KEY_URL_PATTERN);
  }
  for (const t of contract.textPresent) {
    keys.push(`${KEY_TEXT_PRESENT_PREFIX}${t}`);
  }
  for (const t of contract.textAbsent) {
    keys.push(`${KEY_TEXT_ABSENT_PREFIX}${t}`);
  }
  for (const e of contract.elementVisible) {
    keys.push(`${KEY_ELEMENT_VISIBLE_PREFIX}${e}`);
  }
  for (const a of contract.apiCalled) {
    keys.push(`${KEY_API_CALLED_PREFIX}${a}`);
  }
  if (contract.formSubmitted) {
    keys.push(KEY_FORM_SUBMITTED);
  }

  return keys;
}

/**
 * Creates a zeroed AssertionState with all keys from the contract in pending.
 */
export function initAssertionState(contract: AssertionContract): AssertionState {
  return {
    fulfilled: [],
    failed: [],
    pending: contractToKeys(contract),
  };
}

/**
 * Returns total number of assertion keys in a contract.
 */
function totalAssertions(contract: AssertionContract): number {
  return contractToKeys(contract).length;
}

/**
 * Safe case-insensitive substring check against the DOM snapshot.
 */
function domContains(domSnapshot: string, text: string): boolean {
  return domSnapshot.toLowerCase().includes(text.toLowerCase());
}

/**
 * Tests whether a URL matches the given pattern.
 * Treats the pattern first as a regex; falls back to substring match if the
 * pattern is not a valid regex.
 */
function urlMatches(currentUrl: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(currentUrl);
  } catch {
    return currentUrl.toLowerCase().includes(pattern.toLowerCase());
  }
}

/**
 * Checks whether any network log entry has a URL containing the given substring.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function networkContainsUrl(networkLogs: any[], urlSubstring: string): boolean {
  const lower = urlSubstring.toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return networkLogs.some((entry: any) => {
    const url = typeof entry?.url === "string" ? entry.url.toLowerCase() : "";
    return url.includes(lower);
  });
}

/**
 * Checks whether any network log entry represents a form submission
 * (i.e. method is POST, PUT, or PATCH).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function networkContainsFormSubmit(networkLogs: any[]): boolean {
  const submitMethods = new Set(["POST", "PUT", "PATCH"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return networkLogs.some((entry: any) => {
    const method =
      typeof entry?.method === "string" ? entry.method.toUpperCase() : "";
    return submitMethods.has(method);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates the current browser state against all assertions in the contract
 * and returns an updated AssertionState.
 *
 * Rules:
 * - Once a key reaches `fulfilled` it can never leave that bucket.
 * - `textAbsent` keys move to `failed` when the text is found, and back to
 *   `pending` when it is absent again (they cannot be permanently fulfilled
 *   until loop exit; the final evaluation treats absence-at-exit as fulfilled).
 * - `elementVisible` assertions are checked via a shallow DOM-snapshot text
 *   match (aria-label or descriptive identifier present anywhere in HTML).
 *   A full isVisible() check can be layered on top in the orchestrator at exit.
 * - All other assertion kinds are permanently fulfilled once matched.
 *
 * @param contract  - The compiled assertion contract for this scenario.
 * @param state     - The current tracking state (immutably updated).
 * @param domSnapshot - Full HTML content of the current page.
 * @param networkLogs - All network log entries captured so far for the scenario.
 * @param currentUrl  - The current page URL.
 */
export function evaluateAssertions(
  contract: AssertionContract,
  state: AssertionState,
  domSnapshot: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  networkLogs: any[],
  currentUrl: string
): AssertionState {
  // Work on mutable copies; return new object for immutability at the call site.
  const fulfilled = new Set(state.fulfilled);
  const failed = new Set(state.failed);
  const pending = new Set(state.pending);

  const fulfill = (key: string): void => {
    if (fulfilled.has(key)) return; // Already locked in — never revert.
    pending.delete(key);
    failed.delete(key);
    fulfilled.add(key);
  };

  const markFailed = (key: string): void => {
    if (fulfilled.has(key)) return; // Fulfilled keys are immutable.
    pending.delete(key);
    failed.add(key);
  };

  const resetToPending = (key: string): void => {
    if (fulfilled.has(key)) return;
    failed.delete(key);
    pending.add(key);
  };

  // --- urlPattern ---
  if (contract.urlPattern) {
    const key = KEY_URL_PATTERN;
    if (!fulfilled.has(key)) {
      if (urlMatches(currentUrl, contract.urlPattern)) {
        fulfill(key);
      }
      // Not matching yet — leave in pending; no active failure for URL.
    }
  }

  // --- textPresent ---
  for (const text of contract.textPresent) {
    const key = `${KEY_TEXT_PRESENT_PREFIX}${text}`;
    if (!fulfilled.has(key)) {
      if (domContains(domSnapshot, text)) {
        fulfill(key);
      }
      // Absence at this step is not a failure — the text may appear later.
    }
  }

  // --- textAbsent ---
  // These are "must not be present" assertions.
  // Finding the forbidden text is an active failure; its absence is not yet
  // a fulfill (we only confirm absence-as-pass at final evaluation).
  for (const text of contract.textAbsent) {
    const key = `${KEY_TEXT_ABSENT_PREFIX}${text}`;
    if (!fulfilled.has(key)) {
      if (domContains(domSnapshot, text)) {
        markFailed(key);
      } else {
        // Text absent right now — not yet an active failure; reset to pending
        // in case it was previously failing (e.g. an error message that cleared).
        resetToPending(key);
      }
    }
  }

  // --- elementVisible (shallow DOM check) ---
  // A full Playwright isVisible() call is expensive per-step; we do a DOM
  // snapshot text scan here. The orchestrator should run a live isVisible()
  // check at loop exit for final authoritative evaluation.
  for (const descriptor of contract.elementVisible) {
    const key = `${KEY_ELEMENT_VISIBLE_PREFIX}${descriptor}`;
    if (!fulfilled.has(key)) {
      if (domContains(domSnapshot, descriptor)) {
        fulfill(key);
      }
    }
  }

  // --- apiCalled ---
  // Once a matching URL is observed in network logs it is permanently fulfilled;
  // network logs only grow — they never shrink.
  for (const urlSubstring of contract.apiCalled) {
    const key = `${KEY_API_CALLED_PREFIX}${urlSubstring}`;
    if (!fulfilled.has(key)) {
      if (networkContainsUrl(networkLogs, urlSubstring)) {
        fulfill(key);
      }
    }
  }

  // --- formSubmitted ---
  if (contract.formSubmitted) {
    const key = KEY_FORM_SUBMITTED;
    if (!fulfilled.has(key)) {
      if (networkContainsFormSubmit(networkLogs)) {
        fulfill(key);
      }
    }
  }

  return {
    fulfilled: Array.from(fulfilled),
    failed: Array.from(failed),
    pending: Array.from(pending),
  };
}

/**
 * Finalises textAbsent assertions at loop exit:
 * any textAbsent keys that are still pending (text was never found) are
 * promoted to fulfilled. Keys that are in `failed` remain failed.
 *
 * Call this once after the loop ends, before computing the final pass result.
 */
export function finaliseTextAbsentAssertions(
  contract: AssertionContract,
  state: AssertionState
): AssertionState {
  const fulfilled = new Set(state.fulfilled);
  const failed = new Set(state.failed);
  const pending = new Set(state.pending);

  for (const text of contract.textAbsent) {
    const key = `${KEY_TEXT_ABSENT_PREFIX}${text}`;
    if (pending.has(key)) {
      // Still pending means the text was never present — assertion satisfied.
      pending.delete(key);
      fulfilled.add(key);
    }
    // If it is in `failed` it stays failed (text was present when last checked).
  }

  return {
    fulfilled: Array.from(fulfilled),
    failed: Array.from(failed),
    pending: Array.from(pending),
  };
}

/**
 * Computes the fraction of assertions fulfilled (0.0–1.0).
 * Returns 1.0 when the contract has no assertions (vacuously satisfied).
 */
export function computePartialScore(
  state: AssertionState,
  contract: AssertionContract
): number {
  const total = totalAssertions(contract);
  if (total === 0) return 1.0;
  const score = state.fulfilled.length / total;
  return Math.min(1.0, Math.max(0.0, score));
}

// ---------------------------------------------------------------------------
// Goal parser
// ---------------------------------------------------------------------------

/**
 * Sends the scenario description to the LLM with a structured-output prompt
 * and parses the response into an AssertionContract.
 *
 * On any failure (LLM error, JSON parse error, schema mismatch) the function
 * returns a zeroed empty contract so the caller can degrade gracefully to
 * DOM-diff-only pass/fail mode.
 */
export async function parseGoalToContract(
  description: string,
  model: string,
  token: string,
  llmEndpoint?: string,
  llmProvider?: string
): Promise<AssertionContract> {
  const emptyContract: AssertionContract = {
    urlPattern: undefined,
    textPresent: [],
    textAbsent: [],
    elementVisible: [],
    apiCalled: [],
    formSubmitted: false,
  };

  if (!description || description.trim().length === 0) {
    return emptyContract;
  }

  const prompt = buildGoalParserPrompt(description);

  let rawResponse: string;
  try {
    rawResponse = await callModel(model, prompt, token, {
      endpoint: llmEndpoint,
      provider: llmProvider,
      model,
    });
  } catch {
    // LLM call failed — degrade gracefully.
    return emptyContract;
  }

  return parseContractResponse(rawResponse, emptyContract);
}

function buildGoalParserPrompt(description: string): string {
  return [
    "You are a QA assertion extractor.",
    "",
    "Read the following test scenario description and extract verifiable assertions.",
    "Return ONLY a valid JSON object. No explanation. No markdown. No backticks.",
    "",
    "JSON schema (all fields required):",
    "{",
    '  "urlPattern": "string or null — substring or regex the final URL must match, null if not applicable",',
    '  "textPresent": ["strings that must appear in the page DOM"],',
    '  "textAbsent": ["strings that must NOT appear in the page DOM"],',
    '  "elementVisible": ["aria-labels or button/heading text that must be visible"],',
    '  "apiCalled": ["URL substrings of API requests that must have fired"],',
    '  "formSubmitted": true or false',
    "}",
    "",
    "Rules:",
    "- Extract only assertions that can be verified from DOM content, URL, or network activity.",
    "- Do not invent assertions not implied by the description.",
    "- textPresent and textAbsent must be short, literal strings likely to appear verbatim.",
    "- urlPattern should be null when the description does not mention a specific destination URL.",
    "- formSubmitted should be true only when the scenario explicitly involves submitting a form.",
    "- Return empty arrays for fields with no applicable assertions.",
    "",
    "Test scenario:",
    description,
    "",
    "Return ONLY the JSON object.",
  ].join("\n");
}

function parseContractResponse(
  raw: string,
  fallback: AssertionContract
): AssertionContract {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback;
  }

  // Strip markdown fences if present.
  let candidate = raw.trim();
  const fenced = candidate.match(/```(?:json)?([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    candidate = fenced[1].trim();
  }

  // Extract the first JSON object found.
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objectMatch || !objectMatch[0]) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(objectMatch[0]);
  } catch {
    return fallback;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallback;
  }

  const obj = parsed as Record<string, unknown>;

  const urlPattern: string | undefined =
    typeof obj["urlPattern"] === "string" && obj["urlPattern"].trim().length > 0
      ? obj["urlPattern"].trim()
      : undefined;

  const textPresent: string[] = safeStringArray(obj["textPresent"]);
  const textAbsent: string[] = safeStringArray(obj["textAbsent"]);
  const elementVisible: string[] = safeStringArray(obj["elementVisible"]);
  const apiCalled: string[] = safeStringArray(obj["apiCalled"]);

  const formSubmitted: boolean =
    typeof obj["formSubmitted"] === "boolean" ? obj["formSubmitted"] : false;

  return {
    urlPattern,
    textPresent,
    textAbsent,
    elementVisible,
    apiCalled,
    formSubmitted,
  };
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      result.push(item.trim());
    }
  }
  return result;
}
