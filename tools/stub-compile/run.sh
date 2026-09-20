#!/usr/bin/env bash
# ==============================================================
# Pardalote host stub-compile — structural (-fsyntax-only) verification of
# the firmware across the three supported board defines, with NO Arduino
# toolchain or real libraries. Catches parse/type errors the dev host can
# see; it does NOT run or link anything. See README.md.
#
# Usage:  tools/stub-compile/run.sh
# Exit 0 = all target TUs parse clean on all target boards.
# ==============================================================
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../pardalote-arduino/library/Pardalote/src"
STUBS="$HERE/stubs"
CXX="${CXX:-g++}"
STD="-std=gnu++17"
INC="-I$STUBS -I$SRC -I$SRC/internal"
WARN="-Wall -Wextra -Wno-unused-parameter"

# Board define matrix.
# The extra ESP32 board macro just picks a PARDALOTE_BOARD name (quiets the
# "board not recognised" #warning); it doesn't affect the code under test.
BOARDS=( "ESP32:-DESP32 -DARDUINO_ESP32_DEV"
         "UNO_R4_WIFI:-DARDUINO_UNOR4_WIFI"
         "UNO_R4_MINIMA:-DARDUINO_UNOR4_MINIMA" )

# Translation units to check. The sketch TU (motion + gesture API) is the
# primary gesture-feature gate; the library TUs catch the registry/factory.
TUS=( "$HERE/main_motion.cpp"
      "$SRC/internal/extensions.cpp"
      "$SRC/Pardalote.cpp"
      "$SRC/internal/serial_transport.cpp"
      "$SRC/internal/led_matrix.cpp"
      "$SRC/internal/wifi_config.cpp" )

fail=0
for board in "${BOARDS[@]}"; do
    name="${board%%:*}"; def="${board##*:}"
    echo "=============================================================="
    echo " Board: $name   ($def)"
    echo "=============================================================="
    for tu in "${TUS[@]}"; do
        base="$(basename "$tu")"
        if "$CXX" $STD $def $INC $WARN -fsyntax-only "$tu" 2>/tmp/pardalote_stub_err; then
            echo "  ok    $base"
        else
            echo "  FAIL  $base"
            sed 's/^/        /' /tmp/pardalote_stub_err
            fail=1
        fi
    done
done

echo
if [ "$fail" -eq 0 ]; then
    echo "ALL CLEAN — every target TU parses on every target board."
else
    echo "FAILURES above."
fi

# --- Gesture-mods parity: real board transform vs real JS transform ----------
# Byte-for-byte check that pardaloteApplyModsInPlace() (gesture.h) == the JS
# applyGestureModsLane() (bundle) for scale/speed/crop. Skipped if g++/node or
# the JS bundle is unavailable (keeps the board-only run self-sufficient).
BUNDLE="$HERE/../../lib/pardalote.js"
if command -v node >/dev/null 2>&1 && [ -f "$BUNDLE" ]; then
    echo
    echo "=============================================================="
    echo " Gesture mods parity (scale / speed / crop): board vs JS"
    echo "=============================================================="
    if "$CXX" -std=gnu++17 -I "$STUBS" -I "$SRC/internal" \
           "$HERE/gesture_mods_equiv.cpp" -o /tmp/pardalote_gmods 2>/tmp/pardalote_gmods_err; then
        if diff <(/tmp/pardalote_gmods) <(node "$HERE/gesture_mods_equiv.js" "$BUNDLE") >/dev/null; then
            echo "  ok    board pardaloteApplyModsInPlace == JS applyGestureModsLane (7 cases)"
        else
            echo "  FAIL  board vs JS mods diverge:"
            diff <(/tmp/pardalote_gmods) <(node "$HERE/gesture_mods_equiv.js" "$BUNDLE") | sed 's/^/        /'
            fail=1
        fi
    else
        echo "  FAIL  gesture_mods_equiv.cpp did not compile:"
        sed 's/^/        /' /tmp/pardalote_gmods_err
        fail=1
    fi
fi

exit $fail
