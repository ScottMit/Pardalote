// ==============================================================
// Pardalote — Shared Stepper
//
// The SKETCH creates the stepper:
//
//     base = PardaloteStepper.attach("base", STEP_PIN, DIR_PIN, EN_PIN);
//
// and the browser sees it automatically as arduino.base — a full
// Stepper instance, identical to one created with arduino.add().
// No JS-side setup at all.
//
// Both sides then drive the same motor: this sketch sweeps it between
// two positions, and the browser can issue its own moveTo() at any
// time. Last writer wins; both stay in sync (sketch moves are
// auto-echoed to the browser as the target).
//
// Requires the AccelStepper library (by Mike McCauley):
//   Arduino IDE → Tools → Manage Libraries → search "AccelStepper".
//
// Wiring (STEP/DIR driver — TMC2208/2209, A4988, EasyDriver):
//   driver STEP → STEP_PIN, DIR → DIR_PIN, EN → EN_PIN (optional).
//   Give the motor its own supply — do not power it from the board's 5V.
//   For a 4-wire coil motor (28BYJ-48 via ULN2003) use instead:
//     base = PardaloteStepper.attach4wire("base", 8, 9, 10, 11);
// ==============================================================

#include <Pardalote.h>
#include <PardaloteStepper.h>

const int STEP_PIN = 2;
const int DIR_PIN  = 3;
const int EN_PIN   = 4;      // -1 if your driver has no enable pin

int base = -1;               // logical id, assigned by attach()
unsigned long lastMove = 0;
bool atFar = false;

void setup() {
    Pardalote.begin();

    // Create the stepper and make it visible to every browser as
    // arduino.base. Returns the logical id for the calls below.
    base = PardaloteStepper.attach("base", STEP_PIN, DIR_PIN, EN_PIN);
}

void loop() {
    Pardalote.run();

    // Every 3 s, sweep to the other end. The browser's arduino.base.target
    // follows automatically, and arduino.base.position updates on read().
    if (millis() - lastMove > 3000) {
        lastMove = millis();
        atFar = !atFar;
        PardaloteStepper.moveTo(base, atFar ? 2000 : 0);
    }
}
