#!/usr/bin/env python3
"""Generate the Pardalote examples gallery + detail pages from example READMEs."""
import re, html, shutil
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

_LANG_BADGE = {"javascript": "JS", "js": "JS",
               "cpp": "Arduino", "c++": "Arduino", "arduino": "Arduino", "ino": "Arduino"}

def _lang_badge(lang):
    label = _LANG_BADGE.get(lang.lower(), "") if lang else ""
    return ('<span class="lang-badge lang-' + label.lower() + '">' + label + "</span>"
            if label else "")

def _fence(self, tokens, idx, options, env):
    tok = tokens[idx]
    info = tok.info.strip()
    lang, _, caption = info.partition(" ")
    caption = caption.strip()
    body = _hl(tok.content, lang or None, None)
    if body is None:
        body = _html.escape(tok.content)
    code = "<pre><code>" + body + "</code></pre>"
    badge = _lang_badge(lang)
    if caption:
        return ('<div class="code-ex">' + badge + '<div class="bar">' + _html.escape(caption)
                + "</div>" + code + "</div>\n")
    if badge:
        return '<div class="code-ex">' + badge + code + "</div>\n"
    return code + "\n"

_md.add_render_rule("fence", _fence)


REPO = Path(__file__).parent.parent
SRC = REPO / "examples"
OUT = REPO / "docs" / "examples"
GH = "https://github.com/ScottMit/Pardalote"
OUT.mkdir(parents=True, exist_ok=True)

# slug -> (title, blurb, emoji, gradient, [tags], level).
# Shared with build_llms.py — the single source of truth lives in examples_data.py.
from examples_data import EXAMPLES

LEVEL_CLASS = {"Beginner": "lvl-start", "Intermediate": "lvl-mid", "Advanced": "lvl-adv"}
ANCHOR_MAP = {"groups": "../reference/groups.html",
              "pardalote-library": "../reference/installation.html"}

NAV = """<nav class="site-nav">
  <a class="logo" href="../index.html">
    <img src="../assets/logo.svg" width="26" height="26" alt="">
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

FOOTER = """<footer class="site-footer">
  <div class="wrap">
    <span>Pardalote — created by Scott Mitchell for design education and creative technology.</span>
    <span><a href="../reference/index.html">Reference</a> · <a href="{gh}">GitHub</a> · GPL-3.0-or-later</span>
  </div>
