# Shared Input — Potentiometer

The Arduino tells the browser "I have an analog input on A0 — start polling it." The browser does nothing more than listen. A turn of the knob shows up live on screen.

## What this example demonstrates

The companion to [shared-control-example](../shared-control-example/). That one showed the Arduino *pushing* values to the browser; this one shows the Arduino *announcing* a pin so the browser auto-starts polling — without any `pinMode` or `analogRead` call on the JS side.

The minimal Arduino sketch:

```cpp
void setup() {
    Pardalote.begin();
    pinMode(POT, INPUT);
    Pardalote.share(POT, MODE_ANALOG_INPUT);  // ← tells the browser
}

void loop() {
    Pardalote.run();
    // nothing else — the browser polls, Pardalote.run() handles it
}
```

The minimal browser sketch:

```js
arduino.onChange('A0', value => updateDisplay(value));
```

No `arduino.pinMode`, no `arduino.analogRead`. The polling pipeline is set up automatically when the Arduino's `share(A0, MODE_ANALOG_INPUT)` arrives.

## Hardware

- Arduino UNO R4 WiFi or ESP32 development board
- Potentiometer (10 kΩ is fine; anything in the 1 kΩ – 100 kΩ range works)

Wire it as a voltage divider:

| Pot pin | Connect to |
|---|---|
| Outer 1 | 3.3 V |
| Wiper (centre) | A0 |
| Outer 2 | GND |

## Run it

1. Open `potentiometer.ino` in Arduino IDE, select your board, upload.
2. Find the Arduino's IP from the LED matrix (UNO R4) or Serial Monitor (ESP32).
3. Edit `ARDUINO_IP` in `sketch.js` to match.
4. Open `index.html` in a browser.
5. Turn the pot. The number on screen and the bar should follow it in real time.

## What's happening on the wire

```
Arduino: Pardalote.share(A0, MODE_ANALOG_INPUT)
       → CMD_PIN_MODE A0 = ANALOG_INPUT
Browser receives CMD_PIN_MODE:
       → starts a default-interval (200 ms) analogRead poll
       → CMD_ANALOG_READ A0 [interval=200]
Arduino registers the periodic action; every 200 ms:
       → reads A0, broadcasts CMD_ANALOG_READ A0 = <value>
Browser receives CMD_ANALOG_READ:
       → updates cache, fires arduino.onChange('A0', value)
       → display updates
```

The JS code on the page is just the `onChange` handler. The rest of the pipeline was set up by the Arduino's one-line call to `share()`.

## Why this is useful

In a project where the **Arduino sketch is the source of truth** about which pins are wired to what (and the browser is just a viewer), `share()` lets the Arduino describe its hardware setup *to* the browser, instead of every browser sketch having to repeat the wiring knowledge.

Polling rate is 200 ms here (the browser's default). If you want different rates, the browser can override after connect with `arduino.analogRead('A0', 50)` — that just updates the interval; no need to re-declare the mode.
