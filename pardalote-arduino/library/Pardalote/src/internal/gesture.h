// ==============================================================
// internal/gesture.h
// Sketch-callable gesture support — the Arduino half of the JS
// gesture() / group.gesture() API. "Whoever speaks is in control":
// the board composes-and-plays a segment schedule exactly as the
// browser does, so a sketch can run expressive motion with no JS.
//
//   - PardaloteSeg       : the public, sketch-authored segment.
//   - the starter registry : a decoupled, opt-in seam (mirrors the
//     extension registry) that lets the group builder start a
//     gesture on ANY actuator type by DEVICE_* id, without a
//     compile-time dependency on the extension classes.
//   - PardaloteGesture   : the coordinated multi-lane builder — the
//     board-side counterpart of JS group.gesture() (pads uneven
//     lanes to a shared duration, one phase-locked start).
//
// Included by Pardalote.h, so every extension header (which all
// #include "Pardalote.h") sees PardaloteSeg + INSTALL_GESTURE. Each
// gesture-capable extension defines a static startGesture() and
// registers it with INSTALL_GESTURE at the bottom of its header.
// ==============================================================

#ifndef PARDALOTE_INTERNAL_GESTURE_H
#define PARDALOTE_INTERNAL_GESTURE_H

#include <Arduino.h>
#include "defs.h"   // CURVE_*, GESTURE_FLAG_*, DEVICE_*

// -------------------------------------------------------------------
// A sketch-authored gesture segment. Same field layout as each
// extension's private Seg, so startGesture() copies field-by-field —
// the same shape the wire handler unpacks from a JS gesture() frame,
// so a board-authored gesture plays identically to a JS-authored one.
//
//   curve  — CURVE_LINEAR / CURVE_EASE_IN / _OUT / _IN_OUT / CURVE_BACK
//   dur    — segment duration, ms (0 is treated as 1)
//   value  — ABSOLUTE target by default (GESTURE_FLAG_ABSOLUTE), or a
//            RELATIVE delta off the live position when flags == 0.
//            Native units per actuator: servo degrees, stepper steps,
//            bus-servo counts (same as write()/moveTo()/write()).
//
// Because Pardalote is 32-bit only (ESP32 / UNO R4), a
// `static const PardaloteSeg wave[] = {...}` lives in flash and is
// read directly — no PROGMEM / pgm_read, ~0 RAM for canned gestures.
// -------------------------------------------------------------------
struct PardaloteSeg {
    uint8_t  curve;
    uint16_t dur;
    int32_t  value;
};

// Sketch callback fired when a gesture's last segment lands — the board-side
// counterpart of JS whenDone(). Lets a headless sketch SEQUENCE gestures
// (jump -> land -> idle) with no browser. `id` is the actuator's logical id.
// Registered per actuator via <Actuator>.onGestureDone(id, cb); nullptr = none.
typedef void (*PardaloteGestureDone)(int id);

// Sum a lane's authored duration (0 durations count as 1, matching the
// board's /0 guard). Used by the builder to find the group's maxTotal.
static inline uint32_t pardaloteGestureTotal(const PardaloteSeg* segs, uint8_t count) {
    uint32_t t = 0;
    for (uint8_t i = 0; i < count; i++) t += segs[i].dur ? segs[i].dur : 1;
    return t;
}

// -------------------------------------------------------------------
// Starter registry — one function per gesture-capable device type.
//
//   startMs — shared timebase so a coordinated group starts phase-locked
//             (time-clocked actuators use it; the bus servo, which is
//             arrival-clocked, ignores it).
//   padToMs — pad this lane with a trailing hold so it lasts padToMs
//             (0 = no padding — a single-actuator gesture()). Mirrors JS
//             group.gesture()'s "arrive together" trailing-hold.
//
// Storage + bodies live in extensions.cpp (shared across the sketch and
// library TUs, exactly like the extension registry).
// -------------------------------------------------------------------
typedef void (*GestureStarter)(int id, const PardaloteSeg* segs, uint8_t count,
                               uint8_t flags, uint32_t startMs, uint32_t padToMs);

void registerGestureStarter(uint16_t deviceId, GestureStarter start);
void startGestureFor(uint16_t deviceId, int id, const PardaloteSeg* segs,
                     uint8_t count, uint8_t flags, uint32_t startMs, uint32_t padToMs);

// Place at the bottom of a gesture-capable extension header, next to
// INSTALL_EXTENSION. Registers the extension's startGesture() during
// static init (before setup()), so the group builder can reach it.
#define INSTALL_GESTURE(deviceId, starterFn)                    \
    static bool _gest_reg_##deviceId =                          \
        (registerGestureStarter(deviceId, starterFn), true);

// Immediate-write registry — the write() half of the coordinated builder
// (writeTimed() reuses the gesture starter above: a timed write is a one-
// segment linear gesture). Each actuator registers a "go to target NOW"
// function (cancels any running gesture, clamps, echoes to the browser).
typedef void (*ImmediateWriter)(int id, int32_t target);
void registerImmediateWriter(uint16_t deviceId, ImmediateWriter write);
void writeImmediateFor(uint16_t deviceId, int id, int32_t target);

