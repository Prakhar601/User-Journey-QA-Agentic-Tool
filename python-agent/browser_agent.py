"""
Enterprise-grade browser agent powered by browser-use.

Outputs a single JSON object to stdout. No print statements except final dump.
Errors return structured JSON: {"error": true, "message": "...", "details": "..."}
"""

import argparse
import asyncio
import json
import logging
import sys
import time
from typing import Any, Dict, List, Set, Tuple
from urllib.parse import urljoin, urlparse

from browser_use import Agent, Browser, ChatBrowserUse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Browser agent powered by browser-use.")
    parser.add_argument("--url", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--instruction", required=True)
    parser.add_argument("--depth", type=int, default=2, help="Crawl depth limit (default: 2)")
    return parser.parse_args()


def _json_serializable(obj: Any) -> Any:
    """Ensure object is JSON-serializable."""
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_serializable(x) for x in obj]
    return str(obj)


def _emit_error(message: str, details: str = "") -> None:
    payload = {"error": True, "message": message, "details": details}
    sys.stdout.write(json.dumps(_json_serializable(payload), ensure_ascii=False))
    sys.exit(1)


def _emit_json(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(_json_serializable(payload), ensure_ascii=False))
    sys.exit(0)


def _same_domain(base_url: str, link_url: str) -> bool:
    try:
        base = urlparse(base_url)
        link = urlparse(link_url)
        if not base.netloc or not link.netloc:
            return False
        return base.netloc.lower() == link.netloc.lower()
    except Exception:
        return False


def _should_skip_link(href: str) -> bool:
    href_lower = (href or "").strip().lower()
    if not href_lower or href_lower.startswith("#"):
        return True
    if href_lower.startswith("mailto:"):
        return True
    if href_lower.startswith("javascript:"):
        return True
    if "logout" in href_lower or "signout" in href_lower or "log-out" in href_lower:
        return True
    return False


async def _extract_forms(page: Any) -> List[Dict[str, Any]]:
    js = """
    () => Array.from(document.querySelectorAll('form')).map(f => ({
      action: f.action || null,
      method: (f.method || 'get').toLowerCase(),
      enctype: f.enctype || 'application/x-www-form-urlencoded',
      id: f.id || null,
      class: f.className || null
    }))
    """
    try:
        result = await page.evaluate(js)
        return result if isinstance(result, list) else []
    except Exception:
        return []


async def _extract_network_logs(page: Any) -> List[Dict[str, Any]]:
    js = """
    () => {
      try {
        const entries = performance.getEntriesByType('resource') || [];
        const seen = new Set();
        const out = [];
        for (const e of entries) {
          const url = e.name || '';
          if (!url) continue;
          const method = 'GET';
          const status = typeof e.responseStatus === 'number'
            ? e.responseStatus
            : (typeof e.status === 'number' ? e.status : 0);
          const resourceType = (e.initiatorType || '').toString().toLowerCase() || 'other';
          const durationMs = typeof e.duration === 'number' ? e.duration : 0;
          const key = method + ' ' + url;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ url, method, status, resourceType, durationMs });
        }
        return out;
      } catch (_) { return []; }
    }
    """
    try:
        result = await page.evaluate(js)
        if not isinstance(result, list):
            return []

        logs: List[Dict[str, Any]] = []
        seen_keys: Set[Tuple[str, str]] = set()

        for entry in result:
            if not isinstance(entry, dict):
                continue

            url = str(entry.get("url") or "")
            if not url:
                continue

            method = str(entry.get("method") or "GET") or "GET"

            status_raw = entry.get("status", 0)
            try:
                status_int = int(status_raw)
            except Exception:
                status_int = 0

            resource_type = str(entry.get("resourceType") or "other").lower()

            duration_raw = entry.get("durationMs", 0.0)
            try:
                duration_ms = float(duration_raw)
            except Exception:
                duration_ms = 0.0

            key = (url, method)
            if key in seen_keys:
                continue
            seen_keys.add(key)

            success = not (
                status_int >= 400
                or status_int == 0
                or (resource_type in ("xmlhttprequest", "fetch") and status_int != 200)
            )

            logs.append(
                {
                    "url": url,
                    "method": method,
                    "status": status_int,
                    "resourceType": resource_type,
                    "success": bool(success),
                    "durationMs": duration_ms,
                }
            )

        return logs
    except Exception:
        return []


