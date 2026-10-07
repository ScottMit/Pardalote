// ==============================================================
// Step-timing simulation — Pardalote's PardaloteStepperMotor (internal/
// paced_stepper.h) on top of the REAL installed AccelStepper, driven by a fake
// microsecond clock and polled the way Pardalote's loop() polls it (one call per
// pass, a fixed pass period plus jitter). Checks the error-compensated timing:
// the achieved rate must match the requested rate even when steps can only land
// on a loop pass. -DSIM_CONTROL runs AccelStepper's own run()/runSpeed() instead
// (expected to FAIL — it reproduces the bench shortfall).
//
// Build+run (run.sh does this; needs AccelStepper 1.64+ source):
//   g++ -std=gnu++17 -DARDUINO=100 -I <AccelStepper/src> -I stubs -I <src>/internal \
//       accel_timing_sim.cpp <AccelStepper/src>/AccelStepper.cpp -o /tmp/sim && /tmp/sim
// Exit 0 = all checks pass.
// ==============================================================
#include <Arduino.h>
#include <cstdio>
#include <cmath>
#include <initializer_list>
#include "paced_stepper.h"

#ifdef SIM_CONTROL
#define RUN_SPEED(s) (s).runSpeed()
#define RUN(s)       (s).run()
#else
#define RUN_SPEED(s) (s).runSpeedPaced()
#define RUN(s)       (s).runPaced()
#endif

// ---- fake Arduino time + pins -------------------------------------------
static unsigned long g_us = 0;
unsigned long micros(void) { return g_us; }
unsigned long millis(void) { return g_us / 1000; }
void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t, uint8_t) {}
void delayMicroseconds(unsigned int) {}

// Deterministic jitter: pass period = base ± 20 %. When g_wsStall is on, the
// loop also stalls ~200 µs once per millisecond — Pardalote's throttled
// WebSocket poll (bench-measured: _ws.loop() ≈ 200 µs, polled ≤ once per ms).
static unsigned long g_seed = 12345;
static bool g_wsStall = false;
static unsigned long g_nextWsUs = 0;
static unsigned long passUs(unsigned long base) {
    g_seed = g_seed * 1103515245UL + 12345UL;
    long j = (long)((g_seed >> 16) % (base * 2 / 5 + 1)) - (long)(base / 5);
    unsigned long p = (unsigned long)((long)base + j);
    if (g_wsStall && g_us >= g_nextWsUs) { p += 200; g_nextWsUs = g_us + 1000; }
    return p;
}

static int g_fail = 0;
static void check(bool ok, const char* what, double got, double want) {
    std::printf("  %-4s %-46s got %9.1f  want %9.1f\n", ok ? "ok" : "FAIL", what, got, want);
    if (!ok) g_fail = 1;
}

// Constant speed: runSpeed() for `ms` at `sps`, loop pass ~`passBase` µs.
static double constantRate(float sps, unsigned long passBase, unsigned long ms) {
    PardaloteStepperMotor s(AccelStepper::DRIVER, 1, 2);
    s.setMaxSpeed(1e6);
    s.setSpeed(sps);
    unsigned long start = g_us;
    while (g_us - start < 200000UL) { RUN_SPEED(s); g_us += passUs(passBase); }   // settle
    long p0 = s.currentPosition(); unsigned long t0 = g_us;
    while (g_us - t0 < ms * 1000UL) { RUN_SPEED(s); g_us += passUs(passBase); }
    return (s.currentPosition() - p0) / ((g_us - t0) / 1e6);
}

// Accelerated move: run() from 0 to `d` at max `v`, accel `a`; returns ms.
static double rampMs(long d, float v, float a, unsigned long passBase) {
    PardaloteStepperMotor s(AccelStepper::DRIVER, 1, 2);
    s.setMaxSpeed(v);
    s.setAcceleration(a);
    s.moveTo(d);
    unsigned long t0 = g_us;
    while (s.distanceToGo() != 0 && g_us - t0 < 60000000UL) { RUN(s); g_us += passUs(passBase); }
    return (g_us - t0) / 1000.0;
}

// After a long stall, steps must NOT burst: count back-to-back pass steps.
static int burstAfterStall(float sps, unsigned long passBase, unsigned long stallUs) {
    PardaloteStepperMotor s(AccelStepper::DRIVER, 1, 2);
    s.setMaxSpeed(1e6);
    s.setSpeed(sps);
    for (int i = 0; i < 2000; i++) { RUN_SPEED(s); g_us += passUs(passBase); }
    g_us += stallUs;                                   // the loop was blocked
    int run = 0, worst = 0;
    for (int i = 0; i < 2000; i++) {
        bool stepped = RUN_SPEED(s);
        run = stepped ? run + 1 : 0;
        if (run > worst) worst = run;
        g_us += passUs(passBase);
    }
    return worst;
}

