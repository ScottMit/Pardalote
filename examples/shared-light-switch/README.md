# Shared light switch

A light controlled by **both** physical buttons on the Arduino **and** on/off buttons in the browser. Press either side; both stay in sync.

## What this example demonstrates

The library refactor lets your Arduino sketch coexist with the browser as equal peers on the same pins. This example shows the two halves of that contract:

- **Arduino code can change a pin and tell the browser** — `Pardalote.send(pin, value)`
- **Browser can change a pin** — the regular `arduino.digitalWrite(pin, value)` already works
- **Both sides see every change** — whoever was last wins, both UIs reflect it

The Arduino sketch also calls `Pardalote.share(LIGHT, OUTPUT)` once during `setup()` so the browser knows pin 13 is an output without having to declare it itself.

## Hardware

- Arduino UNO R4 WiFi or ESP32 development board
- LED on **pin 13** (built-in on most boards; otherwise add an external LED + 220 Ω resistor)
- Pushbutton on **pin 7** → GND (the "on" button)
- Pushbutton on **pin 8** → GND (the "off" button)

Buttons use `INPUT_PULLUP` — no external resistors needed.

## Run it

1. In Arduino IDE: **File → Examples → Pardalote → shared-light-switch**, select your board, upload.
2. Find the Arduino's IP from the LED matrix (UNO R4) or Serial Monitor (ESP32).
3. Open `index.html` and press **Connect** — enter the IP (or switch to **USB**). No code editing needed; the setting is remembered per browser.
5. Press the physical buttons → the on-screen light follows. Click the browser buttons → the LED follows.

## What's happening under the hood

```cpp
// Arduino side, in loop():
if (button pressed) {
    digitalWrite(LIGHT, HIGH);     // Arduino's own pin API — does the hardware
    Pardalote.send(LIGHT, HIGH);   // tells the browser the new value
}
```

```js
// Browser side:
document.getElementById('on-btn').onclick = () => arduino.digitalWrite(LIGHT, HIGH);
arduino.pin(LIGHT).on('change', ({ value }) => updateLightDisplay(value));
```

`Pardalote.send()` from the Arduino and `arduino.digitalWrite()` from the browser both end up broadcasting the same `CMD_DIGITAL_WRITE` frame. Whoever calls last wins on the actual pin state; every connected browser sees every change.

## Companion example

[shared-potentiometer](../shared-potentiometer/) goes the other direction — the Arduino calls `Pardalote.share(A0, ANALOG_INPUT_MODE)` once, and the browser starts receiving values without writing any `pinMode` / `analogRead` code itself.
