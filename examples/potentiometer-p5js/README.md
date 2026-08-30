# Potentiometer

A minimal Pardalote sketch using p5.js. Reads an analog sensor (potentiometer) and uses the value to draw a circle whose size follows the sensor in real time.

## What This Example Does

- Reads a potentiometer connected to an analog pin
- Draws a circle on a p5.js canvas — larger when the sensor reads high, smaller when it reads low
- Circle is green when the Arduino is connected, red when disconnected

## Hardware Requirements

- **Arduino UNO R4 WiFi** or **ESP32 development board**
- **Potentiometer** (10 kΩ recommended)
- **Breadboard and jumper wires**
- Arduino and browser must be on the same WiFi network

### Wiring

| Potentiometer pin | Arduino |
|---|---|
| Center (wiper) | Pin 33 (ESP32) or A0 (UNO R4) |
| One outer pin | 3.3 V (ESP32) or 5 V (UNO R4) |
| Other outer pin | GND |

Set the wiper's pin in the **Wiring** row on the page (default 14 = A0 on the UNO R4).

## Quick Start

### 1. Upload the firmware

1. In Arduino IDE: **File → Examples → Pardalote → minimal-pardalote**
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

### 2. Open the example and connect

Open `index.html` in a browser. In the **Board** row, enter the Arduino's IP
(or switch to **USB**) and press **Connect**, then set the **pot pin** in the
**Wiring** row. Both settings are remembered per browser — no code editing
needed. Turn the potentiometer — the circle should grow and shrink.

Named pins like `A0` and `D13` also work by name in your own sketches, each
resolving to the right physical pin for the board you connect to (see the
[Pins reference](../../docs-src/reference/pins.md)); this page uses a raw GPIO
number in the pin field.

## How It Works

```javascript
arduino = new Arduino();
arduino.connect(ip);   // ip comes from the Board field on the page

// Configure pin with a 50 ms poll interval
arduino.pinMode(potPin, ANALOG_INPUT_MODE, 50);
```

In `draw()`, `analogRead()` returns the latest cached value — no extra network traffic:

```javascript
let dial = arduino.analogRead(POTPIN);
let circleRadius = map(dial, 0, arduino.analogMax, 2, 100);
```

`arduino.analogMax` is set automatically from the board type:

| Board | `analogMax` |
|---|---|
| UNO R4 WiFi | 1023 |
| ESP32 | 4095 |

Use `arduino.analogMax` rather than a hard-coded value to make your sketch portable between boards.

## Troubleshooting

**"Circle doesn't change size"**
- Check the potentiometer wiring (center to analog pin, outers to power and GND)
- Verify `POTPIN` matches the pin you wired
- Open the browser console (F12) for connection messages

**"Circle is always red"**
- Arduino is not connected — check the IP address and WiFi

**"Circle jumps around erratically"**
- Power issue: make sure the potentiometer outer pins are connected to a stable rail

## File Structure

```
potentiometer-p5js/
├── index.html      # Canvas page (loads p5.js and the pardalote.js bundle)
├── sketch.js       # p5.js setup() and draw()
├── style.css       # Pardalote example house style
└── README.md       # This file

dist/
└── pardalote.js    # Pardalote bundle (core + all extensions)
```

## Next Steps

- Add digital output: try the `basic-light-switch`
- Read distance: try the `ultrasonic-sensor`
- Control a servo from a sensor value: try the `servo-control`
