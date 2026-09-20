// ==============================================================
// Board vs JS parity for gesture mods (scale / speed / crop).
//
// Compiles the REAL board transform — pardaloteApplyModsInPlace() from
// internal/gesture.h (via the Arduino stub) — and dumps its output for a set of
// cases. gesture_mods_equiv.js dumps the REAL JS applyGestureModsLane() from the
// bundle for the SAME cases; run.sh diffs the two. No hand-replicated logic, so
// the JS↔board maths (order, rounding, pardaloteEase↔curveShape) can't drift.
//
// Build:  g++ -std=gnu++17 -I stubs -I <src>/internal gesture_mods_equiv.cpp
// ==============================================================
#include <cstdio>
#include "gesture.h"

static PardaloteGestureMod M(float sc, float sp, float cf, float ct) {
    PardaloteGestureMod m; m.scale = sc; m.speed = sp; m.cropFrom = cf; m.cropTo = ct; return m;
}

static void run(const char* name, const PardaloteSeg* src, uint8_t n, uint8_t flags, PardaloteGestureMod m) {
    PardaloteSeg buf[16];
    for (uint8_t i = 0; i < n; i++) buf[i] = src[i];
    uint8_t k = pardaloteApplyModsInPlace(buf, n, flags, m);
    printf("%s|%u", name, k);
    for (uint8_t i = 0; i < k; i++) printf("|%u,%u,%d", buf[i].curve, buf[i].dur, buf[i].value);
    printf("\n");
}

int main() {
    const uint8_t IO = CURVE_EASE_IN_OUT, BK = CURVE_BACK;
    // A relative "nod": down/up/down/up-settle (values are deltas).
    PardaloteSeg nod[4]    = {{IO,260,190},{IO,260,-190},{IO,260,130},{BK,260,-130}};
    // The same shape as absolute targets.
    PardaloteSeg nodAbs[4] = {{IO,260,1858},{IO,260,2048},{IO,260,1918},{BK,260,2048}};

    run("identity",  nod, 4, 0, M(1.0f, 1.0f, 0.0f, 1.0f));
    run("scale.5",   nod, 4, 0, M(0.5f, 1.0f, 0.0f, 1.0f));
    run("speed2",    nod, 4, 0, M(1.0f, 2.0f, 0.0f, 1.0f));
    run("speed.5",   nod, 4, 0, M(1.0f, 0.5f, 0.0f, 1.0f));
    run("crop.2-.8", nod, 4, 0, M(1.0f, 1.0f, 0.2f, 0.8f));
    run("combo",     nod, 4, 0, M(0.7f, 1.5f, 0.1f, 0.9f));
    run("abs-combo", nodAbs, 4, GESTURE_FLAG_ABSOLUTE, M(0.5f, 2.0f, 0.25f, 0.75f));
    return 0;
}
