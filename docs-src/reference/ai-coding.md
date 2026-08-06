title: Coding with AI
lede: The whole reference in one file, built for AI assistants — paste it in and your assistant knows the entire Pardalote API.
---
Building a Pardalote project with an AI assistant — Claude, ChatGPT, Cursor, Copilot? Give it the reference up front and it writes real Pardalote code: setup in the right place, motion that runs on the board, the correct units — instead of guessing from the library name.

## Paste this in

**llms-full.txt** is this entire reference site as one plain-text file, with a short preamble covering the mistakes assistants make by default. Drop it into your assistant at the start of a session — attach the file, or paste it into a Claude Project, a custom GPT, or your editor's context.

<div class="cta-row">
  <a class="btn btn-solid" href="../llms-full.txt" download>Download llms-full.txt</a>
  <a class="btn btn-ghost" href="../llms-full.txt">View in browser</a>
</div>

It's about 130&nbsp;KB (~32k tokens) — comfortably within any modern assistant's context window.

## For tools that fetch on their own

Some tools look for an **llms.txt** index at a site's root. Pardalote's lives at:

`https://scottmit.github.io/Pardalote/llms.txt`

It's a short map linking to every reference page and to llms-full.txt — point your tool there if it follows the [llms.txt convention](https://llmstxt.org).

## What the preamble covers

So you know what your assistant is being told, the file leads with the handful of things that trip up generated code:

- **Setup goes in `on('ready')`** — not at the top level.
- **`read()` is a poll**, not a one-shot getter.
- **Motion runs on the board** — use `writeTimed()` / `gesture()`, never stream positions.
- **Native units** per actuator (degrees, steps, counts), and relative-vs-absolute gestures.
- **Await real arrival** with `whenDone()`.

The rest of the file is these reference pages, verbatim.

See also: [Overview](index.html) · [Installation](installation.html)
