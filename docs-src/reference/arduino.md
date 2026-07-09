title: The Arduino sketch
lede: Writing Arduino code alongside the browser — sharing pins, sending values, and driving actuators from the sketch.
---
## The model

The minimal sketch is `Pardalote.begin()` + `Pardalote.run()`, but you can also write Arduino code that reads sensors, drives pins, and runs a state machine — alongside the browser.

> **The Arduino is just another voice in a flat command structure.** Both the Arduino sketch and the browser can read and write any pin using the standard Arduino / JS APIs. Whoever wrote last wins on the actual pin state. There's no pin reservation, no negotiation — your sketch and your JS code share the same hardware and you keep them coherent.

## Pardalote.begin()

Starts Pardalote: joins WiFi (see [WiFi configuration](wifi.html)) and starts the WebSocket server. Call once in `setup()`.

<div class="sig">Pardalote.<span class="fn">begin</span>()</div>

## Pardalote.run()

Services the connection: handles incoming commands, runs polls and timed moves. Call every pass of `loop()` — keep the loop non-blocking so it runs often.

<div class="sig">Pardalote.<span class="fn">run</span>()</div>

## Pardalote.share()

Declares a pin's mode to the browser: "this pin exists, it's in this mode." Doesn't touch the hardware — you still call `pinMode()` yourself.

<div class="sig">Pardalote.<span class="fn">share</span>(pin, mode)</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | int | The pin to declare. |
| `mode` | constant | `INPUT`, `OUTPUT`, `INPUT_PULLUP`, `INPUT_PULLDOWN`, or Pardalote's `MODE_ANALOG_INPUT`. |

**For input modes, the browser auto-starts a default-interval (200 ms) poll for the pin** — so the browser starts receiving values without declaring anything itself. For `OUTPUT` it's purely a declaration (no polling).

## Pardalote.send()

Pushes a value to the browser. The browser caches it, fires `arduino.onChange(pin, …)` handlers, and makes it available via `arduino.digitalRead(pin)` / `analogRead(pin)`. Doesn't touch the hardware.

<div class="sig">Pardalote.<span class="fn">send</span>(pin, value)</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | int | The pin the value belongs to. |
| `value` | int | The value to push. |

## Example — light switch

An LED controlled by two physical buttons *and* two browser buttons. Either side flips it; both stay in sync. The Arduino calls `share` once and `send` whenever its buttons fire:

```cpp sketch.ino — light switch, Arduino side
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

## Example — potentiometer

The Arduino announces an analog input; the browser receives values automatically with no JS-side setup:

```cpp sketch.ino — announce an analog input
void setup() {
    Pardalote.begin();
    pinMode(A0, INPUT);
    Pardalote.share(A0, MODE_ANALOG_INPUT);   // browser auto-starts polling
}

void loop() {
    Pardalote.run();   // that's it — browser's polls are handled here
}
```

```javascript sketch.js — receive with no setup
arduino.onChange('A0', value => updateDisplay(value));   // no pinMode, no analogRead
```

## When not to share

Not every pin needs to be shared. In the light-switch example the two button pins are only used by the Arduino — the browser has its own buttons, so there's no reason to tell it about the physical ones. Share only the pins you want the browser to see.

## Creating actuators from the sketch

The sketch can create a servo itself — and every browser receives it automatically, as a full `Servo` instance named `arduino.<name>`, identical to one created with `arduino.add()`.

<div class="sig">PardaloteServo.<span class="fn">attach</span>(name, pin, minPulse?, maxPulse?)</div>

| Parameter | Type | Description |
|---|---|---|
| `name` | string | The browser-side name — `arduino.<name>`. Max 15 chars. |
| `pin` | int | The servo signal pin. |
| `minPulse` | int | Optional pulse range, default 544. |
| `maxPulse` | int | Optional pulse range, default 2400. |

**Returns** the logical id for the `write()` / `read()` calls below, or −1 if no slot is free.

```cpp sketch.ino — the sketch creates a servo
#include <Pardalote.h>
#include <PardaloteServo.h>

int pan;

