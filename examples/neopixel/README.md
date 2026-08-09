# NeoPixel

An interactive p5.js colour mixer that drives a NeoPixel LED strip in real time. Move the mouse across the canvas — left/right for hue, up/down for brightness — and the strip follows the colour under the cursor. Hover the centre for white.

## What This Example Does

- Draws an HSB colour field on a 600×400 p5.js canvas
- Samples the canvas colour under the mouse and sets all 8 LEDs to match — or white when the cursor is over the centre circle
- The circle in the middle previews the colour currently sent to the strip

## Hardware Requirements

- **Arduino UNO R4 WiFi** or **ESP32 development board**
- **NeoPixel LED strip** — WS2812B or compatible, 8 LEDs (configurable)
- Arduino and browser must be on the same WiFi network

### Wiring

| NeoPixel wire | Arduino |
|---|---|
| VCC (red) | 5 V |
| GND (black) | GND |
| Data (white/yellow) | Pin 11 (configurable in sketch.js) |

For strips longer than ~30 LEDs use an external 5 V supply. Connect all grounds (Arduino, strip, supply) together. The data line still goes to the Arduino pin.

### Arduino libraries

Install via Arduino IDE → Tools → Manage Libraries:
- `WebSocketsServer` (by Markus Sattler)
- `Adafruit NeoPixel` (by Adafruit)

Install Pardalote itself by copying `pardalote-arduino/library/Pardalote/` into your Arduino libraries folder (see the [top-level README](../../README.md#pardalote-library)).

## Quick Start

### 1. Upload the firmware

1. In Arduino IDE: **File → Examples → Pardalote → neopixel**. The sketch is two lines:
   ```cpp
   #include <Pardalote.h>
   #include <PardaloteNeoPixel.h>

   void setup() { Pardalote.begin(); }
   void loop()  { Pardalote.run();   }
   ```
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

   **Prefer compile-time credentials?** Create a `secrets.h` file in the sketch folder with:
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

To change the pin or number of LEDs, edit the two variables near the top:

```javascript
let pixelPin  = 11;   // data pin the strip is wired to
let numPixels = 8;    // how many LEDs on the strip
```

### 3. Open the example

Open `index.html` in a browser. Move the mouse across the colour field — the LEDs follow the colour under the cursor, and the circle in the middle previews it. Hover the centre for white.

## How It Works

```javascript
arduino = new Arduino();
arduino.add('strip', new NeoPixel());   // register the extension before connecting

// configure the strip once the board is ready
arduino.on('ready', () => {
    arduino.strip.init(pixelPin, numPixels);  // pin 11, 8 pixels
    arduino.strip.setBrightness(50);          // 0–255
    arduino.strip.clear();
    arduino.strip.show();
});

arduino.connect(ArduinoIP);
```

In `draw()`, the colour under the mouse is sampled from the canvas and sent to the strip (or white when the cursor is over the centre circle):

```javascript
let pixelColor = get(mouseX, mouseY);
let neoColor = arduino.strip.Color(red(pixelColor), green(pixelColor), blue(pixelColor));
arduino.strip.fill(neoColor, 0, numPixels);
arduino.strip.show();    // must call show() to push changes to the LEDs
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
- Check VCC → 5 V, GND → GND, data → pin 11
- Verify the sketch has `#include <PardaloteNeoPixel.h>`
- Try a lower brightness: `arduino.strip.setBrightness(20)`
- Always call `show()` after setting colours

**"Wrong colours"**
- Most WS2812B strips use `NEO_GRB`. Try:
  ```javascript
  arduino.strip.init(11, 8, NEO_GRB + NEO_KHZ800);
  ```
- SK6812 RGBW strips use `NEO_GRBW + NEO_KHZ800`

**"LEDs flicker"**
- Power issue — add an external 5 V supply for strips longer than ~30 LEDs
- Add a 470 Ω resistor between the Arduino data pin and the strip for longer runs

**"Performance is slow" or "colours lag behind the cursor" (UNO R4)**
- The UNO R4 WiFi WebSocket implementation occasionally drops connections — Pardalote reconnects automatically
- Raise the colour-distance threshold to skip tiny changes: `arduino.strip.setThreshold(10)`
- Raise the show throttle to cap how often updates are sent: `arduino.strip.setThrottle(50)` (default 20 ms = ~50 Hz; 50 ms = ~20 Hz is gentler on slow WiFi)

## File Structure

```
neopixel/
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