async def _crawl_same_domain(
    browser: Browser,
    page: Any,
    start_url: str,
    start_links: List[Dict[str, Any]],
    depth_limit: int,
) -> Dict[str, Any]:
    """
    Depth-controlled BFS crawl restricted to the same base domain.

    Returns a structured crawl object with:
      - visitedPages: list of URLs visited (including start_url)
      - edges: list of {from, to} URL edges
      - depthReached: maximum depth reached during traversal
    """
    visited: Set[str] = set()
    queue: List[Tuple[str, int]] = []
    enqueued: Set[str] = set()
    edges_set: Set[Tuple[str, str]] = set()
    depth_reached = 0

    start = (start_url or "").strip()
    if not start:
        return {"visitedPages": [], "edges": [], "depthReached": 0}

    visited.add(start)

    if depth_limit <= 0:
        return {"visitedPages": sorted(visited), "edges": [], "depthReached": 0}

    # Seed BFS with links from the starting page at depth 1
    for link in start_links or []:
        href = (link.get("href") or "").strip()
        if not href:
            continue
        try:
            full = urljoin(start, href)
        except Exception:
            continue
        if not full:
            continue
        if _should_skip_link(full):
            continue
        if not _same_domain(start, full):
            continue
        if full in visited or full in enqueued:
            continue
        queue.append((full, 1))
        enqueued.add(full)
        edges_set.add((start, full))
        depth_reached = max(depth_reached, 1)

    while queue:
        url, depth = queue.pop(0)
        url = url.strip()
        if not url:
            continue
        if depth > depth_limit:
            continue
        if url in visited:
            continue
        if _should_skip_link(url):
            continue
        if not _same_domain(start, url):
            continue

        visited.add(url)
        depth_reached = max(depth_reached, depth)

        try:
            await browser.navigate_to(url, new_tab=False)
        except Exception:
            continue

        try:
            pages = await browser.get_pages()
            if not pages:
                continue
            page = pages[-1]
        except Exception:
            continue

        try:
            links_js = """
            () => Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => h)
            """
            page_links = await page.evaluate(links_js)
        except Exception:
            page_links = []

        if depth >= depth_limit:
            continue

        for href in page_links or []:
            if not isinstance(href, str):
                continue
            try:
                full = urljoin(url, href)
            except Exception:
                continue
            if not full:
                continue
            if _should_skip_link(full):
                continue
            if not _same_domain(start, full):
                continue
            edges_set.add((url, full))
            if full in visited or full in enqueued:
                continue
            if depth + 1 > depth_limit:
                continue
            queue.append((full, depth + 1))
            enqueued.add(full)

    visited_pages = sorted(visited)
    edges = [{"from": src, "to": dst} for (src, dst) in edges_set]

    return {
        "visitedPages": visited_pages,
        "edges": edges,
        "depthReached": depth_reached,
    }


