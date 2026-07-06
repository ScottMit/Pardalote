# Stepper example

Drive a stepper motor from the browser with Pardalote. Demonstrates
accel-limited position moves, continuous rotation, live position readout,
and the `done` completion event.

## Hardware

- Arduino UNO R4 WiFi or ESP32
- A STEP/DIR stepper driver: **TMC2208**, **TMC2209**, **A4988**, or
  **EasyDriver** (or a 28BYJ-48 + ULN2003 — see `attach4wire` below)
- A stepper motor with its **own power supply** (do not run the motor coils
  off the board's 5 V rail)

Wiring for a STEP/DIR driver:

| Driver pin | Arduino |
|---|---|
| STEP | pin 2 (`STEP_PIN`) |
| DIR  | pin 3 (`DIR_PIN`) |
| EN   | pin 4 (`EN_PIN`) — optional, active-LOW on most drivers |
| GND  | shared ground with the Arduino |

Set microstepping with the driver's MS pins as usual, then tell the JS side
how many steps that makes per revolution with `setStepsPerRev()`.

## Arduino

Install the **AccelStepper** library (Arduino IDE → Manage Libraries), then
upload **File → Examples → Pardalote → stepper**. Note the IP address the
board reports (LED matrix on UNO R4, Serial Monitor on ESP32).

## Browser

1. Put the board's IP into `ArduinoIP` at the top of `sketch.js`.
2. Open `index.html` in a browser.

Controls:

| Key | Action |
|---|---|
| ← / → | jog a quarter turn |
| Space | stop (decelerate) |
| R | spin continuously |
| H | return to home (position 0) |

## Notes

- **Motion runs on the board.** The browser sends targets and motion
  profiles; the Arduino generates the step pulses via AccelStepper. You never
  stream individual steps over WiFi.
- **Soft limits** (`setLimits(-6400, 6400)`) are enforced on the Arduino — the
  board clamps every target, so the browser (or an LLM driving it) can't send
  the motor past the set range.
- **`done`** fires when a position move completes. `await arduino.x.moveToAsync(n)`
  resolves at the same moment — handy for sequencing moves.
