import { Parser } from "htmlparser2";

/**
 * A single selector strategy entry in the ranked fallback chain.
 * The dispatcher iterates these in order, attempting each until one resolves
 * to a visible, enabled element in the browser.
 */
export interface SelectorStrategy {
  strategy:
    | "testid"
    | "data-test"
    | "data-qa"
    | "aria-label"
    | "role-text"
    | "placeholder"
    | "text"
    | "id"
    | "name"
    | "css";
  value: string;
  /** Present only when strategy === "role-text". */
  role?: string;
}

/**
 * A fully described interactive element extracted from a DOM snapshot.
 * Used by the LLM (via elementIndex) and by the action dispatcher (via selectorRank).
 */
export interface RichElement {
  /** Stable integer index assigned during parsing — the LLM references elements by this. */
  elementIndex: number;
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  role?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  dataTestId?: string;
  dataTest?: string;
  dataQa?: string;
  placeholder?: string;
  /** Full visible text content accumulated across nested child text nodes. */
  textContent?: string;
  /** href value for anchor elements. */
  href?: string;
  /** Whether the element carries a disabled attribute or aria-disabled="true". */
  disabled: boolean;
  /** True when the element qualifies as interactive by tag, role, or event attribute. */
  isInteractive: boolean;
  /**
   * Ordered list of selector strategies from most stable to least stable.
   * The dispatcher tries these in sequence until one resolves.
   */
  selectorRank: SelectorStrategy[];
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const INTERACTIVE_TAGS = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "details",
  "summary",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "checkbox",
  "radio",
  "switch",
  "treeitem",
  "gridcell",
  "combobox",
  "listbox",
  "searchbox",
  "spinbutton",
  "slider",
]);

/**
 * Void elements that never emit a close tag. Their stack frame is handled
 * immediately inside onopentag so the stack stays consistent.
 */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isInteractiveElement(
  tag: string,
  attrs: Record<string, string>
): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true;

  const role = (attrs["role"] ?? "").toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  if ("onclick" in attrs) return true;

  const tabindex = attrs["tabindex"];
  if (tabindex !== undefined && tabindex !== "-1") return true;

  return false;
}

function buildSelectorRank(
  tag: string,
  attrs: Record<string, string>,
  textContent: string | undefined
): SelectorStrategy[] {
  const strategies: SelectorStrategy[] = [];
  const trimmedText = (textContent ?? "").trim();

  if (attrs["data-testid"]) {
    strategies.push({ strategy: "testid", value: attrs["data-testid"] });
  }
  if (attrs["data-test"]) {
    strategies.push({ strategy: "data-test", value: attrs["data-test"] });
  }
  if (attrs["data-qa"]) {
    strategies.push({ strategy: "data-qa", value: attrs["data-qa"] });
  }
  if (attrs["aria-label"]) {
    strategies.push({ strategy: "aria-label", value: attrs["aria-label"] });
  }

  const role = attrs["role"];
  if (role && trimmedText) {
    strategies.push({ strategy: "role-text", value: trimmedText, role });
  }

  if (attrs["placeholder"]) {
    strategies.push({ strategy: "placeholder", value: attrs["placeholder"] });
  }

  if (trimmedText && trimmedText.length <= 80) {
    strategies.push({ strategy: "text", value: trimmedText });
  }

  if (attrs["id"]) {
    strategies.push({ strategy: "id", value: attrs["id"] });
  }

  if (attrs["name"]) {
    strategies.push({ strategy: "name", value: attrs["name"] });
  }

  // Always append a CSS fallback as the last resort.
  strategies.push({ strategy: "css", value: buildCssFallback(tag, attrs) });

  return strategies;
}

