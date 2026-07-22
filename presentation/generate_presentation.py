"""
AMD AI DevMaster Hackathon — Presentation Generator
Generates: presentation/AMD_AI_DevMaster_Hackathon_Presentation.pptx
"""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt
import os

# ── Colour palette ───────────────────────────────────────────────────────────
BG_DARK      = RGBColor(0x0D, 0x0D, 0x0D)   # near-black
BG_CARD      = RGBColor(0x1A, 0x1A, 0x2E)   # dark navy card
AMD_RED      = RGBColor(0xE0, 0x05, 0x3D)   # AMD brand red
AMD_RED_DIM  = RGBColor(0x8B, 0x00, 0x25)   # darker red for accents
WHITE        = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_GRAY   = RGBColor(0xCC, 0xCC, 0xCC)
MID_GRAY     = RGBColor(0x88, 0x88, 0x99)
ACCENT_BLUE  = RGBColor(0x00, 0xB4, 0xD8)   # teal accent

SLIDE_W = Inches(13.33)
SLIDE_H = Inches(7.5)

os.makedirs("presentation", exist_ok=True)
prs = Presentation()
prs.slide_width  = SLIDE_W
prs.slide_height = SLIDE_H

BLANK = prs.slide_layouts[6]  # completely blank

# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

def add_slide():
    return prs.slides.add_slide(BLANK)

def fill_bg(slide, color=BG_DARK):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color

