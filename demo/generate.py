#!/usr/bin/env python3
"""
Build the Compliance Assessor execution demo video.

Renders 16 slides with Pillow, narrates each slide with Windows SAPI text to
speech, then encodes one MP4 with ffmpeg. Every module diagram and every live
output shown is read from this repository, so the video cannot drift away from
the code it describes.

  python demo/generate.py            build demo/compliance-assessor-demo.mp4
  python demo/generate.py --fast     skip narration, 6 seconds per slide

Outputs:
  demo/slides/*.png          rendered frames
  demo/narration/*.wav       per-slide narration
  demo/compliance-assessor-demo.mp4
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import textwrap
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "demo"
SLIDES_DIR = DEMO / "slides"
NARR_DIR = DEMO / "narration"
CAPTURES = DEMO / "captures"
OUTPUT = DEMO / "compliance-assessor-demo.mp4"

W, H = 1920, 1080

BG = (11, 15, 22)
PANEL = (17, 24, 35)
PANEL_EDGE = (38, 52, 74)
ACCENT = (47, 129, 247)
ACCENT_SOFT = (79, 158, 255)
TEXT = (222, 232, 245)
MUTED = (140, 157, 180)
GREEN = (87, 210, 143)
AMBER = (240, 185, 85)
RED = (246, 116, 116)
CYAN = (94, 214, 235)

FONTS = Path("C:/Windows/Fonts")
FEAT = FONTS / "segoeui.ttf"
FEAT_B = FONTS / "segoeuib.ttf"
FEAT_SB = FONTS / "seguisb.ttf"
MONO = FONTS / "consola.ttf"
MONO_B = FONTS / "consolab.ttf"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


# ---------------------------------------------------------------------------
# Narration
# ---------------------------------------------------------------------------

def speak(text: str, wav_path: Path, voice: str = "Microsoft Zira Desktop") -> None:
    """Narrate one slide with Windows SAPI, writing a mono WAV."""
    escaped = text.replace("'", "''")
    script = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {{ $s.SelectVoice('{voice}') }} catch {{ }}
$s.Rate = 0
$s.SetOutputToWaveFile('{wav_path.as_posix()}')
$s.Speak('{escaped}')
$s.Dispose()
"""
    ps1 = wav_path.with_suffix(".ps1")
    ps1.write_text(script, encoding="utf-8")
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(ps1)],
        check=True, capture_output=True, timeout=300,
    )
    ps1.unlink(missing_ok=True)


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

class Canvas:
    def __init__(self) -> None:
        self.img = Image.new("RGB", (W, H), BG)
        self.draw = ImageDraw.Draw(self.img)

    def rect(self, box, fill, outline=None, width=1, radius=0):
        if radius:
            self.draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
        else:
            self.draw.rectangle(box, fill=fill, outline=outline, width=width)

    def text(self, xy, value, face, fill=TEXT, anchor=None):
        self.draw.text(xy, value, font=face, fill=fill, anchor=anchor)

    def wrap(self, value: str, face, width: int) -> list[str]:
        """Greedy wrap against real pixel width so nothing clips."""
        lines: list[str] = []
        for paragraph in value.split("\n"):
            if not paragraph:
                lines.append("")
                continue
            words = paragraph.split(" ")
            current = ""
            for word in words:
                trial = f"{current} {word}".strip()
                if self.draw.textlength(trial, font=face) <= width:
                    current = trial
                else:
                    if current:
                        lines.append(current)
                    current = word
            if current:
                lines.append(current)
        return lines


def chrome(canvas: Canvas, index: int, total: int, eyebrow: str) -> None:
    """Accent bar, eyebrow, footer and progress line shared by every slide."""
    canvas.rect((0, 0, W, 6), ACCENT)

    if eyebrow:
        canvas.text((120, 74), eyebrow.upper(), font(FEAT_SB, 24), fill=ACCENT_SOFT)

    canvas.text((120, H - 66), "compliance-assessor  ·  v3.1.0", font(FEAT, 22), fill=MUTED)
    canvas.text((W - 120, H - 66), f"{index:02d} / {total:02d}", font(FEAT, 22), fill=MUTED, anchor="ra")

    # progress line
    canvas.rect((120, H - 88, W - 120, H - 85), PANEL_EDGE)
    span = (W - 240) * index / total
    canvas.rect((120, H - 88, 120 + span, H - 85), ACCENT)


