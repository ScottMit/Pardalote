#!/usr/bin/env python3
"""Generate the Pardalote examples gallery + detail pages from example READMEs."""
import re, html
from pathlib import Path
from markdown_it import MarkdownIt
from mdit_py_plugins.anchors import anchors_plugin
from pygments import highlight as _pyg
from pygments.lexers import get_lexer_by_name
from pygments.formatters import HtmlFormatter

def _hl(code, lang, attrs):
    if not lang:
        return None
    try:
        lexer = get_lexer_by_name(lang, stripnl=False)
    except Exception:
        return None
    return _pyg(code, lexer, HtmlFormatter(nowrap=True))

_md = MarkdownIt('commonmark', {'highlight': _hl}).enable('table').use(anchors_plugin, max_level=3)

import html as _html

def _fence(self, tokens, idx, options, env):
    tok = tokens[idx]
    info = tok.info.strip()
    lang, _, caption = info.partition(" ")
    caption = caption.strip()
    body = _hl(tok.content, lang or None, None)
    if body is None:
        body = _html.escape(tok.content)
    code = "<pre><code>" + body + "</code></pre>"
    if caption:
        return ('<div class="code-ex"><div class="bar">' + _html.escape(caption)
                + "</div>" + code + "</div>\n")
    return code + "\n"

_md.add_render_rule("fence", _fence)


REPO = Path(__file__).parent.parent
SRC = REPO / "examples"
OUT = REPO / "docs" / "examples"
GH = "https://github.com/ScottMit/Pardalote"
OUT.mkdir(parents=True, exist_ok=True)

# slug -> (title, blurb, emoji, gradient, [tags], level)
EXAMPLES = {
    "control-panel": ("Control panel",
        "A dashboard for every pin on your board, laid out over a photo of it. Test circuits without writing a line of code.",
        "🎛️", "linear-gradient(135deg,#232129,#4a4652)", ["Multi-user", "Tool"], "Beginner"),
    "basic-LED-example": ("Basic LED",
        "Two buttons on a web page turn the board's LED on and off. The simplest possible start — no frameworks at all.",
        "💡", "linear-gradient(135deg,#fdf0d4,#f2b705)", ["Basics"], "Beginner"),
    "basic-p5js-example": ("Sensor + p5.js",
        "Turn a knob, and a circle on screen grows and shrinks with it. Your first taste of live data flowing into a p5.js sketch.",
        "◉", "linear-gradient(135deg,#e3eef5,#8ec6e6)", ["Basics", "p5.js"], "Beginner"),
    "shared-control-example": ("Shared light switch",
        "One light, four switches: two physical buttons and two on screen. Press any of them — everything stays in sync.",
        "🔦", "linear-gradient(135deg,#fbe3dc,#e08b6d)", ["Multi-user"], "Beginner"),
    "shared-input-example": ("Shared potentiometer",
        "The Arduino announces its own analog input and the browser listens — a turn of the knob shows up live on screen with no JS setup.",
        "🎚️", "linear-gradient(135deg,#efe7d8,#d9bf8c)", ["Multi-user", "Basics"], "Beginner"),
    "servo-example": ("Servo control",
        "Move a servo with your mouse or keyboard while its arm angle is drawn live on screen.",
        "🦾", "linear-gradient(135deg,#e8e2d4,#c9bea4)", ["Motion", "p5.js"], "Intermediate"),
    "stepper-example": ("Stepper motor",
        "Precise position moves, continuous rotation, and a live position readout — the browser as a motor controller.",
        "⚙️", "linear-gradient(135deg,#e5e0f0,#b0a3d4)", ["Motion"], "Intermediate"),
    "busservo-example": ("Bus servos",
        "Drive smart serial servos — the kind used in robot arms. Pose a joint by hand, read it back, and replay it.",
        "🤖", "linear-gradient(135deg,#dcefe0,#8fc79a)", ["Motion"], "Advanced"),
    "coordinated-motion-example": ("Coordinated motion",
        "Two different motors — mix a servo, stepper, or bus servo — sweep in perfect unison using a group.",
        "🎛️", "linear-gradient(135deg,#fdf0d4,#f5c95c)", ["Motion"], "Advanced"),
    "neopixel-example": ("NeoPixel colours",
        "An on-screen colour picker drives an LED strip in real time. Sweep the mouse for colour; hover for rainbow.",
        "🌈", "linear-gradient(135deg,#f3dce8,#d989b8)", ["Light", "p5.js"], "Intermediate"),
    "ultrasonic-sensor-example": ("Ultrasonic distance",
        "A distance sensor paints a colour bar that responds as you move your hand closer and further away.",
        "📏", "linear-gradient(135deg,#dceef3,#7db8c9)", ["Sensors", "p5.js"], "Intermediate"),
    "mpu-example": ("Motion sensor (IMU)",
        "Tilt the sensor and watch a 3D model rotate with it, live, in all three axes.",
        "🧭", "linear-gradient(135deg,#e2e6f0,#94a3cc)", ["Sensors", "p5.js"], "Advanced"),
    "camera-example": ("Camera stream",
        "Live video from an ESP32 camera lands on a p5.js canvas, pixels and all — ready for creative coding.",
        "📷", "linear-gradient(135deg,#e8ddd2,#c4a284)", ["Vision", "p5.js"], "Advanced"),
}

