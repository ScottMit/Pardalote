# Pardalote — AI coding guide

> Pardalote is a JavaScript ↔ Arduino library: write browser JavaScript (p5.js-friendly) that drives Arduino hardware — pins, PWM servos, stepper motors, Feetech serial bus servos, NeoPixels, and sensors — over WiFi (WebSocket) or USB serial, with no server and no Node.js. This file is the complete reference for generating Pardalote code. **Read the gotchas below first** — they prevent the mistakes an LLM makes by default. Everything after the preamble is the full generated API reference.

## The 60-second model

- Two sides: **browser JavaScript** (an `Arduino` object plus extensions) and an **Arduino sketch** (the `Pardalote` firmware). They share the same hardware as equals — **last writer wins**.
- You register devices in JS, then drive them by name: `arduino.pan.write(90)`.
- **Motion and reads run ON the Arduino.** You send targets, motion profiles, and gesture schedules; the board does the timing. You never stream individual steps or positions over the link.

## Minimal working project

Three files. `pardalote.js` is the all-in-one bundle (core + every device extension); include it before your sketch.

```html index.html
<script src="pardalote.js"></script>
<script src="sketch.js"></script>
```

```javascript sketch.js (browser)
const arduino = new Arduino();
arduino.add('pan', new Servo());        // register BEFORE connect()
arduino.connect('192.168.1.42');        // or arduino.connectSerial() for USB

arduino.on('ready', () => {             // ALL setup goes here, after the board syncs
    arduino.pan.attach(9);
    arduino.pan.write(90);
});
```

```cpp sketch.ino (Arduino)
#include <Pardalote.h>
#include <PardaloteServo.h>             // one include per extension you use
void setup() { Pardalote.begin(); }     // WiFi + listens on USB; WiFi set at compile-time or
                                        // via the Serial menu. begin(PARDALOTE_WIFI) = WiFi only,
                                        // begin(PARDALOTE_SERIAL) = USB only. Call
                                        // Pardalote.requireKey("key") before begin() to require a key.
void loop()  { Pardalote.run(); }
```

## Gotchas — get these wrong and the code silently fails

1. **All browser setup goes inside `arduino.on('ready', …)`.** Calling `attach()` / `pinMode()` before the board has synced does nothing. Pin aliases like `'A0'` also only resolve after `ready`.
2. **Register extensions BEFORE `connect()`** with `arduino.add(name, new Type())`. `arduino.<name>` exists immediately, but can't touch hardware until `ready`.
3. **`read()` is a poll, not a getter.** The first `read()` starts a board-side poll and returns the *cached* value (0 until the first reading arrives). Call it once to start, then read the cached value or the property (e.g. `servo.angle`, `stepper.position`) in your draw loop. Do **not** expect a fresh synchronous value from each call. `read(END)` stops the poll.
4. **Never stream motion.** For smooth movement use `writeTimed(target, ms)` or `gesture([...])` — the board interpolates. Do **not** write a `setInterval` / draw-loop that streams positions; it floods the link and is the exact anti-pattern the library exists to avoid.
5. **Units are native per actuator:** PWM servo = degrees (0–180), stepper = steps, bus servo = raw counts (ST 0–4095, SC 0–1023). Use the degree/revolution helpers where provided.
6. **Await real arrival with `whenDone()`**, not a timer: `await arduino.x.moveTo(2000).whenDone();`. It works on every actuator and on groups, and resolves on the actuator's real `done` (feedback-confirmed).
7. **State is shared and multi-client.** The sketch and every connected browser see the same hardware; a value you write can be overwritten by the sketch or another browser (last writer wins).

## Actuators at a glance

| Actuator | JS class | Unit | Move now | Timed move | Expressive |
|---|---|---|---|---|---|
| PWM servo | `Servo` | degrees | `write(a)` | `writeTimed(a, ms)` | `gesture([...])` |
| Stepper | `Stepper` | steps | `moveTo(n)` / `move(d)` | `moveToTimed(n, ms)` | `gesture([...])` |
| Bus servo | `BusServo` | counts | `write(c)` | `writeTimed(c, ms)` | `gesture([...])` |

Drive several together: `arduino.group('arm', { shoulder: arduino.s1, elbow: arduino.s2 })` → `group.write()` / `writeTimed()` / `gesture()` / `whenDone()`.

## Gestures (expressive motion) in one paragraph

`gesture(segments)` plays an authored list of eased moves the board runs back-to-back on its own clock. Each segment is `{ dur, curve, and either by (relative delta — the default) or to (absolute target) }`; curves are `linear`, `easeIn`, `easeOut`, `easeInOut`, `back` (overshoot). Relative gestures are portable and need no homing — a `back` overshoot on an open-loop stepper is a real over-travel-and-return (e.g. a lead-screw bounce). `group.gesture({ name: segments, ... })` coordinates per-member lanes, padding short ones so every member arrives together. Full details in the Servo / Stepper / Bus servo / Groups sections below.
