title: The Arduino sketch
lede: Writing Arduino code alongside the browser — sharing pins, sending values, and driving actuators from the sketch.
---
## The model

The minimal sketch is `Pardalote.begin()` + `Pardalote.run()`, but you can also write Arduino code that reads sensors, drives pins, and runs a state machine — alongside the browser.

> **The Arduino is just another voice in a flat command structure.** Both the Arduino sketch and the browser can read and write any pin using the standard Arduino / JS APIs. Whoever wrote last wins on the actual pin state. There's no pin reservation, no negotiation — your sketch and your JS code share the same hardware and you keep them coherent.

## Pardalote.begin()

Starts Pardalote. Call once in `setup()`. Three forms:

<div class="sig">Pardalote.<span class="fn">begin</span>()</div>
<div class="sig">Pardalote.<span class="fn">begin</span>(key)</div>
<div class="sig">Pardalote.<span class="fn">begin</span>(PARDALOTE_SERIAL)</div>

| Form | What it does |
|---|---|
| `begin()` | The default: joins WiFi (see [WiFi configuration](wifi.html)) and starts the WebSocket server. |
| `begin("key")` | As above, plus a **connection key**: only browsers that pass the same key to [`connect(ip, { key })`](connecting.html#connection-keys) get in. An accident-prevention latch for shared networks — not security (the key travels unencrypted). Up to 32 characters. |
| `begin(PARDALOTE_SERIAL)` | Skips WiFi entirely and talks over the **USB cable** instead — the browser connects with [`connectSerial()`](connecting.html#connectserial). No key concept: holding the cable is access. |

WiFi is the default; serial is an explicit choice. The one exception is the **UNO R4 Minima** — it has no radio, so every `begin()` form starts the serial transport. There is no runtime WiFi→serial failover on WiFi-capable boards.

In serial mode, `Serial.print` from your sketch still works — the output travels between protocol messages and appears in the browser as the [`'log'` event](connecting.html#connectserial) (and in the Serial Monitor as usual when the browser isn't connected). Don't `Serial.write` raw binary; text is fine.

## Pardalote.run()

Services the connection: handles incoming commands, runs polls and timed moves. Call every pass of `loop()` — keep the loop non-blocking so it runs often.

<div class="sig">Pardalote.<span class="fn">run</span>()</div>

## Pardalote.share()

Declares a pin's mode to the browser: "this pin exists, it's in this mode." Doesn't touch the hardware — you still call `pinMode()` yourself.

<div class="sig">Pardalote.<span class="fn">share</span>(pin, mode, [interval], [threshold])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | int | The pin to declare. |
| `mode` | constant | `INPUT`, `OUTPUT`, `INPUT_PULLUP`, `INPUT_PULLDOWN`, or Pardalote's `ANALOG_INPUT_MODE`. |
| `interval` | int | Optional. Registers a **board-owned watch**: values flow to every browser. For analog pins it's the browsers' update rate limit; digital changes transmit immediately. |
| `threshold` | int | Optional. Minimum change worth transmitting (`0` = default: `1` for digital, the ADC noise floor for analog). |

**With an `interval`, the board owns the watch**: values flow to every browser — including ones that connect later — with no JS call and no round trip, and only when the reading has changed by at least `threshold`. The watch survives browser disconnects.

```cpp
Pardalote.share(A0, ANALOG_INPUT_MODE, 50);      // browsers hear changes at most every 50 ms
Pardalote.share(A0, ANALOG_INPUT_MODE, 50, 8);   // …and only changes of 8+ counts
```

**Without an `interval`** (input modes), the browser auto-starts a default-interval (200 ms) poll for the pin — so it still receives values without declaring anything itself. For `OUTPUT` it's purely a declaration (no polling).

## Pardalote.send()

Pushes a value to the browser. The browser caches it, fires `arduino.pin(pin)`'s `'change'` listeners, and makes it available via `arduino.digitalRead(pin)` / `analogRead(pin)`. Doesn't touch the hardware.

<div class="sig">Pardalote.<span class="fn">send</span>(pin, value)</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | int | The pin the value belongs to. |
| `value` | int | The value to push. |

## Example — light switch

An LED controlled by two physical buttons *and* two browser buttons. Either side flips it; both stay in sync. The Arduino calls `share` once and `send` whenever its buttons fire:

```cpp sketch.ino — light switch, Arduino side
#include <Pardalote.h>

const int LIGHT = 13;
const int BTN_ON = 4;
const int BTN_OFF = 5;

void setup() {
    Pardalote.begin();
    pinMode(LIGHT,  OUTPUT);
    pinMode(BTN_ON,  INPUT_PULLUP);
    pinMode(BTN_OFF, INPUT_PULLUP);
    Pardalote.share(LIGHT, OUTPUT);
}

void loop() {
    Pardalote.run();
    if (button_on_pressed) {
        digitalWrite(LIGHT, HIGH);
        Pardalote.send(LIGHT, HIGH);
    }
    // ... mirror for off ...
}
```

The browser writes the same pin and listens for changes, so a press on either side keeps both in sync:

```javascript sketch.js — light switch, browser side
// Browser → Arduino: the on-screen buttons write the pin
onBtn.onclick  = () => arduino.digitalWrite(LIGHT, HIGH);
offBtn.onclick = () => arduino.digitalWrite(LIGHT, LOW);

// Arduino → browser: a change from either side lands here
arduino.pin(LIGHT).on('change', ({ value }) => {
    lightEl.textContent = value ? 'ON' : 'OFF';
});
```

## Example — potentiometer

The Arduino announces an analog input; the browser receives values automatically with no JS-side setup:

```cpp sketch.ino — announce an analog input
#include <Pardalote.h>

void setup() {
    Pardalote.begin();
    pinMode(A0, INPUT);
    Pardalote.share(A0, ANALOG_INPUT_MODE);   // browser auto-starts polling
}

void loop() {
    Pardalote.run();   // that's it — browser's polls are handled here
}
```

```javascript sketch.js — receive with no setup
arduino.pin('A0').on('change', ({ value }) => updateDisplay(value));   // no pinMode, no analogRead
```

## When not to share

Not every pin needs to be shared. In the light-switch example the two button pins are only used by the Arduino — the browser has its own buttons, so there's no reason to tell it about the physical ones. Share only the pins you want the browser to see.

`Pardalote.send(pin, value)` above is really one special case of a more general idea. The same `send` verb, given a **string key** instead of a pin number, becomes the **[message channel](messaging.html#arduino-to-javascript)**: `send(key, value)` pushes any named key/value to the browser — symmetric in both directions and carrying every basic type. Pushing a pin's value is just the pin-shaped form of it; use a string key for anything that isn't tied to a pin or a device.

See also: [Messaging](messaging.html) · [Extensions overview](extensions.html) · [Servo](servo.html) · [Stepper](stepper.html) · [Bus servo](bus-servo.html)
