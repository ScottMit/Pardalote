# Releasing Pardalote

Pardalote ships as **two GitHub repos, one product version**:

| Repo | What it is | Tag style |
|---|---|---|
| [`ScottMit/Pardalote`](https://github.com/ScottMit/Pardalote) | This monorepo — firmware + JS + docs + examples + website. The GitHub **Release** lives here with both zip artifacts. | `vX.Y.Z` |
| [`ScottMit/Pardalote-arduino`](https://github.com/ScottMit/Pardalote-arduino) | Arduino **Library Manager** mirror — the library files at the repo root. Regenerated from this monorepo each release. | `X.Y.Z` (no `v`) |

The mirror is already in the Library Manager index, so **every tag you push to it is auto-indexed — no more registry PRs.** The first submission (the one-line PR to `arduino/library-registry`) only happens once.

Versioning policy: firmware + JS share one product version in lockstep. `MAJOR` = breaking JS API or a protocol change old clients can't survive; `MINOR` = backward-compatible features; `PATCH` = fixes. The **wire protocol** (`PROTOCOL_VERSION_*`) versions independently and only bumps when the wire changes.

---

## The checklist

### 1. Bump the version (4 canonical spots + protocol if the wire changed)
- `pardalote-arduino/library/Pardalote/library.properties` → `version=`
- `lib/package.json` → `"version":`
- `pardalote-arduino/library/Pardalote/src/internal/defs.h` → `#define PARDALOTE_VERSION`
- `lib/src/pardalote-core.js` → `const PARDALOTE_VERSION` (this feeds `Arduino.version`)
- **Only if the wire format changed:** `PROTOCOL_VERSION_MAJOR/MINOR` in `defs.h`

### 2. Write the CHANGELOG entry
Add a new `## [X.Y.Z] — YYYY-MM-DD` section at the top of `CHANGELOG.md` (Keep-a-Changelog style). This doubles as the GitHub Release body.

### 3. Rebuild generated files
Needs the docs venv (one-time: `python3 -m venv .venv && .venv/bin/pip install markdown-it-py mdit-py-plugins pygments`).
```bash
./build-release.sh
```
This rebuilds the JS bundle (`lib/pardalote.js`) and the docs (`docs/`, `llms*.txt`), builds both release artifacts into `release-artifacts/`, and regenerates the mirror repo (clean commit + tag). See the script for the individual steps if you want to run them by hand.

### 4. Verify
- Firmware compiles on ESP32 + UNO R4 (your bench/toolchain — no `arduino-cli` in the dev env).
- `node --check lib/pardalote.js` and the modular sources parse clean (the script does this).
- `arduino-lint --library-manager update` passes clean on the mirror (the script runs it if `arduino-lint` is installed).

### 5. Update the download-page links
`docs/download.html` has two buttons with **version-pinned** asset URLs. Update both the label (`vX.Y.Z`) and the two hrefs:
- `…/releases/download/vX.Y.Z/Pardalote-X.Y.Z.zip`
- `…/releases/download/vX.Y.Z/pardalote-js-X.Y.Z.zip`

### 6. Ship the monorepo release (`ScottMit/Pardalote`)
1. Commit everything, **push `main`** (GitHub Desktop).
2. GitHub → **Releases → Draft a new release** → tag `vX.Y.Z`, target `main`, title `Pardalote X.Y.Z`, paste the CHANGELOG section as the body.
3. Attach `release-artifacts/Pardalote-X.Y.Z.zip` and `release-artifacts/pardalote-js-X.Y.Z.zip`.
4. Leave "pre-release" unchecked. **Publish.**

### 7. Ship the mirror (`ScottMit/Pardalote-arduino`) → auto-indexes
1. In GitHub Desktop, open the `Pardalote-arduino` repo, **push `main`**.
2. Make sure the **`X.Y.Z` tag reaches GitHub** — GitHub Desktop doesn't reliably push tags, so the sure way is: on the mirror repo, **Releases → Draft a new release → tag `X.Y.Z`, target `main`, Publish** (a release isn't required by the index, but it's the reliable way to create the remote tag).
3. Within ~an hour the new version appears in the Arduino IDE Library Manager.

---

## Notes
- **Keep Claude off the contributor list:** the mirror's commits are authored as Scott (the build script does this via `-c user.name/user.email`). Don't add a `Co-Authored-By` trailer to commits on either repo.
- **The mirror is a snapshot, the monorepo is canonical.** Never hand-edit the library inside `Pardalote-arduino/` — edit `pardalote-arduino/library/Pardalote/` here and let the script regenerate the mirror.
- **Name uniqueness** in the Library Manager only mattered for the first submission; it's locked in now.
