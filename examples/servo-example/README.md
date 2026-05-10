# Servo Example

A p5.js sketch that lets you control a servo with the mouse or keyboard. Visualises the servo arm angle on screen in real time.

## What This Example Does

- **Mouse mode (default):** horizontal mouse position maps directly to servo angle (0–180°)
- **Auto sweep:** presses `S` to continuously sweep the servo back and forth using `sweep()`
- **Preset positions:** `C` = centre (90°), `L` = min (0°), `R` = max (180°)
- **Angle display:** a servo arm is drawn on the canvas, updated live from `read()`

## Hardware Requirements

- **Arduino UNO R4 WiFi** or **ESP32 development board**
- **Servo motor** (standard 5 V hobby servo)
- Arduino and browser must be on the same WiFi network

### Wiring

| Servo wire | Arduino |
|---|---|
| Power (red) | 5 V |
| Ground (brown/black) | GND |
| Signal (orange/yellow) | Pin 7 (configurable in sketch.js) |

For more than one or two servos, power them from an external 5 V supply rather than the Arduino's 5 V pin.

### Arduino libraries

Install via Arduino IDE → Tools → Manage Libraries:
- `WebSocketsServer` (by Markus Sattler)
- `ESP32Servo` (ESP32 only — not needed for UNO R4)

Also uncomment the Servo include in `Pardalote.ino`:

```cpp
#include "ServoExtension.h"
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

The sketch attaches the servo to pin 7. Change `attach(7)` in `setup()` if you use a different pin.

### 3. Open the example

Open `index.html` in a browser. Move the mouse left and right — the servo should follow. Use the keyboard shortcuts shown on screen.

## How It Works

```javascript
arduino = new Arduino();
arduino.connect(ArduinoIP);

// Register the servo extension
arduino.add('myServo', new Servo());
arduino.myServo.attach(7);    // attach to pin 7
arduino.myServo.center();     // move to 90° on startup
```

Mouse control in `draw()`:

```javascript
let targetAngle = map(mouseX, 0, width, 0, 180);
arduino.myServo.write(targetAngle);

// read() returns the cached angle — no extra network traffic
angle = arduino.myServo.read();
```

Auto sweep uses `await` — it runs as a background async loop without blocking `draw()`:

```javascript
async function autoSweep() {
    while (machineState === 2) {
        await arduino.myServo.sweep(0, 180, 2000);   // 0→180 over 2 s
        await arduino.myServo.sweep(180, 0, 2000, 10); // 180→0, 10 steps
    }
}
```

Any `write()` call cancels an in-progress sweep immediately.

## Keyboard controls

| Key | Action |
|---|---|
| M | Mouse controls angle |
| S | Auto sweep |
| C | Centre (90°) |
| L | Min (0°) |
| R | Max (180°) |

## Script loading order

`pardalote.js` must load before `servo.js`:

```html
<script src="../../pardalote-js/pardalote.js"></script>
<script src="../../pardalote-js/servo.js"></script>
<script src="sketch.js"></script>
```

## Troubleshooting

**"Servo doesn't move"**
- Check wiring: signal to pin 7, power to 5 V, ground to GND
- Verify `ServoExtension.h` is uncommented in `Pardalote.ino`
- Check the browser console for connection errors

**"Servo jitters"**
- `write()` is called every frame in mouse mode — the library has a built-in 20 ms throttle, but if the servo still jitters check its power supply
- Use `setThreshold(2)` to ignore small angle changes: `arduino.myServo.setThreshold(2)`

**"Servo moves to wrong position on startup"**
- `center()` moves to 90° — if the servo arm is mounted off-centre this is mechanical, not a code issue

## File Structure

```
servo-example/
├── index.html      # Canvas page (loads p5.js, pardalote.js, servo.js)
├── sketch.js       # Servo control and visualisation
└── README.md       # This file

pardalote-js/
├── pardalote.js    # Core Pardalote library
└── servo.js        # Servo extension
```

## Next Steps

- Up to 8 servos simultaneously: `arduino.add('tilt', new Servo())`
- Fine-grained control: `arduino.myServo.writeMicroseconds(1500)`
- Custom pulse range: `arduino.myServo.attach(7, 544, 2400)`
- Combine with a sensor: map `analogRead()` directly to servo angle
