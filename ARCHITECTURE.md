# Architecture Documentation

## Autonomous User-Journey QA Agent

> AMD AI DevMaster Hackathon Submission — Technical Architecture Reference

---

## 1. High-Level Architecture

The system is composed of five decoupled layers, each with clearly defined responsibilities and clean interface boundaries.

```
┌──────────────────────────────────────────────────────────────────┐
│  ENTRY LAYER                                                      │
│  src/index.ts          Interactive CLI (prompts)                  │
│  src/autoLaunch.ts     CI / env-driven (no prompts)              │
│  src/benchmark.ts      Provider benchmark runner                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  ORCHESTRATION LAYER                                              │
│  src/core/orchestrator.ts                                         │
│                                                                   │
│  - Reads config/config.json and .env                             │
│  - Wires all six agents in order                                  │
│  - Owns the adaptive execution loop                               │
│  - Collects ScenarioResult[] for reporting                        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
        ┌────────────────────┤
        │                    │
┌───────▼──────────┐  ┌──────▼────────────────────────────────────┐
│ AGENT LAYER      │  │  BROWSER AUTOMATION LAYER                  │
│ src/agents/      │  │  src/browser/                              │
│                  │  │                                             │
│ Planner          │  │  browserController.ts (Playwright)         │
│ Generator        │  │  seleniumBrowserController.ts              │
│ Evaluator        │  │  actionDispatcher.ts                       │
│ FailureClassif.  │  │  assertionChecker.ts                       │
│ ConfidenceScorer │  │  domParser.ts                              │
│ ReflectionAgent  │  │  networkAnalyzer.ts                        │
└──────────────────┘  └─────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────┐
│  PROVIDER LAYER                                                   │
│  src/ai/                                                          │
│                                                                   │
│  providerFactory.ts    createModelProvider(kind) → ModelProvider  │
│  providerConfig.ts     detectEnabledProviders(), resolveEndpoint()│
│  modelProvider.ts      AMDModelProvider                           │
│                        GitHubModelsProvider                       │
│                        OllamaModelProvider                        │
│  githubModelsClient.ts callModel() — provider-agnostic wrapper    │
│  inferenceLogger.ts    Structured call logging                    │
└──────────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────┐
│  REPORTING LAYER                                                  │
│  src/reporting/                                                   │
│                                                                   │
│  excelReporter.ts          Main workbook writer (8 sheets)        │
│  reflectionReportSheet.ts  Sheets 5–8 builders                    │
│  outputManager.ts          Directory structure                     │
│  regressionSkeletonGen.ts  Regression test file output            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Execution Pipeline (Per Scenario)

```
Input: WorkflowConfig { url, credentials, workflowDescription, model, provider }
│
├─ PLANNING PHASE
│   PlannerAgent.plan()
│   ├─ Sends workflowDescription to LLM
│   └─ Returns Plan { steps[], assertionContract }
│
├─ GENERATION PHASE  
│   GeneratorAgent.generate()
│   ├─ Sends Plan to LLM
│   └─ Returns Playwright/Selenium step skeleton
│
├─ EXECUTION PHASE — Adaptive Loop
│   orchestrator.runAdaptiveLoop()
│   │
│   REPEAT:
│   │   browserController.getPageContext()     → DOM + network state
│   │   EvaluatorAgent.evaluate()             → assertion state update
│   │   LLM.decide()                          → next action JSON
│   │   ActionDispatcher.execute()            → browser interaction
│   │   AssertionChecker.check()              → update fulfilled/failed/pending
│   │
│   UNTIL: stop_reason ∈ { ALL_FULFILLED | TIMEOUT | MAX_STEPS | STUCK | … }
│
├─ POST-EXECUTION INTELLIGENCE (deterministic)
│   FailureClassifier.classify()
│   └─ Returns FailureClassification { primaryClass, isRecoverable, confidence }
│   ConfidenceScorer.score()
│   └─ Returns ScenarioConfidence { score, breakdown, explanation }
│
├─ POST-EXECUTION INTELLIGENCE (LLM-powered)
│   ReflectionAgent.reflect()
│   └─ Returns ReflectionReport { summary, rootCause, evidence, suggestions,
│                                  shouldRetry, retryStrategy, confidence }
│
Output: ScenarioResult {
  pass, stopReason, partialScore,
  failureClassification, confidence, reflection
}
```

---

## 3. Module Responsibilities

### `src/agents/plannerAgent.ts`
- **Input:** Natural-language workflow description or PRD
- **Output:** Structured `Plan` with numbered steps and `AssertionContract`
- **LLM calls:** 1 per scenario

### `src/agents/generatorAgent.ts`
- **Input:** `Plan`
- **Output:** Playwright or Selenium TypeScript test skeleton string
- **LLM calls:** 1 per scenario (optional — may be skipped in adaptive mode)

### `src/agents/evaluatorAgent.ts`
- **Input:** Current `AssertionState`, page snapshot, step history
- **Output:** Updated `EvaluationResult` with `partialScore`
- **LLM calls:** 1 per adaptive loop iteration

### `src/agents/failureClassifier.ts`
- **Input:** `stopReason`, `AssertionState`, `executedSteps`, error signals
- **Output:** `FailureClassification { primaryClass, classificationConfidence, isRecoverable, evidence }`
- **LLM calls:** **ZERO** — pure deterministic rule matching

### `src/agents/confidenceScorer.ts`
- **Input:** `AssertionState`, `AssertionContract`, `stopReason`, execution signals
- **Output:** `ScenarioConfidence { score, breakdown, explanation }`
- **LLM calls:** **ZERO** — weighted formula computation

Confidence formula:
```
score = (assertionProgress × 0.50)
      + (executionStability × 0.30)
      + (stopReasonScore × 0.20)
