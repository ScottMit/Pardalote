#!/usr/bin/env python3
"""Generate the Pardalote reference pages from ref-src markdown files."""
import html
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


SRC = Path(__file__).parent / "reference"
OUT = Path(__file__).parent.parent / "docs" / "reference"
GH = "https://github.com/scottmitchell/pardalote"
OUT.mkdir(parents=True, exist_ok=True)

SIDEBAR = """<aside class="ref-nav">
  <h4>Getting started</h4>
  <a href="index.html">Overview</a>
  <a href="installation.html">Installation</a>
  <a href="wifi.html">WiFi configuration</a>
  <h4>Core — JavaScript</h4>
  <a href="connecting.html#connect">connect() / events</a>
  <a href="pins.html#pinmode">pinMode()</a>
  <a href="pins.html#digitalwrite">digitalWrite() / analogWrite()</a>
  <a href="pins.html#analogread">analogRead() / digitalRead()</a>
  <a href="pins.html#onchange">onChange()</a>
  <a href="pins.html#pin-aliases">Pin aliases</a>
  <h4>Core — Arduino</h4>
  <a href="arduino.html#pardalotebegin">Pardalote.begin() / run()</a>
  <a href="arduino.html#pardaloteshare">share() / send()</a>
  <a href="arduino.html#the-actuator-objects">Reading actuators</a>
  <h4>Extensions</h4>
  <a href="extensions.html">Overview</a>
  <a href="servo.html">Servo</a>
  <a href="stepper.html">Stepper</a>
  <a href="bus-servo.html">Bus servo</a>
  <a href="groups.html">Groups</a>
  <a href="neopixel.html">NeoPixel</a>
  <a href="ultrasonic.html">Ultrasonic</a>
  <a href="mpu.html">MPU / IMU</a>
  <a href="camera.html">Camera</a>
  <h4>Under the hood</h4>
  <a href="protocol.html">Protocol</a>
  <a href="troubleshooting.html">Troubleshooting</a>
</aside>"""

NAV = """<nav class="site-nav speckled">
  <a class="logo" href="../index.html">
    <img src="../assets/logo.svg" width="30" height="30" alt="">
    Pardalote
  </a>
  <div class="links">
    <a data-nav="home" href="../index.html">Home</a>
    <a data-nav="download" href="../download.html">Download</a>
    <a data-nav="examples" href="../examples/index.html">Examples</a>
    <a data-nav="reference" href="index.html">Reference</a>
    <a href="{gh}">GitHub</a>
  </div>
</nav>""".format(gh=GH)

FOOTER = """<footer class="site-footer speckled">
  <div class="wrap">
    <span>Pardalote — created by Scott Mitchell for design education and creative technology.</span>
    <span><a href="index.html">Reference</a> · <a href="{gh}">GitHub</a> · GPL-3.0</span>
  </div>
</footer>""".format(gh=GH)

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — Pardalote reference</title>
<meta name="description" content="{lede}">
<link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="../css/site.css">
</head>
<body data-nav="reference">

{nav}

<div class="wrap">
  <div class="ref-layout">
{sidebar}
    <main class="ref-main">
      <h1>{title}</h1>
      <p class="lede">{lede}</p>
{body}
    </main>
  </div>
</div>

{footer}

<script src="../js/site.js"></script>
</body>
</html>
"""

for md_file in sorted(SRC.glob("*.md")):
    raw = md_file.read_text(encoding="utf-8")
    head, _, body_md = raw.partition("---\n")
    meta = dict(line.split(": ", 1) for line in head.strip().splitlines())
    body = _md.render(body_md)
    page = TEMPLATE.format(
        title=html.escape(meta["title"]),
        lede=html.escape(meta["lede"]),
        nav=NAV, sidebar=SIDEBAR, body=body, footer=FOOTER)
    (OUT / (md_file.stem + ".html")).write_text(page, encoding="utf-8")
    print("wrote", md_file.stem + ".html")
