// ==============================================================
// Pardalote — Shared Bus Servo
//
// The SKETCH creates the bus servo binding:
//
//     wrist = PardaloteBusServo.attach("wrist", SERVO_ID);
//
// and the browser sees it automatically as arduino.wrist — a full
// BusServo instance, identical to one created with arduino.add().
// No JS-side setup at all.
//
// Both sides then drive the same servo: this sketch rocks it between
// two positions, and the browser can write() its own target at any
// time. Last writer wins; both stay in sync (sketch writes are
// auto-echoed to the browser as the target).
//
// Requires the Feetech / Waveshare SCServo library (SMS_STS + SCSCL).
//
// Wiring:
//   Feetech ST/SC bus servo on the shared UART (Serial1 by default,
//   1 Mbps) — typically via a Waveshare Serial Bus Servo driver board.
//   SERVO_ID is the hardware ID (1–253); PardaloteBusServo.scan() finds
//   what's on the bus. For an SC-series servo, pass BUSSERVO_SERIES_SC:
//     wrist = PardaloteBusServo.attach("wrist", 5, BUSSERVO_SERIES_SC);
// ==============================================================

#include <Pardalote.h>
#include <PardaloteBusServo.h>

const int SERVO_ID = 1;      // the servo's address on the bus (see scan())

int wrist = -1;              // logical id, assigned by attach()
unsigned long lastMove = 0;
bool atHigh = false;

void setup() {
    Pardalote.begin();

    // Adopt the bus servo (by its bus id) into a named Pardalote instance,
    // visible to every browser as arduino.wrist. Returns the logical id —
    // the handle write()/read() take below.
    wrist = PardaloteBusServo.attach("wrist", SERVO_ID);
}

void loop() {
    Pardalote.run();

    // Every 3 s, move to the other pose (raw counts: ST 0–4095, SC 0–1023).
    // The browser's arduino.wrist.target follows automatically.
    if (millis() - lastMove > 3000) {
        lastMove = millis();
        atHigh = !atHigh;
        PardaloteBusServo.write(wrist, atHigh ? 3000 : 1000);
    }
}