```

### `src/agents/reflectionAgent.ts`
- **Input:** Full `ScenarioResult` including evaluation, classification, and confidence
- **Output:** `ReflectionReport { summary, rootCause, evidence[], suggestions[], shouldRetry, retryStrategy, confidence }`
- **LLM calls:** 1 per scenario, **ONLY** after adaptive loop has fully exited
- **Isolation:** Never called inside the loop. Never imports browser modules. Never imports reporting modules.

---

## 4. Provider Abstraction

All LLM calls are routed through a three-tier abstraction:

```
callModel()  [githubModelsClient.ts]
    │
    └── createModelProvider(kind)  [providerFactory.ts]
            │
            ├── new GitHubModelsProvider()  → GitHub Models inference API
            ├── new AMDModelProvider()      → AMD Radeon Cloud (OpenAI-compatible)
            └── new OllamaModelProvider()   → Local Ollama HTTP API
```

### `ModelProvider` Interface

Every provider must implement:

```typescript
interface ModelProvider {
  readonly kind: ProviderKind;                    // "github" | "amd" | "ollama"
  generateResponse(messages, options): Promise<GenerateResponseResult>;
  streamResponse?(messages, options): AsyncGenerator<string>;
  healthCheck(options?): Promise<boolean>;
  listModels?(options?): Promise<string[]>;
}
```

**No module outside `src/ai/` contains provider-specific logic.** Provider switching is accomplished exclusively by changing `MODEL_PROVIDER` in `.env`.

### Provider Configuration Resolution

```
MODEL_PROVIDER env var
    │
    └── resolveProviderKind()  [providerConfig.ts]
            │
            ├── "github"  → GITHUB_PAT, GITHUB_MODEL
            ├── "amd"     → AMD_BASE_URL, AMD_API_KEY, AMD_MODEL, AMD_TIMEOUT
            └── "ollama"  → LLM_ENDPOINT, LLM_MODEL, LLM_TIMEOUT
