#!/usr/bin/env python3
"""Generate the Pardalote reference pages from ref-src markdown files."""
import html
import re
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

def _fence(self, tokens, idx, options, env):
    tok = tokens[idx]
    info = tok.info.strip()
    lang, _, caption = info.partition(" ")
    caption = caption.strip()
    body = _hl(tok.content, lang or None, None)
    if body is None:
        body = _html.escape(tok.content)
    code = "<pre><code>" + body + "</code></pre>"
    label = _LANG_BADGE.get(lang.lower(), "") if lang else ""
    badge = ('<span class="lang-badge lang-' + label.lower() + '">' + label + "</span>"
             if label else "")
    if caption:
        return ('<div class="code-ex">' + badge + '<div class="bar">' + _html.escape(caption)
                + "</div>" + code + "</div>\n")
    if badge:
        return '<div class="code-ex">' + badge + code + "</div>\n"
    return code + "\n"

_md.add_render_rule("fence", _fence)


def _tag_sigs(body):
    """Colour-code signature bubbles by language: an Arduino signature (mentions
    a `Pardalote` global) gets .sig-ino (teal); a JS one gets .sig-js (yellow)."""
    def repl(m):
        inner = m.group(1)
        text = re.sub(r"<[^>]+>", "", inner)
        cls = "sig sig-ino" if "Pardalote" in text else "sig sig-js"
        return '<div class="' + cls + '">' + inner + "</div>"
    return re.sub(r'<div class="sig">(.*?)</div>', repl, body, flags=re.S)


SRC = Path(__file__).parent / "reference"
OUT = Path(__file__).parent.parent / "docs" / "reference"
GH = "https://github.com/ScottMit/Pardalote"
OUT.mkdir(parents=True, exist_ok=True)

# Hosted-site analytics (umami) — injected into every generated page's <head>.
UMAMI = ('<!-- umami analytics -->\n'
         '<script defer src="https://cloud.umami.is/script.js" '
         'data-website-id="75a6fe7b-62be-44ca-8a17-65739311fed8"></script>')
def with_umami(html):
    return html.replace("</head>", UMAMI + "\n</head>", 1)

SIDEBAR = """<aside class="ref-nav">
  <button class="ref-nav-toggle" aria-expanded="false" aria-controls="ref-nav-links">Contents</button>
  <div class="ref-nav-links" id="ref-nav-links">
  <h4><a href="index.html">Getting started</a></h4>
  <a href="index.html">Overview</a>
  <a href="installation.html">Installation</a>
  <a href="wifi.html">WiFi configuration</a>
  <a href="ai-coding.html">Coding with AI</a>
  <h4><a href="connecting.html">Core — JavaScript</a></h4>
  <a href="connecting.html#connect">connect()</a>
  <a href="connecting.html#on">on()</a>
  <a href="connecting.html#disconnect">disconnect()</a>
  <a href="connecting.html#getstatus">getStatus()</a>
  <a href="pins.html#pinmode">pinMode()</a>
  <a href="pins.html#digitalwrite">digitalWrite()</a>
  <a href="pins.html#analogwrite">analogWrite()</a>
  <a href="pins.html#setwritethrottle--setwritethreshold">setWriteThrottle() / setWriteThreshold()</a>
  <a href="pins.html#analogread">analogRead()</a>
  <a href="pins.html#digitalread">digitalRead()</a>
  <a href="pins.html#setreadinterval--setreadthreshold">setReadInterval() / setReadThreshold()</a>
  <a href="pins.html#pin--the-listening-handle">pin() — the listening handle</a>
  <a href="pins.html#end--endall">end() / endAll()</a>
  <a href="pins.html#pin-aliases">Pin aliases</a>
  <h4><a href="arduino.html">Core — Arduino</a></h4>
  <a href="arduino.html#pardalotebegin">Pardalote.begin()</a>
  <a href="arduino.html#pardaloterun">Pardalote.run()</a>
  <a href="arduino.html#pardaloteshare">Pardalote.share()</a>
  <a href="arduino.html#pardalotesend">Pardalote.send()</a>
  <a href="arduino.html#when-not-to-share">When not to share</a>
  <h4><a href="messaging.html">Core — Messaging</a></h4>
  <a href="messaging.html#javascript-to-arduino">JavaScript to Arduino</a>
  <a href="messaging.html#arduino-to-javascript">Arduino to JavaScript</a>
  <a href="messaging.html#retain-and-broadcast">Retain and broadcast</a>
  <a href="messaging.html#inspecting-all-traffic">Inspecting all traffic</a>
  <h4><a href="extensions.html">Extensions</a></h4>
  <a href="extensions.html">Overview</a>
  <a href="extensions.html#creating-extension-objects-in-the-firmware">Creating extension objects in the firmware</a>
  <a href="extensions.html#reading-and-writing-actuators-from-the-sketch">Reading and writing actuators from the sketch</a>
  <a href="servo.html">Servo</a>
  <a href="stepper.html">Stepper</a>
  <a href="bus-servo.html">Bus servo</a>
  <a href="groups.html">Groups</a>
  <a href="gesture.html">Gesture</a>
  <a href="neopixel.html">NeoPixel</a>
  <a href="ultrasonic.html">Ultrasonic</a>
  <a href="encoder.html">Rotary encoder</a>
  <a href="imu.html">IMU</a>
  <a href="camera.html">Camera</a>
  <h4><a href="protocol.html">Under the hood</a></h4>
  <a href="protocol.html">Protocol</a>
  <a href="pin-capabilities.html">Pin capabilities</a>
  <a href="troubleshooting.html">Troubleshooting</a>
  </div>
</aside>"""

NAV = """<nav class="site-nav">
  <a class="logo" href="../index.html">
    <img src="../assets/logo.svg" width="26" height="26" alt="">
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

FOOTER = """<footer class="site-footer">
  <div class="wrap">
    <span>Pardalote — created by Scott Mitchell for design education and creative technology.</span>
    <span><a href="index.html">Reference</a> · <a href="{gh}">GitHub</a> · GPL-3.0-or-later</span>
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
    body = _tag_sigs(_md.render(body_md))
    page = TEMPLATE.format(
        title=html.escape(meta["title"]),
        lede=html.escape(meta["lede"]),
        nav=NAV, sidebar=SIDEBAR, body=body, footer=FOOTER)
    (OUT / (md_file.stem + ".html")).write_text(with_umami(page), encoding="utf-8")
    print("wrote", md_file.stem + ".html")