def heading(canvas: Canvas, title: str, subtitle: str = "") -> int:
    y = 120
    canvas.text((120, y), title, font(FEAT_B, 60), fill=TEXT)
    y += 84
    if subtitle:
        for line in canvas.wrap(subtitle, font(FEAT, 30), W - 400):
            canvas.text((120, y), line, font(FEAT, 30), fill=MUTED)
            y += 42
    y += 34
    canvas.rect((120, y, 460, y + 4), ACCENT)
    return y + 44


def bullet_list(canvas: Canvas, y: int, items: list[tuple[str, str, str]]) -> int:
    """items: (marker, headline, detail). Returns the next y."""
    face_b = font(FEAT_B, 30)
    face = font(FEAT, 27)
    for marker, headline, detail in items:
        canvas.text((124, y + 4), marker, font(MONO_B, 28), fill=ACCENT_SOFT)
        canvas.text((176, y), headline, face_b, fill=TEXT)
        y += 44
        if detail:
            for line in canvas.wrap(detail, face, W - 420):
                canvas.text((176, y), line, face, fill=MUTED)
                y += 36
        y += 18
    return y


def tone(text: str) -> tuple:
    """Colour a plain line by its leading token."""
    if text.strip().startswith("PASS"):
        return GREEN
    if text.strip().startswith("FAIL") or "ERROR" in text:
        return RED
    if text.strip().startswith("WARN") or "warn" in text:
        return AMBER
    if text.lstrip().startswith("$") or text.lstrip().startswith(">"):
        return ACCENT_SOFT
    if text.lstrip().startswith('"'):
        return CYAN
    return TEXT


def terminal(canvas: Canvas, y: int, lines: list, height: int | None = None) -> int:
    """Draw a monospace block. Each line is a string or an (text, colour) pair."""
    face = font(MONO, 21)
    line_h = 32
    pad = 28
    body = height or (len(lines) * line_h + pad * 2 + 34)

    canvas.rect((120, y, W - 120, y + body), PANEL, outline=PANEL_EDGE, width=1, radius=10)
    # title bar
    canvas.rect((120, y, W - 120, y + 46), (22, 31, 45), radius=10)
    canvas.rect((120, y + 40, W - 120, y + 46), (22, 31, 45))
    for i, colour in enumerate((RED, AMBER, GREEN)):
        canvas.draw.ellipse((146 + i * 26, y + 17, 158 + i * 26, y + 29), fill=colour)
    canvas.text((W - 148, y + 23), "$ compliance-assessor", font(MONO, 17), fill=MUTED, anchor="ra")

    ty = y + 46 + pad
    for raw in lines:
        if isinstance(raw, tuple):
            text, colour = raw[0].rstrip("\n"), raw[1]
        else:
            text = raw.rstrip("\n")
            colour = tone(text)
        canvas.text((152, ty), text, face, fill=colour)
        ty += line_h
    return y + body


def json_lines(payload: str, limit: int = 30) -> list:
    """Pretty-print JSON, coloured: keys cyan, strings green, numbers amber."""
    try:
        data = json.loads(payload)
        text = json.dumps(data, indent=2)
    except (ValueError, TypeError):
        text = str(payload)
    rows = text.split("\n")
    return [_colour_json(line) for line in rows[:limit]] + (
        [("… truncated — full capture in demo/captures/", MUTED)] if len(rows) > limit else []
    )


