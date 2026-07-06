title: Installation
lede: What you need and where to put it — hardware, software, and the two Pardalote libraries.
---
## Hardware

- **Arduino UNO R4 WiFi** or **ESP32 development board**
- The Arduino and your browser must be on the same WiFi network

## Software

- Arduino IDE ([arduino.cc](https://www.arduino.cc))
- A web browser
- A code or text editor

## Arduino libraries

Install via Arduino IDE → Tools → Manage Libraries. Only install what your hardware needs:

| Library | Needed for |
|---|---|
| `WebSocketsServer` (Markus Sattler) | Always required |
| `Adafruit NeoPixel` | LED strips |
| `ESP32Servo` | Servos on ESP32 |
| `AccelStepper` (Mike McCauley) | Stepper motors |
| `SCServo` (Feetech/Waveshare) | Serial bus servos — usually a ZIP from the Waveshare wiki or Feetech SDK, not in the Library Manager |

No extra library is needed for the MPU / IMU extension — it reads sensor registers directly over I2C. The camera extension needs only the ESP32 Arduino core.

## The Pardalote Arduino library

Pardalote ships as an Arduino library. Install it by copying the `Pardalote` folder from the download into your Arduino libraries folder:

| OS | Libraries folder |
|---|---|
| macOS | `~/Documents/Arduino/libraries/` |
| Windows | `Documents\Arduino\libraries\` |
| Linux | `~/Arduino/libraries/` |

Restart Arduino IDE — Pardalote now appears under **File → Examples → Pardalote**.

## The Pardalote JavaScript library

No install step: copy `pardalote.js` (plus any extension files you want) next to your web page and include it with a script tag. `pardalote.js` must load before any extension file, and extensions before your sketch:

```html index.html — script loading order
<script src="pardalote.js"></script>
<script src="pardalote-pins-esp32-wrover-dev.js"></script>  <!-- optional pin aliases -->
<script src="servo.js"></script>       <!-- optional extensions -->
<script src="neoPixel.js"></script>
<script src="sketch.js"></script>
```

## A minimal sketch

A complete Pardalote sketch is two lines of `setup()` and one line of `loop()`:

```cpp sketch.ino — a complete Pardalote sketch
#include <Pardalote.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
```

Extensions self-register when included — see [Extensions](extensions.html).

## Finding the board's IP address

After uploading and joining WiFi (see [WiFi configuration](wifi.html)):

- **UNO R4 WiFi:** the IP address scrolls across the LED matrix
- **ESP32:** the IP is printed in the Serial Monitor at 115200 baud

Put that address into your JavaScript: `arduino.connect('192.168.1.42')`.
