# AI Regression Agent

An AI-powered regression testing agent that uses Large Language Models (LLMs) to plan, execute, and evaluate browser-based workflows automatically. It supports both **Playwright** and **Selenium** for browser automation, and both **local LLMs** (Ollama-compatible) and **GitHub Models** as AI backends.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Project Structure](#project-structure)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Environment Variables Reference](#environment-variables-reference)
7. [Running the Agent](#running-the-agent)
8. [Available Scripts](#available-scripts)
9. [Dependencies](#dependencies)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Entry Points                        │
│  src/index.ts (interactive CLI)                      │
│  src/autoLaunch.ts (env-var driven, CI-friendly)     │
└───────────────────┬─────────────────────────────────┘
                    │
          ┌─────────▼──────────┐
          │  Orchestrator       │
          │  src/core/          │
          └──┬──────────┬──────┘
             │          │
   ┌──────────▼──┐  ┌───▼──────────────┐
   │ AI Agents   │  │ Browser Control  │
   │ src/agents/ │  │ src/browser/     │
   │  - Planner  │  │  - Playwright    │
   │  - Generator│  │  - Selenium      │
   │  - Evaluator│  └──────────────────┘
   └──────┬──────┘
          │
   ┌──────▼──────────────┐    ┌─────────────────────┐
   │ LLM Backends        │    │ Python Browser Agent │
   │ src/ai/             │    │ python-agent/        │
   │  - Local (Ollama)   │    │  browser_agent.py    │
   │  - GitHub Models    │    │  (browser-use lib)   │
   └─────────────────────┘    └─────────────────────┘
          │
   ┌──────▼──────────────┐
   │ Reporting           │
   │ src/reporting/      │
   │  - Excel (.xlsx)    │
   │  - Network summary  │
   │  - Regression skels │
   └─────────────────────┘
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18 or later | [nodejs.org](https://nodejs.org/) |
| **npm** | 9 or later | Bundled with Node.js |
| **Python** | 3.11 or later | Required for the browser-use agent |
| **pip** | Latest | Bundled with Python |
| **Ollama** *(local mode)* | Latest | [ollama.com](https://ollama.com/) – run a local model |
| **GitHub PAT** *(GitHub mode)* | — | Needs `models:read` scope |
| **ChromeDriver** *(Selenium only)* | Match Chrome version | [chromedriver.chromium.org](https://chromedriver.chromium.org/) |
| **Git** | Any | Optional, for version control |

---

## Project Structure

```
ai-model-main/
├── src/                          # TypeScript source (compiled to dist/)
│   ├── index.ts                  # Interactive CLI entry point
│   ├── autoLaunch.ts             # Non-interactive (env-var) entry point
│   ├── agents/                   # AI agent roles
│   │   ├── plannerAgent.ts       # Generates test plans from workflow descriptions
│   │   ├── generatorAgent.ts     # Generates Playwright/Selenium test skeletons
│   │   └── evaluatorAgent.ts     # Evaluates actual vs expected behaviour
│   ├── ai/
│   │   ├── githubModelsClient.ts # Unified callModel() – routes to local or GitHub
│   │   ├── modelProvider.ts      # LocalLLMProvider / GitHubModelsProvider
│   │   ├── mcpClient.ts          # Spawns python-agent/browser_agent.py
│   │   └── scenarioGenerator.ts  # PRD → test scenario expansion
│   ├── browser/
│   │   ├── browserController.ts  # Playwright browser controller
│   │   ├── browserSession.ts     # Playwright session/network log management
│   │   └── seleniumBrowserController.ts  # Selenium WebDriver controller
│   ├── config/
│   │   ├── loadConfig.ts         # Reads config/config.json with defaults
│   │   └── executionConfig.ts    # ExecutionConfig interface
│   ├── core/
│   │   ├── orchestrator.ts       # Main workflow driver
│   │   ├── retry.ts              # Retry with back-off
│   │   ├── state.ts              # Agent state management
│   │   ├── types.ts              # Shared TypeScript interfaces
│   │   ├── validateBrowserState.ts
│   │   └── verifyBrowserState.ts
│   └── reporting/
│       ├── excelReporter.ts      # Writes TestResults.xlsx and regression reports
│       ├── networkSummary.ts     # Network log summarisation
│       ├── outputManager.ts      # Manages output/ folder structure
│       ├── regressionSkeletonGenerator.ts
│       └── types.ts
├── python-agent/
│   ├── browser_agent.py          # browser-use powered crawl/login agent
│   └── requirements.txt          # Python dependencies
├── config/
│   └── config.json               # Static runtime configuration
├── dist/                         # Compiled JavaScript (auto-generated)
├── output/                       # Test reports, screenshots (auto-generated)
├── dryRunAudit.js                # Standalone dry-run report generator
├── package.json                  # Node.js project manifest & scripts
├── tsconfig.json                 # TypeScript compiler options
├── .env.example                  # Environment variable template
└── .gitignore
```

---

## Installation

### 1. Clone or navigate to the project

```bash
git clone <repository-url>
cd ai-model-main
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Install Playwright browsers

```bash
npx playwright install chromium
# Install additional browsers if needed:
# npx playwright install firefox
# npx playwright install webkit
```

### 4. Set up the Python environment

```bash
cd python-agent
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
cd ..
```

### 5. Create your `.env` file

```bash
copy .env.example .env   # Windows
# cp .env.example .env   # macOS / Linux
```

Edit `.env` with your values (see [Environment Variables Reference](#environment-variables-reference)).

### 6. (Optional) Install and start Ollama for local LLM mode

```bash
# Download from https://ollama.com and then:
ollama pull llama3
ollama serve
```

---

## Configuration

### `config/config.json`

Controls static runtime behaviour. All fields have defaults and are optional:

```json
{
  "automationTool": "playwright",   // "playwright" | "selenium"
  "browser":        "chromium",     // "chromium" | "chrome" | "firefox"
  "headless":       true,           // true = no visible browser window
  "timeoutSeconds": 60,             // per-step timeout
  "concurrency":    1,              // parallel workflow limit (max 5)
  "regressionSweep": true,          // run full regression sweep after workflows
  "outputFolder":   "output",       // relative folder for reports/screenshots
  "environment":    "local"         // label for reports
}
```

### `.env`

Copy `.env.example` to `.env` and fill in the required values for your chosen provider:

```bash
# Local LLM (Ollama)
MODEL_PROVIDER=local
LLM_ENDPOINT=http://localhost:11434
LLM_MODEL=llama3

# OR GitHub Models
MODEL_PROVIDER=github
GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_MODEL=openai/gpt-4.1-mini
```

---

## Environment Variables Reference

### LLM Provider Selection

| Variable | Required | Default | Description |
|---|---|---|---|
| `MODEL_PROVIDER` | No | `local` | `local` (Ollama) or `github` (GitHub Models) |

### Local LLM Mode (`MODEL_PROVIDER=local`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_ENDPOINT` | **Yes** | — | Base URL of your Ollama server, e.g. `http://localhost:11434` |
| `LLM_MODEL` | **Yes** | — | Model name, e.g. `llama3`, `mistral`, `phi3` |
| `LLM_PROVIDER` | No | `ollama` | Provider hint, usually `ollama` |

### GitHub Models Mode (`MODEL_PROVIDER=github`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_PAT` | **Yes** | — | GitHub Personal Access Token with `models:read` scope |
| `GITHUB_MODEL` | No | `openai/gpt-4.1-mini` | GitHub Models inference model ID |

### Python Agent

| Variable | Required | Default | Description |
|---|---|---|---|
| `PYTHON_PATH` | No | `python` | Full path to the Python executable (e.g. `C:\...\python.exe`) |

### Auto-Launch Mode (`npm run launch`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `URL` | **Yes** | — | Target web application URL |
| `USERNAME` | **Yes** | — | Login username |
| `PASSWORD` | **Yes** | — | Login password |
| `WORKFLOW_DESCRIPTIONS` | **Yes** | — | Comma-separated workflow descriptions or full PRD text |
| `MODEL` | **Yes** | — | Model name to use (matches `LLM_MODEL` or `GITHUB_MODEL`) |
| `GITHUB_TOKEN` | No | — | GitHub PAT (only for GitHub Models in auto-launch mode) |
| `AUTOMATION_TOOL` | No | `playwright` | `playwright` or `selenium` |
| `TIMEOUT_SECONDS` | No | `60` | Request timeout in seconds |

### Dry-Run Report (`npm run dry-run`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DRY_RUN_TARGET_URL` | **Yes** | — | Target URL to embed in the audit Excel report |
| `DRY_RUN_MODEL` | No | `test-model` | Model name label in the report |

---

## Running the Agent

### Mode 1 — Interactive CLI (`npm run dev`)

Prompts for all inputs at the terminal. Best for local exploration:

```bash
npm run dev
```

You will be prompted for:
- **URL** – the web application to test
- **Username** and **Password** – login credentials
- **Workflow description or PRD** – comma-separated workflow names, or paste a full PRD (>200 chars triggers automatic scenario expansion)
- **Timeout**, **automation tool**, **browser**, **headless mode**, and **output folder** – all have defaults from `config/config.json`

### Mode 2 — Auto-Launch / CI mode (`npm run launch`)

Non-interactive; reads everything from environment variables. Suitable for CI/CD pipelines:

```bash
# Set variables inline (Windows PowerShell)
$env:MODEL_PROVIDER="local"
$env:LLM_ENDPOINT="http://localhost:11434"
$env:LLM_MODEL="llama3"
$env:URL="https://your-app.com"
$env:USERNAME="admin"
$env:PASSWORD="secret"
$env:WORKFLOW_DESCRIPTIONS="Login and verify dashboard,Add item to cart"
$env:MODEL="llama3"

npm run launch
```

Or with a `.env` file already populated:

```bash
npm run launch
```

### Mode 3 — Dry-Run Audit Report (`npm run dry-run`)

Generates a sample Excel report from mock data without executing any browser workflows. Useful to verify the reporting pipeline:

```bash
$env:DRY_RUN_TARGET_URL="https://your-app.com"
npm run dry-run
```

The report is written to `output/<date>/TestResults.xlsx`.

### Mode 4 — Production (pre-compiled, `npm start`)

Run the compiled JavaScript directly (no ts-node overhead):

```bash
npm run build
npm start
```

---

## Available Scripts

| Script | Command | Description |
|---|---|---|
| `npm run dev` | `ts-node src/index.ts` | Interactive CLI mode with prompts |
| `npm run launch` | `ts-node src/autoLaunch.ts` | Non-interactive, env-var driven mode |
| `npm run build` | `tsc` | Compile TypeScript → `dist/` |
| `npm start` | `node dist/index.js` | Run compiled output (production) |
| `npm run dry-run` | `node dryRunAudit.js` | Generate a mock Excel report |

---

## Dependencies

### Runtime

| Package | Version | Purpose |
|---|---|---|
| `playwright` | ^1.50.0 | Browser automation (Playwright driver) |
| `@playwright/test` | ^1.50.0 | Test skeleton generation |
| `selenium-webdriver` | ^4.27.0 | Browser automation (Selenium driver) |
| `readline-sync` | ^1.4.10 | Synchronous terminal prompts |
| `dotenv` | ^17.3.1 | Loads `.env` file into `process.env` |
| `xlsx` | ^0.18.5 | Excel report generation ⚠️ (see note below) |
| `node-fetch` | ^3.3.2 | HTTP fetch for Node.js |
| `ts-node` | ^10.9.2 | Run TypeScript files directly |
| `typescript` | ^5.6.0 | TypeScript compiler |

> ⚠️ **Note on `xlsx`:** The open-source SheetJS community package has a known high-severity prototype-pollution vulnerability with no available fix in the free tier. If this is deployed in a security-sensitive environment, consider replacing it with [`exceljs`](https://github.com/exceljs/exceljs).

### Development

| Package | Purpose |
|---|---|
| `@types/node` | TypeScript types for Node.js built-ins |
| `@types/readline-sync` | TypeScript types for readline-sync |
| `@types/selenium-webdriver` | TypeScript types for Selenium |

### Python Agent (`python-agent/requirements.txt`)

| Package | Purpose |
|---|---|
| `browser-use >= 0.12.0` | AI-driven browser crawl and interaction |
| `selenium >= 4.0.0` | Selenium bindings for the Python agent |

---

## Troubleshooting

### `LLM endpoint is not configured`
Set `LLM_ENDPOINT` in your `.env` (or environment) and ensure `MODEL_PROVIDER=local`.

### `GitHub PAT is not configured`
Set `GITHUB_PAT` in your `.env` and ensure `MODEL_PROVIDER=github`.

### `Missing required env var: URL` (auto-launch mode)
All five required variables (`URL`, `USERNAME`, `PASSWORD`, `WORKFLOW_DESCRIPTIONS`, `MODEL`) must be set before running `npm run launch`.

### `Dry-run target URL is not configured`
Set `DRY_RUN_TARGET_URL` before running `npm run dry-run`.

### Python agent fails to start
1. Ensure Python 3.11+ is installed and the path is correct (`PYTHON_PATH` env var).
2. Activate the virtual environment: `python-agent\.venv\Scripts\activate` (Windows) then `pip install -r python-agent/requirements.txt`.
3. Confirm `browser-use` is installed: `python -c "import browser_use"`.

### Selenium `SessionNotCreatedException`
Ensure the ChromeDriver version matches your installed Chrome version. Download the matching driver from [chromedriver.chromium.org](https://chromedriver.chromium.org/) and add it to your `PATH`.

### Playwright browser not found
Run `npx playwright install chromium` (or the required browser) from the project root.

### TypeScript compilation errors
Run `npm run build` to see full error output. Ensure all dependencies are installed with `npm install`.
Create a `.env` file in the root directory if needed for environment variables:

```bash
# Example .env file
NODE_ENV=development
```

Refer to your configuration requirements for specific environment variables.

## Troubleshooting

### Common Issues

**Port Already in Use**
- Change the port in your configuration

**Module Not Found**
- Ensure all dependencies are installed: `npm install`
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

**TypeScript Compilation Errors**
- Verify TypeScript version: `npm list typescript`
- Rebuild: `npm run build`

**Playwright Browser Issues**
- Install Playwright browsers: `npx playwright install`

## Next Steps

After installation:

1. Review the project structure in `src/`
2. Check the main entry point: `src/index.ts`
3. Review environment configuration requirements
4. Run `npm run dev` to start development

## Additional Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Playwright Documentation](https://playwright.dev/)
- [XLSX Documentation](https://github.com/SheetJS/sheetjs)

## License

This project is licensed under the MIT/ISC License.
