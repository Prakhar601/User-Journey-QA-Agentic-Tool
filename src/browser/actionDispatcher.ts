import type { RichElement, SelectorStrategy } from "./domParser";

// ---------------------------------------------------------------------------
// AutomationController interface
// This mirrors the shape defined in orchestrator.ts and extends it with the
// five new methods added in the browser controller refactor. The dispatcher
// accesses only the subset of methods it needs; the full interface contract
// lives in the controllers themselves.
// ---------------------------------------------------------------------------

export interface AutomationController {
  click(selector: string): Promise<void>;
  scroll(): Promise<void>;
  waitForTimeout?(ms: number): Promise<void>;
  // Extended methods added by the refactor:
  fill?(selector: string, value: string): Promise<void>;
  selectOption?(selector: string, value: string): Promise<void>;
  hover?(selector: string): Promise<void>;
  navigate?(url: string): Promise<void>;
  isVisible?(selector: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type AdaptiveActionType =
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "CLEAR"
  | "HOVER"
  | "FOCUS"
  | "NAVIGATE"
  | "WAIT"
  | "ASSERT"
  | "STOP";

export interface AdaptiveNextAction {
  type: AdaptiveActionType;
  /** Element index from RichElement.elementIndex — used for element-targeting actions. */
  elementIndex?: number;
  /**
   * Legacy CSS selector string. Used as a fallback when elementIndex is absent,
   * or passed through for CLICK actions from the old plan-based path.
   */
  selector?: string;
  /** Text value for TYPE and SELECT actions. */
  value?: string;
  /** Target URL for NAVIGATE. */
  url?: string;
  /** Duration in milliseconds for WAIT (capped at 10 000 ms). */
  milliseconds?: number;
  /** Assertion type for ASSERT actions (e.g. "visible", "text"). */
  assertionType?: string;
  /** Human-readable reason for STOP. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// DispatchResult
// ---------------------------------------------------------------------------

export interface DispatchResult {
  success: boolean;
  /** The selector string that successfully resolved the target element. */
  selectorUsed?: string;
  /** Human-readable error message when success is false. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Selector resolution
// ---------------------------------------------------------------------------

const LOCATOR_TIMEOUT_MS = 300;

/**
 * Converts a SelectorStrategy entry into a CSS selector string suitable for
 * passing to browser.click() / fill() / etc.
 *
 * The browser controllers' buildSmartLocator already handle Playwright-native
 * strategies (getByTestId, getByLabel, etc.) when given a plain CSS selector.
 * We therefore build CSS attribute selectors for most strategies so they work
 * with both Playwright and Selenium controllers through their existing click()
 * implementations.
 */
function strategyToSelector(strategy: SelectorStrategy): string {
  switch (strategy.strategy) {
    case "testid":
      return `[data-testid="${cssEscape(strategy.value)}"]`;
    case "data-test":
      return `[data-test="${cssEscape(strategy.value)}"]`;
    case "data-qa":
      return `[data-qa="${cssEscape(strategy.value)}"]`;
    case "aria-label":
      return `[aria-label="${cssEscape(strategy.value)}"]`;
    case "role-text":
      // Combine role attribute with visible text content approach.
      return strategy.role
        ? `[role="${cssEscape(strategy.role)}"]`
        : `[role]`;
    case "placeholder":
      return `[placeholder="${cssEscape(strategy.value)}"]`;
    case "text":
      return `button:has-text("${strategy.value}"), a:has-text("${strategy.value}"), [role="button"]:has-text("${strategy.value}")`;
    case "id":
      return `#${cssEscape(strategy.value)}`;
    case "name":
      return `[name="${cssEscape(strategy.value)}"]`;
    case "css":
      return strategy.value;
    default:
      return strategy.value;
  }
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Finds the element in the parsed list by its elementIndex.
 */
function findElement(
  elements: RichElement[],
  elementIndex: number
): RichElement | undefined {
  return elements.find((el) => el.elementIndex === elementIndex);
}

/**
 * Attempts each SelectorStrategy in order.
 * For each strategy, builds a CSS selector and calls the probe function
 * (which attempts a live browser visibility check).
 * Returns the first selector that the probe confirms as usable.
 * Falls back to the CSS fallback strategy if all probes fail or are unavailable.
 *
 * @param selectorRank - Ordered list of strategies from the RichElement.
 * @param probe        - Async function that returns true when a selector resolves
 *                       to a visible element in the browser. May be undefined
 *                       when the browser controller does not support isVisible().
 */
async function resolveLocator(
  selectorRank: SelectorStrategy[],
  probe: ((selector: string) => Promise<boolean>) | undefined
): Promise<string> {
  if (selectorRank.length === 0) {
    return "";
  }

  for (const strategy of selectorRank) {
    const selector = strategyToSelector(strategy);
    if (!selector) continue;

    if (probe) {
      try {
        const visible = await probe(selector);
        if (visible) {
          return selector;
        }
      } catch {
        // This strategy failed — try the next one.
        continue;
      }
    } else {
      // No probe available (browser does not implement isVisible).
      // Return the highest-priority selector and let the action call fail naturally.
      return selector;
    }
  }

  // All probed strategies failed — return the CSS fallback as last resort.
  const cssFallback = selectorRank.find((s) => s.strategy === "css");
  return cssFallback ? cssFallback.value : (selectorRank[0] ? strategyToSelector(selectorRank[0]) : "");
}

// ---------------------------------------------------------------------------
// Individual action handlers
// ---------------------------------------------------------------------------

async function handleClick(
  browser: AutomationController,
  element: RichElement
): Promise<DispatchResult> {
  const probe = browser.isVisible
    ? async (sel: string) => {
        try {
          const result = await (browser.isVisible as (s: string) => Promise<boolean>)(sel);
          return result;
        } catch {
          return false;
        }
      }
    : undefined;

  const selector = await resolveLocator(element.selectorRank, probe);
  if (!selector) {
    console.log("SELECTOR:", "(none resolved)");
    console.log("SUCCESS:", false);
    return {
      success: false,
      errorMessage: `No selector could be resolved for element index ${element.elementIndex} (${element.tag}).`,
    };
  }

  if (browser.isVisible) {
    const visible = await browser.isVisible(selector);
    if (!visible) {
      console.log("SELECTOR:", selector);
      console.log("SUCCESS:", false);
      return {
        success: false,
        selectorUsed: selector,
        errorMessage: `Element not visible: ${selector}`,
      };
    }
  }

  try {
    console.log("SELECTOR:", selector);
    await browser.click(selector);
    console.log("SUCCESS:", true);
    return { success: true, selectorUsed: selector };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("SUCCESS:", false);
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `CLICK failed with selector "${selector}": ${msg}`,
    };
  }
}

async function handleType(
  browser: AutomationController,
  element: RichElement,
  value: string
): Promise<DispatchResult> {
  if (!browser.fill) {
    return {
      success: false,
      errorMessage: "TYPE action is not supported by this browser controller (fill() not implemented).",
    };
  }

  const probe = browser.isVisible
    ? async (sel: string) => {
        try {
          return await (browser.isVisible as (s: string) => Promise<boolean>)(sel);
        } catch {
          return false;
        }
      }
    : undefined;

  const selector = await resolveLocator(element.selectorRank, probe);
  if (!selector) {
    return {
      success: false,
      errorMessage: `No selector could be resolved for element index ${element.elementIndex} (${element.tag}).`,
    };
  }

  try {
    await browser.fill(selector, value);
    return { success: true, selectorUsed: selector };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `TYPE failed with selector "${selector}": ${msg}`,
    };
  }
}

async function handleSelect(
  browser: AutomationController,
  element: RichElement,
  value: string
): Promise<DispatchResult> {
  if (!browser.selectOption) {
    return {
      success: false,
      errorMessage: "SELECT action is not supported by this browser controller (selectOption() not implemented).",
    };
  }

  const probe = browser.isVisible
    ? async (sel: string) => {
        try {
          return await (browser.isVisible as (s: string) => Promise<boolean>)(sel);
        } catch {
          return false;
        }
      }
    : undefined;

  const selector = await resolveLocator(element.selectorRank, probe);
  if (!selector) {
    return {
      success: false,
      errorMessage: `No selector could be resolved for element index ${element.elementIndex} (${element.tag}).`,
    };
  }

  try {
    await browser.selectOption(selector, value);
    return { success: true, selectorUsed: selector };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `SELECT failed with selector "${selector}": ${msg}`,
    };
  }
}

async function handleClear(
  browser: AutomationController,
  element: RichElement
): Promise<DispatchResult> {
  if (!browser.fill) {
    return {
      success: false,
      errorMessage: "CLEAR action is not supported by this browser controller (fill() not implemented).",
    };
  }

  const probe = browser.isVisible
    ? async (sel: string) => {
        try {
          return await (browser.isVisible as (s: string) => Promise<boolean>)(sel);
        } catch {
          return false;
        }
      }
    : undefined;

  const selector = await resolveLocator(element.selectorRank, probe);
  if (!selector) {
    return {
      success: false,
      errorMessage: `No selector could be resolved for element index ${element.elementIndex} (${element.tag}).`,
    };
  }

  try {
    // Clearing is implemented as fill with empty string.
    await browser.fill(selector, "");
    return { success: true, selectorUsed: selector };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `CLEAR failed with selector "${selector}": ${msg}`,
    };
  }
}