function buildCssFallback(tag: string, attrs: Record<string, string>): string {
  if (attrs["id"]) {
    return `${tag}#${cssEscape(attrs["id"])}`;
  }
  if (attrs["data-testid"]) {
    return `${tag}[data-testid="${cssEscape(attrs["data-testid"])}"]`;
  }
  if (attrs["name"]) {
    return `${tag}[name="${cssEscape(attrs["name"])}"]`;
  }
  if (attrs["type"]) {
    return `${tag}[type="${cssEscape(attrs["type"])}"]`;
  }
  return tag;
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function dedupeKey(tag: string, attrs: Record<string, string>): string {
  return [
    tag,
    attrs["id"] ?? "",
    attrs["name"] ?? "",
    attrs["type"] ?? "",
    attrs["data-testid"] ?? "",
    attrs["data-test"] ?? "",
    attrs["data-qa"] ?? "",
    attrs["aria-label"] ?? "",
    attrs["role"] ?? "",
    attrs["placeholder"] ?? "",
    attrs["href"] ?? "",
  ].join("|");
}

// ---------------------------------------------------------------------------
// Stack frame for SAX-style parsing
// ---------------------------------------------------------------------------

interface StackFrame {
  tag: string;
  attrs: Record<string, string>;
  /** Accumulated text from direct and nested child text nodes. */
  text: string;
  interactive: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a full HTML snapshot and returns all interactive elements enriched
 * with ranked selector strategies and stable element indices.
 *
 * Replaces the previous regex-based extractInteractiveElements function.
 * Uses htmlparser2 for correct handling of multi-line attributes,
 * framework-generated markup, deeply nested structures, and void elements.
 */
export function parseInteractiveElements(html: string): RichElement[] {
  if (typeof html !== "string" || html.trim().length === 0) {
    return [];
  }

  const results: RichElement[] = [];
  const seen = new Set<string>();
  let elementCounter = 0;

  const stack: StackFrame[] = [];

  const recordElement = (
    tag: string,
    attrs: Record<string, string>,
    textContent: string | undefined
  ): void => {
    const key = dedupeKey(tag, attrs);
    if (seen.has(key)) return;
    seen.add(key);

    const trimmedText =
      textContent && textContent.trim().length > 0
        ? textContent.trim()
        : undefined;

    const isDisabled =
      "disabled" in attrs || attrs["aria-disabled"] === "true";

    results.push({
      elementIndex: elementCounter++,
      tag,
      id: attrs["id"] || undefined,
      name: attrs["name"] || undefined,
      type: attrs["type"] || undefined,
      role: attrs["role"] || undefined,
      ariaLabel: attrs["aria-label"] || undefined,
      ariaLabelledBy: attrs["aria-labelledby"] || undefined,
      dataTestId: attrs["data-testid"] || undefined,
      dataTest: attrs["data-test"] || undefined,
      dataQa: attrs["data-qa"] || undefined,
      placeholder: attrs["placeholder"] || undefined,
      textContent: trimmedText,
      href: attrs["href"] || undefined,
      disabled: isDisabled,
      isInteractive: true,
      selectorRank: buildSelectorRank(tag, attrs, trimmedText),
    });
  };

  const parser = new Parser(
    {
      onopentag(name: string, attrs: Record<string, string>) {
        const lowerName = name.toLowerCase();

        // Normalise attribute keys to lowercase for consistent access.
        const normAttrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrs)) {
          normAttrs[k.toLowerCase()] = v ?? "";
        }

        if (VOID_TAGS.has(lowerName)) {
          // Void elements never fire onclosetag — record immediately if interactive.
          if (isInteractiveElement(lowerName, normAttrs)) {
            recordElement(lowerName, normAttrs, undefined);
          }
          // Do NOT push a stack frame; htmlparser2 will not emit onclosetag for these.
          return;
        }

        const interactive = isInteractiveElement(lowerName, normAttrs);
        stack.push({ tag: lowerName, attrs: normAttrs, text: "", interactive });
      },

      ontext(text: string) {
        // Append raw text to every open ancestor frame so that nested text
        // (e.g. a <span> inside a <button>) rolls up to the button's frame.
        for (const frame of stack) {
          frame.text += text;
        }
      },

      onclosetag(name: string) {
        const lowerName = name.toLowerCase();

        // Void elements never pushed a frame — skip to avoid stack corruption.
        if (VOID_TAGS.has(lowerName)) return;

        const frame = stack.pop();
        if (!frame) return;

        if (frame.interactive) {
          recordElement(frame.tag, frame.attrs, frame.text);
        }
      },
    },
    {
      decodeEntities: true,
      lowerCaseTags: false,      // We normalise manually above.
      lowerCaseAttributeNames: false,
    }
  );

  parser.write(html);
  parser.end();

  return results;
}
