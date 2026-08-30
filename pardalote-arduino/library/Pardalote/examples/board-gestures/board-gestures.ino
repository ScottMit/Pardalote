// ==============================================================
// Pardalote — Board Gestures example
// https://github.com/ScottMit/Pardalote
// Copyright (C) 2026 Scott Mitchell — GPL-3.0-or-later. See LICENSE.
//
// Expressive motion authored and run ON THE BOARD — no browser needed.
// Pardalote's rule is "whoever speaks is in control": the browser can
// compose-and-play a gesture (arduino.pan.gesture([...])), and so can the
// sketch. This example is the sketch speaking.
//
// A two-servo "creature head" (pan + tilt) idles on its own, and when a
// button is pressed it startles and settles back — all decided by the
// board. A gesture is an ordered list of eased segments the board plays on
// its own millis() clock; Pardalote.gesture() plays several servos
// phase-locked so they arrive together; onGestureDone() chains one gesture
// into the next for a headless sequence.
//
// Browser side (OPTIONAL — just to watch):
//   The sketch creates the servos, so a connected browser sees them as
//   arduino.pan / arduino.tilt automatically and can take over with a
//   write() at any time (last speaker wins).
//
// Hardware:
//   - Two standard PWM servos on pins 9 (pan) and 10 (tilt).
//   - Optional: a momentary button from pin 2 to GND (uses the internal
//     pull-up). With no button wired the head simply idles forever.
//   - ESP32Servo is used on ESP32; the built-in Servo library elsewhere.
// ==============================================================

#include <Pardalote.h>
#include <PardaloteServo.h>

const int PAN_PIN    = 9;
const int TILT_PIN   = 10;
const int BUTTON_PIN = 2;

int pan, tilt;   // logical ids from attach()

// --- Authored gestures --------------------------------------------------
// Absolute degrees. Because Pardalote is 32-bit only, these const arrays
// live in flash and cost no RAM. { curve, duration-ms, target-degrees }.

// Idle: a slow, easy sweep that loops forever.
static const PardaloteSeg PAN_IDLE[] = {
    { CURVE_EASE_IN_OUT, 1600,  60 },
    { CURVE_EASE_IN_OUT, 1600, 120 },
    { CURVE_EASE_IN_OUT, 1200,  90 },
};
static const PardaloteSeg TILT_IDLE[] = {
    { CURVE_EASE_IN_OUT, 1400,  80 },
    { CURVE_EASE_IN_OUT, 1400, 100 },
    { CURVE_EASE_IN_OUT, 1600,  90 },   // shorter total → padded to arrive with pan
};

// Startle: snap to centre + look up fast, then settle with a little
// overshoot (CURVE_BACK travels just past the target and returns).
static const PardaloteSeg PAN_STARTLE[] = {
    { CURVE_EASE_OUT, 120,  90 },
    { CURVE_BACK,     260,  90 },
};
static const PardaloteSeg TILT_STARTLE[] = {
    { CURVE_EASE_OUT, 120, 140 },   // look up sharply
    { CURVE_BACK,     400,  90 },   // settle back down with a bounce
};

enum Mood { IDLING, STARTLED };
Mood mood = IDLING;

// Play the two-servo idle as ONE coordinated, phase-locked gesture. The
// shorter tilt lane is padded with a trailing hold so both lanes finish
// together (the board-side twin of JS group.gesture()).
void playIdle() {
    Pardalote.gesture()
        .add(DEVICE_SERVO, pan,  PAN_IDLE,  3)
        .add(DEVICE_SERVO, tilt, TILT_IDLE, 3)
        .play();
}

void playStartle() {
    Pardalote.gesture()
        .add(DEVICE_SERVO, pan,  PAN_STARTLE,  2)
        .add(DEVICE_SERVO, tilt, TILT_STARTLE, 2)
        .play();
}

// The pan servo drives the sequence: whenever its lane finishes, decide
// what plays next. (Only pan carries a done-callback, so there's one clear
// place the sequence advances.) A startle just finished → return to idling;
// otherwise loop the idle.
void onPanDone(int /*id*/) {
    if (mood == STARTLED) mood = IDLING;
    playIdle();
}

void setup() {
    Pardalote.begin();
    pinMode(BUTTON_PIN, INPUT_PULLUP);

    // Sketch-created servos — the browser sees these automatically.
    pan  = PardaloteServo.attach("pan",  PAN_PIN);
    tilt = PardaloteServo.attach("tilt", TILT_PIN);

    PardaloteServo.onGestureDone(pan, onPanDone);   // chain gestures headlessly
    playIdle();                                     // start moving on our own
}

void loop() {
    Pardalote.run();

    // Board-authored reaction — no browser involved. On a falling edge
    // (button pressed) while idling, interrupt the idle with a startle;
    // onPanDone() then returns the head to its idle loop.
    static bool wasPressed = false;
    bool pressed = (digitalRead(BUTTON_PIN) == LOW);
    if (pressed && !wasPressed && mood == IDLING) {
        mood = STARTLED;
        playStartle();
    }
    wasPressed = pressed;
}
