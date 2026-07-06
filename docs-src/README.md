# Pardalote website docs

The website's reference section is generated from the markdown files in `reference/`.
The example pages are generated from each example's `README.md` in `../examples/`.

## Editing the reference

Edit the markdown in `reference/` — one file per page. Each file starts with a two-line
header (`title:` and `lede:`) followed by `---` and the page body.

API entries use this pattern:

    ## functionName()

    One-sentence description.

    <div class="sig">arduino.<span class="fn">functionName</span>(param, [optional])</div>

    | Parameter | Type | Description |
    |---|---|---|
    | `param` | number | What it does. |

    **Returns** what it returns.

    ```javascript
    // short example
    ```

### Code block captions

Any text after the language on a fence line becomes a caption bar on the
rendered code card:

    ```javascript Example — circle that follows a knob
    ...
    ```

Fences without a caption render as a plain white card. Use `text` as the
language for non-code content (serial output, file trees). This works in the
reference files and in the example READMEs.

## Rebuilding the site

Requires Python 3 with `markdown-it-py`, `mdit-py-plugins` and `pygments`:

    cd docs
    python3 build_reference.py   # reference/*.md  -> ../docs/reference/*.html
    python3 build_examples.py    # ../examples/*/README.md -> ../docs/examples/*.html

Everything else on the site (`docs/index.html`, `docs/download.html`, CSS) is plain HTML —
edit it directly.