```

---

## 5. Reporting Pipeline

The reporting pipeline transforms `ScenarioResult[]` into a structured Excel workbook.

```
ScenarioResult[]
    │
    └── writeTestResultsExcel(results, context)  [excelReporter.ts]
            │
            ├── buildTestResultsSheet()          → Sheet 1: Test Results
            │   + injectIntelligenceColumns()    → + Confidence, Failure Class,
            │                                      Reflection Summary, Provider, Model
            │
            ├── buildExecutiveSummarySheet()     → Sheet 2: Executive Summary
            ├── buildSystemAnalysisSheet()       → Sheet 3: System Analysis
            ├── buildSummarySheet()              → Sheet 4: Summary
            │
            ├── buildReflectionReportSheet()     → Sheet 5: AI Reflection Report
            ├── buildExecutionTimelineSheet()    → Sheet 6: Execution Timeline
            ├── buildRunSummarySheet()           → Sheet 7: Run Summary
            │
            └── buildProviderBenchmarkSheet()    → Sheet 8: Provider Benchmark
                (only when benchmarkResults provided)
```

All Phase 5 reporting functions in `reflectionReportSheet.ts` are **pure** — no LLM calls, no I/O, no side effects. They transform data only.

---

## 6. Reflection Pipeline

```
Adaptive Loop Exits
    │
    ▼
ScenarioResult assembled (pass, stopReason, partialScore, assertionSummary)
    │
    ├── FailureClassifier.classify(input)         [deterministic, no LLM]
    │   └── ScenarioResult.failureClassification
    │
    ├── ConfidenceScorer.score(input)             [deterministic, no LLM]
    │   └── ScenarioResult.confidence
    │
    └── ReflectionAgent.reflect(input)            [LLM call, 1×]
        └── ScenarioResult.reflection
            │
            ▼
        Consumed by:
        ├── AI Reflection Report sheet
        ├── Execution Timeline sheet (Reflection Generated event)
        ├── Run Summary (reflectionSuccessRate metric)
        └── Test Results sheet (Reflection Summary column)
```

The Reflection Agent is **always optional** — a fallback `ReflectionReport` is returned when the LLM call fails, ensuring reporting never blocks on reflection unavailability.

---

## 7. Benchmark Pipeline

```
npm run benchmark
    │
    └── runBenchmark()  [src/benchmark/runBenchmark.ts]
            │
            ├── detectEnabledProviders()
            │   ├─ github  ← GITHUB_PAT present?
            │   ├─ amd     ← AMD_BASE_URL + AMD_API_KEY present?
            │   └─ ollama  ← LLM_ENDPOINT present?
            │
            ├── for each enabled provider:
            │   ├── createModelProvider(kind)     [ProviderFactory — no special casing]
            │   ├── generateResponse(BENCHMARK_PROMPT)
            │   │   └── Measures: wall-clock latency, inferenceTimeMs
            │   └── streamResponse(BENCHMARK_PROMPT)
            │       └── Measures: timeToFirstTokenMs
            │
            ├── BenchmarkRunResult {
            │     provider, model, endpoint, timestamp,
            │     success, totalResponseTimeMs, inferenceTimeMs,
            │     timeToFirstTokenMs, promptTokens, completionTokens,
            │     totalTokens, jsonValid, failureReason, outputPreview
            │   }
            │
            ├── formatBenchmarkConsole(results)   → Console table
            ├── benchmark/benchmark.json          → Machine-readable
            ├── benchmark/benchmark.xlsx          → Standalone Excel
            └── benchmark/benchmark.md            → Markdown report
```

---

## 8. Data Flow Summary

```
.env + config/config.json
    │
    ▼
WorkflowConfig
    │
    ▼
[Plan] → [Steps] → [Adaptive Loop] → [Stop]
                                         │
                              ┌──────────┤
                              │          │
                   [Deterministic]   [LLM Reasoning]
                   Classify          Reflect
                   Score
                              │
                              └──────────▼
                              ScenarioResult[] (enriched)
                                         │
                              ┌──────────┤
                              │          │
                        [Excel Writer]  [JSON Audit]
                        8 sheets        audit-run.json
```
