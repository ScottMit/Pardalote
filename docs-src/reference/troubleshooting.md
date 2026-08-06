title: Troubleshooting
lede: Common issues and their usual fixes, roughly in the order people hit them.
---
## "Can't connect"

- Check the IP address in `sketch.js` matches what the Arduino printed
- Arduino and browser must be on the same WiFi network
- Try refreshing — the Arduino may still be starting up

## "Connection drops every few seconds" (UNO R4)

- This is a known UNO R4 WiFi behaviour
- Pardalote handles reconnection automatically — your sketch keeps working

## "WebSocket is unstable on the UNO R4 — drops, freezes, or reconnects"

- **Keep your `loop()` tight.** The UNO R4 WiFi's WebSocket stack (WiFiS3 + arduinoWebSockets) is sensitive to how often it is serviced. Anything that blocks or slows the loop — a `delay()`, a long computation, a busy blocking peripheral — starves the WebSocket of servicing, and the connection stalls, drops, or churns "client connection lost / new client" and reconnects. A single blocking `delay(100)` in `loop()` is enough to trigger it. (See [arduinoWebSockets issue #909](https://github.com/Links2004/arduinoWebSockets/issues/909).)
- The symptom is often **indirect**. For example, dragging an `analogWrite()` PWM slider may lag and then drop the socket — not because `analogWrite()` is slow, but because something else in the loop is blocking long enough that the extra slider traffic can't be serviced in time. Fix the blocking, not the slider.
- Fixes: remove `delay()` calls from `loop()`; move slow work off the hot path; if you must do something lengthy, call `Pardalote.run()` (which services the WebSocket) periodically while it runs. The ESP32 is far less sensitive to this.
- As a smaller, defensive measure, Pardalote also throttles PWM writes by default (a leading write goes out immediately, rapid follow-ups coalesce into one send carrying the final value) so a slider can't flood the loop with parse work. If you've set `setWriteThrottle(0)`, raise it — `arduino.setWriteThrottle(20)` caps the rate to ~50/s per pin; `arduino.setWriteThreshold(4)` skips sub-4 duty changes.

## "connectSerial() can't find or open the port"

- Web Serial only exists in **Chrome and Edge** (Chromebooks included) — Safari and Firefox can't do serial; use WiFi there.
- **Close the Arduino IDE's Serial Monitor** (and Serial Plotter) first. Only one program can hold the port — if the IDE has it, the browser's picker shows the port but opening it fails, and vice versa: while the browser is connected, the IDE can't open the Serial Monitor.
- The first `connectSerial()` must be triggered by a click — browsers only show the port picker from a user gesture.
- Unplugged and replugged? Pardalote re-acquires the port automatically on the next retry; if it doesn't, click Connect again.

## "The board resets when the browser connects over serial" (ESP32)

Expected. Opening the serial port toggles the DTR/RTS lines, and the auto-reset circuit on classic ESP32 dev boards restarts the chip — the same thing the IDE does before uploading. Pardalote's probe simply waits through the reboot and connects when the board comes back (a few seconds). The UNO R4's native USB doesn't reset on open.

## "Serial connection works, then dies after a NeoPixel animation" 

`show()` disables interrupts while it streams the strip, which can drop incoming serial bytes. Pardalote's serial framing detects the corruption (CRC) and drops that message rather than desyncing — occasional lost frames during heavy animation are expected; the link itself recovers on its own.

## "NeoPixels don't light up"

- Verify the pixel type: `NEO_GRB` works for most WS2812B strips, `NEO_RGB` for some others
- Call `setBrightness()` — default is 255 but strips vary
- Always call `show()` after setting pixel colours

## "IMU not responding"

- Check SDA and SCL wiring and confirm the I2C address (AD0/SA0 pin state)
- Check Serial Monitor for `IMU WHO_AM_I mismatch` — the model string or wiring is wrong
- Verify your sketch has `#include <PardaloteIMU.h>`

## "IMU readings drift when stationary"

- Run calibration with the sensor flat and still: `arduino.imu.calibrate(200)`
- The complementary filter's `ALPHA` parameter gradually pulls angles back; lower it for faster drift correction

## "Board hangs after a few seconds with the IMU example" (ESP32-WROVER and other older ESP32 boards)

- The original ESP32 chip's I²C peripheral can stall under sustained high-rate reads, hanging the main loop. Reduce the JS poll interval to 50 ms or higher: `arduino.imu.read(50)`
- Newer ESP32 boards (ESP32-S3, C3, etc.) and the UNO R4 don't have this limitation and can poll the IMU at 20 ms (50 Hz) reliably

## "Servo jitters"

- Use `setWriteThrottle()` to limit write frequency
- Make sure the servo has adequate power (not just USB)

## "Stepper doesn't move / moves the wrong way"

- Confirm the AccelStepper library is installed and the sketch has `#include <PardaloteStepper.h>`
- Give the motor its own supply — the coils can't run off the board's 5 V
- Nothing happens on `moveTo()`? Set a non-zero `setMaxSpeed()` and `setAcceleration()` first
- Runs backwards: swap the direction with `attach(STEP, DIR, EN, { invertDir: true })`
- Motor buzzes but won't turn: lower `setMaxSpeed()` — software step generation shares the CPU with WiFi and tops out at a few kHz
- Won't move past a point: check you haven't hit a `setLimits()` boundary

## "Stepper motor is hot / won't turn by hand when idle"

- That's the enable pin holding torque. Call `disable()` to release the coils; `enable()` to hold again

## "Bus servo doesn't respond / [NO RESPONSE] in Serial Monitor"

- Confirm the `SCServo` library is installed and the sketch has `#include <PardaloteBusServo.h>`
- Check the servo ID matches what you passed to `attach()` — run `scan()` to list responding IDs
- Baud mismatch: bus servos default to 1,000,000; set it with `configureBus({ baud })` if yours differs
- Wrong UART or swapped RX/TX — UNO R4 uses `Serial1` (D0/D1); on ESP32 set the pins with `configureBus({ rxPin, txPin })`
- Give the servos their own 6–7.4 V supply with a common ground to the board
- Using the wrong series: ST/SMS servos are `'ST'` (0–4095), SC/SCS are `'SC'` (0–1023)

## "Two bus servos both moved when I set an ID"

- `setId()` addresses the current ID — with several servos sharing it, they all take the new ID. Renumber with a single servo on the bus at a time

## "Ultrasonic returns -1"

- Increase timeout: `arduino.sonar.setTimeout(50)`
- Point at a flat, hard surface (fabric and foam absorb ultrasound)
- Maximum range depends on timeout: 30 ms ≈ 500 cm
