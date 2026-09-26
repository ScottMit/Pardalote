title: Troubleshooting
lede: Common issues and their usual fixes, roughly in the order people hit them.
---
## "Can't connect"

- Check the IP address in `sketch.js` matches what the Arduino printed
- Arduino and browser must be on the same WiFi network
- Try refreshing — the Arduino may still be starting up

## "Serial Monitor is blank on an ESP32-C5, C3 or S3 (no `w` menu, board seems dead)"

On chips with native USB (ESP32-**C5**, **C3**, **S3**), **Tools → USB CDC On Boot** decides whether your sketch's `Serial` is routed to the USB port or to hardware UART0. With it **Disabled**, `Serial.print` goes out the UART pins and never reaches the USB Serial Monitor — so the [WiFi setup `w` menu](wifi.html#option-b-eeprom-serial-monitor) never appears and the board looks hung, even though Pardalote is booting and running fine. **Set USB CDC On Boot → `Enabled`** and re-upload.

An early `E (…) MSPI Timing: Failed to allocate dummy cacheline for PSRAM` line can still print — that's harmless ROM-bootloader noise emitted *before* the CDC setting takes effect, not a PSRAM fault. Leave **PSRAM → Disabled** unless you're driving a camera. (Confirmed on the FireBeetle 2 ESP32-C5.)

## "Connection drops every few seconds" (UNO R4)

- This is a known UNO R4 WiFi behaviour
- Pardalote handles reconnection automatically — your sketch keeps working

## "WebSocket is unstable on the UNO R4 — drops, freezes, or reconnects"

- **Keep your `loop()` tight.** The UNO R4 WiFi's WebSocket stack (WiFiS3 + arduinoWebSockets) is sensitive to how often it is serviced. Anything that blocks or slows the loop — a `delay()`, a long computation, a busy blocking peripheral — starves the WebSocket of servicing, and the connection stalls, drops, or churns "client connection lost / new client" and reconnects. A single blocking `delay(100)` in `loop()` is enough to trigger it. (See [arduinoWebSockets issue #909](https://github.com/Links2004/arduinoWebSockets/issues/909).)
- The symptom is often **indirect**. For example, dragging an `analogWrite()` PWM slider may lag and then drop the socket — not because `analogWrite()` is slow, but because something else in the loop is blocking long enough that the extra slider traffic can't be serviced in time. Fix the blocking, not the slider.
- Fixes: remove `delay()` calls from `loop()`; move slow work off the hot path; if you must do something lengthy, call `Pardalote.run()` (which services the WebSocket) periodically while it runs. The ESP32 is far less sensitive to this.
- As a smaller, defensive measure, Pardalote also rate-limits pin writes by default so a slider or draw loop can't flood the loop with parse work. PWM changes coalesce (a leading write goes out immediately, rapid follow-ups coalesce into one send carrying the final value), and writing an unchanged value — `digitalWrite()` or `analogWrite()` — is re-sent at most every 250 ms. If you've set `setWriteThrottle(0)` or `setWriteRepeat(0)`, raise them — `arduino.setWriteThrottle(20)` caps PWM changes to ~50/s per pin; `arduino.setWriteThreshold(4)` skips sub-4 duty changes; `arduino.setWriteRepeat(250)` restores the repeat limit.

## "connectSerial() can't find or open the port"

- Web Serial only exists in **Chrome and Edge** (Chromebooks included) — Safari and Firefox can't do serial; use WiFi there.
- **Close the Arduino IDE's Serial Monitor** (and Serial Plotter) first. Only one program can hold the port — if the IDE has it, the browser's picker shows the port but opening it fails, and vice versa: while the browser is connected, the IDE can't open the Serial Monitor.
- The first `connectSerial()` must be triggered by a click — browsers only show the port picker from a user gesture.
- Unplugged and replugged? Pardalote re-acquires the port automatically on the next retry; if it doesn't, click Connect again.

## "The board resets when the browser connects over serial" (ESP32)

Expected. Opening the serial port toggles the DTR/RTS lines, and the auto-reset circuit on classic ESP32 dev boards restarts the chip — the same thing the IDE does before uploading. Pardalote's probe simply waits through the reboot and connects when the board comes back (a few seconds). The UNO R4's native USB doesn't reset on open. A board switching from WiFi to USB (the default `begin()`) goes through this same reboot on ESP32 — reboot, WiFi comes up, then the switch — so a WiFi→USB switch on ESP32 takes a few seconds; on the R4 it's immediate.

## "connectSerial() connects but nothing happens / I get a 'usbBusy' message"

