// ==============================================================
// Pardalote — minimal sketch
//
// The sketch itself does nothing but start Pardalote. All pin
// configuration and output comes from the browser-side sketch:
//
//   arduino.pinMode(13, OUTPUT);
//   arduino.digitalWrite(13, HIGH);
//
// This one sketch powers several browser examples in the project
// repo: examples/control-panel/, examples/basic-light-switch/ and
// examples/potentiometer-p5js/.
// ==============================================================

#include <Pardalote.h>

void setup() {
    Pardalote.begin();
    // No WiFi handy? Use the USB cable instead (control-panel's USB mode):
    //   Pardalote.begin(PARDALOTE_SERIAL);
}

void loop() {
    Pardalote.run();
}
