// ==============================================================
// Pardalote — Shared NeoPixel
//
// The SKETCH creates the strip:
//
//     ring = PardaloteNeoPixel.attach("ring", PIN, COUNT);
//
// and the browser sees it automatically as arduino.ring — a full
// NeoPixel instance, identical to one created with arduino.add().
// No JS-side setup at all.
//
// This sketch runs a slow colour cycle; a connecting browser gets the
// strip and its current colours (via announce) and can drive it too.
//
// Requires the Adafruit NeoPixel library.
//
// Wiring:
//   Strip data on PIN (through a ~330Ω resistor), 5 V + GND. Power the
//   strip from a supply sized for its pixel count, not the board's 5V.
// ==============================================================

#include <Pardalote.h>
#include <PardaloteNeoPixel.h>

const int PIN   = 6;
const int COUNT = 24;

int ring = -1;                    // logical id, assigned by attach()
unsigned long lastStep = 0;
int hue = 0;

void setup() {
    Pardalote.begin();

    // Create the strip and make it visible to every browser as arduino.ring.
    ring = PardaloteNeoPixel.attach("ring", PIN, COUNT);
    PardaloteNeoPixel.brightness(ring, 40);
}

void loop() {
    Pardalote.run();

    // Every 40 ms, roll a simple R→G→B fade across the whole strip.
    if (millis() - lastStep > 40) {
        lastStep = millis();
        hue = (hue + 8) % 768;
        int r = 0, g = 0, b = 0;
        if      (hue < 256) { r = 255 - hue;        g = hue;             }
        else if (hue < 512) { g = 511 - hue;        b = hue - 256;       }
        else                { b = 767 - hue;        r = hue - 512;       }
        PardaloteNeoPixel.fill(ring, r, g, b);
        PardaloteNeoPixel.show(ring);       // buffered — nothing lights up until show()
    }
}