The board is running on WiFi and won't hand itself to USB without a deliberate user action — a safety so a background tab (or a board that's merely cabled for power) can't yank a shared WiFi board away from everyone. Click your **Connect** button: a `connectSerial()` called from a real click authorises the switch (even one that silently reuses an already-granted port, so no picker needs to appear). What *doesn't* authorise it is an **automatic** connect with no user action — a page reloading and reconnecting, or a background tab. If you're seeing this after a click, make sure `connectSerial()` is called directly from the click handler (not after an `await`, which can expire the browser's user-activation).

## "connectSerial() gets no response at all"

The console logs a hint after a few seconds. Likely causes: the board is still booting (an ESP32 resets when the port opens — wait a moment); it isn't running a Pardalote sketch; or it was started with `Pardalote.begin(PARDALOTE_WIFI)`, which is **WiFi-only and ignores USB**. Use `begin()` (WiFi + USB) or `begin(PARDALOTE_SERIAL)` (USB only) if you want to connect over the cable.

## "Wrong key for this board" over USB

You passed a [connection key](connecting.html#connection-keys) (`connectSerial({ key })`) that doesn't match the one the board set with `requireKey()` — you're likely cabled to the wrong physical board. Over USB the key is a board-identity check, so it catches exactly this. Connect to the board your sketch expects, or fix the key.

## "I reset the board while connected over USB"

It recovers on its own. The board announces the reboot over serial, and the browser — still holding the port — resumes connecting, so a board on the default `begin()` switches straight back to USB within a second or two. No click needed. (If the browser ever misses the announce it still recovers the slower way, via its heartbeat timeout.)

## "Serial connection works, then dies after a NeoPixel animation" 

`show()` disables interrupts while it streams the strip, which can drop incoming serial bytes. Pardalote's serial framing detects the corruption (CRC) and drops that message rather than desyncing — occasional lost frames during heavy animation are expected; the link itself recovers on its own.

## "Camera: poor image quality, stuck at low resolution, or `cam_hal: FB-OVF` in the Serial Monitor"

Almost always **PSRAM isn't enabled in the build.** ESP32 camera boards need PSRAM for anything above the tiniest frame size. Look for this on the Serial Monitor at startup:

```
[Camera] No PSRAM — using DRAM, forced to QQVGA
```

If you see it, the camera has fallen back to a single tiny frame buffer in internal RAM: the image is locked to QQVGA (160×120), it looks poor, and any `setResolution()` to something larger overflows that buffer — the driver then spams `cam_hal: FB-OVF` and the stream breaks.

- **Seeed XIAO ESP32S3 Sense:** it has 8 MB of *octal* PSRAM, but you must select it. **Tools → PSRAM → `OPI PSRAM`** (not "QSPI PSRAM", not "Disabled"), with the board set to XIAO ESP32S3. Re-upload — the "No PSRAM" line should be gone.
- **Other boards:** enable PSRAM under Tools (the option name varies — "OPI PSRAM", "QSPI PSRAM", or "Enabled"). Match it to what your module actually has.

Once PSRAM is detected the camera double-buffers in PSRAM and `setResolution()` works normally.

## "Camera: `FRAMESIZE_HD` gives `cam_hal: FB-OVF` / `net::ERR_INCOMPLETE_CHUNKED_ENCODING` even with PSRAM on"

`FB-OVF` means a JPEG frame was bigger than the buffer the camera driver set aside for it, so the frame was dropped; in the browser console that shows as `net::ERR_INCOMPLETE_CHUNKED_ENCODING`. The driver sizes those buffers once, when the camera starts. Older Pardalote versions started the camera at the requested resolution, which left too little room for HD frames (or for a bigger size chosen after `attach()`). **Update the Pardalote Arduino library**: it now reserves room for frames up to 1600×1200 on boards with PSRAM, and HD streams on the XIAO ESP32S3. Older versions also sent the wrong frame size on ESP32 core 3.x (asking for HD gave 800×600), so earlier reports of which sizes work may be off by a size or two. If you still see `FB-OVF`, check that PSRAM is enabled (see above), then step down a size.

## "Camera: the video stays blank in a second window or tab"

The board sends **one video stream at a time**. While another page is streaming, a second page's stream doesn't fail, it just waits, so its canvas stays blank with no error. The browser console shows a warning when this happens:

```
another page is already streaming from this camera. The board sends one video stream at a time, so this page's video will stay blank until that page is closed.
```

Close the other window or tab (or stop its stream with `detach()`) and the waiting page starts streaming by itself — no reload needed. Snapshots aren't affected — `snapshot()` has its own server and works while another page streams.

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
