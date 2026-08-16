#!/usr/bin/env bash
#
# build-release.sh — prepare a Pardalote release (see RELEASING.md).
#
# Does the deterministic mechanical work:
#   - rebuild lib/pardalote.js (JS bundle) and docs/ + llms*.txt
#   - node --check the bundle + pin maps + modular sources
#   - build the two release artifacts into ./release-artifacts/
#       * Pardalote-<ver>.zip       — the Arduino library
#       * pardalote-js-<ver>.zip    — bundle + pin maps + examples + README + LICENSE
#   - regenerate the Library-Manager mirror repo (clean commit + tag, authored as Scott)
#   - run arduino-lint on the mirror if it's installed
#
# It does NOT push or create GitHub releases — those are manual (GitHub Desktop
# / web UI), because auth lives there. The script prints the remaining steps.
#
# Prereqs: a docs venv at ./.venv with markdown-it-py mdit-py-plugins pygments,
# and a sibling checkout of the mirror repo (default ../Pardalote-arduino).

set -euo pipefail

MONO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR="${PARDALOTE_MIRROR:-$(cd "$MONO/.." && pwd)/Pardalote-arduino}"
LIB="$MONO/pardalote-arduino/library/Pardalote"
VENV="$MONO/.venv/bin"
AUTHOR_NAME="${PARDALOTE_AUTHOR_NAME:-Scott Mitchell}"
AUTHOR_EMAIL="${PARDALOTE_AUTHOR_EMAIL:-scott@openobject.org}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

VERSION="$(sed -n 's/^version=//p' "$LIB/library.properties")"
[ -n "$VERSION" ] || die "could not read version from library.properties"
say "Releasing Pardalote $VERSION"

[ -x "$VENV/python" ] || die "docs venv missing. Run: python3 -m venv .venv && .venv/bin/pip install markdown-it-py mdit-py-plugins pygments"

say "1/5  Rebuild JS bundle + docs"
"$VENV/python" "$MONO/build_pardalote.py"
"$VENV/python" "$MONO/docs-src/build_reference.py" >/dev/null
"$VENV/python" "$MONO/docs-src/build_examples.py"  >/dev/null
"$VENV/python" "$MONO/docs-src/build_llms.py"      >/dev/null
echo "  bundle + docs regenerated"

say "2/5  node --check (bundle + modular sources)"
command -v node >/dev/null || die "node not found"
node --check "$MONO/lib/pardalote.js"
for f in "$MONO"/lib/src/*.js; do node --check "$f"; done
echo "  all JS parses clean"

say "3/5  Build release artifacts -> release-artifacts/"
OUT="$MONO/release-artifacts"
rm -rf "$OUT"; mkdir -p "$OUT"
# Arduino library: unpacks to Pardalote/ with library.properties at its root
( cd "$MONO/pardalote-arduino/library" && zip -rq "$OUT/Pardalote-$VERSION.zip" Pardalote -x '*.DS_Store' )
# JS package: bundle (lib/, minus src/) + examples + README + LICENSE.
# Layout mirrors the repo so each example's ../../lib/pardalote.js resolves.
STAGE="$OUT/pardalote-js-$VERSION"
mkdir -p "$STAGE/lib"
cp "$MONO/lib/pardalote.js" "$STAGE/lib/"
rsync -a --exclude='.DS_Store' "$MONO/examples/" "$STAGE/examples/"
cp "$MONO/LICENSE" "$STAGE/LICENSE"
cat > "$STAGE/README.md" <<PKG
# Pardalote $VERSION — JavaScript

The browser / p5.js side of Pardalote. Include the one bundle:

    <script src="lib/pardalote.js"></script>

Named pins (\`D13\`, \`A0\`, \`SDA\` …) work by name automatically, resolved for
the connected board. Add \`data-pins="off"\` to the script tag to disable them.

Runnable examples are in \`examples/\` — open any \`index.html\` in Chrome or Edge.

Full guide, API reference, and protocol docs: https://github.com/ScottMit/Pardalote
License: GPL-3.0-or-later (see LICENSE).
PKG
( cd "$OUT" && zip -rq "$OUT/pardalote-js-$VERSION.zip" "pardalote-js-$VERSION" && rm -rf "$STAGE" )
ls -1 "$OUT"

say "4/5  Regenerate the Library-Manager mirror ($MIRROR)"
[ -d "$MIRROR/.git" ] || die "mirror repo not found at $MIRROR (set PARDALOTE_MIRROR)"
# sync library files to the mirror root; keep the mirror's .git and .gitignore
rsync -a --delete --exclude='.git' --exclude='.gitignore' --exclude='.DS_Store' "$LIB"/ "$MIRROR"/
( cd "$MIRROR"
  git add -A
  if git diff --cached --quiet; then
    echo "  mirror already matches — no new commit"
  else
    git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" commit -q -m "Pardalote $VERSION"
    echo "  committed 'Pardalote $VERSION' as $AUTHOR_NAME"
  fi
  if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
    echo "  tag $VERSION already exists (left as-is)"
  else
    git tag "$VERSION" && echo "  tagged $VERSION"
  fi
)

say "5/5  Arduino Lint (submit mode)"
if command -v arduino-lint >/dev/null; then
  ( cd "$MIRROR" && arduino-lint --library-manager submit --compliance strict ) | tail -3
else
  echo "  arduino-lint not installed — skipping (install: https://github.com/arduino/arduino-lint)"
fi

cat <<EOF

$(printf '\033[1m== Done — manual steps remain (see RELEASING.md) ==\033[0m')
  Monorepo (ScottMit/Pardalote):
    1. Update docs/download.html links to v$VERSION (step 5 in RELEASING.md)
    2. Commit + push main (GitHub Desktop)
    3. GitHub Release: tag v$VERSION, attach both zips in release-artifacts/
  Mirror (ScottMit/Pardalote-arduino):
    4. Push main (GitHub Desktop)
    5. Create the remote tag $VERSION (Releases -> new release, tag $VERSION, target main)
       -> auto-indexes into Library Manager within ~an hour
EOF
