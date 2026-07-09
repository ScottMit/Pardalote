# Pardalote

Control Arduino hardware directly from a web browser over WiFi — no USB cable, no server, no Node.js. Write JavaScript that reads sensors and drives LEDs, servos (PWM and serial bus), stepper motors, and NeoPixel strips — with an API that mirrors Arduino's own function names, and [groups](#groups) that move multiple actuators together.

Designed for creative coders, design students, and makers who want to connect physical hardware to web interfaces with minimal setup.

---

## What you need

### Hardware
- **Arduino UNO R4 WiFi** or **ESP32 development board**
- Arduino and browser must be on the same WiFi network

### Software
- Arduino IDE (arduino.cc)
- A web browser
- A code or text editor

### Arduino libraries (install via Arduino IDE → Tools → Manage Libraries)
- `WebSocketsServer` (by Markus Sattler)
- `Adafruit NeoPixel` (if using LED strips)
- `ESP32Servo` (if using servos on ESP32)
- `AccelStepper` (by Mike McCauley, if using stepper motors)
- `SCServo` (Feetech/Waveshare, if using serial bus servos — usually a ZIP from the Waveshare wiki or Feetech SDK, not in the Library Manager)

No extra library is needed for the MPU / IMU extension — it reads sensor registers directly over I2C.

### Pardalote library

Pardalote ships as an Arduino library. Install it by copying the `pardalote-arduino/library/Pardalote/` folder of this repo into your Arduino libraries folder:

| OS | Libraries folder |
|---|---|
| macOS | `~/Documents/Arduino/libraries/` |
| Windows | `Documents\Arduino\libraries\` |
| Linux | `~/Arduino/libraries/` |

Restart Arduino IDE — Pardalote should now appear under **File → Examples → Pardalote**.

---

## Quick start

A minimal Pardalote sketch is two lines of setup() and one line of loop():

```cpp
#include <Pardalote.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
```

Opt-in extensions self-register when included:

```cpp
#include <Pardalote.h>
#include <PardaloteServo.h>
#include <PardaloteNeoPixel.h>
#include <PardaloteUltrasonic.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
```

### 1. Configure WiFi

There are two ways to give Pardalote your WiFi credentials — use either or both:

**Option A — Compile-time (`secrets.h`)**

Create a `secrets.h` file in the same folder as your sketch with:
```cpp
#define SECRET_SSID "YourWiFiName"
#define SECRET_PASS "YourWiFiPassword"
```
The credentials are baked into the firmware. Simple, but if you share or publish your code, add `secrets.h` to `.gitignore` first. Pardalote picks it up automatically via `__has_include` — no other changes needed.

**Option B — EEPROM (Serial Monitor)**

If no `secrets.h` is present, Pardalote detects that no credentials are stored on first boot and prompts you via the Serial Monitor at 115200 baud:
```
=== Pardalote ===
No WiFi networks stored.
=== WiFi Configuration ===
[a]dd  [d]elete  [c]lear all  [s]how  [x] exit
> a
SSID: YourWiFiName
Password: ********
Saved: YourWiFiName
> x
```
Credentials survive re-uploads and power cycles. Up to 5 networks can be stored — useful for moving between locations. Press `w` within 5 seconds of any boot to update them.

**Both options together**

If `SECRET_SSID` is defined and EEPROM networks are also stored, Pardalote tries `secrets.h` first, then falls back to EEPROM networks in order.

### 2. Upload and find the IP

1. In Arduino IDE: **File → Examples → Pardalote → basic-LED** (or any other Pardalote example matching the hardware you want to use)
2. Select your board and upload
3. Find the IP address once connected:
   - **UNO R4 WiFi:** scrolls across the LED matrix
   - **ESP32:** printed in Serial Monitor at 115200 baud

### 3. Open a browser example

Navigate to the `examples/` folder in this repo, and pick an example. Update the IP address in `sketch.js` to match your Arduino, and open `index.html` in a browser.

---

## Sharing control with the Arduino sketch

The minimal sketch is `Pardalote.begin()` + `Pardalote.run()`, but you can also write Arduino code that reads sensors, drives pins, runs a state machine — alongside the browser. The model is:

> **The Arduino is just another voice in a flat command structure.**
> Both the Arduino sketch and the browser can read and write any pin using the standard Arduino / JS APIs. Whoever wrote last wins on the actual pin state. There's no pin reservation, no negotiation — your sketch and your JS code share the same hardware and you keep them coherent.

When the Arduino changes a pin, the browser doesn't know unless you tell it. Two calls do that:

```cpp
Pardalote.share(pin, mode);    // declare a pin's mode to the browser
Pardalote.send (pin, value);   // push a current value to the browser
```

Neither one touches the hardware — they only inform the browser. You still use Arduino's standard `pinMode` / `digitalWrite` / `digitalRead` / `analogRead` for the actual pin operations.

### `Pardalote.share(pin, mode)`

Tells the browser "this pin exists, it's in this mode." Use Arduino's constants (`INPUT`, `OUTPUT`, `INPUT_PULLUP`, `INPUT_PULLDOWN`) or Pardalote's `MODE_ANALOG_INPUT`. **For input modes, the browser auto-starts a default-interval (200 ms) poll for the pin** — so the browser starts receiving values without having to declare anything itself.

For `OUTPUT` it's purely a declaration (no polling).

### `Pardalote.send(pin, value)`

Push a value. The browser caches it, fires `arduino.onChange(pin, …)` handlers, and makes it available via `arduino.digitalRead(pin)` / `analogRead(pin)`.

### Two examples

**Light switch** ([examples/shared-control-example/](examples/shared-control-example/)) — an LED controlled by two physical buttons *and* two browser buttons. Either side flips it; both stay in sync. The Arduino calls `share` once and `send` whenever its buttons fire:

```cpp
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

**Potentiometer** ([examples/shared-input-example/](examples/shared-input-example/)) — the Arduino announces an analog input; the browser receives values automatically with no JS-side setup:

```cpp
void setup() {
    Pardalote.begin();
    pinMode(A0, INPUT);
    Pardalote.share(A0, MODE_ANALOG_INPUT);   // browser auto-starts polling
}

void loop() {
    Pardalote.run();   // that's it — browser's polls are handled here
}
```

```js
arduino.onChange('A0', value => updateDisplay(value));   // no pinMode, no analogRead
```

### When *not* to share

Not every pin needs to be shared. In the light-switch example, the two button pins (`BTN_ON`, `BTN_OFF`) are only used by the Arduino — the browser has its own buttons for that, so there's no reason to tell it about the physical ones. Share only the pins you want the browser to see.

### Creating actuators from the sketch

The sketch can create a servo itself — and every browser receives it automatically:

```cpp
#include <Pardalote.h>
#include <PardaloteServo.h>

int pan;

void setup() {
    Pardalote.begin();
    pan = PardaloteServo.attach("pan", 9);   // name, pin → logical id
    PardaloteServo.write(pan, 90);
}
```

That one `attach` call attaches the servo on the board **and** announces it, so `arduino.pan` simply exists in the browser — a full `Servo` instance, identical to one created with `arduino.add('pan', new Servo())`: `write()`, `writeTimed()`, `whenDone()`, limits, groups, all of it. It's there before `'ready'` fires, and browsers that connect later get it too. Optional pulse-range args match the browser attach: `attach("pan", 9, 500, 2500)`.

Unlike raw pins, there's no separate `share()` step — a Pardalote servo has no life outside Pardalote, so creating it *is* sharing it. A servo that should stay private to the sketch shouldn't go through Pardalote at all: use the plain `Servo`/`ESP32Servo` library directly, the way unshared pins just use `pinMode()`.

Names are the sketch's choice (≤ 15 chars; names that would collide with the browser core API, like `"connect"`, are refused with a console warning), calling `attach` again with the same name reuses the same servo, and the browser can watch objects appear with `arduino.on('share', ({ name, extension }) => …)`. See **[examples/shared-servo-example/](examples/shared-servo-example/)**.

*(Currently servos; steppers and bus servos will follow the same pattern.)*

