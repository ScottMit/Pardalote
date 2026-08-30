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
exit $fail
