#!/usr/bin/env python3
"""Generate the AI-coding docs, both stdlib-only (no build deps):

  llms-full.txt  — the hand-written preamble + the whole reference concatenated
                   and decluttered, then the per-example READMEs appended, for
                   pasting into an assistant in one go.
  llms.txt       — the small linked index (llmstxt.org convention) an AI tool
                   auto-discovers at the site root; points at llms-full.txt and
                   each reference page.

Both are written to the repo root (GitHub) and docs/ (the served site). Section
list and per-link descriptions come from the reference frontmatter, so the index
stays in sync automatically. Run:  python3 build_llms.py
"""
import re
from pathlib import Path
from examples_data import EXAMPLES   # shared with build_examples.py; stdlib-only, no build deps

HERE     = Path(__file__).parent
SRC      = HERE / "reference"
EX_SRC   = HERE.parent / "examples"   # example folders (README per example)
PREAMBLE = HERE / "llms-preamble.md"
REPO     = HERE.parent

# Deployed site root (GitHub Pages, served from docs/). Absolute so llms.txt
# links resolve wherever the file is read. Update here if the domain changes.
BASE_URL = "https://scottmit.github.io/Pardalote/"
GH_URL   = "https://github.com/ScottMit/Pardalote"

SUMMARY = ("Pardalote is a JavaScript ↔ Arduino library: browser JavaScript "
           "(p5.js-friendly) drives Arduino hardware — pins, PWM and serial-bus "
           "servos, steppers, NeoPixels, and sensors — over WiFi or USB, with no "
           "server and no Node.js. Motion and reads run on the board.")

# Grouped reading order — drives both the concatenation and the llms.txt index.
GROUPS = [
    ("Getting started",   ["index", "installation", "wifi"]),
    ("Core",              ["connecting", "pins", "arduino", "messaging"]),
    ("Actuators",         ["extensions", "servo", "stepper", "bus-servo", "groups", "gesture"]),
    ("Sensors & output",  ["neopixel", "ultrasonic", "encoder", "imu", "camera"]),
    ("Under the hood",    ["protocol", "pin-capabilities", "troubleshooting"]),
]
ORDER  = [slug for _, slugs in GROUPS for slug in slugs]
LABELS = {"index": "Overview"}   # frontmatter title override for the index link
# Meta pages that live on the website but don't belong in the AI bundle (they
# document how to USE the bundle, not the API).
EXCLUDE = {"ai-coding"}


def strip_frontmatter(raw):
    head, sep, body = raw.partition("---\n")
    if not sep:
        return {}, raw
    meta = {}
    for line in head.strip().splitlines():
        if ": " in line:
            k, v = line.split(": ", 1)
            meta[k.strip()] = v.strip()
    return meta, body.lstrip("\n")


def declutter(body):
    """Turn doc-site chrome into plain markdown. These patterns never occur
    inside code fences (the fenced HTML examples use href=/src=, not these
    class names), so the code blocks are left intact."""
    body = re.sub(r'<span class="fn">([^<]*)</span>', r"\1", body)
    body = re.sub(r"<i>([^<]*)</i>", r"\1", body)
    body = re.sub(r'<div class="sig">(.*?)</div>',
                  lambda m: "`" + m.group(1).strip() + "`", body, flags=re.S)
    # Local .html cross-links don't resolve in one flat file; keep the text,
    # drop the dead target. External http(s) links are preserved.
    body = re.sub(r"\[([^\]]+)\]\((?!https?:)[^)]*\.html(?:#[^)]*)?\)", r"\1", body)
    return body


def strip_local_links_prose(md):
    """Flatten local markdown links (../foo/, bar.html, ../../README.md#x) to
    their text — they don't resolve in one flat file — while preserving http(s)
    links. Only touches prose: lines inside ``` code fences are left untouched,
    so a JS `handlers[type](arg)` is never mistaken for a link."""
    out, in_fence = [], False
    for line in md.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence:
            line = re.sub(r"\[([^\]]+)\]\((?!https?:)[^)]*\)", r"\1", line)
        out.append(line)
    return "\n".join(out)


def write_both(name, text):
    for out in (REPO / name, REPO / "docs" / name):
        out.write_text(text, encoding="utf-8")
        print(f"wrote {out.relative_to(REPO)}")


# --- collect metadata + section bodies once ---
missing = [s for s in ORDER if not (SRC / f"{s}.md").exists()]
extra   = sorted(p.stem for p in SRC.glob("*.md") if p.stem not in ORDER and p.stem not in EXCLUDE)
if missing:
    print("WARNING: in GROUPS but missing:", missing)
if extra:
    print("WARNING: present but not grouped (appended to full, absent from index):", extra)

meta_of, body_of = {}, {}
for stem in ORDER + extra:
    f = SRC / f"{stem}.md"
    if not f.exists():
        continue
    meta_of[stem], body_of[stem] = strip_frontmatter(f.read_text(encoding="utf-8"))

# --- llms-full.txt : preamble + every section, decluttered ---
parts = [PREAMBLE.read_text(encoding="utf-8").rstrip()]
for stem in ORDER + extra:
    if stem not in meta_of:
        continue
    meta = meta_of[stem]
    section = f"# {meta.get('title', stem)}\n"
    if meta.get("lede"):
        section += f"> {meta['lede']}\n"
    section += "\n" + declutter(body_of[stem]).rstrip()
    parts.append(section)

# Worked examples, README-level — complete projects that show the API in use.
# (The full source lives on GitHub; the READMEs carry the idiomatic snippets.)
parts.append("# Examples\n> Complete, working Pardalote projects — each has an "
             "Arduino sketch, a web page, and a wiring note. The sections below are "
             "the per-example READMEs (what each does and how it works); full source "
             f"for every example is on GitHub: {GH_URL}/tree/main/examples.")
ex_missing = []
for slug in EXAMPLES:
    readme = EX_SRC / slug / "README.md"
    if not readme.exists():
        ex_missing.append(slug)
        continue
    parts.append(strip_local_links_prose(readme.read_text(encoding="utf-8")).rstrip())
if ex_missing:
    print("WARNING: examples missing a README (skipped):", ex_missing)

full = "\n\n---\n\n".join(parts) + "\n"
write_both("llms-full.txt", full)

# --- llms.txt : the linked index ---
lines = [f"# Pardalote", "", f"> {SUMMARY}", "",
         f"The complete API reference as a single file for AI-assisted coding: "
         f"[llms-full.txt]({BASE_URL}llms-full.txt).", ""]
for title, slugs in GROUPS:
    lines.append(f"## {title}")
    for stem in slugs:
        if stem not in meta_of:
            continue
        label = LABELS.get(stem, meta_of[stem].get("title", stem))
        lede  = meta_of[stem].get("lede", "").rstrip(".")
        url   = f"{BASE_URL}reference/{stem}.html"
        lines.append(f"- [{label}]({url})" + (f": {lede}." if lede else ""))
    lines.append("")
lines.append("## Examples")
lines.append("Complete, working projects (Arduino sketch + web page). Full source: "
             f"{GH_URL}/tree/main/examples.")
for slug, (title, blurb, *_rest) in EXAMPLES.items():
    url = f"{BASE_URL}examples/{slug}.html"
    lines.append(f"- [{title}]({url}): {blurb.rstrip('.')}.")
lines.append("")
lines += ["## Source",
          f"- [GitHub repository]({GH_URL}): source code, examples, and the Arduino library.",
          ""]
write_both("llms.txt", "\n".join(lines))

print(f"{len(ORDER)} sections + {len(EXAMPLES)} examples indexed, "
      f"~{len(full.split())} words in llms-full.txt")
