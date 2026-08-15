title: Installation
lede: What you need and where to put it — hardware, software, and the two Pardalote libraries.
---
## Hardware

- **Arduino UNO R4 WiFi**, **ESP32 development board**, or **Arduino UNO R4 Minima** (USB serial only — it has no radio)
- Over WiFi: the Arduino and your browser must be on the same network. Over USB serial: just the cable, using Chrome or Edge ([details](connecting.html#connectserial))

## Software

- Arduino IDE ([arduino.cc](https://www.arduino.cc))
- A web browser
- A code or text editor

## Arduino libraries

Install via Arduino IDE → Tools → Manage Libraries. Only install what your hardware needs:

| Library | Needed for |
|---|---|
| `WebSocketsServer` (Markus Sattler) | Always required on WiFi boards (not needed on the UNO R4 Minima — its serial-only build compiles the WiFi path out) |
| `Adafruit NeoPixel` | LED strips |
| `ESP32Servo` | Servos on ESP32 |
| `AccelStepper` (Mike McCauley) | Stepper motors |
| `SCServo` (Feetech/Waveshare) | Serial bus servos — install **"SCServo" by FT&WS** from the Library Manager, or a ZIP from the Waveshare wiki / Feetech SDK |

No extra library is needed for the IMU extension — it reads sensor registers directly over I2C. The camera extension needs only the ESP32 Arduino core.

## The Pardalote Arduino library

The easiest way is the **Library Manager**: in the Arduino IDE open **Tools → Manage Libraries…**, search for **Pardalote**, and click **Install**. The IDE offers to also install the required dependency (`WebSockets` by Markus Sattler) — accept it. Pardalote then appears under **File → Examples → Pardalote**, and future updates arrive through the Library Manager too.

**Manual install** — for a specific version, or a build not yet in the index. Download the Arduino library ZIP from the [download page](../download.html), then either:

- **Sketch → Include Library → Add .ZIP Library…** and select the ZIP, or
- unzip the `Pardalote` folder into your Arduino libraries folder and restart the IDE:

| OS | Libraries folder |
|---|---|
| macOS | `~/Documents/Arduino/libraries/` |
| Windows | `Documents\Arduino\libraries\` |
| Linux | `~/Arduino/libraries/` |

## The Pardalote JavaScript library

No install step: copy `pardalote.js` next to your web page and include it with a script tag. `pardalote.js` is the all-in-one bundle — it contains the core **plus every device extension** (Servo, Stepper, BusServo, NeoPixel, Ultrasonic, IMU, Encoder, Camera), so it is the only Pardalote file you need. It must load before your sketch:

```html index.html — script loading order
<script src="pardalote.js"></script>
<script src="pardalote-pins-esp32-wrover-dev.js"></script>  <!-- optional pin aliases for your board -->
<script src="sketch.js"></script>
```

Advanced: the modular sources live in `lib/src/` (`pardalote-core.js` plus one `pardalote-<device>.js` per extension) if you would rather include only specific files. The bundle is simply those concatenated, rebuilt with `build_pardalote.py`. Board pin maps (`pardalote-pins-*.js`) are per-board and are never bundled — include the one for your board.

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
