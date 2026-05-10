# NeoPixel Example

An interactive p5.js colour picker that drives a NeoPixel LED strip in real time. Move the mouse across the canvas to change the strip colour; hover over the centre circle to trigger a rainbow effect.

## What This Example Does

- Draws an HSB colour field on a 600×600 p5.js canvas
- Samples the canvas colour at the mouse position and sets all 8 LEDs to match
- Hovering over the centre circle runs a per-pixel rainbow
- The circle on screen shows the colour currently sent to the strip

## Hardware Requirements

- **Arduino UNO R4 WiFi** or **ESP32 development board**
- **NeoPixel LED strip** — WS2812B or compatible, 8 LEDs (configurable)
- Arduino and browser must be on the same WiFi network

### Wiring

| NeoPixel wire | Arduino |
|---|---|
| VCC (red) | 5 V |
| GND (black) | GND |
| Data (white/yellow) | Pin 6 (configurable in sketch.js) |

For strips longer than ~30 LEDs use an external 5 V supply. Connect all grounds (Arduino, strip, supply) together. The data line still goes to the Arduino pin.

### Arduino libraries

Install via Arduino IDE → Tools → Manage Libraries:
- `WebSocketsServer` (by Markus Sattler)
- `Adafruit NeoPixel` (by Adafruit)

Also uncomment the NeoPixel include in `Pardalote.ino`:

```cpp
#include "NeoPixelExtension.h"
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

To change the pin or number of LEDs, edit the `init()` call:

```javascript
arduino.neoStrip1.init(6, 8);     // pin 6, 8 pixels
```

### 3. Open the example

Open `index.html` in a browser. Move the mouse around the colour field — the LEDs should follow. Hover over the white circle in the centre for the rainbow effect.

## How It Works

```javascript
arduino = new Arduino();
arduino.connect(ArduinoIP);

// Register the NeoPixel extension before connecting
arduino.add('neoStrip1', new NeoPixel());
arduino.neoStrip1.init(6, 8);          // pin 6, 8 pixels
arduino.neoStrip1.setBrightness(50);   // 0–255
arduino.neoStrip1.clear();
arduino.neoStrip1.show();
```

In `draw()`, colour at the mouse position is sampled from the canvas and sent to the strip:

```javascript
let pixelColor = get(mouseX, mouseY);
let neoColor = arduino.neoStrip1.Color(red(pixelColor), green(pixelColor), blue(pixelColor));
arduino.neoStrip1.fill(neoColor, 0, 8);
arduino.neoStrip1.show();    // must call show() to push changes to the LEDs
```

Changes are buffered locally until `show()` is called — this means you can set many pixels in one `draw()` pass and send them all in a single message.

## Script loading order

`pardalote.js` must load before `neoPixel.js`:

```html
<script src="../../pardalote-js/pardalote.js"></script>
<script src="../../pardalote-js/neoPixel.js"></script>
<script src="sketch.js"></script>
```

## Troubleshooting

**"LEDs don't light up"**
- Check VCC → 5 V, GND → GND, data → pin 6
- Verify `NeoPixelExtension.h` is uncommented in `Pardalote.ino`
- Try a lower brightness: `arduino.neoStrip1.setBrightness(20)`
- Always call `show()` after setting colours

**"Wrong colours"**
- Most WS2812B strips use `NEO_GRB`. Try:
  ```javascript
  arduino.neoStrip1.init(6, 8, NEO_GRB + NEO_KHZ800);
  ```
- SK6812 RGBW strips use `NEO_GRBW + NEO_KHZ800`

**"LEDs flicker"**
- Power issue — add an external 5 V supply for strips longer than ~30 LEDs
- Add a 470 Ω resistor between the Arduino data pin and the strip for longer runs

**"Performance is slow" (UNO R4)**
- The UNO R4 WiFi WebSocket implementation occasionally drops connections — Pardalote reconnects automatically
- Increase the threshold to reduce traffic: `arduino.neoStrip1.setThreshold(10)`

## File Structure

```
neopixel-example/
├── index.html      # Canvas page (loads p5.js, pardalote.js, neoPixel.js)
├── sketch.js       # NeoPixel colour picker
└── README.md       # This file

pardalote-js/
├── pardalote.js    # Core Pardalote library
└── neoPixel.js     # NeoPixel extension
```

## Next Steps

- Add a second strip: `arduino.add('strip2', new NeoPixel())` — up to 4 strips simultaneously
- Drive colours from a sensor: combine with `analogRead()` or the Ultrasonic extension
- Try the `control-panel` example for a multi-device dashboard
