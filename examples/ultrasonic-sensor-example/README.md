# Ultrasonic Sensor Example

A p5.js sketch that reads an HC-SR04 ultrasonic distance sensor and visualises the result as a colour bar. Distance and connection status are shown on screen in real time.

## What This Example Does

- Polls the ultrasonic sensor every 200 ms
- Draws a vertical bar whose height represents distance (0–200 cm)
- Bar colour shifts from red (close) to green (far) using HSB colour mode
- Shows distance in cm and Arduino connection status

## Hardware Requirements

- **Arduino UNO R4 WiFi** or **ESP32 development board**
- **HC-SR04** ultrasonic sensor (or compatible: JSN-SR04T, HY-SRF05, etc.)
- Arduino and browser must be on the same WiFi network

### Wiring (4-wire, HC-SR04)

| Sensor pin | Arduino |
|---|---|
| VCC | 5 V |
| GND | GND |
| TRIG | Pin 7 |
| ECHO | Pin 8 |

The example uses pins 7 (trig) and 8 (echo). Change `attach(7, 8)` in `sketch.js` if you use different pins.

**3-wire sensor** (trig and echo on the same pin): `arduino.ultrasonicSensor.attach(7)`.

### Arduino libraries

Install via Arduino IDE → Tools → Manage Libraries:
- `WebSocketsServer` (by Markus Sattler)

Also uncomment the Ultrasonic include in `Pardalote.ino`:

```cpp
#include "UltrasonicExtension.h"
```

## Quick Start

### 1. Upload the firmware

1. Open `pardalote-arduino/Pardalote/Pardalote.ino` in Arduino IDE
2. Select your board and upload
3. Open the Serial Monitor at 115200 baud — on first boot Pardalote asks for your WiFi credentials:
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
   Credentials are saved to EEPROM and survive re-uploads. Press `w` within 5 seconds of any boot to update them.

   **Prefer compile-time credentials?** Uncomment the two lines in `secrets.h`:
   ```cpp
   #define SECRET_SSID "YourWiFiName"
   #define SECRET_PASS "YourWiFiPassword"
   ```
   If both are configured, `secrets.h` is tried first.

4. Find your Arduino's IP address:
   - **UNO R4 WiFi:** scrolls across the LED matrix
   - **ESP32:** printed in the Serial Monitor

### 2. Configure sketch.js

```javascript
let ArduinoIP = '192.168.1.42';   // your Arduino's IP
```

### 3. Open the example

Open `index.html` in a browser. Move an object in front of the sensor — the bar should respond.

## How It Works

```javascript
arduino = new Arduino();
arduino.connect(ArduinoIP);

// Register the ultrasonic extension
arduino.add('ultrasonicSensor', new Ultrasonic());
arduino.ultrasonicSensor.attach(7, 8);     // trig pin 7, echo pin 8
arduino.ultrasonicSensor.setTimeout(40);   // 40 ms echo timeout ≈ 686 cm max range
arduino.ultrasonicSensor.read(200, CM);    // poll every 200 ms, return cm
```

In `draw()`, `read()` returns the latest cached value — no extra network traffic:

```javascript
let cm = arduino.ultrasonicSensor.read();
```

A return value of `-1` means the echo timed out (nothing in range, or object too far away).

### Echo timeout and range

The echo timeout determines maximum detectable range:

| Timeout | Approximate max range |
|---|---|
| 30 ms (default) | ~500 cm |
| 40 ms | ~686 cm |

Increase with `setTimeout()` for longer range; decrease to speed up failed reads.

## Script loading order

`pardalote.js` must load before `ultrasonic.js`:

```html
<script src="../../pardalote-js/pardalote.js"></script>
<script src="../../pardalote-js/ultrasonic.js"></script>
<script src="sketch.js"></script>
```

## Troubleshooting

**"Always reads -1"**
- Echo timeout too short — try `arduino.ultrasonicSensor.setTimeout(50)`
- Point the sensor at a flat, hard surface (fabric and foam absorb ultrasound)
- Check wiring: TRIG and ECHO to the correct pins

**"Readings jump around"**
- Normal for ultrasound — add smoothing in `draw()` with a rolling average
- Make sure the sensor has a clear line of sight with no nearby reflective surfaces

**"Sensor doesn't respond at all"**
- Verify `UltrasonicExtension.h` is uncommented in `Pardalote.ino`
- Check VCC → 5 V and GND → GND

**"Arduino won't connect"**
- Check the IP address in `sketch.js`
- Arduino and browser must be on the same WiFi network

## File Structure

```
ultrasonic-sensor-example/
├── index.html      # Canvas page (loads p5.js, pardalote.js, ultrasonic.js)
├── sketch.js       # Sensor setup and distance visualisation
└── README.md       # This file

pardalote-js/
├── pardalote.js    # Core Pardalote library
└── ultrasonic.js   # Ultrasonic extension
```

## Next Steps

- Read in inches: `arduino.ultrasonicSensor.read(200, INCH)`
- Use as a trigger: fire an event when distance crosses a threshold with `onChange()`
- Up to 4 sensors simultaneously: `arduino.add('front', new Ultrasonic())`, `arduino.add('side', new Ultrasonic())`
- Combine with servos or NeoPixels to build reactive physical installations
