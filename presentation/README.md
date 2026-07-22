# AMD AI DevMaster Hackathon — Presenter Guide

**File:** `AMD_AI_DevMaster_Hackathon_Presentation.pptx`
**Total Slides:** 14
**Target Duration:** 6–8 minutes + Q&A
**Aspect Ratio:** 16:9 Widescreen

---

## Timing Overview

| Slide | Title | Duration | Cumulative |
|---|---|---|---|
| 1 | Title | 0:30 | 0:30 |
| 2 | Problem | 0:45 | 1:15 |
| 3 | Solution | 0:40 | 1:55 |
| 4 | Architecture | 0:45 | 2:40 |
| 5 | Execution Flow | 0:40 | 3:20 |
| 6 | Key Innovations | 0:50 | 4:10 |
| 7 | Engineering Challenges | 0:40 | 4:50 |
| 8 | AMD Integration | 0:35 | 5:25 |
| 9 | Demo | 1:00–2:00 | 6:25–7:25 |
| 10 | Generated Outputs | 0:35 | 7:00–8:00 |
| 11 | Engineering Quality | 0:25 | 7:25–8:25 |
| 12 | Impact | 0:30 | 7:55–8:55 |
| 13 | Roadmap | 0:25 | 8:20–9:20 |
| 14 | Closing | 0:20 | 8:40–9:40 |

> For 6-minute target: skip or combine slides 11 and 13. Jump from Slide 10 directly to 12, then 14.

---

## Pre-Presentation Checklist

- [ ] `.env` configured with `MODEL_PROVIDER=amd` and valid `AMD_API_KEY`
- [ ] `config/config.json` set to `"headless": false`
- [ ] `npm install` complete
- [ ] `npx playwright install chromium` complete
- [ ] Target website accessible (saucedemo.com recommended)
- [ ] `output/TestResults.xlsx` pre-opened on second monitor
- [ ] Demo video link pre-loaded in browser tab (private/incognito)
- [ ] Terminal zoomed to 150% font size
- [ ] Presentation in Presenter View (notes visible only to you)

---

## Slide-by-Slide Presenter Guide

### Slide 1 — Title (0:30)

**Goal:** First impression. Commanding presence.

**Say:**
> "What you're about to see is a fully autonomous QA agent that tests any website without a single hand-written test script. It plans, executes, reflects on failures, and generates its own regression suite — running on AMD."

**Tips:**
- Pause after the tagline quote at the bottom. Let it land.
- Do not advance immediately — let judges read the subtitle.

---

### Slide 2 — Problem (0:45)

**Goal:** Establish that this is a real, costly problem.

**Say:**
> "Every time a developer renames a CSS class, hundreds of tests break. The engineer spends hours discovering it was a UI update, not a bug. This is waste at scale — and it's universal."

**Tips:**
- Point to left column items one at a time.
- The VS badge in the middle is your visual pivot point.
- "Maintenance cost > value delivered" is the CFO moment — pause on it.

---

### Slide 3 — Solution (0:40)

**Goal:** Introduce the six-agent swarm.

**Say:**
> "We built six specialized agents. The critical distinction is the last two — ConfidenceScorer and FailureClassifier. These are deterministic TypeScript. No LLM. They cannot hallucinate."

**Tips:**
- Physically tap (or laser-point) the Confidence Scorer and Failure Classifier cards.
- Say "hallucination firewall" — judges will remember the phrase.

---

### Slide 4 — Architecture (0:45)

**Goal:** Show decoupling and provider abstraction.

**Say:**
> "The red box is the hot path. Reflection, Confidence, Classification — all run after the loop exits. Zero latency added to execution. And that Provider Abstraction box on the right — swapping AMD for GitHub Models is one environment variable."

**Tips:**
- Use a pointer or mouse to trace the vertical arrow flow.
- Point to the Provider Abstraction box before judges can ask about it.

---

### Slide 5 — Execution Flow (0:40)

**Goal:** Show the one-action-at-a-time intelligence.

**Say:**
> "Unlike generating a full script upfront, we propose one action at a time. This is what allows the agent to naturally dismiss cookie banners and CAPTCHAs — it observes the result of each action before deciding the next."

**Tips:**
- Read the stop reasons footer slowly: "ALL_FULFILLED, EXPLICIT_STOP, MAX_STEPS, ACTION_FAILED, LLM_ERROR. The agent always terminates deterministically."
- If doing a live demo, trigger `npm run dev` now in the background so the browser is ready.

---

### Slide 6 — Key Innovations (0:50)

**Goal:** Prove engineering depth.

**Must-say items:**
1. **Deterministic Enveloping** — "We don't trust the LLM blindly. We wrap its output in deterministic TypeScript."
2. **Confidence Score** — Mention the exact formula: `(assertions × 0.50) + (stability × 0.30) + (stop reason × 0.20)`. This proves it's engineered, not guessed.
3. **Auto Regression** — "The agent's successful run becomes your CI test suite automatically."

