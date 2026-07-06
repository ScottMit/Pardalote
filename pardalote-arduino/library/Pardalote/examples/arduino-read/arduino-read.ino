// ==============================================================
// Pardalote — Arduino-side reads example
//
// Read the actuators the *browser* configured, from the sketch, and use
// their positions to trigger things on the Arduino. Each actuator type is
// a small "bus" object: scan() lists what's there, read(id) reads one.
//
//   PardaloteServo     — PWM servos, addressed by logical id (add() order)
//   PardaloteStepper   — steppers,   addressed by logical id
//   PardaloteBusServo  — bus servos, addressed by hardware servo ID
//
// This sketch lights the built-in LED when bus servo ID 1 passes the
// halfway point — while the browser keeps driving it.
// ==============================================================

#include <Pardalote.h>
#include <PardaloteBusServo.h>

void setup() {
    Pardalote.begin();
    pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
    Pardalote.run();

    // A bus read is a blocking transaction, so throttle it (don't read every loop).
    static unsigned long last = 0;
    if (millis() - last >= 50) {
        last = millis();

        int pos = PardaloteBusServo.read(1);          // servo ID 1, position in counts
        if (pos >= 0) digitalWrite(LED_BUILTIN, pos > 2048 ? HIGH : LOW);
    }

    // Discover which servos are on the bus (blocking — do it in setup or rarely):
    //   uint8_t ids[16];
    //   int n = PardaloteBusServo.scan(ids, 16);
    //
    // PWM servos / steppers read the same way, by logical id (add() order):
    //   int angle = PardaloteServo.read(0);
    //   long step = PardaloteStepper.read(0);
    //
    // The same objects also WRITE (the browser and sketch share the actuator):
    //   PardaloteServo.write(0, 90);          // angle
    //   PardaloteStepper.moveTo(0, 2000);     // steps
    //   PardaloteBusServo.write(1, 2048);     // counts, by hardware ID
}
