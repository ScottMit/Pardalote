// ==============================================================
// Pardalote — basic LED example
//
// The sketch itself does nothing but start Pardalote. All pin
// configuration and output comes from the browser-side sketch:
//
//   arduino.pinMode(13, OUTPUT);
//   arduino.digitalWrite(13, HIGH);
//
// See examples/basic-LED-example/ in the project repo for the
// matching index.html / sketch.js.
// ==============================================================

#include <Pardalote.h>

void setup() {
    Pardalote.begin();
}

void loop() {
    Pardalote.run();
}
