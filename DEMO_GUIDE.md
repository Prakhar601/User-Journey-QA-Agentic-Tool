# Demo Guide — 5-Minute Walkthrough

## Autonomous User-Journey QA Agent
### AMD AI DevMaster Hackathon

---

## Overview

This guide walks through a 5-minute live demonstration of the Autonomous User-Journey QA Agent. The demo is structured to highlight three core intelligence pillars: **Autonomous Execution**, **Reflection Reasoning**, and **Provider Benchmarking**.

---

## Preparation Checklist (Before Demo)

- [ ] `.env` is set with valid `AMD_BASE_URL`, `AMD_API_KEY`, `AMD_MODEL`
- [ ] `MODEL_PROVIDER=amd` is set
- [ ] `config/config.json` has `headless: false` (so judges can watch the browser)
- [ ] A target website is ready (e.g., a test login page or staging environment)
- [ ] `npm install` has been run
- [ ] `npx playwright install chromium` has been run
- [ ] Terminal window is zoomed in and clearly visible
- [ ] `output/` folder is empty for a clean start
- [ ] Pre-run benchmark results saved to `benchmark/` for comparison display

---

## Demo Script (5 Minutes)

---

### MINUTE 0:00 — Opening Statement (30 seconds)

**Say:**
> "What you're about to see is a fully autonomous QA agent that can test any website — without a single hand-written test script. It plans, executes, adapts, fails intelligently, and explains its own reasoning. And it runs on AMD."

**Show:** The repository root in the terminal. Briefly show the `src/agents/` folder listing.

---

### MINUTE 0:30 — The Problem (30 seconds)

**Say:**
> "Traditional QA requires engineers to write hundreds of brittle test scripts that break every time the UI changes. There's no reasoning about *why* a test failed or *what* to try next. We built an agent that replaces that entire workflow."

**Show:** Briefly open `src/agents/reflectionAgent.ts` — show the first 20 lines (isolation rules, no browser imports, no reporting imports).

**Talking point:** "Six specialized agents, each with a single job. The Reflection Agent never touches the browser. The browser never touches the LLM directly. Clean separation."

---

### MINUTE 1:00 — Live Workflow Execution (2 minutes)

**Run:**
```bash
npm run dev
```

**At each prompt, enter:**
- URL: `[your staging URL]`
- Username / Password: `[your credentials]`
- Workflow: `Login and verify the dashboard loads with user data`
- Accept defaults for timeout, browser, headless (set to `false` for visible execution)

**While the agent runs, narrate:**

> "The Planner Agent just sent the workflow description to AMD's LLM. It's generating a structured test plan with step-level assertions."

> "Now you can see the browser opening — the Generator Agent has produced the initial steps. The Adaptive Execution Loop has started."

> "Watch the terminal — every step is an LLM call to AMD. The agent observes the page state, decides the next action, executes it, and checks assertion progress."

> "The loop just stopped with `ALL_FULFILLED`. All assertions passed."

**Talking points:**
- Point out the stop reason printed in the terminal.
- Point out the assertion progress percentage.
- Point out the Confidence Scorer output (no LLM call — deterministic).

---

### MINUTE 3:00 — Reflection Showcase (1 minute)

After the run completes, open the generated Excel report:
```
output/<date>/TestResults.xlsx
```

**Navigate to: Sheet 5 — "AI Reflection Report"**

**Say:**
> "After every scenario, the Reflection Agent calls AMD one final time — not during execution, but after. It synthesizes everything that happened into a structured report."

**Point out for each row:**
- **Summary** — one-sentence description of what happened
- **Root Cause** — why it happened
- **Suggestions** — what to change next time
- **Should Retry** — Yes or No with a reason
- **Confidence** — how certain the system is

**Navigate to: Sheet 6 — "Execution Timeline"**

**Say:**
> "This timeline shows every stage the pipeline went through — Scenario Started, Adaptive Loop, Assertions Evaluated, Confidence Calculated, Reflection Generated, Completed. You can replay exactly what happened."

---

### MINUTE 4:00 — Benchmark Showcase (45 seconds)

**Run:**
```bash
npm run benchmark
```

*(If live benchmarking is too slow, use pre-saved output from `benchmark/`)*

**Say:**
> "Now we benchmark every configured provider with the same prompt. AMD goes up against GitHub Models side-by-side."

**Point out in the console output:**
- Provider names (uppercased)
- Latency comparison
- Time-to-first-token
- Token counts
- JSON validity (the model must return valid JSON — not just text)
- Summary line: "X/Y providers succeeded"

**Navigate to: `benchmark/benchmark.json`**

**Say:**
> "Machine-readable results. `timestamp`, `inferenceTimeMs` separate from `totalResponseTimeMs`, `failureReason` when something goes wrong. Ready for CI pipelines or dashboards."

---

### MINUTE 4:45 — Closing Statement (15 seconds)

**Say:**
> "No hand-written test scripts. No brittle selectors. No silent failures. The agent plans, executes, adapts, classifies failures deterministically, scores its own confidence, and explains its reasoning — all running on AMD. Thank you."

---

## Expected Talking Points

### On AMD
- AMD is used as the primary LLM provider for all six agents.
- The provider abstraction means swapping AMD for another provider requires changing exactly one environment variable.
- The benchmark proves AMD's performance characteristics objectively, alongside competitors.

### On Architecture
- Six agents, each with one job. No agent violates its isolation boundary.
- The Reflection Agent never runs inside the execution loop — it never introduces latency into execution.
- FailureClassifier and ConfidenceScorer are deterministic (no LLM) — they cannot hallucinate.

### On the Reporting
- Eight Excel sheets, all generated from a single `ScenarioResult[]` array.
- A hackathon judge can understand what happened, why it happened, and how confident the system is — without reading code.
- The Execution Timeline is a complete audit log.

### On the Benchmark
- All three providers (AMD, GitHub, Ollama) participate automatically when configured.
- No provider-specific code in the benchmark — routing is 100% through ProviderFactory.
- `inferenceTimeMs` (provider-reported) is separate from `totalResponseTimeMs` (wall clock) for honest comparison.

---

## Fallback Scenarios (if something goes wrong)

| Problem | Fallback |
|---------|---------|
<<<<<<< HEAD
| Target website is down | Show the pre-generated `output/TestResults.xlsx` already committed in the repo |
| AMD API is slow | Pre-saved `benchmark/benchmark.json` can be shown instead |
| Browser not visible | Check `config/config.json` → `"headless": false` |
=======
| Target website is down | Use the `npm run dry-run` command to show pre-generated Excel report |
| AMD API is slow | Pre-saved `benchmark/benchmark.json` can be shown instead |
| Browser not visible | Check `config.json` → `"headless": false` |
>>>>>>> df8ed184ac77e787f6a9575973d9fb03e61b983b
| Reflection fails | Show the fallback report in the Excel — the system never crashes on missing reflection |
| LLM returns invalid JSON | Show the `FailureClassifier` output — it catches `LLM_ERROR` deterministically |
