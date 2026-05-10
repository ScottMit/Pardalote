# Basic LED Example

The simplest possible Pardalote sketch. A web page with two buttons that turn the Arduino's built-in LED on and off over WiFi — no p5.js, no framework.

## What This Example Does

- **Turn LED ON** — sends `digitalWrite(13, HIGH)` to the Arduino
- **Turn LED OFF** — sends `digitalWrite(13, LOW)` to the Arduino

## Hardware Requirements

- **Arduino UNO R4 WiFi** or **ESP32 development board**
- Arduino and browser must be on the same WiFi network
- **UNO R4 WiFi:** the built-in LED on pin 13 is all you need
- **ESP32:** connect an LED + 220 Ω resistor between pin 13 and GND (long leg to pin 13)

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

### 2. Set the IP address

Open `sketch.js` and update this line:

```javascript
let ArduinoIP = '192.168.1.42';
```

### 3. Open the example

Open `index.html` in a browser. Click **Turn LED ON** and **Turn LED OFF**.

## How It Works

```javascript
const arduino = new Arduino();
arduino.connect(ArduinoIP);

arduino.on('ready', function() {
    arduino.pinMode(13, OUTPUT);  // set up pin after connection is ready
});

// Button handlers
arduino.digitalWrite(13, HIGH);  // ON
arduino.digitalWrite(13, LOW);   // OFF
```

`pinMode` is called inside the `ready` handler — this ensures the WebSocket is open before the frame is sent. Calls made before `ready` would be silently dropped.

Reconnection is automatic. If the Arduino resets or the connection drops, Pardalote reconnects and restores the pin configuration.

## Troubleshooting

**"Buttons don't work"**
- Check the IP address in `sketch.js` matches the Arduino's IP
- Arduino and browser must be on the same WiFi network
- Open the browser console (F12) for connection messages

**"IP shows as 0.0.0.0" (UNO R4)**
- WiFi connection failed — check credentials via Serial Monitor (press `w` on boot)

**"LED doesn't light up" (ESP32)**
- Check wiring: long leg of LED to pin 13, short leg through 220 Ω resistor to GND

## File Structure

```
basic-LED-example/
├── index.html      # Two-button web interface
├── sketch.js       # Arduino connection and button handlers
└── README.md       # This file

pardalote-js/
└── pardalote.js    # Core Pardalote library (loaded from here)
```

## Next Steps

- Read a sensor: try the `basic-p5js-example`
- Control a servo: try the `servo-example`
- Control LED strips: try the `neopixel-example`