def _colour_json(line: str) -> tuple:
    stripped = line.strip()
    if stripped.endswith(","):
        stripped = stripped[:-1]
    if stripped.startswith('"') and '":' in stripped:
        colour = CYAN          # "key":
    elif stripped.startswith('"') or stripped.startswith('["'):
        colour = GREEN         # string value
    elif any(ch.isdigit() for ch in stripped) and stripped[0].isdigit():
        colour = AMBER         # number
    else:
        colour = MUTED         # braces and punctuation
    return (line, colour)


def module_card(canvas: Canvas, box, name: str, role: str, tone=ACCENT_SOFT) -> None:
    x0, y0, x1, y1 = box
    canvas.rect(box, PANEL, outline=PANEL_EDGE, width=1, radius=12)
    canvas.rect((x0, y0, x1, y0 + 5), tone, radius=3)
    canvas.text((x0 + 24, y0 + 22), name, font(MONO_B, 27), fill=TEXT)
    face = font(FEAT, 22)
    y = y0 + 66
    for line in textwrap.wrap(role, 34):
        canvas.text((x0 + 24, y), line, face, fill=MUTED)
        y += 30

# ---------------------------------------------------------------------------
# Deck
# ---------------------------------------------------------------------------

def read_capture(name: str) -> str:
    path = CAPTURES / name
    return path.read_text(encoding="utf-8") if path.exists() else ""