</footer>""".format(gh=GH)

# per-example line-drawing icons (24x24 glyphs, stroke = currentColor, no fill).
# Reusable single glyphs — "shared" examples pair two of these side by side.
G_SLIDERS   = '<line x1="4" y1="9" x2="20" y2="9"/><circle cx="9" cy="9" r="2"/><line x1="4" y1="15" x2="20" y2="15"/><circle cx="15" cy="15" r="2"/>'
G_BULB      = '<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3a6 6 0 0 1 3.8 10.6c-.6.5-.8.9-.8 1.6V16H9v-.8c0-.7-.2-1.1-.8-1.6A6 6 0 0 1 12 3Z"/>'
G_DIAL      = '<circle cx="12" cy="12" r="6.5"/><line x1="12" y1="12" x2="12" y2="6.5"/><line x1="12" y1="2.5" x2="12" y2="4"/><line x1="21.5" y1="12" x2="20" y2="12"/><line x1="2.5" y1="12" x2="4" y2="12"/>'
G_CIRCLES   = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>'
G_SWITCH_V  = '<rect x="8" y="4" width="8" height="16" rx="4"/><circle cx="12" cy="9" r="2.4"/>'
G_SERVO_H   = '<path d="M5 13a7 7 0 0 1 14 0"/><circle cx="12" cy="13" r="2.2"/><line x1="12" y1="13" x2="18" y2="9"/><line x1="12" y1="13" x2="6" y2="9"/>'
G_SERVO_P   = '<path d="M4 17a8 8 0 0 1 16 0"/><line x1="4" y1="17" x2="20" y2="17"/><line x1="12" y1="17" x2="17.5" y2="12"/><circle cx="12" cy="17" r="1.4"/>'
G_GEAR      = '<circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M18.9 5.1l-2.1 2.1M7.2 16.8l-2.1 2.1"/>'
G_ARM       = '<rect x="3" y="18" width="6" height="3" rx="1"/><path d="M6 18l4-6 6 2"/><circle cx="10" cy="12" r="1.1"/><path d="M16 14l2.2-2M16 14l2.2 2"/>'
# three linked servos in series (44-wide) — the bus-servo chain
G_BUS       = ('<rect x="4" y="9" width="8" height="10" rx="1.5"/><circle cx="8" cy="7" r="2"/><line x1="8" y1="7" x2="10.3" y2="5.6"/>'
               '<rect x="18" y="9" width="8" height="10" rx="1.5"/><circle cx="22" cy="7" r="2"/><line x1="22" y1="7" x2="24.3" y2="5.6"/>'
               '<rect x="32" y="9" width="8" height="10" rx="1.5"/><circle cx="36" cy="7" r="2"/><line x1="36" y1="7" x2="38.3" y2="5.6"/>'
               '<line x1="12" y1="14" x2="18" y2="14"/><line x1="26" y1="14" x2="32" y2="14"/>')
G_SYNC      = '<path d="M5 9.5a7 7 0 0 1 12-2.6"/><path d="M19 14.5a7 7 0 0 1-12 2.6"/><path d="M17.2 4v3.2H14"/><path d="M6.8 20v-3.2H10"/>'
G_STRIP     = '<rect x="3" y="9" width="18" height="6" rx="1.5"/><circle cx="6" cy="12" r="1.1"/><circle cx="10" cy="12" r="1.1"/><circle cx="14" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/>'
G_SONAR     = '<rect x="3" y="9" width="4.5" height="6" rx="1"/><path d="M10.5 8a6 6 0 0 1 0 8"/><path d="M14 6a10 10 0 0 1 0 12"/><path d="M17.5 4.5a14 14 0 0 1 0 15"/>'
G_AXES      = '<line x1="9" y1="15" x2="21" y2="15"/><path d="M21 15l-3-2M21 15l-3 2"/><line x1="9" y1="15" x2="9" y2="3"/><path d="M9 3l-2 3M9 3l2 3"/><line x1="9" y1="15" x2="2.5" y2="21"/><path d="M2.5 21l3-1M2.5 21l1-3"/>'
G_CAMERA    = '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.4-2.2h5.2L16 7"/><circle cx="12" cy="13.5" r="3.4"/>'
G_MESSAGE   = '<line x1="4" y1="9" x2="19" y2="9"/><path d="M16.5 6l3 3-3 3"/><line x1="20" y1="15" x2="5" y2="15"/><path d="M7.5 12l-3 3 3 3"/>'
# an eased motion curve through three keyframes — the gesture timeline
G_GESTURE   = '<path d="M3 18C7 18 8 6 12 6s5 10 9 10"/><circle cx="3" cy="18" r="1.5"/><circle cx="12" cy="6" r="1.5"/><circle cx="21" cy="16" r="1.5"/>'

def _pair(a, b):
    """Two glyphs side by side in a 44x24 viewBox — the 'shared' motif."""
    return ('<svg x="0" y="2" width="20" height="20" viewBox="0 0 24 24">' + a + '</svg>'
            '<svg x="24" y="2" width="20" height="20" viewBox="0 0 24 24">' + b + '</svg>')

# slug -> (viewBox width, inner markup).  width 44 => a paired ("shared") icon.
ICONS = {
    "control-panel":              (24, G_SLIDERS),
    "basic-light-switch":         (24, G_BULB),
    "potentiometer-p5js":         (24, G_DIAL),                     # Potentiometer
    "shared-light-switch":        (44, _pair(G_SWITCH_V, G_BULB)),  # switch + bulb
    "shared-potentiometer":       (44, _pair(G_CIRCLES, G_DIAL)),   # screen circle + knob
    "messaging":                  (24, G_MESSAGE),                  # two-way traffic
    "shared-servo":               (44,                               # shared servo + servo control, pivots aligned
        '<svg x="0" y="2" width="20" height="20" viewBox="0 0 24 24">' + G_SERVO_H + '</svg>'
        '<svg x="24" y="2" width="20" height="20" viewBox="0 0 24 24"><g transform="translate(0,-4)">' + G_SERVO_P + '</g></svg>'),
    "servo-control":              (24, G_SERVO_P),
    "stepper-motor":              (24, G_GEAR),
    "bus-servos":                 (44, G_BUS),   # three linked servos
    "coordinated-motion":         (24, G_ARM),   # articulated arm
    "leader-follower":            (44, _pair(G_ARM, G_ARM)),   # two arms: leader + follower
    "gesture-builder":            (24, G_GESTURE),             # eased curve + keyframes
    "neopixel":                   (24, G_STRIP),
    "ultrasonic-sensor":          (24, G_SONAR),
    "IMU":                        (24, G_AXES),
    "camera-stream":              (24, G_CAMERA),
    "camera-posenet":             (24, G_CAMERA),
}
ICON_DEFAULT = (24, '<circle cx="12" cy="12" r="7"/>')
ICON_COLOURS = ["ic-teal", "ic-amber", "ic-orange"]

def icon_html(slug, i):
    colour = ICON_COLOURS[i % len(ICON_COLOURS)]
    vb_w, inner = ICONS.get(slug, ICON_DEFAULT)
    wide = " wide" if vb_w > 24 else ""
    return ('<div class="ex-icon{wide} {c}"><svg viewBox="0 0 {w} 24" fill="none" '
            'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" '
            'stroke-linejoin="round" aria-hidden="true">{inner}</svg></div>'
            ).format(wide=wide, c=colour, w=vb_w, inner=inner)

def meta_line(tags, level):
    return " · ".join([level] + list(tags))


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
    "control-panel":              IDE + "/minimal-pardalote/minimal-pardalote.ino",
    "basic-light-switch":         IDE + "/minimal-pardalote/minimal-pardalote.ino",
    "potentiometer-p5js":         IDE + "/minimal-pardalote/minimal-pardalote.ino",
    "shared-light-switch":        IDE + "/shared-light-switch/shared-light-switch.ino",
    "shared-potentiometer":       IDE + "/shared-potentiometer/shared-potentiometer.ino",
    "messaging":                  IDE + "/messaging/messaging.ino",
    "shared-servo":               IDE + "/shared-servo/shared-servo.ino",
    "servo-control":              IDE + "/servo-control/servo-control.ino",
    "stepper-motor":              IDE + "/stepper-motor/stepper-motor.ino",
    "bus-servos":                 IDE + "/bus-servos/bus-servos.ino",
    "coordinated-motion":         IDE + "/coordinated-motion/coordinated-motion.ino",
    "neopixel":                   IDE + "/neopixel/neopixel.ino",
    "ultrasonic-sensor":          IDE + "/ultrasonic-sensor/ultrasonic-sensor.ino",
    "IMU":                        IDE + "/IMU/IMU.ino",
    "camera-stream":              IDE + "/camera-stream/camera-stream.ino",
    "camera-posenet":             IDE + "/camera-stream/camera-stream.ino",   # shares the camera-stream firmware
}


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
            '        ' + _lang_badge(lang) + '\n'
            '        <div class="bar">' + _html.escape(label) + '</div>\n'
            '        <pre><code>' + body + '</code></pre>\n'
            '      </div>')

NO_CODE = {"control-panel", "messaging", "servo-control", "stepper-motor", "bus-servos", "coordinated-motion", "leader-follower", "gesture-builder"}   # tool pages — don't show source

# Examples with no "Try now" button + no runnable mirror: the camera examples
# stream MJPEG over http:// from the board, which a hosted https page can't
# reach (mixed content) — and they need real camera hardware regardless.
NO_TRY = {"camera-stream", "camera-posenet"}

def code_cols(slug):
    if slug in NO_CODE:
        return ""
    ino_path = ARDUINO[slug]
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

    # Screenshot: a real image if one has been captured (see
    # tools/screenshot-examples), otherwise the "coming soon" placeholder.
    shot_png = REPO / "docs" / "assets" / "examples" / (slug + ".png")
    if shot_png.exists():
        shot = ('<img class="screenshot" src="../assets/examples/{slug}.png" '
                'alt="{title} — the example running" loading="lazy">').format(
                    slug=slug, title=html.escape(title))
    else:
        shot = '<div class="screenshot-slot">Screenshot / video of this example — coming soon</div>'

    # "Try now" opens the hosted runnable copy (USB only — see NO_TRY note).
    try_btn = ('' if slug in NO_TRY else
               '<a class="btn btn-try" href="{slug}/index.html" target="_blank" '
               'rel="noopener">Try now over USB ↗</a>\n      '.format(slug=slug))

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

<div class="page-head">
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
      {try_btn}<a class="btn btn-dark" href="{gh}/tree/main/examples/{slug}">View the code on GitHub</a>
    </div>
    {shot}
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
           code_cols=code_cols(slug), shot=shot, try_btn=try_btn)
    (OUT / (slug + ".html")).write_text(page, encoding="utf-8")
    print("wrote", slug + ".html")

# ---------- runnable copies (so "Try now" works on the hosted docs) ----------
# The site is served from docs/, so the repo-root examples/ aren't reachable
# there. Mirror each runnable example into docs/examples/<slug>/ and drop the
# one shared dependency (lib/pardalote.js) at docs/lib/ — the copied pages load
# it via ../../lib/pardalote.js. These are GENERATED mirrors: edit the originals
# in examples/ (and lib/), never these copies; a rebuild overwrites them.
LIB_OUT = REPO / "docs" / "lib"
LIB_OUT.mkdir(parents=True, exist_ok=True)
shutil.copy2(REPO / "lib" / "pardalote.js", LIB_OUT / "pardalote.js")
CONNECT_USB = (Path(__file__).parent / "connect-usb.js").read_text(encoding="utf-8")
for slug in EXAMPLES:
    if slug in NO_TRY:            # no runnable mirror for the camera examples
        continue
    src_dir = SRC / slug
    if not src_dir.is_dir():
        continue
    shutil.copytree(src_dir, OUT / slug, dirs_exist_ok=True)
    # Hosted pages are HTTPS → USB only. Swap in the USB-only connect UI for
    # examples that use connect.js (coordinated-motion / leader-follower build
    # their own transport UI in sketch.js and are unaffected).
    conn = OUT / slug / "connect.js"
    if conn.exists():
        conn.write_text(CONNECT_USB, encoding="utf-8")
print("copied runnable examples + lib into docs/ (USB-only connect UI)")

# ---------- gallery ----------
cards = []
all_tags = sorted({t for _, (_, _, _, _, tags, _) in EXAMPLES.items() for t in tags})
for i, (slug, (title, blurb, emoji, grad, tags, level)) in enumerate(EXAMPLES.items()):
    cards.append("""      <a class="ex-card" href="{slug}.html" data-tags="{dt}">
        {icon}
        <h3>{title}</h3>
        <p>{blurb}</p>
        <div class="meta">{meta}</div>
      </a>""".format(slug=slug, dt=" ".join(tags), icon=icon_html(slug, i),
                     title=html.escape(title), blurb=html.escape(blurb),
                     meta=html.escape(meta_line(tags, level))))

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

<div class="page-head">
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
