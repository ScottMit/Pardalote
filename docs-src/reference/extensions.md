title: Extensions overview
lede: Extensions add support for hardware devices — servos, steppers, LED strips, sensors and cameras. Register them in JS, include them in the sketch.
---
## Using extensions in JavaScript

Register extensions before connecting, and use them by name:

```javascript sketch.js — register and use extensions
const arduino = new Arduino();

arduino.add('myServo', new Servo());
arduino.add('strip',   new NeoPixel());
arduino.add('sonar',   new Ultrasonic());

arduino.connect('192.168.1.42');

arduino.on('ready', () => {
    arduino.myServo.attach(9);
    arduino.strip.init(6, 30);
    arduino.sonar.attach(7, 8);
});
```

Each extension automatically gets a logical ID based on its type. Multiple instances of the same type are supported.

## Script loading order

`pardalote.js` is the all-in-one bundle — core plus every device extension — so a single script tag is all you need, loaded before your sketch:

```html index.html — script loading order
<script src="pardalote.js"></script>
<script src="pardalote-pins-esp32-wrover-dev.js"></script>  <!-- optional pin aliases -->
<script src="sketch.js"></script>
```

Every extension (Servo, Stepper, BusServo, NeoPixel, Ultrasonic, IMU, Encoder, Camera) is already inside the bundle — you just `arduino.add(...)` the ones you use. (Advanced: the modular sources in `pardalote-js/` — `pardalote-core.js` plus one `pardalote-<device>.js` each — can be included individually instead; the bundle is exactly those concatenated.)

## Enabling extensions in the firmware

Extensions are opt-in on the Arduino side too. Add the headers you need to your sketch:

```cpp sketch.ino — opt-in extensions
#include <Pardalote.h>
#include <PardaloteServo.h>
#include <PardaloteNeoPixel.h>
// #include <PardaloteStepper.h>
// #include <PardaloteBusServo.h>
// #include <PardaloteUltrasonic.h>
// #include <PardaloteIMU.h>
// #define CAMERA_MODEL_XIAO_ESP32S3
// #include <PardaloteCamera.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
```

Each extension self-registers when included — no other changes required. Only the extensions you `#include` get compiled into the binary.

## Creating extension objects in the firmware

Extension objects don't have to be created in the browser with `arduino.add()` — **the sketch can create them too**, and every browser receives them automatically. `PardaloteServo.attach("pan", 9)` on the Arduino makes `arduino.pan` appear in every connected browser as a full `Servo` instance, identical to one created with `add()` — present before `'ready'` fires, and pushed to browsers that connect later.

Every multi-instance device supports this — Servo, Stepper, Bus servo, NeoPixel, Ultrasonic and IMU (only the singleton Camera is browser-only):

<div class="sig">PardaloteServo.<span class="fn">attach</span>(name, pin, [minPulse], [maxPulse])</div>
<div class="sig">PardaloteStepper.<span class="fn">attach</span>(name, step, dir, [en]) · <span class="fn">attach4wire</span>(name, p1, p2, p3, p4)</div>
<div class="sig">PardaloteBusServo.<span class="fn">attach</span>(name, servoId, [series])</div>
<div class="sig">PardaloteNeoPixel.<span class="fn">attach</span>(name, pin, count, [type])</div>
<div class="sig">PardaloteUltrasonic.<span class="fn">attach</span>(name, trig, [echo])</div>
<div class="sig">PardaloteIMU.<span class="fn">attach</span>(name, [model], [addr], [sda], [scl])</div>

`name` is the browser-side handle (`arduino.<name>`, max 15 chars). Each `attach` **returns the logical id** used by the sketch-side calls below, or −1 if no slot is free.

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

**Creating an extension object *is* sharing it** — unlike raw pins there's no separate `share()` step, because a Pardalote extension has no life outside Pardalote. `arduino.on('share', ({ name, extension }) => …)` fires the moment it appears; calling `attach` again with the same name reuses the same object; names that would collide with the browser core API (like `"connect"`) are refused with a console warning. A device that should stay private to the sketch shouldn't go through Pardalote at all — drive it with the plain library directly (a raw `Servo` on its own pin, a raw `SCServo` bus on its own UART), the way unshared pins just use `pinMode()`.