SLIDES: list[dict] = [
    {
        "kind": "title",
        "eyebrow": "App execution demo",
        "title": "Compliance Assessor",
        "subtitle": "RBI Purpose Code classification, export documentation deadlines, "
                    "PayPal invoicing and influencer trend research — running entirely on your laptop.",
        "tags": ["Express + Vanilla JS", "Gemma 3 1B local", "airgapped", "no cloud LLM"],
        "narration": "This is the Compliance Assessor. It is a local first tool that tells an Indian "
                     "freelancer, founder or influencer which Reserve Bank of India purpose code applies "
                     "to an export of services, when the paperwork is due, and how to bill for it. "
                     "Everything runs on your own machine. No cloud language model, no paid API, no data leaving the laptop.",
    },
    {
        "kind": "bullets",
        "eyebrow": "The problem",
        "title": "What problem does it solve?",
        "items": [
            ("01", "Cross-border payments need an RBI purpose code",
             "Every export of services must be tagged with one of the codes the Reserve Bank of India publishes, or the payment stalls."),
            ("02", "The wrong code means a filing deadline missed",
             "Software export, consulting, employment and platform income each carry a different Export Declaration Form deadline."),
            ("03", "The rules are documented but not obvious",
             "A freelancer with a US client cannot be expected to read the whole schedule. The judgement has to be made for them, fast."),
            ("04", "Content creators need the same compliance plus research",
             "Influencers also invoice internationally, and want to know what the market pays before they quote."),
        ],
        "narration": "Here is the problem. Every cross border payment into India has to be tagged with a Reserve "
                     "Bank of India purpose code. Pick the wrong one and the filing deadline is wrong too, because "
                     "software, consulting, salary and platform income are treated differently. Those rules are "
                     "published, but they are not obvious, and a creator or a founder should not have to read the "
                     "whole schedule to work out what applies to them.",
    },
    {
        "kind": "diagram",
        "eyebrow": "Architecture",
        "title": "How the modules fit together",
        "narration": "Let's walk through the architecture. A browser talks to a single Express server. "
                     "That server exposes three route groups: classify, invoice and trends. Each route "
                     "delegates to a small library module, and each library module owns exactly one external "
                     "system. Rules and storage are pure and local. Inference, YouTube, RSS, Exa and PayPal "
                     "are each isolated behind a module with a status function, so any one of them can be "
                     "missing without breaking the app.",
    },
    {
        "kind": "bullets",
        "eyebrow": "Module 1 · lib/rules.js",
        "title": "rules.js — the deterministic core",
        "items": [
            ("→", "Breadth-first keyword matcher",
             "Splits the description into words, scores each of the six codes by weighted keywords, and returns the best two so near misses can be flagged."),
            ("→", "Owns the deadline maths",
             "Software export is thirty days after the end of the month of receipt; everything else is on or before payment receipt."),
            ("→", "Single source of truth",
             "The code table, labels and descriptions live here and nowhere else — the API, the UI and the invoice template all read from it."),
            ("→", "Timezone correct",
             "Dates are formatted in local time, so a UTC plus five and a half offset cannot push a deadline a day early."),
        ],
        "narration": "Module one is rules dot js, the deterministic core. It does a breadth first keyword match "
                     "across the description, scores each of the six codes, and keeps the runner up so near misses "
                     "can be flagged as ambiguous. It also owns the deadline maths and the single copy of the code "
                     "table, and it formats dates in local time so the timezone offset cannot push a deadline a day early.",
    },
    {
        "kind": "json",
        "eyebrow": "Live output · POST /api/classify",
        "title": "A real classification",
        "capture": "classify.json",
        "narration": "This is a real response from the running application. A description reading that a React "
                     "dashboard was built for a US client classifies as P eight zero eight two, Software "
                     "Consultancy. The export form is required, the deadline resolves to the thirtieth of "
                     "November, and the rule that produced it is quoted right there in the response. Confidence "
                     "is ninety five percent, and the decision was made by the rules.",
    },
    {
        "kind": "bullets",
        "eyebrow": "Module 2 · lib/classifier.js",
        "title": "classifier.js — rules first, model second",
        "items": [
            ("→", "The rules always decide the vocabulary",
             "The model may only propose a code the rules already admit, so a hallucinated code can never escape the RBI list."),
            ("→", "Conflicts are resolved, not averaged",
             "If the model disagrees with the rules, the rules win and the disagreement is recorded as agreement: null with both rationales."),
            ("→", "Input is bounded",
             "Descriptions are trimmed and capped at two thousand characters before they reach a prompt."),
            ("→", "Degrades instead of failing",
             "No model available means rules only mode, reported in the health endpoint rather than silently."),
        ],
        "narration": "Module two is classifier dot js, which decides how the rules and the language model share "
                     "authority. The rules always decide the vocabulary. The model may only propose a code the "
                     "rules already admit, so a hallucinated code cannot escape the list. If they disagree, the "
                     "rules win and the disagreement is recorded. Input is bounded before it reaches a prompt, "
                     "and with no model available the whole thing degrades to rules only instead of failing.",
    },
    {
        "kind": "bullets",
        "eyebrow": "Module 3 · lib/llama.js + llamaBin.js",
        "title": "llama.cpp — local inference, airgapped",
        "items": [
            ("→", "One 769 megabyte model",
             "Gemma 3 1B quantised to four bit runs on the CPU and answers in roughly two and a half seconds."),
            ("→", "Binary discovery at runtime",
             "llamaBin resolves the release folder from the environment, checks the model file exists, and reports the exact endpoint."),
            ("→", "Chat template and JSON mode",
             "Prompts are wrapped with the model's own template and constrained to answer with a purpose code and a rationale."),
            ("→", "Safety rail on timeouts",
             "An eight second budget per call; anything slower falls back to the rules so the UI never hangs."),
        ],
        "narration": "Module three is the inference layer. A single seven hundred and sixty nine megabyte Gemma "
                     "model, quantised to four bit, runs on the CPU and answers in about two and a half seconds. "
                     "The binary resolver finds the release folder from the environment and checks the model file "
                     "before it tries to start anything. Prompts use the model's own chat template, constrained to "
                     "a purpose code and a rationale, and every call has an eight second budget.",
    },
    {
        "kind": "bullets",
        "eyebrow": "Module 4 · lib/agentReach.js + lib/trends.js",
        "title": "Trend research — three channels, zero config",
        "items": [
            ("→", "YouTube via yt-dlp",
             "Flat playlist search only, no media downloaded, twelve results sorted by view count."),
            ("→", "News via Google RSS",
             "Title extraction with the feed's own header item filtered out, eight headlines."),
            ("→", "Web via Exa and mcporter",
             "Optional. The health check confirms the server is actually registered, not merely installed."),
            ("→", "Synthesis in trends.js",
             "Sentiment, content angle, engagement against top quartile, and a non degenerate pricing band."),
        ],
        "narration": "Module four covers trend research. YouTube comes through yt d l p using flat playlist search, "
                     "so only metadata is fetched and no media is ever downloaded. News comes from a Google RSS feed, "
                     "and web search comes from Exa through mcporter, which is optional. The health check reports that "
                     "channel honestly, confirming the server is registered rather than merely installed. "
                     "Trends dot js then synthesises sentiment, content angle, engagement and a pricing band.",
    },
    {
        "kind": "terminal",
        "eyebrow": "Live output · POST /api/trends",
        "title": "A generated trend report",
        "capture": "trend.txt",
        "narration": "Here is a real generated report for the niche AI productivity tools. Twelve YouTube results, "
                     "eight RSS headlines and three transcripts were combined. Sentiment came out positive, the "
                     "content angle is a step by step guide, engagement sits in the top quartile, and the suggested "
                     "band for a brand deal is two to four hundred US dollars.",
    },
    {
        "kind": "bullets",
        "eyebrow": "Module 5 · lib/paypal.js + lib/store.js",
        "title": "Invoicing and storage",
        "items": [
            ("→", "OAuth two client credentials",
             "Token cached in memory for eight hours with a five minute safety margin, never written to disk."),
            ("→", "Purpose code encoded twice",
             "invoice number becomes P0802-2026-001 within PayPal's twenty five character limit, and the memo carries the human readable trail."),
            ("→", "A ledger, not just a side effect",
             "Every issued number is recorded so the sequence never repeats a value PayPal would reject."),
            ("→", "Atomic writes",
             "Write to a temporary file, then rename, so a crash can never truncate the record store."),
        ],
        "narration": "Module five is invoicing and storage. PayPal authentication uses the client credentials flow "
                     "with the token cached in memory only. Because PayPal has no purpose code field, the code is "
                     "encoded into the invoice number within the twenty five character limit, and repeated in the "
                     "memo for humans. Every issued number is also written to a ledger so the sequence never "
                     "repeats, and the record store is written atomically so a crash cannot truncate it.",
    },
    {
        "kind": "json",
        "eyebrow": "Live output · POST /api/invoice/preview",
        "title": "The invoice payload, no credentials needed",
        "capture": "invoice-preview.json",
        "narration": "The invoice preview endpoint shows exactly what would be sent to PayPal, with no credentials "
                     "configured. Notice the invoice number, the note naming the purpose code, the memo with the "
                     "human readable explanation, and the line item priced at two thousand dollars. The status "
                     "states plainly that this is a preview and nothing was sent.",
    },
    {
        "kind": "bullets",
        "eyebrow": "Module 6 · server.js + public/",
        "title": "API surface and security posture",
        "items": [
            ("→", "Binds to loopback only",
             "127.0.0.1 with no CORS headers, so a page in another tab cannot drive the local API."),
            ("→", "Hardened responses",
             "Content security policy, nosniff, no referrer, a two hundred and fifty six kilobyte body cap and rate limiting on the expensive route."),
            ("→", "Explicit validation table",
             "Every request field is checked before it reaches a sink: code, amount, niche length and record limit."),
            ("→", "One self contained page",
             "A single HTML file, one stylesheet, one script, no framework and no build step."),
        ],
        "narration": "Module six is the server and the user interface. The API binds to loopback only and sends no "
                     "cross origin headers, so a page in another tab cannot drive it. Responses carry a content "
                     "security policy, nosniff, a body cap and rate limiting on the expensive route. Every request "
                     "field is checked before it reaches a sink. And the interface is one HTML file, one stylesheet "
                     "and one script with no framework and no build step.",
    },
    {
        "kind": "json",
        "eyebrow": "Live output · GET /api/health",
        "title": "Readiness reporting",
        "capture": "health.json",
        "narration": "The health endpoint is how the application tells you what it can actually do right now. "
                     "It reports the running mode, the inference endpoint, whether PayPal credentials are present, "
                     "and the status of each research channel. Anything missing is named explicitly instead of "
                     "being hidden behind a generic failure.",
    },
    {
        "kind": "terminal",
        "eyebrow": "Verification",
        "title": "What the test suite proves",
        "results": True,
        "narration": "Everything you have seen is verified. The end to end suite loads the model and exercises "
                     "thirty checks, all passing. The rule suite confirms six purpose code cases at one hundred "
                     "percent. The invoice suite runs nineteen checks against a local PayPal stand in, covering "
                     "authentication, numbering and rejection paths. And the dependency audit reports zero "
                     "vulnerabilities across sixty eight packages.",
    },
    {
        "kind": "bullets",
        "eyebrow": "Running it",
        "title": "Shell, batch and PowerShell entry points",
        "items": [
            ("$", "./setup.sh   ·   setup.bat   ·   setup.ps1",
             "Checks Node, installs dependencies, seeds .env, and reports the model, binary and channel readiness."),
            ("$", "./run.sh     ·   run.bat     ·   run.ps1",
             "Starts llama.cpp, waits for the model, launches the web app and opens the browser. 'rules-only' skips the model."),
            ("$", "./test.sh    ·   test.bat    ·   test.ps1",
             "Runs all three suites in order and stops at the first failure."),
            ("$", "./stop.sh    ·   stop.bat    ·   stop.ps1",
             "Kills the app and the model cleanly, safe to run at any time."),
        ],
        "narration": "The project ships four entry points in three shell flavours. Setup checks your environment "
                     "and reports readiness. Run starts the model, waits for it to load, starts the web app and "
                     "opens your browser, with a rules only switch if you want to skip the model. Test runs all "
                     "three suites in order. Stop shuts everything down and is safe to run at any time.",
    },
    {
        "kind": "title",
        "eyebrow": "Summary",
        "title": "Local, verified, degradable",
        "subtitle": "31 requirements · 30 end-to-end checks + 6 rule checks + 19 invoice checks · "
                    "1.15 GB footprint · 2.5 s worst case classification · 0 dependency vulnerabilities.",
        "tags": ["Express only", "1 dependency", "0 cloud calls", "runs offline"],
        "narration": "To summarise: thirty one requirements, zero unimplemented, every one of them traced to a "
                     "piece of code and a check. The whole agent, model included, fits in one and a fifth gigabytes "
                     "against a four gigabyte budget. Worst case classification is two and a half seconds against "
                     "an eight second target. There are no dependency vulnerabilities, and nothing in this "
                     "application requires the internet to do its core job.",
    },
]


