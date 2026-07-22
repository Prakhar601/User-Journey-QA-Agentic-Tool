# 🤖 Autonomous User-Journey QA Agent

> **AMD AI DevMaster Hackathon Submission**
> An autonomous, multi-agent AI system that plans, executes, reflects on, and reports website QA workflows — end-to-end, without human intervention.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.50-orange.svg)](https://playwright.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Solution Overview](#solution-overview)
3. [Architecture](#architecture)
4. [Agent Pipeline](#agent-pipeline)
5. [Key Features](#key-features)
6. [AMD Integration](#amd-integration)
7. [Supported Providers](#supported-providers)
8. [Technology Stack](#technology-stack)
9. [Folder Structure](#folder-structure)
10. [Installation](#installation)
11. [Configuration](#configuration)
12. [Quick Start](#quick-start)
13. [Running Benchmarks](#running-benchmarks)
14. [Generating Reports](#generating-reports)
15. [Example Outputs](#example-outputs)
16. [Future Work](#future-work)
17. [License](#license)
18. [Acknowledgements](#acknowledgements)

---

## Problem Statement

Modern web applications are complex, dynamic, and constantly evolving. Traditional QA approaches require:
- **Human testers** writing and maintaining hundreds of test scripts.
- **Static test suites** that break on every UI change.
- **No reasoning** about *why* a test failed or *what* to try next.
- **No cross-provider intelligence** to measure inference quality vs. cost.

This leaves teams with slow feedback loops, expensive human review cycles, and zero visibility into *autonomous reasoning* quality.

---

## Solution Overview

The **Autonomous User-Journey QA Agent** is a multi-agent AI system that autonomously:

1. **Plans** test scenarios from natural-language workflow descriptions or PRDs.
2. **Executes** them against live websites using a real browser (Playwright or Selenium).
3. **Adapts** in real-time — the adaptive execution loop observes the page, picks the next action, and evaluates assertion progress at every step.
4. **Classifies** failures deterministically (timeout, selector missing, auth failure, etc.).
5. **Scores confidence** in the result using observable execution signals — no LLM guessing.
6. **Reflects** post-execution using an LLM to produce structured root-cause analysis and retry recommendations.
7. **Reports** everything into a rich Excel workbook with 8 dedicated sheets, suitable for engineers and non-technical stakeholders alike.
8. **Benchmarks** every configured LLM provider for latency, TTFT, token throughput, and JSON conformity.

> The system works with **AMD**, **GitHub Models**, or **Ollama** as the LLM backend — switchable with a single environment variable.

---

## Architecture

```
╔══════════════════════════════════════════════════════════════════════════╗
║                         ENTRY POINTS                                     ║
║  src/index.ts (interactive CLI)   ·   src/autoLaunch.ts (CI/env-driven) ║
╚═══════════════════════════════════════╤══════════════════════════════════╝
                                        │
                          ╔═════════════▼══════════════╗
                          ║        ORCHESTRATOR         ║
                          ║      src/core/orchestrator  ║
                          ╚══════╤══════════════╤═══════╝
                                 │              │
              ╔══════════════════▼╗    ╔════════▼════════════╗
              ║    AGENT PIPELINE ║    ║  BROWSER AUTOMATION  ║
              ║  src/agents/      ║    ║  src/browser/        ║
              ║  ┌─────────────┐  ║    ║  ┌───────────────┐   ║
              ║  │  Planner    │  ║    ║  │  Playwright   │   ║
              ║  │  Generator  │  ║    ║  │  Selenium     │   ║
              ║  │  Evaluator  │  ║    ║  │  ActionDisp.  │   ║
              ║  │  Classifier │  ║    ║  │  Assertions   │   ║
              ║  │  Confidence │  ║    ║  │  DOM Parser   │   ║
              ║  │  Reflection │  ║    ║  │  Network Anal.│   ║
              ║  └─────────────┘  ║    ║  └───────────────┘   ║
              ╚══════════╤════════╝    ╚══════════════════════╝
                         │
              ╔══════════▼════════════════════════════╗
              ║         PROVIDER LAYER                 ║
              ║  src/ai/providerFactory.ts             ║
              ║  ┌──────────┐  ┌─────┐  ┌──────────┐  ║
              ║  │  GitHub  │  │ AMD │  │  Ollama  │  ║
              ║  │  Models  │  │     │  │  Local   │  ║
              ║  └──────────┘  └─────┘  └──────────┘  ║
              ╚══════════╤════════════════════════════╝
                         │
              ╔══════════▼════════════════════════════╗
              ║         REPORTING PIPELINE             ║
              ║  src/reporting/                        ║
              ║  ┌─────────────────────────────────┐   ║
              ║  │ Sheet 1: Test Results (enhanced) │   ║
              ║  │ Sheet 2: Executive Summary       │   ║
              ║  │ Sheet 3: System Analysis         │   ║
              ║  │ Sheet 4: Summary                 │   ║
              ║  │ Sheet 5: AI Reflection Report    │   ║
              ║  │ Sheet 6: Execution Timeline      │   ║
              ║  │ Sheet 7: Run Summary             │   ║
              ║  │ Sheet 8: Provider Benchmark      │   ║
              ║  └─────────────────────────────────┘   ║
              ╚══════════════════════════════════════╝

              ╔══════════════════════════════════════╗
              ║        BENCHMARK PIPELINE             ║
              ║  src/benchmark/runBenchmark.ts        ║
              ║  → JSON  → Markdown  → Excel          ║
              ╚══════════════════════════════════════╝
```

---

## Agent Pipeline

The system orchestrates **six specialized AI agents** in a sequential pipeline:

| # | Agent | Phase | LLM? | Purpose |
|---|-------|-------|------|---------|
| 1 | **Planner Agent** | Planning | ✅ | Converts workflow descriptions or PRDs into a structured test plan with step-level assertions |
| 2 | **Generator Agent** | Generation | ✅ | Produces Playwright/Selenium test skeletons from the plan |
| 3 | **Evaluator Agent** | Execution | ✅ | Evaluates assertion progress at every step of the adaptive loop |
| 4 | **Failure Classifier** | Post-execution | ❌ (deterministic) | Classifies the failure type from observable signals — no LLM needed |
| 5 | **Confidence Scorer** | Post-execution | ❌ (deterministic) | Computes a weighted confidence score from assertion progress, stability, and stop reason |
| 6 | **Reflection Agent** | Post-execution | ✅ | Calls the active LLM once per scenario to produce structured root-cause analysis and recommendations |

### Adaptive Execution Loop

The heart of the system is the adaptive execution loop inside `src/core/orchestrator.ts`:

```
WHILE assertions not all fulfilled AND steps < limit AND not stuck:
  1. Observe current page DOM + network state
  2. LLM decides next action (click, type, navigate, wait...)
  3. ActionDispatcher executes it in the browser
  4. AssertionChecker evaluates all assertion contracts
  5. EvaluatorAgent updates partial score
  6. Loop continues or exits with a stop reason
```

Stop reasons: `ALL_FULFILLED` · `TIMEOUT` · `MAX_STEPS` · `STUCK` · `ACTION_FAILED` · `LLM_ERROR` · `ASSERTIONS_UNREACHABLE` · `EXPLICIT_STOP`

---

## Key Features

### 🧠 Multi-Agent AI Reasoning
- Six specialized agents — each with a single, well-defined responsibility.
- Deterministic failure classification and confidence scoring (no LLM hallucination risk in critical analysis).
- LLM-powered reflection with structured output (summary, root cause, evidence, suggestions, retry recommendation).

### 🔄 Adaptive Execution
- Real-time page observation + action selection at every step.
- DOM parsing, network log analysis, and assertion-state tracking.
- Automatic stop-reason classification on exit.

### 📊 Intelligence-Rich Reporting
Eight Excel worksheets per run, surfacing all AI reasoning to any stakeholder:
- **Test Results** — pass/fail with confidence, failure class, and reflection summary columns.
- **AI Reflection Report** — full LLM reasoning per scenario.
- **Execution Timeline** — chronological event log of every pipeline stage.
- **Run Summary** — aggregate metrics, average confidence, and reflection success rate.
- **Provider Benchmark** — cross-provider latency and quality comparison.

### ⚡ Provider Benchmarking
Compare GitHub Models, AMD, and Ollama on:
- Request latency (wall clock + provider-reported inference time)
- Time to first token (TTFT via streaming)
- Token throughput (prompt/completion/total)
- JSON conformity rate
- Failure rate and failure reasons

### 🔌 Provider-Agnostic Design
All LLM calls route through a single `ProviderFactory`. Switching from GitHub Models to AMD requires only changing `MODEL_PROVIDER=amd` in `.env`.

---

## AMD Integration

This project provides **first-class AMD support** through the `AMDModelProvider` class in `src/ai/modelProvider.ts`.

### How AMD is Used

| Component | AMD Role |
|-----------|----------|
| **Planner Agent** | Plans test scenarios using AMD inference |
| **Generator Agent** | Generates test skeletons via AMD |
| **Evaluator Agent** | Evaluates assertions using AMD |
| **Reflection Agent** | Post-execution reasoning via AMD |
| **Benchmark** | Benchmarked alongside GitHub and Ollama |

### AMD Configuration

```bash
MODEL_PROVIDER=amd
AMD_BASE_URL=https://api.amd.com/v1      # AMD Cloud endpoint
AMD_API_KEY=your_amd_api_key
AMD_MODEL=meta-llama/Llama-3.1-8B-Instruct
AMD_TIMEOUT=120000
```

### AMD Provider Implementation

The `AMDModelProvider` implements the full `ModelProvider` interface:
- `generateResponse()` — OpenAI-compatible chat completions
- `streamResponse()` — Streaming for TTFT measurement
- `healthCheck()` — Connectivity validation
- `listModels()` — Available model enumeration

All AMD calls use the **same abstraction layer** as GitHub Models and Ollama — no special-cased provider logic anywhere in the system.

---

## Supported Providers

| Provider | Variable | Model Example | Notes |
|----------|----------|---------------|-------|
| **AMD Radeon Cloud** | `MODEL_PROVIDER=amd` | `meta-llama/Llama-3.1-8B-Instruct` | Primary hackathon provider |
| **GitHub Models** | `MODEL_PROVIDER=github` | `openai/gpt-4.1-mini` | Requires GitHub PAT |
| **Ollama (Local)** | `MODEL_PROVIDER=ollama` | `llama3`, `mistral`, `phi3` | Requires local Ollama server |

All three providers are benchmarked automatically when credentials are present.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Language** | TypeScript 5.6 |
| **Runtime** | Node.js 18+ |
| **Browser Automation** | Playwright 1.50, Selenium 4.35 |
| **LLM Providers** | AMD Radeon Cloud, GitHub Models, Ollama |
| **Excel Reporting** | SheetJS (xlsx) |
| **DOM Parsing** | htmlparser2 |
| **CLI** | readline-sync |
| **Config** | dotenv |
| **Python Agent** | browser-use (supplemental) |

---

## Folder Structure

```
User-Journey-QA-agentic-tool/
│
├── src/
│   ├── index.ts                      # Interactive CLI entry point
│   ├── autoLaunch.ts                 # Non-interactive / CI entry point
│   ├── benchmark.ts                  # Benchmark runner entry point
│   │
│   ├── agents/
│   │   ├── plannerAgent.ts           # Workflow description → test plan
│   │   ├── generatorAgent.ts         # Test plan → Playwright/Selenium skeleton
│   │   ├── evaluatorAgent.ts         # Assertion evaluation during adaptive loop
│   │   ├── failureClassifier.ts      # Deterministic failure taxonomy (no LLM)
│   │   ├── confidenceScorer.ts       # Weighted confidence score (no LLM)
│   │   └── reflectionAgent.ts        # Post-execution LLM reasoning
│   │
│   ├── ai/
│   │   ├── modelProvider.ts          # AMDModelProvider, GitHubModelsProvider, OllamaModelProvider
│   │   ├── providerFactory.ts        # createModelProvider() — single routing entry point
│   │   ├── providerConfig.ts         # Environment variable resolution + detectEnabledProviders()
│   │   ├── githubModelsClient.ts     # callModel() — provider-agnostic LLM call wrapper
│   │   ├── inferenceLogger.ts        # Structured LLM call logging
│   │   ├── scenarioGenerator.ts      # PRD → scenario expansion
│   │   ├── mcpClient.ts              # Python browser-use agent bridge
│   │   └── loadEnv.ts                # .env file loader
│   │
│   ├── browser/
│   │   ├── browserController.ts      # Playwright session + page management
│   │   ├── browserSession.ts         # Network log capture and session state
│   │   ├── seleniumBrowserController.ts  # Selenium WebDriver controller
│   │   ├── actionDispatcher.ts       # Executes AI-decided browser actions
│   │   ├── assertionChecker.ts       # Real-time assertion contract evaluation
│   │   ├── domParser.ts              # Page DOM extraction for LLM context
│   │   └── networkAnalyzer.ts        # Network request log analysis
│   │
│   ├── core/
│   │   ├── orchestrator.ts           # Main adaptive execution loop
│   │   ├── types.ts                  # All shared TypeScript interfaces
│   │   ├── state.ts                  # AgentState container
│   │   ├── retry.ts                  # Exponential back-off retry
│   │   ├── validateBrowserState.ts   # Pre-step browser state validation
│   │   └── verifyBrowserState.ts     # Post-step browser state verification
│   │
│   ├── benchmark/
│   │   └── runBenchmark.ts           # Provider benchmark runner + formatBenchmarkConsole()
│   │
│   └── reporting/
│       ├── excelReporter.ts          # 8-sheet Excel workbook generation
│       ├── reflectionReportSheet.ts  # Sheets 5–8: Reflection, Timeline, Summary, Benchmark
│       ├── outputManager.ts          # Output directory structure management
│       ├── networkSummary.ts         # Network metric summarization
│       ├── regressionSkeletonGenerator.ts  # Regression test skeleton output
│       └── types.ts                  # Reporting-layer type definitions
│
├── config/
│   └── config.json                   # Static runtime configuration
│
├── python-agent/
│   ├── browser_agent.py              # AI-driven supplemental browser agent
│   └── requirements.txt
│
├── output/                           # Auto-generated: reports, screenshots
├── benchmark/                        # Auto-generated: benchmark JSON/MD/xlsx
├── .env.example                      # Environment variable template
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## Installation

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **npm** | 9+ | Bundled with Node.js |
| **Python** *(optional)* | 3.11+ | Only needed for supplemental browser-use agent |
| **Ollama** *(local mode)* | Latest | [ollama.com](https://ollama.com/) |
| **AMD API Key** *(AMD mode)* | — | AMD Radeon Cloud credentials |
| **GitHub PAT** *(GitHub mode)* | — | `models:read` scope required |

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Prakhar601/User-Journey-QA-agentic-tool.git
cd User-Journey-QA-agentic-tool

# 2. Install Node.js dependencies
npm install

# 3. Install Playwright browser
npx playwright install chromium

# 4. Create your .env file
cp .env.example .env    # macOS / Linux
copy .env.example .env  # Windows

# 5. Edit .env with your provider credentials (see Configuration below)
```

---

## Configuration

### `config/config.json`

```json
{
  "automationTool": "playwright",  // "playwright" | "selenium"
  "browser":        "chromium",    // "chromium" | "chrome" | "firefox"
  "headless":       true,          // run without a visible browser window
  "timeoutSeconds": 60,            // per-step timeout in seconds
  "concurrency":    1,             // parallel scenario limit (max 5)
  "regressionSweep": false,        // run regression sweep after main run
  "outputFolder":   "output",      // relative path for reports and screenshots
  "environment":    "local"        // environment label in reports
}
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the values for your chosen provider:

#### AMD Provider (Recommended for Hackathon)

```bash
MODEL_PROVIDER=amd
AMD_BASE_URL=https://api.amd.com/v1
AMD_API_KEY=your_amd_api_key_here
AMD_MODEL=meta-llama/Llama-3.1-8B-Instruct
AMD_TIMEOUT=120000
```

#### GitHub Models Provider

```bash
MODEL_PROVIDER=github
GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_MODEL=openai/gpt-4.1-mini
```

#### Ollama / Local Provider

```bash
MODEL_PROVIDER=ollama
LLM_ENDPOINT=http://localhost:11434
LLM_MODEL=llama3
```

#### Full Environment Variable Reference

| Variable | Default | Description |
|---|---|---|
| `MODEL_PROVIDER` | `ollama` | Active provider: `github` \| `amd` \| `ollama` |
| `MODEL_NAME` | — | Override model for all providers |
| `AMD_BASE_URL` | — | AMD Cloud API base URL |
| `AMD_API_KEY` | — | AMD authentication key |
| `AMD_MODEL` | — | AMD model identifier |
| `AMD_TIMEOUT` | `120000` | AMD request timeout (ms) |
| `GITHUB_PAT` | — | GitHub Personal Access Token |
| `GITHUB_MODEL` | `openai/gpt-4.1-mini` | GitHub Models model ID |
| `LLM_ENDPOINT` | — | Ollama server URL |
| `LLM_MODEL` | — | Ollama model name |
| `LLM_TIMEOUT` | `120000` | Generic LLM timeout (ms) |
| `URL` | — | Target URL (auto-launch mode) |
| `USERNAME` | — | Login username (auto-launch mode) |
| `PASSWORD` | — | Login password (auto-launch mode) |
| `WORKFLOW_DESCRIPTIONS` | — | Comma-separated workflows (auto-launch mode) |
| `BENCHMARK_PROVIDERS` | all configured | Comma-separated: `github,amd,ollama` |
| `BENCHMARK_RETRIES` | `1` | Retries per provider in benchmark |

---

## Quick Start

### Interactive Mode (recommended for first run)

```bash
npm run dev
```

You will be prompted for:
- Target URL
- Login credentials
- Workflow descriptions (or a full PRD — >200 chars triggers automatic scenario expansion)
- Timeout, browser, headless mode, output folder

### CI / Non-Interactive Mode

```bash
# Set environment variables then:
npm run launch
```

### With AMD (Hackathon Demo)

```bash
# .env must have AMD credentials set
MODEL_PROVIDER=amd
AMD_BASE_URL=https://api.amd.com/v1
AMD_API_KEY=your_key
AMD_MODEL=meta-llama/Llama-3.1-8B-Instruct

npm run dev
# Enter your target URL, credentials, and workflow descriptions at the prompts
```

---

## Running Benchmarks

Compare all configured LLM providers side-by-side:

```bash
npm run benchmark
```

The benchmark runner:
1. Auto-detects all configured providers (AMD, GitHub, Ollama).
2. Sends an identical structured JSON prompt to each.
3. Measures: wall-clock latency, provider-reported inference time, TTFT (streaming), token counts, JSON validity.
4. Prints a formatted summary table to the console.
5. Writes artifacts to `benchmark/`:
   - `benchmark.json` — full machine-readable results
   - `benchmark.xlsx` — formatted Excel comparison
   - `benchmark.md` — Markdown report

### Sample Benchmark Console Output

```
──────────────────────────────────────────────────────────────────────────────────────────
 PROVIDER BENCHMARK RESULTS
──────────────────────────────────────────────────────────────────────────────────────────

  Provider  : AMD
  Model     : meta-llama/Llama-3.1-8B-Instruct
  Timestamp : 2026-07-22T09:00:00.000Z
  Status    : ✅ SUCCESS
  Latency   : 1843ms (wall clock)
  Inference : 1720ms (provider-reported)
  TTFT      : 380ms
  Tokens    : 42 prompt + 71 completion = 113 total
  JSON      : ✓ valid

  Provider  : GITHUB
  Model     : openai/gpt-4.1-mini
  Timestamp : 2026-07-22T09:00:02.100Z
  Status    : ✅ SUCCESS
  Latency   : 1204ms (wall clock)
  Inference : 1100ms (provider-reported)
  TTFT      : 241ms
  Tokens    : 42 prompt + 68 completion = 110 total
  JSON      : ✓ valid

──────────────────────────────────────────────────────────────────────────────────────────
  SUMMARY: 2/2 providers succeeded — Avg latency: 1524ms
──────────────────────────────────────────────────────────────────────────────────────────
```

### Benchmark Provider Selection

```bash
# Only benchmark AMD and GitHub
BENCHMARK_PROVIDERS=amd,github npm run benchmark
```

---

## Generating Reports

Reports are generated automatically at the end of every run. They are written to `output/<date>/TestResults.xlsx`.

### Workbook Structure

| Sheet | Contents |
|-------|----------|
| **Test Results** | One row per scenario: pass/fail, confidence %, failure class, reflection summary, provider, model |
| **Executive Summary** | Overall pass rate, scenario counts, timing |
| **System Analysis** | API call counts, average latency, UI render time, system specs |
| **Summary** | Network waterfall, AI analysis, internet speed |
| **AI Reflection Report** | Per-scenario LLM reasoning: root cause, evidence, suggestions, retry recommendation |
| **Execution Timeline** | Chronological event log: Scenario Started → Adaptive Loop → Assertions → Confidence → Reflection → Completed |
| **Run Summary** | Run timestamp, provider, model, avg confidence, reflection success rate, avg execution time |
| **Provider Benchmark** | Cross-provider latency, TTFT, tokens, JSON validity (when benchmark results are included) |

### Dry-Run (no live browser)

Generate a sample workbook without executing any browser workflows:

```bash
DRY_RUN_TARGET_URL=https://your-app.com npm run dry-run
```

---

## Example Outputs

### Reflection Report (per scenario)

```json
{
  "summary": "Login workflow failed due to a missing error message element after invalid credentials.",
  "rootCause": "The error toast is dynamically injected after a 500ms delay. The assertion checked too early.",
  "evidence": [
    "textPresent:Invalid Credentials assertion failed",
    "HTTP 401 observed on /api/auth",
    "Stop reason: TIMEOUT"
  ],
  "suggestions": [
    "Add a wait step before checking the error message",
    "Assert on network response code instead of DOM text"
  ],
  "shouldRetry": true,
  "retryStrategy": "Add explicit wait for error toast element before assertion",
  "confidence": 0.87
}
```

### Confidence Score Breakdown

```
Score = (assertionProgress × 0.50) + (executionStability × 0.30) + (stopReasonScore × 0.20)
      = (0.80 × 0.50) + (0.90 × 0.30) + (1.00 × 0.20)
      = 0.40 + 0.27 + 0.20
      = 0.87
```

### Failure Classifications

The `FailureClassifier` maps stop signals to one of these deterministic classes:

`TIMEOUT` · `MAX_STEPS_REACHED` · `STUCK_STATE` · `LOOP_DETECTED` · `SELECTOR_NOT_FOUND` · `NAVIGATION_FAILED` · `LOGIN_FAILED` · `ASSERTION_PERMANENTLY_FAILED` · `LLM_ERROR` · `NETWORK_ERROR` · `ACTION_FAILED` · `UNKNOWN`

---

## Future Work

- **Retry Loop Integration** — Wire `shouldRetry` from Reflection Agent back into the adaptive loop for automatic remediation.
- **Historical Regression Tracking** — Store `benchmark.json` per-run and surface trends over time.
- **Visual Diff Screenshots** — Attach before/after DOM screenshots to the Reflection Report.
- **Parallel Scenario Concurrency** — Increase concurrency beyond 5 with improved session isolation.
- **Slack / Webhook Notifications** — Post run summaries to team channels on completion.
- **MCP Server Mode** — Expose the agent pipeline as a Model Context Protocol server for IDE integration.

---

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

- [Playwright](https://playwright.dev/) — reliable cross-browser automation
- [AMD Radeon Cloud](https://www.amd.com/) — LLM inference backbone for this hackathon
- [GitHub Models](https://github.com/marketplace/models) — cloud inference via GitHub Marketplace
- [Ollama](https://ollama.com/) — local LLM serving
- [SheetJS](https://sheetjs.com/) — Excel workbook generation
- [browser-use](https://github.com/browser-use/browser-use) — AI-driven browser interaction (supplemental agent)