void setup() {
    Pardalote.begin();
    pan = PardaloteServo.attach("pan", 9);   // arduino.pan now exists in every browser
    PardaloteServo.write(pan, 90);
}
```

The object exists in the browser before `'ready'` fires, and browsers that connect later get it too. `arduino.on('share', ({ name, extension }) => …)` fires the moment it appears. Calling `attach` again with the same name reuses the same servo; names that would collide with the browser core API (like `"connect"`) are refused with a console warning.

Unlike raw pins, there's no separate `share()` step — a Pardalote servo has no life outside Pardalote, so creating it *is* sharing it. A servo that should stay private to the sketch shouldn't go through Pardalote at all: use the plain `Servo`/`ESP32Servo` library directly, the way unshared pins just use `pinMode()`.

*(Currently servos; steppers and bus servos will follow the same pattern.)*

## The actuator objects

`share`/`send` cover raw pins. For the **extension actuators** — browser-configured or sketch-created — each type gives the sketch a small **bus object**. The browser and the sketch share the same actuator (last writer wins), just as they share raw pins.

| Object | `scan()` returns | `read(id)` returns | `id` is |
|---|---|---|---|
| `PardaloteServo` | attached servo ids | angle (0–180) | logical id (`arduino.add()` order, or returned by sketch `attach`) |
| `PardaloteStepper` | attached stepper ids | position (steps) | logical id |
| `PardaloteBusServo` | responding servo ids | position (counts) | **hardware** servo ID |

### scan()

Lists what's there.

<div class="sig">Pardalote<i>Type</i>.<span class="fn">scan</span>(buffer, maxCount)</div>

| Parameter | Type | Description |
|---|---|---|
| `buffer` | int[] / uint8_t[] | Array to fill with ids. |
| `maxCount` | int | Size of the array. |

**Returns** the number of ids written. For `PardaloteBusServo`, `scan()` pings the bus.

```cpp
int ids[8];
int n = PardaloteServo.scan(ids, 8);
for (int i = 0; i < n; i++) Serial.println(PardaloteServo.read(ids[i]));
```

### read()

Reads one actuator's position.

<div class="sig">Pardalote<i>Type</i>.<span class="fn">read</span>(id)</div>

**Returns** angle (servo), steps (stepper), or counts (bus servo); negative on failure.

```cpp
#include <Pardalote.h>
#include <PardaloteBusServo.h>

void loop() {
    Pardalote.run();
    int pos = PardaloteBusServo.read(1);   // servo ID 1 → position (counts)
    if (pos >= 0) digitalWrite(LED_BUILTIN, pos > 2048 ? HIGH : LOW);
}
```

### write() and friends

The same objects command the actuators — addressed the same way:

```cpp
PardaloteServo.write(id, 90);            // angle 0–180
PardaloteServo.writeTimed(id, 90, 1000); // over 1 s (board-interpolated)
PardaloteServo.stop(id);

PardaloteStepper.moveTo(id, 2000);       // steps
PardaloteStepper.move(id, -400);
PardaloteStepper.stop(id);

PardaloteBusServo.write(id, 2048);       // counts (optional speed, acc)
PardaloteBusServo.torque(id, false);     // release / hold
```

Servo/stepper writes run through the **same command path the browser uses** (so they respect limits, cancel timed moves, etc.); bus-servo writes go straight to the bus by hardware ID.

### Status helpers

```cpp
PardaloteServo.isMoving(id);          // timed move in progress
PardaloteStepper.distanceToGo(id);
PardaloteStepper.isRunning(id);
PardaloteBusServo.feedback(id);       // position, load, voltage, temperature in one read
PardaloteBusServo.isMoving(id);       // the servo's own Moving flag
PardaloteBusServo.arrived(id);
```

For bus servos, `isMoving(id)` / `arrived(id)` read the servo's own **Moving flag** — its honest "am I still moving?", accounting for deadband and settling. It's one bus read (the servo can't notify you — you ask when you want to know):

```cpp Example — wait for a bus servo to arrive
PardaloteBusServo.write(1, 3000);
while (PardaloteBusServo.isMoving(1)) { /* do other work */ }
// arrived — trigger the next thing
```

## Notes

- A **bus servo read/scan/write is a blocking bus transaction** — fine in `setup()` or a throttled `loop()`, not a tight high-rate loop competing with the browser's own polling.
- **Sketch writes update the browser's record automatically.** A sketch write echoes the commanded value to the browser exactly as if the browser had issued it — a PWM servo sets the browser's `angle`, a stepper or bus servo sets its `target`. The live `position` feedback is separate — that still comes from polling.
- See **File → Examples → Pardalote → arduino-read**.

See also: [Servo](servo.html) · [Stepper](stepper.html) · [Bus servo](bus-servo.html)
