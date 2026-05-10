# Pardalote

Control Arduino hardware directly from a web browser over WiFi — no USB cable, no server, no Node.js. Write JavaScript that reads sensors and drives LEDs, servos, and NeoPixel strips using an API that mirrors Arduino's own function names.

Designed for creative coders, design students, and makers who want to connect physical hardware to web interfaces with minimal setup.

---

## What you need

### Hardware
- **Arduino UNO R4 WiFi** or **ESP32 development board**
- Arduino and browser must be on the same WiFi network

### Software
- Arduino IDE (arduino.cc)
- A web browser
- A text editor

### Arduino libraries (install via Arduino IDE → Tools → Manage Libraries)
- `WebSocketsServer` (by Markus Sattler)
- `Adafruit NeoPixel` (if using LED strips)
- `ESP32Servo` (if using servos on ESP32)

---

## Quick start

### 1. Configure WiFi

There are two ways to give Pardalote your WiFi credentials — use either or both:

**Option A — Compile-time (`secrets.h`)**

Open `pardalote-arduino/Pardalote/secrets.h` and uncomment the two lines:
```cpp
#define SECRET_SSID "YourWiFiName"
#define SECRET_PASS "YourWiFiPassword"
```
The credentials are baked into the firmware. Simple, but if you share or publish your code, add `secrets.h` to `.gitignore` first.

**Option B — EEPROM (Serial Monitor)**

Leave `secrets.h` unchanged (both lines commented out). On first boot, Pardalote detects that no credentials are stored and prompts you via the Serial Monitor at 115200 baud:
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

1. Open `pardalote-arduino/Pardalote/Pardalote.ino` in Arduino IDE
2. Select your board and upload
3. Find the IP address once connected:
   - **UNO R4 WiFi:** scrolls across the LED matrix
   - **ESP32:** printed in Serial Monitor at 115200 baud

### 2. Open an example

Navigate to the `examples/` folder, and pick an example. Update the IP address in `sketch.js` to match your Arduino, and open `index.html` in a browser.

---

## JavaScript API

### Connecting

```javascript
const arduino = new Arduino();
arduino.connect('192.168.1.42');        // WebSocket on port 81
arduino.connect('192.168.1.42', 8081);  // custom port

// Events
arduino.on('ready',      () => { /* Arduino connected and state synced */ });
arduino.on('connect',    () => { /* WebSocket open — before ready */ });
arduino.on('disconnect', () => { /* connection lost */ });

arduino.disconnect();  // stop and disable auto-reconnect
```

The `ready` event fires after the Arduino has sent its current state to the browser — pins, extensions, pixel colours. Any client connecting to a running system immediately sees the live state.

Reconnection is automatic with exponential backoff. You don't need to do anything.

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

The analog range depends on the board. Use `arduino.analogMax` — it's set automatically from the HELLO handshake:

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
arduino.attach(SDA);
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
<script src="neoPixel.js"></script>
<script src="ultrasonic.js"></script>
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

#### Smooth sweep

```javascript
// Sweep from 0° to 180° over 2 seconds (50 steps)
await arduino.pan.sweep(0, 180, 2000);
await arduino.pan.sweep(0, 180, 2000, 100); // more steps = smoother

// Any write() call cancels an in-progress sweep
arduino.pan.write(90); // stops sweep immediately
```

#### Events

```javascript
arduino.pan.on('read',     ({ angle }) => { });
arduino.pan.on('write',    ({ angle }) => { });
arduino.pan.on('attached', ({ attached }) => { });

// Shorthand
arduino.pan.onRead(fn);
arduino.pan.onWrite(fn);
arduino.pan.onAttached(fn);
```

#### Configuration

```javascript
arduino.pan.setThrottle(20);   // min ms between writes (default 20)
arduino.pan.setThreshold(1);   // min degrees change to send (default 1)
arduino.pan.getState();        // snapshot of all servo state
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
arduino.ceiling.numPixelsCount();             // number of pixels
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

#### Threshold

Pixel changes below the colour distance threshold are ignored — useful for animation loops that might send identical values:

```javascript
arduino.ceiling.setThreshold(5);  // default 5
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

## Enabling extensions in the firmware

Extensions are opt-in. Uncomment the lines you need in `Pardalote.ino`:

```cpp
#include "ServoExtension.h"
// #include "NeoPixelExtension.h"
// #include "UltrasonicExtension.h"
```

That's all — extensions self-register and require no other changes to the sketch.

---

## Project structure

```
Pardalote_v18/
├── pardalote-arduino/
│   └── Pardalote/
│       ├── Pardalote.ino           # Main Arduino sketch
│       ├── defs.h                  # Protocol constants (single source of truth)
│       ├── protocol.h              # Binary frame encoding/decoding
│       ├── extensions.h            # Extension registry and dispatch
│       ├── wifi_config.h           # WiFi credential storage
│       ├── secrets.h               # Your WiFi credentials (create this file)
│       ├── ServoExtension.h        # Servo support (up to 8)
│       ├── NeoPixelExtension.h     # NeoPixel support (up to 4 strips)
│       └── UltrasonicExtension.h   # Ultrasonic support (up to 4 sensors)
│
├── pardalote-js/
│   ├── pardalote.js                       # Core library — always include first
│   ├── servo.js                           # Servo extension
│   ├── neoPixel.js                        # NeoPixel extension
│   ├── ultrasonic.js                      # Ultrasonic extension
│   ├── pardalote-pins-uno-r4-wifi.js      # Pin aliases for UNO R4 WiFi
│   ├── pardalote-pins-esp32-wrover-dev.js # Pin aliases for ESP32-WROVER-DEV
│   └── pardalote-pins-firebeetle2-esp32-c5.js
│
└── examples/
    ├── basic-LED-example/          # digitalWrite — no p5.js
    ├── basic-p5js-example/         # analogRead with p5.js
    ├── servo-example/              # Servo sweep with p5.js
    ├── servo-test/                 # Servo angle control
    ├── neopixel-example/           # NeoPixel colour picker
    ├── ultrasonic-sensor-example/  # Distance visualisation
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

On connect, the Arduino sends its full current state — pin modes, output values, extension configuration, NeoPixel colours — before signalling `ready`. Any browser connecting to a running system immediately sees live state.

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

**"Servo jitters"**
- Use `setThrottle()` to limit write frequency
- Make sure the servo has adequate power (not just USB)

**"Ultrasonic returns -1"**
- Increase timeout: `arduino.sonar.setTimeout(50)`
- Point at a flat, hard surface (fabric and foam absorb ultrasound)
- Maximum range depends on timeout: 30 ms ≈ 500 cm

---

## License

GNU General Public License v3.0

## Author

Scott Mitchell — created for design education and creative technology projects.
