# LLM Provider Benchmark

Run `npm run benchmark` after configuring your `.env` to generate live benchmark results.

## What Is Measured

The benchmark sends identical prompts to every configured provider and measures:

| Metric | Description |
|---|---|
| `totalResponseTimeMs` | Wall-clock time from request to last byte |
| `inferenceTimeMs` | Provider-reported inference duration |
| `timeToFirstTokenMs` | Streaming TTFT measurement |
| `promptTokens` | Input token count |
| `completionTokens` | Output token count |
| `jsonValid` | Whether the model returned valid structured JSON |
| `success` | Request completed without error |
| `failureReason` | Error detail when `success` is false |

## How to Run

```bash
# Configure at least one provider in .env, then:
npm run benchmark
```

Outputs are written to:
- `benchmark/benchmark.json` — Machine-readable full results
- `benchmark/benchmark.xlsx` — Excel report (15 columns)
- `benchmark/benchmark.md` — This file (regenerated on each run)

## AMD / Fireworks AI Setup

```bash
MODEL_PROVIDER=amd
AMD_BASE_URL=https://api.fireworks.ai/inference/v1
AMD_API_KEY=<your_fireworks_key>
AMD_MODEL=accounts/fireworks/models/deepseek-v4-flash-0731
```

## Troubleshooting

**`fetch failed` / `ENOTFOUND`** — The AMD provider requires a valid `AMD_API_KEY` and
network connectivity to `api.fireworks.ai`. Ensure your `.env` is configured before running.

**Ollama `fetch failed`** — Ollama requires a local server running on `http://localhost:11434`.
Start it with `ollama serve` before benchmarking.