async function handleHover(
  browser: AutomationController,
  element: RichElement
): Promise<DispatchResult> {
  if (!browser.hover) {
    // Fall back to a no-op hover (scroll into view via click attempt would be
    // intrusive; just report unsupported gracefully).
    return {
      success: false,
      errorMessage: "HOVER action is not supported by this browser controller (hover() not implemented).",
    };
  }

  const probe = browser.isVisible
    ? async (sel: string) => {
        try {
          return await (browser.isVisible as (s: string) => Promise<boolean>)(sel);
        } catch {
          return false;
        }
      }
    : undefined;

  const selector = await resolveLocator(element.selectorRank, probe);
  if (!selector) {
    return {
      success: false,
      errorMessage: `No selector could be resolved for element index ${element.elementIndex} (${element.tag}).`,
    };
  }

  try {
    await browser.hover(selector);
    return { success: true, selectorUsed: selector };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `HOVER failed with selector "${selector}": ${msg}`,
    };
  }
}

async function handleFocus(
  browser: AutomationController,
  element: RichElement
): Promise<DispatchResult> {
  // FOCUS degrades to CLICK when no dedicated focus() method exists,
  // since clicking an element naturally focuses it.
  const probe = browser.isVisible
    ? async (sel: string) => {
        try {
          return await (browser.isVisible as (s: string) => Promise<boolean>)(sel);
        } catch {
          return false;
        }
      }
    : undefined;

  const selector = await resolveLocator(element.selectorRank, probe);
  if (!selector) {
    return {
      success: false,
      errorMessage: `No selector could be resolved for element index ${element.elementIndex} (${element.tag}).`,
    };
  }

  try {
    await browser.click(selector);
    return { success: true, selectorUsed: selector };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `FOCUS (via click) failed with selector "${selector}": ${msg}`,
    };
  }
}