## Reading and writing actuators from the sketch

`share`/`send` cover raw pins. For the **extension actuators** — browser-created or sketch-created — each type gives the sketch a small **bus object** (`PardaloteServo`, `PardaloteStepper`, `PardaloteBusServo`). The browser and the sketch share the same actuator (last writer wins), just as they share raw pins. Everything is addressed by **logical id** — what `attach` returns, and the same id the browser and groups use.

| Object | `scan()` returns | `read(id)` returns | `id` is |
|---|---|---|---|
| `PardaloteServo` | attached servo ids | angle (0–180) | logical id (`arduino.add()` order, or returned by sketch `attach`) |
| `PardaloteStepper` | attached stepper ids | position (steps) | logical id |
| `PardaloteBusServo` | responding **hardware** ids on the bus (discovery) | position (counts) | logical id (returned by `attach`) |

### scan()

Lists what's there.

<div class="sig">Pardalote<i>Type</i>.<span class="fn">scan</span>(buffer, maxCount)</div>

| Parameter | Type | Description |
|---|---|---|
| `buffer` | int[] / uint8_t[] | Array to fill with ids. |
| `maxCount` | int | Size of the array. |

**Returns** the number of ids written. For `PardaloteBusServo`, `scan()` pings the bus and reports the **hardware** ids that respond — that's discovery; `attach()` the ones you want to drive, then address them by the logical id it returns.

```cpp
int ids[8];
int n = PardaloteServo.scan(ids, 8);
for (int i = 0; i < n; i++) Serial.println(PardaloteServo.read(ids[i]));
```

### read()

Reads one actuator's position by logical id.

<div class="sig">Pardalote<i>Type</i>.<span class="fn">read</span>(id)</div>

**Returns** angle (servo), steps (stepper), or counts (bus servo); negative on failure.

```cpp
#include <Pardalote.h>
#include <PardaloteBusServo.h>

int wrist;

void setup() {
    Pardalote.begin();
    wrist = PardaloteBusServo.attach("wrist", 1);   // adopt bus id 1 → logical id
}

void loop() {
    Pardalote.run();
    int pos = PardaloteBusServo.read(wrist);        // logical id → position (counts)
    if (pos >= 0) digitalWrite(LED_BUILTIN, pos > 2048 ? HIGH : LOW);
}
```

### write() and friends

The same objects command the actuators, all by logical id:

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

All three run through the **same command path the browser uses** — so they respect soft limits, cancel timed moves, and auto-echo the commanded value back to the browser so its record stays in sync.

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
PardaloteBusServo.write(wrist, 3000);
while (PardaloteBusServo.isMoving(wrist)) { /* do other work */ }
// arrived — trigger the next thing
```

- A **bus servo read/scan/write is a blocking bus transaction** — fine in `setup()` or a throttled `loop()`, not a tight high-rate loop competing with the browser's own polling.
- **Sketch writes update the browser's record automatically.** A sketch write echoes the commanded value to the browser exactly as if the browser had issued it — a PWM servo sets the browser's `angle`, a stepper or bus servo sets its `target`. The live `position` feedback is separate — that still comes from polling.

## The extensions

| Extension | Supports | Limit |
|---|---|---|
| [Servo](servo.html) | PWM hobby servos | 8 |
| [Stepper](stepper.html) | STEP/DIR and 4-wire drivers via AccelStepper | 6 |
| [Bus servo](bus-servo.html) | Feetech ST/SMS and SC/SCS serial servos | 16 |
| [NeoPixel](neopixel.html) | WS2812B-style LED strips | 4 strips |
| [Ultrasonic](ultrasonic.html) | HC-SR04 and similar distance sensors | 4 |
| [IMU](imu.html) | InvenSense MPU and STMicro LSM6 families | 2 |
| [Camera](camera.html) | ESP32 camera modules (MJPEG over HTTP) | 1 stream |

[Groups](groups.html) let you drive several actuators together — one message, coordinated arrival, and coordinated [gestures](groups.html#gesture).

## Rolling your own

An extension is a JS file paired with an Arduino header: the JS side sends commands over the shared protocol, the Arduino side registers handlers for them. The built-in extensions are the best templates — pick the one closest to your hardware and start from its source. See [Protocol](protocol.html) for the frame format.