async def run_agent(
    url: str,
    username: str,
    password: str,
    instruction: str,
    depth_limit: int,
) -> Dict[str, Any]:
    logging.basicConfig(level=logging.CRITICAL)
    logging.getLogger("browser_use").setLevel(logging.CRITICAL)

    start_time = time.perf_counter()
    base_url = url
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Keep the browser session alive after agent.run() so we can safely
    # access the current page before explicitly shutting down the context.
    #
    # Stability/lifecycle: prefer headless so the Node/Playwright session can be
    # the only visible browser window during execution. Fall back gracefully if
    # the installed browser-use version does not support a headless kwarg.
    try:
        browser = Browser(keep_alive=True, headless=True)
    except TypeError:
        browser = Browser(keep_alive=True)
    agent = Agent(
        task=(
            "You are controlling a real browser.\n"
            f"1) Open the URL: {url}\n"
            f"2) Log in using username '{username}' and password '{password}'. "
            "Figure out the correct fields and buttons using reasoning over the page content; "
            "do not ask the user for additional input.\n"
            f"3) Then execute this instruction: {instruction}\n"
            "4) When finished, leave the browser on the final page so tooling can capture state.\n"
        ),
        llm=ChatBrowserUse(),
        browser=browser,
    )

    await agent.run()

    # Prefer the browser session managed by the agent itself
    browser_session = getattr(agent, "browser_session", None) or browser

    try:
        page = await browser_session.get_current_page()
    except Exception:
        page = None

    if not page:
        _emit_error("Empty DOM snapshot", details="No active page available after agent run.")

    # Ensure navigation and network activity have settled before capturing the DOM
    try:
        await page.wait_for_load_state("networkidle")
    except Exception:
        # Fallback in case 'networkidle' is not supported; best-effort load wait
        try:
            await page.wait_for_load_state("load")
        except Exception:
            pass

    current_url: str = await page.evaluate("() => window.location.href") or ""
    title: str = await page.evaluate("() => document.title") or ""

    dom_content = await page.evaluate("() => document.documentElement.outerHTML")
    dom_snapshot: str = dom_content if isinstance(dom_content, str) else str(dom_content or "")
    if dom_snapshot.strip() == "":
        _emit_error("Empty DOM snapshot", details="Page content is empty after waiting for load state.")

    buttons: List[Dict[str, Any]] = await page.evaluate(
        """
() => Array.from(
  document.querySelectorAll('button, input[type="button"], input[type="submit"]')
).map((el) => ({
  text: el.innerText || el.value || "",
  id: el.id || null,
  name: el.name || null,
  type: el.tagName.toLowerCase() === "button" ? "button" : (el.type || "").toLowerCase(),
  disabled: !!el.disabled,
}))
"""
    ) or []

    inputs: List[Dict[str, Any]] = await page.evaluate(
        """
() => Array.from(
  document.querySelectorAll("input, textarea, select")
).map((el) => ({
  label:
    (el.labels && el.labels.length
      ? el.labels[0].innerText
      : null),
  placeholder: el.placeholder || null,
  id: el.id || null,
  name: el.name || null,
  type: (el.type || el.tagName).toLowerCase(),
}))
"""
    ) or []

    links: List[Dict[str, Any]] = await page.evaluate(
        """
() => Array.from(
  document.querySelectorAll("a[href]")
).map((el) => ({
  text: el.innerText || "",
  href: el.href,
}))
"""
    ) or []

    network_logs: List[Dict[str, Any]] = await _extract_network_logs(page)
    forms: List[Dict[str, Any]] = await _extract_forms(page)

    failed_requests = [r for r in network_logs if r.get("status", 0) >= 400 or r.get("status", 0) == 0]
    status_codes: Dict[str, int] = {}
    for r in network_logs:
        s = r.get("status", 0)
        key = str(s)
        status_codes[key] = status_codes.get(key, 0) + 1

    try:
        crawl_result = await _crawl_same_domain(browser, page, current_url, links, depth_limit)
    except Exception:
        crawl_result = {
            "visitedPages": [current_url] if current_url else [],
            "edges": [],
            "depthReached": 0,
        }

    execution_time_ms = int((time.perf_counter() - start_time) * 1000)
    login_successful = bool(current_url and current_url != url and "login" not in current_url.lower() and "signin" not in current_url.lower())

    return {
        "url": current_url,
        "title": title,
        "dom_snapshot": dom_snapshot,
        "buttons": buttons,
        "inputs": inputs,
        "links": links,
        "network_logs": network_logs,
        "meta": {
            "baseUrl": base_url,
            "loginSuccessful": login_successful,
            "timestamp": timestamp,
            "executionTimeMs": execution_time_ms,
        },
        "dom": {"forms": forms},
        "network": {
            "totalRequests": len(network_logs),
            "failedRequests": failed_requests,
            "statusCodes": status_codes,
        },
        "crawl": crawl_result,
    }


async def main() -> None:
    try:
        args = parse_args()
        result = await run_agent(
            url=args.url,
            username=args.username,
            password=args.password,
            instruction=args.instruction,
            depth_limit=args.depth,
        )
        _emit_json(result)
    except Exception as exc:
        _emit_error(str(exc), details=type(exc).__name__)


if __name__ == "__main__":
    asyncio.run(main())