async function handleNavigate(
  browser: AutomationController,
  url: string
): Promise<DispatchResult> {
  if (!browser.navigate) {
    return {
      success: false,
      errorMessage: "NAVIGATE action is not supported by this browser controller (navigate() not implemented).",
    };
  }

  if (!url || url.trim().length === 0) {
    return {
      success: false,
      errorMessage: "NAVIGATE requires a non-empty URL.",
    };
  }

  try {
    await browser.navigate(url.trim());
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorMessage: `NAVIGATE to "${url}" failed: ${msg}`,
    };
  }
}

async function handleWait(
  browser: AutomationController,
  milliseconds: number | undefined
): Promise<DispatchResult> {
  const MAX_WAIT_MS = 10_000;
  const raw = typeof milliseconds === "number" && Number.isFinite(milliseconds)
    ? milliseconds
    : 1_000;
  const ms = Math.max(0, Math.min(MAX_WAIT_MS, Math.floor(raw)));

  try {
    if (typeof browser.waitForTimeout === "function") {
      await browser.waitForTimeout(ms);
    } else {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorMessage: `WAIT failed: ${msg}`,
    };
  }
}

async function handleAssert(
  browser: AutomationController,
  element: RichElement | undefined,
  assertionType: string | undefined
): Promise<DispatchResult> {
  if (!element) {
    return {
      success: false,
      selectorUsed: undefined,
      errorMessage: "ASSERT FAILED: no element provided for assertion",
    };
  }

  if (!browser.isVisible) {
    return {
      success: false,
      selectorUsed: undefined,
      errorMessage: "ASSERT FAILED: browser does not support visibility checks",
    };
  }

  const selector = element.selectorRank.length > 0
    ? strategyToSelector(element.selectorRank[0])
    : "";

  if (!selector) {
    return {
      success: false,
      selectorUsed: undefined,
      errorMessage: "ASSERT FAILED: no selector could be built for element",
    };
  }

  try {
    const visible = await browser.isVisible(selector);
    if (visible) {
      return { success: true, selectorUsed: selector };
    }
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `ASSERT FAILED: element not visible or condition not met`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      selectorUsed: selector,
      errorMessage: `ASSERT FAILED: element not visible or condition not met (${msg})`,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatches a single adaptive action to the browser controller.
 *
 * Element-targeting actions (CLICK, TYPE, SELECT, CLEAR, HOVER, FOCUS, ASSERT)
 * resolve their target via the element's selectorRank list, trying each strategy
 * in priority order until one succeeds. This means a failure on the first
 * selector automatically falls through to the next — no external retry needed
 * for selector resolution.
 *
 * STOP returns success=true immediately; the caller is responsible for halting
 * the loop when it receives a STOP action.
 *
 * @param browser  - The live browser controller instance.
 * @param action   - The action to execute, as decided by the LLM.
 * @param elements - The full list of RichElements parsed from the current DOM snapshot.
 */
export async function dispatchAction(
  browser: AutomationController,
  action: AdaptiveNextAction,
  elements: RichElement[]
): Promise<DispatchResult> {
  console.log("ACTION:", action.type, action.elementIndex !== undefined ? `elementIndex=${action.elementIndex}` : action.selector ?? "");
  switch (action.type) {
    case "STOP": {
      // STOP is not a browser action — signal success so the loop can exit cleanly.
      return { success: true };
    }

    case "WAIT": {
      return handleWait(browser, action.milliseconds);
    }

    case "NAVIGATE": {
      return handleNavigate(browser, action.url ?? "");
    }

    case "CLICK": {
      // Support both elementIndex-based targeting (new path) and legacy selector strings.
      if (action.elementIndex !== undefined) {
        const element = findElement(elements, action.elementIndex);
        if (!element) {
          return {
            success: false,
            errorMessage: `CLICK: no element found with elementIndex ${action.elementIndex}.`,
          };
        }
        return handleClick(browser, element);
      }

      // Legacy path: raw selector string (from old plan-based actions).
      if (action.selector) {
        try {
          await browser.click(action.selector);
          return { success: true, selectorUsed: action.selector };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            selectorUsed: action.selector,
            errorMessage: `CLICK failed with selector "${action.selector}": ${msg}`,
          };
        }
      }

      return {
        success: false,
        errorMessage: "CLICK requires either elementIndex or selector.",
      };
    }

    case "TYPE": {
      const value = action.value ?? "";
      if (action.elementIndex !== undefined) {
        const element = findElement(elements, action.elementIndex);
        if (!element) {
          return {
            success: false,
            errorMessage: `TYPE: no element found with elementIndex ${action.elementIndex}.`,
          };
        }
        return handleType(browser, element, value);
      }
      return {
        success: false,
        errorMessage: "TYPE requires elementIndex.",
      };
    }

    case "SELECT": {
      const value = action.value ?? "";
      if (action.elementIndex !== undefined) {
        const element = findElement(elements, action.elementIndex);
        if (!element) {
          return {
            success: false,
            errorMessage: `SELECT: no element found with elementIndex ${action.elementIndex}.`,
          };
        }
        return handleSelect(browser, element, value);
      }
      return {
        success: false,
        errorMessage: "SELECT requires elementIndex.",
      };
    }

    case "CLEAR": {
      if (action.elementIndex !== undefined) {
        const element = findElement(elements, action.elementIndex);
        if (!element) {
          return {
            success: false,
            errorMessage: `CLEAR: no element found with elementIndex ${action.elementIndex}.`,
          };
        }
        return handleClear(browser, element);
      }
      return {
        success: false,
        errorMessage: "CLEAR requires elementIndex.",
      };
    }

    case "HOVER": {
      if (action.elementIndex !== undefined) {
        const element = findElement(elements, action.elementIndex);
        if (!element) {
          return {
            success: false,
            errorMessage: `HOVER: no element found with elementIndex ${action.elementIndex}.`,
          };
        }
        return handleHover(browser, element);
      }
      return {
        success: false,
        errorMessage: "HOVER requires elementIndex.",
      };
    }

    case "FOCUS": {
      if (action.elementIndex !== undefined) {
        const element = findElement(elements, action.elementIndex);
        if (!element) {
          return {
            success: false,
            errorMessage: `FOCUS: no element found with elementIndex ${action.elementIndex}.`,
          };
        }
        return handleFocus(browser, element);
      }
      return {
        success: false,
        errorMessage: "FOCUS requires elementIndex.",
      };
    }

    case "ASSERT": {
      const element =
        action.elementIndex !== undefined
          ? findElement(elements, action.elementIndex)
          : undefined;
      return handleAssert(browser, element, action.assertionType);
    }

    default: {
      // Unknown action type — treat as a no-op rather than crashing.
      const unknownType = (action as AdaptiveNextAction).type;
      return {
        success: false,
        errorMessage: `Unknown action type: "${unknownType}".`,
      };
    }
  }
}

// Re-export the timeout constant for use in the orchestrator.
export const MAX_WAIT_MS = 10_000;
export const LOCATOR_PROBE_TIMEOUT_MS = LOCATOR_TIMEOUT_MS;