### Reading and writing actuators from the sketch

`share`/`send` cover raw pins. For the **extension actuators** (servos, steppers, bus servos) — whether the browser configured them or the sketch created them — each type gives the sketch a small **bus object** — `scan()` lists what's there, `read(id)` reads one, and `write(id, …)` drives one. The browser and the sketch share the same actuator (last writer wins), the way they already share raw pins — so the sketch can react to a position *and* command motion.

```cpp
#include <Pardalote.h>
#include <PardaloteBusServo.h>

void loop() {
    Pardalote.run();
    int pos = PardaloteBusServo.read(1);              // servo ID 1 → position (counts)
    if (pos >= 0) digitalWrite(LED_BUILTIN, pos > 2048 ? HIGH : LOW);
}
```

The three objects, and how each is addressed:

| Object | `scan()` returns | `read(id)` returns | `id` is |
|---|---|---|---|
| `PardaloteServo` | attached servo ids | angle (0–180) | logical id (`arduino.add()` order, or returned by sketch `attach`) |
| `PardaloteStepper` | attached stepper ids | position (steps) | logical id |
| `PardaloteBusServo` | responding servo ids | position (counts) | **hardware** servo ID |

```cpp
// Discover, then read — same pattern for each type
int ids[8];
int n = PardaloteServo.scan(ids, 8);
for (int i = 0; i < n; i++) Serial.println(PardaloteServo.read(ids[i]));

uint8_t bus[16];
int m = PardaloteBusServo.scan(bus, 16);              // pings the bus
for (int i = 0; i < m; i++) Serial.println(PardaloteBusServo.read(bus[i]));
```

Also: `PardaloteServo.isMoving(id)`, `PardaloteStepper.distanceToGo(id)` / `.isRunning(id)`, and `PardaloteBusServo.feedback(id)` (position, load, voltage, temperature, … in one read).

