// ==============================================================
// Pardalote — Shared Control: Light Switch
//
// An LED on pin 13 is controlled by *both* physical buttons wired to
// the Arduino *and* on/off buttons in the browser. Either side can flip
// the light; both stay in sync.
//
// Wiring:
//   LED   on pin 13 (built-in on most boards)
//   BTN_ON  on pin 7  → GND   (uses INPUT_PULLUP)
//   BTN_OFF on pin 8  → GND   (uses INPUT_PULLUP)
// ==============================================================

#include <Pardalote.h>

const int LIGHT  = 13;
const int BTN_ON = 7;
const int BTN_OFF = 8;

bool lastOn  = HIGH;   // INPUT_PULLUP: idle is HIGH, press pulls LOW
bool lastOff = HIGH;

void setup() {
    Pardalote.begin();
    pinMode(LIGHT,  OUTPUT);
    pinMode(BTN_ON,  INPUT_PULLUP);
    pinMode(BTN_OFF, INPUT_PULLUP);

    // Tell the browser pin 13 is OUTPUT so it doesn't need to declare it.
    Pardalote.share(LIGHT, OUTPUT);
}

void loop() {
    Pardalote.run();

    // Edge-detect each button press (don't re-fire while held)
    bool nowOn  = digitalRead(BTN_ON);
    bool nowOff = digitalRead(BTN_OFF);

    if (nowOn == LOW && lastOn == HIGH) {
        digitalWrite(LIGHT, HIGH);
        Pardalote.send(LIGHT, HIGH);   // tell the browser the light is on
    }
    if (nowOff == LOW && lastOff == HIGH) {
        digitalWrite(LIGHT, LOW);
        Pardalote.send(LIGHT, LOW);
    }

    lastOn  = nowOn;
    lastOff = nowOff;
}