def box(slide, left, top, width, height,
        fill_color=None, line_color=None, line_width_pt=0):
    shape = slide.shapes.add_shape(
        1,  # MSO_SHAPE_TYPE.RECTANGLE
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    shape.fill.solid() if fill_color else shape.fill.background()
    if fill_color:
        shape.fill.fore_color.rgb = fill_color
    if line_color:
        shape.line.color.rgb = line_color
        shape.line.width = Pt(line_width_pt)
    else:
        shape.line.fill.background()
    return shape

def txt(slide, text, left, top, width, height,
        size=18, bold=False, color=WHITE, align=PP_ALIGN.LEFT,
        italic=False, wrap=True):
    txBox = slide.shapes.add_textbox(
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    txBox.word_wrap = wrap
    tf = txBox.text_frame
    tf.word_wrap = wrap
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    return txBox

def multiline_txt(slide, lines, left, top, width, height,
                  size=16, color=WHITE, bullet=False, line_spacing_pt=6):
    txBox = slide.shapes.add_textbox(
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    txBox.word_wrap = True
    tf = txBox.text_frame
    tf.word_wrap = True
    first = True
    for line_text, line_bold, line_color, line_size in lines:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        p.space_before = Pt(line_spacing_pt if not first else 0)
        run = p.add_run()
        prefix = "  • " if bullet and line_text.strip() else ""
        run.text = prefix + line_text
        run.font.size = Pt(line_size or size)
        run.font.bold = line_bold
        run.font.color.rgb = line_color or color
    return txBox

def accent_line(slide, left, top, width, color=AMD_RED, thickness_pt=3):
    """Horizontal rule accent."""
    line_shape = slide.shapes.add_shape(
        1, Inches(left), Inches(top), Inches(width), Pt(thickness_pt)
    )
    line_shape.fill.solid()
    line_shape.fill.fore_color.rgb = color
    line_shape.line.fill.background()
    return line_shape

def header_block(slide, title, subtitle=None):
    """Standard dark header band at top of slide."""
    box(slide, 0, 0, 13.33, 1.4, fill_color=BG_CARD)
    accent_line(slide, 0, 1.4, 13.33)
    txt(slide, title, 0.5, 0.15, 12, 0.7, size=34, bold=True, color=WHITE)
    if subtitle:
        txt(slide, subtitle, 0.5, 0.85, 12, 0.45, size=16, color=LIGHT_GRAY)

def speaker_notes(slide, notes_text):
    notes_slide = slide.notes_slide
    tf = notes_slide.notes_text_frame
    tf.text = notes_text

def pill_badge(slide, text, left, top, width=1.8, height=0.38,
               bg=AMD_RED, fg=WHITE, size=13):
    b = box(slide, left, top, width, height, fill_color=bg)
    tf = b.text_frame
    tf.word_wrap = False
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = True
    run.font.color.rgb = fg

def arrow_down(slide, cx, top, color=AMD_RED, height_in=0.4):
    """Simple downward-pointing arrow label."""
    shape = slide.shapes.add_shape(
        13,  # MSO_SHAPE_TYPE.DOWN_ARROW
        Inches(cx - 0.18), Inches(top), Inches(0.36), Inches(height_in)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 1 — Title
# ─────────────────────────────────────────────────────────────────────────────
slide1 = add_slide()
fill_bg(slide1)

# Hero gradient band
box(slide1, 0, 0, 13.33, 7.5, fill_color=BG_DARK)
box(slide1, 0, 0, 13.33, 4.5, fill_color=BG_CARD)
accent_line(slide1, 0, 4.5, 13.33, color=AMD_RED, thickness_pt=4)
accent_line(slide1, 0, 4.54, 13.33, color=AMD_RED_DIM, thickness_pt=2)

# AMD badge top-right
pill_badge(slide1, "AMD AI DevMaster Hackathon", 8.8, 0.18, 4.3, 0.42, bg=AMD_RED)

# Main title
txt(slide1, "Autonomous", 0.55, 0.65, 12, 0.9, size=52, bold=True, color=WHITE)
txt(slide1, "User-Journey QA Agent", 0.55, 1.55, 12, 0.95, size=42, bold=True, color=AMD_RED)

# Subtitle
txt(slide1,
    "Adaptive AI-powered browser testing using multi-agent reasoning",
    0.55, 2.6, 10, 0.7, size=22, color=LIGHT_GRAY, italic=True)

# Divider
accent_line(slide1, 0.55, 3.45, 6.5, color=AMD_RED, thickness_pt=2)

# Meta row
txt(slide1, "⚙  TypeScript + Playwright + Fireworks AI (AMD)",
    0.55, 3.7, 9, 0.45, size=15, color=ACCENT_BLUE)
txt(slide1, "🔗  github.com/Prakhar601/User-Journey-QA-agentic-tool",
    0.55, 4.15, 9, 0.4, size=14, color=LIGHT_GRAY)

# Bottom tagline
box(slide1, 0, 4.7, 13.33, 2.8, fill_color=BG_DARK)
txt(slide1,
    '"No hand-written test scripts.\nNo brittle selectors. No silent failures."',
    1.2, 5.0, 11, 1.6, size=26, bold=True, color=WHITE, align=PP_ALIGN.CENTER, italic=True)

speaker_notes(slide1,
    "SLIDE 1 — Title (30 seconds)\n\n"
    "Opening statement:\n"
    "'What you're about to see is a fully autonomous QA agent that tests any website without a single "
    "hand-written test script. It plans, executes, reflects on failures, and generates its own regression "
    "suite — running on AMD-provisioned inference.'\n\n"
    "TIMING: 30 seconds. Let the slide breathe. Don't rush.\n"
    "TIP: Make eye contact. Pause after the tagline quote.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 2 — Problem
# ─────────────────────────────────────────────────────────────────────────────
slide2 = add_slide()
fill_bg(slide2)
header_block(slide2, "The Problem with Traditional QA",
             "Why every UI change breaks your test suite")

# Left column — pain points
box(slide2, 0.4, 1.6, 5.8, 5.55, fill_color=BG_CARD, line_color=AMD_RED, line_width_pt=1.5)
txt(slide2, "Traditional Selenium / Playwright", 0.6, 1.7, 5.4, 0.5,
    size=15, bold=True, color=AMD_RED, align=PP_ALIGN.CENTER)
accent_line(slide2, 0.6, 2.2, 5.4, color=AMD_RED, thickness_pt=1)

problems = [
    ("❌  Hardcoded selectors break on every UI change", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("❌  No reasoning about why a test failed", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("❌  Maintenance cost > value delivered", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("❌  Dynamic UIs, popups, overlays crash scripts", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("❌  Manual debugging after every deployment", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("❌  Zero confidence scoring on flaky tests", False, LIGHT_GRAY, 14),
]
multiline_txt(slide2, problems, 0.65, 2.35, 5.3, 4.5, size=14, line_spacing_pt=4)

# Right column — our approach
box(slide2, 6.8, 1.6, 6.1, 5.55, fill_color=BG_CARD, line_color=ACCENT_BLUE, line_width_pt=1.5)
txt(slide2, "Adaptive Agentic QA ✓", 7.0, 1.7, 5.7, 0.5,
    size=15, bold=True, color=ACCENT_BLUE, align=PP_ALIGN.CENTER)
accent_line(slide2, 7.0, 2.2, 5.7, color=ACCENT_BLUE, thickness_pt=1)

solutions = [
    ("✅  LLM-driven DOM interpretation, no brittle selectors", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("✅  Reflection Agent diagnoses root cause", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("✅  Zero script maintenance — agent adapts", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("✅  Adaptive loop recovers from overlays and layout shifts", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("✅  Automated root-cause reports per scenario", False, LIGHT_GRAY, 14),
    ("", False, WHITE, 6),
    ("✅  Continuous confidence score (0.0 – 1.0)", False, LIGHT_GRAY, 14),
]
multiline_txt(slide2, solutions, 7.05, 2.35, 5.65, 4.5, size=14, line_spacing_pt=4)

# VS badge
box(slide2, 6.1, 3.9, 0.65, 0.65, fill_color=AMD_RED)
txt(slide2, "VS", 6.1, 3.92, 0.65, 0.62, size=18, bold=True, color=WHITE, align=PP_ALIGN.CENTER)

speaker_notes(slide2,
    "SLIDE 2 — Problem (45 seconds)\n\n"
    "Key message: QA is not just a tooling problem — it's a reasoning problem.\n\n"
    "Say: 'Every time a developer renames a CSS class, hundreds of tests break. The engineer "
    "then spends hours discovering it was a UI update, not a bug. This is waste at scale.'\n\n"
    "Point at the left column as you read each pain point. Then sweep to the right column.\n"
    "TIMING: 45 seconds. One breath per row.\n"
    "TIP: Pause on 'Maintenance cost > value delivered' — that is the CFO moment.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 3 — Solution
# ─────────────────────────────────────────────────────────────────────────────
slide3 = add_slide()
fill_bg(slide3)
header_block(slide3, "The Solution", "Six specialized agents. One autonomous pipeline.")

agents = [
    ("🗺  Planner Agent",       "Converts natural language into a structured JSON assertion contract",     AMD_RED),
    ("⚡  Generator Agent",     "Proposes one action at a time — click, type, scroll, stop",              ACCENT_BLUE),
    ("🔍  Evaluator Agent",     "Evaluates assertions after every step against DOM and network state",     RGBColor(0x00,0xC9,0x6E)),
    ("🪞  Reflection Agent",    "Post-execution AMD AI call — root cause, suggestions, retry decision",   RGBColor(0xFF,0xA5,0x00)),
    ("📊  Confidence Scorer",   "Deterministic heuristic score (0.0–1.0) — no LLM, no hallucination",    RGBColor(0xBB,0x86,0xFC)),
    ("🛡  Failure Classifier",  "Deterministic taxonomy: UI / Network / LLM / Assertion — no LLM",       RGBColor(0xFF,0x6B,0x6B)),
]

card_w = 3.9
card_h = 1.55
cols = [0.35, 4.6, 8.85]
rows = [1.65, 3.45, 5.25]  # only 2 rows of 3

for i, (name, desc, color) in enumerate(agents):
    col_idx = i % 3
    row_idx = i // 3
    cx = cols[col_idx]
    cy = rows[row_idx]
    box(slide3, cx, cy, card_w, card_h, fill_color=BG_CARD, line_color=color, line_width_pt=1.5)
    accent_line(slide3, cx, cy + 0.52, card_w, color=color, thickness_pt=2)
    txt(slide3, name, cx + 0.15, cy + 0.08, card_w - 0.2, 0.42, size=15, bold=True, color=color)
    txt(slide3, desc, cx + 0.15, cy + 0.62, card_w - 0.25, 0.85, size=11.5, color=LIGHT_GRAY)

speaker_notes(slide3,
    "SLIDE 3 — Solution (40 seconds)\n\n"
    "Key message: Each agent has ONE job and cannot violate the other's boundary.\n\n"
    "Say: 'The Reflection Agent is the most important distinction from classical testing. "
    "It never runs inside the execution loop — it sees the entire, immutable execution "
    "timeline and reasons about it once, after the fact.'\n\n"
    "Critical point: ConfidenceScorer and FailureClassifier are 100% deterministic. "
    "No LLM. They cannot hallucinate.\n\n"
    "TIMING: 40 seconds. Name each agent briefly — don't read the descriptions.\n"
    "TIP: Tap the Confidence Scorer and Failure Classifier cards: 'These two are our hallucination firewall.'")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 4 — Architecture
# ─────────────────────────────────────────────────────────────────────────────
slide4 = add_slide()
fill_bg(slide4)
header_block(slide4, "System Architecture", "Decoupled layers — provider-agnostic by design")

# Draw the architecture flow down the center
stages = [
    ("User Prompt",             BG_CARD,          WHITE,       AMD_RED),
    ("Planner Agent  →  JSON Assertion Contract", BG_CARD, WHITE, ACCENT_BLUE),
    ("Adaptive Execution Loop", AMD_RED_DIM,       WHITE,       AMD_RED),
    ("Playwright Browser + DOM + Network",   BG_CARD, LIGHT_GRAY, ACCENT_BLUE),
    ("Assertion Engine  (Deterministic)",   BG_CARD, LIGHT_GRAY, RGBColor(0x00,0xC9,0x6E)),
    ("Reflection Agent + Failure Classifier + Confidence Scorer", BG_CARD, LIGHT_GRAY, RGBColor(0xFF,0xA5,0x00)),
    ("Reports: Excel · JSON · Playwright Regression", BG_CARD, WHITE, RGBColor(0xBB,0x86,0xFC)),
]

box_w = 7.2
box_h = 0.62
start_x = (13.33 - box_w) / 2
start_y = 1.55
gap = 0.78

for i, (label, bg, fg, border) in enumerate(stages):
    y = start_y + i * gap
    b = box(slide4, start_x, y, box_w, box_h, fill_color=bg, line_color=border, line_width_pt=1.8)
    txt(slide4, label, start_x + 0.15, y + 0.08, box_w - 0.25, 0.46,
        size=14, bold=True if i in (0, 2) else False, color=fg, align=PP_ALIGN.CENTER)
    if i < len(stages) - 1:
        arrow_down(slide4, start_x + box_w / 2, y + box_h + 0.02, color=AMD_RED, height_in=0.3)

# Side label — Provider abstraction
box(slide4, 10.85, 2.75, 2.2, 1.55, fill_color=RGBColor(0x10,0x14,0x22), line_color=AMD_RED, line_width_pt=1)
txt(slide4, "Provider\nAbstraction", 10.9, 2.8, 2.1, 0.6, size=12, bold=True, color=AMD_RED, align=PP_ALIGN.CENTER)
txt(slide4, "AMD / Fireworks\nGitHub Models\nOllama", 10.9, 3.38, 2.1, 0.9, size=10.5, color=LIGHT_GRAY, align=PP_ALIGN.CENTER)

# Arrow from loop box to provider box
arrow_txt_box = slide4.shapes.add_textbox(Inches(9.95), Inches(3.35), Inches(0.9), Inches(0.35))
arrow_txt_box.text_frame.text = "──▶"
arrow_txt_box.text_frame.paragraphs[0].runs[0].font.color.rgb = AMD_RED
arrow_txt_box.text_frame.paragraphs[0].runs[0].font.size = Pt(14)

speaker_notes(slide4,
    "SLIDE 4 — Architecture (45 seconds)\n\n"
    "Walk top to bottom, pausing at the Adaptive Execution Loop (red box).\n\n"
    "Key point: 'The red box is the hot path. Everything outside it — Reflection, Confidence, "
    "Classification — runs after the loop exits. Zero latency added to execution.'\n\n"
    "Point to the Provider Abstraction box: 'Switching from AMD to GitHub Models is one "
    "environment variable. There is zero provider-specific logic in the agents.'\n\n"
    "TIMING: 45 seconds. Use a pointer for the arrow flow.\n"
    "TIP: The judges will look for the provider abstraction. Point to it proactively.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 5 — Execution Flow
# ─────────────────────────────────────────────────────────────────────────────
slide5 = add_slide()
fill_bg(slide5)
header_block(slide5, "Adaptive Execution Loop", "One action at a time — observe, decide, execute, evaluate")

steps = [
    ("1", "Receive Workflow",   "Natural language description →\nPlanner generates assertion contract",  ACCENT_BLUE),
    ("2", "Observe",            "Extract clean DOM snapshot\n+ intercept HTTP network traffic",           RGBColor(0x00,0xC9,0x6E)),
    ("3", "Decide",             "Generator Agent proposes\nthe single next action",                       RGBColor(0xFF,0xA5,0x00)),
    ("4", "Execute",            "Playwright dispatches action\nwith overlay recovery fallback",           AMD_RED),
    ("5", "Evaluate",           "Deterministic assertion check\nagainst DOM + network state",             RGBColor(0xBB,0x86,0xFC)),
    ("6", "Loop / Exit",        "If assertions fulfilled → exit\nOtherwise → next iteration",            LIGHT_GRAY),
]

card_w = 3.7
card_h = 2.0
col_xs = [0.35, 4.4, 8.45]
row_ys = [1.65, 4.05]

for i, (num, title, desc, color) in enumerate(steps):
    col = i % 3
    row = i // 3
    cx = col_xs[col]
    cy = row_ys[row]
    box(slide5, cx, cy, card_w, card_h, fill_color=BG_CARD, line_color=color, line_width_pt=1.5)
    # Step number circle
    num_box = box(slide5, cx + 0.1, cy + 0.12, 0.55, 0.55, fill_color=color)
    txt(slide5, num, cx + 0.1, cy + 0.12, 0.55, 0.55, size=18, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    txt(slide5, title, cx + 0.75, cy + 0.15, card_w - 0.9, 0.45, size=15, bold=True, color=color)
    txt(slide5, desc, cx + 0.12, cy + 0.72, card_w - 0.25, 1.15, size=12, color=LIGHT_GRAY)
    # Arrow between columns
    if col < 2:
        arrow_box = slide5.shapes.add_textbox(Inches(cx + card_w + 0.02), Inches(cy + 0.72), Inches(0.36), Inches(0.45))
        arrow_box.text_frame.text = "▶"
        arrow_box.text_frame.paragraphs[0].runs[0].font.color.rgb = color
        arrow_box.text_frame.paragraphs[0].runs[0].font.size = Pt(18)

# Down arrow between rows at center
arrow_down(slide5, 6.67, 3.65, color=AMD_RED, height_in=0.42)

# Stop reasons footer
box(slide5, 0.35, 6.18, 12.6, 0.95, fill_color=RGBColor(0x10,0x14,0x22), line_color=AMD_RED, line_width_pt=1)
txt(slide5, "Exit reasons:  ALL_FULFILLED  ·  EXPLICIT_STOP  ·  MAX_STEPS  ·  ACTION_FAILED  ·  LLM_ERROR",
    0.5, 6.28, 12.3, 0.6, size=12.5, color=LIGHT_GRAY, align=PP_ALIGN.CENTER)

speaker_notes(slide5,
    "SLIDE 5 — Execution Flow (40 seconds)\n\n"
    "Walk through steps 1-6 at a steady pace.\n\n"
    "Emphasise step 3 (Decide): 'Unlike generating a full script upfront, we propose ONE action at "
    "a time. This is what allows the agent to naturally dismiss unexpected cookie banners or CAPTCHAs.'\n\n"
    "Point to the footer: 'The loop has five clean exit conditions — there is no infinite loop. "
    "The agent always terminates deterministically.'\n\n"
    "TIMING: 40 seconds.\n"
    "TIP: If the demo is live, trigger npm run dev now so the browser is already opening during Q6.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 6 — Key Innovations
# ─────────────────────────────────────────────────────────────────────────────
slide6 = add_slide()
fill_bg(slide6)
header_block(slide6, "Key Innovations", "What makes this system different from a Playwright wrapper")

innovations = [
    ("🧠  Reflection Engine",
     "Isolated post-execution AMD AI call.\nAnalyzes the full execution timeline once — never inside the loop.",
     AMD_RED),
    ("🛡  Deterministic Enveloping",
     "FailureClassifier and ConfidenceScorer are pure TypeScript.\nNo LLM — they cannot hallucinate or be inconsistent.",
     ACCENT_BLUE),
    ("📈  Confidence Scoring",
     "Score = (assertions × 0.50) + (stability × 0.30) + (stop reason × 0.20)\nProvides a continuous reliability signal, not binary pass/fail.",
     RGBColor(0xBB,0x86,0xFC)),
    ("🔌  Provider Abstraction",
     "ModelProvider interface abstracts AMD, GitHub Models, and Ollama.\nSwitch with one environment variable — zero code changes.",
     RGBColor(0x00,0xC9,0x6E)),
    ("🔁  Auto Regression Generation",
     "Converts successful agent runs into stable Playwright .spec.ts files.\nBridges agentic exploration with CI/CD stability.",
     RGBColor(0xFF,0xA5,0x00)),
    ("📊  Network-Aware Assertions",
     "Intercepts HTTP traffic during execution.\nAssertions verify API payload content — not just UI visibility.",
     RGBColor(0xFF,0x6B,0x6B)),
    ("🗓  Execution Timeline",
     "Complete chronological audit log of every pipeline stage.\nReplay exactly what happened — no black boxes.",
     LIGHT_GRAY),
]

col_xs = [0.35, 6.85]
row_ys = [1.65, 2.95, 4.25, 5.55]
card_w = 6.15
card_h = 1.15

for i, (name, desc, color) in enumerate(innovations[:6]):
    col = i % 2
    row = i // 2
    cx = col_xs[col]
    cy = row_ys[row]
    box(slide6, cx, cy, card_w, card_h, fill_color=BG_CARD, line_color=color, line_width_pt=1.2)
    txt(slide6, name, cx + 0.15, cy + 0.08, card_w - 0.25, 0.42, size=14, bold=True, color=color)
    txt(slide6, desc, cx + 0.15, cy + 0.52, card_w - 0.25, 0.58, size=11, color=LIGHT_GRAY)

# 7th card spans full width
cx7 = 0.35
cy7 = row_ys[3]
box(slide6, cx7, cy7, 12.65, card_h, fill_color=BG_CARD, line_color=LIGHT_GRAY, line_width_pt=1.2)
txt(slide6, innovations[6][0], cx7 + 0.15, cy7 + 0.08, 6, 0.42, size=14, bold=True, color=LIGHT_GRAY)
txt(slide6, innovations[6][1], cx7 + 0.15, cy7 + 0.52, 12.3, 0.58, size=11, color=LIGHT_GRAY)

speaker_notes(slide6,
    "SLIDE 6 — Key Innovations (50 seconds)\n\n"
    "This is the technical heart of the pitch. Judges will evaluate depth here.\n\n"
    "Must-mention items:\n"
    "1. Deterministic Enveloping — this is THE architectural innovation. Say: 'We don't trust "
    "the LLM blindly. We wrap its output in deterministic TypeScript that produces reproducible results.'\n"
    "2. Confidence Score formula — mention the exact weights. It proves this is engineered, not guessed.\n"
    "3. Auto Regression Generation — 'The agent's successful run becomes your CI test suite automatically.'\n\n"
    "TIMING: 50 seconds. Don't read cards verbatim — expand with one sentence each.\n"
    "TIP: The Deterministic Enveloping card is the judge's favourite. Spend 15 seconds on it.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 7 — Engineering Challenges
# ─────────────────────────────────────────────────────────────────────────────
slide7 = add_slide()
fill_bg(slide7)
header_block(slide7, "Engineering Challenges & Solutions",
             "Real problems solved — not theoretical design")

challenges = [
    ("LLM Hallucination",
     "LLMs produce invalid JSON or fabricate actions.",
     "Retry with schema enforcement. FailureClassifier catches LLM_ERROR deterministically.",
     AMD_RED),
    ("Dynamic UI / Overlays",
     "Cookie banners, popups, and CAPTCHA intercept clicks.",
     "One-action-at-a-time loop naturally surfaces overlays. Escape key + body click recovery.",
     ACCENT_BLUE),
    ("Provider Lock-In",
     "Switching LLM vendors is expensive and risky.",
     "ModelProvider interface + ProviderFactory. One env-var change routes all six agents.",
     RGBColor(0x00,0xC9,0x6E)),
    ("Assertion Completeness",
     "Agent may mark assertions fulfilled prematurely.",
     "finaliseTextAbsentAssertions() closes assertions post-loop before scoring.",
     RGBColor(0xFF,0xA5,0x00)),
    ("Report Fidelity",
     "Execution state must be preserved exactly for reporting.",
     "Immutable ScenarioResult[] collected by Orchestrator — agents never mutate state.",
     RGBColor(0xBB,0x86,0xFC)),
    ("Reflection Latency",
     "Reflection adds LLM latency to every test run.",
     "Reflection runs post-loop in parallel with report generation — zero execution latency.",
     RGBColor(0xFF,0x6B,0x6B)),
]

row_y = 1.65
card_h = 1.5
card_w = 4.0
col_xs = [0.3, 4.65, 9.0]
row_ys_ch = [1.65, 3.5, 5.35]

for i, (challenge, problem, solution, color) in enumerate(challenges):
    col = i % 3
    row = i // 3
    cx = col_xs[col]
    cy = row_ys_ch[row]
    box(slide7, cx, cy, card_w, card_h, fill_color=BG_CARD, line_color=color, line_width_pt=1.2)
    txt(slide7, challenge, cx + 0.12, cy + 0.08, card_w - 0.2, 0.38, size=13.5, bold=True, color=color)
    txt(slide7, "❗ " + problem, cx + 0.12, cy + 0.48, card_w - 0.2, 0.48, size=10.5, color=LIGHT_GRAY, italic=True)
    txt(slide7, "✅ " + solution, cx + 0.12, cy + 0.95, card_w - 0.2, 0.52, size=10.5, color=WHITE)

speaker_notes(slide7,
    "SLIDE 7 — Engineering Challenges (40 seconds)\n\n"
    "Key message: Every challenge here was encountered in practice, not anticipated theoretically.\n\n"
    "Focus on the first two: LLM Hallucination and Dynamic UI.\n"
    "Say: 'We discovered the overlay problem on the first real test run against saucedemo.com. "
    "The natural one-action-at-a-time loop solved it without any special overlay detection code.'\n\n"
    "For Reflection Latency: 'The judge review flagged this. We isolated reflection outside the "
    "hot path specifically because we measured a 2-4 second LLM call latency per scenario.'\n\n"
    "TIMING: 40 seconds. Two challenges per 15 seconds.\n"
    "TIP: Move faster here — judges appreciate knowing you solved real problems, not theoretical ones.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 8 — AMD Integration
# ─────────────────────────────────────────────────────────────────────────────
slide8 = add_slide()
fill_bg(slide8)
header_block(slide8, "AMD AI Integration",
             "Fireworks AI inference endpoint · OpenAI-compatible provider bridge")

# IMPLEMENTED section
box(slide8, 0.35, 1.65, 6.0, 5.4, fill_color=BG_CARD, line_color=AMD_RED, line_width_pt=2)
txt(slide8, "✅  IMPLEMENTED", 0.55, 1.75, 5.6, 0.5, size=16, bold=True, color=AMD_RED)
accent_line(slide8, 0.55, 2.28, 5.6, color=AMD_RED, thickness_pt=1.5)

impl_items = [
    "AMD AI DevMaster Hackathon",
    "  provisioned Fireworks AI endpoint",
    "",
    "Endpoint:",
    "  api.fireworks.ai/inference/v1",
    "",
    "Model:",
    "  deepseek-v4-flash-0731",
    "",
    "OpenAI-compatible AMDModelProvider",
    "  enforces strict JSON schema output",
    "",
    "Cross-provider benchmark CLI",
    "  npm run benchmark",
    "  measures AMD vs GitHub Models",
    "  on latency, TTFT, token counts",
]
y = 2.4
for item in impl_items:
    if item == "":
        y += 0.08
        continue
    bold = not item.startswith("  ")
    color = LIGHT_GRAY if item.startswith("  ") else WHITE
    txt(slide8, item, 0.55, y, 5.5, 0.32, size=12, bold=bold, color=color)
    y += 0.32

# ROADMAP section
box(slide8, 7.0, 1.65, 6.0, 5.4, fill_color=BG_CARD, line_color=MID_GRAY, line_width_pt=1.5)
txt(slide8, "🗺  FUTURE ROADMAP", 7.2, 1.75, 5.6, 0.5, size=16, bold=True, color=MID_GRAY)
accent_line(slide8, 7.2, 2.28, 5.6, color=MID_GRAY, thickness_pt=1)

roadmap_items = [
    ("ROCm Integration",
     "Run Planner and Reflection on Radeon GPU offline. Eliminate cloud API cost for slow reasoning agents."),
    ("Local Inference",
     "ONNX / llama.cpp execution on AMD hardware. Delegate Generator Agent to cloud, heavy thinkers stay local."),
    ("GPU Benchmarking",
     "Measure ROCm throughput vs cloud endpoint. Provide objective hardware performance metrics."),
    ("Multi-Tab Support",
     "SSO / OAuth flows that open new browser contexts. Extend BrowserController to manage page arrays."),
]
y_r = 2.5
for title_r, desc_r in roadmap_items:
    box(slide8, 7.15, y_r, 5.65, 1.15, fill_color=RGBColor(0x10,0x14,0x22), line_color=MID_GRAY, line_width_pt=0.8)
    txt(slide8, title_r, 7.3, y_r + 0.07, 5.3, 0.38, size=13, bold=True, color=MID_GRAY)
    txt(slide8, desc_r, 7.3, y_r + 0.48, 5.3, 0.62, size=10.5, color=RGBColor(0x66,0x66,0x77))
    y_r += 1.28

speaker_notes(slide8,
    "SLIDE 8 — AMD Integration (35 seconds)\n\n"
    "This is the highest-stakes slide for the AMD judges. Be precise and honest.\n\n"
    "Say: 'The AMD integration uses the Fireworks AI endpoint provisioned by the hackathon. "
    "The AMDModelProvider implements our ModelProvider interface — the same interface used "
    "by GitHub Models and Ollama. This is not a special case.'\n\n"
    "On the roadmap: 'The ROCm items are honest future work. We did not claim local GPU "
    "inference in this submission — but the architecture is designed to support it.'\n\n"
    "TIMING: 35 seconds. Implemented: 20s. Roadmap: 15s.\n"
    "TIP: The honesty about Roadmap vs Implemented will earn trust. Do not blur the line.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 9 — Demo
# ─────────────────────────────────────────────────────────────────────────────
slide9 = add_slide()
fill_bg(slide9)
header_block(slide9, "Live Demo", "5-minute walkthrough of the complete autonomous QA pipeline")

# Large demo card
box(slide9, 0.35, 1.65, 12.6, 3.2, fill_color=BG_CARD, line_color=AMD_RED, line_width_pt=2)
txt(slide9, "▶  DEMO VIDEO", 0.55, 1.78, 8, 0.55, size=22, bold=True, color=AMD_RED)
txt(slide9,
    "https://drive.google.com/file/d/1YanieQ-A2P0G1wv03hTpC-qfLOc4NfCc/view?usp=drive_link",
    0.55, 2.38, 12.1, 0.42, size=12, color=ACCENT_BLUE)
accent_line(slide9, 0.55, 2.9, 12.1, color=AMD_RED, thickness_pt=1)

demo_points = [
    "Adaptive Planning      →    Natural language → JSON assertion contract in real time",
    "Browser Execution      →    Live Playwright automation on target website",
    "Overlay Recovery       →    Agent dismisses popup and continues without script failure",
    "Reflection Output      →    AMD AI root-cause analysis after execution completes",
    "Confidence Score       →    0.87 / 1.0 printed to terminal with component breakdown",
    "Report Generation      →    8-sheet Excel + Playwright regression .spec.ts written to disk",
]
y_d = 3.02
for pt in demo_points:
    txt(slide9, "  •  " + pt, 0.65, y_d, 12.0, 0.32, size=12, color=LIGHT_GRAY)
    y_d += 0.34

# Demo environment
box(slide9, 0.35, 5.0, 5.8, 2.2, fill_color=BG_CARD, line_color=ACCENT_BLUE, line_width_pt=1.2)
txt(slide9, "Demo Environment", 0.55, 5.1, 5.4, 0.42, size=14, bold=True, color=ACCENT_BLUE)
env_lines = [
    ("URL:          saucedemo.com (stable public test site)", False, LIGHT_GRAY, 12),
    ("Provider:     AMD / Fireworks AI", False, LIGHT_GRAY, 12),
    ("Model:        deepseek-v4-flash-0731", False, LIGHT_GRAY, 12),
    ("Browser:      Chromium (headless: false)", False, LIGHT_GRAY, 12),
]
multiline_txt(slide9, env_lines, 0.55, 5.55, 5.4, 1.55, size=12, line_spacing_pt=4)

# QR code placeholder with live link
box(slide9, 7.1, 5.0, 5.6, 2.2, fill_color=BG_CARD, line_color=AMD_RED, line_width_pt=1.2)
txt(slide9, "Scan or click to watch", 7.3, 5.1, 5.2, 0.42, size=14, bold=True, color=AMD_RED, align=PP_ALIGN.CENTER)
txt(slide9, "[ QR Code ]", 7.3, 5.55, 5.2, 0.75, size=28, bold=True, color=MID_GRAY, align=PP_ALIGN.CENTER)
txt(slide9, "drive.google.com/file/d/\n1YanieQ-A2P0G1wv03hTpC-qfLOc4NfCc",
    7.3, 6.32, 5.2, 0.8, size=9.5, color=LIGHT_GRAY, align=PP_ALIGN.CENTER)

speaker_notes(slide9,
    "SLIDE 9 — Demo (60 seconds — or live demo of 2 minutes)\n\n"
    "Option A (if internet available): Open the Google Drive link and play the video.\n"
    "Option B (if live demo): Run npm run dev against saucedemo.com. Narrate in real time.\n\n"
    "Narration cues:\n"
    "- When the planner runs: 'The Planner just sent the workflow to AMD. Watch the JSON contract.'\n"
    "- When browser opens: 'The Generator Agent sees the DOM and proposes: click login button.'\n"
    "- When loop exits: 'ALL_FULFILLED — every assertion passed. Confidence: 0.87.'\n"
    "- When Excel opens: 'Eight sheets. Root cause, timeline, regression code. All generated.'\n\n"
    "TIMING: Video = 60 seconds excerpt. Live = 2 minutes.\n"
    "TIP: Have the demo pre-loaded. Never fumble with setup on stage.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 10 — Generated Outputs
# ─────────────────────────────────────────────────────────────────────────────
slide10 = add_slide()
fill_bg(slide10)
header_block(slide10, "Generated Outputs", "Every run produces enterprise-grade artifacts automatically")

outputs = [
    ("📋  TestResults.xlsx",
     "8 sheets: Test Results · Executive Summary · System Analysis\n"
     "AI Reflection Report · Execution Timeline · Run Summary",
     AMD_RED),
    ("🧪  regression-playwright.spec.ts",
     "Production-ready Playwright TypeScript spec\n"
     "Generated from the successful autonomous run — ready for CI/CD",
     ACCENT_BLUE),
    ("📊  benchmark.json / .xlsx",
     "Cross-provider latency, TTFT, token counts,\n"
     "JSON validity for AMD vs GitHub Models vs Ollama",
     RGBColor(0x00,0xC9,0x6E)),
    ("🪞  AI Reflection Report",
     "Per-scenario: Summary · Root Cause · Suggestions\n"
     "Should Retry · Retry Strategy · Confidence (0.0–1.0)",
     RGBColor(0xFF,0xA5,0x00)),
    ("📅  Execution Timeline",
     "Complete chronological audit: Scenario Started → Adaptive Loop\n"
     "→ Assertions Evaluated → Confidence Calculated → Reflection Generated",
     RGBColor(0xBB,0x86,0xFC)),
    ("🛡  Failure Classification",
     "Deterministic taxonomy per scenario:\n"
     "UI_FAILURE · NETWORK_FAILURE · LLM_ERROR · ASSERTION_FAILURE · PASS",
     RGBColor(0xFF,0x6B,0x6B)),
]

card_w = 5.9
card_h = 1.85
col_xs = [0.35, 6.7]
row_ys = [1.65, 3.65, 5.55]

for i, (name, desc, color) in enumerate(outputs):
    col = i % 2
    row = i // 2
    cx = col_xs[col]
    cy = row_ys[row]
    if cy + card_h > 7.3:
        card_h_here = 1.65
    else:
        card_h_here = card_h
    box(slide10, cx, cy, card_w, card_h_here, fill_color=BG_CARD, line_color=color, line_width_pt=1.5)
    txt(slide10, name, cx + 0.15, cy + 0.1, card_w - 0.25, 0.45, size=14, bold=True, color=color)
    txt(slide10, desc, cx + 0.15, cy + 0.58, card_w - 0.25, card_h_here - 0.65, size=11.5, color=LIGHT_GRAY)

speaker_notes(slide10,
    "SLIDE 10 — Generated Outputs (35 seconds)\n\n"
    "Key message: The outputs are what make this enterprise-ready, not just a proof-of-concept.\n\n"
    "Say: 'Most hackathon projects output raw JSON. We output an 8-sheet Excel workbook that a "
    "QA manager can read without touching code. And we generate the regression test file that "
    "can be dropped directly into a CI pipeline.'\n\n"
    "TIMING: 35 seconds. Don't read every item — summarise the categories.\n"
    "TIP: Have the Excel file open on a second monitor if possible. Flip to it briefly.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 11 — Engineering Quality
# ─────────────────────────────────────────────────────────────────────────────
slide11 = add_slide()
fill_bg(slide11)
header_block(slide11, "Engineering Quality", "Production-grade practices — not a prototype")

quality_items = [
    ("TypeScript Strict Mode",    "noImplicitAny · strict · forceConsistentCasing\nZero compile errors",                             ACCENT_BLUE),
    ("Provider Abstraction",      "ModelProvider interface — AMD, GitHub, Ollama\nZero provider-specific code in agent layer",        AMD_RED),
    ("Agent Isolation",           "ReflectionAgent: NEVER imports browser or reporting.\nGrep-verifiable in 10 seconds",             RGBColor(0x00,0xC9,0x6E)),
    ("Retry Logic",               "fetchWithTimeout + configurable retry wraps\nevery LLM call — network failures don't crash",      RGBColor(0xFF,0xA5,0x00)),
    ("Graceful Degradation",      "Reflection failures return safe fallback.\nExecution never crashes on missing AI response",       RGBColor(0xBB,0x86,0xFC)),
    ("Structured Documentation",  "README · ARCHITECTURE · JUDGE_WALKTHROUGH\nDEMO_GUIDE — every layer documented",                 LIGHT_GRAY),
]

card_w = 5.9
card_h = 1.62
col_xs2 = [0.35, 6.7]
row_ys2 = [1.65, 3.42, 5.18]

for i, (name, desc, color) in enumerate(quality_items):
    col = i % 2
    row = i // 2
    cx = col_xs2[col]
    cy = row_ys2[row]
    box(slide11, cx, cy, card_w, card_h, fill_color=BG_CARD, line_color=color, line_width_pt=1.2)
    txt(slide11, name, cx + 0.15, cy + 0.1, card_w - 0.25, 0.42, size=14, bold=True, color=color)
    txt(slide11, desc, cx + 0.15, cy + 0.55, card_w - 0.25, 1.0, size=11.5, color=LIGHT_GRAY)

speaker_notes(slide11,
    "SLIDE 11 — Engineering Quality (25 seconds)\n\n"
    "This slide is a credibility signal, not a deep discussion.\n\n"
    "Say: 'The codebase compiles with zero errors under TypeScript strict mode. The agent "
    "isolation boundaries are not comments — they are grep-verifiable constraints documented "
    "in the JUDGE_WALKTHROUGH.'\n\n"
    "TIMING: 25 seconds. Move quickly — judges will have already assessed quality from the code.\n"
    "TIP: This is also your natural bridge into Impact.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 12 — Impact
# ─────────────────────────────────────────────────────────────────────────────
slide12 = add_slide()
fill_bg(slide12)
header_block(slide12, "Impact", "Transforming how engineering teams think about test quality")

box(slide12, 0.35, 1.65, 12.65, 2.55, fill_color=BG_CARD, line_color=AMD_RED, line_width_pt=1.5)
impact_stats = [
    ("Zero",      "hand-written\ntest scripts required",   AMD_RED),
    ("Automatic", "recovery from\nUI changes",             ACCENT_BLUE),
    ("Root cause", "analysis per\nscenario — not guesses", RGBColor(0x00,0xC9,0x6E)),
    ("CI-ready",  "Playwright spec\nautomatically generated", RGBColor(0xBB,0x86,0xFC)),
]
stat_w = 3.0
stat_xs = [0.55, 3.75, 6.95, 10.15]
for (stat_val, stat_label, color), sx in zip(impact_stats, stat_xs):
    txt(slide12, stat_val, sx, 1.82, stat_w, 0.62, size=28, bold=True, color=color, align=PP_ALIGN.CENTER)
    txt(slide12, stat_label, sx, 2.5, stat_w, 0.65, size=12, color=LIGHT_GRAY, align=PP_ALIGN.CENTER)

# Use cases
use_cases = [
    ("Enterprise Web Apps",      "Login flows, checkout journeys, dashboards — all tested without scripting"),
    ("Regulated Industries",     "Immutable Excel audit trails satisfy compliance reporting requirements"),
    ("Agile Teams",              "QA keeps pace with daily deployments without selector maintenance"),
    ("AI-native QA Pipelines",   "Foundation for self-healing CI/CD agents driven by AMD inference"),
]
cy_uc = 4.35
for title_uc, desc_uc in use_cases:
    box(slide12, 0.35, cy_uc, 12.65, 0.7, fill_color=BG_CARD, line_color=MID_GRAY, line_width_pt=0.8)
    txt(slide12, "▸  " + title_uc, 0.55, cy_uc + 0.1, 3.8, 0.48, size=13, bold=True, color=WHITE)
    txt(slide12, desc_uc, 4.5, cy_uc + 0.1, 8.3, 0.48, size=12, color=LIGHT_GRAY)
    cy_uc += 0.79

speaker_notes(slide12,
    "SLIDE 12 — Impact (30 seconds)\n\n"
    "Key message: This is not a toy. It addresses a real enterprise bottleneck.\n\n"
    "Say: 'QA engineers stop being selector mechanics and become quality architects. "
    "The agent handles the brittle automation. Humans focus on edge-case reasoning.'\n\n"
    "Point to 'Regulated Industries': 'The Excel audit trail is not a nice-to-have — "
    "it satisfies compliance requirements out of the box.'\n\n"
    "TIMING: 30 seconds.\n"
    "TIP: End with AI-native QA Pipelines row — it sets up the Roadmap slide naturally.")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 13 — Roadmap
# ─────────────────────────────────────────────────────────────────────────────
slide13 = add_slide()
fill_bg(slide13)
header_block(slide13, "Roadmap", "Where this goes next — with AMD hardware at the centre")

phases = [
    ("Phase 1\n(Next 3 months)",
     ["ROCm integration — run Planner + Reflection on Radeon GPU offline",
      "Multi-tab browser context support for SSO / OAuth flows",
      "Self-healing selectors — use generated spec as CI baseline"],
     AMD_RED),
    ("Phase 2\n(3–6 months)",
     ["Visual diffing — pixel-perfect snapshot regression alongside DOM assertions",
      "Agent memory — recall past failures to inform planning on future runs",
      "Multi-agent collaboration — parallel scenarios across concurrent browser sessions"],
     ACCENT_BLUE),
    ("Phase 3\n(6–12 months)",
     ["Full AMD hardware benchmark — ROCm throughput vs cloud endpoint metrics",
      "Autonomous performance testing — network latency and Core Web Vitals assertions",
      "Plug-in marketplace — custom assertion and reporting plugins per domain"],
     RGBColor(0x00,0xC9,0x6E)),
]

phase_w = 4.0
phase_xs = [0.35, 4.7, 9.05]
phase_y = 1.65
phase_h = 5.5

for (phase_title, items, color), px in zip(phases, phase_xs):
    box(slide13, px, phase_y, phase_w, phase_h, fill_color=BG_CARD, line_color=color, line_width_pt=1.5)
    txt(slide13, phase_title, px + 0.15, phase_y + 0.1, phase_w - 0.25, 0.72, size=14, bold=True, color=color)
    accent_line(slide13, px + 0.15, phase_y + 0.88, phase_w - 0.3, color=color, thickness_pt=1)
    iy = phase_y + 1.05
    for item in items:
        txt(slide13, "→  " + item, px + 0.15, iy, phase_w - 0.25, 1.0, size=11, color=LIGHT_GRAY)
        iy += 1.35

speaker_notes(slide13,
    "SLIDE 13 — Roadmap (25 seconds)\n\n"
    "Keep this brief. Judges know roadmaps are aspirational.\n\n"
    "Say: 'Phase 1 is already designed — the architecture supports it. Phase 1 ROCm work "
    "is the natural evolution of this AMD submission.'\n\n"
    "Don't dwell on Phases 2 and 3 — they are directional signals.\n\n"
    "TIMING: 25 seconds.\n"
    "TIP: Transition line: 'But the most important thing is what we have already delivered...'")

# ─────────────────────────────────────────────────────────────────────────────
# SLIDE 14 — Closing
# ─────────────────────────────────────────────────────────────────────────────
slide14 = add_slide()
fill_bg(slide14)

box(slide14, 0, 0, 13.33, 7.5, fill_color=BG_CARD)
accent_line(slide14, 0, 2.5, 13.33, color=AMD_RED, thickness_pt=4)
accent_line(slide14, 0, 2.54, 13.33, color=AMD_RED_DIM, thickness_pt=2)

pill_badge(slide14, "AMD AI DevMaster Hackathon", 4.5, 0.2, 4.3, 0.45, bg=AMD_RED)

txt(slide14, "Thank You", 0.5, 0.85, 12.4, 1.1,
    size=58, bold=True, color=WHITE, align=PP_ALIGN.CENTER)

txt(slide14,
    "No hand-written scripts.  No brittle selectors.  No silent failures.",
    0.5, 2.0, 12.4, 0.6, size=20, color=LIGHT_GRAY, align=PP_ALIGN.CENTER, italic=True)

# Key claim
box(slide14, 1.5, 2.8, 10.35, 0.9, fill_color=AMD_RED_DIM, line_color=AMD_RED, line_width_pt=1)
txt(slide14,
    "The agent plans, executes, adapts, classifies, scores, reflects, and generates — powered by AMD.",
    1.65, 2.88, 10.05, 0.72, size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)

# Three closing links
link_data = [
    ("📂  Repository",
     "github.com/Prakhar601/\nUser-Journey-QA-agentic-tool", ACCENT_BLUE),
    ("🎬  Demo Video",
     "drive.google.com/file/d/\n1YanieQ-A2P0G1wv03hTpC-qfLOc4NfCc", AMD_RED),
    ("📋  Judge Walkthrough",
     "See JUDGE_WALKTHROUGH.md\nin repository root", RGBColor(0x00,0xC9,0x6E)),
]
link_xs = [0.5, 4.67, 8.85]
for (label, link, color), lx in zip(link_data, link_xs):
    box(slide14, lx, 4.0, 3.85, 2.1, fill_color=BG_DARK, line_color=color, line_width_pt=1.5)
    txt(slide14, label, lx + 0.15, 4.1, 3.55, 0.5, size=14, bold=True, color=color)
    txt(slide14, link, lx + 0.15, 4.65, 3.55, 1.35, size=11.5, color=LIGHT_GRAY)

txt(slide14, "Questions welcome.", 0.5, 6.4, 12.4, 0.62,
    size=20, color=MID_GRAY, align=PP_ALIGN.CENTER, italic=True)

speaker_notes(slide14,
    "SLIDE 14 — Closing (20 seconds)\n\n"
    "Closing statement:\n"
    "'No hand-written test scripts. No brittle selectors. No silent failures. "
    "The agent plans, executes, adapts, classifies, scores, reflects, and generates — all running on AMD. "
    "We are ready for questions.'\n\n"
    "Then stand still. Smile. Don't add anything else.\n\n"
    "TIMING: 20 seconds.\n"
    "TIP: The silence after 'Questions welcome.' is powerful. Let it sit.")

# ─────────────────────────────────────────────────────────────────────────────
# Save
# ─────────────────────────────────────────────────────────────────────────────
out_path = "presentation/AMD_AI_DevMaster_Hackathon_Presentation.pptx"
prs.save(out_path)
print(f"Saved: {out_path}")
print(f"Slides: {len(prs.slides)}")