For bus servos, `PardaloteBusServo.isMoving(id)` / `.arrived(id)` read the servo's own **Moving flag** — its honest "am I still moving?", accounting for deadband and settling. It's one bus read (the servo can't notify you — you ask when you want to know):

```cpp
PardaloteBusServo.write(1, 3000);
while (PardaloteBusServo.isMoving(1)) { /* do other work */ }
// arrived — trigger the next thing
```

#### Writing

The same objects command the actuators — addressed the same way (logical id for servo/stepper, hardware ID for bus servo):

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

Notes:
- A **bus servo read/scan/write is a blocking bus transaction** — fine in `setup()` or a throttled `loop()`, not a tight high-rate loop competing with the browser's own polling.
- **Sketch writes update the browser's record automatically.** A sketch write echoes the commanded value to the browser exactly as if the browser had issued it — a PWM servo sets the browser's `angle`, a stepper or bus servo sets its `target`. So the browser's record stays coherent with no `read()` needed. (The live `position` feedback is separate — that still comes from polling, as always.)
- See **File → Examples → Pardalote → arduino-read**.

---

## Messaging

`share`/`send` and the extensions all move *hardware* state. **Messaging** is the
channel for everything else: named key/value messages that aren't tied to any pin
or device. Send a value under a string key; the other side watches keys and reads
values. It's symmetric — the same call works browser→Arduino and Arduino→browser —
and it carries every basic type: `int`, `bool`, `float`, `char`, text, and binary
blobs.

```javascript
arduino.send('temp', 22.5);      // float   (type inferred from the value)
arduino.send('count', 42);       // int
arduino.send('enabled', true);   // bool
arduino.send('mode', 'idle');    // text
arduino.send('frame', pixels);   // Uint8Array → blob
```

The key is a **string**, so `send` never collides with the pin `digitalWrite`/
`analogWrite` calls — pins stay on their own verbs.

### Watching and reading

```javascript
// Watch one key — the callback fires whenever a message with that key arrives
arduino.watch('temp', (value, key, type) => console.log(key, '=', value));

// Or catch every message
arduino.on('message', ({ key, value, type }) => { /* type: 'int','float',… */ });

// Last received value for any key
let mode = arduino.messages['mode'];
```

### Retain and broadcast

Two optional flags shape delivery:

```javascript
arduino.send('mode', 'idle', { retain: true });     // stored on the board,
                                                     // replayed to browsers that connect later
arduino.send('cursor', 120,   { broadcast: true });  // relayed to the OTHER browsers too
arduino.send('mode', 'run',   { retain: true, broadcast: true });
```

- **`retain`** — the board keeps the latest value for that key and re-sends it to
  any client that connects, in the same sync step as pin and extension state. New
  clients immediately see the current value; without it, a message is a one-off
  event.
- **`broadcast`** — the board relays a browser's message to the *other* connected
  browsers (it's the hub), so multiple browsers can coordinate. Without it, a
  browser message goes only to the Arduino sketch.

### From the Arduino sketch

The same verb, mirrored — the string key distinguishes it from the pin
`send(pin, value)`:

```cpp
Pardalote.send("temp", 22.5);                  // float
Pardalote.send("mode", "idle", MSG_FLAG_RETAIN);
Pardalote.watch("led", onLed);                 // handle one key
Pardalote.onMessage(onAny);                    // handle every key
```

Callbacks receive a `Message`; `m.type` says which accessor is valid:

```cpp
void onLed(const Message& m) {
    digitalWrite(LED_BUILTIN, m.asBool() ? HIGH : LOW);
}

void onAny(const Message& m) {
    // m.asInt() / m.asBool() / m.asFloat() / m.asChar() / m.text / m.blob (m.length)
}
```

A sketch `send` reaches every browser (retain still applies). Note the board's
outgoing frame buffer caps a single Arduino→browser text/blob at ~240 bytes;
browser→Arduino is not limited that way.

### Inspecting all traffic

The frame monitor is a superset of message-watching — it sees **every** frame in
and out, decoded and named, so it doubles as a live protocol inspector:

```javascript
arduino.on('frame', ({ dir, cmdName, target, params, payload }) => {
    console.log(dir, cmdName, params);   // 'in' 'SERVO_WRITE' [0, 90], 'out' 'MESSAGE', …
});
arduino.monitor(fn);   // shorthand
arduino.off('frame', fn);
```

```cpp
Pardalote.onFrame([](const FrameEvent& ev) {   // sketch-side, e.g. log to Serial
    Serial.println(ev.name);                    // "MESSAGE", "DIGITAL_WRITE", …
});
```

It costs nothing until a handler is registered. See **File → Examples → Pardalote
→ messaging** and `examples/messaging-example/`.

---

## JavaScript API

### Connecting

```javascript
const arduino = new Arduino();
arduino.connect('192.168.1.42');        // WebSocket on port 81
arduino.connect('192.168.1.42', 8081);  // custom port

// Events
arduino.on('ready',        () => { /* Arduino connected and state synced */ });
arduino.on('connect',      () => { /* WebSocket open — before ready */ });
arduino.on('disconnect',   () => { /* connection lost */ });
arduino.on('reconnecting', ({ attempt, delay }) => { /* next retry in `delay` ms */ });

arduino.disconnect();  // stop and disable auto-reconnect
```

The `ready` event fires after the Arduino has sent its current state to the browser — pins, extensions, pixel colours. Any client connecting to a running system immediately sees the live state.

Reconnection is automatic with exponential backoff and continues for as long as the page is open. You don't need to do anything. The first ten attempts are logged in the console; after that the library falls quiet — subscribe to the `'reconnecting'` event for per-attempt updates.

Calling `connect()` again — for example, to switch to a different Arduino's IP — starts a fresh session: pin modes, polled reads, and write listeners from the previous board are cleared so they aren't replayed onto the new hardware. Each registered extension is reset to its just-constructed state, so any attached servos, initialised strips, MPU calibration, camera streams, and so on are released — call `attach()` / `init()` again inside the new `on('ready')` handler. Event listeners attached with `on('read', …)` etc. survive, as do user-tuned settings like `setThrottle`, `setThreshold`, `setQuality`. Silent auto-reconnect to the same Arduino preserves all of that state as before.

### Pin modes

```javascript
arduino.pinMode(13, OUTPUT);
arduino.pinMode(7,  INPUT_PULLUP);
arduino.pinMode(A0, ANALOG_INPUT);

// Optional interval (ms) starts periodic reads immediately
arduino.pinMode(A0, ANALOG_INPUT, 50);  // start reading A0 every 50 ms
arduino.pinMode(7,  INPUT_PULLUP, 100); // start reading pin 7 every 100 ms
```

### Digital and analog output

```javascript
arduino.digitalWrite(13, HIGH);
arduino.digitalWrite(13, LOW);
arduino.analogWrite(9, 128);   // PWM, 0–255
```

### Reading pins

All reads work the same way: the first call starts a periodic poll on the Arduino. Subsequent calls in your draw loop return the cached value — no extra network traffic.

```javascript
// Start polling, returns 0 until first reading arrives
arduino.analogRead(A0);           // starts default poll (200 ms)
arduino.analogRead(A0, 50);       // starts poll at 50 ms
arduino.analogRead(A0, END);      // stop polling

// Same pattern for digital
arduino.digitalRead(7);
arduino.digitalRead(7, 100);
arduino.digitalRead(7, END);

// Calling with the same interval returns the cached value and does nothing else
let val = arduino.analogRead(A0, 50);  // already running at 50 ms — just returns cache
```

#### ADC range

The analog range depends on the board. Use `arduino.analogMax` to get the maximum value — it's set automatically from the HELLO handshake:

| Board | `arduino.analogMax` |
|---|---|
| UNO R4 WiFi | 1023 |
| ESP32 | 4095 |

```javascript
// Map correctly on any board
let mapped = map(arduino.analogRead(A0), 0, arduino.analogMax, 0, width);
```

#### Change callbacks

```javascript
arduino.onChange(A0, (value, pin) => {
    console.log('A0 changed to', value);
});
```

#### Stopping reads

```javascript
arduino.end(A0);    // stop one pin
arduino.endAll();   // stop all pins
```

### Connection status

```javascript
arduino.connected   // boolean — true after 'ready'
arduino.board       // string — board name from HELLO (e.g. 'UNO R4 WiFi')
arduino.analogMax   // number — ADC range, e.g. 1023 (UNO R4) or 4095 (ESP32)

arduino.getStatus() // { connected, isReconnecting, reconnectAttempts,
                    //   deviceIP, availableExtensions }
```

---

## Pin aliases

Rather than using raw numbers, include the pin file for your board and use named constants. This prevents mistakes and makes sketches portable.

```html
<!-- in index.html, after pardalote.js -->
<script src="pardalote-pins-esp32-wrover-dev.js"></script>
```

```javascript
// Then in sketch.js
arduino.pinMode(A0, ANALOG_INPUT, 50);
arduino.digitalWrite(LED_BUILTIN, HIGH);
arduino.imu.attach(SDA);
```

Available pin files (in `pardalote-js/`):

| File | Board |
|---|---|
| `pardalote-pins-uno-r4-wifi.js` | Arduino UNO R4 WiFi |
| `pardalote-pins-esp32-wrover-dev.js` | ESP32-WROVER-DEV |
| `pardalote-pins-firebeetle2-esp32-c5.js` | FireBeetle 2 ESP32-C5 |

String aliases also work anywhere a pin is accepted:

```javascript
arduino.analogRead('A0');      // resolved from the board's alias table
arduino.digitalWrite('SDA', HIGH);
```

---

## Extensions

Extensions add support for hardware devices. Register them before connecting, and use them by name.

```javascript
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

### Script loading order

`pardalote.js` must load before any extension files. Extension files must load before your sketch:

```html
<script src="pardalote.js"></script>
<script src="pardalote-pins-esp32-wrover-dev.js"></script>  <!-- optional -->
<script src="servo.js"></script>       <!-- optional extensions -->
<script src="stepper.js"></script>
<script src="busServo.js"></script>
<script src="neoPixel.js"></script>
<script src="ultrasonic.js"></script>
<script src="mpu.js"></script>
<script src="sketch.js"></script>
```

---

## Servo

Up to **8 servos** simultaneously.

```javascript
arduino.add('pan',  new Servo());
arduino.add('tilt', new Servo());

arduino.on('ready', () => {
    arduino.pan.attach(9);           // attach to pin 9
    arduino.pan.attach(9, 544, 2400); // with custom pulse range (µs)

    arduino.pan.write(90);           // move to 90°
    arduino.pan.writeMicroseconds(1500); // fine-grained control

    arduino.pan.center();            // go to 90°
    arduino.pan.min();               // go to 0°
    arduino.pan.max();               // go to 180°

    arduino.pan.detach();            // release pin
});
```

#### Reading angle

`read()` follows the same pattern as `analogRead()` — starts a poll, returns cached value:

```javascript
arduino.pan.read();          // start default poll, return cached angle
arduino.pan.read(100);       // start/update poll at 100 ms
arduino.pan.read(END);       // stop poll

let angle = arduino.pan.read();  // use in draw()
```

What the Arduino returns depends on the platform:

- **UNO R4 WiFi:** the last commanded angle (Arduino Servo library's `read()` is just a getter).
- **ESP32:** the angle decoded from the LEDC PWM duty register. Usually matches the commanded angle, but the round-trip through hardware can return values slightly off, and a `write()` happening at the same time as a `read()` can briefly return a transitional value.

If you just want "what did I tell the servo to do?" — track it yourself, or use `arduino.pan.angle` (the locally cached snapshot updated on every `write()`).

#### Smooth sweep

```javascript
// Sweep from 0° to 180° over 2 seconds (50 steps)
await arduino.pan.sweep(0, 180, 2000);
await arduino.pan.sweep(0, 180, 2000, 100); // more steps = smoother

// Any write() call cancels an in-progress sweep
arduino.pan.write(90); // stops sweep immediately
```

#### Timed moves

`writeTimed(angle, duration)` moves to an angle over a set time — the Arduino interpolates on-board (smooth, no WiFi streaming) and fires `done` on arrival. It's the modern replacement for `sweep()`, and it's what lets PWM servos **arrive together** inside a [group](#groups).

```javascript
arduino.pan.writeTimed(120, 1500);   // move to 120° over 1.5 s
arduino.pan.stop();                  // cancel a timed move, hold current angle

arduino.pan.on('done', ({ angle }) => { /* arrived */ });

// or await it — whenDone() resolves on the same 'done'
await arduino.pan.writeTimed(120, 1500).whenDone();
```

An immediate `write()` cancels an in-progress timed move.

#### Soft limits

Same shape as the stepper's: every commanded angle — browser write, sketch write, timed move, or group move — is clamped **on the Arduino** before it reaches the servo, so an LLM or a buggy sketch can't push a joint past the range.

```javascript
arduino.pan.setLimits(20, 160);      // clamp commanded angles to [min, max]
arduino.pan.clearLimits();
```

#### Home

`setHome(angle)` declares the home angle (no-arg: "the current angle is home"); `home()` snaps there, `home(duration)` glides there. Default home is 90° (centre).

```javascript
arduino.pan.setHome(45);
await arduino.pan.home(1000).whenDone();   // ease home over 1 s
```

#### Events

```javascript
arduino.pan.on('read',     ({ angle }) => { });
arduino.pan.on('write',    ({ angle }) => { });
arduino.pan.on('attached', ({ attached }) => { });
arduino.pan.on('done', ({ angle }) => { });   // timed move reached target

// Shorthand
arduino.pan.onRead(fn);
arduino.pan.onWrite(fn);
arduino.pan.onAttached(fn);
arduino.pan.onDone(fn);
```

#### Configuration

```javascript
arduino.pan.setThrottle(20);   // min ms between writes (default 20)
arduino.pan.setThreshold(1);   // min degrees change to send (default 1)
arduino.pan.getState();        // snapshot of all servo state
```

---

## Stepper

Up to **6 steppers** simultaneously. Requires the AccelStepper library. Works with STEP/DIR drivers (**TMC2208**, **TMC2209**, **A4988**, **EasyDriver**) and 4-wire coil drivers (28BYJ-48 via ULN2003, bipolar via H-bridge).

**Motion runs on the Arduino.** You send targets and motion profiles; the board generates the step pulses via `AccelStepper::run()`. You never stream individual steps over WiFi — that's why the API mirrors AccelStepper (non-blocking) rather than the built-in `Stepper` library, whose `step()` blocks and would stall the connection mid-move.

```javascript
arduino.add('x', new Stepper());
arduino.add('y', new Stepper());

arduino.on('ready', () => {
    arduino.x.attach(2, 3, 4);      // STEP, DIR, EN (EN optional)
    arduino.x.setMaxSpeed(1200);    // steps/sec
    arduino.x.setAcceleration(600); // steps/sec²
});
```

Give the motor its own power supply — don't run the coils off the board's 5 V rail.

#### Attaching

```javascript
// STEP/DIR driver (TMC2208/2209, A4988, EasyDriver)
arduino.x.attach(STEP, DIR);          // no enable pin
arduino.x.attach(STEP, DIR, EN);      // with enable pin

// Override invert defaults (EN is treated as active-LOW by default)
arduino.x.attach(STEP, DIR, EN, { invertDir: true, invertEnable: false });

// 4-wire (28BYJ-48 via ULN2003, or bipolar via H-bridge)
arduino.x.attach4wire(8, 9, 10, 11);

arduino.x.detach();                   // release the pins
```

#### Motion profile

```javascript
arduino.x.setMaxSpeed(1200);          // steps/sec ceiling for moves
arduino.x.setAcceleration(600);       // steps/sec²
```

#### Position moves

Accel-limited moves to an absolute or relative target. Chainable.

```javascript
arduino.x.moveTo(2000);               // absolute target (steps)
arduino.x.move(-400);                 // relative to current position

// whenDone() resolves when the move completes — handy for sequencing
await arduino.x.moveTo(2000).whenDone();
await arduino.x.moveTo(0).whenDone();
```

#### Timed moves

`moveToTimed(target, duration)` runs a **constant-speed** move sized to arrive in about `duration` ms — the board computes the speed from its own exact position. This is what lets steppers **arrive together** inside a [group](#groups). (Constant speed skips the acceleration ramp, so keep the speed reasonable to avoid stalling; use `moveTo()` when arrival timing doesn't matter.)

```javascript
arduino.x.moveToTimed(3200, 2000);    // reach step 3200 in ~2 s
```

#### Continuous rotation

Velocity mode spins at a constant speed until stopped. Sign sets direction.

```javascript
arduino.x.runSpeed(600);              // spin at 600 steps/sec
arduino.x.runSpeed(-600);             // reverse
arduino.x.stop();                     // decelerate to a stop
```

#### Reading position

Same pattern as `analogRead()` / servo `read()` — the first call starts a poll, later calls return the cached value:

```javascript
arduino.x.read(100);                  // poll every 100 ms
arduino.x.read(END);                  // stop polling

let pos = arduino.x.position;         // cached currentPosition (steps) — feedback, needs polling
arduino.x.target;                     // commanded destination (set immediately by moveTo)
arduino.x.distanceToGo;               // steps remaining to target
arduino.x.speed;                      // current speed (steps/sec)
arduino.x.isRunning;                  // boolean
```

`target` vs `position`: `moveTo(n)` sets `target` to `n` **right away**, so you can show where it's headed without waiting for a poll; `position` is real feedback and only advances toward `target` as read polls (or the `done` event) arrive. `target` also self-corrects from read feedback — so it stays right even when the *Arduino sketch* issued the move.

#### Zeroing and homing

Steppers have no absolute position feedback. Move the motor to a reference point (by hand or against a stop), then declare it position 0:

```javascript
arduino.x.setPosition(0);             // "here is home"
```

Limit-switch homing is planned for a future version.

#### Enable pin (hold torque)

```javascript
arduino.x.enable();                   // energise coils — hold position
arduino.x.disable();                  // release coils — free to turn by hand
```

#### Soft limits

Limits are enforced **on the Arduino** — every target is clamped to the range before the board acts on it. The browser (or an LLM driving it) can't send the motor past the set bounds.

```javascript
arduino.x.setLimits(-6400, 6400);     // clamp targets to [min, max]
arduino.x.clearLimits();
```

#### Limit switches

Hardware end-stops — none, one, or two, one call per switch. The trip happens **on the board** (no WiFi round-trip): moving into a pressed switch stops the motor *instantly* (no deceleration ramp), while moving away is always allowed so you can back off. Default wiring is active-LOW with the internal pull-up (switch between pin and GND); pass `HIGH` for active-HIGH switches.

```javascript
arduino.x.setLimitSwitch(LIMIT_MIN, 9);          // switch at the min end, active LOW
arduino.x.setLimitSwitch(LIMIT_MAX, 10, HIGH);   // switch at the max end, active HIGH
arduino.x.clearLimitSwitch(LIMIT_MIN);

arduino.x.on('limit', ({ which, position }) => {
    console.log(`hit the ${which} switch at ${position}`);
});
```

When a switch trips, the board broadcasts a `limit` event and the normal `done` follows (the motion is over), so `whenDone()` still settles — check `limitHit` (`'min'`, `'max'`, or `null`, cleared by the next move) to know the move stopped short of its target. After a trip the step counter is suspect (an instant stop above the acceleration limit can lose steps) — that's what homing is for.

#### Homing

**Home is the origin (0).** A limit switch sits at its own coordinate, which you declare with `setSwitchPosition(which, coord)` — independent of the soft limits, and defaulting to `0` (switch at the origin, the historical behaviour). With a switch configured, `home()` runs a **board-side routine**: seek the switch (MIN if configured, else MAX) at a homing speed, set the counter to the switch's declared coordinate when it trips, back off until it releases, then travel to home (`0`). The counter is re-established from the switch, so it works even when the counter is wrong — run it at startup or after a limit trip. Without a switch, `home()` is a plain accel move to `0` (counter trusted as-is).

This is the CNC/work-coordinate model: the switch is a fixed physical reference, and home is a user origin sitting at a known offset from it — so a MIN switch 500 steps below home sits at `-500`, and homing travels up to `0`.

```javascript
arduino.x.setLimitSwitch(LIMIT_MIN, 9);      // min-end switch on pin 9, active LOW
arduino.x.setSwitchPosition(LIMIT_MIN, -500);// it sits 500 steps below home (the origin)

await arduino.x.home().whenDone({ timeout: 30000 });   // seeks it, then travels to 0
arduino.x.home({ speed: 400, timeout: 10000 });        // seek speed + safety cap
```

`setHome()` **re-zeros the frame**: the current physical position becomes `0` (home), and the soft limits and switch positions shift by the same offset so they keep pointing at the same physical spots. It's how you set a manual origin without a switch — jog to the spot, then `setHome()`. Pass a value (`setHome(50)`) to make the current spot that coordinate instead of `0`.

```javascript
// counter reads 500; declare "this is home":
arduino.x.setHome();   // position → 0, and e.g. limitMax → limitMax − 500
```

The seek and back-off legs are **capped** (default 30 s, override with `{ timeout }`): if the switch never trips (unplugged, wrong pin) or never releases, the board hard-stops where it is, fires a `homeFail` event, and then `done` — so `whenDone()` still settles and nothing spins forever. Any explicit move (`moveTo`, `runSpeed`, `stop`, …) cancels an in-progress homing routine. `done` fires when the travel leg arrives.

```javascript
arduino.x.on('homeFail', ({ position }) => console.warn('homing gave up at', position));
```

Convenience helpers convert to raw steps on the JS side. Set steps-per-revolution to match your microstepping first (a 1.8° motor at 16 microsteps = 200 × 16 = 3200):

```javascript
arduino.x.setStepsPerRev(200 * 16);
arduino.x.moveToDegrees(90);          // absolute
arduino.x.moveDegrees(-45);           // relative
arduino.x.moveToRevolutions(2);
arduino.x.moveRevolutions(0.5);
```

#### Events

```javascript
arduino.x.on('read', ({ position, distanceToGo, speed, isRunning }) => { });
arduino.x.on('done', ({ position }) => { });   // position-mode target reached
arduino.x.on('move', ({ target })   => { });   // a move was issued

// Shorthand
arduino.x.onRead(fn);
arduino.x.onDone(fn);
arduino.x.onMove(fn);
```

#### State snapshot

```javascript
arduino.x.getState();
// { logicalId, interface, pins, enPin, attached,
//   maxSpeed, acceleration, stepsPerRev,
//   target, position, distanceToGo, speed, isRunning, limits, interval }
```

---

## Bus Servo

Up to **16 serial bus servos** on a single shared UART. Supports Feetech **ST / SMS** series (0–4095 counts, e.g. the **STS3215** used in the LeRobot SO-100/SO-101 arms) and **SC / SCS** series (0–1023 counts). Requires the Feetech/Waveshare `SCServo` library.

Unlike PWM servos, every bus servo shares **one UART** and is addressed by a hardware **servo ID (1–253)**, and **positions are raw encoder counts, not degrees**. Wiring is via a Waveshare Serial Bus Servo Driver board (or equivalent) on a hardware serial port: UNO R4 WiFi → `Serial1` (D0/D1), ESP32 → `Serial1`/`Serial2`.

```javascript
arduino.add('shoulder', new BusServo());
arduino.add('elbow',    new BusServo());

arduino.on('ready', () => {
    arduino.shoulder.attach(1);       // servo ID 1 (ST series by default)
    arduino.elbow.attach(2);
    arduino.shoulder.center();        // → 2048
    arduino.elbow.write(3000);        // raw counts
});
```

Give the servos their own power supply (6–7.4 V typical) — not the board's 5 V rail.

#### Configuring the bus

Optional — defaults to `Serial1` at 1 Mbps, brought up lazily on first `attach()`. Call once from any instance; it affects all bus servos.

```javascript
arduino.shoulder.configureBus({ serial: 1, baud: 1000000 });
arduino.shoulder.configureBus({ rxPin: 18, txPin: 19 });   // ESP32 custom UART pins
```

#### Attaching

```javascript
arduino.shoulder.attach(1);         // servo ID 1, ST series (default)
arduino.wrist.attach(3, 'SC');      // SC / SCS series (0–1023)
arduino.shoulder.detach();          // releases torque
```

#### Position moves

Raw counts (ST 0–4095, SC 0–1023). Optional per-move speed and acceleration.

```javascript
arduino.shoulder.write(2048);                        // centre
arduino.shoulder.write(3000, { speed: 3000, acc: 50 });
arduino.shoulder.center();                           // resolution / 2

// Degree helpers — accurate for ST (4096/360°), nominal for SC
arduino.shoulder.writeDegrees(90);
let deg = arduino.shoulder.positionDegrees;

// Default speed/acc used by group write() and writeTimed()
arduino.shoulder.setMoveDefaults(2400, 50);

// Reach a position in about a set time (speed picked from the move distance)
arduino.shoulder.writeTimed(3000, 1500);   // ~1.5 s
await arduino.shoulder.whenDone();          // resolves when the servo settles

arduino.shoulder.stop();                    // halt — hold the last-read position
```

#### Continuous rotation (wheel mode)

```javascript
arduino.wheel.setMode('wheel');
arduino.wheel.runSpeed(2000);       // sign sets direction (same verb as stepper)
arduino.wheel.runSpeed(0);          // stop
arduino.wheel.setMode('position');  // back to positioning
```

#### Torque — pose by hand and read back

Disabling torque lets you move a joint by hand while `read()` streams the position — the basis of the teach-a-trajectory workflow in projects like LeRobot.

```javascript
arduino.shoulder.disableTorque();   // go limp
arduino.shoulder.enableTorque();    // hold position
```

#### Reading feedback

One bus transaction per poll returns position, velocity, load, voltage, temperature, and (ST) current.

```javascript
arduino.shoulder.read(120);         // poll every 120 ms
arduino.shoulder.read(END);         // stop

arduino.shoulder.position;          // raw counts — feedback, needs polling
arduino.shoulder.target;            // commanded goal (set immediately by write)
arduino.shoulder.velocity;
arduino.shoulder.load;
arduino.shoulder.voltage;           // volts
arduino.shoulder.temperature;       // °C
arduino.shoulder.current;           // raw units (ST only)

arduino.shoulder.on('read', ({ position, velocity, load, voltage, temperature }) => { });
```

`target` vs `position`: `write(n)` sets `target` to `n` immediately (where you told it to go); `position` is real encoder feedback and only tracks toward `target` while you're polling. Unlike the stepper, bus-servo `target` is browser-side only — the servo has no board-replayed goal, so it isn't restored after a board reset.

#### Limits and calibration

Soft limits, enforced **on the Arduino** — every commanded position (browser write, sketch write, or group SyncWrite) is clamped to the range before it reaches the servo. Software-only by design: the servo's own EEPROM limit registers are never written (no wear, and limits update instantly and freely). Same shape as `setLimits` on the stepper and PWM servo.

```javascript
arduino.shoulder.setLimits(1024, 3072);   // clamp commanded positions to [min, max]
arduino.shoulder.clearLimits();

// Move the joint to its zero pose by hand (torque off), then:
arduino.shoulder.calibrate();             // declare current position as centre
```

#### Home

`setHome(position)` declares the home position (no-arg: "the current position is home" — pairs naturally with torque-off hand-posing: pose the joint, `read()`, `setHome()`); `home()` moves there, `home(duration)` moves there smoothly. Default home is the centre of range (2048 ST / 512 SC).

```javascript
arduino.shoulder.setHome(1500);
await arduino.shoulder.home(1000).whenDone();
```

#### Setup utilities

Servos ship as ID 1. To renumber, put a **single** servo on the bus and `setId()`, one at a time. `scan()` lists responding IDs; `ping()` checks one.

```javascript
await arduino.shoulder.scan(1, 20);       // → [1, 2, 3]
await arduino.shoulder.ping(1);           // → true / false
arduino.shoulder.setId(2);                // renumber (one servo on bus only!)
```

#### State snapshot

```javascript
arduino.shoulder.getState();
// { logicalId, servoId, series, attached, mode, torque, resolution,
//   target, position, velocity, load, voltage, temperature, current, limits, interval }
```

---

## Groups

A **group** is a named collection of actuators you drive together, and its methods mirror the single actuators: `group.write()` writes every member in a **single WebSocket message**, `group.writeTimed()` coordinates a move so all members **arrive together**, and `whenDone()` awaits real completion. Groups currently take **Servo**, **BusServo**, and **Stepper** members (pins and NeoPixels are planned).

```javascript
arduino.add('shoulder', new BusServo());
arduino.add('elbow',    new BusServo());
arduino.add('base',     new Stepper());
arduino.add('wrist',    new Servo());

arduino.on('ready', () => {
    // ... attach each member ...
    const arm = arduino.group('arm', {
        shoulder: arduino.shoulder,
        elbow:    arduino.elbow,
        base:     arduino.base,
        wrist:    arduino.wrist,
    });
});
```

The group is also available as `arduino.arm`.

#### Coordinated write

`write()` writes all named members at once. Every member's frame is packed into **one** WebSocket message, so the board applies them back-to-back within a single receive — they move together. Bus servos of the same series are additionally coalesced into a single hardware **SyncWrite** packet (a truly simultaneous latch).

```javascript
arm.write({ shoulder: 2048, elbow: 3000, base: 1600, wrist: 90 });
```

#### Reading

```javascript
arm.read(100);       // start polling every member at 100 ms
arm.read();          // snapshot of cached values → { shoulder, elbow, base, wrist }
arm.read(END);       // stop polling every member
arm.values();        // same snapshot, no polling change
```

#### Arrive-together moves

`writeTimed(targets, duration)` moves every member to its target so they all finish after about `duration` ms — the same shape as a single actuator's `writeTimed(value, duration)`. Each actuator type does this with its own native mechanism:

| Member | How it arrives together |
|---|---|
| Bus servo | one SyncWrite with per-servo speeds matched to distance |
| PWM servo | on-board interpolation over the shared duration |
| Stepper | constant-speed move, the board sizing speed from its own position |

All of it still goes out in **one** batched message — including mixed groups.

```javascript
arm.writeTimed({ shoulder: 3000, elbow: 1200, base: 0, wrist: 120 }, 1500);

// whenDone() resolves when every moved member actually ARRIVES —
// each actuator's real 'done', not a timer. Ideal for sequencing.
await arm.writeTimed({ shoulder: 2048, elbow: 2048 }, 1000).whenDone();
await arm.writeTimed({ shoulder: 1000, elbow: 3000 },  800).whenDone();
```

`whenDone()` waits for real completion: the board reports `done` when a stepper's step count reaches target, a servo's timed interpolation finishes, and a bus servo's `Moving` flag settles (the board polls it). So the next line runs only once the whole group has settled. It resolves `true` on arrival, or `false` on the safety timeout (default `max(duration × 2, 10000)` ms) if a member never reports — pass `whenDone({ timeout })` to override, `0` to wait forever. The same method exists on every single actuator: `await servo.writeTimed(90, 1000).whenDone()`.

`duration` itself is approximate — it's the *arrival synchronisation* that's exact. For an accurate first move from an unknown pose, either poll `read()` first or start from a known pose (`center()` / `write()`), since `writeTimed` measures distance from each member's last commanded position.

#### State snapshot

```javascript
arm.getState();   // { name, members: { shoulder: {...}, base: {...}, ... } }
arm.stop();       // halt every member's motion (use read(END) to stop polling)
```

#### Going home

`home(duration?)` sends every member to its stored home — servos and bus servos as (optionally timed) moves, steppers via their limit-switch homing routine (which has no duration). Not arrive-together: each member homes at its own pace. `whenDone()` resolves when every member settles; homing can be slow, so raise the timeout.

```javascript
await arm.home(1500).whenDone({ timeout: 30000 });
```

---

## NeoPixel

Up to **4 strips** simultaneously. Requires the Adafruit NeoPixel library.

```javascript
arduino.add('ceiling', new NeoPixel());
arduino.add('floor',   new NeoPixel());

arduino.on('ready', () => {
    arduino.ceiling.init(6, 30);              // pin 6, 30 pixels
    arduino.floor.init(7, 16, NEO_GRB + NEO_KHZ800); // explicit type
});
```

#### Setting pixels

Changes are buffered locally. Nothing is sent to the LEDs until `show()` is called.

```javascript
// Individual pixels
arduino.ceiling.setPixelColor(0, 255, 0, 0);     // index, r, g, b
arduino.ceiling.setPixelColor(0, 255, 0, 0, 128); // RGBW

// Pack a colour value first
let red = arduino.ceiling.Color(255, 0, 0);
arduino.ceiling.setPixelColor(0, red);

// Fill a range
arduino.ceiling.fill(red);          // fill entire strip
arduino.ceiling.fill(red, 0, 10);   // fill pixels 0–9

// Clear all pixels
arduino.ceiling.clear();

// Brightness (0–255)
arduino.ceiling.setBrightness(80);

// Send buffered changes to the LEDs
arduino.ceiling.show();
```

#### Reading pixel state

```javascript
let color = arduino.ceiling.getPixelColor(5); // returns 32-bit colour
arduino.ceiling.numPixels();                  // number of pixels
arduino.ceiling.getState();                   // snapshot of all strip state
```

#### Pixel type constants

```javascript
// Colour order
NEO_RGB   NEO_RBG   NEO_GRB   NEO_GBR   NEO_BRG   NEO_BGR

// Speed
NEO_KHZ800  // most strips (default)
NEO_KHZ400  // older strips

// Combine:
arduino.strip.init(6, 30, NEO_GRB + NEO_KHZ800);
```

#### Threshold and throttle

Pixel changes below the colour distance threshold are ignored — useful for animation loops that might send identical values:

```javascript
arduino.ceiling.setThreshold(5);  // default 5
```

`show()` is debounced so rapid draw-loop calls coalesce into a single send (the latest pending state wins). Default 20 ms (~50 Hz max). Raise if you still see queue-buildup lag on a slow link; set to 0 to disable debouncing:

```javascript
arduino.ceiling.setThrottle(20);  // min ms between show() flushes (default 20)
arduino.ceiling.setThrottle(50);  // gentler on the UNO R4's WiFi
arduino.ceiling.setThrottle(0);   // disable debouncing — every show() flushes
```

---

## Ultrasonic

Up to **4 sensors** simultaneously. Supports HC-SR04 and similar sensors in both 3-wire and 4-wire configurations.

```javascript
arduino.add('front', new Ultrasonic());
arduino.add('side',  new Ultrasonic());

arduino.on('ready', () => {
    arduino.front.attach(7, 8);  // 4-wire: trig pin 7, echo pin 8
    arduino.side.attach(6);      // 3-wire: trig and echo on same pin

    arduino.front.setTimeout(40); // echo timeout in ms (default 30)

    // Start polling — unit set here applies to all subsequent reads
    arduino.front.read(200, CM);   // poll every 200 ms, return cm
    arduino.front.read(200, INCH); // poll every 200 ms, return inches
});
```

#### Reading distance

```javascript
// In draw() — returns cached value, no extra traffic
let cm = arduino.front.read();

// -1 means echo timed out (nothing in range)
if (cm === -1) { console.log('out of range'); }
```

#### Events

```javascript
arduino.front.on('read', ({ distance, unit }) => {
    console.log(distance, unit === CM ? 'cm' : 'in');
});

arduino.front.onRead(fn);  // shorthand

// Stop polling
arduino.front.read(END);
arduino.front.detach();
```

#### State snapshot

```javascript
arduino.front.distance;    // last reading
arduino.front.getState();  // { trigPin, echoPin, attached, timeoutMs, distance, unit, interval }
```

---

## MPU / IMU

Up to **2 IMU sensors** simultaneously. Supports multiple InvenSense MPU and STMicroelectronics LSM6 sensor families with a single extension file. No third-party Arduino library required.

| Model string | Chip | DOF | Default address |
|---|---|---|---|
| `'6050'` | InvenSense MPU-6050 | 6 | 0x68 |
| `'6500'` | InvenSense MPU-6500 | 6 | 0x68 |
| `'9250'` | InvenSense MPU-9250 | 9 | 0x68 |
| `'9255'` | InvenSense MPU-9255 | 9 | 0x68 |
| `'LSM6DS3'`  | STMicro LSM6DS3  | 6 | 0x6A |
| `'LSM6DSOX'` | STMicro LSM6DSOX | 6 | 0x6A |

```javascript
arduino.add('imu', new MPU('6050'));

arduino.on('ready', () => {
    arduino.imu.attach(0x68);           // default I2C address
    arduino.imu.attach(0x69);           // AD0 pin HIGH
    arduino.imu.attach(0x68, 21, 22);   // ESP32 custom SDA/SCL pins

    arduino.imu.onRead(({ accel, gyro, temp }) => {
        // accel: { x, y, z }  in g
        // gyro:  { x, y, z }  in °/s
        // temp:                in °C
        console.log(accel, gyro, temp);
    });

    arduino.imu.read(20);   // poll every 20 ms (50 Hz)
    arduino.imu.read(END);  // stop polling
});
```

#### Range configuration

```javascript
// Accel range — pass the ±g value: 2 (default), 4, 8, or 16
arduino.imu.setAccelRange(2);
arduino.imu.setAccelRange(4);

// Gyro range — pass the ±°/s value: 250 (default), 500, 1000, or 2000
arduino.imu.setGyroRange(250);
arduino.imu.setGyroRange(500);
```

Higher accel range handles larger accelerations but reduces resolution. Higher gyro range handles faster rotation but reduces resolution. Unknown values are rejected with a console warning; the current range is left unchanged.

#### Calibration

```javascript
// Place the sensor flat with Z pointing up, then call:
arduino.imu.calibrate(200);  // 200 samples ≈ 400 ms

arduino.imu.onCalibrate(offsets => {
    // offsets: { ax, ay, az, gx, gy, gz }  — applied automatically
    // After calibration: accel.z ≈ +1g  gyro ≈ 0
});
```

Calibration offsets are stored on the Arduino and re-sent to any browser that reconnects — no need to recalibrate after a page reload.

#### Events

```javascript
arduino.imu.on('read',      ({ accel, gyro, temp }) => { });
arduino.imu.on('calibrate', ({ ax, ay, az, gx, gy, gz }) => { });

// Shorthand
arduino.imu.onRead(fn);
arduino.imu.onCalibrate(fn);
```

#### State snapshot

```javascript
arduino.imu.getState();
// { logicalId, model, dof, address, attached,
//   accelRange, gyroRange, accel, gyro, temp,
//   calibrated, calibration }
```

---

## Camera

Streams MJPEG video and serves JPEG snapshots over a separate HTTP server — video never flows through the WebSocket, so it doesn't compete with control messages.

Requires no third-party library beyond the ESP32 Arduino core (which includes `esp_camera` and `esp_http_server`). PSRAM must be present on the board.

### Hardware

Board define names match the ESP CameraWebServer example:

| Board | Define |
|---|---|
| Freenove ESP32-WROVER-DEV | `CAMERA_MODEL_WROVER_KIT` |
| AI-Thinker ESP32-CAM | `CAMERA_MODEL_AI_THINKER` |
| Seeed Studio XIAO ESP32S3 Sense | `CAMERA_MODEL_XIAO_ESP32S3` |
| Espressif ESP32-S3-EYE | `CAMERA_MODEL_ESP32S3_EYE` |
| Espressif ESP-EYE | `CAMERA_MODEL_ESP_EYE` |
| M5Stack PSRAM | `CAMERA_MODEL_M5STACK_PSRAM` |
| M5Stack V2 PSRAM | `CAMERA_MODEL_M5STACK_V2_PSRAM` |
| M5Stack Wide | `CAMERA_MODEL_M5STACK_WIDE` |
| M5Stack ESP32CAM | `CAMERA_MODEL_M5STACK_ESP32CAM` |
| M5Stack UnitCam | `CAMERA_MODEL_M5STACK_UNITCAM` |
| M5Stack CamS3 Unit | `CAMERA_MODEL_M5STACK_CAMS3_UNIT` |
| TTGO T-Journal | `CAMERA_MODEL_TTGO_T_JOURNAL` |
| ESP32-CAM Board | `CAMERA_MODEL_ESP32_CAM_BOARD` |
| ESP32-S3 CAM LCD | `CAMERA_MODEL_ESP32S3_CAM_LCD` |
| ESP32-S2 CAM Board | `CAMERA_MODEL_ESP32S2_CAM_BOARD` |
| DFRobot FireBeetle 2 ESP32-S3 | `CAMERA_MODEL_DFRobot_FireBeetle2_ESP32S3` |
| DFRobot Romeo ESP32-S3 | `CAMERA_MODEL_DFRobot_Romeo_ESP32S3` |

### Arduino setup

Define your board model **before** including the camera header in your sketch:

```cpp
#define CAMERA_MODEL_WROVER_KIT
#include <PardaloteCamera.h>
```

### JavaScript usage

```javascript
const arduino = new Arduino();
arduino.add('cam', new Camera());
arduino.connect('192.168.1.42');

arduino.on('ready', () => {
    arduino.cam.attach(82);   // start camera HTTP server on port 82
});

arduino.cam.on('stream', ({ url, element }) => {
    // element is a live <img> — append to DOM or use url with p5.js createImg()
    document.body.appendChild(element);
});
```

#### Script loading

```html
<script src="pardalote.js"></script>
<script src="camera.js"></script>
<script src="sketch.js"></script>
```

#### p5.js integration

```javascript
let camEl;

arduino.cam.on('stream', ({ url }) => {
    if (camEl) camEl.remove();
    camEl = createImg(url, '');  // wrap in p5.Element so image() accepts it
    camEl.hide();                // keep it out of the DOM layout
});

function draw() {
    if (camEl) {
        image(camEl, 0, 0, width, height);  // draw MJPEG frame to canvas
        loadPixels();                        // pixels[] available for manipulation
    }
}
```

`loadPixels()` works because `PardaloteCamera.h` sets `Access-Control-Allow-Origin: *` on both HTTP endpoints automatically.

#### Resolution and quality

```javascript
// Framesize constants (match ESP32 camera framesize_t enum)
arduino.cam.setResolution(FRAMESIZE_QVGA);   // 320×240  ← default
arduino.cam.setResolution(FRAMESIZE_VGA);    // 640×480
arduino.cam.setResolution(FRAMESIZE_HD);     // 1280×720

// JPEG quality: 0 = best image / highest bandwidth
//              63 = worst image / lowest bandwidth
arduino.cam.setQuality(12);   // default — good balance for streaming
```

Available framesize constants:

| Constant | Resolution |
|---|---|
| `FRAMESIZE_QQVGA` | 160×120 |
| `FRAMESIZE_QVGA` | 320×240 |
| `FRAMESIZE_HVGA` | 480×320 |
| `FRAMESIZE_VGA` | 640×480 |
| `FRAMESIZE_SVGA` | 800×600 |
| `FRAMESIZE_HD` | 1280×720 |

#### Snapshots

```javascript
// Fetch a single JPEG still over HTTP — returns a blob: URL
const url = await arduino.cam.snapshot();
// use as an image src, or revoke when done:
URL.revokeObjectURL(url);

// Or listen for the event:
arduino.cam.on('snapshot', ({ url, blob }) => { ... });
```

#### HTTP endpoints

Once `attach()` is called, the Arduino serves two endpoints on the chosen port:

| Endpoint | Description |
|---|---|
| `http://<ip>:<port>/stream` | MJPEG stream |
| `http://<ip>:<port>/snapshot` | Single JPEG |

#### Events and API

```javascript
arduino.cam.on('stream',   ({ url, element }) => { });  // stream confirmed live
arduino.cam.on('snapshot', ({ url, blob })    => { });  // still received
arduino.cam.on('error',    ({ message })      => { });  // fetch failed

// Shortcuts
arduino.cam.onStream(fn);
arduino.cam.onSnapshot(fn);
arduino.cam.onError(fn);

// Detach (clears local stream reference; HTTP server keeps running)
arduino.cam.detach();

// Access the <img> element directly
const el = arduino.cam.getElement();

arduino.cam.getState();
// { logicalId, port, streamUrl, snapshotUrl, framesize, quality }
```

#### Limitations

Only one browser can receive the MJPEG stream at a time. This is a fundamental limitation of the ESP32 camera driver — `esp_camera_fb_get()` is single-consumer by design. A second browser connecting will see a black screen and only receives the feed once the first disconnects. This behaviour is identical to Espressif's own CameraWebServer example.

---

## Enabling extensions in the firmware

Extensions are opt-in. Add the headers you need to your sketch:

```cpp
#include <Pardalote.h>
#include <PardaloteServo.h>
#include <PardaloteNeoPixel.h>
// #include <PardaloteStepper.h>
// #include <PardaloteBusServo.h>
// #include <PardaloteUltrasonic.h>
// #include <PardaloteMPU.h>
// #define CAMERA_MODEL_XIAO_ESP32S3
// #include <PardaloteCamera.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
```

Each extension self-registers when included — no other changes required. Only the extensions you `#include` get compiled into the binary.

---

## Project structure

```
Pardalote/
├── pardalote-arduino/
│   └── library/
│       └── Pardalote/                       # ← install this folder as an Arduino library
│           ├── library.properties
│           ├── keywords.txt
│           ├── src/
│           │   ├── Pardalote.h              # Public API
│           │   ├── Pardalote.cpp            # PardaloteClass implementation
│           │   ├── PardaloteServo.h         # Servo support (up to 8)
│           │   ├── PardaloteStepper.h       # Stepper support (up to 6, AccelStepper)
│           │   ├── PardaloteBusServo.h      # Serial bus servos (Feetech ST/SC, up to 16)
│           │   ├── PardaloteNeoPixel.h      # NeoPixel support (up to 4 strips)
│           │   ├── PardaloteUltrasonic.h    # Ultrasonic support (up to 4 sensors)
│           │   ├── PardaloteMPU.h           # IMU support — MPU-6050/6500/9250/9255, LSM6DS3/DSOX
│           │   ├── PardaloteCamera.h        # MJPEG camera stream (ESP32 only)
│           │   └── internal/
│           │       ├── defs.h               # Protocol constants
│           │       ├── protocol.h           # Binary frame encoding/decoding
│           │       ├── extensions.h         # Extension registry — declarations
│           │       ├── extensions.cpp       # Extension registry — storage + dispatch
│           │       ├── platform.h           # Board detection
│           │       ├── wifi_config.h        # WiFi credential storage — declarations
│           │       ├── wifi_config.cpp      # WiFi credential storage — implementation
│           │       ├── led_matrix.h         # UNO R4 LED matrix — declarations
│           │       └── led_matrix.cpp       # UNO R4 LED matrix — implementation
│           └── examples/                    # IDE-visible example sketches
│               ├── basic-LED/
│               ├── servo/
│               ├── stepper/
│               ├── busservo/
│               ├── arduino-read/
│               ├── neopixel/
│               ├── ultrasonic/
│               ├── mpu/
│               └── camera/
│
├── pardalote-js/
│   ├── pardalote.js                       # Core library — always include first
│   ├── servo.js                           # Servo extension
│   ├── stepper.js                         # Stepper extension
│   ├── busServo.js                        # Serial bus servo extension
│   ├── neoPixel.js                        # NeoPixel extension
│   ├── ultrasonic.js                      # Ultrasonic extension
│   ├── mpu.js                             # MPU / IMU extension
│   ├── camera.js                          # Camera extension (ESP32-S3)
│   ├── pardalote-pins-uno-r4-wifi.js      # Pin aliases for UNO R4 WiFi
│   ├── pardalote-pins-esp32-wrover-dev.js # Pin aliases for ESP32-WROVER-DEV
│   └── pardalote-pins-firebeetle2-esp32-c5.js
│
└── examples/
    ├── basic-LED-example/          # digitalWrite — no p5.js
    ├── basic-p5js-example/         # analogRead with p5.js
    ├── servo-example/              # Servo sweep with p5.js
    ├── servo-test/                 # Servo angle control
    ├── stepper-example/            # Stepper position + continuous control
    ├── busservo-example/           # Feetech ST bus servos — pose & read back
    ├── coordinated-motion-example/ # Two motors sweeping in unison via a group
    ├── messaging-example/          # Key/value messages + frame monitor
    ├── neopixel-example/           # NeoPixel colour picker
    ├── ultrasonic-sensor-example/  # Distance visualisation
    ├── mpu-example/                # IMU 3D orientation visualiser
    ├── camera-example/             # MJPEG camera stream in p5.js
    └── control-panel/              # Multi-device dashboard
```

---

## Protocol

Pardalote uses a compact binary WebSocket protocol. Each frame is:

```
Byte 0      CMD          — command code
Bytes 1–2   TARGET       — pin number or extension device ID
Byte 3      NPARAMS      — number of parameters
Bytes 4–5   TYPE_MASK    — bit per param: 0 = int32, 1 = float32
Bytes 6–7   PAYLOAD_LEN  — length of optional trailing string/blob
Bytes 8+    PARAMS       — NPARAMS × 4 bytes
Bytes 8+N×4 PAYLOAD      — optional string or binary data
```

Multiple frames are batched into a single WebSocket message before sending. The `FrameBuilder` class (Arduino) and `encodeFrame()` / `encodeBatch()` functions (JS) handle this automatically.

On connect, the Arduino sends its full current state — pin modes, output values, extension configuration, NeoPixel colours, and retained messages — before signalling `ready`. Any browser connecting to a running system immediately sees live state.

[Messages](#messaging) reuse this frame unchanged (command `CMD_MESSAGE`): the value type and flags ride in the `TARGET` field, the scalar value in a param, and the key (plus any text/blob value) in the payload as `[keyLen][key][value]`.

---

## Common issues

**"Can't connect"**
- Check the IP address in `sketch.js` matches what the Arduino printed
- Arduino and browser must be on the same WiFi network
- Try refreshing — the Arduino may still be starting up

**"Connection drops every few seconds" (UNO R4)**
- This is a known UNO R4 WiFi behaviour
- Pardalote handles reconnection automatically — your sketch keeps working

**"NeoPixels don't light up"**
- Verify the pixel type: `NEO_GRB` works for most WS2812B strips, `NEO_RGB` for some others
- Call `setBrightness()` — default is 255 but strips vary
- Always call `show()` after setting pixel colours

**"IMU not responding"**
- Check SDA and SCL wiring and confirm the I2C address (AD0/SA0 pin state)
- Check Serial Monitor for `[MPU] WHO_AM_I mismatch` — the model string or wiring is wrong
- Verify your sketch has `#include <PardaloteMPU.h>`

**"IMU readings drift when stationary"**
- Run calibration with the sensor flat and still: `arduino.imu.calibrate(200)`
- The complementary filter's `ALPHA` parameter gradually pulls angles back; lower it for faster drift correction

**"Board hangs after a few seconds with the IMU example" (ESP32-WROVER and other older ESP32 boards)**
- The original ESP32 chip's I²C peripheral can stall under sustained high-rate reads, hanging the main loop. Reduce the JS poll interval to 50 ms or higher: `arduino.imu.read(50)`.
- Newer ESP32 boards (ESP32-S3, C3, etc.) and the UNO R4 don't have this limitation and can poll the IMU at 20 ms (50 Hz) reliably.

**"Servo jitters"**
- Use `setThrottle()` to limit write frequency
- Make sure the servo has adequate power (not just USB)

**"Stepper doesn't move / moves the wrong way"**
- Confirm the AccelStepper library is installed and the sketch has `#include <PardaloteStepper.h>`
- Give the motor its own supply — the coils can't run off the board's 5 V
- Nothing happens on `moveTo()`? Set a non-zero `setMaxSpeed()` and `setAcceleration()` first
- Runs backwards: swap the direction with `attach(STEP, DIR, EN, { invertDir: true })`
- Motor buzzes but won't turn: lower `setMaxSpeed()` — software step generation shares the CPU with WiFi and tops out at a few kHz
- Won't move past a point: check you haven't hit a `setLimits()` boundary

**"Stepper motor is hot / won't turn by hand when idle"**
- That's the enable pin holding torque. Call `disable()` to release the coils; `enable()` to hold again

**"Bus servo doesn't respond / `[NO RESPONSE]` in Serial Monitor"**
- Confirm the `SCServo` library is installed and the sketch has `#include <PardaloteBusServo.h>`
- Check the servo ID matches what you passed to `attach()` — run `scan()` to list responding IDs
- Baud mismatch: bus servos default to 1,000,000; set it with `configureBus({ baud })` if yours differs
- Wrong UART or swapped RX/TX — UNO R4 uses `Serial1` (D0/D1); on ESP32 set the pins with `configureBus({ rxPin, txPin })`
- Give the servos their own 6–7.4 V supply with a common ground to the board
- Using the wrong series: ST/SMS servos are `'ST'` (0–4095), SC/SCS are `'SC'` (0–1023)

**"Two bus servos both moved when I set an ID"**
- `setId()` addresses the current ID — with several servos sharing it, they all take the new ID. Renumber with a single servo on the bus at a time

**"Ultrasonic returns -1"**
- Increase timeout: `arduino.sonar.setTimeout(50)`
- Point at a flat, hard surface (fabric and foam absorb ultrasound)
- Maximum range depends on timeout: 30 ms ≈ 500 cm

---

## License

GNU General Public License v3.0

## Author

Scott Mitchell — created for design education and creative technology projects.
