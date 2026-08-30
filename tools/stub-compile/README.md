# Host stub-compile

Structural (`-fsyntax-only`) verification of the Pardalote firmware on a dev
machine with **no Arduino toolchain and no real libraries**. It confirms the
`.h`/`.cpp` sources *parse and type-check* across all three supported board
defines; it does **not** run, link, or exercise real hardware behaviour. Think
of it as "does it compile" for the ~90% of code that is platform-independent —
the last line of defence before an actual on-hardware bench.

## Run

```bash
tools/stub-compile/run.sh
```

Exit 0 = every target TU parses clean on every target board (ESP32, UNO R4
WiFi, UNO R4 Minima). Override the compiler with `CXX=clang++ run.sh`.

## What it checks

The `TUS` list in `run.sh`, compiled once per board define:

- `main_motion.cpp` — a sketch-shaped TU that includes the three motion
  extensions and exercises the sketch-callable gesture API (`gesture()`,
  `onGestureDone()`, and the coordinated `Pardalote.gesture()` builder), so
  `INSTALL_GESTURE`, `startGesture()`, and the Access methods are instantiated.
- `Pardalote.cpp`, `internal/extensions.cpp`, `internal/serial_transport.cpp`,
  `internal/led_matrix.cpp`, `internal/wifi_config.cpp` — the library TUs.

Add a TU by appending its path to `TUS`.

## Stubs

`stubs/` holds hand-written fake headers — just enough declarations for the
real Pardalote sources to parse, matching the *signatures* the code calls
(extracted from the sources, not guessed). They are deliberately thin and are
**not** behavioural: a method body that returns `0` proves nothing about
runtime, only that the call type-checks.

Covered: `Arduino.h` (core macros/types — note `min`/`max`/`constrain` are
macros, defined *after* the std includes so they don't clobber the STL),
`ESP32Servo.h`/`Servo.h`, `AccelStepper.h`, `SCServo.h` (SMS_STS + SCSCL),
`WebSocketsServer.h`, `WiFi.h`/`WiFiS3.h`, `Wire.h`, `EEPROM.h`,
`esp_system.h`, and the UNO R4 LED-matrix trio (`ArduinoGraphics.h`,
`Arduino_LED_Matrix.h`, `TextAnimation.h`).

If a real source starts calling a library method the stub lacks, the compile
fails with a clear "no matching member function" — add the missing declaration
to the stub (match the real library's signature) and re-run.

## Limits

- Parse/type only. No linking, no execution, no timing, no real protocol bytes.
- Stubs approximate signatures, not semantics. A wrong-but-compatible overload
  can hide a real API mismatch that the Arduino toolchain would catch.
- Not a substitute for the on-hardware bench (see `BENCH-TESTS.md`).