// Handoff from a setSpeed()-driven gesture to run(): play a fast one-segment
// linear gesture the way PardaloteStepper's MODE_EASED does (moveTo + setSpeed
// every ~1 ms pass, then land), finish it, then moveTo(0) and run(). Returns the
// position reached after `ms` — it must be back at 0. `oldFinish` replays the
// pre-2026-10-06 finish (setSpeed(0) + moveTo(current)), which left
// AccelStepper's private accel planner stale: run() then crawls AWAY from 0.
static long gestureThenHome(long dist, unsigned long durMs, bool oldFinish, unsigned long ms) {
    PardaloteStepperMotor s(AccelStepper::DRIVER, 1, 2);
    s.setMaxSpeed(20000); s.setAcceleration(15000);
    s.setMaxSpeed(dist * 1000.0f / durMs);                 // gesture raises the cap
    unsigned long t0 = g_us, tick = g_us;
    while (true) {
        unsigned long el = (g_us - t0) / 1000;
        if (g_us - tick >= 1000) {                          // the loop hook, per pass (sampled per ms here)
            tick = g_us;
            if (el < durMs) {
                s.moveTo(lroundf(dist * (float)el / durMs));
                s.setSpeed(dist * 1000.0f / durMs);
            } else {
                s.moveTo(dist);
                if (s.distanceToGo() == 0) break;
                float v = std::fabs((float)s.distanceToGo()) * 2.0f;   // remaining / 0.5 s
                if (v < dist * 1000.0f / durMs) v = dist * 1000.0f / durMs;
                s.setSpeed(v);
            }
        }
        s.runSpeedToPositionPaced();
        g_us += passUs(40);
    }
    if (oldFinish) { s.setSpeed(0); s.moveTo(s.currentPosition()); }
    else           { s.setCurrentPosition(s.currentPosition()); }
    s.setMaxSpeed(20000);
    s.moveTo(0);
    unsigned long t1 = g_us;
    while (g_us - t1 < ms * 1000UL) { s.runPaced(); g_us += passUs(40); }
    return s.currentPosition();
}

int main() {
    std::printf("Step-timing simulation (PardaloteStepperMotor on AccelStepper)\n");
    const unsigned long P = 30;                        // µs per loop pass (bench: ~28–36 µs)
    for (float v : {1000.0f, 4000.0f, 8000.0f, 12000.0f, 16000.0f}) {
        char what[64]; std::snprintf(what, sizeof what, "constant %.0f steps/s, %lu us passes", v, P);
        double got = constantRate(v, P, 2000);
        check(std::fabs(got - v) <= 0.01 * v, what, got, v);
    }
    // Same speeds with the once-per-ms ~200 µs WebSocket stall (the real bench loop).
    g_wsStall = true;
    for (float v : {8000.0f, 16000.0f}) {
        char what[64]; std::snprintf(what, sizeof what, "constant %.0f steps/s, + 200 us stall per ms", v);
        double got = constantRate(v, P, 2000);
        check(std::fabs(got - v) <= 0.01 * v, what, got, v);
    }
    {
        double ideal = 2000.0 * std::sqrt(25600.0 / 15000.0);
        double ms = rampMs(25600, 20000, 15000, P);
        check(std::fabs(ms - ideal) <= 0.03 * ideal, "ramp 25600 (ms), + 200 us stall per ms", ms, ideal);
    }
    g_wsStall = false;

    // Old 1 ms loop: still exact on average up to the pass rate.
    double got = constantRate(600, 1000, 4000);
    check(std::fabs(got - 600) <= 0.01 * 600, "constant 600 steps/s, 1000 us passes", got, 600);

    // The bench ramp: 25,600 steps at 20,000 / 15,000 — ideal 2 * sqrt(d / a).
    double ideal = 2000.0 * std::sqrt(25600.0 / 15000.0);
    double ms = rampMs(25600, 20000, 15000, P);
    check(std::fabs(ms - ideal) <= 0.03 * ideal, "ramp 25600 @ 20000/15000 (ms), 30 us passes", ms, ideal);

    // A 20 ms stall at 8,000 steps/s must not be followed by a catch-up burst.
    int burst = burstAfterStall(8000, P, 20000);
    check(burst <= 2, "longest back-to-back steps after a 20 ms stall", burst, 2);

    // A routine 200 µs stall at 16,000 steps/s (62.5 µs/step) misses ~3 steps; catching
    // up runs a few steps back-to-back (6 measured). Guard against it growing (≤ 8).
    int catchup = burstAfterStall(16000, P, 200);
    check(catchup <= 8, "back-to-back catch-up steps after a 200 us stall", catchup, 8);

#ifndef SIM_CONTROL
    // Bench 2026-10-06 (soak): after a 12,800-step gesture, moveTo(0) crawled
    // the wrong way for 15+ minutes. Fixed finish must be home within 3 s.
    long home = gestureThenHome(12800, 100, false, 3000);
    check(home == 0, "position 3 s after gesture -> moveTo(0)", home, 0);
    long stale = gestureThenHome(12800, 100, true, 3000);
    std::printf("  (old gesture finish, for comparison: %ld after 3 s)\n", stale);
#endif

    std::printf(g_fail ? "FAILURES above.\n" : "PASS — achieved rates match requested rates.\n");
    return g_fail;
}