**Tips:**
- This is the most important slide for technical judges. Spend 50 seconds here — it's worth it.
- Don't read cards verbatim. Expand with one sentence each.

---

### Slide 7 — Engineering Challenges (0:40)

**Goal:** Show that challenges were discovered in practice, not anticipated in theory.

**Say:**
> "We discovered the overlay problem on the first real test run. The one-action-at-a-time loop solved it naturally — no special overlay detection code."

**Tips:**
- Move through 2 challenges per 15 seconds.
- The Reflection Latency row is a credibility signal — it shows you measured real performance.

---

### Slide 8 — AMD Integration (0:35)

**Goal:** Be precise and honest. This is the highest-stakes slide.

**Say:**
> "The AMD integration uses the Fireworks AI endpoint provisioned by the hackathon. The AMDModelProvider implements our ModelProvider interface — the same interface used by GitHub Models and Ollama. This is not a special case. On the right — the ROCm items are honest future work. We did not claim local GPU inference today."

**Tips:**
- The honesty about Implemented vs Roadmap will earn trust from AMD judges.
- Do NOT blur the line between the two columns.

---

### Slide 9 — Demo (1:00–2:00)

**Option A — Video (recommended):**
- Open the Google Drive link pre-loaded in your browser.
- Play from 0:00. Narrate over the video:
  - When terminal shows planning: *"AMD is generating the assertion contract."*
  - When browser opens: *"Generator Agent just decided to click the login button."*
  - When loop exits: *"ALL_FULFILLED. Confidence: 0.87."*
  - When Excel appears: *"Eight sheets. Root cause, timeline, regression code."*

**Option B — Live demo:**
- `npm run dev` is already running.
- Narrate every terminal line.
- Duration: ~2 minutes.

---

### Slide 10 — Generated Outputs (0:35)

**Goal:** Show enterprise readiness.

**Say:**
> "Most hackathon projects output raw JSON. We output an 8-sheet Excel workbook that a QA manager can read without touching code. The regression spec file goes directly into a CI pipeline."

**Tips:**
- If Excel is open on second monitor, switch to it briefly.
- Point to `AI Reflection Report` and `Execution Timeline` — these are the most differentiating sheets.

---

### Slide 11 — Engineering Quality (0:25)

**Goal:** Quick credibility pass.

**Say:**
> "The codebase compiles with zero errors under TypeScript strict mode. The agent isolation boundaries are grep-verifiable in 10 seconds — the JUDGE_WALKTHROUGH shows exactly which grep commands to run."

**Tips:**
- Keep this fast. Judges will have already assessed quality from the code.

---

### Slide 12 — Impact (0:30)

**Goal:** Business case.

**Say:**
> "QA engineers stop being selector mechanics and become quality architects. The Excel audit trail satisfies compliance reporting out of the box — no additional tooling."

---

### Slide 13 — Roadmap (0:25)

**Goal:** Show vision without over-promising.

**Say:**
> "Phase 1 is designed — the architecture supports it today. The ROCm work is the natural evolution of this AMD submission."

**Transition line:**
> "But the most important thing is what we have already delivered..."

---

### Slide 14 — Closing (0:20)

**Say (verbatim):**
> "No hand-written test scripts. No brittle selectors. No silent failures. The agent plans, executes, adapts, classifies, scores, reflects, and generates — all running on AMD. We are ready for questions."

**Then stop talking. Smile. Let the silence sit for 3 seconds.**

---

## Q&A Preparation

| Likely Question | Best Answer |
|---|---|
| "Why Fireworks and not direct AMD GPU?" | "AMD provisioned Fireworks for this hackathon. The ROCm path is designed and on the roadmap." |
| "How do you prevent infinite loops?" | "Five deterministic exit conditions: ALL_FULFILLED, EXPLICIT_STOP, MAX_STEPS, ACTION_FAILED, LLM_ERROR." |
| "Can it test any website?" | "Yes — it needs a URL, optional credentials, and a natural language description. No site-specific code." |
| "How accurate is the Confidence Score?" | "It's calibrated empirically. ALL_FULFILLED = 1.0, ACTION_FAILED = 0.30, MAX_STEPS = 0.25." |
| "What if the LLM returns invalid JSON?" | "FailureClassifier catches LLM_ERROR deterministically. The system logs it and gracefully exits — no crash." |
| "How is this different from browser-use?" | "browser-use is general-purpose. We have domain-specific assertion contracts, network interception, confidence scoring, and CI-ready regression output." |

---

## Design Notes

- **Font:** Segoe UI / Calibri (system default — no install required)
- **Background:** `#0D0D0D` dark with `#1A1A2E` card surfaces
- **Accent:** `#E0053D` AMD red
- **Secondary:** `#00B4D8` teal for agent distinctions
- **No animations** — all builds are instant for reliability

---

## Files in This Directory

| File | Purpose |
|---|---|
| `AMD_AI_DevMaster_Hackathon_Presentation.pptx` | Submit this file |
| `generate_presentation.py` | Regenerate the .pptx from source |
| `README.md` | This presenter guide |
