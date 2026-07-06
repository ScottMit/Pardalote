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

`pardalote.js` must load before any extension files. Extension files must load before your sketch:

```html index.html — script loading order
<script src="pardalote.js"></script>
<script src="pardalote-pins-esp32-wrover-dev.js"></script>  <!-- optional -->
<script src="servo.js"></script>       <!-- optional extensions -->
<script src="stepper.js"></script>
<script src="busServo.js"></script>
<script src="neoPixel.js"></script>
<script src="ultrasonic.js"></script>
<script src="mpu.js"></script>
<script src="camera.js"></script>
<script src="sketch.js"></script>
```

## Enabling extensions in the firmware

Extensions are opt-in on the Arduino side too. Add the headers you need to your sketch:

```cpp sketch.ino — opt-in extensions
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

## The extensions

| Extension | Supports | Limit |
|---|---|---|
| [Servo](servo.html) | PWM hobby servos | 8 |
| [Stepper](stepper.html) | STEP/DIR and 4-wire drivers via AccelStepper | 6 |
| [Bus servo](bus-servo.html) | Feetech ST/SMS and SC/SCS serial servos | 16 |
| [NeoPixel](neopixel.html) | WS2812B-style LED strips | 4 strips |
| [Ultrasonic](ultrasonic.html) | HC-SR04 and similar distance sensors | 4 |
| [MPU / IMU](mpu.html) | InvenSense MPU and STMicro LSM6 families | 2 |
| [Camera](camera.html) | ESP32 camera modules (MJPEG over HTTP) | 1 stream |

[Groups](groups.html) let you drive several actuators together — one message, coordinated arrival.

## Rolling your own

An extension is a JS file paired with an Arduino header: the JS side sends commands over the shared protocol, the Arduino side registers handlers for them. The built-in extensions are the best templates — pick the one closest to your hardware and start from its source. See [Protocol](protocol.html) for the frame format.