#define INSTALL_WRITER(deviceId, writerFn)                      \
    static bool _wr_reg_##deviceId =                            \
        (registerImmediateWriter(deviceId, writerFn), true);

// -------------------------------------------------------------------
// PardaloteGesture — coordinated multi-actuator gesture (the board-side
// counterpart of JS group.gesture()). Collects one lane per actuator,
// pads every lane to the longest so they ARRIVE TOGETHER, and starts
// them all under one millis() (tighter than JS: no wire latency between
// lanes). Cross-type lanes work via the DEVICE_* starter registry, so
// the builder has no compile-time dependency on the extension classes.
//
//   static const PardaloteSeg shoulderG[] = { ... };
//   static const PardaloteSeg wristG[]    = { ... };
//   Pardalote.gesture()
//       .add(DEVICE_SERVO, shoulder, shoulderG, 2)   // absolute by default
//       .add(DEVICE_SERVO, wrist,    wristG,    1)    // shorter → padded
//       .play();
//
// Note: every actuator type is now time-clocked (bus servos render their
// segments with a board-side streaming interpolator), so lanes stay phase-
// locked and arrive together.
// -------------------------------------------------------------------
class PardaloteGesture {
    static const uint8_t MAX_LANES = 12;
    struct Lane {
        uint16_t           dev;
        int                id;
        const PardaloteSeg* segs;
        uint8_t            count;
        uint8_t            flags;
        uint32_t           total;
    };
    Lane    _lanes[MAX_LANES];
    uint8_t _n = 0;

public:
    // Add one actuator's lane. deviceId is DEVICE_SERVO / DEVICE_STEPPER /
    // DEVICE_BUSSERVO. absolute=false makes value a relative delta.
    PardaloteGesture& add(uint16_t deviceId, int id, const PardaloteSeg* segs,
                          uint8_t count, bool absolute = true) {
        if (_n < MAX_LANES && segs && count) {
            _lanes[_n++] = { deviceId, id, segs, count,
                             (uint8_t)(absolute ? GESTURE_FLAG_ABSOLUTE : 0),
                             pardaloteGestureTotal(segs, count) };
        }
        return *this;
    }

    // Start every lane, padded to the longest, under one shared clock.
    void play() {
        uint32_t maxTotal = 0;
        for (uint8_t i = 0; i < _n; i++)
            if (_lanes[i].total > maxTotal) maxTotal = _lanes[i].total;
        uint32_t now = millis();
        for (uint8_t i = 0; i < _n; i++) {
            const Lane& L = _lanes[i];
            startGestureFor(L.dev, L.id, L.segs, L.count, L.flags, now, maxTotal);
        }
    }
};

// -------------------------------------------------------------------
// PardaloteWrite — coordinated one-shot write/writeTimed across actuators,
// the board-side counterpart of JS arduino.write() / arduino.writeTimed().
// Add one target per actuator, then play() them together:
//
//   Pardalote.write().add(DEVICE_SERVO, pan, 90)
//                    .add(DEVICE_STEPPER, lift, 800).play();          // immediate
//   Pardalote.writeTimed(1500).add(DEVICE_SERVO, pan, 90)
//                             .add(DEVICE_SERVO, tilt, 45).play();    // arrive together
//
// dur == 0 (write) dispatches each lane to its registered ImmediateWriter.
// dur  > 0 (writeTimed) plays each lane as a ONE-segment linear gesture via
// the gesture starter, so every actuator type gets its native timed move and
// they arrive together — zero duplicated timing code.
//
// (Values are each actuator's native units, same as gesture(): servo degrees,
// stepper steps, bus-servo counts. Bus lanes are written individually rather
// than coalesced into one SyncWrite — same as the gesture builder; on-board
// the writes are microseconds apart, so they are effectively coordinated.)
// -------------------------------------------------------------------
class PardaloteWrite {
    static const uint8_t MAX_LANES = 12;
    struct Lane { uint16_t dev; int id; int32_t target; };
    Lane     _lanes[MAX_LANES];
    uint8_t  _n = 0;
    uint32_t _dur;

public:
    explicit PardaloteWrite(uint32_t durMs = 0) : _dur(durMs) {}

    PardaloteWrite& add(uint16_t deviceId, int id, int32_t target) {
        if (_n < MAX_LANES) _lanes[_n++] = { deviceId, id, target };
        return *this;
    }

    void play() {
        uint32_t now = millis();
        for (uint8_t i = 0; i < _n; i++) {
            const Lane& L = _lanes[i];
            if (_dur == 0) {
                writeImmediateFor(L.dev, L.id, L.target);
            } else {
                // A timed write is a single absolute linear segment.
                PardaloteSeg seg = { CURVE_LINEAR,
                                     (uint16_t)(_dur > 0xFFFF ? 0xFFFF : _dur),
                                     L.target };
                startGestureFor(L.dev, L.id, &seg, 1, GESTURE_FLAG_ABSOLUTE, now, 0);
            }
        }
    }
};

#endif
