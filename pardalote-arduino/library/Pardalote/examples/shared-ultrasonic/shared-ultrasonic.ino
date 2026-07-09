// ==============================================================
// Pardalote — Shared Ultrasonic
//
// The SKETCH creates the sensor:
//
//     front = PardaloteUltrasonic.attach("front", TRIG, ECHO);
//
// and the browser sees it automatically as arduino.front — a full
// Ultrasonic instance, identical to one created with arduino.add().
// No JS-side setup at all.
//
// The sketch reads the sensor locally (e.g. to react on-board) while
// the browser can poll arduino.front on its own timer. read() blocks
// in pulseIn() up to the timeout, so read at a modest rate.
//
// Wiring (HC-SR04, 4-wire):
//   TRIG → TRIG pin, ECHO → ECHO pin, 5 V + GND.
//   3-wire sensor: attach("front", TRIG) — echo shares the trig pin.
// ==============================================================

#include <Pardalote.h>
#include <PardaloteUltrasonic.h>

const int TRIG = 7;
const int ECHO = 8;

int front = -1;                   // logical id, assigned by attach()
unsigned long lastRead = 0;

void setup() {
    Pardalote.begin();

    // Create the sensor and make it visible to every browser as arduino.front.
    front = PardaloteUltrasonic.attach("front", TRIG, ECHO);
}

void loop() {
    Pardalote.run();

    // Read on-board a few times a second (returns cm, -1 on timeout).
    if (millis() - lastRead > 200) {
        lastRead = millis();
        float cm = PardaloteUltrasonic.read(front);
        if (cm >= 0 && cm < 15) Serial.println(F("object close"));
    }
}
