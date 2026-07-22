# Judge Walkthrough

## Autonomous User-Journey QA Agent
### AMD AI DevMaster Hackathon

Welcome. This document gives you the fastest path to evaluating every major capability of the system.

---

## Step 1 — Start Here: The README

Open [`README.md`](README.md) in the root.

Key sections to read:
- **Solution Overview** — What the system does in 8 bullets
- **Agent Pipeline** — The 6-agent table (which are LLM-powered vs. deterministic)
- **AMD Integration** — How AMD is used, which components call it
- **Running Benchmarks** — One-command cross-provider comparison

---

## Step 2 — Understand the Architecture (2 minutes)

Open [`ARCHITECTURE.md`](ARCHITECTURE.md).

Focus on:
1. **Section 4: Provider Abstraction** — Confirms AMD has no special-cased logic; it uses the same `ModelProvider` interface as all other providers.
2. **Section 2: Execution Pipeline** — Shows the full per-scenario flow, including exactly when the LLM is called and when it is not.
3. **Section 6: Reflection Pipeline** — Shows the post-execution intelligence stack.

---

## Step 3 — Verify AMD Usage

### Where AMD Is Wired In

Open `src/ai/modelProvider.ts` and search for `AMDModelProvider` (around line 300).

You will see:
- `AMDModelProvider` implements the full `ModelProvider` interface.
- `generateResponse()` uses AMD's OpenAI-compatible endpoint.
- `streamResponse()` supports streaming for TTFT measurement.
- `healthCheck()` validates connectivity before use.

### How to Switch to AMD

Open `.env.example` — find the AMD section:
```bash
MODEL_PROVIDER=amd
AMD_BASE_URL=https://api.amd.com/v1
AMD_API_KEY=your_amd_api_key
AMD_MODEL=meta-llama/Llama-3.1-8B-Instruct
```

That single `MODEL_PROVIDER=amd` change routes **all six agents** through AMD.

### Verify No Provider Hard-Coding

Search the `src/` directory for `provider === "amd"`, `provider === "github"`, or `provider === "ollama"`.

You will find **zero results** in the agent pipeline code. All routing happens in:
- `src/ai/providerFactory.ts` — `createModelProvider(kind)` switch statement
- `src/ai/providerConfig.ts` — `resolveEndpoint()`, `resolveApiKey()`

---

## Step 4 — Run the Project

### Quick Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env with AMD credentials
npm run dev
```

### What to Watch For

1. Terminal output shows which provider is being used.
2. The browser opens (if `headless: false` in config.json) and navigates autonomously.
3. After execution, the terminal prints the confidence score and stop reason.
4. Excel report is saved to `output/<date>/TestResults.xlsx`.

---

## Step 5 — Inspect Benchmark Results

```bash
npm run benchmark
```

After completion, inspect:

**Console output** — Cross-provider comparison table with:
- Provider name, model, timestamp
- Latency (wall clock vs. provider-reported inference time)
- Time to first token (streaming measurement)
- Token counts (prompt + completion = total)
- JSON validity (✓/✗)
- Failure reason (if any)
- Summary line: "X/Y providers succeeded — Avg latency: Xms"

**`benchmark/benchmark.json`** — Machine-readable results with every field.

**`benchmark/benchmark.xlsx`** — Formatted Excel with all 15 columns.

**`benchmark/benchmark.md`** — Markdown report suitable for GitHub display.

---

## Step 6 — Inspect the Generated Excel Report

Open `output/<date>/TestResults.xlsx` after any run.

Navigate through each sheet:

| Sheet | What to Look For |
|-------|-----------------|
| **Test Results** | Confidence %, failure class, reflection summary — all in one row |
| **Executive Summary** | High-level pass rate and timing |
| **System Analysis** | API call counts and UI render time |
| **Summary** | Network waterfall and AI analysis text |
| **AI Reflection Report** | Per-scenario LLM reasoning. Check `Root Cause`, `Suggestions`, `Should Retry` |
| **Execution Timeline** | Every pipeline stage with timestamp and status — the audit log |
| **Run Summary** | Average confidence, reflection success rate, provider, model, version |
| **Provider Benchmark** | Only present when `benchmarkResults` are included in context |

---

## Step 7 — Inspect AI Reflections

The richest intelligence output is in the **AI Reflection Report** sheet.

For each scenario row, verify:
- `Summary` — Concise one-sentence description
- `Root Cause` — What caused the failure or enabled the pass
- `Suggestions` — Numbered list of actionable improvements
- `Should Retry` — Boolean with Yes/No
- `Retry Strategy` — Specific strategy text when retry is recommended
- `Confidence` — The Reflection Agent's own confidence in its analysis (0.0–1.0)

**Key fact for judges:** The Reflection Agent is called exactly **once per scenario**, only after the adaptive execution loop has fully exited. It never adds latency to browser execution.

---

## Step 8 — Verify Deterministic Components

Open `src/agents/failureClassifier.ts` (line 1):

```typescript
/**
 * FailureClassifier — deterministic failure taxonomy.
 * This module MUST NOT call an LLM.
 */
```

Open `src/agents/confidenceScorer.ts` (line 1):

```typescript
/**
 * ConfidenceScorer — deterministic confidence scoring.
 * This module MUST NOT call an LLM.
 * Score = (assertionProgress × 0.50) + (executionStability × 0.30) + (stopReasonScore × 0.20)
 */
```

These two components are the system's hallucination firewall — they produce structured, reproducible output from observable execution signals. No LLM is involved.

---

## Step 9 — Verify Isolation Boundaries

Open `src/agents/reflectionAgent.ts` (lines 8–18):

```typescript
 * Strict isolation rules:
 *   - NEVER called inside the adaptive execution loop.
 *   - NEVER imports browser modules.
 *   - NEVER imports reporting modules.
 *   - NEVER contains provider-specific logic.
 *   - ALL failures are caught and return a safe fallback.
```

Run a grep to verify:
```bash
grep -n "import.*browser" src/agents/reflectionAgent.ts
# Expected: no results
grep -n "import.*reporting" src/agents/reflectionAgent.ts
# Expected: no results
```

---

## Step 10 — Files That Matter Most

| File | Why It Matters |
|------|---------------|
| `src/core/orchestrator.ts` | The adaptive execution loop — the system's brain |
| `src/agents/reflectionAgent.ts` | Post-execution LLM reasoning |
| `src/agents/failureClassifier.ts` | Deterministic failure taxonomy |
| `src/agents/confidenceScorer.ts` | Deterministic confidence formula |
| `src/ai/modelProvider.ts` | AMD, GitHub, Ollama implementations |
| `src/ai/providerFactory.ts` | Single routing entry point |
| `src/reporting/reflectionReportSheet.ts` | All Phase 4–5 sheet builders |
| `src/benchmark/runBenchmark.ts` | Cross-provider benchmark + console formatter |
| `src/core/types.ts` | All shared interfaces — the data contract |
