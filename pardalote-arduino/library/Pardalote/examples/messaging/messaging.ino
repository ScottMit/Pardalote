// ==============================================================
// Pardalote — messaging example
//
// Named key/value messages between the sketch and the browser, not
// tied to any pin or hardware device:
//
//   Pardalote.send(key, value, flags)  — send a value (any type)
//   Pardalote.watch(key, cb)           — handle one key
//   Pardalote.onMessage(cb)            — handle every key
//
// This sketch drives the built-in LED from a "led" message and sends
// a retained "uptime" counter once a second (retained = browsers that
// connect later immediately get the current value).
//
// See examples/messaging-example/ in the project repo for the matching
// index.html / sketch.js.
// ==============================================================

#include <Pardalote.h>

unsigned long lastTick = 0;

void onLed(const Message& m) {
    digitalWrite(LED_BUILTIN, m.asBool() ? HIGH : LOW);
}

void setup() {
    Pardalote.begin();
    pinMode(LED_BUILTIN, OUTPUT);
    Pardalote.watch("led", onLed);
}

void loop() {
    Pardalote.run();

    if (millis() - lastTick >= 1000) {
        lastTick += 1000;
        Pardalote.send("uptime", (int)(millis() / 1000), MSG_FLAG_RETAIN);
    }
}