LEVEL_CLASS = {"Beginner": "lvl-start", "Intermediate": "lvl-mid", "Advanced": "lvl-adv"}
ANCHOR_MAP = {"groups": "../reference/groups.html",
              "pardalote-library": "../reference/installation.html"}

NAV = """<nav class="site-nav speckled">
  <a class="logo" href="../index.html">
    <img src="../assets/logo.svg" width="30" height="30" alt="">
    Pardalote
  </a>
  <div class="links">
    <a data-nav="home" href="../index.html">Home</a>
    <a data-nav="download" href="../download.html">Download</a>
    <a data-nav="examples" href="index.html">Examples</a>
    <a data-nav="reference" href="../reference/index.html">Reference</a>
    <a href="{gh}">GitHub</a>
  </div>
</nav>""".format(gh=GH)

FOOTER = """<footer class="site-footer speckled">
  <div class="wrap">
    <span>Pardalote — created by Scott Mitchell for design education and creative technology.</span>
    <span><a href="../reference/index.html">Reference</a> · <a href="{gh}">GitHub</a> · GPL-3.0</span>
  </div>
</footer>""".format(gh=GH)


def rewrite_links(md_text: str, slug: str) -> str:
    def repl(m):
        target = m.group(2)
        if target.startswith("../../README.md"):
            anchor = target.split("#")[1] if "#" in target else ""
            return "[{}]({})".format(m.group(1), ANCHOR_MAP.get(anchor, "../reference/index.html"))
        if target.startswith("../"):  # sibling example folder
            sib = target.strip("/").split("/")[-1]
            if sib in EXAMPLES:
                return "[{}]({}.html)".format(m.group(1), sib)
        if not target.startswith(("http", "#", "mailto:")):  # local file → GitHub
            return "[{}]({}/blob/main/examples/{}/{})".format(m.group(1), GH, slug, target)
        return m.group(0)
    return re.sub(r"\[([^\]]*)\]\(([^)]+)\)", repl, md_text)


def tags_html(tags, level):
    out = ['<span class="tag {}">{}</span>'.format(LEVEL_CLASS[level], level)]
    out += ['<span class="tag">{}</span>'.format(t) for t in tags]
    return "".join(out)



IDE = "pardalote-arduino/library/Pardalote/examples"
# slug -> path (relative to repo root) of the matching Arduino sketch
ARDUINO = {
    "control-panel":              IDE + "/basic-LED/basic-LED.ino",
    "basic-LED-example":          IDE + "/basic-LED/basic-LED.ino",
    "basic-p5js-example":         IDE + "/basic-LED/basic-LED.ino",
    "shared-control-example":     "examples/shared-control-example/light-switch.ino",
    "shared-input-example":       "examples/shared-input-example/potentiometer.ino",
    "servo-example":              IDE + "/servo/servo.ino",
    "stepper-example":            IDE + "/stepper/stepper.ino",
    "busservo-example":           IDE + "/busservo/busservo.ino",
    "coordinated-motion-example": None,   # no dedicated sketch — synthesized below
    "neopixel-example":           IDE + "/neopixel/neopixel.ino",
    "ultrasonic-sensor-example":  IDE + "/ultrasonic/ultrasonic.ino",
    "mpu-example":                IDE + "/mpu/mpu.ino",
    "camera-example":             IDE + "/camera/camera.ino",
}

COORDINATED_INO = """// Include the extension(s) for the motor types you use —
// simplest is all three, so you can switch type without re-flashing.
#include <Pardalote.h>
#include <PardaloteServo.h>
#include <PardaloteBusServo.h>
#include <PardaloteStepper.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
"""


def strip_header_comments(code):
    """Drop leading comment lines (// and /* ... */) and blank lines,
    up to the first line of real code."""
    lines = code.splitlines()
    i, in_block = 0, False
    while i < len(lines):
        line = lines[i].strip()
        if in_block:
            i += 1
            if "*/" in line: in_block = False
            continue
        if line == "" or line.startswith("//"):
            i += 1
            continue
        if line.startswith("/*"):
            if "*/" not in line: in_block = True
            i += 1
            continue
        break
    return "\n".join(lines[i:]).rstrip() + "\n"

def code_card(label, code, lang):
    code = strip_header_comments(code)
    body = _hl(code, lang, None) or _html.escape(code)
    return ('      <div class="code-ex scroll">\n'
            '        <div class="bar">' + _html.escape(label) + '</div>\n'
            '        <pre><code>' + body + '</code></pre>\n'
            '      </div>')