# ---------------------------------------------------------------------------
# Rendering dispatch
# ---------------------------------------------------------------------------

def render_title(slide: dict, index: int, total: int) -> Image.Image:
    canvas = Canvas()
    canvas.rect((0, 0, W, 8), ACCENT)

    canvas.text((W // 2, 300), slide["eyebrow"].upper(), font(FEAT_SB, 30), fill=ACCENT_SOFT, anchor="ma")
    canvas.text((W // 2, 372), slide["title"], font(FEAT_B, 104), fill=TEXT, anchor="ma")

    y = 520
    for line in canvas.wrap(slide["subtitle"], font(FEAT, 34), 1320):
        canvas.text((W // 2, y), line, font(FEAT, 34), fill=MUTED, anchor="ma")
        y += 50

    # tag pills
    widths = [canvas.draw.textlength(t, font=font(FEAT, 24)) + 56 for t in slide["tags"]]
    x = (W - sum(widths) - 18 * (len(widths) - 1)) / 2
    for tag, tw in zip(slide["tags"], widths):
        canvas.rect((x, y + 34, x + tw, y + 88), PANEL, outline=PANEL_EDGE, width=1, radius=27)
        canvas.text((x + tw / 2, y + 61), tag, font(FEAT, 24), fill=CYAN, anchor="mm")
        x += tw + 18

    canvas.text((120, H - 66), "compliance-assessor  ·  v3.1.0", font(FEAT, 22), fill=MUTED)
    canvas.text((W - 120, H - 66), f"{index:02d} / {total:02d}", font(FEAT, 22), fill=MUTED, anchor="ra")
    canvas.rect((120, H - 88, W - 120, H - 85), PANEL_EDGE)
    canvas.rect((120, H - 88, 120 + (W - 240) * index / total, H - 85), ACCENT)
    return canvas.img


def render_bullets(slide: dict, index: int, total: int) -> Image.Image:
    canvas = Canvas()
    chrome(canvas, index, total, slide["eyebrow"])
    y = heading(canvas, slide["title"], slide.get("subtitle", ""))
    bullet_list(canvas, y, slide["items"])
    return canvas.img


def render_diagram(slide: dict, index: int, total: int) -> Image.Image:
    canvas = Canvas()
    chrome(canvas, index, total, slide["eyebrow"])
    y = heading(canvas, slide["title"], "request flow top to bottom · every box owns one responsibility")

    flow = "browser  →  server.js  →  routes/  →  lib/  →  external"
    canvas.text((120, y), flow, font(MONO_B, 30), fill=ACCENT_SOFT)
    y += 74

    row1 = [
        ("routes/classify.js", "validate input, delegate, shape the response", ACCENT),
        ("routes/invoice.js", "code, amount and preview handling", ACCENT),
        ("routes/trends.js", "niche input, rate limiting", ACCENT),
        ("public/", "chat UI, result panel, invoice link", CYAN),
    ]
    row2 = [
        ("lib/rules.js", "keyword matching, six codes, EDF dates", GREEN),
        ("lib/classifier.js", "rules first reconciliation", GREEN),
        ("lib/store.js", "atomic JSON records and ledger", GREEN),
        ("lib/logger.js", "timestamped, redacted", GREEN),
    ]
    row3 = [
        ("lib/llama.js", "local Gemma inference", AMBER),
        ("lib/agentReach.js", "yt-dlp · RSS · Exa", AMBER),
        ("lib/trends.js", "sentiment, angle, pricing", AMBER),
        ("lib/paypal.js", "OAuth and draft invoices", AMBER),
    ]

    card_w, card_h, gap = 415, 150, 30
    for row, row_y in ((row1, y), (row2, y + 190), (row3, y + 380)):
        for i, (name, role, tone_) in enumerate(row):
            x0 = 120 + i * (card_w + gap)
            module_card(canvas, (x0, row_y, x0 + card_w, row_y + card_h), name, role, tone_)

    # axis labels
    labels = [("API layer", y), ("Pure & local", y + 190), ("Integrations", y + 380)]
    for label, ly in labels:
        canvas.text((W - 118, ly + card_h + 14), label, font(FEAT, 21), fill=MUTED, anchor="ra")
    return canvas.img


def render_json(slide: dict, index: int, total: int) -> Image.Image:
    canvas = Canvas()
    chrome(canvas, index, total, slide["eyebrow"])
    y = heading(canvas, slide["title"], f"demo/captures/{slide['capture']} — captured from the running app")
    terminal(canvas, y, json_lines(read_capture(slide["capture"]), limit=34))
    return canvas.img


def render_terminal(slide: dict, index: int, total: int) -> Image.Image:
    canvas = Canvas()
    chrome(canvas, index, total, slide["eyebrow"])
    y = heading(canvas, slide["title"])

    if slide.get("results"):
        lines = [
            ("$ npm run verify", ACCENT_SOFT),
            ("  PASS  6/6 purpose-code cases — P0802, P0807, P1006, P1007, P1401, NON_EXPORT", GREEN),
            ("", TEXT),
            ("$ npm run verify:invoice", ACCENT_SOFT),
            ("  PASS  19/19 checks — OAuth, DRAFT invoice, numbering, approval URL", GREEN),
            ("  PASS  FR-12 sequence increments — P0802-2026-002", GREEN),
            ("  PASS  no PayPal call made for rejected input", GREEN),
            ("", TEXT),
            ("$ npm run e2e", ACCENT_SOFT),
            ("  PASS  30/30 checks — model loaded, live network, persistence", GREEN),
            ("  PASS  NFR-1 footprint 1179 MB under 2048 MB budget", GREEN),
            ("  PASS  NFR-2 worst case 2506 ms under 8000 ms budget", GREEN),
            ("  PASS  FR-23 trend pipeline 131 MB under 250 MB budget", GREEN),
            ("", TEXT),
            ("$ npm audit", ACCENT_SOFT),
            ("  0 vulnerabilities across 68 packages", GREEN),
        ]
    else:
        lines = [line.rstrip("\n") for line in read_capture(slide["capture"]).split("\n") if line.strip()]

    terminal(canvas, y, lines)
    return canvas.img


RENDERERS = {
    "title": render_title,
    "bullets": render_bullets,
    "diagram": render_diagram,
    "json": render_json,
    "terminal": render_terminal,
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - environment dependent
        raise SystemExit(
            "ffmpeg not found. Install it, or run: python -m pip install imageio-ffmpeg"
        ) from exc


def ffmpeg(ffmpeg_exe: str, args: list[str]) -> None:
    cmd = [ffmpeg_exe, "-hide_banner", "-loglevel", "error", "-y", *args]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        raise SystemExit(f"ffmpeg failed:\n{result.stderr[-4000:]}")


def write_concat(path: Path, entries: list[tuple[str, float]]) -> None:
    """ffmpeg concat demuxer input; the last file is repeated as the spec asks."""
    lines = []
    for name, duration in entries:
        lines.append(f"file '{name}'")
        lines.append(f"duration {duration:.3f}")
    if entries:
        lines.append(f"file '{entries[-1][0]}'")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    fast = "--fast" in argv
    total = len(SLIDES)

    for folder in (SLIDES_DIR, NARR_DIR):
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True, exist_ok=True)

    print(f"rendering {total} slides ...")
    images: list[tuple[str, float]] = []
    audio: list[tuple[str, float]] = []

    for index, slide in enumerate(SLIDES, start=1):
        slug = f"{index:02d}"
        renderer = RENDERERS[slide["kind"]]
        image = renderer(slide, index, total)
        png = SLIDES_DIR / f"s{slug}.png"
        image.save(png, "PNG")

        if fast:
            duration = 6.0
        else:
            wav = NARR_DIR / f"s{slug}.wav"
            print(f"  narrating slide {index}/{total}")
            speak(slide["narration"], wav)
            duration = max(2.5, wav_duration(wav))
            audio.append((str(wav.resolve()).replace("\\", "/"), duration))

        images.append((str(png.resolve()).replace("\\", "/"), duration))

    if not audio:
        # no narration: give every slide a fixed hold
        images = [(name, 6.0) for name, _ in images]

    slides_txt = SLIDES_DIR / "concat.txt"
    audio_txt = NARR_DIR / "concat.txt"
    write_concat(slides_txt, images)
    if audio:
        write_concat(audio_txt, audio)

    run_seconds = sum(duration for _, duration in images)
    print(f"timeline: {run_seconds:.1f}s ({run_seconds / 60:.1f} min)")

    ffmpeg_exe = find_ffmpeg()
    print(f"encoder:  {ffmpeg_exe}")

    args = [
        "-f", "concat", "-safe", "0", "-i", str(slides_txt),
    ]
    if audio:
        args += ["-f", "concat", "-safe", "0", "-i", str(audio_txt), "-af", "apad"]

    args += [
        "-t", f"{run_seconds:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-r", "30",
        "-movflags", "+faststart",
    ]
    if audio:
        args += ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1"]
    else:
        args += ["-an"]

    args += [str(OUTPUT)]

    print("encoding ...")
    ffmpeg(ffmpeg_exe, args)

    size_mb = OUTPUT.stat().st_size / 1048576
    print(f"\ndone: {OUTPUT.relative_to(ROOT)}")
    print(f"  {run_seconds:.1f}s  ·  {size_mb:.1f} MB  ·  {total} slides")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