NO_CODE = {"control-panel"}   # tool pages — don't show source

def code_cols(slug):
    if slug in NO_CODE:
        return ""
    ino_path = ARDUINO.get(slug)
    if ino_path is None:
        ino_code, ino_label = COORDINATED_INO, "sketch.ino"
    else:
        ino_code = (REPO / ino_path).read_text(encoding="utf-8")
        ino_label = ino_path.rsplit("/", 1)[-1]
    js_code = (SRC / slug / "sketch.js").read_text(encoding="utf-8")
    return ('    <div class="ex-code-cols">\n'
            + code_card(ino_label + " — the Arduino side", ino_code, "cpp") + "\n"
            + code_card("sketch.js — the browser side", js_code, "javascript") + "\n"
            + "    </div>")

# ---------- detail pages ----------
for slug, (title, blurb, emoji, grad, tags, level) in EXAMPLES.items():
    md_text = (SRC / slug / "README.md").read_text(encoding="utf-8")
    md_text = rewrite_links(md_text, slug)
    intro_md, sep, rest_md = md_text.partition("\n## ")
    intro = _md.render(intro_md)
    rest = _md.render("## " + rest_md) if sep else ""

    page = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — Pardalote examples</title>
<meta name="description" content="{blurb}">
<link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="../css/site.css">
</head>
<body data-nav="examples">

{nav}

<div class="page-head speckled">
  <div class="wrap">
    <div class="crumb"><a href="index.html">Examples</a> / {title}</div>
    <h1>{title}</h1>
    <p>{blurb}</p>
  </div>
</div>

<div class="wrap md-layout">
  <div class="md-body">
    <div class="tags" style="margin-bottom:.5rem;">{tags}</div>
    <div class="ex-meta-row">
      <a class="btn btn-dark" href="{gh}/tree/main/examples/{slug}">View the code on GitHub</a>
    </div>
    <div class="screenshot-slot">Screenshot / video of this example — coming soon</div>
{intro}
  </div>
{code_cols}
  <div class="md-body">
{rest}
  </div>
</div>

{footer}

<script src="../js/site.js"></script>
</body>
</html>
""".format(title=html.escape(title), blurb=html.escape(blurb), nav=NAV,
           tags=tags_html(tags, level), gh=GH, slug=slug, intro=intro, rest=rest, footer=FOOTER,
           code_cols=code_cols(slug))
    (OUT / (slug + ".html")).write_text(page, encoding="utf-8")
    print("wrote", slug + ".html")

# ---------- gallery ----------
cards = []
all_tags = sorted({t for _, (_, _, _, _, tags, _) in EXAMPLES.items() for t in tags})
for slug, (title, blurb, emoji, grad, tags, level) in EXAMPLES.items():
    style = "background:{};".format(grad)
    if slug == "control-panel":
        style += " color:#f2b705;"
    cards.append("""      <a class="ex-card" href="{slug}.html" data-tags="{dt}">
        <div class="ex-thumb" style="{style}">{emoji}</div>
        <div class="ex-body">
          <h3>{title}</h3>
          <p>{blurb}</p>
          <div class="tags">{tags}</div>
        </div>
      </a>""".format(slug=slug, dt=" ".join(tags), style=style, emoji=emoji,
                     title=html.escape(title), blurb=html.escape(blurb),
                     tags=tags_html(tags, level)))

filters = ['      <button class="filter active" data-filter="all">All</button>']
filters += ['      <button class="filter" data-filter="{0}">{0}</button>'.format(t) for t in all_tags]

gallery = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Examples — Pardalote</title>
<meta name="description" content="Complete, working Pardalote projects: an Arduino sketch, a web page, and a wiring note for each.">
<link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="../css/site.css">
</head>
<body data-nav="examples">

{nav}

<div class="page-head speckled">
  <div class="wrap">
    <h1>Examples</h1>
    <p>Every example is a complete, working project: an Arduino sketch, a web page, and a wiring note. Start at the top and work down, or jump to the hardware you have.</p>
  </div>
</div>

<div class="wrap" style="padding-top:2.5rem;">
  <div class="filter-row">
{filters}
  </div>
  <div class="ex-grid">
{cards}
  </div>
</div>

{footer}

<script src="../js/site.js"></script>
<script>
document.querySelectorAll('.filter').forEach(btn => {{
  btn.addEventListener('click', () => {{
    document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.filter;
    document.querySelectorAll('.ex-card').forEach(card => {{
      card.style.display =
        (f === 'all' || card.dataset.tags.split(' ').includes(f)) ? '' : 'none';
    }});
  }});
}});
</script>
</body>
</html>
""".format(nav=NAV, filters="\n".join(filters), cards="\n".join(cards), footer=FOOTER)

(OUT / "index.html").write_text(gallery, encoding="utf-8")
print("wrote index.html")
